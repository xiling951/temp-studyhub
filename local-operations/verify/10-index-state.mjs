import { open, shot, URL_WITH_TOKEN } from './lib.mjs'

const { browser, page, consoleErrors, pageErrors } = await open()
await page.goto(URL_WITH_TOKEN, { waitUntil: 'load', timeout: 60000 })
await page.waitForTimeout(10000)
const tourExit = page.getByRole('button', { name: /以后再说|暂停导览/ }).first()
if (await tourExit.count() > 0) { await tourExit.click().catch(() => {}); await page.waitForTimeout(1200) }
await page.keyboard.press('Escape').catch(() => {})
await page.waitForTimeout(800)

await page.getByRole('button', { name: /^学习库位置/ }).first().click()
await page.waitForTimeout(4000)
await page.getByRole('button', { name: '检索扩展', exact: true }).first().click()
await page.waitForTimeout(5000)

const text = (await page.evaluate(() => document.body.innerText)).replace(/\n{2,}/g, '\n')
console.log('=== 检索扩展 状态 ===')
console.log(text.split('\n').filter((line) => /索引|检索扩展|页|已建好|建立|课程/.test(line)).slice(0, 22).join('\n'))
console.log('shot:', await shot(page, '10-index-built'))
console.log('console errors:', JSON.stringify(consoleErrors.slice(0, 8)))
console.log('page errors:', JSON.stringify(pageErrors.slice(0, 8)))
await browser.close()
