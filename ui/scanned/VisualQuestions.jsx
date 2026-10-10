import React, { useState } from 'react';
import { Button, InlineMessage, Select } from '../components/index.js';

export default function VisualQuestions({ call, scope, blocks }) {
  const [selected, setSelected] = useState([]), [kind, setKind] = useState('open'), [count, setCount] = useState(3), [focus, setFocus] = useState('判断图中器件能否去除、器件作用及连接关系'), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const images = blocks.filter(block => block.assetId), blockIds = selected.filter(id => images.some(block => block.id === id));
  const submit = async () => {
    setBusy(true); setMessage('');
    try {
      await call('generation.visual.start', { ...scope, blockIds, kind, count, focus });
      setMessage('带图出题已提交。在任务页查看进度，完成后打开草稿检查并发布；未通过独立图片审阅的题目会保留为待修订草稿。');
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  if (!images.length) return null;
  return <aside aria-label="结合原图出题">
    <h3>结合原图出题</h3>
    <p>选择 1–4 张当前页原图。规划、答案准备、题干生成和独立审阅均使用原图。</p>
    {images.map(block => <label key={block.id} style={{ display: 'block' }}><input type="checkbox" checked={blockIds.includes(block.id)} disabled={busy || (!blockIds.includes(block.id) && blockIds.length >= 4)} onChange={event => setSelected(event.target.checked ? [...blockIds, block.id] : blockIds.filter(id => id !== block.id))} />{block.captions.map(item => item.text).join(' ') || `图片 ${block.id}`}</label>)}
    <label>题型 <Select value={kind} onChange={setKind} options={[['open', '开放题'], ['flashcard', '闪卡'], ['quiz', '单选'], ['multi', '多选'], ['cloze', '填空']].map(([value, label]) => ({ value, label }))} /></label>
    <label>题数 <input aria-label="带图题数" type="number" min="1" max="6" value={count} onChange={event => setCount(Number(event.target.value))} /></label>
    <label>出题要求 <textarea value={focus} maxLength={1200} rows={2} onChange={event => setFocus(event.target.value)} /></label>
    <Button disabled={busy || !blockIds.length || !focus.trim() || !Number.isInteger(count) || count < 1 || count > 6} onClick={submit}>结合所选原图生成题组</Button>
    {message && <InlineMessage>{message}</InlineMessage>}
  </aside>;
}
