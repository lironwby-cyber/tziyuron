// Age and date helpers (pure, no DOM).

/** Parse "YYYY-MM-DD" as a local calendar date. */
export function parseDate(str) {
  if (!str || typeof str !== 'string') return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getMonth() !== Number(m[2]) - 1) return null; // e.g. 2025-02-31
  return d;
}

/** Today as "YYYY-MM-DD" in local time. */
export function todayStr(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Whole years and months between birth and date. Null when unknown or before birth. */
export function ageAt(birthStr, dateStr) {
  const b = parseDate(birthStr);
  const d = parseDate(dateStr);
  if (!b || !d || d < b) return null;
  let months = (d.getFullYear() - b.getFullYear()) * 12 + (d.getMonth() - b.getMonth());
  if (d.getDate() < b.getDate()) months -= 1;
  return { years: Math.floor(months / 12), months: months % 12 };
}

/** Hebrew label for an age, e.g. "גיל 4 ו-3 חודשים". */
export function ageLabel(age) {
  if (!age) return '';
  const { years, months } = age;
  if (years === 0) {
    if (months === 0) return 'פחות מחודש';
    if (months === 1) return 'חודש';
    if (months === 2) return 'חודשיים';
    return `${months} חודשים`;
  }
  const y = years === 1 ? 'גיל שנה' : years === 2 ? 'גיל שנתיים' : `גיל ${years}`;
  if (months === 0) return y;
  const m = months === 1 ? 'וחודש' : months === 2 ? 'וחודשיים' : `ו-${months} חודשים`;
  return `${y} ${m}`;
}

/** Heading used to group the timeline, by whole year of age. */
export function ageGroupLabel(age) {
  if (!age) return 'בלי גיל';
  if (age.years === 0) return 'עד גיל שנה';
  if (age.years === 1) return 'גיל שנה';
  if (age.years === 2) return 'גיל שנתיים';
  return `גיל ${age.years}`;
}

const HE_MONTHS = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

const HE_DAYS = ['ראשון', 'שני', 'שלישי', 'רביעי', 'חמישי', 'שישי', 'שבת'];

/** "יום ראשון 24/06/2021" (Saturday is "שבת 26/06/2021"): the way a date is shown everywhere in the app. */
export function formatDate(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return '';
  const day = d.getDay() === 6 ? 'שבת' : `יום ${HE_DAYS[d.getDay()]}`;
  return `${day} ${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

/** "20 בינואר 2026": the date in words, kept so that a search for a month's name still finds its drawings. */
export function formatDateWords(dateStr) {
  const d = parseDate(dateStr);
  if (!d) return '';
  return `${d.getDate()} ב${HE_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}
