import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MOTIONS, suggestFromTitle, cleanMotions, turnBox, turnMotions, pose, facing, inkRegion } from '../../js/motion.js';

test('a name with a known thing gets the movement that fits it', () => {
  assert.deepEqual(suggestFromTitle('פרפר צבעוני'), [{ label: 'הפרפר עף', motion: 'fly' }]);
  assert.deepEqual(suggestFromTitle('המכונית של סבא'), [{ label: 'המכונית נוסעת', motion: 'drive' }]);
  assert.deepEqual(suggestFromTitle('דג בים'), [{ label: 'הדג שוחה', motion: 'swim' }]);
  assert.deepEqual(suggestFromTitle('טיל לירח').map((m) => m.motion), ['rise', 'twinkle']);
});

test('prefix letters, plurals and phrases', () => {
  assert.deepEqual(suggestFromTitle('ילדה והכלב שלה').map((m) => m.label), ['הילדה קופצת', 'הכלב הולך']);
  assert.deepEqual(suggestFromTitle('פרחים בגינה'), [{ label: 'הפרחים מתנדנדים ברוח', motion: 'sway' }]);
  assert.deepEqual(suggestFromTitle('כדור פורח בשמיים'), [{ label: 'הכדור הפורח עולה', motion: 'rise' }]);
  assert.deepEqual(suggestFromTitle('בת ים וצב ים').map((m) => m.motion), ['swim', 'swim']);
  assert.deepEqual(suggestFromTitle('פַּרְפַּר!'), [{ label: 'הפרפר עף', motion: 'fly' }]);
});

test('words that only look alike are not matched', () => {
  assert.deepEqual(suggestFromTitle('כלב'), [{ label: 'הכלב הולך', motion: 'walk' }], 'כלב is a dog, not a heart with a prefix');
  assert.deepEqual(suggestFromTitle('דגל ישראל'), [{ label: 'הדגל מתנופף', motion: 'sway' }], 'דגל is a flag, not a fish');
  assert.deepEqual(suggestFromTitle('קשקוש צבעוני'), []);
  assert.deepEqual(suggestFromTitle(''), []);
  assert.deepEqual(suggestFromTitle(null), []);
});

test('at most three suggestions, none twice', () => {
  const s = suggestFromTitle('פרפר ופרפר ליד עץ ושמש וכלב וחתול');
  assert.equal(s.length, 3);
  assert.deepEqual(s.map((m) => m.motion), ['fly', 'sway', 'spin']);
});

test('movements from the naming step are checked', () => {
  const ok = cleanMotions([
    { label: 'הפרפר עף', motion: 'fly', box: [0.1, 0.2, 0.3, 0.4], dir: 'none' },
    { label: 'run <script>', motion: 'fly' },
    { label: 'המכונית נוסעת', motion: 'drive', box: [0.5, 0.5, 0.9, 0.2], dir: 'left' },
    { label: 'משהו', motion: 'explode' },
    { label: 'הפרפר עף', motion: 'glide' },
    { label: 'נקודה', motion: 'spin', box: [0.5, 0.5, 0.01, 0.01] },
    'text', null,
  ]);
  assert.deepEqual(ok, [
    { label: 'הפרפר עף', motion: 'fly', box: [0.1, 0.2, 0.3, 0.4] },
    { label: 'המכונית נוסעת', motion: 'drive', box: [0.5, 0.5, 0.5, 0.2], dir: 'left' },
    { label: 'נקודה', motion: 'spin' },
  ]);
  assert.deepEqual(cleanMotions('x'), []);
  assert.equal(cleanMotions(Array.from({ length: 9 }, (_, i) => ({ label: 'דבר ' + 'אבגדהוזחט'[i], motion: 'sway' }))).length, 4);
});

test('a box follows the picture when it is turned', () => {
  const b = [0.1, 0.2, 0.3, 0.4];
  assert.deepEqual(turnBox(b, 90), [0.4, 0.1, 0.4, 0.3]);
  assert.deepEqual(turnBox(b, 180), [0.6, 0.4, 0.3, 0.4]);
  assert.deepEqual(turnBox(b, 270), [0.2, 0.6, 0.4, 0.3]);
  assert.deepEqual(turnBox(turnBox(turnBox(turnBox(b, 90), 90), 90), 90), b);
  assert.deepEqual(turnBox(turnBox(b, 90), 270), b);
  const t = turnMotions([{ label: 'א', motion: 'drive', box: b, dir: 'left' }], 180);
  assert.equal(t[0].dir, 'right');
  assert.equal(turnMotions([{ label: 'א', motion: 'drive', box: b, dir: 'left' }], 90)[0].dir, undefined);
});

