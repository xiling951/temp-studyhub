import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { scrubSecrets } from '../source/scripts/qa/env.mjs';
import { stopTree } from '../source/scripts/qa/dsh-e2e.mjs';
const raw = await readFile('C:/Users/Lenovo/Desktop/API-key.txt', 'utf8');
const candidates = raw.match(/sk-[A-Za-z0-9_-]+/g) || [];
if (candidates.length !== 1) throw new Error('Expected one unambiguous API credential');
const secret = candidates[0];
const redact = value => value.replaceAll(secret, '[credential]').replace(/token=\S+/g, 'token=[redacted]');
const cancelOnly = process.argv.includes('--cancel');
const gateway = process.argv.includes('--gateway') || cancelOnly;
const plugin = gateway ? 't08-native-gateway-plugin.mjs' : 't08-real-vision-plugin.mjs';
const output = cancelOnly ? 't08-native-cancel.json' : gateway ? 't08-native-gateway.json' : 't08-real-vision.json';
const preset = gateway ? '    - id: visual-probe-jobs-preset\n      name: "@deepseek-ai/dsh-agent-preset"\n      config:\n        id: visual-probe-jobs\n        order: 99\n        plugins:\n          - id: tool-jobs\n            name: "@deepseek-ai/dsh-tool-jobs"\n            config:\n              completionDelivery: quiet\n' : '';
await writeFile('D:/studyhub/implementation/test-harness/real-vision.patch.yml', `- insert:\n${preset}    - id: studyhub-real-vision-probe\n      name: D:/studyhub/implementation/evidence/${plugin}\n      config: {}\n`);
const child = spawn(process.execPath, ['D:/studyhub/implementation/test-harness/bin.mjs', '--profile', 'studyhub-e2e', '--patch', 'D:/studyhub/implementation/test-harness/real-vision.patch.yml', '--port', '43146', '--no-open'], {
  cwd: 'D:/studyhub/implementation/source/output/qa/s67/documents/deepseek-harness/default-workspace',
  env: { ...scrubSecrets(process.env), DEEPSEEK_API_KEY: secret, STUDYHUB_VISUAL_PROBE_CANCEL_ONLY: cancelOnly ? '1' : '0', DSH_HOME: 'D:/studyhub/implementation/source/output/qa/s67/home', DSH_TELEMETRY_DISABLED: '1', SSH_TTY: 'audit' },
  windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
});
let diagnostics = '';
for (const stream of [child.stdout, child.stderr]) stream.on('data', value => { diagnostics = (diagnostics + redact(value.toString())).slice(-12000); });
try {
  const started = Date.now();
  for (let n = 0; n < 150; n++) {
    const value = await readFile(new URL(output, import.meta.url), 'utf8').catch(() => null);
    if (value && Date.parse(JSON.parse(value).startedAt) >= started - 1000) {
      await writeFile(new URL(output, import.meta.url), redact(value));
      console.log(redact(value));
      break;
    }
    if (child.exitCode !== null) throw new Error(`Isolated DSH exited: ${diagnostics.slice(-1200)}`);
    if (n === 149) throw new Error('Real vision validation timed out');
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
} finally { stopTree(child); }
