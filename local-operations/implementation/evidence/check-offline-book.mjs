import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runLocalCommand } from '../source/lib/local-command.js';
import { launchChromium } from '../source/scripts/qa/browser.mjs';
const target = 'D:/studyhub/implementation/evidence/t07-offline'; await mkdir(target, { recursive: true });
const extracted = await runLocalCommand({ file: process.env.STUDYHUB_PDF_PYTHON || 'python' }, ['-c', 'import zipfile,sys,pathlib; z=zipfile.ZipFile(sys.argv[1]); assert all(not pathlib.PurePosixPath(n).is_absolute() and ".." not in pathlib.PurePosixPath(n).parts for n in z.namelist()); z.extractall(sys.argv[2])', 'D:/studyhub/implementation/packages/sample-textbook.zip', target]);
if (extracted.code !== 0) throw new Error('Controlled textbook package extraction failed');
const browser = await launchChromium(); const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
const errors = [], external = []; page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (/^https?:/.test(request.url())) external.push(request.url()); });
try {
  await page.goto(pathToFileURL(join(target, 'index.html')).href); await page.locator('section[data-page="1"] img').first().waitFor();
  await page.screenshot({ path: join(target, 'page200.png') });
  await page.locator('#page').selectOption('2'); await page.locator('section[data-page="2"] .katex').first().waitFor();
  await page.screenshot({ path: join(target, 'page201.png') });
  const result = { offline: true, externalRequests: external.length, pageErrors: errors, renderedMath: await page.locator('section[data-page="2"] .katex').count(),
    renderedTables: await page.locator('section[data-page="2"] table').count(), imageLoaded: await page.locator('section[data-page="1"] img').first().evaluate(image => image.naturalWidth > 0) };
  if (external.length || errors.length || !result.imageLoaded || !result.renderedMath || !result.renderedTables) throw new Error('Offline rendering failed');
  await writeFile('D:/studyhub/implementation/evidence/t07-offline-result.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} finally { await browser.close(); }
