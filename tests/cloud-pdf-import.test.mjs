import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, degrees } from 'pdf-lib';
import { createStudyRuntime } from '../lib/runtime/builtins.js';
import { loadManifest, hashFile, digest, saveManifest } from '../lib/contexts/materials/visual-storage.js';
import { adaptCloudPage, decodeCloudPage, renderCloudRegion } from '../lib/contexts/materials/scanned/cloud-result.js';
import { pdfHelper } from '../lib/contexts/materials/visual-parser.js';
import { runLocalCommand } from '../lib/local-command.js';
import { verifyAsset } from '../lib/contexts/materials/visual-storage.js';
import { validateReading, buildReading } from '../lib/contexts/materials/visual-reading.js';
import { reportUsage } from '../lib/usage-scope.js';
import { until } from './helpers/wait.mjs';
import { CLOUD_REVIEW_DIMENSIONS, CLOUD_REVIEW_PROMPT, CLOUD_REPAIR_PROMPT, decodeCloudReview } from '../lib/contexts/materials/scanned/cloud-review.js';
import { convertHome } from '../lib/mineru-paths.js';

const executor = { assertAvailable() {}, witness: () => ({ pid: process.pid, host: 'synthetic', instance: 'cloud-pdf' }),
  start({ run, cancel }) { void run(); return { id: 'fixture-native', ownerAgentId: 'owner', stop: cancel, append() {} }; } };
async function setup(t, { failPage, beforeAnswer, onRequest } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'cloud-pdf-')); t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = createStudyRuntime(root); t.after(() => runtime.dispose());
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([300, 400]); page.drawText('Repeated fixture text', { x: 30, y: 350 }); page.drawText('Repeated fixture text', { x: 30, y: 300 });
  const rotated = pdf.addPage([300, 400]); rotated.setCropBox(20, 30, 260, 340); rotated.setRotation(degrees(90)); rotated.drawRectangle({ x: 50, y: 100, width: 50, height: 150 });
  pdf.addPage([300, 400]);
  const bytes = Buffer.from(await pdf.save()), path = join(root, 'fixture.pdf'); await writeFile(path, bytes);
  await runtime.call('settings', { scannedTextbooks: true });
  const calls = [], modelCalls = [], attachments = new Map(); let rejects = failPage ? 2 : 0;
  const complete = Object.assign(async () => { throw new Error('No text-only fallback'); }, { completeContent: async (system, parts, request) => {
    const payload = JSON.parse(parts[0].text), number = payload.page;
    const stage = system.startsWith(CLOUD_REVIEW_PROMPT) ? 'review' : system.startsWith(CLOUD_REPAIR_PROMPT) ? 'repair' : 'recognize';
    assert.equal(parts[1].type, 'image'); assert.ok(attachments.get(parts[1].attachment.attachmentId).length > 100);
    assert.equal(request.route.provider, 'synthetic'); assert.equal(request.route.model, 'vision');
    assert.ok((['review', 'rereview'].includes(stage) ? [8000, 16000] : [12000, 24000]).includes(request.maxTokens));
    modelCalls.push({ page: number, stage });
    if (stage !== 'review') calls.push(number);
    reportUsage({ uncachedInputTokens: 10, outputTokens: 5 });
    if (stage !== 'review') await beforeAnswer?.(number, request);
    const custom = await onRequest?.({ system, payload, request, number, stage, modelCalls });
    if (custom !== undefined) return custom;
    if (stage === 'review') return JSON.stringify({ verdict: payload.candidate.blocks.some(block => block.uncertainty.length) ? 'uncertain' : 'pass',
      checks: CLOUD_REVIEW_DIMENSIONS.map(dimension => ({ dimension, passed: true, evidence: 'Synthetic original page comparison' })),
      issues: [], uncertainty: payload.candidate.blocks.some(block => block.uncertainty.length) ? ['Synthetic crop uncertainty is retained'] : [] });
    if (number === failPage && rejects > 0) { rejects--; return '{"blocks":['; }
    return JSON.stringify({ blank: number === 3, printedPage: null, uncertainty: [], blocks: number === 1 ? [
      { type: 'title', text: 'Chapter fixture', bbox: [0, 0, 1, 0.1], uncertainty: [] },
      { type: 'text', text: 'Repeated fixture text', bbox: [0, 0.1, 1, 0.3], uncertainty: [] },
      { type: 'text', text: 'Repeated fixture text', bbox: [0, 0.3, 1, 0.5], uncertainty: [] },
    ] : number === 2 ? [{ type: 'chart', text: 'Real fixture rectangle', bbox: [0.2, 0.1, 0.8, 0.9], uncertainty: ['Synthetic region requires review'] }] : [] });
  } });
  const ctx = { llm: { resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }) }, attachments: {
    saveImages: async images => images.map((image, index) => { const id = `image-${attachments.size}-${index}`; attachments.set(id, image.data); return { attachmentId: id, mediaType: image.mediaType, bytes: image.data.length }; }),
    readImage: async ref => { if (!attachments.has(ref.attachmentId)) throw new Error('Missing native image'); return { data: attachments.get(ref.attachmentId) }; },
  } };
  const services = { complete, jobExecutor: executor, workOwner: Symbol('fixture'), jobModelHost: { ctx, complete, route: { provider: 'synthetic', model: 'vision' } } };
  const start = async (extra = {}) => {
    const upload = await runtime.call('materials.visual.upload.start', { name: 'fixture.pdf', size: bytes.length });
    await runtime.call('materials.visual.upload.append', { uploadId: upload.uploadId, offset: 0, data: bytes.toString('base64') });
    await runtime.call('materials.visual.upload.finish', { uploadId: upload.uploadId });
    return runtime.call('materials.visual.import', { uploadId: upload.uploadId, parser: 'cloud', modelKey: '["synthetic","vision"]', ...extra }, services);
  };
  const wait = async id => { await until(() => ['complete', 'failed', 'cancelled', 'interrupted', 'recovery-required'].includes(runtime.work.jobs.get(id)?.status), 'synthetic cloud parser', { timeoutMs: 20000 }).catch(error => { const c = runtime.work.jobs.get(id)?.contract; throw new Error(`${error.message}: ${JSON.stringify({ status: c?.status, detail: c?.detail, error: c?.error })}`); }); return runtime.work.jobs.get(id).contract; };
  return { root, runtime, bytes, path, calls, modelCalls, start, wait, services };
}

