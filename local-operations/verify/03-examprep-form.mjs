import { open, inventory, shot, URL_WITH_TOKEN } from './lib.mjs'

const { browser, page, consoleErrors, pageErrors } = await open()
await page.goto(URL_WITH_TOKEN, { waitUntil: 'load', timeout: 60000 })
await page.waitForTimeout(10000)

await page.getByRole('button', { name: '备考补习', exact: true }).first().click()
await page.waitForTimeout(5000)

// 3.1.0 的原始缺陷是「这一页根本没有开关、打不开」，3.1.1 之后默认开启；
// 这里再验证一次表单本身能打开、且默认值已预填。
await page.getByRole('button', { name: '新建考点清单', exact: true }).last().click()
await page.waitForTimeout(5000)

const info = await inventory(page)
console.log('HEADINGS:', JSON.stringify(info.headings))
console.log('BUTTONS:', JSON.stringify(info.buttons))
console.log('--- BODY TEXT ---')
console.log(info.bodyText)
console.log('--- ERRORS ---')
console.log('console:', JSON.stringify(consoleErrors.slice(0, 10)))
console.log('pageerror:', JSON.stringify(pageErrors.slice(0, 10)))
console.log('shot:', await shot(page, '03-exam-prep-form'))
await browser.close()
