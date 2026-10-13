// Standalone DSH runner with the Desktop's host-module fallback.
//
// Why this file exists: DSH Desktop launches the harness through its own
// resources/harness-node-entry.mjs, which registers a module-resolution hook so
// that profile plugins linked/copied into `$DSH_HOME/profiles/<name>/node_modules`
// can `import '@deepseek-ai/<host package>'` even though those packages only
// exist beside the harness install. The published `dsh` CLI has no such hook,
// so a plugin that imports host packages (StudyHub imports
// `@deepseek-ai/cordis`, and optionally `dsh-tools` / `dsh-llm`) fails to load
// under a plain `dsh --profile web` run. This entry restores exactly the
// Desktop behaviour, anchored at the harness entry we launch.
//
// Usage:
//   node harness-entry.mjs <dsh bin.js> [dsh args...]
import { pathToFileURL } from 'node:url'
import { registerHostModuleFallback } from './host-module-fallback.mjs'

const [dshEntryPath, ...dshArguments] = process.argv.slice(2)

function report(label, value) {
  process.stderr.write(`[harness-node] ${label}: ${value}\n`)
}

// Send loader-owned identity before the human-readable error.
function reportPluginFailures(error) {
  const failures = []
  const visited = new Set()
  function visit(value) {
    if (!value || typeof value !== 'object' || visited.has(value)) return false
    visited.add(value)
    let nested = visit(value.cause)
    if (value instanceof AggregateError) {
      for (const child of value.errors) nested = visit(child) || nested
    }
    const failure = value.dshPluginFailure
    if (!nested && failure && typeof failure === 'object') {
      const { stage, entryId, packageName, owner, chain, message } = failure
      failures.push({ stage, entryId, packageName, owner, chain, message })
      return true
    }
    return nested
  }
  visit(error)
  if (failures.length) report('plugin failures', JSON.stringify({ version: 1, failures }))
}

process.on('uncaughtException', (error) => report('uncaught exception', error?.stack ?? error))
process.on('unhandledRejection', (error) => report('unhandled rejection', error?.stack ?? error))

if (!dshEntryPath) {
  report('startup error', 'missing DSH entry path')
  process.exitCode = 1
} else {
  process.argv = [process.execPath, dshEntryPath, ...dshArguments]
  try {
    registerHostModuleFallback(dshEntryPath)
    const entry = await import(pathToFileURL(dshEntryPath).href)
    if (typeof entry.runCli === 'function') await entry.runCli()
  } catch (error) {
    reportPluginFailures(error)
    report('DSH entry failed', error?.stack ?? error)
    process.exitCode = 1
  }
}
