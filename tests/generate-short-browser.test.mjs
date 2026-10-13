/* global document, window -- page.evaluate callbacks run in the browser */
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPreview } from '../scripts/build.mjs';
import { createPreviewServer } from '../scripts/preview-server.mjs';
import { createFakeModel } from '../scripts/fake-model.mjs';
import { launchChromium } from '../scripts/qa/browser.mjs';
import { scrubProcessEnv } from '../scripts/qa/env.mjs';
import { drainLayoutStability, judgeLayoutStability } from '../scripts/qa/layout-stability.mjs';
import { frames, openPage, settleAnimations, until } from '../scripts/qa/layout-late.mjs';
import { StudyService } from '../lib/service.js';

/* 创建题组 in the browser preview on a seeded library: the page opens with the current course's documents that have no question ticked and says why, the main path is one line
   (types, strength, course) with 前往设置, the plan (rounds, tokens) is said once under the form, everything optional is in 更多选项, and 前往设置 lands on 出题偏好.
   At 1280 and 420 px, no sideways scroll, no layout shift. EXAM_PREP_SHOTS-style switch: GENERATE_SHOTS=<dir> writes screenshots. */

const SHOTS = process.env.GENERATE_SHOTS || '';
const STAMP = '2026-10-01T08:00:00.000Z';
const body = n => `## 第 ${n} 节\n\n${`数据库索引加快查找，事务保证一致性，范式减少冗余。第 ${n} 节的内容。`.repeat(60)}`;
const note = (id, title, courses, n) => ({ id, title, text: body(n), createdAt: STAMP, courses, chars: body(n).length, excerpt: body(n).slice(0, 160) });

async function seed(root) {
  await mkdir(root, { recursive: true });
  const service = new StudyService(root);
  await service.call('snapshot');
  await service.store.update(state => {
    state.sources.push(note('n1', '索引与查询.md', ['数据库'], 1), note('n2', '事务与并发.md', ['数据库'], 2), note('n3', '范式.md', ['数据库'], 3), note('n4', '路由.md', ['网络'], 4));
    // 范式.md already has questions: a published deck cites it.
    state.decks.push({ id: 'd1', title: '范式小测', course: '数据库', cards: [{ id: 'c1', kind: 'flashcard', topic: '范式', prompt: '什么是第三范式？', answer: '消除传递依赖', explanation: '范式减少冗余。',
      citations: [{ sourceId: 'n3', quote: '范式减少冗余' }] }] });
    state.focus = { ...(state.focus || {}), course: '数据库', mode: 'class' };
  });
  service.dispose?.();
}

async function start(distDir) {
  scrubProcessEnv();
  const base = await mkdtemp(join(tmpdir(), 'study-generate-short-'));
  const root = join(base, 'library');
  await seed(root);
  const server = await createPreviewServer({ libraryRoot: root, home: join(base, 'home'), port: 0, model: createFakeModel({ latencyMs: 20 }), distDir });
  return { server, base, close: async () => { await server.close(); await rm(base, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 }); } };
}

async function openApp(browser, running, { lang = 'zh', width = 1280, height = 900 } = {}) {
  const opened = await openPage(browser, running, { lang, theme: 'dark', width, height });
  await opened.page.goto(running.server.url);
  await opened.page.locator('aside, nav').first().waitFor({ timeout: 30000 });
  return opened;
}

const overflow = page => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false }); };
// The whole page, however tall: the viewport is made tall for the shot (the shell scrolls inside it) and put back.
const shotForm = async (page, name) => {
  if (!SHOTS) return;
  const size = page.viewportSize();
  await page.setViewportSize({ width: size.width, height: 2400 });
  await frames(page, 3);
  await page.screenshot({ path: join(SHOTS, `${name}.png`), fullPage: false });
  await page.setViewportSize(size);
};
const goGenerate = async page => {
  await page.locator('[data-tour="nav-generate"]').first().dispatchEvent('click');
  await page.locator('.generate-page form').waitFor({ timeout: 30000 });
};

