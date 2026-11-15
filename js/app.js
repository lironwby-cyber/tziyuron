// ציורון: main app. Plain ES modules, no build step. Data lives on the device (IndexedDB);
// when a parent signs in, js/cloud.js keeps it in step with the family archive.
import * as db from './db.js';
import { ageAt, ageLabel, formatDate, todayStr, parseDate } from './age.js';
import { TYPES, uid, filterMemories, groupByAge, compareMemories, backupPaths, safeName, memoryBlobIds } from './model.js';
import { createZip, readZip } from './zip.js';
import { esc, $, $$, toast, openSheet, confirmDialog, pickFiles, downloadBlob, formatDuration, kidStyle, art, ANIMALS, KID_COLORS, ICONS } from './ui.js';
import { decode, detect, detectAll, fullCorners, processToCanvas, makeThumb, encodeJpeg, canvasToBlob, videoFrame, mediaDuration, drawToCanvas, turnCanvas } from './scan.js';
import { openCamera, cameraSupported } from './camera.js';
import { openCropEditor } from './crop.js';
import { recordAudio } from './recorder.js';
import { openAnimator } from './anim.js';
import * as cloud from './cloud.js';
import { suggestFromTitle, cleanMotions, turnMotions } from './motion.js';

const APP = document.getElementById('app');
const MAX_BOOK_PAGES = 250;

const state = {
  children: [],
  memories: [],
  // titleRoute: 'paid' | 'free' | 'off'. animRoute: 'ask' | 'ai' | 'local'. Kept per device.
  settings: { id: 'settings', view: 'timeline', activeChild: null, lastBackupAt: 0, backupNagDismissedAt: 0, titleRoute: 'paid', animRoute: 'ask' },
  query: '',
  selecting: false,
  selected: new Set(),
  review: null, // {items, childId, date}
  book: null, // {childId, title, ids}
};

// ---------- Blob URLs ----------
const urlCache = new Map();
async function urlFor(blobId) {
  if (!blobId) return '';
  if (urlCache.has(blobId)) return urlCache.get(blobId);
  const rec = await cloud.ensureBlob(blobId);
  if (!rec || !rec.blob) return '';
  const url = URL.createObjectURL(rec.blob);
  urlCache.set(blobId, url);
  return url;
}
function forgetUrl(blobId) {
  const u = urlCache.get(blobId);
  if (u) URL.revokeObjectURL(u);
  urlCache.delete(blobId);
}
/** Fill <img data-blob>, <audio data-blob>, <video data-blob> after render. */
async function hydrate(root = APP) {
  await Promise.all($$('[data-blob]', root).map(async (el) => {
    const url = await urlFor(el.dataset.blob);
    if (url && el.getAttribute('src') !== url) el.src = url;
  }));
  await Promise.all($$('[data-poster]', root).map(async (el) => {
    const url = await urlFor(el.dataset.poster);
    if (url) el.poster = url;
  }));
}

// ---------- Data ----------
async function load() {
  const [children, memories, settings] = await Promise.all([db.getAll('children'), db.getAll('memories'), db.get('settings', 'settings')]);
  state.children = children.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));
  state.memories = memories;
  if (settings) Object.assign(state.settings, settings);
  if (state.settings.activeChild && !childById(state.settings.activeChild)) state.settings.activeChild = null;
}
function saveSettings() { return db.put('settings', { ...state.settings }); }
function childById(id) { return state.children.find((c) => c.id === id); }
function memoryById(id) { return state.memories.find((m) => m.id === id); }

function blobRecord(blob, role, owner) {
  return { id: uid(), blob, type: blob.type || 'application/octet-stream', role, ...owner };
}

async function deleteMemories(ids) {
  const ops = [];
  for (const id of ids) {
    const m = memoryById(id);
    if (!m) continue;
    for (const b of memoryBlobIds(m)) { ops.push(['blobs', b]); forgetUrl(b); }
    ops.push(['memories', id]);
  }
  await db.delMany(ops);
  const set = new Set(ids);
  state.memories = state.memories.filter((m) => !set.has(m.id));
}

let persistAsked = false;
async function afterFirstSave() {
  if (persistAsked) return;
  persistAsked = true;
  await db.requestPersistence();
}

