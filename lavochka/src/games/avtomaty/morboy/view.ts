/* «Морской бой»: вид в окуляр перископа во весь экран, как на снимке настоящего автомата — овальный вырез на чёрном,
 * панорама под зелёным стеклом (рисованные кучевые облака, море в мазках волн), плоские силуэты кораблей на горизонте,
 * две тёмные линии визиров, зелёные лампочки трассы торпеды. Табло (пуски, попадания, транспаранты) — в чёрных углах
 * вокруг окуляра. Логика — logic.ts. */
import { audioOut } from '../../../core/audio';
import type { ArcadeInstance, ArcadeOpts } from '../../../core/arcade';
import { giveBack, takeCoin } from '../coins';
import { mountShell } from '../screen';
import {
  AIM_MAX, BLAST_TIME, coin, fire, FOV, HALF_W, LAUNCHES, newSea, roseOn, ships, SHIP_LEN, step, TICK, torpedoLamp,
  trackX, TRACKS, turn, type SeaEvent, type SeaState,
} from './logic';

// ---- окуляр и панорама — в своих координатах VW×VH (мир в см); экран вокруг — LW×LH: широкий (табло по бокам)
// или высокий для телефона стоя (табло над и под окуляром, бока обрезаны)
const VW = 1200;
const VH = 560;
const OX = VW / 2;
const OY = VH / 2;
const RX = 440;
const RY = 279;
const K = (RX * 2) / FOV; // точек на см: поле зрения — ширина окуляра
const HOR = VH * 0.73; // линия горизонта, как на снимке
const PAN_W = (HALF_W + 18) * 2; // ширина заготовки панорамы, см
/** Линии визиров — делят окуляр на три окна. */
const VISOR = RX * 0.357;

const LAMP_Z = Array.from({ length: 10 }, (_, i) => Math.pow(0.8, i)); // глубина лампочек: 1 у глаза … ~0.13 у горизонта

/** Точка трассы k, лампочка i (1…10) в координатах мира (x — см, y — точки экрана). */
function lampAt(k: number, i: number) {
  const d = LAMP_Z[i - 1];
  const f = 1 - d;
  const bottom = VH * 1.02;
  return { x: (trackX(k) * f) / 0.87, y: HOR + (bottom - HOR) * d * 0.9, r: 3 + 8 * d };
}

