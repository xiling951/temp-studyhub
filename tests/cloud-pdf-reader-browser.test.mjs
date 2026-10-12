/* Public synthetic PDF/text fixtures. No real model or textbook accuracy claim. */
/* global document, window, MouseEvent */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { createStudyRuntime } from '../lib/runtime/builtins.js';
import { retainPdf, storeBytes, saveManifest } from '../lib/contexts/materials/visual-storage.js';
import { buildReading } from '../lib/contexts/materials/visual-reading.js';
import { renderCloudRegion } from '../lib/contexts/materials/scanned/cloud-result.js';
import { createPreviewServer } from '../scripts/preview-server.mjs';
import { buildPreview } from '../scripts/build.mjs';
import { launchChromium } from '../scripts/qa/browser.mjs';
import { until } from './helpers/wait.mjs';

test('shared cloud reader resolves the second repeated phrase and renders the actual PDF via bounded chunks', { timeout: 180000 }, async t => {
  const folder = await mkdtemp(join(tmpdir(), 'cloud-reader-ui-')), root = join(folder, 'library'), home = join(folder, 'home');
  await mkdir(root); const runtime = createStudyRuntime(root); let browser, server;
  t.after(async () => { await browser?.close(); await server?.close(); await runtime.dispose(); await rm(folder, { recursive: true, force: true }); });
  const pdf = await PDFDocument.create(), first = pdf.addPage([300, 400]);
  const phrase = 'This repeated phrase is genuine fixture text.';
  first.drawText(phrase, { x: 15, y: 330, size: 10 }); first.drawText(phrase, { x: 15, y: 260, size: 10 });
  pdf.addPage([300, 400]).drawCircle({ x: 150, y: 200, size: 70 });
  const input = join(folder, 'input.pdf'); await writeFile(input, await pdf.save());
  const original = await retainPdf(root, input), rendered = await renderCloudRegion(root, input, 2, folder, null);
  const image = { ...await storeBytes(root, rendered.data, { mime: 'image/png', kind: 'chart' }), width: rendered.geometry.width, height: rendered.geometry.height };
  const mathProse = 'Before math $V_{DS}$ after math prose.';
  const repeated = `${phrase}\n\n${phrase}`, text = `${repeated}\n\n${mathProse}`, sourceId = 'cloud-fixture-source', documentId = 'cloud-fixture-book';
  const pages = [{ page: 1, originalPage: 1, sourceId, text, printedPage: null, blocks: [
    { id: 'p1-b0', type: 'text', text: phrase, textRange: { start: 0, end: phrase.length }, captions: [], bbox: [0.1, 0.1, 0.9, 0.3] },
    { id: 'p1-b1', type: 'text', text: phrase, textRange: { start: phrase.length + 2, end: repeated.length }, captions: [], bbox: [0.1, 0.4, 0.9, 0.6] },
    { id: 'p1-b2', type: 'text', text: mathProse, textRange: { start: repeated.length + 2, end: text.length }, captions: [], bbox: [0.1, 0.7, 0.9, 0.8] },
  ] }, { page: 2, originalPage: 2, sourceId: null, text: '', printedPage: null, blocks: [{ id: 'p2-b0', type: 'chart', text: '', captions: [], bbox: [0, 0, 1, 1], assetId: image.assetId }] }];
  const visual = await saveManifest(root, { schema: 1, documentId, revision: 'r1', fingerprint: 'fixture', pages, assets: [original, image], reading: buildReading(pages), quality: { reviewRequired: true } });
  const pureId = 'pure-image-fixture', purePdf = await PDFDocument.create(); purePdf.addPage([300, 400]).drawCircle({ x: 150, y: 200, size: 70 });
  const purePath = join(folder, 'pure.pdf'); await writeFile(purePath, await purePdf.save()); const pureOriginal = await retainPdf(root, purePath);
  const purePages = [{ page: 1, originalPage: 1, sourceId: null, text: '', printedPage: null, blocks: [{ id: 'pure-p1-b0', type: 'chart', text: '', captions: [], bbox: [0, 0, 1, 1], assetId: image.assetId }] }];
  const pureVisual = await saveManifest(root, { schema: 1, documentId: pureId, revision: 'r1', fingerprint: 'pure-fixture', pages: purePages, assets: [pureOriginal, image], reading: buildReading(purePages), quality: { reviewRequired: true } });
  await runtime.storage.update(state => {
    state.documents ||= [];
    state.settings.scannedTextbooks = true;
    state.sources.push({ id: sourceId, title: 'Cloud reader fixture', text, format: 'pdf', document: { id: documentId, materialId: documentId, materialRevision: 'r1', page: 1, originalPage: 1, totalPages: 2, format: 'pdf', bookTitle: 'Cloud reader fixture' } });
    state.documents.push({ id: documentId, title: 'Cloud reader fixture', filename: 'input.pdf', format: 'pdf', currentRevision: 'r1', versions: [{ revision: 'r1', sourceIds: [sourceId], visual }] });
    state.documents.push({ id: pureId, title: 'Pure image fixture', filename: 'pure.pdf', format: 'pdf', currentRevision: 'r1', versions: [{ revision: 'r1', sourceIds: [], visual: pureVisual }] });
  });
  const distDir = join(folder, 'dist'); await buildPreview({ outdir: distDir });
  server = await createPreviewServer({ libraryRoot: root, home, port: 0, model: null, distDir });
  browser = await launchChromium(); const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } }), errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.url().endsWith('/api/call')) { try { requests.push(request.postDataJSON()); } catch { /* non-JSON asset */ } } });
  await page.goto(server.url); await page.locator('[data-tour="nav-sources"]').first().click();
  await page.locator(`.source-doc[data-document-key*="${documentId}"] .source-main`).first().click();
  const second = page.locator('[data-visual-block="p1-b1"] [data-study-anchor-start]'); await second.waitFor();
  await second.evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
  await until(() => requests.some(request => request.action === 'materials.selection.resolve' && request.args.quote === phrase), 'mapped selection request');
  const request = requests.findLast(request => request.action === 'materials.selection.resolve' && request.args.quote === phrase);
  assert.equal(request.args.start, phrase.length + 2, JSON.stringify(request.args)); assert.equal(request.args.sourceId, sourceId); assert.equal(request.args.quote, phrase);
  await page.locator('[data-visual-block="p1-b2"] .katex').first().waitFor();
  const afterMath = page.locator('[data-visual-block="p1-b2"] [data-study-anchor-start]').last();
  await afterMath.evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
  await until(() => requests.some(request => request.action === 'materials.selection.resolve' && request.args.quote === ' after math prose.'), 'prose after rendered math uses its original offsets');
  assert.equal(requests.findLast(request => request.args.quote === ' after math prose.').args.start, text.indexOf(' after math prose.'));
  const count = requests.filter(request => request.action === 'materials.selection.resolve').length;
  await page.locator('[data-study-reflow]').evaluate(element => { const range = document.createRange(); range.selectNodeContents(element); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true })); });
  await page.getByText('请将选区缩小到同一个正文块；跨块与跨页选区尚未支持。', { exact: true }).waitFor();
  assert.equal(requests.filter(request => request.action === 'materials.selection.resolve').length, count, 'unsupported whole-reader selection never falls back to guessed offsets');
  await page.getByRole('button', { name: '原始 PDF', exact: true }).click();
  const canvas = page.locator('[aria-label="原始 PDF 分页阅读"] canvas'); await canvas.waitFor();
  await page.waitForFunction(() => document.querySelector('[aria-label="原始 PDF 分页阅读"] canvas')?.width > 0);
  await page.getByLabel('原始 PDF 页码', { exact: true }).fill('2');
  await page.waitForFunction(() => document.querySelector('[aria-label="PDF 2"]')?.width > 0);
  assert.ok(requests.some(request => request.action === 'materials.visual.chunk'));
  assert.ok(!requests.some(request => request.action === 'materials.document.bytes'), 'never ask for whole-book base64');
  assert.ok(requests.filter(request => request.action === 'materials.visual.chunk').every(request => (request.args.length || 262144) <= 262144));
  await page.goto(server.url); await page.locator('[data-tour="nav-sources"]').first().click();
  await page.getByRole('button', { name: 'Pure image fixture · 图片资料', exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.locator('.scanned-reader').waitFor();
  // UI submission fixture only; real ordinary native generation is tested separately.
  let imageRequest;
  await page.route('**/api/call', async route => {
    const payload = route.request().postDataJSON();
    if (payload.action !== 'generate') return route.fallback();
    imageRequest = payload.args;
    await route.fulfill({ json: { ok: true, value: { jobId: 'explicit-ui-fixture', status: 'running' } } });
  });
  const questionTools = dialog.getByRole('complementary', { name: '结合原图出题', exact: true });
  await questionTools.getByRole('checkbox').first().click();
  assert.equal(await questionTools.getByLabel('带图题数', { exact: true }).getAttribute('max'), '6');
  await questionTools.getByLabel('原图出题方式', { exact: true }).click();
  await page.getByRole('option', { name: '普通批量出题', exact: true }).click();
  await questionTools.getByLabel('带图题数', { exact: true }).fill('7');
  await questionTools.getByRole('button', { name: '结合所选原图生成题组', exact: true }).click();
  await until(() => imageRequest, 'ordinary image UI submission');
  assert.deepEqual(imageRequest.sourceIds, []);
  assert.deepEqual(imageRequest.visualTargets, [{ documentId: pureId, revision: 'r1', blockIds: ['pure-p1-b0'] }]);
  assert.equal(imageRequest.count, 7);
  await dialog.getByRole('button', { name: '原始 PDF', exact: true }).click();
  await dialog.locator('[aria-label="原始 PDF 分页阅读"] canvas').waitFor();
  await page.waitForFunction(() => document.querySelector('[role="dialog"] [aria-label="PDF 1"]')?.width > 0);
  assert.equal((await runtime.storage.read()).sources.length, 1, 'opening an image-only document never fabricates an OCR source');
  assert.ok(requests.some(request => request.action === 'materials.document.get' && request.args.documentId === pureId && !request.args.sourceId));
  assert.deepEqual(errors, []);
});
