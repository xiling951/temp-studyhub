import { cp, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { buildHostClient, buildPreview } from './build.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(manifest.version)) throw new Error('Release version must be a valid version number');
const outputArg = process.argv.find(arg => arg.startsWith('--outdir='))?.slice('--outdir='.length);
const target = outputArg ? resolve(root, outputArg) : resolve(root, 'output', `release-${manifest.version}`);
await mkdir(target, { recursive: true });
// npm's CLI sits next to node.exe on Windows and under <prefix>/lib/node_modules on Linux and macOS.
const npmCli = [process.env.npm_execpath,
  join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'),
  join(dirname(process.execPath), '../lib/node_modules/npm/bin/npm-cli.js')]
  .find(candidate => candidate && /npm-cli\.js$/.test(candidate) && existsSync(candidate));
if (!npmCli) throw new Error('Cannot find npm-cli.js; run the release pack through npm (npm run release:pack)');
// npm pack below deliberately skips lifecycle scripts; compile the current UI first.
await buildHostClient();
await buildPreview();
async function pack(cwd) {
  const child = spawn(process.execPath, [npmCli, 'pack', '--json', '--ignore-scripts', '--pack-destination', target],
    { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '', errors = '';
  child.stdout.on('data', bytes => { output += bytes; });
  child.stderr.on('data', bytes => { errors += bytes; });
  await new Promise((done, reject) => {
    child.on('error', reject);
    child.on('exit', code => code === 0 ? done() : reject(new Error(errors || `npm pack exited ${code}`)));
  });
  const receipt = JSON.parse(output)[0];
  return { name: receipt.name, version: receipt.version, filename: receipt.filename, bytes: receipt.size,
    sha256: createHash('sha256').update(await readFile(join(target, receipt.filename))).digest('hex') };
}

// Build and verification are deliberately owned by the release coordinator.
const archives = [await pack(root)];
await mkdir(join(target, 'packages'), { recursive: true });
for (const domain of ['runtime', 'materials', 'bank', 'study', 'generation', 'audio']) {
  const staging = await mkdtemp(join(target, 'packages', `${domain}-`));
  for (const path of ['lib', 'references', 'locale', 'presets', 'LICENSE', 'README.md', 'README.zh-CN.md', 'CHANGELOG.md', 'CHANGELOG.zh-CN.md'])
    await cp(join(root, path), join(staging, path), { recursive: true });
  await mkdir(join(staging, 'docs'), { recursive: true });
  for (const path of manifest.files.filter(path => path.startsWith('docs/'))) {
    await mkdir(dirname(join(staging, path)), { recursive: true });
    await cp(join(root, path), join(staging, path));
  }
  const name = `@ericwang1358/dsh-study-${domain}`;
  const entry = `./lib/plugins/${domain}.js`;
  await writeFile(join(staging, 'package.json'), JSON.stringify({
    name, version: manifest.version, description: `StudyHub ${domain} capability plugin for DSH`,
    type: 'module', main: entry, exports: { '.': entry, './runtime': './lib/runtime.js', './locale/*': `./locale/plugins/${domain}/*`, './package.json': './package.json' },
    files: manifest.files,
    author: manifest.author, license: manifest.license, engines: manifest.engines, dependencies: manifest.dependencies,
    peerDependencies: manifest.peerDependencies, peerDependenciesMeta: manifest.peerDependenciesMeta,
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, null, 2) + '\n');
  await writeFile(join(staging, 'cordis.patch.yml'), `- insert:\n    - id: study-${domain}\n      name: '${name}'\n      config: {}\n`);
  archives.push(await pack(staging));
}
// The search extension (WP28b): a companion bundle StudyHub installs on request; same version, same checksum list.
{
  const source = join(root, 'packages', 'studyhub-retrieval');
  const staging = await mkdtemp(join(target, 'packages', 'retrieval-'));
  await cp(source, staging, { recursive: true });
  await cp(join(root, 'LICENSE'), join(staging, 'LICENSE'));
  const companion = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'));
  await writeFile(join(staging, 'package.json'), JSON.stringify({ ...companion, version: manifest.version }, null, 2) + '\n');
  archives.push(await pack(staging));
}
const setupFilename = `StudyHub-${manifest.version}-Setup.html`;
const customSetup = language => `<!doctype html><html lang="${language}"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>StudyHub ${manifest.version}</title><style>body{font:18px/1.7 system-ui;max-width:850px;margin:40px auto;padding:0 24px}code{overflow-wrap:anywhere}a{color:#1761b0}</style><h1>StudyHub ${manifest.version}</h1><p>扫描教材图文定制包 / Scanned textbook custom build</p><p>这是本地定制发行包。先备份现有 profile 和学习库，再通过 DSH 原生插件管理安装同名本地 TGZ 并重启。<br>Back up the current profile and library; install the local TGZ through DSH's plugin manager, then restart.</p><ul><li><a href="ericwang1358-dsh-daily-flashcard-${manifest.version}.tgz">StudyHub 定制整包 / Custom bundle</a></li><li><a href="ericwang1358-studyhub-retrieval-${manifest.version}.tgz">可选检索扩展 / Optional retrieval</a></li><li><a href="SHA256SUMS-${manifest.version}.txt">SHA-256</a></li><li><a href="install-and-rollback.md">安装与回退 / Installation and rollback</a></li><li><a href="使用说明.md">使用说明 / Usage</a></li></ul><p>保留原插件名称；整包与独立组件选择一种。市场/upstream 更新会覆盖定制功能，请保留本地包并使用已验证的定制更新。<br>Keep the original plugin names, use either the bundle or modular components. Upstream updates replace custom features.</p></html>`;
const writeSetup = async (filename, language, ordinary) => manifest.version.includes('-scanned.')
  ? writeFile(join(target, filename), customSetup(language)) : cp(join(root, ordinary), join(target, filename));
await writeSetup(setupFilename, 'en', 'docs/install.html');
const setup = { filename: setupFilename,
  sha256: createHash('sha256').update(await readFile(join(target, setupFilename))).digest('hex') };
const setupZhFilename = `StudyHub-${manifest.version}-Setup.zh-CN.html`;
await writeSetup(setupZhFilename, 'zh-CN', 'docs/install.zh-CN.html');
const setupZh = { filename: setupZhFilename,
  sha256: createHash('sha256').update(await readFile(join(target, setupZhFilename))).digest('hex') };
await writeFile(join(target, `SHA256SUMS-${manifest.version}.txt`), [...archives, setup, setupZh].map(artifact => `${artifact.sha256}  ${artifact.filename}`).join('\n') + '\n');
await writeFile(join(target, 'artifacts.json'), JSON.stringify({ version: manifest.version, archives, setup, setupZh }, null, 2) + '\n');
console.log(JSON.stringify({ directory: target, archives, setup, setupZh }, null, 2));
