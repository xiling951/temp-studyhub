import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createStudyRuntime } from '../source/lib/runtime/builtins.js';
import { importVisualPdf } from '../source/lib/contexts/materials/visual-import.js';
import { loadManifest, objectPath } from '../source/lib/contexts/materials/visual-storage.js';
process.env.DSH_HOME = 'D:/studyhub/implementation/test-harness/home';
const root = 'D:/studyhub/implementation/test-libraries/sample'; await mkdir(root, { recursive: true });
const runtime = createStudyRuntime(root, { contexts: ['materials', 'system'] });
const started = Date.now(); let peakRss = process.memoryUsage().rss;
const timer = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 25);
try {
  const result = await importVisualPdf({ root, path: 'D:/studyhub/lab/import-probe/数字集成电路-p200-206.pdf', name: '数字集成电路-p200-206.pdf', input: { pageOffset: 199, courses: ['扫描教材验收'] },
    read: () => runtime.storage.read(), update: fn => runtime.storage.update(fn) });
  const state = await runtime.storage.read(), doc = state.documents.find(document => document.id === result.documentId), visual = doc.versions.find(version => version.revision === result.revision).visual;
  const manifest = await loadManifest(root, visual);
  const resultDir = new URL('./t05-sample/', import.meta.url); await mkdir(resultDir, { recursive: true });
  await writeFile(new URL('manifest.json', resultDir), JSON.stringify(manifest, null, 2));
  for (const block of manifest.pages[0].blocks.filter(block => block.type === 'image' && block.assetId)) {
    const asset = manifest.assets.find(asset => asset.assetId === block.assetId);
    await writeFile(new URL(`${block.id}.jpg`, resultDir), await readFile(await objectPath(root, asset.hash)));
  }
  const repeated = await importVisualPdf({ root, path: 'D:/studyhub/lab/import-probe/数字集成电路-p200-206.pdf', name: '数字集成电路-p200-206.pdf', input: { pageOffset: 199, courses: ['扫描教材验收'] },
    read: () => runtime.storage.read(), update: fn => runtime.storage.update(fn) });
  const evidence = { result, repeated, elapsedMs: Date.now() - started, peakRss, pages: manifest.pages.length, imageAssets: manifest.assets.length - 1, page1Original: manifest.pages[0].originalPage,
    figures: manifest.pages[0].blocks.filter(block => block.type === 'image').map(block => ({ id: block.id, figureNumber: block.figureNumber, parentId: block.parentId, bbox: block.bbox, captions: block.captions, assetId: block.assetId })) };
  await writeFile(new URL('t05-sample-result.json', import.meta.url), JSON.stringify(evidence, null, 2)); console.log(JSON.stringify(evidence, null, 2));
} finally { clearInterval(timer); await runtime.dispose(); }
