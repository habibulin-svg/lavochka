/* «Магистраль М»: монитор в чёрной рамке, экран — растровая картинка телевизионной игры на рассыпной логике
 * (машины-«гантели», как в заставке на фото; парапет из прямоугольников; индикаторы и финишная лента), под ним
 * пульт: два руля, педали, чёрный блок с жёлтой наклейкой «Выбор трассы» и монетоприёмник. Логика — logic.ts. */
import { audioOut } from '../../../core/audio';
import type { ArcadeInstance, ArcadeOpts } from '../../../core/arcade';
import { coinMode, DAILY, giveBack, pocket, setCoinMode, takeCoin, type CoinMode } from '../coins';
import {
  CAR_H, CAR_W, chooseTrack, coin, CRASH_TIME, greenIndicator, indicator, newMag, POST_GAP, start, step, TH, TRACKS, TW,
  type MagEvent, type MagState, type Mover, type Player, type TrackKind,
} from './logic';
import './magistral.css';

// ---- экран: 320×240 точек, трасса 400×800 условных → 120×240; между трассами — индикаторы
const SW = 320;
const SH = 240;
const S = SH / TH; // 0.3
const TRACK_PX = TW * S; // 120
const GAP = SW - TRACK_PX * 2 - 20; // 60 — середина под индикаторы
const X0 = [10, 10 + TRACK_PX + GAP];

/** Палитра: 3 разряда на цвет, как у видеосигнала автомата. */
const C = {
  field: '#ee8fa6', // розовое поле, как на фото экрана
  road: '#c96a86',
  post: '#ffffff',
  car: '#a8b4ff', // сиреневые машины, как в заставке
  carEdge: '#4848b4',
  p1: '#2a48ff',
  p2: '#ff2424',
  green: '#12c832',
  tape: '#000000',
  spec: '#000000',
  text: '#ffffff',
  night: '#120012',
};

/** Машина-«гантель»: две оси с колёсами и корпус (сверху вниз, носом вверх). */
function drawCar(g: CanvasRenderingContext2D, cx: number, cy: number, w: number, color: string, edge: string) {
  const W = Math.round(w * S);
  const H = Math.round(CAR_H * S);
  const x = Math.round(cx - W / 2);
  const y = Math.round(cy - H / 2);
  const body = Math.max(3, Math.round(W * 0.34));
  const bx = Math.round(cx - body / 2);
  g.fillStyle = edge;
  g.fillRect(bx - 1, y - 1, body + 2, H + 2);
  g.fillStyle = color;
  g.fillRect(bx, y, body, H);
  for (const ay of [y + 2, y + H - 7]) {
    g.fillStyle = edge;
    g.fillRect(x - 1, ay - 1, W + 2, 7);
    g.fillStyle = color;
    g.fillRect(x, ay + 1, W, 3);
    g.fillRect(x, ay, 3, 5);
    g.fillRect(x + W - 3, ay, 3, 5);
  }
  g.fillStyle = edge;
  g.fillRect(bx + 1, Math.round(cy - 2), body - 2, 4); // кабина
}

