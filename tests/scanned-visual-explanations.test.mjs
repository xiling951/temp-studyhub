import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStudyRuntime } from '../lib/runtime/builtins.js';
import { storeBytes, saveManifest } from '../lib/contexts/materials/visual-storage.js';
import { planVisualExplanations, decodeVisualExplanation } from '../lib/contexts/materials/scanned/visual-explanations.js';
import { until } from './helpers/wait.mjs';
import { reportUsage } from '../lib/usage-scope.js';
const executor = { assertAvailable() {}, witness: () => ({ pid: process.pid, host: 'fixture', instance: 'visual-notes' }),
  start({ run, cancel }) { void run(); return { id: 'fixture-native', ownerAgentId: 'fixture-owner', stop: cancel, append() {} }; } };
async function setup(t, answer) {
  const root = await mkdtemp(join(tmpdir(), 'visual-notes-')); t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = createStudyRuntime(root); t.after(() => runtime.dispose());
  const original = await storeBytes(root, Buffer.from('%PDF-1.7 fixture'), { mime: 'application/pdf', kind: 'original' });
  const image = await storeBytes(root, Buffer.from('fixture native attachment bytes'), { mime: 'image/png', kind: 'figure' });
  const manifest = { schema: 1, documentId: 'book', revision: 'r1', fingerprint: 'v1', assets: [original, image], quality: { reviewRequired: true },
    pages: [1, 2].map(page => ({ page, originalPage: 199 + page, text: `Genuine OCR context ${page}`, sourceId: `source-${page}`, blocks: [{ id: `p${page}-b0`, type: 'image', assetId: image.assetId, captions: [] }] })) };
  const visual = await saveManifest(root, manifest);
  await runtime.storage.update(state => { state.settings.scannedTextbooks = true; (state.documents ||= []).push({ id: 'book', title: 'Fixture book', currentRevision: 'r1', versions: [{ revision: 'r1', sourceIds: ['source-1', 'source-2'], visual }] }); state.sources.push({ id: 'source-1', text: 'Genuine OCR context 1' }, { id: 'source-2', text: 'Genuine OCR context 2' }); });
  const admitted = [];
  const ctx = { llm: { resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }) }, attachments: {
    saveImages: async images => images.map(image => { admitted.push(image); return { attachmentId: 'sha256:fixture', mediaType: image.mediaType, bytes: image.data.length }; }),
    readImage: async () => ({ data: Buffer.from('fixture') }),
  } };
  const complete = Object.assign(async () => 'ordinary text', { completeContent: answer || (async (_system, parts) => {
    assert.equal(parts[1].type, 'image'); reportUsage({ uncachedInputTokens: 5, outputTokens: 2 });
    return JSON.stringify({ description: 'Distinct model explanation', uncertainty: ['OCR label requires checking'] });
  }) });
  const services = { complete, jobExecutor: executor, workOwner: Symbol('test'), jobModelHost: { ctx, sessionId: 'none', complete, route: { provider: 'fixture', model: 'vision' } } };
  const submit = async input => {
    const job = await runtime.call('materials.visual.explain', { documentId: 'book', ...input }, services);
    await until(() => ['complete', 'failed', 'cancelled'].includes(runtime.work.jobs.get(job.jobId)?.status), 'explanation fixture settlement');
    return runtime.work.jobs.get(job.jobId).contract;
  };
  return { root, runtime, services, submit, admitted, manifest };
}
test('native Job saves separate pending notes, reuses exact versions, changes model create history, and human review is explicit', async t => {
  const { runtime, submit, services, admitted } = await setup(t);
  const originalSources = (await runtime.storage.read()).sources;
  const first = await submit({ pageStart: 1, pageEnd: 1 }); assert.equal(first.status, 'complete', first.error?.message); assert.equal(first.calls.length, 1); assert.equal(first.usage.tokens, 7);
  const firstNote = (await runtime.call('materials.visual.explanations', { documentId: 'book', page: 1 })).notes[0];
  assert.equal(firstNote.review, 'pending'); assert.equal(firstNote.indexed, false);
  const reused = await submit({ pageStart: 1, pageEnd: 1 }); assert.equal(reused.status, 'complete'); assert.equal(reused.calls[0].reused, true); assert.equal(admitted.length, 1);
  services.jobModelHost.route.model = 'vision-new'; assert.equal((await submit({ pageStart: 1, pageEnd: 1 })).status, 'complete'); assert.equal(admitted.length, 2);
  const reviewed = await runtime.call('materials.visual.explanation.review', { documentId: 'book', noteId: firstNote.id, status: 'verified', text: 'Human corrected explanation', indexed: true });
  assert.equal(reviewed.note.supersedes, firstNote.id); assert.equal(reviewed.note.origin, 'human-correction'); assert.equal(reviewed.note.indexed, true);
  const notes = (await runtime.call('materials.visual.explanations', { documentId: 'book', page: 1 })).notes;
  assert.equal(notes.length, 3); assert.equal(notes[0].text, 'Distinct model explanation');
  const latest = notes.find(note => note.route.model === 'vision-new');
  await runtime.call('materials.visual.explanation.review', { documentId: 'book', noteId: latest.id, status: 'rejected' });
  assert.equal((await submit({ pageStart: 1, pageEnd: 1 })).status, 'complete');
  assert.equal(admitted.length, 3, 'a rejected human review cannot be bypassed by finding its old pending ancestor in cache');
  assert.deepEqual((await runtime.storage.read()).sources, originalSources);
  assert.equal(first.capabilities.pauseMode, 'unsupported'); assert.equal(first.capabilities.recoveryMode, 'none');
});
test('invalid image selection and absent model fail before Job admission, preserving material data', async t => {
  const { runtime, services, submit } = await setup(t);
  await assert.rejects(submit({ blockIds: ['foreign'] }), /outside/);
  await assert.rejects(runtime.call('materials.visual.explain', { documentId: 'book' }), /视觉模型/);
  services.jobModelHost.ctx.llm.resolveModelInfo = async () => ({ inputModalities: ['text'] });
  await assert.rejects(submit({}), /图像输入/);
  assert.equal(runtime.work.jobs.size, 0);
  assert.equal((await runtime.storage.read()).documents[0].versions[0].visual.status, 'complete');
});
test('cancellation preserves completed notes and stops the next call; retry reuses the completed group', async t => {
  const entered = Promise.withResolvers(); let calls = 0, hold = true;
  const { runtime, services } = await setup(t, async (_system, _parts, { signal }) => {
    calls++;
    if (calls === 2 && hold) { entered.resolve(); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })); signal.throwIfAborted(); }
    return '{"description":"Completed group","uncertainty":[]}';
  });
  const started = await runtime.call('materials.visual.explain', { documentId: 'book', force: true }, services); await entered.promise;
  const logicalId = runtime.work.jobs.get(started.jobId).contract.jobId;
  await runtime.call('job.control', { jobId: started.jobId, action: 'cancel' }, services);
  await until(() => runtime.work.jobs.get(started.jobId).status === 'cancelled', 'cancel explanation');
  assert.equal((await runtime.call('materials.visual.explanations', { documentId: 'book' })).notes.length, 1);
  hold = false; await runtime.call('job.control', { jobId: started.jobId, action: 'retry' }, services);
  await until(() => [...runtime.work.jobs.values()].some(job => job.contract.jobId === logicalId && job.status === 'complete'), 'retry explanation');
  assert.equal((await runtime.call('materials.visual.explanations', { documentId: 'book' })).notes.length, 2); assert.equal(calls, 3);
});
test('a provider failure leaves saved material available and performs no automatic retry loop', async t => {
  let calls = 0;
  const { runtime, submit } = await setup(t, async () => { calls++; throw Object.assign(new Error('Fixture credential unavailable'), { code: 'MISSING_CREDENTIAL' }); });
  const state = await runtime.storage.read();
  const job = await submit({ pageStart: 1, pageEnd: 1 });
  assert.equal(job.status, 'failed'); assert.equal(calls, 1);
  assert.deepEqual((await runtime.storage.read()).sources, state.sources);
  assert.equal((await runtime.call('materials.visual.explanations', { documentId: 'book' })).notes.length, 0);
});
test('context/manifest and route are fingerprinted; malformed replies are never saved as valid notes', async t => {
  const { root, runtime, manifest } = await setup(t);
  const before = await planVisualExplanations(root, await runtime.storage.read(), { documentId: 'book' }, { provider: 'p', model: 'm' });
  const changedManifest = { ...manifest, revision: 'r2', pages: manifest.pages.map(page => ({ ...page, text: 'Changed authoritative OCR context' })) };
  const visual = await saveManifest(root, changedManifest);
  await runtime.storage.update(state => { state.documents[0].versions.push({ revision: 'r2', sourceIds: [], visual }); state.documents[0].currentRevision = 'r2'; });
  const after = await planVisualExplanations(root, await runtime.storage.read(), { documentId: 'book' }, { provider: 'p', model: 'm' });
  assert.notEqual(before.groups[0].fingerprint, after.groups[0].fingerprint);
  for (const value of ['caption only', '{"description":"","uncertainty":[]}', '{"description":"invented"}']) assert.throws(() => decodeVisualExplanation(value));
});
