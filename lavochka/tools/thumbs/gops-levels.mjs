/* Превью уровней ГОПС: public/gops/a/levels/<id>.webp (640×235) — карта целиком в своей теме, бойцы уже приземлились.
 *
 * Нужен запущенный `npm run dev` (:5173). Безголовый Chrome по протоколу отладки открывает /gops.html?shot=<id>
 * (окно 1280×470 — пропорция карты 1920×704), ждёт, пока страница сама скажет «shot-ready» (Game.shot), и снимает.
 *
 *   node tools/thumbs/gops-levels.mjs            # все уровни из docs/gops/levels/missions.json
 *   node tools/thumbs/gops-levels.mjs m01 m07    # только эти
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, 'public/gops/a/levels');
const TMP = 'G:/temp/gops-shots';
const PORT = 9333;
const CHROME = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe`,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
].find(existsSync);

const ids = process.argv.slice(2).length
  ? process.argv.slice(2)
  : JSON.parse(readFileSync(join(ROOT, '../docs/gops/levels/missions.json'), 'utf8')).map((m) => m.id);
mkdirSync(OUT, { recursive: true });
mkdirSync(TMP, { recursive: true });
const profile = join(TMP, '_chrome');
const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--hide-scrollbars', '--mute-audio',
  '--window-size=1280,470', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', 'about:blank',
], { env: { ...process.env, TEMP: TMP, TMP } });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) {
  await sleep(200);
  target = await fetch(`http://127.0.0.1:${PORT}/json`).then((r) => r.json()).then((l) => l.find((t) => t.type === 'page')).catch(() => null);
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let seq = 0;
const wait = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && wait.has(m.id)) {
    wait.get(m.id)(m);
    wait.delete(m.id);
  }
};
const cdp = (method, params = {}) =>
  new Promise((r) => {
    const id = ++seq;
    wait.set(id, r);
    ws.send(JSON.stringify({ id, method, params }));
  });
await cdp('Emulation.setDeviceMetricsOverride', { width: 1280, height: 470, deviceScaleFactor: 1, mobile: false });

let bad = 0;
for (const [i, id] of ids.entries()) {
  await cdp('Page.navigate', { url: `http://localhost:5173/gops.html?shot=${id}` });
  let ready = false;
  for (let k = 0; k < 120 && !ready; k++) {
    await sleep(250);
    const r = await cdp('Runtime.evaluate', { expression: 'document.title' });
    ready = r.result?.result?.value === 'shot-ready';
  }
  if (!ready) {
    bad++;
    console.log(`${i + 1}/${ids.length} ${id} — не дождался`);
    continue;
  }
  await sleep(300);
  const shot = await cdp('Page.captureScreenshot', { format: 'webp', quality: 80, clip: { x: 0, y: 0, width: 1280, height: 470, scale: 0.5 } });
  writeFileSync(join(OUT, `${id}.webp`), Buffer.from(shot.result.data, 'base64'));
  console.log(`${i + 1}/${ids.length} ${id}`);
}
ws.close();
chrome.kill();
await sleep(500);
rmSync(profile, { recursive: true, force: true });
process.exit(bad ? 1 : 0);
