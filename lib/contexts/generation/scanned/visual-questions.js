import { randomUUID } from 'node:crypto';
import { parseJson } from '../../../generation.js';
import { validateDeck } from '../../../domain.js';
import { reviewedCardFingerprint } from '../../../review-integrity.js';
import { visualReviewIssues, VISUAL_REVIEW_VERSION } from '../../../visual-citations.js';
import { admitVisualImages } from '../../../visual-model-content.js';
import { observeVisualEvidence } from './visual-observation.js';
import { answerLeakIssues, explanationIssues, learnerContextIssues, reviewIssues, REVIEW_SHAPE, QUALITY_CRITERIA } from '../../../assessment-quality.js';

export const VISUAL_QUESTIONS_KIND = 'scanned-textbook-questions';
const words = { type: 'string', minLength: 1, maxLength: 1200 }, result = { type: 'object', additionalProperties: true };
export const visualQuestionSchemas = {
  'visual.start': { description: 'Plan, prepare answers, author and independently review questions using actual native images, then save an ordinary draft.',
    input: { type: 'object', additionalProperties: false, properties: { documentId: words, revision: words,
      blockIds: { type: 'array', minItems: 1, maxItems: 4, uniqueItems: true, items: words }, count: { type: 'integer', minimum: 1, maximum: 6 },
      kind: { enum: ['flashcard', 'quiz', 'multi', 'open', 'cloze'] }, title: words, focus: words, course: words }, required: ['documentId', 'blockIds'] }, output: result },
  'visual.review': { description: 'Independently re-review edited/imported visual draft cards against their actual original images.',
    input: { type: 'object', additionalProperties: false, properties: { draftId: words, draftVersion: { type: 'integer', minimum: 1 } }, required: ['draftId'] }, output: result },
};
const bounded = (value, max = 12000) => typeof value === 'string' && value.trim().length && value.length <= max;
export const visualQualityCriteria = QUALITY_CRITERIA.replace('The learner sees only this question during review, not the lecture notes, transcript or citations.', 'The learner sees this question AND all bound original images during review, but not the lecture notes, model explanation, answers or textual citations.') + '\nVisual sourceSupport clarification: source includes the actual attached original images, even when sources/citations are empty. A direct electrical/topological or Boolean derivation from visible circuit symbols is valid evidence; a text caption need not state its conclusion. Do not demand an OCR quote for a pure image question. Necessary hypothetical conditions are context, not an answer leak merely because the learner can solve the problem from them. Fail actual unsupported claims, wrong connections, ambiguity or leakage of the requested conclusion; record nonblocking instructional preferences as suggestions. Sources.quotes are validated literal textbook excerpts; they need not be printed inside the attached crop. A pending/needs-review label records review status and cannot itself establish that the actual image is invalid.' + '\nBefore evaluating algebra, enumerate the visible facts claimed by the question: distinguish each subfigure/device, count ALL input terminals as connected incoming signal wires PLUS unconnected short stubs (do not count only the unused stubs), and report connected + unconnected = total for each device whose input count is claimed, inspect polarity marks, wiring, labels, axes and units. Report the observable facts concisely in reason. Given hypothetical parameters do not exempt assertions about the actual figure from this check. A statement that a real pictured device has a certain input count, kind or connection must agree with the original image; mathematical consistency cannot make an image contradiction pass. If an observed fact is uncertain, report the uncertainty and reject claims depending on it. A hypothetical replacement circuit must be explicitly distinguished from the depicted circuit. observations are blind original-image observations made without the question or author answer, not source text or an approval. Independently reconcile every figure claim with their visible facts and the attached fresh original images; contradictions or critical unknowns require evidenceValid:false and sourceSupport:fail. Never change a visible input count to fit the author answer. Explicit hypothetical assumptions do not override claims about the real depicted circuit.';
const brief = evidence => evidence.map(({ citation, originalPage, caption, quality }) => ({ ...citation, originalPage, caption, quality }));
const viewOf = view => () => ({ title: '图片证据出题', stage: { code: view.phase, text: view.message },
  progress: { done: view.done, total: view.total, unit: 'stage', percent: view.total ? 100 * view.done / view.total : null, segments: [] },
  detail: { visualGeneration: true }, legacy: { draftId: view.draftId, done: view.done, total: view.total } });

