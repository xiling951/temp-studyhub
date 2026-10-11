import React, { useEffect, useRef, useState } from 'react';
import { useStudy } from '../study-context.jsx';
import { Button, InlineMessage } from '../components/index.js';
import { ui } from '../i18n.js';

export default function VisualPdf({ document, page = 1, onPage, region }) {
  const { call } = useStudy(), canvas = useRef(null), [renderer, setRenderer] = useState(null), [scale, setScale] = useState(1), [error, setError] = useState(''), [loading, setLoading] = useState(true);
  const documentId = document.documentId || document.id, revision = document.revision, assetId = document.visual.original.assetId;
  useEffect(() => {
    let current = true, opened; const stop = new AbortController();
    setRenderer(null); setError(''); setLoading(true);
    (async () => {
      const { createPeekRenderer } = await import('../document-preview/peek/renderer.js');
      if (!current) return;
      opened = await createPeekRenderer(undefined, { signal: stop.signal, visual: { call, scope: { documentId, revision }, asset: document.visual.original } });
      if (current) setRenderer(opened); else await opened.destroy();
    })().catch(error => { if (current) { setError(error.message); setLoading(false); } });
    return () => { current = false; stop.abort(); void opened?.destroy(); };
  }, [call, documentId, revision, assetId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!renderer) return undefined;
    const stop = new AbortController(), target = canvas.current; let bitmap;
    setLoading(true); setError('');
    renderer.render(page, { scale, signal: stop.signal, onReport: report => { if (report.undecoded) throw new Error('部分原页图像无法解码，请下载原 PDF 核对'); } }).then(image => {
      bitmap = image;
      if (stop.signal.aborted || !canvas.current) return;
      target.width = image.width; target.height = image.height;
      const drawing = target.getContext('2d'); drawing.drawImage(image, 0, 0);
      if (region) { drawing.strokeStyle = '#d55b15'; drawing.lineWidth = 3; drawing.strokeRect(region[0] * image.width, region[1] * image.height, (region[2] - region[0]) * image.width, (region[3] - region[1]) * image.height); }
      setLoading(false);
    }).catch(error => { if (!stop.signal.aborted) { setError(error.message); setLoading(false); } }).finally(() => { bitmap?.close(); });
    return () => { stop.abort(); bitmap?.close(); if (target) { target.width = 0; target.height = 0; } };
  }, [renderer, page, scale, region]);
  return <section aria-label={ui('原始 PDF 分页阅读')} data-study-marker="true">
    <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}><Button size="sm" disabled={page <= 1} onClick={() => onPage?.(page - 1)}>{ui('上一页')}</Button> <label>{ui('PDF 页')} <input aria-label={ui('原始 PDF 页码')} type="number" value={page} min="1" max={document.visual.pageCount} onChange={event => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 1 && value <= document.visual.pageCount) onPage?.(value); }} style={{ width: 70 }} /></label> <Button size="sm" disabled={page >= document.visual.pageCount} onClick={() => onPage?.(page + 1)}>{ui('下一页')}</Button> <label>{ui('缩放')} <input aria-label={ui('原始 PDF 缩放')} type="range" min="0.5" max="2" step="0.25" value={scale} onChange={event => setScale(Number(event.target.value))} style={{ width: 160 }} /></label></div>
    {loading && <p role="status">{ui('按需读取原 PDF…')}</p>}{error && <InlineMessage tone="error">{error}</InlineMessage>}
    <canvas ref={canvas} aria-label={`PDF ${page}`} style={{ maxWidth: '100%', height: 'auto' }} />
  </section>;
}
