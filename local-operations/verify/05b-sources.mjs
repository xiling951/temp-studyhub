import { open, inventory, shot, URL_WITH_TOKEN } from './lib.mjs'

const { browser, page, consoleErrors, pageErrors } = await open()
await page.goto(URL_WITH_TOKEN, { waitUntil: 'load', timeout: 60000 })
await page.waitForTimeout(10000)

const tourExit = page.getByRole('button', { name: /以后再说|暂停导览/ }).first()
if (await tourExit.count() > 0) { await tourExit.click().catch(() => {}); await page.waitForTimeout(1500) }

const log = (label, value) => console.log(`=== ${label} ===\n${value}`)

// 资料页
const sources = page.getByRole('button', { name: /^资料/ }).first()
if (await sources.count() > 0) { await sources.click(); await page.waitForTimeout(4000) }
let info = await inventory(page)
log('资料页 HEADINGS', JSON.stringify(info.headings))
log('资料页 BUTTONS', JSON.stringify(info.buttons))
log('资料页 BODY', info.bodyText.slice(0, 2600))
console.log('shot:', await shot(page, '05b-sources'))

// 找「添加资料」/「大教材」/「检索」相关入口
for (const pattern of [/添加资料/, /大教材/, /检索/, /索引/]) {
  const target = page.getByRole('button', { name: pattern }).first()
  if (await target.count() > 0) {
    console.log(`clicking: ${pattern}`)
    await target.click().catch(() => {})
    await page.waitForTimeout(3500)
    info = await inventory(page)
    log(`after ${pattern} BODY`, info.bodyText.slice(1000, 4200))
    console.log('shot:', await shot(page, `05c-${String(pattern).replace(/[^a-z\u4e00-\u9fa5]/gi, '')}`))
    break
  } else {
    console.log(`not found: ${pattern}`)
  }
}

console.log('--- ERRORS ---')
console.log('console:', JSON.stringify(consoleErrors.slice(0, 12)))
console.log('pageerror:', JSON.stringify(pageErrors.slice(0, 12)))
await browser.close()
