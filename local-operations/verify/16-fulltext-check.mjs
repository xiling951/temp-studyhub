// 核对"完整信息提取"的 HTML 产物：渲染统计 + 图片加载检查 + 逐页截图。
// 复用本部署已有的 Playwright 驱动（verify/lib.mjs，channel: chrome，无需下载 Chromium）。
import { open } from './lib.mjs'

const FILE = 'file:///D:/studyhub/lab/extract/全文-p200-206-html/全文.html'
const OUT = 'D:/studyhub/lab/extract/全文-p200-206-html'

const { browser, page, consoleErrors, pageErrors } = await open()
await page.goto(FILE, { waitUntil: 'load' })
await page.waitForTimeout(1500)

const stats = await page.evaluate(() => ({
  title: document.title,
  h1: document.querySelector('h1')?.innerText.trim() || '',
  headings: [...document.querySelectorAll('h2')].map((e) => e.innerText.trim().replace(/\s+/g, ' ')),
  images: [...document.images].map((i) => ({ src: i.getAttribute('src'), w: i.naturalWidth, h: i.naturalHeight })),
  katex: document.querySelectorAll('.katex').length,
  katexErrors: document.querySelectorAll('.katex-error').length,
  tables: document.querySelectorAll('table').length,
  pagebreaks: document.querySelectorAll('.pagebreak').length,
  height: document.body.scrollHeight,
}))

console.log('标题      : ' + stats.title)
console.log('H1        : ' + stats.h1)
console.log('二级标题  : ' + (stats.headings.length ? stats.headings.join(' | ') : '(无)'))
console.log('公式节点  : ' + stats.katex + ' 个 KaTeX，渲染失败 ' + stats.katexErrors + ' 个')
console.log('表格      : ' + stats.tables + ' 个；分页标记 ' + stats.pagebreaks + ' 个')
console.log('页面高度  : ' + stats.height + ' px')
console.log('图片加载  :')
let bad = 0
for (const img of stats.images) {
  const ok = img.w > 0 && img.h > 0
  if (!ok) bad++
  console.log('  ' + (ok ? 'OK ' : 'BAD') + '  ' + String(img.w).padStart(4) + 'x' + String(img.h).padStart(4) + '  ' + img.src)
}
console.log('图片加载失败数: ' + bad)

const shot = async (name, y) => {
  await page.evaluate((top) => window.scrollTo(0, top), y)
  await page.waitForTimeout(300)
  const path = `${OUT}/${name}.png`
  await page.screenshot({ path })
  console.log('截图: ' + path)
}

const marks = await page.$$('.pagebreak')
const tops = []
for (const m of marks) tops.push(await m.evaluate((el) => el.getBoundingClientRect().top + window.scrollY))

const pick = [0, 2, 3, 6].filter((i) => i < tops.length)
pick.forEach((i, n) => void 0)
for (const i of pick) await shot('shot-p' + (i + 1), Math.max(0, tops[i] - 30))

await page.screenshot({ path: `${OUT}/shot-fullpage.png`, fullPage: true })
console.log('整页截图: ' + `${OUT}/shot-fullpage.png`)

console.log('console errors: ' + consoleErrors.length + (consoleErrors.length ? ' -> ' + consoleErrors.slice(0, 3).join(' ; ') : ''))
console.log('page errors   : ' + pageErrors.length + (pageErrors.length ? ' -> ' + pageErrors.slice(0, 3).join(' ; ') : ''))

await browser.close()
