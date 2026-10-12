import { loadManifest } from './visual-storage.js';

/** Bounded metadata for actual current-revision figures. Never accept image paths,
    client approval flags, historical pages or provider-invented references. */
export async function visualCandidates(root, state, args) {
  if (Object.keys(args).some(key => !['sourceIds', 'offset', 'limit'].includes(key))) throw Error('Image candidate field is not supported');
  const { sourceIds, offset = 0, limit = 40 } = args;
  if (!Array.isArray(sourceIds) || !sourceIds.length || sourceIds.length > 10000 || sourceIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 1200) || new Set(sourceIds).size !== sourceIds.length) throw Error('Select actual source pages');
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 40) throw Error('Image candidates require a bounded page');
  const wanted = new Set(sourceIds), assets = new Map(), items = []; let total = 0;
  for (const document of state.documents || []) {
    if (document.archived) continue;
    const version = document.versions.find(version => version.revision === document.currentRevision);
    if (!version?.visual || !version.sourceIds.some(id => wanted.has(id))) continue;
    const manifest = await loadManifest(root, version.visual);
    if (manifest.documentId !== document.id || manifest.revision !== version.revision) throw Error('Image candidate ownership mismatch');
    assets.clear(); for (const asset of manifest.assets) assets.set(asset.assetId, asset);
    for (const page of manifest.pages) {
      if (!wanted.has(page.sourceId)) continue;
      for (const block of page.blocks) {
        if (!['image', 'chart', 'table'].includes(block.type) || !block.assetId || !Array.isArray(block.bbox) || block.bbox.length !== 4 ||
          block.bbox.some(n => !Number.isFinite(n) || n < 0 || n > 1) || block.bbox[0] >= block.bbox[2] || block.bbox[1] >= block.bbox[3]) continue;
        const asset = assets.get(block.assetId);
        if (!asset?.mime.startsWith('image/') || asset.bytes > 8 * 1024 * 1024 || block.quality === 'original-page-fallback') continue;
        if (total >= offset && items.length < limit) items.push({ documentId: document.id, revision: version.revision, page: page.page, originalPage: page.originalPage,
          blockId: block.id, sourceId: page.sourceId, type: block.type, title: document.title, caption: (block.captions || []).map(c => c.text).join(' ').slice(0, 800), asset });
        total++;
      }
    }
  }
  return { items, total, offset, limit, hasMore: offset + items.length < total };
}
