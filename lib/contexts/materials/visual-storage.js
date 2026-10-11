import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { VISUAL_LIMITS } from './visual-contracts.js';
import { validateReading } from './visual-reading.js';

const HASH = /^[a-f0-9]{64}$/;
export const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const objects = root => join(root, 'attachments', 'textbooks', 'objects');
const verified = new Map();
export async function verifyAsset(root, asset) {
  const path = await objectPath(root, asset.hash), info = await lstat(path), stamp = `${info.size}:${info.mtimeMs}:${info.ctimeMs}`;
  if (info.size !== asset.bytes || asset.assetId !== `asset-${asset.hash}`) throw new Error('Resource metadata mismatch');
  if (verified.get(path) !== stamp) {
    const actual = await hashFile(path);
    if (actual.hash !== asset.hash) throw new Error('Resource hash mismatch');
    if (verified.size > 1024) verified.delete(verified.keys().next().value);
    verified.set(path, stamp);
  }
  return path;
}

async function directory(root) {
  const base = await realpath(root);
  let current = base;
  for (const part of ['attachments', 'textbooks', 'objects']) {
    current = join(current, part);
    await mkdir(current).catch(error => { if (error.code !== 'EEXIST') throw error; });
    const info = await lstat(current);
    if (info.isSymbolicLink() || !info.isDirectory() || await realpath(current) !== current) throw new Error('Unsafe textbook resource directory');
  }
  return current;
}

export async function objectPath(root, hash) {
  if (!HASH.test(hash)) throw new Error('Invalid resource identity');
  const base = await realpath(root), path = join(base, 'attachments', 'textbooks', 'objects', hash);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || await realpath(path) !== path) throw new Error('Resource escaped its library');
  return path;
}

export async function hashFile(path, signal) {
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(path, { highWaterMark: VISUAL_LIMITS.chunkBytes, signal })) { hash.update(chunk); bytes += chunk.length; }
  return { hash: hash.digest('hex'), bytes };
}

/** Complete immutable bytes first. A failed/cancelled write publishes no reference. */
export async function storeStream(root, stream, { mime, kind, maxBytes = VISUAL_LIMITS.originalBytes, signal } = {}) {
  const dir = await directory(root), temp = join(dir, `.pending-${randomUUID()}`), hash = createHash('sha256'); let bytes = 0;
  const meter = new Transform({ transform(chunk, _encoding, done) {
    bytes += chunk.length;
    if (bytes > maxBytes) return done(new Error('Textbook resource exceeds its byte budget'));
    hash.update(chunk); done(null, chunk);
  } });
  try {
    await pipeline(stream, meter, createWriteStream(temp, { flags: 'wx' }), { signal });
    signal?.throwIfAborted();
    const sha256 = hash.digest('hex'), destination = join(dir, sha256);
    const prior = await lstat(destination).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
    if (prior) {
      const existing = await hashFile(await objectPath(root, sha256), signal);
      if (existing.hash !== sha256 || existing.bytes !== bytes) throw new Error('Corrupt existing immutable resource');
      await rm(temp);
    } else await rename(temp, destination);
    return { assetId: `asset-${sha256}`, hash: sha256, bytes, mime, kind };
  } catch (error) { await rm(temp, { force: true }); throw error; }
}
export const storeBytes = (root, bytes, options) => storeStream(root, Readable.from([bytes]), options);

export async function retainPdf(root, path, { signal } = {}) {
  const file = await open(path, 'r');
  try {
    const info = await file.stat(), head = Buffer.alloc(5);
    if (!info.isFile() || info.size < 5 || info.size > VISUAL_LIMITS.originalBytes) throw new Error('PDF must be within the 800 MiB storage budget');
    await file.read(head, 0, 5, 0);
    if (head.toString() !== '%PDF-') throw new Error('Uploaded file is not a PDF');
    return await storeStream(root, file.createReadStream({ start: 0, highWaterMark: VISUAL_LIMITS.chunkBytes, autoClose: false }), { mime: 'application/pdf', kind: 'original', signal });
  } finally { await file.close(); }
}

