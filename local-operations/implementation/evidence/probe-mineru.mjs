import { mkdir, readFile, writeFile } from 'node:fs/promises';
const base = 'http://127.0.0.1:16580/v1';
const out = new URL('./mineru-sample/', import.meta.url);
await mkdir(out, { recursive: true });
const request = { files: [{ source: { type: 'local', path: 'D:/studyhub/lab/import-probe/数字集成电路-p200-206.pdf' }, page_range: '1-7' }], tier: 'standard', output_formats: ['middle_json', 'structured_content', 'zip'] };
let job = await readFile(new URL('submitted.json', out), 'utf8').then(text => JSON.parse(text).job, () => null);
if (!job) {
  const response = await fetch(`${base}/parse/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
  job = await response.json();
  await writeFile(new URL('submitted.json', out), JSON.stringify({ httpStatus: response.status, job }, null, 2));
  if (!response.ok) throw new Error(JSON.stringify(job));
}
const id = job.job_id;
for (let n = 0; n < 240; n++) {
  job = await (await fetch(`${base}/parse/jobs/${id}`)).json();
  if (['completed', 'failed', 'cancelled'].includes(job.status)) break;
  await new Promise(resolve => setTimeout(resolve, 2000));
}
await writeFile(new URL('result.json', out), JSON.stringify(job, null, 2));
for (const file of job.files || []) for (const [kind, artifact] of Object.entries(file.output_files || {})) {
  if (!artifact) continue;
  const bytes = new Uint8Array(await (await fetch(`${base}/files/${artifact.file_id}/content`)).arrayBuffer());
  await writeFile(new URL(`${kind}.${kind === 'zip' ? 'zip' : 'json'}`, out), bytes);
}
console.log(JSON.stringify({ id, status: job.status, files: job.files?.map(file => ({ status: file.status, page_range: file.page_range, outputs: file.output_files, error: file.error })) }, null, 2));
