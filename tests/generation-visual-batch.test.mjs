import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudyService } from '../lib/service.js';
import { storeBytes, saveManifest } from '../lib/contexts/materials/visual-storage.js';
import { withQualityStages, qualityReview } from './helpers/assessment.mjs';
import { managedRuntimeOptions } from './helpers/runtime-switch.mjs';
import { settleJob } from './helpers/wait.mjs';
import { modelKey } from '../lib/job-model.js';
import { inputRefOf } from '../lib/contexts/generation/jobs/input-ref.js';

const source = { id: 'p1', title: 'Synthetic device page', text: 'A controlled switch closes the current path when enabled and opens the path when disabled. This determines whether the output node follows the input state.' };
const targets = [{ documentId: 'book', blockIds: ['figure'] }];

async function fixture(t, { approved = true, failImageReview = false, gateFirst = false, pureImage = false, rejectFirstEditor = false, legacyDefault = false } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'ordinary-visual-batch-'));
  const requests = [], attachments = new Map();
  let entered, release;
  const first = new Promise(resolve => { entered = resolve; }), gate = new Promise(resolve => { release = resolve; });
  let editors = 0;
  const inner = withQualityStages(async (system, prompt) => {
    if (system.startsWith('Act as a strict assessment editor')) {
      const deck = JSON.parse(prompt).candidate, review = qualityReview(deck);
      if (rejectFirstEditor && editors++ === 0) { review.issues = [`${deck.cards[0].id}: sourceSupport failed: unsupported device premise`]; review.checks[0].sourceSupport = 'fail'; }
      return JSON.stringify(review);
    }
    const data = JSON.parse(prompt.split('REQUEST DATA:\n')[1]);
    return JSON.stringify({ title: 'Synthetic switching questions', cards: Array.from({ length: data.count }, (_, i) => ({
      id: `q${i}`, kind: 'open', topic: 'Switching path', objective: `Device role ${i}`, prompt: `For ${data.assessmentPlan.targets[i].objective}, explain how the switch controls the current path shown in the attached image.`,
      answer: 'Enabling the switch closes the path; disabling it interrupts conduction.', hint: 'Trace the two device terminals.',
      explanation: 'The material states the switching rule; the diagram identifies the terminal path to which that rule applies.',
      misconception: 'Treating a controlled path as an always connected conductor.', rubric: 'Identify the switched connection and distinguish enabled and disabled states.',
      citations: pureImage ? [] : [{ sourceId: source.id, quote: source.text.slice(0, 87) }],
    })) });
  });
  const complete = Object.assign(async () => { throw new Error('An image batch must never fall back to text'); }, { completeContent: async (system, parts, options) => {
    assert.equal(parts.length, 2); assert.equal(parts[1].type, 'image');
    assert.deepEqual(Buffer.from(attachments.get(parts[1].attachment.attachmentId).data), Buffer.from('explicit synthetic device image'));
    requests.push({ system, parts, route: options.route });
    if (requests.length === 1) { entered(); if (gateFirst) await gate; }
    if (system.includes('独立图像题审阅者')) {
      if (failImageReview) throw new Error('Synthetic image review connection lost');
      const card = JSON.parse(parts[0].text.split('\n\nORIGINAL IMAGE EVIDENCE:')[0]).card;
      return JSON.stringify({ evidenceValid: approved, answerCorrect: approved, reason: 'Synthetic independent terminal-path check', issues: approved ? [] : ['Synthetic wrong device connection'], checks: qualityReview({ cards: [card] }).checks });
    }
    const prompt = parts[0].text.split('\n\nORIGINAL IMAGE EVIDENCE:')[0];
    if (system.startsWith('Repair one draft card')) {
      const data = JSON.parse(prompt);
      return JSON.stringify({ card: { ...data.card, prompt: `${data.card.prompt} Trace both terminals.`, visualCitations: [{ assetId: 'untrusted-model-image' }] } });
    }
    if (pureImage && system.startsWith('Plan a source-grounded')) {
      const data = JSON.parse(prompt.split('REQUEST DATA:\n')[1]);
      return JSON.stringify({ targets: Array.from({ length: data.count }, (_, i) => ({ objective: `Visible device path ${data.existing.length + i}`, knowledge: 'The visible switch controls the connection between its two terminals.', citations: [] })) });
    }
    return inner(system, prompt);
  } });
  const ctx = { llm: { resolveModelInfo: async (_provider, model) => ({ inputModalities: model === 'text-only' ? ['text'] : ['text', 'image'] }) },
    attachments: { saveImages: async images => images.map((image, i) => { const attachmentId = `image-${attachments.size}-${i}`; attachments.set(attachmentId, image); return { attachmentId, mediaType: image.mediaType, bytes: image.data.length }; }),
      readImage: async ref => attachments.get(ref.attachmentId) } };
  const options = managedRuntimeOptions({ complete, paths: ['generation'] });
  if (legacyDefault) options.runtimePilot = {};
  options.jobModelHost.ctx = ctx;
  const service = new StudyService(root, { complete, ...options });
  t.after(async () => { release(); await service.dispose(); await rm(root, { recursive: true, force: true }); });
  const original = await storeBytes(root, Buffer.from('%PDF explicit fixture'), { kind: 'original', mime: 'application/pdf' });
  const image = await storeBytes(root, Buffer.from('explicit synthetic device image'), { kind: 'figure', mime: 'image/png' });
  const visual = await saveManifest(root, { schema: 1, documentId: 'book', revision: 'r1', assets: [original, image], quality: {}, pages: [{ page: 1, originalPage: 149, sourceId: pureImage ? null : source.id, text: pureImage ? '' : source.text,
    blocks: [{ id: 'figure', type: 'image', assetId: image.assetId, bbox: [0, 0, 1, 1], captions: [] }] }] });
  await service.store.update(state => { state.settings.scannedTextbooks = true; state.sources = pureImage ? [] : [source]; state.documents = [{ id: 'book', title: 'Synthetic device page', currentRevision: 'r1', versions: [{ revision: 'r1', sourceIds: pureImage ? [] : [source.id], visual }] }]; });
  return { service, requests, first, release, setApproval: value => { approved = value; }, start: (count = 1) => service.call('generate', { sourceIds: pureImage ? [] : [source.id], visualTargets: targets, count, kind: 'open', performance: { concurrency: 1, fillRounds: rejectFirstEditor ? 1 : 0 } }) };
}

