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
    await B.getByRole('button', { name: 'הבנתי' }).click();
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
