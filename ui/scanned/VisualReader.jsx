import React, { useEffect, useRef, useState } from 'react';
import { ui, uiFormat } from '../i18n.js';
import { useStudy } from '../study-context.jsx';
import Markdown from '../Markdown.jsx';
import { Button, Dialog, InlineMessage } from '../components/index.js';
import { readVisualAsset, downloadVisualAsset, downloadVisualArchive } from './asset.js';
import VisualTable from './VisualTable.jsx';
import VisualExplanations from './VisualExplanations.jsx';
import VisualQuestions from './VisualQuestions.jsx';

export function VisualImage({ scope, asset, caption, onOpen }) {
  const { call } = useStudy();
  const element = useRef(null), [url, setUrl] = useState(''), [error, setError] = useState('');
  useEffect(() => {
    const stop = new AbortController(); let objectUrl;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      readVisualAsset(call, scope, asset, { signal: stop.signal }).then(blob => {
        if (stop.signal.aborted) return;
        objectUrl = URL.createObjectURL(blob); setUrl(objectUrl);
      }).catch(error => { if (!stop.signal.aborted) setError(error.message); });
    }, { rootMargin: '200px' });
    observer.observe(element.current);
    return () => { stop.abort(); observer.disconnect(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [call, scope.documentId, scope.revision, asset.assetId]); // eslint-disable-line react-hooks/exhaustive-deps
  return <figure ref={element} style={{ margin: '1.2rem 0', minHeight: 40 }}>
    {error ? <InlineMessage tone="error">{error}</InlineMessage> : url ? <Button variant="quiet" onClick={() => onOpen?.(url, caption)} aria-label={uiFormat('放大{0}', [caption || ui('教材图片')])} style={{ border: 0, background: 'transparent', cursor: 'zoom-in', maxWidth: '100%' }}><img src={url} alt={caption || ui('教材原图')} width={asset.width} height={asset.height} style={{ maxWidth: '100%', height: 'auto', maxHeight: 520, objectFit: 'contain' }} /></Button> : <span role="status">{ui('图片按需加载…')} </span>}
    {caption && <figcaption><Markdown text={caption} /></figcaption>}
  </figure>;
}

export default function VisualReader({ document, initialPage = 1, page: controlledPage, onPage, reflow = false, onRendered, outlineId }) {
  const { call } = useStudy();
  const scope = { documentId: document.documentId || document.id, revision: document.revision };
  const [localPage, setLocalPage] = useState(initialPage), [value, setValue] = useState(null), [error, setError] = useState(''), [zoom, setZoom] = useState(null), [original, setOriginal] = useState(null);
  const page = controlledPage ?? localPage, setPage = onPage || setLocalPage;
  const identity = useRef(''); identity.current = `${scope.documentId}:${scope.revision}:${page}`;
  useEffect(() => {
    let active = true; setValue(null); setOriginal(null); setError('');
    call('materials.visual.page', { ...scope, page }).then(value => { if (active) { setValue(value); onRendered?.(); } }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [call, scope.documentId, scope.revision, page]); // eslint-disable-line react-hooks/exhaustive-deps
  const preview = async blockId => {
    const expected = identity.current;
    try { const value = await call('materials.visual.preview', { ...scope, page, ...(blockId ? { blockId } : {}) }); if (identity.current === expected) setOriginal(value.asset); }
    catch (error) { if (identity.current === expected) setError(error.message); }
  };
  return <section className="scanned-reader" aria-label={ui('扫描教材图文')} data-study-reflow={reflow ? 'true' : undefined} data-study-marker={reflow ? undefined : 'true'}>
    <div data-study-marker="true" style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>{ui('上一页')} </Button>
      <label>{ui('PDF 页')} <input aria-label={ui('图文 PDF 页码')} type="number" min="1" max={document.visual.pageCount} value={page} onChange={event => { const number = Number(event.target.value); if (Number.isInteger(number) && number >= 1 && number <= document.visual.pageCount) setPage(number); }} style={{ width: 75 }} /></label>
      <Button size="sm" disabled={page >= document.visual.pageCount} onClick={() => setPage(page + 1)}>{ui('下一页')} </Button>
      <Button size="sm" onClick={() => preview()}>{ui('原页对照')} </Button>
      <Button size="sm" onClick={() => downloadVisualAsset(call, scope, document.visual.original, document.filename).catch(error => setError(error.message))}>{ui('保存原 PDF')} </Button>
      <Button size="sm" onClick={() => downloadVisualArchive(call, 'materials.visual.export', scope, 'textbook.zip').catch(error => setError(error.message))}>{ui('导出图文教材')} </Button>
    </div>
    <p data-study-marker="true">{ui('图文已保存 · OCR 与图像内容待核对')} </p>
    {error && <InlineMessage tone="error">{error}</InlineMessage>}
    {!value && !error && <p role="status">{ui('加载当前页…')} </p>}
    {value && <>
      <p data-study-marker="true">{uiFormat('原书 PDF 第 {0} 页 · 印刷页码 {1}', [value.page.originalPage, value.page.printedPage || ui('未识别')])}</p>
      {!!value.page.uncertainty?.length && <div data-study-marker="true"><InlineMessage tone="warning">{ui('本页待核对：')}{value.page.uncertainty.join('；')}</InlineMessage></div>}
      {original && <aside data-study-marker="true" aria-label={ui('原页对照')}><VisualImage scope={scope} asset={original} caption={uiFormat('原书 PDF 第 {0} 页', [value.page.originalPage])} onOpen={(url, title) => setZoom({ url, title })} /></aside>}
      <div data-outline-id={outlineId}>
      {value.page.blocks.filter(block => !reflow || !['page_header', 'page_footer', 'page_number'].includes(block.type)).map(block => <article key={block.id} data-visual-block={block.id} data-study-page={page} data-study-source={value.page.sourceId || undefined}>
        {!!block.uncertainty?.length && <div data-study-marker="true"><InlineMessage tone="warning">{ui('本区域待核对：')}{block.uncertainty.join('；')}</InlineMessage></div>}
        {block.quality === 'original-page-fallback' && <p data-study-marker="true">{ui('无法确认区域坐标，以下保留完整原页供核对。')}</p>}
        {reflow && block.textRange && !['equation', 'table'].includes(block.type)
          ? <div data-study-text="true" data-study-anchor-start={block.textRange.start} data-study-anchor-end={block.textRange.end} data-study-prefix={value.page.text.slice(Math.max(0, block.textRange.start - 80), block.textRange.start)} data-study-suffix={value.page.text.slice(block.textRange.end, block.textRange.end + 80)} style={{ whiteSpace: 'pre-wrap', lineHeight: 'var(--reader-line-height, 1.8)', fontSize: 'inherit', fontWeight: block.type === 'title' ? 700 : undefined }}>{block.text}</div>
          : <div data-study-marker={reflow ? 'true' : undefined}>{block.type === 'equation' ? <Markdown text={`$$\n${block.text}\n$$`} /> : block.type === 'table' && /<table/i.test(block.text) ? <VisualTable text={block.text} /> : block.text ? <Markdown text={block.text} /> : null}</div>}
        {reflow && ['equation', 'table'].includes(block.type) && <p data-study-marker="true">{ui('公式与表格选区请切换到「原文」；这里可查看原区域。')}</p>}
        {block.assetId && <div data-study-marker="true"><VisualImage scope={scope} asset={value.assets.find(asset => asset.assetId === block.assetId)} caption={block.captions.map(caption => caption.text).join('\n')} onOpen={(url, title) => setZoom({ url, title })} /></div>}
        {!block.assetId && block.captions.map((caption, index) => <Markdown key={index} text={caption.text} />)}
        {block.bbox && <Button data-study-marker="true" size="sm" onClick={() => preview(block.id)}>{ui('对照原区域')}</Button>}
        {block.quality === 'original-page-fallback' && <Button size="sm" onClick={() => preview()}>{ui('查看未解析区域的原页')} </Button>}
      </article>)}
      </div>
      <div data-study-marker="true">
      <VisualQuestions key={`${scope.documentId}:${scope.revision}:${page}`} scope={scope} blocks={value.page.blocks} />
      <VisualExplanations scope={scope} page={page} pageCount={document.visual.pageCount} />
      </div>
    </>}
    {zoom && <Dialog title={zoom.title || ui('教材原图')} onClose={() => setZoom(null)}><Button size="sm" onClick={() => { setZoom(null); void preview(); }}>{ui('定位原页')} </Button><img src={zoom.url} alt={zoom.title || ui('教材原图')} style={{ maxWidth: '100%', height: 'auto' }} /></Dialog>}
  </section>;
}
