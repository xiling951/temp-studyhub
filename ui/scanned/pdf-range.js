/** PDF.js transport over the existing library-scoped bridge. No URL or whole-book base64. */
export function visualPdfRange(PDFDataRangeTransport, call, scope, asset) {
  const stop = new AbortController();
  let rejectFailure, active = 0; const waiting = [];
  const failure = new Promise((_resolve, reject) => { rejectFailure = reject; });
  void failure.catch(() => {});
  const pump = () => {
    while (active < 2 && waiting.length && !stop.signal.aborted) {
      const { begin, end } = waiting.shift(); active++;
      void read(begin, end).catch(error => { if (!stop.signal.aborted) { rejectFailure(error); stop.abort(); } }).finally(() => { active--; pump(); });
    }
  };
  const range = new PDFDataRangeTransport(asset.bytes, new Uint8Array(0));
  range.requestDataRange = (begin, end) => {
    if (!Number.isSafeInteger(begin) || !Number.isSafeInteger(end) || begin < 0 || end <= begin || end > asset.bytes || end - begin > 8 * 1024 * 1024) { rejectFailure(new Error('Invalid PDF range request')); return; }
    if (stop.signal.aborted) return;
    waiting.push({ begin, end }); pump();
  };
  async function read(begin, end) {
    const bytes = new Uint8Array(end - begin);
    for (let offset = begin; offset < end;) {
      stop.signal.throwIfAborted();
      const chunk = await call('materials.visual.chunk', { ...scope, assetId: asset.assetId, offset, length: Math.min(262144, end - offset) });
      stop.signal.throwIfAborted();
      const data = Uint8Array.from(atob(chunk.dataBase64), char => char.charCodeAt(0));
      if (chunk.offset !== offset || chunk.totalBytes !== asset.bytes || chunk.bytes !== data.length || !data.length || offset + data.length > end) throw new Error('Original PDF range transfer is incomplete');
      bytes.set(data, offset - begin); offset += data.length;
    }
    range.onDataRange(begin, bytes);
  }
  range.abort = () => { stop.abort(); waiting.length = 0; };
  return { range, failure, close: range.abort };
}