/** Контур окуляра: сверхэллипс (бока круче, чем у эллипса). */
function scopePath(g: CanvasRenderingContext2D, grow = 0) {
  const n = 2.6;
  g.beginPath();
  for (let i = 0; i <= 160; i++) {
    const t = (i / 160) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const x = OX + (RX + grow) * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
    const y = OY + (RY + grow) * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.closePath();
}

// ---- силуэты кораблей (см, носом вправо, начало — середина киля): корпус тёмный, надстройка цветная
type Part = { fill: string; path: Path2D };
function shipParts(kind: number): Part[] {
  const hull = new Path2D();
  const top = new Path2D();
  const extra = new Path2D();
  if (kind === 0) {
    // грузовой пароход: длинный корпус с седловатой палубой, ступенчатая надстройка светлой охрой, мачта
    hull.moveTo(-3.9, -0.95);
    hull.lineTo(3.6, -1.15);
    hull.lineTo(3.1, 0);
    hull.lineTo(-3.4, 0);
    hull.closePath();
    top.rect(-2.5, -1.75, 3.6, 0.85);
    top.rect(-1.9, -2.4, 2.4, 0.7);
    top.rect(-1.3, -2.95, 1.3, 0.6);
    top.rect(-0.85, -3.9, 0.28, 1.0); // мачта
    top.rect(-0.3, -3.25, 0.5, 0.35);
    top.rect(1.3, -1.4, 0.9, 0.3);
  } else {
    // сторожевик: корпус с высоким носом, надстройка — синяя пирамида с красными огнями
    hull.moveTo(-3.6, -0.9);
    hull.lineTo(3.9, -1.3);
    hull.lineTo(3.2, 0);
    hull.lineTo(-3.2, 0);
    hull.closePath();
    top.moveTo(-1.8, -1.0);
    top.lineTo(-0.2, -3.6);
    top.lineTo(0.15, -3.6);
    top.lineTo(1.6, -1.1);
    top.closePath();
    extra.rect(-2.4, -1.45, 0.6, 0.5);
    extra.rect(1.7, -1.6, 0.6, 0.5);
  }
  return [
    { fill: '#2c3442', path: hull },
    { fill: kind === 0 ? '#e3cf92' : '#3567b8', path: top },
    { fill: '#c83a2a', path: extra },
  ];
}
const SHIPS = [shipParts(0), shipParts(1)];

/** Детерминированный «шум» для росписи. */
const rnd = (() => {
  let x = 7;
  return () => (x = (x * 16807) % 2147483647) / 2147483647;
})();

/** Кучевое облако как на росписи: сплошной силуэт клубов кремовой краской с тёмной обводкой и завитками внутри,
 * плоское снизу; большие — башней вверх. */
function cloud(g: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number) {
  const puffs: [number, number, number][] = [];
  const n = 6 + Math.floor(w / 22);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const hump = Math.pow(Math.sin(Math.PI * t), 0.8);
    const r = h * (0.18 + 0.32 * hump) * (0.8 + rnd() * 0.4);
    puffs.push([cx - w / 2 + w * t, cy - r * 0.55 - hump * h * 0.35 * rnd(), r]);
  }
  for (let i = 0; i < n * 0.8; i++) {
    const t = 0.2 + rnd() * 0.6;
    const hump = Math.sin(Math.PI * t);
    puffs.push([cx - w / 2 + w * t, cy - h * (0.35 + 0.45 * hump * rnd()), h * (0.12 + 0.2 * hump)]);
  }
  g.save();
  g.beginPath();
  g.rect(cx - w, cy - h * 3, w * 2, h * 3);
  g.clip(); // низ облака — ровный
  const all = (grow: number, fill: string) => {
    g.fillStyle = fill;
    g.beginPath();
    for (const [x, y, r] of puffs) {
      g.moveTo(x + r + grow, y);
      g.arc(x, y, r + grow, 0, Math.PI * 2);
    }
    g.fill();
  };
  all(2.2, 'rgba(105,120,98,0.85)'); // обводка
  all(0, '#d9d9bf');
  // завитки: верхняя дуга каждого клуба, светлая шапка и тёмная черта
  g.lineCap = 'round';
  for (const [x, y, r] of puffs) {
    if (r < 6) continue;
    g.strokeStyle = 'rgba(250,248,230,0.7)';
    g.lineWidth = Math.max(2, r * 0.25);
    g.beginPath();
    g.arc(x - r * 0.08, y + r * 0.05, r * 0.7, Math.PI * 1.1, Math.PI * 1.7);
    g.stroke();
    g.strokeStyle = 'rgba(120,132,108,0.55)';
    g.lineWidth = 1.4;
    g.beginPath();
    g.arc(x, y + r * 0.35, r * 0.95, Math.PI * 1.15, Math.PI * 1.55);
    g.stroke();
  }
  g.restore();
  g.fillStyle = 'rgba(105,120,98,0.6)';
  g.fillRect(cx - w / 2 - h * 0.2, cy - 2, w + h * 0.4, 2);
}

