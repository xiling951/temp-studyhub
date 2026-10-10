/* Real native model regression for whole-book topic coverage, always in an isolated library. */
import { spawnSync } from 'node:child_process';
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import YAML from 'yaml';
import { Store } from '../../lib/store.js';
import { launchChromium } from './browser.mjs';
import { bootDsh, stopTree } from './dsh-e2e.mjs';
import { scrubSecrets } from './env.mjs';

const base = resolve('..'), stamp = Date.now();
const home = join(base, 'test-harness/final-restore-1791631596795');
const root = join(base, `test-libraries/mos-quality-${stamp}`), evidence = join(base, `evidence/mos-quality-${stamp}`);
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
const env = { ...scrubSecrets(process.env), DSH_HOME: home, DSH_TELEMETRY_DISABLED: '1', SSH_TTY: 'audit' };
const candidates = (await readFile('C:/Users/Lenovo/Desktop/API-key.txt', 'utf8')).match(/sk-[A-Za-z0-9_-]+/g) || [];
if (candidates.length !== 1) throw Error('Expected one authorized native credential');
const redact = value => value.replaceAll(candidates[0], '[credential]').replace(/token=[^\s"\\&]+/g, 'token=[redacted]');
let dsh, browser;
const result = { root, home, version, startedAt: new Date().toISOString(), actualNativeModel: true, countRequested: 30, pageErrors: [] };
try {
  await mkdir(evidence, { recursive: true });
  await cp(join(base, 'test-libraries/final-restore-1791631596795'), root, { recursive: true, errorOnExist: true, force: false });
  const cli = spawnSync(process.execPath, [join(base, 'test-harness/bin.mjs'), 'plugin', '--profile', 'studyhub-e2e', 'add', join(base, `packages/${version}/ericwang1358-dsh-daily-flashcard-${version}.tgz`), '--offline'], { env, encoding: 'utf8', windowsHide: true, timeout: 300000 });
  if (cli.status !== 0) throw Error('Native isolated installer failed');
  for (const file of ['lib/section-weights.js', 'lib/generation.js', 'lib/contexts/generation/operations.js']) {
    const hash = data => createHash('sha256').update(data).digest('hex');
    if (hash(await readFile(file)) !== hash(await readFile(join(home, 'profiles/studyhub-e2e/node_modules/@ericwang1358/dsh-daily-flashcard', file)))) throw Error('Stale native package');
  }
  const patch = join(evidence, 'native.patch.yml');
  await writeFile(patch, YAML.stringify([
    { id: 'agent-default-model', config: { provider: 'deepseek-official', model: 'deepseek-flash' } },
    { id: 'agent-preset-registry', config: { default: 'study' } },
    { id: 'workspace-controller', config: { documentsDirectory: join(home, 'workspace') } },
    { id: 'daily-flashcard', config: { libraryRoot: root } },
  ]));
  dsh = await bootDsh(join(base, 'test-harness/bin.mjs'), { env: { ...env, DEEPSEEK_API_KEY: candidates[0] }, cwd: join(home, 'workspace'), patch, port: 43144 });
  browser = await launchChromium(); const page = await browser.newPage();
  page.on('pageerror', error => result.pageErrors.push(redact(error.message)));
  await page.goto(dsh.url, { waitUntil: 'networkidle' });
  const intro = page.getByRole('dialog').getByRole('button', { name: '继续', exact: true });
  if (await intro.isVisible()) await intro.click();
  const later = page.getByRole('button', { name: '稍后配置', exact: true });
  if (await later.waitFor({ timeout: 3000 }).then(() => true, () => false)) await later.click();
  const rpc = (method, payload) => page.evaluate(async ({ method, payload }) => (await (await fetch('/api/' + method, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload }) })).json()).result, { method, payload });
  const sessionId = (await rpc('session/list', { args: { _request: {} } })).value.items[0].sessionId;
  const call = async (action, args = {}) => { const response = await rpc('study-workspace/call', { sessionId, action, args }); if (!response.ok) throw Error(response.error?.message); return response.value; };
  await call('binding.set', { root, provider: 'deepseek-official', model: 'deepseek-flash', reasoningEffort: 'off' });
  const snapshot = await call('snapshot'), document = snapshot.sources.find(source => source.id.includes('eadf9'))?.document;
  const sourceIds = snapshot.sources.filter(source => source.document?.materialRevision === document?.materialRevision).map(source => source.id);
  if (sourceIds.length !== 571) throw Error('Expected current 571 genuine OCR sources');
  result.inputPages = sourceIds.length;
  const before = await new Store(root).read();
  result.originalSourcesHash = createHash('sha256').update(JSON.stringify(before.sources)).digest('hex');
  const started = await call('generate', { sourceIds, title: 'MOS · 修复后真实验收', course: '数字集成电路', focus: 'MOS管器件特性、电路计算；考器件结构、工作区、阈值与体效应、电流、电容、短沟道效应及MOS电路中的器件作用。排除参考文献编号、阅读书目、期刊会议、全书组织及与MOS器件无关的系统架构题。', count: 30, coverageLevel: 'full', autoComplete: true, kind: 'quiz', kinds: ['quiz', 'multi', 'flashcard', 'open', 'cloze'], tokenBudget: 400000, performance: { concurrency: 3, batchSize: 5, jobTimeoutMinutes: 20, fillRounds: 1, effortPlanning: 'low', effortReview: 'low', effortWriting: 'low', effortRepair: 'low' } });
  result.jobId = started.jobId; let job, last = '';
  for (let n = 0; n < 1500; n++) {
    job = (await call('snapshot')).jobs.find(item => item.id === started.jobId);
    const current = JSON.stringify({ status: job?.status, stage: job?.stage, saved: job?.savedCount, selected: job?.sourceIds?.length });
    if (current !== last) { console.log(current); last = current; }
    if (job && !['queued', 'running', 'cancelling', 'pausing', 'paused'].includes(job.status)) break;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  result.job = job;
  const state = await new Store(root).read(), draft = state.drafts.find(draft => draft.id === job?.draftId);
  result.ocrUnchanged = createHash('sha256').update(JSON.stringify(state.sources)).digest('hex') === result.originalSourcesHash;
  if (!draft) throw Error(job?.stage || 'No draft returned');
  result.topicScope = draft.editorial.generation.topicScope;
  result.sourcePages = draft.editorial.generation.sourceIds.map(id => +id.split('-p').at(-1));
  result.cards = draft.cards.map(card => ({ id: card.id, topic: card.topic, objective: card.objective, kind: card.kind, pages: card.citations.map(ref => +ref.sourceId.split('-p').at(-1)) }));
  result.topicChecks = draft.editorial.audits.flatMap(audit => audit.checks || []).map(check => ({ cardId: check.cardId, topicRelevance: check.topicRelevance, sourceSupport: check.sourceSupport }));
  await writeFile(join(evidence, 'draft-private.json'), redact(JSON.stringify(draft, null, 2)));
  if (!result.ocrUnchanged || !result.topicScope || result.sourcePages.includes(564) || result.sourcePages.includes(112)) throw Error('Topic scope regression');
  result.countGenerated = draft.cards.length;
  result.ok = job.status === 'complete' && draft.cards.length === 30 && result.pageErrors.length === 0;
  if (!result.ok) throw Error('Native run did not produce 30 approved questions; inspect evidence');
} catch (error) { result.error = redact(error.message); result.ok = false; process.exitCode = 1; }
finally {
  if (browser) await browser.close(); if (dsh) await stopTree(dsh.child);
  await writeFile(join(evidence, 'summary.json'), redact(JSON.stringify(result, null, 2)));
  console.log(JSON.stringify({ evidence, ok: result.ok, error: result.error, count: result.countGenerated }));
}
