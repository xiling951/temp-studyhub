import { open, shot, URL_WITH_TOKEN } from './lib.mjs'

const { browser, page, consoleErrors, pageErrors } = await open()
await page.goto(URL_WITH_TOKEN, { waitUntil: 'load', timeout: 60000 })
await page.waitForTimeout(10000)

const newSession = page.getByRole('button', { name: /新会话/ }).first()
if (await newSession.count() > 0) { await newSession.click().catch(() => {}); await page.waitForTimeout(6000) }
console.log('url:', await page.evaluate(() => location.href))
console.log('shot:', await shot(page, '13a-after-new-session'))

const inputs = await page.evaluate(() =>
  [...document.querySelectorAll('textarea, [contenteditable="true"], input[type="text"]')].map((element) => {
    const rect = element.getBoundingClientRect()
    return {
      tag: element.tagName,
      placeholder: element.getAttribute('placeholder'),
      visible: rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== 'hidden',
      rect: `${Math.round(rect.x)},${Math.round(rect.y)} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
    }
  }),
)
console.log('inputs:', JSON.stringify(inputs, null, 1))

const visibleBox = page.locator('textarea:visible, [contenteditable="true"]:visible').first()
console.log('visible input count:', await visibleBox.count())
if (await visibleBox.count() > 0) {
  await visibleBox.click()
  await visibleBox.fill('只回答两个字：可以')
  await page.waitForTimeout(600)
  await page.keyboard.press('Enter')
  console.log('sent; waiting…')
  const deadline = Date.now() + 3 * 60 * 1000
  let text = ''
  while (Date.now() < deadline) {
    await page.waitForTimeout(5000)
    text = await page.evaluate(() => document.body.innerText)
    if (/可以/.test(text)) break
    if (/错误|失败|Unauthorized|401|403|余额|API key|No model|ECONN|fetch failed/i.test(text)) break
  }
  console.log('=== tail ===')
  console.log(text.replace(/\n{2,}/g, '\n').slice(-1200))
  console.log('shot:', await shot(page, '13b-session-reply'))
} else {
  console.log('no visible chat input yet')
}
console.log('errors:', JSON.stringify(consoleErrors.slice(0, 10)), JSON.stringify(pageErrors.slice(0, 10)))
await browser.close()