test('cloud import uses real rendered native attachments, immutable source ranges and schema=1 reading', async t => {
  const { root, runtime, calls, modelCalls, start, wait, path } = await setup(t), before = await hashFile(path);
  const started = await start(), job = await wait(started.jobId);
  assert.equal(job.status, 'complete', job.error?.message); assert.equal(job.result.completeness, 'partial'); assert.deepEqual(calls, [1, 2, 3]);
  assert.equal(job.usage.tokens, 90); assert.deepEqual(modelCalls.map(call => call.stage), ['recognize', 'review', 'recognize', 'review', 'recognize', 'review']);
  assert.ok(job.calls.filter(call => !call.modelRequest).length > 0);
  const state = await runtime.storage.read(), doc = state.documents[0], manifest = await loadManifest(root, doc.versions[0].visual);
  assert.equal(manifest.schema, 1); assert.equal(state.version, 4); assert.equal(manifest.pages.length, 3); assert.equal(state.sources.length, 2);
  assert.equal(manifest.pages[2].sourceId, null); assert.equal(manifest.pages[1].geometry.rotation, 90); assert.ok(manifest.pages[1].blocks[0].assetId);
  assert.equal(manifest.quality.humanVerified, false); assert.equal(manifest.quality.automatedReview.checkedPages, 2);
  assert.deepEqual(manifest.quality.uncertainPages, [2]); assert.equal(manifest.pages[0].automatedReview.status, 'model-checked');
  assert.equal(manifest.pages[1].blocks[0].cropVerified, false, 'model checking never claims human crop verification');
  for (const page of manifest.pages.filter(page => page.sourceId)) assert.equal(state.sources.find(source => source.id === page.sourceId).text, page.text);
  const nodes = (await runtime.call('materials.visual.reading', { documentId: doc.id, pageStart: 1, pageEnd: 2 })).nodes;
  assert.equal(nodes[1].text, nodes[2].text); assert.notEqual(nodes[1].anchors[0].start, nodes[2].anchors[0].start);
  assert.deepEqual(await hashFile(path), before);
  const block = manifest.pages[1].blocks[0], preview = await runtime.call('materials.visual.preview', { documentId: doc.id, page: 2, blockId: block.id });
  const expectedPath = join(root, 'expected-preview.png'); await pdfHelper(['cloud-render', path, '2', expectedPath, JSON.stringify(block.bbox), '160']);
  assert.equal(preview.asset.hash, digest(await readFile(expectedPath)), 'region comparison uses the same rotated CropBox frame as recognition');
  await assert.rejects(runtime.call('materials.visual.reading', { documentId: doc.id, pageEnd: 99 }), /1–10/);
  const repeated = await wait((await start()).jobId); assert.equal(repeated.status, 'complete'); assert.deepEqual(calls, [1, 2, 3], 'committed same revision needs no additional model calls');
});

