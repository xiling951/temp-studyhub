import MarkdownIt from 'markdown-it';
import katex from 'katex';
import { parse } from 'parse5';
import texmath from 'markdown-it-texmath';
import { validateReading, withReading, readingHeading } from './visual-reading.js';

const markdown = new MarkdownIt({ html: false }).use(texmath, { engine: katex, delimiters: 'dollars', katexOptions: { throwOnError: false, trust: false } });
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const math = value => katex.renderToString(value, { throwOnError: false, trust: false, displayMode: true });
function tableHtml(source) {
  const tags = new Set(['table', 'thead', 'tbody', 'tr', 'td', 'th']);
  const visit = node => {
    if (node.nodeName === '#text') return escape(node.value);
    if (['script', 'style', 'iframe', 'object'].includes(node.tagName)) return '';
    if (node.tagName === 'eq') return katex.renderToString((node.childNodes || []).map(node => node.value || '').join(''), { throwOnError: false, trust: false });
    const inside = (node.childNodes || []).map(visit).join('');
    if (!tags.has(node.tagName)) return inside;
    const attrs = (node.attrs || []).filter(attr => ['colspan', 'rowspan'].includes(attr.name) && /^\d{1,3}$/.test(attr.value)).map(attr => ` ${attr.name}="${attr.value}"`).join('');
    return `<${node.tagName}${attrs}>${inside}</${node.tagName}>`;
  };
  return visit(parse(source));
}

export function textbookOutputs(document, manifest, figureNames) {
  return readingOutputs(document, withReading(manifest), figureNames);
}

function readingOutputs(document, manifest, figureNames) {
  validateReading(manifest);
  const reading = manifest.reading, files = {}, md = [];
  const renderNode = (node, prefix = '') => {
    const anchor = node.anchors[0];
    const text = node.text;
    const body = text ? node.type === 'equation' ? math(text) : node.type === 'table' && /<table/i.test(text) ? tableHtml(text) : markdown.render(readingHeading(node.type) ? `## ${text}` : text) : '';
    const caution = [...new Set(node.anchors.flatMap(part => {
      const p = manifest.pages[part.page - 1], b = p.blocks.find(block => block.id === part.blockId);
      return [...(p.uncertainty || []), ...(b.uncertainty || []), ...(b.quality === 'original-page-fallback' ? ['区域坐标未确认，下图为完整原页。'] : [])];
    }))];
    const figures = node.anchors.map(part => {
      const b = manifest.pages[part.page - 1].blocks.find(block => block.id === part.blockId), file = figureNames.get(part.assetId), caption = (b.captions || []).map(c => c.text).join(' ');
      return file ? `<figure><img loading="lazy" src="${prefix}${escape(file)}" alt="${escape(caption)}"><figcaption>${markdown.render(caption)}</figcaption></figure>` : '';
    }).join('');
    const origins = node.anchors.map(part => `<a href="${prefix}original.pdf#page=${part.page}" target="_blank">原 PDF 第 ${part.page} 页 · ${escape(part.blockId)}</a>`).join(' · ');
    return `<article id="${escape(node.id)}" data-page="${anchor.page}">${caution.length ? `<p class="origin">待核对：${escape(caution.join('；'))}</p>` : ''}${body}${figures}<p class="origin">${origins}</p></article>`;
  };
  const verificationNote = manifest.quality?.automatedReview?.status === 'model-checked' ? '已完成逐页自动原图核验；原页与原图完整保留，可随时对照。' : '忠实转写候选；尚未确认的疑点与原页完整保留。';
  const wrap = (title, body, prefix = '') => `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(title)}</title><link rel="stylesheet" href="${prefix}styles/katex.min.css"><style>body{font:18px/1.8 system-ui;max-width:900px;margin:32px auto;padding:0 24px}nav{position:sticky;top:0;background:white;padding:12px;display:flex;gap:16px;flex-wrap:wrap}img{max-width:100%;height:auto}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:8px}.origin{font-size:13px;color:#666}article{margin:20px 0}.katex-display{overflow:auto}input{max-width:180px}</style><h1>${escape(title)}</h1><p>${escape(verificationNote)}</p><nav><label>字号 <input id="font" type="range" min="14" max="30" value="18"></label><label>行宽 <input id="width" type="range" min="500" max="1300" value="900"></label><button onclick="window.print()">打印</button><span>查找：Ctrl+F</span></nav>${body}<script>document.getElementById('font').oninput=e=>document.body.style.fontSize=e.target.value+'px';document.getElementById('width').oninput=e=>document.body.style.maxWidth=e.target.value+'px';</script></html>`;
  for (const chapter of reading.chapters) {
    const nodes = reading.nodes.filter(node => node.chapterId === chapter.id);
    files[`chapters/${chapter.id}.html`] = wrap(chapter.title, nodes.map(node => renderNode(node, '../')).join('\n'), '../');
  }
  for (const node of reading.nodes) {
    const anchor = node.anchors[0], block = manifest.pages[anchor.page - 1].blocks.find(block => block.id === anchor.blockId);
    md.push(`<!-- ${node.id}; PDF ${anchor.page}; block ${anchor.blockId} -->`);
    if (block.uncertainty?.length) md.push(`> 待核对：${block.uncertainty.join('；')}`);
    if (block.quality === 'original-page-fallback') md.push('> 区域坐标未确认，下图为完整原页。');
    if (node.text) md.push(readingHeading(node.type) ? `## ${node.text}` : node.type === 'equation' ? `$$\n${node.text}\n$$` : node.text);
    for (const part of node.anchors) {
      const b = manifest.pages[part.page - 1].blocks.find(block => block.id === part.blockId), file = figureNames.get(part.assetId);
      if (file) md.push(`![${(b.captions || []).map(item => item.text).join(' ').replace(/[\[\]]/g, '')}](${file})`);
    }
  }
  const large = manifest.pages.length > 30;
  const toc = `<nav>${reading.chapters.map(chapter => `<a href="${large ? `chapters/${chapter.id}.html` : `#${escape(chapter.nodeId)}`}">${escape(chapter.title)}</a>${large ? '' : ` <a href="chapters/${chapter.id}.html">按章打开</a>`}`).join(' ')}</nav>`;
  return { html: wrap(document.title, toc + (large ? '<p>请选择上面的章节开始阅读。按章打开避免一次加载整本书。</p>' : reading.nodes.map(node => renderNode(node)).join('\n'))), markdown: md.join('\n\n'), files,
    mappings: { schema: 1, documentId: manifest.documentId, revision: manifest.revision, nodes: reading.nodes.map(({ id, anchors }) => ({ id, anchors })) } };
}