test('创建题组 opens ticked with a reason, the main path is one line, the plan is said once, and 前往设置 lands on 出题偏好, at 1280 and 420 px', { timeout: 900000 }, async t => {
  let browser;
  try { browser = await launchChromium(); } catch (error) { t.skip(`no Chromium to measure with: ${String(error.message).split('\n')[0]}`); return; }
  const dist = await mkdtemp(join(tmpdir(), 'study-generate-short-dist-'));
  await buildPreview({ outdir: dist });
  const running = await start(dist);
  try {
    for (const width of [1280, 420]) {
      const { page, errors, context } = await openApp(browser, running, { width });
      await goGenerate(page);
      await settleAnimations(page);
      await frames(page, 4);
      await drainLayoutStability(page);
      assert.ok(await overflow(page) <= 0, `${width}px: no sideways scroll`);

      // opened ticked: the two notes of the current course that have no question; the one with a deck and the other course are not
      const ticked = page.locator('.source-picker__item.is-selected');
      await until(async () => (await ticked.count()) === 2, 'the two documents without questions are ticked');
      const names = await ticked.locator('strong').allInnerTexts();
      assert.deepEqual(names.sort(), ['事务与并发', '索引与查询'], 'the course\'s documents without questions');
      const reason = page.locator('[data-opening-reason]');
      assert.match(await reason.innerText(), /已选中「数据库」里还没出过题的 2 份资料。\s*没选：已出过题的 1 份。/, 'and the line says why, and what it left out');

      // the main path: one line, one link, no control
      const plan = page.locator('[data-generate-plan]');
      assert.match(await plan.innerText(), /单选测验 · 覆盖强度：标准 · 课程：数据库/);
      assert.equal(await plan.locator('input, select, textarea').count(), 0, 'nothing to fill in on the main path');
      assert.equal(await page.locator('.generate-more').evaluate(element => element.open), false, '更多选项 is closed');
      assert.equal(await page.locator('#generate-focus').isVisible(), false, 'the topic box is not on the main path');
      assert.equal(await page.getByText('难度', { exact: true }).first().isVisible(), false, 'nor the difficulty');

      // the plan, said once: the estimate and the count under the form, not in the fold
      await until(async () => (await page.locator('[data-generate-estimate] [data-token-estimate][data-status="ready"]').count()) > 0, 'the estimate', { timeoutMs: 60000 });
      const summary = await page.locator('.generate-summary').innerText();
      const count = /出 (\d+) 题/.exec(summary)?.[1];
      assert.ok(count, `the summary line says how many questions: ${summary}`);
      const formText = await page.locator('.generate-page form').innerText();
      assert.equal((formText.match(new RegExp(`(?<![\\d.])${count} (?:题|道题)`, 'g')) || []).length, 1, `the planned ${count} questions are said once on the page`);
      assert.match(await page.locator('[data-generate-estimate]').innerText(), /覆盖 \d+\/\d+ 个(?:小节|片段)，(?:分 \d+ 轮|一轮出完)，预计/);
      assert.doesNotMatch(await page.locator('.quality-note').innerText(), /发布时/, 'no promise of a check at publish');
      await shot(page, `main-${width}`);
      await shotForm(page, `main-form-${width}`);
      const mainVerdict = judgeLayoutStability(await drainLayoutStability(page), { maxCls: 0.1 });
      assert.ok(mainVerdict.ok, `${width}px main path: ${mainVerdict.message}`);

      // everything optional is one click away, inside the fold
      await page.locator('.generate-more > summary').click();
      await page.locator('#generate-focus').waitFor({ state: 'visible', timeout: 10000 });
      for (const label of ['难度', '语言', '公式写法', '题组名称（可选）']) assert.ok(await page.getByText(label, { exact: false }).first().isVisible(), `${label} is in the fold`);
      assert.ok(await overflow(page) <= 0, `${width}px: no sideways scroll with the fold open`);
      assert.equal(await page.locator('[data-coverage-consequence]').count(), 0, 'the fold repeats no estimate line');
      await shot(page, `fold-${width}`);
      await shotForm(page, `fold-form-${width}`);

      // 前往设置 lands on 出题偏好 (and the new default is there)
      await page.locator('[data-open-settings="settings-generation"]').click();
      await page.locator('[data-tour="settings-generation"]').waitFor({ state: 'visible', timeout: 30000 });
      assert.equal(await page.locator('select[name="coverageLevel"], [name="coverageLevel"]').count() > 0, true, 'the 覆盖强度 default is on that page');
      await shot(page, `settings-${width}`);

      // back on the page: the choices stand, the line is still true
      await goGenerate(page);
      assert.equal(await page.locator('.source-picker__item.is-selected').count(), 2, 'the ticks survived the detour');
      assert.deepEqual(errors, []);
      await context.close();
    }
  } finally { await running.close(); await browser.close(); await rm(dist, { recursive: true, force: true }); }
});

