import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { createStudyRuntime } from '../lib/runtime/builtins.js';
import { importVisualPdf } from '../lib/contexts/materials/visual-import.js';
import { digest } from '../lib/contexts/materials/visual-storage.js';
import { runLocalCommand } from '../lib/local-command.js';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'scanned-archive-')); t.after(() => rm(root, { recursive: true, force: true }));
  const runtime = createStudyRuntime(root); t.after(() => runtime.dispose());
  return { root, runtime };
}
async function upload(runtime, bytes) {
  const receipt = await runtime.call('materials.visual.backup.upload.start', { name: 'backup.zip', size: bytes.length });
  for (let offset = 0; offset < bytes.length; offset += 262144) await runtime.call('materials.visual.backup.upload.append', { uploadId: receipt.uploadId, offset, data: bytes.subarray(offset, offset + 262144).toString('base64') });
  await runtime.call('materials.visual.backup.upload.finish', { uploadId: receipt.uploadId }); return receipt.uploadId;
}
async function download(runtime, result) {
  const chunks = [];
  for (let offset = 0; offset < result.bytes;) {
    const chunk = await runtime.call('materials.visual.export.chunk', { transferId: result.transferId, offset });
    chunks.push(Buffer.from(chunk.dataBase64, 'base64')); offset += chunk.bytes;
  }
  const bytes = Buffer.concat(chunks); assert.equal(digest(bytes), result.hash); return bytes;
}

test('textbook export contains actual original/images/offline math; full archive restores old attachments and SM-2 without JSON bulk transport', async t => {
  const { root, runtime } = await fixture(t), destination = await fixture(t);
  const pdf = await PDFDocument.create(); pdf.addPage([300, 400]); const path = join(root, 'fixture.pdf'); await writeFile(path, await pdf.save());
  const imported = await importVisualPdf({ root, path, name: '教材.pdf', read: () => runtime.storage.read(), update: fn => runtime.storage.update(fn),
    parse: async () => ({ pages: [{ page_idx: 0, blocks: [{ type: 'equation', content: 'E=mc^2', bbox: [0.1, 0.1, 0.8, 0.3] }] }] }) });
  const notes = [{ id: 'fixture-pending', text: 'Synthetic pending model note', review: 'pending', indexed: false }, { id: 'fixture-correction', supersedes: 'fixture-pending', text: 'Synthetic human correction', review: 'verified', indexed: true }];
  await runtime.storage.update(state => { state.documents.find(document => document.id === imported.documentId).versions[0].visual.explanations = notes; });
  const old = await runtime.call('materials.document.import', { filename: 'old.txt', dataBase64: Buffer.from('old exact citation').toString('base64') });
  const review = { repetitions: 3, interval_days: 18, ease_factor: 2.4, due_at: '2026-10-20T12:00:00.000Z' };
  await runtime.storage.update(state => state.decks.push({ id: 'old-deck', title: 'Old deck', cards: [{ id: 'old-card', kind: 'flashcard', question: 'Q', answer: 'A', citations: [{ sourceId: old.sourceIds[0], quote: 'old exact citation' }], review }] }));
  await assert.rejects(runtime.call('export'), /ZIP/);
  const book = await runtime.call('materials.visual.export', { documentId: imported.documentId }), bookBytes = await download(runtime, book);
  const bookPath = join(root, 'textbook.zip'); await writeFile(bookPath, bookBytes);
  const inspected = await runLocalCommand({ file: process.env.STUDYHUB_PDF_PYTHON || 'python' }, ['-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print("original.pdf" in z.namelist(),"index.html" in z.namelist(),"katex" in z.read("index.html").decode(),len([n for n in z.namelist() if n.startswith("figures/")]))', bookPath]);
  assert.equal(inspected.stdout.trim(), 'True True True 1');
  const backup = await runtime.call('library.visualBackup.export'), bytes = await download(runtime, backup), uploadId = await upload(destination.runtime, bytes);
  await destination.runtime.call('library.visualBackup.restore', { uploadId });
  const restored = await destination.runtime.storage.read(); assert.deepEqual(restored.decks[0].cards[0].review, review);
  assert.deepEqual(restored.documents.find(document => document.id === imported.documentId).versions[0].visual.explanations, notes, 'independent explanations and human history survive a full backup');
  const original = await destination.runtime.call('materials.document.bytes', { documentId: old.documentId });
  assert.equal(Buffer.from(original.dataBase64, 'base64').toString(), 'old exact citation');
  assert.equal((await destination.runtime.call('materials.visual.page', { documentId: imported.documentId, page: 1 })).assets.length, 1);
  await assert.rejects(destination.runtime.call('materials.visual.export.chunk', { transferId: backup.transferId, offset: 0 }), /unavailable/);
  await runtime.call('materials.visual.export.discard', { transferId: book.transferId }); await runtime.call('materials.visual.export.discard', { transferId: backup.transferId });
});

test('invalid ZIP/traversal/missing asset backups never replace the receiving state', async t => {
  const { root, runtime } = await fixture(t);
  await runtime.call('materials.document.import', { filename: 'keep.txt', dataBase64: Buffer.from('keep current state').toString('base64') });
  const before = await runtime.storage.read(), badPath = join(root, 'bad.zip');
  const produced = await runLocalCommand({ file: process.env.STUDYHUB_PDF_PYTHON || 'python' }, ['-c', 'import zipfile,sys; z=zipfile.ZipFile(sys.argv[1],"w"); z.writestr("../escape.txt","bad"); z.writestr("manifest.json","{}"); z.close()', badPath]); assert.equal(produced.code, 0);
  const uploadId = await upload(runtime, await readFile(badPath));
  await assert.rejects(runtime.call('library.visualBackup.restore', { uploadId }), /validation failed/);
  assert.deepEqual(await runtime.storage.read(), before);
  await runtime.call('materials.visual.backup.upload.cancel', { uploadId });
  const missingPath = join(root, 'missing.zip');
  const missing = await runLocalCommand({ file: process.env.STUDYHUB_PDF_PYTHON || 'python' }, ['-c', 'import zipfile,json,hashlib,sys; s={"version":4,"sources":[],"decks":[],"documents":[{"id":"fake","versions":[{"revision":"r","sourceIds":[],"visual":{"schema":1,"manifestHash":"a"*64}}]}]}; b=json.dumps(s).encode(); m={"format":"studyhub-library-backup/v1","schema":1,"files":[{"name":"library.json","bytes":len(b),"sha256":hashlib.sha256(b).hexdigest()}]}; z=zipfile.ZipFile(sys.argv[1],"w"); z.writestr("library.json",b); z.writestr("manifest.json",json.dumps(m)); z.close()', missingPath]); assert.equal(missing.code, 0);
  const missingId = await upload(runtime, await readFile(missingPath));
  await assert.rejects(runtime.call('library.visualBackup.restore', { uploadId: missingId }), /missing or corrupt/);
  assert.deepEqual(await runtime.storage.read(), before);
  await runtime.call('materials.visual.backup.upload.cancel', { uploadId: missingId });
});
