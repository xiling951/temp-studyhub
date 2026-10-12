/* Prepare private plans from the user's actual immutable book revision. */
import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
const evidence = resolve('../evidence/fullbook-20261012');
const manifest = JSON.parse(await readFile(join(evidence, 'original-manifest-private.json'), 'utf8'));
const topics = [
  { name: 'mos-static', title: 'MOS专题 · 静态工作区与非理想效应', pages: [80, 93], blocks: ['p83-b2', 'p87-b2', 'p92-b2', 'p93-b3'],
    focus: 'MOS晶体管的阈值与体效应、截止/电阻/饱和区边界、速度饱和、沟道长度调制和长短沟模型比较。至少4题必须结合所选真实曲线或工作区图推理，不能只读图注。计算题明确给出全部参数、符号约定、采用的模型及单位，区别长沟饱和和速度饱和条件。' },
  { name: 'mos-dynamic', title: 'MOS专题 · 电容、开关模型与动态效应', pages: [93, 100], blocks: ['p95-b4', 'p96-b9', 'p97-b4', 'p99-b3'],
    focus: 'MOS开关等效电阻，覆盖电容、沟道电容、工作区内的电容分配、源漏结电容和器件电容模型。至少4题结合所选原图/原表完成推理或定量分析，明确给定所需尺寸、偏置、模型参数和单位。避免凭图中模糊字符猜值。' },
  { name: 'mos-inverter', title: 'MOS专题 · CMOS反相器、VTC与噪声容限', pages: [148, 156], blocks: ['p149-b8', 'p151-b2', 'p153-b7', 'p154-b11'],
    focus: '由NMOS/PMOS连接推理CMOS反相器的稳态路径、各VTC区域器件工作模式、尺寸比与开关阈值、噪声容限及VIL/VIH定义。至少4题结合所选原始电路、VTC或曲线推理。计算题给出全部参数和模型，明确电压及电流符号，避免把开关阈值当作噪声边界。' },
];
for (const topic of topics) {
  const pages = manifest.pages.filter(page => page.page >= topic.pages[0] && page.page <= topic.pages[1]);
  const selected = pages.flatMap(page => page.blocks).filter(block => topic.blocks.includes(block.id));
  if (selected.length !== 4 || selected.some(block => !block.assetId || !block.bbox)) throw Error('Topic requires four actual located images');
  const bytes = selected.reduce((sum, block) => sum + manifest.assets.find(asset => asset.assetId === block.assetId).bytes, 0);
  if (bytes > 8 * 1024 * 1024) throw Error('Topic image budget exceeded');
  const plan = { title: topic.title, course: '数字集成电路', sourceIds: pages.map(page => page.sourceId).filter(Boolean), count: 10, kind: 'open', language: 'zh',
    focus: topic.focus + ' 全部10题只考本主题，难度包含理解、应用和分析；不以页码、图号、作者或参考文献为考点。每题须有真实逐字材料引用、完整答案、解释及常见误区。所有图像结论须通过独立原图复审。',
    visualTargets: [{ documentId: manifest.documentId, revision: manifest.revision, blockIds: topic.blocks }] };
  await writeFile(join(evidence, `topic-${topic.name}-plan-private.json`), JSON.stringify(plan, null, 2));
  console.log(JSON.stringify({ topic: topic.name, sourcePages: plan.sourceIds.length, images: selected.length, imageBytes: bytes, requested: 10 }));
}
