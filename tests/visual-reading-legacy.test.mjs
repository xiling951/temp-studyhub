import test from 'node:test';
import assert from 'node:assert/strict';
import { withReading, validateReading, readingWindow, legacyPageRanges, orderedReadingBlocks } from '../lib/contexts/materials/visual-reading.js';
import { textbookOutputs } from '../lib/contexts/materials/visual-export-html.js';

const page = (number, heading, body) => {
  const text = `Repeated header\n\n${heading}\n\n${body}`;
  return { page: number, originalPage: number, printedPage: null, sourceId: `s${number}`, text,
    blocks: [{ id: `p${number}-h`, type: 'header', text: 'Repeated header', textRange: { start: 0, end: 15 }, captions: [] },
      { id: `p${number}-t`, type: 'paragraph_title', text: heading, textRange: { start: 17, end: 17 + heading.length }, captions: [] },
      { id: `p${number}-b`, type: 'text', text: body, textRange: { start: 19 + heading.length, end: text.length }, captions: [] }] };
};
test('legacy MinerU projection excludes decoration, recognizes actual chapters and preserves all original ranges', () => {
  const m = { schema: 1, pages: [page(1, '第1章 基础', 'Repeated sentence.'), page(2, '1.2 子节', 'Repeated sentence.'), page(3, '第2章 器件', 'Different literal text.')], assets: [] };
  const original = structuredClone(m), derived = withReading(m);
  assert.deepEqual(m, original); validateReading(derived);
  assert.equal(derived.reading.chapters.length, 2);
  assert.deepEqual(derived.reading.chapters.map(c => c.page), [1, 3]);
  assert.equal(derived.reading.nodes.length, 6);
  const window = readingWindow(m, { pageStart: 2, pageEnd: 3 });
  assert.equal(window.available, true); assert.equal(window.nodes.length, 4);
  assert.equal(window.nodes[1].anchors[0].sourceId, 's2');
  const wrong = structuredClone(derived); wrong.reading.nodes[3].anchors[0].sourceId = 's1'; assert.throws(() => validateReading(wrong), /Invalid/);
});
test('full-book export opens chapters without mounting the whole book, while MD/mappings retain every body block', () => {
  const m = { schema: 1, documentId: 'book', revision: 'r1', pages: Array.from({ length: 572 }, (_, i) => page(i + 1,
    i === 0 ? '第1章 基础' : i === 200 ? '第2章 器件' : `1.${i + 1} 子节`, `Literal paragraph ${i + 1}.`)), assets: [] };
  const output = textbookOutputs({ title: 'Synthetic full book' }, m, new Map());
  assert.equal(Object.keys(output.files).length, 2);
  assert.ok(output.html.includes('chapters/chapter-1.html')); assert.ok(!output.html.includes('Literal paragraph 572.'));
  assert.equal(output.mappings.nodes.length, 1144);
  for (let i = 1; i <= 572; i++) assert.ok(output.markdown.includes(`Literal paragraph ${i}.`));
  assert.ok(!output.markdown.includes('Repeated header'));
  assert.ok(output.files['chapters/chapter-2.html'].includes('Literal paragraph 572.'));
});

test('historical repeated text and reassociated captions reconstruct exact offsets without changing original pages', () => {
  const p = { page: 1, sourceId: 's1', text: 'Same\n\nFigure B\n\nFigure A\n\nSame', blocks: [
    { id: 'p1-b0', type: 'text', text: 'Same', captions: [] },
    { id: 'p1-b1', type: 'image', text: '', captions: [{ text: 'Figure A' }], assetId: 'a' },
    { id: 'p1-b2', type: 'text', text: 'Same', captions: [{ text: 'Figure B', originalBlockId: 'p1-b1' }] },
  ] };
  const original = structuredClone(p), projected = legacyPageRanges(p);
  assert.deepEqual(p, original);
  assert.deepEqual(projected.blocks[0].textRange, { start: 0, end: 4 });
  assert.deepEqual(projected.blocks[2].textRange, { start: 26, end: 30 });
  assert.throws(() => legacyPageRanges({ ...p, text: 'Different text' }), /projection mismatch/);
});

test('page-boundary joins retain both real anchors and table crops, and reject completed sentences or different headers', () => {
  const header = '<table><tr><td>Gate</td><td>n</td></tr><tr><td>1</td><td>2</td></tr>';
  const make = (n, text, type = 'text', captions = []) => ({ page: n, originalPage: n, sourceId: `s${n}`, text,
    blocks: [{ id: `p${n}-b0`, type, text, textRange: { start: 0, end: text.length }, bbox: [0.1, n % 2 ? 0.75 : 0.1, 0.9, n % 2 ? 0.9 : 0.2], captions,
      ...(type === 'table' ? { assetId: `a${n}` } : {}) }] });
  const prose = 'An actual paragraph continues across the physical page';
  const m = { schema: 1, pages: [make(1, prose), make(2, 'with its original ending.')], assets: [] };
  const joined = withReading(m); validateReading(joined);
  assert.equal(joined.reading.nodes.length, 1);
  assert.equal(joined.reading.nodes[0].text, `${prose} with its original ending.`);
  assert.deepEqual(joined.reading.nodes[0].anchors.map(a => a.sourceId), ['s1', 's2']);
  assert.equal(withReading({ ...m, pages: [make(1, prose + '.'), m.pages[1]] }).reading.nodes.length, 2);
  const tables = { ...m, pages: [make(1, header + '<tr><td>Inv</td><td>1</td></tr></table>', 'table'),
    make(2, header + '<tr><td>NAND</td><td>4/3</td></tr></table>', 'table', [{ text: '续表' }])] };
  const flow = withReading(tables), window = readingWindow(tables, { pageStart: 1, pageEnd: 2 });
  assert.equal(flow.reading.nodes.length, 1); assert.equal(window.nodes[0].segments.length, 2);
  const output = textbookOutputs({ title: 'Continued table' }, flow, new Map([['a1', 'figures/a.png'], ['a2', 'figures/b.png']]));
  assert.ok(output.html.includes('figures/a.png')); assert.ok(output.html.includes('figures/b.png'));
  assert.ok(output.html.includes('NAND')); assert.ok(output.html.includes('original.pdf#page=2'));
  assert.equal(withReading({ ...tables, pages: [tables.pages[0], make(2, '<table><tr><td>Different</td></tr></table>', 'table', [{ text: '续表' }])] }).reading.nodes.length, 2);
});

test('single-column displaced figures follow page geometry while overlapping text columns retain parser order', () => {
  const image = { id: 'p1-i', type: 'image', assetId: 'a', text: '', bbox: [0.3, 0.6, 0.7, 0.8] };
  const a = { id: 'p1-a', type: 'text', text: 'Top prose', bbox: [0.1, 0.1, 0.9, 0.2] };
  assert.deepEqual(orderedReadingBlocks({ blocks: [image, a] }).map(b => b.id), ['p1-a', 'p1-i']);
  const left = { ...a, bbox: [0.1, 0.1, 0.45, 0.8] }, right = { ...a, id: 'p1-r', bbox: [0.55, 0.1, 0.9, 0.8] };
  assert.deepEqual(orderedReadingBlocks({ blocks: [right, left] }).map(b => b.id), ['p1-r', 'p1-a']);
});
