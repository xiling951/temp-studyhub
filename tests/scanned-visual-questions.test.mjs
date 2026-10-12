import { syntheticImageObservation } from './helpers/visual-observation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStudyRuntime } from '../lib/runtime/builtins.js';
import { storeBytes, saveManifest } from '../lib/contexts/materials/visual-storage.js';
import { until } from './helpers/wait.mjs';
import { reportUsage } from '../lib/usage-scope.js';
const executor = { assertAvailable() {}, witness: () => ({ pid: process.pid, host: 'fixture', instance: 'visual-question' }), start({ run, cancel }) { void run(); return { id: 'fixture-native', ownerAgentId: 'owner', stop: cancel, append() {} }; } };
const check = card => ({ cardId: card.id, selfContained: 'pass', answerLeak: 'pass', optionQuality: 'na', learningValue: 'pass', sourceSupport: 'pass', explanationQuality: 'pass', explanation: 'Explicit synthetic quality review fixture with a supported device connection' });
async function setup(t, approved = true) {
  const root = await mkdtemp(join(tmpdir(), 'visual-questions-')); t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = createStudyRuntime(root); t.after(() => runtime.dispose());
  const original = await storeBytes(root, Buffer.from('%PDF-1.7 fixture'), { kind: 'original', mime: 'application/pdf' }), image = await storeBytes(root, Buffer.from('synthetic native image bytes'), { kind: 'figure', mime: 'image/png' });
  const visual = await saveManifest(root, { schema: 1, documentId: 'book', revision: 'r1', fingerprint: 'fixture', assets: [original, image], quality: {}, pages: [{ page: 1, originalPage: 1, sourceId: null, text: '', blocks: [{ id: 'b0', type: 'image', assetId: image.assetId, bbox: [0, 0, 1, 1], captions: [] }] }] });
  await runtime.storage.update(state => { state.settings.scannedTextbooks = true; state.documents = [{ id: 'book', title: 'Fixture', currentRevision: 'r1', versions: [{ revision: 'r1', sourceIds: [], visual }] }]; });
  const requests = []; let reviewResponse;
  const complete = Object.assign(async () => { throw new Error('A visual stage must never call the old text seam'); }, { completeContent: async (system, parts, options) => {
    requests.push({ system, parts, maxTokens: options?.maxTokens }); assert.equal(parts[1].type, 'image'); reportUsage({ uncachedInputTokens: 10, outputTokens: 5 });
    const data = JSON.parse(parts[0].text);
    if (system.startsWith('你是盲图观察者')) { assert.deepEqual(Object.keys(data), ['image']); return JSON.stringify(syntheticImageObservation); }
    if (system.includes('独立图像题审阅者')) return reviewResponse ? reviewResponse(data.card) : JSON.stringify({ evidenceValid: approved, answerCorrect: approved, reason: 'Explicit synthetic model review of the required path', issues: approved ? [] : ['Synthetic incorrect circuit answer'], checks: [check(data.card)] });
    if (system.includes('准备具体正确答案')) return JSON.stringify({ items: [{ targetId: 't1', answer: 'No, it supplies a necessary switching path.', explanation: 'Removing the device opens the path; the operating state then fails to follow the stated connection.', misconception: 'Confusing a controlled switch with a redundant conductor', citations: [], rubric: 'Identify the path, explain the interruption and conclude.' }] });
    if (system.includes('组织清晰')) return JSON.stringify({ title: 'Fixture circuit questions', cards: [{ targetId: 't1', topic: 'Switching path', prompt: 'Can the selected device be removed while retaining the circuit behavior? Explain the connection that determines this.', hint: 'Trace the device terminals and power rails.' }] });
    return '{"targets":[{"targetId":"t1","objective":"Analyze removal of the required switching device","blockIds":["b0"]}]}';
  } });
  const ctx = { llm: { resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }) }, attachments: { saveImages: async images => images.map(image => ({ attachmentId: 'sha256:fixture', mediaType: image.mediaType, bytes: image.data.length })), readImage: async () => ({ data: Buffer.alloc(1) }) } };
  const services = { complete, jobExecutor: executor, workOwner: Symbol('owner'), jobModelHost: { ctx, sessionId: 'missing', complete, route: { provider: 'fixture', model: 'vision' } } };
  const wait = async result => { await until(() => ['complete', 'failed', 'cancelled'].includes(runtime.work.jobs.get(result.jobId)?.status), 'visual question fixture'); return runtime.work.jobs.get(result.jobId).contract; };
  return { runtime, services, requests, wait, setApproval: value => { approved = value; }, setReviewResponse: value => { reviewResponse = value; } };
}

