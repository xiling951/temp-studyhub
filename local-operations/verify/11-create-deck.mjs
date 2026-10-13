import { open, inventory, shot, URL_WITH_TOKEN } from './lib.mjs'

const { browser, page, consoleErrors, pageErrors } = await open()
await page.goto(URL_WITH_TOKEN, { waitUntil: 'load', timeout: 60000 })
await page.waitForTimeout(10000)
const tourExit = page.getByRole('button', { name: /以后再说|暂停导览/ }).first()
if (await tourExit.count() > 0) { await tourExit.click().catch(() => {}); await page.waitForTimeout(1200) }
await page.keyboard.press('Escape').catch(() => {})
await page.waitForTimeout(800)

// 创建题组 页面：先看清表单控件，真正的生成在下一步运行
await page.getByRole('button', { name: '创建题组', exact: true }).first().click()
await page.waitForTimeout(6000)

const info = await inventory(page)
console.log('HEADINGS:', JSON.stringify(info.headings))
console.log('BUTTONS:', JSON.stringify(info.buttons))
const text = (await page.evaluate(() => document.body.innerText)).replace(/\n{2,}/g, '\n')
console.log('--- TEXT (600..4200) ---')
console.log(text.slice(600, 4200))
console.log('shot:', await shot(page, '11-create-deck'))
console.log('errors:', JSON.stringify(consoleErrors.slice(0, 8)), JSON.stringify(pageErrors.slice(0, 8)))
await browser.close()
