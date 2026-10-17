/* «Морской бой»: вид в окуляр перископа на диораму — как у настоящего автомата это не картинка, а ящик: задник
 * с небом и облаками под светом лампы, боковые стенки с расписными горами, скалы-мысы в углах, пол — море со
 * стеклом и лампочками трасс; корабли — силуэты на цепи вдоль задника. Всё рисуем в перспективе один раз, потом
 * сдвигаем при повороте перископа. Транспаранты «ПРИЗОВАЯ ИГРА ОКОНЧЕНА» горят прямо на небе; при попадании свет
 * в ящике гаснет. Табло «ПУСК» и «ТОРПЕДИРОВАНО» — красным по краям окуляра. Логика — logic.ts. */
import { audioOut } from '../../../core/audio';
import type { ArcadeInstance, ArcadeOpts } from '../../../core/arcade';
import { giveBack, takeCoin } from '../coins';
import { mountShell } from '../screen';
import {
  AIM_MAX, BLAST_TIME, coin, fire, HALF_W, LAUNCHES, newSea, roseOn, ships, step, TICK, torpedoLamp, trackX,
  TRACKS, turn, type SeaEvent, type SeaState,
} from './logic';

// ---- окуляр VW×VH (свои координаты), экран LW×LH: сверху полоса «ПУСК», снизу «ТОРПЕДИРОВАНО»
const VW = 1200;
const VH = 700;
const TOP = 80;
const LW = VW;
const LH = TOP + VH + 130;
const OX = VW / 2;
const OY = VH / 2;
const RX = 590;
const RY = 345;
/** Линии визиров — делят окуляр на три окна. */
const VISOR = RX * 0.38;

// ---- ящик: задник — плоскость Z=1, пол и потолок сходятся к уровню глаза E; Z меньше — ближе к перископу
const B = HALF_W + 2; // полуширина задника, см
const K = 10.8; // точек на см на заднике
const BW = B * K; // полуширина задника, точек
const WT = 165; // верх задника
const HOR = 420; // низ задника — горизонт
const E = 300; // уровень глаза
const Z_NEAR = 0.24;
const sx0 = (X: number, Z: number) => X / Z; // X — точки на заднике (Z=1)
const sy0 = (Y: number, Z: number) => E + (Y - E) / Z;
/** Панорама шире окуляра: при повороте перископа сдвигается на ±AIM_MAX см. */
const PW = Math.ceil(2 * (OX + AIM_MAX * K + 40));
const PC = PW / 2;

/** Лампочка трассы k, номер i (1 — у перископа … 10 — у горизонта): точка на полу. */
function lampAt(k: number, i: number) {
  const Z = 0.3 + ((i - 1) / 9) * 0.66;
  const X = trackX(k) * K * ((Z - Z_NEAR) / (1 - Z_NEAR)); // трасса идёт от перископа к точке на заднике
  return { x: sx0(X, Z), y: sy0(HOR, Z), r: 2.4 / Z };
}

/** Контур окуляра: сверхэллипс (бока и верх площе эллипса). */
function scopePath(g: CanvasRenderingContext2D, grow = 0) {
  const n = 3;
  g.beginPath();
  for (let i = 0; i <= 180; i++) {
    const t = (i / 180) * Math.PI * 2;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const x = OX + (RX + grow) * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
    const y = OY + (RY + grow) * Math.sign(s) * Math.pow(Math.abs(s), 2 / n);
    if (i) g.lineTo(x, y);
    else g.moveTo(x, y);
  }
  g.closePath();
}

/** Детерминированный «шум» для росписи. */
const rnd = (() => {
  let x = 7;
  return () => (x = (x * 16807) % 2147483647) / 2147483647;
})();

const canvas = (w: number, h: number) => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

