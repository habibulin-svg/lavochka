/* «Магистраль М»: экран телевизионной игры на рассыпной логике во всю область — как на снимке настоящего автомата:
 * голубое поле, парапет из чёрно-белых полос, пунктир осевой, машины-«болиды» из крупных точек, посередине чёрная
 * полоса с финишной лентой и столбиками индикаторов. Выбор трассы и «Старт» — в карточке справа (клавиши 1…5, Enter),
 * на телефоне — руль, газ и тормоз поверх экрана. Логика — logic.ts. */
import { audioOut } from '../../../core/audio';
import type { ArcadeInstance, ArcadeOpts } from '../../../core/arcade';
import { giveBack, takeCoin } from '../coins';
import { mountShell } from '../screen';
import './magistral.css';
import {
  CAR_H, CAR_W, chooseTrack, coin, CRASH_TIME, greenIndicator, indicator, newMag, POST_GAP, start, step, TH, TRACKS, TW,
  type MagEvent, type MagState, type Mover, type Player, type TrackKind,
} from './logic';

// ---- экран 320×240: две трассы по 136 точек, между ними чёрная полоса индикаторов, по краям — зелёная кайма
const SW = 320;
const SH = 240;
const SY = SH / TH; // 0.3
const TRACK_PX = 136;
const SX = TRACK_PX / TW; // 0.34
const EDGE = 8;
const GAP = SW - EDGE * 2 - TRACK_PX * 2; // 32
const X0 = [EDGE, EDGE + TRACK_PX + GAP];

/** Палитра — как на снимке экрана. */
const C = {
  field: '#a9c3db',
  night: '#141c2c',
  edge: '#5fe05a',
  post: '#ffffff',
  postDark: '#101010',
  lane: '#ffffff',
  car: '#8cf07c', // машины автомата — салатовые
  wide: '#cc2a22', // широкая попутная — красная
  p1: '#ff5a1e', // левый игрок — оранжевый
  p2: '#3448ff', // правый — синий
  green: '#2fd84a',
  tape: '#ff4a1a',
  strip: '#050505',
  text: '#ffffff',
};

/** «Болид» сверху, носом вверх: переднее антикрыло с колёсами, кокпит, задняя ось с широкими колёсами, спойлер. */
const CAR = [
  '.XXX.....XXX.',
  '.XXXXXXXXXXX.',
  '.XXX.XXX.XXX.',
  '.....XXX.....',
  '....XXXXX....',
  '....X...X....',
  '....X...X....',
  '....XXXXX....',
  'XXX.XXXXX.XXX',
  'XXXXXXXXXXXXX',
  'XXX.XXXXX.XXX',
  'XXX.XXXXX.XXX',
  '....XXXXX....',
  '..XXXXXXXXX..',
];

function drawCar(g: CanvasRenderingContext2D, cx: number, cy: number, w: number, color: string, flip = false) {
  const W = w * SX;
  const H = CAR_H * SY;
  const cw = W / CAR[0].length;
  const ch = H / CAR.length;
  const x0 = Math.round(cx - W / 2);
  const y0 = Math.round(cy - H / 2);
  g.fillStyle = color;
  for (let r = 0; r < CAR.length; r++) {
    const row = CAR[flip ? CAR.length - 1 - r : r];
    for (let c = 0; c < row.length; c++)
      if (row[c] === 'X') g.fillRect(Math.floor(x0 + c * cw), Math.floor(y0 + r * ch), Math.ceil(cw), Math.ceil(ch));
  }
}

