import { reviewedCardFingerprint } from './review-integrity.js';

// Reusing an image decision also requires the same substantive review criteria.
export const VISUAL_REVIEW_VERSION = 4;

export const visualCitationSchema = { type: 'object', additionalProperties: false,
  properties: { schema: { const: 1 }, documentId: { type: 'string', minLength: 1 }, revision: { type: 'string', minLength: 1 },
    page: { type: 'integer', minimum: 1 }, blockId: { type: 'string', minLength: 1 }, assetId: { type: 'string', pattern: '^asset-[a-f0-9]{64}$' },
    imageHash: { type: 'string', pattern: '^[a-f0-9]{64}$' }, bbox: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'number', minimum: 0, maximum: 1 } },
    reviewState: { enum: ['pending', 'verified'] } },
  required: ['schema', 'documentId', 'revision', 'page', 'blockId', 'assetId', 'imageHash', 'bbox', 'reviewState'] };
const keys = Object.keys(visualCitationSchema.properties), hash = /^[a-f0-9]{64}$/;
export function visualCitationShapeIssues(refs) {
  if (refs === undefined) return [];
  if (!Array.isArray(refs) || !refs.length || refs.length > 4) return ['visual citations require 1–4 bounded image references'];
  for (const ref of refs) {
    if (!ref || typeof ref !== 'object' || Array.isArray(ref) || keys.some(key => !Object.hasOwn(ref, key)) || Object.keys(ref).some(key => !keys.includes(key)) || ref.schema !== 1 ||
      !['documentId', 'revision', 'blockId'].every(key => typeof ref[key] === 'string' && ref[key].trim() && ref[key].length <= 250) ||
      !Number.isSafeInteger(ref.page) || ref.page < 1 || !hash.test(ref.imageHash) || ref.assetId !== `asset-${ref.imageHash}` || !['pending', 'verified'].includes(ref.reviewState) ||
      !Array.isArray(ref.bbox) || ref.bbox.length !== 4 || ref.bbox.some(value => !Number.isFinite(value) || value < 0 || value > 1) || ref.bbox[0] >= ref.bbox[2] || ref.bbox[1] >= ref.bbox[3]) return ['visual citation shape/region/hash is invalid'];
  }
  if (new Set(refs.map(ref => `${ref.documentId}:${ref.revision}:${ref.blockId}`)).size !== refs.length) return ['duplicate visual image evidence'];
  return [];
}
export const publicVisualCitations = refs => Array.isArray(refs) ? refs.map(ref => Object.fromEntries(keys.map(key => [key, ref[key]]))) : undefined;

/** Caller-supplied flags are never proof. Only the owning document's server-written independent review can admit this exact card. */
export function visualReviewIssues(card, documents = []) {
  if (card.visualCitations === undefined) return [];
  const shape = visualCitationShapeIssues(card.visualCitations);
  if (shape.length) return shape;
  const fingerprint = reviewedCardFingerprint(card);
  for (const ref of card.visualCitations) {
    const document = documents.find(item => item.id === ref.documentId), version = document?.versions?.find(item => item.revision === ref.revision);
    if (!version?.visual) return ['visual evidence document/version is unavailable'];
    if (ref.reviewState !== 'verified' || !version.visual.cardReviews?.some(receipt => receipt.schema === 1 && receipt.cardId === card.id && receipt.fingerprint === fingerprint &&
      receipt.manifestHash === version.visual.manifestHash && receipt.evidenceValid === true && receipt.answerCorrect === true && receipt.independent === true &&
      receipt.citations?.some(checked => keys.every(key => JSON.stringify(checked[key]) === JSON.stringify(ref[key]))))) return ['visual evidence requires an independent image and answer review of this exact card'];
  }
  return [];
}
export function assertVisualReviews(cards, documents) {
  for (const card of cards) { const issues = visualReviewIssues(card, documents); if (issues.length) throw new Error(`${card.id}: ${issues.join('; ')}`); }
}
