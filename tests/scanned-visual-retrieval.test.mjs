import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createStudyRuntime } from '../lib/runtime/builtins.js';
import { storeBytes, saveManifest } from '../lib/contexts/materials/visual-storage.js';
import { projectVisualRetrieval } from '../lib/contexts/materials/visual-retrieval.js';
import { indexedDocument, sourceIndexHash, planIndex, buildIndex, INDEX_TOOLS } from '../lib/retrieval-index.js';
import { normalizeHits, resolveHits, narrowSources } from '../lib/retrieval.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'visual-retrieval-')), runtime = createStudyRuntime(root);
  t.after(async () => { await runtime.dispose(); await rm(root, { recursive: true, force: true }); });
  const original = await storeBytes(root, Buffer.from('%PDF fixture'), { kind: 'original', mime: 'application/pdf' }), image = await storeBytes(root, Buffer.from('synthetic image bytes'), { kind: 'figure', mime: 'image/png' });
  const page = sourceId => ({ page: 1, originalPage: 200, sourceId, text: 'Explicit OCR fixture: the transistor control signal changes the discharge path.', blocks: [
    { id: 'paragraph', type: 'text', text: 'Explicit OCR fixture: the transistor control signal changes the discharge path.', bbox: [0, 0, 0.5, 0.3], captions: [] },
    { id: 'near', type: 'image', bbox: [0.1, 0.3, 0.5, 0.7], assetId: image.assetId, captions: [{ text: 'Fig. fixture: native transistor circuit' }] },
    { id: 'far', type: 'image', bbox: [0.8, 0.8, 1, 1], assetId: image.assetId, captions: [] },
  ] });
  const old = await saveManifest(root, { schema: 1, documentId: 'book', revision: 'old', fingerprint: 'old-fixture', assets: [original, image], quality: {}, pages: [page('s-old')] });
  const visual = await saveManifest(root, { schema: 1, documentId: 'book', revision: 'current', fingerprint: 'current-fixture', assets: [original, image], quality: {}, pages: [page('s-current')] });
  await runtime.storage.update(state => {
    state.sources = ['old', 'current'].map(revision => ({ id: `s-${revision}`, title: 'Book', text: page('').text, courses: ['Circuit'], document: { id: 'book', materialId: 'book', materialRevision: revision, page: 1 } }));
    state.documents = [{ id: 'book', currentRevision: 'current', versions: [{ revision: 'old', sourceIds: ['s-old'], visual: old }, { revision: 'current', sourceIds: ['s-current'], visual }] }];
  });
  return { root, runtime, visual, image };
}
test('only explicitly indexed current human-reviewed notes alter content/hash; no model note or caption becomes source text', async t => {
  const { root, runtime, visual } = await fixture(t), originalText = (await runtime.storage.read()).sources[1].text;
  let sources = await projectVisualRetrieval(root, await runtime.storage.read()), hash = sourceIndexHash(sources[0]);
  assert.deepEqual(sources.map(source => source.id), ['s-current']); assert.match(indexedDocument(sources[0]), /Fig. fixture/);
  const note = { schema: 1, id: 'note-1', revision: 'current', manifestHash: visual.manifestHash, page: 1, text: 'EXPLICIT SYNTHETIC MODEL NOTE', fingerprint: 'f1', contextHash: 'c1', review: 'pending', indexed: false };
  await runtime.storage.update(state => { state.documents[0].versions[1].visual.explanations = [note]; });
  sources = await projectVisualRetrieval(root, await runtime.storage.read()); assert.equal(sourceIndexHash(sources[0]), hash); assert.ok(!indexedDocument(sources[0]).includes(note.text));
  await runtime.storage.update(state => { state.documents[0].versions[1].visual.explanations.push({ ...note, id: 'note-2', supersedes: 'note-1', review: 'verified', indexed: true }); });
  sources = await projectVisualRetrieval(root, await runtime.storage.read()); assert.notEqual(sourceIndexHash(sources[0]), hash); assert.equal(sources[0].text, originalText);
  const manifest = { sources: { 's-current': { hash } } }; assert.equal(planIndex({ sources, library: ['s-current'], manifest }).add.length, 1);
  const calls = [], port = { tools: () => [{ name: INDEX_TOOLS.ingest }], call: async (name, args) => { calls.push({ name, args }); } };
  await buildIndex({ port, sources, library: ['s-current'], manifest }); assert.equal(calls.length, 1); assert.deepEqual(Object.keys(calls[0].args), ['content', 'metadata']);
  assert.deepEqual(calls[0].args.metadata, { source: 'studyhub://source/s-current', format: 'markdown' }); assert.match(calls[0].args.content, /不是教材原文/);
  hash = sourceIndexHash(sources[0]);
  await runtime.storage.update(state => { state.documents[0].versions[1].visual.explanations.push({ ...note, id: 'note-3', supersedes: 'note-2', text: 'Corrected human explanation', review: 'verified', indexed: true }); });
  sources = await projectVisualRetrieval(root, await runtime.storage.read()); assert.notEqual(sourceIndexHash(sources[0]), hash); assert.ok(!indexedDocument(sources[0]).includes(note.text)); assert.equal((await runtime.storage.read()).sources[1].text, originalText);
});
test('normalized hits regain authoritative nearby image references and reject historical versions while old evidence still resolves', async t => {
  const { root, runtime, image } = await fixture(t), state = await runtime.storage.read(), sources = await projectVisualRetrieval(root, state);
  const hits = normalizeHits({ results: [{ source: 'studyhub://source/s-current', text: sources[0].text, score: 1, visual: { assetId: '/forged/path' } }, { sourceId: 's-old', text: sources[0].text, score: 2 }] });
  const result = resolveHits(hits, sources); assert.equal(result.unresolved, 1); const visual = result.passages[0].visual;
  assert.equal(visual.revision, 'current'); assert.equal(visual.citations[0].blockId, 'near'); assert.equal(visual.citations[0].imageHash, image.hash);
  assert.equal(narrowSources(sources, result.passages).pages[0].visual.documentId, 'book');
  assert.equal((await runtime.call('materials.visual.page', { documentId: 'book', revision: 'old', page: 1 })).page.sourceId, 's-old');
  assert.equal(runtime.hasAction('materials.visual.retrieval.sources'), false);
});
test('source removal protects image-only card and oral history references, and disabled retrieval retains native reading/current page mapping', async t => {
  const { runtime, root } = await fixture(t), projected = await projectVisualRetrieval(root, await runtime.storage.read());
  const visual = resolveHits(normalizeHits([{ sourceId: 's-current', text: projected[0].text }]), projected).passages[0].visual;
  await runtime.storage.update(state => { state.sources[1].archived = true; state.decks = [{ id: 'deck', cards: [{ id: 'card', kind: 'flashcard', prompt: 'Fixture', answer: 'Fixture', citations: [], visualCitations: visual.citations }] }]; });
  await assert.rejects(runtime.call('source.remove', { id: 's-current', confirm: true }), /referenced/);
  await runtime.storage.update(state => { state.oralRuns = [{ id: 'oral', entries: [{ card: state.decks[0].cards[0] }] }]; state.decks = []; });
  await assert.rejects(runtime.call('source.remove', { id: 's-current', confirm: true }), /referenced/);
  assert.equal((await runtime.call('materials.visual.page', { documentId: 'book', page: 1 })).page.sourceId, 's-current');
  const status = await runtime.call('retrieval.status'); assert.equal(status.hostCanSearch, false);
});