export function mountMagistral(root: HTMLElement, opts?: ArcadeOpts): ArcadeInstance {
  const s: MagState = newMag((Date.now() % 100000) + 1);
  if (import.meta.env.DEV) (window as unknown as { magistral?: MagState }).magistral = s;
  const touch = [
    { wheel: 0, pedal: false, brake: false },
    { wheel: 0, pedal: false, brake: false },
  ];
  const sh = mountShell(root, opts, {
    cls: 'avs--crt avs--mag',
    aspect: 4 / 3,
    info: `<p><b>«Магистраль»</b> <small>(телевизионный, 1980-е)</small>. Гонки на двоих: пять трасс, руль и педаль — по заводскому руководству.
      15 коп. — один игрок, 30 коп. — двое. Обгоните зелёный индикатор до финишной ленты — пересеките надпись ПРИЗ.</p>
      <div class="mg-sel"><b>Выбор трассы</b>
        <div class="mg-pads">${TRACKS.map((t, i) => `<button class="mg-pad" data-t="${t.id}" title="${t.title}: клавиша ${i + 1}"><i></i><span>${t.title}</span></button>`).join('')}</div>
        <button class="btn primary mg-start" title="Старт: Enter">Старт</button>
      </div>`,
    pad: 'x',
    buttons: [
      { id: 'gas', label: 'ГАЗ', big: true },
      { id: 'brake', label: 'ТОРМОЗ' },
      { id: 'start', label: 'СТАРТ' },
    ],
    onCoin: () => insertCoin(),
    onInput: (k, down) => {
      const t = touch[0];
      if (k === 'left') t.wheel = down ? -1 : t.wheel < 0 ? 0 : t.wheel;
      else if (k === 'right') t.wheel = down ? 1 : t.wheel > 0 ? 0 : t.wheel;
      else if (k === 'gas') t.pedal = down;
      else if (k === 'brake') t.brake = down;
      else if (k === 'start' && down) doStart();
    },
  });
  const cv = document.createElement('canvas');
  cv.width = SW;
  cv.height = SH;
  sh.screen.appendChild(cv);
  const g = cv.getContext('2d')!;
  const info = sh.info;
  const { drawPocket } = sh;

  // ---- звук: моторы, взрыв, сирена спецмашины, музыкальная заставка
  const audio = audioOut();
  const engines = [0, 1].map(() => {
    if (!audio) return null;
    const o = audio.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = 40;
    const f = audio.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 600;
    const gn = audio.ctx.createGain();
    gn.gain.value = 0;
    o.connect(f).connect(gn).connect(audio.out);
    o.start();
    return { o, gn };
  });
  const boom = () => {
    const a = audioOut();
    if (!a) return;
    const src = a.ctx.createBufferSource();
    src.buffer = a.noise;
    src.loop = true;
    const f = a.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 500;
    const gn = a.ctx.createGain();
    const t = a.ctx.currentTime;
    gn.gain.setValueAtTime(0.8, t);
    gn.gain.exponentialRampToValueAtTime(0.001, t + 1.2);
    src.connect(f).connect(gn).connect(a.out);
    src.start(t);
    src.stop(t + 1.25);
  };
  const tones = (seq: [number, number][], type: OscillatorType = 'square', vol = 0.08) => {
    const a = audioOut();
    if (!a) return;
    let t = a.ctx.currentTime + 0.02;
    for (const [f, d] of seq) {
      if (f > 0) {
        const o = a.ctx.createOscillator();
        o.type = type;
        o.frequency.value = f;
        const gn = a.ctx.createGain();
        gn.gain.setValueAtTime(vol, t);
        gn.gain.setValueAtTime(vol, t + d * 0.85);
        gn.gain.linearRampToValueAtTime(0.0001, t + d);
        o.connect(gn).connect(a.out);
        o.start(t);
        o.stop(t + d + 0.02);
      }
      t += d;
    }
  };
  const siren = () => tones(Array.from({ length: 8 }, (_, i) => [i % 2 ? 640 : 880, 0.35] as [number, number]), 'triangle', 0.07);
  const jingle = () => tones([[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.24], [0, 0.06], [784, 0.12], [1047, 0.36]]);

  let msgUntil = 0;
  let msgText = '';
  const say = (t: string, sec = 2.4) => {
    msgText = t;
    msgUntil = s.clock + sec;
  };

  const handle = (ev: MagEvent[]) => {
    for (const e of ev) {
      if (e === 'crash') boom();
      else if (e === 'siren') siren();
      else if (e === 'start') jingle();
      else if (e === 'prize') tones([[784, 0.1], [988, 0.1], [1175, 0.1], [1568, 0.3]]);
    }
  };

  // ---- монета, выбор трассы, старт
  const insertCoin = () => {
    if (paused) return;
    if (!takeCoin()) {
      say('МОНЕТЫ КОНЧИЛИСЬ');
      drawPocket();
      return;
    }
    sh.drop();
    const ev: MagEvent[] = [];
    if (!coin(s, ev)) {
      giveBack();
      say(s.mode === 'play' ? 'ИДЁТ ИГРА — МОНЕТА В ВОЗВРАТ' : 'УЖЕ ОПЛАЧЕНО ДВОЕ');
    } else say(s.credits === 1 ? 'ОДИН ИГРОК. ЕЩЁ МОНЕТА — ДВОЕ' : 'ИГРАЮТ ДВОЕ');
    handle(ev);
    drawPocket();
  };
  const pick = (t: TrackKind) => {
    if (paused) return;
    chooseTrack(s, t);
  };
  info.querySelectorAll<HTMLButtonElement>('.mg-pad[data-t]').forEach(
    (b) =>
      (b.onclick = () => {
        b.blur();
        pick(b.dataset.t as TrackKind);
      }),
  );
  const doStart = () => {
    if (paused) return;
    const ev: MagEvent[] = [];
    if (!start(s, ev)) say(s.credits ? '' : 'СНАЧАЛА ОПУСТИТЕ МОНЕТУ');
    handle(ev);
  };
  const startBtn = info.querySelector('.mg-start') as HTMLButtonElement;
  startBtn.onclick = () => {
    startBtn.blur();
    doStart();
  };

  // ---- руль и педаль: клавиши (A/D/W/S — левый, стрелки — правый; один игрок — любые), палец
  const keys = new Set<string>();
  const onKey = (e: KeyboardEvent, down: boolean) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
    if (e.metaKey || e.altKey || e.ctrlKey) return;
    const k = e.code;
    if (k === 'Space') {
      e.preventDefault();
      if (down && !e.repeat) insertCoin();
      return;
    }
    if (down && !e.repeat && /^Digit[1-5]$/.test(k)) {
      pick(TRACKS[Number(k.slice(5)) - 1].id);
      return;
    }
    if (down && !e.repeat && (k === 'Enter' || k === 'NumpadEnter')) {
      doStart();
      return;
    }
    if (['KeyA', 'KeyD', 'KeyW', 'KeyS', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(k)) {
      e.preventDefault();
      if (down) keys.add(k);
      else keys.delete(k);
    }
  };
  const kd = (e: KeyboardEvent) => onKey(e, true);
  const ku = (e: KeyboardEvent) => onKey(e, false);
  const clear = () => keys.clear();
  window.addEventListener('keydown', kd);
  window.addEventListener('keyup', ku);
  window.addEventListener('blur', clear);

  const readInput = (dt: number) => {
    const two = s.players[1].on;
    const has = (k: string) => keys.has(k);
    const sets = two
      ? [['KeyA', 'KeyD', 'KeyW', 'KeyS'], ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']]
      : [['KeyA', 'KeyD', 'KeyW', 'KeyS', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'], []];
    s.players.forEach((p, i) => {
      const ks = sets[i];
      const L = ks.length ? has(ks[0]) || has(ks[4] ?? '') : false;
      const R = ks.length ? has(ks[1]) || has(ks[5] ?? '') : false;
      const gas = (ks.length ? has(ks[2]) || has(ks[6] ?? '') : false) || touch[i].pedal;
      const brake = (ks.length ? has(ks[3]) || has(ks[7] ?? '') : false) || touch[i].brake;
      p.wheel = touch[i].wheel || (R ? 1 : 0) - (L ? 1 : 0);
      // педаль на пружине: жмём — опускается, отпустили — возвращается
      p.pedal = brake ? Math.max(0, p.pedal - 3 * dt) : gas ? Math.min(1, p.pedal + 1.6 * dt) : Math.max(0, p.pedal - 1.2 * dt);
    });
  };

  // ---- отрисовка экрана
  const oncoming = (c: Mover) => c.kind === 'car' && (s.track === 'learn' || s.track === 'night' || (s.track === 'race' && c.x < TW / 2));
  const drawTrack = (p: Player, x0: number, idx: number) => {
    g.save();
    g.translate(x0, 0);
    g.beginPath();
    g.rect(0, 0, TRACK_PX, SH);
    g.clip();
    const night = s.track === 'night' && s.mode === 'play';
    g.fillStyle = night ? C.night : C.field;
    g.fillRect(0, 0, TRACK_PX, SH);
    const py = p.y * SY;
    const px = p.x * SX;
    if (night && p.on) {
      // темнота; луч фар — единственное освещённое место (рис. 5 руководства)
      g.fillStyle = C.field;
      g.beginPath();
      g.moveTo(px - 4, py - 10);
      g.lineTo(px - 30, 0);
      g.lineTo(px + 30, 0);
      g.lineTo(px + 4, py - 10);
      g.fill();
    }
    // осевая «Гоночной» — белый пунктир
    if (s.track === 'race') {
      g.fillStyle = C.lane;
      const step = POST_GAP / 2;
      for (let y = -step; y < TH + step; y += step) g.fillRect(Math.round(TRACK_PX / 2) - 1, Math.round((y + ((p.scroll * 2) % step)) * SY), 2, 10);
    }
    // парапет — бегущие чёрно-белые полосы по краям
    for (let y = -POST_GAP; y < TH + POST_GAP; y += POST_GAP / 2) {
      const yy = Math.round((y + (p.scroll % (POST_GAP / 2))) * SY);
      const odd = Math.round(y / (POST_GAP / 2)) % 2 === 0;
      g.fillStyle = odd ? C.post : C.postDark;
      g.fillRect(0, yy, 4, Math.ceil((POST_GAP / 2) * SY));
      g.fillRect(TRACK_PX - 4, yy, 4, Math.ceil((POST_GAP / 2) * SY));
    }
    // машины автомата
    const inBeam = (c: Mover) => {
      if (!night) return true;
      const cy = c.y * SY;
      if (cy > py) return false;
      const half = 4 + ((py - cy) / py) * 26;
      return Math.abs(c.x * SX - px) < half + 6;
    };
    for (const c of p.cars) {
      if (!inBeam(c)) continue;
      if (c.kind === 'spec') drawCar(g, c.x * SX, c.y * SY, c.w, Math.floor(s.clock * 6) % 2 === 0 ? '#ffffff' : '#ff2a2a');
      else drawCar(g, c.x * SX, c.y * SY, c.w, c.kind === 'wide' ? C.wide : C.car, oncoming(c));
    }
    // ПРИЗ — надпись поперёк трассы
    if (p.prizeSign !== null) {
      g.fillStyle = Math.floor(s.clock * 5) % 2 ? '#ffff00' : '#ffffff';
      g.font = 'bold 22px monospace';
      g.textAlign = 'center';
      g.fillText('ПРИЗ', TRACK_PX / 2, p.prizeSign * SY + 8);
    }
    // машина игрока или взрыв
    if (p.on) {
      if (p.boom) {
        const t = p.boom.t;
        const r = 4 + t * 26;
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2 + t * 3;
          g.fillStyle = k % 2 ? '#ffff00' : '#ffffff';
          const rr = r * (0.6 + (0.4 * ((k * 37) % 7)) / 7);
          g.fillRect(Math.round(p.boom.x * SX + Math.cos(a) * rr) - 2, Math.round(p.boom.y * SY + Math.sin(a) * rr) - 2, 4, 4);
        }
        if (t < CRASH_TIME * 0.4) {
          g.fillStyle = '#ffffff';
          g.fillRect(Math.round(p.boom.x * SX) - 6, Math.round(p.boom.y * SY) - 6, 12, 12);
        }
      } else drawCar(g, px, py, CAR_W, idx ? C.p2 : C.p1);
    }
    g.restore();
  };

  const drawCenter = () => {
    const x0 = X0[0] + TRACK_PX;
    const cx = x0 + GAP / 2;
    g.fillStyle = C.strip;
    g.fillRect(x0, 0, GAP, SH);
    // финишная лента наверху
    g.fillStyle = C.tape;
    g.fillRect(cx - 11, 8, 22, 6);
    const base = SH - 4;
    const top = 18;
    const bar = (x: number, w: number, v: number, col: string) => {
      const h = Math.max(1, Math.round((base - top) * v));
      g.fillStyle = col;
      g.fillRect(x, base - h, w, h);
    };
    const [p1, p2] = s.players;
    if (p1.on || s.mode === 'over') bar(cx - 11, 6, indicator(p1), C.p1);
    bar(cx - 3, 6, greenIndicator(s), C.green);
    if (p2.on || s.mode === 'over') bar(cx + 5, 6, indicator(p2), C.p2);
  };

  const drawFrame = () => {
    // зелёная кайма по краям экрана
    g.fillStyle = C.strip;
    g.fillRect(0, 0, EDGE, SH);
    g.fillRect(SW - EDGE, 0, EDGE, SH);
    g.fillStyle = C.edge;
    g.fillRect(2, 0, 3, SH);
    g.fillRect(SW - 5, 0, 3, SH);
  };

  const text = (t: string, y: number, col = C.text, size = 16) => {
    g.font = `bold ${size}px monospace`;
    g.textAlign = 'center';
    g.fillStyle = '#000';
    g.fillText(t, SW / 2 + 1, y + 1);
    g.fillStyle = col;
    g.fillText(t, SW / 2, y);
  };

  // заставка: машины стоят на старте, бежит парапет
  const idle: Player[] = [s.players[0], s.players[1]];
  const drawAttract = () => {
    const sc = s.clock * 160;
    idle.forEach((p, i) => {
      const fake = { ...p, on: false, scroll: sc % POST_GAP, cars: [], prizeSign: null } as Player;
      drawTrack(fake, X0[i], i);
      g.save();
      g.translate(X0[i], 0);
      drawCar(g, TRACK_PX / 2, SH - 40, CAR_W, i ? C.p2 : C.p1);
      drawCar(g, TRACK_PX * 0.3, ((sc * 0.6 + i * 90) % (SH + 60)) - 30, CAR_W, C.car);
      g.restore();
    });
    drawCenter();
    drawFrame();
  };

  const draw = () => {
    g.imageSmoothingEnabled = false;
    if (s.mode === 'attract' || s.mode === 'ready') {
      drawAttract();
      text('МАГИСТРАЛЬ', 40, '#ffff00', 22);
      if (s.mode === 'ready') {
        text(`ОПЛАЧЕНО: ${s.credits === 2 ? 'ДВОЕ' : 'ОДИН'}`, 70, '#ffffff', 14);
        text(`ТРАССА «${TRACKS.find((t) => t.id === s.track)!.title.toUpperCase()}»`, SH - 60, '#ffffff', 13);
        if (Math.floor(s.clock * 2) % 2) text('НАЖМИТЕ «СТАРТ»', SH - 42, '#ffff00', 12);
      } else if (Math.floor(s.clock * 1.5) % 2) text('ОПУСТИТЕ МОНЕТУ', SH - 42, '#ffffff', 13);
    } else {
      drawTrack(s.players[0], X0[0], 0);
      drawTrack(s.players[1], X0[1], 1);
      drawCenter();
      drawFrame();
      if (s.prizeRound && s.mode === 'play') text('ПРИЗОВАЯ ИГРА', 30, '#ffff00', 12);
      if (s.mode === 'over') text('КОНЕЦ ИГРЫ', SH / 2, '#ffff00', 22);
    }
    if (s.clock < msgUntil && msgText) text(msgText, SH / 2 + 40, '#ffffff', 11);
    info.querySelectorAll<HTMLButtonElement>('.mg-pad[data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === s.track));
    startBtn.classList.toggle('blink', s.mode === 'ready' && Math.floor(s.clock * 2) % 2 === 0);
  };

  let dead = false;
  let paused = false;
  let raf = 0;
  let last = performance.now();
  const frame = (t: number) => {
    if (dead) return;
    const dt = paused ? 0 : Math.min(0.05, (t - last) / 1000);
    last = t;
    if (dt > 0) {
      readInput(dt);
      const ev: MagEvent[] = [];
      step(s, dt, ev);
      handle(ev);
      s.players.forEach((p, i) => {
        const e = engines[i];
        if (!e || !audio) return;
        const on = s.mode === 'play' && p.on && !p.finished;
        e.o.frequency.setTargetAtTime(38 + p.speed * 0.32, audio.ctx.currentTime, 0.05);
        e.gn.gain.setTargetAtTime(on ? 0.05 + (p.speed / 470) * 0.05 : 0, audio.ctx.currentTime, 0.08);
      });
    } else if (audio) engines.forEach((e) => e?.gn.gain.setTargetAtTime(0, audio.ctx.currentTime, 0.05));
    draw();
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);

  return {
    pause(on) {
      paused = on;
      if (on) clear();
    },
    launch() {
      insertCoin();
    },
    destroy() {
      dead = true;
      cancelAnimationFrame(raf);
      engines.forEach((e) => {
        try {
          e?.o.stop();
        } catch {
          /* уже остановлен */
        }
        e?.gn.disconnect();
      });
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', clear);
      sh.destroy();
    },
  };
}
