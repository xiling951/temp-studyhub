import { setTimeout as delay } from 'node:timers/promises';
import { digest } from '../visual-storage.js';
import { isRateLimit } from '../../../rate-limit.js';
import { stripTrailingCommas } from '../../../model-json.js';
import { CLOUD_PROMPT, decodeCloudPage } from './cloud-result.js';

export const CLOUD_REVIEW_DIMENSIONS = ['coverage', 'literal', 'equations', 'tables', 'figures', 'order'];
export const CLOUD_REVIEW_PROMPT = `你是独立的 PDF 原页转写核验员。直接查看本次附带的真实原页图片，把候选转写与原页逐项对照，不采信转写模型的自评，不判断知识是否正确，不改写作者原文。检查正文/脚注遗漏、标点与上下标、公式符号与编号、单位与表格单元格、图号图注与归一化裁图范围、阅读顺序。禁止依据常识补写看不清的内容；无法确认必须 uncertain。对空白页也检查真实图像。只输出 JSON：{"verdict":"pass","checks":[{"dimension":"coverage","passed":true,"evidence":"具体的原页对照依据"}],"issues":[],"uncertainty":[]}。checks 必须恰有 coverage/literal/equations/tables/figures/order 六项；没有公式/表格/图时写明原页不存在并通过。issue 格式为 {"blockIndex":0,"kind":"literal","detail":"原页的实际字符与候选的具体差异"}，整页遗漏的 blockIndex 为 null，kind 只用 omission/literal/equation/table/caption/geometry/order。只能在六项均通过且没有差异或疑点时 verdict:pass；有确定的原页差异用 repair；模糊字符或不确定位置用 uncertain。repair 必须给出具体 issues，不能只说需要人工核对。你没有人工验收权限。`;
export const CLOUD_REPAIR_PROMPT = `${CLOUD_PROMPT}\n这是有界转写修复。根据附带的独立核验具体差异重新查看真实原页，输出完整、忠实的当前页 JSON。仅修正原页能够直接确认的遗漏、错误字符、图注或坐标，不润色、不总结、不按知识常识替作者纠错。不确定处保留 [待核对] 与 uncertainty。`;

