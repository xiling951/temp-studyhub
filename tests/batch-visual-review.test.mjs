import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { batchVisualReviewer } from '../lib/contexts/generation/scanned/batch-visual-evidence.js';
import { commitVisualCardReviews, prepareVisualCardEvidence, resolveVisualCardEvidence, lookupVisualImageObservation, commitVisualImageObservation } from '../lib/contexts/materials/visual-card-evidence.js';
import { syntheticImageObservation } from './helpers/visual-observation.mjs';
import { isImageObservation } from '../lib/visual-observations.js';
import { loadManifest, objectPath, saveManifest, storeBytes } from '../lib/contexts/materials/visual-storage.js';
import { visualReviewIssues, VISUAL_REVIEW_VERSION } from '../lib/visual-citations.js';
import { reviewedCardFingerprint } from '../lib/review-integrity.js';

const dimensions = ['selfContained', 'answerLeak', 'optionQuality', 'learningValue', 'sourceSupport', 'explanationQuality'];
const quote = 'For this explicitly limited long-channel approximation, current follows the square of gate overdrive.';
const source = { id: 'source-1', title: 'Synthetic model conditions', text: 'First define the terminal sign convention and the long-channel approximation.\n\n' +
  quote + '\n\nUnder a separate velocity-saturated approximation, the high-overdrive dependence is approximately linear; these conditions cannot be interchanged.' };

function verdict(card, { approved = true, failed = '' } = {}) {
  const check = { cardId: card.id, explanation: 'Independent fixture check of the stated model and original device connection.',
    ...Object.fromEntries(dimensions.map(key => [key, key === failed ? 'fail' : key === 'optionQuality' ? 'na' : 'pass'])) };
  return { evidenceValid: approved, answerCorrect: approved, reason: 'The explicit original fixture supports this model only under its stated conditions.',
    issues: approved && !failed ? [] : ['The stated model conditions do not support this answer.'], checks: [check] };
}

async function fixture(t, count = 1) {
  const root = await mkdtemp(join(tmpdir(), 'studyhub-batch-visual-'));
  t.after(async () => {
    assert.ok(resolve(root).startsWith(resolve(join(tmpdir(), 'studyhub-batch-visual-'))), 'cleanup stays inside the fixture created here');
    await rm(root, { recursive: true, force: true });
  });
  const original = await storeBytes(root, Buffer.from('%PDF synthetic fixture'), { kind: 'original', mime: 'application/pdf' });
  const image = await storeBytes(root, Buffer.from('explicit synthetic model diagram'), { kind: 'figure', mime: 'image/png' });
  const visual = await saveManifest(root, { schema: 1, documentId: 'book', revision: 'r1', assets: [original, image], quality: {},
    pages: [{ page: 1, originalPage: 1, sourceId: source.id, text: source.text,
      blocks: [{ id: 'figure', type: 'image', assetId: image.assetId, bbox: [0.1, 0.1, 0.9, 0.9], captions: [] }] }] });
  let state = { sources: [structuredClone(source)], drafts: [], documents: [{ id: 'book', currentRevision: 'r1', versions: [{ revision: 'r1', sourceIds: [source.id], visual }] }] };
  const read = async () => structuredClone(state);
  const update = async mutate => { const next = structuredClone(state); await mutate(next); state = next; };
  const [evidence] = await prepareVisualCardEvidence(root, state, { documentId: 'book', revision: 'r1', blockIds: ['figure'] }, { bytes: false });
  const draft = { id: 'draft', draftVersion: 1, title: 'Synthetic scoped model questions', cards: Array.from({ length: count }, (_, i) => ({ id: `card-${i + 1}`, kind: 'open',
    objective: i ? `Distinct boundary ${i}` : 'Identify the applicable long-channel approximation',
    prompt: i ? `Apply a distinct model boundary ${i}.` : 'Which explicit approximation applies to the depicted device under the supplied conditions?',
    answer: 'Only the explicitly limited long-channel approximation.', hint: 'Check the model conditions.', explanation: 'The quoted model applies under its stated approximation.',
    citations: [{ sourceId: source.id, quote }], visualCitations: [structuredClone(evidence.citation)] })), editorial: { reviewedCards: {}, rejectedIssues: {} } };
  state.drafts = [structuredClone(draft)];
  const calls = [], progress = [], observationCalls = [];
  let route = { provider: 'fixture', model: 'vision-a' }, reply = card => verdict(card);
  const models = { visualRoute: () => structuredClone(route), call: async (system, payload, options) => {
    const data = JSON.parse(payload); options.onRoute(structuredClone(route));
    if (options.blindObservation) { observationCalls.push({ system, data }); return JSON.stringify(syntheticImageObservation); }
    calls.push({ system, data, retry: options.retry });
    const value = await reply(data.card, calls.length, data);
    if (value instanceof Error) throw value;
    return typeof value === 'string' ? value : JSON.stringify(value);
  } };
  const materials = {
    resolve: (refs, options) => resolveVisualCardEvidence(root, state, refs, options),
    commit: (args, options) => commitVisualCardReviews({ root, read, update }, args, options),
    observationLookup: (args, options) => lookupVisualImageObservation({ root, read }, args, options),
    observationCommit: (args, options) => commitVisualImageObservation({ root, read, update }, args, options),
  };
  const onProgress = async (next, status) => {
    const saved = { ...next, draftVersion: next.draftVersion + 1 };
    await update(current => { current.drafts = [structuredClone(saved)]; });
    progress.push({ ...status, draft: structuredClone(saved) }); return saved;
  };
  const reviewer = (options = {}) => batchVisualReviewer({ models, materials, read, onProgress, jobId: 'fixture-job', attemptId: 'fixture-attempt', signal: new AbortController().signal, sources: state.sources, ...options });
  return { root, image, read, update, calls, observationCalls, progress, reviewer, draft,
    setReply: next => { reply = next; }, setRoute: next => { route = next; } };
}

