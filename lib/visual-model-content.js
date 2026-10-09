import { VISUAL_LIMITS } from './contexts/materials/visual-contracts.js';

const unavailable = (code, message) => Object.assign(new Error(message), { code });
export function validateVisualContent(parts) {
  if (!Array.isArray(parts) || !parts.length) throw unavailable('visual-content-invalid', 'Explicit native image content is required');
  let images = 0, bytes = 0;
  for (const part of parts) {
    if (part.type === 'text' && typeof part.text === 'string') continue;
    const ref = part.attachment;
    if (part.type !== 'image' || !ref || typeof ref.attachmentId !== 'string' || !ref.mediaType?.startsWith('image/') || !Number.isSafeInteger(ref.bytes) || ref.bytes < 1) throw unavailable('visual-content-invalid', 'Use DSH-admitted image references, not paths or image_url');
    if (part.offloaded === true || ref.offloaded === true) throw unavailable('visual-offloaded', '图片已卸载为占位内容，本次不能作为看图调用');
    images++; bytes += ref.bytes;
  }
  if (!images || images > VISUAL_LIMITS.modelImages || bytes > VISUAL_LIMITS.modelBytes) throw unavailable('visual-budget-exceeded', '图像调用须为 1–4 张、合计不超过 8 MiB');
  return structuredClone(parts);
}
export async function assertVisualRoute(ctx, route, signal) {
  if (!ctx.llm?.resolveModelInfo || !route) throw unavailable('visual-model-unavailable', '没有可用的 DSH 视觉模型');
  const model = await ctx.llm.resolveModelInfo(route.provider, route.model, signal);
  if (!model.inputModalities?.includes('image')) throw unavailable(model.inputModalities ? 'visual-model-unsupported' : 'visual-capability-unknown', '当前模型未声明图像输入能力，请选择支持视觉的模型');
  return model;
}
export async function admitVisualImages(ctx, images, signal) {
  const attachments = ctx.get?.('attachments') || ctx.attachments;
  if (!attachments?.saveImages || !attachments?.readImage) throw unavailable('visual-attachments-unavailable', 'DSH 原生图片附件服务不可用');
  if (!images.length || images.length > VISUAL_LIMITS.modelImages || images.reduce((sum, image) => sum + image.data.length, 0) > VISUAL_LIMITS.modelBytes) throw unavailable('visual-budget-exceeded', '图像附件超过调用预算');
  signal?.throwIfAborted();
  const refs = await attachments.saveImages(images);
  signal?.throwIfAborted();
  return refs.map(attachment => ({ type: 'image', attachment }));
}
export async function verifyVisualReferences(ctx, parts, signal) {
  const attachments = ctx.get?.('attachments') || ctx.attachments;
  if (!attachments?.readImage) throw unavailable('visual-attachments-unavailable', 'DSH 原生图片附件服务不可用');
  for (const part of parts) if (part.type === 'image') { signal?.throwIfAborted(); await attachments.readImage(part.attachment, signal); }
}
