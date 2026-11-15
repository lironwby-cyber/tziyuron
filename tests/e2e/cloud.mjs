// End-to-end test of the family archive: two devices (a parent and a grandmother) against a stand-in server.
// Usage: node tests/e2e/cloud.mjs
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
import { startMock } from './mock-supabase.mjs';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(execFileSync('npm', ['root', '-g']).toString().trim(), 'playwright')); }
const { chromium } = playwright;

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fx = join(root, 'tests', 'fixtures');
const outDir = join(root, 'tests', 'e2e', 'out');
mkdirSync(outDir, { recursive: true });

const PORT = 8766, API = 8767;
const web = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
const mock = await startMock(API);
await new Promise((r) => setTimeout(r, 800));
const BASE = `http://127.0.0.1:${PORT}/`;
const api = (path, body) => fetch(`http://127.0.0.1:${API}${path}`, { method: 'POST', body: JSON.stringify(body || {}) }).then((r) => r.json());
await api('/__test/user', { email: 'aba@example.com', password: 'secret-aba' });
await api('/__test/user', { email: 'savta@example.com', password: 'secret-savta' });

const browser = await chromium.launch();
const errors = [];
async function device(name) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: Number(process.env.SHOT_SCALE) || 1 });
  await context.addInitScript((url) => { window.__tziyuronCloud = { url }; window.__noSW = true; }, `http://127.0.0.1:${API}`);
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
  return page;
}
const A = await device('A');
const B = await device('B');

let step = 0;
const results = [];
async function check(name, fn) {
  step++;
  try { await fn(); results.push(`ok ${step} - ${name}`); } catch (err) {
    results.push(`not ok ${step} - ${name}\n   ${String(err.message).split('\n').slice(0, 5).join('\n   ')}`);
    await A.screenshot({ path: join(outDir, `cloud-fail-${step}-A.png`) }).catch(() => {});
    await B.screenshot({ path: join(outDir, `cloud-fail-${step}-B.png`) }).catch(() => {});
    throw err;
  }
}
const sync = (page) => page.evaluate(() => window.__tziyuron.cloud.sync());
const settled = (page) => page.waitForFunction(() => {
  const c = window.__tziyuron.cloud;
  const st = c.getStatus();
  return c.signedIn() && !st.syncing && !st.pending && !st.error && st.lastSyncAt > 0;
}, null, { timeout: 20000 });
const signIn = async (page, email, password) => {
  await page.getByLabel('אימייל').fill(email);
  await page.getByLabel('סיסמה').fill(password);
  await page.getByRole('button', { name: 'כניסה', exact: true }).click();
};
const who = async (page, name) => {
  const d = page.getByRole('dialog', { name: 'מי משתמש במכשיר הזה?' });
  await d.waitFor({ timeout: 15000 });
  await d.getByRole('button', { name }).click();
  await d.waitFor({ state: 'detached' });
};
const typePin = async (page, pin) => {
  for (const digit of pin) await page.getByRole('dialog').getByRole('button', { name: digit, exact: true }).click();
};
const loaded = (page, sel) => page.waitForFunction((s) => { const el = document.querySelector(s); return el && (el.naturalWidth > 0 || el.readyState >= 1); }, sel, { timeout: 15000 });

