import { mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { retainPdf, hashFile } from '../source/lib/contexts/materials/visual-storage.js';
const folder = 'C:/Users/Lenovo/Desktop/杂物/大三上/数集';
const candidates = [];
for (const name of await readdir(folder)) if (name.startsWith('数字集成电路') && name.toLowerCase().endsWith('.pdf')) {
  const path = join(folder, name), info = await stat(path); candidates.push({ path, bytes: info.size });
}
const source = candidates.find(file => file.bytes === 198094368);
if (!source) throw new Error('Expected original textbook not found; no file selected');
const root = 'D:/studyhub/implementation/test-libraries/full-retain'; await mkdir(root, { recursive: true });
const started = Date.now(), before = await stat(source.path); let peakRss = process.memoryUsage().rss;
const timer = setInterval(() => { peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 25);
try {
  const original = await hashFile(source.path), retained = await retainPdf(root, source.path), after = await stat(source.path);
  if (original.hash !== retained.hash || original.bytes !== retained.bytes || before.mtimeMs !== after.mtimeMs) throw new Error('Original integrity mismatch');
  const result = { candidates, source, retained, elapsedMs: Date.now() - started, peakRss, root, originalUnchanged: true, hashMatched: true, streamed: true };
  await writeFile(new URL('t04-full-retain.json', import.meta.url), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
} finally { clearInterval(timer); }
