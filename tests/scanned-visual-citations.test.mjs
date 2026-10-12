import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { storeBytes, saveManifest, objectPath } from '../lib/contexts/materials/visual-storage.js';
import { prepareVisualCardEvidence, resolveVisualCardEvidence, commitVisualCardReviews, verifyVisualPublication, commitVisualImageObservation } from '../lib/contexts/materials/visual-card-evidence.js';
import { IMAGE_OBSERVER_VERSION } from '../lib/visual-observations.js';
import { syntheticImageObservation } from './helpers/visual-observation.mjs';
import { visualReviewIssues, visualCitationShapeIssues, VISUAL_REVIEW_VERSION } from '../lib/visual-citations.js';
import { validateDeck, publicCard } from '../lib/domain.js';
import { reviewedCardFingerprint } from '../lib/review-integrity.js';
import { createStudyRuntime } from '../lib/runtime/builtins.js';
import { prepareJsonImport } from '../lib/json-import.js';
async function setup(t) {
  const root = await mkdtemp(join(tmpdir(), 'visual-citations-')); t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = createStudyRuntime(root); t.after(() => runtime.dispose());
  const store = runtime.storage, original = await storeBytes(root, Buffer.from('%PDF-1.7 fixture'), { kind: 'original', mime: 'application/pdf' });
  const asset = await storeBytes(root, Buffer.from('immutable image bytes'), { kind: 'figure', mime: 'image/png' });
  const visual = await saveManifest(root, { schema: 1, documentId: 'book', revision: 'r1', fingerprint: 'fixture', assets: [original, asset], quality: {}, pages: [{ page: 1, originalPage: 200, text: '', sourceId: null, blocks: [{ id: 'b0', type: 'image', bbox: [0.1, 0.2, 0.8, 0.9], assetId: asset.assetId, captions: [] }] }] });
  await store.update(state => { state.documents = [{ id: 'book', currentRevision: 'r1', versions: [{ revision: 'r1', sourceIds: [], visual }] }]; });
  const evidence = await prepareVisualCardEvidence(root, await store.read(), { documentId: 'book', blockIds: ['b0'] }, { bytes: true });
  const card = { id: 'question', kind: 'flashcard', topic: 'Circuit role', objective: 'Explain the function of the selected device', prompt: 'Could the marked device be removed while retaining the shown behavior?', answer: 'No, it supplies the stated path.', hint: 'Trace the two terminal connections.', explanation: 'The required conduction path would be interrupted, changing the operating condition.', misconception: 'Confusing a redundant wire with a switching device', citations: [], visualCitations: evidence.map(item => item.citation) };
  const approve = async () => {
    card.visualCitations.forEach(ref => { ref.reviewState = 'verified'; });
    const route = { provider: 'fixture', model: 'vision' }, ports = { root, read: () => store.read(), update: fn => store.update(fn) };
    const observation = await commitVisualImageObservation(ports, { citation: card.visualCitations[0], route, observerVersion: IMAGE_OBSERVER_VERSION, value: syntheticImageObservation, jobId: 'fixture-job', attemptId: 'fixture-attempt' });
    await commitVisualCardReviews(ports, { cards: [card], checks: [{ cardId: card.id, evidenceValid: true, answerCorrect: true, independent: true, reason: 'Explicit synthetic reviewer fixture', observationKeys: [observation.key] }], jobId: 'fixture-job', attemptId: 'fixture-attempt', route });
  };
  return { root, store, asset, card, approve, runtime };
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
test('new publication refuses older review criteria while historical image questions remain readable', async t => {
  const { root, store, card, approve } = await setup(t); await approve();
  await store.update(state => { state.documents[0].versions[0].visual.cardReviews[0].criteriaVersion = VISUAL_REVIEW_VERSION - 1; });
  const state = await store.read();
  assert.deepEqual(visualReviewIssues(card, state.documents), [], 'historical reading retains its original trusted receipt');
  await assert.rejects(verifyVisualPublication(root, state, [card]), /current independent image-review criteria/);
});

test('a model-approved flag without a trusted blind observation cannot create a current review receipt', async t => {
  const { root, store, card } = await setup(t);
  await assert.rejects(commitVisualCardReviews({ root, read: () => store.read(), update: fn => store.update(fn) },
    { cards: [card], checks: [{ cardId: card.id, evidenceValid: true, answerCorrect: true, independent: true, reason: 'Constructed fake approval', observationKeys: ['forged'] }],
      jobId: 'fixture-job', attemptId: 'fixture-attempt', route: { provider: 'fixture', model: 'vision' } }), /trusted blind observation/);
  assert.equal((await store.read()).documents[0].versions[0].visual.cardReviews?.length || 0, 0);
});
test('actual publication APIs reject client flags and resource tampering; quick publish cannot waive image review', async t => {
  const { root, store, card, asset, approve, runtime } = await setup(t);
  let draft = await runtime.call('draft.save', { deck: { title: 'Visual draft', cards: [card] } });
  for (const action of ['draft.publish', 'draft.publish.quick', 'draft.publish.plan']) await assert.rejects(runtime.call(action, { id: draft.id, planned: true, allowIssues: true }), /independent/);
  await approve();
  draft = await runtime.call('draft.save', { deck: { ...draft, cards: [card] } });
  await writeFile(await objectPath(root, asset.hash), Buffer.alloc(asset.bytes));
  await assert.rejects(runtime.call('draft.publish.quick', { id: draft.id, allowIssues: true }), /hash mismatch/);
  assert.equal((await store.read()).decks.length, 0);
});
test('actual bank append validates image resources under its coordination lock and accepts only independent approved cards', async t => {
  const { card, approve, runtime } = await setup(t);
  const target = await runtime.call('bank.deck.ensure', { title: 'Approved visual questions', purpose: 'source-qa' });
  const args = { deckId: target.deckId, cards: [card], operationId: 'append-picture', expectedVersion: 0 };
  await assert.rejects(runtime.call('bank.append', args), /independent/);
  await approve();
  const receipt = await runtime.call('bank.append', args);
  assert.equal(receipt.added, 1); assert.equal((await runtime.call('bank.deck.get', { id: target.deckId })).deck.cards[0].visualCitations.length, 1);
});
test('an approved visual draft publishes through the existing authoring flow with clean quality and preserved original references', async t => {
  const { card, approve, runtime } = await setup(t); await approve();
  const draft = await runtime.call('draft.save', { deck: { title: 'Verified visual draft', cards: [card], editorial: { reviewedCards: { [card.id]: reviewedCardFingerprint(card) } } } });
  assert.deepEqual(draft.quality.errors, []);
  const published = await runtime.call('draft.publish', { id: draft.id, draftVersion: draft.draftVersion, requireReviewed: true });
  const deck = (await runtime.call('bank.deck.get', { id: published.id })).deck;
  assert.equal(deck.cards.length, 1); assert.deepEqual(deck.cards[0].visualCitations, card.visualCitations); assert.deepEqual(deck.quality.errors, []);
});
test('JSON import preserves visual references as a pending draft and does not silently discard bad ordinary evidence', async t => {
  const { card, approve, runtime } = await setup(t); await approve();
  const text = JSON.stringify({ title: 'Imported visual deck', cards: [card] });
  const result = await runtime.call('deck.import', { text });
  assert.equal(result.imported, 1); assert.equal(result.added, 0); assert.equal(result.results[0].status, 'needs-visual-review');
  const state = await runtime.storage.read();
  assert.equal(state.decks.length, 0); assert.equal(state.drafts[0].cards[0].visualCitations[0].reviewState, 'pending');
  await assert.rejects(runtime.call('draft.publish.quick', { id: state.drafts[0].id }), /independent/);
  const bad = { ...card, citations: [{ sourceId: 'unknown', quote: 'An invented quote that is not in the material' }] };
  const parsed = prepareJsonImport(JSON.stringify({ title: 'Bad text evidence', cards: [bad] }));
  assert.deepEqual(parsed.deck.cards[0].citations, bad.citations);
  assert.ok(parsed.deck.quality.errors.some(error => /unknown source/.test(error)));
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
