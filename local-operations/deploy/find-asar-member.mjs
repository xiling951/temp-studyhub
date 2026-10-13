// Locate a member inside app.asar by fingerprinting its own "name" field, then
// derive the data-section base from the header offset recorded for it.
import { openSync, readSync, closeSync, statSync } from 'node:fs'

const archive = process.argv[2]
const memberPath = process.argv[3]
const packageName = memberPath.replace(/^.*node_modules\//, '').replace(/\/package\.json$/, '')
const fingerprints = [
  Buffer.from('"name": "' + packageName + '"'),
  Buffer.from('"name":"' + packageName + '"'),
  Buffer.from('"name" : "' + packageName + '"'),
]
console.log('package:', packageName)

const size = statSync(archive).size
const fd = openSync(archive, 'r')

const probe = Buffer.alloc(16)
readSync(fd, probe, 0, 16, 0)
const u12 = probe.readUInt32LE(12)
const headerBytes = Buffer.alloc(u12)
readSync(fd, headerBytes, 0, u12, 16)
const header = JSON.parse(headerBytes.toString('utf8'))

function lookup(path) {
  let node = header
  for (const part of path.split('/')) {
    node = node?.files?.[part]
    if (!node) return undefined
  }
  return node
}
const entry = lookup(memberPath)
if (!entry) { console.error('member not in header:', memberPath); process.exit(1) }
console.log('member offset', entry.offset, 'size', entry.size, 'unpacked', entry.unpacked ?? false)

const chunk = 8 * 1024 * 1024
const buffer = Buffer.alloc(chunk + 512)
let position = -1
let which = -1
outer: for (let start = 0; start < size; start += chunk) {
  const read = readSync(fd, buffer, 0, Math.min(chunk + 512, size - start), start)
  for (let index = 0; index < fingerprints.length; index += 1) {
    const hit = buffer.subarray(0, read).indexOf(fingerprints[index])
    if (hit >= 0) { position = start + hit; which = index; break outer }
  }
}
if (position < 0) { console.error('fingerprint not found anywhere in the archive'); process.exit(1) }
console.log('fingerprint', which, 'found at', position)

let found = null
for (let back = 1; back <= 512 && !found; back += 1) {
  const start = position - back
  const candidate = Buffer.alloc(entry.size)
  readSync(fd, candidate, 0, entry.size, start)
  try {
    const json = JSON.parse(candidate.toString('utf8'))
    if (json.name === packageName) found = { start, json, base: start - Number(entry.offset) }
  } catch { /* keep looking */ }
}
if (!found) { console.error('could not parse member content'); process.exit(1) }
console.log('content starts at', found.start, '=> data base', found.base)
console.log(`RESULT ${memberPath} name=${found.json.name} version=${found.json.version}`)
closeSync(fd)
