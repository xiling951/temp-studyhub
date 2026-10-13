import { open, inventory, shot, URL_WITH_TOKEN } from './lib.mjs'

const { browser, page, consoleErrors, pageErrors } = await open()
await page.goto(URL_WITH_TOKEN, { waitUntil: 'load', timeout: 60000 })
await page.waitForTimeout(10000)

// 3.1+ 备考补习（examBlueprint）侧栏入口
const entry = page.getByRole('button', { name: '备考补习', exact: true }).first()
console.log('备考补习 entry found:', await entry.count() > 0)
await entry.click()
await page.waitForTimeout(6000)

const info = await inventory(page)
console.log('URL:', info.url)
console.log('HEADINGS:', JSON.stringify(info.headings))
console.log('BUTTONS:', JSON.stringify(info.buttons))
console.log('--- BODY TEXT ---')
console.log(info.bodyText)
console.log('--- ERRORS ---')
console.log('console:', JSON.stringify(consoleErrors.slice(0, 10)))
console.log('pageerror:', JSON.stringify(pageErrors.slice(0, 10)))
console.log('shot:', await shot(page, '02-exam-prep'))
await browser.close()
