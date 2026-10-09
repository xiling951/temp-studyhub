import test from 'node:test';
import assert from 'node:assert/strict';
import { modelCompletion } from '../lib/index.js';
import { modelServices } from '../lib/runtime/models.js';
import { validateVisualContent, assertVisualRoute } from '../lib/visual-model-content.js';
import { withUsageSink } from '../lib/usage-scope.js';
import { createModelGateway } from '../lib/jobs/gateway.js';
import { goldenRuntimeContracts } from './fixtures/unified-runtime-contract.mjs';
const ref = { attachmentId: 'sha256:test', mediaType: 'image/png', bytes: 100, width: 20, height: 20 };
const parts = [{ type: 'text', text: 'Read the figure.' }, { type: 'image', attachment: ref }];
const route = { provider: 'test', model: 'vision' };
function fixture(stream, modalities = ['text', 'image']) {
  return { attachments: { readImage: async () => ({ data: Buffer.alloc(100) }) }, llm: {
    resolveModelInfo: async () => ({ inputModalities: modalities }),
    resolveCallConfig: async config => config,
    prepareCall: async config => ({ config, inputModalities: modalities, stream }),
    stream: () => { throw new Error('Structured calls must use the pinned prepared adapter'); },
  } };
}
const text = async function* () {
  yield { type: 'text-delta', index: 0, text: 'image answer' };
  yield { type: 'usage', usage: { inputTokens: 9, outputTokens: 3 } };
  yield { type: 'finish', reason: { kind: 'stop' } };
};
test('structured completion sends a real native image block to the pinned adapter and reports usage once', async () => {
  let request; const usages = [];
  const ctx = fixture(async function* (options) { request = options; yield* text(); });
  const complete = modelCompletion(ctx, () => route, 's');
  assert.equal(await withUsageSink({ key: 'test', sink: usage => usages.push(usage) }, () => complete.completeContent('system', parts)), 'image answer');
  assert.deepEqual(request.messages[0].content, parts);
  assert.equal(usages.length, 1);
  assert.deepEqual(usages[0], { uncachedInputTokens: 9, outputTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0 });
});
test('native content preparation keeps attachment references while retaining the ordinary text sanitizer', async () => {
  const seen = []; const raw = async (_system, prompt) => { seen.push(prompt); return 'text'; };
  raw.completeContent = async (_system, prompt) => { seen.push(prompt); return 'image'; };
  const service = modelServices({ complete: raw });
  const dirty = '![inline](data:image/png;base64,AAAA)';
  await service.complete('s', dirty); await service.completeContent('s', [{ type: 'text', text: dirty }, parts[1]]);
  assert.ok(!seen[0].includes('base64,AAAA')); assert.ok(!seen[1][0].text.includes('base64,AAAA'));
  assert.deepEqual(seen[1][1], parts[1]);
});
test('unknown/text models, placeholder-only input, oversized images and unreadable native attachments fail before dispatch', async () => {
  assert.throws(() => validateVisualContent([{ type: 'text', text: 'caption only' }]), { code: 'visual-budget-exceeded' });
  assert.throws(() => validateVisualContent([{ ...parts[1], offloaded: true }]), { code: 'visual-offloaded' });
  assert.throws(() => validateVisualContent(Array(5).fill(parts[1])), { code: 'visual-budget-exceeded' });
  assert.throws(() => validateVisualContent([{ type: 'image', attachment: { ...ref, bytes: 9 * 1024 * 1024 } }]), { code: 'visual-budget-exceeded' });
  assert.throws(() => validateVisualContent([{ type: 'image_url', image_url: 'file:///private' }]), { code: 'visual-content-invalid' });
  for (const modalities of [undefined, ['text']]) await assert.rejects(() => assertVisualRoute(fixture(text, modalities === undefined ? null : modalities), route), { code: modalities ? 'visual-model-unsupported' : 'visual-capability-unknown' });
  let sent = 0; const ctx = fixture(async function* () { sent++; yield* text(); });
  ctx.attachments.readImage = async () => { throw new Error('Attachment missing'); };
  await assert.rejects(() => modelCompletion(ctx, () => route, 's').completeContent('s', parts), /Attachment missing/); assert.equal(sent, 0);
});
test('structured provider offload/rate-limit errors keep their codes and do not return placeholder success', async () => {
  for (const [code, status] of [['IMAGE_OFFLOAD_REQUIRED', undefined], ['RATE_LIMIT', 429]]) {
    const ctx = fixture(async function* () { yield { type: 'finish', reason: { kind: 'error', failure: { code, status, message: code } } }; });
    await assert.rejects(() => modelCompletion(ctx, () => route, 's').completeContent('s', parts), error => error.code === code && error.status === status && error.modelFailure);
  }
});
test('structured calls propagate caller cancellation and timeout to the prepared stream', async () => {
  for (const cancel of [true, false]) {
    const entered = Promise.withResolvers(), controller = new AbortController();
    const ctx = fixture(async function* ({ signal }) {
      entered.resolve(); await new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
      yield { type: 'finish', reason: { kind: 'aborted' } };
    });
    const pending = modelCompletion(ctx, () => route, 's').completeContent('s', parts, { signal: controller.signal, timeoutMs: cancel ? 10000 : 30 });
    const rejected = assert.rejects(pending, error => error.name === (cancel ? 'AbortError' : 'TimeoutError'));
    await entered.promise; if (cancel) controller.abort(); await rejected;
  }
});
test('gateway assembles native child image prompt, books usage once and drains child disposal', async () => {
  let request, disposed = 0, ledgerCalls = 0;
  const parent = { id: 'parent' };
  const subagents = { getProvider: () => ({ capabilities: { toolFilter: true, agentOptions: true } }), start: async (_kind, options) => {
    request = options;
    return { id: 'child', localAgent: { session: { seq: 0, eventAt() {} } }, result: Promise.resolve({ stopReason: 'completed', output: [{ type: 'text', text: 'child answer' }] }), dispose: async () => { disposed++; } };
  } };
  const ctx = fixture(text); ctx.get = key => key === 'subagents' ? subagents : key === 'agents' ? { get: () => parent } : key === 'attachments' ? ctx.attachments : undefined;
  const record = structuredClone(goldenRuntimeContracts.running); record.calls = []; record.runtime.steps = [];
  record.capabilities.executionModes = ['direct', 'subagent'];
  const context = { jobId: record.jobId, attemptId: record.attemptId, signal: new AbortController().signal, assertCurrent() {} };
  const gateway = createModelGateway({ context, record, host: { ctx, sessionId: parent.id, route }, ledger: () => { ledgerCalls++; } });
  assert.equal(await gateway.step('child', { purpose: 'probe', feature: 'other', requestedEffort: 'default', executionMode: 'agent-required', budget: null }).completeContent('system', parts), 'child answer');
  assert.deepEqual(request.prompt, [{ type: 'text', text: 'system' }, ...parts]);
  assert.equal(disposed, 1); assert.equal(record.calls.length, 1); assert.equal(ledgerCalls, 0, 'unknown fixture usage must not fabricate a billed event');
});