export function mountMagistral(root: HTMLElement, opts?: ArcadeOpts): ArcadeInstance {
  const s: MagState = newMag((Date.now() % 100000) + 1);
  if (import.meta.env.DEV) (window as unknown as { magistral?: MagState }).magistral = s;
  const base = `${import.meta.env.BASE_URL}avtomaty/cab/`;
  const wheel = (side: 'l' | 'r') => `<div class="mg-wheel mg-wheel-${side}" title="${side === 'l' ? 'Руль левого игрока: A/D' : 'Руль правого игрока: ← →'}">
      <svg viewBox="-50 -50 100 100"><circle r="44" fill="none" stroke="#141414" stroke-width="9"/><circle r="44" fill="none" stroke="#3a3a3a" stroke-width="2" stroke-dasharray="3 5"/>
      <circle r="11" fill="#1d1d1d" stroke="#555" stroke-width="2"/><path d="M-9 4 L-40 14 L-38 22 L-6 10Z M9 4 L40 14 L38 22 L6 10Z M-4 10 L-6 42 L6 42 L4 10Z" fill="#141414"/>
      <circle r="5" fill="#8a8a8a"/></svg>
      <div class="mg-pedal" title="${side === 'l' ? 'Педаль: W' : 'Педаль: ↑'}"><i></i></div></div>`;
  const wrap = document.createElement('div');
  wrap.className = 'mg';
  wrap.innerHTML = `<div class="mg-cab">
      <div class="mg-mon"><div class="mg-crt"><canvas width="${SW}" height="${SH}"></canvas><div class="mg-glass"></div></div></div>
      <div class="mg-desk">
        ${wheel('l')}
        <div class="mg-box">
          <div class="mg-sticker">
            <div class="mg-sel"><b>Выбор трассы</b>
              <div class="mg-pads">${TRACKS.map((t, i) => `<button class="mg-pad" data-t="${t.id}" title="${t.title}: клавиша ${i + 1}"><i></i><span>${t.title}</span></button>`).join('')}</div>
            </div>
            <div class="mg-startrow"><span class="mg-ico mg-ico-1">1</span><button class="mg-pad mg-start" title="Старт: Enter"><i></i><span>старт</span></button><span class="mg-ico mg-ico-2">2</span></div>
            <p>Опустите монету: 15 коп. — один игрок, 30 коп. — двое. Выберите трассу и коснитесь «СТАРТ». Руль — машина вправо-влево, педаль — скорость.
              Обгоните зелёный индикатор до финишной ленты — получите приз: пересеките надпись ПРИЗ.</p>
          </div>
          <button class="mg-coin" title="Бросить монету 15 коп.: пробел"><img alt="" src="${base}coinmech.webp"><i></i></button>
        </div>
        ${wheel('r')}
      </div>
    </div>`;
  root.appendChild(wrap);
  const q = <T extends Element>(sel: string) => wrap.querySelector(sel) as T;
  const cv = q<HTMLCanvasElement>('canvas');
  const g = cv.getContext('2d')!;
  const coinBtn = q<HTMLButtonElement>('.mg-coin');
  const wheels = [q<HTMLElement>('.mg-wheel-l svg'), q<HTMLElement>('.mg-wheel-r svg')];
  const pedals = [q<HTMLElement>('.mg-wheel-l .mg-pedal'), q<HTMLElement>('.mg-wheel-r .mg-pedal')];

  // ---- карточка справа: монеты
  const info = document.createElement('div');
  info.className = 'avt-info';
  info.innerHTML = `<p><b>«Магистраль»</b> <small>(телевизионный, 1980-е)</small>. Гонки на двоих: пять трасс, руль и педаль — по заводскому руководству.</p>
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
      say('Монеты кончились');
      drawPocket();
      return;
    }
    coinBtn.classList.remove('drop');
    void coinBtn.offsetWidth;
    coinBtn.classList.add('drop');
    const ev: MagEvent[] = [];
    if (!coin(s, ev)) {
      giveBack();
      say(s.mode === 'play' ? 'Идёт игра — монета в возврат' : 'Уже оплачено двое');
    } else say(s.credits === 1 ? 'Один игрок. Ещё монета — двое' : 'Играют двое');
    handle(ev);
    drawPocket();
  };
  coinBtn.onclick = insertCoin;
  const pick = (t: TrackKind) => {
    if (paused) return;
    chooseTrack(s, t);
  };
  wrap.querySelectorAll<HTMLButtonElement>('.mg-pad[data-t]').forEach((b) => (b.onclick = () => pick(b.dataset.t as TrackKind)));
  const doStart = () => {
    if (paused) return;
    const ev: MagEvent[] = [];
    if (!start(s, ev)) say(s.credits ? '' : 'Сначала опустите монету');
    handle(ev);
  };
  q<HTMLButtonElement>('.mg-start').onclick = doStart;

  // ---- руль и педаль: клавиши (A/D/W — левый, ←/→/↑ — правый; один игрок — любые), мышь и палец
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
  const touch = [{ wheel: 0, pedal: false }, { wheel: 0, pedal: false }];
  wrap.querySelectorAll<HTMLElement>('.mg-wheel').forEach((el, i) => {
    const svg = el.querySelector('svg') as SVGElement;
    svg.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      svg.setPointerCapture(e.pointerId);
      const r = svg.getBoundingClientRect();
      const move = (ev: PointerEvent) => (touch[i].wheel = Math.max(-1, Math.min(1, ((ev.clientX - (r.left + r.width / 2)) / (r.width / 2)) * 1.6)));
      const up = () => {
        touch[i].wheel = 0;
        svg.removeEventListener('pointermove', move);
        svg.removeEventListener('pointerup', up);
        svg.removeEventListener('pointercancel', up);
      };
      move(e);
      svg.addEventListener('pointermove', move);
      svg.addEventListener('pointerup', up);
      svg.addEventListener('pointercancel', up);
    });
    const ped = el.querySelector('.mg-pedal') as HTMLElement;
    ped.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      ped.setPointerCapture(e.pointerId);
      touch[i].pedal = true;
      const up = () => {
        touch[i].pedal = false;
        ped.removeEventListener('pointerup', up);
        ped.removeEventListener('pointercancel', up);
      };
      ped.addEventListener('pointerup', up);
      ped.addEventListener('pointercancel', up);
    });
  });

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
      const gas = (ks.length ? has(ks[2]) || has(ks[6] ?? '') : false) || touch[i].pedal || (!two && i === 0 && touch[1].pedal);
      const brake = ks.length ? has(ks[3]) || has(ks[7] ?? '') : false;
      const tw = touch[i].wheel || (!two && i === 0 ? touch[1].wheel : 0);
      p.wheel = tw || (R ? 1 : 0) - (L ? 1 : 0);
      // педаль на пружине: жмём — опускается, отпустили — возвращается
      p.pedal = brake ? Math.max(0, p.pedal - 3 * dt) : gas ? Math.min(1, p.pedal + 1.6 * dt) : Math.max(0, p.pedal - 1.2 * dt);
    });
  };

  // ---- отрисовка экрана
  const drawTrack = (p: Player, x0: number, idx: number) => {
    g.save();
    g.translate(x0, 0);
    g.beginPath();
    g.rect(0, 0, TRACK_PX, SH);
    g.clip();
    const night = s.track === 'night' && s.mode === 'play';
    g.fillStyle = night ? C.night : C.field;
    g.fillRect(0, 0, TRACK_PX, SH);
    const py = p.y * S;
    const px = p.x * S;
    if (night && p.on) {
      // темнота заштрихована, луч фар — единственное освещённое место (рис. 5 руководства)
      g.strokeStyle = '#4a0a2a';
      g.lineWidth = 1;
      for (let y = -40; y < SH + 20; y += 10) {
        g.beginPath();
        g.moveTo(0, y + ((s.clock * 40) % 10));
        g.lineTo(TRACK_PX, y + 26 + ((s.clock * 40) % 10));
        g.stroke();
      }
      g.fillStyle = C.field;
      g.beginPath();
      g.moveTo(px - 4, py - 10);
      g.lineTo(px - 26, 0);
      g.lineTo(px + 26, 0);
      g.lineTo(px + 4, py - 10);
      g.fill();
    }
    // разделительная полоса «Гоночной»
    if (s.track === 'race') {
      g.fillStyle = C.post;
      for (let y = -POST_GAP; y < TH + POST_GAP; y += POST_GAP / 2) g.fillRect(TRACK_PX / 2 - 0.5, Math.round((y + (p.scroll * 2) % (POST_GAP / 2)) * S), 1, 6);
    }
    // парапет — бегущие столбики
    g.strokeStyle = C.post;
    g.lineWidth = 1;
    for (let y = -POST_GAP; y < TH + POST_GAP; y += POST_GAP) {
      const yy = Math.round((y + p.scroll) * S) + 0.5;
      g.strokeRect(2.5, yy, 4, 9);
      g.strokeRect(TRACK_PX - 6.5, yy, 4, 9);
    }
    // машины автомата
    const inBeam = (c: Mover) => {
      if (!night) return true;
      const cy = c.y * S;
      if (cy > py) return false;
      const half = 4 + ((py - cy) / py) * 22;
      return Math.abs(c.x * S - px) < half + 6;
    };
    for (const c of p.cars) {
      if (!inBeam(c)) continue;
      if (c.kind === 'spec') {
        const blink = Math.floor(s.clock * 6) % 2 === 0;
        drawCar(g, c.x * S, c.y * S, c.w, C.spec, blink ? '#3cf' : '#f33');
      } else drawCar(g, c.x * S, c.y * S, c.w, C.car, C.carEdge);
    }
    // ПРИЗ — надпись поперёк трассы
    if (p.prizeSign !== null) {
      g.fillStyle = Math.floor(s.clock * 5) % 2 ? '#ffff00' : '#ffffff';
      g.font = 'bold 22px monospace';
      g.textAlign = 'center';
      g.fillText('ПРИЗ', TRACK_PX / 2, p.prizeSign * S + 8);
    }
    // машина игрока или взрыв
    if (p.on) {
      if (p.boom) {
        const t = p.boom.t;
        const r = 4 + t * 26;
        for (let k = 0; k < 10; k++) {
          const a = (k / 10) * Math.PI * 2 + t * 3;
          g.fillStyle = k % 2 ? '#ffff00' : '#ffffff';
          const rr = r * (0.6 + 0.4 * ((k * 37) % 7) / 7);
          g.fillRect(Math.round(p.boom.x * S + Math.cos(a) * rr) - 2, Math.round(p.boom.y * S + Math.sin(a) * rr) - 2, 4, 4);
        }
        if (t < CRASH_TIME * 0.4) {
          g.fillStyle = '#ffffff';
          g.fillRect(Math.round(p.boom.x * S) - 6, Math.round(p.boom.y * S) - 6, 12, 12);
        }
      } else drawCar(g, px, py, CAR_W, idx ? C.p2 : C.p1, '#ffffff');
    }
    g.restore();
  };

  const drawCenter = () => {
    const x0 = X0[0] + TRACK_PX;
    const cx = x0 + GAP / 2;
    g.fillStyle = C.field;
    g.fillRect(x0, 0, GAP, SH);
    // финишная лента и основание
    g.fillStyle = C.tape;
    g.fillRect(cx - 14, 8, 28, 5);
    const base = SH - 18;
    g.fillRect(cx - 18, base, 36, 2);
    const top = 16;
    const bar = (x: number, w: number, v: number, col: string, outline = false) => {
      const h = Math.round((base - top) * v);
      if (outline) {
        g.strokeStyle = col;
        g.lineWidth = 1;
        g.strokeRect(x + 0.5, base - h + 0.5, w - 1, h);
      } else {
        g.fillStyle = col;
        g.fillRect(x, base - h, w, h);
      }
    };
    const [p1, p2] = s.players;
    if (p1.on || s.mode === 'over') bar(cx - 12, 7, indicator(p1), C.p1);
    if (p2.on || s.mode === 'over') bar(cx + 5, 7, indicator(p2), C.p2);
    bar(cx - 4, 8, greenIndicator(s), C.green);
  };

  const ATTRACT = [
    '....XXXX....',
    'XXXXX..XXXXX',
    'XX.XXXXXX.XX',
    'XX.X....X.XX',
    'XXXX.XX.XXXX',
    'XX.X....X.XX',
    'XX.XXXXXX.XX',
    'XXXXXXXXXXXX',
    '....XXXX....',
    '....XXXX....',
    '....XXXX....',
    '..XXXXXXXX..',
    'XXXX.XX.XXXX',
    'XX.XXXXXX.XX',
    'XX.X.XX.X.XX',
    'XX.XXXXXX.XX',
    'XXXX.XX.XXXX',
    '..XXXXXXXX..',
  ];
  const drawAttract = () => {
    g.fillStyle = C.field;
    g.fillRect(0, 0, SW, SH);
    const k = 12;
    const ox = SW / 2 - (ATTRACT[0].length * k) / 2;
    const oy = SH / 2 - (ATTRACT.length * k) / 2 + Math.sin(s.clock * 1.4) * 4;
    for (let y = 0; y < ATTRACT.length; y++)
      for (let x = 0; x < ATTRACT[y].length; x++) {
        if (ATTRACT[y][x] !== 'X') continue;
        g.fillStyle = '#c8ccff';
        g.fillRect(ox + x * k, oy + y * k, k, k);
        // тонкая синяя кайма только по внешнему краю фигуры, как на экране автомата
        g.fillStyle = '#5a6cf0';
        const empty = (dx: number, dy: number) => (ATTRACT[y + dy]?.[x + dx] ?? '.') !== 'X';
        if (empty(-1, 0)) g.fillRect(ox + x * k, oy + y * k, 1, k);
        if (empty(1, 0)) g.fillRect(ox + x * k + k - 1, oy + y * k, 1, k);
        if (empty(0, -1)) g.fillRect(ox + x * k, oy + y * k, k, 1);
        if (empty(0, 1)) g.fillRect(ox + x * k, oy + y * k + k - 1, k, 1);
      }
  };

  const text = (t: string, y: number, col = C.text, size = 16) => {
    g.font = `bold ${size}px monospace`;
    g.textAlign = 'center';
    g.fillStyle = '#000';
    g.fillText(t, SW / 2 + 1, y + 1);
    g.fillStyle = col;
    g.fillText(t, SW / 2, y);
  };

  const draw = () => {
    g.imageSmoothingEnabled = false;
    if (s.mode === 'attract' || s.mode === 'ready') {
      drawAttract();
      if (s.mode === 'ready') {
        text(`ОПЛАЧЕНО: ${s.credits === 2 ? 'ДВОЕ' : 'ОДИН'}`, 22, '#ffff00', 14);
        text(`ТРАССА «${TRACKS.find((t) => t.id === s.track)!.title.toUpperCase()}»`, SH - 30, '#ffffff', 13);
        if (Math.floor(s.clock * 2) % 2) text('КОСНИТЕСЬ «СТАРТ»', SH - 12, '#ffff00', 12);
      }
    } else {
      drawTrack(s.players[0], X0[0], 0);
      drawTrack(s.players[1], X0[1], 1);
      drawCenter();
      g.fillStyle = '#5a1030';
      g.fillRect(0, 0, X0[0], SH);
      g.fillRect(SW - 10, 0, 10, SH);
      if (s.prizeRound && s.mode === 'play') text('ПРИЗОВАЯ ИГРА', 30, '#ffff00', 12);
      if (s.mode === 'over') text('КОНЕЦ ИГРЫ', SH / 2, '#ffff00', 22);
    }
    if (s.clock < msgUntil && msgText) text(msgText, SH / 2 + 40, '#ffffff', 12);
    // пульт: руль, педаль
    s.players.forEach((p, i) => {
      wheels[i].style.transform = `rotate(${p.wheel * 70}deg)`;
      pedals[i].style.setProperty('--p', String(p.pedal));
    });
    wrap.querySelectorAll<HTMLButtonElement>('.mg-pad[data-t]').forEach((b) => b.classList.toggle('on', b.dataset.t === s.track));
    q<HTMLButtonElement>('.mg-start').classList.toggle('on', s.mode === 'ready' && Math.floor(s.clock * 2) % 2 === 0);
    wrap.querySelectorAll('.mg-ico').forEach((el, i) => el.classList.toggle('on', (s.mode === 'ready' && s.credits > i) || (s.mode === 'play' && s.players[i].on)));
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
      info.remove();
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', clear);
      wrap.remove();
    },
  };
}
