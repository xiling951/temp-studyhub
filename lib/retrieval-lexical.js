/* Complement the companion's English embedding model with literal Chinese book
   terms. Ranking adds no content and remains scoped to the requested sources. */
const normalize = value => String(value || '').normalize('NFKC').toLowerCase().replace(/\s+/g, '');
export function rankBookTerms(sources, query, limit = 12) {
  const figures = [...String(query).normalize('NFKC').matchAll(/[图表]\s*\d+\s*[.．]\s*\d+/gu)].map(match => normalize(match[0]).replace('．', '.'));
  const runs = String(query).normalize('NFKC').toLowerCase().match(/[a-z][a-z0-9_-]*|[\u3400-\u9fff]{2,}/g) || [];
  if (!figures.length && !runs.some(term => /[\u3400-\u9fff]/.test(term))) return [];
  const terms = new Map();
  for (const term of runs) {
    terms.set(term, 2);
    if (/^[\u3400-\u9fff]{4,}$/.test(term)) for (let i = 0; i < term.length - 1; i++) if (!terms.has(term.slice(i, i + 2))) terms.set(term.slice(i, i + 2), 0.3);
  }
  const metadataRequested = /参考文献|索引|作者|出版|前言|目录/u.test(query);
  const candidates = sources.filter(source => (metadataRequested || source.visualIndex?.topicSearchable !== false) && (source.visualIndex || ['ocr', 'cloud-transcription'].includes(source.document?.origin)))
    .map(source => ({ source,
      text: normalize(!metadataRequested && source.visualIndex?.blocks ? source.visualIndex.blocks.filter(block => !['ref_text', 'index', 'header', 'footer', 'page_header', 'page_footer', 'page_number'].includes(block.type)).flatMap(block => [block.text, ...(block.captions || []).map(caption => caption.text)]).join('\n') : source.text),
      headings: normalize(source.visualIndex?.blocks?.filter(block => ['title', 'doc_title', 'paragraph_title'].includes(block.type)).map(block => block.text).join('\n')) }));
  const weights = [...terms].map(([term, factor]) => ({ term, weight: factor * Math.log(1 + candidates.length / (1 + candidates.filter(candidate => candidate.text.includes(term)).length)) }));
  const ranked = candidates.map(candidate => {
    const matched = weights.filter(({ term }) => candidate.text.includes(term));
    const figureMatches = figures.filter(figure => new RegExp(`${figure.replace('.', '\\.')}(?!\\d)`).test(candidate.text)).length;
    return { ...candidate, matches: matched.length, figureMatches, score: figureMatches * 100 + matched.reduce((sum, term) => sum + term.weight * (candidate.headings.includes(term.term) ? 2.5 : 1), 0) };
  }).filter(candidate => (candidate.figureMatches || candidate.matches >= 2) && candidate.score > 0).sort((a, b) => b.score - a.score || a.source.id.localeCompare(b.source.id)).slice(0, limit);
  return ranked.map(({ source, score }) => ({ sourceId: source.id, page: source.document?.page, title: source.title, text: source.text,
    score, matchedBy: 'literal-book-terms' }));
}

export function fuseBookPassages(semantic, lexical, limit) {
  if (!lexical.length) return semantic;
  const scores = new Map(), values = new Map();
  for (const [list, weight] of [[semantic, 1], [lexical, 4]]) list.forEach((passage, i) => {
    scores.set(passage.sourceId, (scores.get(passage.sourceId) || 0) + weight / (60 + i + 1));
    // Local text comes from the exact source; semantic metadata retains actual image links.
    values.set(passage.sourceId, { ...values.get(passage.sourceId), ...passage });
  });
  return [...scores].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id, score]) => ({ ...values.get(id), score }));
}
