import { open, shot, URL_WITH_TOKEN } from './lib.mjs'

const { browser, page, consoleErrors, pageErrors } = await open()
await page.goto(URL_WITH_TOKEN, { waitUntil: 'load', timeout: 60000 })
await page.waitForTimeout(10000)
const tourExit = page.getByRole('button', { name: /以后再说|暂停导览/ }).first()
if (await tourExit.count() > 0) { await tourExit.click().catch(() => {}); await page.waitForTimeout(1200) }
await page.keyboard.press('Escape').catch(() => {})
await page.waitForTimeout(800)
const bodyText = async () => (await page.evaluate(() => document.body.innerText)).replace(/\n{2,}/g, '\n')

// 打开刚生成的草稿
const openDraft = page.getByRole('button', { name: /打开草稿/ }).first()
if (await openDraft.count() > 0) { await openDraft.click() } else {
  const pending = page.getByRole('button', { name: /检查并发布草稿|待发布/ }).first()
  if (await pending.count() > 0) await pending.click()
}
await page.waitForTimeout(7000)
console.log('=== DRAFT VIEW ===')
const draftText = await bodyText()
console.log(draftText.slice(400, 4200))
console.log('shot:', await shot(page, '15a-draft'))

// 任务控制台：看这次出题的模型用量/速度
await page.getByRole('button', { name: '任务', exact: true }).first().click().catch(() => {})
await page.waitForTimeout(6000)
const jobText = await bodyText()
const lines = jobText.split('\n').filter((line) => /出题|生成|用量|token|TTFT|TPS|首 token|输出速度|题|完成|轮|覆盖|模型|秒|分/.test(line))
console.log('=== JOB CONSOLE (filtered) ===')
console.log(lines.slice(0, 60).join('\n'))
console.log('shot:', await shot(page, '15b-job-console'))
console.log('errors:', JSON.stringify(consoleErrors.slice(0, 8)), JSON.stringify(pageErrors.slice(0, 8)))
await browser.close()