// ---------- Routing ----------
function route() {
  const h = location.hash.replace(/^#\/?/, '');
  const [name, id] = h.split('/');
  return { name: name || 'home', id: id ? decodeURIComponent(id) : null };
}
function go(hash, { replace = false } = {}) {
  const target = '#/' + hash;
  if (location.hash === target) { render(); return; }
  if (replace) { history.replaceState(null, '', target); render(); } else location.hash = target;
}
function back(fallback = '') {
  if (history.length > 1 && document.referrer !== undefined && state._navCount > 0) history.back();
  else go(fallback, { replace: true });
}
state._navCount = 0;
window.addEventListener('hashchange', () => { state._navCount++; render(); });

// ---------- Rendering ----------
async function render() {
  const r = route();
  if (state._stale) { state._stale = false; await load(); }
  if (r.name === 'join') { joinFamily(r.id); return; }
  let view;
  if (!state.children.length && r.name !== 'settings' && r.name !== 'child') view = renderWelcome();
  else if (r.name === 'memory') view = renderMemory(r.id);
  else if (r.name === 'settings') {
    if (r.id && r.id.startsWith('backup-')) { // back from pCloud's approval page
      const ok = r.id === 'backup-ok';
      history.replaceState(null, '', '#/settings');
      setTimeout(() => toast(ok ? 'pCloud חובר. ההעתקה מתחילה' : 'החיבור ל-pCloud לא הושלם. אפשר לנסות שוב'), 300);
      if (ok) cloud.backupSweep().catch(() => {});
      setTimeout(refreshBackup, 6000);
    }
    view = renderSettings();
  }
  else if (r.name === 'review' && state.review) view = renderReview();
  else if (r.name === 'book' && state.book) view = renderBook();
  else if (r.name === 'child') {
    // A redraw while the form is open (a sync that ended, the minute tick) must not open a second form on top.
    if (!state._childForm) openChildForm(r.id === 'new' ? null : childById(r.id));
    return;
  }
  else view = renderHome();
  APP.innerHTML = view;
  document.title = 'ציורון';
  bindCommon();
  await hydrate();
}

function header({ title = null, backTo = null, actions = '', below = '' } = {}) {
  const left = backTo !== null
    ? `<button class="icon-btn" data-nav-back="${esc(backTo)}" aria-label="חזרה">${ICONS.back}</button><div class="page-title">${esc(title || '')}</div>`
    : `<div class="wordmark">${art('pencil')}<span>ציור<i>ון</i></span></div>`;
  return `<header class="topbar"><div class="topbar-row">${left}${actions}</div>${below}</header>`;
}

function childIndex(child) {
  if (!child) return 0;
  if (Number.isInteger(child.color)) return child.color;
  return Math.max(0, state.children.indexOf(child));
}
function kidVars(child) { return kidStyle(childIndex(child)); }
function childAnimal(child) {
  if (!child) return ANIMALS[0];
  return ANIMALS.includes(child.animal) ? child.animal : ANIMALS[Math.max(0, state.children.indexOf(child)) % ANIMALS.length];
}

function avatarHtml(child, size = 44) {
  if (!child) return '';
  const inner = child.avatar
    ? `<img data-blob="${esc(child.avatar)}" alt="">`
    : `<img class="animal" src="art/av-${childAnimal(child)}.webp" alt="">`;
  return `<span class="avatar" aria-hidden="true" style="width:${size}px;height:${size}px;${kidVars(child)}">${inner}</span>`;
}

function renderWelcome() {
  return `
  <main class="welcome" style="padding:0">
    <div class="welcome-stage" aria-hidden="true">
      ${art('sun', 's-sun')}${art('rocket', 's-rocket')}${art('bucket-red', 's-b1')}${art('bucket-blue', 's-b2')}${art('pencil', 's-pencil')}
    </div>
    <div class="welcome-copy">
      <div class="wordmark" style="margin:0">${art('pencil')}<span>ציור<i>ון</i></span></div>
      <h1>כל ציור נשמר, <em>מסודר לפי ילד וגיל</em></h1>
      <p>מצלמים ציור, הדף מיושר והרקע מתנקה לבד. אפשר להוסיף את הקול של הילד שמסביר מה צייר, ולהדפיס ספר.</p>
      <button class="btn primary xl" data-go="child/new">הוספת ילד ראשון</button>
      <div class="promise">
        <span>${art('padlock')}פרטי, רק למשפחה</span>
        <span>${art('gift')}בלי הגבלת כמות</span>
      </div>
      ${cloud.signedIn() ? '' : '<button class="btn ghost" data-act="cloud-signin">כבר יש ארכיון משפחתי? כניסה</button>'}
      <button class="btn ghost" data-go="settings">שחזור מגיבוי</button>
    </div>
  </main>`;
}

function kidsStripHtml() {
  const active = state.settings.activeChild;
  return `<div class="kids" role="toolbar" aria-label="בחירת ילד">
    ${state.children.length > 1 ? `<button class="kid all" data-child="" aria-pressed="${!active}"><span class="avatar" aria-hidden="true" style="width:60px;height:60px">${art('rainbow')}</span>כולם</button>` : ''}
    ${state.children.map((c) => `<button class="kid" data-child="${esc(c.id)}" style="${kidVars(c)}" aria-pressed="${active === c.id || state.children.length === 1}">${avatarHtml(c, 60)}${esc(c.name)}</button>`).join('')}
    <button class="kid add" data-go="child/new" aria-label="הוספת ילד"><span class="avatar" aria-hidden="true" style="width:60px;height:60px">+</span>ילד חדש</button>
  </div>`;
}

function heroHtml(child, list) {
  const arts = list.filter((m) => m.type === 'artwork').length;
  const voices = list.reduce((n, m) => n + (m.type === 'voice' ? 1 : 0) + (m.attachments || []).filter((a) => a.kind === 'voice').length, 0);
  const pills = [
    `<span class="pill">${arts} ${arts === 1 ? 'ציור' : 'ציורים'}</span>`,
    voices ? `<span class="pill">${voices} ${voices === 1 ? 'הקלטה' : 'הקלטות'}</span>` : '',
  ].join('');
  if (!child) {
    return `<section class="hero" style="--kid:var(--c4);--kid-ink:var(--c4-ink)">
      <h1>הגלריה של המשפחה</h1><p>${state.children.length} ילדים, ${list.length} זיכרונות</p>
      <div class="hero-stats">${pills}</div>${art('rainbow', 'hero-art')}</section>`;
  }
  const age = ageLabel(ageAt(child.birthDate, todayStr()));
  return `<section class="hero" style="${kidVars(child)}">
    <h1>הציורים של ${esc(child.name)}</h1>${age ? `<p>${esc(age)}</p>` : ''}
    <div class="hero-stats">${pills}</div>
    ${art(child.avatar ? 'sun' : 'av-' + childAnimal(child), 'hero-art')}</section>`;
}

function emptyHtml(sprite, title, text) {
  return `<div class="empty">${art(sprite)}<h2>${title}</h2><p>${text}</p></div>`;
}

function renderHome() {
  if (state.children.length === 1 && !state.settings.activeChild) state.settings.activeChild = state.children[0].id;
  const active = state.settings.activeChild;
  const child = active ? childById(active) : null;
  const searching = state.query.trim().length > 0;
  const list = filterMemories(state.memories, state.children, { childId: searching ? null : active, query: state.query });
  const view = state.settings.view;
  const dense = view === 'gallery';
  let content;
  if (!list.length) {
    content = searching
      ? emptyHtml('magnifier', 'לא נמצא', `אין זיכרונות שמתאימים לחיפוש "${esc(state.query)}".`)
      : emptyHtml('splat', child ? `עוד אין כאן ציורים של ${esc(child.name)}` : 'עוד אין כאן ציורים', 'לוחצים על הכפתור האדום למטה כדי לצלם את הציור הראשון.');
  } else if (dense) {
    content = `<div class="wall dense">${list.map((m) => frameHtml(m, !child)).join('')}</div>`;
  } else if (searching) {
    content = `<section class="chapter"><div class="chapter-head"><h2>תוצאות</h2><span>${list.length} בכל הילדים</span></div>
      <div class="wall">${list.map((m) => frameHtml(m, true)).join('')}</div></section>`;
  } else {
    let groups;
    if (child) groups = groupByAge(list, child).map((g) => [g.label, g.items]);
    else {
      const byYear = new Map();
      for (const m of list) {
        const y = (m.date || '').slice(0, 4) || 'ללא תאריך';
        if (!byYear.has(y)) byYear.set(y, []);
        byYear.get(y).push(m);
      }
      groups = [...byYear];
    }
    content = groups.map(([label, items]) => `<section class="chapter">
      <div class="chapter-head"><h2 class="group-title">${esc(label)}</h2><span>${items.length} פריטים</span></div>
      <div class="wall">${items.map((m) => frameHtml(m, !child)).join('')}</div></section>`).join('');
  }

  const total = state.memories.length;
  const sinceBackup = Date.now() - (state.settings.lastBackupAt || 0);
  const nagHidden = Date.now() - (state.settings.backupNagDismissedAt || 0) < 7 * 864e5;
  const showNag = total >= 5 && sinceBackup > 30 * 864e5 && !nagHidden;
  const hasArt = list.some((m) => m.image);

  return `${header({ actions: `<button class="icon-btn" data-go="settings" aria-label="הגדרות">${ICONS.settings}</button>`, below: kidsStripHtml() })}
  <main>
    ${searching ? '' : heroHtml(child, list)}
    ${backupAlertHtml()}
    ${showNag ? `<div class="banner">${art('chest')}
      <div class="grow"><b>כדאי לגבות.</b> <span class="small">הציורים שמורים רק בטלפון הזה.</span></div>
      <button class="btn sunny" data-act="export-all">גיבוי</button>
      <button class="icon-btn flat" data-act="dismiss-nag" aria-label="לא עכשיו">${ICONS.close}</button></div>` : ''}
    <div class="toolbar">
      <label class="search">${ICONS.search}<span class="sr-only">חיפוש</span>
        <input type="search" placeholder="חיפוש בכל הזיכרונות" value="${esc(state.query)}" data-search enterkeyhint="search"></label>
      <div class="seg" role="group" aria-label="תצוגה">
        <button data-view="timeline" aria-pressed="${!dense}">לפי גיל</button>
        <button data-view="gallery" aria-pressed="${dense}">גלריה</button>
      </div>
      ${hasArt ? `<button class="icon-btn" data-act="show" aria-label="תערוכה">${ICONS.show}</button>` : ''}
      ${child && hasArt ? `<button class="icon-btn" data-act="book-child" aria-label="ספר מהציורים">${art('book')}</button>` : ''}
      ${list.length ? `<button class="icon-btn" data-act="select" aria-label="בחירה" aria-pressed="${state.selecting}">${ICONS.select}</button>` : ''}
    </div>
    ${content}
  </main>
  ${state.selecting ? selbarHtml() : `<button class="fab" data-act="add" aria-label="הוספה"><span class="plus" aria-hidden="true">+</span>ציור חדש</button>`}`;
}

function selbarHtml() {
  const n = state.selected.size;
  const dis = n ? '' : 'disabled';
  return `<div class="selbar" role="toolbar" aria-label="פעולות על הנבחרים">
    <span class="count">${n} נבחרו</span>
    <button class="btn" data-act="sel-compare" ${n === 2 ? '' : 'disabled'}>השוואה</button>
    <button class="btn" data-act="sel-book" ${dis}>ספר</button>
    <button class="btn" data-act="sel-share" ${dis}>שיתוף</button>
    <button class="btn" data-act="sel-export" ${dis}>ייצוא ZIP</button>
    <button class="btn danger" data-act="sel-delete" ${dis}>מחיקה</button>
    <button class="btn primary" data-act="sel-cancel">סיום</button>
  </div>`;
}

const TYPE_ART = { artwork: 'splat', photo: 'rainbow', video: 'ticket', voice: 'mic', milestone: 'star', note: 'pencil' };

function metaLine(m, withChild) {
  const child = childById(m.childId);
  const age = child ? ageLabel(ageAt(child.birthDate, m.date)) : '';
  return [withChild && child ? child.name : '', age || formatDate(m.date)].filter(Boolean).join(' · ');
}

function frameHtml(m, withChild) {
  const sel = state.selected.has(m.id);
  const title = m.title || TYPES[m.type]?.label || 'ללא שם';
  const atts = m.attachments || [];
  const tags = [];
  if (atts.some((a) => a.kind === 'voice')) tags.push(`<span class="tag">${art('mic')}</span>`);
  if (atts.some((a) => a.kind === 'video' || a.kind === 'animation')) tags.push(`<span class="tag">${art('ticket')}</span>`);
  if (m.type === 'voice' || m.type === 'video') tags.push(`<span class="tag time">${formatDuration(m.mediaDuration)}</span>`);
  const inner = m.thumb
    ? `<img class="art" data-blob="${esc(m.thumb)}" alt="" loading="lazy">`
    : `${art(TYPE_ART[m.type] || 'splat')}${m.caption && m.type !== 'voice' ? `<span class="quote">${esc(m.caption)}</span>` : ''}`;
  return `<button class="frame ${m.type} ${sel ? 'selected' : ''}" data-mem="${esc(m.id)}" aria-label="${esc(title)}"${state.selecting ? ` aria-pressed="${sel}"` : ''}>
    ${state.selecting ? `<span class="check" aria-hidden="true">${sel ? ICONS.check : ''}</span>` : ''}
    ${tags.length ? `<span class="tags" aria-hidden="true">${tags.join('')}</span>` : ''}
    <span class="mat ${m.type === 'photo' || m.type === 'video' ? 'photo' : ''}">${inner}</span>
    <span class="cap"><b class="title">${esc(title)}</b><span class="sub">${esc(metaLine(m, withChild))}</span></span>
  </button>`;
}

// ---------- Memory detail ----------
function voiceRowHtml(blobId, duration, delId, label) {
  const bars = Array.from({ length: 28 }, (_, i) => `<i style="height:${20 + Math.round(70 * Math.abs(Math.sin(i * 1.7 + (blobId.charCodeAt(0) || 0))))}%"></i>`).join('');
  return `<div class="voice" data-voice>
    <button class="play" data-play aria-label="${esc(label)}">${ICONS.play}</button>
    <div class="bars" aria-hidden="true">${bars}</div>
    <time>${formatDuration(duration)}</time>
    <audio preload="metadata" data-blob="${esc(blobId)}"></audio>
    ${delId ? `<button class="icon-btn" data-del-att="${esc(delId)}" aria-label="מחיקת ההקלטה">${ICONS.trash}</button>` : ''}
  </div>`;
}

function renderMemory(id) {
  const m = memoryById(id);
  if (!m) return `${header({ title: 'לא נמצא', backTo: '' })}<main>${emptyHtml('magnifier', 'הפריט לא נמצא', '')}<button class="btn" data-go="">לדף הבית</button></main>`;
  const child = childById(m.childId);
  const age = child ? ageLabel(ageAt(child.birthDate, m.date)) : '';
  let media = '';
  if (m.type === 'video' && m.media) {
    media = `<div class="stage-art"><video controls playsinline preload="metadata" data-blob="${esc(m.media)}" ${m.image ? `data-poster="${esc(m.image)}"` : ''}></video></div>`;
  } else if (m.type === 'voice' && m.media) {
    media = `<div class="empty" style="padding:8px">${art('mic')}</div><div class="voices">${voiceRowHtml(m.media, m.mediaDuration, null, 'השמעת ההקלטה')}</div>`;
  } else if (m.image) {
    media = `<div class="stage-art"><div class="mat"><img data-blob="${esc(m.image)}" data-main alt="${esc(m.title || 'ציור')}"></div>
      ${m.original && m.original !== m.image ? `<button class="btn toggle-orig" data-act="toggle-orig">הצגת המקור</button>` : ''}</div>`;
  } else {
    media = `<div class="empty" style="padding:8px">${art(TYPE_ART[m.type] || 'star')}</div>`;
  }
  const atts = m.attachments || [];
  const canAttach = m.type !== 'voice' && m.type !== 'video';
  const canAnimate = m.image && (m.type === 'artwork' || m.type === 'photo');
  return `${header({ title: child ? child.name : '', backTo: '' })}
  <main style="${kidVars(child)}">
    ${media}
    <div class="detail-head">
      <h1>${esc(m.title || TYPES[m.type]?.label || 'ללא שם')}</h1>
      <div class="chips">
        ${child ? `<span class="chip kidc">${esc(child.name)}</span>` : ''}
        ${age ? `<span class="chip">${esc(age)}</span>` : ''}
        <span class="chip sub">${esc(formatDate(m.date))}</span>
        ${m.type !== 'artwork' ? `<span class="chip">${TYPES[m.type]?.label}</span>` : ''}
        ${m.autoTitle ? '<span class="chip sub" data-auto-title>שם אוטומטי</span>' : ''}
        ${state._naming && state._naming.has(m.id) ? `<span class="chip sub" data-naming>${state._naming.get(m.id) ? 'השם יהיה מוכן בעוד כדקה' : 'מחפש שם…'}</span>` : ''}
        ${state._seeking && state._seeking.has(m.id) ? '<span class="chip sub" data-seeking>מחפש תנועות לציור…</span>' : ''}
      </div>
    </div>
    ${m.caption ? `<div class="bubble">${esc(m.caption)}</div>` : ''}
    ${atts.length ? `<div class="voices">${atts.map((a, i) => (a.kind === 'voice'
      ? voiceRowHtml(a.blob, a.duration, a.id, `השמעת הקלטה ${i + 1}`)
      : `<div class="voice video"><video controls playsinline preload="metadata" ${a.kind === 'animation' ? 'loop' : ''} data-blob="${esc(a.blob)}"></video>
          <div class="row"><button class="icon-btn" data-del-att="${esc(a.id)}" aria-label="מחיקת הסרטון">${ICONS.trash}</button></div></div>`)).join('')}</div>` : ''}
    ${animStatusHtml(m)}
    ${canAttach ? `<div class="doers">
      <button class="doer" data-act="rec-voice">${art('mic')}הקלטת קול</button>
      <button class="doer" data-act="add-video">${art('ticket')}הוספת וידאו</button>
      ${canAnimate ? `<button class="doer" data-act="animate">${art('sparkle')}הנפשה</button>` : ''}
    </div>` : ''}
    <div class="tools">
      <button class="btn" data-act="edit">${ICONS.edit}עריכה</button>
      ${!m.title && m.image && cloud.signedIn() && (m.type === 'artwork' || m.type === 'photo') && !(state._naming && state._naming.has(m.id)) ? `<button class="btn" data-act="suggest-title">${ICONS.edit}הצעת שם</button>` : ''}
      ${m.image || m.media ? `<button class="btn" data-act="share">${ICONS.share}שיתוף</button>
      <button class="btn" data-act="download">${ICONS.download}הורדה</button>` : ''}
      ${m.image && (m.type === 'artwork' || m.type === 'photo') ? `<button class="btn" data-act="rotate">${ICONS.turn}סיבוב</button>` : ''}
      ${m.image && m.original && m.type === 'artwork' ? `<button class="btn" data-act="recrop">${ICONS.crop}חיתוך מחדש</button>` : ''}
      <button class="btn danger" data-act="delete">${ICONS.trash}מחיקה</button>
    </div>
  </main>`;
}

// ---------- Review (after capture) ----------
function renderReview() {
  const r = state.review;
  const ready = r.items.filter((i) => i.status === 'ready').length;
  const busy = r.items.some((i) => i.status === 'processing');
  const photos = r.items.every((i) => i.mode === 'photo');
  const many = r.items.length > 1;
  return `${header({ title: many ? `${r.items.length} ${photos ? 'תמונות' : 'ציורים'}` : photos ? 'תמונה חדשה' : 'ציור חדש', backTo: '' })}
  <main>
    <div class="panel">
      <div class="field"><label for="rv-child">של מי ${photos ? (many ? 'התמונות' : 'התמונה') : (many ? 'הציורים' : 'הציור')}?</label>
        <select id="rv-child" class="input" data-rv="child">${state.children.map((c) => `<option value="${esc(c.id)}" ${c.id === r.childId ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
      <div class="field"><label for="rv-date">תאריך</label>
        <input id="rv-date" class="input" type="date" data-rv="date" value="${esc(r.date)}" max="${todayStr()}"></div>
    </div>
    <div class="review-list">
      ${r.items.map((it, idx) => `
      <div class="review-item" data-item="${idx}">
        <div class="thumb">${it.status === 'ready' ? `<img src="${esc(it.previewUrl)}" alt="תוצאה ${idx + 1}">` : it.status === 'error' ? art('eraser') : '<div class="spinner"></div>'}</div>
        <div class="grow">
          ${it.status === 'processing' ? '<div class="processing-label"><span class="spinner"></span>מיישר ומנקה רקע…</div>' : ''}
          ${it.status === 'error' ? '<div class="small" style="color:var(--danger)">לא הצלחתי לפתוח את התמונה הזו</div>' : ''}
          ${it.status === 'ready' && it.mode === 'scan' ? (it.found
            ? `<div class="auto-note">${ICONS.check}${it.parts ? `ציור ${it.part} מתוך ${it.parts} בצילום, יושר ונחתך לבד` : 'הדף זוהה, יושר ונחתך לבד'}</div>`
            : '<div class="auto-note warn">לא זיהיתי דף, שמרתי את כל התמונה</div>') : ''}
          <input class="input" placeholder="${cloud.signedIn() ? 'שם הציור (אם ריק, יוצע שם לבד)' : 'שם הציור (לא חובה)'}" value="${esc(it.title)}" data-title="${idx}" aria-label="שם הציור ${idx + 1}">
          ${!many ? `<textarea class="input" placeholder="מה הילד סיפר על הציור? (לא חובה)" data-caption="${idx}" aria-label="כיתוב" style="min-height:60px">${esc(it.caption || '')}</textarea>` : ''}
          <div class="btn-row">
            <button class="btn" data-turn="${idx}" ${it.status !== 'ready' ? 'disabled' : ''}>${ICONS.turn}סיבוב</button>
            <button class="btn" data-crop="${idx}" ${it.status !== 'ready' ? 'disabled' : ''}>${ICONS.crop}תיקון חיתוך</button>
            <button class="btn ghost" data-remove="${idx}">הסרה</button>
          </div>
        </div>
      </div>`).join('')}
    </div>
    <div class="btn-row">
      <button class="btn" data-act="rv-more">עוד ציורים</button>
      <button class="btn primary xl" data-act="rv-save" style="flex:1" ${!ready || busy ? 'disabled' : ''}>שמירה${ready > 1 ? ` (${ready})` : ''}</button>
    </div>
  </main>`;
}

// ---------- Book ----------
function bookPages() {
  const b = state.book;
  return b.ids.map(memoryById).filter((m) => m && m.image && (!b.year || (m.date || '').slice(0, 4) === b.year));
}
function coverAvatar(child) {
  if (child && child.avatar) return `<img data-blob="${esc(child.avatar)}" alt="">`;
  return `<img class="animal" src="art/${child ? 'av-' + childAnimal(child) : 'rainbow'}.webp" alt="">`;
}
function renderBook() {
  const b = state.book;
  const child = childById(b.childId);
  const pages = bookPages();
  const years = [...new Set(b.ids.map(memoryById).filter(Boolean).map((m) => (m.date || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  const dates = pages.map((m) => m.date).filter(Boolean).sort();
  const range = dates.length ? (dates[0].slice(0, 4) === dates[dates.length - 1].slice(0, 4) ? dates[0].slice(0, 4) : `${dates[0].slice(0, 4)}–${dates[dates.length - 1].slice(0, 4)}`) : '';
  return `${header({ title: 'ספר דיגיטלי', backTo: '' })}
  <main style="${kidVars(child)}">
    <div class="panel no-print">
      <div class="panel-head">${art('book')}<div><h2>הספר של ${esc(child ? child.name : 'המשפחה')}</h2><p>${pages.length} עמודים</p></div></div>
      <div class="field"><label for="bk-title">שם הספר</label><input id="bk-title" class="input" data-book-title value="${esc(b.title)}"></div>
      ${years.length > 1 ? `<div class="field"><label for="bk-year">איזו שנה?</label>
        <select id="bk-year" class="input" data-book-year><option value="">כל השנים</option>${years.map((y) => `<option value="${y}" ${b.year === y ? 'selected' : ''}>ספר שנתי ${y}</option>`).join('')}</select></div>` : ''}
      <p class="small muted">אפשר לשנות סדר ולהסיר עמודים. הכפתור פותח את חלון ההדפסה, ומשם שומרים PDF ושולחים לכל בית דפוס.</p>
      <button class="btn primary xl block" data-act="print">הדפסה או שמירה כ-PDF</button>
    </div>
    <div class="book">
      <div class="page cover">
        <h1 data-cover-title>${esc(b.title)}</h1>
        <div class="cover-avatar">${coverAvatar(child)}</div>
        <div style="font-size:22px;font-weight:800">${esc(child ? child.name : '')}</div>
        <div class="p-sub">${esc(range)}</div>
      </div>
      ${pages.map((m, i) => `
      <div class="page">
        <div class="page-tools no-print">
          <button data-move="${i}" data-dir="-1" aria-label="הזזה אחורה" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button data-move="${i}" data-dir="1" aria-label="הזזה קדימה" ${i === pages.length - 1 ? 'disabled' : ''}>↓</button>
          <button data-unpage="${esc(m.id)}" aria-label="הסרה מהספר">✕</button>
        </div>
        <img data-blob="${esc(m.image)}" alt="${esc(m.title || '')}">
        ${m.title ? `<div class="p-title">${esc(m.title)}</div>` : ''}
        <div class="p-sub">${esc([formatDate(m.date), child ? ageLabel(ageAt(child.birthDate, m.date)) : ''].filter(Boolean).join(' · '))}</div>
        ${m.caption ? `<div class="p-cap">"${esc(m.caption)}"</div>` : ''}
        <div class="page-num">${i + 1}</div>
      </div>`).join('')}
      <div class="page cover">
        <div class="cover-avatar" style="width:30%">${coverAvatar(child)}</div>
        <div class="p-sub">נשמר באהבה בציורון</div>
      </div>
    </div>
  </main>`;
}

/** On the home screen: the owner is told while the family's uploads have no second copy, or when it stopped. */
function backupAlertHtml() {
  const b = state._backup;
  if (!cloud.signedIn() || !b || b === 'error' || !b.owner) return '';
  if (b.connected && !b.problem && !b.failed) return '';
  const text = !b.connected ? 'הגיבוי ל-pCloud עוד לא מחובר.' : b.problem ? 'הגיבוי ל-pCloud נעצר: צריך לחבר מחדש.' : 'חלק מהקבצים לא הועתקו ל-pCloud.';
  return `<div class="banner" data-backup-alert>${art('chest')}
    <div class="grow"><b>${text}</b> <span class="small">מה שהמשפחה מעלה שמור רק בארכיון המשפחתי.</span></div>
    <button class="btn sunny" data-go="settings">להגדרות</button></div>`;
}

// ---------- Settings ----------
function familyPanelHtml() {
  const u = cloud.user();
  if (!u) {
    return `<div class="panel">
      <div class="panel-head">${art('balloon')}<div><h2>שיתוף משפחתי</h2><p>כל המשפחה רואה ומוסיפה</p></div></div>
      <p class="small muted">אחרי כניסה, הציורים נשמרים גם בארכיון משפחתי פרטי. לכל ילד אפשר לצרף בני משפחה, ולכולם אותן הרשאות בדיוק.</p>
      <button class="btn sunny" data-act="cloud-signin">כניסה או חשבון חדש</button>
    </div>`;
  }
  const st = cloud.getStatus();
  const line = st.syncing ? 'מסנכרן…'
    : st.error ? st.error
    : st.pending ? `${st.pending} שינויים מחכים לשליחה`
    : st.lastSyncAt ? 'הכול מסונכרן' : 'מחובר';
  return `<div class="panel">
    <div class="panel-head">${art('balloon')}<div><h2>שיתוף משפחתי</h2><p dir="ltr" style="text-align:right">${esc(u.email || '')}</p></div></div>
    <p class="small" data-sync-line>${esc(line)}</p>
    <p class="small muted">לצירוף בן משפחה לילד: לוחצים "משפחה" ליד שם הילד ושולחים את הקישור.</p>
    <div class="btn-row">
      <button class="btn" data-act="cloud-sync">סנכרון עכשיו</button>
      <button class="btn" data-act="cloud-signout">יציאה</button>
    </div>
  </div>`;
}

// Every action that costs something has a free route beside it; the choice is made here, per device.
const TITLE_ROUTES = [
  ['paid', 'מהיר', 'מוכן תוך שניות. בתשלום לפי שימוש: פחות מעשירית אגורה לציור.'],
  ['free', 'חינם', 'דרך מנוי Claude של המשפחה, בלי תשלום נוסף. השם מוכן בעוד כדקה.'],
  ['off', 'כבוי', 'בלי שם אוטומטי. כותבים שם ידנית.'],
];
const ANIM_ROUTES = [
  ['ask', 'לשאול', 'בכל הנפשה בוחרים בין שתי האפשרויות.'],
  ['ai', 'חכמה', 'הציור מתעורר לחיים. יורד מקרדיטי Kling, מוכן תוך כמה דקות.'],
  ['local', 'במכשיר', 'חינם ומיידי. תנועה עדינה של הציור, פשוטה יותר מהנפשה חכמה.'],
];

function routesPanelHtml() {
  if (!cloud.signedIn()) return '';
  const row = (label, key, routes) => {
    const cur = routes.find((r) => r[0] === state.settings[key]) || routes[0];
    return `<div class="route">
      <b>${label}</b>
      <div class="seg" role="group" aria-label="${label}">
        ${routes.map(([v, name]) => `<button data-route="${key}" data-value="${v}" aria-pressed="${v === cur[0]}">${name}</button>`).join('')}
      </div>
      <p class="small muted" data-route-note="${key}">${esc(cur[2])}</p>
    </div>`;
  };
  return `<div class="panel">
    <div class="panel-head">${art('sparkle')}<div><h2>פעולות חכמות</h2><p>מסלול חינם ליד כל פעולה בתשלום. הבחירה נשמרת בחשבון, בכל המכשירים.</p></div></div>
    ${row('שם אוטומטי לציור', 'titleRoute', TITLE_ROUTES)}
    ${row('הנפשה', 'animRoute', ANIM_ROUTES)}
  </div>`;
}

// The automatic copy of the family archive into the owner's pCloud. The numbers come from the server.
function backupTime(at) {
  const d = new Date(at);
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${formatDate(todayStr(d))} בשעה ${hm}`;
}

/** {head, text, tone, connect, copy, disconnect} for the backup panel, from the server's status. */
function backupView(b) {
  if (b === undefined) return { head: 'בודק…', text: '', tone: '' };
  if (b === 'error') return { head: 'אי אפשר לבדוק עכשיו', text: 'אין תשובה מהשרת. הבדיקה תחזור כשתהיה רשת.', tone: 'warn' };
  if (b === null) return { head: 'עוד לא הופעל', text: 'הגיבוי האוטומטי ל-pCloud עוד לא הופעל בארכיון המשפחתי.', tone: 'warn' };
  if (!b.connected) {
    return b.owner
      ? { head: 'עוד לא מחובר', tone: 'warn', connect: 'חיבור pCloud',
        text: 'כל מה שהמשפחה מעלה יועתק אוטומטית לתיקייה "ציורון" ב-pCloud שלך, בתיקייה לכל ילד. החיבור נעשה פעם אחת, באישור שלך באתר של pCloud.' }
      : { head: 'עוד לא מחובר', tone: 'warn', text: 'מי שפתח את הארכיון המשפחתי מחבר את pCloud פעם אחת. עד אז הציורים שמורים במכשירים ובארכיון המשפחתי.' };
  }
  if (b.problem) {
    return { head: 'pCloud דחה את החיבור', tone: 'bad', connect: b.owner ? 'חיבור מחדש' : '',
      text: `${b.done} מתוך ${b.total} קבצים מגובים. ההעתקה נעצרה עד לחיבור מחדש${b.owner ? '.' : ' על ידי מי שפתח את הארכיון.'}` };
  }
  const waiting = Math.max(0, b.total - b.done - b.failed);
  const parts = [`${b.done} מתוך ${b.total} קבצים מגובים ב-pCloud.`];
  if (waiting) parts.push(waiting === 1 ? 'קובץ אחד ממתין ויועתק בדקות הקרובות.' : `${waiting} קבצים ממתינים ויועתקו בדקות הקרובות.`);
  if (b.failed) parts.push(b.failed === 1 ? 'קובץ אחד לא הועתק.' : `${b.failed} קבצים לא הועתקו.`);
  if (b.last) parts.push(`העתקה אחרונה: ${backupTime(b.last)}.`);
  const upToDate = !waiting && !b.failed;
  return {
    head: !b.total ? 'מחובר' : upToDate ? 'הגיבוי מעודכן' : b.failed ? 'חלק מהקבצים לא הועתקו' : 'מעתיק…',
    tone: upToDate ? 'good' : b.failed ? 'bad' : '',
    text: b.total ? parts.join(' ') : 'כל קובץ שיעלה לארכיון המשפחתי יועתק ל-pCloud תוך דקות.',
    copy: upToDate ? '' : b.failed ? 'ניסיון נוסף' : 'העתקה עכשיו',
    disconnect: b.owner,
  };
}

function backupPanelHtml() {
  if (!cloud.signedIn()) return '';
  const v = backupView(state._backup);
  return `<div class="panel" data-backup-panel>
    <div class="panel-head">${art('chest')}<div><h2>גיבוי אוטומטי ל-pCloud</h2><p><b class="backup-state ${v.tone || ''}" data-backup-head>${esc(v.head)}</b></p></div></div>
    <p class="small muted" data-backup-text>${esc(v.text)}</p>
    ${v.connect || v.copy || v.disconnect ? `<div class="btn-row">
      ${v.connect ? `<button class="btn sunny" data-act="backup-connect">${esc(v.connect)}</button>` : ''}
      ${v.copy ? `<button class="btn" data-act="backup-copy">${esc(v.copy)}</button>` : ''}
      ${v.disconnect ? '<button class="btn" data-act="backup-disconnect">ניתוק</button>' : ''}
    </div>` : ''}
  </div>`;
}

/** Reads the backup's state from the server and redraws the panel when it changed. */
async function refreshBackup() {
  if (!cloud.signedIn()) { state._backup = undefined; return; }
  let next;
  try { next = await cloud.backupStatus(); } catch { next = state._backup && state._backup !== 'error' ? state._backup : 'error'; }
  const changed = JSON.stringify(next) !== JSON.stringify(state._backup);
  state._backup = next;
  if (!changed) return;
  const panel = $('[data-backup-panel]');
  if (panel && route().name === 'settings') panel.outerHTML = backupPanelHtml();
  else if (route().name === 'home' && !document.querySelector('.scrim')) render();
}

function renderSettings() {
  const last = state.settings.lastBackupAt ? formatDate(todayStr(new Date(state.settings.lastBackupAt))) : 'עוד לא';
  return `${header({ title: 'הגדרות', backTo: '' })}
  <main>
    <div class="panel">
      <div class="panel-head">${art('balloon')}<div><h2>ילדים</h2><p>לכל ילד צבע, דמות וגיל משלו</p></div></div>
      ${state.children.map((c) => {
        const n = state.memories.filter((m) => m.childId === c.id).length;
        const age = ageLabel(ageAt(c.birthDate, todayStr()));
        return `<div class="list-row">${avatarHtml(c, 52)}<div class="grow"><b>${esc(c.name)}</b><div class="small muted">${esc([age, `${n} פריטים`].filter(Boolean).join(' · '))}</div></div>
          <div class="row-actions">${cloud.signedIn() ? `<button class="btn" data-family="${esc(c.id)}">משפחה</button>` : ''}<button class="btn" data-go="child/${esc(c.id)}">עריכה</button></div></div>`;
      }).join('') || '<p class="muted">אין עדיין ילדים.</p>'}
      <button class="btn" data-go="child/new">הוספת ילד</button>
    </div>
    ${familyPanelHtml()}
    ${routesPanelHtml()}
    ${backupPanelHtml()}
    <div class="panel">
      <div class="panel-head">${art('chest')}<div><h2>גיבוי לקובץ</h2><p>גיבוי אחרון: <b data-last-backup>${esc(last)}</b></p></div></div>
      <p class="small muted">${cloud.signedIn() ? 'הציורים נשמרים במכשיר וגם בארכיון המשפחתי.' : 'הציורים נשמרים רק במכשיר הזה.'} קובץ הגיבוי הוא ZIP רגיל עם תיקייה לכל ילד, כך שאפשר לפתוח אותו גם בלי האפליקציה. בטלפון נפתח תפריט השיתוף, ומשם שומרים ישר ל-Google Drive או ל-iCloud.</p>
      <div class="btn-row">
        <button class="btn sunny" data-act="export-all" ${state.memories.length || state.children.length ? '' : 'disabled'}>גיבוי עכשיו</button>
        <button class="btn" data-act="import">שחזור מגיבוי</button>
      </div>
    </div>
    <div class="panel">
      <div class="panel-head">${art('star')}<div><h2>ציורון כאפליקציה</h2><p>${isInstalled() ? 'שמור במסך הבית של המכשיר הזה' : 'סמל במסך הבית, כמו כל אפליקציה'}</p></div></div>
      <p class="small muted">לבני משפחה שמצטרפים: שולחים להם קישור הזמנה, ואחרי ההצטרפות מוצג להם ההסבר הזה לפי הטלפון שלהם.</p>
      <button class="btn" data-act="install-guide">איך שומרים במסך הבית</button>
    </div>
    <div class="panel">
      <div class="panel-head">${art('bucket-blue')}<div><h2>אחסון</h2><p>בלי הגבלת כמות</p></div></div>
      <p class="small" data-storage>בודק…</p>
      <button class="btn" data-act="persist">בקשת אחסון קבוע</button>
    </div>
    <div class="panel">
      <div class="panel-head">${art('padlock')}<div><h2>פרטיות</h2><p>${cloud.signedIn() ? 'רק המשפחה רואה' : 'הכול נשאר אצלך'}</p></div></div>
      <p class="small muted">${cloud.signedIn()
        ? 'אין פרסומות ואין מעקב. הציורים נשמרים במכשיר ובארכיון משפחתי פרטי, ורק מי שצורף לילד רואה אותו.'
        : 'אין פרסומות ואין מעקב. בלי כניסה לשיתוף המשפחתי, התמונות, ההקלטות והשמות נשארים בדפדפן במכשיר שלך, ויוצאים ממנו רק כשמשתפים או מגבים.'}</p>
      <button class="btn danger" data-act="wipe">מחיקת כל הנתונים</button>
    </div>
    <p class="small muted" style="text-align:center">ציורון · גרסה 2.7</p>
  </main>`;
}

async function fillStorage() {
  const el = $('[data-storage]');
  if (!el) return;
  const est = await db.storageEstimate();
  let persisted = false;
  try { persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false; } catch { /* ignore */ }
  const mb = (n) => (n / 1048576).toFixed(n > 1048576 * 100 ? 0 : 1);
  el.textContent = (est ? `בשימוש ${mb(est.usage || 0)} מ"ב מתוך כ-${mb(est.quota || 0)} מ"ב. ` : '')
    + (persisted ? 'האחסון מוגדר כקבוע, והדפדפן לא ימחק אותו כשחסר מקום.' : 'האחסון עוד לא מוגדר כקבוע. באייפון כדאי להוסיף את האפליקציה למסך הבית.');
}

// ---------- Events ----------
function bindCommon() {
  if (route().name === 'settings') { fillStorage(); refreshBackup(); }
}

APP.addEventListener('click', async (e) => {
  const t = e.target;
  const goEl = t.closest('[data-go]');
  if (goEl) { go(goEl.dataset.go); return; }
  const backEl = t.closest('[data-nav-back]');
  if (backEl) {
    if (route().name === 'review' && state.review) {
      if (!(await confirmDialog('לצאת בלי לשמור?', 'הציורים שצילמת עכשיו לא יישמרו.', { ok: 'יציאה', danger: true }))) return;
      discardReview();
    }
    back(backEl.dataset.navBack);
    return;
  }
  const chip = t.closest('[data-child]');
  if (chip) {
    state.settings.activeChild = chip.dataset.child || null;
    state.query = '';
    saveSettings();
    render();
    return;
  }
  const viewBtn = t.closest('[data-view]');
  if (viewBtn) { state.settings.view = viewBtn.dataset.view; saveSettings(); render(); return; }
  const mem = t.closest('[data-mem]');
  if (mem) {
    if (state.selecting) {
      const id = mem.dataset.mem;
      if (state.selected.has(id)) state.selected.delete(id); else state.selected.add(id);
      render();
    } else go('memory/' + encodeURIComponent(mem.dataset.mem));
    return;
  }
  const r = route();
  // Review screen
  if (r.name === 'review' && state.review) {
    const turn = t.closest('[data-turn]');
    if (turn) {
      const it = state.review.items[Number(turn.dataset.turn)];
      if (it && it.status === 'ready') {
        it.rot = ((it.rot || 0) + 90) % 360;
        it.status = 'processing';
        await render();
        await processQueue();
      }
      return;
    }
    const crop = t.closest('[data-crop]');
    if (crop) { await recropItem(Number(crop.dataset.crop)); return; }
    const rem = t.closest('[data-remove]');
    if (rem) {
      const it = state.review.items.splice(Number(rem.dataset.remove), 1)[0];
      if (it) releaseItem(it);
      if (!state.review.items.length) { state.review = null; back(''); return; }
      render();
      return;
    }
  }
  // Book screen
  if (r.name === 'book' && state.book) {
    const mv = t.closest('[data-move]');
    if (mv) {
      const ids = bookPages().map((m) => m.id);
      const i = Number(mv.dataset.move), j = i + Number(mv.dataset.dir);
      if (j >= 0 && j < ids.length) { [ids[i], ids[j]] = [ids[j], ids[i]]; state.book.ids = ids; render(); }
      return;
    }
    const un = t.closest('[data-unpage]');
    if (un) { state.book.ids = state.book.ids.filter((id) => id !== un.dataset.unpage); render(); return; }
  }
  // Memory detail
  const delAtt = t.closest('[data-del-att]');
  if (delAtt && r.name === 'memory') { await deleteAttachment(r.id, delAtt.dataset.delAtt); return; }

  const routeBtn = t.closest('[data-route]');
  if (routeBtn) {
    state.settings[routeBtn.dataset.route] = routeBtn.dataset.value;
    await saveSettings();
    // Kept with the account, so the phone and the computer follow the same choice.
    cloud.setPrefs({ titleRoute: state.settings.titleRoute, animRoute: state.settings.animRoute }).catch(() => {});
    render();
    return;
  }
  const fam = t.closest('[data-family]');
  if (fam) { await openFamilySheet(childById(fam.dataset.family)); return; }

  const playBtn = t.closest('[data-play]');
  if (playBtn) { togglePlay(playBtn.closest('[data-voice]')); return; }

  const act = t.closest('[data-act]')?.dataset.act;
  if (!act) return;
  await handleAction(act, r);
});

APP.addEventListener('input', (e) => {
  const t = e.target;
  if (t.matches('[data-search]')) {
    state.query = t.value;
    clearTimeout(state._searchTimer);
    state._searchTimer = setTimeout(async () => {
      const pos = t.selectionStart;
      await render();
      const s = $('[data-search]');
      if (s) { s.focus(); try { s.setSelectionRange(pos, pos); } catch { /* ignore */ } }
    }, 200);
  }
  if (t.matches('[data-title]') && state.review) state.review.items[Number(t.dataset.title)].title = t.value;
  if (t.matches('[data-caption]') && state.review) state.review.items[Number(t.dataset.caption)].caption = t.value;
  if (t.matches('[data-rv="date"]') && state.review) state.review.date = t.value;
  if (t.matches('[data-book-title]') && state.book) {
    state.book.title = t.value;
    const c = $('[data-cover-title]');
    if (c) c.textContent = t.value;
  }
});
APP.addEventListener('change', (e) => {
  const t = e.target;
  if (t.matches('[data-rv="child"]') && state.review) state.review.childId = t.value;
  if (t.matches('[data-book-year]') && state.book) { state.book.year = t.value; render(); }
});

async function handleAction(act, r) {
  switch (act) {
    case 'add': return openAddSheet();
    case 'select':
      state.selecting = !state.selecting;
      state.selected.clear();
      return render();
    case 'sel-cancel':
      state.selecting = false; state.selected.clear();
      return render();
    case 'sel-delete': {
      const n = state.selected.size;
      if (!(await confirmDialog(`למחוק ${n} פריטים?`, 'המחיקה סופית. כדאי לגבות קודם.', { ok: 'מחיקה', danger: true }))) return;
      await deleteMemories([...state.selected]);
      state.selected.clear(); state.selecting = false;
      toast('נמחק');
      return render();
    }
    case 'sel-export': return exportZip([...state.selected]);
    case 'sel-compare': return openCompare([...state.selected]);
    case 'show': return openExhibition();
    case 'sel-share': return shareMemories([...state.selected]);
    case 'sel-book': {
      const ids = [...state.selected].map(memoryById).filter((m) => m && m.image).sort((a, b) => -compareMemories(a, b)).map((m) => m.id);
      if (!ids.length) { toast('בספר אפשר לשים רק ציורים ותמונות'); return; }
      return openBook(ids);
    }
    case 'book-child': {
      const id = state.settings.activeChild;
      const ids = state.memories.filter((m) => m.childId === id && m.image && (m.type === 'artwork' || m.type === 'photo')).sort((a, b) => -compareMemories(a, b)).map((m) => m.id);
      return openBook(ids);
    }
    case 'print': return window.print();
    case 'export-all': return exportZip(null);
    case 'import': return importZip();
    case 'dismiss-nag':
      state.settings.backupNagDismissedAt = Date.now();
      await saveSettings();
      return render();
    case 'cloud-signin': return openSignIn();
    case 'join-retry': return render();
    case 'install-guide': return openInstallGuide();
    case 'backup-connect': {
      const btn = $('[data-act="backup-connect"]');
      if (btn) btn.disabled = true;
      let res;
      try { res = await cloud.backupConnect(); } catch { res = { reason: 'network' }; }
      if (res.url) { location.href = res.url; return; }
      if (btn) btn.disabled = false;
      return toast(/not configured/.test(res.reason) ? 'בשרת חסרים מפתחות האפליקציה של pCloud'
        : /only the owner/.test(res.reason) ? 'רק מי שפתח את הארכיון מחבר את הגיבוי' : 'החיבור לא התחיל. אפשר לנסות שוב');
    }
    case 'backup-copy': {
      const btn = $('[data-act="backup-copy"]');
      if (btn) btn.disabled = true;
      try { await cloud.backupSweep({ retry: true }); toast('ההעתקה התחילה'); } catch { toast('ההעתקה לא התחילה. אפשר לנסות שוב'); }
      setTimeout(refreshBackup, 5000);
      setTimeout(refreshBackup, 20000);
      if (btn) btn.disabled = false;
      return;
    }
    case 'backup-disconnect': {
      if (!(await confirmDialog('לנתק את הגיבוי ל-pCloud?', 'מה שכבר הועתק נשאר ב-pCloud. קבצים חדשים לא יועתקו עד לחיבור מחדש.', { ok: 'ניתוק' }))) return;
      try { await cloud.backupDisconnect(); } catch { toast('הניתוק לא הצליח'); }
      return refreshBackup();
    }
    case 'cloud-sync': {
      await cloud.sync();
      const st = cloud.getStatus();
      toast(st.error || 'הכול מסונכרן');
      return render();
    }
    case 'cloud-signout': {
      if (!(await confirmDialog('לצאת מהשיתוף המשפחתי?', 'הציורים נשארים במכשיר הזה. שינויים חדשים לא יישלחו עד הכניסה הבאה.', { ok: 'יציאה' }))) return;
      await cloud.signOut();
      toast('יצאת');
      return render();
    }
    case 'persist': {
      const ok = await db.requestPersistence();
      toast(ok ? 'האחסון מוגדר כקבוע' : 'הדפדפן לא אישר. באייפון: שיתוף > הוספה למסך הבית.');
      return fillStorage();
    }
    case 'wipe': {
      if (!(await confirmDialog('למחוק את כל הנתונים?', cloud.signedIn() ? 'כל הילדים, הציורים וההקלטות יימחקו מהמכשיר הזה, ותתבצע יציאה מהשיתוף המשפחתי. הארכיון המשפחתי לא נמחק.' : 'כל הילדים, הציורים וההקלטות יימחקו מהמכשיר הזה. אי אפשר לבטל.', { ok: 'מחיקת הכול', danger: true }))) return;
      await db.clearAll();
      urlCache.forEach((u) => URL.revokeObjectURL(u));
      urlCache.clear();
      state.children = []; state.memories = [];
      state.settings = { id: 'settings', view: 'timeline', activeChild: null, lastBackupAt: 0, backupNagDismissedAt: 0 };
      toast('כל הנתונים נמחקו');
      return go('', { replace: true });
    }
    case 'rv-save': return saveReview();
    case 'rv-more': return addToReview();
  }
  if (r.name === 'memory') {
    const m = memoryById(r.id);
    if (!m) return;
    switch (act) {
      case 'rec-voice': return addVoiceAttachment(m);
      case 'add-video': return addVideoAttachment(m);
      case 'edit': return openMemoryForm(m);
      case 'share': return shareMemories([m.id]);
      case 'download': return downloadMemory(m);
      case 'delete':
        if (!(await confirmDialog('למחוק את הפריט?', 'המחיקה סופית, כולל ההקלטות שעליו.', { ok: 'מחיקה', danger: true }))) return;
        await deleteMemories([m.id]);
        toast('נמחק');
        return back('');
      case 'toggle-orig': {
        const img = $('[data-main]');
        const btn = $('[data-act="toggle-orig"]');
        const showingOrig = img.dataset.blob === m.original;
        img.dataset.blob = showingOrig ? m.image : m.original;
        btn.textContent = showingOrig ? 'הצגת המקור' : 'הצגת הנקי';
        return hydrate();
      }
      case 'recrop': return recropMemory(m);
      case 'rotate': {
        if (state._turning) return;
        state._turning = true;
        try { await rotateMemory(m); } finally { state._turning = false; }
        return render();
      }
      case 'suggest-title': {
        const got = await nameDrawings([m.id], { manual: true });
        if (!got) toast('לא הצלחתי לזהות מה מצויר. אפשר לכתוב שם ב"עריכה".', 5000);
        return;
      }
      case 'animate': return chooseAnimation(m);
      case 'anim-clear': {
        const { anim, ...rest } = m;
        const updated = { ...rest, updatedAt: Date.now() };
        await db.put('memories', updated);
        delete m.anim;
        return render();
      }
    }
  }
}

// ---------- Add sheet ----------
function openAddSheet() {
  return openSheet((body, close) => {
    body.innerHTML = `
      <h2>מה מוסיפים?</h2>
      <div class="make-grid">
        <button class="make hero-make" data-k="scan">${art('tablet')}<b>סריקת ציור</b><small>מכוונים אל הדף. הוא מזוהה, מצולם, מיושר ונחתך לבד</small></button>
        <button class="make" data-k="batch">${art('sheet')}כמה ציורים ברצף<small>דף אחרי דף, בלי ללחוץ</small></button>
        <button class="make" data-k="import">${art('album')}ציורים מהגלריה<small>גם כמה ציורים בתמונה אחת</small></button>
        <button class="make" data-k="photo">${art('rainbow')}תמונה<small>כמו שהיא</small></button>
        <button class="make" data-k="video">${art('ticket')}וידאו</button>
        <button class="make" data-k="voice">${art('mic')}הקלטת קול</button>
        <button class="make" data-k="milestone">${art('star')}אבן דרך<small>"פעם ראשונה ש…"</small></button>
        <button class="make" data-k="note">${art('speech')}זיכרון כתוב<small>משפט מצחיק שנאמר</small></button>
      </div>`;
    body.addEventListener('click', (e) => {
      const k = e.target.closest('[data-k]')?.dataset.k;
      if (k) close(k);
    });
  }, { label: 'הוספה' }).then((k) => {
    if (!k) return;
    if (k === 'scan') return startScan(false);
    if (k === 'batch') return startScan(true);
    if (k === 'import') return startImport();
    if (k === 'photo') return addPhoto();
    if (k === 'video') return addVideoMemory();
    if (k === 'voice') return addVoiceMemory();
    if (k === 'milestone' || k === 'note') return openMemoryForm(null, k);
  });
}

function defaultChildId() {
  return state.settings.activeChild || (state.children[0] && state.children[0].id);
}

// ---------- Scan pipeline ----------
async function startScan(batch) {
  if (cameraSupported()) {
    const shots = await openCamera({ batch });
    if (shots === null) {
      // No camera permission or device: fall back to the system camera picker.
      const files = await pickFiles({ accept: 'image/*', multiple: batch, capture: 'environment' });
      return files.length ? startReview(files.map((f) => ({ blob: f }))) : undefined;
    }
    if (!shots.length) return;
    return startReview(shots.map((s) => ({ blob: s.blob, hint: s.corners })));
  }
  const files = await pickFiles({ accept: 'image/*', multiple: batch, capture: 'environment' });
  if (files.length) return startReview(files.map((f) => ({ blob: f })));
}

async function startImport() {
  const files = await pickFiles({ accept: 'image/*', multiple: true });
  if (files.length) return startReview(files.map((f) => ({ blob: f })));
}

function newReviewItem(input) {
  return { blob: input.blob, hint: input.hint || null, corners: input.corners || null, found: !!input.found, cornersGiven: !!input.corners, detected: null,
    clean: true, title: '', caption: '', status: 'processing', previewUrl: '', processed: null, mode: 'scan' };
}

async function startReview(inputs) {
  if (!state.children.length) { toast('קודם מוסיפים ילד'); return; }
  state.review = { items: inputs.map(newReviewItem), childId: defaultChildId(), date: todayStr() };
  go('review');
  await processQueue();
}

async function addToReview() {
  const files = await pickFiles({ accept: 'image/*', multiple: true });
  if (!files.length || !state.review) return;
  state.review.items.push(...files.map((f) => newReviewItem({ blob: f })));
  render();
  await processQueue();
}

let processing = false;
async function processQueue() {
  if (processing) return;
  processing = true;
  try {
    while (state.review) {
      const it = state.review.items.find((i) => i.status === 'processing');
      if (!it) break;
      await processItem(it);
      if (route().name === 'review') await render();
    }
  } finally {
    processing = false;
  }
}

async function processItem(it) {
  try {
    await new Promise((r) => setTimeout(r, 30)); // let the spinner paint
    const src = await decode(it.blob);
    if (it.mode === 'photo' && !it.corners) {
      // Photos are kept as they are: no crop and no cleaning.
      it.corners = fullCorners(src);
      it.found = true;
      it.processed = it.rot ? await canvasToBlob(turnCanvas(drawToCanvas(src, 2400).canvas, it.rot), 'image/jpeg', 0.9) : await encodeJpeg(src, 2400, 0.9);
    } else {
      // A photo from the gallery may hold several drawings: each one becomes its own item.
      if (!it.corners && !it.hint && !it.splitDone && state.review) {
        it.splitDone = true;
        const all = detectAll(src);
        if (all.length > 1) {
          const idx = state.review.items.indexOf(it);
          const parts = all.map((d, n) => ({ ...newReviewItem({ blob: it.blob, corners: d.corners }), found: true, detected: d.corners, splitDone: true, part: n + 1, parts: all.length }));
          if (idx >= 0) {
            state.review.items.splice(idx, 1, ...parts);
            if (src.close) src.close();
            toast(`נמצאו ${all.length} ציורים בצילום אחד`);
            return;
          }
        }
      }
      const det = detect(src);
      it.detected = it.detected || (det.found ? det.corners : null);
      // The live camera outline is only a fallback: the full frame is detected again, more precisely.
      if (!it.corners) { it.corners = det.found ? det.corners : it.hint || fullCorners(src); it.found = det.found || !!it.hint; }
      const canvas = turnCanvas(processToCanvas(src, it.corners, { clean: it.clean }), it.rot || 0);
      it.processed = await canvasToBlob(canvas, 'image/jpeg', 0.9);
    }
    if (src.close) src.close();
    if (it.previewUrl) URL.revokeObjectURL(it.previewUrl);
    it.previewUrl = URL.createObjectURL(it.processed);
    it.status = 'ready';
  } catch (err) {
    console.error(err);
    it.status = 'error';
  }
}

async function recropItem(idx) {
  const it = state.review.items[idx];
  if (!it || it.status !== 'ready') return;
  const src = await decode(it.blob);
  const url = URL.createObjectURL(it.blob);
  const res = await openCropEditor({ url, source: src, corners: it.corners, detected: it.detected, clean: it.clean });
  URL.revokeObjectURL(url);
  if (src.close) src.close();
  if (!res) return;
  it.corners = res.corners;
  it.clean = res.clean;
  it.found = true;
  it.status = 'processing';
  await render();
  await processQueue();
}

function releaseItem(it) { if (it.previewUrl) URL.revokeObjectURL(it.previewUrl); }
function discardReview() {
  if (state.review) state.review.items.forEach(releaseItem);
  state.review = null;
}

async function saveReview() {
  const r = state.review;
  if (!r) return;
  const childId = r.childId || defaultChildId();
  const date = parseDate(r.date) ? r.date : todayStr();
  const ops = [];
  const created = [];
  const now = Date.now();
  let order = 0;
  for (const it of r.items) {
    if (it.status !== 'ready') continue;
    const id = uid();
    const src = await decode(it.processed);
    const thumb = await makeThumb(src);
    if (src.close) src.close();
    // Keep the untouched original next to the cleaned version (re-encode huge HEIC/PNG to JPEG).
    let original = it.blob;
    if (!/^image\/(jpeg|png|webp)$/.test(original.type)) {
      const s2 = await decode(it.blob);
      original = await encodeJpeg(s2, 4000, 0.92);
      if (s2.close) s2.close();
    }
    const bImage = blobRecord(it.processed, 'image', { memoryId: id });
    const bOrig = blobRecord(original, 'original', { memoryId: id });
    const bThumb = blobRecord(thumb, 'thumb', { memoryId: id });
    const m = {
      id, childId, type: it.mode === 'photo' ? 'photo' : 'artwork', title: it.title.trim(), caption: (it.caption || '').trim(), date,
      createdAt: now + order++, updatedAt: now, image: bImage.id, original: bOrig.id, thumb: bThumb.id,
      corners: it.corners, clean: it.clean, rot: it.rot || 0, ...(it.rot ? { rotUser: true } : {}), attachments: [],
    };
    ops.push(['blobs', bImage], ['blobs', bOrig], ['blobs', bThumb], ['memories', m]);
    created.push(m);
  }
  if (!created.length) return;
  await db.putMany(ops);
  state.memories.push(...created);
  discardReview();
  afterFirstSave();
  toast(created.length > 1 ? `${created.length} ציורים נשמרו` : 'הציור נשמר');
  nameDrawings(created.filter((m) => !m.title).map((m) => m.id));
  if (created.length === 1) go('memory/' + created[0].id, { replace: true });
  else {
    state.settings.activeChild = childId;
    saveSettings();
    go('', { replace: true });
  }
}

async function recropMemory(m) {
  const origRec = await cloud.ensureBlob(m.original);
  if (!origRec) return;
  const src = await decode(origRec.blob);
  const det = detect(src);
  const url = URL.createObjectURL(origRec.blob);
  const res = await openCropEditor({ url, source: src, corners: m.corners || (det.found ? det.corners : fullCorners(src)), detected: det.found ? det.corners : null, clean: m.clean !== false });
  URL.revokeObjectURL(url);
  if (!res) { if (src.close) src.close(); return; }
  toast('מעבד…', 1500);
  const canvas = turnCanvas(processToCanvas(src, res.corners, { clean: res.clean }), m.rot || 0);
  if (src.close) src.close();
  const processed = await canvasToBlob(canvas, 'image/jpeg', 0.9);
  const thumb = await makeThumb(canvas);
  const bImage = blobRecord(processed, 'image', { memoryId: m.id });
  const bThumb = blobRecord(thumb, 'thumb', { memoryId: m.id });
  const old = [m.image, m.thumb];
  // After a new cut the figures sit elsewhere on the page: the suggestions stay, their places do not.
  const updated = { ...m, image: bImage.id, thumb: bThumb.id, corners: res.corners, clean: res.clean, ...(m.motions ? { motions: m.motions.map(({ box, ...r }) => r) } : {}), updatedAt: Date.now() };
  await db.putMany([['blobs', bImage], ['blobs', bThumb], ['memories', updated]]);
  await db.delMany(old.map((id) => ['blobs', id]));
  old.forEach(forgetUrl);
  Object.assign(m, updated);
  render();
}

/**
 * Turn a saved drawing clockwise by a quarter turn (or by `by` degrees). A scanned drawing is rebuilt from
 * its original, so repeated turns never wear the picture down; a plain photo is turned as it is.
 * auto: the turn was suggested by the naming step, and is skipped once someone turned the drawing by hand.
 */
async function rotateMemory(m, by = 90, { auto = false } = {}) {
  by = ((Math.round(by / 90) % 4) + 4) % 4 * 90;
  if (!m || !m.image || !by || (auto && m.rotUser)) return false;
  const rot = ((m.rot || 0) + by) % 360;
  let canvas = null;
  const origRec = m.type === 'artwork' && m.original && m.corners ? await cloud.ensureBlob(m.original) : null;
  if (origRec && origRec.blob) {
    const src = await decode(origRec.blob);
    canvas = turnCanvas(processToCanvas(src, m.corners, { clean: m.clean !== false }), rot);
    if (src.close) src.close();
  } else {
    const rec = await cloud.ensureBlob(m.image);
    if (!rec || !rec.blob) return false;
    const src = await decode(rec.blob);
    canvas = turnCanvas(drawToCanvas(src, 2400).canvas, by);
    if (src.close) src.close();
  }
  const processed = await canvasToBlob(canvas, 'image/jpeg', 0.9);
  const thumb = await makeThumb(canvas);
  const bImage = blobRecord(processed, 'image', { memoryId: m.id });
  const bThumb = blobRecord(thumb, 'thumb', { memoryId: m.id });
  const old = [m.image, m.thumb];
  const { turn, ...rest } = m;
  const updated = { ...rest, image: bImage.id, thumb: bThumb.id, rot, ...(auto ? {} : { rotUser: true }), ...(m.motions ? { motions: turnMotions(m.motions, by) } : {}), updatedAt: Date.now() };
  await db.putMany([['blobs', bImage], ['blobs', bThumb], ['memories', updated]]);
  await db.delMany(old.filter(Boolean).map((id) => ['blobs', id]));
  old.forEach(forgetUrl);
  if (turn !== undefined) delete m.turn;
  Object.assign(m, updated);
  return true;
}

// ---------- Other memory types ----------
async function addPhoto() {
  if (!state.children.length) return;
  const files = await pickFiles({ accept: 'image/*', multiple: true });
  if (!files.length) return;
  state.review = {
    items: files.map((f) => ({ ...newReviewItem({ blob: f }), mode: 'photo', clean: false })),
    childId: defaultChildId(), date: todayStr(),
  };
  go('review');
  await processQueue();
}

async function videoRecords(file, memoryId) {
  let poster = null, duration = 0;
  try {
    const f = await videoFrame(file);
    duration = f.duration;
    poster = await canvasToBlob(drawToCanvas(f.canvas, 1600).canvas, 'image/jpeg', 0.85);
  } catch { /* some formats (e.g. HEVC on desktop) cannot be previewed */ }
  if (!duration) duration = await mediaDuration(file, 'video');
  return { poster, duration };
}

async function addVideoMemory() {
  const files = await pickFiles({ accept: 'video/*' });
  if (!files.length) return;
  const file = files[0];
  const details = await openMemoryForm(null, 'video', { returnOnly: true });
  if (!details) return;
  toast('שומר את הסרטון…', 1500);
  const id = uid();
  const { poster, duration } = await videoRecords(file, id);
  const ops = [];
  const bMedia = blobRecord(file, 'media', { memoryId: id });
  ops.push(['blobs', bMedia]);
  let image = null, thumb = null;
  if (poster) {
    const bPoster = blobRecord(poster, 'image', { memoryId: id });
    const src = await decode(poster);
    const bThumb = blobRecord(await makeThumb(src), 'thumb', { memoryId: id });
    if (src.close) src.close();
    ops.push(['blobs', bPoster], ['blobs', bThumb]);
    image = bPoster.id; thumb = bThumb.id;
  }
  const m = { id, ...details, type: 'video', media: bMedia.id, mediaDuration: duration, image, thumb, createdAt: Date.now(), updatedAt: Date.now(), attachments: [] };
  ops.push(['memories', m]);
  await db.putMany(ops);
  state.memories.push(m);
  afterFirstSave();
  toast('הסרטון נשמר');
  go('memory/' + id);
}

async function addVoiceMemory() {
  const rec = await recordAudio('הקלטת קול');
  if (!rec) return;
  const details = await openMemoryForm(null, 'voice', { returnOnly: true });
  if (!details) return;
  const id = uid();
  const bMedia = blobRecord(rec.blob, 'media', { memoryId: id });
  const m = { id, ...details, type: 'voice', media: bMedia.id, mediaDuration: rec.duration, createdAt: Date.now(), updatedAt: Date.now(), attachments: [] };
  await db.putMany([['blobs', bMedia], ['memories', m]]);
  state.memories.push(m);
  afterFirstSave();
  toast('ההקלטה נשמרה');
  go('memory/' + id);
}

async function addVoiceAttachment(m) {
  const rec = await recordAudio('הקלטה על הציור');
  if (!rec) return;
  const b = blobRecord(rec.blob, 'voice', { memoryId: m.id });
  const att = { id: uid(), kind: 'voice', blob: b.id, duration: rec.duration, createdAt: Date.now() };
  const updated = { ...m, attachments: [...(m.attachments || []), att], updatedAt: Date.now() };
  await db.putMany([['blobs', b], ['memories', updated]]);
  Object.assign(m, updated);
  toast('ההקלטה נוספה');
  render();
}

async function addVideoAttachment(m) {
  const files = await pickFiles({ accept: 'video/*' });
  if (!files.length) return;
  const duration = await mediaDuration(files[0], 'video');
  const b = blobRecord(files[0], 'video', { memoryId: m.id });
  const att = { id: uid(), kind: 'video', blob: b.id, duration, createdAt: Date.now() };
  const updated = { ...m, attachments: [...(m.attachments || []), att], updatedAt: Date.now() };
  await db.putMany([['blobs', b], ['memories', updated]]);
  Object.assign(m, updated);
  toast('הסרטון נוסף');
  render();
}

async function deleteAttachment(memId, attId) {
  const m = memoryById(memId);
  const att = m && (m.attachments || []).find((a) => a.id === attId);
  if (!att) return;
  if (!(await confirmDialog('למחוק את ההקלטה?', '', { ok: 'מחיקה', danger: true }))) return;
  const updated = { ...m, attachments: m.attachments.filter((a) => a.id !== attId), updatedAt: Date.now() };
  await db.putMany([['memories', updated]]);
  await db.delMany([['blobs', att.blob]]);
  forgetUrl(att.blob);
  Object.assign(m, updated);
  render();
}

/**
 * Create/edit form. For a new milestone/note it saves; with returnOnly it resolves the
 * fields ({childId, title, caption, date}) for the caller to save with media.
 */
function openMemoryForm(m, type = null, { returnOnly = false } = {}) {
  const t = m ? m.type : type;
  const heading = m ? 'עריכה' : { milestone: 'אבן דרך חדשה', note: 'זיכרון כתוב', video: 'פרטי הסרטון', voice: 'פרטי ההקלטה' }[t] || 'פריט חדש';
  const titlePh = { milestone: 'למשל: הצעד הראשון', note: 'כותרת', artwork: 'שם הציור', video: 'כותרת', voice: 'כותרת', photo: 'כותרת' }[t];
  const capLabel = t === 'note' ? 'מה קרה?' : t === 'milestone' ? 'פרטים' : 'כיתוב';
  return openSheet((body, close) => {
    body.innerHTML = `
      <h2>${esc(heading)}</h2>
      <form data-form>
        <div class="field"><label for="f-child">ילד</label>
          <select id="f-child" class="input" name="childId">${state.children.map((c) => `<option value="${esc(c.id)}" ${(m ? m.childId : defaultChildId()) === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div class="field"><label for="f-title">כותרת</label><input id="f-title" class="input" name="title" value="${esc(m ? m.title : '')}" placeholder="${esc(titlePh)}" ${t === 'milestone' || t === 'note' ? 'required' : ''}></div>
        <div class="field"><label for="f-date">תאריך</label><input id="f-date" class="input" type="date" name="date" value="${esc(m ? m.date : todayStr())}" max="${todayStr()}" required></div>
        <div class="field"><label for="f-cap">${esc(capLabel)}</label><textarea id="f-cap" class="input" name="caption">${esc(m ? m.caption : '')}</textarea></div>
        <div class="btn-row" style="justify-content:flex-end">
          <button type="button" class="btn" data-cancel>ביטול</button>
          <button type="submit" class="btn primary">שמירה</button>
        </div>
      </form>`;
    body.querySelector('[data-cancel]').addEventListener('click', () => close(null));
    body.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      close({
        childId: String(fd.get('childId')),
        title: String(fd.get('title') || '').trim(),
        date: parseDate(String(fd.get('date'))) ? String(fd.get('date')) : todayStr(),
        caption: String(fd.get('caption') || '').trim(),
      });
    });
  }, { label: heading }).then(async (v) => {
    if (!v || returnOnly) return v;
    if (m) {
      const updated = { ...m, ...v, updatedAt: Date.now() };
      if (v.title !== m.title) delete updated.autoTitle; // a name the parent typed is theirs
      await db.put('memories', updated);
      if (!('autoTitle' in updated)) delete m.autoTitle;
      Object.assign(m, updated);
      toast('נשמר');
      return render();
    }
    const nm = { id: uid(), ...v, type: t, createdAt: Date.now(), updatedAt: Date.now(), attachments: [] };
    await db.put('memories', nm);
    state.memories.push(nm);
    afterFirstSave();
    toast('נשמר');
    go('memory/' + nm.id);
  });
}

// ---------- Children ----------
/**
 * Choose which part of a photo becomes the round profile picture: drag to move, slider or pinch to zoom.
 * Resolves a 320 × 320 canvas, or undefined when cancelled. The picture always covers the whole circle.
 */
function openAvatarCrop(src) {
  const OUT = 320, VIEW = 640;
  const fit = Math.max(1 / src.width, 1 / src.height); // scale at which the short side fills the square (in squares per pixel)
  let zoom = 1, cx = src.width / 2, cy = src.height / 2; // the photo point at the centre of the circle
  return openSheet((body, close) => {
    body.innerHTML = `
      <h2>תמונת פרופיל</h2>
      <p class="small muted" style="margin:4px 0 12px">גוררים את התמונה כדי למקם, ומגדילים עם המחוון. מה שבתוך העיגול יישמר.</p>
      <div class="av-crop" data-stage tabindex="0" role="img" aria-label="מיקום התמונה בעיגול. חיצים מזיזים."><canvas width="${VIEW}" height="${VIEW}"></canvas></div>
      <div class="field" style="margin-top:12px"><label for="av-zoom">הגדלה</label><input id="av-zoom" type="range" min="1" max="4" step="0.01" value="1" data-zoom></div>
      <div class="btn-row" style="justify-content:space-between;margin-top:8px">
        <button type="button" class="btn ghost" data-cancel>ביטול</button>
        <button type="button" class="btn primary" data-ok>אישור</button>
      </div>`;
    const stage = body.querySelector('[data-stage]');
    const canvas = stage.querySelector('canvas');
    const slider = body.querySelector('[data-zoom]');
    const side = () => 1 / (fit * zoom); // photo pixels across the square
    const clamp = () => {
      const h = side() / 2;
      cx = Math.min(Math.max(cx, h), src.width - h);
      cy = Math.min(Math.max(cy, h), src.height - h);
    };
    const paintTo = (c) => {
      const g = c.getContext('2d');
      const sdim = side();
      g.imageSmoothingQuality = 'high';
      g.drawImage(src, cx - sdim / 2, cy - sdim / 2, sdim, sdim, 0, 0, c.width, c.height);
    };
    const draw = () => { clamp(); paintTo(canvas); stage.dataset.view = [Math.round(cx), Math.round(cy), Math.round(side())].join(','); };
    draw();
    const setZoom = (z) => { zoom = Math.min(4, Math.max(1, z)); slider.value = String(zoom); draw(); };
    slider.addEventListener('input', () => setZoom(Number(slider.value)));
    const pts = new Map();
    let pinch = 0;
    stage.addEventListener('pointerdown', (e) => { stage.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); pinch = 0; });
    stage.addEventListener('pointermove', (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      const k = side() / stage.clientWidth; // photo pixels per screen pixel
      if (pts.size === 1) { cx -= (e.clientX - p.x) * k; cy -= (e.clientY - p.y) * k; }
      p.x = e.clientX; p.y = e.clientY;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch) setZoom(zoom * d / pinch);
        pinch = d;
        return;
      }
      draw();
    });
    const up = (e) => { pts.delete(e.pointerId); pinch = 0; };
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    stage.addEventListener('keydown', (e) => {
      const step = side() * 0.05;
      const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!move) return;
      e.preventDefault();
      cx += move[0]; cy += move[1];
      draw();
    });
    // Escape closes only this sheet, not the child's form underneath.
    const onEsc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(undefined); } };
    document.addEventListener('keydown', onEsc, true);
    const done = (v) => { document.removeEventListener('keydown', onEsc, true); close(v); };
    body.querySelector('[data-cancel]').addEventListener('click', () => done(undefined));
    body.querySelector('[data-ok]').addEventListener('click', () => {
      const out = document.createElement('canvas');
      out.width = out.height = OUT;
      clamp();
      paintTo(out);
      done(out);
    });
  }, { label: 'תמונת פרופיל' });
}

function openChildForm(child) {
  // Render the page underneath first so the sheet has context.
  const base = state.children.length ? (child ? renderSettings() : renderHome()) : renderWelcome();
  APP.innerHTML = base;
  hydrate();
  let avatarBlob = null;
  let removeAvatar = false;
  let animal = child ? childAnimal(child) : ANIMALS[state.children.length % ANIMALS.length];
  let color = child ? childIndex(child) : state.children.length % KID_COLORS;
  let usePhoto = !!(child && child.avatar);
  let photoUrl = '';
  state._childForm = true;
  return openSheet((body, close) => {
    body.innerHTML = `
      <h2>${child ? 'עריכת ילד' : 'ילד חדש'}</h2>
      <form data-form>
        <div class="field"><label for="c-name">שם</label><input id="c-name" class="input" name="name" required maxlength="40" value="${esc(child ? child.name : '')}" autocomplete="off"></div>
        <div class="field"><label for="c-birth">תאריך לידה</label><input id="c-birth" class="input" type="date" name="birthDate" max="${todayStr()}" value="${esc(child ? child.birthDate || '' : '')}">
          <span class="small muted">לפיו נרשם הגיל ליד כל ציור, אוטומטית.</span></div>
        <div class="field"><span class="label">דמות</span><div class="animals" data-animals></div></div>
        <div class="field"><span class="label">צבע</span><div class="colors" data-colors></div></div>
        <div class="btn-row" style="justify-content:space-between;margin-top:8px">
          ${child ? '<button type="button" class="btn danger" data-del-child>מחיקה</button>' : '<span></span>'}
          <div class="btn-row"><button type="button" class="btn ghost" data-cancel>ביטול</button><button type="submit" class="btn primary">שמירה</button></div>
        </div>
      </form>`;
    const paint = () => {
      body.querySelector('[data-animals]').innerHTML = ANIMALS.map((a) => `<button type="button" data-animal="${a}" aria-label="דמות ${a}" aria-pressed="${!usePhoto && animal === a}"><img src="art/av-${a}.webp" alt=""></button>`).join('')
        + `<button type="button" class="photo" data-pick-av aria-pressed="${usePhoto}" aria-label="תמונת פרופיל">${usePhoto && photoUrl ? `<img src="${photoUrl}" alt="" style="object-fit:cover;border-radius:50%">` : usePhoto && child && child.avatar ? `<img data-blob="${esc(child.avatar)}" alt="" style="object-fit:cover;border-radius:50%">` : 'תמונה'}</button>`;
      body.querySelector('[data-colors]').innerHTML = Array.from({ length: KID_COLORS }, (_, i) => `<button type="button" data-color="${i}" aria-label="צבע ${i + 1}" aria-pressed="${color === i}" style="background:var(--c${i})"></button>`).join('');
      hydrate(body);
    };
    paint();
    body.querySelector('[data-cancel]').addEventListener('click', () => close(null));
    body.addEventListener('click', async (e) => {
      const an = e.target.closest('[data-animal]');
      if (an) { animal = an.dataset.animal; usePhoto = false; removeAvatar = true; avatarBlob = null; paint(); return; }
      const co = e.target.closest('[data-color]');
      if (co) { color = Number(co.dataset.color); paint(); return; }
      if (!e.target.closest('[data-pick-av]')) return;
      const files = await pickFiles({ accept: 'image/*' });
      if (!files.length) return;
      try {
        const src = await decode(files[0]);
        const c = await openAvatarCrop(src);
        if (src.close) src.close();
        if (!c) return; // cancelled: the picture chosen before stays
        avatarBlob = await canvasToBlob(c, 'image/jpeg', 0.88);
        removeAvatar = false; usePhoto = true;
        photoUrl = URL.createObjectURL(avatarBlob);
        paint();
      } catch { toast('לא הצלחתי לפתוח את התמונה'); }
    });
    body.querySelector('[data-del-child]')?.addEventListener('click', () => close({ delete: true }));
    body.querySelector('form').addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(e.target);
      const name = String(fd.get('name') || '').trim();
      if (!name) return;
      close({ name, birthDate: String(fd.get('birthDate') || '') });
    });
  }, { label: child ? 'עריכת ילד' : 'ילד חדש' }).then(async (v) => {
    state._childForm = false;
    if (!v) { back(child ? 'settings' : ''); return; }
    if (v.delete) {
      const n = state.memories.filter((m) => m.childId === child.id).length;
      if (!(await confirmDialog(`למחוק את ${child.name}?`, [n ? `גם ${n} הפריטים של ${child.name} יימחקו. כדאי לגבות קודם.` : '', cloud.signedIn() ? 'המחיקה חלה על כל בני המשפחה שצורפו.' : ''].filter(Boolean).join(' '), { ok: 'מחיקה', danger: true }))) { render(); return; }
      await deleteMemories(state.memories.filter((m) => m.childId === child.id).map((m) => m.id));
      const ops = [['children', child.id]];
      if (child.avatar) { ops.push(['blobs', child.avatar]); forgetUrl(child.avatar); }
      await db.delMany(ops);
      state.children = state.children.filter((c) => c.id !== child.id);
      if (state.settings.activeChild === child.id) { state.settings.activeChild = null; saveSettings(); }
      toast('נמחק');
      go(state.children.length ? 'settings' : '', { replace: true });
      return;
    }
    const rec = child ? { ...child } : { id: uid(), createdAt: Date.now() };
    rec.name = v.name;
    rec.animal = animal;
    rec.color = color;
    rec.birthDate = parseDate(v.birthDate) ? v.birthDate : '';
    const ops = [];
    const oldAvatar = rec.avatar;
    if (avatarBlob) {
      const b = blobRecord(avatarBlob, 'avatar', { childId: rec.id });
      ops.push(['blobs', b]);
      rec.avatar = b.id;
    } else if (removeAvatar) rec.avatar = null;
    ops.push(['children', rec]);
    await db.putMany(ops);
    if (oldAvatar && oldAvatar !== rec.avatar) { await db.delMany([['blobs', oldAvatar]]); forgetUrl(oldAvatar); }
    if (child) Object.assign(child, rec);
    else {
      state.children.push(rec);
      state.settings.activeChild = rec.id;
      saveSettings();
    }
    toast('נשמר');
    go(child ? 'settings' : '', { replace: true });
  });
}

// ---------- Book ----------
function openBook(ids) {
  if (!ids.length) { toast('אין עדיין ציורים לספר'); return; }
  if (ids.length > MAX_BOOK_PAGES) { toast(`בספר יש מקום ל-${MAX_BOOK_PAGES} עמודים. לקחתי את הראשונים.`); ids = ids.slice(0, MAX_BOOK_PAGES); }
  const first = memoryById(ids[0]);
  const child = first ? childById(first.childId) : null;
  state.book = { year: '', childId: child ? child.id : null, title: child ? `הציורים של ${child.name}` : 'הציורים שלנו', ids };
  state.selecting = false; state.selected.clear();
  go('book');
}

// ---------- Share / download ----------
function fileNameFor(m, blob, role = '') {
  const child = childById(m.childId);
  const ext = (blob.type.split('/')[1] || 'bin').split(';')[0].replace('jpeg', 'jpg').replace('quicktime', 'mov');
  return `${safeName(child ? child.name : '')} ${m.date} ${safeName(m.title, TYPES[m.type]?.label)}${role}.${ext}`;
}

async function memoryMainFile(m) {
  const id = m.type === 'video' || m.type === 'voice' ? m.media : m.image;
  const rec = await cloud.ensureBlob(id);
  if (!rec) return null;
  return new File([rec.blob], fileNameFor(m, rec.blob), { type: rec.blob.type });
}

/** Ready-made line for the family WhatsApp group. */
function shareText(ids) {
  const ms = ids.map(memoryById).filter(Boolean);
  if (ms.length !== 1) {
    const kids = [...new Set(ms.map((m) => childById(m.childId)?.name).filter(Boolean))];
    return `${ms.length} יצירות חדשות${kids.length ? ' של ' + kids.join(' ו') : ''}`;
  }
  const m = ms[0];
  const child = childById(m.childId);
  const age = child ? ageLabel(ageAt(child.birthDate, m.date)) : '';
  return [`${m.title || TYPES[m.type]?.label || 'יצירה'}${child ? ' של ' + child.name : ''}${age ? ` (${age})` : ''}`, m.caption ? `"${m.caption}"` : ''].filter(Boolean).join('\n');
}

async function shareMemories(ids) {
  const files = [];
  for (const id of ids) {
    const m = memoryById(id);
    if (!m) continue;
    const f = await memoryMainFile(m);
    if (f) files.push(f);
  }
  if (!files.length) { toast('אין קבצים לשתף'); return; }
  if (navigator.canShare && navigator.canShare({ files })) {
    try {
      await navigator.share({ files, title: 'ציורון', text: shareText(ids) });
    } catch (err) {
      if (err && err.name !== 'AbortError') toast('השיתוף לא הצליח');
    }
    return;
  }
  if (files.length === 1) downloadBlob(files[0], files[0].name);
  else await exportZip(ids);
}

async function downloadMemory(m) {
  const f = await memoryMainFile(m);
  if (f) downloadBlob(f, f.name);
}

// ---------- Backup ----------
async function exportZip(ids) {
  const memories = ids ? ids.map(memoryById).filter(Boolean) : state.memories;
  const childIds = new Set(memories.map((m) => m.childId));
  const children = ids ? state.children.filter((c) => childIds.has(c.id)) : state.children;
  toast('מכין קובץ…', 4000);
  const blobIds = [...memories.flatMap(memoryBlobIds), ...children.map((c) => c.avatar).filter(Boolean)];
  const recs = (await Promise.all(blobIds.map((id) => cloud.ensureBlob(id)))).filter((r) => r && r.blob);
  // Thumbnails are rebuilt from the image, so a full backup skips them only when selective.
  const meta = recs.map((r) => ({ id: r.id, type: r.type, role: r.role, memoryId: r.memoryId || null, childId: r.childId || null }));
  const paths = backupPaths(children, memories, meta);
  const entries = [];
  for (const r of recs) {
    entries.push({ name: paths[r.id], data: new Uint8Array(await r.blob.arrayBuffer()) });
  }
  const manifest = {
    app: 'tziyuron', version: 1, exportedAt: new Date().toISOString(),
    children, memories, blobs: meta.map((b) => ({ ...b, path: paths[b.id] })),
  };
  entries.unshift({ name: 'גיבוי-ציורון.json', data: new TextEncoder().encode(JSON.stringify(manifest, null, 1)) });
  const zip = createZip(entries);
  const name = ids ? `ציורון-${todayStr()}-${memories.length}-פריטים.zip` : `ציורון-גיבוי-${todayStr()}.zip`;
  const file = new File([zip], name, { type: 'application/zip' });
  if (!ids) {
    state.settings.lastBackupAt = Date.now();
    await saveSettings();
  }
  // On phones, the share sheet lets the parent save straight to Drive/iCloud.
  if (navigator.canShare && navigator.canShare({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
    try { await navigator.share({ files: [file], title: name }); } catch (err) { if (err && err.name !== 'AbortError') downloadBlob(file, name); }
  } else downloadBlob(file, name);
  toast(ids ? 'הקובץ מוכן' : 'הגיבוי מוכן');
  if (route().name === 'settings' || route().name === 'home' || route().name === '') render();
}

async function importZip() {
  const files = await pickFiles({ accept: '.zip,application/zip' });
  if (!files.length) return;
  let entries;
  try {
    entries = readZip(new Uint8Array(await files[0].arrayBuffer()));
  } catch {
    toast('זה לא קובץ גיבוי של ציורון');
    return;
  }
  const mf = entries.find((e) => e.name === 'גיבוי-ציורון.json');
  let manifest;
  try { manifest = JSON.parse(new TextDecoder().decode(mf.data)); } catch { manifest = null; }
  if (!manifest || manifest.app !== 'tziyuron') { toast('זה לא קובץ גיבוי של ציורון'); return; }
  const n = manifest.memories.length;
  if (!(await confirmDialog('לשחזר מהגיבוי?', `${manifest.children.length} ילדים ו-${n} פריטים יתווספו. פריטים שכבר קיימים יוחלפו בגרסה מהגיבוי.`, { ok: 'שחזור' }))) return;
  const byPath = new Map(entries.map((e) => [e.name, e.data]));
  const ops = [];
  let missing = 0;
  for (const b of manifest.blobs) {
    const data = byPath.get(b.path);
    if (!data) { missing++; continue; }
    const { path, ...rest } = b;
    ops.push(['blobs', { ...rest, blob: new Blob([data], { type: b.type }) }]);
  }
  for (const c of manifest.children) ops.push(['children', c]);
  for (const m of manifest.memories) ops.push(['memories', m]);
  await db.putMany(ops);
  await load();
  toast(missing ? `שוחזר. ${missing} קבצים חסרים בגיבוי.` : 'השחזור הושלם');
  go('', { replace: true });
}

// ---------- Voice rows ----------
function togglePlay(row) {
  if (!row) return;
  const audio = row.querySelector('audio');
  const btn = row.querySelector('[data-play]');
  const bars = [...row.querySelectorAll('.bars i')];
  const time = row.querySelector('time');
  if (!audio.dataset.bound) {
    audio.dataset.bound = '1';
    const total = time.textContent;
    const paint = () => {
      const d = Number.isFinite(audio.duration) && audio.duration ? audio.duration : 0;
      const k = d ? audio.currentTime / d : 0;
      bars.forEach((b, i) => b.classList.toggle('on', !audio.paused && i / bars.length <= k));
      time.textContent = audio.paused ? total : formatDuration(audio.currentTime);
    };
    audio.addEventListener('timeupdate', paint);
    audio.addEventListener('play', () => { btn.innerHTML = ICONS.pause; });
    const stop = () => { btn.innerHTML = ICONS.play; paint(); };
    audio.addEventListener('pause', stop);
    audio.addEventListener('ended', () => { audio.currentTime = 0; stop(); });
  }
  if (audio.paused) {
    $$('audio', APP).forEach((a) => { if (a !== audio) a.pause(); });
    audio.play().catch(() => toast('לא הצלחתי להשמיע'));
  } else audio.pause();
}

// ---------- Compare two drawings (same child at different ages) ----------
async function openCompare(ids) {
  const pair = ids.map(memoryById).filter((m) => m && m.image).sort((a, b) => -compareMemories(a, b));
  if (pair.length !== 2) { toast('בוחרים שני ציורים להשוואה'); return; }
  const urls = await Promise.all(pair.map((m) => urlFor(m.image)));
  return openSheet((body, close) => {
    body.innerHTML = `<h2>אז והיום</h2>
      <div class="compare">${pair.map((m, i) => {
        const child = childById(m.childId);
        const age = child ? ageLabel(ageAt(child.birthDate, m.date)) : '';
        return `<figure><div class="mat"><img src="${esc(urls[i])}" alt="${esc(m.title || 'ציור')}"></div>
          <figcaption><b>${esc(age || formatDate(m.date))}</b><span>${esc([child ? child.name : '', m.title].filter(Boolean).join(' · '))}</span></figcaption></figure>`;
      }).join('')}</div>
      <button class="btn block" data-x>סגירה</button>`;
    body.querySelector('[data-x]').addEventListener('click', () => close());
  }, { label: 'השוואה' });
}

// ---------- Exhibition: full-screen slideshow, good for a tablet or a digital frame ----------
async function openExhibition() {
  const active = state.settings.activeChild;
  const list = filterMemories(state.memories, state.children, { childId: active, query: '' }).filter((m) => m.image && (m.type === 'artwork' || m.type === 'photo'));
  if (!list.length) { toast('אין עדיין ציורים לתערוכה'); return; }
  const root = document.createElement('div');
  root.className = 'show';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-label', 'תערוכה');
  root.innerHTML = `<div class="show-slide"><div class="mat"><img alt=""></div><div class="show-cap"><b></b><span></span></div></div>
    <button class="icon-btn show-close" aria-label="סגירת התערוכה">${ICONS.close}</button>`;
  document.body.appendChild(root);
  const img = root.querySelector('img'), slide = root.querySelector('.show-slide');
  const capB = root.querySelector('.show-cap b'), capS = root.querySelector('.show-cap span');
  let i = -1, timer = 0, lock = null, closed = false;
  try { lock = await navigator.wakeLock?.request('screen'); } catch { /* not supported or denied */ }
  try { await root.requestFullscreen?.(); } catch { /* fine without */ }
  const next = async (step = 1) => {
    if (closed) return;
    i = (i + step + list.length) % list.length;
    const m = list[i];
    const child = childById(m.childId);
    const url = await urlFor(m.image);
    slide.classList.remove('in');
    await new Promise((r) => setTimeout(r, 350));
    img.src = url;
    img.alt = m.title || 'ציור';
    capB.textContent = m.title || '';
    capS.textContent = [child ? child.name : '', child ? ageLabel(ageAt(child.birthDate, m.date)) : formatDate(m.date)].filter(Boolean).join(' · ');
    slide.classList.add('in');
  };
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    document.removeEventListener('keydown', onKey);
    if (lock) lock.release().catch(() => {});
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    root.remove();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') close();
    if (e.key === 'ArrowLeft') next(1);
    if (e.key === 'ArrowRight') next(-1);
  };
  document.addEventListener('keydown', onKey);
  root.addEventListener('click', (e) => { if (e.target.closest('.show-close')) close(); else { clearInterval(timer); next(1); timer = setInterval(next, 6000); } });
  await next(1);
  timer = setInterval(next, 6000);
}

// ---------- Animation made on the device ----------
async function animateMemory(m, { motions = [], first = 0 } = {}) {
  const rec = await cloud.ensureBlob(m.image);
  if (!rec || !rec.blob) return;
  const res = await openAnimator(rec.blob, m.title || 'ציור', { motions, first });
  if (!res) return;
  const b = blobRecord(res.blob, 'video', { memoryId: m.id });
  const att = { id: uid(), kind: 'animation', style: res.style, ...(res.label ? { label: res.label } : {}), blob: b.id, duration: res.duration, createdAt: Date.now() };
  const updated = { ...m, attachments: [...(m.attachments || []), att], updatedAt: Date.now() };
  await db.putMany([['blobs', b], ['memories', updated]]);
  Object.assign(m, updated);
  toast('ההנפשה נשמרה ליד הציור');
  render();
}


// ---------- Family archive ----------
function openSignIn() {
  return openSheet((body, close) => {
    body.innerHTML = `
      <h2>שיתוף משפחתי</h2>
      <p class="muted">נכנסים עם אימייל וסיסמה. מי שיש לו חשבון בעולם הלמידה נכנס עם אותם פרטים.</p>
      <form class="form" novalidate>
        <label class="field"><span>אימייל</span><input name="email" type="email" dir="ltr" autocomplete="email" inputmode="email" required></label>
        <label class="field"><span>סיסמה</span><input name="password" type="password" dir="ltr" autocomplete="current-password" minlength="6" required></label>
        <p class="small" data-err role="alert" style="color:var(--red-ink, #b3261e);min-height:1.4em"></p>
        <div class="btn-row">
          <button class="btn sunny" type="submit" data-mode="in">כניסה</button>
          <button class="btn" type="submit" data-mode="up">חשבון חדש</button>
        </div>
      </form>`;
    const form = $('form', body);
    const err = $('[data-err]', body);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const mode = e.submitter && e.submitter.dataset.mode === 'up' ? 'up' : 'in';
      const fd = new FormData(form);
      const email = String(fd.get('email') || '').trim();
      const password = String(fd.get('password') || '');
      if (!email || password.length < 6) { err.textContent = 'צריך אימייל וסיסמה של 6 תווים לפחות.'; return; }
      $$('button', form).forEach((b) => { b.disabled = true; });
      err.textContent = '';
      try {
        if (mode === 'up') {
          const r = await cloud.signUp(email, password);
          if (r.confirm) { close('confirm'); return; }
        } else await cloud.signIn(email, password);
        close('in');
        loadPrefs();
      } catch (ex) {
        err.textContent = ex instanceof TypeError ? 'אין חיבור לרשת.'
          : mode === 'up' ? 'לא הצלחנו לפתוח חשבון. ייתכן שהאימייל כבר רשום.'
          : 'האימייל או הסיסמה לא נכונים.';
        $$('button', form).forEach((b) => { b.disabled = false; });
      }
    });
  }, { label: 'שיתוף משפחתי' }).then(async (v) => {
    if (v === 'confirm') { toast('שלחנו אימייל לאישור. אחרי האישור נכנסים כאן.', 6000); return false; }
    if (v !== 'in') return false;
    toast('נכנסת. מסנכרן…');
    render();
    await cloud.sync();
    return true;
  });
}

async function openFamilySheet(child) {
  if (!child) return;
  await cloud.sync();
  let list;
  try { list = await cloud.members(child.id); } catch { toast('אין חיבור לארכיון המשפחתי'); return; }
  const me = cloud.user().id;
  await openSheet((body, close) => {
    const draw = () => {
      body.innerHTML = `
        <h2>המשפחה של ${esc(child.name)}</h2>
        <p class="muted">כל מי שברשימה רואה הכול ויכול להוסיף, לערוך ולמחוק. לכולם אותן הרשאות.</p>
        ${list.map((m) => `<div class="list-row"><div class="grow"><b>${esc(m.display_name || 'בן משפחה')}</b>${m.user_id === me ? ' <span class="chip sub">אני</span>' : ''}</div>
          ${m.user_id !== me ? `<button class="btn danger" data-remove-member="${esc(m.user_id)}">הסרה</button>` : ''}</div>`).join('')}
        <div class="btn-row" style="margin-top:16px">
          <button class="btn sunny" data-invite>הזמנת בן משפחה</button>
          <button class="btn" data-close>סגירה</button>
        </div>`;
    };
    draw();
    body.addEventListener('click', async (e) => {
      if (e.target.closest('[data-close]')) return close();
      const rm = e.target.closest('[data-remove-member]');
      if (rm) {
        const who = list.find((m) => m.user_id === rm.dataset.removeMember);
        if (!(await confirmDialog(`להסיר את ${who.display_name || 'בן המשפחה'}?`, `${child.name} לא יופיע יותר אצלו.`, { ok: 'הסרה', danger: true }))) return;
        try {
          await cloud.removeMember(child.id, who.user_id);
          list = list.filter((m) => m !== who);
          draw();
        } catch { toast('ההסרה לא הצליחה'); }
        return;
      }
      if (e.target.closest('[data-invite]')) {
        let code;
        try { code = await cloud.createInvite(child.id); } catch { toast('לא הצלחנו ליצור הזמנה'); return; }
        const link = `${location.origin}${location.pathname}#/join/${code}`;
        const text = `הזמנה לארכיון הציורים של ${child.name} בציורון. הקישור תקף לשבוע ולאדם אחד:`;
        try {
          if (navigator.share) await navigator.share({ title: 'ציורון', text, url: link });
          else { await navigator.clipboard.writeText(`${text} ${link}`); toast('הקישור הועתק. אפשר להדביק בוואטסאפ.', 5000); }
        } catch (ex) {
          if (!ex || ex.name !== 'AbortError') {
            body.insertAdjacentHTML('beforeend', `<p class="small" dir="ltr" style="word-break:break-all;user-select:all" data-invite-link>${esc(link)}</p>`);
          }
        }
      }
    });
  }, { label: `המשפחה של ${child.name}` });
}

