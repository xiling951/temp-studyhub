import test from 'node:test';
import assert from 'node:assert/strict';
import { parseJson } from '../lib/generation.js';
import { decodeCloudPage } from '../lib/contexts/materials/scanned/cloud-result.js';
import { stripTrailingCommas } from '../lib/model-json.js';

test('a prematurely closed review object cannot silently discard trailing quality checks', () => {
  assert.throws(() => parseJson('{"evidenceValid":true,"answerCorrect":true,"issues":[]},"checks":[{"cardId":"q"}]}'), SyntaxError);
  assert.deepEqual(parseJson('Here is the payload: {"accepted":false} Further explanation follows.'), { accepted: false });
});

test('structural trailing commas leave quoted transcription, escapes and literal comma-bracket sequences unchanged', () => {
  const literal = 'Literal ,] and ,} with "quotes" and \\alpha';
  const response = `{"text":${JSON.stringify(literal)},"parts":[1,2,],}`;
  assert.deepEqual(JSON.parse(stripTrailingCommas(response)), { text: literal, parts: [1, 2] });
  assert.throws(() => JSON.parse(stripTrailingCommas('{"missing":[')));
  const page = decodeCloudPage('{"blank":false,"printedPage":"242","blocks":[{"type":"text","text":"Actual literal ,] prose","bbox":[0.1,0.1,0.9,0.2],"uncertainty":[]},],"uncertainty":[],}');
  assert.equal(page.blocks[0].text, 'Actual literal ,] prose');
  assert.throws(() => decodeCloudPage('{"blank":false,"blocks":['), /未提交/);
});

test('one explicit JSON review is parsed after mathematical prose, preserving a rejection instead of selecting TeX braces', () => {
  const answer = 'The boundary V_{GS} differs from V_{DS}.\n```json\n{"evidenceValid":false,"answerCorrect":false,"issues":["Incorrect boundary"]}\n```';
  assert.deepEqual(parseJson(answer), { evidenceValid: false, answerCorrect: false, issues: ['Incorrect boundary'] });
  assert.throws(() => parseJson('Reasoning {x}\n```json\n{"approved":true}\n```\n```json\n{"approved":false}\n```'), /Ambiguous/);
});