try {
  await check('device A: a child and a drawing saved before any sign-in stay local', async () => {
    await A.goto(BASE);
    await A.getByText('הוספת ילד ראשון').click();
    await A.getByLabel('שם', { exact: true }).fill('נועה');
    await A.getByLabel('תאריך לידה').fill('2020-03-10');
    await A.getByRole('button', { name: 'שמירה' }).click();
    await A.getByText('עוד אין כאן ציורים של נועה').waitFor();
    await A.getByRole('button', { name: 'הוספה' }).click();
    const fc = A.waitForEvent('filechooser');
    await A.getByText('ציורים מהגלריה').click();
    await (await fc).setFiles(join(fx, 'scene.jpg'));
    await A.getByRole('img', { name: 'תוצאה 1' }).waitFor({ timeout: 20000 });
    await A.getByLabel('שם הציור 1').fill('טיל לירח');
    await A.getByRole('button', { name: 'שמירה' }).click();
    await A.getByRole('heading', { name: 'טיל לירח' }).waitFor();
    assert.equal(mock.tables.art_children.length, 0);
    assert.equal(mock.log.filter((l) => !l.includes('__test')).length, 0, 'no request before sign-in');
  });

  await check('device A: wrong password is refused, right one signs in and sends everything', async () => {
    await A.goto(BASE + '#/settings');
    await A.getByRole('button', { name: 'כניסה או חשבון חדש' }).click();
    await signIn(A, 'aba@example.com', 'wrong-one');
    await A.getByText('האימייל או הסיסמה לא נכונים.').waitFor();
    await signIn(A, 'aba@example.com', 'secret-aba');
    // Once on every device, right after signing in: a parent's device or a child's?
    await who(A, 'הורה');
    await settled(A);
    await A.getByText('הכול מסונכרן').first().waitFor();
    assert.equal(mock.tables.art_children.length, 1);
    assert.equal(mock.tables.art_children[0].name, 'נועה');
    assert.equal(mock.tables.art_children[0].birth_date, '2020-03-10');
    assert.equal(mock.tables.art_memories.length, 1);
    const row = mock.tables.art_memories[0];
    assert.equal(row.title, 'טיל לירח');
    const ids = Object.keys(row.files);
    assert.equal(ids.length, 3, 'image, original and thumbnail');
    for (const id of ids) assert.ok(mock.files.has(`${row.child_id}/${id}`), 'file uploaded under the child folder');
    await A.screenshot({ path: join(outDir, 'cloud-01-settings.png'), fullPage: true });
  });

  let code;
  await check('device A: the family sheet lists the parent and makes a one-time invitation', async () => {
    await A.getByRole('button', { name: 'משפחה' }).click();
    await A.getByRole('heading', { name: 'המשפחה של נועה' }).waitFor();
    await A.getByText('אני', { exact: true }).waitFor();
    await A.waitForTimeout(600);
    await A.screenshot({ path: join(outDir, 'cloud-02-family.png') });
    await A.getByRole('button', { name: 'הזמנת בן משפחה' }).click();
    await A.waitForFunction(() => true);
    await new Promise((r) => setTimeout(r, 500));
    assert.equal(mock.tables.art_invites.length, 1);
    code = mock.tables.art_invites[0].code;
    await A.getByRole('button', { name: 'סגירה' }).click();
  });

  await check('device B: the invitation link signs in, asks for a name and brings the child with the drawing', async () => {
    await B.goto(`${BASE}#/join/${code}`);
    await signIn(B, 'savta@example.com', 'secret-savta');
    await B.getByLabel('שם', { exact: true }).fill('סבתא רותי');
    await B.getByRole('button', { name: 'הצטרפות' }).click();
    // The new member is shown how to keep the app on the phone's home screen.
    await B.getByRole('heading', { name: 'ציורון כאפליקציה בטלפון' }).waitFor({ timeout: 15000 });
    assert.equal(await B.locator('.steps li').count(), 4);
    await B.waitForTimeout(3200);
    await B.screenshot({ path: join(outDir, 'cloud-03a-install.png') });
    await B.getByRole('button', { name: 'אייפון' }).click();
    await B.locator('[data-steps="ios-safari"]').waitFor();
    await B.getByText('גוללים ברשימה ובוחרים "הוסף למסך הבית".').waitFor();
    assert.equal(await B.getByRole('dialog', { name: 'מי משתמש במכשיר הזה?' }).count(), 0, 'the question waits for the guide to close');
    await B.getByRole('button', { name: 'הבנתי' }).click();
    await who(B, 'הורה');
    await B.getByRole('button', { name: 'נועה', exact: true }).waitFor({ timeout: 15000 });
    await B.getByText('טיל לירח').first().waitFor();
    await loaded(B, '.frame img');
    await B.screenshot({ path: join(outDir, 'cloud-03-joined.png') });
    await B.getByText('טיל לירח').first().click();
    await loaded(B, '[data-main]');
    const w = await B.evaluate(() => document.querySelector('[data-main]').naturalWidth);
    assert.ok(w > 600, `full drawing downloaded on demand (${w}px)`);
  });

  await check('the install guide matches the phone in hand, and is always in the settings', async () => {
    for (const [ua, steps, tab] of [
      ['Mozilla/5.0 (iPhone; CPU iPhone OS 27_3_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/158.0.8127.35 Mobile/15E148 Safari/604.1', 'ios-chrome', 'אייפון'],
      ['Mozilla/5.0 (iPhone; CPU iPhone OS 27_3_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.3 Mobile/15E148 Safari/604.1', 'ios-safari', 'אייפון'],
      ['Mozilla/5.0 (Linux; Android 16; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Mobile Safari/537.36', 'android', 'אנדרואיד'],
      ['Mozilla/5.0 (Linux; Android 16; SM-S938B) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/29.0 Chrome/150.0.0.0 Mobile Safari/537.36', 'samsung', 'אנדרואיד'],
    ]) {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, userAgent: ua, deviceScaleFactor: Number(process.env.SHOT_SCALE) || 1 });
      const P = await ctx.newPage();
      await P.goto(BASE + '#/settings');
      await P.getByRole('button', { name: 'איך שומרים במסך הבית' }).click();
      await P.locator(`[data-steps="${steps}"]`).waitFor();
      assert.equal(await P.getByRole('button', { name: tab }).getAttribute('aria-pressed'), 'true', `${steps} opens on its own tab`);
      assert.equal(await P.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) <= 0, true);
      await P.waitForTimeout(400);
      await P.screenshot({ path: join(outDir, `cloud-03b-install-${steps}.png`) });
      await ctx.close();
    }
  });

  await check('a used invitation does not work a second time', async () => {
    const r = await B.evaluate((c) => window.__tziyuron.cloud.acceptInvite(c, 'x').then(() => 'ok', (e) => e.message), code);
    assert.equal(r, 'invite is not valid');
  });

  await check('device B edits the parent\'s drawing and adds a memory; device A receives both', async () => {
    await B.getByRole('button', { name: 'עריכה' }).click();
    await B.getByLabel('כותרת').fill('טיל לירח של נועה');
    await B.getByRole('button', { name: 'שמירה' }).click();
    await B.getByRole('heading', { name: 'טיל לירח של נועה' }).waitFor();
    await settled(B);
    await A.goto(BASE);
    await sync(A);

    await A.getByText('טיל לירח של נועה').first().waitFor();
    assert.equal(mock.tables.art_memories[0].title, 'טיל לירח של נועה');
    assert.equal(mock.tables.art_memories.length, 1);
  });

  await check('device A: the family sheet now shows the grandmother by name', async () => {
    await A.goto(BASE + '#/settings');
    await A.getByRole('button', { name: 'משפחה' }).click();
    await A.getByText('סבתא רותי').waitFor();
    assert.equal(await A.getByRole('button', { name: 'הסרה' }).count(), 1, 'only the other member can be removed');
    await A.getByRole('button', { name: 'סגירה' }).click();
  });

  let jobId;
  await check('device A asks for an AI animation: status "בהכנה", then the clip arrives by itself', async () => {
    await A.goto(BASE);
    await A.getByText('טיל לירח של נועה').first().click();
    await A.getByRole('button', { name: 'הנפשה' }).click();
    await A.getByRole('button', { name: 'הטיל ממריא' }).click();
    await A.getByRole('heading', { name: 'הטיל ממריא' }).waitFor();
    await A.waitForTimeout(500);
    await A.screenshot({ path: join(outDir, 'cloud-04a-where.png') });
    await A.getByRole('button', { name: /הנפשה חכמה/ }).click();
    await A.getByText('ההנפשה בהכנה', { exact: true }).waitFor();
    await A.screenshot({ path: join(outDir, 'cloud-04-preparing.png') });
    assert.equal(mock.tables.art_animation_jobs.length, 1);
    const job = mock.tables.art_animation_jobs[0];
    assert.equal('hint' in job, false, 'a server without the new column still gets the request');
    jobId = job.id;
    assert.equal(job.status, 'queued');
    assert.ok(mock.files.has(job.source_path), 'the job points at the uploaded drawing');
    // A second tap does not make a second (paid) job.
    await A.getByRole('button', { name: 'הנפשה' }).click();
    await A.getByText('ההנפשה כבר בהכנה').waitFor();
    assert.equal(mock.tables.art_animation_jobs.length, 1);
    // The other device sees the status too.
    await settled(A);
    await sync(B);
    await B.goto(BASE);
    await B.getByText('טיל לירח של נועה').first().click();
    await B.getByText('ההנפשה בהכנה', { exact: true }).waitFor();
    // The server finishes the clip.
    const clip = execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x120:rate=10:duration=1', '-pix_fmt', 'yuv420p', '-c:v', 'libx264', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', '-']);
    await api('/__test/finish-job', { id: jobId, status: 'done', data: clip.toString('base64') });
    await A.getByText('ההנפשה מוכנה').waitFor({ timeout: 20000 });
    await loaded(A, '.voice.video video');
    assert.equal(await A.getByText('ההנפשה בהכנה', { exact: true }).count(), 0);
    await A.screenshot({ path: join(outDir, 'cloud-05-ready.png'), fullPage: true });
  });

  await check('device B gets the finished clip without doing anything', async () => {
    await settled(A);
    await sync(B);
    await loaded(B, '.voice.video video');
    assert.equal(await B.getByText('ההנפשה בהכנה', { exact: true }).count(), 0);
    assert.equal(mock.tables.art_animation_jobs.length, 1, 'still one job');
  });

  await check('a failed job shows a calm message and can be dismissed', async () => {
    await A.getByRole('button', { name: 'הנפשה' }).click();
    await A.getByRole('button', { name: 'תנועה עדינה של כל הציור' }).click();
    await A.getByRole('button', { name: /הנפשה חכמה/ }).click();
    await A.getByText('ההנפשה בהכנה', { exact: true }).waitFor();
    const job = mock.tables.art_animation_jobs.find((j) => j.id !== jobId);
    await api('/__test/finish-job', { id: job.id, status: 'failed' });
    await A.getByText('ההנפשה לא הצליחה').waitFor({ timeout: 20000 });
    await A.getByRole('button', { name: 'הבנתי' }).click();
    await A.getByText('ההנפשה לא הצליחה').waitFor({ state: 'detached' });
  });

  await check('device B deletes the drawing: it disappears on device A and its files leave the archive', async () => {
    await settled(A);
    await sync(B);
    await B.getByRole('button', { name: 'מחיקה' }).click();
    await B.getByRole('dialog').getByRole('button', { name: 'מחיקה' }).click();
    await B.getByText('עוד אין כאן ציורים של נועה').waitFor();
    await settled(B);
    assert.equal(mock.tables.art_memories.length, 0);
    assert.equal([...mock.files.keys()].filter((p) => !p.includes('/anim/')).length, 0, 'drawing files removed');
    await settled(A);
    await sync(A);
    await A.goto(BASE);
    await A.getByText('עוד אין כאן ציורים של נועה').waitFor();
  });

  await check('device A removes the grandmother: the child leaves device B', async () => {
    await A.goto(BASE + '#/settings');
    await A.getByRole('button', { name: 'משפחה' }).click();
    await A.getByRole('button', { name: 'הסרה' }).click();
    await A.getByRole('dialog').last().getByRole('button', { name: 'הסרה' }).click();
    await A.waitForFunction(() => !document.body.innerText.includes('סבתא רותי'));
    assert.equal(mock.tables.art_child_members.length, 1);
    await sync(B);
    await B.goto(BASE);
    await B.getByText('הוספת ילד ראשון').waitFor();
    await A.getByRole('button', { name: 'סגירה' }).click();
  });

  const importDrawing = async (title) => {
    await A.goto(BASE);
    await A.getByRole('button', { name: 'הוספה' }).click();
    const fc = A.waitForEvent('filechooser');
    await A.getByText('ציורים מהגלריה').click();
    await (await fc).setFiles(join(fx, 'scene.jpg'));
    await A.getByRole('img', { name: 'תוצאה 1' }).waitFor({ timeout: 20000 });
    if (title) await A.getByLabel('שם הציור 1').fill(title);
    await A.getByRole('button', { name: 'שמירה' }).click();
  };

  await check('a drawing saved without a name gets one by itself, marked as automatic', async () => {
    mock.titles.push('טיל כחול');
    await importDrawing('');
    await A.getByRole('heading', { name: 'טיל כחול' }).waitFor({ timeout: 20000 });
    await A.locator('[data-auto-title]').waitFor();
    await settled(A);
    assert.equal(mock.tables.art_memories.at(-1).title, 'טיל כחול');
    assert.equal(mock.titleCalls.length, 1);
    await A.screenshot({ path: join(outDir, 'cloud-06-auto-title.png') });
  });

  await check('the automatic name can be edited, and then it is no longer marked', async () => {
    await A.getByRole('button', { name: 'עריכה' }).click();
    await A.getByLabel('כותרת').fill('החללית של נועה');
    await A.getByRole('button', { name: 'שמירה' }).click();
    await A.getByRole('heading', { name: 'החללית של נועה' }).waitFor();
    assert.equal(await A.locator('[data-auto-title]').count(), 0);
    await settled(A);
    assert.equal(mock.tables.art_memories.at(-1).title, 'החללית של נועה');
    assert.equal(mock.tables.art_memories.at(-1).details.autoTitle, undefined);
  });

  await check('a typed name is kept and nothing is sent for naming', async () => {
    await importDrawing('הים בקיץ');
    await A.getByRole('heading', { name: 'הים בקיץ' }).waitFor();
    await settled(A);
    assert.equal(mock.titleCalls.length, 1, 'no title request for a named drawing');
  });

  await check('an unclear drawing stays without a name, and a name can be asked for again', async () => {
    mock.titles.push(null);
    await importDrawing('');
    await A.getByRole('button', { name: 'הצעת שם' }).waitFor({ timeout: 20000 });
    assert.equal(await A.locator('[data-auto-title]').count(), 0);
    mock.titles.push('הר ושמש');
    await A.getByRole('button', { name: 'הצעת שם' }).click();
    await A.getByRole('heading', { name: 'הר ושמש' }).waitFor();
    assert.equal(mock.titleCalls.length, 3);
  });

  const mainSize = () => A.locator('img[data-main]').evaluate((i) => (i.complete && i.naturalWidth ? `${i.naturalWidth}x${i.naturalHeight}` : ''));
  const sizeChanges = async (from) => {
    for (let i = 0; i < 100; i++) { const now = await mainSize(); if (now && now !== from) return now; await A.waitForTimeout(100); }
    throw new Error('the picture did not change');
  };
  const flip = (size) => size.split('x').reverse().join('x');

  await check('a saved drawing can be turned a quarter turn, and the turn reaches the archive', async () => {
    const before = await sizeChanges('');
    await A.getByRole('button', { name: 'סיבוב' }).click();
    assert.equal(await sizeChanges(before), flip(before));
    await settled(A);
    const row = mock.tables.art_memories.at(-1);
    assert.equal(row.details.rot, 90);
    assert.equal(row.details.rotUser, true);
    await A.getByRole('button', { name: 'סיבוב' }).click();
    assert.equal(await sizeChanges(flip(before)), before);
    await settled(A);
    assert.equal(mock.tables.art_memories.at(-1).details.rot, 180);
    assert.equal(mock.files.size, new Set(mock.files.keys()).size);
  });

  await check('the save screen has a turn button too', async () => {
    await A.goto(BASE);
    await A.getByRole('button', { name: 'הוספה' }).click();
    const fc = A.waitForEvent('filechooser');
    await A.getByText('ציורים מהגלריה').click();
    await (await fc).setFiles(join(fx, 'scene.jpg'));
    const preview = A.getByRole('img', { name: 'תוצאה 1' });
    await preview.waitFor({ timeout: 20000 });
    const size = () => preview.evaluate((i) => (i.complete && i.naturalWidth ? `${i.naturalWidth}x${i.naturalHeight}` : ''));
    let before = ''; for (let i = 0; i < 50 && !before; i++) { before = await size(); await A.waitForTimeout(100); }
    await A.getByRole('button', { name: 'סיבוב' }).click();
    let after = before; for (let i = 0; i < 100 && (after === before || !after); i++) { await A.waitForTimeout(100); after = await preview.evaluate((i) => (i.complete && i.naturalWidth ? `${i.naturalWidth}x${i.naturalHeight}` : '')).catch(() => ''); }
    assert.equal(after, flip(before));
    await A.screenshot({ path: join(outDir, 'cloud-08-turn.png') });
    await A.getByLabel('שם הציור 1').fill('ציור מסובב');
    await A.getByRole('button', { name: 'שמירה' }).click();
    await A.getByRole('heading', { name: 'ציור מסובב' }).waitFor();
    assert.equal(await sizeChanges(''), after);
    await settled(A);
    assert.equal(mock.tables.art_memories.at(-1).details.rot, 90);
  });

  await check('the naming step also says which way is up, and the drawing is turned by itself', async () => {
    mock.titles.push('פרפר צהוב');
    mock.turns.push(90);
    await importDrawing('');
    await A.getByRole('heading', { name: 'פרפר צהוב' }).waitFor({ timeout: 20000 });
    await A.getByText('סובבתי את הציור').waitFor({ timeout: 20000 });
    await settled(A);
    const row = mock.tables.art_memories.at(-1);
    assert.equal(row.details.rot, 90);
    assert.equal(row.details.rotUser, undefined);
  });

  await check('the naming step also says what can move: the suggestions are offered, and the choice goes with a paid request', async () => {
    mock.titles.push('פרפר בגינה');
    mock.motionSets.push([
      { label: 'הפרפר עף', motion: 'fly', box: [0.25, 0.2, 0.45, 0.4], dir: 'none' },
      { label: 'הפרחים זזים ברוח', motion: 'sway', box: [0.1, 0.6, 0.8, 0.35], dir: 'none' },
      { label: 'drop table', motion: 'fly' },
    ]);
    await importDrawing('');
    await A.getByRole('heading', { name: 'פרפר בגינה' }).waitFor({ timeout: 20000 });
    await settled(A);
    assert.deepEqual(mock.tables.art_memories.at(-1).details.motions.map((m) => m.label), ['הפרפר עף', 'הפרחים זזים ברוח']);
    await A.getByRole('button', { name: 'הנפשה' }).click();
    await A.getByText('הצעות לפי מה שמצויר.').waitFor();
    assert.equal(await A.getByRole('button', { name: 'הצעות לפי הציור' }).count(), 0, 'nothing more to look for');
    await A.waitForTimeout(3200);
    await A.screenshot({ path: join(outDir, 'cloud-09-motions.png') });
    await A.getByRole('button', { name: 'הפרפר עף' }).click();
    await A.getByRole('heading', { name: 'הפרפר עף' }).waitFor();
    mock.flags.hint = true;
    const before = mock.tables.art_animation_jobs.length;
    await A.getByRole('button', { name: /הנפשה חכמה/ }).click();
    await A.getByText('ההנפשה בהכנה', { exact: true }).waitFor();
    assert.equal(mock.tables.art_animation_jobs.length, before + 1);
    assert.equal(mock.tables.art_animation_jobs.at(-1).hint, 'fly: הפרפר עף');
  });

  await check('a turn keeps the suggestions on their figures', async () => {
    mock.titles.push('מכונית אדומה');
    mock.turns.push(90);
    mock.motionSets.push([{ label: 'המכונית נוסעת', motion: 'drive', box: [0.1, 0.2, 0.3, 0.4], dir: 'left' }]);
    await importDrawing('');
    await A.getByRole('heading', { name: 'מכונית אדומה' }).waitFor({ timeout: 20000 });
    await A.getByText('סובבתי את הציור').waitFor({ timeout: 20000 });
    await settled(A);
    assert.deepEqual(mock.tables.art_memories.at(-1).details.motions, [{ label: 'המכונית נוסעת', motion: 'drive', box: [0.4, 0.1, 0.4, 0.3] }]);
  });

  await check('no name yet: the animation button says to type one or ask for one, then looks at the drawing for more', async () => {
    mock.titles.push(null);
    await importDrawing('');
    await A.getByRole('button', { name: 'הצעת שם' }).waitFor({ timeout: 20000 });
    await A.getByRole('button', { name: 'הנפשה' }).click();
    await A.getByRole('heading', { name: 'לציור עוד אין שם' }).waitFor();
    await A.getByRole('button', { name: 'שם אוטומטי' }).waitFor();
    await A.waitForTimeout(3200);
    await A.screenshot({ path: join(outDir, 'cloud-10-no-name.png') });
    await A.getByRole('button', { name: 'כתיבת שם עכשיו' }).click();
    await A.getByLabel('כותרת').fill('דג זהב');
    await A.getByRole('button', { name: 'שמירה' }).click();
    await A.getByText('הצעות לפי השם של הציור.').waitFor();
    assert.deepEqual(await A.locator('.motion-opt b').allTextContents(), ['הדג שוחה', 'תנועה עדינה של כל הציור']);
    mock.motionSets.push([{ label: 'הדג הכתום שוחה', motion: 'swim', box: [0.2, 0.3, 0.5, 0.3], dir: 'left' }]);
    await A.getByRole('button', { name: 'הצעות לפי הציור' }).click();
    await A.getByText('הצעות לפי מה שמצויר.').waitFor({ timeout: 20000 });
    assert.equal(mock.wants.at(-1), 'motions');
    await A.getByRole('button', { name: 'הדג הכתום שוחה' }).click();
    await A.getByRole('button', { name: /במכשיר/ }).click();
    await A.waitForFunction(() => document.querySelector('.anim-stage canvas')?.dataset.cut === 'true', null, { timeout: 10000 });
    await A.waitForTimeout(600);
    await A.screenshot({ path: join(outDir, 'cloud-11-fit.png') });
    await A.getByRole('button', { name: 'ביטול' }).click();
    await settled(A);
    assert.equal(mock.tables.art_memories.at(-1).details.motions[0].label, 'הדג הכתום שוחה');
  });

  await check('settings: every paid action has a free route with its price and waiting time', async () => {
    await A.goto(BASE + '#/settings');
    await A.getByRole('heading', { name: 'פעולות חכמות' }).waitFor();
    await A.getByText('פחות מעשירית אגורה לציור').waitFor();
    await A.getByRole('group', { name: 'שם אוטומטי לציור' }).getByRole('button', { name: 'חינם' }).click();
    await A.getByText('השם מוכן בעוד כדקה').waitFor();
    await A.getByRole('group', { name: 'הנפשה' }).getByRole('button', { name: 'במכשיר' }).click();
    await A.getByText('חינם ומיידי').waitFor();
    // The choice is kept with the account, so every device follows it.
    for (let i = 0; i < 50 && !([...mock.users.values()].some((u) => u.meta && u.meta.tziyuron && u.meta.tziyuron.animRoute === 'local')); i++) await A.waitForTimeout(100);
    const meta = [...mock.users.values()].map((u) => u.meta && u.meta.tziyuron).find(Boolean);
    assert.deepEqual(meta, { titleRoute: 'free', animRoute: 'local' });
    await A.locator('.panel', { hasText: 'פעולות חכמות' }).screenshot({ path: join(outDir, 'cloud-07-routes.png') });
    assert.equal(await A.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth) <= 0, true, 'no sideways overflow');
  });

  await check('free naming: the app says when the name will be ready, and it arrives by itself', async () => {
    mock.titles.push('בית עם גג אדום');
    mock.turns.push(180);
    await importDrawing('');
    await A.getByText('השם יהיה מוכן בעוד כדקה').first().waitFor({ timeout: 20000 });
    await A.locator('[data-naming]').waitFor();
    // Pressing the animation button meanwhile says to wait for the name.
    await A.getByRole('button', { name: 'הנפשה' }).click();
    await A.locator('[data-name-first]', { hasText: 'השם האוטומטי בדרך ויגיע בעוד כדקה. כדאי להמתין לו' }).waitFor();
    await A.waitForTimeout(500);
    await A.screenshot({ path: join(outDir, 'cloud-12-wait.png') });
    await A.getByRole('button', { name: 'אמתין לשם' }).click();
    await A.getByRole('heading', { name: 'בית עם גג אדום' }).waitFor({ timeout: 30000 });
    await A.locator('[data-auto-title]').waitFor();
    const pic = mock.freePictures.at(-1);
    assert.ok(pic.length > 500 && pic.length < 40000, `small picture is ${pic.length} characters`);
    assert.equal(Buffer.from(pic, 'base64').subarray(0, 2).toString('hex'), 'ffd8', 'a JPEG');
    await A.getByText('סובבתי את הציור').waitFor({ timeout: 30000 });
    await settled(A);
    const row = mock.tables.art_memories.at(-1);
    assert.equal(row.details.rot, 180);
    assert.equal(row.details.turn, undefined, 'the pending turn is cleared once applied');
  });

  await check('free route: movements by the drawing arrive within about a minute', async () => {
    mock.motionSets.push([{ label: 'העשן עולה', motion: 'rise', box: [0.5, 0.05, 0.2, 0.3], dir: 'none' }]);
    await A.getByRole('button', { name: 'הנפשה' }).click();
    await A.getByText('הציור נבדק במסלול החינמי').waitFor();
    await A.getByRole('button', { name: 'הצעות לפי הציור' }).click();
    await A.getByText('ההצעות לפי הציור יהיו מוכנות בעוד כדקה').waitFor({ timeout: 20000 });
    await A.locator('[data-seeking]').waitFor();
    await A.getByText('ההצעות לפי הציור מוכנות').waitFor({ timeout: 30000 });
    assert.equal(await A.locator('[data-seeking]').count(), 0);
    await A.getByRole('button', { name: 'הנפשה' }).click();
    await A.getByRole('button', { name: 'העשן עולה' }).waitFor();
    await A.keyboard.press('Escape');
  });

  await check('animation route "on the device": no sheet and no paid job', async () => {
    const before = mock.tables.art_animation_jobs.length;
    await A.getByRole('button', { name: 'הנפשה' }).click();
    await A.getByRole('dialog').waitFor();
    assert.equal(await A.getByRole('button', { name: /הנפשה חכמה/ }).count(), 0);
    await A.keyboard.press('Escape');
    assert.equal(mock.tables.art_animation_jobs.length, before);
  });

  await check('backup to pCloud: before the server has it, the settings say so and nobody is nagged', async () => {
    await A.goto(BASE + '#/settings');
    await A.locator('[data-backup-head]', { hasText: 'עוד לא הופעל' }).waitFor();
    assert.equal(await A.locator('[data-act="backup-connect"]').count(), 0);
    await A.goto(BASE);
    await A.getByRole('button', { name: 'נועה', exact: true }).waitFor();
    assert.equal(await A.locator('[data-backup-alert]').count(), 0);
  });

  await check('backup to pCloud: the owner is told it is not connected, a member is told who connects it', async () => {
    mock.backup.enabled = true;
    await A.goto(BASE + '#/settings');
    await A.locator('[data-backup-head]', { hasText: 'עוד לא מחובר' }).waitFor();
    await A.getByRole('button', { name: 'חיבור pCloud' }).waitFor();
    await new Promise((r) => setTimeout(r, 600)); await A.evaluate(() => document.querySelector('[data-backup-panel]').scrollIntoView({ block: 'center' }));
    await A.screenshot({ path: join(outDir, 'cloud-20-backup-not-connected.png') });
    await B.goto(BASE + '#/settings');
    await B.locator('[data-backup-head]', { hasText: 'עוד לא מחובר' }).waitFor();
    assert.match(await B.locator('[data-backup-text]').textContent(), /מי שפתח את הארכיון המשפחתי מחבר/);
    assert.equal(await B.locator('[data-act="backup-connect"]').count(), 0, 'a member has no connect button');
    // "Not connected yet" is said in the settings only: the home screen stays quiet, for the owner and for a member.
    await A.evaluate(() => window.__tziyuron.refreshBackup());
    await A.goto(BASE);
    await B.goto(BASE);
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(await A.locator('[data-backup-alert]').count(), 0);
    assert.equal(await B.locator('[data-backup-alert]').count(), 0);
    await A.screenshot({ path: join(outDir, 'cloud-21-home-no-backup-line.png') });
  });

  await check('backup to pCloud: connecting goes to pCloud and back, then every file is copied and the state says so', async () => {
    // pCloud's approval page is played by the test: it approves and sends the browser back, as the server function does.
    await A.route('https://my.pcloud.com/**', (r) => {
      mock.backup.connected = true;
      r.fulfill({ status: 200, contentType: 'text/html', body: `<script>location.replace(${JSON.stringify(BASE + '#/settings/backup-ok')})</script>` });
    });
    await A.goto(BASE + '#/settings');
    await A.getByRole('button', { name: 'חיבור pCloud' }).click();
    await A.locator('[data-backup-head]', { hasText: 'הגיבוי מעודכן' }).waitFor({ timeout: 15000 });
    assert.equal(mock.backup.connects, 1);
    assert.equal(new URL(A.url()).hash, '#/settings', 'the return address is cleaned');
    const total = [...mock.files.keys()].length;
    assert.ok(total > 0);
    assert.match(await A.locator('[data-backup-text]').textContent(), new RegExp(`${total} מתוך ${total} קבצים מגובים ב-pCloud\\. העתקה אחרונה: יום .+ \\d\\d/\\d\\d/\\d{4} בשעה \\d\\d:\\d\\d\\.`));
    assert.equal(await A.locator('[data-act="backup-connect"]').count(), 0);
    await new Promise((r) => setTimeout(r, 600)); await A.evaluate(() => document.querySelector('[data-backup-panel]').scrollIntoView({ block: 'center' }));
    await new Promise((r) => setTimeout(r, 3500)); // the toast leaves
    await A.screenshot({ path: join(outDir, 'cloud-22-backup-up-to-date.png') });
    await A.unroute('https://my.pcloud.com/**');
    await A.goto(BASE);
    await A.getByRole('button', { name: 'נועה', exact: true }).waitFor();
    await A.evaluate(() => window.__tziyuron.refreshBackup());
    assert.equal(await A.locator('[data-backup-alert]').count(), 0, 'no reminder once it is connected and up to date');
  });

  await check('backup to pCloud: a new upload tells the backup at once; waiting and failed files are shown', async () => {
    mock.backup.hold = true;
    const sweeps = mock.backup.sweeps.length;
    await A.evaluate(async () => {
      const t = window.__tziyuron;
      const c = document.createElement('canvas'); c.width = 40; c.height = 40;
      c.getContext('2d').fillRect(5, 5, 20, 20);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg'));
      const id = crypto.randomUUID();
      const child = (await t.db.getAll('children'))[0];
      const mem = { id: crypto.randomUUID(), childId: child.id, type: 'artwork', title: 'גיבוי', caption: '', date: '2026-02-02', image: id };
      await t.db.put('blobs', { id, type: 'image/jpeg', role: 'image', memoryId: mem.id, blob });
      await t.db.put('memories', mem);
      await t.cloud.sync();
    });
    await settled(A);
    assert.ok(mock.backup.sweeps.length > sweeps, 'the upload poked the backup');
    assert.equal(mock.backup.sweeps.at(-1).retry, false);
    const total = [...mock.files.keys()].length;
    await A.goto(BASE + '#/settings');
    await A.locator('[data-backup-head]', { hasText: 'מעתיק…' }).waitFor();
    assert.match(await A.locator('[data-backup-text]').textContent(), new RegExp(`${total - 1} מתוך ${total} קבצים מגובים ב-pCloud\\. קובץ אחד ממתין ויועתק בדקות הקרובות\\.`));
    // One file fails: the state says so, the owner is reminded, and "another try" copies it.
    mock.backup.failed.add([...mock.files.keys()].at(-1));
    await A.reload();
    await A.locator('[data-backup-head]', { hasText: 'חלק מהקבצים לא הועתקו' }).waitFor();
    assert.match(await A.locator('[data-backup-text]').textContent(), /קובץ אחד לא הועתק\./);
    await new Promise((r) => setTimeout(r, 600)); await A.evaluate(() => document.querySelector('[data-backup-panel]').scrollIntoView({ block: 'center' }));
    await A.screenshot({ path: join(outDir, 'cloud-23-backup-failed.png') });
    mock.backup.hold = false;
    await A.getByRole('button', { name: 'ניסיון נוסף' }).click();
    await A.locator('[data-backup-head]', { hasText: 'הגיבוי מעודכן' }).waitFor({ timeout: 15000 });
    assert.equal(mock.backup.sweeps.at(-1).retry, true);
  });

  await check('backup to pCloud: a refused connection is shown to everyone, and only the owner can reconnect or disconnect', async () => {
    mock.backup.problem = true;
    await A.reload();
    await A.locator('[data-backup-head]', { hasText: 'pCloud דחה את החיבור' }).waitFor();
    await A.getByRole('button', { name: 'חיבור מחדש' }).waitFor();
    await B.goto(BASE + '#/settings');
    await B.locator('[data-backup-head]', { hasText: 'pCloud דחה את החיבור' }).waitFor();
    assert.equal(await B.locator('[data-act="backup-connect"], [data-act="backup-disconnect"]').count(), 0);
    mock.backup.problem = false;
    await A.reload();
    await A.locator('[data-backup-head]', { hasText: 'הגיבוי מעודכן' }).waitFor();
    await A.getByRole('button', { name: 'ניתוק', exact: true }).click();
    await A.getByRole('dialog').getByRole('button', { name: 'ניתוק' }).click();
    await A.locator('[data-backup-head]', { hasText: 'עוד לא מחובר' }).waitFor();
    assert.equal(mock.backup.connected, false);
    mock.backup.connected = true; // left connected for the rest of the run
  });

  await check('kids mode: the code follows the account, a child device opens straight on the drawings, and a forgotten code is reset with the password', async () => {
    const pinOf = () => mock.users.get('aba@example.com').meta?.tziyuron?.kidPin;
    await A.goto(BASE + '#/settings');
    await A.getByRole('button', { name: 'מעבר למצב ילדים' }).click();
    await A.getByRole('dialog', { name: 'קוד חדש להורים' }).waitFor();
    await typePin(A, '4821');
    await A.getByRole('dialog', { name: 'שוב, לאישור' }).waitFor();
    await typePin(A, '4821');
    await A.locator('.kid-title').waitFor();
    for (let i = 0; i < 50 && !pinOf(); i += 1) await A.waitForTimeout(100);
    const first = JSON.stringify(pinOf());
    assert.ok(/"hash":"[0-9a-f]{64}"/.test(first) && !first.includes('4821'), 'the account keeps a digest, never the code');

    // A phone that is handed to a child: signs in once, answers "ילד", and no code is asked for (it is already set).
    const C = await device('C');
    await C.goto(BASE + '#/settings');
    await C.getByRole('button', { name: 'כניסה או חשבון חדש' }).click();
    await signIn(C, 'aba@example.com', 'secret-aba');
    await C.getByRole('dialog', { name: 'מי משתמש במכשיר הזה?' }).waitFor({ timeout: 15000 });
    await C.waitForTimeout(400);
    await C.screenshot({ path: join(outDir, 'cloud-24-who.png') });
    await C.getByRole('dialog').getByRole('button', { name: 'ילד' }).click();
    await C.locator('.kid-tile').first().waitFor({ timeout: 20000 });
    assert.equal(await C.getByRole('dialog').count(), 0, 'no new code is asked for');
    assert.equal(await C.locator('.fab, [data-act], [data-go], [data-mem]').count(), 0, 'nothing of the parent screens');

    // The code is forgotten: a wrong code is refused, a wrong password is refused, the right one sets a new code.
    await C.getByRole('button', { name: 'מסך הורים' }).click();
    await typePin(C, '1111');
    await C.getByText('הקוד לא נכון').waitFor();
    assert.equal(await C.locator('.kid-title').count(), 1, 'still on the kids screen');
    await C.getByRole('button', { name: 'מסך הורים' }).click();
    await C.getByRole('button', { name: 'שכחתי את הקוד' }).click();
    await C.getByLabel('סיסמה').fill('not-the-password');
    await C.getByRole('button', { name: 'המשך' }).click();
    await C.getByText('הסיסמה לא נכונה.').waitFor();
    await C.getByLabel('סיסמה').fill('secret-aba');
    await C.getByRole('button', { name: 'המשך' }).click();
    await C.getByRole('dialog', { name: 'קוד חדש להורים' }).waitFor();
    await typePin(C, '7777');
    await C.getByRole('dialog', { name: 'שוב, לאישור' }).waitFor();
    await typePin(C, '7777');
    await C.getByRole('button', { name: 'נועה', exact: true }).waitFor();
    assert.equal(await C.locator('.kid-title').count(), 0, 'back on the parent screen');
    for (let i = 0; i < 50 && JSON.stringify(pinOf()) === first; i += 1) await C.waitForTimeout(100);
    assert.notEqual(JSON.stringify(pinOf()), first, 'the new code reached the account');
    await C.context().close();

    // The first device is still in kids mode after reopening, and now leaves only with the new code.
    await A.reload();
    await A.locator('.kid-title').waitFor();
    for (let i = 0; i < 50; i += 1) {
      if (await A.evaluate((want) => JSON.stringify(window.__tziyuron.state.settings.kidPin) === want, JSON.stringify(pinOf()))) break;
      await A.waitForTimeout(100);
    }
    await A.getByRole('button', { name: 'מסך הורים' }).click();
    await typePin(A, '4821');
    await A.getByText('הקוד לא נכון').waitFor();
    await A.getByRole('button', { name: 'מסך הורים' }).click();
    await typePin(A, '7777');
    await A.getByRole('button', { name: 'נועה', exact: true }).waitFor();
    assert.equal(await A.locator('.kid-title').count(), 0);
  });

  await check('share the whole family: hidden until the server has it', async () => {
    await A.goto(BASE + '#/settings');
    await A.getByRole('button', { name: 'סנכרון עכשיו' }).waitFor();
    await A.waitForTimeout(800);
    assert.equal(await A.getByRole('button', { name: 'שיתוף כל המשפחה' }).count(), 0);
    assert.deepEqual(errors, []);
  });

  let famCode;
  await check('share the whole family: a typed contact, one invitation to all the children, and a WhatsApp message that is ready', async () => {
    mock.flags.familyInvites = true;
    // A second child, so that "all the children" means something.
    await A.goto(BASE + '#/child/new');
    await A.getByLabel('שם', { exact: true }).fill('יובל');
    await A.getByLabel('תאריך לידה').fill('2022-05-01');
    await A.getByRole('button', { name: 'שמירה' }).click();
    for (let i = 0; i < 100 && mock.tables.art_children.length < 2; i += 1) await A.waitForTimeout(100);
    assert.equal(mock.tables.art_children.length, 2);
    await settled(A);
    await A.goto(BASE + '#/settings');
    await A.getByRole('button', { name: 'שיתוף כל המשפחה' }).click();
    const sheet = A.getByRole('dialog', { name: 'שיתוף כל המשפחה' });
    await sheet.getByText('כל הילדים יחד: נועה ויובל').waitFor();
    // A desktop browser has no contact picker: the screen says so, and the name and number are typed.
    assert.equal(await sheet.getByRole('button', { name: 'בחירה מאנשי הקשר' }).count(), 0);
    await sheet.getByText('הדפדפן הזה לא מאפשר לבחור מאנשי הקשר').waitFor();
    await sheet.getByRole('button', { name: 'הכנת ההודעה' }).click();
    await sheet.getByText('צריך שם, כדי שההודעה תהיה אישית.').waitFor();
    await sheet.getByLabel('שם', { exact: true }).fill('דודה מיכל');
    await sheet.getByLabel('מספר טלפון').fill('12ab');
    await sheet.getByRole('button', { name: 'הכנת ההודעה' }).click();
    await sheet.getByText('המספר לא נראה כמו מספר טלפון').waitFor();
    assert.equal(mock.familyInvites.length, 0, 'nothing is made before the form is right');
    await sheet.getByLabel('מספר טלפון').fill('054-123 4567');
    assert.equal(await sheet.getByText('המספר לא נראה כמו מספר טלפון').count(), 0, 'the remark goes away when the number is corrected');
    await A.waitForTimeout(3200);
    await A.screenshot({ path: join(outDir, 'cloud-25-share-form.png') });
    await sheet.getByRole('button', { name: 'הכנת ההודעה' }).click();
    const ready = A.getByRole('dialog', { name: 'ההודעה לדודה מיכל מוכנה' });
    await ready.waitFor();
    assert.equal(mock.familyInvites.length, 1);
    famCode = mock.familyInvites[0].code;
    assert.ok(/^F[0-9a-f]{32}$/.test(famCode));
    assert.ok(!JSON.stringify(mock.familyInvites).includes('541234567'), 'the phone number does not reach the server');
    const link = `${BASE}#/join/${famCode}`;
    const text = await ready.locator('[data-invite-text]').innerText();
    assert.ok(text.startsWith('היי דודה מיכל,') && text.includes('של נועה ויובל.') && text.includes(link), text);
    assert.ok(text.includes('באייפון: כפתור השיתוף ואז "הוספה למסך הבית".') && text.includes('באנדרואיד: תפריט כרום ואז "התקנת אפליקציה".'));
    const href = new URL(await ready.getByRole('link', { name: 'שליחה בוואטסאפ' }).getAttribute('href'));
    assert.equal(href.origin + href.pathname, 'https://wa.me/972541234567');
    assert.equal(href.searchParams.get('text').replace(/\s+/g, ' '), text.replace(/\s+/g, ' '), 'WhatsApp gets the message that is shown');
    await A.waitForTimeout(300);
    await A.screenshot({ path: join(outDir, 'cloud-26-share-message.png') });
    // One press opens WhatsApp on that number (the address is answered here, nothing leaves the test).
    await A.context().route('https://wa.me/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<title>wa</title>' }));
    const [wa] = await Promise.all([A.context().waitForEvent('page'), ready.getByRole('link', { name: 'שליחה בוואטסאפ' }).click()]);
    await wa.waitForLoadState();
    assert.ok(wa.url().startsWith('https://wa.me/972541234567?text='), wa.url().slice(0, 60));
    await wa.close();
    await ready.getByRole('button', { name: 'סגירה' }).click();
    const row = A.locator(`[data-invite-row="${famCode}"]`);
    await row.getByText('דודה מיכל').waitFor();
    await row.getByText('מחכים').waitFor();
    await A.locator('[data-invites]').scrollIntoViewIfNeeded();
  });

  await check('share the whole family: the guest joins once and sees all the children; the link does not work again', async () => {
    await api('/__test/user', { email: 'doda@example.com', password: 'secret-doda' });
    const D = await device('D');
    await D.goto(`${BASE}#/join/${famCode}`);
    await signIn(D, 'doda@example.com', 'secret-doda');
    await D.getByLabel('שם', { exact: true }).fill('מיכל');
    await D.getByRole('button', { name: 'הצטרפות' }).click();
    await D.getByRole('heading', { name: 'ציורון כאפליקציה בטלפון' }).waitFor({ timeout: 15000 });
    await D.getByRole('button', { name: 'הבנתי' }).click();
    await who(D, 'הורה');
    await D.getByRole('button', { name: 'נועה', exact: true }).waitFor({ timeout: 15000 });
    await D.getByRole('button', { name: 'יובל', exact: true }).waitFor();
    const doda = mock.users.get('doda@example.com').id;
    assert.equal(mock.tables.art_child_members.filter((m) => m.user_id === doda && m.display_name === 'מיכל').length, 2, 'attached to both children under the typed name');
    await D.waitForTimeout(400);
    await D.screenshot({ path: join(outDir, 'cloud-27-share-joined.png') });
    // The same link again: by the same person, and by someone else.
    assert.equal(await D.evaluate((c) => window.__tziyuron.cloud.acceptInvite(c, 'x').then(() => 'ok', (e) => e.message), famCode), 'invite is not valid');
    await B.goto(`${BASE}#/join/${famCode}`);
    await B.getByLabel('שם', { exact: true }).fill('סבתא');
    await B.getByRole('button', { name: 'הצטרפות' }).click();
    await B.getByText('ההזמנה לא תקפה או שכבר נעשה בה שימוש').waitFor();
    const savta = mock.users.get('savta@example.com').id;
    assert.equal(mock.tables.art_child_members.filter((m) => m.user_id === savta).length, 0, 'a used link attaches nobody');
    // The inviter's list now says who joined, and the guest (a family member like any other) sees the list too.
    await A.reload();
    await A.locator(`[data-invite-row="${famCode}"]`).getByText('כבר איתנו').waitFor();
    assert.equal(await A.locator(`[data-invite-row="${famCode}"] button`).count(), 0, 'nothing to cancel after joining');
    await D.goto(BASE + '#/settings');
    await D.locator(`[data-invite-row="${famCode}"]`).getByText('דודה מיכל').waitFor();
    await D.context().close();
  });

  await check('share the whole family: a contact picked from the phone fills the form; an unused invitation can be sent again and cancelled', async () => {
    // A phone with a contact picker (Android Chrome): the picker is answered here.
    await A.evaluate(() => {
      Object.defineProperty(navigator, 'contacts', { configurable: true, value: { select: async () => [{ name: ['סבא יוסי'], tel: ['+972 50-765 4321'] }] } });
      return window.__tziyuron.render();
    });
    await A.getByRole('button', { name: 'שיתוף כל המשפחה' }).click();
    const sheet = A.getByRole('dialog', { name: 'שיתוף כל המשפחה' });
    await sheet.getByRole('button', { name: 'בחירה מאנשי הקשר' }).click();
    await A.waitForFunction(() => document.querySelector('#fs-name').value === 'סבא יוסי');
    assert.equal(await sheet.getByLabel('מספר טלפון').inputValue(), '+972 50-765 4321');
    await sheet.getByRole('button', { name: 'הכנת ההודעה' }).click();
    const ready = A.getByRole('dialog', { name: 'ההודעה לסבא יוסי מוכנה' });
    await ready.waitFor();
    assert.ok((await ready.getByRole('link', { name: 'שליחה בוואטסאפ' }).getAttribute('href')).startsWith('https://wa.me/972507654321?text='));
    await ready.getByRole('button', { name: 'סגירה' }).click();
    const code = mock.familyInvites.find((i) => i.invitee_name === 'סבא יוסי').code;
    const row = A.locator(`[data-invite-row="${code}"]`);
    await row.waitFor();
    await A.locator('[data-invites]').evaluate((el) => el.scrollIntoView({ block: 'center' }));
    await A.waitForTimeout(300);
    await A.screenshot({ path: join(outDir, 'cloud-28-share-list.png') });
    // "שליחה שוב" builds the same message for the same number, kept on this phone only.
    await row.getByRole('button', { name: 'שליחה שוב' }).click();
    const again = A.getByRole('dialog', { name: 'ההודעה לסבא יוסי מוכנה' });
    assert.ok((await again.getByRole('link', { name: 'שליחה בוואטסאפ' }).getAttribute('href')).startsWith('https://wa.me/972507654321?text='));
    assert.ok((await again.locator('[data-invite-text]').innerText()).includes(`#/join/${code}`));
    await again.getByRole('button', { name: 'סגירה' }).click();
    // Cancelled: gone from the list, and the link is dead.
    await row.getByRole('button', { name: 'ביטול' }).click();
    await A.getByRole('dialog').getByRole('button', { name: 'ביטול ההזמנה' }).click();
    await row.waitFor({ state: 'detached' });
    assert.equal(mock.familyInvites.some((i) => i.code === code), false);
    assert.equal(await B.evaluate((c) => window.__tziyuron.cloud.acceptInvite(c, 'x').then(() => 'ok', (e) => e.message), code), 'invite is not valid');
    assert.equal(await A.evaluate((c) => (window.__tziyuron.state.settings.invitePhones || {})[c] || null, code), null, 'the number is forgotten with the invitation');
    await A.evaluate(() => { delete navigator.contacts; });
  });

  await check('forgotten password: the sign-in screen sends a reset link, the link sets a new password and signs in, and the token leaves the address', async () => {
    const E = await device('E');
    await E.goto(BASE + '#/settings');
    await E.getByRole('button', { name: 'כניסה או חשבון חדש' }).click();
    // With no address typed, nothing is sent.
    await E.getByRole('button', { name: 'שכחתי סיסמה' }).click();
    await E.getByText('מקלידים את האימייל למעלה').waitFor();
    assert.equal(mock.recovers.length, 0);
    await E.getByLabel('אימייל').fill('savta@example.com');
    await E.waitForTimeout(300);
    await E.screenshot({ path: join(outDir, 'cloud-29-forgot-link.png') });
    await E.getByRole('button', { name: 'שכחתי סיסמה' }).click();
    await E.getByRole('heading', { name: 'שלחנו קישור לאיפוס' }).waitFor();
    await E.getByText('savta@example.com').waitFor();
    assert.equal(mock.recovers.length, 1);
    assert.equal(mock.recovers[0].email, 'savta@example.com');
    assert.equal(mock.recovers[0].redirect, BASE, 'the link in the email comes back to this site');
    await E.waitForTimeout(300);
    await E.screenshot({ path: join(outDir, 'cloud-30-forgot-sent.png') });
    await E.getByRole('button', { name: 'הבנתי' }).click();
    // Asking again within the minute is answered calmly.
    await E.getByRole('button', { name: 'כניסה או חשבון חדש' }).click();
    await E.getByLabel('אימייל').fill('savta@example.com');
    await E.getByRole('button', { name: 'שכחתי סיסמה' }).click();
    await E.getByText('כבר נשלח קישור לפני רגע').waitFor();
    assert.equal(mock.recovers.length, 1);

    // The link from the email, as the server sends the browser back.
    const savta = mock.users.get('savta@example.com');
    await E.goto('about:blank');
    await E.goto(`${BASE}#access_token=tok-${savta.id}&expires_in=3600&refresh_token=ref-${savta.id}&token_type=bearer&type=recovery`);
    const sheet = E.getByRole('dialog', { name: 'סיסמה חדשה' });
    await sheet.waitFor();
    assert.ok(!(await E.evaluate(() => location.href)).includes('access_token'), 'the token is out of the address at once');
    assert.equal(await E.evaluate(() => window.__tziyuron.cloud.signedIn()), false, 'not signed in before a password is chosen');
    await sheet.getByLabel('סיסמה חדשה').fill('abc');
    await sheet.getByLabel('שוב, לאישור').fill('abc');
    await sheet.getByRole('button', { name: 'שמירה וכניסה' }).click();
    await sheet.getByText('הסיסמה צריכה 6 תווים לפחות.').waitFor();
    await sheet.getByLabel('סיסמה חדשה').fill('new-secret-1');
    await sheet.getByLabel('שוב, לאישור').fill('new-secret-2');
    await sheet.getByRole('button', { name: 'שמירה וכניסה' }).click();
    await sheet.getByText('שתי הסיסמאות לא זהות.').waitFor();
    assert.equal(savta.password, 'secret-savta', 'nothing changed yet');
    await sheet.getByLabel('שוב, לאישור').fill('new-secret-1');
    await E.waitForTimeout(300);
    await E.screenshot({ path: join(outDir, 'cloud-31-new-password.png') });
    await sheet.getByRole('button', { name: 'שמירה וכניסה' }).click();
    await E.getByText('הסיסמה הוחלפה, ונכנסת.').waitFor();
    assert.equal(savta.password, 'new-secret-1');
    await who(E, 'הורה');
    assert.equal(await E.evaluate(() => window.__tziyuron.cloud.user().email), 'savta@example.com');
    // The old password no longer signs in, the new one does.
    assert.equal(await E.evaluate(() => window.__tziyuron.cloud.verifyPassword('secret-savta')), false);
    assert.equal(await E.evaluate(() => window.__tziyuron.cloud.verifyPassword('new-secret-1')), true);
    await E.context().close();

    // A link that expired says so, and the address is cleaned as well.
    const F = await device('F');
    await F.goto(`${BASE}#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired`);
    await F.getByText('הקישור לא תקף או שפג תוקפו').waitFor();
    assert.ok(!(await F.evaluate(() => location.href)).includes('error'));
    assert.equal(await F.getByRole('dialog').count(), 0);
    await F.context().close();
  });

  await check('an invitation survives a forgotten password: the guest resets the password from the invitation and still joins', async () => {
    // What happened to a real guest: the link was opened, the password was reset through the email, and the family did not appear.
    await api('/__test/user', { email: 'ran@example.com', password: 'old-secret' });
    const code = (await A.evaluate(() => window.__tziyuron.cloud.createFamilyInvite('רן'))).code;
    const G = await device('G');
    await G.goto(`${BASE}#/join/${code}`);
    await G.getByLabel('אימייל').fill('ran@example.com');
    await G.getByRole('button', { name: 'שכחתי סיסמה' }).click();
    await G.getByRole('heading', { name: 'שלחנו קישור לאיפוס' }).waitFor();
    await G.getByRole('button', { name: 'הבנתי' }).click();
    await G.getByText('כדי להצטרף צריך להיכנס.').waitFor();
    // The email's link comes back to the plain site address: the invitation's code is not in it.
    const ran = mock.users.get('ran@example.com');
    await G.goto('about:blank');
    await G.goto(`${BASE}#access_token=tok-${ran.id}&expires_in=3600&refresh_token=ref-${ran.id}&token_type=bearer&type=recovery`);
    const sheet = G.getByRole('dialog', { name: 'סיסמה חדשה' });
    await sheet.getByLabel('סיסמה חדשה').fill('new-secret-9');
    await sheet.getByLabel('שוב, לאישור').fill('new-secret-9');
    await sheet.getByRole('button', { name: 'שמירה וכניסה' }).click();
    // Signed in, and the invitation that led here is taken up without the link being opened again.
    await G.getByLabel('שם', { exact: true }).fill('רן');
    await G.getByRole('button', { name: 'הצטרפות' }).click();
    await G.getByRole('heading', { name: 'ציורון כאפליקציה בטלפון' }).waitFor({ timeout: 15000 });
    await G.getByRole('button', { name: 'הבנתי' }).click();
    await who(G, 'הורה');
    await G.getByRole('button', { name: 'נועה', exact: true }).waitFor({ timeout: 15000 });
    await G.getByRole('button', { name: 'יובל', exact: true }).waitFor();
    assert.equal(mock.tables.art_child_members.filter((m) => m.user_id === ran.id).length, 2);
    assert.equal(await G.evaluate(() => localStorage.getItem('tziyuron-pending-invite')), null, 'nothing is left waiting');
    // Opening the app again does not ask to join again.
    await G.reload();
    await G.getByRole('button', { name: 'נועה', exact: true }).waitFor();
    assert.equal(await G.getByRole('dialog').count(), 0);
    await G.context().close();
  });

  await check('an invitation survives a later sign-in: opened, left, and taken up after signing in from the settings', async () => {
    await api('/__test/user', { email: 'nurit@example.com', password: 'secret-nurit' });
    const code = (await A.evaluate(() => window.__tziyuron.cloud.createFamilyInvite('נורית'))).code;
    const H = await device('H');
    await H.goto(`${BASE}#/join/${code}`);
    await H.getByLabel('אימייל').waitFor();
    // The guest leaves without signing in, and comes back another time through the plain address.
    await H.goto('about:blank');
    await H.goto(BASE + '#/settings');
    await H.getByRole('button', { name: 'כניסה או חשבון חדש' }).click();
    await signIn(H, 'nurit@example.com', 'secret-nurit');
    await H.getByLabel('שם', { exact: true }).fill('נורית');
    await H.getByRole('button', { name: 'הצטרפות' }).click();
    await H.getByRole('heading', { name: 'ציורון כאפליקציה בטלפון' }).waitFor({ timeout: 15000 });
    await H.getByRole('button', { name: 'הבנתי' }).click();
    await who(H, 'הורה');
    await H.getByRole('button', { name: 'יובל', exact: true }).waitFor({ timeout: 15000 });
    const nurit = mock.users.get('nurit@example.com').id;
    assert.equal(mock.tables.art_child_members.filter((m) => m.user_id === nurit).length, 2);
    assert.equal(await H.evaluate(() => localStorage.getItem('tziyuron-pending-invite')), null);
    await H.context().close();

    // A used or cancelled invitation that is still remembered on a device is dropped after one refusal, not asked forever.
    const I = await device('I');
    await I.goto(BASE);
    await I.evaluate((c) => localStorage.setItem('tziyuron-pending-invite', JSON.stringify({ code: c, at: Date.now() })), code);
    await I.goto('about:blank');
    await I.goto(BASE + '#/settings');
    await I.getByRole('button', { name: 'כניסה או חשבון חדש' }).click();
    await signIn(I, 'savta@example.com', 'new-secret-1');
    await I.getByLabel('שם', { exact: true }).fill('סבתא');
    await I.getByRole('button', { name: 'הצטרפות' }).click();
    await I.getByText('ההזמנה לא תקפה או שכבר נעשה בה שימוש').waitFor();
    assert.equal(await I.evaluate(() => localStorage.getItem('tziyuron-pending-invite')), null);
    await I.context().close();
  });

  await check('sign-out keeps the local copy and stops sending', async () => {
    await A.goto(BASE + '#/settings');
    await A.getByRole('button', { name: 'יציאה', exact: true }).click();
    await A.getByRole('dialog').getByRole('button', { name: 'יציאה' }).click();
    await A.getByRole('button', { name: 'כניסה או חשבון חדש' }).waitFor();
    const before = mock.log.length;
    await A.goto(BASE);
    await A.getByRole('button', { name: 'נועה', exact: true }).waitFor();
    await new Promise((r) => setTimeout(r, 2500));
    assert.equal(mock.log.length, before, 'no request after sign-out');
  });

  await check('no page errors on either device', async () => {
    assert.deepEqual(errors, []);
  });
} catch (err) {
  console.error(String(err.stack || err).split('\n').slice(0, 6).join('\n'));
  process.exitCode = 1;
} finally {
  console.log(results.join('\n'));
  await browser.close();
  web.kill();
  mock.server.close();
}
