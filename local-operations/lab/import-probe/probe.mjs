/* Isolated import probe.
 *
 * Calls StudyHub's REAL import code (the copy the harness loads, via the
 * node_modules junction) on a synthetic PDF and on a synthetic MinerU
 * content_list. Writes only inside D:\studyhub\lab\import-probe.
 * No learning library, no DSH, no network, no model is touched.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PDFDocument, StandardFonts } from 'pdf-lib';

import { extractPdf, importSourceFile } from './node_modules/@ericwang1358/dsh-daily-flashcard/lib/documents.js';
import { parseConvertedDocument } from './node_modules/@ericwang1358/dsh-daily-flashcard/lib/converted-document.js';

const ROOT = 'D:/studyhub/lab/import-probe';
const A4 = [595.28, 841.89];
const line = (title) => console.log(`\n${'='.repeat(72)}\n${title}\n${'='.repeat(72)}`);

/* ---------- build a 4-page probe PDF that exercises every branch ---------- */
const doc = await PDFDocument.create();
const font = await doc.embedFont(StandardFonts.Helvetica);

const p1 = doc.addPage(A4);                                  // normal page
p1.drawText('StudyHub import probe', { x: 72, y: 770, size: 18, font });
p1.drawText('This page holds a normal amount of extractable text, so the', { x: 72, y: 730, size: 11, font });
p1.drawText('extractor keeps it as one saved source record for page 1.', { x: 72, y: 712, size: 11, font });

const p2 = doc.addPage(A4);                                  // 2 chars -> dropped by the <12 rule
p2.drawText('p2', { x: 72, y: 770, size: 11, font });

const p3 = doc.addPage(A4);                                  // 32 chars -> kept but sparseText
p3.drawText('Sparse page: short caption only.', { x: 72, y: 770, size: 11, font });

const p4 = doc.addPage(A4);                                  // wide horizontal gap -> warning
p4.drawText('Left column label', { x: 60, y: 770, size: 11, font });
p4.drawText('far right column', { x: 420, y: 770, size: 11, font });

const pdfBytes = await doc.save();
const pdfPath = path.join(ROOT, 'probe.pdf');
await writeFile(pdfPath, pdfBytes);
console.log(`probe.pdf written: ${pdfBytes.length} bytes  sha256=${createHash('sha256').update(pdfBytes).digest('hex').slice(0, 16)}…`);

/* ---------- A. the real extractor ---------- */
line('A. extractPdf({ path })  — the actual return value');
const extracted = await extractPdf({ path: pdfPath, filename: 'probe.pdf' });
console.log(JSON.stringify(extracted, null, 2));

line('A2. per-page summary');
console.log('totalPages     :', extracted.totalPages);
console.log('selectedPages  :', JSON.stringify(extracted.selectedPages));
console.log('skippedPages   :', JSON.stringify(extracted.skippedPages), '  (<12 non-space chars)');
console.log('sparsePages    :', JSON.stringify(extracted.sparsePages), '  (<100 chars, kept)');
console.log('saved sources  :', extracted.sources.length);
for (const s of extracted.sources) {
  console.log(`  ${s.document.page}  id=${s.id}`);
  console.log(`      title="${s.title}"  chars=${s.text.length}  sparseText=${s.document.sparseText}`);
  console.log(`      warnings=${JSON.stringify(s.document.warnings)}`);
  console.log(`      text=${JSON.stringify(s.text)}`);
}
console.log('top-level warnings:', JSON.stringify(extracted.warnings));
console.log('notice           :', extracted.notice);

/* ---------- B. persistence + what the caller actually receives ---------- */
line('B. importSourceFile(port, {path})  — real persistence path');
const state = { sources: [] };
const port = { read: async () => state, update: async (mutate) => mutate(state) };
try {
  const imported = await importSourceFile(port, { path: pdfPath, filename: 'probe.pdf', courses: ['实验课程 · 探针'] });
  console.log('returned fields :', Object.keys(imported).join(', '));
  console.log('added           :', imported.added, ' legacyPages:', imported.legacyPages);
  console.log('sourceIds       :', JSON.stringify(imported.sourceIds));
  console.log('\n-- the shape the API/UI sees (note: no full text) --');
  console.log(JSON.stringify(imported.sources, null, 2));
  console.log('\n-- what is PERSISTED in shards/sources/*.json --');
  console.log(JSON.stringify(state.sources, null, 2));
  console.log('\nhasFullTextInApiResponse:', imported.sources.some((s) => 'text' in s));
  console.log('hasFullTextOnDisk        :', state.sources.every((s) => typeof s.text === 'string'));
} catch (error) {
  console.log('FAILED:', error.message);
  console.log(error.stack);
}

/* ---------- C. the local-model route, fed a synthetic MinerU result ---------- */
line('C. parseConvertedDocument()  — the MinerU / local-model output contract');
const mineru = [
  { type: 'text', text: '第 1 章 导论', text_level: 1, page_idx: 0 },
  { type: 'text', text: '这是正文第一段。', page_idx: 0 },
  { type: 'header', text: '页眉应当被丢弃', page_idx: 0 },
  { type: 'equation', text: '$$E = mc^2$$', page_idx: 0 },
  { type: 'text', text: '第 2 章 方法', text_level: 1, page_idx: 1 },
  { type: 'table', table_caption: ['表 1 结果'], table_body: '<table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table>', page_idx: 1 },
  { type: 'image', image_caption: ['图 1 架构'], img_path: 'images/x.jpg', page_idx: 2 },
  { type: 'list', list_items: ['要点一', '要点二'], page_idx: 2 },
  { type: 'code', code_body: 'print(1)', page_idx: 2 },
];
const mineruText = JSON.stringify(mineru);
try {
  const book = parseConvertedDocument(mineruText, { filename: 'book_content_list.json' });
  console.log(JSON.stringify(book, null, 2));
  console.log('\nchapters -> pages mapping:');
  for (const page of book.pages) {
    const chapter = page.chapter >= 0 ? `#${page.chapter} ${book.chapters[page.chapter].title}` : '(front matter, -1)';
    console.log(`  p.${page.page} -> ${chapter}`);
  }
} catch (error) {
  console.log('FAILED:', error.message);
  console.log(error.stack);
}

/* ---------- D. that converted book as real material records ---------- */
line('D. projectDocument(bytes, {format:"json"})  — converted book -> sources');
try {
  const { projectDocument } = await import('./node_modules/@ericwang1358/dsh-daily-flashcard/lib/contexts/materials/files.js');
  const bytes = Buffer.from(mineruText, 'utf8');
  const projection = await projectDocument(bytes, { format: 'json', filename: 'book_content_list.json' });
  console.log(JSON.stringify(projection, null, 2));
} catch (error) {
  console.log('FAILED:', error.message);
  console.log(error.stack);
}
