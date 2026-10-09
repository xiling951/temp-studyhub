import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { digest, loadManifest, locateVisual, objectPath, verifyAsset } from './visual-storage.js';
import { admitVisualImages } from '../../visual-model-content.js';
import { VISUAL_LIMITS } from './visual-contracts.js';

export const VISUAL_EXPLAIN_KIND = 'scanned-textbook-explain';
const SCHEMA = 'studyhub-figure-explanation/v1';
const REQUESTED_EFFORT = 'lowest';
const fail = message => { throw new Error(message); };
const boundedText = text => typeof text === 'string' && text.trim() && text.length <= 12000;
const caption = block => (block.captions || []).map(item => item.text).join('\n');

/** The immutable OCR projection is the context authority. Model notes never become source.text. */
export async function planVisualExplanations(root, state, input, route) {
  const modelRoute = { provider: route.provider, model: route.model };
  const { document, version } = locateVisual(state, input), manifest = await loadManifest(root, version.visual);
  if (manifest.documentId !== document.id || manifest.revision !== version.revision) fail('Explanation document/version mismatch');
  const start = input.pageStart || 1, end = input.pageEnd || manifest.pages.length;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 1 || end < start || end > manifest.pages.length) fail('Invalid explanation page range');
  const selected = input.blockIds && new Set(input.blockIds), found = new Set(), groups = [], seen = new Set();
  for (const page of manifest.pages.filter(item => item.page >= start && item.page <= end)) {
    for (const block of page.blocks) {
      if (!block.assetId || (selected && !selected.has(block.id)) || (!selected && !['image', 'table'].includes(block.type))) continue;
      found.add(block.id);
      const key = block.parentId || block.id;
      if (seen.has(key)) continue;
      seen.add(key);
      const blocks = page.blocks.filter(item => item.assetId && (item.id === block.id || (block.parentId && item.parentId === block.parentId)));
      const batches = []; let batch = [], batchBytes = 0;
      for (const item of blocks) {
        const asset = manifest.assets.find(asset => asset.assetId === item.assetId);
        if (!asset || asset.bytes > VISUAL_LIMITS.modelBytes) fail('Figure exceeds the model image budget');
        if (batch.length && (batch.length === VISUAL_LIMITS.modelImages || batchBytes + asset.bytes > VISUAL_LIMITS.modelBytes)) { batches.push(batch); batch = []; batchBytes = 0; }
        batch.push(item); batchBytes += asset.bytes;
      }
      if (batch.length) batches.push(batch);
      for (const group of batches) {
        const assets = group.map(item => manifest.assets.find(asset => asset.assetId === item.assetId));
        if (assets.some(asset => !asset || !asset.mime.startsWith('image/'))) fail('Missing genuine figure image');
        for (const asset of assets) await verifyAsset(root, asset);
        const context = manifest.pages.filter(item => Math.abs(item.page - page.page) <= 1).map(item => `PDF page ${item.originalPage}:\n${item.text || ''}`).join('\n').slice(0, 16000);
        const imageCaptions = group.map(item => `${item.id}: ${caption(item)}`).join('\n').slice(0, 4000);
        const contextHash = digest(Buffer.from(context + '\n' + imageCaptions));
        const fingerprint = digest(Buffer.from(JSON.stringify({ schema: SCHEMA, manifest: version.visual.manifestHash, contextHash, route: modelRoute, requestedEffort: REQUESTED_EFFORT, blocks: group.map(item => item.id), images: assets.map(item => item.hash) })));
        groups.push({ page: page.page, originalPage: page.originalPage, blockIds: group.map(item => item.id), assets, context, imageCaptions, contextHash, fingerprint });
      }
    }
  }
  if (selected && [...selected].some(id => !found.has(id))) fail('Selected image block is outside the requested document/page range');
  if (!groups.length) fail('所选页没有可解释的真实图片或表格');
  return { documentId: document.id, revision: version.revision, manifestHash: version.visual.manifestHash, route: modelRoute, groups };
}

