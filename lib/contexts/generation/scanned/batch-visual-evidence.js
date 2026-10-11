import { parseJson } from '../../../generation.js';
import { reviewedCardFingerprint } from '../../../review-integrity.js';
import { reviewIssues, REVIEW_SHAPE } from '../../../assessment-quality.js';
import { visualQualityCriteria } from './visual-questions.js';

/** Explicit selections, resolved by materials before a normal batch is admitted. No image paths or client review flags are accepted. */
export async function prepareBatchVisualEvidence(targets, materials) {
  if (targets === undefined) return undefined;
  if (!Array.isArray(targets) || !targets.length || targets.length > 4) throw new Error('visualTargets must select 1–4 actual image blocks');
  let count = 0;
  const evidence = [], seen = new Set();
  for (const target of targets) {
    if (!target || typeof target !== 'object' || Array.isArray(target) || Object.keys(target).some(key => !['documentId', 'revision', 'blockIds'].includes(key)) ||
      typeof target.documentId !== 'string' || !target.documentId.trim() || target.documentId.length > 1200 ||
      (target.revision !== undefined && (typeof target.revision !== 'string' || !target.revision.trim() || target.revision.length > 1200)) ||
      !Array.isArray(target.blockIds) || !target.blockIds.length || target.blockIds.some(id => typeof id !== 'string' || !id.trim() || id.length > 1200) ||
      new Set(target.blockIds).size !== target.blockIds.length || (count += target.blockIds.length) > 4) throw new Error('Invalid visualTargets; choose at most four scoped image blocks');
    if (!materials?.prepare) throw new Error('Actual material image evidence is unavailable');
    for (const item of await materials.prepare(target, { bytes: false })) {
      const key = JSON.stringify([item.citation.documentId, item.citation.revision, item.citation.blockId]);
      if (seen.has(key)) throw new Error('Duplicate visualTargets image block');
      seen.add(key); evidence.push(item);
    }
  }
  if (evidence.reduce((sum, item) => sum + item.asset.bytes, 0) > 8 * 1024 * 1024) throw new Error('Visual batch evidence exceeds the 8 MiB image budget');
  return { citations: evidence.map(item => item.citation),
    targets: targets.map(target => ({ ...target, revision: evidence.find(item => item.citation.documentId === target.documentId).citation.revision })) };
}

/** Review the final, stable card identities, after text review/patch/fill. Changed content or route never reuses an earlier decision. */
export function batchVisualReviewer({ models, materials, jobId, attemptId, signal, sources }) {
  const decisions = new Map();
  return async draft => {
    const cards = draft.cards.filter(card => card.visualCitations?.length);
    if (!cards.length) return draft;
    const rejected = { ...draft.editorial?.rejectedIssues }, accepted = [];
    for (const card of cards) {
      signal.throwIfAborted();
      const verified = { ...card, visualCitations: card.visualCitations.map(ref => ({ ...ref, reviewState: 'verified' })) };
      const fingerprint = reviewedCardFingerprint(verified), routeKey = JSON.stringify(models.visualRoute());
      const previous = decisions.get(card.id);
      if (previous?.fingerprint === fingerprint && previous.routeKey === routeKey) {
        if (previous.problems.length) { rejected[card.id] = previous.problems; card.visualCitations.forEach(ref => { ref.reviewState = 'pending'; }); }
        else { card.visualCitations.forEach(ref => { ref.reviewState = 'verified'; }); accepted.push(card); delete rejected[card.id]; }
        continue;
      }
      card.visualCitations.forEach(ref => { ref.reviewState = 'pending'; });
      let route;
      const quoted = sources.filter(source => card.citations.some(ref => ref.sourceId === source.id)).map(source => ({ id: source.id, title: source.title,
        quotes: card.citations.filter(ref => ref.sourceId === source.id).map(ref => ref.quote) }));
      const value = parseJson(await models.call(
        `你是独立图像题审阅者。重新读取真实原图，分别判断 evidenceValid 和 answerCorrect；不要信任作者自评。关键器件、连接、坐标、单位或条件无法确认时拒绝通过。返回 {"evidenceValid":boolean,"answerCorrect":boolean,"reason":"具体图像证据与独立判断","issues":[],"checks":${JSON.stringify(REVIEW_SHAPE.checks)}}。${visualQualityCriteria}`,
        JSON.stringify({ card, sources: quoted }), { kind: 'review', stage: 'Reviewing original image evidence', unit: 'visual-review', card: card.id,
          visualCitations: card.visualCitations, signal, onRoute: actual => { route = actual; } }));
      const problems = [...(Array.isArray(value.issues) ? value.issues : ['Independent image review omitted issues']), ...reviewIssues({ issues: [], checks: value.checks }, { cards: [card] })];
      if (value.evidenceValid !== true) problems.push('Independent review did not confirm original image support');
      if (value.answerCorrect !== true) problems.push('Independent review did not confirm the answer');
      if (typeof value.reason !== 'string' || !value.reason.trim() || value.reason.length > 4000) problems.push('Independent image review needs a specific reason');
      if (problems.length) {
        decisions.set(card.id, { fingerprint, routeKey: JSON.stringify(route), problems: problems.slice(0, 10) });
        rejected[card.id] = problems.slice(0, 10); continue;
      }
      if (!route) throw new Error('Actual image review route is unavailable');
      card.visualCitations.forEach(ref => { ref.reviewState = 'verified'; });
      await materials.commit({ cards: [card], checks: [{ cardId: card.id, evidenceValid: true, answerCorrect: true, independent: true, reason: value.reason }], jobId, attemptId, route }, { signal });
      decisions.set(card.id, { fingerprint, routeKey: JSON.stringify(route), problems: [] });
      accepted.push(card);
      delete rejected[card.id];
    }
    return { ...draft, editorial: { ...draft.editorial, rejectedIssues: rejected,
      reviewedCards: { ...draft.editorial?.reviewedCards, ...Object.fromEntries(accepted.map(card => [card.id, reviewedCardFingerprint(card)])) } } };
  };
}
