import { syntheticImageObservation } from './helpers/visual-observation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StudyService } from '../lib/service.js';
import { storeBytes, saveManifest } from '../lib/contexts/materials/visual-storage.js';
import { prepareVisualCardEvidence } from '../lib/contexts/materials/visual-card-evidence.js';
import { repairGeneratedVisualDraft } from '../lib/contexts/generation/draft-repair.js';
import { reviewedCardFingerprint } from '../lib/review-integrity.js';
import { managedRuntimeOptions } from './helpers/runtime-switch.mjs';
import { qualityReview } from './helpers/assessment.mjs';
import { settleJob } from './helpers/wait.mjs';

const source = { id: 's', title: 'Constructed switching notes', text: 'A controlled switch closes the current path when enabled and opens the path when disabled. This determines whether the output node follows the input state.' };
const question = id => ({ id, targetId: `target-${id}`, kind: 'flashcard', topic: 'Switching paths', objective: `Explain path condition ${id}`,
  prompt: `How does enabling the controlled switch affect path ${id}?`, answer: 'The switch closes the conducting path.',
  hint: 'Trace the two terminals and check the control state.', explanation: 'Enabling creates a conducting connection between the terminals; disabling interrupts this connection.',
  misconception: 'A controlled switch conducts regardless of its input.', citations: [{ sourceId: source.id, quote: source.text }] });
const reviewReply = (card, approved = true) => ({ evidenceValid: true, answerCorrect: approved, reason: 'The constructed terminal path was checked independently.',
  issues: approved ? [] : ['The candidate applies the switching rule to the wrong terminals.'], checks: qualityReview({ cards: [card] }).checks });

async function nativeFixture(t, { reject = () => false, edit = card => card, calculation } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'draft-repair-visual-')), requests = [], observationRequests = [], attachments = new Map();
  let repairs = 0, reviews = 0;
  const complete = Object.assign(async () => { throw new Error('Visual repair must use actual native image content'); }, {
    completeContent: async (system, parts, context) => {
      assert.equal(parts.length, 2);
      assert.equal(parts[1].type, 'image');
      assert.deepEqual(Buffer.from(attachments.get(parts[1].attachment.attachmentId).data), Buffer.from('constructed switch image bytes'));
      if (system.startsWith('你是盲图观察者')) { observationRequests.push(parts); return JSON.stringify(syntheticImageObservation); }
      requests.push({ system, context });
      const data = JSON.parse(parts[0].text.split('\n\nORIGINAL IMAGE EVIDENCE:')[0]);
      if (system.startsWith('Repair one draft card')) {
        repairs++;
        const card = edit({ ...data.card, prompt: `${data.card.prompt} Examine control condition ${repairs}.`,
          visualCitations: [{ assetId: 'invented-model-owned-image' }] }, repairs);
        return JSON.stringify({ card });
      }
      if (system.startsWith('你是独立图像题审阅者')) return JSON.stringify(reviewReply(data.card, !reject(++reviews)));
      throw new Error(`Unexpected extra review: ${system.slice(0, 60)}`);
    },
  });
  const options = managedRuntimeOptions({ complete, paths: ['generationRepair'] });
  options.jobModelHost.ctx = { llm: { resolveModelInfo: async () => ({ inputModalities: ['text', 'image'] }) }, attachments: {
    saveImages: async images => images.map((image, i) => {
      const attachmentId = `repair-image-${attachments.size}-${i}`;
      attachments.set(attachmentId, image);
      return { attachmentId, mediaType: image.mediaType, bytes: image.data.length };
    }), readImage: async ref => attachments.get(ref.attachmentId),
  } };
  const service = new StudyService(root, { complete, ...options });
  t.after(async () => { await service.dispose(); await rm(root, { recursive: true, force: true }); });
  const original = await storeBytes(root, Buffer.from('%PDF constructed fixture'), { kind: 'original', mime: 'application/pdf' });
  const image = await storeBytes(root, Buffer.from('constructed switch image bytes'), { kind: 'figure', mime: 'image/png' });
  const visual = await saveManifest(root, { schema: 1, documentId: 'book', revision: 'r1', assets: [original, image], quality: {}, pages: [
    { page: 1, sourceId: source.id, text: source.text, blocks: [{ id: 'switch', type: 'image', assetId: image.assetId, bbox: [0, 0, 1, 1], captions: [] }] },
  ] });
  await service.store.update(state => { state.sources = [source]; state.documents = [{ id: 'book', title: 'Constructed switch', currentRevision: 'r1',
    versions: [{ revision: 'r1', sourceIds: [source.id], visual }] }]; });
  const evidence = await prepareVisualCardEvidence(root, await service.store.read(), { documentId: 'book', blockIds: ['switch'] });
  const item = { ...question('a'), visualCitations: evidence.map(item => item.citation), ...(calculation ? { answer: '6 m' } : {}) };
  await service.call('draft.save', { deck: { id: 'draft', title: 'Constructed image repair', cards: [item], editorial: {
    generation: { sourceIds: [source.id], kind: 'flashcard' }, rejectedIssues: { a: ['The original answer needs correction.'] },
    ...(calculation ? { evidenceWorkflow: { version: 1, answers: [{ targetId: item.targetId, answer: item.answer, calculation }] } } : {}),
  } } });
  const draft = async () => (await service.store.read()).drafts.find(draft => draft.id === 'draft');
  const repair = async () => settleJob(service, (await service.call('draft.repair', { id: 'draft', draftVersion: (await draft()).draftVersion })).jobId);
  return { service, requests, observationRequests, draft, repair };
}

