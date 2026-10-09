import React, { useState } from 'react';
import { Button, FileDrop, InlineMessage } from '../components/index.js';
import { uploadInChunks } from '../upload.js';

export default function ScannedImport({ call, data, courses, onStarted }) {
  const [enabled, setEnabled] = useState(data?.settings?.scannedTextbooks === true), [file, setFile] = useState(null), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [explain, setExplain] = useState(false);
  const toggle = async value => {
    try { await call('settings', { scannedTextbooks: value }); setEnabled(value); setMessage(''); }
    catch (error) { setMessage(error.message); }
  };
  const start = async () => {
    setBusy(true); setMessage('正在上传原 PDF…');
    try {
      const uploaded = await uploadInChunks((action, args) => call(action.replace('.upload.chunk', '.upload.append'), args), 'materials.visual', file,
        { onProgress: fraction => setMessage(`上传原 PDF ${Math.round(fraction * 100)}%`) });
      const result = await call('materials.visual.import', { uploadId: uploaded, courses, title: file.name, explain });
      setMessage('已提交图文导入任务，请在任务页查看保存、解析和校验状态'); await onStarted?.(result);
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  return <details className="scanned-import" style={{ margin: '12px 0' }}>
    <summary>扫描教材：保留图文</summary>
    <label><input type="checkbox" aria-label="开启扫描教材图文" checked={enabled} disabled={busy} onChange={event => toggle(event.target.checked)} />开启扫描教材图文</label>
    <p>保存原 PDF、正文、公式、表格和真实图片；不需要视觉模型。识别结果保留待核对状态。</p>
    {enabled && <><label><input type="checkbox" checked={explain} disabled={busy} onChange={event => setExplain(event.target.checked)} />同时解释关键图（需已配置视觉模型；结果待核对）</label><FileDrop accept={['.pdf']} multiple={false} onFiles={files => setFile(files[0])} title="选择或拖入扫描教材 PDF" />{file && <Button disabled={busy} onClick={start}>保留图文并导入：{file.name}</Button>}</>}
    {message && <InlineMessage>{message}</InlineMessage>}
  </details>;
}
