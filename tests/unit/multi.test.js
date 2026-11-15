import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadScene } from './scenes-eval.mjs';
import { detectPapers } from '../../js/image.js';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'scenes');
const truth = JSON.parse(readFileSync(join(dir, 'multi.json'), 'utf8'));
const diag = Math.hypot(1600, 1200);

// Several drawings in one photo: every sheet is found, each within 1% of its true corners.
for (const [name, quads] of Object.entries(truth)) {
  test(`several sheets in one photo: ${name}`, () => {
    const { img, scale } = loadScene(name, 1024);
    const res = detectPapers(img);
    assert.equal(res.length, quads.length, `found ${res.length} of ${quads.length}`);
    for (const q of quads) {
      const best = Math.min(...res.map((r) => Math.max(...r.corners.map((c, i) => Math.hypot(c.x * scale - q[i][0], c.y * scale - q[i][1]))) / diag * 100));
      assert.ok(best < 1, `a sheet is off by ${best.toFixed(2)}%`);
    }
  });
}

test('a single sheet still gives one result', () => {
  for (const name of ['dark-wood', 'white-table', 'tablecloth', 'painted-to-edge']) {
    const { img } = loadScene(name, 1024);
    assert.equal(detectPapers(img).length, 1, name);
  }
});

test('reading order: top row first, right to left', () => {
  const { img } = loadScene('multi-4-grey', 1024);
  const c = detectPapers(img).map((r) => ({ x: r.corners.reduce((s, p) => s + p.x, 0) / 4, y: r.corners.reduce((s, p) => s + p.y, 0) / 4 }));
  assert.ok(c[0].y < c[2].y && c[1].y < c[3].y);
  assert.ok(c[0].x > c[1].x && c[2].x > c[3].x);
});