test('native image repair uses one repair and one independent real-image decision, without a duplicate text editor', async t => {
  const { service, requests, draft, repair } = await nativeFixture(t);
  const done = await repair();
  assert.equal(done.status, 'complete', done.stage);
  assert.equal(requests.length, 2);
  assert.ok(requests[0].system.startsWith('Repair one draft card'));
  assert.ok(requests[1].system.startsWith('你是独立图像题审阅者'));
  const saved = await draft();
  assert.equal(saved.cards[0].visualCitations[0].blockId, 'switch', 'model-supplied image identities are replaced by material-owned identities');
  assert.equal(saved.cards[0].visualCitations[0].reviewState, 'verified');
  assert.deepEqual(saved.editorial.rejectedIssues, {});
  assert.equal((await service.store.read()).documents[0].versions[0].visual.cardReviews.length, 1);
  assert.equal((await service.call('draft.publish', { id: saved.id, draftVersion: saved.draftVersion, requireReviewed: true })).accepted, 1);
});

test('a real negative image verdict is repaired once more, not retried as malformed JSON or accepted', async t => {
  const { requests, observationRequests, draft, repair } = await nativeFixture(t, { reject: round => round === 1 });
  assert.equal((await repair()).status, 'complete');
  assert.equal(requests.length, 4, 'two different repaired candidates each receive exactly one independent image decision');
  assert.deepEqual(requests.map(request => request.system.startsWith('Repair one') ? 'repair' : 'image-review'), ['repair', 'image-review', 'repair', 'image-review']);
  assert.equal((await draft()).editorial.visualRepairAttempts.a.rounds, 2);
  assert.equal(observationRequests.length, 1, 'two repairs share one unchanged blind image observation');
});

test('two substantive failures leave the original pending; retries cannot replenish its paid repair budget', async t => {
  const { service, requests, draft, repair } = await nativeFixture(t, { reject: () => true });
  const original = structuredClone((await draft()).cards[0]);
  assert.equal((await repair()).status, 'failed');
  assert.equal(requests.length, 4);
  assert.deepEqual((await draft()).cards[0], original);
  assert.ok((await draft()).editorial.rejectedIssues.a.some(issue => /wrong terminals|confirm the answer/.test(issue)));
  assert.equal((await service.store.read()).documents[0].versions[0].visual.cardReviews?.length || 0, 0);
  await assert.rejects(service.call('draft.publish.quick', { id: 'draft', allowIssues: true }), /independent/);
  assert.equal((await repair()).status, 'failed');
  assert.equal(requests.length, 4, 'same card fingerprint retains the two-round limit across a new repair job');
});

test('invented verbatim evidence is rejected locally before any image review', async t => {
  const { requests, draft, repair } = await nativeFixture(t, { edit: card => ({ ...card, citations: [{ sourceId: source.id, quote: 'This invented verbatim statement does not occur in the supplied material.' }] }) });
  assert.equal((await repair()).status, 'failed');
  assert.equal(requests.length, 2);
  assert.ok(requests.every(request => request.system.startsWith('Repair one draft card')));
  assert.equal((await draft()).cards[0].visualCitations[0].reviewState, 'pending');
});

test('repair cannot change a supported numerical answer while silently dropping its original checkable arithmetic', async t => {
  const calculation = { variables: { speed: { value: 2, unit: 'm/s' }, time: { value: 3, unit: 's' } }, expression: 'speed*time', result: { value: 6, unit: 'm' } };
  const { requests, draft, repair } = await nativeFixture(t, { calculation, edit: card => ({ ...card, answer: '7 m' }) });
  assert.equal((await repair()).status, 'failed');
  assert.equal(requests.length, 2, 'numerical disagreement blocks the candidate before an independent image call');
  assert.match((await draft()).editorial.rejectedIssues.a.join('\n'), /Calculation mismatch/);
  assert.deepEqual((await draft()).editorial.evidenceWorkflow.answers[0].calculation, calculation);
});

