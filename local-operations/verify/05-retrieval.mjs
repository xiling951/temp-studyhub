import { open, inventory, shot, URL_WITH_TOKEN } from './lib.mjs'

const { browser, page, consoleErrors, pageErrors } = await open()
await page.goto(URL_WITH_TOKEN, { waitUntil: 'load', timeout: 60000 })
await page.waitForTimeout(10000)

// 关掉可能出现的导览覆盖层
const tourExit = page.getByRole('button', { name: /以后再说|暂停导览/ }).first()
if (await tourExit.count() > 0) { await tourExit.click().catch(() => {}); await page.waitForTimeout(1500) }

// 1) 「添加资料」里的大教材卡片：检索扩展的状态应该在这里可见
await page.getByRole('button', { name: '添加资料' }).first().click()
await page.waitForTimeout(4000)
let info = await inventory(page)
console.log('=== 添加资料 ===')
console.log('HEADINGS:', JSON.stringify(info.headings))
console.log('BUTTONS:', JSON.stringify(info.buttons))
console.log(info.bodyText.slice(1200, 3600))
console.log('shot:', await shot(page, '05a-add-source'))
// 关掉对话框
await page.keyboard.press('Escape')
await page.waitForTimeout(2000)

// 2) StudyHub 自己的设置页：找一个含「检索」的分区
const settingsButtons = page.getByRole('button', { name: '设置', exact: true })
const count = await settingsButtons.count()
console.log('设置 buttons:', count)
for (let index = 0; index < count; index += 1) {
  await settingsButtons.nth(index).click().catch(() => {})
  await page.waitForTimeout(3500)
  const text = await page.evaluate(() => document.body.innerText)
  if (/检索|大教材|MinerU|索引/.test(text)) {
    console.log(`--- settings #${index} mentions 检索/大教材 ---`)
    console.log(text.replace(/\n{2,}/g, '\n').slice(0, 3000))
    console.log('shot:', await shot(page, '05b-settings-retrieval'))
    break
  }
  console.log(`settings #${index}: no retrieval mention`)
}

console.log('--- ERRORS ---')
console.log('console:', JSON.stringify(consoleErrors.slice(0, 12)))
console.log('pageerror:', JSON.stringify(pageErrors.slice(0, 12)))
await browser.close()
