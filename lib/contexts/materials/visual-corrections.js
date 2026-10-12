import { createHash } from 'node:crypto';
import { loadManifest, locateVisual, saveManifest } from './visual-storage.js';
import { associateVisualCaptions } from './visual-captions.js';

// A correction appends a material version. Historical quotes, image receipts and
// original PDF bytes remain owned by their original immutable version.
const literalText = page => {
  const captions = page.blocks.flatMap(block => (block.captions || []).map(caption => ({ ...caption, owner: caption.originalBlockId || block.id })));
  return page.blocks.flatMap(block => [block.text, ...captions.filter(caption => caption.owner === block.id).map(caption => caption.text)]).filter(Boolean).join('\n\n');
};

export async function correctVisualTranscription({ root, read, update }, input) {
  const state = await read(), { document, version } = locateVisual(state, input);
  if (document.archived || document.currentRevision !== input.revision || version.visual.manifestHash !== input.manifestHash) throw Error('Choose the exact current visual revision before correcting transcription');
  if (!Array.isArray(input.changes) || !input.changes.length || input.changes.length > 20 || typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 1200) throw Error('Provide 1–20 bounded corrections and a source-page checking reason');
  const manifest = await loadManifest(root, version.visual), affected = new Set(), keys = new Set();
  for (const change of input.changes) {
    const page = manifest.pages.find(page => page.page === change.page), block = page?.blocks.find(block => block.id === change.blockId);
    if (!block || !['text', 'caption'].includes(change.field) || typeof change.before !== 'string' || typeof change.after !== 'string' || !change.after.trim() || Math.max(change.before.length, change.after.length) > 12000) throw Error('Invalid scoped transcription correction');
    if (!affected.has(page.page)) {
      const source = state.sources.find(source => source.id === page.sourceId);
      if (!source || source.document?.id !== document.id || source.document?.materialRevision !== version.revision || source.text !== page.text) throw Error('Original material source ownership mismatch');
      if (literalText(page) !== page.text) throw Error('Historical literal projection is ambiguous; correction refused');
    }
    const key = JSON.stringify([page.page, block.id, change.field, change.captionIndex]);
    if (keys.has(key)) throw Error('Duplicate correction target'); keys.add(key); affected.add(page.page);
    if (change.field === 'text') {
      if (change.captionIndex !== undefined || change.targetBlockId !== undefined || block.text !== change.before || change.after === change.before) throw Error('Text correction must match the exact previous block text');
      block.text = change.after;
    } else {
      const caption = block.captions?.[change.captionIndex];
      if (!Number.isSafeInteger(change.captionIndex) || change.captionIndex < 0 || caption?.text !== change.before) throw Error('Caption correction must match the exact previous caption');
      if (change.targetBlockId !== undefined) {
        const target = page.blocks.find(block => block.id === change.targetBlockId);
        if (!target || target === block || !['image', 'chart', 'table'].includes(target.type)) throw Error('Caption move requires a different actual visual block on the same page');
        block.captions.splice(change.captionIndex, 1);
        delete caption.originalBlockId; delete caption.association;
        target.captions.push({ ...caption, text: change.after });
      } else {
        if (change.after === change.before) throw Error('Empty caption correction'); caption.text = change.after;
      }
    }
  }
  const corrections = { baseRevision: version.revision, baseManifestHash: version.visual.manifestHash, associationAdapter: 3, changes: structuredClone(input.changes), reason: input.reason.trim(), reviewRequired: true };
  const fingerprint = createHash('sha256').update(JSON.stringify(corrections)).digest('hex'), revision = `corrected1-${fingerprint}`;
  delete manifest.reading;
  const now = new Date().toISOString(), sources = [];
  for (const page of manifest.pages) {
    if (affected.has(page.page)) {
      page.text = literalText(page);
      for (const block of page.blocks) delete block.textRange;
    }
    page.blocks = associateVisualCaptions(page.blocks, page.page);
    if (!page.sourceId) continue;
    const prior = state.sources.find(source => source.id === page.sourceId);
    if (!prior || (!affected.has(page.page) && prior.text !== page.text)) throw Error('Original material source ownership mismatch');
    const id = `${document.id}-${revision}-p${page.page}`; page.sourceId = id;
    sources.push({ ...prior, id, text: page.text, createdAt: now, importedAt: now, document: { ...prior.document, materialRevision: revision } });
  }
  const visual = await saveManifest(root, { ...manifest, revision, fingerprint, corrections, quality: { ...manifest.quality, reviewRequired: true } });
  await update(current => {
    const owner = current.documents.find(item => item.id === document.id), base = owner?.versions.find(item => item.revision === input.revision);
    if (!owner || owner.archived || owner.currentRevision !== input.revision || base?.visual.manifestHash !== input.manifestHash) throw Error('Visual document changed while correction was being prepared');
    if (owner.versions.some(item => item.revision === revision) || sources.some(source => current.sources.some(item => item.id === source.id))) throw Error('Correction version identity conflict');
    current.sources.push(...sources); owner.versions.push({ revision, sourceIds: sources.map(source => source.id), importedAt: now, attachment: null, visual }); owner.currentRevision = revision;
  });
  return { documentId: document.id, revision, sourceIds: sources.map(source => source.id), correctedPages: [...affected], reviewRequired: true };
}