/** Opened from an invitation link: #/join/<code>. */
async function joinFamily(code) {
  if (!code) { go('', { replace: true }); return; }
  if (state._joining) return; // renders triggered by the sign-in and the first sync land here again
  state._joining = true;
  try { await joinFlow(code); } finally { state._joining = false; }
}

async function joinFlow(code) {
  APP.innerHTML = `${header({})}<main>${emptyHtml('balloon', 'הזמנה לארכיון משפחתי', 'עוד רגע מצרפים אותך.')}</main>`;
  if (!cloud.signedIn() && !(await openSignIn())) {
    APP.innerHTML = `${header({})}<main>${emptyHtml('balloon', 'הזמנה לארכיון משפחתי', 'כדי להצטרף צריך להיכנס.')}
      <div class="btn-row" style="justify-content:center"><button class="btn sunny" data-act="join-retry">כניסה</button><button class="btn" data-go="">לא עכשיו</button></div></main>`;
    return;
  }
  const name = await openSheet((body, close) => {
    body.innerHTML = `
      <h2>איך לקרוא לך?</h2>
      <p class="muted">השם יופיע ברשימת המשפחה, למשל "סבתא רותי".</p>
      <form class="form"><label class="field"><span>שם</span><input name="name" maxlength="40" required autocomplete="given-name"></label>
      <div class="btn-row"><button class="btn sunny" type="submit">הצטרפות</button></div></form>`;
    $('form', body).addEventListener('submit', (e) => {
      e.preventDefault();
      const v = String(new FormData(e.target).get('name') || '').trim();
      if (v) close(v);
    });
  }, { label: 'הצטרפות למשפחה' });
  if (!name) { go('', { replace: true }); return; }
  let joined = false;
  try {
    const childId = await cloud.acceptInvite(code, name);
    await cloud.sync();
    await load();
    if (childById(childId)) { state.settings.activeChild = childId; saveSettings(); }
    toast('הצטרפת. הציורים כבר כאן.');
    joined = true;
  } catch {
    toast('ההזמנה לא תקפה או שכבר נעשה בה שימוש. אפשר לבקש קישור חדש.', 6000);
  }
  state._joining = false;
  go('', { replace: true });
  // A new family member arrived through a link in the browser: show how to keep ציורון as an app on the phone.
  if (joined && !isInstalled()) openInstallGuide();
}