export function locateVisual(state, { documentId, revision }) {
  const document = state.documents?.find(item => item.id === documentId);
  const version = document?.versions?.find(item => item.revision === (revision || document.currentRevision));
  if (!version?.visual || version.visual.schema !== 1) throw new Error('Visual document revision not found in this library');
  return { document, version };
}

export async function loadManifest(root, visual) {
  const path = await objectPath(root, visual.manifestHash), info = await lstat(path);
  if (info.size > VISUAL_LIMITS.manifestBytes) throw new Error('Visual manifest exceeds budget');
  const bytes = await readFile(path);
  if (digest(bytes) !== visual.manifestHash) throw new Error('Visual manifest hash mismatch');
  const manifest = JSON.parse(bytes);
  if (manifest.schema !== 1 || !Array.isArray(manifest.pages) || !Array.isArray(manifest.assets)) throw new Error('Unsupported visual manifest');
  validateReading(manifest);
  return manifest;
}

export async function saveManifest(root, manifest, { signal } = {}) {
  validateReading(manifest);
  if (manifest.schema !== 1 || !manifest.pages?.length || manifest.pages.some((page, index) => page.page !== index + 1)) throw new Error('Visual page coverage must be contiguous');
  for (const asset of manifest.assets) {
    const actual = await hashFile(await objectPath(root, asset.hash), signal);
    if (actual.hash !== asset.hash || actual.bytes !== asset.bytes || asset.assetId !== `asset-${asset.hash}`) throw new Error('Visual resource integrity failure');
  }
  const known = new Set(manifest.assets.map(asset => asset.assetId));
  for (const page of manifest.pages) for (const block of page.blocks) if (block.assetId && !known.has(block.assetId)) throw new Error('Missing block resource');
  const resource = await storeBytes(root, Buffer.from(JSON.stringify(manifest)), { mime: 'application/json', kind: 'manifest', maxBytes: VISUAL_LIMITS.manifestBytes, signal });
  return { schema: 1, manifestHash: resource.hash, original: manifest.assets.find(asset => asset.kind === 'original'),
    fingerprint: manifest.fingerprint, pageCount: manifest.pages.length, status: 'complete', quality: manifest.quality,
    ...(manifest.reading ? { reading: { schema: 1, nodeCount: manifest.reading.nodes.length, chapterCount: manifest.reading.chapters.length } } : {}) };
}

export async function scopedAsset(root, state, args) {
  const { document, version } = locateVisual(state, args), manifest = await loadManifest(root, version.visual);
  if (manifest.documentId !== document.id || manifest.revision !== version.revision) throw new Error('Visual manifest ownership mismatch');
  const asset = manifest.assets.find(item => item.assetId === args.assetId) || version.visual.previews?.find(item => item.assetId === args.assetId);
  if (!asset) throw new Error('Asset does not belong to this document revision');
  await verifyAsset(root, asset);
  return { asset, manifest, document, version };
}

export async function readChunk(root, asset, { offset, length = VISUAL_LIMITS.chunkBytes }) {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > asset.bytes || !Number.isInteger(length) || length < 1 || length > VISUAL_LIMITS.chunkBytes) throw new Error('Invalid bounded resource request');
  const file = await open(await objectPath(root, asset.hash), 'r');
  try {
    if ((await file.stat()).size !== asset.bytes) throw new Error('Resource size mismatch');
    const buffer = Buffer.alloc(Math.min(length, asset.bytes - offset));
    const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
    return { offset, bytes: bytesRead, totalBytes: asset.bytes, dataBase64: buffer.subarray(0, bytesRead).toString('base64'), done: offset + bytesRead === asset.bytes };
  } finally { await file.close(); }
}

// Conservative retention: no resource GC until all version/card/job references can be proved absent.
export const visualObjectsDirectory = root => resolve(objects(root));
