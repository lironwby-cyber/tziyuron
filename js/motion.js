// Movements that fit what is drawn: "the butterfly flies", "the car drives".
// Pure rules, no DOM: the list of movements, suggestions from a drawing's name, the check of suggestions that
// came from the naming step, and the position of the moving figure at every moment of the 5 second loop.

export const MOTIONS = ['fly', 'glide', 'rise', 'swim', 'drive', 'walk', 'jump', 'sway', 'spin', 'twinkle', 'fall', 'float'];

/** Hebrew words in a drawing's name -> the movement offered. Longer phrases first. */
const WORDS = [
  ['כדור פורח', 'הכדור הפורח עולה', 'rise'], ['בת ים', 'בת הים שוחה', 'swim'], ['בתולת ים', 'בת הים שוחה', 'swim'],
  ['צב ים', 'צב הים שוחה', 'swim'], ['גיבור על', 'גיבור העל עף', 'glide'], ['כוכב ים', 'כוכב הים זז', 'sway'],
  ['פרפר', 'הפרפר עף', 'fly'], ['פרפרים', 'הפרפרים עפים', 'fly'], ['ציפור', 'הציפור עפה', 'fly'], ['ציפורים', 'הציפורים עפות', 'fly'],
  ['דבורה', 'הדבורה עפה', 'fly'], ['יונה', 'היונה עפה', 'fly'], ['תוכי', 'התוכי עף', 'fly'], ['ינשוף', 'הינשוף עף', 'fly'],
  ['עטלף', 'העטלף עף', 'fly'], ['פיה', 'הפיה עפה', 'fly'], ['דרקון', 'הדרקון עף', 'fly'], ['מלאך', 'המלאך עף', 'fly'],
  ['מטוס', 'המטוס טס', 'glide'], ['מסוק', 'המסוק טס', 'glide'], ['עפיפון', 'העפיפון עף', 'glide'], ['חללית', 'החללית טסה', 'glide'],
  ['טיל', 'הטיל ממריא', 'rise'], ['רקטה', 'הרקטה ממריאה', 'rise'], ['בלון', 'הבלון עולה', 'rise'], ['בלונים', 'הבלונים עולים', 'rise'],
  ['דג', 'הדג שוחה', 'swim'], ['דגים', 'הדגים שוחים', 'swim'], ['כריש', 'הכריש שוחה', 'swim'], ['לוויתן', 'הלוויתן שוחה', 'swim'],
  ['לויתן', 'הלוויתן שוחה', 'swim'], ['דולפין', 'הדולפין שוחה', 'swim'], ['תמנון', 'התמנון שוחה', 'swim'], ['ברווז', 'הברווז שוחה', 'swim'],
  ['מדוזה', 'המדוזה שוחה', 'swim'],
  ['מכונית', 'המכונית נוסעת', 'drive'], ['מכוניות', 'המכוניות נוסעות', 'drive'], ['אוטו', 'האוטו נוסע', 'drive'], ['אוטובוס', 'האוטובוס נוסע', 'drive'],
  ['משאית', 'המשאית נוסעת', 'drive'], ['רכבת', 'הרכבת נוסעת', 'drive'], ['טרקטור', 'הטרקטור נוסע', 'drive'], ['אופניים', 'האופניים נוסעים', 'drive'],
  ['אופנוע', 'האופנוע נוסע', 'drive'], ['קורקינט', 'הקורקינט נוסע', 'drive'], ['אמבולנס', 'האמבולנס נוסע', 'drive'], ['כבאית', 'הכבאית נוסעת', 'drive'],
  ['סירה', 'הסירה שטה', 'float'], ['אוניה', 'האונייה שטה', 'float'], ['אונייה', 'האונייה שטה', 'float'], ['ספינה', 'הספינה שטה', 'float'],
  ['ענן', 'הענן נע', 'float'], ['עננים', 'העננים נעים', 'float'],
  ['כלב', 'הכלב הולך', 'walk'], ['חתול', 'החתול הולך', 'walk'], ['סוס', 'הסוס דוהר', 'walk'], ['פיל', 'הפיל הולך', 'walk'],
  ['אריה', 'האריה הולך', 'walk'], ['דינוזאור', 'הדינוזאור הולך', 'walk'], ['צב', 'הצב הולך', 'walk'], ['פרה', 'הפרה הולכת', 'walk'],
  ['כבשה', 'הכבשה הולכת', 'walk'], ['דוב', 'הדוב הולך', 'walk'], ['נמלה', 'הנמלה הולכת', 'walk'], ['חיפושית', 'החיפושית הולכת', 'walk'],
  ['רובוט', 'הרובוט הולך', 'walk'], ['חילזון', 'החילזון זוחל', 'walk'], ['נחש', 'הנחש זוחל', 'walk'], ['גירפה', 'הגירפה הולכת', 'walk'],
  ['צפרדע', 'הצפרדע קופצת', 'jump'], ['ארנב', 'הארנב קופץ', 'jump'], ['קנגורו', 'הקנגורו קופץ', 'jump'], ['כדור', 'הכדור קופץ', 'jump'],
  ['ילד', 'הילד קופץ', 'jump'], ['ילדה', 'הילדה קופצת', 'jump'], ['ילדים', 'הילדים קופצים', 'jump'], ['איש', 'האיש קופץ', 'jump'],
  ['קוף', 'הקוף קופץ', 'jump'], ['משפחה', 'המשפחה קופצת', 'jump'],
  ['פרח', 'הפרח מתנדנד ברוח', 'sway'], ['פרחים', 'הפרחים מתנדנדים ברוח', 'sway'], ['עץ', 'העץ מתנדנד ברוח', 'sway'],
  ['עצים', 'העצים מתנדנדים ברוח', 'sway'], ['דשא', 'הדשא זז ברוח', 'sway'], ['דגל', 'הדגל מתנופף', 'sway'], ['נדנדה', 'הנדנדה מתנדנדת', 'sway'],
  ['שמש', 'השמש מסתובבת', 'spin'], ['גלגל', 'הגלגל מסתובב', 'spin'], ['סביבון', 'הסביבון מסתובב', 'spin'], ['קרוסלה', 'הקרוסלה מסתובבת', 'spin'],
  ['שבשבת', 'השבשבת מסתובבת', 'spin'],
  ['כוכב', 'הכוכב מנצנץ', 'twinkle'], ['כוכבים', 'הכוכבים מנצנצים', 'twinkle'], ['ירח', 'הירח זוהר', 'twinkle'], ['לב', 'הלב פועם', 'twinkle'],
  ['לבבות', 'הלבבות פועמים', 'twinkle'], ['נר', 'הנר מהבהב', 'twinkle'], ['נרות', 'הנרות מהבהבים', 'twinkle'], ['חנוכיה', 'הנרות מהבהבים', 'twinkle'],
  ['חנוכייה', 'הנרות מהבהבים', 'twinkle'], ['זיקוקים', 'הזיקוקים מנצנצים', 'twinkle'], ['קשת', 'הקשת זוהרת', 'twinkle'], ['כתר', 'הכתר מנצנץ', 'twinkle'],
  ['גשם', 'הגשם יורד', 'fall'], ['שלג', 'השלג יורד', 'fall'], ['עלים', 'העלים נושרים', 'fall'],
];
const KEYS = new Map(WORDS.filter(([k]) => !k.includes(' ')).map(([k, label, motion]) => [k, { label, motion }]));
const PHRASES = WORDS.filter(([k]) => k.includes(' '));
const PREFIX = 'הובלמכש';

