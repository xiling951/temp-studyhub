/* Actual isolated DSH + browser QA. Local model stand-in only; no real vision claim. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { launchChromium } from './browser.mjs';
import { bootDsh, dshPatch, stopTree } from './dsh-e2e.mjs';
import { scrubSecrets } from './env.mjs';
import { createFakeOpenAI } from './fake-openai.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url)), base = resolve(repo, '..');
const questions = process.argv.includes('--questions');
const retrieval = process.argv.includes('--retrieval');
const vision = process.argv.includes('--vision') || questions;
const noModel = process.argv.includes('--no-model');
const studyPreset = process.argv.includes('--study-preset');
const resume = process.argv.includes('--resume');
const runId = Date.now();
const evidence = join(base, retrieval ? 'evidence/t11-native' : questions ? 'evidence/t10-native' : vision ? 'evidence/t09-native' : noModel ? 'evidence/t09-no-model' : 'evidence/t06-native');
const previous = resume ? JSON.parse(await readFile(join(evidence, 'summary.json'), 'utf8')) : null;
const home = previous?.home || join(base, `test-harness/native-${runId}`), root = previous?.root || join(base, `test-libraries/native-${runId}`), workspace = join(base, `test-harness/workspace-${runId}`);
const bin = join(base, 'test-harness/bin.mjs'), pack = join(base, 'packages/dev', String(runId)), env = { ...scrubSecrets(process.env), DSH_HOME: home, TEMP: join(home, 'study/tmp'), TMP: join(home, 'study/tmp'), SSH_TTY: 'audit', DSH_TELEMETRY_DISABLED: '1', npm_config_offline: 'true' };
let credential = '';
if (vision) {
  const candidates = (await readFile('C:/Users/Lenovo/Desktop/API-key.txt', 'utf8')).match(/sk-[A-Za-z0-9_-]+/g) || [];
  if (candidates.length !== 1) throw new Error('Expected one unambiguous authorized API credential');
  credential = candidates[0];
}
const redact = value => (credential ? value.replaceAll(credential, '[credential]') : value).replace(/token=[^\s"\\&]+/g, 'token=[redacted]');
for (const dir of [home, root, workspace, evidence, pack, env.TEMP]) await mkdir(dir, { recursive: true });
const run = (command, args, cwd = repo) => {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', windowsHide: true, shell: command === 'npm', timeout: 300000 });
  if (result.status !== 0) throw new Error(`QA command failed: ${result.stderr.slice(-1000).replace(/token=\S+/g, 'token=…')}`);
  return result.stdout;
};
const summary = { root, home, startedAt: new Date().toISOString(), consoleErrors: [], pageErrors: [], model: vision ? 'deepseek-official/deepseek-flash-real' : 'local-stand-in-no-paid-call', steps: [] };
let dsh, browser, model, page;
const dismissStartup = async () => {
  const dialog = page.getByRole('dialog');
  const continueButton = dialog.getByRole('button', { name: '继续', exact: true });
  if (await continueButton.isVisible()) await continueButton.click();
  const later = dialog.getByRole('button', { name: '稍后配置', exact: true });
  if (await later.waitFor({ timeout: 3000 }).then(() => true, () => false)) await later.click();
};
try {
  const tgzName = run('npm', ['pack', '--ignore-scripts', '--pack-destination', pack]).trim().split(/\r?\n/).at(-1);
  if (!resume) run(process.execPath, [bin, '--profile', 'studyhub-e2e', '--from-default-profile', 'web', '--dump-config']);
  run(process.execPath, [bin, 'plugin', '--profile', 'studyhub-e2e', 'add', join(pack, tgzName), '--offline']);
  summary.installedSourceVerified = [];
  for (const file of ['lib/runtime.js', 'lib/runtime/builtins.js', 'lib/contexts/bank/operations.js', 'lib/contexts/generation/scanned/visual-questions.js', 'lib/retrieval-index.js', 'lib/contexts/materials/visual-retrieval.js']) {
    const hash = value => createHash('sha256').update(value).digest('hex');
    const sourceHash = hash(await readFile(join(repo, file))), installedHash = hash(await readFile(join(home, 'profiles/studyhub-e2e/node_modules/@ericwang1358/dsh-daily-flashcard', file)));
    if (sourceHash !== installedHash) throw new Error(`Installed QA package is stale: ${file}`);
    summary.installedSourceVerified.push({ file, hash: sourceHash });
  }
  if (retrieval) {
    const extension = run('npm', ['pack', '--ignore-scripts', '--pack-destination', pack], join(repo, 'packages/studyhub-retrieval')).trim().split(/\r?\n/).at(-1);
    run(process.execPath, [bin, 'plugin', '--profile', 'studyhub-e2e', 'add', join(pack, extension), '--offline', '--allow-build=onnxruntime-node', '--allow-build=sharp', '--allow-build=protobufjs']);
    const hash = value => createHash('sha256').update(value).digest('hex');
    summary.installedExtensionHash = hash(await readFile(join(home, 'profiles/studyhub-e2e/node_modules/@ericwang1358/studyhub-retrieval/index.js')));
    if (summary.installedExtensionHash !== hash(await readFile(join(repo, 'packages/studyhub-retrieval/index.js')))) throw new Error('Installed search extension is stale');
  }
  model = await createFakeOpenAI({ port: 43145 });
  const patch = join(base, 'test-harness/scanned.patch.yml');
  await writeFile(patch, YAML.stringify([...dshPatch({ fakeModelUrl: model.url, documentsDirectory: workspace }), ...(studyPreset ? [{ id: 'agent-preset-registry', config: { default: 'study' } }] : []), ...(vision ? [{ id: 'agent-default-model', config: { provider: 'deepseek-official', model: 'deepseek-flash' } }] : []), { id: 'daily-flashcard', config: { libraryRoot: root } }, ...(retrieval ? YAML.parse(await readFile(join(repo, 'packages/studyhub-retrieval/cordis.patch.yml'), 'utf8')) : [])]));
  dsh = await bootDsh(bin, { env: { ...env, STUDYHUB_QA_FAKE_KEY: 'test-only', ...(vision ? { DEEPSEEK_API_KEY: credential } : {}) }, cwd: workspace, patch, port: 43144 });
  browser = await launchChromium(); page = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  page.on('console', message => { if (message.type() === 'error') summary.consoleErrors.push(message.text().replace(/token=\S+/g, 'token=…')); });
  page.on('pageerror', error => summary.pageErrors.push(error.message));
  await page.goto(dsh.url, { waitUntil: 'networkidle' }); await page.locator('.study-app').first().waitFor({ timeout: 90000 });
  await dismissStartup();
  const rpc = (method, payload) => page.evaluate(async ({ method, payload }) => (await (await fetch(`/api/${method}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'client-request', rpcId: crypto.randomUUID(), method, payload }) })).json()).result, { method, payload });
  const sessionId = (await rpc('session/list', { args: { _request: {} } })).value.items[0].sessionId;
  if (studyPreset) {
    const session = (await rpc('session/list', { args: { _request: {} } })).value.items.find(item => item.sessionId === sessionId);
    summary.agentPreset = session.projections?.values?.agentPreset;
    if (summary.agentPreset !== 'study') throw new Error('QA did not enter the study preset');
  }
  const call = async (action, args = {}) => { const result = await rpc('study-workspace/call', { sessionId, action, args }); if (!result.ok) throw new Error(`${action}: ${result.error?.message || JSON.stringify(result)}`); return result.value; };
  const baseline = await call('materials.visual.status'); if (baseline.enabled && !resume) throw new Error('New isolated library feature should be off');
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
  await dismissStartup();
  if (!await page.locator('.study-app').first().isVisible().catch(() => false)) await page.getByRole('button', { name: 'StudyHub', exact: true }).first().click({ timeout: 15000 });
  await page.locator('.study-app').first().waitFor({ timeout: 30000 });
  await page.locator('[data-tour="nav-sources"]').first().click({ force: true }).catch(() => {});
  if (resume) { await page.locator('.page-scope [role="combobox"]').first().click(); await page.getByRole('option', { name: '全部课程', exact: true }).click(); }
  await page.locator(`.source-doc[data-document-key*="${descriptor.documentId}"] .source-main`).first().click({ force: true });
  await page.locator('.scanned-reader').waitFor({ timeout: 30000 });
  await page.locator('.scanned-reader img').first().waitFor({ timeout: 30000 });
  await page.screenshot({ path: join(evidence, 'page200.png'), fullPage: false });
  await page.getByRole('button', { name: '原页对照', exact: true }).click();
  await page.locator('[aria-label="原页对照"] img').waitFor({ timeout: 30000 });
  await page.screenshot({ path: join(evidence, 'original-page200.png'), fullPage: false });
  await page.getByLabel('图文 PDF 页码').fill('2'); await page.locator('[data-visual-block="p2-b0"]').waitFor({ timeout: 30000 });
  await page.screenshot({ path: join(evidence, 'page201.png'), fullPage: false });
  if (vision && !questions && !retrieval) {
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
  if (questions) {
    let question;
    if (resume && previous.publication?.id) question = { jobId: previous.questionJob.jobId };
    else if (resume && previous.questionJob?.result?.refs?.[0]?.kind === 'draft') {
      // Explicit human correction against originals, followed by a fresh native independent review.
      // This is validation of the supported edit/review flow, not an assertion that the first model answer was correct.
      const draft = await call('draft.get', { id: previous.questionJob.result.refs[0].id });
      summary.previousRejectedJob = previous.questionJob;
      for (const card of draft.cards) {
        if (card.visualCitations[0].blockId === 'p1-b2') Object.assign(card, {
          topic: '串联下拉通路', objective: '判断移除接地端晶体管对下拉通路的影响',
          prompt: '观察图 6.14，M₁ 位于链底端并连接地，M_N 位于输出端。假设全部输入为高电平、所有 NMOS 原本导通，输出负载电容 C_L 已充电。若把 M₁ 完全移除，原源漏位置保持开路且不增加任何替代连接，剩余串联链还能通过原来的导通通路把 Out 主动拉低吗？说明 M₁ 在该通路中的作用。忽略漏电及其它未画出的通路。',
          answer: '不能。Out 经 M_N 及其它串联 NMOS 到 M₁ 再到地，M₁ 是这条受输入控制的接地导通路径的一部分。移除 M₁ 并保持开路后，串联路径在接地端断开，剩余晶体管不能通过这条路径使 C_L 向地放电。',
          explanation: '沿原图从 Out 向地追踪，必须经过所有串联 NMOS。M₁ 的下端接地，上端接内部节点；保持源漏开路地移除它，会切断对地导通路径。图中电容不提供替代的直流导通连接，所以不能靠该串联链主动拉低输出。这里不据此推断其它未画出电路或长期漏电造成的最终电压。',
          hint: '先独立判断，再用电路行为检验你的结论。', citations: [], misconception: '把完全移除器件并留下开路，误认为用导线短接源漏。', rubric: '指出不能主动拉低；正确追踪串联链及 M₁ 的接地位置；说明开路导致对地导通路径断开。',
        });
        else Object.assign(card, {
          topic: '反相器与逻辑极性', objective: '判断移除输出反相器是否改变逻辑功能',
          prompt: '观察题图左侧电路。将输入在本题中自行记为 x₁…x_N（这是题目约定，不是原图标号）。现作一个假设性的电路改动：移除最靠近 Out 的三角形器件并用导线连接其原输入与输出位置。根据图中门符号判断改动前后的逻辑功能是否相同，说明该器件的作用，并自行给出一种可以验证结论的输入情况。',
          answer: '不保持。原电路输出为 OR，即 x₁∨…∨x_N，因为 NOR 后接反相器进行第二次取反；旁路反相器后输出为 NOR，即 ¬(x₁∨…∨x_N)。所有输入为 0 时，原 Out 为 0，旁路后 Out 为 1。反相器恢复 OR 输出极性。',
          explanation: '本题旁路改动是构造性思想实验。原图第一个门的外形是 OR 符号，输出端小圆圈表示取反，故该门为 NOR；后级三角形带反相圆圈表示反相器。当输入均为 0 时 NOR 输出为 1，再经反相器得到 0，旁路则输出 1。设输入逻辑或为 S，原输出 ¬(¬S)=S，旁路后为 ¬S，因此两个电路逻辑不同。检查沿信号路径的取反次数可以判断输出极性，不能只按器件数量判断是否可省。',
          hint: '选择能检验你所写逻辑表达式的输入情况。', citations: [], misconception: '只看到减少一级门可能更快，却忽略输出逻辑极性的变化。', rubric: '正确识别 NOR 与后级反相器；写出原 OR 与旁路后 NOR；自行给出有效输入反例；指出反相器改变输出极性。',
        });
      }
      const saved = await call('draft.save', { deck: draft });
      let blocked = false; try { await call('draft.publish.quick', { id: saved.id, draftVersion: saved.draftVersion }); } catch { blocked = true; }
      if (!blocked) throw new Error('Edited answers unexpectedly published with an old review');
      summary.editedPublicationBlocked = true;
      question = await call('generation.visual.review', { draftId: saved.id, draftVersion: saved.draftVersion });
    } else question = await call('generation.visual.start', { documentId: descriptor.documentId, revision: descriptor.revision, blockIds: ['p1-b2', 'p1-b7'], count: 2, kind: 'open', title: '真实教材电路图题组', focus: '判断图中一个具体器件能否移除，说明其作用；依据实际连接关系出题，所需条件必须明确。' });
    let questionJob;
    for (let n = 0; n < 1800; n++) {
      questionJob = (await call('snapshot')).jobs.find(item => item.id === question.jobId);
      if (questionJob && !['queued', 'running', 'cancelling'].includes(questionJob.status)) break;
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    summary.questionJob = questionJob?.contract;
    if (questionJob?.status !== 'complete' || questionJob.contract.result?.completeness !== 'complete') throw new Error(`Real image questions require revision: ${JSON.stringify(questionJob?.contract?.error || questionJob?.contract?.result)}`);
    const snapshot = await call('snapshot'), pending = snapshot.drafts.find(item => item.id === questionJob.draftId);
    if (!pending && !previous?.publication?.id) throw new Error('Native question draft missing');
    summary.draftId = pending?.id || previous.draftId;
    const published = previous?.publication?.id ? previous.publication : await call('draft.publish', { id: pending.id, draftVersion: pending.draftVersion, requireReviewed: true });
    summary.publication = published;
    if (!published.id || published.accepted !== 2 || published.rejected) throw new Error('Native visual publication retained invalid candidates');
    const exportedDeck = await call('deck.get', { id: published.id });
    const importedDeck = await call('draft.import', { text: JSON.stringify(exportedDeck), title: '带图题 JSON 往返检查', course: '扫描教材验收' });
    if (!importedDeck.cards.every(card => card.visualCitations?.every(ref => ref.reviewState === 'pending')) || importedDeck.cards[0].visualCitations[0].imageHash !== exportedDeck.cards[0].visualCitations[0].imageHash) throw new Error('Question JSON round trip lost original evidence or trusted imported review state');
    let importedBlocked = false; try { await call('draft.publish.quick', { id: importedDeck.id, draftVersion: importedDeck.draftVersion }); } catch { importedBlocked = true; }
    if (!importedBlocked) throw new Error('Imported visual draft bypassed independent review');
    summary.jsonRoundTrip = { draftId: importedDeck.id, cards: importedDeck.cards.length, imageHashPreserved: true, reviewReset: true, publicationBlocked: true };
    const run = await call('review.start', { mode: 'path', scope: [{ deckId: published.id }], count: 2, fresh: true });
    if (!run.card.visualCitations?.length || run.card.answer || run.card.explanation || run.card.visualCitations.some(ref => ref.caption || ref.text)) throw new Error('Question front lacks safe images or leaks its answer');
    summary.questionFront = run;
    summary.ocrUnchanged = (await call('snapshot')).sources.find(item => item.id === source.id).text === source.text;
    if (!summary.ocrUnchanged) throw new Error('Question generation changed original OCR');
    await page.reload({ waitUntil: 'networkidle' });
    if (!await page.locator('.study-app').first().isVisible().catch(() => false)) await page.getByRole('button', { name: 'StudyHub', exact: true }).first().click({ timeout: 15000 });
    await page.locator('.study-app').first().waitFor({ timeout: 30000 });
    await page.locator('[data-usage="nav.resume"]').first().click();
    await page.locator('[aria-label="题目图片证据"] img').first().waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: '定位题图原页', exact: true }).first().click();
    await page.getByRole('dialog').getByRole('img').first().waitFor({ timeout: 30000 });
    await page.screenshot({ path: join(evidence, 'original-citation.png') });
    await page.keyboard.press('Escape');
    summary.uiText = (await page.locator('.study-app').innerText()).slice(0, 4000);
    await page.screenshot({ path: join(evidence, 'published-run.png') });
  }
  if (retrieval) {
    const course = '扫描教材验收', sourceIds = (await call('snapshot')).sources.filter(item => item.document?.id === descriptor.documentId).map(item => item.id);
    const ocr = await Promise.all(sourceIds.map(id => call('source.get', { id }).then(source => source.text)));
    summary.retrievalStatus = await call('retrieval.status');
    if (!summary.retrievalStatus.companion.running) throw new Error('Native search companion did not mount');
    await call('retrieval.set', { provider: 'mcp:mcp__studyhub__query_documents' });
    const index = async label => {
      const plan = await call('retrieval.index.plan', { course });
      console.log(JSON.stringify({ stage: label, toIndex: plan.toIndex, pages: plan.pages }));
      const started = await call('retrieval.index.start', { course }); let job;
      for (let n = 0; n < 1800; n++) {
        job = await call('retrieval.index.status');
        if (job && !['queued', 'running', 'cancelling'].includes(job.status)) break;
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (job?.status !== 'complete') throw new Error(`Native index failed: ${JSON.stringify(job)}`);
      summary.steps.push({ name: label, started, plan, job }); return plan;
    };
    await index('real-native-index');
    const beforeNotes = await call('retrieval.index.plan', { course }); if (beforeNotes.toIndex) throw new Error('Index was not incremental');
    const result = await call('retrieval.preview', { sourceIds, query: '晶体管链 NMOS 放电 Out GND', limit: 5 }); summary.retrievalHits = result;
    const hit = result.pages.find(item => item.visual?.citations?.length); if (!hit) throw new Error('Real search hits did not map to original images');
    const ref = hit.visual.citations[0], actual = await call('materials.visual.asset', { documentId: ref.documentId, revision: ref.revision, assetId: ref.assetId });
    if (actual.asset.hash !== ref.imageHash) throw new Error('Search image mapping hash mismatch');
    summary.hitOriginal = await call('materials.visual.preview', { documentId: ref.documentId, revision: ref.revision, page: ref.page });
    if (vision) {
      const scope = { documentId: descriptor.documentId, revision: descriptor.revision }, explain = await call('materials.visual.explain', { ...scope, blockIds: ['p1-b2'] }); let job;
      for (let n = 0; n < 600; n++) { job = (await call('snapshot')).jobs.find(item => item.id === explain.jobId); if (job && !['queued', 'running', 'cancelling'].includes(job.status)) break; await new Promise(resolve => setTimeout(resolve, 500)); }
      if (job?.status !== 'complete') throw new Error('Native explanation prerequisite failed');
      summary.explanationJob = job.contract;
      const notes = (await call('materials.visual.explanations', scope)).notes, note = notes.find(item => item.blockIds.includes('p1-b2') && item.review === 'pending');
      if (!note) throw new Error('Real image explanation was not retained as pending');
      const text = '实施代理对原图核对并修订：图 6.14 展示由 Out 到地的串联 NMOS 下拉链，M_N 位于输出端，M₁ 位于接地端；输出接负载电容 C_L，各内部节点有对地电容。此说明是图像解释，不是教材原文。';
      const reviewed = await call('materials.visual.explanation.review', { ...scope, noteId: note.id, status: 'verified', indexed: true, text });
      const changed = await index('human-selected-note-reindex'); if (changed.toIndex !== 1) throw new Error('Note-only change did not reindex exactly its page');
      const after = await Promise.all(sourceIds.map(id => call('source.get', { id }).then(source => source.text)));
      summary.ocrUnchanged = JSON.stringify(ocr) === JSON.stringify(after); if (!summary.ocrUnchanged) throw new Error('Indexed explanation changed OCR source text');
      summary.reviewedNote = { result: reviewed, operator: 'implementation-agent-reviewed-original', userManuallyApproved: false };
    }
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
  if (dsh) summary.hostDiagnostics = redact(dsh.output().slice(-4000));
  if (page) { summary.pageText = await page.locator('body').innerText().then(text => text.slice(0, 1600), () => 'unavailable'); await page.screenshot({ path: join(evidence, 'failed.png') }).catch(() => {}); }
}
finally {
  await browser?.close(); stopTree(dsh?.child); await model?.close(); summary.finishedAt = new Date().toISOString();
  await writeFile(join(evidence, 'summary.json'), redact(JSON.stringify(summary, null, 2)));
}
console.log(JSON.stringify({ ok: summary.ok, error: summary.error, steps: summary.steps, consoleErrors: summary.consoleErrors, pageErrors: summary.pageErrors }));
if (!summary.ok) process.exitCode = 1;
