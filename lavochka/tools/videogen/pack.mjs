// Упаковка роликов персонажей для холдема: videogen_out/<перс>/<перс>_<реакция>.mp4 → public/video/holdem/<перс>/<реакция>.mp4
// 512×512, H.264 без звука, края обрезаны (стойки фона по бокам), сверху закрашена лампа — фон вырезает шейдер в игре.
// Запуск (из lavochka/): FFMPEG=путь/к/ffmpeg.exe node tools/videogen/pack.mjs [папка с роликами]
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const ff = process.env.FFMPEG || 'ffmpeg';
const src = process.argv[2] || 'tools/videogen/dist/videogen_out';
const dst = 'public/video/holdem';
const SIZE = 512;
const CRF = 27;

let total = 0;
let n = 0;
for (const who of readdirSync(src)) {
  const dir = join(src, who);
  if (!statSync(dir).isDirectory()) continue;
  mkdirSync(join(dst, who), { recursive: true });
  for (const f of readdirSync(dir)) {
    const m = f.match(new RegExp(`^${who}_(\\w+)\\.mp4$`));
    if (!m) continue;
    const out = join(dst, who, `${m[1]}.mp4`);
    if (existsSync(out) && statSync(out).mtimeMs > statSync(join(dir, f)).mtimeMs) continue;
    execFileSync(ff, [
      '-v', 'error', '-y', '-i', join(dir, f), '-an',
      '-vf', `crop=iw*0.94:ih:iw*0.03:0,drawbox=x=0:y=0:w=iw:h=ih*0.09:color=0x228c3c:t=fill,scale=${SIZE}:${SIZE}:flags=lanczos`,
      '-c:v', 'libx264', '-profile:v', 'main', '-preset', 'slow', '-crf', String(CRF), '-pix_fmt', 'yuv420p',
      '-g', '24', '-movflags', '+faststart', out,
    ]);
    total += statSync(out).size;
    n++;
    console.log(out, Math.round(statSync(out).size / 1024), 'КБ');
  }
}
console.log(`готово: ${n} роликов, ${(total / 1048576).toFixed(1)} МБ`);
