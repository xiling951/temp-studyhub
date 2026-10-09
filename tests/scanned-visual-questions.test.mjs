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
  const requests = [];
  const complete = Object.assign(async () => { throw new Error('A visual stage must never call the old text seam'); }, { completeContent: async (system, parts) => {
    requests.push({ system, parts }); assert.equal(parts[1].type, 'image'); reportUsage({ uncachedInputTokens: 10, outputTokens: 5 });
    const data = JSON.parse(parts[0].text);
    if (system.includes('独立图像题审阅者')) return JSON.stringify({ evidenceValid: approved, answerCorrect: approved, reason: 'Explicit synthetic model review of the required path', issues: approved ? [] : ['Synthetic incorrect circuit answer'], checks: [check(data.card)] });
    if (system.includes('准备具体正确答案')) return JSON.stringify({ items: [{ targetId: 't1', answer: 'No, it supplies a necessary switching path.', explanation: 'Removing the device opens the path; the operating state then fails to follow the stated connection.', misconception: 'Confusing a controlled switch with a redundant conductor', citations: [], rubric: 'Identify the path, explain the interruption and conclude.' }] });
    if (system.includes('组织清晰')) return JSON.stringify({ title: 'Fixture circuit questions', cards: [{ targetId: 't1', topic: 'Switching path', prompt: 'Can the selected device be removed while retaining the circuit behavior? Explain the connection that determines this.', hint: 'Trace the device terminals and power rails.' }] });
    return '{"targets":[{"targetId":"t1","objective":"Analyze removal of the required switching device","blockIds":["b0"]}]}';
  } });
  const ctx = { llm: { resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }) }, attachments: { saveImages: async images => images.map(image => ({ attachmentId: 'sha256:fixture', mediaType: image.mediaType, bytes: image.data.length })), readImage: async () => ({ data: Buffer.alloc(1) }) } };
  const services = { complete, jobExecutor: executor, workOwner: Symbol('owner'), jobModelHost: { ctx, sessionId: 'missing', complete, route: { provider: 'fixture', model: 'vision' } } };
  const wait = async result => { await until(() => ['complete', 'failed', 'cancelled'].includes(runtime.work.jobs.get(result.jobId)?.status), 'visual question fixture'); return runtime.work.jobs.get(result.jobId).contract; };
  return { runtime, services, requests, wait };
}
test('all four native visual stages receive real image blocks; pure-image questions publish only after separate image/answer review', async t => {
  const { runtime, services, requests, wait } = await setup(t);
  const job = await wait(await runtime.call('generation.visual.start', { documentId: 'book', blockIds: ['b0'], count: 1, kind: 'open' }, services));
  assert.equal(job.status, 'complete', job.error?.message); assert.equal(job.result.completeness, 'complete'); assert.equal(requests.length, 4); assert.equal(job.calls.length, 4); assert.equal(job.usage.tokens, 60);
  assert.ok(job.calls.every(call => call.runner === 'direct' && call.fallbackReason === 'agent-unavailable'));
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
  assert.equal(reviewed.status, 'complete', reviewed.error?.message); assert.equal(requests.length, 5); assert.equal(reviewed.calls.length, 1);
  assert.equal((await runtime.storage.read()).documents[0].versions[0].visual.cardReviews.length, 2);
});
