/** Reading is a projection of immutable page ranges, never a second text authority. */
const fail = () => { throw new Error('Invalid visual reading anchor or structure'); };
const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;
export const readingDecoration = type => ['page_header', 'page_footer', 'page_number', 'header', 'footer'].includes(type);
export const readingHeading = type => ['title', 'paragraph_title', 'doc_title'].includes(type);
const tableHeader = text => /^\s*<table\b/i.test(text) ? (text.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/gi) || []).slice(0, 2).join('').replace(/\s+/g, '') : '';
/** Reconstruct the historical parser's exact concatenation, including captions
 * at their original owner. No substring search is used for repeated prose. */
export function legacyPageRanges(page) {
  if (page.blocks.every(block => !block.text || block.textRange)) return page;
  if (page.blocks.map(block => block.text).filter(Boolean).join('\n\n') === page.text) {
    let cursor = 0;
    return { ...page, blocks: page.blocks.map(block => {
      if (!block.text) return block;
      if (cursor) cursor += 2;
      const textRange = { start: cursor, end: cursor + block.text.length }; cursor = textRange.end;
      return { ...block, textRange };
    }) };
  }
  let text = '';
  const ranges = new Map(), captions = page.blocks.flatMap(block => (block.captions || []).map(caption => ({ ...caption, owner: caption.originalBlockId || block.id })));
  const append = value => {
    if (!value) return null;
    if (text) text += '\n\n';
    const range = { start: text.length, end: text.length + value.length }; text += value; return range;
  };
  for (const block of page.blocks) {
    ranges.set(block.id, append(block.text));
    const pending = captions.filter(caption => caption.owner === block.id && caption.text);
    while (pending.length) {
      const start = text.length + (text ? 2 : 0);
      const candidates = pending.filter(caption => page.text.slice(start, start + caption.text.length) === caption.text &&
        (start + caption.text.length === page.text.length || page.text.slice(start + caption.text.length, start + caption.text.length + 2) === '\n\n'));
      if (!candidates.length || new Set(candidates.map(caption => caption.text)).size > 1) throw new Error(`Historical caption projection mismatch on page ${page.page}`);
      const next = candidates[0]; append(next.text); pending.splice(pending.indexOf(next), 1);
    }
  }
  if (text !== page.text) throw new Error(`Historical OCR projection mismatch on page ${page.page}`);
  return { ...page, blocks: page.blocks.map(block => ({ ...block, ...(ranges.get(block.id) ? { textRange: ranges.get(block.id) } : {}) })) };
}
/** Correct displaced single-column figures using their actual page geometry.
 * Keep parser order when prose columns overlap or a block is unlocated. */
