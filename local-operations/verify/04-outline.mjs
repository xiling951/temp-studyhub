import { open, inventory, shot, URL_WITH_TOKEN } from './lib.mjs'

const { browser, page, consoleErrors, pageErrors } = await open()
await page.goto(URL_WITH_TOKEN, { waitUntil: 'load', timeout: 60000 })
await page.waitForTimeout(10000)

// 载入示例课程（设计模式）：一份讲义、九道带出处的题
const load = page.getByRole('button', { name: /载入示例/ }).first()
console.log('载入示例 found:', await load.count() > 0)
await load.click()
await page.waitForTimeout(9000)
console.log('shot after sample:', await shot(page, '04a-sample-loaded'))

// 导览是模态覆盖层，先看看它给了什么控件
let info = await inventory(page)
console.log('T0 HEADINGS:', JSON.stringify(info.headings))
console.log('T0 BUTTONS:', JSON.stringify(info.buttons))
console.log('--- T0 BODY ---')
console.log(info.bodyText.slice(0, 1800))

// 尝试结束导览（Esc 或「跳过/结束」按钮）
const tourExit = page.getByRole('button', { name: /跳过|结束|关闭|完成|退出/ }).first()
if (await tourExit.count() > 0) {
  console.log('tour exit button:', await tourExit.innerText().catch(() => '?'))
  await tourExit.click().catch(() => {})
  await page.waitForTimeout(2500)
} else {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(2500)
}
console.log('shot after tour exit:', await shot(page, '04b-after-tour'))

// 回到学习库首页，找课程区域的「总纲」
const home = page.getByRole('button', { name: '学习库', exact: true }).first()
if (await home.count() > 0) { await home.click(); await page.waitForTimeout(4000) }

info = await inventory(page)
console.log('T1 HEADINGS:', JSON.stringify(info.headings))
console.log('T1 BUTTONS:', JSON.stringify(info.buttons))
console.log('--- T1 BODY ---')
console.log(info.bodyText.slice(0, 2500))

const outline = page.getByRole('button', { name: /总纲/ }).first()
console.log('总纲 entry found:', await outline.count() > 0)
if (await outline.count() > 0) {
  await outline.click()
  await page.waitForTimeout(6000)
  const o = await inventory(page)
  console.log('T2 HEADINGS:', JSON.stringify(o.headings))
  console.log('T2 BUTTONS:', JSON.stringify(o.buttons))
  console.log('--- T2 BODY ---')
  console.log(o.bodyText.slice(0, 3000))
  console.log('shot outline:', await shot(page, '04c-course-outline'))
}

console.log('--- ERRORS ---')
console.log('console:', JSON.stringify(consoleErrors.slice(0, 12)))
console.log('pageerror:', JSON.stringify(pageErrors.slice(0, 12)))
await browser.close()
