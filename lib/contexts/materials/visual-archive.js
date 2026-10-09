import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runLocalCommand } from '../../local-command.js';
import { convertHome } from '../../mineru-paths.js';
import { readDiagramFile, writeDiagramFile } from '../../skeleton-diagrams.js';
import { attachmentPath } from './files.js';
import { hashFile, loadManifest, locateVisual, objectPath, storeStream, verifyAsset } from './visual-storage.js';
import { textbookOutputs } from './visual-export-html.js';

const helper = fileURLToPath(new URL('./visual-zip.py', import.meta.url)), require = createRequire(import.meta.url);
const HASH = /^[a-f0-9]{64}$/, SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;
async function zip(args, signal) {
  const result = await runLocalCommand({ file: process.env.STUDYHUB_PDF_PYTHON || 'python' }, [helper, ...args], { signal, timeoutMs: 10 * 60 * 1000 });
  if (result.code !== 0) throw new Error('Archive integrity/path/budget validation failed; current library state was not replaced');
  return JSON.parse(result.stdout);
}
async function boundedState(path) {
  if ((await lstat(path)).size > 64 * 1024 * 1024) throw new Error('Library metadata exceeds 64 MiB restore budget');
  return JSON.parse(await readFile(path, 'utf8'));
}
async function checkedLegacy(root, ref) {
  const path = attachmentPath(root, ref), canonical = await realpath(root);
  if (await realpath(path) !== join(canonical, ref.path) || (await lstat(path)).isSymbolicLink()) throw new Error('Unsafe legacy original');
  const actual = await hashFile(path);
  if (actual.hash !== ref.hash || actual.bytes !== ref.bytes) throw new Error('Legacy original integrity mismatch');
  return path;
}