// ---------- ציורון as an app on the phone ----------
let installPrompt = null; // Android Chrome offers its own install dialog; kept until the guide's button is pressed
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installPrompt = e; });
window.addEventListener('appinstalled', () => { installPrompt = null; });

function isInstalled() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true;
}

/** 'ios-safari' | 'ios-chrome' | 'samsung' | 'android' | 'other', from the browser's own description of itself. */
function deviceKind(ua = navigator.userAgent, touch = navigator.maxTouchPoints || 0) {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touch > 1);
  if (ios) return /CriOS|FxiOS|EdgiOS/.test(ua) ? 'ios-chrome' : 'ios-safari';
  if (/Android/.test(ua)) return /SamsungBrowser/.test(ua) ? 'samsung' : 'android';
  return 'other';
}

const INSTALL_STEPS = {
  'ios-safari': ['פותחים את ציורון בדפדפן Safari.', 'לוחצים על כפתור השיתוף: ריבוע עם חץ למעלה, בתחתית המסך.', 'גוללים ברשימה ובוחרים "הוסף למסך הבית".', 'לוחצים "הוסף". הסמל של ציורון מופיע במסך הבית.'],
  'ios-chrome': ['לוחצים על כפתור השיתוף: ריבוע עם חץ למעלה, בקצה שורת הכתובת למעלה.', 'גוללים ברשימה ובוחרים "הוסף למסך הבית".', 'לוחצים "הוסף". הסמל של ציורון מופיע במסך הבית.'],
  android: ['פותחים את ציורון בדפדפן Chrome.', 'לוחצים על שלוש הנקודות בפינה העליונה של המסך.', 'בוחרים "הוספה למסך הבית" או "התקנת האפליקציה".', 'לוחצים "התקנה". הסמל של ציורון מופיע במסך הבית.'],
  samsung: ['לוחצים על שלושת הקווים בפינה התחתונה של המסך.', 'בוחרים "הוספת דף אל" ואז "מסך הבית".', 'לוחצים "הוספה". הסמל של ציורון מופיע במסך הבית.'],
};

