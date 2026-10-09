import React, { useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import Markdown from '../Markdown.jsx';
import { Button, Dialog, InlineMessage } from '../components/index.js';
import { readVisualAsset, downloadVisualAsset } from './asset.js';

export function VisualImage({ call, scope, asset, caption, onOpen }) {
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
    {error ? <InlineMessage tone="error">{error}</InlineMessage> : url ? <button type="button" onClick={() => onOpen?.(url, caption)} aria-label={`放大${caption || '教材图片'}`} style={{ border: 0, background: 'transparent', cursor: 'zoom-in', maxWidth: '100%' }}><img src={url} alt={caption || '教材原图'} width={asset.width} height={asset.height} style={{ maxWidth: '100%', height: 'auto', maxHeight: 520, objectFit: 'contain' }} /></button> : <span role="status">图片按需加载…</span>}
    {caption && <figcaption><Markdown text={caption} /></figcaption>}
  </figure>;
}

export default function VisualReader({ document, call, initialPage = 1 }) {
  const scope = { documentId: document.documentId || document.id, revision: document.revision };
  const [page, setPage] = useState(initialPage), [value, setValue] = useState(null), [error, setError] = useState(''), [zoom, setZoom] = useState(null), [original, setOriginal] = useState(null);
  useEffect(() => {
    let active = true; setValue(null); setOriginal(null); setError('');
    call('materials.visual.page', { ...scope, page }).then(value => { if (active) setValue(value); }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [call, scope.documentId, scope.revision, page]); // eslint-disable-line react-hooks/exhaustive-deps
  const preview = async () => {
    try { const value = await call('materials.visual.preview', { ...scope, page }); setOriginal(value.asset); }
    catch (error) { setError(error.message); }
  };
  return <section className="scanned-reader" aria-label="扫描教材图文">
    <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
      <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>上一页</Button>
      <label>PDF 页 <input aria-label="图文 PDF 页码" type="number" min="1" max={document.visual.pageCount} value={page} onChange={event => { const number = Number(event.target.value); if (Number.isInteger(number) && number >= 1 && number <= document.visual.pageCount) setPage(number); }} style={{ width: 75 }} /></label>
      <Button size="sm" disabled={page >= document.visual.pageCount} onClick={() => setPage(page + 1)}>下一页</Button>
      <Button size="sm" onClick={preview}>原页对照</Button>
      <Button size="sm" onClick={() => downloadVisualAsset(call, scope, document.visual.original, document.filename).catch(error => setError(error.message))}>保存原 PDF</Button>
    </div>
    <p>图文已保存 · OCR 与图像内容待核对 · 图像解释尚未执行</p>
    {error && <InlineMessage tone="error">{error}</InlineMessage>}
    {!value && !error && <p role="status">加载当前页…</p>}
    {value && <>
      <p>原书 PDF 第 {value.page.originalPage} 页 · 印刷页码 {value.page.printedPage || '未识别'}</p>
      {original && <aside aria-label="原页对照"><VisualImage call={call} scope={scope} asset={original} caption={`原书 PDF 第 ${value.page.originalPage} 页`} onOpen={(url, title) => setZoom({ url, title })} /></aside>}
      {value.page.blocks.map(block => <article key={block.id} data-visual-block={block.id} data-study-page={page} data-study-source={value.page.sourceId || undefined}>
        {block.type === 'equation' ? <Markdown text={`$$\n${block.text}\n$$`} /> : block.type === 'table' && /<table/i.test(block.text) ? <div className="scanned-table" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(block.text.replace(/<eq>(.*?)<\/eq>/gs, '$1'), { ALLOWED_TAGS: ['table', 'thead', 'tbody', 'tr', 'td', 'th'], ALLOWED_ATTR: ['rowspan', 'colspan'] }) }} /> : block.text ? <Markdown text={block.text} /> : null}
        {block.assetId && <VisualImage call={call} scope={scope} asset={value.assets.find(asset => asset.assetId === block.assetId)} caption={block.captions.map(caption => caption.text).join('\n')} onOpen={(url, title) => setZoom({ url, title })} />}
        {!block.assetId && block.captions.map((caption, index) => <Markdown key={index} text={caption.text} />)}
        {block.quality === 'original-page-fallback' && <Button size="sm" onClick={preview}>查看未解析区域的原页</Button>}
      </article>)}
    </>}
    {zoom && <Dialog title={zoom.title || '教材原图'} onClose={() => setZoom(null)}><Button size="sm" onClick={() => { setZoom(null); void preview(); }}>定位原页</Button><img src={zoom.url} alt={zoom.title || '教材原图'} style={{ maxWidth: '100%', height: 'auto' }} /></Dialog>}
  </section>;
}
