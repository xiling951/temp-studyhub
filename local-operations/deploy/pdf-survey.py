"""Survey what a PDF actually contains: text layer, raster images, vector
graphics, fonts, attachments. Decides what "complete extraction" has to cover."""
import sys, collections
import pymupdf

path = sys.argv[1]
doc = pymupdf.open(path)
print(f"pages           : {doc.page_count}")
meta = doc.metadata or {}
print(f"title           : {meta.get('title')!r}")
print(f"producer        : {meta.get('producer')!r}")
print(f"encrypted       : {doc.is_encrypted}")
print(f"embedded files  : {len(doc.embfile_names())}")

tot_chars = 0
raster_pages = 0
vector_pages = 0
empty_text_pages = 0
img_counts = []
draw_counts = []
fonts = collections.Counter()
heavy = []
for i, page in enumerate(doc, start=1):
    text = page.get_text("text")
    chars = len(text.strip())
    tot_chars += chars
    if chars == 0:
        empty_text_pages += 1
    images = page.get_images(full=True)
    drawings = page.get_drawings()
    img_counts.append(len(images))
    draw_counts.append(len(drawings))
    if images:
        raster_pages += 1
    if len(drawings) > 50:
        vector_pages += 1
    for f in page.get_fonts(full=True):
        fonts[f[3]] += 1
    if len(drawings) > 300 or len(images) >= 5:
        heavy.append((i, chars, len(images), len(drawings)))

print(f"text chars total: {tot_chars}  (avg {tot_chars // max(1, doc.page_count)}/page)")
print(f"pages with no text layer : {empty_text_pages}")
print(f"pages with raster images : {raster_pages}")
print(f"pages with >50 vector ops: {vector_pages}")
print(f"raster image objects     : {sum(img_counts)}")
print(f"vector drawing objects   : {sum(draw_counts)}")
print("top fonts        :", ", ".join(f"{n}x{c}" for n, c in fonts.most_common(6)))
print(f"figure-heavy pages (first 25 of {len(heavy)}):")
for page_no, chars, imgs, draws in heavy[:25]:
    print(f"   p{page_no:<4} text={chars:<5} raster={imgs:<3} vectorOps={draws}")