/** Steps for keeping ציורון on the home screen, for the phone in hand, with the other kind one tap away. */
function openInstallGuide() {
  const kind = deviceKind();
  let tab = kind.startsWith('ios') ? 'ios' : 'android';
  return openSheet((body, close) => {
    const draw = () => {
      const key = tab === 'ios' ? (kind === 'ios-chrome' ? 'ios-chrome' : 'ios-safari') : (kind === 'samsung' ? 'samsung' : 'android');
      const mine = (tab === 'ios') === kind.startsWith('ios') && kind !== 'other';
      body.innerHTML = `
        <h2>ציורון כאפליקציה בטלפון</h2>
        <p style="margin:6px 0 12px">${isInstalled() ? 'ציורון כבר שמור כאפליקציה במכשיר הזה. כך מוסיפים אותו בטלפון נוסף:' : 'שומרים את ציורון במסך הבית, והוא נפתח כמו כל אפליקציה: במסך מלא, בלי שורת כתובת.'}</p>
        <div class="seg" role="group" aria-label="סוג הטלפון" style="margin-bottom:12px">
          <button type="button" data-tab="android" aria-pressed="${tab === 'android'}">אנדרואיד</button>
          <button type="button" data-tab="ios" aria-pressed="${tab === 'ios'}">אייפון</button>
        </div>
        ${tab === 'android' && installPrompt && !isInstalled() ? '<button type="button" class="btn violet" data-install style="width:100%;justify-content:center;margin-bottom:12px">התקנה עכשיו</button><p class="small muted" style="margin-bottom:8px">או בעצמך:</p>' : ''}
        <ol class="steps" data-steps="${key}">${INSTALL_STEPS[key].map((t) => `<li>${esc(t)}</li>`).join('')}</ol>
        <p class="small muted" style="margin-top:12px">${tab === 'ios'
    ? 'אחרי ההוספה פותחים את ציורון מהסמל שבמסך הבית ונכנסים פעם אחת עם אותו אימייל ואותה סיסמה. הציורים מגיעים לבד.'
    : 'אם ציורון מבקש כניסה אחרי ההתקנה, נכנסים עם אותו אימייל ואותה סיסמה. הציורים מגיעים לבד.'}${mine ? '' : ' ההסבר הזה מיועד לטלפון מהסוג שנבחר למעלה.'}</p>
        <div class="btn-row" style="justify-content:flex-end;margin-top:12px"><button type="button" class="btn" data-close>הבנתי</button></div>`;
    };
    draw();
    body.addEventListener('click', async (e) => {
      const t = e.target.closest('[data-tab]');
      if (t) { tab = t.dataset.tab; return draw(); }
      if (e.target.closest('[data-close]')) return close();
      if (e.target.closest('[data-install]') && installPrompt) {
        const ask = installPrompt;
        installPrompt = null;
        try { await ask.prompt(); } catch { /* the browser declined to show its dialog; the steps below still work */ }
        draw();
      }
    });
  }, { label: 'ציורון כאפליקציה בטלפון' });
}