test('failed page leaves no published half-version; native retry reuses verified completed pages', async t => {
  const { runtime, calls, start, wait, services } = await setup(t, { failPage: 2 });
  const started = await start(); let job = await wait(started.jobId);
  assert.equal(job.status, 'failed'); assert.equal((await runtime.storage.read()).documents.length, 0);
  const retried = await runtime.call('job.control', { jobId: started.jobId, action: 'retry' }, services);
  job = await wait(retried.attemptId);
  assert.equal(job.status, 'complete', job.error?.message); assert.deepEqual(calls, [1, 2, 2, 2, 3]);
  const state = await runtime.storage.read(); assert.equal(state.documents[0].versions.length, 1); assert.equal(state.sources.length, 2);
});

test('bad cloud route/unknown parameters fail before claiming the uploaded PDF', async t => {
  const { start, services, calls } = await setup(t);
  await assert.rejects(start({ parser: 'invented' }), /allowed/i);
  await assert.rejects(start({ modelKey: 'follow' }), /modelKey/);
  services.jobModelHost.ctx.llm.resolveModelInfo = async () => ({ inputModalities: ['text'] });
  await assert.rejects(start(), /图像/); assert.equal(calls.length, 0);
  assert.throws(() => decodeCloudPage('{"blank":false,"printedPage":null,"uncertainty":[],"blocks":[{"type":"text","text":"x","bbox":[0,0,2,1],"uncertainty":[]}]}'), /bounding/);
  assert.throws(() => decodeCloudPage('null'), /object/);
});

test('a changed page offset creates another revision while retaining old exact source identities', async t => {
  const { runtime, start, wait } = await setup(t);
  assert.equal((await wait((await start()).jobId)).status, 'complete'); const before = await runtime.storage.read();
  assert.equal((await wait((await start({ pageOffset: 100 })).jobId)).status, 'complete'); const after = await runtime.storage.read();
  assert.equal(after.documents[0].versions.length, 2); assert.notEqual(after.documents[0].versions[0].revision, after.documents[0].versions[1].revision);
  for (const source of before.sources) assert.deepEqual(after.sources.find(item => item.id === source.id), source);
  assert.equal(after.sources.find(source => source.document.materialRevision === after.documents[0].currentRevision).document.originalPage, 101);
});

test('429 retries are bounded and their waits are not model calls; permission errors are not retried', async t => {
  let rejected = false;
  const { start, wait, calls } = await setup(t, { beforeAnswer: number => { if (number === 1 && !rejected) { rejected = true; throw Object.assign(new Error('HTTP 429'), { status: 429 }); } } });
  const completed = await wait((await start()).jobId); assert.equal(completed.status, 'complete', completed.error?.message);
  assert.deepEqual(calls, [1, 1, 2, 3]); assert.equal(completed.calls.filter(call => call.modelRequest).length, 7);
  assert.ok(completed.calls.some(call => call.observation.boundary === 'local-wait' && !call.modelRequest));
  const denied = await setup(t, { beforeAnswer: () => { throw Object.assign(new Error('HTTP 403 permission denied'), { status: 403 }); } });
  assert.equal((await denied.wait((await denied.start()).jobId)).status, 'failed'); assert.deepEqual(denied.calls, [1]);
});

test('checkpoint pause publishes nothing; resume completes without repeating the saved page', { timeout: 20000 }, async t => {
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  t.after(() => release());
  const { runtime, calls, start, wait, services } = await setup(t, { beforeAnswer: async number => { if (number === 1) await pending; } });
  const timer = setTimeout(() => release(), 5000); t.after(() => clearTimeout(timer));
  const started = await start();
  await until(() => calls.length || runtime.work.jobs.get(started.jobId)?.contract.status === 'failed', 'first image call');
  assert.equal(calls.length, 1);
  await runtime.call('job.control', { jobId: started.jobId, action: 'pause' }, services); release();
  clearTimeout(timer);
  await until(() => runtime.work.jobs.get(started.jobId)?.contract.status === 'paused', 'cloud safe-point pause');
  assert.deepEqual(calls, [1]); assert.equal((await runtime.storage.read()).documents.length, 0);
  const resumed = await runtime.call('job.control', { jobId: started.jobId, action: 'resume' }, services);
  assert.equal((await wait(resumed.attemptId)).status, 'complete'); assert.deepEqual(calls, [1, 2, 3]);
});