test('practice suggestions carry the current scope and discard late or edited-scope results; picking a refinement preserves its peers and applying settings preserves the scope', { timeout: 180000 }, async t => {
  let browser;
  try { browser = await launchChromium(); } catch (error) { t.skip(`no Chromium to verify the assist with: ${String(error.message).split('\n')[0]}`); return; }
  const dist = await mkdtemp(join(tmpdir(), 'study-generate-assist-dist-'));
  await buildPreview({ outdir: dist });
  const running = await start(dist);
  let releaseDelayed;
  const delayed = new Promise(resolve => { releaseDelayed = resolve; });
  try {
    const { page, errors, context } = await openApp(browser, running);
    const calls = [], asked = [];
    page.on('request', request => {
      if (request.url().endsWith('/api/call')) calls.push(request.postDataJSON());
    });
    const oldScope = 'CMOS反相器静态性能与工作状态';
    const currentScope = 'CMOS反相器静态和动态指标及其影响因素';
    const refined = ['静态指标的计算', '工作状态判定', '动态延迟与影响因素'];
    // UI interaction fixtures only: model results are held/released at the HTTP
    // boundary. The preview uses createFakeModel and never a real paid API.
    await page.route('**/api/call', async route => {
      const payload = route.request().postDataJSON();
      if (payload.action !== 'generate.suggest') return route.fallback();
      const index = asked.push(payload.args) - 1;
      if (index === 0) await delayed;
      const value = index === 0
        ? { source: 'model', focus: ['旧范围建议不应出现'], coverage: 'full', difficulty: 'advanced', kind: 'quiz', why: '过期结果。' }
        : { source: 'model', focus: refined, coverage: 'lean', difficulty: 'foundation', kind: 'flashcard', why: '围绕当前反相器范围练习。' };
      await route.fulfill({ json: { ok: true, value } });
    });
    await goGenerate(page);
    await page.locator('.generate-more > summary').click();
    const scope = page.locator('#generate-focus');
    await scope.fill(oldScope);
    await until(() => calls.some(call => call.action === 'usage.estimate' && call.args.feature === 'suggest' && call.args.focus === oldScope), 'the scoped assist estimate');
    await page.locator('[data-generate-assist]').click();
    await until(() => asked.length === 1, 'the delayed assist request');
    assert.equal(asked[0].focus, oldScope);
    assert.deepEqual([...asked[0].sourceIds].sort(), ['n1', 'n2']);
    assert.equal(asked[0].course, '数据库');
    const estimate = calls.findLast(call => call.action === 'usage.estimate' && call.args.feature === 'suggest' && call.args.focus === oldScope).args;
    const { feature, ...estimateArgs } = estimate;
    assert.equal(feature, 'suggest');
    assert.deepEqual(estimateArgs, asked[0], 'the estimate and actual assist use the same scope, sources and course');

    // No second ask yet: an old result must be rejected because the scope changed,
    // rather than merely because a later request happened to replace its token.
    await scope.fill(currentScope);
    assert.equal(await page.locator('.generate-assist__result').count(), 0, 'editing the scope hides its pending result immediately');
    const oldResponse = page.waitForResponse(response => response.url().endsWith('/api/call') && response.request().postDataJSON().action === 'generate.suggest');
    releaseDelayed();
    await (await oldResponse).finished();
    await frames(page, 4);
    assert.equal(await scope.inputValue(), currentScope);
    assert.equal(await page.locator('.generate-assist__result').count(), 0, 'the obsolete response never fills the changed form');
    assert.equal(await page.getByRole('button', { name: '按建议设置', exact: true }).count(), 0, 'obsolete settings cannot be applied');
    assert.equal(await page.getByRole('button', { name: '旧范围建议不应出现', exact: true }).count(), 0);

    await page.locator('[data-generate-assist]').click();
    await page.getByRole('button', { name: refined[0], exact: true }).waitFor();
    assert.equal(asked.length, 2);
    assert.equal(asked[1].focus, currentScope);
    assert.deepEqual(await page.locator('.generate-suggestion button').allInnerTexts(), refined);
    await page.getByRole('button', { name: refined[0], exact: true }).click();
    const refinedScope = `${currentScope}；${refined[0]}`;
    assert.equal(await scope.inputValue(), refinedScope, 'a refinement appends to the learner\'s own words');
    assert.deepEqual(await page.locator('.generate-suggestion button').allInnerTexts(), refined, 'picking a same-scope chip keeps the other refinements available');
    assert.equal(await page.getByRole('button', { name: refined[0], exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(asked.length, 2, 'picking a refinement does not issue another model call');

    await page.getByRole('button', { name: '按建议设置', exact: true }).click();
    assert.equal(await scope.inputValue(), refinedScope, 'applying coverage/difficulty/type leaves the learner\'s scope intact');
    assert.equal(await page.getByRole('button', { name: '已按建议设置', exact: true }).isDisabled(), true);
    assert.equal(await page.locator('[role="group"][aria-label="覆盖强度"] button[aria-pressed="true"]').innerText(), '精简');
    assert.equal(await page.locator('[role="group"][aria-label="难度"] button[aria-pressed="true"]').innerText(), '基础理解');
    assert.equal(await page.locator('input[name="kinds-flashcard"]').isChecked(), true);
    assert.equal(await page.locator('input[name="kinds-quiz"]').isChecked(), false);

    await scope.fill('只练习输入输出电压与噪声容限');
    assert.equal(await page.locator('.generate-assist__result').count(), 0, 'editing a completed scope also hides all its suggestions immediately');
    assert.equal(await page.getByRole('button', { name: '按建议设置', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: '已按建议设置', exact: true }).count(), 0);
    assert.equal(asked.length, 2, 'manual edits never ask the model automatically');
    assert.ok(!calls.some(call => call.action === 'generate'), 'this assist never starts question generation');
    assert.deepEqual(errors, []);
    await context.close();
  } finally { releaseDelayed(); await running.close(); await browser.close(); await rm(dist, { recursive: true, force: true }); }
});
