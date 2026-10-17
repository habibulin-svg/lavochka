/* «Морской бой»: табло (роспись по стеклу, лампы номеров и транспарантов, смотровые окна), вид в окуляр перископа
 * (панорама: небо, горы на боковых щитах, зелёное стекло моря с восемью лучами лампочек, силуэты на цепи, три визира),
 * щит с рукоятками («ПУСК» на правой), шкалой «градусы» и монетоприёмником. Логика — logic.ts. */
import { audioOut } from '../../../core/audio';
import type { ArcadeInstance, ArcadeOpts } from '../../../core/arcade';
import { coinMode, DAILY, giveBack, pocket, setCoinMode, takeCoin, type CoinMode } from '../coins';
import {
  AIM_MAX, BLAST_TIME, coin, fire, FOV, HALF_W, LAUNCHES, newSea, roseOn, ships, SHIP_LEN, step, TICK, torpedoLamp,
  trackX, TRACKS, turn, type SeaEvent, type SeaState,
} from './logic';
import './morboy.css';

// ---- панорама: мир в см, экран окуляра VW×VH
const VW = 1200;
const VH = 560;
const K = VW / FOV; // точек на см
const HOR = VH * 0.47; // линия горизонта
const PAN_W = (HALF_W + 16) * 2; // ширина заготовки панорамы, см

const LAMP_Z = Array.from({ length: 10 }, (_, i) => Math.pow(0.8, i)); // глубина лампочек: 1 у глаза … ~0.13 у горизонта

/** Точка трассы k, лампочка i (1…10) в координатах мира (x — см, y — точки экрана). */
function lampAt(k: number, i: number) {
  const d = LAMP_Z[i - 1];
  const f = 1 - d; // 0 у подлодки, ~0.87 у горизонта
  const bottom = VH * 1.05;
  return { x: trackX(k) * f / 0.87, y: HOR + (bottom - HOR) * d * 0.92, r: 3 + 9 * d };
}

// ---- силуэты кораблей (см, носом вправо, начало — середина киля)
function cruiser(p: Path2D) {
  p.moveTo(-3.8, 0);
  p.lineTo(3.9, 0);
  p.lineTo(3.4, -0.55);
  p.lineTo(-3.6, -0.55);
  p.closePath();
  p.rect(-2.6, -1.05, 4.6, 0.55);
  p.rect(-1.6, -1.6, 2.4, 0.6);
  p.rect(-0.6, -2.4, 0.9, 0.85);
  p.rect(-1.25, -2.2, 0.35, 0.65); // труба
  p.rect(0.55, -1.95, 0.35, 0.4);
  p.rect(-0.25, -3.3, 0.12, 0.95); // мачта
  p.rect(-1.0, -3.0, 1.6, 0.08);
  p.rect(2.0, -0.9, 1.3, 0.3); // носовая башня, ствол
  p.rect(3.0, -0.85, 0.9, 0.08);
  p.rect(-3.3, -0.9, 1.1, 0.3); // кормовая
  p.rect(-3.9, -0.85, 0.8, 0.08);
}
function destroyer(p: Path2D) {
  p.moveTo(-3.6, 0);
  p.lineTo(3.8, 0);
  p.lineTo(3.0, -0.5);
  p.lineTo(-3.4, -0.45);
  p.closePath();
  p.rect(-1.4, -1.0, 3.0, 0.5);
  p.rect(0.6, -1.6, 0.9, 0.6);
  p.rect(-0.9, -1.75, 0.5, 0.75); // трубы
  p.rect(-0.2, -1.6, 0.45, 0.6);
  p.rect(1.0, -2.7, 0.1, 1.1);
  p.rect(0.5, -2.45, 1.1, 0.07);
  p.rect(2.0, -0.8, 0.8, 0.3);
  p.rect(2.6, -0.75, 0.7, 0.07);
  p.rect(-2.8, -0.75, 0.8, 0.28);
}
const SHIPS = [cruiser, destroyer].map((f) => {
  const p = new Path2D();
  f(p);
  return p;
});

