// Shared Playwright setup for verifying the StudyHub UI on the standalone harness.
import { chromium } from 'playwright-core'
import { mkdirSync } from 'node:fs'

export const URL_WITH_TOKEN = process.env.SH_URL
export const SHOTS = 'D:/studyhub/verify/shots'
mkdirSync(SHOTS, { recursive: true })

export async function open({ headless = true } = {}) {
  const browser = await chromium.launch({
    channel: 'chrome',
    headless,
    args: ['--no-first-run', '--no-default-browser-check', '--disable-features=Translate'],
  })
  const context = await browser.newContext({
    locale: 'zh-CN',
    viewport: { width: 1680, height: 1000 },
    deviceScaleFactor: 1,
  })
  const page = await context.newPage()
  const consoleErrors = []
  const pageErrors = []
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text().slice(0, 300))
  })
  page.on('pageerror', (error) => pageErrors.push(String(error.message).slice(0, 300)))
  return { browser, context, page, consoleErrors, pageErrors }
}

/** Visible clickable texts, for deciding the next click without guessing selectors. */
export async function inventory(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none'
    }
    const label = (element) =>
      (element.getAttribute('aria-label') || element.innerText || element.textContent || element.title || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60)
    const collect = (selector) =>
      [...document.querySelectorAll(selector)]
        .filter(visible)
        .map(label)
        .filter((text) => text.length > 0)
    return {
      title: document.title,
      url: location.href,
      buttons: [...new Set(collect('button, [role="button"]'))].slice(0, 80),
      links: [...new Set(collect('a'))].slice(0, 40),
      tabs: [...new Set(collect('[role="tab"]'))].slice(0, 40),
      headings: [...new Set(collect('h1, h2, h3, [role="heading"]'))].slice(0, 40),
      bodyText: document.body.innerText.replace(/\n{2,}/g, '\n').slice(0, 2500),
    }
  })
}

export async function shot(page, name) {
  const path = `${SHOTS}/${name}.png`
  await page.screenshot({ path, fullPage: false })
  return path
}
