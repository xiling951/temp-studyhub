import { open, inventory, shot, URL_WITH_TOKEN } from './lib.mjs'

const { browser, page, consoleErrors, pageErrors } = await open()
await page.goto(URL_WITH_TOKEN, { waitUntil: 'load', timeout: 60000 })
// The SPA boots, then creates/loads a session over the websocket.
await page.waitForTimeout(12000)

const info = await inventory(page)
console.log('URL:', info.url)
console.log('TITLE:', info.title)
console.log('HEADINGS:', JSON.stringify(info.headings))
console.log('BUTTONS:', JSON.stringify(info.buttons))
console.log('TABS:', JSON.stringify(info.tabs))
console.log('LINKS:', JSON.stringify(info.links))
console.log('--- BODY TEXT ---')
console.log(info.bodyText)
console.log('--- ERRORS ---')
console.log('console:', JSON.stringify(consoleErrors.slice(0, 10)))
console.log('pageerror:', JSON.stringify(pageErrors.slice(0, 10)))
console.log('shot:', await shot(page, '01-boot'))
await browser.close()