// ---------- Automatic title ----------
const NAME_WAIT_MS = 4 * 60 * 1000;

/** A small JPEG of the drawing as base64, for the free naming route (the task gets the picture in its wake text). */
async function smallPicture(m) {
  const rec = await cloud.ensureBlob(m.thumb || m.image);
  if (!rec || !rec.blob) return null;
  const src = await decode(rec.blob);
  const { canvas } = drawToCanvas(src, 256);
  if (src.close) src.close();
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.6);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

/**
 * Ask for a title for drawings saved without one, by the route chosen in the settings. The name is only a
 * suggestion: it is marked as automatic, never replaces a name someone typed, and a drawing that is not
 * recognised simply stays without a name. Returns how many drawings got a name or are waiting for one.
 */
async function nameDrawings(ids, { manual = false } = {}) {
  const route = state.settings.titleRoute === 'free' ? 'free' : 'paid';
  if (!ids.length || !cloud.signedIn() || (state.settings.titleRoute === 'off' && !manual)) return 0;
  state._naming = state._naming || new Map(); // id -> time the free route was asked (0 on the paid route)
  ids.forEach((id) => state._naming.set(id, 0));
  const refresh = () => { if (!document.querySelector('.scrim') && !state.review) render(); };
  refresh();
  let named = 0;
  const waiting = [];
  const turned = () => toast('סובבתי את הציור שיעמוד ישר. אפשר לתקן בכפתור "סיבוב".', 5000);
  try {
    await cloud.sync(); // the picture has to be in the family archive before it can be looked at
    for (const id of ids) {
      const m = memoryById(id);
      let res = {};
      try {
        if (m && !m.title) res = await cloud.suggestTitle(id, route === 'free' ? { route, picture: await smallPicture(m) } : {});
      } catch { /* offline or not set up: the drawing keeps no name */ }
      if (res.queued) {
        state._naming.set(id, Date.now());
        waiting.push(id);
        named++;
      } else {
        state._naming.delete(id);
        if (res.title && m && !m.title) {
          const fit = cleanMotions(res.motions);
          const updated = { ...m, title: res.title, autoTitle: true, ...(fit.length ? { motions: fit } : {}), updatedAt: Date.now() };
          await db.put('memories', updated);
          Object.assign(m, updated);
          named++;
        }
        if (res.turn && m && await rotateMemory(m, res.turn, { auto: true })) turned();
      }
      refresh();
    }
  } finally {
    ids.filter((id) => !waiting.includes(id)).forEach((id) => state._naming.delete(id));
    refresh();
  }
  if (waiting.length) {
    toast(waiting.length > 1 ? 'השמות יהיו מוכנים בעוד כדקה' : 'השם יהיה מוכן בעוד כדקה', 5000);
    awaitNames();
  }
  return named;
}

