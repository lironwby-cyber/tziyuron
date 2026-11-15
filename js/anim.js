// Short animation of a drawing, made on the device: nothing is uploaded.
// The drawing is redrawn every frame, either with a gentle movement of the whole page or with a movement that
// fits what is drawn (the figure is lifted from the page and moves on it), and can be recorded to a 5 second clip.
import { openSheet, esc, toast } from './ui.js';
import { decode } from './scan.js';
import { pose } from './motion.js';

const W = 720, H = 900, SECONDS = 5, FPS = 30;

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
 * Separate the figure that moves from the page it is drawn on.
 * On even paper the ink inside `box` (0 to 1 of the drawing; the whole drawing when there is no box) is lifted
 * into a see-through cut-out and wiped from the page behind it. When the page is not even (a photo, a painted
 * background) nothing can be lifted cleanly, so the whole picture moves as one piece.
 * Returns { cut, bg, sprite, f: {cx, cy, w, h} }.
 */
export function buildFigure(base, box) {
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
  // The colour of the paper: the middle value along the edge of the drawing.
  const ring = [[], [], []];
  const sample = (x, y) => { const i = (y * W + x) * 4; ring[0].push(d[i]); ring[1].push(d[i + 1]); ring[2].push(d[i + 2]); };
  const inset = 5;
  for (let x = R.x + inset; x < R.x + R.w - inset; x += 6) { sample(x, R.y + inset); sample(x, R.y + R.h - inset - 1); }
  for (let y = R.y + inset; y < R.y + R.h - inset; y += 6) { sample(R.x + inset, y); sample(R.x + R.w - inset - 1, y); }
  if (!ring[0].length) return whole();
  const paper = ring.map((c) => [...c].sort((a, b) => a - b)[c.length >> 1]);
  let near = 0;
  for (let i = 0; i < ring[0].length; i++) {
    if (Math.max(Math.abs(ring[0][i] - paper[0]), Math.abs(ring[1][i] - paper[1]), Math.abs(ring[2][i] - paper[2])) < 40) near++;
  }
  if (near / ring[0].length < 0.72) return whole();

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
  const pad = 3, ex0 = Math.max(0, minX - pad), ey0 = Math.max(0, minY - pad), ex1 = Math.min(W, maxX + 1 + pad), ey1 = Math.min(H, maxY + 1 + pad);
  const ew = ex1 - ex0, eh = ey1 - ey0;
  const ink = new Uint8Array(ew * eh), wide = new Uint8Array(ew * eh);
  for (let y = 0; y < sh; y++) {
    for (let x = 0; x < sw; x++) {
      const i = ((y + minY) * W + x + minX) * 4, o = (y * sw + x) * 4;
      const f = far(i);
      const a = f <= 20 ? 0 : f >= 52 ? 255 : Math.round((f - 20) / 32 * 255);
      out.data[o] = d[i]; out.data[o + 1] = d[i + 1]; out.data[o + 2] = d[i + 2]; out.data[o + 3] = a;
      if (f > 14) ink[(y + minY - ey0) * ew + x + minX - ex0] = 1;
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

/** Draw one frame of a figure that moves on its page. `m` = { motion, dir }, t in seconds. */
export function drawFigureFrame(g, fig, m, t, sparkle) {
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.globalAlpha = 1;
  g.drawImage(fig.bg, 0, 0);
  const p = (t % SECONDS) / SECONDS;
  const f = fig.f;
  const ps = pose(m.motion, p, f, W, H, m.dir);
  const bottom = ps.anchor === 'bottom';
  if (m.motion === 'jump') {
    // A soft shadow that shrinks as the figure leaves the ground.
    const lift = Math.min(1, -ps.dy / 120);
    g.fillStyle = `rgba(42,35,70,${0.14 * (1 - lift * 0.6)})`;
    g.beginPath();
    g.ellipse(f.cx, Math.min(H - 8, f.cy + f.h / 2 + 4), f.w * 0.36 * (1 - lift * 0.35), Math.max(4, f.h * 0.035), 0, 0, Math.PI * 2);
    g.fill();
  }
  const one = (ox, oy) => {
    g.save();
    g.translate(f.cx + ps.dx + ox, f.cy + (bottom ? f.h / 2 : 0) + ps.dy + oy);
    g.rotate(ps.rot);
    g.scale(ps.sx, ps.sy);
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
 * Opens the animator. Resolves {blob, style, duration} when a clip was saved, otherwise null.
 * `motions` = movements that fit this drawing ({label, motion, box, dir}); `first` = the one chosen (its place in the list).
 */
export async function openAnimator(imageBlob, title, { motions = [], first = 0 } = {}) {
  let base, sparkle;
  try { [base, sparkle] = await Promise.all([makeBase(imageBlob), loadSparkle()]); } catch { toast('לא הצלחתי לפתוח את הציור'); return null; }
  const mime = recorderMime();
  const figures = new Map();
  const figureFor = (i) => {
    if (!figures.has(i)) { try { figures.set(i, buildFigure(base, motions[i].box)); } catch { figures.set(i, null); } }
    return figures.get(i);
  };
  return openSheet((body, close) => {
    let style = motions.length ? 'm' + Math.min(Math.max(first, 0), motions.length - 1) : STYLES[0].id;
    let raf = 0, start = performance.now(), recording = false;
    body.innerHTML = `
      <h2>הנפשה של ${esc(title)}</h2>
      <div class="anim-stage"><canvas width="${W}" height="${H}" aria-label="תצוגה מקדימה של ההנפשה"></canvas></div>
      <div class="anim-styles" role="group" aria-label="סגנון תנועה" style="margin:14px 0">
        ${motions.map((m, i) => `<button type="button" class="fit" data-style="m${i}" aria-pressed="${style === 'm' + i}">${esc(m.label)}</button>`).join('')}
        ${STYLES.map((s) => `<button type="button" data-style="${s.id}" aria-pressed="${s.id === style}">${esc(s.label)}</button>`).join('')}
      </div>
      <p class="small muted" style="text-align:center;margin-bottom:12px">ההנפשה נוצרת כאן במכשיר. הציור לא נשלח לשום מקום.</p>
      <div class="btn-row" style="justify-content:space-between">
        <button type="button" class="btn ghost" data-cancel>ביטול</button>
        <button type="button" class="btn violet" data-save ${mime ? '' : 'disabled'}>${mime ? 'שמירה כסרטון של 5 שניות' : 'הדפדפן הזה לא מקליט וידאו'}</button>
      </div>`;
    const canvas = body.querySelector('canvas');
    const g = canvas.getContext('2d');
    const paint = (t) => {
      const i = style[0] === 'm' && /^m\d+$/.test(style) ? Number(style.slice(1)) : -1;
      const fig = i >= 0 ? figureFor(i) : null;
      if (fig) drawFigureFrame(g, fig, motions[i], t, sparkle);
      else drawFrame(g, base, i >= 0 ? 'float' : style, t, sparkle);
      canvas.dataset.cut = fig ? String(fig.cut) : '';
    };
    const loop = (now) => {
      paint((now - start) / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const stop = (v) => { cancelAnimationFrame(raf); close(v); };
    body.querySelector('[data-cancel]').addEventListener('click', () => { if (!recording) stop(null); });
    body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-style]');
      if (!b || recording) return;
      style = b.dataset.style;
      start = performance.now();
      body.querySelectorAll('[data-style]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    });
    body.querySelector('[data-save]').addEventListener('click', async (e) => {
      if (recording || !mime) return;
      recording = true;
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
      const i = /^m\d+$/.test(style) ? Number(style.slice(1)) : -1;
      stop({ blob, style: i >= 0 ? motions[i].motion : style, label: i >= 0 ? motions[i].label : '', duration: SECONDS });
    });
  }, { label: 'הנפשה' });
}
