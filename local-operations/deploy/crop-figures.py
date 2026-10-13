"""Crop every figure/table region MinerU found, straight from the scanned
pages of the original PDF.

Input:  MinerU doclib JSON (pages[] -> blocks[] with normalized bbox) + the PDF
Output: one PNG per region, named by page and block type, plus a manifest.

Normalized bbox is [x0, y0, x1, y1] in 0..1 of the page box.
"""
import json, os, sys, pathlib
import pymupdf

pdf_path, json_path, out_dir = sys.argv[1], sys.argv[2], sys.argv[3]
dpi = int(sys.argv[4]) if len(sys.argv) > 4 else 300
kinds = set((sys.argv[5] if len(sys.argv) > 5 else 'image,chart,table').split(','))

data = json.load(open(json_path, encoding='utf-8'))
pages = data.get('pages') or []
os.makedirs(out_dir, exist_ok=True)

doc = pymupdf.open(pdf_path)
manifest = []
total_bytes = 0

def text_of(block):
    content = block.get('content')
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        chunks = []
        for item in content:
            if isinstance(item, dict):
                chunks.append(item.get('content') if isinstance(item.get('content'), str) else '')
            elif isinstance(item, str):
                chunks.append(item)
        return ' '.join(c for c in chunks if c)
    return ''

for page in pages:
    idx = page.get('page_idx')
    if idx is None or idx >= doc.page_count:
        continue
    pymupdf_page = doc[idx]
    rect = pymupdf_page.rect
    scale = dpi / 72.0
    pixmap = pymupdf_page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), alpha=False)
    for n, block in enumerate(page.get('blocks') or []):
        if block.get('type') not in kinds:
            continue
        bbox = block.get('bbox')
        if not (isinstance(bbox, list) and len(bbox) == 4):
            continue
        x0, y0, x1, y1 = bbox
        clip = pymupdf.Rect(x0 * rect.width, y0 * rect.height, x1 * rect.width, y1 * rect.height) & rect
        if clip.is_empty or clip.width < 8 or clip.height < 8:
            continue
        page_pix = pymupdf_page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), clip=clip, alpha=False)
        name = f"p{idx + 1:03d}_{block.get('type')}_{n:02d}.png"
        path = os.path.join(out_dir, name)
        page_pix.save(path)
        size = os.path.getsize(path)
        total_bytes += size
        manifest.append({
            'file': name, 'page': idx + 1, 'type': block.get('type'), 'bbox': bbox,
            'pixels': f"{page_pix.width}x{page_pix.height}", 'bytes': size,
            'caption': text_of(block)[:200],
        })
    pixmap = None

json.dump(manifest, open(os.path.join(out_dir, '_manifest.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
counts = {}
for item in manifest:
    counts[item['type']] = counts.get(item['type'], 0) + 1
print(f"regions : {len(manifest)}  {counts}")
print(f"bytes   : {total_bytes/1024/1024:.1f} MB")
print(f"sample  : " + "; ".join(f"{m['file']} ({m['pixels']})" for m in manifest[:6]))
withcap = [m for m in manifest if m['caption'].strip()]
print(f"with text content (表/图注): {len(withcap)}")
for m in withcap[:3]:
    print(f"   {m['file']}: {m['caption'][:90]}")
