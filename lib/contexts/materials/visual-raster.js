/** Intrinsic dimensions from admitted PNG/JPEG headers; DSH performs full decoding before model admission. */
export function rasterDimensions(bytes, mime) {
  if (mime === 'image/png' && bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return checked(bytes.readUInt32BE(16), bytes.readUInt32BE(20));
  }
  if (mime === 'image/jpeg' && bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 255) throw new Error('Malformed JPEG segment');
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || marker >= 208 && marker <= 215) continue;
      const size = bytes.readUInt16BE(offset);
      if (size < 2 || offset + size > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) return checked(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3));
      offset += size;
    }
  }
  throw new Error('Parser raster dimensions unavailable');
}
function checked(width, height) {
  if (width < 1 || height < 1 || width * height > 64000000) throw new Error('Invalid parser raster dimensions');
  return { width, height };
}