const encode = value => Buffer.from(JSON.stringify(value));
const kinds = new Set(['omission', 'literal', 'equation', 'table', 'caption', 'geometry', 'order']);
const shortText = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 2000;
export function decodeCloudReview(answer, candidate) {
  if (typeof answer !== 'string' || Buffer.byteLength(answer) > 128 * 1024) throw new Error('Cloud verification response exceeds budget');
  let value;
  try { value = JSON.parse(stripTrailingCommas(answer.trim().replace(/^```(?:json)?\s*|\s*```$/g, '').trim())); }
  catch { throw new Error('Cloud verification response is not complete JSON'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || !['pass', 'repair', 'uncertain'].includes(value.verdict) ||
    !Array.isArray(value.checks) || value.checks.length !== CLOUD_REVIEW_DIMENSIONS.length ||
    new Set(value.checks.map(check => check?.dimension)).size !== CLOUD_REVIEW_DIMENSIONS.length ||
    value.checks.some(check => !CLOUD_REVIEW_DIMENSIONS.includes(check?.dimension) || typeof check.passed !== 'boolean' || !shortText(check.evidence)) ||
    !Array.isArray(value.issues) || value.issues.length > 100 || value.issues.some(issue => !issue || !kinds.has(issue.kind) || !shortText(issue.detail) ||
      !(issue.blockIndex === null || (Number.isSafeInteger(issue.blockIndex) && issue.blockIndex >= 0 && issue.blockIndex < candidate.blocks.length))) ||
    !Array.isArray(value.uncertainty) || value.uncertainty.length > 100 || value.uncertainty.some(text => !shortText(text))) throw new Error('Invalid cloud verification coverage');
  if (value.verdict === 'pass' && (value.checks.some(check => !check.passed) || value.issues.length || value.uncertainty.length)) throw new Error('Cloud verification pass contradicts its findings');
  if (value.verdict === 'repair' && !value.issues.length) throw new Error('Cloud repair requires a concrete original-page discrepancy');
  if (value.verdict === 'uncertain' && !value.issues.length && !value.uncertainty.length && value.checks.every(check => check.passed)) throw new Error('Cloud uncertainty requires an explicit unresolved finding');
  return value;
}

/** Separate requests see the real page image. A model receipt is not human ground truth. */
export async function verifyCloudPage(context, port, record, { number, rendered, images, update }) {
  const imageHash = digest(rendered.data);
  const runStage = async (name, prompt, payload, decode) => {
    const inputHash = digest(encode({ prompt, imageHash, payload, route: record.route }));
    const saved = await port.readStage(number, name, inputHash);
    if (saved) return { value: decode(saved.value.answer), ref: saved.ref, syntaxRepairs: saved.value.syntaxRepairs };
    const invalidResponses = [];
    for (let syntaxRetry = 0; ; syntaxRetry++) {
      let answer;
      let incomplete;
      const reviewStage = ['review', 'rereview'].includes(name);
      // Historical checkpoints may carry the old 4k reviewer budget, which can
      // be consumed entirely by provider reasoning before any JSON is emitted.
      const initialBudget = reviewStage ? Math.max(8000, record.config.reviewMaxOutputTokens || 8000) : record.config.maxOutputTokens;
      const maxOutputTokens = syntaxRetry ? Math.min(24000, Math.max(8000, initialBudget * 2)) : initialBudget;
      for (let retry = 0; ; retry++) {
        context.signal.throwIfAborted();
        const step = context.gateway.step(`cloud-${name}:${number}:${syntaxRetry}:${retry}`, { purpose: 'convert', feature: 'scanned-textbook',
          requestedEffort: 'lowest', executionMode: 'direct', budget: { timeoutMs: 240000, maxOutputTokens } },
        { route: record.route, labels: { stage: `cloud-${name}`, file: imageHash, part: number, retry, round: syntaxRetry } });
        try {
          answer = await step.completeContent(syntaxRetry ? `${prompt}\n上次响应未通过 JSON 或字段校验。请输出完整 JSON，字符串内双引号与 LaTeX 反斜杠须正确转义，禁止 Markdown 或 JSON 外文本。` : prompt,
            [{ type: 'text', text: JSON.stringify({ page: number, width: rendered.geometry.width, height: rendered.geometry.height, ...payload }) }, ...images]);
          break;
        } catch (error) {
          if (!context.signal.aborted && /max[-_ ]tokens|finish.reason.*length|output.*(?:token|length).*limit|^Model returned no text$/i.test(String(error.message)) &&
            syntaxRetry < (record.config.syntaxRetries || 0)) { incomplete = error; break; }
          if (context.signal.aborted || !isRateLimit(error) || retry >= (record.config.rateLimitRetries || 0)) throw error;
          update(`第 ${number} 页 ${name} 遇到限流，等待重试 ${retry + 1}/${record.config.rateLimitRetries}`);
          const wait = context.gateway.step(`cloud-${name}-backoff:${number}:${syntaxRetry}:${retry}`, { purpose: 'convert', feature: 'scanned-textbook', budget: null });
          await wait.run(() => wait.observe({ boundary: 'local-wait', kind: 'wait', modelRequest: false, sideEffect: false, reason: 'provider-rate-limit' }, async signal => {
            await delay(Math.min(30000, 1000 * 2 ** retry), undefined, { signal }); return { value: null };
          }));
        }
      }
      if (incomplete) {
        invalidResponses.push({ hash: null, reason: incomplete.message.slice(0, 300), maxOutputTokens });
        update(`第 ${number} 页 ${name} 响应达到长度上限，增加预算重试一次`);
        continue;
      }
      let value;
      try { value = decode(answer); }
      catch (error) {
        if (context.signal.aborted || syntaxRetry >= (record.config.syntaxRetries || 0)) throw error;
        invalidResponses.push({ hash: digest(Buffer.from(typeof answer === 'string' ? answer : '')), reason: error.message.slice(0, 300) });
        update(`第 ${number} 页 ${name} 响应格式有误，自动修复一次`); continue;
      }
      const ref = await port.saveStage(number, name, inputHash, { answer, syntaxRepairs: syntaxRetry, invalidResponses, maxOutputTokens, executionMode: 'direct' });
      return { value, ref, syntaxRepairs: syntaxRetry };
    }
  };
  const decodeCandidate = answer => {
    const value = decodeCloudPage(answer);
    if (value.blank && rendered.geometry.nonWhiteFraction > 0.002) throw new Error(`第 ${number} 页有可见内容，转写不能为空白`);
    return value;
  };
  update(`云模型忠实转写第 ${number} 页`);
  const initial = await runStage('recognize', CLOUD_PROMPT, {}, decodeCandidate);
  if (!record.config.reviewVersion) return { value: initial.value, automatedReview: { version: 0, status: 'not-run', humanVerified: false, initialCandidateRef: initial.ref } };
  update(`独立核验第 ${number} 页的原页图像`);
  const review = await runStage('review', CLOUD_REVIEW_PROMPT, { candidate: initial.value }, answer => decodeCloudReview(answer, initial.value));
  let selected = initial, final = review, repaired = null, rereview = null;
  if (review.value.verdict === 'repair') {
    update(`按原页具体差异自动修复第 ${number} 页（最多一次）`);
    repaired = await runStage('repair', CLOUD_REPAIR_PROMPT, { candidate: initial.value, findings: review.value.issues }, decodeCandidate);
    update(`独立复审第 ${number} 页的修复结果`);
    rereview = await runStage('rereview', CLOUD_REVIEW_PROMPT, { candidate: repaired.value }, answer => decodeCloudReview(answer, repaired.value));
    final = rereview;
    // An unconfirmed rewrite never becomes the authoritative transcription.
    if (rereview.value.verdict === 'pass') selected = repaired;
  }
  const sourceUncertainty = selected.value.uncertainty.length || selected.value.blocks.some(block => block.uncertainty.length);
  const passed = final.value.verdict === 'pass' && !sourceUncertainty;
  const issues = passed ? [] : [...review.value.issues, ...(rereview?.value.issues || [])];
  const uncertainty = passed ? [] : [...new Set([...review.value.uncertainty, ...(rereview?.value.uncertainty || []), ...issues.map(issue => issue.detail)])].slice(0, 100);
  const value = structuredClone(selected.value);
  if (!passed) value.uncertainty = [...new Set([...value.uncertainty, ...uncertainty.map(text => text.slice(0, 1000))])].slice(0, 100);
  return { value, automatedReview: { version: record.config.reviewVersion, status: passed ? 'model-checked' : 'uncertain', humanVerified: false,
    route: record.route, imageHash, initialCandidateRef: initial.ref, selectedCandidateRef: selected.ref, reviewRef: review.ref,
    repairRef: repaired?.ref || null, rereviewRef: rereview?.ref || null, repairs: repaired ? 1 : 0, checks: final.value.checks, issues, uncertainty,
    syntaxRepairs: [initial, review, repaired, rereview].filter(Boolean).reduce((sum, stage) => sum + stage.syntaxRepairs, 0) } };
}
