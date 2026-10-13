// List members of the remote macOS build matching a filter (range requests only).
import { inflateRawSync } from 'node:zlib'

const URL_ZIP = 'https://dshdesktop.com/updates/latest/dsh-desktop-mac-arm64.zip'
const FILTER = new RegExp(process.argv[2] ?? 'deepseek|asar|runtime', 'i')
const LIMIT = Number(process.argv[3] ?? 60)

async function getRange(start, end) {
  const response = await fetch(URL_ZIP, { headers: { Range: `bytes=${start}-${end}` } })
  return Buffer.from(await response.arrayBuffer())
}

const total = Number((await fetch(URL_ZIP, { method: 'HEAD' })).headers.get('content-length'))
const tail = await getRange(Math.max(0, total - 65536), total - 1)
let eocd = -1
for (let index = tail.length - 22; index >= 0; index -= 1) if (tail.readUInt32LE(index) === 0x06054b50) { eocd = index; break }
const entryCount = tail.readUInt16LE(eocd + 10)
const centralSize = tail.readUInt32LE(eocd + 12)
const centralOffset = tail.readUInt32LE(eocd + 16)
const central = await getRange(centralOffset, centralOffset + centralSize - 1)

const names = []
let p = 0
while (p + 46 <= central.length && central.readUInt32LE(p) === 0x02014b50) {
  const nameLength = central.readUInt16LE(p + 28)
  const extraLength = central.readUInt16LE(p + 30)
  const commentLength = central.readUInt16LE(p + 32)
  names.push({
    name: central.toString('utf8', p + 46, p + 46 + nameLength),
    method: central.readUInt16LE(p + 10),
    compressedSize: central.readUInt32LE(p + 20),
    localOffset: central.readUInt32LE(p + 42),
  })
  p += 46 + nameLength + extraLength + commentLength
}
console.log('entries:', names.length, '(header says', entryCount + ')')
console.log('--- first 12 ---')
names.slice(0, 12).forEach((entry) => console.log(' ', entry.name))
console.log('--- matching', FILTER, '---')
names.filter((entry) => FILTER.test(entry.name)).slice(0, LIMIT).forEach((entry) => console.log(` ${(entry.compressedSize / 1024).toFixed(0)}KB ${entry.name}`))

// Optionally pull one member.
const target = process.argv[4]
if (target) {
  const hit = names.find((entry) => entry.name.endsWith(target))
  if (!hit) { console.log('member not found:', target); process.exit(0) }
  const header = await getRange(hit.localOffset, hit.localOffset + 29)
  const dataStart = hit.localOffset + 30 + header.readUInt16LE(26) + header.readUInt16LE(28)
  const raw = await getRange(dataStart, dataStart + hit.compressedSize - 1)
  const buffer = hit.method === 0 ? raw : inflateRawSync(raw)
  console.log(`--- ${hit.name} (${buffer.length} bytes) ---`)
  console.log(buffer.toString('utf8').slice(0, 4000))
}
