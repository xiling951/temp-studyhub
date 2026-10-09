import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { visualCitationShapeIssues, assertVisualReviews } from '../../visual-citations.js';
import { reviewedCardFingerprint } from '../../review-integrity.js';
import { loadManifest, locateVisual, objectPath, verifyAsset } from './visual-storage.js';
import { VISUAL_LIMITS } from './visual-contracts.js';

/** Every claimed page, region and byte hash is checked against immutable material data before model use or publication. */
export async function resolveVisualCardEvidence(root, state, refs, { signal, bytes = false } = {}) {
  const issues = visualCitationShapeIssues(refs);
  if (!refs?.length || issues.length) throw new Error(issues.join('; ') || 'Actual visual citations required');
  const manifests = new Map(), resolved = []; let total = 0;
  for (const ref of refs) {
    signal?.throwIfAborted();
    const scope = `${ref.documentId}:${ref.revision}`;
    if (!manifests.has(scope)) {
      const { document, version } = locateVisual(state, ref), manifest = await loadManifest(root, version.visual);
      if (manifest.documentId !== document.id || manifest.revision !== version.revision) throw new Error('Visual citation manifest ownership mismatch');
      manifests.set(scope, manifest);
    }
    const manifest = manifests.get(scope), page = manifest.pages.find(page => page.page === ref.page), block = page?.blocks.find(block => block.id === ref.blockId);
    const asset = manifest.assets.find(asset => asset.assetId === ref.assetId);
    if (!block || block.assetId !== ref.assetId || !asset || asset.hash !== ref.imageHash || !asset.mime.startsWith('image/') ||
      JSON.stringify(block.bbox) !== JSON.stringify(ref.bbox)) throw new Error('Visual citation page/block/region/hash mismatch');
    total += asset.bytes;
    if (total > VISUAL_LIMITS.modelBytes) throw new Error('Visual card evidence exceeds the 8 MiB image budget');
    await verifyAsset(root, asset);
    resolved.push({ citation: structuredClone(ref), asset, page: page.page, originalPage: page.originalPage, sourceId: page.sourceId,
      caption: (block.captions || []).map(item => item.text).join('\n').slice(0, 1500), context: (page.text || '').slice(0, 12000), quality: block.quality,
      ...(bytes ? { image: { data: await readFile(await objectPath(root, asset.hash)), mediaType: asset.mime, name: `${block.id}.image` } } : {}) });
  }
  return resolved;
}

export async function prepareVisualCardEvidence(root, state, input, options) {
  const { document, version } = locateVisual(state, input), manifest = await loadManifest(root, version.visual);
  const ids = new Set(input.blockIds || []);
  if (!ids.size || ids.size > VISUAL_LIMITS.modelImages) throw new Error('Choose 1–4 actual image blocks');
  const refs = manifest.pages.flatMap(page => page.blocks.filter(block => ids.has(block.id)).map(block => {
    const asset = manifest.assets.find(asset => asset.assetId === block.assetId);
    return { schema: 1, documentId: document.id, revision: version.revision, page: page.page, blockId: block.id, assetId: block.assetId, imageHash: asset?.hash, bbox: block.bbox, reviewState: 'pending' };
  }));
  if (refs.length !== ids.size) throw new Error('Selected image evidence is outside this document revision');
  return resolveVisualCardEvidence(root, state, refs, options);
}

export async function verifyVisualPublication(root, state, cards, options) {
  assertVisualReviews(cards, state.documents);
  for (const card of cards) if (card.visualCitations) await resolveVisualCardEvidence(root, state, card.visualCitations, options);
}

/** Internal generation-to-materials port, never a public alias. No client-provided reviewed flag or JSON import writes these receipts. */
export async function commitVisualCardReviews({ root, read, update }, { cards, checks, jobId, attemptId, route }, { signal } = {}) {
  const state = await read(), receipts = [];
  for (const card of cards) {
    const check = checks.find(check => check.cardId === card.id);
    if (!check || check.evidenceValid !== true || check.answerCorrect !== true || check.independent !== true || !check.reason?.trim()) throw new Error('Independent image review did not approve evidence and answer separately');
    await resolveVisualCardEvidence(root, state, card.visualCitations, { signal });
    for (const scope of new Set(card.visualCitations.map(ref => `${ref.documentId}:${ref.revision}`))) {
      const ref = card.visualCitations.find(ref => `${ref.documentId}:${ref.revision}` === scope), version = locateVisual(state, ref).version;
      receipts.push({ schema: 1, id: randomUUID(), cardId: card.id, fingerprint: reviewedCardFingerprint(card), manifestHash: version.visual.manifestHash,
        documentId: ref.documentId, revision: ref.revision, citations: card.visualCitations, evidenceValid: true, answerCorrect: true, independent: true,
        reason: check.reason.slice(0, 4000), jobId, attemptId, route: structuredClone(route), reviewedAt: new Date().toISOString() });
    }
  }
  await update(current => {
    signal?.throwIfAborted();
    for (const receipt of receipts) {
      const visual = locateVisual(current, receipt).version.visual;
      if (visual.manifestHash !== receipt.manifestHash) throw new Error('Visual evidence changed before review commit');
      (visual.cardReviews ||= []).push(receipt);
    }
  });
  return { receiptIds: receipts.map(receipt => receipt.id) };
}
