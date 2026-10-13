import { readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { PDFDocument } from 'pdf-lib';

// Use the desktop's installed package; never write to its study library.
const installed = path.join(process.env.APPDATA, 'dsh-desktop/harness/profiles/web/node_modules/@ericwang1358/dsh-daily-flashcard');
const load = file => import(pathToFileURL(path.join(installed, file)).href);
const { extractPdf, MAX_PDF_BYTES } = await load('lib/documents.js');
const { parseConvertedDocument } = await load('lib/converted-document.js');
const { projectDocument } = await load('lib/contexts/materials/files.js');
const report = { version: JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8')).version, installed, cases: [] };
async function attempt(name, fn) {
  try { report.cases.push({ name, ok: true, result: await fn() }); }
  catch (error) { report.cases.push({ name, ok: false, message: error.message, code: error.code }); }
}
const textbookDir = 'C:/Users/Lenovo/Desktop/杂物/大三上/数集';
const textbook = path.join(textbookDir, (await readdir(textbookDir)).find(name => name.startsWith('数字集成电路') && name.endsWith('.pdf')));
report.textbook = { path: textbook, bytes: (await stat(textbook)).size };
await attempt('actual-textbook-direct-import-selected-page-200', () => extractPdf({ path: textbook, pages: [200] }));
await attempt('actual-seven-page-scan-below-size-limit', () => extractPdf({ path: 'D:/studyhub/lab/import-probe/数字集成电路-p200-206.pdf' }));
await attempt('201-pages-small-pdf-select-one-page', async () => {
  const doc = await PDFDocument.create();
  for (let i = 0; i < 201; i++) doc.addPage([100, 100]);
  const bytes = await doc.save();
  return extractPdf({ dataBase64: Buffer.from(bytes).toString('base64'), filename: '201-pages.pdf', pages: [1] });
});
await attempt('mineru-caption-plus-picture-path', async () => {
  const input = JSON.stringify([
    { type: 'text', text: '正文：晶体管开关与电路。', page_idx: 0 },
    { type: 'image', image_caption: ['图1 CMOS反相器'], img_path: 'images/critical-circuit.png', bbox: [0,0,1,1], page_idx: 0 },
    { type: 'image', image_caption: [], img_path: 'images/no-caption.png', page_idx: 1 },
  ]);
  return { parsed: parseConvertedDocument(input, { filename: 'test_content_list.json' }), projection: await projectDocument(Buffer.from(input), { format: 'json', filename: 'test_content_list.json' }) };
});
await attempt('converted-markdown-picture-reference', () => parseConvertedDocument('<!-- page: 1 -->\n正文与图注。\n\n![电路关键图](images/critical-circuit.png)\n', { filename: 'test.md' }));
report.maxPdfBytes = MAX_PDF_BYTES;
await writeFile('D:/studyhub/lab/import-probe/textbook-verification-results.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
