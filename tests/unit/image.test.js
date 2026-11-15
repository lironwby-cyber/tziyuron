import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeImage, detectPaper, homography, applyH, warpPerspective, warpSize, cleanPaper, otsuThreshold, quadArea } from '../../js/image.js';

/** Dark table with a bright, tilted sheet, a soft shadow and a red stroke on it. */
function scene(w = 400, h = 300, quad = [{ x: 90, y: 50 }, { x: 320, y: 70 }, { x: 300, y: 260 }, { x: 70, y: 240 }]) {
  const img = makeImage(w, h);
  const inside = (x, y) => {
    let s = 0;
    for (let i = 0; i < 4; i++) {
      const a = quad[i], b = quad[(i + 1) % 4];
      const c = (b.x - a.x) * (y - a.y) - (b.y - a.y) * (x - a.x);
      if (c === 0) continue;
      if (s === 0) s = Math.sign(c); else if (Math.sign(c) !== s) return false;
    }
    return true;
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let v = [60, 52, 45];
      if (inside(x, y)) {
        const shade = 235 - (x / w) * 50; // light falls off to one side
        v = [shade, shade - 3, shade - 8];
        if (Math.abs(y - 150) < 4 && x > 150 && x < 250) v = [200 * shade / 235, 30, 30];
      }
      img.data[i] = v[0]; img.data[i + 1] = v[1]; img.data[i + 2] = v[2]; img.data[i + 3] = 255;
    }
  }
  return { img, quad };
}

test('otsu splits two populations', () => {
  const g = new Uint8Array(1000);
  for (let i = 0; i < 1000; i++) g[i] = i < 500 ? 40 : 210;
  const t = otsuThreshold(g);
  assert.ok(t >= 40 && t < 210, `threshold ${t}`);
});

test('detectPaper finds the four corners of a tilted sheet', () => {
  const { img, quad } = scene();
  const { corners, found } = detectPaper(img);
  assert.ok(found);
  corners.forEach((c, i) => {
    const d = Math.hypot(c.x - quad[i].x, c.y - quad[i].y);
    assert.ok(d < 6, `corner ${i} off by ${d.toFixed(1)}px`);
  });
});

test('detectPaper reports not found on a blank frame', () => {
  const img = makeImage(100, 80);
  img.data.fill(128);
  const r = detectPaper(img);
  assert.equal(r.found, false);
  assert.equal(quadArea(r.corners), 99 * 79);
});

test('homography maps the four points exactly', () => {
  const src = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
  const dst = [{ x: 10, y: 5 }, { x: 90, y: 20 }, { x: 80, y: 95 }, { x: 5, y: 80 }];
  const H = homography(src, dst);
  src.forEach((p, i) => {
    const q = applyH(H, p.x, p.y);
    assert.ok(Math.abs(q.x - dst[i].x) < 1e-6 && Math.abs(q.y - dst[i].y) < 1e-6);
  });
});

test('warp straightens the sheet and keeps the stroke', () => {
  const { img, quad } = scene();
  const size = warpSize(quad);
  const out = warpPerspective(img, quad, size.width, size.height);
  assert.equal(out.width, size.width);
  // Every pixel in the output is paper or stroke, not the dark table (check a margin-free inner area).
  let dark = 0, red = 0;
  for (let y = 3; y < out.height - 3; y++) {
    for (let x = 3; x < out.width - 3; x++) {
      const i = (y * out.width + x) * 4;
      if (out.data[i] < 100 && out.data[i + 1] < 100) dark++;
      if (out.data[i] > 120 && out.data[i + 1] < 80) red++;
    }
  }
  assert.equal(dark, 0, 'no table pixels inside the straightened sheet');
  assert.ok(red > 100, 'red stroke survives');
});

test('cleanPaper turns uneven paper white and keeps colour', () => {
  const { img, quad } = scene();
  const size = warpSize(quad);
  const out = cleanPaper(warpPerspective(img, quad, size.width, size.height));
  let paper = 0, white = 0, red = 0;
  for (let y = 10; y < out.height - 10; y++) {
    for (let x = 10; x < out.width - 10; x++) {
      const i = (y * out.width + x) * 4;
      const isRed = out.data[i] > 150 && out.data[i + 1] < 90 && out.data[i + 2] < 90;
      if (isRed) { red++; continue; }
      paper++;
      if (out.data[i] >= 250 && out.data[i + 1] >= 250 && out.data[i + 2] >= 245) white++;
    }
  }
  assert.ok(white / paper > 0.95, `paper white ratio ${(white / paper).toFixed(3)}`);
  assert.ok(red > 100, 'stroke stays red');
});

test('cleanPaper keeps a large coloured fill and its hue', () => {
  // Paper with a big orange disc covering several cells: it must not be treated as paper.
  const w = 240, h = 240;
  const img = makeImage(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const inDisc = (x - 120) ** 2 + (y - 120) ** 2 < 70 ** 2;
      const v = inDisc ? [250, 150, 40] : [225, 222, 215];
      img.data.set([...v, 255], i);
    }
  }
  const out = cleanPaper(img);
  const at = (x, y) => [...out.data.slice((y * w + x) * 4, (y * w + x) * 4 + 3)];
  const [r, g, b] = at(120, 120);
  assert.ok(r > 230 && g > 130 && g < 190 && b < 70, `disc centre ${[r, g, b]}`);
  assert.deepEqual(at(10, 10), [255, 255, 255]);
});

test('cleanPaper keeps a large black fill dark', () => {
  const w = 200, h = 200;
  const img = makeImage(w, h);
  for (let p = 0; p < w * h; p++) {
    const x = p % w, y = (p / w) | 0;
    const dark = x > 50 && x < 150 && y > 50 && y < 150;
    img.data.set(dark ? [30, 30, 30, 255] : [220, 220, 220, 255], p * 4);
  }
  const out = cleanPaper(img);
  assert.ok(out.data[(100 * w + 100) * 4] < 60, 'black area stays black');
  assert.equal(out.data[(10 * w + 10) * 4], 255);
});
