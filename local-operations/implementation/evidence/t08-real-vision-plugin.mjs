import { readFile, writeFile } from 'node:fs/promises';
import { modelCompletion } from '../source/lib/index.js';
import { admitVisualImages } from '../source/lib/visual-model-content.js';
export const name = 'studyhub-real-vision-probe';
export function apply(ctx) {
  ctx.inject(['attachments', 'llm'], async c => {
    const result = { route: { provider: 'deepseek-official', model: 'deepseek-flash' }, paidCallMade: false, startedAt: new Date().toISOString() };
    try {
      const image = await readFile('D:/studyhub/implementation/fixtures/vision-control.png');
      const parts = await admitVisualImages(c, [{ data: image, mediaType: 'image/png', name: 'vision-control.png' }]);
      result.attachment = parts[0].attachment;
      const complete = modelCompletion(c, () => result.route, 'studyhub-real-vision-probe');
      result.paidCallMade = true;
      result.answer = await complete.completeContent('Read the attached image carefully. Return only a JSON object.', [
        { type: 'text', text: 'Transcribe the code printed at the top, and count red circles and blue squares. Return keys code, redCircles, blueSquares. Do not guess if the image is unavailable.' }, ...parts,
      ], { maxTokens: 256, timeoutMs: 90000 });
      const expected = JSON.parse(await readFile('D:/studyhub/implementation/fixtures/vision-control.expected.json', 'utf8'));
      const answer = JSON.parse(result.answer.replace(/^```(?:json)?\s*|\s*```$/g, '').trim());
      result.ok = Object.entries(expected).every(([key, value]) => answer[key] === value);
    } catch (error) {
      // The launcher substitutes any loaded credential in diagnostics as an additional safeguard.
      result.error = { code: error.code, message: error.message };
      result.ok = false;
    }
    result.finishedAt = new Date().toISOString();
    await writeFile('D:/studyhub/implementation/evidence/t08-real-vision.json', JSON.stringify(result, null, 2));
  });
}