test('a change in image-review criteria requires a fresh decision without replenishing repair attempts', async t => {
  const f = await fixture(t), reviewed = await f.reviewer()(f.draft);
  await f.update(state => {
    for (const receipt of state.documents[0].versions[0].visual.cardReviews) receipt.criteriaVersion = VISUAL_REVIEW_VERSION - 1;
    state.drafts[0].editorial.visualRepairAttempts = { 'card-1': { fingerprint: 'unchanged-budget', rounds: 2 } };
  });
  const current = (await f.read()).drafts[0];
  const checked = await f.reviewer()(current);
  assert.equal(f.calls.length, 2, 'older criteria cannot stand in for a new independent decision');
  assert.deepEqual(checked.editorial.visualRepairAttempts, current.editorial.visualRepairAttempts);
  await f.reviewer()(checked);
  assert.equal(f.calls.length, 2, 'the new exact criteria receipt is reused');
  assert.equal(reviewed.cards[0].id, checked.cards[0].id);
});

test('blind image observations exclude authors, quotes and OCR and survive a failed question review', async t => {
  const f = await fixture(t);
  f.setReply(() => new Error('Synthetic independent-review transport failure'));
  await assert.rejects(f.reviewer()(f.draft), /transport failure/);
  assert.equal(f.observationCalls.length, 1);
  assert.deepEqual(Object.keys(f.observationCalls[0].data), ['image']);
  assert.ok(!JSON.stringify(f.observationCalls[0].data).includes(quote));
  const state = await f.read();
  assert.equal(state.documents[0].versions[0].visual.imageObservations.length, 1);
  assert.equal(state.documents[0].versions[0].visual.cardReviews?.length || 0, 0, 'an observation never creates approval');
  f.setReply(card => verdict(card));
  await f.reviewer()(f.draft);
  assert.equal(f.observationCalls.length, 1, 'the saved original-image observation survives a new reviewer');
  assert.deepEqual(f.calls.at(-1).data.observations[0].value, syntheticImageObservation);
  f.setRoute({ provider: 'fixture', model: 'vision-b' });
  await f.reviewer()((await f.read()).drafts[0]);
  assert.equal(f.observationCalls.length, 2, 'another actual model requires its own observation');
});

test('input observations require disjoint connected and unused terminals and their exact total', () => {
  const object = { label: 'constructed-device', kind: 'synthetic gate', region: [0.1, 0.1, 0.9, 0.9],
    connectedInputs: ['left-upper connected wire'], unconnectedInputs: ['left-middle short stub', 'left-lower short stub'], totalInputs: 3, inputCountUncertain: false };
  const value = { objects: [object], visibleFacts: ['Synthetic gate input locations listed separately.'], uncertainties: [] };
  assert.equal(isImageObservation(value), true);
  assert.equal(isImageObservation({ ...value, objects: [{ ...object, totalInputs: 2 }] }), false);
  assert.equal(isImageObservation({ ...value, objects: [{ ...object, unconnectedInputs: ['left-upper connected wire'], totalInputs: 2 }] }), false);
  assert.equal(isImageObservation({ ...value, objects: [{ ...object, region: [0.9, 0.1, 0.1, 0.9] }] }), false);
  assert.equal(isImageObservation({ ...value, card: { answer: 'untrusted author content' } }), false);
});

