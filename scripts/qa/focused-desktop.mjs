/* Read-only verification of the authorized Desktop upgrade and existing study records. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { Store } from '../../lib/store.js';
import { launchChromium } from './browser.mjs';

const phase = process.argv.find(arg => arg.startsWith('--phase='))?.slice(8);
if (!['before', 'after'].includes(phase)) throw Error('Choose --phase=before or after');
const base = resolve('..'), evidence = join(base, 'evidence/mos-desktop-upgrade');
const home = 'C:/Users/Lenovo/AppData/Roaming/dsh-desktop/harness';
const root = 'D:/studyhub/libraries/数字集成电路-图文';
const hash = data => createHash('sha256').update(data).digest('hex');
const result = { phase, checkedAt: new Date().toISOString(), pageErrors: [] };
let browser;
try {
  await mkdir(evidence, { recursive: true });
  const log = await readFile('C:/Users/Lenovo/AppData/Roaming/dsh-desktop/logs/harness.log', 'utf8');
  const url = [...log.matchAll(/dsh web: (http:\/\/127\.0\.0\.1:\d+\/\?token=\S+)/g)].at(-1)?.[1];
  if (!url) throw Error('Running Desktop endpoint missing');
  browser = await launchChromium(); const page = await browser.newPage();
  page.on('pageerror', error => result.pageErrors.push(error.message.replace(/token=\S+/g, 'token=[redacted]')));
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  const rpc = (method, payload) => page.evaluate(async ({ method, payload }) => (await (await fetch('/api/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload }) })).json()).result, { method, payload });
  const sessions = (await rpc('session/list', { args: { _request: {} } })).value.items;
  const sessionId = sessions.find(session => session.sessionId === 'session-adab0730-1b72-457d-b98d-b3f3169af84d')?.sessionId ?? sessions[0]?.sessionId;
  if (!sessionId) throw Error('Existing Desktop session missing');
  const response = await rpc('study-workspace/call', { sessionId, action: 'snapshot', args: {} });
  if (!response.ok) throw Error(response.error?.message ?? 'StudyHub snapshot unavailable');
  if (phase === 'after') {
    await page.locator('.study-app').first().waitFor({ timeout: 30000 });
    result.nativeWebUiVisible = true;
    await page.screenshot({ path: join(evidence, 'native-ui-private.png') });
  }
  result.activeJobs = (response.value.jobs ?? []).filter(job => ['queued', 'running', 'cancelling', 'pausing', 'paused'].includes(job.status)).map(job => ({ id: job.id, status: job.status }));
  const installed = join(home, 'profiles/web/node_modules/@ericwang1358/dsh-daily-flashcard');
  result.installedVersion = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8')).version;
  result.retrievalVersion = JSON.parse(await readFile(join(home, 'profiles/web/node_modules/@ericwang1358/studyhub-retrieval/package.json'), 'utf8')).version;
  result.sourceChecks = [];
  for (const file of ['lib/section-weights.js', 'lib/generation.js', 'lib/contexts/generation/operations.js', 'lib/contexts/authoring/publication.js']) {
    result.sourceChecks.push({ file, matches: hash(await readFile(file)) === hash(await readFile(join(installed, file))) });
  }
  result.libraries = [];
  for (const library of ['D:/studyhub/.dsh-study', root]) {
    const state = await new Store(library).read();
    result.libraries.push({ root: library, stateHash: hash(JSON.stringify(state)), collectionHashes: Object.fromEntries(Object.entries(state).map(([key, value]) => [key, hash(JSON.stringify(value))])), counts: Object.fromEntries(Object.entries(state).filter(([, value]) => Array.isArray(value)).map(([key, value]) => [key, value.length])) });
  }
  result.launcherHash = hash(await readFile('D:/studyhub/start-dsh-desktop.cmd'));
  result.shortcutHash = hash(await readFile('C:/Users/Lenovo/Desktop/DSH Desktop.lnk'));
  if (phase === 'after') {
    const before = JSON.parse(await readFile(join(evidence, 'before.json'), 'utf8'));
    result.dataUnchanged = result.libraries.every((library, index) => library.stateHash === before.libraries[index].stateHash);
    result.launchUnchanged = result.launcherHash === before.launcherHash && result.shortcutHash === before.shortcutHash;
    if (!result.dataUnchanged || !result.launchUnchanged || result.sourceChecks.some(check => !check.matches) || result.installedVersion !== '3.3.0-scanned.3') throw Error('Desktop upgrade verification failed');
  } else if (result.activeJobs.length) throw Error('Active StudyHub jobs must finish before upgrade');
  result.ok = result.pageErrors.length === 0;
  if (!result.ok) throw Error('StudyHub page errors detected');
} catch (error) { result.ok = false; result.error = error.message.replace(/token=[^\s"\\&]+/g, 'token=[redacted]'); process.exitCode = 1; }
finally {
  if (browser) await browser.close();
  await writeFile(join(evidence, phase + '.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify({ phase, ok: result.ok, version: result.installedVersion, activeJobs: result.activeJobs, dataUnchanged: result.dataUnchanged, error: result.error }));
}
