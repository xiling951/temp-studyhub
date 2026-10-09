import { link, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';
import { pdfConvertGate, holdPdfSlot } from '../../pdf-convert-gate.js';
import { objectPath, retainPdf, saveManifest } from './visual-storage.js';
import { adaptWindow, parseWindow, parserFingerprint, pdfHelper, saveWindowCache, verifiedWindowCache } from './visual-parser.js';
import { VISUAL_LIMITS } from './visual-contracts.js';
import { convertHome } from '../../mineru-paths.js';

export const VISUAL_IMPORT_KIND = 'scanned-textbook-import';
const presentation = view => () => ({ title: view.title, stage: { code: view.phase, text: view.message },
  progress: { done: view.done, total: view.total, unit: 'page', percent: view.total ? 100 * view.done / view.total : null, segments: [] },
  detail: { visual: true }, legacy: { filename: view.title, done: view.done, total: view.total } });

/** Files are validated before the only library transaction; genuine OCR sources never contain model notes. */
export async function importVisualPdf({ root, path, name, input = {}, read, update, signal, present = () => {}, parse = parseWindow }) {
  signal?.throwIfAborted();
  const tier = input.tier || 'standard', pageOffset = input.pageOffset || 0;
  if (!['basic', 'standard'].includes(tier) || !Number.isSafeInteger(pageOffset) || pageOffset < 0 || pageOffset > 100000) throw new Error('Invalid visual parse options');
  const view = { title: input.title || name, phase: 'retain', message: '保存原 PDF', done: 0, total: null };
  present(presentation(view));
  const original = await retainPdf(root, path, { signal }), originalPath = await objectPath(root, original.hash);
  const fingerprint = parserFingerprint(original.hash, tier, pageOffset), documentId = `visual-${original.hash}`, revision = `visual1-${fingerprint}`;
  const state = await read(), existing = state.documents?.find(document => document.id === documentId);
  if (existing?.versions.some(version => version.revision === revision)) {
    // Never trust a text-cache hit: every referenced asset is reverified before declaring visual reuse.
    const { loadManifest, hashFile } = await import('./visual-storage.js');
    const manifest = await loadManifest(root, existing.versions.find(version => version.revision === revision).visual);
    for (const asset of manifest.assets) if ((await hashFile(await objectPath(root, asset.hash), signal)).hash !== asset.hash) throw new Error('Cached visual asset is corrupt or missing');
    return { documentId, revision, sourceIds: existing.versions.find(version => version.revision === revision).sourceIds, reused: true, pages: manifest.pages.length };
  }
  const info = await pdfHelper(['info', originalPath], signal), total = info.pages.length;
  if (total < 1 || total > 10000) throw new Error('Invalid textbook page count');
  view.total = total; view.phase = 'parse'; view.message = '分页解析和保存图表';
  const tempBase = join(convertHome(root), 'visual-render'); await mkdir(tempBase, { recursive: true });
  const renderDir = await mkdtemp(join(tempBase, 'window-'));
  // The public parser selects its codec from the suffix. A private hard link preserves one original object's disk bytes.
  const parserPath = join(renderDir, 'original.pdf');
  const pages = [], assets = new Map([[original.assetId, original]]);
  try {
    await link(originalPath, parserPath).catch(async error => {
      if (error.code !== 'EXDEV') throw error;
      await pipeline(createReadStream(originalPath, { highWaterMark: VISUAL_LIMITS.chunkBytes }), createWriteStream(parserPath, { flags: 'wx' }), { signal });
    });
    const window = async (start, end) => {
      signal?.throwIfAborted();
      let result = await verifiedWindowCache(root, fingerprint, start, end);
      if (!result) {
        try {
          const raw = await parse(parserPath, start, end, { tier, signal });
          result = await adaptWindow(root, raw, { start, end, originalPath, pageOffset, signal, renderDir });
          await saveWindowCache(root, fingerprint, start, end, result);
        } catch (error) {
          if (signal?.aborted || start === end || ['pdf-helper-unavailable'].includes(error.code)) throw error;
          const middle = Math.floor((start + end) / 2);
          await window(start, middle); await window(middle + 1, end); return;
        }
      }
      for (const page of result.pages) pages.push({ ...page, geometry: info.pages[page.page - 1] });
      for (const asset of result.assets) assets.set(asset.assetId, asset);
      view.done += result.pages.length; present(presentation(view));
    };
    for (let start = 1; start <= total; start += VISUAL_LIMITS.parseWindowPages) await window(start, Math.min(total, start + VISUAL_LIMITS.parseWindowPages - 1));
    pages.sort((a, b) => a.page - b.page);
    const now = new Date().toISOString(), courses = Array.isArray(input.courses) ? input.courses : [];
    const sources = pages.filter(page => page.text.trim()).map(page => {
      const id = `${documentId}-${revision}-p${page.page}`; page.sourceId = id;
      return { id, title: `${view.title} · p.${page.originalPage}`, text: page.text, format: 'pdf', createdAt: now, importedAt: now, courses,
        document: { id: documentId, materialId: documentId, materialRevision: revision, page: page.page, originalPage: page.originalPage, totalPages: total, format: 'pdf', filename: name, origin: 'ocr', extractionVersion: 3, bookTitle: view.title } };
    });
    const quality = { reviewRequired: true, pages: total, assets: assets.size - 1, imageOnly: pages.filter(page => page.status === 'image-only').map(page => page.page),
      blankOrUnrecognized: pages.filter(page => page.status === 'blank-or-unrecognized').map(page => page.page),
      originalPageFallback: pages.flatMap(page => page.blocks.filter(block => block.quality === 'original-page-fallback').map(block => ({ page: page.page, blockId: block.id }))), explanation: 'not-requested' };
    const visual = await saveManifest(root, { schema: 1, documentId, revision, fingerprint, parser: { name: 'MinerU', version: '4.0.11', tier, adapter: 1 }, pages, assets: [...assets.values()], quality }, { signal });
    view.phase = 'commit'; view.message = '校验完成，提交图文资料'; present(presentation(view)); signal?.throwIfAborted();
    await update(state => {
      signal?.throwIfAborted();
      state.documents ||= []; state.sources ||= [];
      let document = state.documents.find(item => item.id === documentId);
      if (!document) { document = { id: documentId, title: view.title, filename: name, format: 'pdf', courses, versions: [] }; state.documents.push(document); }
      if (!document.versions.some(item => item.revision === revision)) {
        for (const source of sources) {
          const prior = state.sources.find(item => item.id === source.id);
          if (prior && prior.text !== source.text) throw new Error('Visual source identity conflict');
          if (!prior) state.sources.push(source);
        }
        document.versions.push({ revision, sourceIds: sources.map(source => source.id), importedAt: now, attachment: null, visual });
      }
      document.currentRevision = revision;
    });
    view.phase = 'complete'; view.message = '图文已保存；OCR 和图像内容待核对'; present(presentation(view));
    return { documentId, revision, sourceIds: sources.map(source => source.id), pages: total, quality };
  } finally { await rm(renderDir, { recursive: true, force: true }); }
}

export const visualImportDefinition = {
  kind: VISUAL_IMPORT_KIND, version: 1, title: '扫描教材图文导入', capabilities: { cancel: true, retry: true, pauseMode: 'unsupported', recoveryMode: 'none', executionModes: ['direct'] },
  async admit(context, _input, binding) { return holdPdfSlot(context, pdfConvertGate(binding.jobs)); },
  async run(context, input, binding) {
    const upload = binding.uploads.claimUpload(binding.root, input.uploadId);
    try {
      const step = context.gateway.step('parse-textbook', { purpose: 'convert', feature: 'scanned-textbook', budget: null });
      const result = await step.run(() => step.observe({ boundary: 'local-process', kind: 'mineru-visual', sideEffect: false }, async signal => ({
        value: await importVisualPdf({ root: binding.root, path: upload.path, name: upload.name, input, read: binding.read, update: binding.update, signal, present: reader => context.present(reader) }) })));
      await binding.uploads.discardUpload(upload);
      return { refs: [{ kind: 'document', id: result.documentId }, ...result.sourceIds.map(id => ({ kind: 'source', id }))], completeness: 'complete' };
    } catch (error) { binding.uploads.releaseUpload(upload); throw error; }
  },
};