test('ordinary batch planning, answers, author, editor and independent image review receive native images and publish bound original evidence', async t => {
  const { service, requests, start } = await fixture(t);
  const job = await settleJob(service, (await start()).jobId);
  assert.equal(job.status, 'complete', JSON.stringify(job));
  assert.equal(requests.length, 5, 'one separate image decision, no repeated checkpoint reviews');
  assert.ok(requests.some(request => request.system.startsWith('Plan a source-grounded')));
  assert.ok(requests.some(request => request.system.startsWith('Prepare supported answers')));
  assert.ok(requests.some(request => request.system.startsWith('You author')));
  assert.ok(requests.some(request => request.system.startsWith('Act as a strict')));
  const state = await service.store.read(), draft = state.drafts[0];
  assert.equal(draft.cards[0].visualCitations[0].reviewState, 'verified');
  assert.equal(state.documents[0].versions[0].visual.cardReviews.length, 1);
  assert.equal(state.sources[0].text, source.text);
  assert.equal(draft.editorial.generation.visualTargets[0].revision, 'r1');
  assert.deepEqual(draft.quality.errors, []);
  const result = await service.call('draft.publish', { id: draft.id, draftVersion: draft.draftVersion, requireReviewed: true });
  assert.equal(result.accepted, 1);
});

