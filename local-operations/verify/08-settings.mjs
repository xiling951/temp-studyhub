import { open, inventory, shot, URL_WITH_TOKEN } from './lib.mjs'

const { browser, page, consoleErrors, pageErrors } = await open()
await page.goto(URL_WITH_TOKEN, { waitUntil: 'load', timeout: 60000 })
await page.waitForTimeout(10000)
const tourExit = page.getByRole('button', { name: /以后再说|暂停导览/ }).first()
if (await tourExit.count() > 0) { await tourExit.click().catch(() => {}); await page.waitForTimeout(1200) }
await page.keyboard.press('Escape').catch(() => {})
await page.waitForTimeout(1000)

// StudyHub 设置入口：侧栏底部的「学习库位置：…」
const settingsEntry = page.getByRole('button', { name: /^学习库位置/ }).first()
console.log('settings entry found:', await settingsEntry.count() > 0)
if (await settingsEntry.count() > 0) { await settingsEntry.click(); await page.waitForTimeout(5000) }

let info = await inventory(page)
console.log('=== SETTINGS VIEW ===')
console.log('HEADINGS:', JSON.stringify(info.headings))
console.log('BUTTONS:', JSON.stringify(info.buttons))
const seen = await page.evaluate(() => document.body.innerText.replace(/\n{2,}/g, '\n'))
console.log('--- TEXT (1200..5200) ---')
console.log(seen.slice(1200, 5200))
console.log('shot:', await shot(page, '08-studyhub-settings'))

// 在设置里找检索/索引分区
const section = page.getByRole('button', { name: /^检索|索引|大教材/ }).first()
if (await section.count() > 0) {
  console.log('clicking retrieval section:', await section.innerText().catch(() => '?'))
  await section.click()
  await page.waitForTimeout(5000)
  const after = await page.evaluate(() => document.body.innerText.replace(/\n{2,}/g, '\n'))
  const lines = after.split('\n').filter((line) => /检索|索引|扩展|RAG|MCP|mcp|工具|状态|已安装|就绪/.test(line))
  console.log('RETRIEVAL LINES:', JSON.stringify(lines.slice(0, 50), null, 1))
  console.log('--- TEXT TAIL ---')
  console.log(after.slice(1200, 4800))
  console.log('shot:', await shot(page, '08b-retrieval-section'))
} else {
  console.log('no retrieval section button found')
}

console.log('--- ERRORS ---')
console.log('console:', JSON.stringify(consoleErrors.slice(0, 12)))
console.log('pageerror:', JSON.stringify(pageErrors.slice(0, 12)))
await browser.close()
