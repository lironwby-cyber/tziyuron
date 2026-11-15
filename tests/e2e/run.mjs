// End-to-end test in headless Chromium with a fake camera (our test photo) and a fake microphone.
// Usage: node tests/e2e/run.mjs   (needs python3 and ffmpeg for the fixture)
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(execFileSync('npm', ['root', '-g']).toString().trim(), 'playwright')); }
const { chromium } = playwright;

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fx = join(root, 'tests', 'fixtures');
const outDir = join(root, 'tests', 'e2e', 'out');
mkdirSync(outDir, { recursive: true });
if (!existsSync(join(fx, 'scene.y4m'))) execFileSync('python3', [join(fx, 'make_scene.py'), fx], { stdio: 'inherit' });

const PORT = 8765;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const BASE = `http://127.0.0.1:${PORT}/`;

const browser = await chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${join(fx, 'scene.y4m')}`],
});
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1, acceptDownloads: true, permissions: ['camera', 'microphone'] });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push('console: ' + m.text()); });

let step = 0;
const results = [];
async function check(name, fn) {
  step++;
  try {
    await fn();
    results.push(`ok ${step} - ${name}`);
  } catch (err) {
    results.push(`not ok ${step} - ${name}\n   ${String(err.message).split('\n').slice(0, 4).join('\n   ')}`);
    await page.screenshot({ path: join(outDir, `fail-${step}.png`) }).catch(() => {});
    throw err;
  }
}
const shot = (n) => page.screenshot({ path: join(outDir, n + '.png') });
const noOverflow = async () => {
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(over <= 0, `horizontal overflow of ${over}px`);
};

/** Pixel stats of the main image on the page (decoded in the page). */
const imageStats = () => page.evaluate(async () => {
  const img = document.querySelector('[data-main]');
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, c.width, c.height).data;
  let white = 0, brown = 0, n = 0;
  for (let i = 0; i < d.length; i += 4 * 7) {
    n++;
    if (d[i] > 245 && d[i + 1] > 245 && d[i + 2] > 240) white++;
    if (d[i] > 80 && d[i] < 170 && d[i + 1] > 50 && d[i + 1] < 120 && d[i + 2] < 80 && d[i] - d[i + 2] > 50) brown++;
  }
  return { w: c.width, h: c.height, white: white / n, brown: brown / n };
});

try {
  await check('welcome screen in Hebrew, RTL', async () => {
    await page.goto(BASE);
    await page.getByText('הוספת ילד ראשון').waitFor();
    assert.equal(await page.getAttribute('html', 'dir'), 'rtl');
    await noOverflow();
    await shot('01-welcome');
  });

  await check('add a child with birth date', async () => {
    await page.getByText('הוספת ילד ראשון').click();
    await page.getByLabel('שם', { exact: true }).fill('נועה');
    await page.getByLabel('תאריך לידה').fill('2020-03-10');
    await page.getByRole('button', { name: 'דמות fox' }).click();
    await shot('02a-child-form');
    await page.getByRole('button', { name: 'שמירה' }).click();
    await page.getByRole('button', { name: 'נועה', exact: true }).waitFor();
    await page.getByText('עוד אין כאן ציורים של נועה').waitFor();
    assert.match(await page.locator('.kid[aria-pressed="true"] .avatar img').getAttribute('src'), /av-fox/);
    await noOverflow();
    await shot('02-empty-child');
  });

  await check('import a photo: sheet detected, straightened and cleaned', async () => {
    await page.getByRole('button', { name: 'הוספה' }).click();
    const fc = page.waitForEvent('filechooser');
    await page.getByText('ציורים מהגלריה').click();
    await (await fc).setFiles(join(fx, 'scene.jpg'));
    await page.getByRole('img', { name: 'תוצאה 1' }).waitFor({ timeout: 20000 });
    assert.equal(await page.getByText('לא זיהיתי דף').count(), 0, 'sheet should be detected');
    await page.getByLabel('שם הציור 1').fill('טיל לירח');
    await page.getByLabel('כיתוב').fill('זה אבא שטס לירח');
    await page.getByLabel('תאריך').fill('2025-01-20');
    await shot('03-review');
    await page.getByRole('button', { name: 'שמירה' }).click();
    await page.getByRole('heading', { name: 'טיל לירח' }).waitFor();
    await page.getByText('גיל 4 ו-10 חודשים').waitFor();
    const s = await imageStats();
    // Output follows the sheet's edges in the photo (~813 x 917 px), the table is gone and the paper is white.
    assert.ok(Math.abs(s.w - 813) < 25 && Math.abs(s.h - 917) < 25, `size ${s.w}x${s.h}`);
    assert.ok(s.brown < 0.01, `table pixels left: ${(s.brown * 100).toFixed(2)}%`);
    assert.ok(s.white > 0.7, `white paper ratio ${(s.white * 100).toFixed(1)}%`);
    await shot('04-detail');
  });

  await check('original is kept and can be shown', async () => {
    await page.getByRole('button', { name: 'הצגת המקור' }).click();
    await page.waitForFunction(() => document.querySelector('[data-main]').naturalWidth === 1600, null, { timeout: 5000 });
    const s = await imageStats();
    assert.equal(s.w, 1600, 'original photo is the full 1600px frame');
    assert.ok(s.brown > 0.2, 'original still shows the table');
    await page.getByRole('button', { name: 'הצגת הנקי' }).click();
  });

  await check('record the child\'s voice on the drawing', async () => {
    await page.getByRole('button', { name: 'הקלטת קול' }).click();
    await page.getByRole('button', { name: 'התחלת הקלטה' }).click();
    await page.waitForTimeout(1600);
    await shot('05-recording');
    await page.getByRole('button', { name: 'עצירת הקלטה' }).click();
    await page.getByRole('button', { name: 'שמירה' }).click();
    await page.getByText('ההקלטה נוספה').waitFor();
    const dur = await page.evaluate(async () => {
      const a = document.querySelector('[data-voice] audio');
      const r = await fetch(a.src); const b = await r.blob();
      return { size: b.size, type: b.type };
    });
    assert.ok(dur.size > 2000, `audio size ${dur.size}`);
    assert.match(dur.type, /audio/);
    await page.getByRole('button', { name: 'השמעת הקלטה 1' }).click();
    await page.waitForFunction(() => !document.querySelector('[data-voice] audio').paused, null, { timeout: 5000 });
    await page.getByRole('button', { name: 'השמעת הקלטה 1' }).click();
    await shot('05b-detail-voice');
  });

  await check('animate the drawing on the device and keep the clip', async () => {
    // The name says what is drawn, so the movements offered fit it.
    await page.getByRole('button', { name: 'הנפשה' }).click();
    await page.getByRole('heading', { name: 'איך להנפיש את טיל לירח?' }).waitFor();
    await page.getByText('הצעות לפי השם של הציור.').waitFor();
    assert.deepEqual(await page.locator('.motion-opt b').allTextContents(), ['הטיל ממריא', 'הירח זוהר', 'תנועה עדינה של כל הציור']);
    await page.waitForTimeout(500);
    await shot('05c-motions');
    await page.getByRole('button', { name: 'הטיל ממריא' }).click();
    const canvas = page.locator('.anim-stage canvas');
    await page.waitForFunction(() => document.querySelector('.anim-stage canvas')?.dataset.cut === 'true', null, { timeout: 10000 });
    assert.equal(await page.getByRole('button', { name: 'הטיל ממריא' }).getAttribute('aria-pressed'), 'true');
    // The page stays in place and the figure moves on it: the corners keep still, the middle changes.
    const probe = () => canvas.evaluate((c) => {
      const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
      let ink = 0, sum = 0;
      for (let i = 0; i < d.length; i += 4 * 7) { if (d[i] + d[i + 1] + d[i + 2] < 600) { ink++; sum = (sum + i * 31) % 1000003; } }
      return { ink, sum, corner: [d[0], d[1], d[2]].join() };
    });
    const f1 = await probe();
    await page.waitForTimeout(700);
    const f2 = await probe();
    assert.ok(f1.ink > 200, `the drawing is on the stage (${f1.ink})`);
    assert.notEqual(f1.sum, f2.sum, 'the figure moved');
    assert.equal(f1.corner, f2.corner, 'the page did not move');
    await shot('05d-animate-fit');
    await page.getByRole('button', { name: 'מרחף' }).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'הירח זוהר' }).click();
    await page.waitForTimeout(300);
    await page.getByRole('button', { name: 'הטיל ממריא' }).click();
    await page.getByRole('button', { name: /שמירה כסרטון/ }).click();
    await page.getByText('ההנפשה נשמרה ליד הציור').waitFor({ timeout: 20000 });
    const v = await page.evaluate(async () => {
      const el = document.querySelector('.voice.video video');
      const b = await (await fetch(el.src)).blob();
      await new Promise((r) => { if (el.readyState >= 1) r(); else el.onloadedmetadata = r; });
      return { size: b.size, type: b.type, w: el.videoWidth, h: el.videoHeight };
    });
    assert.ok(v.size > 20000, `clip size ${v.size}`);
    assert.match(v.type, /video/);
    assert.equal(v.w, 720); assert.equal(v.h, 900);
  });

  await check('scan with the live camera: sheet detected in the viewfinder', async () => {
    await page.goBack();
    await page.getByRole('button', { name: 'הוספה' }).click();
    await page.getByText('סריקת ציור').click();
    // No tap: the sheet is found, held still, shot, straightened and cropped by itself.
    await page.getByText('מצוין, לא לזוז').waitFor({ timeout: 15000 });
    await shot('06-camera');
    await page.getByRole('img', { name: 'תוצאה 1' }).waitFor({ timeout: 20000 });
    await page.getByText('הדף זוהה, יושר ונחתך לבד').waitFor();
    await shot('06b-auto-result');
    await page.getByLabel('שם הציור 1').fill('השמש');
    await page.getByRole('button', { name: 'שמירה' }).click();
    await page.getByRole('heading', { name: 'השמש' }).waitFor();
    const s = await imageStats();
    assert.ok(s.brown < 0.02, `table pixels left after camera scan: ${(s.brown * 100).toFixed(2)}%`);
  });

  await check('batch: three shots in a row, saved together', async () => {
    await page.goBack();
    await page.getByRole('button', { name: 'הוספה' }).click();
    await page.getByText('כמה ציורים ברצף').click();
    // The first shot is automatic. The same sheet is not shot twice, so the next two are taken by hand.
    await page.locator('.cam-thumb b', { hasText: '1' }).waitFor({ timeout: 15000 });
    await page.getByText('צולם. מחליפים לציור הבא').waitFor();
    await page.waitForTimeout(2500);
    assert.equal(await page.locator('.cam-thumb b').textContent(), '1', 'the same sheet must not be shot again');
    for (let i = 0; i < 2; i++) { await page.getByRole('button', { name: 'צילום' }).click(); await page.waitForTimeout(400); }
    await shot('06c-batch');
    await page.getByRole('button', { name: 'סיום' }).first().click();
    await page.getByRole('heading', { name: '3 ציורים' }).waitFor().catch(() => {});
    await page.getByRole('img', { name: 'תוצאה 3' }).waitFor({ timeout: 30000 });
    await page.getByRole('button', { name: /שמירה \(3\)/ }).click();
    await page.getByText('3 ציורים נשמרו').waitFor();
    assert.equal(await page.locator('[data-mem]').count(), 5);
  });

  await check('one photo with three drawings becomes three drawings', async () => {
    await page.getByRole('button', { name: 'הוספה' }).click();
    const fc = page.waitForEvent('filechooser');
    await page.getByText('ציורים מהגלריה').click();
    await (await fc).setFiles(join(fx, 'scenes', 'multi-3-dark.jpg'));
    await page.getByRole('img', { name: 'תוצאה 3' }).waitFor({ timeout: 30000 });
    await page.getByText('ציור 3 מתוך 3 בצילום').waitFor();
    assert.equal(await page.locator('.review-item').count(), 3);
    const sizes = await page.evaluate(() => [...document.querySelectorAll('.review-item img')].map((i) => [i.naturalWidth, i.naturalHeight]));
    for (const [w, h] of sizes) assert.ok(w > 300 && h > w, `each result is one upright sheet, got ${w}x${h}`);
    await shot('06d-multi');
    page.once('dialog', (d) => d.accept());
    await page.getByRole('button', { name: 'חזרה' }).click();
    await page.getByRole('button', { name: 'יציאה' }).click();
    await page.getByRole('button', { name: 'הוספה' }).waitFor();
  });

  await check('a drawing without a name: the animation button asks for a name first, then offers what fits it', async () => {
    await page.locator('[data-mem]').first().click();
    await page.getByRole('button', { name: 'הנפשה' }).click();
    await page.getByRole('heading', { name: 'לציור עוד אין שם' }).waitFor();
    await page.locator('[data-name-first]', { hasText: 'אפשר לכתוב שם עכשיו.' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'שם אוטומטי' }).count(), 0, 'no automatic name without the family archive');
    await shot('06e-no-name');
    await page.getByRole('button', { name: 'כתיבת שם עכשיו' }).click();
    await page.getByLabel('כותרת').fill('פרפר ופרחים');
    await page.getByRole('button', { name: 'שמירה' }).click();
    await page.getByRole('heading', { name: 'איך להנפיש את פרפר ופרחים?' }).waitFor();
    assert.deepEqual(await page.locator('.motion-opt b').allTextContents(), ['הפרפר עף', 'הפרחים מתנדנדים ברוח', 'תנועה עדינה של כל הציור']);
    await page.keyboard.press('Escape');
    // Without a name the animation is still possible.
    await page.getByRole('button', { name: 'עריכה' }).click();
    await page.getByLabel('כותרת').fill('');
    await page.getByRole('button', { name: 'שמירה' }).click();
    await page.getByRole('button', { name: 'הנפשה' }).click();
    await page.getByRole('button', { name: 'הנפשה בלי שם' }).click();
    await page.getByText('בלי שם אין לי הצעה שמתאימה לציור.').waitFor();
    await page.getByRole('button', { name: 'תנועה עדינה של כל הציור' }).click();
    await page.getByRole('button', { name: 'קווים חיים' }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'קווים חיים' }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'ביטול' }).click();
    await page.goBack();
  });

  await check('manual crop editor opens and re-processes', async () => {
    await page.locator('[data-mem]').first().click();
    await page.getByRole('button', { name: 'חיתוך מחדש' }).click();
    await page.getByText('גוררים את ארבע הנקודות').waitFor();
    await shot('07-crop');
    await page.getByRole('button', { name: 'כל התמונה' }).click();
    await page.getByRole('button', { name: 'אישור' }).click();
    await page.waitForFunction(() => document.querySelector('[data-main]')?.naturalWidth > 0);
    await page.waitForTimeout(600);
    const s = await imageStats();
    assert.ok(s.w > s.h, 'full frame crop is landscape');
    await page.goBack();
  });

  await check('milestone and written memory', async () => {
    await page.getByRole('button', { name: 'הוספה' }).click();
    await page.getByText('אבן דרך').first().click();
    await page.getByLabel('כותרת').fill('כתבה את השם לבד');
    await page.getByLabel('תאריך').fill('2024-09-01');
    await page.getByRole('button', { name: 'שמירה' }).click();
    await page.getByRole('heading', { name: 'כתבה את השם לבד' }).waitFor();
    await page.goBack();
  });

  await check('timeline grouped by age, gallery view', async () => {
    await page.getByRole('heading', { name: /גיל 6/ }).waitFor();
    await page.getByRole('heading', { name: /גיל 4/ }).waitFor();
    await noOverflow();
    await shot('08-timeline');
    await page.getByRole('button', { name: 'גלריה' }).click();
    assert.equal(await page.locator('.wall.dense .frame').count(), 6);
    await shot('09-gallery');
    await page.getByRole('button', { name: 'לפי גיל' }).click();
  });

  await check('second child and search across children', async () => {
    await page.getByRole('button', { name: 'הוספת ילד' }).click();
    await page.getByLabel('שם', { exact: true }).fill('יובל');
    await page.getByLabel('תאריך לידה').fill('2022-07-01');
    await page.getByRole('button', { name: 'שמירה' }).click();
    await page.getByText('עוד אין כאן ציורים של יובל').waitFor();
    await page.getByPlaceholder('חיפוש בכל הזיכרונות').fill('אבא');
    await page.getByText('1 בכל הילדים').waitFor();
    await shot('09b-search');
    await page.getByText('טיל לירח').waitFor();
    await page.getByPlaceholder('חיפוש בכל הזיכרונות').fill('');
    await page.getByRole('button', { name: 'נועה', exact: true }).click();
  });

  await check('select drawings and build a printable book', async () => {
    await page.getByRole('button', { name: 'בחירה' }).click();
    const cards = page.locator('[data-mem]');
    for (let i = 0; i < 3; i++) await cards.nth(i + 1).click();
    await page.getByText('3 נבחרו').waitFor();
    await shot('09c-select');
    await page.getByRole('button', { name: 'ספר', exact: true }).click();
    await page.getByText('ספר דיגיטלי').waitFor();
    assert.equal(await page.locator('.page').count(), 5, 'cover + 3 pages + back');
    await page.getByLabel('שם הספר').fill('הספר של נועה');
    assert.equal(await page.locator('[data-cover-title]').textContent(), 'הספר של נועה');
    await page.getByRole('button', { name: 'הסרה מהספר' }).first().click();
    assert.equal(await page.locator('.page').count(), 4);
    await shot('10-book');
    await page.emulateMedia({ media: 'print' });
    await page.pdf({ path: join(outDir, 'book.pdf'), format: 'A4', printBackground: true });
    await page.emulateMedia({ media: 'screen' });
    await page.goBack();
  });

  await check('compare two drawings side by side', async () => {
    await page.getByRole('button', { name: 'בחירה' }).click();
    await page.locator('[data-mem]').nth(1).click();
    assert.ok(await page.getByRole('button', { name: 'השוואה' }).isDisabled(), 'needs exactly two');
    await page.locator('[data-mem]').nth(2).click();
    await page.getByRole('button', { name: 'השוואה' }).click();
    await page.getByRole('heading', { name: 'אז והיום' }).waitFor();
    assert.equal(await page.locator('.compare img').count(), 2);
    await shot('10b-compare');
    await page.getByRole('button', { name: 'סגירה' }).click();
    await page.getByRole('button', { name: 'סיום' }).click();
  });

  await check('exhibition slideshow', async () => {
    await page.getByRole('button', { name: 'תערוכה' }).click();
    await page.locator('.show-slide.in img').waitFor();
    await page.waitForFunction(() => document.querySelector('.show img').naturalWidth > 0);
    await page.waitForTimeout(700);
    await shot('10c-exhibition');
    await page.getByRole('button', { name: 'סגירת התערוכה' }).click();
    assert.equal(await page.locator('.show').count(), 0);
  });

  let zipPath;
  await check('full backup to ZIP opens with standard tools', async () => {
    await page.getByRole('button', { name: 'הגדרות' }).click();
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: /גיבוי עכשיו/ }).click();
    const d = await dl;
    zipPath = join(outDir, 'backup.zip');
    await d.saveAs(zipPath);
    const py = `import zipfile,sys,json\nz=zipfile.ZipFile(sys.argv[1])\nassert z.testzip() is None\nm=json.loads(z.read('גיבוי-ציורון.json'))\nprint(len(m['children']),len(m['memories']),len(z.namelist()))\nprint([n for n in z.namelist() if n.startswith('נועה/')][0])`;
    const out = execFileSync('python3', ['-c', py, zipPath]).toString().trim().split('\n');
    const [kids, mems] = out[0].split(' ').map(Number);
    assert.equal(kids, 2); assert.equal(mems, 6);
    assert.match(out[1], /^נועה\/\d{4}-\d{2}-\d{2} /);
    await page.getByText('גיבוי אחרון').waitFor();
    assert.notEqual(await page.locator('[data-last-backup]').textContent(), 'עוד לא');
  });

  await check('data survives a reload', async () => {
    await page.goto(BASE);
    await page.getByText('טיל לירח').waitFor();
  });

  await check('works offline after the first visit', async () => {
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await context.setOffline(true);
    await page.reload();
    await page.getByText('טיל לירח').waitFor();
    await context.setOffline(false);
  });

  await check('wipe everything, then restore from the backup', async () => {
    await page.getByRole('button', { name: 'הגדרות' }).click();
    await page.getByRole('button', { name: 'מחיקת כל הנתונים' }).click();
    await page.getByRole('button', { name: 'מחיקת הכול' }).click();
    await page.getByText('הוספת ילד ראשון').waitFor();
    await page.getByRole('button', { name: 'שחזור מגיבוי' }).click();
    const fc = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: /שחזור מגיבוי/ }).click();
    await (await fc).setFiles(zipPath);
    await page.getByRole('button', { name: 'שחזור', exact: true }).click();
    await page.getByText('השחזור הושלם').waitFor();
    await page.getByRole('button', { name: 'כולם' }).click();
    assert.equal(await page.locator('[data-mem]').count(), 6);
    await page.getByText('טיל לירח').click();
    await page.locator('[data-voice] audio').waitFor({ state: 'attached' });
    await page.locator('.voice.video video').waitFor();
    const s = await imageStats();
    assert.ok(s.white > 0.7);
  });

  await check('delete a drawing', async () => {
    await page.getByRole('button', { name: 'מחיקה' }).last().click();
    await page.getByRole('dialog').getByRole('button', { name: 'מחיקה' }).click();
    await page.getByText('נמחק').waitFor();
    assert.equal(await page.locator('[data-mem]').count(), 5);
  });

  await check('dark mode renders', async () => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await shot('11-dark');
    const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    assert.equal(bg, 'rgb(23, 20, 42)');
    await page.emulateMedia({ colorScheme: 'light' });
  });

  await check('no console errors', async () => {
    assert.deepEqual(errors, []);
  });
} catch {
  // reported below
} finally {
  console.log(results.join('\n'));
  if (errors.length) console.log('errors:\n' + errors.join('\n'));
  await browser.close();
  server.kill();
  const failed = results.some((r) => r.startsWith('not ok'));
  console.log(failed ? 'E2E FAILED' : `E2E PASSED (${results.length} checks)`);
  process.exit(failed ? 1 : 0);
}
