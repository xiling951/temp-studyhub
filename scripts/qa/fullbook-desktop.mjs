/* Explicitly authorized real-book work through the running native Desktop.
   File transfers are streamed in 256 KiB blocks; credentials are never read. */
import { readFile, writeFile, open, stat, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { connectDesktop } from './desktop-client.mjs';

const option = name => process.argv.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
const mode = option('mode');
if (!['audit-start', 'audit-retry', 'audit-status', 'book-export', 'index-status', 'topic-start', 'topic-retry', 'topic-status'].includes(mode)) throw Error('Choose a supported explicit full-book action');
const evidence = resolve('../evidence/fullbook-20261012'); await mkdir(evidence, { recursive: true });
const baseline = JSON.parse(await readFile(join(evidence, 'baseline-private.json'), 'utf8'));
const client = await connectDesktop({ liveModelSession: ['audit-start', 'audit-retry', 'topic-start', 'topic-retry'].includes(mode) });
const { call } = client;
try {
  if (mode === 'audit-start') {
    const pdf = join(evidence, 'audit-sample.pdf'), info = await stat(pdf), file = await open(pdf, 'r');
    let upload;
    try {
      upload = await call('materials.visual.upload.start', { name: '原书分层质量核验样本.pdf', size: info.size });
      const buffer = Buffer.alloc(262144);
      for (let offset = 0; offset < info.size;) {
        const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
        if (!bytesRead) throw Error('PDF stream ended early');
        await call('materials.visual.upload.append', { uploadId: upload.uploadId, offset, data: buffer.subarray(0, bytesRead).toString('base64') }); offset += bytesRead;
      }
      await call('materials.visual.upload.finish', { uploadId: upload.uploadId });
      const job = await call('materials.visual.import', { uploadId: upload.uploadId, title: '原书分层质量核验样本（26页）', parser: 'cloud', modelKey: JSON.stringify(['qwen', 'qwen3.8-flash']) });
      await writeFile(join(evidence, 'audit-job-private.json'), JSON.stringify(job, null, 2)); console.log(JSON.stringify({ auditJobId: job.jobId, status: job.status }));
    } finally { await file.close(); }
  } else if (mode === 'audit-retry' || mode === 'topic-retry') {
    const filename = mode === 'audit-retry' ? 'audit-job-private.json' : `topic-${option('topic')}-job-private.json`;
    const record = JSON.parse(await readFile(join(evidence, filename), 'utf8'));
    let result;
    try { result = await call('job.control', { jobId: record.jobId, action: 'retry' }); }
    catch (error) {
      if (mode !== 'topic-retry' || !error.message.includes('Study job not found:')) throw error;
      const plan = JSON.parse(await readFile(join(evidence, `topic-${option('topic')}-plan-private.json`), 'utf8'));
      const draft = (await call('snapshot')).drafts.find(draft => draft.title === plan.title);
      if (!draft) throw Error('Actual saved topic draft unavailable');
      result = await call('generate', { resumeDraftId: draft.id, draftVersion: draft.draftVersion, performance: { concurrency: 1, fillRounds: 0 } });
    }
    const jobId = result.attemptId || result.jobId;
    await writeFile(join(evidence, filename), JSON.stringify({ ...record, jobId, previousJobId: record.jobId }, null, 2));
    console.log(JSON.stringify({ jobId, resumedCheckpoint: true }));
  } else if (mode === 'audit-status' || mode === 'topic-status') {
    const record = JSON.parse(await readFile(join(evidence, mode === 'audit-status' ? 'audit-job-private.json' : `topic-${option('topic')}-job-private.json`), 'utf8'));
    const snapshot = await call('snapshot'), job = snapshot.jobs.find(job => job.id === record.jobId);
    if (!job) throw Error('Requested actual native job unavailable');
    await writeFile(join(evidence, mode === 'audit-status' ? 'audit-status-private.json' : `topic-${option('topic')}-status-private.json`), JSON.stringify(job, null, 2));
    console.log(JSON.stringify({ id: job.id, status: job.status, stage: job.stage, progress: job.contract.progress, usage: job.contract.usage, error: job.contract.error }));
  } else if (mode === 'book-export') {
    const archive = await call('materials.visual.export', { documentId: baseline.documentId }), path = join(evidence, '数字集成电路-电子教材资源包.zip');
    const file = await open(path, 'w'), hash = createHash('sha256');
    try {
      for (let offset = 0; offset < archive.bytes;) {
        const chunk = await call('materials.visual.export.chunk', { transferId: archive.transferId, offset });
        const bytes = Buffer.from(chunk.dataBase64, 'base64');
        if (!bytes.length || bytes.length > 262144 || chunk.offset !== offset) throw Error('Incomplete bounded archive transfer');
        await file.write(bytes); hash.update(bytes); offset += bytes.length;
      }
      if (hash.digest('hex') !== archive.hash) throw Error('Resource package hash mismatch');
      const result = { path, bytes: archive.bytes, sha256: archive.hash, streamed: true };
      await writeFile(join(evidence, 'book-export.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
    } finally { await file.close(); await call('materials.visual.export.discard', { transferId: archive.transferId }); }
  } else if (mode === 'index-status') {
    const status = await call('retrieval.index.status'), coverage = await call('retrieval.index.coverage');
    await writeFile(join(evidence, 'index-status-private.json'), JSON.stringify({ status, coverage }, null, 2));
    console.log(JSON.stringify({ status: status.status, done: status.done, total: status.total, failed: status.failedCount, indexed: coverage.indexed.length, missing: coverage.missing.length, stale: coverage.stale.length }));
  } else if (mode === 'topic-start') {
    const name = option('topic'), plan = JSON.parse(await readFile(join(evidence, `topic-${name}-plan-private.json`), 'utf8'));
    const job = await call('generate', { ...plan, performance: { concurrency: 1, fillRounds: 0, effortPlanning: 'lowest', effortWriting: 'lowest', effortReview: 'lowest' } });
    await writeFile(join(evidence, `topic-${name}-job-private.json`), JSON.stringify(job, null, 2)); console.log(JSON.stringify({ topic: name, jobId: job.jobId, status: job.status }));
  }
} finally { await client.close(); }
