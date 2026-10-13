/* 把 全文.md 渲染成自包含的 全文.html（公式用 KaTeX，图片复制到 HTML 目录，离线可看）。
 * 依赖来自 StudyHub 自己的包：markdown-it / markdown-it-texmath / katex。
 * 本脚本不启动任何子进程，只读写文件。
 */
const fs = require('node:fs');
const path = require('node:path');

const [, , mdPath, htmlDirArg, titleArg] = process.argv;
if (!mdPath || !htmlDirArg) {
  console.error('用法: node render-fulltext.cjs <全文.md 的路径> <HTML 输出目录> [标题]');
  process.exit(2);
}
const htmlDir = path.resolve(htmlDirArg);
const mdDir = path.dirname(path.resolve(mdPath));

const MarkdownIt = require('markdown-it');
let texmath = null;
try { texmath = require('markdown-it-texmath'); } catch { /* 没装就退化为纯文本公式 */ }
let katex = null;
try { katex = require('katex'); } catch { /* 同上 */ }

function katexDir() {
  const candidates = [];
  try { candidates.push(path.dirname(require.resolve('katex/dist/katex.min.css'))); } catch {}
  try { candidates.push(path.dirname(require.resolve('katex'))); } catch {}
  for (const dir of candidates) if (fs.existsSync(path.join(dir, 'katex.min.css'))) return dir;
  return null;
}

let md = fs.readFileSync(mdPath, 'utf8');
// 让 HTML 里的分页标记可见
md = md.replace(/<!--\s*page\s+(\d+)\s+of\s+(\d+)\s*-->/g, '\n\n<div class="pagebreak">— 第 $1 页 / 共 $2 页 —</div>\n\n');

const mdi = new MarkdownIt({ html: true, linkify: false, breaks: false });
if (texmath && katex) {
  mdi.use(texmath, { engine: katex, delimiters: 'dollars', katexOptions: { throwOnError: false, output: 'html' } });
  console.log('公式渲染: markdown-it-texmath + katex');
} else {
  console.log('警告: 未找到 texmath/katex，公式将按原样文本显示');
}
const body = mdi.render(md);

fs.mkdirSync(htmlDir, { recursive: true });

const srcImages = path.join(mdDir, 'images');
const dstImages = path.join(htmlDir, 'images');
if (fs.existsSync(srcImages)) {
  fs.cpSync(srcImages, dstImages, { recursive: true });
  console.log('已复制图片: ' + fs.readdirSync(dstImages).length + ' 个 -> ' + dstImages);
} else {
  console.log('警告: 未找到图片目录 ' + srcImages);
}

let katexLink = '';
const kdir = katexDir();
if (kdir) {
  fs.mkdirSync(path.join(htmlDir, 'katex'), { recursive: true });
  fs.copyFileSync(path.join(kdir, 'katex.min.css'), path.join(htmlDir, 'katex', 'katex.min.css'));
  const fontsSrc = path.join(kdir, 'fonts');
  if (fs.existsSync(fontsSrc)) fs.cpSync(fontsSrc, path.join(htmlDir, 'katex', 'fonts'), { recursive: true });
  katexLink = '<link rel="stylesheet" href="katex/katex.min.css">';
  console.log('已复制 KaTeX 样式与字体: ' + kdir);
} else {
  console.log('警告: 未找到 katex.min.css，公式样式将退化');
}

const pageTitle = titleArg || path.basename(mdPath, '.md');
const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${pageTitle}</title>
${katexLink}
<style>
  :root { --ink:#1f2328; --muted:#6b7280; --line:#d8dee4; --bg:#ffffff; --soft:#f6f8fa; --accent:#0b5cad; }
  body { margin:0; background:var(--soft); color:var(--ink);
         font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif; line-height:1.8; }
  main { max-width:900px; margin:0 auto; background:var(--bg); padding:48px 56px 96px;
         box-shadow:0 1px 3px rgba(0,0,0,.08); }
  h1 { font-size:1.7em; border-bottom:2px solid var(--line); padding-bottom:.4em; }
  h2 { font-size:1.35em; margin-top:2em; border-bottom:1px solid var(--line); padding-bottom:.25em; }
  h3 { font-size:1.15em; margin-top:1.6em; }
  p { margin:.9em 0; }
  ul { margin:.6em 0 .9em 1.4em; }
  img { display:block; max-width:min(100%,640px); height:auto; margin:1.3em auto;
        border:1px solid var(--line); border-radius:6px; background:#fff; padding:6px; }
  table { border-collapse:collapse; margin:1.2em 0; width:100%; font-size:.95em; }
  th, td { border:1px solid var(--line); padding:6px 10px; text-align:left; }
  th { background:var(--soft); }
  table table { margin:0; }
  hr { border:0; border-top:1px solid var(--line); margin:2.5em 0; }
  small, .docvortex-page-footnote { color:var(--muted); font-size:.88em; }
  code { background:var(--soft); padding:.15em .35em; border-radius:4px;
         font-family:Consolas,"Courier New",monospace; font-size:.92em; }
  .pagebreak { margin:2.6em 0 1.6em; text-align:center; color:var(--accent);
               font-size:.88em; letter-spacing:.08em; border-top:1px dashed var(--line); padding-top:1.1em; }
</style>
</head>
<body>
<main>
${body}
</main>
</body>
</html>
`;
const outHtml = path.join(htmlDir, '全文.html');
fs.writeFileSync(outHtml, html, 'utf8');
console.log('已写入: ' + outHtml);
console.log('HTML 字节: ' + Buffer.byteLength(html, 'utf8'));
