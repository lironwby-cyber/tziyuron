// Short animation of a drawing, made on the device: nothing is uploaded.
// The drawing is redrawn every frame, either with a gentle movement of the whole page or with a movement that
// fits what is drawn (the figure is lifted from the page and moves on it), and can be recorded to a 5 second clip.
import { openSheet, esc, toast } from './ui.js';
import { decode } from './scan.js';
import { pose, inkRegion, DIRECTED } from './motion.js';
import { playFx, soundOn, setSound, stopAll, FX } from './sfx.js';

const SECONDS = 5, FPS = 30;

/** The stage follows the drawing: wide for a wide drawing, tall for a tall one, square in between. */
export function stageSize(w, h) {
  const r = w / h;
  if (r > 1.15) return { W: 900, H: 720 };
  if (r < 0.87) return { W: 720, H: 900 };
  return { W: 810, H: 810 };
}

export const STYLES = [
  { id: 'boil', label: 'קווים חיים' },
  { id: 'wobble', label: 'מתנדנד' },
  { id: 'float', label: 'מרחף' },
  { id: 'breathe', label: 'נושם' },
];

/** Tiny deterministic noise, so a recording looks the same as the preview. */
function noise(i, seed) {
  const x = Math.sin(i * 127.1 + seed * 311.7) * 43758.5453;
  return (x - Math.floor(x)) * 2 - 1;
}

