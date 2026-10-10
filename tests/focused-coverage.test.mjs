import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sectionWeights, weightsPrompts } from '../lib/section-weights.js';
import { reviewIssues } from '../lib/assessment-quality.js';
import { reviewPrompts, reviewDeck } from '../lib/generation.js';
import { StudyService } from '../lib/service.js';
import { createFakeModel } from '../scripts/fake-model.mjs';
import { qualityReview } from './helpers/assessment.mjs';
import { settleJob } from './helpers/wait.mjs';

const sources = [
  { id: 'mos', title: 'MOS device physics', text: 'An NMOS device conducts when its gate to source voltage exceeds the threshold. The linear and saturation regions have distinct drain voltage conditions.' },
  { id: 'refs', title: 'References', text: 'References and reading recommendations list publication identifiers; this page contains no device operating principle.' .repeat(30) },
  { id: 'adder', title: 'Adder architecture', text: 'Carry lookahead architectures trade logic area for shorter carry propagation paths.' .repeat(30) },
];
const sections = sources.map(source => ({ key: `${source.id}#p`, sourceId: source.id, id: 'p', title: source.title, start: 0, end: source.text.length, chars: source.text.length }));
const ratings = prompt => JSON.parse(prompt.split('\n\n')[0]).sections.map(item => ({ id: item.id, importance: 3, kind: 'definition', reason: 'Rated from evidence', relevant: /NMOS/.test(item.head) }));

test('topic scope is checked before quotas even when unrelated pages are longer', async () => {
  const result = await sectionWeights({ sections, sources, focus: 'MOS device operation', light: async (_, prompt) => JSON.stringify({ sections: ratings(prompt) }) });
  assert.deepEqual(result.weights.filter(row => row.relevant).map(row => row.sectionId), ['mos#p']);
  assert.equal(result.source, 'model');
});

test('missing model, incomplete verdicts and a failed provider cannot fall back to length for a topic', async () => {
  await assert.rejects(sectionWeights({ sections, sources, focus: 'MOS' }), /不会退回整书/);
  await assert.rejects(sectionWeights({ sections, sources, focus: 'MOS', light: async () => '{"sections":[]}' }), /未完整核验/);
  await assert.rejects(sectionWeights({ sections, sources, focus: 'MOS', light: async () => { throw Error('Unavailable'); } }), /未完整核验/);
});

test('unfocused generation retains the existing no-model length fallback', async () => {
  const result = await sectionWeights({ sections, sources });
  assert.equal(result.weights.length, 3);
  assert.equal(result.source, 'length');
  assert.equal(result.weights[0].relevant, undefined);
});

test('scoping asks for every explicit boolean and excludes bibliography as a technical target', () => {
  const prompt = weightsPrompts([], { focus: 'MOS' }).prompt;
  assert.match(prompt, /boolean "relevant"/);
  assert.match(prompt, /bibliography/);
});

test('unsupported source premises cannot be downgraded to suggestions, but wording suggestions remain optional', () => {
  const deck = { cards: [{ id: 'q', kind: 'quiz' }] }, review = qualityReview(deck);
  Object.assign(review.checks[0], { sourceSupport: 'suggest', explanation: '体裁判据在本页无任何证据，但建议收窄措辞。' });
  assert.ok(reviewIssues(review, deck).some(issue => issue.includes('unsupported')));
  review.checks[0].explanation = 'The source supports the premise; the wording could be shorter.';
  assert.deepEqual(reviewIssues(review, deck), []);
});

test('each scoped question needs its own topic verdict; generic approval is insufficient', () => {
  const deck = { cards: [{ id: 'q', kind: 'quiz' }] }, review = qualityReview(deck), topicScope = { focus: 'MOS' };
  assert.ok(reviewIssues(review, deck, { topicScope }).some(issue => issue.includes('topicRelevance')));
  review.checks[0].topicRelevance = 'fail';
  assert.ok(reviewIssues(review, deck, { topicScope }).length);
  review.checks[0].topicRelevance = 'pass';
  assert.deepEqual(reviewIssues(review, deck, { topicScope }), []);
  const prompt = reviewPrompts({ sources, deck, focus: 'MOS', topicScope });
  assert.match(prompt.system, /topicRelevance/);
  assert.match(prompt.system, /Unsupported decisive premises/);
});

