import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { convertHome } from '../../mineru-paths.js';
import { loadManifest, locateVisual, storeBytes, verifyAsset } from './visual-storage.js';
import { pdfHelper } from './visual-parser.js';
import { VISUAL_LIMITS } from './visual-contracts.js';

const inFlight = new Map();
export async function previewVisualPage({ root, read, update }, args, { signal } = {}) {
  const state = await read(), { version } = locateVisual(state, args), revision = version.revision;
  const manifest = await loadManifest(root, version.visual), page = manifest.pages.find(page => page.page === args.page);
  if (!page) throw new Error('Original page not found');
  const block = args.blockId ? page.blocks.find(block => block.id === args.blockId) : null;
  if (args.blockId && !block?.bbox) throw new Error('Original region is unlocated; open the whole page');
  const rotatedFrame = manifest.parser?.name === 'DSH cloud vision';
  const previewKey = `${page.page}:${block?.id || 'page'}:${rotatedFrame ? 'cloud-rotated:' : ''}160`;
  const existing = version.visual.previews?.find(asset => asset.previewKey === previewKey);
  if (existing) { await verifyAsset(root, existing); return { asset: existing, page: page.page, originalPage: page.originalPage }; }
  const key = `${root}:${args.documentId}:${revision}:${previewKey}`;
  if (inFlight.has(key)) return inFlight.get(key);
  const work = (async () => {
    const base = join(convertHome(root), 'visual-preview'); await mkdir(base, { recursive: true });
    const temp = await mkdtemp(join(base, 'page-'));
    try {
      const path = await verifyAsset(root, version.visual.original), target = join(temp, 'page.png');
      const dimensions = await pdfHelper([rotatedFrame ? 'cloud-render' : 'render', path, String(page.page), target, JSON.stringify(block?.bbox || null), '160'], signal);
      const asset = { ...await storeBytes(root, await readFile(target), { mime: 'image/png', kind: 'page-preview', signal, maxBytes: VISUAL_LIMITS.imageBytes }),
        width: dimensions.width, height: dimensions.height, previewKey, page: page.page, originalHash: version.visual.original.hash };
      signal?.throwIfAborted();
      await update(state => {
        signal?.throwIfAborted();
        const { version: current } = locateVisual(state, { documentId: args.documentId, revision });
        current.visual.previews ||= [];
        if (!current.visual.previews.some(item => item.previewKey === previewKey)) current.visual.previews.push(asset);
      });
      return { asset, page: page.page, originalPage: page.originalPage };
    } finally { await rm(temp, { recursive: true, force: true }); }
  })();
  inFlight.set(key, work); try { return await work; } finally { inFlight.delete(key); }
}
