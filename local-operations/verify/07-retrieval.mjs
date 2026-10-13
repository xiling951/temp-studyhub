import { open, inventory, shot, URL_WITH_TOKEN } from './lib.mjs'

const { browser, page, consoleErrors, pageErrors } = await open()
await page.goto(URL_WITH_TOKEN, { waitUntil: 'load', timeout: 60000 })
await page.waitForTimeout(10000)
const tourExit = page.getByRole('button', { name: /以后再说|暂停导览/ }).first()
if (await tourExit.count() > 0) { await tourExit.click().catch(() => {}); await page.waitForTimeout(1200) }

await page.getByRole('button', { name: /^资料/ }).first().click()
await page.waitForTimeout(3000)
await page.getByRole('button', { name: '添加资料', exact: true }).first().click()
await page.waitForTimeout(4000)

// PDF 解析卡片里的「前往设置」通常指向 StudyHub 的解析/检索设置
const goSettings = page.getByRole('button', { name: '前往设置', exact: true }).first()
if (await goSettings.count() > 0) { console.log('clicking 前往设置'); await goSettings.click() }
else {
  console.log('clicking 选择 PDF 解析…')
  await page.getByRole('button', { name: /选择 PDF 解析/ }).first().click().catch(() => {})
}
await page.waitForTimeout(5000)

const info = await inventory(page)
console.log('HEADINGS:', JSON.stringify(info.headings))
console.log('BUTTONS:', JSON.stringify(info.buttons))
const matches = await page.evaluate(() => {
  const text = document.body.innerText
  return {
    lines: text.split('\n').filter((line) => /检索|索引|扩展|RAG|MCP|mcp|大教材|MinerU|解析/.test(line)).slice(0, 60),
  }
})
console.log('RELEVANT LINES:', JSON.stringify(matches.lines, null, 1))
console.log('--- BODY TAIL ---')
console.log((await page.evaluate(() => document.body.innerText)).replace(/\n{2,}/g, '\n').slice(600, 4600))
console.log('shot:', await shot(page, '07-retrieval-settings'))
console.log('--- ERRORS ---')
console.log('console:', JSON.stringify(consoleErrors.slice(0, 12)))
console.log('pageerror:', JSON.stringify(pageErrors.slice(0, 12)))
await browser.close()