function boundedFixture({ failCard, reject = false } = {}) {
  const refs = [{ schema: 1, documentId: 'book', revision: 'r1', page: 1, blockId: 'switch', assetId: `asset-${'a'.repeat(64)}`, imageHash: 'a'.repeat(64), bbox: [0, 0, 1, 1], reviewState: 'pending' }];
  const cards = ['old', 'a', 'b'].map(id => ({ ...question(id), visualCitations: structuredClone(refs) }));
  let draft = { id: 'd', title: 'Bounded repair', draftVersion: 1, cards, editorial: { generation: { sourceIds: [source.id] }, rejectedIssues: Object.fromEntries(cards.map(card => [card.id, ['Original defect']])) } };
  const state = { sources: [source], decks: [], documents: [{ id: 'book', versions: [{ revision: 'r1', visual: { manifestHash: 'manifest', cardReviews: [] } }] }] };
  const calls = [], checkpoints = [], route = { provider: 'fixture', model: 'vision' };
  const models = { visualRoute: () => route, call: async (system, prompt, options) => {
    assert.equal(draft.editorial.visualRepairAttempts[options.card].rounds > 0, true, 'paid round is checkpointed before its model request');
    assert.equal(options.visualCitations[0].blockId, 'switch');
    const data = JSON.parse(prompt);
    calls.push({ cardId: data.card.id, kind: options.kind });
    if (system.startsWith('Repair one')) return JSON.stringify({ card: { ...data.card, prompt: `${data.card.prompt} Trace the control condition ${options.attempt}.` } });
    if (data.card.id === failCard) throw new Error('Constructed review transport failure');
    options.onRoute?.(route);
    return JSON.stringify(reviewReply(data.card, !reject));
  } };
  const materials = { observationLookup: async () => ({ key: 'constructed-observation', value: syntheticImageObservation }), observationCommit: async () => { throw Error('Unexpected uncached fixture observation'); }, resolve: async () => [], commit: async ({ cards, route }) => {
    state.documents[0].versions[0].visual.cardReviews.push({ schema: 1, cardId: cards[0].id, fingerprint: reviewedCardFingerprint(cards[0]), manifestHash: 'manifest',
      evidenceValid: true, answerCorrect: true, independent: true, citations: structuredClone(cards[0].visualCitations), route });
  } };
  const save = async next => { draft = structuredClone({ ...next, draftVersion: draft.draftVersion + 1 }); checkpoints.push(structuredClone(draft)); return draft; };
  return { cards, calls, checkpoints, getDraft: () => draft, run: cardIds => repairGeneratedVisualDraft({ draft, sources: [source], models, materials,
    read: async () => ({ ...state, drafts: [draft] }), save, signal: new AbortController().signal, jobId: 'bounded', cardIds }) };
}

test('ordinary bounded repair limits itself to this batch and keeps earlier successes after a later image service failure', async () => {
  const fixture = boundedFixture({ failCard: 'b' }), old = structuredClone(fixture.getDraft().cards[0]);
  const saved = await fixture.run(['a', 'b']);
  assert.deepEqual(saved.cards.find(card => card.id === 'old'), old);
  assert.equal(saved.cards.find(card => card.id === 'a').visualCitations[0].reviewState, 'verified');
  assert.equal(saved.cards.find(card => card.id === 'b').visualCitations[0].reviewState, 'pending');
  assert.deepEqual(fixture.calls.map(call => [call.cardId, call.kind]), [['a', 'repair'], ['a', 'review'], ['b', 'repair'], ['b', 'review']]);
  assert.ok(fixture.checkpoints.some(draft => draft.cards.length === 3 && !draft.editorial.rejectedIssues.a && draft.editorial.rejectedIssues.b));
  assert.match(saved.editorial.rejectedIssues.b[0], /transport failure/);
});

test('the ordinary generator resumes the persisted budget, while an explicit content edit starts a new bounded revision', async () => {
  const fixture = boundedFixture({ reject: true });
  await fixture.run(['a']);
  assert.equal(fixture.calls.length, 4);
  await fixture.run(['a']);
  assert.equal(fixture.calls.length, 4);
  fixture.getDraft().cards.find(card => card.id === 'a').prompt += ' A new manually supplied condition.';
  await fixture.run(['a']);
  assert.equal(fixture.calls.length, 8, 'an actual content revision gets two fresh rounds; unchanged resumes do not');
});
