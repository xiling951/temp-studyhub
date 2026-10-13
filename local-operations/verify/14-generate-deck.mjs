import { open, inventory, shot, URL_WITH_TOKEN } from './lib.mjs'

const { browser, page, consoleErrors, pageErrors } = await open()
await page.goto(URL_WITH_TOKEN, { waitUntil: 'load', timeout: 60000 })
await page.waitForTimeout(10000)
const tourExit = page.getByRole('button', { name: /以后再说|暂停导览/ }).first()
if (await tourExit.count() > 0) { await tourExit.click().catch(() => {}); await page.waitForTimeout(1200) }
await page.keyboard.press('Escape').catch(() => {})
await page.waitForTimeout(800)

const bodyText = async () => (await page.evaluate(() => document.body.innerText)).replace(/\n{2,}/g, '\n')

await page.getByRole('button', { name: '创建题组', exact: true }).first().click()
await page.waitForTimeout(6000)

// 直接选中当前课程范围里的全部资料
const selectAll = page.getByRole('button', { name: '选择当前范围' }).first()
if (await selectAll.count() > 0) { await selectAll.click().catch(() => {}); await page.waitForTimeout(2500) }
console.log('after 选择当前范围:', (await bodyText()).match(/已选择 \d+ \/ \d+ 份资料/)?.[0] ?? '(not shown)')

// 覆盖强度压到最小：精简
const light = page.getByRole('button', { name: '精简', exact: true }).first()
console.log('精简 button:', await light.count())
if (await light.count() > 0) { await light.click().catch(() => {}); await page.waitForTimeout(2000) }
console.log('after 精简:', (await bodyText()).match(/覆盖强度[：:]\s*\S+/)?.[0] ?? '(not shown)')
console.log('shot:', await shot(page, '14a-ready'))

const generate = page.getByRole('button', { name: /生成并检查题组/ }).first()
console.log('generate button:', await generate.count())
await generate.click()
await page.waitForTimeout(6000)

// 预估/确认层：出现就确认
for (let attempt = 0; attempt < 6; attempt += 1) {
  const confirm = page.getByRole('button', { name: /^(开始生成|确认|继续|开始|好)$/ }).first()
  if (await confirm.count() > 0) {
    console.log('confirming with:', await confirm.innerText().catch(() => '?'))
    await confirm.click().catch(() => {})
    await page.waitForTimeout(4000)
    break
  }
  await page.waitForTimeout(3000)
}
console.log('shot after start:', await shot(page, '14b-started'))
console.log('--- text right after start ---')
console.log((await bodyText()).slice(-900))

// 轮询任务页 / 首页横幅，直到出现结果
const deadline = Date.now() + 8 * 60 * 1000
let last = ''
while (Date.now() < deadline) {
  await page.waitForTimeout(20000)
  const text = await bodyText()
  const interesting = text
    .split('\n')
    .filter((line) => /正在|出题|草稿|失败|错误|用量|token|完成|发布|覆盖|题|模型|轮/.test(line))
    .slice(-16)
    .join('\n')
  if (interesting !== last) {
    console.log(`--- t+${Math.round((Date.now() - (deadline - 8 * 60 * 1000)) / 1000)}s ---`)
    console.log(interesting)
    last = interesting
  }
  if (/待发布|草稿已生成|检查并发布草稿|生成完成/.test(text)) break
  if (/生成失败|出题失败|余额|限流|无可用模型|API key/i.test(text)) break
}

console.log('=== FINAL ===')
console.log((await bodyText()).slice(-1600))
console.log('shot:', await shot(page, '14c-final'))
console.log('errors:', JSON.stringify(consoleErrors.slice(0, 10)), JSON.stringify(pageErrors.slice(0, 10)))
await browser.close()
