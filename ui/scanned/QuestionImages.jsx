import React, { useEffect, useState } from 'react';
import { useStudy } from '../study-context.jsx';
import { Button, Dialog, InlineMessage } from '../components/index.js';
import { VisualImage } from './VisualReader.jsx';

function EvidenceImage({ citation, call }) {
  const scope = { documentId: citation.documentId, revision: citation.revision };
  const [asset, setAsset] = useState(null), [error, setError] = useState(''), [original, setOriginal] = useState(null), [zoom, setZoom] = useState(null);
  useEffect(() => {
    let active = true; setAsset(null); setError('');
    call('materials.visual.asset', { ...scope, assetId: citation.assetId }).then(result => {
      if (!active) return;
      if (result.asset.hash !== citation.imageHash) { setError('题图与所引用版本不一致，不能展示为有效证据'); return; }
      setAsset(result.asset);
    }).catch(error => { if (active) setError(error.message); });
    return () => { active = false; };
  }, [call, citation.documentId, citation.revision, citation.assetId, citation.imageHash]); // eslint-disable-line react-hooks/exhaustive-deps
  const locate = async () => {
    try { const result = await call('materials.visual.preview', { ...scope, page: citation.page }); setOriginal(result); }
    catch (error) { setError(error.message); }
  };
  return <div data-question-image={citation.blockId} style={{ position: 'relative', zIndex: 2 }}>
    {error && <InlineMessage tone="error">{error}</InlineMessage>}
    {asset && <VisualImage call={call} scope={scope} asset={asset} onOpen={(url, title) => setZoom({ url, title })} />}
    <Button size="sm" onClick={locate}>定位题图原页</Button>
    {original && <Dialog title={`原书 PDF 第 ${original.originalPage} 页`} onClose={() => setOriginal(null)}><VisualImage call={call} scope={scope} asset={original.asset} onOpen={(url, title) => setZoom({ url, title })} /></Dialog>}
    {zoom && <Dialog title="题目原图" onClose={() => setZoom(null)}><img src={zoom.url} alt="题目所需原图" style={{ maxWidth: '100%', height: 'auto' }} /></Dialog>}
  </div>;
}

/** Question fronts load only original assets. Model explanations, answers and source captions never enter this component. */
export default function QuestionImages({ citations }) {
  const { call } = useStudy();
  if (!citations?.length) return null;
  return <section aria-label="题目图片证据">{citations.map(ref => <EvidenceImage key={`${ref.documentId}:${ref.revision}:${ref.blockId}`} citation={ref} call={call} />)}</section>;
}
