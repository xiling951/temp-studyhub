// Read files out of an app.asar. Calibrate the data section on the very member
// we want, because entries marked "unpacked" keep their bytes outside the asar.
import { openSync, readSync, closeSync, statSync } from 'node:fs'

const archive = process.argv[2]
const want = process.argv.slice(3)
const size = statSync(archive).size
const fd = openSync(archive, 'r')

const probe = Buffer.alloc(16)
readSync(fd, probe, 0, 16, 0)
const u4 = probe.readUInt32LE(4)
const u8 = probe.readUInt32LE(8)
const u12 = probe.readUInt32LE(12)
console.log(`pickle: [${probe.readUInt32LE(0)}] [${u4}] [${u8}] [${u12}]`)

let header = null
for (const length of [u12, u8, u4]) {
  if (length <= 0 || length > size) continue
  const buffer = Buffer.alloc(length)
  readSync(fd, buffer, 0, length, 16)
  try { header = JSON.parse(buffer.toString('utf8').replace(/\0+$/, '')); console.log('header parsed, length', length); break } catch { /* next */ }
}
if (!header) { console.error('could not parse asar header'); process.exit(1) }

function lookup(path) {
  let node = header
  for (const part of path.split('/')) {
    node = node?.files?.[part]
    if (!node) return undefined
  }
  return node
}

for (const path of want) {
  const entry = lookup(path)
  if (!entry) { console.log('MISSING:', path); continue }
  if (entry.unpacked === true) { console.log('UNPACKED (bytes live outside the asar):', path); continue }
  let parsed = null
  let usedBase = -1
  for (let base = 16 + u12 - 64; base <= 16 + u12 + 128; base += 4) {
    if (base < 0 || base + Number(entry.offset) + entry.size > size) continue
    const buffer = Buffer.alloc(entry.size)
    readSync(fd, buffer, 0, entry.size, base + Number(entry.offset))
    try {
      const json = JSON.parse(buffer.toString('utf8'))
      if (typeof json.name === 'string') { parsed = json; usedBase = base; break }
    } catch { /* next base */ }
  }
  if (!parsed) { console.log('could not read:', path, '(size', entry.size + ')'); continue }
  console.log(`--- ${path}\n    base=${usedBase} name=${parsed.name} version=${parsed.version}`)
}
closeSync(fd)
