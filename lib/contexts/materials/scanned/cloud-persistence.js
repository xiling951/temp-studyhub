import { randomUUID } from 'node:crypto';
import { mkdir, readFile, readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { atomicJson, readJsonFile } from '../../../atomic-json.js';
import { convertHome, jobDir } from '../../../mineru-paths.js';
import { digest, loadManifest, objectPath, retainPdf, verifyAsset } from '../visual-storage.js';
import { CLOUD_ADAPTER, CLOUD_PROMPT, CLOUD_RENDER_DPI } from './cloud-result.js';
import { CLOUD_REVIEW_PROMPT, CLOUD_REPAIR_PROMPT } from './cloud-review.js';

export const CLOUD_IMPORT_KIND = 'cloud-textbook-import';
const HASH = /^[a-f0-9]{64}$/;
const encode = value => Buffer.from(JSON.stringify(value));
export async function prepareCloudInput(root, upload, options, route, modelInfo, signal) {
  const pageOffset = options.pageOffset || 0;
  if (!Number.isSafeInteger(pageOffset) || pageOffset < 0 || pageOffset > 100000) throw new Error('Invalid visual page offset');
  const runId = `cloud-${randomUUID()}`, dir = jobDir(root, runId);
  const original = await retainPdf(root, upload.path, { signal });
  const legacyConfig = { adapter: 1, promptHash: digest(Buffer.from(CLOUD_PROMPT)), dpi: CLOUD_RENDER_DPI, deskew: false, pageOffset, requestedEffort: 'lowest', maxOutputTokens: 12000, rateLimitRetries: 2 };
  const config = { ...legacyConfig, adapter: CLOUD_ADAPTER, reviewVersion: 1, reviewPromptHash: digest(Buffer.from(CLOUD_REVIEW_PROMPT)),
    repairPromptHash: digest(Buffer.from(CLOUD_REPAIR_PROMPT)), reviewMaxOutputTokens: 8000, repairRounds: 1, syntaxRetries: 1 };
  const identity = { original: original.hash, route: { provider: route.provider, model: route.model }, modelVersion: modelInfo?.version || null, config };
  const fingerprint = digest(encode(identity));
  const legacyFingerprint = digest(encode({ ...identity, config: legacyConfig }));
  const { uploadId: _uploadId, ...savedOptions } = options;
  const record = { schema: 1, runId, original, name: upload.name, options: savedOptions, ...identity, fingerprint,
    legacyFingerprint, legacyRevision: `cloud1-${legacyFingerprint}`, documentId: `visual-${original.hash}`, revision: `cloud1-${fingerprint}` };
  // Keep the descriptor, not credentials or an expiring upload ID, as the restart authority.
  record.original = original;
  await mkdir(dir, { recursive: true }); await atomicJson(join(dir, 'manifest.json'), { input: record });
  return { runId };
}

export async function cloudInputs(root) {
  const dir = join(convertHome(root), 'jobs');
  const entries = await readdir(dir, { withFileTypes: true }).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  return entries.filter(entry => entry.isDirectory() && /^cloud-[a-f0-9-]{36}$/.test(entry.name)).map(entry => ({ runId: entry.name }));
}

export async function openCloudPersistence(input, binding) {
  if (!/^cloud-[a-f0-9-]{36}$/.test(input.runId)) throw new Error('Invalid cloud run identity');
  const { root, read, update } = binding, dir = jobDir(root, input.runId), file = join(dir, 'manifest.json');
  const record = (await readJsonFile(file)).input, hash = digest(encode(record));
  if (record.schema !== 1 || record.runId !== input.runId) throw new Error('Cloud input identity conflict');
  const inputRef = { id: input.runId, hash, size: record.original.bytes };
  const readOutput = async ref => {
    if (!HASH.test(ref)) throw new Error('Invalid cloud result identity');
    const path = join(dir, `${ref}.json`);
    if ((await lstat(path)).size > 2 * 1024 * 1024) throw new Error('Cloud checkpoint exceeds budget');
    const bytes = await readFile(path);
    if (digest(bytes) !== ref) throw new Error('Cloud checkpoint hash mismatch');
    return JSON.parse(bytes);
  };
  const saveOutput = async value => {
    const hash = digest(encode(value)); await atomicJson(join(dir, `${hash}.json`), value); return hash;
  };
  const stageNames = new Set(['recognize', 'review', 'repair', 'rereview']);
  const stageIndex = async number => {
    if (!Number.isSafeInteger(number) || number < 1 || number > 10000) throw new Error('Invalid cloud stage page');
    const path = join(dir, `page-${number}-stages.json`);
    const value = await readJsonFile(path).catch(error => { if (error.code === 'ENOENT') return { schema: 1, fingerprint: record.fingerprint, page: number, stages: {} }; throw error; });
    if (value.schema !== 1 || value.fingerprint !== record.fingerprint || value.page !== number || !value.stages || typeof value.stages !== 'object' || Array.isArray(value.stages)) throw new Error('Cloud stage identity conflict');
    return { path, value };
  };
  const readStage = async (number, name, inputHash) => {
    if (!stageNames.has(name) || !HASH.test(inputHash)) throw new Error('Invalid cloud stage identity');
    const { value: index } = await stageIndex(number), ref = index.stages[name];
    if (!ref) return null;
    const value = await readOutput(ref);
    if (value.schema !== 1 || value.fingerprint !== record.fingerprint || value.page !== number || value.stage !== name || value.inputHash !== inputHash) throw new Error('Cloud stage input changed');
    return { ref, value: value.value };
  };
  const saveStage = async (number, name, inputHash, value) => {
    if (!stageNames.has(name) || !HASH.test(inputHash)) throw new Error('Invalid cloud stage identity');
    const prior = await readStage(number, name, inputHash);
    if (prior) {
      if (digest(encode(prior.value)) !== digest(encode(value))) throw new Error('Cloud stage already contains different output');
      return prior.ref;
    }
    const output = { schema: 1, fingerprint: record.fingerprint, page: number, stage: name, inputHash, value };
    if (encode(output).length > 2 * 1024 * 1024) throw new Error('Cloud stage output exceeds budget');
    const hash = await saveOutput(output), { path, value: index } = await stageIndex(number);
    index.stages[name] = hash; await atomicJson(path, index); return hash;
  };
  const validatePage = async item => {
    const value = await readOutput(item.hash);
    if (value.fingerprint !== record.fingerprint || value.page.page !== item.page || !Array.isArray(value.assets)) throw new Error('Cloud page identity conflict');
    for (const asset of value.assets) await verifyAsset(root, asset);
    return value;
  };
  const checkpoint = async completed => {
    const hash = await saveOutput({ schema: 1, fingerprint: record.fingerprint, completed });
    return { version: 1, ref: hash, digest: hash, stepKey: 'cloud-pages' };
  };
  const validateCheckpoint = async checkpoint => {
    if (checkpoint.version !== 1 || checkpoint.ref !== checkpoint.digest || checkpoint.stepKey !== 'cloud-pages') throw new Error('Invalid cloud checkpoint');
    const value = await readOutput(checkpoint.ref);
    if (value.schema !== 1 || value.fingerprint !== record.fingerprint || !Array.isArray(value.completed) || value.completed.length > 10000) throw new Error('Cloud checkpoint identity conflict');
    for (const [index, item] of value.completed.entries()) { if (item.page !== index + 1) throw new Error('Cloud checkpoint page gap'); await validatePage(item); }
  };
  const receipt = async () => {
    const state = await read(), versions = state.documents?.find(doc => doc.id === record.documentId)?.versions;
    const version = versions?.find(version => version.revision === record.revision) ||
      (record.legacyRevision && versions?.find(version => version.revision === record.legacyRevision));
    if (!version) return { notPublished: true };
    const manifest = await loadManifest(root, version.visual);
    const legacy = version.revision === record.legacyRevision;
    if (manifest.fingerprint !== (legacy ? record.legacyFingerprint : record.fingerprint) || manifest.documentId !== record.documentId || manifest.revision !== version.revision) throw new Error('Cloud publication identity conflict');
    for (const asset of manifest.assets) await verifyAsset(root, asset);
    for (const page of manifest.pages) if (page.sourceId && state.sources.find(source => source.id === page.sourceId)?.text !== page.text) throw new Error('Cloud source projection conflict');
    return { refs: [{ kind: 'document', id: record.documentId }, ...version.sourceIds.map(id => ({ kind: 'source', id }))], legacyUnreviewed: !!legacy,
      reviewRequired: manifest.quality.reviewRequired !== false };
  };
  return { input, record, dir, inputRef, store: binding.manifestJobStore(file), readOutput, saveOutput, readStage, saveStage, validatePage, checkpoint,
    async retired() { return (await readJsonFile(file)).retired === true; },
    async retire() {
      const saved = await readJsonFile(file);
      if (['queued', 'running', 'pausing', 'paused', 'cancelling'].includes(saved.runtimeJob?.contract.status)) throw new Error('Cannot retire an active cloud task');
      saved.retired = true; await atomicJson(file, saved);
    },
    async validateInput(ref) {
      const current = (await readJsonFile(file)).input;
      if (ref.id !== inputRef.id || ref.hash !== hash || ref.size !== inputRef.size || digest(encode(current)) !== hash) throw new Error('Cloud input changed');
      await verifyAsset(root, record.original);
      if (!record.route?.provider || !record.route?.model || record.config.promptHash !== digest(Buffer.from(CLOUD_PROMPT))) throw new Error('Cloud configuration changed');
      if (record.config.reviewVersion && (record.config.reviewPromptHash !== digest(Buffer.from(CLOUD_REVIEW_PROMPT)) ||
        record.config.repairPromptHash !== digest(Buffer.from(CLOUD_REPAIR_PROMPT)) || record.config.repairRounds !== 1 || record.config.syntaxRetries !== 1)) throw new Error('Cloud verification configuration changed');
    }, validateCheckpoint, reconcileCommit: receipt,
    async publish({ visual, sources }, { assertCurrent }) {
      assertCurrent();
      await update(state => {
        assertCurrent(); state.documents ||= []; state.sources ||= [];
        let document = state.documents.find(doc => doc.id === record.documentId);
        if (!document) { document = { id: record.documentId, title: record.options.title || record.name, filename: record.name, format: 'pdf', courses: record.options.courses || [], versions: [] }; state.documents.push(document); }
        const previous = document.versions.find(version => version.revision === record.revision);
        if (previous && previous.visual.manifestHash !== visual.manifestHash) throw new Error('Cloud revision already contains different output');
        if (!previous) {
          for (const source of sources) {
            const prior = state.sources.find(item => item.id === source.id);
            if (prior && prior.text !== source.text) throw new Error('Cloud source identity conflict');
            if (!prior) state.sources.push(source);
          }
          document.versions.push({ revision: record.revision, importedAt: new Date().toISOString(), sourceIds: sources.map(source => source.id), attachment: null, visual });
        }
        document.currentRevision = record.revision;
      });
      return receipt();
    }, async originalPath() { return objectPath(root, record.original.hash); },
  };
}
