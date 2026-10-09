import React, { useState } from 'react';
import { Button, ConfirmDialog, InlineMessage } from '../components/index.js';
import { useStudy } from '../study-context.jsx';
import { uploadInChunks } from '../upload.js';
import { downloadVisualArchive } from './asset.js';

export default function VisualBackup({ onRestored }) {
  const { call, act } = useStudy(), [file, setFile] = useState(null), [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [confirm, setConfirm] = useState(false);
  const restore = async () => {
    setBusy(true); setConfirm(false); setMessage('上传并验证备份、资源和哈希…');
    try {
      const uploadId = await uploadInChunks((action, args) => call(action.replace('.upload.chunk', '.upload.append'), args), 'materials.visual.backup', file);
      await act('library.visualBackup.restore', { uploadId }, result => onRestored?.(result), { rethrow: true }); setMessage('完整备份已恢复'); setFile(null);
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  const exportAll = async () => {
    setBusy(true); setMessage('正在整理全部资料版本、附件和复习状态…');
    try { await downloadVisualArchive(call, 'library.visualBackup.export', {}, 'studyhub-library.zip'); setMessage('整库 ZIP 已保存'); }
    catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  return <section aria-label="含附件整库备份" style={{ margin: '24px 0' }}>
    <h3>含附件整库备份</h3><p>ZIP 包含课程、题库、SM-2 复习状态、库内原 PDF、图片和历史资料版本。外部引用的原件仍需自行保留。教材图文导出位于阅读器。</p>
    <Button disabled={busy} onClick={exportAll}>导出含附件整库 ZIP</Button>
    <label style={{ display: 'block', margin: '12px 0' }}>选择完整学习库 ZIP <input type="file" accept=".zip" disabled={busy} onChange={event => setFile(event.target.files[0] || null)} /></label>
    {file && <Button variant="danger" disabled={busy} onClick={() => setConfirm(true)}>验证并用 ZIP 替换当前学习库</Button>}
    {message && <InlineMessage>{message}</InlineMessage>}
    {confirm && <ConfirmDialog title="替换当前学习库" description="完整性验证通过后，此 ZIP 将替换当前库。请先导出当前库作为回退备份。" confirmLabel="验证并替换" onConfirm={restore} onClose={() => setConfirm(false)} />}
  </section>;
}