export function orderedReadingBlocks(page) {
  const body = page.blocks.filter(block => !readingDecoration(block.type) && (block.text || block.assetId));
  if (body.some(block => !Array.isArray(block.bbox))) return page.blocks;
  const prose = body.filter(block => ['text', 'paragraph_title', 'doc_title', 'title'].includes(block.type));
  if (prose.some((a, i) => prose.slice(i + 1).some(b => Math.min(a.bbox[3], b.bbox[3]) - Math.max(a.bbox[1], b.bbox[1]) > 0.02 &&
    (a.bbox[2] + 0.03 < b.bbox[0] || b.bbox[2] + 0.03 < a.bbox[0])))) return page.blocks;
  return [...page.blocks].sort((a, b) => (a.bbox?.[1] ?? 1) - (b.bbox?.[1] ?? 1) || (a.bbox?.[0] ?? 0) - (b.bbox?.[0] ?? 0));
}
export function validateReading(manifest) {
  const reading = manifest.reading;
  if (!reading) return;
  if (reading.schema !== 1 || !Array.isArray(reading.nodes) || !Array.isArray(reading.chapters) || reading.nodes.length > 100000 || reading.chapters.length > 10000) fail();
  const projectedPages = manifest.pages.map(legacyPageRanges);
  const ids = new Map(), chapters = new Set(), pages = new Map(projectedPages.map(page => [page.page, { ...page, byId: new Map(page.blocks.map(block => [block.id, block])) }]));
  const required = new Set(manifest.pages.flatMap(page => page.blocks.filter(block => !readingDecoration(block.type) && (block.text || block.assetId)).map(block => `${page.page}:${block.id}`)));
  const anchored = new Set();
  for (const chapter of reading.chapters) {
    if (!SAFE_ID.test(chapter.id) || chapters.has(chapter.id) || typeof chapter.title !== 'string' || chapter.title.length > 1000) fail();
    chapters.add(chapter.id);
  }
  for (const node of reading.nodes) {
    if (!SAFE_ID.test(node.id) || ids.has(node.id) || !chapters.has(node.chapterId) || !Array.isArray(node.anchors) || !node.anchors.length || node.anchors.length > 20) fail();
    ids.set(node.id, node);
    const text = [];
    for (const anchor of node.anchors) {
      const page = pages.get(anchor.page), block = page?.byId.get(anchor.blockId);
      if (!block || anchor.sourceId !== page.sourceId || anchor.assetId !== (block.assetId || null)) fail();
      const key = `${anchor.page}:${anchor.blockId}`;
      if (!required.has(key) || anchored.has(key) || anchor.start !== (block.textRange?.start ?? null) || anchor.end !== (block.textRange?.end ?? null)) fail();
      anchored.add(key);
      if (anchor.start !== null || anchor.end !== null) {
        if (!page.sourceId || !Number.isSafeInteger(anchor.start) || !Number.isSafeInteger(anchor.end) || anchor.start < 0 || anchor.end <= anchor.start || anchor.end > page.text.length ||
          anchor.start !== block.textRange?.start || anchor.end !== block.textRange?.end || page.text.slice(anchor.start, anchor.end) !== block.text) fail();
        text.push(block.text);
      }
    }
    const joiner = node.joiner ?? '\n\n';
    if (!['', ' ', '\n\n'].includes(joiner)) fail();
    if (node.anchors.length > 1 && (node.anchors.length !== 2 || !['text', 'table'].includes(node.type) ||
      node.anchors[1].page !== node.anchors[0].page + 1 || node.anchors.some(anchor => pages.get(anchor.page)?.byId.get(anchor.blockId)?.type !== node.type))) fail();
    if (node.text !== text.join(joiner) || node.type !== pages.get(node.anchors[0].page)?.byId.get(node.anchors[0].blockId)?.type) fail();
  }
  for (const chapter of reading.chapters) if (ids.get(chapter.nodeId)?.chapterId !== chapter.id) fail();
  if (anchored.size !== required.size) fail();
}