test('fresh runtime restores a failed job and reuses its verified page checkpoint', async t => {
  const { root, runtime, calls, start, wait, services } = await setup(t, { failPage: 2 });
  const started = await start(), failed = await wait(started.jobId); await runtime.dispose();
  const restored = createStudyRuntime(root); t.after(() => restored.dispose());
  const snapshot = await restored.call('snapshot', {}, services);
  const job = snapshot.jobs.find(job => job.contract.jobId === failed.jobId);
  assert.ok(job, 'persisted task is discoverable after a restart');
  assert.equal(job.contract.status, 'failed'); assert.ok(job.contract.actions.retry.available);
  const retried = await restored.call('job.control', { jobId: job.id, action: 'retry' }, services);
  await until(() => restored.work.jobs.get(retried.attemptId)?.status === 'complete', 'restored cloud job', { timeoutMs: 20000 });
  assert.deepEqual(calls, [1, 2, 2, 2, 3]); assert.equal((await restored.storage.read()).documents[0].versions.length, 1);
});

test('archived and dismissed cloud tasks stay out of snapshots and do not reappear after restart', async t => {
  const { root, runtime, start, wait, services } = await setup(t);
  const started = await start(), complete = await wait(started.jobId);
  await runtime.call('job.archive', { jobId: started.jobId }, services);
  assert.ok(!(await runtime.call('snapshot', {}, services)).jobs.some(job => job.contract.jobId === complete.jobId));
  await runtime.call('job.delete', { jobIds: [complete.jobId] }, services);
  await runtime.dispose(); const restored = createStudyRuntime(root); t.after(() => restored.dispose());
  assert.ok(!(await restored.call('snapshot', {}, services)).jobs.some(job => job.contract.jobId === complete.jobId));
  assert.equal((await restored.storage.read()).documents.length, 1, 'removing a task preserves its published document');
});

test('rotation/CropBox renderer crops in rotated coordinates and respects the pixel budget', async t => {
  const { root, path } = await setup(t), output = join(root, 'rotated.png');
  const info = await pdfHelper(['cloud-render', path, '2', output, '[0.1,0.2,0.9,0.8]', '200']);
  assert.equal(info.rotation, 90); assert.ok(info.renderWidth > info.renderHeight);
  assert.ok(info.renderWidth * info.renderHeight <= 12000000); assert.ok((await readFile(output)).length > 100);
  assert.ok(Math.abs(info.bbox[0] - 0.1) <= 1 / info.renderWidth);
});

test('unlocated pure image blocks keep the real original page in reading and export mappings', async t => {
  const { root, path } = await setup(t), rendered = await renderCloudRegion(root, path, 2, root, null);
  const value = decodeCloudPage(JSON.stringify({ blank: false, printedPage: 131, uncertainty: [], blocks: [{ type: 'chart', text: '', bbox: null, uncertainty: ['Cannot confirm crop coordinates'] }] }));
  const result = await adaptCloudPage(root, value, { number: 2, originalPath: path, renderDir: root, rendered });
  assert.equal(result.page.printedPage, '131'); assert.equal(result.page.blocks[0].quality, 'original-page-fallback');
  assert.equal(result.page.blocks[0].assetId, result.page.previewAssetId); assert.equal(result.page.blocks[0].bbox, null);
  const reading = buildReading([result.page]); assert.equal(reading.nodes.length, 1); assert.equal(reading.nodes[0].anchors[0].sourceId, null);
  assert.equal(reading.nodes[0].anchors[0].assetId, result.page.previewAssetId);
});

