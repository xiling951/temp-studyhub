import { assertVisualEnabled, visualEnabled, VISUAL_LIMITS } from './visual-contracts.js';
import { loadManifest, locateVisual, readChunk, scopedAsset } from './visual-storage.js';
import { previewVisualPage } from './visual-preview.js';

export function createVisualOperations({ root, read, update, uploads, submit } = {}) {
  const enabled = async () => assertVisualEnabled(await read());
  return {
    'materials.visual.status': async () => ({ enabled: visualEnabled(await read()), modelRequired: false, limits: VISUAL_LIMITS }),
    'materials.visual.list': async () => ({ documents: (await read()).documents.filter(document => !document.archived && document.versions.some(version => version.revision === document.currentRevision && version.visual && !version.sourceIds.length)).map(document => ({ documentId: document.id, title: document.title, revision: document.currentRevision })) }),
    'materials.visual.upload.start': async args => { await enabled(); return uploads.startUpload(root, { ...args, kind: 'pdf' }); },
    'materials.visual.upload.append': async args => { await enabled(); return uploads.appendUpload(root, args); },
    'materials.visual.upload.finish': async args => { await enabled(); return uploads.finishUpload(root, args.uploadId); },
    'materials.visual.upload.cancel': async args => { await enabled(); return uploads.cancelUnclaimedUpload(root, args.uploadId); },
    'materials.visual.import': async args => { await enabled(); if (!submit) throw Object.assign(new Error('Native visual import executor unavailable'), { code: 'executor-unavailable' }); return submit(args); },
    'materials.visual.page': async args => {
      const { document, version } = locateVisual(await read(), args), manifest = await loadManifest(root, version.visual);
      if (manifest.documentId !== document.id || manifest.revision !== version.revision) throw new Error('Visual page ownership mismatch');
      const page = manifest.pages.find(page => page.page === args.page);
      if (!page) throw new Error('Visual page not found');
      const ids = new Set(page.blocks.map(block => block.assetId).filter(Boolean));
      return { documentId: document.id, revision: version.revision, totalPages: manifest.pages.length, original: version.visual.original,
        page, assets: manifest.assets.filter(asset => ids.has(asset.assetId)) };
    },
    'materials.visual.asset': async args => ({ asset: (await scopedAsset(root, await read(), args)).asset }),
    'materials.visual.preview': (args, services) => previewVisualPage({ root, read, update }, args, services),
    'materials.visual.chunk': async args => readChunk(root, (await scopedAsset(root, await read(), args)).asset, args),
  };
}