test('every movement starts where the figure was drawn and closes its loop', () => {
  const f = { cx: 300, cy: 400, w: 200, h: 180 };
  for (const motion of MOTIONS) {
    for (const dir of [undefined, 'left', 'right']) {
      const a = pose(motion, 0, f, 720, 900, dir), z = pose(motion, 0.999999, f, 720, 900, dir);
      assert.ok(Math.abs(a.dx) < 1e-6 && Math.abs(a.dy) < 1e-6, `${motion} starts in place`);
      for (const k of ['dx', 'dy']) {
        const wrap = k === 'dx' ? a.wrapX || z.wrapX : a.wrapY || z.wrapY;
        const gap = Math.abs(z[k] - a[k]);
        assert.ok(gap < 0.5 || (wrap && Math.abs(gap - wrap) < 0.5), `${motion} ${k} closes (${gap})`);
      }
      const turn = Math.abs(z.rot - a.rot) % (Math.PI * 2);
      assert.ok(turn < 0.01 || Math.abs(turn - Math.PI * 2) < 0.01, `${motion} turn closes`);
      assert.ok(Math.abs(z.sx - a.sx) < 0.01 && Math.abs(z.sy - a.sy) < 0.01, `${motion} stretch closes`);
      for (let i = 0; i <= 50; i++) {
        const q = pose(motion, i / 50, f, 720, 900, dir);
        for (const v of [q.dx, q.dy, q.rot, q.sx, q.sy]) assert.ok(Number.isFinite(v));
        if (!q.wrapX && !q.wrapY) assert.ok(Math.abs(q.dx) <= 720 * 0.25 && Math.abs(q.dy) <= 900 * 0.3, `${motion} stays near`);
      }
    }
  }
});

test('a figure that goes back and forth faces the way it moves, and turns around at the ends', () => {
  const f = { cx: 360, cy: 450, w: 160, h: 120 };
  for (const motion of ['fly', 'glide', 'swim', 'walk', 'float']) {
    for (const dir of [undefined, 'right', 'left']) {
      const sign = dir === 'left' ? -1 : 1;
      for (let i = 1; i < 40; i++) {
        const p = i / 40;
        const a = pose(motion, p, f, 720, 900, dir), b = pose(motion, p + 0.002, f, 720, 900, dir);
        const v = (b.dx - a.dx) * sign; // > 0: moving the way the figure was drawn facing
        if (Math.abs(v) > 0.3) assert.equal(Math.sign(a.sx), Math.sign(v), `${motion} ${dir} at ${p} faces its way`);
      }
      assert.ok(Math.abs(pose(motion, 0.25, f, 720, 900, dir).sx) < 0.05, `${motion} turns around at the far end`);
    }
  }
  assert.equal(facing(0), 1);
  assert.equal(facing(0.5), -1);
});

test('the twinkle really glows, and the glow closes its loop', () => {
  const f = { cx: 360, cy: 450, w: 100, h: 100 };
  const glows = Array.from({ length: 81 }, (_, i) => pose('twinkle', i / 80, f, 720, 900).glow);
  assert.ok(Math.max(...glows) > 0.95);
  assert.ok(glows[0] < 1e-9 && glows[80] < 1e-9);
});

test('a touch picks the strokes of one figure', () => {
  const W = 200, H = 100;
  const d = new Uint8ClampedArray(W * H * 4).fill(255);
  const dot = (x, y) => { const i = (y * W + x) * 4; d[i] = 30; d[i + 1] = 30; d[i + 2] = 200; };
  // A figure on the left made of two strokes 5 px apart, and a separate one on the right.
  for (let y = 20; y < 60; y++) { dot(30, y); dot(36, y); }
  for (let x = 30; x < 37; x++) dot(x, 60);
  for (let y = 30; y < 50; y++) for (let x = 150; x < 170; x++) dot(x, y);
  const R = { x: 0, y: 0, w: W, h: H };
  const left = inkRegion(d, W, R, [255, 255, 255], 33, 40);
  assert.ok(left[0] <= 30 / W && left[0] + left[2] >= 37 / W, 'both strokes are in the box');
  assert.ok(left[0] + left[2] < 0.5, 'the figure on the right is not');
  const near = inkRegion(d, W, R, [255, 255, 255], 140, 40); // a touch beside the right figure
  assert.ok(near[0] >= 0.72 && near[0] <= 0.76);
  assert.equal(inkRegion(d, W, R, [255, 255, 255], 100, 95), null, 'nothing is drawn near the touch');
});