function checkedPlan(value, evidence, count) {
  if (!Array.isArray(value.targets) || !value.targets.length || value.targets.length > count) throw new Error(`图片规划目标无效：期望 1–${count} 个 targets，实际 ${Array.isArray(value.targets) ? value.targets.length : '未提供数组'}；未生成假题目`);
  const ids = new Set(), available = new Set(evidence.map(item => item.citation.blockId));
  for (const target of value.targets) {
    if (!bounded(target.targetId, 80) || ids.has(target.targetId) || !bounded(target.objective, 1000) || !Array.isArray(target.blockIds) || !target.blockIds.length ||
      new Set(target.blockIds).size !== target.blockIds.length || target.blockIds.some(id => !available.has(id))) throw new Error('图像出题规划的目标或图片范围无效');
    ids.add(target.targetId);
  }
  return value.targets;
}
function bindCards(authored, items, targets, evidence, kind) {
  if (!Array.isArray(authored.cards) || !authored.cards.length || authored.cards.length > targets.length || !Array.isArray(items.items)) throw new Error('图像题候选或答案准备格式无效');
  const seen = new Set();
  return authored.cards.map(stem => {
    const target = targets.find(target => target.targetId === stem.targetId), answers = items.items.filter(item => item.targetId === stem.targetId), item = answers[0];
    if (!target || answers.length !== 1 || seen.has(target.targetId) || !item) throw new Error('图像题缺少唯一目标和准备好的答案');
    seen.add(target.targetId);
    const card = { id: randomUUID(), kind, topic: stem.topic, objective: target.objective, prompt: kind === 'cloze' ? item.cloze?.text : stem.prompt,
      answer: item.answer, hint: stem.hint, explanation: item.explanation, misconception: item.misconception, citations: item.citations,
      visualCitations: evidence.filter(item => target.blockIds.includes(item.citation.blockId)).map(item => structuredClone(item.citation)) };
    for (const key of ['options', 'rubric', 'cloze']) if (item[key] !== undefined && (key === 'options' ? ['quiz', 'multi'].includes(kind) : key === 'rubric' ? kind === 'open' : kind === 'cloze')) card[key] = item[key];
    return card;
  });
}

async function askJson(context, binding, key, system, data, evidence, outputTokens = 6000, blind = false) {
  // Each stage resolves fresh bytes; placeholders and an earlier text-only call never qualify as seeing the image.
  const resolved = await binding.materials.resolve(evidence.map(item => item.citation), { signal: context.signal, bytes: true });
  const images = await admitVisualImages(binding.hostContext, resolved.map(item => item.image), context.signal);
  for (let attempt = 0; attempt < 2; attempt++) {
    const stage = attempt ? `${key}:json-retry` : key;
    const step = context.gateway.step(stage, { purpose: key.split(':')[0], feature: 'generate', requestedEffort: 'lowest', executionMode: 'direct',
      budget: { timeoutMs: 240000, maxOutputTokens: Math.min(24000, Math.max(8000, outputTokens) * (attempt ? 2 : 1)) } }, { route: binding.route, labels: { stage } });
    try {
      const reply = await step.completeContent(system + (attempt ? '\n上次响应格式不完整或达到输出上限。本次只返回完整严格 JSON：字符串中的双引号必须转义，说明保持简明，不要加入 JSON 外的分析。重新独立判断，不能为了修复格式改变通过或拒绝的标准。' : ''),
        [{ type: 'text', text: JSON.stringify({ ...(blind ? {} : { imageEvidence: brief(resolved) }), ...data }) }, ...images]);
      return parseJson(reply);
    } catch (error) {
      const incomplete = error instanceof SyntaxError || /max[-_ ]tokens|finish.reason.*length|output.*(?:token|length).*limit|^Model returned no text$/i.test(String(error.message));
      if (context.signal.aborted || attempt || !incomplete) throw error;
    }
  }
}