test('reading export preserves chapter mappings and relative assets; full backup restores exact sources and visual hashes', async t => {
  const { root, runtime, start, wait } = await setup(t);
  assert.equal((await wait((await start()).jobId)).status, 'complete');
  await runtime.call('materials.document.import', { filename: 'old.txt', dataBase64: Buffer.from('Old immutable quote').toString('base64') });
  const before = await runtime.storage.read(), document = before.documents.find(item => item.versions.some(version => version.visual));
  const manifest = await loadManifest(root, document.versions[0].visual);
  const download = async transfer => {
    const chunks = [];
    for (let offset = 0; offset < transfer.bytes;) {
      const chunk = await runtime.call('materials.visual.export.chunk', { transferId: transfer.transferId, offset });
      chunks.push(Buffer.from(chunk.dataBase64, 'base64')); offset += chunk.bytes;
    }
    await runtime.call('materials.visual.export.discard', { transferId: transfer.transferId }); return Buffer.concat(chunks);
  };
  const book = await download(await runtime.call('materials.visual.export', { documentId: document.id })), bookPath = join(root, 'book.zip'); await writeFile(bookPath, book);
  const inspected = await runLocalCommand({ file: process.env.STUDYHUB_PDF_PYTHON || 'python' }, ['-c', 'import zipfile,json,sys,re,posixpath; z=zipfile.ZipFile(sys.argv[1]); names=set(z.namelist()); m=json.loads(z.read("mappings.json")); d=json.loads(z.read("document.json")); chapters=[n for n in names if n.startswith("chapters/")]; assert m["nodes"]==[{"id":n["id"],"anchors":n["anchors"]} for n in d["reading"]["nodes"]]; assert chapters; assert "Repeated fixture text" in z.read("textbook.md").decode(); assert "data-page=\\"2\\"" in z.read("index.html").decode(); refs=[posixpath.normpath(posixpath.join(posixpath.dirname(n),src)) for n in ["index.html"]+chapters for src in re.findall(r"src=\\"([^\\"]+)\\"",z.read(n).decode())]; assert refs and all(r in names for r in refs); print("chapter-mappings-assets-ok")', bookPath]);
  assert.equal(inspected.code, 0, inspected.stderr); assert.equal(inspected.stdout.trim(), 'chapter-mappings-assets-ok');
  const broken = structuredClone(manifest); broken.reading.chapters[0].id = '../escape'; assert.throws(() => validateReading(broken), /Invalid/);
  const shifted = structuredClone(manifest); shifted.reading.nodes[1].anchors[0].start++; assert.throws(() => validateReading(shifted), /Invalid/);
  const omitted = structuredClone(manifest); omitted.reading.nodes.pop(); assert.throws(() => validateReading(omitted), /Invalid/);
  const backup = await download(await runtime.call('library.visualBackup.export'));
  const destinationRoot = await mkdtemp(join(tmpdir(), 'cloud-restore-')); t.after(() => rm(destinationRoot, { recursive: true, force: true }));
  const destination = createStudyRuntime(destinationRoot); t.after(() => destination.dispose());
  const upload = await destination.call('materials.visual.backup.upload.start', { name: 'backup.zip', size: backup.length });
  for (let offset = 0; offset < backup.length; offset += 262144) await destination.call('materials.visual.backup.upload.append', { uploadId: upload.uploadId, offset, data: backup.subarray(offset, offset + 262144).toString('base64') });
  await destination.call('materials.visual.backup.upload.finish', { uploadId: upload.uploadId });
  await destination.call('library.visualBackup.restore', { uploadId: upload.uploadId });
  const after = await destination.storage.read(); assert.deepEqual(after.sources, before.sources); assert.deepEqual(after.documents, before.documents);
  const recovered = await loadManifest(destinationRoot, after.documents.find(item => item.id === document.id).versions[0].visual);
  assert.deepEqual(recovered, manifest); for (const asset of recovered.assets) await verifyAsset(destinationRoot, asset);
  assert.equal(Buffer.from((await destination.call('materials.document.bytes', { documentId: before.documents.find(item => item.filename === 'old.txt').id })).dataBase64, 'base64').toString(), 'Old immutable quote');
});

const checked = (verdict = 'pass', issues = [], uncertainty = []) => JSON.stringify({ verdict, checks: CLOUD_REVIEW_DIMENSIONS.map(dimension => ({
  dimension, passed: verdict === 'pass', evidence: dimension === 'literal' ? 'Original page prints Repeated fixture text twice' : 'Compared with the original rendered fixture page',
})), issues, uncertainty });
const fixturePage = text => JSON.stringify({ blank: false, printedPage: null, uncertainty: [], blocks: [{ type: 'text', text, bbox: [0.1, 0.1, 0.9, 0.5], uncertainty: [] }] });

