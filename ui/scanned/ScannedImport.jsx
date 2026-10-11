import React, { useEffect, useState } from 'react';
import { ui, uiFormat } from '../i18n.js';
import { useStudy } from '../study-context.jsx';
import { Button, Checkbox, FileDrop, InlineMessage, Select } from '../components/index.js';
import { uploadInChunks } from '../upload.js';

export default function ScannedImport({ data, courses, onStarted }) {
  const { call, host } = useStudy();
  const [enabled, setEnabled] = useState(data?.settings?.scannedTextbooks === true), [file, setFile] = useState(null), [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const [explain, setExplain] = useState(false);
  const [parser, setParser] = useState('mineru'), [selectedModel, setSelectedModel] = useState('');
  const [visualModels, setVisualModels] = useState(null), [catalogError, setCatalogError] = useState('');
  useEffect(() => {
    if (!enabled || parser !== 'cloud') return undefined;
    let active = true; setVisualModels(null); setCatalogError('');
    call('materials.visual.models', {}).then(value => { if (active) setVisualModels(value.models); }).catch(error => { if (active) { setVisualModels([]); setCatalogError(error.message); } });
    return () => { active = false; };
  }, [call, enabled, parser, host?.modelGroups]);
  const visualKeys = new Set((visualModels || []).map(model => model.key));
  const groups = new Map();
  for (const model of visualModels || []) {
    if (!groups.has(model.provider)) groups.set(model.provider, { group: model.providerName, options: [] });
    groups.get(model.provider).options.push({ value: model.key, label: model.name });
  }
  const models = [...groups.values()];
  const toggle = async value => {
    try { await call('settings', { scannedTextbooks: value }); setEnabled(value); setMessage(''); }
    catch (error) { setMessage(error.message); }
  };
  const start = async () => {
    setBusy(true); setMessage(ui('正在上传原 PDF…'));
    try {
      const uploaded = await uploadInChunks((action, args) => call(action.replace('.upload.chunk', '.upload.append'), args), 'materials.visual', file,
        { onProgress: fraction => setMessage(uiFormat('上传原 PDF {0}%', [Math.round(fraction * 100)])) });
      const result = await call('materials.visual.import', { uploadId: uploaded, courses, title: file.name, explain, parser, ...(parser === 'cloud' ? { modelKey: selectedModel } : {}) });
      setMessage(ui('已提交图文导入任务，请在任务页查看保存、解析和校验状态')); await onStarted?.(result);
    } catch (error) { setMessage(error.message); }
    finally { setBusy(false); }
  };
  return <details className="scanned-import" style={{ margin: '12px 0' }}>
    <summary>{ui('扫描教材：保留图文')} </summary>
    <Checkbox aria-label={ui('开启扫描教材图文')} label={ui('开启扫描教材图文')} checked={enabled} disabled={busy} onChange={toggle} />
    <p>{ui(parser === 'cloud' ? '云端逐页转写需要支持图片的 DSH 模型；正文、裁图与跨页结构保留待核对状态。' : '保存原 PDF、正文、公式、表格和真实图片；不需要视觉模型。识别结果保留待核对状态。')} </p>
    {enabled && <><Select aria-label={ui('图文解析方式')} value={parser} disabled={busy} onChange={setParser} options={[{ value: 'mineru', label: ui('本地 MinerU') }, { value: 'cloud', label: ui('云端视觉模型') }]} />
      {parser === 'cloud' && <><Select aria-label={ui('云解析模型')} value={selectedModel} disabled={busy || !visualModels} onChange={setSelectedModel} options={[{ value: '', label: ui('选择支持图片的模型') }, ...models]} /><p>{ui('沿用桌面已配置模型；后台会验证图片能力，不支持时不会自动换模型。')}</p>{visualModels?.length === 0 && <InlineMessage tone="warning">{catalogError || ui('宿主尚未声明可用的图片模型。请在 DSH 模型配置中核对该模型的输入模态；已配置 API Key 不等于已启用视觉能力。')}</InlineMessage>}</>}
      <Checkbox checked={explain} disabled={busy} onChange={setExplain} label={ui('同时解释关键图（需已配置视觉模型；结果待核对）')} /><FileDrop accept={['.pdf']} multiple={false} onFiles={files => setFile(files[0])} title={ui('选择或拖入扫描教材 PDF')} />{file && <Button disabled={busy || (parser === 'cloud' && (!selectedModel || !visualKeys.has(selectedModel)))} onClick={start}>{ui('保留图文并导入：')} {file.name}</Button>}</>}
    {message && <InlineMessage>{message}</InlineMessage>}
  </details>;
}
