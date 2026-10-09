import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../lib/store.js';
import { storeBytes, saveManifest, objectPath } from '../lib/contexts/materials/visual-storage.js';
import { prepareVisualCardEvidence, resolveVisualCardEvidence, commitVisualCardReviews, verifyVisualPublication } from '../lib/contexts/materials/visual-card-evidence.js';
import { visualReviewIssues, visualCitationShapeIssues } from '../lib/visual-citations.js';
import { validateDeck, publicCard } from '../lib/domain.js';
import { reviewedCardFingerprint } from '../lib/review-integrity.js';
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'visual-citations-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = new Store(root), original = await storeBytes(root, Buffer.from('%PDF-1.7 fixture'), { kind: 'original', mime: 'application/pdf' });
  const asset = await storeBytes(root, Buffer.from('immutable image bytes'), { kind: 'figure', mime: 'image/png' });
  const visual = await saveManifest(root, { schema: 1, documentId: 'book', revision: 'r1', fingerprint: 'fixture', assets: [original, asset], quality: {}, pages: [{ page: 1, originalPage: 200, text: '', sourceId: null, blocks: [{ id: 'b0', type: 'image', bbox: [0.1, 0.2, 0.8, 0.9], assetId: asset.assetId, captions: [] }] }] });
  await store.update(state => { state.documents = [{ id: 'book', currentRevision: 'r1', versions: [{ revision: 'r1', sourceIds: [], visual }] }]; });
  const evidence = await prepareVisualCardEvidence(root, await store.read(), { documentId: 'book', blockIds: ['b0'] }, { bytes: true });
  const card = { id: 'question', kind: 'flashcard', topic: 'Circuit role', objective: 'Explain the function of the selected device', prompt: 'Could the marked device be removed while retaining the shown behavior?', answer: 'No, it supplies the stated path.', hint: 'Trace the two terminal connections.', explanation: 'The required conduction path would be interrupted, changing the operating condition.', misconception: 'Confusing a redundant wire with a switching device', citations: [], visualCitations: evidence.map(item => item.citation) };
  const approve = async () => {
    card.visualCitations.forEach(ref => { ref.reviewState = 'verified'; });
    await commitVisualCardReviews({ root, read: () => store.read(), update: fn => store.update(fn) }, { cards: [card], checks: [{ cardId: card.id, evidenceValid: true, answerCorrect: true, independent: true, reason: 'Explicit synthetic reviewer fixture' }], jobId: 'fixture-job', attemptId: 'fixture-attempt', route: { provider: 'fixture', model: 'vision' } });
  };
  return { root, store, asset, card, approve };
}
test('pure image evidence has no invented source; independent review authority binds exact question, image, version and region', async t => {
  const { root, store, card, approve } = await setup(t);
  assert.equal(card.citations.length, 0);
  assert.ok(validateDeck({ title: 'Visual', cards: [card] }, [], { documents: (await store.read()).documents }).errors.some(issue => /independent/.test(issue)));
  card.importedFromJson = true;
  assert.ok(validateDeck({ title: 'Visual', cards: [card] }, []).errors.some(issue => /source citations/.test(issue)), 'JSON provenance cannot waive image evidence');
  await approve();
  const state = await store.read();
  assert.deepEqual(validateDeck({ title: 'Visual', cards: [card] }, [], { documents: state.documents }).errors, []);
  await verifyVisualPublication(root, state, [card]);
  for (const change of [{ answer: 'Changed answer' }, { id: 'different-question' }, { visualCitations: [{ ...card.visualCitations[0], bbox: [0, 0, 1, 1] }] }]) {
    assert.ok(visualReviewIssues({ ...card, ...change }, state.documents).length);
  }
});
test('cross-document, wrong revision, wrong region, missing resources and tampered bytes cannot become valid visual evidence', async t => {
  const { root, store, card, asset, approve } = await setup(t), state = await store.read();
  for (const change of [{ documentId: 'other-book' }, { revision: 'r2' }, { page: 2 }, { blockId: 'other-block' }, { bbox: [0, 0, 1, 1] }]) {
    await assert.rejects(resolveVisualCardEvidence(root, state, [{ ...card.visualCitations[0], ...change }]));
  }
  assert.ok(visualCitationShapeIssues([{ ...card.visualCitations[0], path: 'C:/secret' }]).length);
  await approve(); await writeFile(await objectPath(root, asset.hash), Buffer.alloc(asset.bytes));
  await assert.rejects(verifyVisualPublication(root, await store.read(), [card]), /hash mismatch/);
});
test('ordinary quote verification stays strict and public question DTOs expose only the required original-image references', async t => {
  const { store, card, approve } = await setup(t); await approve();
  const state = await store.read(), changed = { ...card, citations: [{ sourceId: 'actual', quote: 'Fabricated text that never existed in the source' }] };
  const report = validateDeck({ title: 'Visual', cards: [changed] }, [{ id: 'actual', text: 'The genuine source contains entirely different words.' }], { documents: state.documents });
  assert.ok(report.errors.some(issue => /quote must match/.test(issue)));
  const dto = publicCard(card);
  for (const key of ['answer', 'explanation', 'citations', 'reviewReceipt', 'modelNotes']) assert.equal(dto[key], undefined);
  assert.equal(dto.visualCitations.length, 1);
  assert.notEqual(reviewedCardFingerprint(card), reviewedCardFingerprint({ ...card, visualCitations: undefined }));
  const plain = { ...card, importedFromJson: true }; delete plain.visualCitations;
  assert.deepEqual(validateDeck({ title: 'Old JSON', cards: [plain] }, []).errors, [], 'the established ordinary JSON behavior remains intact');
});
