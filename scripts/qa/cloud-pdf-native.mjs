/* Isolated native DSH cloud acceptance. Credentials are resolved by DSH, never read by this script. */
/* global document */
import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { bootDsh, stopTree } from './dsh-e2e.mjs';
import { scrubSecrets } from './env.mjs';
import { launchChromium } from './browser.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url)), base = resolve(repo, '..');
const args = Object.fromEntries(process.argv.slice(2).map(arg => { const at = arg.indexOf('='); if (!arg.startsWith('--') || at < 0) throw new Error('Use --name=value options'); return [arg.slice(2, at), arg.slice(at + 1)]; }));
for (const key of ['home', 'root', 'profile', 'credential-store', 'pdf']) if (!args[key]) throw new Error(`--${key} is required`);
const within = (path, parent) => { const absolute = resolve(path); if (!absolute.startsWith(resolve(parent) + sep)) throw new Error('QA target must remain in the named isolated directory'); return absolute; };
const home = within(args.home, join(base, 'test-harness')), root = within(args.root, join(base, 'test-libraries'));
const stamp = Date.now(), evidence = join(base, 'evidence/cloud-pdf', `native-${stamp}`), workspace = join(home, 'workspace'), pack = join(base, 'packages/dev', `cloud-${stamp}`);
const env = { ...scrubSecrets(process.env), DSH_HOME: home, TEMP: join(home, 'tmp'), TMP: join(home, 'tmp'), SSH_TTY: 'audit', DSH_TELEMETRY_DISABLED: '1' };
const summary = { startedAt: new Date().toISOString(), fixture: false, home, root, modelCalls: 0, formalProfileChanged: false, pageErrors: [], steps: [] };
const run = (file, argv, cwd = repo) => {
  const result = spawnSync(file, argv, { cwd, env, encoding: 'utf8', windowsHide: true, shell: file === 'npm', timeout: 300000 });
  summary.steps.push({ command: file === process.execPath ? argv.slice(1, 4).join(' ') : `${file} ${argv[0]}`, exitCode: result.status });
  writeFileSync(join(evidence, `setup-${summary.steps.length}-private.log`), `${result.stdout || ''}\n${result.stderr || ''}`);
  if (result.status !== 0) throw new Error(`Isolated setup step ${summary.steps.length} failed: ${file} exited ${result.status}; see private setup logs`);
  return result.stdout.trim();
};
for (const dir of [home, root, workspace, evidence, pack, env.TEMP]) await mkdir(dir, { recursive: true });
const sourceProfile = JSON.parse(await readFile(args.profile, 'utf8')).value.providers[args.provider || 'qwen'];
if (!sourceProfile || Object.keys(sourceProfile).some(key => /^(apiKey|token|secret)$/i.test(key))) throw new Error('Use a DSH non-secret provider profile, not credential contents');
const provider = args.provider || 'qwen', model = args.model || 'qwen3-vl-plus';
// Exact documented models only; never infer a whole provider's capabilities from its display name.
if (!['qwen3-vl-plus', 'qwen3.8-max', 'qwen3.8-flash'].includes(model)) throw new Error('Choose an explicitly documented image-input model for this probe');
const profile = { ...sourceProfile, models: [{ id: model, input: ['text', 'image'], reasoningEfforts: false }], modelOverrides: {} };
delete profile.headers;
summary.route = { provider, model }; summary.isolatedMetadataOverride = { input: ['text', 'image'], reasoningEfforts: false };
const bin = join(base, 'test-harness/bin.mjs'); let dsh, browser;
try {
  const name = run('npm', ['pack', '--ignore-scripts', '--pack-destination', pack]).split(/\r?\n/).at(-1);
  if (!await access(join(home, 'profiles/studyhub-e2e')).then(() => true, () => false)) run(process.execPath, [bin, '--profile', 'studyhub-e2e', '--from-default-profile', 'web', '--dump-config']);
  run(process.execPath, [bin, 'plugin', '--profile', 'studyhub-e2e', 'add', join(pack, name)]);
  const patch = join(home, 'cloud.patch.yml');
  await writeFile(patch, YAML.stringify([{ id: 'llm-pi-ai', config: { providers: { [provider]: profile } } },
    { id: 'credentials', config: { path: resolve(args['credential-store']), watch: false } },
    { id: 'agent-default-model', config: { provider, model } }, { id: 'agent-preset-registry', config: { default: 'study' } },
    { id: 'workspace-controller', config: { documentsDirectory: workspace } }, { id: 'daily-flashcard', config: { libraryRoot: root } }]));
  dsh = await bootDsh(bin, { env, cwd: workspace, patch, port: Number(args.port || 43154) });
  let hostOutput = dsh.output();
  dsh.child.stdout.on('data', chunk => { hostOutput += chunk; });
  dsh.child.stderr.on('data', chunk => { hostOutput += chunk; });
  dsh.output = () => hostOutput;
  dsh.child.on('exit', (code, signal) => { summary.hostExit = { code, signal }; });
  browser = await launchChromium(); const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('pageerror', error => summary.pageErrors.push(error.message.replace(/token=\S+/g, 'token=[redacted]')));
  await page.goto(dsh.url, { waitUntil: 'domcontentloaded' });
  await page.locator('.study-app').first().waitFor({ timeout: 90000 });
  const continueButton = page.getByRole('dialog').getByRole('button', { name: '继续', exact: true });
  if (await continueButton.isVisible()) await continueButton.click();
  const later = page.getByRole('dialog').getByRole('button', { name: '稍后配置', exact: true });
  if (await later.isVisible()) await later.click();
  const rpc = (method, payload) => page.evaluate(async ({ method, payload }) => (await (await fetch(`/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload }) })).json()).result, { method, payload });
  // A persisted conversation is not proof of a registered live executor after host restart.
  const created = await rpc('session/create', { args: { request: { cwd: workspace, agentPreset: 'study' } } });
  if (!created.ok) throw new Error(`Isolated session admission failed: ${created.error?.message}`);
  const sessionId = created.value.sessionId;
  const call = async (action, args = {}) => { const result = await rpc('study-workspace/call', { sessionId, action, args }); if (!result.ok) throw new Error(`${action}: ${result.error?.message || 'native call failed'}`); return result.value; };
  summary.models = await call('materials.visual.models');
  if (!summary.models.models.some(item => item.provider === provider && item.id === model)) throw new Error('Isolated DSH did not declare the intended image route');
  await call('settings', { scannedTextbooks: true });
  let started;
  if (args['inspect-document']) {
    const snapshot = await call('snapshot'), existing = snapshot.jobs.find(job => job.contract.result.refs.some(ref => ref.kind === 'document' && ref.id === args['inspect-document']));
    if (!existing) throw new Error('No persisted native job for the requested isolated candidate');
    started = { jobId: existing.id }; summary.inspectedOnly = true;
  } else if (args['retry-job'] || args['resume-job']) {
    await call('snapshot');
    const jobId = args['retry-job'] || args['resume-job'];
    const retried = await call('job.control', { jobId, action: args['resume-job'] ? 'resume' : 'retry' });
    started = { jobId: retried.attemptId }; summary.restoredJob = jobId;
  } else {
    const bytes = await readFile(args.pdf);
    const upload = await call('materials.visual.upload.start', { name: 'cloud-capability-sample.pdf', size: bytes.length });
    for (let offset = 0; offset < bytes.length; offset += 262144) await call('materials.visual.upload.append', { uploadId: upload.uploadId, offset, data: bytes.subarray(offset, offset + 262144).toString('base64') });
    await call('materials.visual.upload.finish', { uploadId: upload.uploadId });
    started = await call('materials.visual.import', { uploadId: upload.uploadId, parser: 'cloud', modelKey: JSON.stringify([provider, model]) });
  }
  summary.jobId = started.jobId;
  if (args['pause-at-checkpoint'] === 'true') await call('job.control', { jobId: started.jobId, action: 'pause' });
  let job;
  for (let n = 0; n < 1200; n++) {
    job = (await call('snapshot')).jobs.find(item => item.id === started.jobId);
    summary.job = job?.contract;
    summary.modelCalls = job?.contract?.calls.filter(item => item.modelRequest).length || 0;
    if (n % 20 === 0) await writeFile(join(evidence, 'summary.json'), JSON.stringify(summary, null, 2));
    if (job && !['queued', 'running', 'pausing', 'cancelling'].includes(job.contract.status)) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  summary.job = job?.contract; summary.modelCalls = job?.contract?.calls.filter(item => item.modelRequest).length || 0;
  summary.newModelCalls = summary.inspectedOnly ? 0 : job?.contract?.calls.filter(item => item.modelRequest && item.attemptId === job.contract.runtime.attempts.at(-1)?.attemptId).length || 0;
  if (job?.contract.status === 'paused' && args['pause-at-checkpoint'] === 'true') {
    summary.outcome = 'native-checkpoint-paused';
    summary.checkpoint = job.contract.runtime.attempts.at(-1)?.checkpointRef;
  } else {
  if (job?.status !== 'complete') throw new Error(`Native cloud job ended ${job?.status}: ${job?.contract?.error?.message || job?.stage}`);
  const documentId = job.contract.result.refs.find(ref => ref.kind === 'document').id;
  const descriptor = await call('materials.document.get', { documentId });
  summary.document = { documentId, revision: descriptor.revision, pages: descriptor.visual.pageCount, quality: descriptor.visual.quality, originalHash: descriptor.visual.original.hash };
  summary.pages = [];
  for (let number = 1; number <= descriptor.visual.pageCount; number++) {
    const value = await call('materials.visual.page', { documentId, page: number });
    summary.pages.push({ page: number, characters: value.page.text.length, types: value.page.blocks.map(block => block.type), assets: value.assets.length, uncertaintyCount: value.page.uncertainty?.length || 0 });
  }
  if (args.ui === 'true') {
    const requests = [];
    page.on('request', request => { if (request.url().endsWith('/api/study-workspace/call')) { try { requests.push(request.postDataJSON().payload); } catch { /* non-JSON request */ } } });
    await page.locator('[data-tour="nav-sources"]').first().click();
    await page.locator(`.source-doc[data-document-key*="${documentId}"] .source-main`).first().click();
    await page.locator('[data-study-reflow] [data-study-anchor-start]').first().waitFor();
    await page.screenshot({ path: join(evidence, 'reading-private.png') });
    await page.getByRole('button', { name: '原始 PDF', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="原始 PDF 分页阅读"] canvas')?.width > 0);
    await page.screenshot({ path: join(evidence, 'original-private.png') });
    summary.ui = { reading: true, original: true, chunkRequests: requests.filter(request => request.action === 'materials.visual.chunk').length, wholeBookRequests: requests.filter(request => request.action === 'materials.document.bytes').length };
    if (!summary.ui.chunkRequests || summary.ui.wholeBookRequests || summary.pageErrors.length) throw new Error('Native reading UI failed its bounded-transfer acceptance');
    await page.getByRole('dialog').getByRole('button', { name: '关闭', exact: true }).first().click();
    await page.locator('[data-tour="nav-sources"]').first().click(); await page.getByRole('button', { name: '添加资料', exact: true }).first().click(); await page.locator('.scanned-import summary').click();
    await page.getByLabel('图文解析方式', { exact: true }).click(); await page.getByRole('option', { name: '云端视觉模型', exact: true }).click();
    await page.getByLabel('云解析模型', { exact: true }).click(); await page.getByRole('option', { name: model, exact: true }).click();
    summary.ui.cloudModelSelection = (await page.getByLabel('云解析模型', { exact: true }).innerText()).includes(model);
    if (!summary.ui.cloudModelSelection) throw new Error('Native image model was not selectable in the import UI');
  }
  summary.outcome = 'native-cloud-candidate-saved-content-unverified';
  if (summary.inspectedOnly) summary.outcome = 'native-existing-candidate-read-only';
  }
} catch (error) { summary.outcome = 'failed'; summary.error = error.message.replace(/token=\S+/g, 'token=[redacted]').slice(0, 500); process.exitCode = 1; }
finally {
  await browser?.close(); stopTree(dsh?.child);
  if (dsh) await writeFile(join(evidence, 'host-private.log'), dsh.output().replace(/token=\S+/g, 'token=[redacted]'));
  await writeFile(join(evidence, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify({ evidence, outcome: summary.outcome, modelCalls: summary.modelCalls, newModelCalls: summary.newModelCalls, error: summary.error, document: summary.document, usage: summary.job?.usage }));
}
