/* Slice a page range out of a large PDF into a small one.
 *
 * Why: StudyHub's native PDF import accepts at most 8 MB / 200 pages and checks
 * the whole file before page selection, so a 572-page / 198 MB book cannot go
 * through it. StudyHub's own message for the page limit says to split the PDF
 * first. This script does only that, using pdf-lib (a StudyHub dependency).
 * The extraction itself is done by StudyHub's own importer, not here.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { PDFDocument } from 'pdf-lib';

const [src, out, firstRaw, lastRaw] = process.argv.slice(2);
const first = Number(firstRaw);
const last = Number(lastRaw);
if (!src || !out || !Number.isInteger(first) || !Number.isInteger(last)) {
  console.error('用法: node slice.mjs <源PDF> <输出PDF> <起始页> <结束页>   (页码从 1 开始)');
  process.exit(2);
}

const bytes = await readFile(src);
const source = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
console.log(`源文件页数: ${source.getPageCount()}`);

const indices = [];
for (let page = first; page <= last; page++) {
  if (page < 1 || page > source.getPageCount()) throw new Error(`第 ${page} 页超出范围`);
  indices.push(page - 1);
}

const target = await PDFDocument.create();
for (const page of await target.copyPages(source, indices)) target.addPage(page);
const output = await target.save();
await writeFile(out, output);
console.log(`已写出: ${out}`);
console.log(`字节数: ${output.length}  页数: ${target.getPageCount()}  (原书第 ${first}-${last} 页)`);
