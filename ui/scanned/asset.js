/** Bounded authenticated reads; never ask the browser to open a host filesystem path. */
export async function readVisualAsset(call, scope, asset, { signal } = {}) {
  if (asset.bytes > 8 * 1024 * 1024) throw new Error('这项图片资源超过浏览器预览预算');
  const bytes = new Uint8Array(asset.bytes);
  for (let offset = 0; offset < asset.bytes;) {
    signal?.throwIfAborted();
    const chunk = await call('materials.visual.chunk', { ...scope, assetId: asset.assetId, offset });
    const value = Uint8Array.from(atob(chunk.dataBase64), char => char.charCodeAt(0));
    if (chunk.offset !== offset || value.length < 1 || value.length !== chunk.bytes || offset + value.length > bytes.length) throw new Error('图片分块传输不完整');
    bytes.set(value, offset); offset += value.length;
  }
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(value => value.toString(16).padStart(2, '0')).join('');
  if (hash !== asset.hash) throw new Error('图片完整性校验失败');
  return new Blob([bytes], { type: asset.mime });
}

export async function downloadVisualAsset(call, scope, asset, name) {
  if (!window.showSaveFilePicker) {
    if (asset.bytes > 8 * 1024 * 1024) throw new Error('大文件保存需要 Chrome/Edge 文件保存支持，请使用桌面导出');
    const url = URL.createObjectURL(await readVisualAsset(call, scope, asset));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = name; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); return;
  }
  const handle = await window.showSaveFilePicker({ suggestedName: name }), writer = await handle.createWritable();
  try {
    for (let offset = 0; offset < asset.bytes;) {
      const chunk = await call('materials.visual.chunk', { ...scope, assetId: asset.assetId, offset });
      const bytes = Uint8Array.from(atob(chunk.dataBase64), char => char.charCodeAt(0));
      if (!bytes.length || chunk.offset !== offset) throw new Error('资源下载中断');
      await writer.write(bytes); offset += bytes.length;
    }
    await writer.close();
  } catch (error) { await writer.abort(); throw error; }
}
