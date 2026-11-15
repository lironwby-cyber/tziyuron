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
  const out = { dx: 0, dy: 0, rot: 0, sx: 1, sy: 1, anchor: 'center', wrapX: 0, wrapY: 0, wave: 0 };
  const sign = dir === 'left' ? -1 : 1;
  switch (motion) {
    case 'fly':
      out.dx = ax * Math.sin(T * p); out.dy = ay * 0.8 * (Math.sin(T * 2 * p + 1.2) - Math.sin(1.2));
      out.rot = 0.14 * Math.sin(T * p); out.sx = 1 - 0.28 * Math.abs(Math.sin(T * 6 * p));
      break;
    case 'glide':
      out.dx = ax * Math.sin(T * p); out.dy = ay * 0.7 * Math.sin(T * 2 * p); out.rot = 0.1 * Math.sin(T * p);
      break;
    case 'rise':
      out.wrapY = H + f.h; out.dy = -out.wrapY * p; out.dx = 3 * Math.sin(T * 9 * p);
      break;
    case 'swim':
      out.dx = ax * Math.sin(T * p); out.dy = ay * 0.25 * Math.sin(T * 2 * p); out.rot = 0.05 * Math.sin(T * 2 * p); out.wave = 1;
      break;
    case 'drive':
      if (dir === 'left' || dir === 'right') { out.wrapX = W + f.w; out.dx = sign * out.wrapX * p; } else out.dx = ax * Math.sin(T * p);
      out.dy = -2 * Math.abs(Math.sin(T * 10 * p)); out.anchor = 'bottom';
      break;
    case 'walk':
      out.dx = ax * Math.sin(T * p); out.dy = -5 * Math.abs(Math.sin(T * 8 * p)); out.rot = 0.045 * Math.sin(T * 8 * p); out.anchor = 'bottom';
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
      out.sx = s; out.sy = s; out.glow = 0.5 + 0.5 * Math.sin(T * 4 * p);
      break;
    }
    case 'fall':
      out.wrapY = H + f.h; out.dy = out.wrapY * p; out.dx = 10 * Math.sin(T * 3 * p); out.rot = 0.08 * Math.sin(T * 3 * p);
      break;
    case 'float':
      out.dx = ax * 0.6 * Math.sin(T * p); out.dy = -6 * (1 - Math.cos(T * 2 * p)); out.rot = 0.035 * Math.sin(T * 2 * p); out.anchor = 'bottom';
      break;
    default:
  }
  return out;
}
