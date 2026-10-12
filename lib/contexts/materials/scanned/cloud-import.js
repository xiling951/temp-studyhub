import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { pdfConvertGate, holdPdfSlot } from '../../../pdf-convert-gate.js';
import { admitVisualImages, assertVisualRoute } from '../../../visual-model-content.js';
import { saveManifest } from '../visual-storage.js';
import { pdfHelper } from '../visual-parser.js';
import { buildReading } from '../visual-reading.js';
import { CLOUD_IMPORT_KIND, openCloudPersistence } from './cloud-persistence.js';
import { adaptCloudPage, renderCloudRegion } from './cloud-result.js';
import { verifyCloudPage } from './cloud-review.js';

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
    if (!previous.notPublished) {
      if (previous.legacyUnreviewed) context.output('复用已有忠实转写版本；此历史缓存没有独立自动图像核验记录，不重复调用全书 API。');
      return { refs: previous.refs, completeness: previous.legacyUnreviewed || previous.reviewRequired ? 'partial' : 'complete' };
    }
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
          view.phase = 'recognize';
          const checked = await verifyCloudPage(context, port, record, { number, rendered, images,
            update: message => { view.message = message; context.present(present(view)); } });
          view.phase = 'verify'; view.message = `校验文字与真实裁图：第 ${number} 页`; context.present(present(view));
          result = { ...await local(context, `cloud-regions:${number}`, signal => adaptCloudPage(binding.root, checked.value, { number, originalPath, renderDir: temp, signal, rendered })), fingerprint: record.fingerprint };
          result.page.automatedReview = checked.automatedReview;
          if (checked.automatedReview.status === 'model-checked' && result.page.status === 'cloud-needs-review') result.page.status = 'cloud-model-checked';
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
      const uncertainPages = pages.filter(page => page.uncertainty.length || page.blocks.some(block => block.uncertainty.length) || page.automatedReview?.status !== 'model-checked').map(page => page.page);
      const quality = { reviewRequired: uncertainPages.length > 0, humanVerified: false, pages: pages.length, assets: assets.size - 1,
        uncertainPages, automatedReview: { version: record.config.reviewVersion || 0,
          status: uncertainPages.length ? 'uncertain' : 'model-checked', checkedPages: pages.filter(page => page.automatedReview?.status === 'model-checked').length,
          repairedPages: pages.filter(page => page.automatedReview?.repairs).map(page => page.page), humanVerified: false },
        originalPageFallback: pages.flatMap(page => page.blocks.filter(block => block.quality === 'original-page-fallback').map(block => ({ page: page.page, blockId: block.id }))),
        reconstruction: 'anchored-page-order', limitations: ['自动核验不能保证所有转写正确；疑点保留真实原页', '仅明确锚点和几何支持的跨页段落自动衔接'], explanation: 'not-requested' };
      const visual = await saveManifest(binding.root, { schema: 1, documentId: record.documentId, revision: record.revision, fingerprint: record.fingerprint,
        parser: { name: 'DSH cloud vision', route: record.route, modelVersion: record.modelVersion, config: record.config }, pages, assets: [...assets.values()], reading: buildReading(pages), quality }, { signal: context.signal });
      view.phase = 'commit'; view.message = uncertainPages.length ? '保存资源包和未确认原页映射' : '保存经过自动原页核验的版本'; context.present(present(view));
      const receipt = await context.commitArtifact('cloud-version', async () => ({ visual, sources }), { publish: port.publish });
      if (record.options.explain) {
        try { await binding.submitExplain({ documentId: record.documentId, revision: record.revision }); }
        catch (error) { context.output(`图文已保存；独立图解任务未启动：${error.message.slice(0, 200)}`); }
      }
      view.phase = 'complete'; view.message = uncertainPages.length ? `已保存；${uncertainPages.length} 页疑点保留原页，未标作已确认` : '已完成忠实转写、独立原页核验与阅读整编'; context.present(present(view));
      return { refs: receipt.refs, completeness: quality.reviewRequired ? 'partial' : 'complete' };
    } finally { await rm(temp, { recursive: true, force: true }); }
  },
};
