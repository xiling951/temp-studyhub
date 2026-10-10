import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument, degrees } from 'pdf-lib';
import { createStudyRuntime } from '../lib/runtime/builtins.js';
import { importVisualPdf } from '../lib/contexts/materials/scanned/visual-import.js';
import { objectPath } from '../lib/contexts/materials/visual-storage.js';

test('model-free rotated/image-only original preview is scoped, cached and rejects a corrupted resource before serving', async t => {
  const root = await mkdtemp(join(tmpdir(), 'scanned-preview-')); t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = createStudyRuntime(root, { contexts: ['materials', 'system'] }); t.after(() => runtime.dispose());
  const doc = await PDFDocument.create(), page = doc.addPage([300, 400]); page.setRotation(degrees(90));
  const path = join(root, 'rotated.pdf'); await writeFile(path, await doc.save());
  const imported = await importVisualPdf({ root, path, name: 'rotated.pdf', read: () => runtime.storage.read(), update: fn => runtime.storage.update(fn),
    parse: async () => ({ pages: [{ page_idx: 0, blocks: [] }] }) });
  const scope = { documentId: imported.documentId, revision: imported.revision }, preview = await runtime.call('materials.visual.preview', { ...scope, page: 1 });
  assert.ok(preview.asset.width > preview.asset.height, 'rotation is applied');
  assert.equal((await runtime.call('materials.visual.list')).documents.length, 1, 'no fake text source is needed to expose the document');
  assert.deepEqual(await runtime.call('materials.visual.preview', { ...scope, page: 1 }), preview);
  await assert.rejects(runtime.call('materials.visual.preview', { ...scope, page: 1, blockId: 'invented' }), /unlocated/);
  const chunk = await runtime.call('materials.visual.chunk', { ...scope, assetId: preview.asset.assetId, offset: 0 });
  assert.equal(Buffer.from(chunk.dataBase64, 'base64').subarray(1, 4).toString(), 'PNG');
  await writeFile(await objectPath(root, preview.asset.hash), Buffer.alloc(preview.asset.bytes));
  await assert.rejects(runtime.call('materials.visual.chunk', { ...scope, assetId: preview.asset.assetId, offset: 0 }), /hash mismatch/);
});