/** Draw one frame. `base` is a W×H canvas holding the drawing on white. t in seconds. */
export function drawFrame(g, base, style, t, sparkle) {
  const W = base.width, H = base.height;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#fff';
  g.fillRect(0, 0, W, H);
  const loop = (t % SECONDS) / SECONDS * Math.PI * 2; // every motion closes after SECONDS
  if (style === 'wobble' || style === 'boil') {
    const strip = style === 'boil' ? 10 : 6;
    const step = Math.floor(t * 8); // boil changes 8 times a second, like hand-drawn film
    g.save();
    g.translate(W / 2, H / 2);
    g.rotate(Math.sin(loop) * (style === 'boil' ? 0.006 : 0.02));
    g.translate(-W / 2, -H / 2);
    for (let y = 0, i = 0; y < H; y += strip, i++) {
      const dx = style === 'boil'
        ? noise(i >> 1, step) * 2.2 + Math.sin(loop * 2 + y * 0.01) * 1.5
        : Math.sin(loop * 2 + y * 0.012) * 9;
      const dy = style === 'boil' ? noise(i >> 2, step + 50) * 1.2 : 0;
      g.drawImage(base, 0, y, W, strip, dx, y + dy, W, strip + 1);
    }
    g.restore();
  } else {
    const s = style === 'breathe' ? 1 + Math.sin(loop) * 0.035 : 0.94;
    const dy = style === 'float' ? Math.sin(loop) * 18 : 0;
    const rot = Math.sin(loop + 1) * (style === 'float' ? 0.035 : 0.012);
    if (style === 'float') {
      g.fillStyle = 'rgba(42,35,70,.10)';
      g.beginPath();
      g.ellipse(W / 2, H - 34, W * 0.3 * (1 - dy / 120), 14, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.save();
    g.translate(W / 2, H / 2 + dy);
    g.rotate(rot);
    g.scale(s, s);
    g.drawImage(base, -W / 2, -H / 2);
    g.restore();
  }
  if (sparkle) {
    for (let k = 0; k < 5; k++) {
      const ph = (t / SECONDS + k / 5) % 1;
      const a = Math.sin(ph * Math.PI);
      const size = 46 + 30 * a;
      const x = W * (0.12 + 0.76 * ((k * 0.37 + 0.11) % 1));
      const y = H * (0.1 + 0.8 * ((k * 0.61 + 0.23) % 1)) - ph * 30;
      g.globalAlpha = a * 0.9;
      g.drawImage(sparkle, x - size / 2, y - size / 2, size, size);
    }
    g.globalAlpha = 1;
  }
}

async function makeBase(blob) {
  const src = await decode(blob);
  const { W, H } = stageSize(src.width, src.height);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, W, H);
  const pad = 40;
  const k = Math.min((W - pad * 2) / src.width, (H - pad * 2) / src.height);
  const w = src.width * k, h = src.height * k;
  g.drawImage(src, (W - w) / 2, (H - h) / 2, w, h);
  if (src.close) src.close();
  c.rect = { x: Math.round((W - w) / 2), y: Math.round((H - h) / 2), w: Math.round(w), h: Math.round(h) }; // where the drawing sits on the stage
  return c;
}

/**
 * The colour of the paper: the middle value along the edge of the drawing. Null when the edge is not even
 * (a photo, a painted background), so nothing can be lifted cleanly from it.
 */
function paperOf(d, W, R) {
  const ring = [[], [], []];
  const sample = (x, y) => { const i = (y * W + x) * 4; ring[0].push(d[i]); ring[1].push(d[i + 1]); ring[2].push(d[i + 2]); };
  const inset = 5;
  for (let x = R.x + inset; x < R.x + R.w - inset; x += 6) { sample(x, R.y + inset); sample(x, R.y + R.h - inset - 1); }
  for (let y = R.y + inset; y < R.y + R.h - inset; y += 6) { sample(R.x + inset, y); sample(R.x + R.w - inset - 1, y); }
  if (!ring[0].length) return null;
  const paper = ring.map((c) => [...c].sort((a, b) => a - b)[c.length >> 1]);
  let near = 0;
  for (let i = 0; i < ring[0].length; i++) {
    if (Math.max(Math.abs(ring[0][i] - paper[0]), Math.abs(ring[1][i] - paper[1]), Math.abs(ring[2][i] - paper[2])) < 40) near++;
  }
  return near / ring[0].length < 0.72 ? null : paper;
}

/** The box (0 to 1 of the drawing) of the figure a finger touched at (x, y) on the stage, or null. */
export function figureAt(base, x, y) {
  const W = base.width, H = base.height;
  const R = base.rect || { x: 0, y: 0, w: W, h: H };
  if (x < R.x || y < R.y || x >= R.x + R.w || y >= R.y + R.h) return null;
  const d = base.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
  const paper = paperOf(d, W, R);
  if (!paper) return null;
  return inkRegion(d, W, R, paper, Math.round(x), Math.round(y));
}

/**
 * Separate the figure that moves from the page it is drawn on.
 * On even paper the ink inside `box` (0 to 1 of the drawing; the whole drawing when there is no box) is lifted
 * into a see-through cut-out and wiped from the page behind it. When the page is not even (a photo, a painted
 * background) nothing can be lifted cleanly, so the whole picture moves as one piece.
 * Returns { cut, bg, sprite, f: {cx, cy, w, h} }.
 */
export function buildFigure(base, box) {
  const W = base.width, H = base.height;
  const R = base.rect || { x: 0, y: 0, w: W, h: H };
  const g = base.getContext('2d', { willReadFrequently: true });
  const img = g.getImageData(0, 0, W, H);
  const d = img.data;
  const whole = () => {
    const sprite = document.createElement('canvas');
    const k = 0.86;
    sprite.width = Math.round(R.w * k); sprite.height = Math.round(R.h * k);
    sprite.getContext('2d').drawImage(base, R.x, R.y, R.w, R.h, 0, 0, sprite.width, sprite.height);
    const bg = document.createElement('canvas');
    bg.width = W; bg.height = H;
    const bgg = bg.getContext('2d');
    bgg.fillStyle = '#fff';
    bgg.fillRect(0, 0, W, H);
    return { cut: false, bg, sprite, f: { cx: R.x + R.w / 2, cy: R.y + R.h / 2, w: sprite.width, h: sprite.height } };
  };
  const paper = paperOf(d, W, R);
  if (!paper) return whole();

  const b = box || [0, 0, 1, 1];
  const grow = box ? 0.02 : 0;
  const x0 = Math.max(R.x, Math.floor(R.x + (b[0] - grow) * R.w)), y0 = Math.max(R.y, Math.floor(R.y + (b[1] - grow) * R.h));
  const x1 = Math.min(R.x + R.w, Math.ceil(R.x + (b[0] + b[2] + grow) * R.w)), y1 = Math.min(R.y + R.h, Math.ceil(R.y + (b[1] + b[3] + grow) * R.h));
  const far = (i) => Math.max(Math.abs(d[i] - paper[0]), Math.abs(d[i + 1] - paper[1]), Math.abs(d[i + 2] - paper[2]));
  let minX = x1, minY = y1, maxX = x0 - 1, maxY = y0 - 1;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      if (far((y * W + x) * 4) > 48) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
  }
  if (maxX - minX < 8 || maxY - minY < 8) return whole();
  const sw = maxX - minX + 1, sh = maxY - minY + 1;
  const sprite = document.createElement('canvas');
  sprite.width = sw; sprite.height = sh;
  const sg = sprite.getContext('2d');
  const out = sg.createImageData(sw, sh);
  // The page behind the figure is wiped a little wider than the ink, so that no pale outline stays behind.
  const pad = 6, ex0 = Math.max(0, minX - pad), ey0 = Math.max(0, minY - pad), ex1 = Math.min(W, maxX + 1 + pad), ey1 = Math.min(H, maxY + 1 + pad);
  const ew = ex1 - ex0, eh = ey1 - ey0;
  const ink = new Uint8Array(ew * eh), wide = new Uint8Array(ew * eh);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = ((y + minY) * W + x + minX) * 4, o = (y * sw + x) * 4;
      const f = far(i);
      const a = f <= 20 ? 0 : f >= 52 ? 255 : Math.round((f - 20) / 32 * 255);
      out.data[o] = d[i]; out.data[o + 1] = d[i + 1]; out.data[o + 2] = d[i + 2]; out.data[o + 3] = a;
      if (f > 10) ink[(y + minY - ey0) * ew + x + minX - ex0] = 1;
    }
  }
  for (let y = 0; y < eh; y++) {
    for (let x = 0; x < ew; x++) {
      if (!ink[y * ew + x]) continue;
      for (let k = Math.max(0, x - pad); k <= Math.min(ew - 1, x + pad); k++) wide[y * ew + k] = 1;
    }
  }
  for (let x = 0; x < ew; x++) {
    for (let y = 0; y < eh; y++) {
      if (!wide[y * ew + x]) continue;
      for (let k = Math.max(0, y - pad); k <= Math.min(eh - 1, y + pad); k++) {
        const i = ((k + ey0) * W + x + ex0) * 4;
        d[i] = paper[0]; d[i + 1] = paper[1]; d[i + 2] = paper[2];
      }
    }
  }
  sg.putImageData(out, 0, 0);
  const bg = document.createElement('canvas');
  bg.width = W; bg.height = H;
  bg.getContext('2d').putImageData(img, 0, 0);
  return { cut: true, bg, sprite, f: { cx: minX + sw / 2, cy: minY + sh / 2, w: sw, h: sh } };
}