/** Free route: the scheduled task writes the title (or the movements) on the server, and it reaches this device by sync. */
let nameTimer = null;
function awaitNames() {
  clearTimeout(nameTimer);
  const pending = state._naming ? [...state._naming].filter(([, at]) => at) : [];
  const seeking = state._seeking ? [...state._seeking] : [];
  if (!pending.length && !seeking.length) return;
  nameTimer = setTimeout(async () => {
    await cloud.sync();
    if (state._stale) { state._stale = false; await load(); }
    let changed = false;
    for (const [id, at] of pending) {
      const m = memoryById(id);
      if (m && m.title && m.turn) {
        // The task also said which way is up. Only the device that asked applies it, once.
        if (await rotateMemory(m, m.turn, { auto: true })) toast('סובבתי את הציור שיעמוד ישר. אפשר לתקן בכפתור "סיבוב".', 5000);
        else if (m.turn !== undefined) { const { turn, ...rest } = m; const u = { ...rest, updatedAt: Date.now() }; await db.put('memories', u); delete m.turn; Object.assign(m, u); }
      }
      if (!m || m.title || Date.now() - at > NAME_WAIT_MS) { state._naming.delete(id); changed = true; }
    }
    for (const [id, at] of seeking) {
      const m = memoryById(id);
      const got = m && cleanMotions(m.motions).length > 0;
      if (got) toast('ההצעות לפי הציור מוכנות. לחיצה על "הנפשה" תציג אותן.', 5000);
      if (!m || got || Date.now() - at > NAME_WAIT_MS) { state._seeking.delete(id); changed = true; }
    }
    if (changed && !document.querySelector('.scrim') && !state.review) render();
    awaitNames();
  }, 8000);
}

