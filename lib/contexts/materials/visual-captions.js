const numberOf = caption => caption.text.match(/图\s*(\d+[.．]\d+)/)?.[1]?.replace('．', '.');
const located = box => Array.isArray(box) && box.length === 4 && box.every(Number.isFinite) && box[0] < box[2] && box[1] < box[3];

/** Correct only an explicit multi-figure caption mix-up with a clearly closer, located image.
 * Literal OCR page text is retained separately; ambiguous and shared subfigure captions stay unchanged. */
export function associateVisualCaptions(input, page) {
  const blocks = structuredClone(input), images = blocks.filter(block => block.type === 'image' && located(block.bbox));
  const distance = (block, caption) => {
    const b = block.bbox, c = caption.bbox, gap = c[1] - b[3];
    const overlap = Math.min(b[2], c[2]) - Math.max(b[0], c[0]);
    if (gap < -0.025 || gap > 0.08 || overlap < 0.25 * Math.min(b[2] - b[0], c[2] - c[0])) return Infinity;
    return Math.max(0, gap) + 0.02 * Math.abs((b[0] + b[2]) / 2 - (c[0] + c[2]) / 2);
  };
  for (const owner of images) {
    if (new Set(owner.captions.map(numberOf).filter(Boolean)).size < 2) continue;
    for (const caption of [...owner.captions]) {
      const number = numberOf(caption); if (!number || !located(caption.bbox)) continue;
      const candidates = images.filter(block => block === owner || !block.captions.some(other => numberOf(other) && numberOf(other) !== number))
        .map(block => ({ block, score: distance(block, caption) })).filter(item => Number.isFinite(item.score)).sort((a, b) => a.score - b.score);
      const best = candidates[0];
      if (!best || best.block === owner || distance(owner, caption) - best.score < 0.02 || candidates[1] && candidates[1].score - best.score < 0.02) continue;
      owner.captions.splice(owner.captions.indexOf(caption), 1);
      best.block.captions.push({ ...caption, association: 'geometry-reassociated', originalBlockId: owner.id });
    }
  }
  for (const block of blocks) {
    const number = block.captions.map(numberOf).find(Boolean);
    delete block.figureNumber; delete block.parentId;
    if (number) { block.figureNumber = number; block.parentId = `p${page}-figure-${number}`; }
  }
  for (let i = 0; i < blocks.length; i++) if (blocks[i].figureNumber) {
    const previous = blocks[i - 1];
    if (previous?.type === 'image' && previous.captions.some(caption => /^\s*[（(]a[)）]\s*$/i.test(caption.text))) {
      previous.parentId = blocks[i].parentId; previous.figureNumber = blocks[i].figureNumber;
    }
  }
  return blocks;
}