test('a later review failure preserves earlier authoritative decisions and resumes only unchanged unreviewed cards', async t => {
  const { runtime, services, requests, wait, setReviewResponse } = await setup(t);
  await wait(await runtime.call('generation.visual.start', { documentId: 'book', blockIds: ['b0'], count: 1 }, services));
  let draft = structuredClone((await runtime.storage.read()).drafts[0]);
  draft.cards[0].answer = 'New independent candidate requiring image review.';
  draft.cards.push({ ...structuredClone(draft.cards[0]), id: 'second', objective: 'Analyze how disabling the switch interrupts current', prompt: 'What happens to the current path when the switch is disabled? Explain why.', visualCitations: draft.cards[0].visualCitations.map(ref => ({ ...ref, reviewState: 'pending' })) });
  draft = await runtime.call('draft.save', { deck: draft });
  setReviewResponse(card => { if (card.id === 'second') throw Error('Synthetic later transport failure'); return JSON.stringify({ evidenceValid: true, answerCorrect: true, reason: 'Actual fixture image independently checked', issues: [], checks: [check(card)] }); });
  const failed = await wait(await runtime.call('generation.visual.review', { draftId: draft.id, draftVersion: draft.draftVersion }, services));
  assert.equal(failed.status, 'failed'); assert.match(failed.error.message, /transport failure/);
  draft = (await runtime.storage.read()).drafts[0];
  assert.equal(draft.cards[0].visualCitations[0].reviewState, 'verified'); assert.equal(draft.cards[1].visualCitations[0].reviewState, 'pending');
  assert.ok(draft.editorial.reviewedCards[draft.cards[0].id]);
  setReviewResponse(undefined);
  const before = requests.length;
  const resumed = await wait(await runtime.call('generation.visual.review', { draftId: draft.id, draftVersion: draft.draftVersion }, services));
  assert.equal(resumed.status, 'complete', resumed.error?.message); assert.equal(resumed.calls.length, 1); assert.equal(requests.length - before, 1);
  draft = (await runtime.storage.read()).drafts[0];
  const published = await runtime.call('draft.publish', { id: draft.id, draftVersion: draft.draftVersion, requireReviewed: true });
  assert.equal(published.accepted, 2);
});