async function reviewCards(context, binding, draft, view, evidenceByCard) {
  const checks = [], rejectedIssues = { ...draft.editorial?.rejectedIssues }, state = await binding.read();
  for (const cardId of draft.cards.map(card => card.id)) {
    const card = draft.cards.find(card => card.id === cardId);
    context.signal.throwIfAborted();
    const evidence = await evidenceByCard(card);
    const fingerprint = reviewedCardFingerprint(card);
    const sameRoute = card.visualCitations.every(ref => state.documents.find(document => document.id === ref.documentId)?.versions.find(version => version.revision === ref.revision)?.visual.cardReviews?.some(receipt => receipt.criteriaVersion === VISUAL_REVIEW_VERSION && receipt.cardId === card.id && receipt.fingerprint === fingerprint && receipt.route?.provider === binding.route.provider && receipt.route?.model === binding.route.model));
    if (sameRoute && !visualReviewIssues(card, state.documents).length && draft.editorial?.reviewedCards?.[card.id] === fingerprint) {
      const previous = draft.editorial.visualReview?.checks?.find(check => check.cardId === card.id);
      checks.push(previous || { cardId: card.id, reused: true }); delete rejectedIssues[card.id]; view.done++;
      continue;
    }
    card.visualCitations.forEach(ref => { ref.reviewState = 'pending'; });
    const quoted = (binding.sources || []).filter(source => card.citations.some(ref => ref.sourceId === source.id)).map(source => ({ id: source.id, title: source.title,
      quotes: card.citations.filter(ref => ref.sourceId === source.id).map(ref => ref.quote) }));
    const observations = await observeVisualEvidence({ materials: binding.materials, citations: card.visualCitations, route: binding.route,
      signal: context.signal, jobId: context.jobId, attemptId: context.attemptId,
      ask: async ({ system, data, citation }) => ({ value: await askJson(context, binding, `visual-observe:${citation.blockId}`, system, data, [{ citation }], 8000, true), route: binding.route }) });
    const value = await askJson(context, binding, `visual-review:${card.id}`, `你是独立图像题审阅者。前面的作者结果可能错误；从当前真实图片重新核对节点、连接、坐标、器件作用和推导，不信任图解或作者的自评。分别判断图片证据是否支撑这道题 evidenceValid，以及答案/选项/解释是否正确 answerCorrect。若图片看不清或关键条件缺失，拒绝通过。学习者在作答前会看到这里附带的原图，但不会看到答案或图解；不要假定练习界面不显示图片。题干可明确约定新的符号或假设性电路改动，不要求所有条件都是原书叙述，必须区分题设与原图事实。sourceSupport 指真实原图和可用教材原文支持，纯图片或拓扑推导可以不用文字引用，不要求问题复述原书图注的主题。issues 只列阻止题目成立、正确评分或独立解答的具体缺陷；一般教学建议、open 无选项的 na 和仍可辨认的扫描清晰度放入 warnings，不作为拒绝原因。返回 {"evidenceValid":boolean,"answerCorrect":boolean,"reason":"具体图片证据与独立判断","issues":[],"warnings":[],"checks":${JSON.stringify(REVIEW_SHAPE.checks)}}。${visualQualityCriteria}`, { card, sources: quoted, observations }, evidence, 16000);
    const problems = [...(Array.isArray(value.issues) ? value.issues : ['独立图像审阅缺少问题清单']), ...reviewIssues({ issues: [], checks: value.checks }, { cards: [card] })];
    if (value.evidenceValid !== true) problems.push('独立审阅未确认图片证据');
    if (value.answerCorrect !== true) problems.push('独立审阅未确认答案正确');
    if (!bounded(value.reason, 4000)) problems.push('独立审阅缺少具体图片证据说明');
    if (problems.length) { rejectedIssues[card.id] = problems.slice(0, 10); delete draft.editorial?.reviewedCards?.[card.id]; }
    else {
      card.visualCitations.forEach(ref => { ref.reviewState = 'verified'; });
      checks.push({ cardId: card.id, evidenceValid: true, answerCorrect: true, independent: true, reason: value.reason, quality: value.checks, observationKeys: observations.map(item => item.key) });
      delete rejectedIssues[card.id];
      await binding.materials.commit({ cards: [card], checks: [checks.at(-1)], jobId: context.jobId, attemptId: context.attemptId, route: binding.route }, { signal: context.signal });
      draft.editorial ||= {}; draft.editorial.reviewedCards ||= {};
      draft.editorial.reviewedCards[card.id] = reviewedCardFingerprint(card);
    }
    draft.editorial ||= {}; draft.editorial.rejectedIssues = { ...rejectedIssues };
    draft.editorial.visualReview = { jobId: context.jobId, checkedAt: new Date().toISOString(), checks: [...checks], rejectedIssues: { ...rejectedIssues } };
    // Commit each completed decision so a later transport/JSON failure cannot lose paid reviews.
    draft = await binding.saveDraft(draft, { reviewed: true });
    view.done++; view.message = `独立图片审阅 ${checks.length} 题通过，${Object.keys(rejectedIssues).length} 题待修订`; context.present(viewOf(view));
  }
  draft.editorial ||= {};
  draft.editorial.rejectedIssues = rejectedIssues;
  draft.editorial.visualReview = { jobId: context.jobId, checkedAt: new Date().toISOString(), checks, rejectedIssues };
  context.signal.throwIfAborted();
  return binding.saveDraft(draft, { reviewed: true });
}

