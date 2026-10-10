import { loadManifest } from './visual-storage.js';

export const VISUAL_INDEX_SCHEMA = 1;
const located = block => Array.isArray(block.bbox) && block.bbox.length === 4 && block.bbox.every(value => Number.isFinite(value) && value >= 0 && value <= 1) && block.bbox[0] < block.bbox[2] && block.bbox[1] < block.bbox[3];

/** Index-only projections. OCR/source ids stay immutable; model notes never become source.text or quote evidence. */
export async function projectVisualRetrieval(root, state, sourceIds, { imageOnly = false } = {}) {
  const wanted = Array.isArray(sourceIds) ? new Set(sourceIds) : null, excluded = new Set(), mapped = new Map(), imagePages = [];
  for (const document of state.documents || []) {
    const versions = document.versions || [], current = versions.find(version => version.revision === document.currentRevision);
    for (const version of versions) if (version.visual && (document.archived || version.revision !== document.currentRevision)) for (const id of version.sourceIds || []) excluded.add(id);
    if (document.archived || !current?.visual || (wanted && !(current.sourceIds || []).some(id => wanted.has(id)))) continue;
    const manifest = await loadManifest(root, current.visual), superseded = new Set((current.visual.explanations || []).map(note => note.supersedes).filter(Boolean));
    const notes = (current.visual.explanations || []).filter(note => note.review === 'verified' && note.indexed === true && !superseded.has(note.id) && note.manifestHash === current.visual.manifestHash && note.revision === current.revision);
    for (const page of manifest.pages) {
      if ((!page.sourceId && (!imageOnly || wanted)) || (page.sourceId && wanted && !wanted.has(page.sourceId))) continue;
      const blocks = page.blocks.map(block => ({ id: block.id, bbox: block.bbox, text: block.text || '', captions: block.captions || [],
        ...(block.assetId && located(block) ? { citation: { schema: 1, documentId: document.id, revision: current.revision, page: page.page, blockId: block.id, assetId: block.assetId,
          imageHash: manifest.assets.find(asset => asset.assetId === block.assetId)?.hash, bbox: block.bbox, reviewState: 'pending' } } : {}) }));
      const captions = page.blocks.filter(block => block.assetId).flatMap(block => (block.captions || []).map(caption => caption.text)).filter(Boolean);
      const indexedNotes = notes.filter(note => note.page === page.page);
      const projection = { schema: VISUAL_INDEX_SCHEMA, documentId: document.id, revision: current.revision, manifestHash: current.visual.manifestHash, page: page.page, originalPage: page.originalPage,
        blocks, indexText: [captions.length ? `图注（解析结果，待核对）：\n${[...new Set(captions)].join('\n')}` : '', ...indexedNotes.map(note => `人工核对并选择索引的图解（辅助说明，不是教材原文）：\n${note.text}`)].filter(Boolean).join('\n\n'),
        noteVersions: indexedNotes.map(note => ({ id: note.id, fingerprint: note.fingerprint, contextHash: note.contextHash })), notes: indexedNotes.map(note => ({ text: note.text, blockIds: note.blockIds || [] })) };
      if (page.sourceId) mapped.set(page.sourceId, projection);
      else if (projection.indexText) imagePages.push({ id: `visual-page-${document.id}-${current.revision}-p${page.page}`, title: `${document.title || document.filename || document.id} · PDF ${page.originalPage}`, text: '',
        courses: document.courses || [], visualOnly: true, document: { id: document.id, materialRevision: current.revision, page: page.page }, visualIndex: projection });
    }
  }
  const sources = state.sources.filter(source => !excluded.has(source.id) && (!wanted || wanted.has(source.id)) && !(mapped.has(source.id) && source.archived)).map(source => {
    const { visualIndex: _untrusted, ...plain } = source;
    return mapped.has(source.id) ? { ...plain, visualIndex: mapped.get(source.id) } : plain;
  });
  // These are search-index records, never persisted sources or ordinary quote evidence.
  return [...sources, ...imagePages];
}

/** The local manifest owns associations. Provider-supplied paths/metadata and old normalized hits never create references. */
export function visualForHit(source, text = '') {
  const visual = source?.visualIndex; if (!visual) return undefined;
  const compact = value => String(value || '').replace(/\s+/g, '').toLowerCase(), probe = compact(text);
  const anchor = probe.length >= 12 ? visual.blocks.find(block => located(block) && compact(block.text).length >= 12 && (probe.includes(compact(block.text).slice(0, 40)) || compact(block.text).includes(probe.slice(0, 40)))) : null;
  const note = probe.length >= 12 ? visual.notes?.find(note => probe.includes(compact(note.text).slice(0, 40)) || compact(note.text).includes(probe.slice(0, 40))) : null;
  const center = block => [(block.bbox[0] + block.bbox[2]) / 2, (block.bbox[1] + block.bbox[3]) / 2];
  const distance = block => anchor ? center(block).reduce((sum, value, index) => sum + Math.abs(value - center(anchor)[index]), 0) : 1;
  const images = visual.blocks.filter(block => block.citation).map(block => ({ block, score: note?.blockIds.includes(block.id) ? -2 : block.captions.some(caption => compact(caption.text).length >= 4 && probe.includes(compact(caption.text))) ? -1 : distance(block) }));
  images.sort((left, right) => left.score - right.score);
  return { schema: visual.schema, documentId: visual.documentId, revision: visual.revision, page: visual.page, originalPage: visual.originalPage,
    citations: images.slice(0, 4).map(item => item.block.citation) };
}