/** Облако росписи: мягкие белые клубы с серо-голубой тенью снизу, плоское основание. */
function cloud(g: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number, shade = 'rgba(120,150,150,0.55)') {
  const puffs: [number, number, number][] = [];
  const n = 4 + Math.floor(w / 18);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const hump = Math.pow(Math.sin(Math.PI * t), 0.9);
    const r = h * (0.25 + 0.4 * hump) * (0.75 + rnd() * 0.5);
    puffs.push([cx - w / 2 + w * t, cy - r * 0.5 - hump * h * 0.25 * rnd(), r]);
  }
  g.save();
  g.beginPath();
  g.rect(cx - w, cy - h * 3, w * 2, h * 3);
  g.clip();
  g.filter = 'blur(1.2px)';
  g.fillStyle = shade;
  g.beginPath();
  for (const [x, y, r] of puffs) {
    g.moveTo(x + r, y + r * 0.25);
    g.arc(x, y + r * 0.25, r, 0, Math.PI * 2);
  }
  g.fill();
  g.fillStyle = '#f2f6ee';
  g.beginPath();
  for (const [x, y, r] of puffs) {
    g.moveTo(x + r * 0.92, y - r * 0.05);
    g.arc(x, y - r * 0.05, r * 0.92, 0, Math.PI * 2);
  }
  g.fill();
  g.restore();
}

/** Горы росписи на стенке: красно-бурые пики со снежными шапками, тёмная теневая сторона. */
function mountains(g: CanvasRenderingContext2D, w: number, base: number, peaks: [number, number][], dark = 1) {
  for (const [px, ph] of peaks) {
    const half = ph * (0.45 + rnd() * 0.25);
    const top = base - ph;
    g.fillStyle = `rgb(${Math.round(150 * dark)},${Math.round(88 * dark)},${Math.round(58 * dark)})`;
    g.beginPath();
    g.moveTo(px - half, base);
    g.lineTo(px - half * 0.35, top + ph * 0.35);
    g.lineTo(px, top);
    g.lineTo(px + half * 0.4, top + ph * 0.3);
    g.lineTo(px + half, base);
    g.fill();
    // теневая сторона
    g.fillStyle = `rgb(${Math.round(78 * dark)},${Math.round(42 * dark)},${Math.round(30 * dark)})`;
    g.beginPath();
    g.moveTo(px, top);
    g.lineTo(px + half * 0.4, top + ph * 0.3);
    g.lineTo(px + half, base);
    g.lineTo(px + half * 0.1, base);
    g.lineTo(px + half * 0.15, top + ph * 0.45);
    g.fill();
    // снег
    g.fillStyle = `rgb(${Math.round(236 * dark)},${Math.round(236 * dark)},${Math.round(226 * dark)})`;
    g.beginPath();
    g.moveTo(px, top);
    g.lineTo(px - half * 0.22, top + ph * 0.2);
    g.lineTo(px - half * 0.05, top + ph * 0.16);
    g.lineTo(px + half * 0.06, top + ph * 0.24);
    g.lineTo(px + half * 0.24, top + ph * 0.18);
    g.fill();
  }
  void w;
}

/** Небо росписи: мятный градиент, светлее под лампой. */
function sky(g: CanvasRenderingContext2D, w: number, h: number, dark = 1) {
  const gr = g.createLinearGradient(0, 0, 0, h);
  const c = (r: number, gg: number, b: number) => `rgb(${Math.round(r * dark)},${Math.round(gg * dark)},${Math.round(b * dark)})`;
  gr.addColorStop(0, c(150, 205, 190));
  gr.addColorStop(0.5, c(112, 172, 158));
  gr.addColorStop(1, c(150, 188, 174));
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
}

/** Стенка ящика в перспективе: текстура ложится полосками от задника (Z=1) к перископу (Z_NEAR). */
function wall(g: CanvasRenderingContext2D, tex: HTMLCanvasElement, side: -1 | 1) {
  const steps = 260;
  for (let i = 0; i < steps; i++) {
    const z1 = 1 - ((1 - Z_NEAR) * i) / steps;
    const z2 = 1 - ((1 - Z_NEAR) * (i + 1)) / steps;
    const xa = PC + side * sx0(BW, z1);
    const xb = PC + side * sx0(BW, z2);
    const top = sy0(WT, (z1 + z2) / 2);
    const bot = sy0(HOR, (z1 + z2) / 2);
    const u = (i / steps) * tex.width;
    g.drawImage(tex, u, 0, tex.width / steps + 0.5, tex.height, Math.min(xa, xb), top, Math.abs(xb - xa) + 0.6, bot - top);
  }
}

