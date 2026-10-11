import MarkdownIt from 'markdown-it';
import katex from 'katex';
import { parse } from 'parse5';
import texmath from 'markdown-it-texmath';
import { validateReading } from './visual-reading.js';

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
  if (manifest.reading) return readingOutputs(document, manifest, figureNames);
  const md = [], html = [];
  for (const page of manifest.pages) {
    md.push(`\n## 原书 PDF 第 ${page.originalPage} 页\n`);
    const blocks = [];
    for (const block of page.blocks) {
      if (block.text) {
        md.push(block.type === 'equation' ? `$$\n${block.text}\n$$` : block.text);
        blocks.push(block.type === 'equation' ? math(block.text) : block.type === 'table' && /<table/i.test(block.text) ? tableHtml(block.text) : markdown.render(block.text));
      }
      if (block.assetId && figureNames.has(block.assetId)) {
        const name = figureNames.get(block.assetId), caption = block.captions.map(item => item.text).join(' ');
        md.push(`![${caption.replace(/[\[\]]/g, '')}](${name})`);
        blocks.push(`<figure><img loading="lazy" src="${name}" alt="${escape(caption)}"><figcaption>${markdown.render(caption)}</figcaption></figure>`);
      }
    }
    html.push(`<section data-page="${page.page}" ${page.page === 1 ? '' : 'hidden'}><h2>原书 PDF 第 ${page.originalPage} 页</h2><p>印刷页码 ${escape(page.printedPage || '未识别')} · OCR/图像待核对</p><a href="original.pdf#page=${page.page}" target="_blank">打开原 PDF 对照</a>${blocks.join('\n')}</section>`);
  }
  return { markdown: md.join('\n\n'), html: `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(document.title)}</title><link rel="stylesheet" href="styles/katex.min.css"><style>body{font:18px/1.8 system-ui;max-width:1000px;margin:32px auto;padding:0 24px}nav{position:sticky;top:0;background:white;padding:12px}img{max-width:100%;max-height:800px;height:auto}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:8px}figure{margin:24px 0}figcaption{font-size:15px}select{font:inherit}</style><h1>${escape(document.title)}</h1><p>原始图文已保存；识别与解释须核对。原 PDF 与图片可离开 StudyHub 阅读。</p><nav><label>PDF 页 <select id="page">${manifest.pages.map(page => `<option value="${page.page}">${page.originalPage}</option>`).join('')}</select></label></nav>${html.join('\n')}<script>document.getElementById('page').addEventListener('change',e=>{document.querySelectorAll('section[data-page]').forEach(p=>p.hidden=p.dataset.page!==e.target.value);window.scrollTo(0,0)})</script></html>` };
}

function readingOutputs(document, manifest, figureNames) {
  validateReading(manifest);
  const reading = manifest.reading, files = {}, md = [];
  const renderNode = (node, prefix = '') => {
    const anchor = node.anchors[0], page = manifest.pages[anchor.page - 1], block = page.blocks.find(block => block.id === anchor.blockId);
    const text = node.text, name = figureNames.get(anchor.assetId), caption = (block.captions || []).map(item => item.text).join(' ');
    const body = text ? node.type === 'equation' ? math(text) : node.type === 'table' && /<table/i.test(text) ? tableHtml(text) : markdown.render(node.type === 'title' ? `## ${text}` : text) : '';
    const caution = [...(page.uncertainty || []), ...(block.uncertainty || []), ...(block.quality === 'original-page-fallback' ? ['区域坐标未确认，下图为完整原页。'] : [])];
    return `<article id="${escape(node.id)}" data-page="${anchor.page}">${caution.length ? `<p class="origin">待核对：${escape(caution.join('；'))}</p>` : ''}${body}${name ? `<figure><img loading="lazy" src="${prefix}${escape(name)}" alt="${escape(caption)}"><figcaption>${markdown.render(caption)}</figcaption></figure>` : ''}<p class="origin"><a href="${prefix}original.pdf#page=${anchor.page}" target="_blank">原 PDF 第 ${anchor.page} 页 · ${escape(block.id)}</a></p></article>`;
  };
  const wrap = (title, body, prefix = '') => `<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escape(title)}</title><link rel="stylesheet" href="${prefix}styles/katex.min.css"><style>body{font:18px/1.8 system-ui;max-width:900px;margin:32px auto;padding:0 24px}nav{position:sticky;top:0;background:white;padding:12px;display:flex;gap:16px;flex-wrap:wrap}img{max-width:100%;height:auto}table{border-collapse:collapse}td,th{border:1px solid #bbb;padding:8px}.origin{font-size:13px;color:#666}article{margin:20px 0}.katex-display{overflow:auto}input{max-width:180px}</style><h1>${escape(title)}</h1><p>忠实转写候选，正文与图表待核对；跨页段落和续表尚未自动合并。</p><nav><label>字号 <input id="font" type="range" min="14" max="30" value="18"></label><label>行宽 <input id="width" type="range" min="500" max="1300" value="900"></label><button onclick="window.print()">打印</button><span>查找：Ctrl+F</span></nav>${body}<script>document.getElementById('font').oninput=e=>document.body.style.fontSize=e.target.value+'px';document.getElementById('width').oninput=e=>document.body.style.maxWidth=e.target.value+'px';</script></html>`;
  for (const chapter of reading.chapters) {
    const nodes = reading.nodes.filter(node => node.chapterId === chapter.id);
    files[`chapters/${chapter.id}.html`] = wrap(chapter.title, nodes.map(node => renderNode(node, '../')).join('\n'), '../');
  }
  for (const node of reading.nodes) {
    const anchor = node.anchors[0], block = manifest.pages[anchor.page - 1].blocks.find(block => block.id === anchor.blockId), name = figureNames.get(anchor.assetId);
    md.push(`<!-- ${node.id}; PDF ${anchor.page}; block ${anchor.blockId} -->`);
    if (block.uncertainty?.length) md.push(`> 待核对：${block.uncertainty.join('；')}`);
    if (block.quality === 'original-page-fallback') md.push('> 区域坐标未确认，下图为完整原页。');
    if (node.text) md.push(node.type === 'title' ? `## ${node.text}` : node.type === 'equation' ? `$$\n${node.text}\n$$` : node.text);
    if (name) md.push(`![${(block.captions || []).map(item => item.text).join(' ').replace(/[\[\]]/g, '')}](${name})`);
  }
  const toc = `<nav>${reading.chapters.map(chapter => `<a href="#${escape(chapter.nodeId)}">${escape(chapter.title)}</a> <a href="chapters/${chapter.id}.html">按章打开</a>`).join(' ')}</nav>`;
  return { html: wrap(document.title, toc + reading.nodes.map(node => renderNode(node)).join('\n')), markdown: md.join('\n\n'), files,
    mappings: { schema: 1, documentId: manifest.documentId, revision: manifest.revision, nodes: reading.nodes.map(({ id, anchors }) => ({ id, anchors })) } };
}