/** Заготовка панорамы: небо, облака, море в мазках волн, прорези лампочек. */
function paintPanorama() {
  const W = Math.round(PAN_W * K);
  const back = document.createElement('canvas');
  back.width = W;
  back.height = VH;
  const g = back.getContext('2d')!;
  const X = (cm: number) => (cm + PAN_W / 2) * K;
  const sky = g.createLinearGradient(0, 0, 0, HOR);
  sky.addColorStop(0, '#4b8775');
  sky.addColorStop(0.55, '#79a48e');
  sky.addColorStop(1, '#93b199');
  g.fillStyle = sky;
  g.fillRect(0, 0, W, HOR + 2);
  // облака: ряды вверху, громады в середине, лёгкие у горизонта
  for (let x = 40; x < W; x += 260 + rnd() * 220) cloud(g, x, 50 + rnd() * 60, 150 + rnd() * 180, 34 + rnd() * 22);
  for (let x = 120; x < W; x += 380 + rnd() * 300) cloud(g, x, HOR * 0.66 + rnd() * 30, 260 + rnd() * 220, 110 + rnd() * 80);
  for (let x = 0; x < W; x += 200 + rnd() * 200) {
    g.strokeStyle = 'rgba(220,220,190,0.35)';
    g.lineWidth = 1.5;
    const y = HOR * (0.78 + rnd() * 0.15);
    for (let k = 0; k < 6; k++) {
      g.beginPath();
      g.arc(x + k * 16, y, 9 + rnd() * 5, Math.PI, 0);
      g.stroke();
    }
  }
  // море: тёмно-зелёное, мазки волн светлее и крупнее к зрителю
  const sea = g.createLinearGradient(0, HOR, 0, VH);
  sea.addColorStop(0, '#5b7d64');
  sea.addColorStop(0.3, '#3f5f48');
  sea.addColorStop(1, '#22382a');
  g.fillStyle = sea;
  g.fillRect(0, HOR, W, VH - HOR);
  for (let row = 0; row < 40; row++) {
    const t = row / 40;
    const y = HOR + 3 + (VH - HOR) * Math.pow(t, 1.5);
    const len = 40 + 220 * t;
    g.lineWidth = 0.8 + 3 * t;
    for (let x = -rnd() * len; x < W; x += len * (0.7 + rnd() * 0.7)) {
      g.strokeStyle = rnd() < 0.6 ? `rgba(150,195,160,${0.25 + 0.25 * t})` : `rgba(15,35,22,${0.3 + 0.2 * t})`;
      g.beginPath();
      g.moveTo(x, y);
      g.bezierCurveTo(x + len * 0.3, y - 1 - 3 * t, x + len * 0.6, y + 1 + 3 * t, x + len, y);
      g.stroke();
    }
  }
  // прорези под лампочки — восемь лучей по десять, еле видны
  for (let k = 0; k < TRACKS; k++)
    for (let i = 1; i <= 10; i++) {
      const l = lampAt(k, i);
      g.fillStyle = 'rgba(10,30,18,0.45)';
      g.beginPath();
      g.ellipse(X(l.x), l.y, l.r * 1.2, l.r * 0.5, 0, 0, Math.PI * 2);
      g.fill();
    }
  // зерно росписи
  const grain = g.getImageData(0, 0, W, VH);
  for (let i = 0; i < grain.data.length; i += 4) {
    const v = (rnd() - 0.5) * 14;
    grain.data[i] += v;
    grain.data[i + 1] += v;
    grain.data[i + 2] += v;
  }
  g.putImageData(grain, 0, 0);
  return { back, X };
}