/** Explicit ranges are assigned by the parser; repeated strings are never located by indexOf. */
export function buildReading(pages) {
  const chapters = [], nodes = []; let chapterId = 'chapter-1';
  for (const page of pages) for (const block of orderedReadingBlocks(page)) {
    if (readingDecoration(block.type)) continue;
    if (!block.text && !block.assetId) continue;
    const nodeId = `flow-${block.id}`;
    const major = block.type === 'title' || block.type === 'doc_title' || (block.type === 'paragraph_title' &&
      (/^\s*第\s*[\d一二三四五六七八九十]+\s*[章篇部分]/u.test(block.text) || /^\s*(?:前言|译者序|出版说明|教材出版委员会|目录)\s*$/u.test(block.text)));
    if (major || !chapters.length) {
      chapterId = `chapter-${chapters.length + 1}`;
      chapters.push({ id: chapterId, title: readingHeading(block.type) ? block.text.slice(0, 1000) : '正文', nodeId, page: page.page });
    }
    nodes.push({ id: nodeId, chapterId, type: block.type, text: block.textRange ? block.text : '', anchors: [{
      page: page.page, blockId: block.id, sourceId: page.sourceId, start: block.textRange?.start ?? null, end: block.textRange?.end ?? null, assetId: block.assetId || null,
    }] });
  }
  const removed = new Set();
  for (let i = 1; i < pages.length; i++) {
    const previous = pages[i - 1], current = pages[i];
    const visible = page => orderedReadingBlocks(page).filter(block => !readingDecoration(block.type) && block.type !== 'page_footnote' && (block.text || block.assetId));
    const a = visible(previous).at(-1), b = visible(current)[0];
    if (!a || !b || !a.textRange || !b.textRange || !Array.isArray(a.bbox) || !Array.isArray(b.bbox) || a.bbox[3] < 0.7 || b.bbox[1] > 0.25) continue;
    const left = nodes.find(node => node.id === `flow-${a.id}`), right = nodes.find(node => node.id === `flow-${b.id}`);
    if (!left || !right || left.chapterId !== right.chapterId || removed.has(left.id) || removed.has(right.id) || left.anchors.length !== 1) continue;
    const paragraph = a.type === 'text' && b.type === 'text' && a.text.length >= 25 && !/[。！？.!?:：;；][”’"'）)\]]?\s*$/.test(a.text) && !/^\s*(?:[■●•]|\d+[.、])/u.test(b.text);
    const table = a.type === 'table' && b.type === 'table' && (b.captions || []).some(c => /续表/u.test(c.text)) && tableHeader(a.text) && tableHeader(a.text) === tableHeader(b.text);
    if (!paragraph && !table) continue;
    left.joiner = table ? '\n\n' : /[\u3400-\u9fff]$/.test(a.text.trim()) || /^[\u3400-\u9fff]/.test(b.text.trim()) ? '' : ' ';
    left.text = [a.text, b.text].join(left.joiner); left.anchors.push(...right.anchors);
    left.continuation = table ? 'explicit-continued-table' : 'geometry-unterminated-paragraph'; removed.add(right.id);
  }
  return { schema: 1, chapters, nodes: nodes.filter(node => !removed.has(node.id)), reconstruction: 'anchored-page-order', reviewRequired: true };
}

/** Derive a read-only projection for historical MinerU revisions without rewriting
    their source ids, manifest hashes or already-reviewed image references. */
export function withReading(manifest) {
  if (manifest.reading) return manifest;
  const pages = manifest.pages.map(legacyPageRanges);
  const projected = { ...manifest, pages, reading: { ...buildReading(pages), derived: true } };
  validateReading(projected);
  return projected;
}

export function readingWindow(manifest, { pageStart = 1, pageEnd = pageStart, chapterId } = {}) {
  manifest = withReading(manifest);
  validateReading(manifest);
  if (!Number.isSafeInteger(pageStart) || !Number.isSafeInteger(pageEnd) || pageStart < 1 || pageEnd < pageStart || pageEnd > manifest.pages.length || pageEnd - pageStart >= 10) throw new Error('Reading requests must cover 1–10 existing pages');
  const reading = manifest.reading;
  if (chapterId && !reading?.chapters.some(chapter => chapter.id === chapterId)) throw new Error('Reading chapter not found');
  return { schema: 1, available: !!reading, totalPages: manifest.pages.length, chapters: (reading?.chapters || []).slice(0, 500).map(chapter => ({ ...chapter, page: reading.nodes.find(node => node.id === chapter.nodeId)?.anchors[0].page })), chaptersTruncated: (reading?.chapters.length || 0) > 500,
    nodes: (reading?.nodes || []).filter(node => (!chapterId || node.chapterId === chapterId) && node.anchors.some(anchor => anchor.page >= pageStart && anchor.page <= pageEnd)).map(node => ({ ...node,
      segments: node.anchors.map(anchor => {
        const page = manifest.pages[anchor.page - 1], block = page.blocks.find(block => block.id === anchor.blockId);
        return { ...anchor, text: block.text, originalPage: page.originalPage, captions: block.captions || [],
          ...(anchor.assetId ? { asset: manifest.assets.find(asset => asset.assetId === anchor.assetId) } : {}),
          prefix: anchor.start === null ? '' : page.text.slice(Math.max(0, anchor.start - 80), anchor.start), suffix: anchor.end === null ? '' : page.text.slice(anchor.end, anchor.end + 80) };
      }) })),
    reconstruction: reading?.reconstruction || null, reviewRequired: manifest.quality?.reviewRequired !== false };
}
