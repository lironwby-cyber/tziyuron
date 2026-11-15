// ציורון: the rules of "שיתוף כל המשפחה", with no screen in them, so that they are tested in Node.

/** A phone number as WhatsApp wants it: digits only, with the country code. Israeli numbers by default. Null = not a number. */
export function waPhone(raw, country = '972') {
  let s = String(raw ?? '').trim();
  const plus = s.startsWith('+');
  s = s.replace(/\D/g, '');
  if (!s) return null;
  if (plus) { /* already international */ } else if (s.startsWith('00')) s = s.slice(2);
  else if (s.startsWith(country) && s.length >= 11) { /* typed with the country code and no plus */ } else if (s.startsWith('0')) s = country + s.slice(1);
  else if (s.length <= 9) s = country + s;
  if (s.startsWith(country + '0')) s = country + s.slice(country.length + 1); // "+972 054…"
  return s.length >= 10 && s.length <= 15 ? s : null;
}

/** "עמרי", "עמרי ואיתי", "עמרי, איתי וגיא". */
export function nameList(names) {
  const n = names.map((x) => String(x || '').trim()).filter(Boolean);
  if (n.length < 2) return n[0] || '';
  return `${n.slice(0, -1).join(', ')} ו${n[n.length - 1]}`;
}

/** The message that goes to WhatsApp. The link carries only the invitation code. */
export function inviteMessage({ name, kids = [], link }) {
  const who = nameList(kids);
  return [
    `היי ${String(name || '').trim()},`,
    `הזמנתי אותך לציורון, הארכיון המשפחתי שלנו לציורים${who ? ` של ${who}` : ' של הילדים'}. רואים שם כל ציור חדש, ואפשר גם להוסיף ציורים.`,
    '',
    'הקישור האישי שלך (לאדם אחד, בתוקף לשבוע):',
    link,
    '',
    'איך מצטרפים:',
    '1. פותחים את הקישור.',
    '2. נכנסים, או פותחים חשבון עם אימייל וסיסמה.',
    '3. מתקינים למסך הבית.',
    'באייפון: כפתור השיתוף ואז "הוספה למסך הבית".',
    'באנדרואיד: תפריט כרום ואז "התקנת אפליקציה".',
  ].join('\n');
}

/** Opens WhatsApp on a chat with that number and the message typed in; with no number, WhatsApp asks whom to send to. */
export function waLink(phone, text) {
  const q = `text=${encodeURIComponent(text)}`;
  return phone ? `https://wa.me/${phone}?${q}` : `https://wa.me/?${q}`;
}

/** 'joined' | 'expired' | 'open' for a row of the invitations list. */
export function inviteState(row, now = Date.now()) {
  if (row.used_at) return 'joined';
  return new Date(row.expires_at).getTime() <= now ? 'expired' : 'open';
}

/** The first name and phone of what the phone's contact picker returned. */
export function pickedContact(list) {
  const c = Array.isArray(list) ? list[0] : null;
  if (!c) return null;
  const name = String((c.name && c.name[0]) || '').trim().slice(0, 40);
  const tel = String((c.tel && c.tel[0]) || '').trim();
  return name || tel ? { name, tel } : null;
}
