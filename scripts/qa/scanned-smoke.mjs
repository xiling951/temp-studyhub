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
const runId = Date.now();
const home = join(base, `test-harness/native-${runId}`), root = join(base, `test-libraries/native-${runId}`), workspace = join(base, `test-harness/workspace-${runId}`), evidence = join(base, 'evidence/t06-native');
const bin = join(base, 'test-harness/bin.mjs'), pack = join(base, 'packages/dev'), env = { ...scrubSecrets(process.env), DSH_HOME: home, SSH_TTY: 'audit', DSH_TELEMETRY_DISABLED: '1', npm_config_offline: 'true' };
for (const dir of [home, root, workspace, evidence, pack]) await mkdir(dir, { recursive: true });
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: repo, env, encoding: 'utf8', windowsHide: true, shell: command === 'npm', timeout: 300000 });
  if (result.status !== 0) throw new Error(`QA command failed: ${result.stderr.slice(-1000).replace(/token=\S+/g, 'token=…')}`);
  return result.stdout;
};
const summary = { root, home, startedAt: new Date().toISOString(), consoleErrors: [], pageErrors: [], model: 'local-stand-in-no-paid-call', steps: [] };
let dsh, browser, model, page;
try {
  const tgzName = run('npm', ['pack', '--ignore-scripts', '--pack-destination', pack]).trim().split(/\r?\n/).at(-1);
  run(process.execPath, [bin, '--profile', 'studyhub-e2e', '--from-default-profile', 'web', '--dump-config']);
  run(process.execPath, [bin, 'plugin', '--profile', 'studyhub-e2e', 'add', join(pack, tgzName)]);
  model = await createFakeOpenAI({ port: 43145 });
  const patch = join(base, 'test-harness/scanned.patch.yml');
  await writeFile(patch, YAML.stringify([...dshPatch({ fakeModelUrl: model.url, documentsDirectory: workspace }), { id: 'daily-flashcard', config: { libraryRoot: root } }]));
  dsh = await bootDsh(bin, { env: { ...env, STUDYHUB_QA_FAKE_KEY: 'test-only' }, cwd: workspace, patch, port: 43144 });
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
  const started = await call('materials.visual.import', { uploadId: upload.uploadId, pageOffset: 199, courses: ['扫描教材验收'] });
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
  summary.ok = summary.consoleErrors.length === 0 && summary.pageErrors.length === 0;
} catch (error) {
  summary.ok = false; summary.error = error.message;
  if (page) { summary.pageText = await page.locator('body').innerText().then(text => text.slice(0, 1600), () => 'unavailable'); await page.screenshot({ path: join(evidence, 'failed.png') }).catch(() => {}); }
}
finally {
  await browser?.close(); stopTree(dsh?.child); await model?.close(); summary.finishedAt = new Date().toISOString();
  await writeFile(join(evidence, 'summary.json'), JSON.stringify(summary, null, 2));
}
console.log(JSON.stringify({ ok: summary.ok, error: summary.error, steps: summary.steps, consoleErrors: summary.consoleErrors, pageErrors: summary.pageErrors }));
if (!summary.ok) process.exitCode = 1;
