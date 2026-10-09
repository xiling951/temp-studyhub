import React, { useEffect, useState } from 'react';
import { Button, Dialog, InlineMessage } from '../components/index.js';
import VisualReader from './VisualReader.jsx';

/** Image-only textbooks are documents, never fabricated OCR sources. */
export default function ScannedOnly({ call, revision }) {
  const [items, setItems] = useState([]), [opened, setOpened] = useState(null), [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    call('materials.visual.list', {}).then(value => { if (active) setItems(value.documents); }).catch(() => {});
    return () => { active = false; };
  }, [call, revision]);
  const open = async item => {
    try { setOpened(await call('materials.document.get', { documentId: item.documentId, revision: item.revision })); }
    catch (error) { setError(error.message); }
  };
  if (!items.length) return null;
  return <section aria-label="无正文的图文教材">
    {error && <InlineMessage tone="error">{error}</InlineMessage>}
    {items.map(item => <Button key={item.documentId} onClick={() => open(item)}>{item.title} · 图片资料</Button>)}
    {opened && <Dialog title={opened.title} size="full" onClose={() => setOpened(null)}><VisualReader document={opened} call={call} /></Dialog>}
  </section>;
}
