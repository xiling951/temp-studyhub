/* Actual original PDF browser acceptance; the empty OCR projection is an explicit reader fixture, not cloud recognition. */
/* global document */
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createStudyRuntime } from '../../lib/runtime/builtins.js';
import { retainPdf, saveManifest } from '../../lib/contexts/materials/visual-storage.js';
import { pdfHelper } from '../../lib/contexts/materials/visual-parser.js';
import { createPreviewServer } from '../preview-server.mjs';
import { buildPreview } from '../build.mjs';
import { launchChromium } from './browser.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url)), base = resolve(repo, '..');
const args = Object.fromEntries(process.argv.slice(2).map(value => { const at = value.indexOf('='); return [value.slice(2, at), value.slice(at + 1)]; }));
const checked = (value, folder) => { const path = resolve(value || ''); if (!path.startsWith(resolve(base, folder) + sep)) throw new Error('Use a named isolated QA directory'); return path; };
const root = checked(args.root, 'test-libraries'), home = checked(args.home, 'test-harness');
if (!args.pdf) throw new Error('--pdf is required');
const evidence = join(base, 'evidence/cloud-pdf', `reader-${Date.now()}`), distDir = join(home, 'reader-dist');
for (const folder of [root, home, evidence]) await mkdir(folder, { recursive: true });
const runtime = createStudyRuntime(root), summary = { fixture: 'original-PDF-reader-only-no-OCR', pageErrors: [], wholeBookRequests: 0, chunks: [], pages: [] };
let browser, server;
try {
  if ((await runtime.storage.read()).documents?.length) throw new Error('Use an empty isolated reader library');
  const original = await retainPdf(root, resolve(args.pdf)), info = await pdfHelper(['info', resolve(args.pdf)]);
  const documentId = `reader-original-${original.hash}`, pages = info.pages.map((geometry, index) => ({ page: index + 1, originalPage: index + 1, sourceId: null, text: '', blocks: [], geometry }));
  const visual = await saveManifest(root, { schema: 1, documentId, revision: 'reader-fixture', fingerprint: original.hash, pages, assets: [original], quality: { readerFixture: true, noRecognition: true } });
  await runtime.storage.update(state => { state.settings.scannedTextbooks = true; state.documents ||= []; state.documents.push({ id: documentId, title: '原书分页验收', filename: 'original.pdf', format: 'pdf', currentRevision: 'reader-fixture', versions: [{ revision: 'reader-fixture', sourceIds: [], visual }] }); });
  summary.original = { hash: original.hash, bytes: original.bytes, pageCount: pages.length };
  await buildPreview({ outdir: distDir }); server = await createPreviewServer({ libraryRoot: root, home, port: 0, model: null, distDir });
  browser = await launchChromium(); const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  page.on('pageerror', error => summary.pageErrors.push(error.message));
  page.on('request', request => {
    if (!request.url().endsWith('/api/call')) return;
    let value; try { value = request.postDataJSON(); } catch { return; }
    if (value.action === 'materials.document.bytes') summary.wholeBookRequests++;
    if (value.action === 'materials.visual.chunk') summary.chunks.push({ offset: value.args.offset, length: value.args.length });
  });
  await page.goto(server.url); await page.locator('[data-tour="nav-sources"]').first().click();
  await page.getByRole('button', { name: '原书分页验收 · 图片资料', exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByRole('button', { name: '原始 PDF', exact: true }).click();
  for (const number of [...new Set([1, 149, Math.ceil(pages.length / 2), pages.length].filter(number => number <= pages.length))]) {
    const started = Date.now(); await dialog.getByLabel('原始 PDF 页码', { exact: true }).fill(String(number));
    await page.waitForFunction(number => { const canvas = document.querySelector(`[role="dialog"] canvas[aria-label="PDF ${number}"]`); return canvas?.width > 0 && !document.querySelector('[aria-label="原始 PDF 分页阅读"] [role="status"]'); }, number, { timeout: 90000 });
    const geometry = await dialog.locator('canvas').evaluate(canvas => ({ width: canvas.width, height: canvas.height }));
    summary.pages.push({ number, ...geometry, ms: Date.now() - started }); await page.screenshot({ path: join(evidence, `page-${number}-private.png`) });
  }
  if (summary.pageErrors.length || summary.wholeBookRequests || !summary.chunks.length || summary.chunks.some(chunk => chunk.length > 262144)) throw new Error('Reader acceptance failed; inspect private evidence');
  summary.outcome = 'passed-original-reader';
} catch (error) { summary.outcome = 'failed'; summary.error = error.message; process.exitCode = 1; }
finally {
  await browser?.close(); await server?.close(); await runtime.dispose();
  await writeFile(join(evidence, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ evidence, outcome: summary.outcome, original: summary.original, pages: summary.pages, chunkRequests: summary.chunks.length, wholeBookRequests: summary.wholeBookRequests, pageErrors: summary.pageErrors, error: summary.error }));
}