const clean = (s) => String(s || '').normalize('NFKD').replace(/[֑-ׇ]/g, '').replace(/[^א-ת\s]/g, ' ').replace(/\s+/g, ' ').trim();

function wordMatch(word) {
  if (KEYS.has(word)) return KEYS.get(word);
  // "הפרפר", "והכלב", "בגינה": one or two prefix letters, tried only when the word itself is not known.
  for (let n = 1; n <= 2 && n < word.length - 1; n++) {
    if (!PREFIX.includes(word[n - 1])) break;
    const rest = word.slice(n);
    if (KEYS.has(rest)) return KEYS.get(rest);
  }
  return null;
}

/** Up to three movements that fit the words of a name, in the order the words appear. No box: the whole drawing moves. */
export function suggestFromTitle(title) {
  let text = ` ${clean(title)} `;
  const found = [];
  const add = (hit, at) => { if (!found.some((f) => f.label === hit.label)) found.push({ ...hit, at }); };
  for (const [phrase, label, motion] of PHRASES) {
    for (const lead of ['', 'ה', 'ו', 'וה']) {
      const at = text.indexOf(` ${lead}${phrase} `);
      if (at >= 0) { add({ label, motion }, at); text = text.replace(` ${lead}${phrase} `, ' '.repeat(phrase.length + lead.length + 2)); }
    }
  }
  let at = 0;
  for (const word of text.split(' ')) {
    if (word) { const hit = wordMatch(word); if (hit) add(hit, at); }
    at += word.length + 1;
  }
  return found.sort((a, b) => a.at - b.at).slice(0, 3).map(({ label, motion }) => ({ label, motion }));
}

