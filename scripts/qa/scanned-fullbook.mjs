/* Real full-book native Job QA. No cloud model is called by this script. */
import { execFile, spawnSync } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { mkdir, open, readFile, writeFile, stat, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import YAML from 'yaml';
import { launchChromium } from './browser.mjs';
import { bootDsh, dshPatch, stopTree } from './dsh-e2e.mjs';
import { scrubSecrets } from './env.mjs';
import { createFakeOpenAI } from './fake-openai.mjs';
import { hashFile, loadManifest, verifyAsset } from '../../lib/contexts/materials/visual-storage.js';
import { Store } from '../../lib/store.js';

const base = resolve('..'), pdf = process.argv.find(arg => arg.startsWith('--pdf='))?.slice(6);
if (!pdf) throw new Error('Provide --pdf=<absolute original book path>');
const previous = JSON.parse(await readFile(join(base, 'evidence/t11-native/summary.json'), 'utf8'));
const home = previous.home, evidence = join(base, 'evidence/t12-fullbook');
const root = join(base, 'test-libraries/fullbook'), workspace = join(base, 'test-harness/fullbook-workspace');
const env = { ...scrubSecrets(process.env), DSH_HOME: home, TEMP: join(home, 'study/tmp'), TMP: join(home, 'study/tmp'), SSH_TTY: 'audit', DSH_TELEMETRY_DISABLED: '1' };
const summary = { home, root, startedAt: new Date().toISOString(), steps: [], memory: { samplingSeconds: 10, hostTreePeakBytes: 0, parserTreePeakBytes: 0, samples: 0 }, consoleErrors: [], pageErrors: [] };
const exec = promisify(execFile);
let dsh, browser, model, timer, sampling = false;
const disk = async dir => { let bytes = 0; for (const entry of await readdir(dir, { withFileTypes: true })) { const path = join(dir, entry.name); if (entry.isDirectory()) bytes += await disk(path); else if (entry.isFile()) bytes += (await stat(path)).size; } return bytes; };
try {
  for (const dir of [root, workspace, evidence, env.TEMP]) await mkdir(dir, { recursive: true });
  const pack = join(base, 'packages/dev', `fullbook-${Date.now()}`); await mkdir(pack, { recursive: true });
  const command = (file, args) => {
    const result = spawnSync(file, args, { env: { ...env, npm_config_offline: 'true' }, cwd: resolve('.'), windowsHide: true, encoding: 'utf8', shell: file === 'npm', timeout: 300000 });
    if (result.status !== 0) throw new Error(`Isolated fullbook package installation failed: ${result.stderr.slice(-1000)}`);
    return result.stdout.trim().split(/\r?\n/).at(-1);
  };
  const filename = command('npm', ['pack', '--ignore-scripts', '--pack-destination', pack]);
  command(process.execPath, [join(base, 'test-harness/bin.mjs'), 'plugin', '--profile', 'studyhub-e2e', 'add', join(pack, filename), '--offline']);
  summary.installedSourceHashes = {};
  for (const file of ['lib/contexts/materials/visual-import.js', 'lib/contexts/materials/visual-parser.js', 'lib/contexts/materials/visual-captions.js', 'lib/jobs/gateway.js', 'lib/client.js']) {
    const expected = (await hashFile(resolve(file))).hash, actual = (await hashFile(join(home, 'profiles/studyhub-e2e/node_modules/@ericwang1358/dsh-daily-flashcard', file))).hash;
    if (expected !== actual) throw new Error(`Stale installed fullbook source: ${file}`);
    summary.installedSourceHashes[file] = actual;
  }
  const before = await stat(pdf), original = await hashFile(pdf); summary.original = { ...original, mtimeMs: before.mtimeMs }; summary.diskBeforeBytes = await disk(root);
  const parserPid = Number((await exec('powershell.exe', ['-NoProfile', '-Command', '(Get-NetTCPConnection -LocalPort 16580 -State Listen).OwningProcess'], { windowsHide: true })).stdout.trim());
  const patch = join(evidence, 'native.patch.yml');
  model = await createFakeOpenAI({ port: 43145 });
  await writeFile(patch, YAML.stringify([...dshPatch({ fakeModelUrl: model.url, documentsDirectory: workspace }), { id: 'daily-flashcard', config: { libraryRoot: root } }]));
  dsh = await bootDsh(join(base, 'test-harness/bin.mjs'), { env, cwd: workspace, patch, port: 43144 });
  // Sample working sets of the actual host/parser trees; unrelated Python/Node processes are excluded.
  const sample = async () => {
    if (sampling) return; sampling = true;
    try {
      const command = `$taskRows=Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId; function Measure-TaskTree([int]$taskRoot) { $taskIds=[Collections.Generic.HashSet[int]]::new(); [void]$taskIds.Add($taskRoot); do { $taskChanged=$false; foreach($taskRow in $taskRows){if($taskIds.Contains([int]$taskRow.ParentProcessId) -and $taskIds.Add([int]$taskRow.ProcessId)){$taskChanged=$true}} }while($taskChanged); $taskSum=0L; foreach($taskId in $taskIds){$taskProcess=Get-Process -Id $taskId -ErrorAction SilentlyContinue; if($taskProcess){$taskSum+=$taskProcess.WorkingSet64}}; return $taskSum }; @{host=(Measure-TaskTree ${dsh.child.pid}); parser=(Measure-TaskTree ${parserPid})} | ConvertTo-Json -Compress`;
      const values = JSON.parse((await exec('powershell.exe', ['-NoProfile', '-Command', command], { windowsHide: true, timeout: 9000 })).stdout);
      summary.memory.hostTreePeakBytes = Math.max(summary.memory.hostTreePeakBytes, values.host); summary.memory.parserTreePeakBytes = Math.max(summary.memory.parserTreePeakBytes, values.parser); summary.memory.samples++;
    } catch (error) { summary.memory.lastSamplingError = error.code || 'sampling-error'; }
    finally { sampling = false; }
  };
  await sample(); timer = setInterval(sample, 10000);
  browser = await launchChromium(); const page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  page.on('console', item => { if (item.type() === 'error') summary.consoleErrors.push(item.text().replace(/token=\S+/g, 'token=…')); });
  page.on('pageerror', error => summary.pageErrors.push(error.message));
  await page.goto(dsh.url, { waitUntil: 'networkidle' }); await page.locator('.study-app').first().waitFor({ timeout: 90000 });
  const rpc = (method, payload) => page.evaluate(async ({ method, payload }) => (await (await fetch(`/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload }) })).json()).result, { method, payload });
  const sessionId = (await rpc('session/list', { args: { _request: {} } })).value.items[0].sessionId;
  const call = async (action, args = {}) => { const result = await rpc('study-workspace/call', { sessionId, action, args }); if (!result.ok) throw new Error(`${action}: ${result.error?.message}`); return result.value; };
  await call('settings', { scannedTextbooks: true });
  const uploadStart = Date.now(), upload = await call('materials.visual.upload.start', { name: '数字集成电路-第2版-全书.pdf', size: before.size });
  const handle = await open(pdf); let offset = 0; const buffer = Buffer.alloc(262144), uploadHash = createHash('sha256');
  try { while (offset < before.size) { const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset); if (!bytesRead) throw new Error('Original truncated'); uploadHash.update(buffer.subarray(0, bytesRead)); await call('materials.visual.upload.append', { uploadId: upload.uploadId, offset, data: buffer.subarray(0, bytesRead).toString('base64') }); offset += bytesRead; if (offset % (262144 * 100) === 0) console.log(JSON.stringify({ stage: 'upload', bytes: offset, total: before.size })); } } finally { await handle.close(); }
  if (uploadHash.digest('hex') !== original.hash) throw new Error('Upload hash mismatch');
  await call('materials.visual.upload.finish', { uploadId: upload.uploadId }); summary.uploadMs = Date.now() - uploadStart;
  const importStart = Date.now(), started = await call('materials.visual.import', { uploadId: upload.uploadId, courses: ['数字集成电路'], title: '数字集成电路（第二版）' }); summary.jobId = started.jobId;
  let job, lastProgress = '';
  for (let n = 0; n < 14400; n++) {
    job = (await call('snapshot')).jobs.find(item => item.id === started.jobId);
    const progress = JSON.stringify({ stage: 'fullbook-parse', status: job?.status, taskStage: job?.contract?.stage, progress: job?.contract?.progress });
    if (progress !== lastProgress) { console.log(progress); lastProgress = progress; await writeFile(join(evidence, 'running.json'), JSON.stringify({ job, summary }, null, 2)); }
    if (job && !['queued', 'running', 'cancelling'].includes(job.status)) break;
    await new Promise(done => setTimeout(done, 5000));
  }
  summary.importMs = Date.now() - importStart; summary.job = job;
  if (job?.status !== 'complete') throw new Error(`Full book native Job failed: ${job?.stage || job?.status}`);
  const state = await new Store(root).read(), documentId = `visual-${original.hash}`, document = state.documents.find(item => item.id === documentId);
  if (!document) throw new Error('Full book document not committed');
  const version = document.versions.find(item => item.revision === document.currentRevision), manifest = await loadManifest(root, version.visual);
  if (manifest.pages.length !== 572 || manifest.pages.some((item, index) => item.page !== index + 1 || item.originalPage !== index + 1)) throw new Error('Full-book page coverage mismatch');
  for (const asset of manifest.assets) await verifyAsset(root, asset);
  summary.document = { documentId, revision: version.revision, pages: manifest.pages.length, assets: manifest.assets.length, quality: manifest.quality };
  summary.blockCounts = Object.fromEntries([...new Set(manifest.pages.flatMap(item => item.blocks.map(block => block.type)))].map(type => [type, manifest.pages.reduce((sum, item) => sum + item.blocks.filter(block => block.type === type).length, 0)]));
  summary.captionAssociation = manifest.pages.find(item => item.page === 149).blocks.filter(block => block.figureNumber).map(block => ({ blockId: block.id, figure: block.figureNumber, captions: block.captions }));
  summary.inverterPages = manifest.pages.filter(item => /第\s*5\s*章|CMOS\s*反相器|图\s*5[.．]/.test(item.text)).map(item => ({ page: item.page, printedPage: item.printedPage, images: item.blocks.filter(block => block.assetId && block.type !== 'equation').map(block => ({ id: block.id, type: block.type, figureNumber: block.figureNumber, captions: block.captions })) }));
  await writeFile(join(evidence, 'inverter-pages.json'), JSON.stringify(summary.inverterPages, null, 2));
  await page.reload({ waitUntil: 'networkidle' });
  if (!await page.locator('.study-app').first().isVisible().catch(() => false)) await page.getByRole('button', { name: 'StudyHub', exact: true }).first().click();
  await page.locator('.study-app').first().waitFor({ timeout: 30000 });
  await page.locator('[data-tour="nav-sources"]').first().click({ force: true });
  await page.locator(`.source-doc[data-document-key*="${documentId}"] .source-main`).first().click({ force: true }); await page.locator('.scanned-reader').waitFor();
  const selectedPages = [...new Set([1, 200, 201, 206, 572, ...summary.inverterPages.slice(0, 2).map(item => item.page), ...manifest.pages.filter(item => item.geometry.rotation).slice(0, 1).map(item => item.page), ...manifest.quality.imageOnly.slice(0, 1), ...manifest.quality.blankOrUnrecognized.slice(0, 1)])];
  for (const number of selectedPages) {
    const current = await call('materials.visual.page', { documentId, page: number }); await call('materials.visual.preview', { documentId, page: number });
    await page.getByLabel('图文 PDF 页码').fill(String(number)); await page.waitForTimeout(1000);
    await page.screenshot({ path: join(evidence, `page-${number}.png`) }); summary.steps.push({ name: 'page-read-preview', page: number, blocks: current.page.blocks.length, assets: current.assets.length });
  }
  const download = async (action, args, filename) => {
    const transfer = await call(action, args), path = join(base, 'packages', filename), writer = await open(path, 'w'); let offset = 0; const hash = createHash('sha256');
    try {
      while (offset < transfer.bytes) {
        const chunk = await call('materials.visual.export.chunk', { transferId: transfer.transferId, offset }), bytes = Buffer.from(chunk.dataBase64, 'base64');
        if (!bytes.length || chunk.offset !== offset || offset + bytes.length > transfer.bytes) throw new Error('Incomplete native ZIP transfer');
        await writer.write(bytes); hash.update(bytes); offset += bytes.length;
      }
    } finally { await writer.close(); await call('materials.visual.export.discard', { transferId: transfer.transferId }); }
    const actual = hash.digest('hex'); if (actual !== transfer.hash) throw new Error('Native ZIP hash mismatch');
    return { filename, bytes: transfer.bytes, hash: actual, entries: transfer.entries };
  };
  summary.textbookZip = await download('materials.visual.export', { documentId }, 'full-textbook.zip');
  summary.libraryZip = await download('library.visualBackup.export', {}, 'fullbook-library.zip');
  const after = await stat(pdf), finalOriginal = await hashFile(pdf); summary.originalUnchanged = finalOriginal.hash === original.hash && after.mtimeMs === before.mtimeMs;
  summary.diskAfterBytes = await disk(root); summary.allAssetHashesVerified = true; summary.ok = summary.originalUnchanged && !summary.consoleErrors.length && !summary.pageErrors.length;
  await sample();
} catch (error) { summary.ok = false; summary.error = error.message; if (dsh) summary.hostDiagnostics = dsh.output().slice(-3000).replace(/token=\S+/g, 'token=…'); }
finally { clearInterval(timer); await browser?.close(); stopTree(dsh?.child); await model?.close(); summary.finishedAt = new Date().toISOString(); await writeFile(join(evidence, 'summary.json'), JSON.stringify(summary, null, 2)); }
console.log(JSON.stringify({ ok: summary.ok, error: summary.error, document: summary.document, memory: summary.memory, importMs: summary.importMs }));
if (!summary.ok) process.exitCode = 1;
