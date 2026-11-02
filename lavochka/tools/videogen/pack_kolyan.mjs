// Упаковка реакций Коляна для «Коммерсов»: <партия>/<реакция>-kolyan-<год>-v1.mp4 → public/kommersy/a/kolyan/<год>-<реакция>.mp4
// 384×384, H.264 без звука. Зелёный фон заменяется подложкой портретов (#e5d8bd) тем же ключом, что шейдер холдема
// (video3d.ts: зелень относительно яркости, мягкий край, гашение зелёной каймы) — в игре ролик просто <video>.
// Запуск (из lavochka/): FFMPEG=G:/ai/ffmpeg/bin/ffmpeg.exe node tools/videogen/pack_kolyan.mjs [папка партии]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ff = process.env.FFMPEG || 'ffmpeg';
const src = process.argv[2] || 'G:/temp/studio/out/kommersy/09-kolyan-reactions';
const dst = 'public/kommersy/a/kolyan';
const SIZE = 384;
const CRF = 28;
const BG = [0xe5, 0xd8, 0xbd];

// k — насколько зелёный перевешивает красный и синий; a — непрозрачность (1 — человек, 0 — фон).
const M = 'max(r(X,Y),b(X,Y))';
const K = `(g(X,Y)-${M})/(g(X,Y)+25.5)`;
// тёмные тени с лёгкой прозеленью (под руками) — не фон: прозрачно только там, где зелёный перевешивает заметно и по абсолютной величине
const AL = `clip(max((0.26-${K})/0.14,(26-(g(X,Y)-${M}))/14),0,1)`;
const G2 = `min(g(X,Y),${M}+3)`;
const mix = (fg, bg) => `${AL}*${fg}+(1-${AL})*${bg}`;
const geq = `geq=r='${mix('r(X,Y)', BG[0])}':g='${mix(G2, BG[1])}':b='${mix('b(X,Y)', BG[2])}'`;

mkdirSync(dst, { recursive: true });
let total = 0;
let n = 0;
for (const f of readdirSync(src)) {
  const m = f.match(/^(\w+)-kolyan-(\d{4})-v1\.mp4$/);
  if (!m) continue;
  const out = join(dst, `${m[2]}-${m[1]}.mp4`);
  if (existsSync(out) && statSync(out).mtimeMs > statSync(join(src, f)).mtimeMs) continue;
  execFileSync(ff, [
    '-v', 'error', '-y', '-i', join(src, f), '-an',
    '-vf', `scale=${SIZE}:${SIZE}:flags=lanczos,format=gbrp,${geq},format=yuv420p`,
    '-c:v', 'libx264', '-profile:v', 'main', '-preset', 'slow', '-crf', String(CRF),
    '-g', '24', '-movflags', '+faststart', out,
  ]);
  total += statSync(out).size;
  n++;
  console.log(out, Math.round(statSync(out).size / 1024), 'КБ');
}
console.log(`готово: ${n} роликов, ${(total / 1048576).toFixed(1)} МБ`);