test('independent image rejection preserves a pending ordinary draft and blocks publication shortcuts', async t => {
  const { service, requests, start } = await fixture(t, { approved: false });
  const job = await settleJob(service, (await start()).jobId);
  assert.equal(service.runtime.work.jobs.get(job.id).contract.result.completeness, 'partial');
  const draft = (await service.store.read()).drafts[0];
  assert.equal(draft.cards[0].visualCitations[0].reviewState, 'pending');
  assert.ok(draft.editorial.rejectedIssues[draft.cards[0].id].length);
  assert.equal(requests.length, 5);
  await assert.rejects(service.call('draft.publish.quick', { id: draft.id, allowIssues: true }), /independent/);
});

test('image review service failure retains the authored candidate without approval', async t => {
  const { service, start } = await fixture(t, { failImageReview: true });
  const job = await settleJob(service, (await start()).jobId);
  assert.equal(job.status, 'failed');
  const draft = (await service.store.read()).drafts[0];
  assert.equal(draft.cards.length, 1); assert.equal(draft.cards[0].visualCitations[0].reviewState, 'pending');
  await assert.rejects(service.call('draft.publish.quick', { id: draft.id, allowIssues: true }), /independent/);
});

test('ordinary visual batches use live model switching and reject text-only routes before another model request', async t => {
  const { service, requests, start, first, release } = await fixture(t, { gateFirst: true });
  const job = await start(); await first;
  await service.call('job.control', { jobId: job.jobId, action: 'set', patch: { model: modelKey({ provider: 'fixture', model: 'text-only' }) } });
  release();
  assert.equal((await settleJob(service, job.jobId)).status, 'failed');
  assert.equal(requests.length, 1, 'the new text-only route never receives a fake image request');
});

test('a live switch to another vision route affects every later image stage and the independent receipt', async t => {
  const { service, requests, start, first, release } = await fixture(t, { gateFirst: true });
  const job = await start(); await first;
  await service.call('job.control', { jobId: job.jobId, action: 'set', patch: { model: modelKey({ provider: 'fixture', model: 'vision-b' }) } });
  release(); assert.equal((await settleJob(service, job.jobId)).status, 'complete');
  assert.equal(requests[0].route.model, 'fixture');
  assert.ok(requests.slice(1).every(request => request.route.model === 'vision-b'));
  const state = await service.store.read();
  assert.equal(state.documents[0].versions[0].visual.cardReviews[0].route.model, 'vision-b');
});

test('invalid/duplicate/outside-revision selections reject before a model call; image selections affect frozen input', async t => {
  const { service, requests } = await fixture(t);
  for (const visualTargets of [[], [...targets, ...targets], [{ documentId: 'book', revision: 'missing', blockIds: ['figure'] }], [{ documentId: 'book', blockIds: ['missing'] }], [{ ...targets[0], reviewed: true }]])
    await assert.rejects(service.call('generate', { sourceIds: [source.id], visualTargets, count: 1 }));
  assert.equal(requests.length, 0);
  const base = { definition: 'generation@1', sources: [source], request: { count: 1 } };
  assert.notEqual(inputRefOf(base).hash, inputRefOf({ ...base, request: { ...base.request, visualTargets: targets } }).hash);
});

test('pure-image ordinary batches require explicit visualTargets, retain empty source identities and publish actual images', async t => {
  const { service, requests, start } = await fixture(t, { pureImage: true });
  await assert.rejects(service.call('generate', { sourceIds: [], count: 1 }), /Select at least one source/);
  const job = await settleJob(service, (await start(2)).jobId);
  assert.equal(job.status, 'complete', JSON.stringify(job));
  const state = await service.store.read(), draft = state.drafts[0];
  assert.equal(draft.cards.length, 2); assert.equal(state.sources.length, 0);
  assert.deepEqual(draft.editorial.generation.sourceIds, []);
  assert.ok(draft.cards.every(card => card.citations.length === 0 && card.visualCitations[0].reviewState === 'verified'));
  assert.equal(requests.length, 6);
  assert.equal((await service.call('draft.publish', { id: draft.id, draftVersion: draft.draftVersion })).accepted, 2);
});

