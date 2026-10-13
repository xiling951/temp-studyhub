import { open, shot, URL_WITH_TOKEN } from './lib.mjs'

const { browser, page, consoleErrors, pageErrors } = await open()
await page.goto(URL_WITH_TOKEN, { waitUntil: 'load', timeout: 60000 })
await page.waitForTimeout(10000)
const tourExit = page.getByRole('button', { name: /以后再说|暂停导览/ }).first()
if (await tourExit.count() > 0) { await tourExit.click().catch(() => {}); await page.waitForTimeout(1200) }
await page.keyboard.press('Escape').catch(() => {})
await page.waitForTimeout(1000)

await page.getByRole('button', { name: /^学习库位置/ }).first().click()
await page.waitForTimeout(4000)
await page.getByRole('button', { name: '检索扩展', exact: true }).first().click()
await page.waitForTimeout(4000)

const retrieve = async () => (await page.evaluate(() => document.body.innerText)).replace(/\n{2,}/g, '\n')
const relevant = (text) =>
  text
    .split('\n')
    .filter((line) => /索引|检索|模型|下载|分钟|失败|错误|完成|建立|进度|页/.test(line))
    .slice(0, 25)
    .join('\n')

console.log('=== BEFORE ===')
console.log(relevant(await retrieve()))

const build = page.getByRole('button', { name: /建立检索索引/ }).first()
console.log('build button found:', await build.count() > 0)
await build.click()
console.log('clicked 为这门课建立检索索引 — polling…')

const deadline = Date.now() + 12 * 60 * 1000
let last = ''
let settled = false
while (Date.now() < deadline) {
  await page.waitForTimeout(15000)
  const text = await retrieve()
  const lines = relevant(text)
  if (lines !== last) {
    console.log(`--- t+${Math.round((Date.now() - (deadline - 12 * 60 * 1000)) / 1000)}s ---`)
    console.log(lines)
    last = lines
  }
  const buildButtonAgain = await page.getByRole('button', { name: /建立检索索引|重建检索索引/ }).count()
  if (/索引已建好|索引已经建好|建好了|索引完成|已建立索引|索引失败|建立失败/.test(text) || (buildButtonAgain > 0 && /已经建好|已建好/.test(text))) {
    settled = true
    break
  }
}

const finalText = await retrieve()
console.log('=== FINAL (settled=' + settled + ') ===')
console.log(relevant(finalText))
console.log('shot:', await shot(page, '09-index-built'))
console.log('--- ERRORS ---')
console.log('console:', JSON.stringify(consoleErrors.slice(0, 12)))
console.log('pageerror:', JSON.stringify(pageErrors.slice(0, 12)))
await browser.close()