test('each completed image verdict is persisted with its real receipt and the returned draft version', async t => {
  const f = await fixture(t, 2), reviewed = await f.reviewer()(f.draft), state = await f.read();
  assert.equal(reviewed.draftVersion, 3); assert.deepEqual(f.progress.map(item => item.cardId), ['card-1', 'card-2']);
  assert.equal(f.progress[0].draft.cards[0].visualCitations[0].reviewState, 'verified');
  assert.equal(f.progress[0].draft.cards[1].visualCitations[0].reviewState, 'pending');
  assert.equal(state.documents[0].versions[0].visual.cardReviews.length, 2);
  for (const card of reviewed.cards) assert.deepEqual(visualReviewIssues(card, state.documents), []);
});

test('a later transport failure keeps paid approvals and a new reviewer resumes only the unanswered card', async t => {
  const f = await fixture(t, 2);
  f.setReply(card => card.id === 'card-2' ? new Error('Synthetic transport failure') : verdict(card));
  await assert.rejects(f.reviewer()(f.draft), /Synthetic transport failure/);
  const saved = (await f.read()).drafts[0];
  assert.equal(saved.cards[0].visualCitations[0].reviewState, 'verified');
  assert.deepEqual(visualReviewIssues(saved.cards[0], (await f.read()).documents), []);
  assert.equal(f.progress.length, 1);
  f.setReply(card => verdict(card));
  await f.reviewer()(saved);
  assert.equal(f.calls.filter(call => call.data.card.id === 'card-1').length, 1);
  assert.equal(f.calls.filter(call => call.data.card.id === 'card-2').length, 2);
});

test('malformed JSON is reasked once, and a real negative second verdict remains rejected', async t => {
  const f = await fixture(t);
  f.setReply((card, call) => call === 1 ? '{ malformed' : verdict(card, { approved: false, failed: 'sourceSupport' }));
  const reviewed = await f.reviewer()(f.draft), state = await f.read();
  assert.deepEqual(f.calls.map(call => call.retry), [0, 1]);
  assert.match(f.calls[1].system, /真实 false\/fail/);
  assert.equal(reviewed.cards[0].visualCitations[0].reviewState, 'pending');
  assert.ok(reviewed.editorial.rejectedIssues['card-1'].length);
  assert.equal(state.documents[0].versions[0].visual.cardReviews?.length || 0, 0);
  assert.equal(reviewed.editorial.reviewedCards['card-1'], undefined);
});

test('valid JSON missing a required dimension is a protocol error and can receive one complete review', async t => {
  const f = await fixture(t);
  f.setReply((card, call) => { const result = verdict(card); if (call === 1) delete result.checks[0].sourceSupport; return result; });
  const reviewed = await f.reviewer()(f.draft);
  assert.equal(f.calls.length, 2); assert.equal(reviewed.cards[0].visualCitations[0].reviewState, 'verified');
});

test('a wrong card id or missing boolean cannot become a passing verdict after the one format retry', async t => {
  const f = await fixture(t);
  f.setReply((card, call) => { const result = verdict(card); if (call === 1) result.checks[0].cardId = 'not-this-card'; else delete result.evidenceValid; return result; });
  await assert.rejects(f.reviewer()(f.draft), error => error.code === 'review-protocol' && error.attempts === 2);
  assert.equal(f.calls.length, 2); assert.equal(f.progress.length, 0);
  assert.equal((await f.read()).documents[0].versions[0].visual.cardReviews?.length || 0, 0);
});

test('complete false/fail verdicts are saved without any format retry or forged approval', async t => {
  const f = await fixture(t);
  f.setReply(card => verdict(card, { failed: 'learningValue' }));
  const reviewed = await f.reviewer()(f.draft);
  assert.equal(f.calls.length, 1); assert.equal(f.progress.length, 1);
  assert.ok(reviewed.editorial.rejectedIssues['card-1'].some(issue => /learningValue/.test(issue)));
  assert.ok(visualReviewIssues(reviewed.cards[0], (await f.read()).documents).length);
});

test('an ordinary save may reset the public image label but cannot erase an unchanged trustworthy durable decision', async t => {
  const f = await fixture(t), approved = await f.reviewer()(f.draft);
  const pending = structuredClone(approved); pending.cards[0].visualCitations[0].reviewState = 'pending';
  const reused = await f.reviewer()(pending);
  assert.equal(f.calls.length, 1); assert.equal(f.progress.at(-1).reused, true);
  assert.equal(reused.cards[0].visualCitations[0].reviewState, 'verified');
  assert.equal(reused.editorial.reviewedCards['card-1'], reviewedCardFingerprint(reused.cards[0]));
});

