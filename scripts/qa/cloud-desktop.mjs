/* Explicitly authorized live Desktop verification. Adds one small PDF candidate
   to the current library; never installs plugins or reads credentials. */
/* global document */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { PDFDocument } from 'pdf-lib';
import { launchChromium } from './browser.mjs';

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
if (!option('pdf')) throw Error('Explicit --pdf is required: this probe uses the configured live model and current library');
const pdf = resolve(option('pdf')), bytes = await readFile(pdf);
const pageCount = (await PDFDocument.load(bytes)).getPageCount();
assert.ok(pageCount > 0 && pageCount <= 5 && bytes.length <= 8 * 1024 * 1024, 'Live verification is limited to five small pages');
const title = `云端导入验证样本（${pageCount}页）`;
const evidence = resolve(option('evidence-dir') || '../evidence/cloud-desktop-upgrade');
await mkdir(evidence, { recursive: true });
const result = { checkedAt: new Date().toISOString(), formalDesktop: true, pageCount, pageErrors: [], humanVerified: false };
const provider = 'qwen', model = 'qwen3.8-flash';
const inspectDocument = option('inspect-document');
let browser;
try {
  const log = await readFile('C:/Users/Lenovo/AppData/Roaming/dsh-desktop/logs/harness.log', 'utf8');
  const url = [...log.matchAll(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=\S+)/g)].at(-1)?.[1];
  assert.ok(url, 'Running Desktop endpoint required');
  browser = await launchChromium();
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => result.pageErrors.push(error.message.replace(/token=\S+/g, 'token=[redacted]')));
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.locator('.study-app').first().waitFor({ timeout: 90000 });
  const rpc = (method, payload) => page.evaluate(async ({ method, payload }) => (await (await fetch(`/api/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload }),
  })).json()).result, { method, payload });
  let sessionId;
  if (inspectDocument) {
    const sessions = await rpc('session/list', { args: { _request: {} } });
    sessionId = sessions.value.items[0]?.sessionId;
  } else {
    const created = await rpc('session/create', { args: { request: { cwd: 'D:/studyhub', agentPreset: 'study' } } });
    assert.ok(created.ok, 'Live StudyHub session admission');
    sessionId = created.value.sessionId;
  }
  assert.ok(sessionId, 'Existing live Desktop session');
  const call = async (action, args = {}) => {
    const response = await rpc('study-workspace/call', { sessionId, action, args });
    if (!response.ok) throw Error(`${action}: ${response.error?.message || 'native request failed'}`);
    return response.value;
  };
  const before = await call('snapshot');
  assert.ok(!before.jobs.some(job => ['queued', 'running', 'pausing', 'cancelling'].includes(job.status)), 'Do not contend with user tasks');
  const oldSources = new Map(before.sources.map(source => [source.id, createHash('sha256').update(source.text || '').digest('hex')]));
  const catalog = await call('materials.visual.models');
  assert.ok(catalog.models.some(item => item.provider === provider && item.id === model), 'Qwen Flash must be declared as an image model');
  if (!before.settings.scannedTextbooks) await call('settings', { scannedTextbooks: true });
  let started;
  if (inspectDocument) {
    const existing = before.jobs.find(job => job.contract.result.refs.some(ref => ref.kind === 'document' && ref.id === inspectDocument));
    assert.ok(existing, 'An actual completed native job is required for the existing candidate');
    started = { jobId: existing.id }; result.inspectedOnly = true;
  } else {
  const upload = await call('materials.visual.upload.start', { name: `${title}.pdf`, size: bytes.length });
  for (let offset = 0; offset < bytes.length; offset += 262144) await call('materials.visual.upload.append', {
    uploadId: upload.uploadId, offset, data: bytes.subarray(offset, offset + 262144).toString('base64'),
  });
  await call('materials.visual.upload.finish', { uploadId: upload.uploadId });
  started = await call('materials.visual.import', {
    uploadId: upload.uploadId, title, parser: 'cloud', modelKey: JSON.stringify([provider, model]),
  });
  }
  result.jobId = started.jobId;
  const deadline = Date.now() + 15 * 60 * 1000;
  let job;
  while (Date.now() < deadline) {
    job = (await call('snapshot')).jobs.find(item => item.id === started.jobId);
    result.job = { status: job?.status, stage: job?.stage, usage: job?.contract?.usage, error: job?.contract?.error };
    await writeFile(join(evidence, 'cloud-probe-private.json'), JSON.stringify(result, null, 2));
    if (job && !['queued', 'running', 'pausing', 'cancelling'].includes(job.status)) break;
    await new Promise(done => setTimeout(done, 1000));
  }
  assert.equal(job?.status, 'complete', job?.contract?.error?.message || job?.stage);
  const documentId = job.contract.result.refs.find(ref => ref.kind === 'document')?.id;
  const descriptor = await call('materials.document.get', { documentId });
  assert.equal(descriptor.visual.pageCount, pageCount);
  assert.equal(descriptor.visual.original.hash, createHash('sha256').update(bytes).digest('hex'));
  result.documentId = documentId;
  result.quality = descriptor.visual.quality;
  const after = await call('snapshot');
  result.oldSourceTextUnchanged = [...oldSources].every(([id, hash]) => {
    const source = after.sources.find(item => item.id === id);
    return source && createHash('sha256').update(source.text || '').digest('hex') === hash;
  });
  for (const key of ['decks', 'drafts', 'runs', 'attempts']) assert.deepEqual(after[key], before[key], `Existing ${key} preserved`);
  assert.ok(result.oldSourceTextUnchanged);
  const requests = [];
  page.on('request', request => {
    if (!request.url().endsWith('/api/study-workspace/call')) return;
    try { requests.push(request.postDataJSON().payload); } catch { /* non-JSON request */ }
  });
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: 'StudyHub', exact: true }).click();
  await page.locator('.study-app').first().waitFor();
  // Desktop mounts StudyHub's navigation in the host sidebar, outside .study-app.
  await page.getByRole('button', { name: /^资料/ }).first().click();
  await page.locator('.page-scope').getByRole('combobox').first().click();
  await page.getByRole('option', { name: '全部课程', exact: true }).click();
  await page.locator(`.source-doc[data-document-key*="${documentId}"] .source-main`).first().click();
  await page.locator('[data-study-reflow] [data-study-anchor-start]').first().waitFor();
  await page.screenshot({ path: join(evidence, 'cloud-reading-private.png') });
  await page.getByRole('button', { name: '原始 PDF', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="原始 PDF 分页阅读"] canvas')?.width > 0);
  await page.getByLabel('原始 PDF 页码', { exact: true }).fill(String(pageCount));
  await page.waitForFunction(number => document.querySelector(`[aria-label="PDF ${number}"]`)?.width > 0, pageCount);
  result.ui = { reading: true, original: true, chunkRequests: requests.filter(item => item.action === 'materials.visual.chunk').length,
    wholeBookRequests: requests.filter(item => item.action === 'materials.document.bytes').length };
  assert.ok(result.ui.chunkRequests > 0 && result.ui.wholeBookRequests === 0);
  await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).first().click();
  await page.getByRole('button', { name: '添加资料', exact: true }).first().click();
  await page.locator('.scanned-import summary').click();
  await page.getByLabel('图文解析方式', { exact: true }).click();
  await page.getByRole('option', { name: '云端视觉模型', exact: true }).click();
  await page.getByLabel('云解析模型', { exact: true }).click();
  await page.getByRole('option', { name: model, exact: true }).click();
  result.ui.cloudModelSelection = (await page.getByLabel('云解析模型', { exact: true }).innerText()).includes(model);
  assert.ok(result.ui.cloudModelSelection);
  const archive = await call('materials.visual.export', { documentId, revision: descriptor.revision });
  try {
    assert.ok(archive.bytes <= 64 * 1024 * 1024);
    const chunks = [];
    for (let offset = 0; offset < archive.bytes;) {
      const chunk = await call('materials.visual.export.chunk', { transferId: archive.transferId, offset });
      const data = Buffer.from(chunk.dataBase64, 'base64');
      assert.ok(data.length > 0 && data.length <= 262144 && chunk.offset === offset);
      chunks.push(data); offset += data.length;
    }
    const zip = Buffer.concat(chunks);
    assert.equal(zip.length, archive.bytes);
    assert.equal(createHash('sha256').update(zip).digest('hex'), archive.hash);
    await writeFile(join(evidence, '云端导入验证样本-资源包.zip'), zip);
    result.export = { bytes: zip.length, hash: archive.hash, path: join(evidence, '云端导入验证样本-资源包.zip') };
  } finally { await call('materials.visual.export.discard', { transferId: archive.transferId }); }
  assert.deepEqual(result.pageErrors, []);
  result.ok = true;
} catch (error) {
  result.ok = false; result.error = error.message.replace(/token=[^\s"\\&]+/g, 'token=[redacted]'); process.exitCode = 1;
} finally {
  await browser?.close();
  await writeFile(join(evidence, 'cloud-probe-private.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ ok: result.ok, status: result.job?.status, documentId: result.documentId, ui: result.ui,
    usage: result.job?.usage, oldSourceTextUnchanged: result.oldSourceTextUnchanged, export: result.export, error: result.error }));
}
