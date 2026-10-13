import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { modelCompletion } from '../source/lib/index.js';
import { admitVisualImages } from '../source/lib/visual-model-content.js';
import { createJobLifecycle } from '../source/lib/jobs/lifecycle.js';
import { createRuntimeWork } from '../source/lib/runtime/work.js';
import { dshJobExecutor } from '../source/lib/jobs/executor.js';
import { preparedModelHost } from '../source/lib/runtime/models.js';
export const name = 'studyhub-native-visual-gateway-probe';
export function apply(ctx) {
  ctx.inject(['attachments', 'llm', 'agents', 'jobs', 'agentPresets'], async c => {
    const result = { startedAt: new Date().toISOString(), paidModel: true, route: { provider: 'deepseek-official', model: 'deepseek-flash' } };
    let parentHandle, lifecycle;
    try {
      for (let n = 0; n < 30; n++) {
        try {
          parentHandle = await c.agents.create({ sessionId: randomUUID(), meta: { cwd: 'D:/studyhub/implementation/test-harness' }, agentOptions: result.route,
            setup: async scoped => { scoped.get('tools').restrict({ allow: [] }); await c.agentPresets.mount(scoped, 'visual-probe-jobs'); } });
          break;
        } catch (error) { if (n === 29) throw error; await new Promise(resolve => setTimeout(resolve, 500)); }
      }
      const parent = parentHandle.agent || c.agents.get(parentHandle.id);
      if (!parent) throw new Error('Native parent admission did not publish an Agent');
      const parts = [{ type: 'text', text: 'Read the attached image. Return only JSON keys code, redCircles, blueSquares. Transcribe the printed code and count the colored shapes.' }, ...await admitVisualImages(c, [{ data: await readFile('D:/studyhub/implementation/fixtures/vision-control.png'), mediaType: 'image/png', name: 'control.png' }])];
      const expected = JSON.parse(await readFile('D:/studyhub/implementation/fixtures/vision-control.expected.json', 'utf8'));
      lifecycle = createJobLifecycle('D:/studyhub/implementation/test-libraries/t08-native-gateway', createRuntimeWork());
      const complete = modelCompletion(c, () => result.route, parent.id);
      const host = preparedModelHost({ jobModelHost: { ctx: parent.ctx, sessionId: parent.id, route: result.route, complete } });
      const cancelOnly = process.env.STUDYHUB_VISUAL_PROBE_CANCEL_ONLY === '1';
      const port = lifecycle.scoped({ owner: Symbol('visual-probe'), domain: 'gateway.v1', executor: dshJobExecutor(c, parent), modelHost: host });
      result.answers = [];
      lifecycle.register(c, 'gateway.v1', { kind: 't08-native-images', version: 1, capabilities: { cancel: true, executionModes: ['direct', 'subagent'] }, run: async context => {
        for (const executionMode of cancelOnly ? ['agent-required'] : ['direct', 'agent-required']) {
          const answer = await context.gateway.step(executionMode, { purpose: 'visual-probe', feature: 'other', requestedEffort: 'default', executionMode, budget: { timeoutMs: 90000, maxOutputTokens: 256 } }).completeContent('Return only JSON based on the real image.', parts);
          const parsed = JSON.parse(answer.replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
          if (!Object.entries(expected).every(([key, value]) => parsed[key] === value)) throw new Error('Image-only information mismatch');
          result.answers.push({ executionMode, parsed });
        }
        return { refs: [] };
      } });
      const submitted = await port.submit('t08-native-images', {});
      if (cancelOnly) {
        for (let n = 0; n < 300; n++) {
          const active = port.status(submitted.jobId);
          if (active.calls.some(call => call.childId)) {
            result.admittedChildId = active.calls.find(call => call.childId).childId;
            result.cancelRequestedAt = new Date().toISOString();
            await port.control(submitted.jobId, 'cancel'); break;
          }
          if (!['queued', 'running'].includes(active.status)) throw new Error('Job settled before native child cancellation');
          if (n === 299) throw new Error('Child admission timed out');
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }
      const finished = await port.wait(submitted.jobId);
      result.status = finished.status; result.error = finished.error; result.calls = finished.calls; result.nativeExecutor = finished.runtime.attempts[0].executor;
      result.childDisposed = finished.calls.filter(call => call.childId).every(call => !c.agents.get(call.childId));
      result.ok = cancelOnly ? finished.status === 'cancelled' && finished.calls.length === 1 && finished.calls[0].status === 'cancelled' && result.childDisposed : finished.status === 'complete' && finished.calls.length === 2 && finished.calls.every(call => call.status === 'ok' && call.tokens > 0) && result.childDisposed;
    } catch (error) { result.ok = false; result.error = { code: error.code, message: error.message }; }
    finally {
      await lifecycle?.dispose(); await parentHandle?.dispose();
      result.finishedAt = new Date().toISOString();
      await writeFile(`D:/studyhub/implementation/evidence/${process.env.STUDYHUB_VISUAL_PROBE_CANCEL_ONLY === '1' ? 't08-native-cancel' : 't08-native-gateway'}.json`, JSON.stringify(result, null, 2));
    }
  });
}
