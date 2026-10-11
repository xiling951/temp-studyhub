import { NATIVE_IMAGE_LIMITS } from '../../visual-model-content.js';
const text = { type: 'string', minLength: 1 }, integer = { type: 'integer', minimum: 0 };
const scope = { documentId: text, revision: text };
const input = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required });
const result = { type: 'object', additionalProperties: true };
export const visualSchemas = Object.fromEntries([
  ['status', {}, [], 'Read the opt-in scanned textbook capability; no model required.'],
  ['models', {}, [], 'Read genuine image-input model capabilities from the host catalog; no model call or credential contents.'],
  ['list', {}, [], 'List visual documents with no genuine text projection without inventing sources.'],
  ['upload.start', { name: text, size: integer }, ['name', 'size'], 'Start a library-scoped PDF upload.'],
  ['upload.append', { uploadId: text, offset: integer, data: text }, ['uploadId', 'offset', 'data'], 'Append an ordered bounded upload chunk.'],
  ['upload.finish', { uploadId: text }, ['uploadId'], 'Finish an admitted PDF upload.'],
  ['upload.cancel', { uploadId: text }, ['uploadId'], 'Discard an unclaimed PDF upload.'],
  ['import', { uploadId: text, title: text, courses: { type: 'array', items: text }, pageOffset: integer, tier: { enum: ['basic', 'standard'] }, explain: { type: 'boolean' }, parser: { enum: ['mineru', 'cloud'] }, modelKey: { type: 'string', minLength: 5, maxLength: 420 } }, ['uploadId'], 'Submit scanned textbook import through native Jobs; cloud mode requires a genuine visual route.'],
  ['reading', { ...scope, pageStart: { type: 'integer', minimum: 1 }, pageEnd: { type: 'integer', minimum: 1 }, chapterId: text }, ['documentId'], 'Read immutable reading nodes and anchors for at most ten pages.'],
  ['explain', { ...scope, pageStart: { type: 'integer', minimum: 1 }, pageEnd: { type: 'integer', minimum: 1 }, blockIds: { type: 'array', minItems: 1, maxItems: 200, uniqueItems: true, items: text }, force: { type: 'boolean' } }, ['documentId'], 'Submit genuine image explanations as a cancellable native Job; OCR remains unchanged.'],
  ['explanations', { ...scope, page: { type: 'integer', minimum: 1 } }, ['documentId'], 'Read independently versioned model notes and human reviews.'],
  ['explanation.review', { ...scope, noteId: text, status: { enum: ['verified', 'rejected'] }, text: { type: 'string', minLength: 1, maxLength: 12000 }, indexed: { type: 'boolean' } }, ['documentId', 'noteId', 'status'], 'Append a human review/correction preserving prior explanations; indexing is explicit.'],
  ['page', { ...scope, page: { type: 'integer', minimum: 1 } }, ['documentId', 'page'], 'Read one immutable visual page including historical revisions.'],
  ['preview', { ...scope, page: { type: 'integer', minimum: 1 }, blockId: text }, ['documentId', 'page'], 'Render one original PDF page or a located region on demand.'],
  ['asset', { ...scope, assetId: text }, ['documentId', 'assetId'], 'Read metadata for an asset belonging to this document version.'],
  ['chunk', { ...scope, assetId: text, offset: integer, length: { type: 'integer', minimum: 1, maximum: 262144 } }, ['documentId', 'assetId', 'offset'], 'Read up to 256 KiB through the authenticated bridge.'],
  ['export', scope, ['documentId'], 'Export one complete readable textbook ZIP, distinct from library backup.'],
  ['export.chunk', { transferId: text, offset: integer, length: { type: 'integer', minimum: 1, maximum: 262144 } }, ['transferId', 'offset'], 'Download one library-scoped archive transfer in bounded chunks.'],
  ['export.discard', { transferId: text }, ['transferId'], 'Remove a finished/cancelled temporary export transfer.'],
  ['backup.upload.start', { name: text, size: integer }, ['name', 'size'], 'Start a bounded full-library ZIP upload.'],
  ['backup.upload.append', { uploadId: text, offset: integer, data: text }, ['uploadId', 'offset', 'data'], 'Append an archive upload chunk.'],
  ['backup.upload.finish', { uploadId: text }, ['uploadId'], 'Finish an archive upload.'],
  ['backup.upload.cancel', { uploadId: text }, ['uploadId'], 'Discard an unclaimed archive upload.'],
].map(([name, properties, required, description]) => [`materials.visual.${name}`, { input: input(properties, required), output: result, description }]));

export const VISUAL_LIMITS = Object.freeze({ originalBytes: 800 * 1024 * 1024, chunkBytes: 256 * 1024, imageBytes: 8 * 1024 * 1024,
  manifestBytes: 32 * 1024 * 1024, parseWindowPages: 10, renderPixels: 12_000_000, modelImages: NATIVE_IMAGE_LIMITS.images, modelBytes: NATIVE_IMAGE_LIMITS.bytes });

export function visualEnabled(state) { return state.settings?.scannedTextbooks === true; }
export function assertVisualEnabled(state) {
  if (!visualEnabled(state)) throw Object.assign(new Error('扫描教材图文功能尚未开启，请在资料导入中开启'), { code: 'visual-disabled' });
}
