/* global document */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, rgb } from 'pdf-lib';
import { createStudyRuntime } from '../lib/runtime/builtins.js';
import { importVisualPdf } from '../lib/contexts/materials/visual-import.js';
import { prepareVisualCardEvidence } from '../lib/contexts/materials/visual-card-evidence.js';
import { createPreviewServer, previewCall } from '../scripts/preview-server.mjs';
import { buildPreview } from '../scripts/build.mjs';
import { launchChromium } from '../scripts/qa/browser.mjs';

// Explicit UI fixture: the parser output and stored questions below are synthetic.
// Actual native model generation/publication is exercised separately by scanned-smoke --questions.
test('original evidence renders before answering in all five kinds, written/oral exam and wrong-book; zoom and original page work', { timeout: 300000 }, async t => {
  const folder = await mkdtemp(join(tmpdir(), 'scanned-browser-')), root = join(folder, 'library'), home = join(folder, 'home');
  const previousHome = process.env.DSH_HOME; process.env.DSH_HOME = home;
  const runtime = createStudyRuntime(root); let browser, server;
  t.after(async () => { await browser?.close(); await server?.close(); await runtime.dispose(); if (previousHome === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previousHome; await rm(folder, { recursive: true, force: true }); });
  const pdf = await PDFDocument.create(), page = pdf.addPage([300, 400]);
  page.drawCircle({ x: 100, y: 260, size: 40, color: rgb(0.8, 0, 0) });
  page.drawRectangle({ x: 160, y: 100, width: 80, height: 100, color: rgb(0, 0.2, 0.8) });
  await mkdir(root, { recursive: true }); const input = join(root, 'drawing.pdf'); await writeFile(input, await pdf.save());
  const imported = await importVisualPdf({ root, path: input, name: 'drawing.pdf', read: () => runtime.storage.read(), update: fn => runtime.storage.update(fn),
    parse: async () => ({ pages: [{ page_idx: 0, blocks: [{ type: 'image', bbox: [0, 0, 1, 1], content: '' }] }] }) });
  const current = await runtime.call('materials.visual.page', { documentId: imported.documentId, page: 1 });
  const evidence = await prepareVisualCardEvidence(root, await runtime.storage.read(), { documentId: imported.documentId, blockIds: [current.page.blocks.find(block => block.assetId).id] });
  const citations = evidence.map(item => item.citation);
  await runtime.storage.update(state => {
    state.decks = ['flashcard', 'quiz', 'multi', 'open', 'cloze'].map(kind => ({ id: kind, title: `UI fixture ${kind}`, course: 'Evidence UI', cards: [{
      id: `card-${kind}`, kind, topic: 'Image evidence', prompt: kind === 'cloze' ? '图中蓝色器件属于{{b1}}。' : '观察原图，指出图中的蓝色器件。',
      answer: 'REFERENCE-ANSWER-SECRET', explanation: 'MODEL-EXPLANATION-SECRET', citations: [], visualCitations: citations,
      ...(kind === 'quiz' || kind === 'multi' ? { options: [{ id: 'a', text: '选项 A', correct: true }, { id: 'b', text: '选项 B', correct: kind === 'multi' }, { id: 'c', text: '选项 C', correct: false }] } : {}),
      ...(kind === 'cloze' ? { cloze: { text: '图中蓝色器件属于{{b1}}。', answers: [{ id: 'b1', value: 'REFERENCE-ANSWER-SECRET', accept: [] }] } } : {}),
    }] }));
  });
  const distDir = join(folder, 'dist'); await buildPreview({ outdir: distDir });
  server = await createPreviewServer({ libraryRoot: root, home, port: 0, model: null, distDir });
  browser = await launchChromium(); const browserPage = await browser.newPage({ viewport: { width: 1280, height: 900 } }), errors = [];
  browserPage.on('pageerror', error => errors.push(error.message));
  browserPage.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  const shots = process.env.STUDYHUB_SHOTS; if (shots) await mkdir(shots, { recursive: true });
  const visibleEvidence = async label => {
    const image = browserPage.locator('[aria-label="题目图片证据"] img').first(); await image.waitFor();
    await image.scrollIntoViewIfNeeded(); await browserPage.waitForFunction(() => [...document.querySelectorAll('[aria-label="题目图片证据"] img')].some(image => image.naturalWidth > 100));
    const text = await browserPage.locator('.study-app').innerText(); assert.ok(!text.includes('REFERENCE-ANSWER-SECRET') && !text.includes('MODEL-EXPLANATION-SECRET'), `${label}: no answer/explanation before answering`);
    if (shots) await browserPage.screenshot({ path: join(shots, `${label}.png`) });
  };
  for (const kind of ['flashcard', 'quiz', 'multi', 'open', 'cloze']) {
    await previewCall(server, 'review.start', { mode: 'path', scope: [{ deckId: kind }], fresh: true });
    await browserPage.goto(server.url); await browserPage.locator('[data-usage="nav.resume"]').first().click();
    await visibleEvidence(kind);
    const snapshot = await previewCall(server, 'snapshot'), run = await previewCall(server, 'review.get', { runId: snapshot.lastRun.id });
    assert.equal(run.card.visualCitations[0].imageHash, citations[0].imageHash); assert.equal(run.card.answer, undefined);
    if (kind === 'flashcard') {
      await browserPage.locator('[aria-label="题目图片证据"] figure button').first().click();
      await browserPage.getByRole('dialog').getByRole('img').first().waitFor(); await browserPage.keyboard.press('Escape');
      await browserPage.getByRole('button', { name: '翻面查看答案', exact: true }).click();
      await browserPage.getByText('REFERENCE-ANSWER-SECRET', { exact: true }).first().waitFor();
      assert.ok(await browserPage.locator('[aria-label="题目图片证据"] img').first().isVisible(), 'image remains visible on the answer side');
    }
    await browserPage.getByRole('button', { name: '定位题图原页', exact: true }).first().click();
    await browserPage.getByRole('dialog').getByRole('img').first().waitFor();
    if (shots && kind === 'flashcard') await browserPage.screenshot({ path: join(shots, 'original-page.png') });
    await previewCall(server, 'review.end', { runId: run.id });
  }
  const exam = await previewCall(server, 'review.start', { mode: 'exam', scope: [{ deckId: 'quiz' }], count: 1, fresh: true });
  await browserPage.goto(server.url); await browserPage.locator('[data-tour="nav-exam"]').click(); await visibleEvidence('written-exam');
  await previewCall(server, 'review.end', { runId: exam.id });
  const oral = await previewCall(server, 'oral.start', { scope: [{ deckId: 'open' }], count: 1 });
  await browserPage.goto(server.url); await browserPage.locator('[data-tour="nav-exam"]').click(); await browserPage.getByRole('button', { name: '口头面试', exact: true }).click(); await visibleEvidence('oral-exam');
  assert.equal(oral.entry.visualCitations[0].imageHash, citations[0].imageHash); assert.equal(oral.entry.expected, undefined);
  await previewCall(server, 'oral.submit', { runId: oral.id });
  const wrong = await previewCall(server, 'review.start', { mode: 'path', scope: [{ deckId: 'quiz' }], count: 1, fresh: true });
  await previewCall(server, 'review.answer', { runId: wrong.id, cardId: wrong.card.id, selected: ['c'] }); await previewCall(server, 'review.end', { runId: wrong.id });
  const detail = await previewCall(server, 'wrongbook.detail', { deckId: 'quiz', cardId: wrong.card.id }); assert.equal(detail.visualCitations[0].imageHash, citations[0].imageHash);
  await browserPage.goto(server.url); await browserPage.locator('[data-tour="nav-wrongbook"]').click();
  await browserPage.locator('.wb-group-toggle').first().click(); await browserPage.locator('.wb-row-toggle').first().click();
  await browserPage.locator('.wb-detail [aria-label="题目图片证据"] figure').first().scrollIntoViewIfNeeded();
  await browserPage.locator('.wb-detail [aria-label="题目图片证据"] img').first().waitFor();
  if (shots) await browserPage.screenshot({ path: join(shots, 'wrong-book.png') });
  assert.deepEqual(errors, []);
});
