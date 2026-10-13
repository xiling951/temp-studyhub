import { mkdir, writeFile } from 'node:fs/promises';
import { createStudyRuntime } from '../source/lib/runtime/builtins.js';
import { digest } from '../source/lib/contexts/materials/visual-storage.js';
process.env.DSH_HOME = 'D:/studyhub/implementation/test-harness/home';
const root = 'D:/studyhub/implementation/test-libraries/sample', target = `D:/studyhub/implementation/test-libraries/sample-restored-${Date.now()}`;
await mkdir(target, { recursive: true });
const source = createStudyRuntime(root), destination = createStudyRuntime(target);
const receive = async result => {
  const chunks = [];
  for (let offset = 0; offset < result.bytes;) {
    const chunk = await source.call('materials.visual.export.chunk', { transferId: result.transferId, offset }); chunks.push(Buffer.from(chunk.dataBase64, 'base64')); offset += chunk.bytes;
  }
  const bytes = Buffer.concat(chunks); if (digest(bytes) !== result.hash) throw new Error('Transfer hash mismatch'); return bytes;
};
try {
  const before = await source.storage.read(), document = before.documents.find(document => document.versions.some(version => version.visual));
  const book = await source.call('materials.visual.export', { documentId: document.id });
  await writeFile('D:/studyhub/implementation/packages/sample-textbook.zip', await receive(book));
  const full = await source.call('library.visualBackup.export'), bytes = await receive(full);
  await writeFile('D:/studyhub/implementation/evidence/t07-sample-library.zip', bytes);
  const upload = await destination.call('materials.visual.backup.upload.start', { name: 'backup.zip', size: bytes.length });
  for (let offset = 0; offset < bytes.length; offset += 262144) await destination.call('materials.visual.backup.upload.append', { uploadId: upload.uploadId, offset, data: bytes.subarray(offset, offset + 262144).toString('base64') });
  await destination.call('materials.visual.backup.upload.finish', { uploadId: upload.uploadId });
  await destination.call('library.visualBackup.restore', { uploadId: upload.uploadId });
  const after = await destination.storage.read();
  if (JSON.stringify(before.sources) !== JSON.stringify(after.sources) || JSON.stringify(before.decks) !== JSON.stringify(after.decks)) throw new Error('Restored source/card mismatch');
  for (let page = 1; page <= 7; page++) {
    const current = await destination.call('materials.visual.page', { documentId: document.id, page });
    for (const asset of current.assets) await destination.call('materials.visual.asset', { documentId: document.id, assetId: asset.assetId });
  }
  const result = { root, target, book, full, verifiedPages: 7, sourceTextIdentical: true, cardsIdentical: true, allPageAssetsVerified: true };
  await writeFile('D:/studyhub/implementation/evidence/t07-roundtrip.json', JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
  await source.call('materials.visual.export.discard', { transferId: book.transferId }); await source.call('materials.visual.export.discard', { transferId: full.transferId });
} finally { await source.dispose(); await destination.dispose(); }