test('one syntax retry still accepts a valid independent rejection and never retries that rejection', async t => {
  const { runtime, services, wait, setReviewResponse } = await setup(t);
  await wait(await runtime.call('generation.visual.start', { documentId: 'book', blockIds: ['b0'], count: 1 }, services));
  let draft = structuredClone((await runtime.storage.read()).drafts[0]); draft.cards[0].answer = 'A changed candidate';
  draft = await runtime.call('draft.save', { deck: draft }); let attempts = 0;
  setReviewResponse(card => ++attempts === 1 ? '{"reason":"unescaped "quote""}' : JSON.stringify({ evidenceValid: true, answerCorrect: false, reason: 'The visible circuit contradicts the candidate', issues: ['Incorrect candidate answer'], checks: [check(card)] }));
  const result = await wait(await runtime.call('generation.visual.review', { draftId: draft.id, draftVersion: draft.draftVersion }, services));
  assert.equal(result.status, 'complete', result.error?.message); assert.equal(result.result.completeness, 'partial'); assert.equal(attempts, 2); assert.equal(result.calls.length, 2);
  draft = (await runtime.storage.read()).drafts[0];
  await assert.rejects(runtime.call('draft.publish', { id: draft.id, draftVersion: draft.draftVersion, requireReviewed: true }), /independent|review|Incorrect/);
});
test('a truncated direct image review retries once with a larger budget and preserves a real negative verdict', async t => {
  const { runtime, services, requests, wait, setReviewResponse } = await setup(t);
  await wait(await runtime.call('generation.visual.start', { documentId: 'book', blockIds: ['b0'], count: 1 }, services));
  const draft = structuredClone((await runtime.storage.read()).drafts[0]);
  draft.cards[0].answer = 'An unsupported device-count assertion needing fresh review.';
  await runtime.call('draft.save', { deck: draft });
  const saved = (await runtime.storage.read()).drafts[0];
  let attempts = 0;
  setReviewResponse(card => {
    if (++attempts === 1) throw Error('Synthetic max-tokens: max-tokens');
    return JSON.stringify({ evidenceValid: false, answerCorrect: false, reason: 'The actual image contradicts the count.', issues: ['Visible device-count mismatch'], checks: [check(card)] });
  });
  const ended = await wait(await runtime.call('generation.visual.review', { draftId: saved.id, draftVersion: saved.draftVersion }, services));
  assert.equal(attempts, 2);
  assert.deepEqual(requests.slice(-2).map(request => request.maxTokens), [16000, 24000]);
  assert.equal(ended.result.completeness, 'partial');
  assert.ok(ended.calls.every(call => call.runner === 'direct'));
  const after = (await runtime.storage.read()).drafts[0];
  assert.equal(after.cards[0].id, saved.cards[0].id);
  assert.equal(after.cards[0].visualCitations[0].reviewState, 'pending');
  await assert.rejects(runtime.call('draft.publish', { id: after.id, draftVersion: after.draftVersion, requireReviewed: true }), /review|independent|mismatch/);
});

test('all four native visual stages receive real image blocks; pure-image questions publish only after separate image/answer review', async t => {
  const { runtime, services, requests, wait } = await setup(t);
  const job = await wait(await runtime.call('generation.visual.start', { documentId: 'book', blockIds: ['b0'], count: 1, kind: 'open' }, services));
  assert.equal(job.status, 'complete', job.error?.message); assert.equal(job.result.completeness, 'complete'); assert.equal(requests.length, 5); assert.equal(job.calls.length, 5); assert.equal(job.usage.tokens, 75);
  assert.ok(job.calls.every(call => call.runner === 'direct' && call.fallbackReason !== 'agent-unavailable'));
  const state = await runtime.storage.read(), draft = state.drafts[0];
  assert.equal(state.sources.length, 0, 'pure image work must not invent source text'); assert.equal(draft.cards[0].citations.length, 0);
  assert.equal(draft.cards[0].visualCitations[0].reviewState, 'verified'); assert.equal(state.documents[0].versions[0].visual.cardReviews.length, 1);
  assert.deepEqual(draft.quality.errors, []);
  const published = await runtime.call('draft.publish', { id: draft.id, draftVersion: draft.draftVersion, requireReviewed: true });
  assert.equal(published.accepted, 1);
  assert.equal((await runtime.call('bank.deck.get', { id: published.id })).deck.cards[0].visualCitations[0].assetId, draft.cards[0].visualCitations[0].assetId);
});
test('independent image/answer rejection preserves an editable draft and blocks every publication shortcut', async t => {
  const { runtime, services, wait } = await setup(t, false);
  const job = await wait(await runtime.call('generation.visual.start', { documentId: 'book', blockIds: ['b0'], count: 1, kind: 'open' }, services));
  assert.equal(job.status, 'complete', job.error?.message); assert.equal(job.result.completeness, 'partial');
  const draft = (await runtime.storage.read()).drafts[0];
  assert.equal(draft.cards[0].visualCitations[0].reviewState, 'pending'); assert.ok(draft.editorial.rejectedIssues[draft.cards[0].id].length);
  await assert.rejects(runtime.call('draft.publish.quick', { id: draft.id, allowIssues: true }), /independent/);
  assert.equal((await runtime.storage.read()).decks.length, 0);
});
test('an edited visual answer invalidates its old review and can be re-reviewed only through fresh actual image calls', async t => {
  const { runtime, services, requests, wait } = await setup(t);
  await wait(await runtime.call('generation.visual.start', { documentId: 'book', blockIds: ['b0'], count: 1, kind: 'open' }, services));
  let draft = structuredClone((await runtime.storage.read()).drafts[0]); draft.cards[0].answer = 'Edited answer requiring a fresh independent decision';
  draft = await runtime.call('draft.save', { deck: draft });
  await assert.rejects(runtime.call('draft.publish', { id: draft.id }), /independent/);
  const reviewed = await wait(await runtime.call('generation.visual.review', { draftId: draft.id, draftVersion: draft.draftVersion }, services));
  assert.equal(reviewed.status, 'complete', reviewed.error?.message); assert.equal(requests.length, 6); assert.equal(reviewed.calls.length, 1);
  assert.equal((await runtime.storage.read()).documents[0].versions[0].visual.cardReviews.length, 2);
});