// What is around the figure, by its movement: sky for what flies, water for what swims, a road for what drives.
const SCENES = { fly: 'sky', glide: 'sky', rise: 'sky', swim: 'water', float: 'water', drive: 'road', walk: 'ground', jump: 'ground', sway: 'wind', spin: 'stars', twinkle: 'stars', fall: 'ground' };
export function sceneOf(motion) { return SCENES[motion] || ''; }

/** A soft backdrop behind the moving figure. Every element is placed by the moment p of the loop, so the loop closes. */
function drawScene(g, scene, p, f, W, H, sign, pass) {
  const T = Math.PI * 2;
  g.save();
  if (scene === 'sky') {
    g.fillStyle = 'rgba(150, 196, 240, .30)';
    for (let k = 0; k < 4; k++) {
      const speed = k % 2 ? 1 : 2; // whole passes per loop
      const x = ((((k * 0.29 + 0.1) - p * speed * sign) % 1) + 1) % 1 * (W + 240) - 120;
      const y = H * (0.1 + 0.2 * k) + Math.sin(T * p + k) * 6;
      const s = 0.7 + 0.15 * k;
      g.beginPath(); // one path for the whole cloud, so the puffs do not darken where they overlap
      for (const [ox, oy, r] of [[0, 0, 34], [32, -14, 40], [66, 2, 30], [30, 12, 34]]) {
        g.moveTo(x + ox * s + r * s, y + oy * s);
        g.arc(x + ox * s, y + oy * s, r * s, 0, T);
      }
      g.fill();
    }
  } else if (scene === 'water') {
    g.strokeStyle = 'rgba(60, 140, 220, .5)';
    g.lineWidth = 3;
    for (let k = 0; k < 12; k++) {
      const speed = 1 + (k % 2);
      const q = ((k * 0.137 + p * speed) % 1);
      const y = H + 20 - q * (H + 40);
      const x = W * ((k * 0.383 + 0.07) % 1) + Math.sin(T * (q * 3 + k * 0.2)) * 10;
      const r = 6 + (k % 4) * 3;
      g.beginPath(); g.arc(x, y, r, 0, T); g.stroke();
    }
  } else if (scene === 'road' || scene === 'ground') {
    const y = Math.min(H - 10, f.cy + f.h / 2 + 8);
    g.strokeStyle = 'rgba(90, 80, 120, .28)';
    g.lineWidth = 4;
    g.lineCap = 'round';
    g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    if (scene === 'road') {
      const step = W / 8, shift = pass ? (p * 4 * step * -sign) % step : 0; // the road runs only under a car that drives across
      g.lineWidth = 5;
      for (let x = -step + shift; x < W + step; x += step) { g.beginPath(); g.moveTo(x, y + 14); g.lineTo(x + step * 0.45, y + 14); g.stroke(); }
    } else {
      g.strokeStyle = 'rgba(70, 150, 80, .45)';
      g.lineWidth = 3;
      for (let k = 0; k < 14; k++) {
        const x = W * ((k * 0.071 + 0.03) % 1);
        const lean = Math.sin(T * 2 * p + k) * 3;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x - 5 + lean, y - 12); g.moveTo(x, y); g.lineTo(x + 5 + lean, y - 10); g.stroke();
      }
    }
  } else if (scene === 'wind') {
    g.strokeStyle = 'rgba(110, 160, 220, .45)';
    g.lineWidth = 3;
    g.lineCap = 'round';
    for (let k = 0; k < 5; k++) {
      const x = (((k * 0.23 + p * 2) % 1)) * (W + 200) - 100;
      const y = H * (0.18 + 0.15 * k);
      g.beginPath(); g.moveTo(x, y);
      g.bezierCurveTo(x + 30, y - 12, x + 60, y + 12, x + 90, y);
      g.stroke();
    }
  } else if (scene === 'stars') {
    g.fillStyle = 'rgba(245, 185, 40, .85)';
    for (let k = 0; k < 9; k++) {
      const a = Math.max(0, Math.sin(T * (2 * p + k / 9)));
      if (a < 0.05) continue;
      const x = W * ((k * 0.317 + 0.09) % 1), y = H * ((k * 0.571 + 0.13) % 1), r = 4 + 9 * a;
      g.beginPath();
      for (let i = 0; i < 8; i++) { const ang = i * Math.PI / 4, rr = i % 2 ? r * 0.35 : r; g.lineTo(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr); }
      g.closePath(); g.fill();
    }
  }
  g.restore();
}

