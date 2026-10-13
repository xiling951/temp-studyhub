import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const source = new URL('../source/', import.meta.url);
const installed = new URL('../../deploy/pkg/package/', import.meta.url);
const paths = ['lib/index.js', 'lib/store.js', 'lib/runtime/domain-contracts.js', 'lib/contexts/materials/operations.js', 'lib/mineru-local.js', 'lib/jobs/gateway.js'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const files = [];
for (const file of paths) {
  const [a, b] = await Promise.all([readFile(new URL(file, source)), readFile(new URL(file, installed))]);
  files.push({ file, source: hash(a), published: hash(b), identical: a.equals(b) });
}
const [a, b] = await Promise.all([readFile(new URL('package.json', source), 'utf8'), readFile(new URL('package.json', installed), 'utf8')]);
const exportsMatch = JSON.stringify(JSON.parse(a).exports) === JSON.stringify(JSON.parse(b).exports);
const result = { commit: 'daa4df7b3045df14290e10a43d72e0e751e0f72d', lockSha256: hash(await readFile(new URL('package-lock.json', source))), exportsMatch, files };
await writeFile(new URL('baseline-comparison.json', import.meta.url), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result, null, 2));
