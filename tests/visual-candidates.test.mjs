import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStudyRuntime } from '../lib/runtime/builtins.js';
import { storeBytes, saveManifest, loadManifest, objectPath } from '../lib/contexts/materials/visual-storage.js';
import { targetsForEvidence } from '../ui/scanned/image-selection.js';
import { queueSteps } from '../ui/generation-path-flow.js';

test('native candidates expose bounded actual current images, excluding historical, fallback and invalid regions', async t => {
  const root = await mkdtemp(join(tmpdir(), 'visual-candidates-')), runtime = createStudyRuntime(root);
  t.after(async () => { await runtime.dispose(); await rm(root, { recursive: true, force: true }); });
  const asset = await storeBytes(root, Buffer.from('catalog fixture image'), { mime: 'image/png', kind: 'image' });
  const manifest = revision => ({ schema: 1, documentId: 'book', revision, fingerprint: revision, assets: [asset],
    pages: [{ page: 1, originalPage: 1, sourceId: revision, text: 'Actual fixture body.', blocks: [
      { id: 'p1-text', type: 'text', text: 'Actual fixture body.', textRange: { start: 0, end: 20 } },
      ...Array.from({ length: 45 }, (_, i) => ({ id: `p1-b${i}`, type: 'image', assetId: asset.assetId, bbox: [0.1, 0.1, 0.9, 0.9], captions: [{ text: `Figure ${i}` }] })),
      { id: 'fallback', type: 'table', assetId: asset.assetId, bbox: [0, 0, 1, 1], quality: 'original-page-fallback', captions: [] },
      { id: 'unlocated', type: 'chart', assetId: asset.assetId, bbox: null, captions: [] },
    ] }] });
  const old = await saveManifest(root, manifest('old')), current = await saveManifest(root, manifest('current'));
  await runtime.storage.update(state => {
    (state.sources ||= []).push({ id: 'old', title: 'Old', text: 'Actual fixture body.' }, { id: 'current', title: 'Current', text: 'Actual fixture body.' });
    (state.documents ||= []).push({ id: 'book', currentRevision: 'current', versions: [{ revision: 'old', sourceIds: ['old'], visual: old }, { revision: 'current', sourceIds: ['current'], visual: current }] });
  });
  const first = await runtime.call('materials.visual.candidates', { sourceIds: ['current'] });
  assert.equal(first.items.length, 40); assert.equal(first.total, 45); assert.equal(first.hasMore, true);
  const last = await runtime.call('materials.visual.candidates', { sourceIds: ['current'], offset: 40 });
  assert.equal(last.items.length, 5); assert.equal(last.hasMore, false);
  assert.ok(first.items.every(item => item.revision === 'current' && item.sourceId === 'current' && item.asset.hash === asset.hash));
  assert.equal((await runtime.call('materials.visual.candidates', { sourceIds: ['old'] })).items.length, 0);
  await assert.rejects(runtime.call('materials.visual.candidates', { sourceIds: ['current'], limit: 41 }), /bounded/i);
  await assert.rejects(runtime.call('materials.visual.candidates', { sourceIds: ['current'], path: 'outside.png' }), /supported/i);
  const loaded = await loadManifest(root, current); loaded.pages[0].sourceId = 'caller-edited-copy';
  assert.equal((await loadManifest(root, current)).pages[0].sourceId, 'current');
  assert.ok(Object.isFrozen((await loadManifest(root, current, { shared: true })).pages[0].blocks));
  await writeFile(await objectPath(root, current.manifestHash), 'corrupt');
  await assert.rejects(loadManifest(root, current), /hash mismatch/);
});
test('path steps inherit only selected images from their own exact pages', async () => {
  const evidence = [{ documentId: 'book', revision: 'r1', blockId: 'p1-b1', sourceId: 's1' },
    { documentId: 'book', revision: 'r1', blockId: 'p2-b1', sourceId: 's2' }];
  assert.deepEqual(targetsForEvidence(evidence, ['s2']), [{ documentId: 'book', revision: 'r1', blockIds: ['p2-b1'] }]);
  const calls = [];
  await queueSteps(async (_, args) => { calls.push(args); return { jobId: String(calls.length) }; },
    [{ count: 2, sourceIds: ['s1'] }, { count: 2, sourceIds: ['s2'] }, { count: 2, sourceIds: ['s3'] }], { kind: 'open' }, { visualEvidence: evidence });
  assert.deepEqual(calls[0].visualTargets[0].blockIds, ['p1-b1']);
  assert.deepEqual(calls[1].visualTargets[0].blockIds, ['p2-b1']); assert.ok(!Object.hasOwn(calls[2], 'visualTargets'));
});
