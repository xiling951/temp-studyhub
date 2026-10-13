import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const installed = path.join(process.env.APPDATA, 'dsh-desktop/harness/profiles/web/node_modules/@ericwang1358/dsh-daily-flashcard');
const load = file => import(pathToFileURL(path.join(installed, file)).href);
const { publicCard } = await load('lib/domain.js');
const { citationCheck, quotePages } = await load('lib/quote-match.js');
const { normalizeHits } = await load('lib/retrieval.js');
const { planIndex, contentHash } = await load('lib/retrieval-index.js');
const { omitLocalImagePayloads } = await load('lib/study-image-markdown.js');
const { pdfConvertDefinition } = await load('lib/contexts/audio/pdf/pdf-convert-job.js');
const report = {
  version: JSON.parse(await readFile(path.join(installed, 'package.json'), 'utf8')).version,
  installed,
  probes: {
    imageOnlyCitation: citationCheck(quotePages([{ id: 'p1', text: '' }]), { sourceId: 'p1', quote: '图中的晶体管采用串联连接' }, { locate: false }),
    publicCardKeepsProposedAssets: 'assets' in publicCard({ id: 'q1', kind: 'flashcard', topic: 'test', prompt: 'test', hint: 'test', assets: [{ assetId: 'figure1' }] }),
    retrievalKeepsProposedAssets: normalizeHits([{ text: '图注', sourceId: 'p1', page: 1, assetId: 'figure1', revision: 'r1', bbox: [0,0,1,1] }]),
    explanationChangeReindexed: planIndex({ sources: [{ id: 'p1', text: '相同正文', figureNotes: '新的图像解释' }], library: ['p1'], manifest: { sources: { p1: { hash: contentHash('相同正文') } } } }).add.length,
    modelPayloadAfterTextCleaning: omitLocalImagePayloads('图：data:image/png;base64,aGVsbG8='),
    explicitPdfConvertCapabilities: pdfConvertDefinition.capabilities,
  },
};
await writeFile('D:/studyhub/lab/import-probe/plan-compatibility-results.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
