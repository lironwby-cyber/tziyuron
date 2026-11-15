import { test } from 'node:test';
import assert from 'node:assert/strict';
import { truth, evalScene, loadScene } from './scenes-eval.mjs';
import { detectPaper } from '../../js/image.js';

// Ten photo-like scenes: dark and light wood, a white table, a steep angle, a hand's shadow,
// yellow paper, paint reaching the edge, a checked tablecloth, clutter with blur, a rotated sheet.
for (const name of Object.keys(truth)) {
  test(`finds the sheet: ${name}`, () => {
    const { found, err } = evalScene(name);
    assert.ok(found, 'sheet not found');
    assert.ok(err < 1, `corner error ${err.toFixed(2)}% of the diagonal`);
  });
}

test('no sheet on a patterned tablecloth alone', () => {
  assert.equal(detectPaper(loadScene('neg-no-paper').img).found, false);
});

test('a photo already cropped to the drawing keeps the whole frame', () => {
  assert.equal(detectPaper(loadScene('neg-inside-paper').img).found, false);
});

test('live-camera size runs fast enough', () => {
  const { img } = loadScene('tablecloth', 320);
  const t = performance.now();
  for (let i = 0; i < 5; i++) detectPaper(img);
  const ms = (performance.now() - t) / 5;
  assert.ok(ms < 150, `${ms.toFixed(0)} ms per frame`);
});
