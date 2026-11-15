// Short animation of a drawing, made on the device: nothing is uploaded.
// The drawing is redrawn every frame with a gentle movement, and can be recorded to a 5 second clip.
import { openSheet, esc, toast } from './ui.js';
import { decode } from './scan.js';

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
  return c;
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

/** Opens the animator. Resolves {blob, style, duration} when a clip was saved, otherwise null. */
export async function openAnimator(imageBlob, title) {
  let base, sparkle;
  try { [base, sparkle] = await Promise.all([makeBase(imageBlob), loadSparkle()]); } catch { toast('לא הצלחתי לפתוח את הציור'); return null; }
  const mime = recorderMime();
  return openSheet((body, close) => {
    let style = STYLES[0].id, raf = 0, start = performance.now(), recording = false;
    body.innerHTML = `
      <h2>הנפשה של ${esc(title)}</h2>
      <div class="anim-stage"><canvas width="${W}" height="${H}" aria-label="תצוגה מקדימה של ההנפשה"></canvas></div>
      <div class="anim-styles" role="group" aria-label="סגנון תנועה" style="margin:14px 0">
        ${STYLES.map((s) => `<button type="button" data-style="${s.id}" aria-pressed="${s.id === style}">${esc(s.label)}</button>`).join('')}
      </div>
      <p class="small muted" style="text-align:center;margin-bottom:12px">ההנפשה נוצרת כאן במכשיר. הציור לא נשלח לשום מקום.</p>
      <div class="btn-row" style="justify-content:space-between">
        <button type="button" class="btn ghost" data-cancel>ביטול</button>
        <button type="button" class="btn violet" data-save ${mime ? '' : 'disabled'}>${mime ? 'שמירה כסרטון של 5 שניות' : 'הדפדפן הזה לא מקליט וידאו'}</button>
      </div>`;
    const canvas = body.querySelector('canvas');
    const g = canvas.getContext('2d');
    const loop = (now) => {
      drawFrame(g, base, style, (now - start) / 1000, sparkle);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const stop = (v) => { cancelAnimationFrame(raf); close(v); };
    body.querySelector('[data-cancel]').addEventListener('click', () => { if (!recording) stop(null); });
    body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-style]');
      if (!b || recording) return;
      style = b.dataset.style;
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
      stop({ blob, style, duration: SECONDS });
    });
  }, { label: 'הנפשה' });
}