export const visualQuestionsDefinition = {
  kind: VISUAL_QUESTIONS_KIND, version: 1, title: '图片证据出题', legacyFields: ['draftId', 'done', 'total'],
  capabilities: { cancel: true, retry: true, pauseMode: 'unsupported', recoveryMode: 'none', executionModes: ['direct', 'subagent'] },
  async admit(context, _input, binding) { const turn = binding.queue.enter(binding.root, context.signal); await turn.admitted; return { finish: turn.leave }; },
  async run(context, input, binding) {
    const draftId = input.draftId || `visual-draft-${context.jobId}`, state = await binding.read();
    let draft = state.drafts.find(draft => draft.id === draftId);
    const view = { draftId, done: 0, total: input.mode === 'review' ? draft?.cards.length || 0 : 3 + (input.count || 3), phase: 'visual-plan', message: '以真实图片规划题目' };
    context.present(viewOf(view));
    if (input.mode === 'review') {
      if (!draft || (input.draftVersion && draft.draftVersion !== input.draftVersion) || draft.cards.some(card => !card.visualCitations?.length)) throw new Error('选择当前版本的带图草稿后再独立复审');
      const problems = validateDeck(draft, state.sources, { documents: state.documents, allowPendingVisual: true }).errors;
      if (problems.length) throw new Error(`带图草稿结构/文字证据需要先修订：${problems.slice(0, 8).join('; ')}`);
    } else if (!draft) {
      const evidence = await binding.materials.prepare(input, { signal: context.signal, bytes: false }), count = input.count || 3, kind = input.kind || 'open';
      const sourceIds = new Set(evidence.map(item => item.sourceId).filter(Boolean));
      binding = { ...binding, sources: state.sources.filter(source => sourceIds.has(source.id)).map(source => ({ id: source.id, title: source.title, text: source.text.slice(0, 12000) })) };
      const request = { sources: binding.sources, kind, count, focus: input.focus || '器件能否移除、其作用和连接关系；避免只读图注', title: input.title };
      const targets = checkedPlan(await askJson(context, binding, 'visual-plan', `只根据当前真实图片和标为待核对的 OCR 正文规划 ${count} 个互不重复、可独立评分的目标；证据不足时可以少于 ${count} 个，绝不能超过。图解不属于证据。禁止虚构图中没有的器件。只返回一个 JSON 对象，必须使用 targets 数组：{"targets":[{"targetId":"t1","objective":"具体学习目标","blockIds":["实际图片块 id"]}]}。`, request, evidence), evidence, count);
      view.done = 1; view.phase = 'visual-answers'; view.message = '结合原图准备具体答案与推导'; context.present(viewOf(view));
      const items = await askJson(context, binding, 'visual-answers', '根据真实图片为每个目标准备具体正确答案和理由。仅引用提供的真正教材 sourceId/原文 quote（至少12字且必须原文匹配）；纯图片目标可以 citations:[]，但不得把图注或解释伪造为正文引用。返回 {"items":[{"targetId":"目标id","answer":"具体答案","explanation":"依据图中连接/器件/坐标的推导，不超过500字","misconception":"真实常见误解","citations":[],"rubric":"仅open提供评分标准","options":[{"id":"a","text":"选项","correct":true,"explanation":"理由"}],"cloze":{"text":"含{{b1}}的题干","answers":[{"id":"b1","value":"答案","accept":[]}]}}]}。按kind只提供适用字段：quiz/multi 3–6个选项，quiz恰好一个正确，multi有多个但非全对；open提供rubric；cloze提供cloze；flashcard不提供这些字段。', { ...request, targets }, evidence);
      view.done = 2; view.phase = 'visual-author'; view.message = '组织带图题干，保留准备的答案'; context.present(viewOf(view));
      const authored = await askJson(context, binding, 'visual-author', '依据真实图片、目标和准备好的答案组织清晰、自足的题干。题图会在作答前显示，但图解和答案不会显示。不要让topic或hint泄露答案，不要问“教材说什么”。返回 {"title":"题组标题","cards":[{"targetId":"目标id","topic":"主题","prompt":"题干","hint":"方法提示，不泄露答案"}]}。不要改换目标或答案，不要声称看到了不存在的图片。', { ...request, targets, answerBlueprint: items }, evidence);
      const cards = bindCards(authored, items, targets, evidence, kind);
      draft = { id: draftId, title: input.title || authored.title || '教材图片题组', course: input.course || '', cards, sourceIds: [...sourceIds], editorial: { visualGeneration: { schema: 1, jobId: context.jobId, documentId: input.documentId, revision: evidence[0].citation.revision, targets, route: binding.route } } };
      const problems = [...validateDeck(draft, state.sources, { documents: state.documents, allowPendingVisual: true }).errors, ...learnerContextIssues(draft), ...explanationIssues(draft), ...answerLeakIssues(draft)];
      draft = await binding.saveDraft(draft);
      if (problems.length) throw new Error(`带图草稿已保存，但候选结构/文字证据需要修订：${problems.slice(0, 8).join('; ')}`);
      view.done = 3; view.total = 3 + cards.length;
    }
    const sourceIds = new Set(draft.cards.flatMap(card => card.citations || []).map(ref => ref.sourceId));
    binding = { ...binding, sources: (await binding.read()).sources.filter(source => sourceIds.has(source.id)).map(source => ({ id: source.id, title: source.title, text: source.text.slice(0, 12000) })) };
    view.phase = 'visual-review'; view.total = view.done + draft.cards.length; view.message = '以原图独立核验每题证据与答案'; context.present(viewOf(view));
    draft = await reviewCards(context, binding, structuredClone(draft), view, card => binding.materials.resolve(card.visualCitations, { signal: context.signal, bytes: false }));
    view.phase = 'complete'; view.message = '带图草稿已保存；发布继续执行原图完整性和独立复审检查'; context.present(viewOf(view));
    return { refs: [{ kind: 'draft', id: draft.id }], completeness: Object.keys(draft.editorial.rejectedIssues).length ? 'partial' : 'complete' };
  },
};