/** Suggestions that came from the naming step are data from outside: keep only what is well formed. */
export function cleanMotions(raw) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const r of raw) {
    if (!r || typeof r !== 'object' || !MOTIONS.includes(r.motion)) continue;
    const label = clean(r.label).slice(0, 30).trim();
    if (label.length < 2 || out.some((o) => o.label === label)) continue;
    const item = { label, motion: r.motion };
    const b = Array.isArray(r.box) && r.box.length === 4 ? r.box.map(Number) : null;
    if (b && b.every((v) => Number.isFinite(v))) {
      const x = Math.min(Math.max(b[0], 0), 1), y = Math.min(Math.max(b[1], 0), 1);
      const w = Math.min(b[2], 1 - x), h = Math.min(b[3], 1 - y);
      if (w >= 0.05 && h >= 0.05) item.box = [x, y, w, h].map((v) => Math.round(v * 1000) / 1000);
    }
    if (r.dir === 'left' || r.dir === 'right') item.dir = r.dir;
    out.push(item);
    if (out.length === 4) break;
  }
  return out;
}

/** A box [x, y, w, h] (0 to 1) after the picture is turned clockwise by 90, 180 or 270 degrees. */
export function turnBox(box, degrees) {
  const [x, y, w, h] = box;
  const r = (v) => Math.round(v * 1000) / 1000;
  const d = ((degrees % 360) + 360) % 360;
  if (d === 90) return [r(1 - y - h), x, h, w];
  if (d === 180) return [r(1 - x - w), r(1 - y - h), w, h];
  if (d === 270) return [y, r(1 - x - w), h, w];
  return [x, y, w, h];
}

/** The same suggestions after the picture was turned: boxes follow, left and right swap on a half turn. */
export function turnMotions(motions, degrees) {
  const d = ((degrees % 360) + 360) % 360;
  return (motions || []).map((m) => {
    const out = { ...m };
    if (m.box) out.box = turnBox(m.box, d);
    if (d !== 0 && d !== 180) delete out.dir; // after a quarter turn the direction is no longer left or right
    else if (d === 180 && m.dir) out.dir = m.dir === 'left' ? 'right' : 'left';
    return out;
  });
}

/**
 * Where the figure is at moment p (0 to 1) of the loop. Every movement returns to its start at p = 1.
 * f = the figure {cx, cy, w, h} on a stage W × H. Returns the shift (dx, dy), the turn (rot, radians),
 * the stretch (sx, sy), the point the turn and stretch hold on to (anchor), and whether the figure
 * leaves one edge and returns from the other (wrapX / wrapY, the distance of one full pass).
 */