/** Заготовка диорамы: задник, стенки, потолок, пол-море; отдельно — скалы (стоят перед кораблями). */
function paintBox() {
  const back = canvas(PW, VH);
  const g = back.getContext('2d')!;
  g.fillStyle = '#050607';
  g.fillRect(0, 0, PW, VH);
  // задник
  const bw = Math.round(BW * 2);
  const bh = HOR - WT;
  const bt = canvas(bw, bh);
  const b = bt.getContext('2d')!;
  sky(b, bw, bh);
  for (let x = 20; x < bw; x += 70 + rnd() * 70) cloud(b, x, 40 + rnd() * 50, 50 + rnd() * 60, 16 + rnd() * 10);
  for (let x = 60; x < bw; x += 120 + rnd() * 90) cloud(b, x, 110 + rnd() * 40, 90 + rnd() * 80, 26 + rnd() * 16);
  // дымка у горизонта
  const haze = b.createLinearGradient(0, bh * 0.55, 0, bh);
  haze.addColorStop(0, 'rgba(190,215,205,0)');
  haze.addColorStop(1, 'rgba(190,215,205,0.55)');
  b.fillStyle = haze;
  b.fillRect(0, 0, bw, bh);
  g.drawImage(bt, PC - BW, WT);
  // стенки: небо, облака, горы вдоль низа (правая — в тени)
  for (const side of [-1, 1] as const) {
    const dark = side < 0 ? 1 : 0.78;
    const tw = 600;
    const th = bh;
    const tx = canvas(tw, th);
    const t = tx.getContext('2d')!;
    sky(t, tw, th, dark);
    for (let x = 20; x < tw; x += 60 + rnd() * 70) cloud(t, x, 30 + rnd() * 60, 40 + rnd() * 40, 14 + rnd() * 8, `rgba(90,130,150,${0.6 * dark})`);
    // дальний хребет — бледнее, ближний — крупные пики
    const far: [number, number][] = [];
    for (let x = 0; x < tw; x += 50 + rnd() * 60) far.push([x, th * (0.25 + rnd() * 0.2)]);
    mountains(t, tw, th, far, dark * 0.75);
    t.fillStyle = `rgba(150,195,185,${0.45 * dark})`;
    t.fillRect(0, 0, tw, th);
    const peaks: [number, number][] = [];
    for (let x = 30; x < tw; x += 90 + rnd() * 110) peaks.push([x, th * (0.45 + rnd() * 0.4)]);
    mountains(t, tw, th, peaks, dark);
    // стенка ближе к перископу — темнее (свет лампы падает на задник)
    const fall = t.createLinearGradient(0, 0, tw, 0);
    fall.addColorStop(0, 'rgba(0,0,0,0)');
    fall.addColorStop(1, 'rgba(0,0,0,0.45)');
    t.fillStyle = fall;
    t.fillRect(0, 0, tw, th);
    wall(g, tx, side);
  }
  // потолок — тёмный, у задника светлая полоса от лампы
  g.fillStyle = '#0b0f0e';
  g.beginPath();
  g.moveTo(PC - BW, WT);
  g.lineTo(PC + BW, WT);
  g.lineTo(PC + sx0(BW, Z_NEAR), sy0(WT, Z_NEAR));
  g.lineTo(PC - sx0(BW, Z_NEAR), sy0(WT, Z_NEAR));
  g.fill();
  const lamp = g.createLinearGradient(0, WT - 50, 0, WT);
  lamp.addColorStop(0, 'rgba(160,210,190,0)');
  lamp.addColorStop(1, 'rgba(170,220,200,0.35)');
  g.fillStyle = lamp;
  g.fillRect(PC - BW * 1.4, WT - 50, BW * 2.8, 50);
  // свет лампы на заднике сверху
  for (const lx of [-0.55, 0, 0.55]) {
    const x = PC + lx * BW;
    const sp = g.createRadialGradient(x, WT, 0, x, WT, 170);
    sp.addColorStop(0, 'rgba(235,255,240,0.55)');
    sp.addColorStop(1, 'rgba(235,255,240,0)');
    g.fillStyle = sp;
    g.fillRect(x - 170, WT, 340, 170);
  }
  // пол — море: строки текстуры волн в перспективе
  const sw = 900;
  const shh = 400;
  const st = canvas(sw, shh);
  const s = st.getContext('2d')!;
  const sea = s.createLinearGradient(0, 0, 0, shh);
  sea.addColorStop(0, '#93b3aa');
  sea.addColorStop(0.3, '#6a948c');
  sea.addColorStop(1, '#3a6661');
  s.fillStyle = sea;
  s.fillRect(0, 0, sw, shh);
  s.filter = 'blur(1.5px)';
  for (let i = 0; i < 140; i++) {
    const y = rnd() * shh;
    const len = 60 + rnd() * 260;
    const x = rnd() * sw;
    s.strokeStyle = rnd() < 0.7 ? `rgba(225,240,232,${0.1 + rnd() * 0.2})` : `rgba(20,50,46,${0.12 + rnd() * 0.18})`;
    s.lineWidth = 2 + rnd() * 4;
    s.beginPath();
    s.moveTo(x, y);
    s.bezierCurveTo(x + len * 0.3, y - 2, x + len * 0.7, y + 2, x + len, y);
    s.stroke();
  }
  for (let y = HOR; y < VH; y++) {
    const Z = (HOR - E) / (y + 0.5 - E);
    if (Z < Z_NEAR * 0.6) break;
    const v = Math.min(shh - 1, ((1 - Math.min(1, Z)) / (1 - Z_NEAR * 0.6)) * shh);
    const half = sx0(BW, Z);
    g.drawImage(st, 0, v, sw, 1, PC - half, y, half * 2, 1.2);
  }
  // блики ламп на стекле моря
  for (const [dx, y, r, c] of [[0, VH - 90, 170, '255,215,210'], [-120, VH - 150, 90, '220,255,230'], [140, VH - 120, 110, '255,235,220']] as const) {
    const gl = g.createRadialGradient(PC + dx, y, 0, PC + dx, y, r);
    gl.addColorStop(0, `rgba(${c},0.32)`);
    gl.addColorStop(1, `rgba(${c},0)`);
    g.fillStyle = gl;
    g.save();
    g.translate(PC + dx, y);
    g.scale(1.8, 0.45);
    g.translate(-(PC + dx), -y);
    g.fillRect(PC + dx - r, y - r, r * 2, r * 2);
    g.restore();
  }
  // прорези лампочек трасс
  for (let k = 0; k < TRACKS; k++)
    for (let i = 1; i <= 10; i++) {
      const l = lampAt(k, i);
      g.fillStyle = 'rgba(10,30,26,0.14)';
      g.beginPath();
      g.ellipse(PC + l.x, l.y, l.r * 1.3, l.r * 0.45, 0, 0, Math.PI * 2);
      g.fill();
    }
  // скалы-мысы в углах задника — отдельный слой поверх кораблей
  const rocks = canvas(PW, VH);
  const r = rocks.getContext('2d')!;
  for (const side of [-1, 1]) {
    const cx = PC + side * (BW - 30);
    const pts: [number, number][] = [
      [-46, 6], [-40, -22], [-30, -30], [-24, -58], [-12, -44], [-4, -78], [6, -52], [14, -60], [26, -26], [40, -18], [52, 6],
    ];
    r.save();
    r.translate(cx, HOR);
    r.scale(side * 1.5, 1.5);
    r.translate(-cx, -HOR);
    r.fillStyle = '#3a271d';
    r.beginPath();
    pts.forEach(([x, y], i) => (i ? r.lineTo(cx + x, HOR + y) : r.moveTo(cx + x, HOR + y)));
    r.closePath();
    r.fill();
    r.fillStyle = 'rgba(205,125,70,0.7)'; // освещённые грани
    r.beginPath();
    r.moveTo(cx - 4, HOR - 78);
    r.lineTo(cx - 12, HOR - 44);
    r.lineTo(cx - 2, HOR - 30);
    r.closePath();
    r.fill();
    r.beginPath();
    r.moveTo(cx - 24, HOR - 58);
    r.lineTo(cx - 30, HOR - 30);
    r.lineTo(cx - 20, HOR - 24);
    r.closePath();
    r.fill();
    r.restore();
  }
  // зерно росписи
  const grain = g.getImageData(0, 0, PW, VH);
  for (let i = 0; i < grain.data.length; i += 4) {
    const v = (rnd() - 0.5) * 10;
    grain.data[i] += v;
    grain.data[i + 1] += v;
    grain.data[i + 2] += v;
  }
  g.putImageData(grain, 0, 0);
  return { back, rocks };
}