export function decodeVisualExplanation(answer) {
  const value = JSON.parse(answer.replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
  if (!boundedText(value.description) || !Array.isArray(value.uncertainty) || value.uncertainty.length > 20 || value.uncertainty.some(item => typeof item !== 'string' || item.length > 1000)) fail('模型图解格式无效，没有写入解释');
  return { text: value.description.trim(), uncertainty: value.uncertainty };
}

export async function reviewVisualExplanation({ read, update }, input) {
  const { version } = locateVisual(await read(), input), original = version.visual.explanations?.find(note => note.id === input.noteId);
  if (!original) fail('Explanation version not found');
  if (!['verified', 'rejected'].includes(input.status) || (input.text !== undefined && !boundedText(input.text))) fail('Invalid human review');
  const note = { ...structuredClone(original), id: randomUUID(), supersedes: original.id, text: input.text?.trim() || original.text,
    review: input.status, indexed: input.status === 'verified' && input.indexed === true, origin: input.text === undefined ? 'human-review' : 'human-correction', reviewedAt: new Date().toISOString() };
  await update(state => {
    const current = locateVisual(state, input).version.visual;
    if (!current.explanations?.some(item => item.id === original.id)) fail('Explanation changed before review');
    current.explanations.push(note);
  });
  return { note };
}

const presentation = view => () => ({ title: '教材图解', stage: { code: view.phase, text: view.message },
  progress: { done: view.done, total: view.total, unit: 'figure', percent: view.total ? 100 * view.done / view.total : null, segments: [] },
  detail: { visualExplanation: true, reviewRequired: true }, legacy: { done: view.done, total: view.total } });

export const visualExplainDefinition = {
  kind: VISUAL_EXPLAIN_KIND, version: 1, title: '教材图解', legacyFields: ['done', 'total'],
  capabilities: { cancel: true, retry: true, pauseMode: 'unsupported', recoveryMode: 'none', executionModes: ['direct', 'subagent'] },
  async run(context, input, binding) {
    const plan = await planVisualExplanations(binding.root, await binding.read(), input, binding.route);
    const view = { done: 0, total: plan.groups.length, phase: 'explain', message: '图文已经保存，正在解释所选图片' };
    context.present(presentation(view));
    for (const group of plan.groups) {
      context.signal.throwIfAborted();
      const current = locateVisual(await binding.read(), plan).version.visual;
      const superseded = new Set((current.explanations || []).map(note => note.supersedes).filter(Boolean));
      const previous = current.explanations?.findLast(note => note.fingerprint === group.fingerprint && note.schema === SCHEMA && !superseded.has(note.id));
      const cached = (!input.force || previous?.jobId === context.jobId) && previous?.review !== 'rejected' && previous;
      const step = context.gateway.step(`figure:${group.fingerprint.slice(0, 20)}:${view.done}`, { purpose: 'figure-explanation', feature: 'other', requestedEffort: REQUESTED_EFFORT, executionMode: 'agent-preferred', budget: { timeoutMs: 180000, maxOutputTokens: 4000 } }, { route: plan.route, labels: { part: view.done + 1, parts: view.total, stage: '图解待核对' } });
      if (cached) await step.reuse('matching-explanation-version');
      else {
        const images = await admitVisualImages(binding.hostContext, await Promise.all(group.assets.map(async asset => ({ data: await readFile(await objectPath(binding.root, asset.hash)), mediaType: asset.mime, name: `${asset.assetId}.image` }))), context.signal);
        const answer = await step.completeContent('你是教材图像讲解助手。只依据附带真实图片和明确标记的 OCR 上下文。用800字以内说明电路节点、连接、曲线坐标或表格含义。不要把 OCR 当作绝对正确。看不清的内容列入 uncertainty，禁止臆造。返回 JSON {"description":"中文讲解","uncertainty":["待核对事项"]}。', [
          { type: 'text', text: `OCR context (unverified):\n${group.context}\nCaptions (unverified):\n${group.imageCaptions}` }, ...images,
        ]);
        context.signal.throwIfAborted();
        const decoded = decodeVisualExplanation(answer), note = { schema: SCHEMA, id: randomUUID(), documentId: plan.documentId, revision: plan.revision, manifestHash: plan.manifestHash,
          page: group.page, originalPage: group.originalPage, blockIds: group.blockIds, assetHashes: group.assets.map(asset => asset.hash), contextHash: group.contextHash, fingerprint: group.fingerprint, jobId: context.jobId, attemptId: context.attemptId,
          route: plan.route, requestedEffort: REQUESTED_EFFORT, ...decoded, review: 'pending', indexed: false, origin: 'model', ...(previous ? { supersedes: previous.id } : {}), createdAt: new Date().toISOString() };
        await binding.update(state => {
          context.signal.throwIfAborted();
          const visual = locateVisual(state, plan).version.visual;
          if (visual.manifestHash !== plan.manifestHash) fail('Explanation target changed');
          (visual.explanations ||= []).push(note);
        });
      }
      view.done++; view.message = `已保存 ${view.done}/${view.total} 组图解，等待人工核对`; context.present(presentation(view));
    }
    view.phase = 'complete'; context.present(presentation(view));
    return { refs: [{ kind: 'document', id: plan.documentId }], completeness: 'complete' };
  },
};