export function pose(motion, p, f, W, H, dir) {
  const T = Math.PI * 2;
  const roomX = Math.max(0, Math.min(f.cx - f.w / 2, W - f.cx - f.w / 2));
  const roomY = Math.max(0, Math.min(f.cy - f.h / 2, H - f.cy - f.h / 2));
  const ax = Math.max(14, Math.min(W * 0.24, roomX + f.w * 0.12));
  const ay = Math.max(10, Math.min(H * 0.12, roomY + f.h * 0.1));
  const out = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, anchor: 'center', wrapX: 0, wrapY: 0, wave: 0, glow: 0 };
  const sign = dir === 'left' ? -1 : 1;
  // Back and forth: the figure sets off the way it was drawn facing (dir, right when unknown), and turns
  // around at each end instead of sliding backwards. The turn is a quick squeeze through the middle.
  const across = (k) => {
    out.dx = sign * k * Math.sin(T * p);
    out.sx = facing(p);
  };
  switch (motion) {
    case 'fly':
      across(ax);
      out.dy = ay * 0.8 * (Math.sin(T * 2 * p + 1.2) - Math.sin(1.2));
      out.rot = sign * 0.08 * Math.sin(T * 2 * p);
      out.sy = 1 + 0.06 * Math.sin(T * 8 * p); // a soft beat of the wings, not a flicker of the whole figure
      break;
    case 'glide':
      across(ax); out.dy = ay * 0.7 * Math.sin(T * 2 * p); out.rot = sign * 0.06 * Math.sin(T * 2 * p);
      break;
    case 'rise':
      out.wrapY = H + f.h; out.dy = -out.wrapY * p; out.dx = 3 * Math.sin(T * 9 * p);
      break;
    case 'swim':
      across(ax); out.dy = ay * 0.25 * Math.sin(T * 2 * p); out.rot = 0.05 * Math.sin(T * 2 * p); out.wave = 1;
      break;
    case 'drive':
      if (dir === 'left' || dir === 'right') { out.wrapX = W + f.w; out.dx = sign * out.wrapX * p; } else across(ax);
      out.dy = -2 * Math.abs(Math.sin(T * 10 * p)); out.anchor = 'bottom';
      break;
    case 'walk':
      across(ax); out.dy = -5 * Math.abs(Math.sin(T * 8 * p)); out.rot = 0.045 * Math.sin(T * 8 * p); out.anchor = 'bottom';
      break;
    case 'jump': {
      const q = (p * 4) % 1, up = 4 * q * (1 - q);
      out.dy = -Math.max(24, Math.min(H * 0.16, roomY + f.h * 0.25)) * up; out.sy = 0.92 + 0.16 * up; out.sx = 1.06 - 0.1 * up; out.anchor = 'bottom';
      break;
    }
    case 'sway':
      out.rot = 0.09 * Math.sin(T * 2 * p); out.anchor = 'bottom';
      break;
    case 'spin':
      out.rot = sign * T * p;
      break;
    case 'twinkle': {
      const s = 1 + 0.07 * Math.sin(T * 4 * p);
      out.sx = s; out.sy = s; out.glow = 0.5 - 0.5 * Math.cos(T * 4 * p); // 0 at the start and the end of the loop
      break;
    }
    case 'fall':
      out.wrapY = H + f.h; out.dy = out.wrapY * p; out.dx = 10 * Math.sin(T * 3 * p); out.rot = 0.08 * Math.sin(T * 3 * p);
      break;
    case 'float':
      across(ax * 0.6); out.dy = -6 * (1 - Math.cos(T * 2 * p)); out.rot = 0.035 * Math.sin(T * 2 * p); out.anchor = 'bottom';
      break;
    default:
  }
  return out;
}

