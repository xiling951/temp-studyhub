import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createStudyRuntime } from '../lib/runtime/builtins.js';
import { Store } from '../lib/store.js';
import { storeBytes, storeStream, retainPdf, digest, saveManifest, visualObjectsDirectory } from '../lib/contexts/materials/visual-storage.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'scanned-visual-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = createStudyRuntime(root, { contexts: ['materials', 'system'] });
  t.after(() => runtime.dispose());
  return { root, runtime, store: new Store(root) };
}

test('visual opt-in is off by default; native uploads remain library scoped with strict input DTOs', async t => {
  const { runtime, root } = await fixture(t);
  assert.equal((await runtime.call('materials.visual.status')).enabled, false);
  await assert.rejects(runtime.call('materials.visual.upload.start', { name: 'book.pdf', size: 8 }), /尚未开启/);
  await runtime.call('settings', { scannedTextbooks: true });
  const uploaded = await runtime.call('materials.visual.upload.start', { name: 'book.pdf', size: 8 });
  const foreign = createStudyRuntime(join(root, 'another'), { contexts: ['materials', 'system'] });
  t.after(() => foreign.dispose());
  await foreign.call('settings', { scannedTextbooks: true });
  await assert.rejects(foreign.call('materials.visual.upload.append', { uploadId: uploaded.uploadId, offset: 0, data: Buffer.from('%PDF-1.7').toString('base64') }), /失效/);
  await assert.rejects(runtime.call('materials.visual.chunk', { documentId: 'none', assetId: 'file', offset: 0, path: 'C:/secret' }), /not supported/i);
  assert.equal((await new Store(root).read()).version, 4);
});

test('immutable resources deduplicate, cancel and reject over-budget writes without publishing incomplete objects', async t => {
  const { root } = await fixture(t);
  const bytes = Buffer.from('actual image fixture bytes'), first = await storeBytes(root, bytes, { mime: 'image/png', kind: 'figure' });
  assert.equal(first.hash, digest(bytes));
  assert.deepEqual(await storeBytes(root, bytes, { mime: 'image/png', kind: 'figure' }), first);
  await assert.rejects(storeStream(root, Readable.from([Buffer.alloc(40)]), { maxBytes: 8 }), /budget/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(storeStream(root, Readable.from([bytes]), { signal: controller.signal }), /abort/i);
  assert.deepEqual(await readdir(visualObjectsDirectory(root)), [first.hash]);
});

test('only a complete verified manifest commits; same library historical versions survive current revision change', async t => {
  const { root, runtime, store } = await fixture(t);
  const path = join(root, 'input.pdf'); await writeFile(path, '%PDF-1.7 test');
  const original = await retainPdf(root, path), figure = await storeBytes(root, Buffer.from('figure'), { mime: 'image/png', kind: 'figure' });
  const make = revision => ({ schema: 1, documentId: 'doc', revision, fingerprint: revision, assets: [original, figure], pages: [{ page: 1, sourceId: null, blocks: [{ id: 'b1', type: 'image', assetId: figure.assetId }] }], quality: { reviewRequired: true } });
  const first = await saveManifest(root, make('r1'));
  await assert.rejects(saveManifest(root, { ...make('bad'), assets: [original] }), /Missing block resource/);
  const second = await saveManifest(root, make('r2'));
  await store.update(state => (state.documents ||= []).push({ id: 'doc', title: 'book', format: 'pdf', currentRevision: 'r2', versions: [{ revision: 'r1', sourceIds: [], visual: first }, { revision: 'r2', sourceIds: [], visual: second }] }));
  assert.equal((await runtime.call('materials.visual.page', { documentId: 'doc', revision: 'r1', page: 1 })).page.sourceId, null);
  const chunk = await runtime.call('materials.visual.chunk', { documentId: 'doc', revision: 'r1', assetId: figure.assetId, offset: 0 });
  assert.equal(Buffer.from(chunk.dataBase64, 'base64').toString(), 'figure');
  await assert.rejects(runtime.call('materials.visual.asset', { documentId: 'other', assetId: figure.assetId }), /not found/);
  await assert.rejects(runtime.call('materials.visual.chunk', { documentId: 'doc', assetId: figure.assetId, offset: -1 }), /Invalid|schema/i);
});
