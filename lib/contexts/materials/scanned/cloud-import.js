import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { isRateLimit } from '../../../rate-limit.js';
import { pdfConvertGate, holdPdfSlot } from '../../../pdf-convert-gate.js';
import { admitVisualImages, assertVisualRoute } from '../../../visual-model-content.js';
import { digest, saveManifest } from '../visual-storage.js';
import { pdfHelper } from '../visual-parser.js';
import { buildReading } from '../visual-reading.js';
import { CLOUD_IMPORT_KIND, openCloudPersistence } from './cloud-persistence.js';
import { CLOUD_PROMPT, adaptCloudPage, decodeCloudPage, renderCloudRegion } from './cloud-result.js';

const present = view => () => ({ title: view.title, stage: { code: view.phase, text: view.message },
  progress: { done: view.done, total: view.total, unit: 'page', percent: view.total ? 100 * view.done / view.total : null, segments: [] },
  detail: { visual: true, parser: 'cloud', reviewRequired: true }, legacy: { filename: view.title, done: view.done, total: view.total } });
const local = (context, key, operation) => {
  const step = context.gateway.step(key, { purpose: 'convert', feature: 'scanned-textbook', budget: null });
  return step.run(() => step.observe({ boundary: 'local-process', kind: key, sideEffect: false, modelRequest: false }, async signal => ({ value: await operation(signal) })));
};
export const cloudImportDefinition = {
  kind: CLOUD_IMPORT_KIND, version: 1, title: '云端图文解析', legacyFields: ['filename', 'done', 'total'],
  capabilities: { cancel: true, retry: true, pauseMode: 'checkpoint', recoveryMode: 'resume-checkpoint', executionModes: ['direct', 'subagent'] },
  persistence: { open: openCloudPersistence },
  async admit(context, _input, binding) { return holdPdfSlot(context, pdfConvertGate(binding.jobs)); },
  async run(context, _input, binding) {
    const port = context.persistence, record = port.record;
    const previous = await port.reconcileCommit();
    if (!previous.notPublished) return { refs: previous.refs, completeness: 'partial' };
    await assertVisualRoute(binding.hostContext, record.route, context.signal);
    const originalPath = await port.originalPath(), info = await local(context, 'cloud-metadata', signal => pdfHelper(['info', originalPath], signal));
    if (!info.pages.length || info.pages.length > 10000) throw new Error('Invalid cloud PDF page count');
    const view = { title: record.options.title || record.name, phase: 'render', message: '渲染原页', done: 0, total: info.pages.length };
    context.present(present(view));
    const saved = await port.store.load(), completed = saved.checkpoint ? (await port.readOutput(saved.checkpoint.ref)).completed : [];
    const pages = [], assets = new Map([[record.original.assetId, record.original]]);
    const renderBase = join(port.dir, 'render'); await mkdir(renderBase, { recursive: true });
    const temp = await mkdtemp(join(renderBase, 'page-'));
    try {
      for (let number = 1; number <= info.pages.length; number++) {
        context.signal.throwIfAborted();
        if (completed.length && context.pauseRequested) context.checkpoint(context.checkpointRef);
        let result;
        if (completed[number - 1]) result = await port.validatePage(completed[number - 1]);
        else {
          view.phase = 'render'; view.message = `本地渲染第 ${number} 页`; context.present(present(view));
          const rendered = await local(context, `cloud-render:${number}`, signal => renderCloudRegion(binding.root, originalPath, number, temp, null, signal));
          const images = await admitVisualImages(binding.hostContext, [rendered], context.signal);
          view.phase = 'recognize'; view.message = `云模型识别第 ${number} 页`; context.present(present(view));
          let answer;
          for (let retry = 0; ; retry++) {
            context.signal.throwIfAborted();
            const step = context.gateway.step(`cloud-recognize:${number}:${retry}`, { purpose: 'convert', feature: 'scanned-textbook', requestedEffort: 'lowest', executionMode: 'agent-preferred',
              budget: { timeoutMs: 240000, maxOutputTokens: record.config.maxOutputTokens } }, { route: record.route, labels: { stage: 'cloud-recognize', file: digest(rendered.data), part: number, retry } });
            try { answer = await step.completeContent(CLOUD_PROMPT, [{ type: 'text', text: JSON.stringify({ page: number, width: rendered.geometry.width, height: rendered.geometry.height }) }, ...images]); break; }
            catch (error) {
              if (context.signal.aborted || !isRateLimit(error) || retry >= (record.config.rateLimitRetries || 0)) throw error;
              const milliseconds = Math.min(30000, 1000 * 2 ** retry);
              view.message = `第 ${number} 页遇到限流，等待后重试 ${retry + 1}/${record.config.rateLimitRetries}`; context.present(present(view));
              const wait = context.gateway.step(`cloud-backoff:${number}:${retry}`, { purpose: 'convert', feature: 'scanned-textbook', budget: null });
              await wait.run(() => wait.observe({ boundary: 'local-wait', kind: 'wait', modelRequest: false, sideEffect: false, reason: 'provider-rate-limit' }, async signal => { await delay(milliseconds, undefined, { signal }); return { value: null }; }));
            }
          }
          const value = decodeCloudPage(answer);
          view.phase = 'verify'; view.message = `校验文字与真实裁图：第 ${number} 页`; context.present(present(view));
          result = { ...await local(context, `cloud-regions:${number}`, signal => adaptCloudPage(binding.root, value, { number, originalPath, renderDir: temp, signal, rendered })), fingerprint: record.fingerprint };
          const hash = await port.saveOutput(result); completed.push({ page: number, hash });
          await context.saveCheckpoint(await port.checkpoint(completed));
        }
        pages.push({ ...result.page, originalPage: number + (record.options.pageOffset || 0), geometry: info.pages[number - 1] });
        for (const asset of result.assets) assets.set(asset.assetId, asset);
        view.done = number; context.present(present(view));
      }
      view.phase = 'assemble'; view.message = '整编正文与原页映射'; context.present(present(view));
      const now = new Date().toISOString(), sources = pages.filter(page => page.text.trim()).map(page => {
        page.sourceId = `${record.documentId}-${record.revision}-p${page.page}`;
        return { id: page.sourceId, title: `${view.title} · p.${page.originalPage}`, text: page.text, format: 'pdf', createdAt: now, importedAt: now, courses: record.options.courses || [],
          document: { id: record.documentId, materialId: record.documentId, materialRevision: record.revision, page: page.page, originalPage: page.originalPage, totalPages: pages.length, format: 'pdf', filename: record.name, origin: 'cloud-transcription', extractionVersion: 3, bookTitle: view.title } };
      });
      const quality = { reviewRequired: true, humanVerified: false, pages: pages.length, assets: assets.size - 1,
        uncertainPages: pages.filter(page => page.uncertainty.length || page.blocks.some(block => block.uncertainty.length)).map(page => page.page),
        originalPageFallback: pages.flatMap(page => page.blocks.filter(block => block.quality === 'original-page-fallback').map(block => ({ page: page.page, blockId: block.id }))),
        reconstruction: 'page-order', limitations: ['跨页段落及续表尚未自动合并', '模型坐标与转写需人工核对'], explanation: 'not-requested' };
      const visual = await saveManifest(binding.root, { schema: 1, documentId: record.documentId, revision: record.revision, fingerprint: record.fingerprint,
        parser: { name: 'DSH cloud vision', route: record.route, modelVersion: record.modelVersion, config: record.config }, pages, assets: [...assets.values()], reading: buildReading(pages), quality }, { signal: context.signal });
      view.phase = 'commit'; view.message = '提交已校验版本（内容待核对）'; context.present(present(view));
      const receipt = await context.commitArtifact('cloud-version', async () => ({ visual, sources }), { publish: port.publish });
      if (record.options.explain) {
        try { await binding.submitExplain({ documentId: record.documentId, revision: record.revision }); }
        catch (error) { context.output(`图文已保存；独立图解任务未启动：${error.message.slice(0, 200)}`); }
      }
      view.phase = 'complete'; view.message = '云解析已保存；正文、图表与跨页结构待核对'; context.present(present(view));
      return { refs: receipt.refs, completeness: 'partial' };
    } finally { await rm(temp, { recursive: true, force: true }); }
  },
};