test('ordinary reserve fill sends original images to replacement answers, author and editor', async t => {
  const { service, requests, start } = await fixture(t, { rejectFirstEditor: true });
  const job = await settleJob(service, (await start()).jobId);
  assert.equal(job.status, 'complete', JSON.stringify(job));
  const draft = (await service.store.read()).drafts[0];
  assert.equal(draft.cards.length, 1); assert.equal(draft.cards[0].visualCitations[0].reviewState, 'verified');
  assert.equal(requests.filter(request => request.system.startsWith('Prepare supported answers')).length, 2);
  assert.equal(requests.filter(request => request.system.startsWith('You author')).length, 2);
  assert.equal(requests.filter(request => request.system.startsWith('Act as a strict')).length, 2);
});

test('an explicit image selection uses native generation even when the old text executor remains the default', async t => {
  const { service, requests, start } = await fixture(t, { legacyDefault: true });
  const job = await settleJob(service, (await start()).jobId);
  assert.equal(job.status, 'complete', JSON.stringify(job)); assert.equal(requests.length, 5);
  assert.equal(service.runtime.work.jobs.get(job.id).contract.kind, 'generation');
});

test('pure-image requests larger than one planning group remain bounded and keep every approved card identity', async t => {
  const { service, start } = await fixture(t, { pureImage: true });
  const job = await settleJob(service, (await start(11)).jobId);
  assert.equal(job.status, 'complete', JSON.stringify(job));
  const state = await service.store.read(), draft = state.drafts[0];
  assert.equal(draft.cards.length, 11); assert.equal(state.sources.length, 0);
  assert.equal(new Set(draft.cards.map(card => card.id)).size, 11);
  assert.equal(state.documents[0].versions[0].visual.cardReviews.length, 11, 'unchanged checkpoints do not spend another independent review');
});

test('ordinary repair of a rejected pure-image card sends fresh native images to repair, editor and independent review', async t => {
  const { service, requests, start, setApproval } = await fixture(t, { pureImage: true, approved: false, legacyDefault: true });
  await settleJob(service, (await start()).jobId);
  let draft = (await service.store.read()).drafts[0];
  const originalId = draft.cards[0].id, before = requests.length;
  setApproval(true);
  const repair = await service.call('draft.repair', { id: draft.id, draftVersion: draft.draftVersion });
  assert.equal((await settleJob(service, repair.jobId)).status, 'complete');
  draft = (await service.store.read()).drafts[0];
  assert.equal(requests.length - before, 3); assert.equal(draft.cards[0].id, originalId);
  assert.equal(draft.cards[0].visualCitations[0].blockId, 'figure', 'a repair reply cannot replace authoritative image identities');
  assert.equal(draft.cards[0].visualCitations[0].reviewState, 'verified');
  assert.deepEqual(draft.editorial.rejectedIssues, {});
  assert.equal((await service.call('draft.publish', { id: draft.id, draftVersion: draft.draftVersion })).accepted, 1);
});

test('ordinary image supplementation publishes into the exact deck while keeping existing card and schedule data', async t => {
  const { service, start } = await fixture(t, { pureImage: true });
  await settleJob(service, (await start()).jobId);
  let state = await service.store.read(), draft = state.drafts[0];
  const published = await service.call('draft.publish', { id: draft.id, draftVersion: draft.draftVersion });
  state = await service.store.read(); const before = structuredClone(state.decks[0].cards[0]);
  const job = await service.call('supplement', { deckId: published.id, sourceIds: [], visualTargets: targets, count: 1, kind: 'open', performance: { concurrency: 1, fillRounds: 0 } });
  const ended = await settleJob(service, job.jobId);
  assert.equal(ended.status, 'complete', JSON.stringify(ended));
  state = await service.store.read(); assert.equal(state.decks.length, 1); assert.equal(state.decks[0].cards.length, 2);
  assert.deepEqual(state.decks[0].cards.find(card => card.id === before.id), before);
  assert.ok(state.decks[0].cards.every(card => card.visualCitations[0].reviewState === 'verified'));
});
