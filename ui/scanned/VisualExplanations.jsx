import React, { useEffect, useState } from 'react';
import { ui, uiFormat } from '../i18n.js';
import { useStudy } from '../study-context.jsx';
import Markdown from '../Markdown.jsx';
import { Button, Checkbox, InlineMessage } from '../components/index.js';
import { usePolling } from '../use-polling.js';

function Note({ note, scope, refresh }) {
  const { call } = useStudy();
  const [text, setText] = useState(note.text), [indexed, setIndexed] = useState(note.indexed === true), [editing, setEditing] = useState(false), [error, setError] = useState('');
  const review = async status => {
    try { await call('materials.visual.explanation.review', { ...scope, noteId: note.id, status, ...(editing ? { text } : {}), indexed }); setEditing(false); refresh(); }
    catch (error) { setError(error.message); }
  };
  return <article data-visual-note={note.id} style={{ borderLeft: '3px solid #999', paddingLeft: 12, margin: '16px 0' }}>
    <p>{uiFormat('图解 · {0} · {1}', [note.review === 'verified' ? ui('人工已核对') : note.review === 'rejected' ? ui('人工已否决') : ui('待人工核对'), `${note.route.provider}/${note.route.model}`])}</p>
    <Markdown text={note.text} />
    {!!note.uncertainty?.length && <p>{uiFormat('待核对：{0}', [note.uncertainty.join('; ')])}</p>}
    {editing && <label>{ui('修正图解')} <textarea aria-label={ui('修正图解')} value={text} maxLength={12000} onChange={event => setText(event.target.value)} rows={8} style={{ width: '100%' }} /></label>}
    <Checkbox checked={indexed} onChange={setIndexed} label={ui('核对通过后，允许该解释进入检索')} />
    <div style={{ display: 'flex', gap: 8 }}><Button size="sm" onClick={() => setEditing(!editing)}>{ui('修正')} </Button><Button size="sm" onClick={() => review('verified')}>{ui('核对通过')} </Button><Button size="sm" onClick={() => review('rejected')}>{ui('否决')} </Button></div>
    {error && <InlineMessage tone="error">{error}</InlineMessage>}
  </article>;
}

export default function VisualExplanations({ scope, page, pageCount }) {
  const { call } = useStudy();
  const [notes, setNotes] = useState([]), [message, setMessage] = useState(''), [job, setJob] = useState(null), [start, setStart] = useState(page), [end, setEnd] = useState(page), [revision, setRevision] = useState(0), [busy, setBusy] = useState(false);
  const refresh = () => setRevision(value => value + 1);
  useEffect(() => { setStart(page); setEnd(page); }, [page]);
  useEffect(() => {
    let active = true; setNotes([]);
    const read = async () => {
      try {
        const result = await call('materials.visual.explanations', { ...scope, page });
        if (active) { setNotes(result.notes); if (result.importExplanation?.status === 'unavailable') setMessage(uiFormat('图文已保存；图解未启动：{0}', [result.importExplanation.message])); }
      } catch (error) { if (active) setMessage(error.message); }
    };
    void read();
    return () => { active = false; };
  }, [call, scope.documentId, scope.revision, page, revision]); // eslint-disable-line react-hooks/exhaustive-deps
  usePolling(() => setRevision(value => value + 1), { intervalMs: 5000 });
  const submit = async force => {
    setBusy(true);
    try { const result = await call('materials.visual.explain', { ...scope, pageStart: start, pageEnd: end, force }); setJob(result.jobId); setMessage(ui('图解任务已提交；在任务页查看进度、错误与重试。已保存的图文可继续阅读。')); }
    catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  const superseded = new Set(notes.map(note => note.supersedes).filter(Boolean));
  const current = notes.filter(note => !superseded.has(note.id));
  return <aside aria-label={ui('图解与核对')}>
    <h3>{ui('图解与核对')} </h3><p>{ui('图文解析已完成。以下为独立模型解释，不属于教材原文；自动结果默认待核对。')} </p>
    <label>{ui('解释 PDF 页范围')} <input aria-label={ui('解释起始页')} type="number" min="1" max={pageCount} value={start} onChange={event => setStart(Number(event.target.value))} style={{ width: 75 }} />{ui('至')} <input aria-label={ui('解释结束页')} type="number" min="1" max={pageCount} value={end} onChange={event => setEnd(Number(event.target.value))} style={{ width: 75 }} /></label>
    <Button size="sm" disabled={busy} onClick={() => submit(false)}>{ui('解释所选页图片')} </Button><Button size="sm" disabled={busy} onClick={() => submit(true)}>{ui('重新解释并保留旧版')} </Button>
    {job && <Button size="sm" onClick={() => call('job.control', { jobId: job, action: 'cancel' }).then(() => setMessage(ui('正在取消；已经保存的图解保留。'))).catch(error => setMessage(error.message))}>{ui('取消本次图解')} </Button>}
    {message && <InlineMessage>{message}</InlineMessage>}
    {!current.length && <p>{ui('当前页尚无图解。')} </p>}
    {current.map(note => <Note key={note.id} note={note} scope={scope} refresh={refresh} />)}
    {!!superseded.size && <details><summary>{ui('历史解释与修正')} </summary>{notes.filter(note => superseded.has(note.id)).map(note => <div key={note.id}><p>{note.review} · {note.id}</p><Markdown text={note.text} /></div>)}</details>}
  </aside>;
}