test('verification requires every dimension and cannot accept a pass with concrete discrepancies', () => {
  const candidate = decodeCloudPage(fixturePage('Repeated fixture text'));
  assert.equal(decodeCloudReview(checked(), candidate).verdict, 'pass');
  assert.throws(() => decodeCloudReview('{"verdict":"pass","checks":[],"issues":[],"uncertainty":[]}', candidate), /coverage/);
  assert.throws(() => decodeCloudReview(checked('pass', [{ blockIndex: 0, kind: 'literal', detail: 'Wrong original-page character' }]), candidate), /contradicts/);
  assert.throws(() => decodeCloudReview(checked('repair'), candidate), /concrete/);
  assert.throws(() => decodeCloudReview(checked('uncertain', [{ blockIndex: 4, kind: 'literal', detail: 'Invented block index' }]), candidate), /coverage/);
});

test('a model output limit gets one larger bounded retry and reuses the saved transcription', async t => {
  let limited = true;
  const { root, runtime, start, wait, modelCalls } = await setup(t, { onRequest: ({ number, stage }) => {
    if (number === 1 && stage === 'review' && limited) { limited = false; throw Error('Study subagent max-tokens: max-tokens'); }
  } });
  const job = await wait((await start()).jobId);
  assert.equal(job.status, 'complete', job.error?.message);
  assert.deepEqual(modelCalls.filter(call => call.page === 1).map(call => call.stage), ['recognize', 'review', 'review']);
  const state = await runtime.storage.read(), manifest = await loadManifest(root, state.documents[0].versions[0].visual);
  assert.equal(manifest.pages[0].automatedReview.syntaxRepairs, 1);
  assert.equal(manifest.pages[0].automatedReview.status, 'model-checked');
});

test('repeated output-limit failures stop after the one retry without publishing', async t => {
  const { runtime, start, wait, modelCalls } = await setup(t, { onRequest: ({ stage }) => {
    if (stage === 'review') throw Error('Study subagent max-tokens: max-tokens');
  } });
  const job = await wait((await start()).jobId);
  assert.equal(job.status, 'failed');
  assert.deepEqual(modelCalls.map(call => call.stage), ['recognize', 'review', 'review']);
  assert.equal((await runtime.storage.read()).documents.length, 0);
});

test('a reasoning-only empty response gets one format retry, while repeated emptiness remains a failure', async t => {
  for (const always of [false, true]) {
    let first = true;
    const { runtime, start, wait, modelCalls } = await setup(t, { onRequest: ({ number, stage }) => {
      if (number === 1 && stage === 'review' && (always || first)) { first = false; throw Error('Model returned no text'); }
    } });
    const job = await wait((await start()).jobId);
    assert.equal(job.status, always ? 'failed' : 'complete', job.error?.message);
    assert.equal(modelCalls.filter(call => call.page === 1 && call.stage === 'recognize').length, 1);
    assert.equal(modelCalls.filter(call => call.page === 1 && call.stage === 'review').length, 2);
    if (always) assert.equal((await runtime.storage.read()).documents.length, 0);
  }
});

test('fully model-checked material and its exact cache report completion without claiming human review', async t => {
  const { root, runtime, start, wait, modelCalls } = await setup(t, { onRequest: ({ number, stage }) => {
    if (number === 2 && stage === 'recognize') return JSON.stringify({ blank: false, printedPage: null, uncertainty: [],
      blocks: [{ type: 'chart', text: 'Real fixture rectangle', bbox: [0.2, 0.1, 0.8, 0.9], uncertainty: [] }] });
  } });
  const job = await wait((await start()).jobId);
  assert.equal(job.result.completeness, 'complete');
  const state = await runtime.storage.read(), document = state.documents[0], manifest = await loadManifest(root, document.versions[0].visual);
  assert.equal(manifest.quality.reviewRequired, false); assert.equal(manifest.quality.humanVerified, false);
  assert.equal((await runtime.call('materials.visual.reading', { documentId: document.id })).reviewRequired, false);
  const calls = modelCalls.length, cached = await wait((await start()).jobId);
  assert.equal(cached.result.completeness, 'complete'); assert.equal(modelCalls.length, calls);
});

test('one malformed response is repaired automatically with no user retry and no text-only fallback', async t => {
  let invalid = true;
  const { root, runtime, start, wait, modelCalls } = await setup(t, { onRequest: ({ number, stage }) => {
    if (number === 1 && stage === 'recognize' && invalid) { invalid = false; return '{"blank":'; }
  } });
  const job = await wait((await start()).jobId);
  assert.equal(job.status, 'complete', job.error?.message);
  assert.deepEqual(modelCalls.filter(call => call.page === 1).map(call => call.stage), ['recognize', 'recognize', 'review']);
  const document = (await runtime.storage.read()).documents[0], manifest = await loadManifest(root, document.versions[0].visual);
  assert.equal(manifest.pages[0].automatedReview.syntaxRepairs, 1);
  assert.equal(manifest.pages[0].automatedReview.status, 'model-checked');
});

