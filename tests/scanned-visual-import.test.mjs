import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { createStudyRuntime } from '../lib/runtime/builtins.js';
import { importVisualPdf } from '../lib/contexts/materials/scanned/visual-import.js';
import { loadManifest, hashFile } from '../lib/contexts/materials/visual-storage.js';
import { adaptWindow, parserFingerprint, saveWindowCache, verifiedWindowCache } from '../lib/contexts/materials/visual-parser.js';

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=';
const parsed = { pages: [
  { page_idx: 0, blocks: [{ type: 'text', bbox: [0.1, 0.1, 0.9, 0.3], content: 'Actual fixture text' }, { type: 'equation', bbox: [0.1, 0.4, 0.5, 0.5], content: 'x^2=4', image_source: PNG }] },
  { page_idx: 1, blocks: [{ type: 'image', bbox: [0.1, 0.1, 0.9, 0.9], content: '', image_source: PNG }] },
  { page_idx: 2, blocks: [] },
] };

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'scanned-import-')); t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = createStudyRuntime(root, { contexts: ['materials', 'system'] }); t.after(() => runtime.dispose());
  const pdf = await PDFDocument.create(); for (let n = 0; n < 3; n++) pdf.addPage([300, 400]);
  const path = join(root, 'input.pdf'); await writeFile(path, await pdf.save());
  const run = extra => importVisualPdf({ root, path, name: 'fixture.pdf', input: { pageOffset: 199 }, read: () => runtime.storage.read(), update: fn => runtime.storage.update(fn), parse: async () => structuredClone(parsed), ...extra });
  return { root, runtime, path, run };
}

test('structured adapter keeps genuine text separate from image-only/blank pages; repeated import preserves source IDs', async t => {
  const { runtime, run } = await fixture(t), first = await run();
  const state = await runtime.storage.read(), doc = state.documents[0], manifest = await loadManifest(runtime.storage.root, doc.versions[0].visual);
  assert.equal(manifest.pages.length, 3); assert.equal(manifest.pages[0].originalPage, 200);
  assert.equal(manifest.pages[1].status, 'image-only'); assert.equal(manifest.pages[1].sourceId, null);
  assert.equal(manifest.pages[2].sourceId, null); assert.equal(state.sources.length, 1);
  assert.equal(state.sources[0].text, 'Actual fixture text\n\nx^2=4');
  assert.equal(manifest.pages[0].blocks[1].assetId, manifest.pages[1].blocks[0].assetId, 'same bytes deduplicate without losing either block');
  const second = await run(); assert.equal(second.reused, true); assert.deepEqual(second.sourceIds, first.sourceIds);
  assert.deepEqual((await runtime.storage.read()).sources, state.sources);
});

test('parse cancellation and transaction failure cannot publish partial documents or alter the original input', async t => {
  const { runtime, run, path } = await fixture(t), before = await readFile(path);
  await assert.rejects(run({ update: async () => { throw new Error('injected transaction failure'); } }), /transaction failure/);
  assert.equal((await runtime.storage.read()).documents?.length || 0, 0);
  assert.deepEqual(await readFile(path), before);
  const stop = new AbortController(); stop.abort(new Error('fixture cancelled'));
  await assert.rejects(run({ signal: stop.signal }), /fixture cancelled/);
  assert.equal((await runtime.storage.read()).sources.length, 0);
});

test('missing page coverage fails; fingerprints separate parser options and cannot reuse text-only cache', async t => {
  const { root } = await fixture(t);
  await assert.rejects(adaptWindow(root, { pages: [] }, { start: 1, end: 1 }), /Missing or duplicate/);
  assert.notEqual(parserFingerprint('a'.repeat(64), 'basic'), parserFingerprint('a'.repeat(64), 'standard'));
  assert.notEqual(parserFingerprint('a'.repeat(64), 'standard', 199), parserFingerprint('a'.repeat(64), 'standard'));
});

test('verified adapter v1 cache derives v2 associations without another parser call or changing literal OCR', async t => {
  const { root, path, run, runtime } = await fixture(t), original = await hashFile(path);
  const result = await adaptWindow(root, structuredClone(parsed), { start: 1, end: 3, pageOffset: 199 });
  await saveWindowCache(root, parserFingerprint(original.hash, 'standard', 199, 1), 1, 3, result);
  const imported = await run({ parse: async () => { throw new Error('Unnecessary parser call'); } });
  const current = await verifiedWindowCache(root, parserFingerprint(original.hash, 'standard', 199), 1, 3);
  assert.ok(current); assert.equal(current.pages[0].text, result.pages[0].text);
  assert.equal((await loadManifest(root, (await runtime.storage.read()).documents[0].versions[0].visual)).parser.adapter, 2);
  assert.equal(imported.pages, 3);
});
