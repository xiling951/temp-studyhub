/* Actual isolated DSH + browser QA. Local model stand-in only; no real vision claim. */
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { launchChromium } from './browser.mjs';
import { bootDsh, dshPatch, stopTree } from './dsh-e2e.mjs';
import { scrubSecrets } from './env.mjs';
import { createFakeOpenAI } from './fake-openai.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url)), base = resolve(repo, '..');
const vision = process.argv.includes('--vision');
const noModel = process.argv.includes('--no-model');
const runId = Date.now();
const home = join(base, `test-harness/native-${runId}`), root = join(base, `test-libraries/native-${runId}`), workspace = join(base, `test-harness/workspace-${runId}`), evidence = join(base, vision ? 'evidence/t09-native' : noModel ? 'evidence/t09-no-model' : 'evidence/t06-native');
const bin = join(base, 'test-harness/bin.mjs'), pack = join(base, 'packages/dev'), env = { ...scrubSecrets(process.env), DSH_HOME: home, SSH_TTY: 'audit', DSH_TELEMETRY_DISABLED: '1', npm_config_offline: 'true' };
let credential = '';
if (vision) {
  const candidates = (await readFile('C:/Users/Lenovo/Desktop/API-key.txt', 'utf8')).match(/sk-[A-Za-z0-9_-]+/g) || [];
  if (candidates.length !== 1) throw new Error('Expected one unambiguous authorized API credential');
  credential = candidates[0];
}
const redact = value => (credential ? value.replaceAll(credential, '[credential]') : value).replace(/token=\S+/g, 'token=[redacted]');
for (const dir of [home, root, workspace, evidence, pack]) await mkdir(dir, { recursive: true });
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: repo, env, encoding: 'utf8', windowsHide: true, shell: command === 'npm', timeout: 300000 });
  if (result.status !== 0) throw new Error(`QA command failed: ${result.stderr.slice(-1000).replace(/token=\S+/g, 'token=…')}`);
  return result.stdout;
};
const summary = { root, home, startedAt: new Date().toISOString(), consoleErrors: [], pageErrors: [], model: vision ? 'deepseek-official/deepseek-flash-real' : 'local-stand-in-no-paid-call', steps: [] };
let dsh, browser, model, page;
try {
  const tgzName = run('npm', ['pack', '--ignore-scripts', '--pack-destination', pack]).trim().split(/\r?\n/).at(-1);
  run(process.execPath, [bin, '--profile', 'studyhub-e2e', '--from-default-profile', 'web', '--dump-config']);
  run(process.execPath, [bin, 'plugin', '--profile', 'studyhub-e2e', 'add', join(pack, tgzName)]);
  model = await createFakeOpenAI({ port: 43145 });
  const patch = join(base, 'test-harness/scanned.patch.yml');
  await writeFile(patch, YAML.stringify([...dshPatch({ fakeModelUrl: model.url, documentsDirectory: workspace }), ...(vision ? [{ id: 'agent-default-model', config: { provider: 'deepseek-official', model: 'deepseek-flash' } }] : []), { id: 'daily-flashcard', config: { libraryRoot: root } }]));
  dsh = await bootDsh(bin, { env: { ...env, STUDYHUB_QA_FAKE_KEY: 'test-only', ...(vision ? { DEEPSEEK_API_KEY: credential } : {}) }, cwd: workspace, patch, port: 43144 });
  browser = await launchChromium(); page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  page.on('console', message => { if (message.type() === 'error') summary.consoleErrors.push(message.text().replace(/token=\S+/g, 'token=…')); });
  page.on('pageerror', error => summary.pageErrors.push(error.message));
  await page.goto(dsh.url, { waitUntil: 'networkidle' }); await page.locator('.study-app').first().waitFor({ timeout: 90000 });
  const rpc = (method, payload) => page.evaluate(async ({ method, payload }) => (await (await fetch(`/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload }) })).json()).result, { method, payload });
  const sessionId = (await rpc('session/list', { args: { _request: {} } })).value.items[0].sessionId;
  const call = async (action, args = {}) => { const result = await rpc('study-workspace/call', { sessionId, action, args }); if (!result.ok) throw new Error(`${action}: ${result.error?.message || JSON.stringify(result)}`); return result.value; };
  const baseline = await call('materials.visual.status'); if (baseline.enabled) throw new Error('New isolated library feature should be off');
  await call('settings', { scannedTextbooks: true });
  const bytes = await readFile(resolve(base, '../lab/import-probe/数字集成电路-p200-206.pdf'));
  const upload = await call('materials.visual.upload.start', { name: '数字集成电路-p200-206.pdf', size: bytes.length });
  for (let offset = 0; offset < bytes.length; offset += 262144) await call('materials.visual.upload.append', { uploadId: upload.uploadId, offset, data: bytes.subarray(offset, offset + 262144).toString('base64') });
  await call('materials.visual.upload.finish', { uploadId: upload.uploadId });
  const started = await call('materials.visual.import', { uploadId: upload.uploadId, pageOffset: 199, courses: ['扫描教材验收'], ...(noModel ? { explain: true } : {}) });
  summary.steps.push({ name: 'native-submit', started });
  let job;
  for (let n = 0; n < 240; n++) {
    job = (await call('snapshot')).jobs.find(job => job.id === started.jobId);
    if (job && !['queued', 'running', 'cancelling'].includes(job.status)) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (job?.status !== 'complete') throw new Error(`Native import did not complete: ${job?.stage || job?.status}`);
  summary.job = { status: job.status, contract: job.contract };
  const state = await call('snapshot'), source = state.sources.find(source => source.document?.origin === 'ocr');
  const descriptor = await call('materials.document.get', { sourceId: source.id });
  if (!descriptor.originalAvailable || descriptor.original?.mode !== 'visual') throw new Error('Visual original descriptor is incorrect');
  summary.document = { documentId: descriptor.documentId, revision: descriptor.revision, pages: descriptor.visual.pageCount };
  const current = await call('materials.visual.page', { documentId: descriptor.documentId, page: 1 });
  summary.assets = current.assets.length;
  const preview = await call('materials.visual.preview', { documentId: descriptor.documentId, page: 1 }); summary.preview = preview;
  const unauthorized = await fetch('http://127.0.0.1:43144/api/study-workspace/call', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: 'unauthorized-probe', method: 'study-workspace/call', payload: { sessionId, action: 'materials.visual.page', args: { documentId: descriptor.documentId, page: 1 } } }) });
  summary.unauthorizedHttpStatus = unauthorized.status; summary.unauthorizedRejected = !(await unauthorized.json().catch(() => ({}))).result?.ok;
  await page.reload({ waitUntil: 'networkidle' });
  if (!await page.locator('.study-app').first().isVisible().catch(() => false)) await page.getByRole('button', { name: 'StudyHub', exact: true }).first().click({ timeout: 15000 });
  await page.locator('.study-app').first().waitFor({ timeout: 30000 });
  await page.locator('[data-tour="nav-sources"]').first().click({ force: true }).catch(() => {});
  await page.locator('.source-doc .source-main').first().click({ force: true });
  await page.locator('.scanned-reader').waitFor({ timeout: 30000 });
  await page.locator('.scanned-reader img').first().waitFor({ timeout: 30000 });
  await page.screenshot({ path: join(evidence, 'page200.png'), fullPage: false });
  await page.getByRole('button', { name: '原页对照', exact: true }).click();
  await page.locator('[aria-label="原页对照"] img').waitFor({ timeout: 30000 });
  await page.screenshot({ path: join(evidence, 'original-page200.png'), fullPage: false });
  await page.getByLabel('图文 PDF 页码').fill('2'); await page.locator('[data-visual-block="p2-b0"]').waitFor({ timeout: 30000 });
  await page.screenshot({ path: join(evidence, 'page201.png'), fullPage: false });
  if (vision) {
    const target = { documentId: descriptor.documentId, revision: descriptor.revision, blockIds: ['p1-b2', 'p2-b9', 'p7-b9'] };
    const explain = await call('materials.visual.explain', target);
    let explanationJob;
    for (let n = 0; n < 600; n++) {
      explanationJob = (await call('snapshot')).jobs.find(item => item.id === explain.jobId);
      if (explanationJob && !['queued', 'running', 'cancelling'].includes(explanationJob.status)) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (explanationJob?.status !== 'complete') throw new Error(`Image explanations failed: ${JSON.stringify(explanationJob?.contract?.error || explanationJob?.stage)}`);
    summary.explanationJob = explanationJob.contract;
    summary.explanations = (await call('materials.visual.explanations', { documentId: descriptor.documentId })).notes;
    if (summary.explanations.length !== 3 || summary.explanations.some(note => note.review !== 'pending' || note.indexed || !note.text)) throw new Error('Explanation version/review isolation failed');
    const again = await call('materials.visual.explain', target);
    let reused;
    for (let n = 0; n < 100; n++) { reused = (await call('snapshot')).jobs.find(item => item.id === again.jobId); if (reused?.status === 'complete') break; await new Promise(resolve => setTimeout(resolve, 100)); }
    if (reused?.status !== 'complete' || reused.contract.calls.some(call => !call.reused)) throw new Error('Matching explanation cache was not reused');
    summary.reusedJob = reused.contract;
    await page.getByLabel('图文 PDF 页码').fill('1');
    await page.locator('[data-visual-note]').first().waitFor({ timeout: 15000 });
    await page.locator('[aria-label="图解与核对"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(evidence, 'explanation-pending.png') });
    summary.ocrUnchanged = (await call('snapshot')).sources.find(item => item.id === source.id).text === source.text;
    if (!summary.ocrUnchanged) throw new Error('Model explanation contaminated source text');
  }
  if (noModel) {
    summary.explanationState = await call('materials.visual.explanations', { documentId: descriptor.documentId });
    if (summary.explanationState.importExplanation?.status !== 'unavailable' || summary.explanationState.notes.length) throw new Error('Model unavailability should retain verified import without creating a fake explanation');
    await page.locator('[aria-label="图解与核对"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(evidence, 'import-retained-no-vision.png') });
  }
  summary.ok = summary.consoleErrors.length === 0 && summary.pageErrors.length === 0;
} catch (error) {
  summary.ok = false; summary.error = error.message;
  if (page) { summary.pageText = await page.locator('body').innerText().then(text => text.slice(0, 1600), () => 'unavailable'); await page.screenshot({ path: join(evidence, 'failed.png') }).catch(() => {}); }
}
finally {
  await browser?.close(); stopTree(dsh?.child); await model?.close(); summary.finishedAt = new Date().toISOString();
  await writeFile(join(evidence, 'summary.json'), redact(JSON.stringify(summary, null, 2)));
}
console.log(JSON.stringify({ ok: summary.ok, error: summary.error, steps: summary.steps, consoleErrors: summary.consoleErrors, pageErrors: summary.pageErrors }));
if (!summary.ok) process.exitCode = 1;
