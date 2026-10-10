import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { runLocalCommand } from '../../local-command.js';
import { digest, hashFile, objectPath, storeBytes } from './visual-storage.js';
import { VISUAL_LIMITS } from './visual-contracts.js';
import { rasterDimensions } from './visual-raster.js';
import { associateVisualCaptions } from './visual-captions.js';

const BASE = 'http://127.0.0.1:16580/v1';
const helper = fileURLToPath(new URL('./scanned-pdf.py', import.meta.url));
const validBbox = value => Array.isArray(value) && value.length === 4 && value.every(number => Number.isFinite(number) && number >= 0 && number <= 1) && value[0] < value[2] && value[1] < value[3];
export const parserFingerprint = (hash, tier, pageOffset = 0, adapter = 2) => digest(Buffer.from(JSON.stringify({ hash, parser: 'MinerU-4.0.11', tier, mode: 'auto', adapter, resources: 1, pageOffset })));

export async function pdfHelper(args, signal) {
  const response = await runLocalCommand({ file: process.env.STUDYHUB_PDF_PYTHON || 'python' }, [helper, ...args], { signal, timeoutMs: 60000 });
  if (response.code !== 0) throw Object.assign(new Error('PDF preview helper failed; install Python + PyMuPDF or configure STUDYHUB_PDF_PYTHON'), { code: 'pdf-helper-unavailable' });
  return JSON.parse(response.stdout);
}

async function boundedJson(response, maxBytes = VISUAL_LIMITS.manifestBytes) {
  if (!response.ok) throw Object.assign(new Error(`Local MinerU API HTTP ${response.status}`), { code: `mineru-http-${response.status}` });
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body) { bytes += chunk.length; if (bytes > maxBytes) throw new Error('MinerU result exceeds bounded window budget'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8'));
}

/** Public same-version local API. Polling is bounded; cancellation reaches the external parse job. */
export async function parseWindow(path, start, end, { tier, signal, fetcher = fetch }) {
  const job = await boundedJson(await fetcher(`${BASE}/parse/jobs`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ files: [{ source: { type: 'local', path }, page_range: `${start}-${end}` }], tier, output_formats: ['structured_content'] }), signal }));
  if (typeof job.job_id !== 'string') throw new Error('MinerU public job ID missing');
  try {
    const deadline = Date.now() + 15 * 60 * 1000;
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      const current = await boundedJson(await fetcher(`${BASE}/parse/jobs/${job.job_id}`, { signal }));
      if (current.status === 'completed') {
        const file = current.files?.[0], resource = file?.output_files?.structured_content;
        if (file?.status !== 'completed' || !resource?.file_id) throw new Error('MinerU did not publish structured image content');
        if (file.parse?.parser_version !== '4.0.11') throw Object.assign(new Error('Visual adapter requires verified MinerU 4.0.11'), { code: 'parser-version-mismatch' });
        return boundedJson(await fetcher(`${BASE}/files/${encodeURIComponent(resource.file_id)}/content`, { signal }));
      }
      if (['failed', 'cancelled', 'canceled'].includes(current.status)) throw new Error(`MinerU parse ${current.status}: ${current.files?.[0]?.error?.code || 'no-output'}`);
      await delay(500, undefined, { signal });
    }
    throw new Error('MinerU parse window timed out');
  } catch (error) {
    await fetcher(`${BASE}/parse/jobs/${job.job_id}`, { method: 'DELETE', signal: AbortSignal.timeout(5000) }).catch(() => {});
    throw error;
  }
}

