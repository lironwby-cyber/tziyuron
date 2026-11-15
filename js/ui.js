// Small DOM helpers: escaping, toast, sheets and dialogs.

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function $(sel, root = document) { return root.querySelector(sel); }
export function $$(sel, root = document) { return [...root.querySelectorAll(sel)]; }

let toastTimer = null;
export function toast(msg, ms = 2600) {
  document.querySelectorAll('.toast').forEach((t) => t.remove());
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.appendChild(t);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.remove(), ms);
}

/**
 * Open a bottom sheet (or centred dialog). `render(body, close)` fills it.
 * Returns a promise that resolves with the value passed to close().
 */
export function openSheet(render, { dialog = false, label = '' } = {}) {
  return new Promise((resolve) => {
    const scrim = document.createElement('div');
    scrim.className = 'scrim' + (dialog ? ' dialog' : '');
    const sheet = document.createElement('div');
    sheet.className = 'sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-modal', 'true');
    if (label) sheet.setAttribute('aria-label', label);
    if (!dialog) sheet.innerHTML = '<div class="grabber" aria-hidden="true"></div>';
    const body = document.createElement('div');
    sheet.appendChild(body);
    scrim.appendChild(sheet);
    const prevFocus = document.activeElement;
    let closed = false;
    const close = (value) => {
      if (closed) return;
      closed = true;
      document.removeEventListener('keydown', onKey);
      scrim.remove();
      if (prevFocus && prevFocus.focus) prevFocus.focus();
      resolve(value);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(undefined); };
    document.addEventListener('keydown', onKey);
    scrim.addEventListener('click', (e) => { if (e.target === scrim) close(undefined); });
    document.body.appendChild(scrim);
    render(body, close);
    const first = sheet.querySelector('input, textarea, select, button');
    if (first && dialog) first.focus();
  });
}

/** Confirm dialog. Resolves true/false. */
export function confirmDialog(title, text, { ok = 'אישור', danger = false } = {}) {
  return openSheet((body, close) => {
    body.innerHTML = `
      <h2>${esc(title)}</h2>
      ${text ? `<p class="muted">${esc(text)}</p>` : ''}
      <div class="btn-row" style="justify-content:flex-end;margin-top:16px">
        <button class="btn" data-v="0">ביטול</button>
        <button class="btn ${danger ? 'danger' : 'primary'}" data-v="1">${esc(ok)}</button>
      </div>`;
    body.addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]');
      if (b) close(b.dataset.v === '1');
    });
  }, { dialog: true, label: title }).then((v) => !!v);
}

/** Pick files through a hidden input. Resolves to an array (empty if cancelled). */
export function pickFiles({ accept = '*/*', multiple = false, capture = null } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    if (capture) input.setAttribute('capture', capture);
    input.style.display = 'none';
    input.addEventListener('change', () => { resolve([...input.files]); input.remove(); });
    input.addEventListener('cancel', () => { resolve([]); input.remove(); });
    document.body.appendChild(input);
    input.click();
  });
}

export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function formatDuration(sec) {
  sec = Math.max(0, Math.round(sec || 0));
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

export const KID_COLORS = 6;
export const ANIMALS = ['lion', 'bunny', 'fox', 'panda', 'unicorn', 'puppy'];
/** Inline style that gives an element a child's colour pair. */
export function kidStyle(n) {
  const k = ((Number(n) || 0) % KID_COLORS + KID_COLORS) % KID_COLORS;
  return `--kid:var(--c${k});--kid-ink:var(--c${k}-ink)`;
}
/** One of the app's soft-3D pictures (art/<name>.webp). Decorative, so alt is empty. */
export function art(name, cls = '') {
  return `<img class="sprite ${cls}" src="art/${name}.webp" alt="" draggable="false">`;
}

const I = (d, extra = '') => `<svg class="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
export const ICONS = {
  search: I('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  settings: I('<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2.4"/><circle cx="8" cy="17" r="2.4"/>'),
  back: I('<path d="M9 18l6-6-6-6"/>'),
  close: I('<path d="M18 6 6 18M6 6l12 12"/>'),
  select: I('<rect x="3" y="3" width="18" height="18" rx="5"/><path d="m8 12 3 3 5-6"/>'),
  play: '<svg class="ui-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M8 5.5v13a1 1 0 0 0 1.5.86l10.5-6.5a1 1 0 0 0 0-1.72L9.5 4.64A1 1 0 0 0 8 5.5z"/></svg>',
  pause: '<svg class="ui-icon" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="6" y="5" width="4.5" height="14" rx="1.5"/><rect x="13.5" y="5" width="4.5" height="14" rx="1.5"/></svg>',
  trash: I('<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>'),
  share: I('<path d="M12 15V3M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7"/>'),
  edit: I('<path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4"/>'),
  download: I('<path d="M12 3v12M8 11l4 4 4-4M5 21h14"/>'),
  turn: I('<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>'),
  crop: I('<path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14"/>'),
  show: I('<rect x="3" y="5" width="18" height="13" rx="3"/><path d="M10 9.5v4l3.5-2-3.5-2zM8 21h8"/>'),
  compare: I('<rect x="3" y="5" width="7.5" height="14" rx="2"/><rect x="13.5" y="5" width="7.5" height="14" rx="2"/>'),
  check: I('<path d="m5 12 5 5 9-10"/>', 'stroke-width="3"'),
  plus: I('<path d="M12 5v14M5 12h14"/>', 'stroke-width="2.6"'),
  lock: I('<rect x="5" y="11" width="14" height="10" rx="2.5"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>'),
  next: I('<path d="M15 18l-6-6 6-6"/>', 'stroke-width="3"'),
  prev: I('<path d="M9 18l6-6-6-6"/>', 'stroke-width="3"'),
  erase: I('<path d="M21 6H9l-6 6 6 6h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1zM13 10l4 4M17 10l-4 4"/>'),
};
