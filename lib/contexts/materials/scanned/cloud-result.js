import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { storeBytes } from '../visual-storage.js';
import { VISUAL_LIMITS } from '../visual-contracts.js';
import { pdfHelper } from '../visual-parser.js';

export const CLOUD_ADAPTER = 1;
export const CLOUD_RENDER_DPI = 200;
export const CLOUD_PROMPT = `忠实转写当前 PDF 原页，禁止总结、补写、解释知识或猜测模糊字符。只输出 JSON：{"blank":false,"printedPage":null,"blocks":[{"type":"text","text":"逐字原文","bbox":[0,0,1,1],"uncertainty":[]}],"uncertainty":[]}。blocks 按阅读顺序排列。type 只用 title/text/image/chart/table/equation/page_header/page_footer/page_number。bbox 为当前图片归一化坐标 [左,上,右,下]。图表范围包含完整图号、图注、子图和端口；image/chart 的 text 仅包含实际图注，不能填图解。equation 的 text 使用忠实 LaTeX；table 的 text 使用逐字 Markdown 表格。不清楚处写 [待核对] 并在 uncertainty 说明。没有内容才 blank:true。禁止 HTML、资源路径和图片 URL。不要遗漏正文、脚注、公式编号或表格单元格。`;
const bboxValid = value => Array.isArray(value) && value.length === 4 && value.every(n => Number.isFinite(n) && n >= 0 && n <= 1) && value[0] < value[2] && value[1] < value[3];
const types = new Set(['title', 'text', 'image', 'chart', 'table', 'equation', 'page_header', 'page_footer', 'page_number']);
const uncertain = value => Array.isArray(value) && value.length <= 100 && value.every(text => typeof text === 'string' && text.length <= 1000);
export function decodeCloudPage(answer) {
  if (typeof answer !== 'string' || Buffer.byteLength(answer) > 512 * 1024) throw new Error('Cloud page response exceeds budget');
  let value;
  try { value = JSON.parse(answer.replace(/^```(?:json)?\s*|\s*```$/g, '').trim()); } catch { throw Object.assign(new Error('云识别响应不完整或非 JSON；该页未提交，请重试解析'), { code: 'cloud-response-invalid' }); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Cloud page response must be an object');
  // A numeric printed page is literal page metadata, not inferred document text.
  if (Number.isSafeInteger(value.printedPage) && value.printedPage >= 0 && value.printedPage <= 100000) value.printedPage = String(value.printedPage);
  if (typeof value.blank !== 'boolean' || !uncertain(value.uncertainty) || !(value.printedPage === null || (typeof value.printedPage === 'string' && value.printedPage.length <= 40)) ||
    !Array.isArray(value.blocks) || value.blocks.length > 400 || (value.blank && value.blocks.length) || (!value.blank && !value.blocks.length)) {
    const shape = { blankType: typeof value.blank, printedPageType: typeof value.printedPage, blocks: Array.isArray(value.blocks) ? value.blocks.length : typeof value.blocks, uncertaintyValid: uncertain(value.uncertainty) };
    throw new Error(`Invalid cloud page coverage: ${JSON.stringify(shape)}`);
  }
  let characters = 0;
  for (const block of value.blocks) {
    if (!types.has(block.type) || typeof block.text !== 'string' || block.text.length > 40000 || !uncertain(block.uncertainty) || (block.bbox !== null && !bboxValid(block.bbox))) throw new Error('Invalid cloud block or bounding box');
    characters += block.text.length;
    if (characters > 80000) throw new Error('Cloud page text exceeds budget');
    if (/<\/?(?:script|iframe|img|table|a)\b/i.test(block.text)) throw new Error('Cloud output must contain transcription, not executable HTML');
  }
  return value;
}

export async function renderCloudRegion(root, originalPath, number, renderDir, bbox, signal) {
  const target = join(renderDir, `p${number}-${Math.random().toString(16).slice(2)}.png`);
  try {
    const geometry = await pdfHelper(['cloud-render', originalPath, String(number), target, JSON.stringify(bbox), String(CLOUD_RENDER_DPI)], signal);
    const data = await readFile(target);
    if (data.length > VISUAL_LIMITS.modelBytes || geometry.width * geometry.height > VISUAL_LIMITS.renderPixels) throw new Error('Rendered page exceeds image budget');
    return { data, mediaType: 'image/png', geometry };
  } finally { await rm(target, { force: true }); }
}

export async function adaptCloudPage(root, value, { number, originalPath, renderDir, signal, rendered }) {
  if (value.blank && rendered.geometry.nonWhiteFraction > 0.002) throw new Error(`第 ${number} 页有可见内容，模型却返回空白；该页未发布`);
  const blocks = [], assets = new Map(); let text = '';
  for (const [index, raw] of value.blocks.entries()) {
    const block = { id: `p${number}-b${index}`, type: raw.type, order: index, text: raw.text, bbox: raw.bbox,
      coordinateSystem: 'normalized-rotated-page', captions: [], origin: 'cloud-transcription', quality: 'needs-review', uncertainty: raw.uncertainty };
    if (block.text) {
      if (text) text += '\n\n';
      block.textRange = { start: text.length, end: text.length + block.text.length }; text += block.text;
    }
    if (['image', 'chart', 'table', 'equation'].includes(block.type)) {
      if (raw.bbox) {
        const padded = raw.bbox.map((n, i) => Math.max(0, Math.min(1, n + (i < 2 ? -0.015 : 0.015))));
        const crop = await renderCloudRegion(root, originalPath, number, renderDir, padded, signal);
        const asset = await storeBytes(root, crop.data, { mime: 'image/png', kind: raw.type, maxBytes: VISUAL_LIMITS.imageBytes, signal });
        block.candidateBbox = raw.bbox; block.bbox = crop.geometry.bbox; block.cropVerified = false;
        block.render = crop.geometry; block.assetId = asset.assetId;
        assets.set(asset.assetId, { ...asset, width: crop.geometry.width, height: crop.geometry.height });
      } else block.quality = 'original-page-fallback';
    }
    blocks.push(block);
  }
  const preview = await storeBytes(root, rendered.data, { mime: 'image/png', kind: 'page-preview', maxBytes: VISUAL_LIMITS.imageBytes, signal });
  assets.set(preview.assetId, { ...preview, width: rendered.geometry.width, height: rendered.geometry.height });
  // Keep unlocated figures visible as the actual original page; never invent a crop or silently omit them.
  for (const block of blocks) if (block.quality === 'original-page-fallback') block.assetId = preview.assetId;
  return { page: { page: number, originalPage: number, printedPage: value.printedPage, sourceId: null, text, blocks,
    status: value.blank ? 'blank' : text.trim() ? 'cloud-needs-review' : 'image-only', uncertainty: value.uncertainty, render: rendered.geometry, previewAssetId: preview.assetId }, assets: [...assets.values()] };
}
