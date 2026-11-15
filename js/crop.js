// Manual crop editor: drag the four corners of the sheet. Resolves {corners, clean} or null.
import { openSheet, esc } from './ui.js';
import { sizeOf } from './scan.js';
import { fullFrame } from './image.js';

export function openCropEditor({ url, source, corners, detected, clean }) {
  const { width: W, height: H } = sizeOf(source);
  let pts = corners.map((c) => ({ ...c }));
  return openSheet((body, close) => {
    const r = Math.max(W, H) * 0.022;
    body.innerHTML = `
      <h2>חיתוך ויישור</h2>
      <p class="muted small">גוררים את ארבע הנקודות לפינות הדף.</p>
      <div class="crop-wrap" style="max-width:${Math.round(Math.min(520, 520 * W / H))}px">
        <img src="${esc(url)}" alt="הצילום המקורי">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-label="פינות החיתוך">
          <polygon></polygon>
          ${[0, 1, 2, 3].map((i) => `<circle class="handle" data-i="${i}" r="${r}" tabindex="0" role="slider" aria-label="פינה ${i + 1}"></circle>`).join('')}
        </svg>
      </div>
      <div class="btn-row" style="margin:10px 0">
        <button class="btn" data-act="auto" ${detected ? '' : 'disabled'}>זיהוי אוטומטי</button>
        <button class="btn" data-act="full">כל התמונה</button>
      </div>
      <label class="switch"><input type="checkbox" ${clean ? 'checked' : ''} data-clean> ניקוי רקע (הדף הופך לבן נקי)</label>
      <div class="btn-row" style="justify-content:flex-end;margin-top:12px">
        <button class="btn" data-act="cancel">ביטול</button>
        <button class="btn primary" data-act="ok">אישור</button>
      </div>`;
    const svg = body.querySelector('svg');
    const poly = svg.querySelector('polygon');
    const handles = [...svg.querySelectorAll('.handle')];
    const paint = () => {
      poly.setAttribute('points', pts.map((p) => `${p.x},${p.y}`).join(' '));
      handles.forEach((h, i) => { h.setAttribute('cx', pts[i].x); h.setAttribute('cy', pts[i].y); });
    };
    paint();

    const toLocal = (e) => {
      const rect = svg.getBoundingClientRect();
      return {
        x: Math.min(Math.max(((e.clientX - rect.left) / rect.width) * W, 0), W - 1),
        y: Math.min(Math.max(((e.clientY - rect.top) / rect.height) * H, 0), H - 1),
      };
    };
    let drag = -1;
    svg.addEventListener('pointerdown', (e) => {
      const h = e.target.closest('.handle');
      if (h) drag = Number(h.dataset.i);
      else {
        // Grab the nearest corner so small handles are easy to catch on a phone.
        const p = toLocal(e);
        let best = Infinity;
        pts.forEach((q, i) => { const d = Math.hypot(q.x - p.x, q.y - p.y); if (d < best) { best = d; drag = i; } });
      }
      svg.setPointerCapture(e.pointerId);
      pts[drag] = toLocal(e);
      paint();
    });
    svg.addEventListener('pointermove', (e) => { if (drag >= 0) { pts[drag] = toLocal(e); paint(); } });
    const end = () => { drag = -1; };
    svg.addEventListener('pointerup', end);
    svg.addEventListener('pointercancel', end);
    svg.addEventListener('keydown', (e) => {
      const h = e.target.closest('.handle');
      if (!h) return;
      const i = Number(h.dataset.i), step = Math.max(W, H) / 100;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!d) return;
      e.preventDefault();
      pts[i] = { x: Math.min(Math.max(pts[i].x + d[0], 0), W - 1), y: Math.min(Math.max(pts[i].y + d[1], 0), H - 1) };
      paint();
    });

    body.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'auto' && detected) { pts = detected.map((c) => ({ ...c })); paint(); }
      if (act === 'full') { pts = fullFrame(W, H); paint(); }
      if (act === 'cancel') close(null);
      if (act === 'ok') close({ corners: pts, clean: body.querySelector('[data-clean]').checked });
    });
  }, { label: 'חיתוך ויישור' });
}