// ---- силуэты кораблей (см, носом вправо, начало — середина киля)
function shipPath(kind: number) {
  const p = new Path2D();
  if (kind === 0) {
    // крейсер: корпус, ступенчатая надстройка, мачта, башни
    p.moveTo(-3.8, -0.7);
    p.lineTo(3.9, -0.9);
    p.lineTo(3.3, 0);
    p.lineTo(-3.5, 0);
    p.closePath();
    p.rect(-2.2, -1.4, 3.6, 0.75);
    p.rect(-1.4, -2.1, 2.0, 0.75);
    p.rect(-0.7, -2.9, 0.9, 0.85);
    p.rect(-0.35, -4.0, 0.22, 1.2);
    p.rect(-1.0, -3.6, 1.5, 0.15);
    p.rect(2.0, -1.2, 0.9, 0.35);
    p.rect(-3.2, -1.1, 0.9, 0.35);
  } else {
    // эсминец: длинный низкий корпус, две трубы, мачта
    p.moveTo(-3.6, -0.6);
    p.lineTo(3.9, -1.0);
    p.lineTo(3.2, 0);
    p.lineTo(-3.3, 0);
    p.closePath();
    p.rect(-1.2, -1.3, 2.8, 0.7);
    p.rect(0.4, -2.0, 0.9, 0.75);
    p.rect(-0.8, -2.0, 0.45, 0.75);
    p.rect(-0.1, -1.9, 0.4, 0.6);
    p.rect(0.8, -3.2, 0.16, 1.25);
    p.rect(2.2, -1.05, 0.7, 0.3);
    p.rect(-2.7, -0.95, 0.7, 0.3);
  }
  return p;
}
const SHIPS = [shipPath(0), shipPath(1)];
/** Видимая длина силуэта, см (корабли на диораме мелкие). */
const SHIP_VIS = 5.2;

