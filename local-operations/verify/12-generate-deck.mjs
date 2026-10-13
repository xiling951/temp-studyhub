import { open, inventory, shot, URL_WITH_TOKEN } from './lib.mjs'

const { browser, page, consoleErrors, pageErrors } = await open()
await page.goto(URL_WITH_TOKEN, { waitUntil: 'load', timeout: 60000 })
await page.waitForTimeout(10000)
const tourExit = page.getByRole('button', { name: /以后再说|暂停导览/ }).first()
if (await tourExit.count() > 0) { await tourExit.click().catch(() => {}); await page.waitForTimeout(1200) }
await page.keyboard.press('Escape').catch(() => {})
await page.waitForTimeout(800)

await page.getByRole('button', { name: '创建题组', exact: true }).first().click()
await page.waitForTimeout(6000)

// 「01 / 选择资料」里的资料是复选框
const boxes = page.locator('input[type="checkbox"]')
const boxCount = await boxes.count()
console.log('checkboxes:', boxCount)
for (let index = 0; index < boxCount; index += 1) {
  const box = boxes.nth(index)
  if (!(await box.isChecked().catch(() => false))) { await box.check({ force: true }).catch(() => {}); }
}
await page.waitForTimeout(2500)

// 覆盖强度选「精简」，把真实模型的用量压到最小
const light = page.getByRole('button', { name: '精简', exact: true }).first()
if (await light.count() > 0) { await light.click().catch(() => {}); await page.waitForTimeout(1500) }

const before = await inventory(page)
console.log('BEFORE BUTTONS:', JSON.stringify(before.buttons.slice(-14)))
console.log('text before:', (await page.evaluate(() => document.body.innerText)).replace(/\n{2,}/g, '\n').slice(-700))
console.log('shot:', await shot(page, '12a-before-generate'))

const generate = page.getByRole('button', { name: /生成并检查题组/ }).first()
console.log('generate button:', await generate.count() > 0)
await generate.click()
console.log('clicked 生成并检查题组 — waiting for the model chain…')

const deadline = Date.now() + 9 * 60 * 1000
let last = ''
while (Date.now() < deadline) {
  await page.waitForTimeout(20000)
  const text = (await page.evaluate(() => document.body.innerText)).replace(/\n{2,}/g, '\n')
  const interesting = text
    .split('\n')
    .filter((line) => /正在|生成|草稿|题|失败|错误|模型|用量|token|完成|发布|覆盖/.test(line))
    .slice(-14)
    .join('\n')
  if (interesting !== last) {
    console.log(`--- t+${Math.round((Date.now() - (deadline - 9 * 60 * 1000)) / 1000)}s ---`)
    console.log(interesting)
    last = interesting
  }
  if (/草稿已生成|待发布|检查并发布草稿|生成完成|已发布/.test(text)) break
  if (/生成失败|出错了|无法连接|API key|余额|401|403/.test(text)) break
}

const finalText = (await page.evaluate(() => document.body.innerText)).replace(/\n{2,}/g, '\n')
console.log('=== FINAL (tail) ===')
console.log(finalText.slice(-1500))
console.log('shot:', await shot(page, '12b-after-generate'))
console.log('errors:', JSON.stringify(consoleErrors.slice(0, 10)), JSON.stringify(pageErrors.slice(0, 10)))
await browser.close()
