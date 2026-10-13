// Read one member out of a remote ZIP using HTTP range requests only, so a
// 335 MB macOS build can answer "which harness version does it bundle?" in a
// few hundred KB of traffic.
import { inflateRawSync } from 'node:zlib'

const URL_ZIP = 'https://dshdesktop.com/updates/latest/dsh-desktop-mac-arm64.zip'
const WANT = [/@deepseek-ai\/dsh\/package\.json$/, /@deepseek-ai\/dsh-tools\/package\.json$/, /@deepseek-ai\/dsh-mcp-client\/package\.json$/]

async function getRange(start, end) {
  const response = await fetch(URL_ZIP, { headers: { Range: `bytes=${start}-${end}` } })
  if (!response.ok && response.status !== 206) throw new Error(`range ${start}-${end} -> HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}

const head = await fetch(URL_ZIP, { method: 'HEAD' })
const total = Number(head.headers.get('content-length'))
console.log('zip size:', total, 'bytes')

const tailStart = Math.max(0, total - 65536)
const tail = await getRange(tailStart, total - 1)
let eocd = -1
for (let index = tail.length - 22; index >= 0; index -= 1) {
  if (tail.readUInt32LE(index) === 0x06054b50) { eocd = index; break }
}
if (eocd < 0) throw new Error('EOCD not found')
let entryCount = tail.readUInt16LE(eocd + 10)
let centralSize = tail.readUInt32LE(eocd + 12)
let centralOffset = tail.readUInt32LE(eocd + 16)

// ZIP64 upgrade when the classic fields are saturated.
if (centralOffset === 0xffffffff || entryCount === 0xffff) {
  for (let index = eocd - 20; index >= 0; index -= 1) {
    if (tail.readUInt32LE(index) === 0x07064b50) {
      const zip64EocdOffset = Number(tail.readBigUInt64LE(index + 8))
      const z = await getRange(zip64EocdOffset, zip64EocdOffset + 55)
      entryCount = Number(z.readBigUInt64LE(32))
      centralSize = Number(z.readBigUInt64LE(40))
      centralOffset = Number(z.readBigUInt64LE(48))
      console.log('zip64: entries', entryCount, 'central at', centralOffset)
      break
    }
  }
}
console.log('entries:', entryCount, 'central dir:', centralOffset, '+', centralSize)

const central = await getRange(centralOffset, centralOffset + centralSize - 1)
const entries = []
let p = 0
while (p + 46 <= central.length && central.readUInt32LE(p) === 0x02014b50) {
  const method = central.readUInt16LE(p + 10)
  let compressedSize = central.readUInt32LE(p + 20)
  const nameLength = central.readUInt16LE(p + 28)
  const extraLength = central.readUInt16LE(p + 30)
  const commentLength = central.readUInt16LE(p + 32)
  let localOffset = central.readUInt32LE(p + 42)
  const name = central.toString('utf8', p + 46, p + 46 + nameLength)
  // ZIP64 extra field for saturated sizes/offsets.
  if (compressedSize === 0xffffffff || localOffset === 0xffffffff) {
    let q = p + 46 + nameLength
    const extraEnd = q + extraLength
    while (q + 4 <= extraEnd) {
      const id = central.readUInt16LE(q)
      const size = central.readUInt16LE(q + 2)
      if (id === 0x0001) {
        let r = q + 4
        if (central.readUInt32LE(p + 20) === 0xffffffff) { compressedSize = Number(central.readBigUInt64LE(r)); r += 8 }
        if (central.readUInt32LE(p + 42) === 0xffffffff) { localOffset = Number(central.readBigUInt64LE(r)); r += 8 }
        break
      }
      q += 4 + size
    }
  }
  entries.push({ name, method, compressedSize, localOffset })
  p += 46 + nameLength + extraLength + commentLength
}
console.log('parsed entries:', entries.length)

for (const pattern of WANT) {
  const hit = entries.find((entry) => pattern.test(entry.name))
  if (!hit) { console.log('NOT FOUND:', pattern); continue }
  const header = await getRange(hit.localOffset, hit.localOffset + 29)
  const nameLength = header.readUInt16LE(26)
  const extraLength = header.readUInt16LE(28)
  const dataStart = hit.localOffset + 30 + nameLength + extraLength
  const raw = await getRange(dataStart, dataStart + hit.compressedSize - 1)
  const json = JSON.parse((hit.method === 0 ? raw : inflateRawSync(raw)).toString('utf8'))
  console.log(`--- ${hit.name}`)
  console.log('   name:', json.name, 'version:', json.version)
  if (json.dependencies?.['@deepseek-ai/dsh']) console.log('   depends on @deepseek-ai/dsh:', json.dependencies['@deepseek-ai/dsh'])
}