export function mountMorboy(root: HTMLElement, opts?: ArcadeOpts): ArcadeInstance {
  const s: SeaState = newSea();
  if (import.meta.env.DEV) (window as unknown as { morboy?: SeaState }).morboy = s; // для проверки в превью
  const turning = { l: false, r: false };
  const sh = mountShell(root, opts, {
    cls: 'avs--scope',
    aspect: LW / LH,
    info: `<p><b>«Морской бой»</b> <small>(электромеханический, 1974)</small>. Перископ, восемь трасс торпед, силуэты кораблей на цепи — по заводскому техописанию.
      10 торпед; 10 попаданий из 10 — призовая игра, ещё три пуска.</p>
      <button class="btn small" data-a="reset" title="Выключить и включить автомат">Сброс</button>`,
    pad: 'x',
    buttons: [{ id: 'fire', label: 'ПУСК', big: true }],
    onCoin: () => insertCoin(),
    onInput: (k, down) => {
      if (k === 'left') turning.l = down;
      else if (k === 'right') turning.r = down;
      else if (k === 'fire' && down) doFire();
    },
  });
  const view = canvas(LW, LH);
  sh.screen.appendChild(view);
  const ctx = view.getContext('2d')!;
  const { say, drawPocket } = sh;
  const box = paintBox();
  (sh.info.querySelector('[data-a=reset]') as HTMLButtonElement).onclick = (e) => {
    (e.currentTarget as HTMLButtonElement).blur();
    Object.assign(s, newSea());
    say('Автомат перезапущен.');
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
      // диорама идёт за пальцем: сдвиг в точках холста / точек на см
      const scale = LW / (view.getBoundingClientRect().width || 1);
      turn(s, s.aim - ((ev.clientX - lx) * scale) / K);
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
  const glow = (x: number, y: number, r: number, a: number, rgb: string) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(255,255,240,${a})`);
    g.addColorStop(0.18, `rgba(${rgb},${a * 0.9})`);
    g.addColorStop(1, `rgba(${rgb},0)`);
    ctx.fillStyle = g;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
  };
  const lampGlow = (x: number, y: number, r: number, a: number) => {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(x, y);
    ctx.scale(1, 0.55);
    glow(0, 0, r * 4.5, a, '120,255,160');
    ctx.restore();
  };

  // транспаранты на небе задника: не горят — чуть темнее росписи, горят — тёплым светом сквозь стекло
  const skyWord = (x: number, y: number, t: string, on: boolean) => {
    ctx.font = '700 24px "Arial Narrow", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (on) {
      ctx.save();
      ctx.shadowColor = '#ff8a1a';
      ctx.shadowBlur = 16;
      ctx.fillStyle = '#ffb04a';
      ctx.fillText(t, x, y);
      ctx.shadowBlur = 4;
      ctx.fillStyle = '#ffe2b0';
      ctx.fillText(t, x, y);
      ctx.restore();
    } else {
      ctx.fillStyle = 'rgba(60,95,88,0.2)';
      ctx.fillText(t, x, y);
    }
  };

  // табло по краям окуляра — красный неон
  const NEON = '#ff3b2a';
  const neonCircle = (x: number, y: number, n: number, on: boolean, r = 17) => {
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = on ? NEON : '#3a0f0b';
    ctx.fillStyle = on ? 'rgba(255,60,40,0.2)' : 'rgba(40,8,6,0.6)';
    if (on) {
      ctx.shadowColor = NEON;
      ctx.shadowBlur = 16;
    }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = on ? '#ffd2c8' : '#4a1510';
    ctx.font = `700 ${Math.round(r * 1.15)}px "Arial Narrow", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), x, y + 1);
    ctx.restore();
  };
  const neonPlate = (x: number, y: number, w: number, h: number, t: string, on: boolean) => {
    ctx.save();
    ctx.lineWidth = 3;
    ctx.strokeStyle = on ? NEON : '#3a0f0b';
    ctx.fillStyle = on ? 'rgba(255,60,40,0.25)' : 'rgba(40,8,6,0.6)';
    if (on) {
      ctx.shadowColor = NEON;
      ctx.shadowBlur = 18;
    }
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, 8);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = on ? '#ffd2c8' : '#4a1510';
    ctx.font = `700 ${Math.round(h * 0.62)}px "Arial Narrow", Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(t, x + w / 2, y + h / 2 + 1);
    ctx.restore();
  };
  /** «ТОРПЕДИРОВАНО» — по дуге нижнего края окуляра. */
  const neonArc = (t: string, on: boolean) => {
    const cx = LW / 2 + 50;
    const cy = TOP + VH - 260;
    const R = 360;
    ctx.save();
    ctx.font = '700 30px "Arial Narrow", Arial, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const span = 0.8;
    ctx.lineWidth = 46;
    ctx.lineCap = 'round';
    ctx.strokeStyle = on ? 'rgba(255,60,40,0.22)' : 'rgba(40,8,6,0.6)';
    ctx.beginPath();
    ctx.arc(cx, cy, R, Math.PI / 2 + span / 2, Math.PI / 2 - span / 2, true);
    ctx.stroke();
    if (on) {
      ctx.shadowColor = NEON;
      ctx.shadowBlur = 16;
    }
    for (let i = 0; i < t.length; i++) {
      const a = Math.PI / 2 + span / 2 - (span * (i + 0.5)) / t.length;
      ctx.save();
      ctx.translate(cx + R * Math.cos(a), cy + R * Math.sin(a));
      ctx.rotate(a - Math.PI / 2);
      ctx.fillStyle = on ? '#ffd2c8' : '#4a1510';
      ctx.fillText(t[i], 0, 0);
      ctx.restore();
    }
    ctx.restore();
  };

  const drawBoard = () => {
    const blink = roseOn(s);
    neonPlate(14, 12, 104, 54, 'ПУСК', s.ready && (blink || !s.alarm));
    for (let i = 0; i < LAUNCHES; i++) {
      const n = i + 1;
      neonCircle(150 + i * 44, 39, n, s.playing && (n === s.litLaunch || (s.prize && n === LAUNCHES)));
    }
    const hitN = s.litHit || (s.hits >= LAUNCHES ? LAUNCHES : 0);
    neonCircle(LW / 2 - 165, TOP + VH + 38, hitN || 0, hitN > 0, 24);
    neonArc('ТОРПЕДИРОВАНО', s.torpedoed);
  };

  const draw = () => {
    const shift = -s.aim * K; // поворот перископа сдвигает диораму
    const px = (x: number) => OX + shift + x; // x — точки от середины задника
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, LW, LH);
    ctx.save();
    ctx.translate(0, TOP);
    ctx.save();
    scopePath(ctx);
    ctx.clip();
    ctx.drawImage(box.back, PC - OX - shift, 0, VW, VH, 0, 0, VW, VH);
    // транспаранты на небе
    const ty = WT + 58;
    skyWord(px(-104), ty, 'ПРИЗОВАЯ', s.prize);
    skyWord(px(0), ty, 'ИГРА', true);
    skyWord(px(100), ty, 'ОКОНЧЕНА', !s.playing);
    // корабли вдоль задника (на цепи), уходят за скалы
    ctx.save();
    ctx.beginPath();
    ctx.rect(px(-BW), 0, BW * 2, HOR + 2);
    ctx.clip();
    for (const shp of ships(s)) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, (HALF_W + 5 - Math.abs(shp.x)) / 5));
      ctx.translate(px(shp.x * K), HOR + 1 + Math.sin(s.time * 3 + shp.kind) * 0.4);
      const k = (K * SHIP_VIS) / 7.7;
      ctx.scale(shp.dir * k, k);
      ctx.fillStyle = '#14181a';
      ctx.fill(SHIPS[shp.kind]);
      ctx.restore();
    }
    ctx.restore();
    ctx.drawImage(box.rocks, PC - OX - shift, 0, VW, VH, 0, 0, VW, VH);
    // взрыв: свет в ящике гаснет, у цели — красная вспышка
    if (s.blast > 0) {
      const f = s.blast / BLAST_TIME;
      ctx.fillStyle = 'rgba(0,0,0,0.94)';
      ctx.fillRect(0, 0, VW, VH);
      const bx = px(trackX(s.blastTrack) * K);
      const flick = 0.7 + 0.3 * Math.sin(s.time * 37);
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      glow(bx, HOR - 12, 120, 0.7 * flick * Math.min(1, f * 1.6), '230,40,20');
      ctx.restore();
      skyWord(px(0), ty, 'ИГРА', true);
      if (s.prize) skyWord(px(-104), ty, 'ПРИЗОВАЯ', true);
    } else if (!s.playing) {
      ctx.fillStyle = 'rgba(0,6,4,0.12)';
      ctx.fillRect(0, 0, VW, VH);
    }
    // лампочки трассы под стеклом моря
    const lamp = torpedoLamp(s);
    if (s.torpedo && lamp) {
      if (lamp > 1) {
        const p = lampAt(s.torpedo.track, lamp - 1);
        const cool = Math.max(0, 1 - ((s.torpedo.t % TICK) / TICK) * 2.2);
        if (cool > 0) lampGlow(px(p.x), p.y, p.r, 0.55 * cool);
      }
      const l = lampAt(s.torpedo.track, lamp);
      lampGlow(px(l.x), l.y, l.r, Math.min(1, ((s.torpedo.t % TICK) / TICK) * 4 + 0.35));
    }
    // стекло окуляра: зеленоватый тон и затенение к краю
    ctx.fillStyle = 'rgba(30,80,60,0.1)';
    ctx.fillRect(0, 0, VW, VH);
    const vg = ctx.createRadialGradient(OX, OY, RY * 0.75, OX, OY, RX * 1.08);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,4,2,0.5)');
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, VW, VH);
    // визиры: две линии во всю высоту и шкала прицела под горизонтом
    ctx.fillStyle = 'rgba(8,10,10,0.85)';
    ctx.fillRect(OX - VISOR - 1.5, 0, 3, VH);
    ctx.fillRect(OX + VISOR - 1.5, 0, 3, VH);
    const ry = HOR + 46;
    ctx.fillRect(OX - 165, ry - 1, 330, 2.5);
    for (let i = -11; i <= 11; i++) ctx.fillRect(OX + i * 15 - 1, ry - 7, 2, 14);
    ctx.fillRect(OX - 1.5, ry - 16, 3, 32);
    ctx.restore();
    // кромка окуляра — мягкая тень
    ctx.save();
    scopePath(ctx, 8);
    ctx.lineWidth = 18;
    ctx.strokeStyle = 'rgba(0,0,0,0.9)';
    ctx.filter = 'blur(7px)';
    ctx.stroke();
    ctx.restore();
    ctx.restore();
    drawBoard();
    // указатель поворота перископа
    const nx = LW / 2 + 170 + (s.aim / AIM_MAX) * 130;
    ctx.fillStyle = '#3a0f0b';
    ctx.fillRect(LW / 2 + 40, LH - 18, 260, 3);
    ctx.fillStyle = NEON;
    ctx.fillRect(nx - 2, LH - 26, 4, 14);
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
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', blur);
      sh.destroy();
    },
  };
}
