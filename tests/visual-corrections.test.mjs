import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStudyRuntime } from '../lib/runtime/builtins.js';
import { storeBytes, saveManifest, loadManifest, objectPath } from '../lib/contexts/materials/visual-storage.js';
import { withReading } from '../lib/contexts/materials/visual-reading.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'visual-correction-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = createStudyRuntime(root); t.after(() => runtime.dispose());
  const original = await storeBytes(root, Buffer.from('%PDF-1.7 synthetic correction fixture'), { kind: 'original', mime: 'application/pdf' });
  const image = await storeBytes(root, Buffer.from('synthetic graph crop'), { kind: 'chart', mime: 'image/png' });
  const blocks = [{ id: 'eq', type: 'equation', text: '\\left| x = y \\right|', captions: [] },
    { id: 'left', type: 'chart', text: '', bbox: [0.1, 0.1, 0.4, 0.3], assetId: image.assetId, captions: [] },
    { id: 'bottom', type: 'chart', text: '', bbox: [0.1, 0.5, 0.4, 0.7], assetId: image.assetId, captions: [
      { text: '图1.1 上方曲线说明', bbox: [0.1, 0.31, 0.4, 0.33] }, { text: '图1.2 漏字图注', bbox: [0.1, 0.71, 0.4, 0.73] }] }];
  const text = blocks.flatMap(block => [block.text, ...block.captions.map(caption => caption.text)]).filter(Boolean).join('\n\n');
  const manifest = { schema: 1, documentId: 'book', revision: 'r0', fingerprint: 'fixture', assets: [original, image], quality: { reviewRequired: true },
    pages: [{ page: 1, originalPage: 1, sourceId: 'original-source', text, blocks }] };
  const visual = await saveManifest(root, manifest);
  await runtime.storage.update(state => { state.settings.scannedTextbooks = true; state.documents ||= []; state.sources.push({ id: 'original-source', title: 'Synthetic source', text, document: { id: 'book', materialRevision: 'r0', page: 1 } }); state.documents.push({ id: 'book', title: 'Synthetic book', currentRevision: 'r0', versions: [{ revision: 'r0', sourceIds: ['original-source'], visual }] }); });
  const request = { documentId: 'book', revision: 'r0', manifestHash: visual.manifestHash, reason: 'Fixture source-page comparison', changes: [
    { page: 1, blockId: 'eq', field: 'text', before: blocks[0].text, after: 'x = y' },
    { page: 1, blockId: 'bottom', field: 'caption', captionIndex: 1, before: '图1.2 漏字图注', after: '图1.2 完整图注' },
    { page: 1, blockId: 'bottom', field: 'caption', captionIndex: 0, before: '图1.1 上方曲线说明', after: '图1.1 上方曲线说明', targetBlockId: 'left' }] };
  return { root, runtime, manifest, visual, request };
}

test('native transcription corrections append an immutable version and preserve original sources, PDF, assets and review authority', async t => {
  const { root, runtime, manifest, visual, request } = await fixture(t);
  const oldBytes = await readFile(await objectPath(root, visual.manifestHash));
  const result = await runtime.call('materials.visual.transcription.correct', request);
  const state = await runtime.storage.read(), document = state.documents[0], version = document.versions.at(-1);
  assert.equal(document.versions.length, 2); assert.equal(document.currentRevision, result.revision); assert.match(result.revision, /^corrected1-/);
  assert.equal(state.sources[0].text, manifest.pages[0].text); assert.equal(state.sources.length, 2); assert.equal(document.versions[0].sourceIds[0], 'original-source');
  assert.deepEqual(await readFile(await objectPath(root, visual.manifestHash)), oldBytes);
  const corrected = await loadManifest(root, version.visual);
  assert.deepEqual(corrected.assets, manifest.assets); assert.equal(corrected.quality.reviewRequired, true); assert.equal(version.visual.cardReviews, undefined);
  assert.equal(corrected.corrections.baseRevision, 'r0'); assert.deepEqual(corrected.corrections.changes, request.changes);
  assert.equal(corrected.pages[0].blocks[1].figureNumber, '1.1'); assert.equal(corrected.pages[0].blocks[2].figureNumber, '1.2');
  assert.equal(state.sources[1].text, 'x = y\n\n图1.1 上方曲线说明\n\n图1.2 完整图注');
  assert.ok(withReading(corrected).reading.nodes.every(node => node.anchors.every(anchor => anchor.sourceId === result.sourceIds[0])));
  await assert.rejects(runtime.call('materials.visual.transcription.correct', request), /exact current/);
});

test('stale, invented, duplicate and mismatching correction scopes fail before changing library state', async t => {
  const { runtime, request } = await fixture(t), before = JSON.stringify(await runtime.storage.read());
  const variants = [ { ...request, manifestHash: 'a'.repeat(64) }, { ...request, changes: [{ ...request.changes[0], before: 'invented old text' }] },
    { ...request, changes: [request.changes[0], request.changes[0]] }, { ...request, changes: [{ ...request.changes[2], targetBlockId: 'invented' }] } ];
  for (const variant of variants) {
    await assert.rejects(runtime.call('materials.visual.transcription.correct', variant));
    assert.equal(JSON.stringify(await runtime.storage.read()), before);
  }
});
