import { assertVisualEnabled, visualEnabled, VISUAL_LIMITS } from './visual-contracts.js';
import { loadManifest, locateVisual, readChunk, scopedAsset } from './visual-storage.js';
import { previewVisualPage } from './visual-preview.js';
import { reviewVisualExplanation } from './scanned/visual-explanations.js';
import { readingWindow, legacyPageRanges, orderedReadingBlocks } from './visual-reading.js';
import { modelOfKey, modelKey } from '../../job-model.js';
import { visualCandidates } from './visual-candidates.js';
import { correctVisualTranscription } from './visual-corrections.js';

export function createVisualOperations({ root, read, update, uploads, submit, submitExplain, archives } = {}) {
  const enabled = async () => assertVisualEnabled(await read());
  return {
    'materials.visual.transcription.correct': args => correctVisualTranscription({ root, read, update }, args),
    'materials.visual.candidates': async args => visualCandidates(root, await read(), args),
    'materials.visual.status': async () => ({ enabled: visualEnabled(await read()), modelRequired: false, parsers: { mineru: { modelRequired: false }, cloud: { modelRequired: true } }, limits: VISUAL_LIMITS }),
    'materials.visual.models': async (_args, services) => {
      const ctx = services?.jobModelHost?.ctx, llm = ctx?.get?.('llm') || ctx?.llm;
      if (!llm?.listProviders || !llm?.listModels) return { models: [], reason: 'host-catalog-unavailable' };
      const models = [], failures = [];
      for (const provider of (await llm.listProviders()).slice(0, 50)) {
        try {
          for (const model of (await llm.listModels(provider.id)).slice(0, 500)) if (model.inputModalities?.includes('image')) models.push({ key: modelKey({ provider: provider.id, model: model.id }), provider: provider.id, providerName: provider.name || provider.id, id: model.id, name: model.name || model.id, inputModalities: model.inputModalities });
        } catch { failures.push({ provider: provider.id, reason: 'catalog-unavailable' }); }
      }
      return { models, failures, reason: models.length ? null : 'no-declared-image-model' };
    },
    'materials.visual.list': async () => ({ documents: (await read()).documents.filter(document => !document.archived && document.versions.some(version => version.revision === document.currentRevision && version.visual && !version.sourceIds.length)).map(document => ({ documentId: document.id, title: document.title, revision: document.currentRevision })) }),
    'materials.visual.upload.start': async args => { await enabled(); return uploads.startUpload(root, { ...args, kind: 'pdf' }); },
    'materials.visual.upload.append': async args => { await enabled(); return uploads.appendUpload(root, args); },
    'materials.visual.upload.finish': async args => { await enabled(); return uploads.finishUpload(root, args.uploadId); },
    'materials.visual.upload.cancel': async args => { await enabled(); return uploads.cancelUnclaimedUpload(root, args.uploadId); },
    'materials.visual.import': async args => {
      await enabled();
      if (args.parser && !['mineru', 'cloud'].includes(args.parser)) throw new Error('Unknown visual parser');
      if (args.modelKey !== undefined && !modelOfKey(args.modelKey)) throw new Error('Invalid cloud modelKey');
      if (args.parser === 'cloud' && !modelOfKey(args.modelKey)) throw new Error('云解析需要选择支持图片的 DSH 模型');
      if (!submit) throw Object.assign(new Error('Native visual import executor unavailable'), { code: 'executor-unavailable' });
      return submit(args);
    },
    'materials.visual.reading': async args => {
      const { document, version } = locateVisual(await read(), args), manifest = await loadManifest(root, version.visual);
      if (manifest.documentId !== document.id || manifest.revision !== version.revision) throw new Error('Visual reading ownership mismatch');
      return { documentId: document.id, revision: version.revision, ...readingWindow(manifest, args) };
    },
    'materials.visual.explain': async args => { await enabled(); if (!submitExplain) throw Object.assign(new Error('Native image explanation executor unavailable'), { code: 'executor-unavailable' }); return submitExplain(args); },
    'materials.visual.explanations': async args => {
      const { version } = locateVisual(await read(), args);
      return { notes: (version.visual.explanations || []).filter(note => !args.page || note.page === args.page), importExplanation: version.visual.importExplanation || null };
    },
    'materials.visual.explanation.review': args => reviewVisualExplanation({ read, update }, args),
    'materials.visual.page': async args => {
      const { document, version } = locateVisual(await read(), args), manifest = await loadManifest(root, version.visual);
      if (manifest.documentId !== document.id || manifest.revision !== version.revision) throw new Error('Visual page ownership mismatch');
      const page = manifest.pages.find(page => page.page === args.page);
      if (!page) throw new Error('Visual page not found');
      const ids = new Set(page.blocks.map(block => block.assetId).filter(Boolean));
      return { documentId: document.id, revision: version.revision, totalPages: manifest.pages.length, original: version.visual.original,
        page: { ...legacyPageRanges(page), blocks: orderedReadingBlocks(legacyPageRanges(page)) }, assets: manifest.assets.filter(asset => ids.has(asset.assetId)) };
    },
    'materials.visual.asset': async args => ({ asset: (await scopedAsset(root, await read(), args)).asset }),
    'materials.visual.preview': (args, services) => previewVisualPage({ root, read, update }, args, services),
    'materials.visual.chunk': async args => readChunk(root, (await scopedAsset(root, await read(), args)).asset, args),
    'materials.visual.export': (args, services) => archives.book(args, services),
    'materials.visual.export.chunk': args => archives.chunk(args),
    'materials.visual.export.discard': args => archives.discard(args),
    'materials.visual.backup.upload.start': args => uploads.startUpload(root, { ...args, kind: 'study-archive' }),
    'materials.visual.backup.upload.append': args => uploads.appendUpload(root, args),
    'materials.visual.backup.upload.finish': args => uploads.finishUpload(root, args.uploadId),
    'materials.visual.backup.upload.cancel': args => uploads.cancelUnclaimedUpload(root, args.uploadId),
  };
}
