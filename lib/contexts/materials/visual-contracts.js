const text = { type: 'string', minLength: 1 }, integer = { type: 'integer', minimum: 0 };
const scope = { documentId: text, revision: text };
const input = (properties, required = []) => ({ type: 'object', additionalProperties: false, properties, required });
const result = { type: 'object', additionalProperties: true };
export const visualSchemas = Object.fromEntries([
  ['status', {}, [], 'Read the opt-in scanned textbook capability; no model required.'],
  ['upload.start', { name: text, size: integer }, ['name', 'size'], 'Start a library-scoped PDF upload.'],
  ['upload.append', { uploadId: text, offset: integer, data: text }, ['uploadId', 'offset', 'data'], 'Append an ordered bounded upload chunk.'],
  ['upload.finish', { uploadId: text }, ['uploadId'], 'Finish an admitted PDF upload.'],
  ['upload.cancel', { uploadId: text }, ['uploadId'], 'Discard an unclaimed PDF upload.'],
  ['import', { uploadId: text, title: text, courses: { type: 'array', items: text }, pageOffset: integer, tier: { enum: ['basic', 'standard'] } }, ['uploadId'], 'Submit scanned textbook import through native Jobs; no arbitrary file path.'],
  ['page', { ...scope, page: { type: 'integer', minimum: 1 } }, ['documentId', 'page'], 'Read one immutable visual page including historical revisions.'],
  ['asset', { ...scope, assetId: text }, ['documentId', 'assetId'], 'Read metadata for an asset belonging to this document version.'],
  ['chunk', { ...scope, assetId: text, offset: integer, length: { type: 'integer', minimum: 1, maximum: 262144 } }, ['documentId', 'assetId', 'offset'], 'Read up to 256 KiB through the authenticated bridge.'],
].map(([name, properties, required, description]) => [`materials.visual.${name}`, { input: input(properties, required), output: result, description }]));

export const VISUAL_LIMITS = Object.freeze({ originalBytes: 800 * 1024 * 1024, chunkBytes: 256 * 1024, imageBytes: 8 * 1024 * 1024,
  manifestBytes: 32 * 1024 * 1024, parseWindowPages: 10, renderPixels: 12_000_000, modelImages: 4, modelBytes: 8 * 1024 * 1024 });

export function visualEnabled(state) { return state.settings?.scannedTextbooks === true; }
export function assertVisualEnabled(state) {
  if (!visualEnabled(state)) throw Object.assign(new Error('扫描教材图文功能尚未开启，请在资料导入中开启'), { code: 'visual-disabled' });
}
