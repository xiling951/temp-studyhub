/** Reading is a projection of immutable page ranges, never a second text authority. */
const fail = () => { throw new Error('Invalid visual reading anchor or structure'); };
const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;
export function validateReading(manifest) {
  const reading = manifest.reading;
  if (!reading) return;
  if (reading.schema !== 1 || !Array.isArray(reading.nodes) || !Array.isArray(reading.chapters) || reading.nodes.length > 100000 || reading.chapters.length > 10000) fail();
  const ids = new Map(), chapters = new Set(), pages = new Map(manifest.pages.map(page => [page.page, { ...page, byId: new Map(page.blocks.map(block => [block.id, block])) }]));
  const required = new Set(manifest.pages.flatMap(page => page.blocks.filter(block => !['page_header', 'page_footer', 'page_number'].includes(block.type) && (block.text || block.assetId)).map(block => `${page.page}:${block.id}`)));
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
    if (node.text !== text.join('\n\n') || node.type !== pages.get(node.anchors[0].page)?.byId.get(node.anchors[0].blockId)?.type) fail();
  }
  for (const chapter of reading.chapters) if (ids.get(chapter.nodeId)?.chapterId !== chapter.id) fail();
  if (anchored.size !== required.size) fail();
}

/** Explicit ranges are assigned by the parser; repeated strings are never located by indexOf. */
export function buildReading(pages) {
  const chapters = [], nodes = []; let chapterId = 'chapter-1';
  for (const page of pages) for (const block of page.blocks) {
    if (['page_header', 'page_footer', 'page_number'].includes(block.type)) continue;
    if (!block.text && !block.assetId) continue;
    const nodeId = `flow-${block.id}`;
    if (block.type === 'title' || !chapters.length) {
      chapterId = `chapter-${chapters.length + 1}`;
      chapters.push({ id: chapterId, title: block.type === 'title' ? block.text.slice(0, 1000) : '正文', nodeId });
    }
    nodes.push({ id: nodeId, chapterId, type: block.type, text: block.textRange ? block.text : '', anchors: [{
      page: page.page, blockId: block.id, sourceId: page.sourceId, start: block.textRange?.start ?? null, end: block.textRange?.end ?? null, assetId: block.assetId || null,
    }] });
  }
  return { schema: 1, chapters, nodes, reconstruction: 'page-order', reviewRequired: true };
}

export function readingWindow(manifest, { pageStart = 1, pageEnd = pageStart, chapterId } = {}) {
  validateReading(manifest);
  if (!Number.isSafeInteger(pageStart) || !Number.isSafeInteger(pageEnd) || pageStart < 1 || pageEnd < pageStart || pageEnd > manifest.pages.length || pageEnd - pageStart >= 10) throw new Error('Reading requests must cover 1–10 existing pages');
  const reading = manifest.reading;
  if (chapterId && !reading?.chapters.some(chapter => chapter.id === chapterId)) throw new Error('Reading chapter not found');
  return { schema: 1, available: !!reading, totalPages: manifest.pages.length, chapters: (reading?.chapters || []).slice(0, 500), chaptersTruncated: (reading?.chapters.length || 0) > 500,
    nodes: (reading?.nodes || []).filter(node => (!chapterId || node.chapterId === chapterId) && node.anchors.some(anchor => anchor.page >= pageStart && anchor.page <= pageEnd)),
    reconstruction: reading?.reconstruction || null, reviewRequired: true };
}
