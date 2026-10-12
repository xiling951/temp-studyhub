import test from 'node:test';
import assert from 'node:assert/strict';
import { retrieveFromPort } from '../lib/retrieval.js';
import { planIssues } from '../lib/assessment-quality.js';
import { rankBookTerms } from '../lib/retrieval-lexical.js';

test('literal figure search uses actual captions without confusing decimal prefixes and bibliography search remains available', () => {
  const source = (id, text, caption, topicSearchable = true) => ({ id, text, visualIndex: { topicSearchable, blocks: [{ type: topicSearchable ? 'chart' : 'ref_text', text, captions: [{ text: caption }] }] } });
  const sources = [source('actual', '实际曲线所在页', '图 3.14 衬底偏置'), source('other', '另一曲线', '图3.140'), source('refs', '参考文献 出版信息', '', false)];
  assert.deepEqual(rankBookTerms(sources, '图3.14').map(hit => hit.sourceId), ['actual']);
  assert.deepEqual(rankBookTerms([...sources, source('mixed', '两种图号在同一页', '图3.14与图3.140')], '图3.14').map(hit => hit.sourceId), ['actual', 'mixed']);
  assert.deepEqual(rankBookTerms(sources, '参考文献 出版').map(hit => hit.sourceId), ['refs']);
});

test('companion Chinese retrieval complements an irrelevant vector hit with exact scoped book terms and heading evidence', async () => {
  const source = (id, text, type = 'text') => ({ id, title: id, text, document: { page: Number(id.slice(1)), origin: 'ocr' }, visualIndex: { schema: 1, blocks: [{ id: 'b', type, text }] } });
  const sources = [source('s1', '出版社 CMOS 数字电路'), source('s2', 'CMOS反相器 VTC 与噪声容限的定义', 'paragraph_title'),
    source('s3', '在CMOS反相器中，用VTC的增益边界确定噪声容限'), source('s4', 'CMOS反相器 VTC 噪声容限论文参考文献', 'ref_text')];
  const tools = [{ name: 'mcp__studyhub__query_documents', parameters: { properties: { query: { type: 'string' }, limit: { type: 'integer' } } } }];
  const port = { tools: () => tools, call: async () => ({ content: [{ type: 'text', text: JSON.stringify([{ sourceId: 's1', text: sources[0].text, score: 1 }, { sourceId: 'outside', text: 'Unselected page', score: 0.9 }]) }] }) };
  const result = await retrieveFromPort(port, { provider: 'mcp:mcp__studyhub__query_documents' }, { query: 'CMOS反相器 VTC 噪声容限', sources, limit: 2 });
  assert.deepEqual(result.passages.map(p => p.sourceId), ['s2', 's3']);
  assert.ok(result.passages.every(p => p.text === sources.find(source => source.id === p.sourceId).text));
  assert.equal(result.augmentation.kind, 'literal-book-terms'); assert.equal(result.unresolved, 1);
  const other = await retrieveFromPort(port, { provider: 'service' }, { query: 'CMOS反相器', sources }).catch(error => error);
  assert.ok(other instanceof Error, 'other provider admission remains unchanged');
});

test('image-only plans require selected actual image indices; invented, duplicate or unbound references fail', () => {
  const target = { objective: 'Visible switch connection', knowledge: 'The switch connects the indicated nodes', citations: [] };
  const request = { count: 1, sources: [], visualEvidence: { citations: [{ blockId: 'actual' }] } };
  assert.deepEqual(planIssues({ targets: [{ ...target, imageEvidenceIndices: [0] }] }, request), []);
  for (const indices of [[1], [-1], [0, 0], ['actual'], []]) assert.ok(planIssues({ targets: [{ ...target, imageEvidenceIndices: indices }] }, request).length);
});