/**
 * Draw one frame of a figure that moves on its page. `m` = { motion, dir }, t in seconds.
 * opts.scene: the backdrop that fits the movement is drawn behind the figure (only on even paper).
 */
export function drawFigureFrame(g, fig, m, t, sparkle, { scene = false } = {}) {
  const W = fig.bg.width, H = fig.bg.height;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.drawImage(fig.bg, 0, 0);
  const p = (t % SECONDS) / SECONDS;
  const f = fig.f;
  const ps = pose(m.motion, p, f, W, H, m.dir);
  const sign = m.dir === 'left' ? -1 : 1;
  if (scene && fig.cut) drawScene(g, sceneOf(m.motion), p, f, W, H, sign, !!ps.wrapX);
  const bottom = ps.anchor === 'bottom';
  if (m.motion === 'jump') {
    // A soft shadow that shrinks as the figure leaves the ground.
    const lift = Math.min(1, -ps.dy / 120);
    g.fillStyle = `rgba(42,35,70,${0.14 * (1 - lift * 0.6)})`;
    g.beginPath();
    g.ellipse(f.cx, Math.min(H - 8, f.cy + f.h / 2 + 4), f.w * 0.36 * (1 - lift * 0.35), Math.max(4, f.h * 0.035), 0, 0, Math.PI * 2);
    g.fill();
  }
  if (ps.glow > 0.01) {
    // The light around what twinkles: a warm halo that swells and fades with the beat.
    const r = Math.max(f.w, f.h) * (0.62 + 0.18 * ps.glow);
    const halo = g.createRadialGradient(f.cx, f.cy, r * 0.15, f.cx, f.cy, r);
    halo.addColorStop(0, `rgba(255, 214, 90, ${0.55 * ps.glow})`);
    halo.addColorStop(1, 'rgba(255, 214, 90, 0)');
    g.fillStyle = halo;
    g.fillRect(f.cx - r, f.cy - r, r * 2, r * 2);
  }
  const one = (ox, oy) => {
    g.save();
    g.translate(f.cx + ps.dx + ox, f.cy + (bottom ? f.h / 2 : 0) + ps.dy + oy);
    g.rotate(ps.rot);
    g.scale(Math.abs(ps.sx) < 0.04 ? 0.04 * Math.sign(ps.sx || 1) : ps.sx, ps.sy);
    const top = bottom ? -f.h : -f.h / 2;
    if (ps.wave) {
      const strip = 6;
      for (let x = 0; x < f.w; x += strip) {
        const dy = Math.sin(Math.PI * 2 * 3 * p + x * 0.035) * Math.min(7, f.h * 0.05);
        g.drawImage(fig.sprite, x, 0, Math.min(strip, f.w - x), f.h, -f.w / 2 + x, top + dy, Math.min(strip, f.w - x) + 0.6, f.h);
      }
    } else g.drawImage(fig.sprite, -f.w / 2, top);
    g.restore();
  };
  one(0, 0);
  if (ps.wrapX) one(ps.dx > 0 ? -ps.wrapX : ps.wrapX, 0);
  if (ps.wrapY) one(0, ps.dy > 0 ? -ps.wrapY : ps.wrapY);
  if (m.motion === 'twinkle' && sparkle) {
    for (let k = 0; k < 4; k++) {
      const a = Math.max(0, Math.sin(Math.PI * 2 * (2 * p + k / 4)));
      const ang = k * 1.7 + 0.6;
      const x = f.cx + Math.cos(ang) * (f.w / 2 + 14), y = f.cy + Math.sin(ang) * (f.h / 2 + 14);
      const size = 30 + 26 * a;
      g.globalAlpha = a * 0.95;
      g.drawImage(sparkle, Math.min(W - size, Math.max(0, x - size / 2)), Math.min(H - size, Math.max(0, y - size / 2)), size, size);
    }
    g.globalAlpha = 1;
  }
}

