import { open, shot, URL_WITH_TOKEN } from './lib.mjs'

const { browser, page, consoleErrors, pageErrors } = await open()
await page.goto(URL_WITH_TOKEN, { waitUntil: 'load', timeout: 60000 })
await page.waitForTimeout(10000)

// 新会话，发一条最小消息，验证模型链路（凭据 / provider / 网络 / 流式）
const newSession = page.getByRole('button', { name: /新会话/ }).first()
if (await newSession.count() > 0) {
  const href = await page.evaluate(() => location.href)
  await newSession.click().catch(() => {})
  await page.waitForTimeout(4000)
  console.log('new session clicked; url was', href, 'now', await page.evaluate(() => location.href))
}
await page.waitForTimeout(3000)

const inputs = await page.evaluate(() =>
  [...document.querySelectorAll('textarea, [contenteditable="true"], input[type="text"]')].map((element) => ({
    tag: element.tagName,
    role: element.getAttribute('role'),
    placeholder: element.getAttribute('placeholder'),
    visible: element.getBoundingClientRect().height > 0,
  })),
)
console.log('inputs:', JSON.stringify(inputs))

const box = page.locator('textarea, [contenteditable="true"]').first()
await box.click()
await box.fill('只回答两个字：可以')
await page.waitForTimeout(800)
await page.keyboard.press('Enter')
console.log('sent; waiting for a reply…')

const deadline = Date.now() + 3 * 60 * 1000
let text = ''
while (Date.now() < deadline) {
  await page.waitForTimeout(5000)
  text = await page.evaluate(() => document.body.innerText)
  if (/可以/.test(text) && !/只回答两个字：可以\s*$/.test(text)) break
  if (/错误|失败|unauthorized|401|403|余额|API key|No model/i.test(text)) break
}
const tail = text.replace(/\n{2,}/g, '\n')
console.log('=== session tail ===')
console.log(tail.slice(-1400))
console.log('shot:', await shot(page, '13-session-model-call'))
console.log('errors:', JSON.stringify(consoleErrors.slice(0, 10)), JSON.stringify(pageErrors.slice(0, 10)))
await browser.close()