/** Ephemeral bounded transfer handles, not a second job scheduler or database. Owned by one runtime. */
export function createVisualArchives({ root, read, uploads }) {
  const transfers = new Map();
  const temporary = async () => { const base = join(convertHome(root), 'visual-archives'); await mkdir(base, { recursive: true }); return mkdtemp(join(base, 'transfer-')); };
  const register = (dir, info, filename) => {
    const id = randomUUID(); transfers.set(id, { dir, path: join(dir, 'archive.zip'), bytes: info.bytes, hash: info.sha256 });
    return { transferId: id, bytes: info.bytes, hash: info.sha256, filename, expandedBytes: info.expandedBytes, entries: info.entries };
  };
  const transfer = id => { const found = transfers.get(id); if (!found) throw new Error('Archive transfer is unavailable in this library/runtime'); return found; };
  const build = async (dir, format, entries, filename, metadata, signal) => {
    const plan = join(dir, 'plan.json'); await writeFile(plan, JSON.stringify({ format, entries, metadata }));
    try { return register(dir, await zip(['pack', plan, join(dir, 'archive.zip')], signal), filename); }
    catch (error) { await rm(dir, { recursive: true, force: true }); throw error; }
  };
  async function book(args, { signal } = {}) {
    const { document, version } = locateVisual(await read(), args), manifest = await loadManifest(root, version.visual), dir = await temporary(), entries = [], names = new Map();
    for (const asset of manifest.assets) {
      const path = await verifyAsset(root, asset), name = asset.kind === 'original' ? 'original.pdf' : `figures/${asset.hash}.${asset.mime === 'image/png' ? 'png' : 'jpg'}`;
      entries.push({ name, path }); if (asset.kind !== 'original') names.set(asset.assetId, name);
    }
    const outputs = textbookOutputs(document, manifest, names);
    for (const [name, contents] of Object.entries({ 'index.html': outputs.html, 'textbook.md': outputs.markdown, 'document.json': JSON.stringify(manifest), 'quality-report.json': JSON.stringify(manifest.quality), 'figure-notes.json': JSON.stringify(version.visual.explanations || []) })) {
      const path = join(dir, name); await writeFile(path, contents); entries.push({ name, path });
    }
    const css = require.resolve('katex/dist/katex.min.css'), fonts = join(dirname(css), 'fonts');
    entries.push({ name: 'styles/katex.min.css', path: css });
    for (const name of await readdir(fonts)) if (/^[A-Za-z0-9_-]+\.woff2?$/.test(name)) entries.push({ name: `styles/fonts/${name}`, path: join(fonts, name) });
    return build(dir, 'studyhub-textbook/v1', entries, 'textbook.zip', { documentId: document.id, revision: version.revision, pages: manifest.pages.length }, signal);
  }
  async function backup(state, { signal } = {}) {
    const authoritative = await read(), known = new Map((authoritative.documents || []).map(document => [document.id, document]));
    const dir = await temporary(), entries = [], objects = new Map(), legacy = new Map();
    for (const document of state.documents || []) for (const version of document.versions || []) {
      const owner = known.get(document.id)?.versions?.find(item => item.revision === version.revision);
      if (!owner || JSON.stringify(owner.visual) !== JSON.stringify(version.visual) || JSON.stringify(owner.attachment) !== JSON.stringify(version.attachment)) throw new Error('Backup document revision changed; retry export');
      if (version.visual) {
        const manifest = await loadManifest(root, version.visual);
        objects.set(version.visual.manifestHash, { hash: version.visual.manifestHash, bytes: (await lstat(await objectPath(root, version.visual.manifestHash))).size, assetId: `asset-${version.visual.manifestHash}` });
        for (const asset of [...manifest.assets, ...(version.visual.previews || [])]) objects.set(asset.hash, asset);
      }
      if (version.attachment) legacy.set(version.attachment.path, version.attachment);
    }
    for (const [hash, asset] of objects) entries.push({ name: `objects/${hash}`, path: await verifyAsset(root, asset) });
    for (const ref of legacy.values()) entries.push({ name: `legacy/${ref.hash}.${ref.format}`, path: await checkedLegacy(root, ref) });
    for (const skeleton of state.skeletons || []) for (const record of skeleton.diagrams || []) {
      const { file } = await readDiagramFile(root, skeleton.id, record);
      entries.push({ name: `diagrams/${skeleton.id}/${record.id}.html`, path: file });
    }
    const json = JSON.stringify(state); if (Buffer.byteLength(json) > 64 * 1024 * 1024) throw new Error('Library metadata exceeds backup budget');
    const path = join(dir, 'library.json'); await writeFile(path, json); entries.push({ name: 'library.json', path });
    return build(dir, 'studyhub-library-backup/v1', entries, 'studyhub-library.zip', { storeVersion: 4,
      externalReferences: (state.documents || []).flatMap(document => document.versions.filter(version => version.external && !version.attachment).map(version => ({ documentId: document.id, revision: version.revision, bytes: version.external.bytes }))) }, signal);
  }
  async function stage(uploadId, { signal } = {}) {
    const upload = uploads.claimUpload(root, uploadId), dir = await temporary();
    try {
      if (!upload.name.toLowerCase().endsWith('.zip')) throw new Error('Restore requires the ZIP backup upload');
      await zip(['unpack', upload.path, dir], signal);
      const state = await boundedState(join(dir, 'library.json'));
      if (state.version !== 4 || !Array.isArray(state.sources) || !Array.isArray(state.decks)) throw new Error('Unsupported library snapshot');
      const archive = await boundedState(join(dir, 'manifest.json')), known = new Map(archive.files.map(file => [file.name, file]));
      const refs = new Map(), legacy = new Map();
      for (const document of state.documents || []) for (const version of document.versions || []) {
        if (version.visual) {
          if (!HASH.test(version.visual.manifestHash)) throw new Error('Invalid visual manifest identity');
          const name = `objects/${version.visual.manifestHash}`, proof = known.get(name);
          if (!proof || proof.sha256 !== version.visual.manifestHash) throw new Error('Backup visual manifest is missing or corrupt');
          const manifest = await boundedState(join(dir, name));
          if (manifest.documentId !== document.id || manifest.revision !== version.revision || manifest.schema !== 1) throw new Error('Backup document ownership mismatch');
          if (!Array.isArray(manifest.pages) || manifest.pages.length !== version.visual.pageCount || manifest.pages.some((page, index) => page.page !== index + 1)) throw new Error('Backup visual page coverage mismatch');
          const original = manifest.assets?.find(asset => asset.kind === 'original');
          if (!original || JSON.stringify(original) !== JSON.stringify(version.visual.original)) throw new Error('Backup original descriptor mismatch');
          for (const page of manifest.pages) if (page.sourceId !== null) {
            const source = state.sources.find(source => source.id === page.sourceId);
            if (!source || !version.sourceIds.includes(page.sourceId) || source.text !== page.text) throw new Error('Backup OCR projection mismatch');
          }
          refs.set(version.visual.manifestHash, { hash: version.visual.manifestHash, bytes: proof.bytes, mime: 'application/json', kind: 'manifest' });
          const assets = new Set(manifest.assets.map(asset => asset.assetId));
          for (const page of manifest.pages) for (const block of page.blocks) if (block.assetId && !assets.has(block.assetId)) throw new Error('Backup block resource missing');
          for (const asset of [...manifest.assets, ...(version.visual.previews || [])]) {
            if (!HASH.test(asset.hash) || asset.assetId !== `asset-${asset.hash}`) throw new Error('Invalid asset identity');
            const proof = known.get(`objects/${asset.hash}`);
            if (!proof || proof.sha256 !== asset.hash || proof.bytes !== asset.bytes) throw new Error('Backup asset missing or hash mismatch');
            refs.set(asset.hash, asset);
          }
        }
        if (version.attachment) {
          attachmentPath(root, version.attachment);
          const name = `legacy/${version.attachment.hash}.${version.attachment.format}`, proof = known.get(name);
          if (!proof || proof.sha256 !== version.attachment.hash || proof.bytes !== version.attachment.bytes) throw new Error('Backup legacy original missing');
          legacy.set(name, version.attachment);
        }
      }
      // Verify every diagram before any library mutation; existing differing IDs are refused rather than overwritten.
      const diagrams = [];
      for (const skeleton of state.skeletons || []) for (const record of skeleton.diagrams || []) {
        if (!SAFE_ID.test(skeleton.id) || !SAFE_ID.test(record.id)) throw new Error('Unsafe diagram identity');
        const name = `diagrams/${skeleton.id}/${record.id}.html`, proof = known.get(name);
        if (!proof || proof.sha256 !== record.sha256 || proof.bytes !== record.bytes) throw new Error('Backup diagram missing or corrupt');
        const path = join(root, 'skeleton-diagrams', skeleton.id, `${record.id}.html`);
        if (await lstat(path).catch(() => null)) await readDiagramFile(root, skeleton.id, record);
        else diagrams.push({ skeletonId: skeleton.id, id: record.id, text: await readFile(join(dir, name), 'utf8') });
      }
      for (const asset of refs.values()) {
        const saved = await storeStream(root, createReadStream(join(dir, `objects/${asset.hash}`)), { mime: asset.mime, kind: asset.kind, signal });
        if (saved.hash !== asset.hash) throw new Error('Restored asset hash mismatch');
      }
      for (const [name, ref] of legacy) {
        const target = attachmentPath(root, ref); await mkdir(dirname(target), { recursive: true });
        if (await lstat(target).catch(() => null)) await checkedLegacy(root, ref);
        else await copyFile(join(dir, name), target);
      }
      for (const file of diagrams) await writeDiagramFile(root, file.skeletonId, file.id, file.text);
      await uploads.discardUpload(upload);
      return { state, integrityVerified: true, entries: known.size };
    } catch (error) { uploads.releaseUpload(upload); throw error; }
    finally { await rm(dir, { recursive: true, force: true }); }
  }
  return { book, backup, stage,
    async chunk({ transferId, offset, length }) { const record = transfer(transferId); return readChunkTransfer(record, { offset, length }); },
    async discard({ transferId }) { const record = transfer(transferId); transfers.delete(transferId); await rm(record.dir, { recursive: true, force: true }); return { discarded: true }; },
  };
}
async function readChunkTransfer(record, args) {
  // Reuse the bounded resource reader with a controlled ephemeral file, without accepting public paths.
  const { open } = await import('node:fs/promises');
  const { offset, length = 262144 } = args;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > record.bytes || !Number.isInteger(length) || length < 1 || length > 262144) throw new Error('Invalid archive chunk request');
  const file = await open(record.path, 'r');
  try { const data = Buffer.alloc(Math.min(length, record.bytes - offset)), { bytesRead } = await file.read(data, 0, data.length, offset); return { offset, bytes: bytesRead, totalBytes: record.bytes, dataBase64: data.subarray(0, bytesRead).toString('base64'), done: offset + bytesRead === record.bytes }; }
  finally { await file.close(); }
}