export function mountMorboy(root: HTMLElement, opts?: ArcadeOpts): ArcadeInstance {
  const s: SeaState = newSea();
  if (import.meta.env.DEV) (window as unknown as { morboy?: SeaState }).morboy = s; // для проверки в превью
  const turning = { l: false, r: false };
  const sh = mountShell(root, opts, {
    cls: 'avs--scope',
    aspect: VW / VH,
    info: `<p><b>«Морской бой»</b> <small>(электромеханический, 1974)</small>. Перископ, восемь трасс торпед, силуэты кораблей на цепи — по заводскому техописанию.
      10 торпед; 10 попаданий из 10 — призовая игра, ещё три пуска.</p>`,
    pad: 'x',
    buttons: [{ id: 'fire', label: 'ПУСК', big: true }],
    onCoin: () => insertCoin(),
    onInput: (k, down) => {
      if (k === 'left') turning.l = down;
      else if (k === 'right') turning.r = down;
      else if (k === 'fire' && down) doFire();
    },
  });
  const view = document.createElement('canvas');
  sh.screen.appendChild(view);
  let LW = VW;
  let LH = VH;
  let tall = false;
  const layout = () => {
    const r = sh.wrap.getBoundingClientRect();
    const t = r.width > 0 && r.width / Math.max(1, r.height) < 1.3;
    if (t === tall && view.width) return;
    tall = t;
    LW = tall ? 900 : VW;
    LH = tall ? VH + 220 : VH;
    view.width = LW;
    view.height = LH;
    sh.wrap.style.setProperty('--ar', String(LW / LH));
  };
  layout();
  const ro = new ResizeObserver(layout);
  ro.observe(sh.wrap);
  const ctx = view.getContext('2d')!;
  const { say, drawPocket } = sh;
  const pan = paintPanorama();

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
    sh.drop();
    const ev: SeaEvent[] = [];
    if (!coin(s, ev)) {
      giveBack();
      say('Идёт игра — монета звякнула в возврат.');
    }
    handle(ev);
    drawPocket();
  };

  const doFire = () => {
    if (paused) return;
    const ev: SeaEvent[] = [];
    fire(s, ev);
    handle(ev);
  };

  // ---- поворот перископа: клавиши; мышью или пальцем — тащить панораму, щелчок без сдвига — «ПУСК»
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
      sh.lit('fire', down);
    }
  };
  const kd = (e: KeyboardEvent) => onKey(e, true);
  const ku = (e: KeyboardEvent) => onKey(e, false);
  const blur = () => (turning.l = turning.r = false);
  window.addEventListener('keydown', kd);
  window.addEventListener('keyup', ku);
  window.addEventListener('blur', blur);
  view.style.cursor = 'ew-resize';
  view.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    view.setPointerCapture(e.pointerId);
    let lx = e.clientX;
    let moved = 0;
    const move = (ev: PointerEvent) => {
      const w = view.getBoundingClientRect().width * ((RX * 2) / LW) || 1;
      turn(s, s.aim - ((ev.clientX - lx) / w) * FOV);
      moved += Math.abs(ev.clientX - lx);
      lx = ev.clientX;
    };
    const up = () => {
      view.removeEventListener('pointermove', move);
      view.removeEventListener('pointerup', up);
      view.removeEventListener('pointercancel', up);
      if (moved < 6 && e.pointerType === 'mouse') doFire();
    };
    view.addEventListener('pointermove', move);
    view.addEventListener('pointerup', up);
    view.addEventListener('pointercancel', up);
  });

  // ---- отрисовка
  const lampGlow = (x: number, y: number, r: number, a: number) => {
    // лампа под зелёным стеклом: горячее ядро и зелёное пятно, расплывшееся в стекле
    const R = r * 4.5;
    const g = ctx.createRadialGradient(x, y, 0, x, y, R);
    g.addColorStop(0, `rgba(235,255,220,${a})`);
    g.addColorStop(0.15, `rgba(170,255,150,${a * 0.9})`);
    g.addColorStop(0.45, `rgba(70,220,110,${a * 0.4})`);
    g.addColorStop(1, 'rgba(40,180,90,0)');
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(x, y, R, R * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  // табло в углах: лампы-номера и транспаранты (горят — светятся тёплым)
  const lampNum = (x: number, y: number, n: number, on: boolean) => {
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    if (on) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, 18);
      g.addColorStop(0, '#fffbe6');
      g.addColorStop(0.5, '#ffd84a');
      g.addColorStop(1, 'rgba(255,150,0,0)');
      ctx.fillStyle = g;
      ctx.fill();
    } else {
      ctx.fillStyle = '#16191a';
      ctx.fill();
      ctx.strokeStyle = '#3a4140';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.fillStyle = on ? '#6a1500' : '#59625f';
    ctx.font = '700 13px "Arial Narrow", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), x, y + 1);
  };
  const banner = (x: number, y: number, w: number, text: string, on: boolean) => {
    ctx.fillStyle = on ? '#fff0a0' : '#141718';
    ctx.strokeStyle = on ? '#ffd84a' : '#343b3a';
    ctx.lineWidth = 1.5;
    if (on) {
      ctx.shadowColor = '#ffcc33';
      ctx.shadowBlur = 16;
    }
    ctx.fillRect(x, y, w, 24);
    ctx.shadowBlur = 0;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, 23);
    ctx.fillStyle = on ? '#7a1b00' : '#5a6361';
    ctx.font = '700 14px "Arial Narrow", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + w / 2, y + 13);
  };
  const caption = (x: number, y: number, t: string) => {
    ctx.fillStyle = '#7d8885';
    ctx.font = '700 12px "Arial Narrow", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(t, x, y);
  };
  const drawBoard = () => {
    const blink = roseOn(s);
    caption(80, 22, 'ПУСКИ');
    caption(LW - 80, 22, 'ПОРАЖЕНО');
    for (let i = 0; i < 10; i++) {
      const cx = 24 + (i % 5) * 28;
      const cy = 42 + Math.floor(i / 5) * 30;
      const n = i + 1;
      lampNum(cx, cy, n, s.playing && (n === s.litLaunch || (s.prize && n === LAUNCHES)));
      lampNum(LW - 136 + (i % 5) * 28, cy, n, n === s.litHit || (s.hits >= LAUNCHES && n === LAUNCHES && s.litHit !== 0));
    }
    banner(14, LH - 104, 120, 'ПРИЗОВАЯ', s.prize);
    banner(14, LH - 74, 120, 'ИГРА', true);
    banner(14, LH - 44, 120, 'ОКОНЧЕНА', !s.playing);
    banner(LW - 154, LH - 74, 140, 'ТОРПЕДИРОВАНО', s.torpedoed);
    banner(LW - 124, LH - 44, 80, 'ПУСК', s.ready && (blink || !s.alarm));
    // «роза ветров» мигает, пока ждёт пуска
    const rx = tall ? LW / 2 : LW - 84;
    const ry = tall ? 55 : 130;
    ctx.save();
    ctx.translate(rx, ry);
    const on = roseOn(s) && s.playing && s.ready;
    ctx.fillStyle = on ? '#f6c23a' : '#2a2e2e';
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
      const r = i % 2 ? 7 : 22;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath();
    if (on) {
      ctx.shadowColor = '#ffcc33';
      ctx.shadowBlur = 14;
    }
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#7d8885';
    ctx.font = '700 11px "Arial Narrow", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('ЛЕВЫЙ БОРТ', 210, LH - 12);
    ctx.fillText('ПРАВЫЙ БОРТ', LW - 210, LH - 12);
  };

  const draw = () => {
    const sx = (cm: number) => OX + (cm - s.aim) * K;
    const srcX = pan.X(s.aim) - OX;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, LW, LH);
    ctx.save();
    ctx.translate((LW - VW) / 2, (LH - VH) / 2);
    ctx.save();
    scopePath(ctx);
    ctx.clip();
    ctx.drawImage(pan.back, srcX, 0, VW, VH, 0, 0, VW, VH);
    // корабли на линии горизонта (покачиваются на цепи)
    for (const shp of ships(s)) {
      const x = sx(shp.x);
      if (x < -300 || x > VW + 300) continue;
      ctx.save();
      // корабль выходит из дымки у края панорамы и уходит в неё
      ctx.globalAlpha = Math.max(0, Math.min(1, (HALF_W + 5 - Math.abs(shp.x)) / 5));
      ctx.translate(x, HOR + 2 + Math.sin(s.time * 3 + shp.kind) * 0.6);
      ctx.scale((shp.dir * K * SHIP_LEN) / 7.7, (K * SHIP_LEN) / 7.7);
      for (const part of SHIPS[shp.kind]) {
        ctx.fillStyle = part.fill;
        ctx.fill(part.path);
      }
      ctx.restore();
    }
    // лампочки трассы под стеклом
    const lamp = torpedoLamp(s);
    if (s.torpedo && lamp) {
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
      ctx.fillStyle = 'rgba(2,6,4,0.86)';
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
      ctx.fillStyle = 'rgba(0,10,4,0.22)';
      ctx.fillRect(0, 0, VW, VH);
    }
    // зелёное стекло: тон и затенение к краю окуляра
    ctx.fillStyle = 'rgba(40,90,50,0.12)';
    ctx.fillRect(0, 0, VW, VH);
    const vg = ctx.createRadialGradient(OX, OY, RY * 0.7, OX, OY, RX * 1.05);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,8,2,0.6)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, VW, VH);
    // линии визиров — во всю высоту
    ctx.fillStyle = '#0b0d0c';
    ctx.fillRect(OX - VISOR - 2, 0, 4, VH);
    ctx.fillRect(OX + VISOR - 2, 0, 4, VH);
    // средний визир — метка прицела над горизонтом
    ctx.beginPath();
    ctx.moveTo(OX - 7, HOR - 46);
    ctx.lineTo(OX + 7, HOR - 46);
    ctx.lineTo(OX, HOR - 30);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // кромка окуляра — мягкая тень
    ctx.save();
    scopePath(ctx, 6);
    ctx.lineWidth = 14;
    ctx.strokeStyle = 'rgba(0,0,0,0.85)';
    ctx.filter = 'blur(6px)';
    ctx.stroke();
    ctx.restore();
    ctx.restore();
    drawBoard();
    // указатель поворота
    const nx = LW / 2 + (s.aim / AIM_MAX) * 120;
    ctx.fillStyle = '#3a4140';
    ctx.fillRect(LW / 2 - 130, LH - 6, 260, 2);
    ctx.fillStyle = '#ffd84a';
    ctx.fillRect(nx - 2, LH - 12, 4, 10);
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
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  say('Опустите монету (пробел). Перископ — стрелками или мышью, «ПУСК» — Z или щелчок.', 4200);

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
      ro.disconnect();
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', blur);
      sh.destroy();
    },
  };
}