function loadSparkle() {
  return new Promise((resolve) => {
    const im = new Image();
    im.onload = () => resolve(im);
    im.onerror = () => resolve(null);
    im.src = 'art/sparkle.webp';
  });
}

export function recorderMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  return ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m)) || '';
}

/**
 * Opens the animator. Resolves {blob, style, label, duration, fx, scene, motions, picked} when a clip was saved,
 * otherwise null. `motions` = movements that fit this drawing ({label, motion, box, dir}); `first` = the one chosen.
 * A touch on the stage picks the figure that moves; `picked` says the boxes in `motions` were set that way.
 */
export async function openAnimator(imageBlob, title, { motions = [], first = 0 } = {}) {
  let base, sparkle;
  try { [base, sparkle] = await Promise.all([makeBase(imageBlob), loadSparkle()]); } catch { toast('לא הצלחתי לפתוח את הציור'); return null; }
  const W = base.width, H = base.height;
  const mime = recorderMime();
  const list = motions.map((m) => ({ ...m }));
  const figures = new Map();
  const figureFor = (i) => {
    if (!figures.has(i)) { try { figures.set(i, buildFigure(base, list[i].box)); } catch { figures.set(i, null); } }
    return figures.get(i);
  };
  const even = (() => { try { return buildFigure(base, null).cut; } catch { return false; } })();
  let scene = true, picked = false;
  return openSheet((body, close) => {
    let style = list.length ? 'm' + Math.min(Math.max(first, 0), list.length - 1) : STYLES[0].id;
    let raf = 0, start = performance.now(), recording = false, lastLoop = -1;
    const fitIndex = () => (/^m\d+$/.test(style) ? Number(style.slice(1)) : -1);
    body.innerHTML = `
      <h2>הנפשה של ${esc(title)}</h2>
      <div class="anim-stage" style="aspect-ratio:${W} / ${H}"><canvas width="${W}" height="${H}" aria-label="תצוגה מקדימה של ההנפשה"></canvas></div>
      ${even ? '<p class="small muted anim-hint">הקישו על הדמות בציור כדי לבחור מה יזוז.</p>' : ''}
      <div class="anim-styles" role="group" aria-label="סגנון תנועה" data-chips style="margin:12px 0 10px"></div>
      <div class="anim-toggles" role="group" aria-label="תוספות">
        <button type="button" data-scene aria-pressed="true">רקע מתאים</button>
        <button type="button" data-sound aria-pressed="${soundOn()}">צליל</button>
        <button type="button" data-dir hidden>החלפת כיוון ⇄</button>
      </div>
      <p class="small muted" style="text-align:center;margin:10px 0 12px">ההנפשה נוצרת כאן במכשיר. הציור לא נשלח לשום מקום. הצליל מתנגן באפליקציה ולא נשמר בסרטון.</p>
      <div class="btn-row" style="justify-content:space-between">
        <button type="button" class="btn ghost" data-cancel>ביטול</button>
        <button type="button" class="btn violet" data-save ${mime ? '' : 'disabled'}>${mime ? 'שמירה כסרטון של 5 שניות' : 'הדפדפן הזה לא מקליט וידאו'}</button>
      </div>`;
    const canvas = body.querySelector('canvas');
    const g = canvas.getContext('2d');
    const chips = body.querySelector('[data-chips]');
    const dirBtn = body.querySelector('[data-dir]');
    const sceneBtn = body.querySelector('[data-scene]');
    const drawChips = () => {
      chips.innerHTML = `${list.map((m, i) => `<button type="button" class="fit" data-style="m${i}" aria-pressed="${style === 'm' + i}">${esc(m.label)}</button>`).join('')}
        ${STYLES.map((x) => `<button type="button" data-style="${x.id}" aria-pressed="${x.id === style}">${esc(x.label)}</button>`).join('')}`;
      const i = fitIndex();
      dirBtn.hidden = !(i >= 0 && DIRECTED.includes(list[i].motion));
      sceneBtn.hidden = !(i >= 0 && even && sceneOf(list[i].motion));
    };
    drawChips();
    const restart = () => { start = performance.now(); lastLoop = -1; stopAll(); };
    const paint = (t) => {
      const i = fitIndex();
      const fig = i >= 0 ? figureFor(i) : null;
      if (fig) drawFigureFrame(g, fig, list[i], t, sparkle, { scene });
      else drawFrame(g, base, i >= 0 ? 'float' : style, t, sparkle);
      canvas.dataset.cut = fig ? String(fig.cut) : '';
      const loop = Math.floor(t / SECONDS);
      if (loop !== lastLoop) { lastLoop = loop; if (i >= 0 && !recording) playFx(list[i].motion); }
    };
    const tick = (now) => {
      paint((now - start) / 1000);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    const stop = (v) => { cancelAnimationFrame(raf); stopAll(); close(v); };
    body.querySelector('[data-cancel]').addEventListener('click', () => { if (!recording) stop(null); });
    body.addEventListener('click', (e) => {
      if (recording) return;
      const b = e.target.closest('[data-style]');
      if (b) { style = b.dataset.style; restart(); drawChips(); return; }
      if (e.target.closest('[data-scene]')) { scene = !scene; sceneBtn.setAttribute('aria-pressed', String(scene)); return; }
      if (e.target.closest('[data-sound]')) {
        const on = !soundOn();
        setSound(on);
        e.target.closest('[data-sound]').setAttribute('aria-pressed', String(on));
        if (on) restart();
        return;
      }
      if (e.target.closest('[data-dir]')) {
        const i = fitIndex();
        if (i < 0) return;
        list[i].dir = list[i].dir === 'left' ? 'right' : 'left';
        restart();
      }
    });
    // A touch on the drawing picks the figure that moves.
    canvas.addEventListener('click', (e) => {
      if (recording || !even) return;
      const r = canvas.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width * W, y = (e.clientY - r.top) / r.height * H;
      const box = figureAt(base, x, y);
      if (!box) { toast('כאן אין ציור. אפשר להקיש על הקו של הדמות עצמה.'); return; }
      let i = fitIndex();
      if (i >= 0) list[i] = { ...list[i], box };
      else {
        list.push({ label: 'הדמות שבחרתי', motion: 'jump', box });
        i = list.length - 1;
        style = 'm' + i;
      }
      figures.delete(i);
      picked = true;
      restart();
      drawChips();
      toast('הדמות נבחרה');
    });
    body.querySelector('[data-save]').addEventListener('click', async (e) => {
      if (recording || !mime) return;
      recording = true;
      stopAll();
      const btn = e.currentTarget;
      btn.disabled = true;
      btn.textContent = 'מקליט…';
      const chunks = [];
      const stream = canvas.captureStream(FPS);
      const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
      rec.ondataavailable = (ev) => { if (ev.data && ev.data.size) chunks.push(ev.data); };
      const done = new Promise((r) => { rec.onstop = r; });
      start = performance.now(); // record exactly one loop, from its first frame
      rec.start(250);
      await new Promise((r) => setTimeout(r, SECONDS * 1000));
      rec.stop();
      await done;
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: mime.split(';')[0] });
      if (!blob.size) { toast('ההקלטה לא הצליחה'); recording = false; btn.disabled = false; btn.textContent = 'שמירה כסרטון של 5 שניות'; return; }
      const i = fitIndex();
      const m = i >= 0 ? list[i] : null;
      stop({
        blob, style: m ? m.motion : style, label: m ? m.label : '', duration: SECONDS,
        fx: m && FX.includes(m.motion) ? m.motion : '', motions: list, picked,
      });
    });
  }, { label: 'הנפשה' });
}
