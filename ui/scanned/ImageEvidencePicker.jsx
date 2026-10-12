import React, { useEffect, useState } from 'react';
import { useStudy } from '../study-context.jsx';
import { ui, uiFormat } from '../i18n.js';
import { Button, Checkbox, Dialog, InlineMessage } from '../components/index.js';
import { VisualImage } from './VisualReader.jsx';

export default function ImageEvidencePicker({ sourceIds, value, onChange, disabled = false }) {
  const { call } = useStudy();
  const [open, setOpen] = useState(false), [offset, setOffset] = useState(0), [catalog, setCatalog] = useState(null), [error, setError] = useState(''), [preview, setPreview] = useState(null);
  const [zoom, setZoom] = useState(null);
  const key = sourceIds.join('|');
  useEffect(() => { setOffset(0); setCatalog(null); setPreview(null); setZoom(null); onChange([]); }, [key, onChange]);
  useEffect(() => {
    if (!open || !sourceIds.length) return undefined;
    let active = true; setError(''); setCatalog(null);
    call('materials.visual.candidates', { sourceIds, offset, limit: 40 }).then(data => { if (active) setCatalog(data); })
      .catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [call, open, key, offset]); // eslint-disable-line react-hooks/exhaustive-deps
  const chosen = item => value.some(selected => selected.documentId === item.documentId && selected.revision === item.revision && selected.blockId === item.blockId);
  return <details onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>{ui('选择图片证据（最多四张）')}</summary>
    <p>{ui('从所选资料页选择电路图、曲线或表格。出题与独立审阅使用真实原图；分步出题只继承各步对应页的图片。')}</p>
    {error && <InlineMessage tone="error">{error}</InlineMessage>}
    {!sourceIds.length && <p>{ui('请先选择资料页。')}</p>}
    {open && sourceIds.length > 0 && !catalog && !error && <p role="status">{ui('正在读取所选页图片…')}</p>}
    {catalog && <>
      <p>{uiFormat('已选 {0} 张，所选资料中共 {1} 张可用图片', [value.length, catalog.total])}</p>
      {value.length > 0 && <Button size="sm" disabled={disabled} onClick={() => onChange([])}>{ui('清空所选图片')}</Button>}
      {catalog.items.map(item => <div key={`${item.documentId}:${item.blockId}`}>
        <Checkbox checked={chosen(item)} disabled={disabled || (!chosen(item) && value.length >= 4)}
          onChange={checked => onChange(checked ? [...value, item] : value.filter(selected => !(selected.documentId === item.documentId && selected.revision === item.revision && selected.blockId === item.blockId)))}
          label={`PDF ${item.originalPage} · ${item.caption || item.blockId}`} />
        <Button size="sm" onClick={() => setPreview(item)}>{ui('预览原图')}</Button>
      </div>)}
      <Button size="sm" disabled={offset === 0 || disabled} onClick={() => { setOffset(Math.max(0, offset - 40)); setPreview(null); setZoom(null); }}>{ui('上一组图片')}</Button>
      <Button size="sm" disabled={!catalog.hasMore || disabled} onClick={() => { setOffset(offset + 40); setPreview(null); setZoom(null); }}>{ui('下一组图片')}</Button>
    </>}
    {preview && <VisualImage scope={{ documentId: preview.documentId, revision: preview.revision }} asset={preview.asset} caption={preview.caption} onOpen={(url, title) => setZoom({ url, title })} />}
    {zoom && <Dialog title={zoom.title || ui('教材原图')} onClose={() => setZoom(null)}><img src={zoom.url} alt={zoom.title || ui('教材原图')} style={{ maxWidth: '100%', height: 'auto' }} /></Dialog>}
  </details>;
}