/** Детерминированный «шум» для росписи. */
const rnd = (() => {
  let x = 7;
  return () => ((x = (x * 16807) % 2147483647) / 2147483647);
})();

/** Заготовки: задник (небо, море со стеклом и прорезями лампочек), боковые щиты с горами. */
function paintPanorama() {
  const W = Math.round(PAN_W * K);
  const back = document.createElement('canvas');
  back.width = W;
  back.height = VH;
  const g = back.getContext('2d')!;
  const X = (cm: number) => (cm + PAN_W / 2) * K;
  // небо: светлое у горизонта, голубое выше, мазки облаков
  const sky = g.createLinearGradient(0, 0, 0, HOR);
  sky.addColorStop(0, '#3f7fb8');
  sky.addColorStop(0.55, '#7fb4d8');
  sky.addColorStop(1, '#d9e7e4');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, HOR + 2);
  for (let i = 0; i < 26; i++) {
    const cx = rnd() * W;
    const cy = 30 + rnd() * (HOR * 0.6);
    const rw = 80 + rnd() * 220;
    const rh = 10 + rnd() * 22;
    const cg = g.createRadialGradient(cx, cy, 0, cx, cy, rw);
    cg.addColorStop(0, 'rgba(255,255,255,0.55)');
    cg.addColorStop(1, 'rgba(255,255,255,0)');
    g.save();
    g.translate(cx, cy);
    g.scale(1, rh / rw);
    g.translate(-cx, -cy);
    g.fillStyle = cg;
    g.beginPath();
    g.arc(cx, cy, rw, 0, Math.PI * 2);
    g.fill();
    g.restore();
  }
  // дальний берег у горизонта
  g.fillStyle = 'rgba(70,95,110,0.55)';
  g.beginPath();
  g.moveTo(0, HOR);
  for (let x = 0; x <= W; x += 40) g.lineTo(x, HOR - 6 - 6 * Math.sin(x / 170) - 4 * Math.sin(x / 47));
  g.lineTo(W, HOR);
  g.fill();
  // море: зелёное стекло, подсвеченное снизу, с рисунком волн
  const sea = g.createLinearGradient(0, HOR, 0, VH);
  sea.addColorStop(0, '#2f6f5a');
  sea.addColorStop(0.35, '#1f6b45');
  sea.addColorStop(1, '#0f4a2c');
  g.fillStyle = sea;
  g.fillRect(0, HOR, W, VH - HOR);
  for (let row = 0; row < 46; row++) {
    const t = row / 46;
    const y = HOR + 4 + (VH - HOR) * Math.pow(t, 1.7);
    const amp = 2 + 10 * t;
    const len = 30 + 140 * t;
    g.lineWidth = 1 + 3.5 * t;
    for (let x = -rnd() * len; x < W; x += len * (0.8 + rnd() * 0.6)) {
      g.strokeStyle = rnd() < 0.5 ? `rgba(150,220,170,${0.18 + 0.2 * t})` : `rgba(10,40,25,${0.25 + 0.2 * t})`;
      g.beginPath();
      g.moveTo(x, y);
      g.quadraticCurveTo(x + len * 0.25, y - amp, x + len * 0.5, y);
      g.quadraticCurveTo(x + len * 0.75, y + amp * 0.6, x + len, y);
      g.stroke();
    }
  }
  // прорези под лампочки — восемь лучей по десять
  for (let k = 0; k < TRACKS; k++) {
    for (let i = 1; i <= 10; i++) {
      const l = lampAt(k, i);
      g.fillStyle = 'rgba(5,25,15,0.55)';
      g.beginPath();
      g.ellipse(X(l.x), l.y, l.r * 1.25, l.r * 0.5, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
  // боковые щиты с горами (стоят перед цепью — корабли уходят за них)
  const shields = document.createElement('canvas');
  shields.width = W;
  shields.height = VH;
  const s = shields.getContext('2d')!;
  for (const side of [-1, 1]) {
    const edge = X(side * (HALF_W - 1));
    const far = side < 0 ? 0 : W;
    for (let layer = 0; layer < 3; layer++) {
      s.fillStyle = ['#5d6f86', '#44526a', '#2f3a4c'][layer];
      s.beginPath();
      s.moveTo(far, HOR + 8);
      let x = far;
      const step = -side * (36 - layer * 6); // от края панорамы к середине
      let y = HOR - 60 - layer * 25;
      while ((side < 0 && x < edge + 40 - layer * 30) || (side > 0 && x > edge - 40 + layer * 30)) {
        x += step;
        y = Math.max(HOR - 200 + layer * 30, Math.min(HOR - 10, y + (rnd() - 0.45) * 50));
        s.lineTo(x, y);
      }
      s.lineTo(x + step, HOR + 8);
      s.closePath();
      s.fill();
    }
    // скалистый мыс у воды
    s.fillStyle = '#26303d';
    s.beginPath();
    s.moveTo(edge - side * 10, HOR + 8);
    s.lineTo(edge + side * 30, HOR - 30);
    s.lineTo(far, HOR - 40);
    s.lineTo(far, HOR + 10);
    s.fill();
  }
  return { back, shields, X };
}

function buildBoard(): string {
  const circ = (cx: number, cy: number, n: number, kind: 'l' | 'h') =>
    `<g class="mb-num" data-${kind}="${n}"><circle cx="${cx}" cy="${cy}" r="15"/><text x="${cx}" y="${cy + 6}">${n}</text></g>`;
  const hits = Array.from({ length: 10 }, (_, i) => circ(48 + i * 27, 108 + Math.pow(i - 4.5, 2) * 0.9, i + 1, 'h')).join('');
  const launches = Array.from({ length: 10 }, (_, i) => circ(640 + i * 33, 214, i + 1, 'l')).join('');
  return `<svg class="mb-board" viewBox="0 0 1000 400" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="mbSky" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#d6262d"/><stop offset=".35" stop-color="#ee4a2a"/><stop offset=".6" stop-color="#f7892a"/><stop offset=".75" stop-color="#fbb92e"/>
      </linearGradient>
      <radialGradient id="mbLamp"><stop offset="0" stop-color="#fffbe6"/><stop offset=".55" stop-color="#ffe066"/><stop offset="1" stop-color="#ff9d00" stop-opacity="0"/></radialGradient>
      <filter id="mbGlow" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6"/></filter>
    </defs>
    <rect width="1000" height="400" fill="url(#mbSky)"/>
    <path d="M0 150 C120 140 220 165 330 150 S560 140 700 158 S900 150 1000 140 L1000 170 C880 182 760 170 640 182 S380 180 250 176 S80 176 0 182Z" fill="#fbd03a" opacity=".85"/>
    <path d="M0 190 C140 182 260 200 420 190 S700 196 1000 186 L1000 214 C820 222 620 210 430 220 S120 222 0 218Z" fill="#f7a6b8" opacity=".75"/>
    <!-- самолёт -->
    <path d="M640 78 l70 10 l42 -14 l6 4 l-34 16 l50 6 l12 -10 l6 2 l-6 14 l4 2 l-60 -2 l-46 18 l-6 -3 l30 -18 l-62 -10z" fill="#1d1d1d"/>
    <!-- море -->
    <path d="M0 250 C90 236 170 262 260 246 S430 238 520 252 S700 240 800 252 S940 246 1000 240 L1000 400 L0 400Z" fill="#8fd2ec"/>
    <path d="M0 290 C70 270 150 300 240 280 S420 300 520 284 S720 300 820 282 S960 292 1000 284 L1000 400 L0 400Z" fill="#2e9e52"/>
    <path d="M0 330 C80 312 160 342 260 322 S460 344 560 326 S760 344 860 328 S960 336 1000 330 L1000 400 L0 400Z" fill="#1d7d3c"/>
    <path d="M30 262 c30 -18 60 -6 90 -16 c-10 22 -50 30 -90 16z M420 270 c40 -26 80 -8 120 -20 c-14 28 -70 34 -120 20z M760 268 c30 -20 80 -10 110 -18 c-16 24 -60 30 -110 18z" fill="#fff"/>
    <!-- водяные столбы и взрыв -->
    <path d="M520 262 C516 200 528 150 540 112 C552 150 556 200 552 262Z M566 262 C566 210 574 170 582 140 C590 176 592 220 588 262Z" fill="#f4fbff"/>
    <g class="mb-blastimg">
      <path d="M210 262 L178 150 L232 222 L250 92 L270 214 L320 120 L300 226 L370 170 L318 254Z" fill="#f4fbff"/>
      <path d="M230 262 L222 190 L250 230 L268 150 L282 228 L318 190 L298 262Z" fill="#ffcf2e"/>
      <path d="M250 262 L250 214 L266 238 L282 206 L284 262Z" fill="#e8331d"/>
      <path d="M150 268 L196 232 L214 262 L196 276Z M168 246 l-6 -40 l8 0 l6 34z" fill="#111"/>
      <path d="M310 272 L356 236 L388 258 L350 286Z M340 250 l10 -28 l7 3 l-9 28z" fill="#111"/>
    </g>
    <!-- подлодка: массивный корпус охрой с чёрной тенью, рубка, антенны, бурун у носа -->
    <path d="M470 366 C520 330 640 300 790 276 C860 266 930 258 968 262 C982 266 980 280 964 288 C900 314 760 346 610 372 C560 382 500 388 478 380 C466 376 464 370 470 366Z" fill="#141414"/>
    <path d="M500 356 C560 330 690 304 820 284 C880 276 930 270 958 270 L960 276 C900 292 780 316 660 338 C590 350 540 360 506 364Z" fill="#e8b434"/>
    <path d="M520 350 C580 330 700 308 830 290" fill="none" stroke="#141414" stroke-width="3"/>
    <path d="M690 300 L700 238 L790 230 L806 282Z" fill="#141414"/>
    <path d="M706 296 L714 246 L780 240 L790 280Z" fill="#e8b434"/>
    <path d="M722 290 L726 250 L742 248 L740 288Z M752 286 L755 246 L770 245 L770 282Z" fill="#141414"/>
    <path d="M740 238 l3 -64 l6 0 l-3 64z M766 236 l2 -40 l5 0 l-2 40z" fill="#141414"/>
    <path d="M746 176 L540 300 M746 176 L930 252" stroke="#141414" stroke-width="2"/>
    <path d="M840 274 l40 -6 l4 8 l-40 6z" fill="#141414"/>
    <path d="M452 384 c40 -30 90 -40 140 -26 c-30 6 -60 20 -70 34 c-24 4 -50 0 -70 -8z M600 372 c60 2 120 -8 170 -24 c-30 26 -110 40 -170 24z" fill="#fff"/>
    <!-- заголовок и транспаранты -->
    <text class="mb-title" x="590" y="56">МОРСКОЙ БОЙ</text>
    <g class="mb-tr" data-t="prize"><rect x="18" y="14" width="96" height="24" rx="3"/><text x="66" y="32">ПРИЗОВАЯ</text></g>
    <g class="mb-tr" data-t="game"><rect x="118" y="14" width="64" height="24" rx="3"/><text x="150" y="32">ИГРА</text></g>
    <g class="mb-tr" data-t="over"><rect x="186" y="14" width="100" height="24" rx="3"/><text x="236" y="32">ОКОНЧЕНА</text></g>
    <g class="mb-tr" data-t="torp"><rect x="40" y="52" width="210" height="26" rx="3"/><text x="145" y="71">ТОРПЕДИРОВАНО</text></g>
    <g class="mb-tr" data-t="pusk"><rect x="760" y="168" width="80" height="26" rx="3"/><text x="800" y="187">ПУСК</text></g>
    ${hits}${launches}
    <!-- роза ветров -->
    <g class="mb-rose" transform="translate(920 92)">
      <circle r="44" class="mb-rose-glow"/>
      <path d="M0 -40 L9 -9 L40 0 L9 9 L0 40 L-9 9 L-40 0 L-9 -9Z" fill="#f6c23a" stroke="#7a3d00" stroke-width="2"/>
      <path d="M0 -40 L9 -9 L0 0Z M40 0 L9 9 L0 0Z M0 40 L-9 9 L0 0Z M-40 0 L-9 -9 L0 0Z" fill="#c9302c"/>
      <circle r="7" fill="#fff4c8" stroke="#7a3d00" stroke-width="2"/>
    </g>
    <!-- смотровые окна -->
    <rect x="36" y="286" width="196" height="100" rx="8" class="mb-win-frame"/>
    <rect x="786" y="292" width="180" height="96" rx="8" class="mb-win-frame"/>
    <rect x="3" y="3" width="994" height="394" rx="10" fill="none" stroke="#1a6f2b" stroke-width="6"/>
  </svg>`;
}

export function mountMorboy(root: HTMLElement, opts?: ArcadeOpts): ArcadeInstance {
  const s: SeaState = newSea();
  if (import.meta.env.DEV) (window as unknown as { morboy?: SeaState }).morboy = s; // для проверки в превью
  const wrap = document.createElement('div');
  wrap.className = 'mb';
  wrap.innerHTML = `<div class="mb-cab">
      <div class="mb-top">${buildBoard()}
        <canvas class="mb-win" style="left:3.6%;top:71.5%;width:19.6%;height:25%"></canvas>
        <canvas class="mb-win" style="left:78.6%;top:73%;width:18%;height:24%"></canvas>
      </div>
      <div class="mb-scope">
        <div class="mb-hood"><canvas class="mb-view" width="${VW}" height="${VH}"></canvas><div class="mb-eye"></div></div>
        <div class="mb-msg" hidden></div>
      </div>
      <div class="mb-panel">
        <div class="mb-grip mb-grip-l" title="Рукоятка перископа: стрелки ← →"><i></i></div>
        <div class="mb-gauge" title="Поворот перископа"><svg viewBox="0 0 200 90"><path d="M20 80 A90 90 0 0 1 180 80" fill="none" stroke="#7a1d12" stroke-width="3"/>
          ${Array.from({ length: 17 }, (_, i) => {
            const a = Math.PI * (1 - i / 16);
            const r1 = 72, r2 = i % 4 === 0 ? 58 : 64;
            return `<line x1="${100 + r1 * Math.cos(a)}" y1="${88 - r1 * Math.sin(a)}" x2="${100 + r2 * Math.cos(a)}" y2="${88 - r2 * Math.sin(a)}" stroke="#3a1a10" stroke-width="2"/>`;
          }).join('')}
          <text x="28" y="88">ЛЕВЫЙ БОРТ</text><text x="100" y="60" text-anchor="middle">ГРАДУСЫ</text><text x="172" y="88" text-anchor="end">ПРАВЫЙ БОРТ</text>
          <line class="mb-needle" x1="100" y1="88" x2="100" y2="22" stroke="#111" stroke-width="3"/></svg></div>
        <div class="mb-grip mb-grip-r" title="Правая рукоятка — кнопка «ПУСК»: Z, Enter или щелчок"><i></i><button class="mb-fire" title="ПУСК"></button></div>
        <button class="mb-coin" title="Бросить монету 15 коп.: пробел"><i></i><span>15 коп.</span></button>
      </div>
    </div>`;
  root.appendChild(wrap);
  const q = <T extends Element>(sel: string) => wrap.querySelector(sel) as T;
  const view = q<HTMLCanvasElement>('.mb-view');
  const ctx = view.getContext('2d')!;
  const wins = [...wrap.querySelectorAll<HTMLCanvasElement>('.mb-win')];
  wins.forEach((c) => {
    c.width = 360;
    c.height = 180;
  });
  const msg = q<HTMLElement>('.mb-msg');
  const needle = q<SVGLineElement>('.mb-needle');
  const fireBtn = q<HTMLButtonElement>('.mb-fire');
  const coinBtn = q<HTMLButtonElement>('.mb-coin');
  const svg = q<SVGSVGElement>('.mb-board');
  const pan = paintPanorama();

  // ---- карточка справа: монеты
  const info = document.createElement('div');
  info.className = 'avt-info';
  info.innerHTML = `<p><b>«Морской бой»</b> <small>(электромеханический, 1974)</small>. Перископ, восемь трасс торпед, силуэты кораблей на цепи — по заводскому техописанию.</p>
    <div class="seg avt-mode">
      <button data-m="strict" title="Рубль на день — шесть монет; кончились — приходите завтра">Строго: рубль в день</button>
      <button data-m="free" title="Монета всегда найдётся">Бесконечные монетки</button>
    </div>
    <div class="avt-pocket"></div>`;
  opts?.panel?.appendChild(info);
  const pocketEl = info.querySelector('.avt-pocket') as HTMLElement;
  const drawPocket = () => {
    const p = pocket();
    info.querySelectorAll<HTMLElement>('[data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === coinMode()));
    pocketEl.innerHTML =
      coinMode() === 'strict'
        ? `<span class="avt-coins">${Array.from({ length: DAILY }, (_, i) => `<i class="${i < p.left ? '' : 'gone'}"></i>`).join('')}</span> ${p.left ? `В кармане ${p.left} × 15 коп.` : 'Монеты кончились — приходите завтра.'}`
        : `<span class="avt-coins"><i></i><i></i><i></i></span> Монет сколько угодно. Сегодня брошено: ${p.played}.`;
  };
  info.querySelectorAll<HTMLButtonElement>('[data-m]').forEach((b) => {
    b.onclick = () => {
      setCoinMode(b.dataset.m as CoinMode);
      drawPocket();
    };
  });
  drawPocket();

  let msgTimer = 0;
  const say = (t: string, ms = 2400) => {
    msg.textContent = t;
    msg.hidden = false;
    clearTimeout(msgTimer);
    msgTimer = window.setTimeout(() => (msg.hidden = true), ms);
  };

  // ---- звук (ШЭМС): шум торпеды, взрыв, «боевая» тревога
  const snd = {
    noise(hp: boolean, dur: number, gain: number) {
      const a = audioOut();
      if (!a) return;
      const src = a.ctx.createBufferSource();
      src.buffer = a.noise;
      src.loop = true;
      const f = a.ctx.createBiquadFilter();
      f.type = hp ? 'highpass' : 'lowpass';
      f.frequency.value = hp ? 2500 : 220;
      const g = a.ctx.createGain();
      const t = a.ctx.currentTime;
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
      src.connect(f).connect(g).connect(a.out);
      src.start(t);
      src.stop(t + dur + 0.05);
    },
    beep() {
      const a = audioOut();
      if (!a) return;
      const o = a.ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = 350;
      const g = a.ctx.createGain();
      const t = a.ctx.currentTime;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.09, t + 0.01);
      g.gain.setValueAtTime(0.09, t + 0.2);
      g.gain.linearRampToValueAtTime(0.0001, t + 0.24);
      o.connect(g).connect(a.out);
      o.start(t);
      o.stop(t + 0.26);
    },
  };

  const handle = (ev: SeaEvent[]) => {
    for (const e of ev) {
      if (e === 'launch') snd.noise(true, 2.6, 0.35);
      else if (e === 'hit') snd.noise(false, 2.2, 0.9);
      else if (e === 'prize') say('Призовая игра! Ещё три пуска.', 3000);
      else if (e === 'over') say(`Игра окончена. Поражено целей: ${s.hits}.`, 3500);
    }
  };

  // ---- монета
  const insertCoin = () => {
    if (paused) return;
    if (!takeCoin()) {
      say('Монеты кончились. Завтра будет ещё рубль.', 3000);
      drawPocket();
      return;
    }
    coinBtn.classList.remove('drop');
    void coinBtn.offsetWidth;
    coinBtn.classList.add('drop');
    const ev: SeaEvent[] = [];
    if (!coin(s, ev)) {
      giveBack();
      say('Идёт игра — монета звякнула в возврат.');
    }
    handle(ev);
    drawPocket();
  };
  coinBtn.onclick = insertCoin;

  const doFire = () => {
    if (paused) return;
    fireBtn.classList.add('down');
    setTimeout(() => fireBtn.classList.remove('down'), 140);
    const ev: SeaEvent[] = [];
    fire(s, ev);
    handle(ev);
  };
  fireBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    doFire();
  });

  // ---- поворот перископа: клавиши, перетаскивание по окуляру или рукояткам
  const turning = { l: false, r: false };
  const onKey = (e: KeyboardEvent, down: boolean) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.metaKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === ' ') {
      e.preventDefault();
      if (down && !e.repeat) insertCoin();
    } else if (k === 'arrowleft' || k === 'a' || k === 'ф') {
      e.preventDefault();
      turning.l = down;
    } else if (k === 'arrowright' || k === 'd' || k === 'в') {
      e.preventDefault();
      turning.r = down;
    } else if (k === 'z' || k === 'я' || k === 'enter' || k === 'control' || k === 'arrowup' || k === 'w' || k === 'ц') {
      e.preventDefault();
      if (down && !e.repeat) doFire();
    }
  };
  const kd = (e: KeyboardEvent) => onKey(e, true);
  const ku = (e: KeyboardEvent) => onKey(e, false);
  const blur = () => (turning.l = turning.r = false);
  window.addEventListener('keydown', kd);
  window.addEventListener('keyup', ku);
  window.addEventListener('blur', blur);
  const dragTurn = (el: HTMLElement, sens: number) => {
    el.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.mb-fire')) return;
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      let lx = e.clientX;
      const move = (ev: PointerEvent) => {
        const w = el.getBoundingClientRect().width || 1;
        turn(s, s.aim - ((ev.clientX - lx) / w) * sens);
        lx = ev.clientX;
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  };
  dragTurn(q('.mb-hood'), FOV);
  dragTurn(q('.mb-panel'), -FOV * 1.2);

  // ---- отрисовка
  const lampGlow = (x: number, y: number, r: number, a: number) => {
    // лампа под зелёным стеклом: горячее ядро, тёплый ореол и пятно, расплывшееся в стекле
    const R = r * 5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, R);
    g.addColorStop(0, `rgba(255,255,235,${a})`);
    g.addColorStop(0.12, `rgba(255,246,170,${a * 0.95})`);
    g.addColorStop(0.4, `rgba(200,240,120,${a * 0.45})`);
    g.addColorStop(1, 'rgba(60,200,110,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, R, R * 0.55, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  const draw = () => {
    const sx = (cm: number) => VW / 2 + (cm - s.aim) * K;
    const srcX = pan.X(s.aim - FOV / 2);
    ctx.clearRect(0, 0, VW, VH);
    ctx.drawImage(pan.back, srcX, 0, VW, VH, 0, 0, VW, VH);
    // корабли на линии горизонта (покачиваются на цепи)
    for (const sh of ships(s)) {
      const x = sx(sh.x);
      if (x < -300 || x > VW + 300) continue;
      ctx.save();
      ctx.translate(x, HOR + 3 + Math.sin(s.time * 3 + sh.kind) * 0.6);
      ctx.scale((sh.dir * K * SHIP_LEN) / 7.7, (K * SHIP_LEN) / 7.7);
      ctx.fillStyle = '#121418';
      ctx.fill(SHIPS[sh.kind]);
      ctx.strokeStyle = 'rgba(200,210,220,0.35)';
      ctx.lineWidth = 0.05;
      ctx.stroke(SHIPS[sh.kind]);
      ctx.restore();
    }
    ctx.drawImage(pan.shields, srcX, 0, VW, VH, 0, 0, VW, VH);
    // лампочки трассы под стеклом
    const lamp = torpedoLamp(s);
    if (s.torpedo && lamp) {
      // нить предыдущей лампы ещё остывает
      if (lamp > 1) {
        const p = lampAt(s.torpedo.track, lamp - 1);
        const cool = Math.max(0, 1 - ((s.torpedo.t % TICK) / TICK) * 2.2);
        if (cool > 0) lampGlow(sx(p.x), p.y, p.r, 0.55 * cool);
      }
      const l = lampAt(s.torpedo.track, lamp);
      const warm = Math.min(1, ((s.torpedo.t % TICK) / TICK) * 4 + 0.35);
      lampGlow(sx(l.x), l.y, l.r, warm);
    }
    // освещение: затемнение при взрыве и красный фонарь
    if (s.blast > 0) {
      const f = s.blast / BLAST_TIME;
      ctx.fillStyle = 'rgba(2,4,8,0.86)';
      ctx.fillRect(0, 0, VW, VH);
      const bx = sx(trackX(s.blastTrack));
      const flick = 0.75 + 0.25 * Math.sin(s.time * 37);
      const g = ctx.createRadialGradient(bx, HOR - 10, 0, bx, HOR - 10, 260);
      g.addColorStop(0, `rgba(255,120,60,${0.95 * flick * Math.min(1, f * 1.6)})`);
      g.addColorStop(0.35, `rgba(220,30,20,${0.6 * flick * Math.min(1, f * 1.4)})`);
      g.addColorStop(1, 'rgba(120,0,0,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, VW, VH);
    } else if (!s.playing) {
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(0, 0, VW, VH);
    }
    // смотровые окна табло — та же панорама целиком, без визиров
    for (const w of wins) {
      const c = w.getContext('2d')!;
      c.drawImage(view, VW * 0.1, VH * 0.18, VW * 0.8, VH * 0.6, 0, 0, w.width, w.height);
    }
    // визиры: средний и два боковых (тёмные, не в фокусе)
    ctx.save();
    ctx.filter = 'blur(2px)';
    ctx.fillStyle = 'rgba(15,15,15,0.85)';
    for (const [dx, w] of [[0, 7], [-VW * 0.14, 5], [VW * 0.14, 5]] as const) {
      const x = VW / 2 + dx;
      ctx.beginPath();
      ctx.moveTo(x - w, 0);
      ctx.lineTo(x + w, 0);
      ctx.lineTo(x + w, HOR - 34);
      ctx.lineTo(x, HOR - 12);
      ctx.lineTo(x - w, HOR - 34);
      ctx.fill();
    }
    ctx.restore();
  };

  const syncBoard = () => {
    const tr = (t: string, on: boolean) => svg.querySelector(`[data-t=${t}]`)?.classList.toggle('on', on);
    tr('game', true);
    tr('over', !s.playing);
    tr('prize', s.prize);
    tr('pusk', s.ready);
    tr('torp', s.torpedoed);
    svg.querySelectorAll<SVGGElement>('[data-l]').forEach((g) => {
      const n = Number(g.dataset.l);
      g.classList.toggle('on', s.playing && (n === s.litLaunch || (s.prize && n === LAUNCHES)));
    });
    svg.querySelectorAll<SVGGElement>('[data-h]').forEach((g) => {
      const n = Number(g.dataset.h);
      g.classList.toggle('on', n === s.litHit || (s.hits >= LAUNCHES && n === LAUNCHES && s.litHit !== 0));
    });
    svg.querySelector('.mb-blastimg')?.classList.toggle('on', s.blast > 0);
    svg.querySelector('.mb-rose')?.classList.toggle('on', roseOn(s));
    needle.setAttribute('transform', `rotate(${(s.aim / AIM_MAX) * 70} 100 88)`);
  };

  let dead = false;
  let paused = false;
  let raf = 0;
  let last = performance.now();
  let rose = false;
  const frame = (t: number) => {
    if (dead) return;
    const dt = paused ? 0 : Math.min(0.1, (t - last) / 1000);
    last = t;
    if (dt > 0) {
      const v = (turning.r ? 1 : 0) - (turning.l ? 1 : 0);
      if (v) turn(s, s.aim + v * 11 * dt);
      const ev: SeaEvent[] = [];
      step(s, dt, ev);
      handle(ev);
      const r = roseOn(s);
      if (r && !rose && s.alarm) snd.beep();
      rose = r;
    }
    draw();
    syncBoard();
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  say('Опустите монету (пробел). Перископ — стрелками или мышью, «ПУСК» — Z.', 4200);

  return {
    pause(on) {
      paused = on;
      if (on) blur();
    },
    launch() {
      insertCoin();
    },
    destroy() {
      dead = true;
      cancelAnimationFrame(raf);
      clearTimeout(msgTimer);
      info.remove();
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', blur);
      wrap.remove();
    },
  };
}