export async function adaptWindow(root, raw, { start, end, originalPath, pageOffset = 0, signal, renderDir }) {
  const pages = [], assets = new Map();
  if (!Array.isArray(raw.pages)) throw new Error('Invalid public structured-content response');
  for (let number = start; number <= end; number++) {
    signal?.throwIfAborted();
    const matches = raw.pages.filter(page => page.page_idx === number - 1);
    if (matches.length !== 1) throw new Error(`Missing or duplicate parsed page ${number}`);
    const blocks = [];
    for (const [index, source] of (matches[0].blocks || []).entries()) {
      const captions = (source.captions || []).map(caption => ({ text: String(caption.content || ''), bbox: validBbox(caption.bbox) ? caption.bbox : null }));
      const text = typeof source.content === 'string' ? source.content : '';
      const bbox = validBbox(source.bbox) ? source.bbox : null;
      const block = { id: `p${number}-b${index}`, type: String(source.type || 'unknown'), order: index, text,
        bbox, coordinateSystem: 'normalized-rotated-page', captions, origin: 'ocr', quality: bbox ? 'needs-review' : 'unlocated' };
      const figure = captions.map(caption => caption.text).join(' ').match(/图\s*(\d+[.．]\d+)/);
      if (figure) block.figureNumber = figure[1].replace('．', '.');
      const encoded = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/]+=*)$/.exec(source.image_source || '');
      let bytes, mime, dimensions;
      if (encoded) {
        if (encoded[2].length > Math.ceil(VISUAL_LIMITS.imageBytes / 3) * 4) throw new Error('Parser image exceeds asset budget');
        bytes = Buffer.from(encoded[2], 'base64'); mime = encoded[1];
        if (bytes.toString('base64') !== encoded[2]) throw new Error('Noncanonical parser image payload');
      } else if (['image', 'chart', 'table', 'equation'].includes(block.type) && bbox) {
        await mkdir(renderDir, { recursive: true });
        const target = join(renderDir, `${block.id}.png`);
        dimensions = await pdfHelper(['render', originalPath, String(number), target, JSON.stringify(bbox), '200'], signal);
        bytes = await readFile(target); mime = 'image/png'; await rm(target);
        block.origin = 'pdf-region';
      }
      if (bytes) {
        dimensions ||= rasterDimensions(bytes, mime);
        const resource = await storeBytes(root, bytes, { mime, kind: block.type, maxBytes: VISUAL_LIMITS.imageBytes, signal });
        block.assetId = resource.assetId;
        assets.set(resource.assetId, { ...resource, ...(dimensions ? { width: dimensions.width, height: dimensions.height } : {}) });
        block.quality = 'needs-review';
      } else if (['image', 'chart', 'table', 'equation'].includes(block.type)) block.quality = 'original-page-fallback';
      blocks.push(block);
    }
    // Preserve the literal public OCR projection before correcting visual caption associations.
    const evidenceText = blocks.flatMap(block => [block.text, ...block.captions.map(caption => caption.text)]).filter(Boolean).join('\n\n');
    pages.push({ page: number, originalPage: number + pageOffset, printedPage: blocks.find(block => block.type === 'page_number')?.text || null,
      sourceId: null, text: evidenceText, blocks: associateVisualCaptions(blocks, number), status: evidenceText.trim() ? 'ocr-needs-review' : blocks.some(block => block.assetId) ? 'image-only' : 'blank-or-unrecognized' });
  }
  return { pages, assets: [...assets.values()] };
}

export async function verifiedWindowCache(root, fingerprint, start, end) {
  const path = join(root, 'attachments', 'textbooks', 'cache', `${fingerprint}-${start}-${end}.json`);
  const value = await readFile(path, 'utf8').then(JSON.parse, () => null);
  if (!value || value.fingerprint !== fingerprint || value.start !== start || value.end !== end || value.pages?.length !== end - start + 1) return null;
  try {
    for (const asset of value.assets) if ((await hashFile(await objectPath(root, asset.hash))).hash !== asset.hash) return null;
    for (const [index, page] of value.pages.entries()) if (page.page !== start + index) return null;
    return value;
  } catch { return null; }
}

export async function saveWindowCache(root, fingerprint, start, end, result) {
  const dir = join(root, 'attachments', 'textbooks', 'cache'); await mkdir(dir, { recursive: true });
  const file = join(dir, `${fingerprint}-${start}-${end}.json`), pending = `${file}.pending`;
  await writeFile(pending, JSON.stringify({ fingerprint, start, end, ...result })); await rename(pending, file);
}
