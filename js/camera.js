// Full-screen camera with live sheet detection. Resolves to an array of shots:
// [{blob, width, height, corners, found}], or null when the camera is unavailable.
import { detectPaper, scaleCorners, fitScale } from './image.js';
import { canvasToBlob } from './scan.js';
import { ICONS, esc } from './ui.js';

export function cameraSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

export async function openCamera({ batch = false } = {}) {
  if (!cameraSupported()) return null;
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1920 } },
      audio: false,
    });
  } catch {
    return null;
  }

  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'camera';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-label', 'מצלמה');
    root.innerHTML = `
      <div class="camera-top">
        <button class="icon-btn" data-act="close" aria-label="סגירה">${ICONS.close}</button>
        <div class="mode-toggle" role="group" aria-label="מצב צילום">
          <button data-mode="single" aria-pressed="${!batch}">ציור אחד</button>
          <button data-mode="batch" aria-pressed="${batch}">כמה ברצף</button>
        </div>
        <button class="auto-toggle" data-act="auto" aria-pressed="true">אוטומטי</button>
      </div>
      <div class="camera-view">
        <video playsinline muted autoplay></video>
        <canvas></canvas>
        <div class="flash"></div>
        <div class="cam-hint"><span>מכוונים אל הדף</span></div>
      </div>
      <div class="camera-bottom">
        <div class="cam-side"><button class="cam-thumb" data-act="done" aria-label="סיום" hidden></button></div>
        <button class="shutter" data-act="shoot" aria-label="צילום"></button>
        <div class="cam-side"><button class="btn sunny" data-act="done-text" hidden>סיום</button></div>
      </div>`;
    document.body.appendChild(root);

    const video = root.querySelector('video');
    const overlay = root.querySelector('canvas');
    const og = overlay.getContext('2d');
    const flash = root.querySelector('.flash');
    const hint = root.querySelector('.cam-hint span');
    const thumbBtn = root.querySelector('[data-act="done"]');
    const doneText = root.querySelector('[data-act="done-text"]');
    const shots = [];
    let mode = batch ? 'batch' : 'single';
    let corners = null, found = false, timer = 0, closed = false;
    const shutter = root.querySelector('.shutter');
    const autoBtn = root.querySelector('[data-act="auto"]');
    // Auto capture: shoot by itself once the sheet is found and held still.
    let auto = true, armed = true, busy = false;
    let anchor = null, stableSince = 0, missing = 0, shotSig = null, shotCorners = null;
    const HOLD_MS = 900;
    const diag = () => Math.hypot(video.videoWidth, video.videoHeight) || 1;
    const maxMove = (a, b) => Math.max(...a.map((p, i) => Math.hypot(p.x - b[i].x, p.y - b[i].y))) / diag();
    /** 8×8 brightness signature of the probe frame: tells a new drawing from the one just shot. */
    const signature = (id) => {
      const sig = new Float32Array(64), w = id.width, h = id.height, d = id.data;
      for (let gy = 0; gy < 8; gy++) for (let gx = 0; gx < 8; gx++) {
        const x = Math.floor((gx + 0.5) * w / 8), y = Math.floor((gy + 0.5) * h / 8);
        let sum = 0, n = 0;
        for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
          const i = ((y + dy) * w + x + dx) * 4;
          if (i >= 0 && i + 2 < d.length) { sum += d[i] + d[i + 1] + d[i + 2]; n++; }
        }
        sig[gy * 8 + gx] = sum / (n * 3 || 1);
      }
      return sig;
    };
    const sigDiff = (a, b) => { let t = 0; for (let i = 0; i < 64; i++) t += Math.abs(a[i] - b[i]); return t / 64; };
    const setProgress = (p) => shutter.style.setProperty('--p', String(Math.max(0, Math.min(1, p))));
    const say = (text, ok = false) => { if (hint.textContent !== text) hint.textContent = text; hint.classList.toggle('ok', ok); };
    const probe = document.createElement('canvas');
    const pg = probe.getContext('2d', { willReadFrequently: true });

    video.srcObject = stream;
    video.play().catch(() => {});

    const finish = (value) => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      root.remove();
      resolve(value);
    };

    // Map video pixel coords to the overlay (video uses object-fit: contain).
    const layout = () => {
      const r = overlay.getBoundingClientRect();
      overlay.width = r.width * devicePixelRatio;
      overlay.height = r.height * devicePixelRatio;
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) return null;
      const s = Math.min(overlay.width / vw, overlay.height / vh);
      return { s, ox: (overlay.width - vw * s) / 2, oy: (overlay.height - vh * s) / 2 };
    };

    const tick = () => {
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh) return;
      const f = fitScale(vw, vh, 320);
      probe.width = Math.round(vw * f);
      probe.height = Math.round(vh * f);
      pg.drawImage(video, 0, 0, probe.width, probe.height);
      const id = pg.getImageData(0, 0, probe.width, probe.height);
      const res = detectPaper({ data: id.data, width: id.width, height: id.height });
      found = res.found;
      corners = scaleCorners(res.corners, 1 / f);
      const L = layout();
      og.clearRect(0, 0, overlay.width, overlay.height);
      // Re-arm after a shot only when the sheet left, moved, or a different drawing is in view.
      if (!armed) {
        missing = found ? 0 : missing + 1;
        const sig = signature(id);
        if (missing >= 2 || (found && shotCorners && maxMove(corners, shotCorners) > 0.08) || (shotSig && sigDiff(sig, shotSig) > 14)) {
          armed = true; anchor = null; stableSince = 0;
        }
      }
      if (!L || !found) {
        anchor = null; stableSince = 0; setProgress(0);
        say(armed || !auto ? 'מכוונים אל הדף' : 'מחליפים לציור הבא');
        return;
      }
      if (auto && armed && !busy) {
        const now = performance.now();
        if (!anchor || maxMove(corners, anchor) > 0.015) { anchor = corners; stableSince = now; }
        const held = now - stableSince;
        setProgress(held / HOLD_MS);
        say('מצוין, לא לזוז', true);
        if (held >= HOLD_MS) { shotSig = signature(id); shoot(true); }
      } else if (auto && !armed) {
        setProgress(0);
        say('צולם. מחליפים לציור הבא', true);
      } else {
        setProgress(0);
        say('הדף זוהה. אפשר לצלם', true);
      }
      og.lineWidth = 4 * devicePixelRatio;
      og.strokeStyle = '#ffffff';
      og.fillStyle = 'rgba(255,201,74,.22)';
      og.beginPath();
      corners.forEach((c, i) => {
        const x = L.ox + c.x * L.s, y = L.oy + c.y * L.s;
        if (i) og.lineTo(x, y); else og.moveTo(x, y);
      });
      og.closePath();
      og.fill();
      og.stroke();
      // Corner marks
      og.strokeStyle = '#ffc94a';
      og.lineWidth = 6 * devicePixelRatio;
      for (let i = 0; i < 4; i++) {
        const c = corners[i], p = corners[(i + 3) % 4], n = corners[(i + 1) % 4];
        const cx = L.ox + c.x * L.s, cy = L.oy + c.y * L.s;
        const seg = (o) => {
          const dx = (o.x - c.x) * L.s, dy = (o.y - c.y) * L.s, len = Math.hypot(dx, dy) || 1;
          const k = Math.min(28 * devicePixelRatio, len / 3) / len;
          og.beginPath(); og.moveTo(cx, cy); og.lineTo(cx + dx * k, cy + dy * k); og.stroke();
        };
        seg(p); seg(n);
      }
    };
    timer = setInterval(tick, 160);

    const shoot = async (byAuto = false) => {
      const vw = video.videoWidth, vh = video.videoHeight;
      if (!vw || !vh || busy) return;
      busy = true;
      armed = false; anchor = null; stableSince = 0; missing = 0;
      shotCorners = corners && found ? corners : null;
      if (!byAuto) shotSig = null;
      setProgress(0);
      if (navigator.vibrate) { try { navigator.vibrate(30); } catch { /* ignore */ } }
      const c = document.createElement('canvas');
      c.width = vw; c.height = vh;
      c.getContext('2d').drawImage(video, 0, 0);
      flash.classList.remove('on'); void flash.offsetWidth; flash.classList.add('on');
      const blob = await canvasToBlob(c, 'image/jpeg', 0.92);
      shots.push({ blob, width: vw, height: vh, corners: corners && found ? corners : null, found });
      busy = false;
      if (mode === 'single') { finish(shots); return; }
      const url = URL.createObjectURL(blob);
      thumbBtn.hidden = false;
      doneText.hidden = false;
      thumbBtn.innerHTML = `<img src="${esc(url)}" alt=""><b>${shots.length}</b>`;
    };

    root.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      const m = e.target.closest('[data-mode]')?.dataset.mode;
      if (m) {
        mode = m;
        root.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === m)));
      }
      if (act === 'close') finish(shots.length ? shots : []);
      if (act === 'shoot') shoot(false);
      if (act === 'auto') {
        auto = !auto; armed = true; anchor = null; setProgress(0);
        autoBtn.setAttribute('aria-pressed', String(auto));
      }
      if (act === 'done' || act === 'done-text') finish(shots);
    });
    const onKey = (e) => { if (e.key === 'Escape') { document.removeEventListener('keydown', onKey); finish(shots); } };
    document.addEventListener('keydown', onKey);
  });
}
