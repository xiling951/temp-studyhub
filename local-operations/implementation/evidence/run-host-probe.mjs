import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { scrubSecrets } from '../source/scripts/qa/env.mjs';
import { stopTree } from '../source/scripts/qa/dsh-e2e.mjs';
const child = spawn(process.execPath, ['D:/studyhub/implementation/test-harness/bin.mjs', '--profile', 'studyhub-e2e', '--patch', 'D:/studyhub/implementation/test-harness/probe.patch.yml', '--port', '43142', '--no-open'], { cwd: 'D:/studyhub/implementation/source/output/qa/s67/documents/deepseek-harness/default-workspace', env: { ...scrubSecrets(process.env), DSH_HOME: 'D:/studyhub/implementation/source/output/qa/s67/home', DSH_TELEMETRY_DISABLED: '1', SSH_TTY: 'audit' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let diagnostics = '';
child.stderr.on('data', value => { diagnostics += value.toString().replace(/token=\S+/g, 'token=…'); });
try {
  for (let n = 0; n < 90; n++) {
    const result = await readFile(new URL('dsh-capability-result.json', import.meta.url), 'utf8').catch(() => null);
    if (result) { console.log(result); break; }
    if (child.exitCode !== null) throw new Error(`DSH exited: ${diagnostics.slice(-2500)}`);
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
} finally { stopTree(child); }
