// Fills the app with demo drawings through the real import flow and takes phone screenshots.
// Usage: node tests/demo/shots.mjs <outDir>
import { createRequire } from 'node:module';
import { spawn, execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import assert from 'node:assert/strict';
const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(join(execFileSync('npm', ['root', '-g']).toString().trim(), 'playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const photos = join(root, 'tests', 'demo', 'photos');
const out = process.argv[2] || join(root, 'tests', 'demo', 'out');
mkdirSync(out, { recursive: true });
const PORT = 8771;
const server = spawn('python3', ['-m', 'http.server', String(PORT), '--bind', '127.0.0.1'], { cwd: root, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 800));
const browser = await playwright.chromium.launch({
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-video-capture=${join(root, 'tests', 'fixtures', 'scene.y4m')}`],
});
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, locale: 'he-IL', permissions: ['camera', 'microphone'] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const shot = async (n, { top = true } = {}) => {
  if (top) await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('.toast').waitFor({ state: 'detached', timeout: 6000 }).catch(() => {});
  await page.waitForTimeout(250);
  await page.screenshot({ path: join(out, n + '.png') });
};
const settle = () => page.waitForTimeout(500);

const ITEMS = [
  ['נועה', 'house', 'הבית שלנו', 'זה הבית, ואני בחלון', '2026-10-28'],
  ['נועה', 'family', 'כל המשפחה', 'אבא, אמא, אני ויובל', '2026-09-14'],
  ['נועה', 'rainbow', 'קשת אחרי הגשם', '', '2026-05-02'],
  ['נועה', 'cat', 'החתול של סבתא', 'קוראים לו מיצי והוא שמן', '2025-11-20'],
  ['נועה', 'flower', 'פרח לאמא', '', '2025-06-08'],
  ['נועה', 'rocket', 'טיל לירח', 'זה אבא שטס לירח', '2024-12-01'],
  ['יובל', 'fish', 'דג בים', '', '2026-08-19'],
  ['יובל', 'car', 'אוטו אדום', 'ברררם', '2026-03-03'],
];
try {
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.getByText('הוספת ילד ראשון').waitFor();
  await page.waitForTimeout(900);
  await shot('01-welcome');
  for (const [name, birth, animal] of [['נועה', '2020-03-10', 'fox'], ['יובל', '2022-07-01', 'panda']]) {
    await page.locator('[data-go="child/new"]').first().click();
    await page.getByLabel('שם', { exact: true }).fill(name);
    await page.getByLabel('תאריך לידה').fill(birth);
    await page.getByRole('button', { name: 'דמות ' + animal }).click();
    if (name === 'יובל') { await page.getByRole('button', { name: 'צבע 4' }).click(); await settle(); await shot('02-child-form'); }
    await page.getByRole('button', { name: 'שמירה' }).click();
    await page.getByRole('button', { name, exact: true }).waitFor();
  }
  for (const [kid, file, title, caption, date] of ITEMS) {
    await page.getByRole('button', { name: kid, exact: true }).click();
    await page.getByRole('button', { name: 'הוספה' }).click();
    if (file === 'house') { await settle(); await shot('03-add-menu'); }
    const fc = page.waitForEvent('filechooser');
    await page.getByText('ציורים מהגלריה').click();
    await (await fc).setFiles(join(photos, file + '.jpg'));
    await page.getByRole('img', { name: 'תוצאה 1' }).waitFor({ timeout: 30000 });
    assert.equal(await page.getByText('הדף זוהה, יושר ונחתך לבד').count(), 1, `sheet not detected in ${file}`);
    await page.getByLabel('שם הציור 1').fill(title);
    if (caption) await page.getByLabel('כיתוב').fill(caption);
    await page.getByLabel('תאריך').fill(date);
    if (file === 'house') { await settle(); await shot('05-auto-result'); }
    await page.getByRole('button', { name: 'שמירה' }).click();
    await page.getByRole('heading', { name: title }).waitFor();
    if (file === 'rocket') {
      await page.getByRole('button', { name: 'הקלטת קול' }).click();
      await page.getByRole('button', { name: 'התחלת הקלטה' }).click();
      await page.waitForTimeout(2300);
      await page.getByRole('button', { name: 'עצירת הקלטה' }).click();
      await page.getByRole('button', { name: 'שמירה' }).click();
      await page.getByText('ההקלטה נוספה').waitFor();
      await page.waitForTimeout(2800);
      await shot('06-detail');
      await page.getByRole('button', { name: 'הנפשה' }).click();
      await page.getByRole('button', { name: 'מרחף' }).click();
      await page.waitForTimeout(900);
      await shot('07-animate');
      await page.getByRole('button', { name: 'ביטול' }).click();
    }
    await page.goBack();
  }
  // Milestone
  await page.getByRole('button', { name: 'נועה', exact: true }).click();
  await page.getByRole('button', { name: 'הוספה' }).click();
  await page.getByText('אבן דרך').first().click();
  await page.getByLabel('כותרת').fill('כתבה את השם לבד');
  await page.getByLabel('תאריך').fill('2025-09-01');
  await page.getByRole('button', { name: 'שמירה' }).click();
  await page.getByRole('heading', { name: 'כתבה את השם לבד' }).waitFor();
  await page.goBack();
  await page.evaluate(() => { const s = window.__tziyuron.state.settings; s.lastBackupAt = Date.now(); return window.__tziyuron.render(); });
  await page.waitForTimeout(900);
  await shot('08-home');
  await page.evaluate(() => window.scrollTo(0, 520));
  await settle();
  await shot('09-home-scrolled', { top: false });
  await page.evaluate(() => window.scrollTo(0, 0));
  // Camera with auto capture
  await page.getByRole('button', { name: 'הוספה' }).click();
  await page.getByText('סריקת ציור').click();
  await page.getByText('מצוין, לא לזוז').waitFor({ timeout: 15000 });
  await page.screenshot({ path: join(out, '04-camera-auto.png') });
  await page.getByRole('img', { name: 'תוצאה 1' }).waitFor({ timeout: 20000 });
  page.once('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'חזרה' }).click();
  await page.getByRole('button', { name: 'יציאה' }).click();
  await page.getByRole('button', { name: 'הוספה' }).waitFor();
  // Compare
  await page.getByRole('button', { name: 'בחירה' }).click();
  await page.locator('[data-mem][aria-label="הבית שלנו"]').click();
  await page.locator('[data-mem][aria-label="טיל לירח"]').click();
  await page.getByRole('button', { name: 'השוואה' }).click();
  await page.getByRole('heading', { name: 'אז והיום' }).waitFor();
  await settle();
  await shot('10-compare');
  await page.getByRole('button', { name: 'סגירה' }).click();
  await page.getByRole('button', { name: 'סיום' }).click();
  // Book
  await page.getByRole('button', { name: 'ספר מהציורים' }).click();
  await page.getByText('ספר דיגיטלי').waitFor();
  await page.waitForTimeout(900);
  await shot('11-book');
  await page.goBack();
  // Exhibition
  await page.getByRole('button', { name: 'תערוכה' }).click();
  await page.locator('.show-slide.in img').waitFor();
  await page.waitForTimeout(900);
  await shot('12-exhibition');
  await page.getByRole('button', { name: 'סגירת התערוכה' }).click();
  // All kids, settings, dark
  await page.getByRole('button', { name: 'כולם' }).click();
  await page.waitForTimeout(700);
  await shot('13-all-kids');
  await page.getByRole('button', { name: 'הגדרות' }).click();
  await page.waitForTimeout(700);
  await shot('14-settings');
  await page.goBack();
  await page.getByRole('button', { name: 'נועה', exact: true }).click();
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.waitForTimeout(700);
  await shot('15-dark-home');
  await page.locator('[data-mem][aria-label="כל המשפחה"]').click();
  await page.waitForTimeout(900);
  await shot('16-dark-detail');
  const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(over <= 0, 'overflow');
  assert.deepEqual(errors, []);
  console.log('DEMO OK');
} catch (e) {
  await shot('fail');
  console.log('DEMO FAILED', e.message.split('\n').slice(0, 5).join('\n'), errors);
  process.exitCode = 1;
} finally {
  await browser.close();
  server.kill();
}
