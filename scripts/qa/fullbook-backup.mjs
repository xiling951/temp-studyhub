/* Private, streaming backup of actual study data and durable conversion jobs.
   Provider profiles and credentials are intentionally outside these paths. */
import { mkdir, readdir, lstat, copyFile, writeFile } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { hashFile } from '../../lib/contexts/materials/visual-storage.js';
const name = process.argv.find(arg => arg.startsWith('--name='))?.slice(7);
if (!/^desktop-before-fullbook[0-9]*-(?:20261012|20261013)$/.test(name || '')) throw Error('Choose the explicit book backup name');
const destination = resolve('../private-backups', name);
await mkdir(destination);
const inventory = [];
async function tree(base, label, current = base) {
  for (const entry of await readdir(current, { withFileTypes: true })) {
    const source = join(current, entry.name), local = relative(base, source);
    if (label === 'study' && local === 'tmp') continue;
    if (entry.isSymbolicLink()) throw Error('Unexpected symbolic link in study data');
    if (entry.isDirectory()) { await tree(base, label, source); continue; }
    if (!(await lstat(source)).isFile()) throw Error('Unexpected resource kind');
    const target = join(destination, label, local); await mkdir(resolve(target, '..'), { recursive: true });
    await copyFile(source, target);
    const expected = await hashFile(source), actual = await hashFile(target);
    if (actual.hash !== expected.hash || actual.bytes !== expected.bytes) throw Error('Backup integrity mismatch');
    inventory.push({ target: label, path: local, sha256: actual.hash, bytes: actual.bytes });
  }
}
const home = 'C:/Users/Lenovo/AppData/Roaming/dsh-desktop/harness';
await tree('D:/studyhub/.dsh-study', 'old-library');
await tree('D:/studyhub/libraries/数字集成电路-图文', 'textbook-library');
await tree(join(home, 'study'), 'study');
await tree(join(home, 'study/tmp/pdf-convert'), 'conversion-jobs');
await tree(join(home, 'storages'), 'storages');
await copyFile('D:/studyhub/start-dsh-desktop.cmd', join(destination, 'launcher.cmd'));
await copyFile('C:/Users/Lenovo/Desktop/DSH Desktop.lnk', join(destination, 'shortcut.lnk'));
await writeFile(join(destination, 'inventory.json'), JSON.stringify(inventory, null, 2));
console.log(JSON.stringify({ backup: name, verifiedFiles: inventory.length, bytes: inventory.reduce((sum, file) => sum + file.bytes, 0) }));
