/* Use Desktop's shipped generation installer for its registered core bundle.
   Run with Desktop.exe in ELECTRON_RUN_AS_NODE mode after quitting Desktop and backing up the profile/library. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

if (!process.execPath.endsWith('DSH Desktop.exe') || process.env.ELECTRON_RUN_AS_NODE !== '1') throw Error('Use the authorized Desktop Node runtime');
const base = resolve('..');
const version = process.argv.find(arg => arg.startsWith('--version='))?.slice('--version='.length) ?? JSON.parse(await readFile('package.json', 'utf8')).version;
if (!/^3\.3\.0-scanned\.(?:[2-9]|1[0-9]|2[0-2])$/.test(version)) throw Error('Choose a retained scanned.2–22 package');
const evidence = resolve(process.argv.find(arg => arg.startsWith('--evidence-dir='))?.slice('--evidence-dir='.length) ?? join(base, 'evidence/mos-desktop-upgrade'));
const home = join(process.env.APPDATA, 'dsh-desktop/harness');
const resources = join(process.env.LOCALAPPDATA, 'Programs/DSH Desktop/resources/app.asar');
const native = join(resources, 'node_modules/dsh-desktop-market-installer/generations');
const load = file => import(pathToFileURL(join(native, file)).href);
const { withRegistryLock, readDesired, listGenerations, writeDesired } = await load('registry.mjs');
const { installGeneration } = await load('installer.mjs');
const { publishInstalledGeneration } = await load('projection.mjs');
const companion = process.argv.includes('--retrieval');
const target = companion ? '@ericwang1358/studyhub-retrieval' : '@ericwang1358/dsh-daily-flashcard';
const archiveName = companion ? 'studyhub-retrieval' : 'dsh-daily-flashcard';
await mkdir(evidence, { recursive: true });
const result = await withRegistryLock(home, async () => {
  await writeFile(join(evidence, companion ? 'desired-before-retrieval.json' : 'desired-before-core.json'), JSON.stringify(await readDesired(home), null, 2));
  const installed = await installGeneration({
    dshHome: home, pluginSpec: 'file:' + join(base, `packages/${version}/ericwang1358-${archiveName}-${version}.tgz`),
    expectedPluginName: target, expectedVersion: version, nodeExecutablePath: process.execPath,
    pnpmEntryPath: join(resources, 'node_modules/pnpm/bin/pnpm.cjs'),
    environment: { ...process.env, ELECTRON_RUN_AS_NODE: '1', ...(process.argv.includes('--offline') ? { npm_config_offline: 'true' } : {}) }, onTrace: line => console.log(line),
  });
  if (!installed.ok || !installed.generation) throw Error(installed.detail ?? 'Native generation installation failed');
  // Follow Desktop's upgradePluginToGeneration path: the shipped installer owns
  // package checks; its separate migration-only peer scan is not an upgrade prerequisite.
  const [desired, generations] = await Promise.all([readDesired(home), listGenerations(home)]);
  const byId = new Map(generations.map(generation => [generation.id, generation]));
  const kept = desired.filter(id => byId.get(id)?.pluginName !== target);
  await writeDesired(home, [...kept, installed.generation.id]);
  try { await publishInstalledGeneration(home, target, 'web', { allowRealDirectory: true, syncBundles: true }); }
  catch (error) { await writeDesired(home, desired); throw error; }
  return { ok: true, target, version, generationId: installed.generation.id, mechanism: 'Desktop upgradePluginToGeneration path: shipped generation installer and transactional projection', runtimeValidationRequired: true };
});
await mkdir(evidence, { recursive: true });
await writeFile(join(evidence, companion ? 'retrieval-generation-install.json' : 'generation-install.json'), JSON.stringify(result, null, 2));
console.log(JSON.stringify(result));
