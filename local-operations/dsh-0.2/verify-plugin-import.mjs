// Verification: with the host-module fallback registered exactly as
// harness-entry.mjs does, can every StudyHub entry the profile composes be
// imported — including its `@deepseek-ai/*` host imports?
import { registerHostModuleFallback } from './host-module-fallback.mjs'

const DSH_ENTRY = 'D:/studyhub/dsh-0.2/node_modules/@deepseek-ai/dsh/lib/bin.js'
const PKG = 'file:///D:/studyhub/dsh-home/profiles/web/node_modules/@ericwang1358/dsh-daily-flashcard'

registerHostModuleFallback(DSH_ENTRY)

const targets = [
  ['main', `${PKG}/lib/index.js`],
  ['plugins/runtime', `${PKG}/lib/plugins/runtime.js`],
  ['plugins/materials', `${PKG}/lib/plugins/materials.js`],
  ['plugins/bank', `${PKG}/lib/plugins/bank.js`],
  ['plugins/study', `${PKG}/lib/plugins/study.js`],
  ['plugins/generation', `${PKG}/lib/plugins/generation.js`],
  ['plugins/audio', `${PKG}/lib/plugins/audio.js`],
  ['runtime/builtins (static @deepseek-ai/cordis import)', `${PKG}/lib/runtime/builtins.js`],
]

let failed = 0
for (const [label, url] of targets) {
  try {
    const m = await import(url)
    console.log(`OK   ${label} | exports: ${Object.keys(m).slice(0, 6).join(',') || '(none)'}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL ${label} | ${error.code ?? ''} ${String(error.message).split('\n')[0]}`)
  }
}

for (const spec of ['@deepseek-ai/cordis', '@deepseek-ai/dsh-tools', '@deepseek-ai/dsh-llm']) {
  try {
    const m = await import(spec)
    console.log(`OK   host peer ${spec} | exports: ${Object.keys(m).slice(0, 4).join(',')}`)
  } catch (error) {
    failed += 1
    console.log(`FAIL host peer ${spec} | ${error.code ?? ''} ${String(error.message).split('\n')[0]}`)
  }
}

console.log(failed === 0 ? 'RESULT: all host-side entries import cleanly' : `RESULT: ${failed} failures`)
process.exitCode = failed === 0 ? 0 : 1