test('missing topic verdicts use protocol recovery; an explicit rejection is preserved', async () => {
  const deck = { cards: [{ id: 'a', kind: 'quiz' }, { id: 'b', kind: 'quiz' }] };
  let calls = 0;
  const reviewed = await reviewDeck(async (_, payload) => {
    calls++;
    const request = JSON.parse(payload);
    if (calls === 1) {
      const answer = qualityReview(deck);
      answer.checks[0].topicRelevance = 'pass';
      return JSON.stringify(answer);
    }
    assert.deepEqual(request.reask.onlyCardIds, ['b']);
    assert.match(request.reask.rules, /topicRelevance/);
    const answer = qualityReview({ cards: [deck.cards[1]] });
    answer.checks[0].topicRelevance = 'fail';
    return JSON.stringify(answer);
  }, { sources, deck, topicScope: { focus: 'MOS' }, focus: 'MOS', singleRound: true });
  assert.equal(calls, 2);
  assert.deepEqual(reviewed.checks.map(check => check.topicRelevance), ['pass', 'fail']);
  assert.ok(reviewIssues(reviewed, deck, { topicScope: { focus: 'MOS' } }).some(issue => issue.startsWith('b:')));
});

test('a real coverage operation scopes the draft and its input identity before authoring', async t => {
  const root = await mkdtemp(join(tmpdir(), 'study-focused-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new StudyService(root), fake = createFakeModel();
  t.after(() => service.dispose());
  service.light = async (_, prompt) => JSON.stringify({ sections: ratings(prompt) });
  service.complete = async (system, prompt, context) => {
    const result = await fake(system, prompt, context);
    const text = typeof result === 'string' ? result : result.text;
    if (!system.startsWith('Act as a strict assessment editor')) return text;
    assert.match(system, /topicRelevance/);
    const reply = JSON.parse(text);
    reply.checks.forEach(check => { check.topicRelevance = 'pass'; });
    return JSON.stringify(reply);
  };
  for (const source of sources) await service.call('source.add', source);
  const started = await service.call('generate', { sourceIds: sources.map(source => source.id), focus: 'MOS device operation', coverageLevel: 'full', count: 1, title: 'MOS' });
  const job = await settleJob(service, started.jobId);
  assert.equal(job.status, 'complete', job.stage);
  const state = await service.call('export'), draft = state.drafts[0];
  assert.deepEqual(draft.editorial.generation.sourceIds, ['mos']);
  assert.equal(draft.editorial.generation.topicScope.excluded, 2);
  assert.equal(draft.editorial.coverageSpec.leaves, 1);
  assert.ok(draft.cards.every(card => card.citations.every(ref => ref.sourceId === 'mos')));
  assert.deepEqual(draft.editorial.generation.inputRef.sources.map(item => item.id), ['mos']);
});

test('publication after editing still requires a fresh topic verdict and retains rejected questions', async t => {
  const root = await mkdtemp(join(tmpdir(), 'study-topic-publish-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const service = new StudyService(root);
  t.after(() => service.dispose());
  let verdict = 'fail';
  service.complete = async (system, prompt) => {
    assert.match(system, /topicRelevance/);
    const review = qualityReview(JSON.parse(prompt).candidate);
    review.checks.forEach(check => { check.topicRelevance = verdict; });
    return JSON.stringify(review);
  };
  await service.call('source.add', sources[0]);
  const mosCard = { id: 'q', kind: 'flashcard', topic: '导通条件', objective: 'Explain NMOS conduction',
    prompt: 'What gate-to-source condition makes an NMOS device conduct?', answer: 'Its gate-to-source voltage exceeds its threshold.',
    explanation: 'The gate voltage must establish a conducting channel; below threshold the ideal device is off.',
    hint: 'Compare the applied control voltage with the device boundary.', misconception: 'Any positive gate voltage suffices.',
    citations: [{ sourceId: 'mos', quote: sources[0].text }] };
  const saved = await service.call('draft.save', { deck: { id: 'topic-draft', title: 'MOS', cards: [mosCard],
    editorial: { generation: { focus: 'MOS device operation', topicScope: { focus: 'MOS', retained: 1 } } } } });
  const rejected = await service.call('draft.publish', { id: saved.id, draftVersion: saved.draftVersion, requireReviewed: true });
  assert.equal(rejected.accepted, 0);
  const state = await service.call('export');
  assert.equal(state.decks.length, 0);
  assert.equal(state.drafts[0].cards.length, 1);
  verdict = 'pass';
  const next = await service.call('draft.publish', { id: state.drafts[0].id, draftVersion: state.drafts[0].draftVersion, requireReviewed: true });
  assert.equal(next.accepted, 1);
});
