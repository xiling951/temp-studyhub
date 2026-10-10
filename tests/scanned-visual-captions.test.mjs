import test from 'node:test';
import assert from 'node:assert/strict';
import { associateVisualCaptions } from '../lib/contexts/materials/visual-captions.js';

// Synthetic regression of the exact geometry observed on the real book's PDF page 149.
test('distinct misplaced figure caption moves only to a clearly closer image; input and evidence identities remain intact', () => {
  const blocks = [
    { id: 'lower', type: 'image', bbox: [0.391, 0.603, 0.655, 0.79], assetId: 'lower-image', captions: [] },
    { id: 'upper', type: 'image', bbox: [0.417, 0.397, 0.621, 0.571], assetId: 'upper-image', captions: [
      { text: '图5.1 静态 CMOS 反相器', bbox: [0.322, 0.58, 0.701, 0.596] },
      { text: '图5.2 开关模型', bbox: [0.378, 0.793, 0.65, 0.809] },
    ] },
  ];
  const before = structuredClone(blocks), result = associateVisualCaptions(blocks, 149);
  assert.deepEqual(blocks, before); assert.deepEqual(result.map(b => b.assetId), blocks.map(b => b.assetId));
  assert.deepEqual(result.map(b => b.figureNumber), ['5.2', '5.1']);
  assert.equal(result[0].captions[0].originalBlockId, 'upper');
  assert.equal(result[1].captions.length, 1);
  assert.deepEqual(associateVisualCaptions(result, 149), result);
});

test('unlocated, ambiguous and shared subfigure captions are retained rather than guessed', () => {
  const blocks = [
    { id: 'a', type: 'image', bbox: [0.1, 0.2, 0.4, 0.4], captions: [{ text: '(a)' }], assetId: 'a' },
    { id: 'b', type: 'image', bbox: [0.5, 0.2, 0.8, 0.4], captions: [{ text: '图6.15 (b)' }], assetId: 'b' },
    { id: 'c', type: 'image', bbox: null, captions: [{ text: '图7.1' }, { text: '图7.2' }], assetId: 'c' },
  ];
  const result = associateVisualCaptions(blocks, 200);
  assert.equal(result[0].parentId, result[1].parentId); assert.equal(result[2].captions.length, 2);
  assert.deepEqual(result.map(b => b.captions), blocks.map(b => b.captions));
});