/**
 * Ask for movements that fit a drawing by looking at it, by the route chosen in the settings.
 * Returns 'ready' (they are on the drawing now), 'waiting' (the free route: about a minute) or '' (nothing came).
 */
async function seekMotions(m) {
  const route = state.settings.titleRoute === 'free' ? 'free' : 'paid';
  state._seeking = state._seeking || new Map();
  state._seeking.set(m.id, Date.now());
  let res = {};
  try {
    await cloud.sync();
    res = await cloud.suggestTitle(m.id, { want: 'motions', route, picture: route === 'free' ? await smallPicture(m) : null });
  } catch { /* offline or not set up */ }
  if (res.queued) { awaitNames(); return 'waiting'; }
  state._seeking.delete(m.id);
  const fit = cleanMotions(res.motions);
  if (!fit.length) return '';
  const updated = { ...m, motions: fit, updatedAt: Date.now() };
  await db.put('memories', updated);
  Object.assign(m, updated);
  return 'ready';
}

// ---------- AI animation (made for the family on the server side) ----------
const ANIM_WAIT_MS = 30 * 60 * 1000;

function animStatusHtml(m) {
  const a = m.anim;
  if (!a) return '';
  if (a.status === 'failed') {
    return `<div class="banner" data-anim-status="failed">${art('eraser')}<div class="grow"><b>ההנפשה לא הצליחה</b><div class="small">אפשר לנסות שוב.</div></div>
      <button class="btn" data-act="anim-clear">הבנתי</button></div>`;
  }
  return `<div class="banner" data-anim-status="pending">${art('sparkle')}<div class="grow"><b>ההנפשה בהכנה</b><div class="small">זה לוקח כמה דקות. הסרטון יופיע כאן לבד.</div></div></div>`;
}

/** The movements offered for a drawing: what the naming step saw in it, otherwise what its name says. */
function motionsFor(m) {
  const seen = cleanMotions(m.motions);
  return seen.length ? { list: seen, seen: true } : { list: suggestFromTitle(m.title), seen: false };
}

/** A drawing without a name: say whether to wait for the automatic name or to type one. Resolves 'go' to animate anyway. */
function askForName(m) {
  const naming = state._naming && state._naming.has(m.id);
  const slow = naming && state._naming.get(m.id);
  return openSheet((body, close) => {
    body.innerHTML = `
      <h2>לציור עוד אין שם</h2>
      <p data-name-first style="margin:6px 0 14px">${naming
    ? `השם האוטומטי בדרך ויגיע ${slow ? 'בעוד כדקה' : 'בעוד כמה שניות'}. כדאי להמתין לו: לפי השם אציע תנועה שמתאימה לציור, למשל שהפרפר יעוף.`
    : 'לפי השם אציע תנועה שמתאימה לציור, למשל שהפרפר יעוף. אפשר לכתוב שם עכשיו' + (cloud.signedIn() ? ', או לבקש שם אוטומטי.' : '.')}</p>
      <div class="stack-btns">
        ${naming ? '<button type="button" class="btn violet" data-v="wait">אמתין לשם</button>' : ''}
        <button type="button" class="btn ${naming ? '' : 'violet'}" data-v="type">כתיבת שם עכשיו</button>
        ${!naming && cloud.signedIn() ? '<button type="button" class="btn" data-v="auto">שם אוטומטי</button>' : ''}
        <button type="button" class="btn ghost" data-v="go">הנפשה בלי שם</button>
      </div>`;
    body.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) close(b.dataset.v); });
  }, { label: 'לציור עוד אין שם' });
}

/** Choose a movement. Resolves { list, first } (first = -1 for the gentle movement of the whole page), 'seek' or undefined. */
function pickMotion(m) {
  const { list, seen } = motionsFor(m);
  const seeking = state._seeking && state._seeking.has(m.id);
  const free = state.settings.titleRoute === 'free';
  return openSheet((body, close) => {
    body.innerHTML = `
      <h2>איך להנפיש את ${esc(m.title || 'הציור')}?</h2>
      <p class="small muted" style="margin:4px 0 12px">${list.length
    ? (seen ? 'הצעות לפי מה שמצויר.' : 'הצעות לפי השם של הציור.')
    : (m.title ? 'לא מצאתי בשם משהו שאני יודע להזיז.' : 'בלי שם אין לי הצעה שמתאימה לציור.')}</p>
      <div class="motion-list">
        ${list.map((x, i) => `<button type="button" class="motion-opt" data-m="${i}">${art('sparkle')}<b>${esc(x.label)}</b></button>`).join('')}
        <button type="button" class="motion-opt plain" data-m="-1">${art('pencil')}<b>תנועה עדינה של כל הציור</b></button>
      </div>
      ${cloud.signedIn() && !seen ? (seeking
    ? '<p class="small muted" data-seeking style="margin-top:12px">ההצעות לפי הציור בדרך. הן יופיעו כאן בעוד כדקה.</p>'
    : `<button type="button" class="btn" data-seek style="margin-top:12px">${ICONS.edit}הצעות לפי הציור</button>
       <p class="small muted" style="margin-top:6px">${free ? 'הציור נבדק במסלול החינמי. ההצעות מוכנות בעוד כדקה.' : 'הציור נבדק במסלול המהיר, בתשלום קטן. ההצעות מוכנות בעוד כמה שניות.'}</p>`) : ''}`;
    body.addEventListener('click', (e) => {
      if (e.target.closest('[data-seek]')) return close('seek');
      const b = e.target.closest('[data-m]');
      if (b) close({ list, first: Number(b.dataset.m) });
    });
  }, { label: 'בחירת תנועה' });
}

async function chooseAnimation(m) {
  if (m.anim && m.anim.status !== 'failed') { toast('ההנפשה כבר בהכנה'); return; }
  if (!m.title) {
    const step = await askForName(m);
    if (step === 'type') {
      await openMemoryForm(m);
      if (!m.title) return;
    } else if (step === 'auto') {
      const got = await nameDrawings([m.id], { manual: true });
      if (!got) { toast('לא הצלחתי לזהות מה מצויר. אפשר לכתוב שם ב"עריכה".', 5000); return; }
      if (!m.title) return; // the free route: the name arrives in about a minute, and the toast said so
    } else if (step !== 'go') return;
  }
  let pick = await pickMotion(m);
  if (pick === 'seek') {
    toast('בודק מה מצויר…', 4000);
    const got = await seekMotions(m);
    render();
    if (got === 'waiting') { toast('ההצעות לפי הציור יהיו מוכנות בעוד כדקה. אפשר להמשיך בינתיים.', 5000); return; }
    if (!got) toast('לא הצלחתי לזהות בציור משהו להזיז.', 5000);
    pick = await pickMotion(m);
  }
  if (!pick || pick === 'seek') return;
  const chosen = pick.first >= 0 ? pick.list[pick.first] : null;
  const local = () => animateMemory(m, { motions: pick.list, first: pick.first });
  if (!cloud.signedIn()) return local();
  const fixed = { ai: 'ai', local: 'local' }[state.settings.animRoute];
  const where = fixed || await openSheet((body, close) => {
    body.innerHTML = `
      <h2>${chosen ? esc(chosen.label) : 'הנפשה'}</h2>
      <div class="make-grid">
        <button class="make" data-v="local">${art('pencil')}<b>במכשיר</b><span class="small">חינם ומיד. ${chosen ? 'הדמות נגזרת מהדף וזזה עליו.' : 'תנועה עדינה.'}</span></button>
        <button class="make" data-v="ai">${art('sparkle')}<b>הנפשה חכמה</b><span class="small">הציור מתעורר לחיים. יורד מקרדיטי Kling, מוכן בעוד כמה דקות.</span></button>
      </div>`;
    body.addEventListener('click', (e) => { const b = e.target.closest('[data-v]'); if (b) close(b.dataset.v); });
  }, { label: 'איפה להכין את ההנפשה' });
  if (where === 'local') return local();
  if (where !== 'ai') return;
  toast('שולח את הציור…', 4000);
  await cloud.sync();
  if (cloud.getStatus().pending || cloud.getStatus().error) { toast('הציור עוד לא הגיע לארכיון המשפחתי. ננסה שוב כשיהיה חיבור.', 5000); return; }
  let job;
  try { job = await cloud.requestAnimation(m, chosen ? `${chosen.motion}: ${chosen.label}` : ''); } catch { toast('הבקשה לא נשלחה. אפשר לנסות שוב.'); return; }
  const updated = { ...m, anim: { job: job.id, status: 'queued', at: Date.now() }, updatedAt: Date.now() };
  await db.put('memories', updated);
  Object.assign(m, updated);
  toast('ההנפשה בהכנה. היא תופיע כאן לבד בעוד כמה דקות.', 5000);
  render();
  watchJobs();
}

let jobTimer = null;
function watchJobs() {
  clearTimeout(jobTimer);
  if (!cloud.signedIn() || !state.memories.some((m) => m.anim && m.anim.status !== 'failed')) return;
  jobTimer = setTimeout(checkJobs, 10000);
}

async function checkJobs() {
  const waiting = state.memories.filter((m) => m.anim && m.anim.status !== 'failed');
  if (!waiting.length || !cloud.signedIn()) return;
  let rows = [];
  try { rows = await cloud.jobs(waiting.map((m) => m.anim.job)); } catch { watchJobs(); return; }
  const byId = new Map(rows.map((j) => [j.id, j]));
  let changed = false;
  for (const m of waiting) {
    const j = byId.get(m.anim.job);
    let updated = null;
    if (j && j.status === 'done' && j.result_path) {
      const { anim, ...rest } = m;
      updated = { ...rest, updatedAt: Date.now() };
      if (!(m.attachments || []).some((a) => a.id === j.id)) {
        await db.put('blobs', { id: j.id, type: 'video/mp4', role: 'video', memoryId: m.id, path: j.result_path, blob: null }, { silent: true });
        updated.attachments = [...(m.attachments || []), { id: j.id, kind: 'animation', style: 'ai', blob: j.id, createdAt: Date.now() }];
      }
    } else if ((j && j.status === 'failed') || !j || Date.now() - m.anim.at > ANIM_WAIT_MS) {
      updated = { ...m, anim: { ...m.anim, status: 'failed' }, updatedAt: Date.now() };
    } else if (j.status !== m.anim.status) {
      updated = { ...m, anim: { ...m.anim, status: j.status }, updatedAt: Date.now() };
    }
    if (!updated) continue;
    await db.put('memories', updated);
    for (const k of Object.keys(m)) delete m[k];
    Object.assign(m, updated);
    if (!updated.anim) toast('ההנפשה מוכנה');
    changed = true;
  }
  if (changed && !document.querySelector('.scrim')) render();
  watchJobs();
}

/** The routes chosen under "פעולות חכמות" follow the account to every device. */
async function loadPrefs() {
  if (!cloud.signedIn()) return;
  let prefs = {};
  try { prefs = await cloud.getPrefs(); } catch { return; }
  let changed = false;
  for (const [key, routes] of [['titleRoute', TITLE_ROUTES], ['animRoute', ANIM_ROUTES]]) {
    if (routes.some((r) => r[0] === prefs[key]) && state.settings[key] !== prefs[key]) { state.settings[key] = prefs[key]; changed = true; }
  }
  if (changed) { await saveSettings(); if (route().name === 'settings' && !document.querySelector('.scrim')) render(); }
}

function startCloud() {
  cloud.onStatus((st) => {
    const line = $('[data-sync-line]');
    if (line && st.syncing) line.textContent = 'מסנכרן…';
    if (!st.dataChanged) { if (line && !st.syncing && !document.querySelector('.scrim')) render(); return; }
    state._stale = true;
    const busy = document.querySelector('.scrim') || state.review || /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '');
    if (!busy) render().then(watchJobs);
  });
  let backupSeen = 0;
  const wake = () => {
    if (document.visibilityState !== 'visible' || !cloud.signedIn()) return;
    loadPrefs();
    cloud.sync().then(checkJobs).then(() => {
      // The backup's state: on opening, and then every 5 minutes (the settings screen asks by itself).
      if (Date.now() - backupSeen < 5 * 60000) return;
      backupSeen = Date.now();
      refreshBackup();
    });
  };
  document.addEventListener('visibilitychange', wake);
  window.addEventListener('online', wake);
  setInterval(wake, 60000);
  wake();
}

// ---------- Boot ----------
async function boot() {
  try {
    await load();
  } catch (err) {
    console.error(err);
    APP.innerHTML = `<div class="empty">${art('eraser')}<h2>אין גישה לאחסון</h2><p>ייתכן שהדפדפן במצב פרטי. ציורון צריך אחסון מקומי כדי לשמור ציורים.</p></div>`;
    return;
  }
  if (route().name === 'review' || route().name === 'book') history.replaceState(null, '', '#/');
  await render();
  startCloud();
  if ('serviceWorker' in navigator && location.protocol !== 'file:' && !window.__noSW) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
boot();

// Exposed for tests.
window.__tziyuron = { state, render, db, cloud, refreshBackup };