test('specific original-page discrepancies trigger only one rewrite and an independent image rereview', async t => {
  const { root, runtime, start, wait, modelCalls } = await setup(t, { onRequest: ({ number, stage, payload }) => {
    if (number !== 1) return;
    if (stage === 'recognize') return fixturePage('Repeated fixture typo');
    if (stage === 'repair') { assert.equal(payload.findings[0].kind, 'literal'); return fixturePage('Repeated fixture text'); }
    if (stage === 'review') return payload.candidate.blocks[0].text.endsWith('typo') ? checked('repair', [{ blockIndex: 0, kind: 'literal', detail: 'The original page prints text, not typo' }]) : checked();
  } });
  const job = await wait((await start()).jobId);
  assert.equal(job.status, 'complete', job.error?.message);
  assert.deepEqual(modelCalls.filter(call => call.page === 1).map(call => call.stage), ['recognize', 'review', 'repair', 'review']);
  const document = (await runtime.storage.read()).documents[0], manifest = await loadManifest(root, document.versions[0].visual), page = manifest.pages[0];
  assert.equal(page.text, 'Repeated fixture text'); assert.equal(page.automatedReview.repairs, 1);
  assert.equal(page.automatedReview.status, 'model-checked'); assert.notEqual(page.automatedReview.initialCandidateRef, page.automatedReview.selectedCandidateRef);
  assert.ok(page.automatedReview.repairRef); assert.ok(page.automatedReview.rereviewRef);
  assert.deepEqual(manifest.quality.automatedReview.repairedPages, [1]); assert.equal(manifest.quality.humanVerified, false);
  assert.equal((await runtime.storage.read()).sources.find(source => source.id === page.sourceId).text, page.text);
});

test('a valid rejection after bounded repair preserves the first candidate and exposes uncertainty', async t => {
  const { root, runtime, start, wait, modelCalls } = await setup(t, { onRequest: ({ number, stage, payload }) => {
    if (number !== 1) return;
    if (stage === 'recognize') return fixturePage('Repeated fixture uncertain');
    if (stage === 'repair') return fixturePage('Unconfirmed replacement');
    if (stage === 'review') return payload.candidate.blocks[0].text === 'Unconfirmed replacement' ?
      checked('uncertain', [{ blockIndex: 0, kind: 'literal', detail: 'Replacement does not match the visible original page' }], ['Do not certify this rewrite']) :
      checked('repair', [{ blockIndex: 0, kind: 'literal', detail: 'Original visible text differs from the first candidate' }]);
  } });
  const job = await wait((await start()).jobId);
  assert.equal(job.status, 'complete', job.error?.message);
  assert.deepEqual(modelCalls.filter(call => call.page === 1).map(call => call.stage), ['recognize', 'review', 'repair', 'review']);
  const document = (await runtime.storage.read()).documents[0], manifest = await loadManifest(root, document.versions[0].visual), page = manifest.pages[0];
  assert.equal(page.text, 'Repeated fixture uncertain'); assert.equal(page.automatedReview.status, 'uncertain');
  assert.equal(page.automatedReview.initialCandidateRef, page.automatedReview.selectedCandidateRef);
  assert.ok(page.uncertainty.some(text => text.includes('does not match'))); assert.ok(page.previewAssetId);
  assert.ok(manifest.quality.uncertainPages.includes(1)); assert.equal(manifest.quality.reviewRequired, true);
});

test('a restart after review transport failure reuses the paid transcription before the page checkpoint', async t => {
  let refused = true;
  const { root, runtime, calls, modelCalls, start, wait, services } = await setup(t, { onRequest: ({ number, stage }) => {
    if (number === 1 && stage === 'review' && refused) { refused = false; throw Object.assign(new Error('HTTP 503 synthetic review interruption'), { status: 503 }); }
  } });
  const started = await start(), failed = await wait(started.jobId); assert.equal(failed.status, 'failed');
  assert.deepEqual(calls, [1]); assert.equal((await runtime.storage.read()).documents.length, 0);
  await runtime.dispose(); const restored = createStudyRuntime(root); t.after(() => restored.dispose());
  const snapshot = await restored.call('snapshot', {}, services), oldJob = snapshot.jobs.find(job => job.contract.jobId === failed.jobId);
  const retry = await restored.call('job.control', { jobId: oldJob.id, action: 'retry' }, services);
  await until(() => ['complete', 'failed'].includes(restored.work.jobs.get(retry.attemptId)?.status), 'restored page stage', { timeoutMs: 20000 });
  assert.equal(restored.work.jobs.get(retry.attemptId).contract.status, 'complete', restored.work.jobs.get(retry.attemptId).contract.error?.message);
  assert.deepEqual(calls, [1, 2, 3], 'the failed review never repeats the saved transcription request');
  assert.deepEqual(modelCalls.filter(call => call.page === 1).map(call => call.stage), ['recognize', 'review', 'review']);
});

