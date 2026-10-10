/* Full-book native ZIP restore and UI verification in an isolated profile. No paid model calls. */
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import YAML from 'yaml';
import { launchChromium } from './browser.mjs';
import { bootDsh, dshPatch, stopTree } from './dsh-e2e.mjs';
import { scrubSecrets } from './env.mjs';
import { createFakeOpenAI } from './fake-openai.mjs';
import { Store } from '../../lib/store.js';
import { loadManifest, verifyAsset } from '../../lib/contexts/materials/visual-storage.js';

const base = resolve('..'), runId = Date.now(), evidence = join(base, 'evidence/t12-restore');
const previous = process.argv.includes('--resume') ? JSON.parse(await readFile(join(evidence, 'summary.json'), 'utf8')) : null;
const home = previous?.home || join(base, `test-harness/restore-${runId}`), root = previous?.root || join(base, `test-libraries/restore-${runId}`), workspace = join(home, 'workspace');
const env = { ...scrubSecrets(process.env), DSH_HOME: home, TEMP: join(home, 'study/tmp'), TMP: join(home, 'study/tmp'), SSH_TTY: 'audit', DSH_TELEMETRY_DISABLED: '1' };
const version = JSON.parse(await readFile(resolve('package.json'), 'utf8')).version;
const bin = join(base, 'test-harness/bin.mjs'), release = join(base, `packages/${version}`);
const summary = { home, root, startedAt: new Date().toISOString(), consoleErrors: [], pageErrors: [], paidModelCalls: 0 };
let dsh, browser, model;
try {
  for (const dir of [home, root, workspace, env.TEMP, evidence]) await mkdir(dir, { recursive: true });
  const cli = args => {
    const result = spawnSync(process.execPath, [bin, ...args], { env, encoding: 'utf8', windowsHide: true, timeout: 300000 });
    if (result.status !== 0) throw new Error(`Native installer failed: ${result.stderr.slice(-800)}`);
  };
  if (!previous) cli(['--profile', 'studyhub-e2e', '--from-default-profile', 'web', '--dump-config']);
  cli(['plugin', '--profile', 'studyhub-e2e', 'add', join(release, `ericwang1358-dsh-daily-flashcard-${version}.tgz`), '--offline']);
  model = await createFakeOpenAI({ port: 43145 });
  const patch = join(evidence, 'native.patch.yml');
  await writeFile(patch, YAML.stringify([...dshPatch({ fakeModelUrl: model.url, documentsDirectory: workspace }), { id: 'daily-flashcard', config: { libraryRoot: root } }]));
  dsh = await bootDsh(bin, { env, cwd: workspace, patch, port: 43144 });
  browser = await launchChromium(); const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  page.on('console', item => { if (item.type() === 'error') summary.consoleErrors.push(item.text().replace(/token=\S+/g, 'token=…')); });
  page.on('pageerror', error => summary.pageErrors.push(error.message));
  await page.goto(dsh.url, { waitUntil: 'networkidle' }); await page.locator('.study-app').first().waitFor({ timeout: 90000 });
  const hostDialog = page.getByRole('dialog');
  if (await hostDialog.count()) {
    summary.startupDialog = await hostDialog.allInnerTexts();
    await page.screenshot({ path: join(evidence, 'startup-dialog.png') });
    const dismiss = hostDialog.getByRole('button', { name: /^(继续|关闭|稍后|取消|知道了|跳过|完成)$/ });
    if (await dismiss.count()) await dismiss.first().click();
    const later = page.getByRole('button', { name: '稍后配置', exact: true });
    if (await later.waitFor({ timeout: 5000 }).then(() => true, () => false)) await later.click();
  }
  const rpc = (method, payload) => page.evaluate(async ({ method, payload }) => (await (await fetch(`/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload }) })).json()).result, { method, payload });
  const sessionId = (await rpc('session/list', { args: { _request: {} } })).value.items[0].sessionId;
  const call = async (action, args = {}) => { const result = await rpc('study-workspace/call', { sessionId, action, args }); if (!result.ok) throw new Error(`${action}: ${result.error?.message}`); return result.value; };
  const skipTour = page.getByRole('button', { name: /^(以后再说|跳过导览)$/ });
  if (await skipTour.isVisible()) await skipTour.click();
  if (!previous) {
    await page.locator('[data-tour="nav-settings"]').first().click();
    await page.getByRole('button', { name: '导入、计划与备份', exact: true }).click();
    const backup = page.getByRole('region', { name: '含附件整库备份', exact: true });
    await backup.getByLabel('选择完整学习库 ZIP').setInputFiles(join(base, 'packages/fullbook-library.zip'));
    await backup.getByRole('button', { name: '验证并用 ZIP 替换当前学习库', exact: true }).click();
    await page.getByRole('button', { name: '验证并替换', exact: true }).click();
    // Successful restore leaves settings; a library with decks has a different home layout.
    await backup.waitFor({ state: 'hidden', timeout: 300000 });
  }
  const state = await new Store(root).read(), document = state.documents[0];
  const documentVersion = document.versions.find(item => item.revision === document.currentRevision), manifest = await loadManifest(root, documentVersion.visual);
  if (manifest.pages.length !== 572 || document.versions.length !== 2) throw new Error('Full book/history restore mismatch');
  let verified = 0;
  for (const asset of manifest.assets) { await verifyAsset(root, asset); verified++; }
  summary.restored = { pages: manifest.pages.length, versions: document.versions.length, sources: state.sources.length, assetsVerified: verified, documentId: document.id, revision: document.currentRevision };
  await page.reload({ waitUntil: 'networkidle' });
  const laterAfterReload = page.getByRole('button', { name: '稍后配置', exact: true });
  if (await laterAfterReload.waitFor({ timeout: 5000 }).then(() => true, () => false)) await laterAfterReload.click();
  if (!await page.locator('.study-app').first().isVisible().catch(() => false)) await page.getByRole('button', { name: 'StudyHub', exact: true }).first().click();
  await page.locator('.study-app').first().waitFor({ timeout: 30000 });
  await page.locator('[data-tour="nav-sources"]').first().click();
  await page.locator(`.source-doc[data-document-key*="${document.id}"] .source-main`).first().click();
  await page.locator('.scanned-reader').waitFor({ timeout: 30000 });
  await page.getByLabel('图文 PDF 页码').fill('149');
  await page.locator('[data-visual-block="p149-b8"] img').waitFor({ timeout: 30000 });
  await page.screenshot({ path: join(evidence, 'inverter-p149.png') });
  await page.getByRole('button', { name: '原页对照', exact: true }).click();
  await page.locator('[aria-label="原页对照"] img').waitFor({ timeout: 30000 });
  await page.screenshot({ path: join(evidence, 'inverter-original-p149.png') });
  summary.originalPreview = await call('materials.visual.preview', { documentId: document.id, page: 149 });
  summary.ok = summary.consoleErrors.length === 0 && summary.pageErrors.length === 0;
  if (!summary.ok) throw new Error('Browser errors during native restore');
} catch (error) {
  if (browser?.contexts()[0]?.pages()[0]) {
    const failedPage = browser.contexts()[0].pages()[0];
    summary.remainingDialogs = await failedPage.getByRole('dialog').allInnerTexts().catch(() => []);
    await failedPage.screenshot({ path: join(evidence, 'failure.png') }).catch(() => {});
  }
  summary.error = error.message.replace(/token=\S+/g, 'token=…'); summary.ok = false; process.exitCode = 1;
}
finally { if (browser) await browser.close(); if (dsh) await stopTree(dsh.child); if (model) await model.close(); await writeFile(join(evidence, 'summary.json'), JSON.stringify(summary, null, 2)); console.log(JSON.stringify(summary)); }