test('a batch checkpoint carrying its original pending-state editorial mark reuses only the exact real image review', async t => {
  const f = await fixture(t), approved = await f.reviewer()(f.draft), pending = structuredClone(approved);
  pending.cards[0].visualCitations[0].reviewState = 'pending';
  pending.editorial.reviewedCards['card-1'] = reviewedCardFingerprint(pending.cards[0]);
  const reused = await f.reviewer()(pending);
  assert.equal(f.calls.length, 1); assert.equal(f.progress.at(-1).reused, true);
  assert.equal(reused.editorial.reviewedCards['card-1'], reviewedCardFingerprint(reused.cards[0]));
  pending.cards[0].prompt += ' Now apply a different explicit condition.';
  await f.reviewer()(pending);
  assert.equal(f.calls.length, 2, 'a pending-state mark cannot approve edited content');
});

test('a single-card repair scope retains all original peers for duplicate checking and persistence', async t => {
  const f = await fixture(t, 2), reviewed = await f.reviewer({ cardIds: ['card-2'] })(f.draft);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].data.card.id, 'card-2');
  assert.equal(f.calls[0].data.otherTargets[0].cardId, 'card-1');
  assert.equal(reviewed.cards.length, 2); assert.deepEqual(reviewed.cards[0], f.draft.cards[0]);
  assert.equal(reviewed.cards[1].visualCitations[0].reviewState, 'verified');
  await assert.rejects(f.reviewer({ cardIds: ['outside-draft'] })(reviewed), /existing unique visual card IDs/);
  assert.equal(f.calls.length, 1, 'invalid scope is rejected before any model request');
});

test('a route change or edited question requires a new independent image review', async t => {
  const f = await fixture(t), first = await f.reviewer()(f.draft);
  f.setRoute({ model: 'vision-b', provider: 'fixture' });
  const second = await f.reviewer()(first);
  assert.equal(f.calls.length, 2);
  second.cards[0].prompt += ' Use the newly stated boundary.';
  const third = await f.reviewer()(second);
  assert.equal(f.calls.length, 3); assert.deepEqual(visualReviewIssues(third.cards[0], (await f.read()).documents), []);
});

test('neither an editorial fingerprint without a native receipt nor a native receipt without the current editorial fingerprint is reused', async t => {
  const f = await fixture(t), first = await f.reviewer()(f.draft);
  first.editorial.reviewedCards = {};
  await f.reviewer()(first); assert.equal(f.calls.length, 2);
  const saved = (await f.read()).drafts[0];
  await f.update(state => { state.documents[0].versions[0].visual.cardReviews = []; });
  f.setReply(card => verdict(card, { approved: false }));
  const rejected = await f.reviewer()(saved);
  assert.equal(f.calls.length, 3); assert.equal(rejected.cards[0].visualCitations[0].reviewState, 'pending');
});

test('changing the immutable manifest invalidates old receipts even when the image reference and question are identical', async t => {
  const f = await fixture(t), first = await f.reviewer()(f.draft), state = await f.read();
  const oldVisual = state.documents[0].versions[0].visual, manifest = await loadManifest(f.root, oldVisual);
  const changed = await saveManifest(f.root, { ...manifest, quality: { explicitFixtureRevision: 'changed-context' } });
  await f.update(next => { next.documents[0].versions[0].visual = { ...changed, cardReviews: oldVisual.cardReviews }; });
  const reviewed = await f.reviewer()(first);
  assert.equal(f.calls.length, 2); assert.deepEqual(visualReviewIssues(reviewed.cards[0], (await f.read()).documents), []);
  assert.equal(f.observationCalls.length, 2, 'changed immutable material context also invalidates its blind observations');
});

test('a durable receipt still requires fresh verification of the actual image bytes', async t => {
  const f = await fixture(t), first = await f.reviewer()(f.draft);
  await writeFile(await objectPath(f.root, f.image.hash), Buffer.from('deliberately corrupted and differently sized fixture bytes'));
  await assert.rejects(f.reviewer()(first), /size|hash|bytes|changed|integrity|metadata mismatch/i);
  assert.equal(f.calls.length, 1, 'corrupt evidence is rejected before another model call');
});

test('model conditions, exact bounded source context and other targets reach the independent reviewer without rewriting quotations', async t => {
  const f = await fixture(t, 2);
  await f.reviewer()(f.draft);
  const { data, system } = f.calls[0];
  assert.deepEqual(data.sources[0].quotes, [quote]);
  assert.ok(data.sources[0].contexts.some(context => /velocity-saturated/.test(context.text)));
  assert.ok(data.sources[0].contexts.every(context => context.text === source.text.slice(context.start, context.end)));
  assert.ok(data.sources.flatMap(item => item.contexts).reduce((sum, context) => sum + context.text.length, 0) <= 6000);
  assert.equal(data.otherTargets[0].cardId, 'card-2');
  assert.match(system, /先辨认模型、适用条件、符号定义和近似范围/);
  assert.match(system, /不同边界、模型或解题技能不可只因主题相同而拒绝/);
});
