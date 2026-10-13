"""Build a single browsable HTML page: the extracted text plus every cropped
figure, with page numbers and MinerU's own captions."""
import html, json, os, sys

md_path, figures_dir, out_html = sys.argv[1], sys.argv[2], sys.argv[3]
title = sys.argv[4] if len(sys.argv) > 4 else 'PDF 完整提取结果'

text = open(md_path, encoding='utf-8').read()
manifest = []
mpath = os.path.join(figures_dir, '_manifest.json')
if os.path.exists(mpath):
    manifest = json.load(open(mpath, encoding='utf-8'))

cards = []
for item in sorted(manifest, key=lambda m: (m['page'], m['file'])):
    caption = (item.get('caption') or '').strip()
    kind = item.get('type')
    label = {'image': '图', 'chart': '图表', 'table': '表格'}.get(kind, kind)
    cards.append(f"""
    <figure>
      <a href="figures/{html.escape(item['file'])}" target="_blank">
        <img loading="lazy" src="figures/{html.escape(item['file'])}" alt="p{item['page']} {kind}">
      </a>
      <figcaption><b>p{item['page']}</b> · {label} · {item['pixels']}
        <br><span class="cap">{html.escape(caption[:180]) if caption else '（无图注）'}</span>
      </figcaption>
    </figure>""")

page = f"""<!doctype html>
<html lang="zh-CN"><meta charset="utf-8">
<title>{html.escape(title)}</title>
<style>
 body{{margin:0;background:#faf9f7;color:#26221f;font:15px/1.75 -apple-system,"Segoe UI",system-ui,sans-serif}}
 header{{position:sticky;top:0;background:#fff;border-bottom:1px solid #e6e2dc;padding:14px 22px;z-index:5}}
 h1{{font-size:17px;margin:0 0 4px}} .meta{{color:#6b6560;font-size:12.5px}}
 main{{max-width:1180px;margin:0 auto;padding:22px}}
 h2{{font-size:15px;margin:26px 0 10px;padding-bottom:6px;border-bottom:1px solid #e6e2dc}}
 pre{{white-space:pre-wrap;word-break:break-word;background:#fff;border:1px solid #e6e2dc;border-radius:8px;padding:16px;font:13.5px/1.7 ui-monospace,Consolas,monospace}}
 .grid{{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px}}
 figure{{margin:0;background:#fff;border:1px solid #e6e2dc;border-radius:8px;padding:8px}}
 figure img{{width:100%;height:auto;border-radius:5px;background:#fff}}
 figcaption{{font-size:12px;color:#6b6560;margin-top:6px}} .cap{{color:#3f3a36}}
 a{{color:#a63a1f}}
</style>
<header>
  <h1>{html.escape(title)}</h1>
  <div class="meta">文字 {len(text):,} 字符 · 裁出区域 {len(manifest)} 个 ·
    来源：MinerU standard 档解析缓存 + 原始扫描页 300 dpi 裁切</div>
</header>
<main>
  <h2>一、图表区（点图看原尺寸）</h2>
  <div class="grid">{''.join(cards)}</div>
  <h2>二、提取出的全文（含 LaTeX 公式、表格 HTML、页码标记、图块引用）</h2>
  <pre>{html.escape(text)}</pre>
</main>
</html>"""
open(out_html, 'w', encoding='utf-8').write(page)
print(f"written {out_html}  ({os.path.getsize(out_html)/1024:.1f} KB)  figures={len(manifest)}  text={len(text)} chars")