test('an image-only page can index selected notes as a visual search record without inventing any ordinary source/quote', async t => {
  const { runtime, root } = await fixture(t);
  await runtime.storage.update(state => { const version = state.documents[0].versions[1]; version.sourceIds = []; state.sources = []; });
  const state = structuredClone(await runtime.storage.read()), version = state.documents[0].versions[1];
  const manifest = { schema: 1, documentId: 'book', revision: 'current', fingerprint: 'image-only-fixture', assets: [], quality: {}, pages: [] };
  // Reuse the retained fixture assets in a real manifest, only clearing its OCR association.
  const { loadManifest } = await import('../lib/contexts/materials/visual-storage.js');
  Object.assign(manifest, await loadManifest(root, version.visual)); manifest.pages[0].sourceId = null; manifest.pages[0].text = '';
  manifest.pages[0].blocks = manifest.pages[0].blocks.filter(block => block.assetId);
  version.visual = await saveManifest(root, manifest);
  version.visual.explanations = [{ id: 'chosen-note', revision: 'current', manifestHash: version.visual.manifestHash, page: 1, blockIds: ['far'], text: 'Synthetic selected explanation for the far image, not OCR evidence', review: 'verified', indexed: true }];
  await runtime.storage.update(current => { current.documents = state.documents; });
  const projected = await projectVisualRetrieval(root, await runtime.storage.read(), undefined, { imageOnly: true });
  assert.equal(projected.length, 1); assert.equal(projected[0].visualOnly, true); assert.equal(projected[0].text, ''); assert.equal((await runtime.storage.read()).sources.length, 0);
  const result = resolveHits(normalizeHits([{ source: `studyhub://source/${projected[0].id}`, text: version.visual.explanations[0].text }]), projected);
  assert.equal(result.passages[0].visual.citations[0].blockId, 'far');
  assert.equal(narrowSources(projected, result.passages).pages[0].visualOnly, true);
  await assert.rejects(runtime.call('source.get', { id: projected[0].id }), /not found/i);
});