test('a fresh rejection after editing is retained and reported as partial; approval authority is never a public action', async t => {
  const { runtime, services, wait, setApproval } = await setup(t, false);
  await wait(await runtime.call('generation.visual.start', { documentId: 'book', blockIds: ['b0'], count: 1 }, services));
  let draft = structuredClone((await runtime.storage.read()).drafts[0]); draft.cards[0].answer = 'Changed candidate that the synthetic independent reviewer still rejects';
  draft = await runtime.call('draft.save', { deck: draft });
  assert.deepEqual(draft.editorial.rejectedIssues, {});
  const result = await wait(await runtime.call('generation.visual.review', { draftId: draft.id, draftVersion: draft.draftVersion }, services));
  assert.equal(result.result.completeness, 'partial');
  draft = (await runtime.storage.read()).drafts[0]; assert.ok(draft.editorial.rejectedIssues[draft.cards[0].id].length);
  for (const action of ['materials.visual.cards.review.commit', 'materials.visual.cards.resolve', 'materials.visual.images.observation.lookup', 'materials.visual.images.observation.commit', 'bank.draft.visual.review.save']) {
    assert.equal(runtime.hasAction(action), false);
    await assert.rejects(runtime.call(action, {}), /Capability unavailable/);
  }
  assert.ok(runtime.describe().every(domain => domain.operations.every(operation => !['visual.cards.review.commit', 'draft.visual.review.save'].includes(operation.name))));
  setApproval(true);
  const approved = await wait(await runtime.call('generation.visual.review', { draftId: draft.id, draftVersion: draft.draftVersion }, services));
  assert.equal(approved.result.completeness, 'complete');
});

test('invalid edited visual drafts fail structural preflight before another paid image review', async t => {
  const { runtime, services, wait, requests } = await setup(t);
  await wait(await runtime.call('generation.visual.start', { documentId: 'book', blockIds: ['b0'], count: 1 }, services));
  let draft = structuredClone((await runtime.storage.read()).drafts[0]); draft.cards[0].hint = '';
  draft = await runtime.call('draft.save', { deck: draft });
  const job = await wait(await runtime.call('generation.visual.review', { draftId: draft.id, draftVersion: draft.draftVersion }, services));
  assert.equal(job.status, 'failed'); assert.match(job.error.message, /hint is required/);
  assert.equal(requests.length, 5); assert.equal(job.calls.length, 0);
});