/**
 * Which way a figure that goes back and forth faces at moment p: 1 as drawn, -1 mirrored. Around the two
 * turning points (p = 0.25 and 0.75) it passes smoothly through 0, which reads as turning around.
 */
export function facing(p) {
  const c = Math.cos(Math.PI * 2 * p);
  return Math.max(-1, Math.min(1, c / 0.18));
}

/** Movements that go somewhere, for which the way the figure faces matters. */
export const DIRECTED = ['fly', 'glide', 'swim', 'drive', 'walk', 'float'];

/**
 * The figure a finger touched: the strokes around point (x, y) of a stage of width W, joined when they are
 * closer than a few pixels, as a box [x, y, w, h] from 0 to 1 of the drawing's place R on the stage.
 * d = RGBA pixels of the stage, paper = [r, g, b] of the page. Returns null when nothing is drawn near the touch.
 */
export function inkRegion(d, W, R, paper, x, y) {
  const CELL = 4, GAP = 2; // cells of 4 px; strokes up to 2 cells (8 px) apart belong to one figure
  const cw = Math.ceil(R.w / CELL), ch = Math.ceil(R.h / CELL);
  const ink = new Uint8Array(cw * ch);
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      let hit = 0;
      for (let yy = 0; yy < CELL && !hit; yy++) {
        const py = R.y + cy * CELL + yy;
        if (py >= R.y + R.h) break;
        for (let xx = 0; xx < CELL; xx++) {
          const px = R.x + cx * CELL + xx;
          if (px >= R.x + R.w) break;
          const i = (py * W + px) * 4;
          if (Math.max(Math.abs(d[i] - paper[0]), Math.abs(d[i + 1] - paper[1]), Math.abs(d[i + 2] - paper[2])) > 48) { hit = 1; break; }
        }
      }
      ink[cy * cw + cx] = hit;
    }
  }
  // Start at the touched cell, or at the nearest ink within a fingertip (about 40 px).
  const tx = Math.floor((x - R.x) / CELL), ty = Math.floor((y - R.y) / CELL);
  let start = -1, best = Infinity;
  const reach = Math.ceil(40 / CELL);
  for (let cy = Math.max(0, ty - reach); cy <= Math.min(ch - 1, ty + reach); cy++) {
    for (let cx = Math.max(0, tx - reach); cx <= Math.min(cw - 1, tx + reach); cx++) {
      if (!ink[cy * cw + cx]) continue;
      const dist = (cx - tx) ** 2 + (cy - ty) ** 2;
      if (dist < best) { best = dist; start = cy * cw + cx; }
    }
  }
  if (start < 0 || best > reach * reach) return null;
  const seen = new Uint8Array(cw * ch);
  const stack = [start];
  seen[start] = 1;
  let x0 = cw, y0 = ch, x1 = -1, y1 = -1;
  while (stack.length) {
    const c = stack.pop();
    const cx = c % cw, cy = (c - cx) / cw;
    if (cx < x0) x0 = cx; if (cx > x1) x1 = cx; if (cy < y0) y0 = cy; if (cy > y1) y1 = cy;
    for (let ny = Math.max(0, cy - GAP); ny <= Math.min(ch - 1, cy + GAP); ny++) {
      for (let nx = Math.max(0, cx - GAP); nx <= Math.min(cw - 1, cx + GAP); nx++) {
        const n = ny * cw + nx;
        if (ink[n] && !seen[n]) { seen[n] = 1; stack.push(n); }
      }
    }
  }
  const r = (v) => Math.round(v * 1000) / 1000;
  const bx = (x0 * CELL) / R.w, by = (y0 * CELL) / R.h;
  const bw = Math.min(1 - bx, ((x1 - x0 + 1) * CELL) / R.w), bh = Math.min(1 - by, ((y1 - y0 + 1) * CELL) / R.h);
  return [r(bx), r(by), r(Math.max(0.02, bw)), r(Math.max(0.02, bh))];
}
