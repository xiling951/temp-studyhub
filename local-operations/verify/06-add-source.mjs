import { open, inventory, shot, URL_WITH_TOKEN } from './lib.mjs'

const { browser, page, consoleErrors, pageErrors } = await open()
await page.goto(URL_WITH_TOKEN, { waitUntil: 'load', timeout: 60000 })
await page.waitForTimeout(10000)
const tourExit = page.getByRole('button', { name: /以后再说|暂停导览/ }).first()
if (await tourExit.count() > 0) { await tourExit.click().catch(() => {}); await page.waitForTimeout(1200) }

await page.getByRole('button', { name: /^资料/ }).first().click()
await page.waitForTimeout(3500)
await page.getByRole('button', { name: '添加资料', exact: true }).first().click()
await page.waitForTimeout(5000)

const dialogs = await page.evaluate(() =>
  [...document.querySelectorAll('[role="dialog"], dialog, [aria-modal="true"]')].map((element) =>
    element.innerText.replace(/\n{2,}/g, '\n').slice(0, 3000),
  ),
)
console.log('=== dialog count:', dialogs.length, '===')
dialogs.forEach((text, index) => console.log(`--- dialog ${index} ---\n${text}`))

const info = await inventory(page)
console.log('=== BUTTONS ===')
console.log(JSON.stringify(info.buttons))
console.log('=== retrieval mentions in page ===')
const hits = await page.evaluate(() => {
  const text = document.body.innerText
  const lines = text.split('\n').filter((line) => /检索|索引|大教材|MinerU|扩展/.test(line))
  return lines.slice(0, 40)
})
console.log(JSON.stringify(hits, null, 1))
console.log('shot:', await shot(page, '06-add-source-dialog'))
console.log('--- ERRORS ---')
console.log('console:', JSON.stringify(consoleErrors.slice(0, 12)))
console.log('pageerror:', JSON.stringify(pageErrors.slice(0, 12)))
await browser.close()
