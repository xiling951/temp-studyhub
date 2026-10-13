// Carve the embedded 7z payload out of an electron-builder NSIS installer and
// list/extract one member, without installing 7-Zip: the 7z start header tells
// us exactly where the archive ends.
import { readFileSync, writeFileSync, openSync, readSync, closeSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

const installer = process.argv[2]
const outArchive = process.argv[3] ?? 'D:/studyhub/deploy/app-64.7z'
const MAGIC = Buffer.from([0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])

const size = statSync(installer).size
console.log('installer:', installer, size, 'bytes')
const fd = openSync(installer, 'r')

// Find the 7z signature: scan in 8 MB windows so a 260 MB file stays cheap.
const windowSize = 8 * 1024 * 1024
const buffer = Buffer.alloc(windowSize)
let offset = 0
let found = -1
while (offset < size) {
  const read = readSync(fd, buffer, 0, Math.min(windowSize, size - offset), offset)
  if (read <= 0) break
  const index = buffer.subarray(0, read).indexOf(MAGIC)
  if (index >= 0) { found = offset + index; break }
  offset += read - (MAGIC.length - 1)
}
if (found < 0) { console.error('no 7z payload found'); process.exit(1) }
console.log('7z signature at', found)

const header = Buffer.alloc(32)
readSync(fd, header, 0, 32, found)
const nextHeaderOffset = Number(header.readBigUInt64LE(12))
const nextHeaderSize = Number(header.readBigUInt64LE(20))
const archiveSize = 32 + nextHeaderOffset + nextHeaderSize
console.log('payload size:', archiveSize, 'bytes')

const payload = Buffer.alloc(archiveSize)
let done = 0
while (done < archiveSize) {
  const read = readSync(fd, payload, done, Math.min(4 * 1024 * 1024, archiveSize - done), found + done)
  if (read <= 0) break
  done += read
}
closeSync(fd)
writeFileSync(outArchive, payload)
console.log('wrote', outArchive, payload.length, 'bytes')

const sevenZip = process.argv[4] ?? 'D:/studyhub/deploy/7zr.exe'
const listing = spawnSync(sevenZip, ['l', '-slt', outArchive], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 })
if (listing.error) { console.error('7zr failed:', listing.error.message); process.exit(1) }
const entries = listing.stdout.split('\n').filter((line) => line.startsWith('Path = ')).map((line) => line.slice(7).trim())
console.log('members:', entries.length)
console.log('--- matching package.json for @deepseek-ai ---')
entries.filter((name) => /@deepseek-ai\/(dsh|dsh-tools|dsh-mcp-client|dsh-llm)\/package\.json$/.test(name)).forEach((name) => console.log(' ', name))