test('tampering with a retained candidate fails its hash check and publishes nothing', async t => {
  let interrupted = false;
  const { root, runtime, calls, start, wait, services } = await setup(t, { onRequest: ({ number, stage }) => {
    if (number === 1 && stage === 'review') { interrupted = true; throw Object.assign(new Error('HTTP 503 synthetic interruption'), { status: 503 }); }
  } });
  const started = await start(); assert.equal((await wait(started.jobId)).status, 'failed'); assert.equal(interrupted, true);
  const entries = await readdir(join(convertHome(root), 'jobs')), dir = join(convertHome(root), 'jobs', entries.find(name => name.startsWith('cloud-')));
  const index = JSON.parse(await readFile(join(dir, 'page-1-stages.json'), 'utf8')), candidate = join(dir, `${index.stages.recognize}.json`);
  await writeFile(candidate, `${await readFile(candidate, 'utf8')} `);
  const retry = await runtime.call('job.control', { jobId: started.jobId, action: 'retry' }, services), result = await wait(retry.attemptId);
  assert.equal(result.status, 'failed'); assert.match(result.error.message, /hash mismatch/);
  assert.deepEqual(calls, [1]); assert.equal((await runtime.storage.read()).documents.length, 0);
});

test('a matching legacy cloud publication is reused without claiming independent image verification', async t => {
  const { root, runtime, start, wait, modelCalls } = await setup(t);
  assert.equal((await wait((await start()).jobId)).status, 'complete');
  const state = await runtime.storage.read(), document = state.documents[0], manifest = await loadManifest(root, document.versions[0].visual);
  const legacyConfig = { adapter: 1, promptHash: manifest.parser.config.promptHash, dpi: 200, deskew: false, pageOffset: 0, requestedEffort: 'lowest', maxOutputTokens: 12000, rateLimitRetries: 2 };
  const fingerprint = digest(Buffer.from(JSON.stringify({ original: manifest.assets.find(asset => asset.kind === 'original').hash, route: manifest.parser.route, modelVersion: manifest.parser.modelVersion, config: legacyConfig }))), revision = `cloud1-${fingerprint}`;
  const pages = manifest.pages.map(page => { const copy = structuredClone(page); delete copy.automatedReview; copy.sourceId = page.sourceId ? `${document.id}-${revision}-p${page.page}` : null; return copy; });
  const legacyManifest = { ...manifest, fingerprint, revision, pages, parser: { ...manifest.parser, config: legacyConfig }, reading: buildReading(pages), quality: { reviewRequired: true, humanVerified: false } };
  const visual = await saveManifest(root, legacyManifest);
  const sourceIds = pages.map(page => page.sourceId).filter(Boolean);
  await runtime.storage.update(current => {
    current.sources = pages.filter(page => page.sourceId).map(page => ({ ...current.sources.find(source => source.document.page === page.page), id: page.sourceId,
      document: { ...current.sources.find(source => source.document.page === page.page).document, materialRevision: revision } }));
    current.documents = [{ ...document, currentRevision: revision, versions: [{ ...document.versions[0], revision, sourceIds, visual }] }];
  });
  const beforeCalls = modelCalls.length, before = await runtime.storage.read();
  const cached = await wait((await start()).jobId); assert.equal(cached.status, 'complete', cached.error?.message);
  assert.equal(modelCalls.length, beforeCalls, 'upgrading does not re-pay an already published full-book cache');
  assert.deepEqual((await runtime.storage.read()).sources, before.sources);
  assert.equal((await runtime.storage.read()).documents[0].versions.length, 1);
  assert.equal((await loadManifest(root, visual)).quality.automatedReview, undefined, 'historical OCR does not gain a fabricated model receipt');
});
