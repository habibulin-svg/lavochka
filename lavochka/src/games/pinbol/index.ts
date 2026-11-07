/* Пинбол — экран аркады: стол на canvas (рисованная подложка, детали стола — картинки модели из art.ts), табло с точечными цифрами,
 * флипперы с клавиатуры и касанием, пружина, подтолкнуть стол, звуки, музыка стола (выключатель запоминается),
 * сохранение партии: пауза, уход со страницы — партия сохраняется и продолжается при следующем входе.
 * Вход — экран игры (soloHome): столы кнопками, правила, рекорды, текст страницы. */
import type { ArcadeModule, ArcadeOpts } from '../../core/arcade';
import { audioOut, click, Sound, tone } from '../../core/audio';
import { store } from '../../core/settings';
import { h } from '../../core/util';
import { art, loadArt, loaded, offset, pattern, ribbon, smooth, sprite, strip, stripLine, tinted, type ArtName } from './art';
import {
  BALL_R,
  flipperTip,
  KICKBACK,
  laneShift,
  missionOf,
  newGame,
  rampAt,
  rampLen,
  rampMouthWalls,
  rampPath,
  SLING_TRI,
  step,
  tableOf,
  TABLES,
  TH,
  TW,
  validSave,
  type PbEvent,
  type PbInput,
  type PbState,
  type TableDef,
} from './logic';
import './pinbol.css';

const DMD = 136;
const PREF_MUSIC = 'pinbol.music';
const SAVE = (t: string) => `pinbol.save2.${t}`;
const BEST = (t: string) => `pinbol.best.${t}`;

interface Look {
  /** Цвет ламп-вставок, резины, белых деталей (мишени, стойки), рампы. */
  insert: string;
  rubber: string;
  target: string;
  stand: string;
  ramp: string;
  post: string;
  frame: [string, string];
  bg: [string, string];
}

const LOOKS: Record<string, Look> = {
  park: { insert: '#ffd23a', rubber: '#e8322a', target: '#ffcf3a', stand: '#ff5a4a', ramp: '#ffd6c8', post: '#ff6a5a', frame: ['#7a1f10', '#3a0c06'], bg: ['#ff9a4a', '#5a1a5a'] },
  disco: { insert: '#ff3df2', rubber: '#ff3df2', target: '#3af0ff', stand: '#ff5af0', ramp: '#e0b8ff', post: '#ff7af4', frame: ['#2a0a4a', '#0c0418'], bg: ['#4a1a8a', '#0c0418'] },
  kosmos: { insert: '#7af0ff', rubber: '#ff8a2a', target: '#ffb03a', stand: '#7ad8ff', ramp: '#c8e8ff', post: '#ff9a4a', frame: ['#0a1a4a', '#03081e'], bg: ['#123a8a', '#05081e'] },
};

const img = (src: string) => {
  const i = new Image();
  i.src = src;
  return i;
};
const BG: Record<string, HTMLImageElement> = {};
const bgArt = (id: string) => (BG[id] ??= img(`/pinbol/${id}.webp`));

/** Где на рампе стоит фигура стола (доля пути) и какая. */
const RAMP_TOY: Record<string, { name: ArtName; at: number; w: number; h: number }> = {
  park: { name: 'coaster', at: 0.42, w: 54, h: 40 },
  kosmos: { name: 'rocket', at: 0.06, w: 34, h: 64 },
};

class Pinball {
  private el: HTMLElement;
  private cv: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private stat: HTMLCanvasElement | null = null;
  private rampCv: HTMLCanvasElement | null = null;
  private statKey = '';
  private st: PbState;
  private tb: TableDef;
  private look: Look;
  private raf = 0;
  private last = 0;
  private acc = 0;
  private paused = false;
  private keys = new Set<string>();
  private touches = new Map<number, 'L' | 'R'>();
  private nudgeReq = false;
  private wasL = false;
  private wasR = false;
  private scale = 1;
  private ox = 0;
  private oy = 0;
  private music: HTMLAudioElement | null = null;
  private musicBtn: HTMLButtonElement | null = null;
  private cleanup: (() => void)[] = [];
  private flash = 0;
  private shake = 0;
  resumed = false;

  constructor(
    root: HTMLElement,
    private opts: ArcadeOpts,
    /** Превью карточки: без сохранений и управления, шары расставлены. */
    demo = false
  ) {
    this.tb = tableOf(opts.mode);
    this.look = LOOKS[this.tb.id] ?? LOOKS.park;
    const saved = demo ? null : store.get<unknown>(SAVE(this.tb.id), null);
    if (validSave(saved) && saved.table === this.tb.id && !saved.over) {
      this.st = saved;
      this.resumed = true;
    } else this.st = newGame(this.tb.id);
    this.el = h(`<div class="pb-wrap"><canvas class="pb-cv"></canvas></div>`);
    root.appendChild(this.el);
    this.cv = this.el.querySelector('canvas') as HTMLCanvasElement;
    this.g = this.cv.getContext('2d')!;
    bgArt(this.tb.id).onload = () => (this.statKey = '');
    void loadArt().then(() => (this.statKey = ''));
    if (demo) {
      this.paused = true;
      const i = TABLES.indexOf(this.tb);
      this.st.score = [48250, 126700, 73400][i] ?? 0;
      this.st.lanes = this.st.lanes.map((_, k) => k % 2 === 0);
      this.st.stands = this.st.stands.map((_, k) => k !== 1);
      this.st.mult = 3;
      this.st.mission = 1;
      this.st.mprog = 1;
      const R = this.tb.ramps[0];
      const [rx, ry] = rampAt(R, rampLen(R) * 0.3);
      this.st.balls = [
        { x: 330, y: 560, vx: 0, vy: 0, held: 0 },
        { x: 236, y: 880, vx: 0, vy: 0, held: 0 },
        { x: rx, y: ry, vx: 0, vy: 0, held: 0, ramp: 0, rs: rampLen(R) * 0.3 },
      ];
      this.st.bumpLit[1] = 0.2;
      this.st.spins.forEach((s) => (s.a = 0.9));
      this.st.flips[0].a = this.tb.flippers[0].up;
      this.st.msgT = 0;
    } else {
      this.panel();
      this.bind();
    }
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  // ---------------------------------------------------------------- панель: музыка, толчок, новая игра

  private panel() {
    const p = this.opts.panel;
    if (!p) return;
    const row = h(`<div class="pb-panel">
      <button class="btn small" data-a="music"></button>
      <button class="btn small" data-a="nudge" title="Клавиша ↑ или W">Толкнуть стол</button>
      <button class="btn small" data-a="new">Новая игра</button>
    </div>`);
    p.appendChild(row);
    this.musicBtn = row.querySelector('[data-a=music]') as HTMLButtonElement;
    const sync = () => (this.musicBtn!.textContent = this.musicOn() ? '♪ Музыка: вкл' : '♪ Музыка: выкл');
    sync();
    this.musicBtn.onclick = () => {
      store.set(PREF_MUSIC, this.musicOn() ? 'off' : 'on');
      sync();
      this.syncMusic();
      this.musicBtn!.blur();
    };
    (row.querySelector('[data-a=nudge]') as HTMLButtonElement).onclick = (e) => {
      this.nudgeReq = true;
      (e.target as HTMLElement).blur();
    };
    (row.querySelector('[data-a=new]') as HTMLButtonElement).onclick = (e) => {
      this.restart();
      (e.target as HTMLElement).blur();
    };
  }

  private musicOn = () => store.get<string>(PREF_MUSIC, 'on') !== 'off';

  private syncMusic() {
    const want = this.musicOn() && !this.paused && !this.st.over;
    if (!want) {
      this.music?.pause();
      return;
    }
    if (!this.music) {
      this.music = new Audio(`/pinbol/music/${this.tb.id}.ogg`);
      this.music.loop = true;
      this.music.volume = 0.28;
    }
    if (this.music.paused) void this.music.play().catch(() => {});
  }

  private restart() {
    store.set(SAVE(this.tb.id), null);
    this.st = newGame(this.tb.id);
    this.syncMusic();
  }

  // ---------------------------------------------------------------- управление

  private bind() {
    const L = ['ShiftLeft', 'KeyZ', 'ArrowLeft', 'KeyA', 'ControlLeft'];
    const R = ['ShiftRight', 'Slash', 'ArrowRight', 'KeyD', 'ControlRight', 'KeyM'];
    const P = ['Space', 'ArrowDown', 'Enter', 'KeyS'];
    const N = ['ArrowUp', 'KeyW'];
    const all = [...L, ...R, ...P, ...N];
    const kd = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest?.('input, textarea') || !all.includes(e.code)) return;
      if (this.paused) return;
      e.preventDefault();
      Sound.unlock();
      this.syncMusic();
      if (N.includes(e.code) && !e.repeat) this.nudgeReq = true;
      if (P.includes(e.code) && this.st.over && !e.repeat) return this.restart();
      this.keys.add(e.code);
    };
    const ku = (e: KeyboardEvent) => this.keys.delete(e.code);
    const blur = () => this.keys.clear();
    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    window.addEventListener('blur', blur);
    this.cleanup.push(() => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      window.removeEventListener('blur', blur);
    });
    this.input = () => {
      const has = (l: string[]) => l.some((c) => this.keys.has(c));
      const tl = [...this.touches.values()];
      return { l: has(L) || tl.includes('L'), r: has(R) || tl.includes('R'), pull: has(P) || (this.st.inLane && tl.length > 0) };
    };
    const cv = this.cv;
    cv.style.touchAction = 'none';
    const down = (e: PointerEvent) => {
      Sound.unlock();
      this.syncMusic();
      if (this.st.over) return this.restart();
      const r = cv.getBoundingClientRect();
      this.touches.set(e.pointerId, e.clientX - r.left < r.width / 2 ? 'L' : 'R');
      cv.setPointerCapture?.(e.pointerId);
    };
    const up = (e: PointerEvent) => this.touches.delete(e.pointerId);
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    cv.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private input: () => { l: boolean; r: boolean; pull: boolean } = () => ({ l: false, r: false, pull: false });

  // ---------------------------------------------------------------- цикл

  pause(on: boolean) {
    this.paused = on;
    if (on) this.save();
    this.keys.clear();
    this.touches.clear();
    this.syncMusic();
  }

  private save() {
    store.set(SAVE(this.tb.id), this.st.over ? null : this.st);
  }

  private frame(now: number) {
    this.raf = requestAnimationFrame((t) => this.frame(t));
    const dt = Math.min(0.1, (now - (this.last || now)) / 1000);
    this.last = now;
    if (!this.paused && !document.hidden) {
      this.acc += dt;
      const STEP = 1 / 60;
      while (this.acc >= STEP) {
        this.acc -= STEP;
        const k = this.input();
        const inp: PbInput = { ...k, nudge: this.nudgeReq };
        this.nudgeReq = false;
        if (k.l && !this.wasL) laneShift(this.st, -1);
        if (k.r && !this.wasR) laneShift(this.st, 1);
        this.wasL = k.l;
        this.wasR = k.r;
        const wasOver = this.st.over;
        const ev = step(this.st, inp, STEP);
        for (const e of ev) this.sound(e);
        if (!wasOver && this.st.over) this.finish();
      }
    }
    this.render(this.paused ? 0 : dt);
  }

  private finish() {
    store.set(SAVE(this.tb.id), null);
    const best = store.get<number>(BEST(this.tb.id), 0);
    if (this.st.score > best) store.set(BEST(this.tb.id), this.st.score);
    this.syncMusic();
    this.opts.onScore(this.st.score);
  }

  // ---------------------------------------------------------------- звук

  private sound(e: PbEvent) {
    if (e.k === 'bumper') {
      this.flash = Math.max(this.flash, 0.25);
      this.shake = Math.max(this.shake, 0.25);
    }
    if (e.k === 'tilt') this.shake = 1;
    if (e.k === 'mission' || e.k === 'kickback') this.flash = Math.max(this.flash, 0.6);
    const o = audioOut();
    if (!o) return;
    const t = o.ctx.currentTime;
    switch (e.k) {
      case 'bumper':
        tone(t, { freq: 320 + e.i * 70, to: 160, dur: 0.12, gain: 0.25, type: 'square' });
        click(t, { freq: 1800, q: 2, dur: 0.03, gain: 0.35 });
        break;
      case 'sling':
        click(t, { freq: 900, q: 1.5, dur: 0.05, gain: 0.5 });
        tone(t, { freq: 180, to: 90, dur: 0.08, gain: 0.25 });
        break;
      case 'flip':
        click(t, { freq: 400, q: 1, dur: 0.05, gain: 0.45 });
        tone(t, { freq: 90, to: 60, dur: 0.06, gain: 0.3 });
        break;
      case 'flipHit':
        click(t, { freq: 1200, q: 2, dur: 0.03, gain: Math.min(0.5, e.st / 3000) });
        break;
      case 'wall':
        click(t, { freq: 1600 + Math.random() * 600, q: 3, dur: 0.025, gain: Math.min(0.35, e.st / 4000) });
        break;
      case 'target':
        click(t, { freq: 700, q: 2, dur: 0.06, gain: 0.5 });
        tone(t, { freq: e.all ? 880 : 520, dur: 0.1, gain: 0.15, type: 'triangle' });
        if (e.all) [660, 880, 1100, 1320].forEach((f, i) => tone(t + 0.1 + i * 0.08, { freq: f, dur: 0.1, gain: 0.14, type: 'square' }));
        break;
      case 'stand':
        click(t, { freq: 1100, q: 3, dur: 0.04, gain: 0.45 });
        tone(t, { freq: 760 + e.i * 90, dur: 0.08, gain: 0.13, type: 'triangle' });
        if (e.all) [523, 784, 1046].forEach((f, i) => tone(t + 0.08 + i * 0.08, { freq: f, dur: 0.12, gain: 0.14, type: 'square' }));
        break;
      case 'spin':
        click(t, { freq: 3000, q: 4, dur: 0.015, gain: 0.22 });
        break;
      case 'rampIn':
        tone(t, { freq: 200, to: 500, dur: 0.3, gain: 0.12, type: 'triangle' });
        break;
      case 'ramp':
        [659, 784, 988, e.combo ? 1318 : 1175].forEach((f, i) => tone(t + i * 0.06, { freq: f, dur: 0.1, gain: 0.13, type: 'square' }));
        break;
      case 'rampBack':
        tone(t, { freq: 500, to: 150, dur: 0.35, gain: 0.12, type: 'triangle' });
        break;
      case 'disc':
        tone(t, { freq: 600, to: 900, dur: 0.12, gain: 0.08, type: 'sine' });
        break;
      case 'magnet':
        if (e.out) tone(t, { freq: 120, to: 600, dur: 0.25, gain: 0.18, type: 'sawtooth' });
        else tone(t, { freq: 900, to: 80, dur: 0.6, gain: 0.16, type: 'sawtooth' });
        break;
      case 'kickback':
        click(t, { freq: 500, q: 1, dur: 0.1, gain: 0.6 });
        tone(t, { freq: 100, to: 400, dur: 0.2, gain: 0.25, type: 'square' });
        break;
      case 'mission':
        (e.all ? [523, 659, 784, 1046, 1318, 1568, 2093] : [784, 988, 1175, 1568]).forEach((f, i) => tone(t + i * 0.09, { freq: f, dur: 0.14, gain: 0.15, type: 'square' }));
        break;
      case 'lane':
        tone(t, { freq: 1046 + e.i * 120, dur: 0.12, gain: 0.14, type: 'triangle' });
        if (e.all) [784, 988, 1175, 1568].forEach((f, i) => tone(t + 0.08 + i * 0.07, { freq: f, dur: 0.12, gain: 0.13, type: 'square' }));
        break;
      case 'saucer':
        tone(t, { freq: 150, to: 60, dur: 0.25, gain: 0.35 });
        if (e.jackpot || e.multiball) [523, 659, 784, 1046, 1318].forEach((f, i) => tone(t + 0.1 + i * 0.09, { freq: f, dur: 0.14, gain: 0.15, type: 'square' }));
        break;
      case 'orbit':
        tone(t, { freq: 400, to: 1600, dur: 0.35, gain: 0.12, type: 'sawtooth' });
        break;
      case 'launch':
        click(t, { freq: 300, q: 1, dur: 0.08, gain: 0.5 });
        tone(t, { freq: 120, to: 300, dur: 0.15, gain: 0.2, type: 'triangle' });
        break;
      case 'skill':
      case 'extra':
        [784, 1046, 1318, 1568, 2093].forEach((f, i) => tone(t + i * 0.08, { freq: f, dur: 0.12, gain: 0.14, type: 'square' }));
        break;
      case 'drain':
        tone(t, { freq: e.saved ? 600 : 300, to: e.saved ? 900 : 80, dur: 0.6, gain: 0.18, type: 'sawtooth' });
        break;
      case 'tilt':
      case 'warn':
        tone(t, { freq: 110, dur: e.k === 'tilt' ? 0.8 : 0.25, gain: 0.25, type: 'square' });
        break;
      case 'over':
        [523, 392, 330, 262].forEach((f, i) => tone(t + i * 0.18, { freq: f, dur: 0.2, gain: 0.15, type: 'square' }));
        break;
    }
  }

  // ---------------------------------------------------------------- отрисовка

  private layout() {
    const r = this.el.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(60, Math.round(r.width * dpr));
    const hgt = Math.max(60, Math.round(r.height * dpr));
    if (this.cv.width !== w || this.cv.height !== hgt) {
      this.cv.width = w;
      this.cv.height = hgt;
    }
    const s = Math.min(w / (TW + 20), hgt / (TH + DMD + 30));
    this.scale = s;
    this.ox = (w - TW * s) / 2;
    this.oy = (hgt - (TH + DMD) * s) / 2 + DMD * s;
  }

  /** Контур игрового поля: прямоугольник с дугой сверху. */
  private fieldPath(g: CanvasRenderingContext2D) {
    g.beginPath();
    g.moveTo(20, TH + 60);
    g.lineTo(20, 280);
    g.arc(300, 280, 280, Math.PI, Math.PI * 2);
    g.lineTo(580, TH + 60);
    g.closePath();
  }

  /** Неподвижное: корпус, подложка, мёртвые зоны под пластиком, борта-рейки, рогатки, столбики, лунка. */
  private drawStatic() {
    const key = `${this.cv.width}x${this.cv.height}:${this.tb.id}:${bgArt(this.tb.id).complete}:${loaded()}`;
    if (key === this.statKey && this.stat) return;
    this.statKey = key;
    const c = (this.stat ??= document.createElement('canvas'));
    c.width = this.cv.width;
    c.height = this.cv.height;
    const g = c.getContext('2d')!;
    const L = this.look;
    const s = this.scale;
    const id = this.tb.id;
    // корпус автомата: лакированное дерево
    g.fillStyle = L.frame[1];
    g.fillRect(0, 0, c.width, c.height);
    g.setTransform(s, 0, 0, s, this.ox, this.oy);
    const woodIm = art('wood');
    if (woodIm) {
      // лист дерева — на весь фон, без повторов
      const W = c.width / s;
      const H = c.height / s;
      const k = Math.max(W, H) / woodIm.naturalWidth;
      g.drawImage(woodIm, -this.ox / s, -this.oy / s, woodIm.naturalWidth * k, woodIm.naturalHeight * k);
    }
    const wood = pattern(g, 'wood', 0.5);
    // тень поля в корпусе
    g.save();
    g.shadowColor = 'rgba(0,0,0,0.8)';
    g.shadowBlur = 40 * s;
    g.fillStyle = '#000';
    this.fieldPath(g);
    g.fill();
    g.restore();
    // поле: подложка-картинка
    g.save();
    this.fieldPath(g);
    g.clip();
    const fg = g.createLinearGradient(0, 0, 0, TH);
    fg.addColorStop(0, L.bg[0]);
    fg.addColorStop(1, L.bg[1]);
    g.fillStyle = fg;
    g.fillRect(0, 0, TW, TH + 60);
    const im = bgArt(id);
    if (im.complete && im.naturalWidth) {
      const k = Math.max(TW / im.naturalWidth, (TH + 60) / im.naturalHeight);
      const iw = im.naturalWidth * k;
      const ih = im.naturalHeight * k;
      g.drawImage(im, (TW - iw) / 2, (TH + 60 - ih) / 2, iw, ih);
      g.fillStyle = 'rgba(10,6,24,0.22)';
      g.fillRect(0, 0, TW, TH + 60);
    }
    // по краям темнее — детали читаются поверх рисунка
    const vg = g.createRadialGradient(284, 520, 160, 284, 560, 760);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.5)');
    g.fillStyle = vg;
    g.fillRect(0, 0, TW, TH + 60);
    // пластик под направляющими (мёртвые зоны внизу) и жёлоб пружины — пластик стола и дерево
    const plast = pattern(g, `plastic-${id}` as ArtName, 0.35);
    const dead = [
      [62, 920, 201, 974, 201, TH + 60, 62, TH + 60],
      [506, 920, 367, 974, 367, TH + 60, 506, TH + 60],
    ];
    for (const d of dead) {
      g.beginPath();
      g.moveTo(d[0], d[1]);
      for (let i = 2; i < d.length; i += 2) g.lineTo(d[i], d[i + 1]);
      g.closePath();
      g.fillStyle = plast ?? L.frame[0];
      g.fill();
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fill();
    }
    if (wood) {
      g.fillStyle = wood;
      g.fillRect(548, 330, 32, TH);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.fillRect(548, 330, 32, TH);
    }
    g.restore();
    // рогатки: пластик стола, по лицу — резина
    for (const sl of SLING_TRI) {
      g.save();
      g.beginPath();
      g.moveTo(sl[0], sl[1]);
      g.lineTo(sl[2], sl[3]);
      g.lineTo(sl[4], sl[5]);
      g.closePath();
      g.shadowColor = 'rgba(0,0,0,0.6)';
      g.shadowBlur = 12 * s;
      g.shadowOffsetY = 4 * s;
      g.fillStyle = plast ?? L.frame[0];
      g.fill();
      g.restore();
    }
    // борта и направляющие: хромированные рейки с тенью
    const rail = art('rail');
    const lines = [...this.tb.walls.slice(1), ...this.tb.ramps.flatMap(rampMouthWalls)];
    g.save();
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.lineWidth = 12;
    g.translate(2, 4);
    for (const pl of lines) {
      g.beginPath();
      g.moveTo(pl[0], pl[1]);
      for (let i = 2; i < pl.length; i += 2) g.lineTo(pl[i], pl[i + 1]);
      g.stroke();
    }
    g.restore();
    for (const pl of lines) stripLine(g, rail, pl, 9);
    // наружный борт — рейка пошире
    stripLine(g, rail, this.tb.walls[0], 14);
    // столбики
    const post = tinted('post', L.post);
    for (const [x, y, r] of this.tb.posts) sprite(g, post, x, y, (r + 3) * 2.2, (r + 3) * 2.2);
    // лунка
    const sc = this.tb.saucer;
    sprite(g, art('saucer'), sc.x, sc.y, 44, 44);
    // отбойник в левом ауте
    g.setTransform(1, 0, 0, 1, 0, 0);

    // рампы — отдельный слой поверх шаров на поле (прозрачный пластик)
    const rc = (this.rampCv ??= document.createElement('canvas'));
    rc.width = c.width;
    rc.height = c.height;
    const rg = rc.getContext('2d')!;
    rg.setTransform(s, 0, 0, s, this.ox, this.oy);
    const rt = tinted('ramp', L.ramp);
    for (const R of this.tb.ramps) {
      const { pts } = rampPath(R);
      const p0 = smooth([R.mouth[0] - R.dir[0] * 12, R.mouth[1] - R.dir[1] * 12, ...pts], 4);
      // тень рампы на поле
      rg.save();
      rg.globalAlpha = 0.3;
      rg.strokeStyle = '#000';
      rg.lineWidth = 54;
      rg.lineJoin = 'round';
      rg.translate(8, 12);
      rg.beginPath();
      rg.moveTo(p0[0], p0[1]);
      for (let i = 2; i < p0.length; i += 2) rg.lineTo(p0[i], p0[i + 1]);
      rg.stroke();
      rg.restore();
      // прозрачный пластик и хромированные бортики по краям
      rg.save();
      rg.globalAlpha = 0.62;
      ribbon(rg, rt as HTMLCanvasElement | null, p0, 54);
      rg.restore();
      const rl = art('rail');
      ribbon(rg, rl, offset(p0, 27), 7);
      ribbon(rg, rl, offset(p0, -27), 7);
      const toy = RAMP_TOY[this.tb.id];
      if (toy) {
        const [x, y, dx, dy] = rampAt(R, rampLen(R) * toy.at);
        const side = toy.name === 'rocket' ? -1 : 0;
        sprite(rg, art(toy.name), x + -dy * 46 * side, y + dx * 46 * side, toy.w, toy.h, side ? 0 : Math.atan2(dy, dx) + (dx < 0 ? Math.PI : 0));
      }
    }
    rg.setTransform(1, 0, 0, 1, 0, 0);
  }

  private render(dt: number) {
    this.layout();
    this.drawStatic();
    const g = this.g;
    const st = this.st;
    const L = this.look;
    const tb = this.tb;
    const s = this.scale;
    let sx = 0;
    let sy = 0;
    if (this.shake > 0) {
      sx = (Math.random() - 0.5) * this.shake * 6 * s;
      sy = (Math.random() - 0.5) * this.shake * 6 * s;
      this.shake = Math.max(0, this.shake - dt * 4);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.stat!, sx, sy);
    g.setTransform(s, 0, 0, s, this.ox + sx, this.oy + sy);
    const blink = Math.floor(st.t * 4) % 2 === 0;
    const mis = missionOf(st);
    const want = (ev: string) => !!mis && tb.missions[st.mission % tb.missions.length]?.ev === ev;
    // огни дорожек: буквы
    tb.lanes.forEach(([x, y], i) => {
      const on = st.lanes[i];
      const skill = st.save > 6 && st.skill === i && st.inLane === false && st.balls.length === 1;
      const lit = on || (skill && blink) || (st.inLane && st.skill === i && blink);
      this.insert(x, y + 34, 15, lit, L.insert, tb.word[i] ?? '');
    });
    // множитель бонуса
    [2, 3, 4, 5].forEach((m, i) => this.insert(214 + i * 46, 760, 14, st.mult >= m, '#ffd23a', `×${m}`));
    // спасение шара и отбойник
    this.insert(284, 1062, 12, st.save > 0 && (st.save > 2 || blink), '#3aff8a', '◆');
    this.arrowIns(KICKBACK[0], KICKBACK[1] - 60, 0, 13, st.kick, '#3aff8a');
    // стрелки к рампам, вертушкам, кругу — мигают, если это цель задания
    tb.ramps.forEach((R) => {
      const a = Math.atan2(R.dir[1], R.dir[0]) + Math.PI / 2;
      const lit = want('ramp') ? blink : st.t - st.rampT < 1.5;
      for (let k = 0; k < 2; k++) this.arrowIns(R.mouth[0] - R.dir[0] * (68 + k * 30), R.mouth[1] - R.dir[1] * (68 + k * 30), a, 12, lit, L.insert);
    });
    tb.spinners.forEach(([ax, ay, bx, by], i) => {
      const lit = want('spin') ? blink : Math.abs(st.spins[i].w) > 2;
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      this.arrowIns(mx, my + 34, 0, 11, lit, L.insert);
    });
    // джекпот у лунки
    const sc = tb.saucer;
    if (st.jackpot) {
      g.save();
      g.shadowColor = '#ffd23a';
      g.shadowBlur = 24 * s;
      g.strokeStyle = blink ? '#ffd23a' : '#ff8a2a';
      g.lineWidth = 4;
      g.beginPath();
      g.arc(sc.x, sc.y, 26, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
    this.insert(sc.x, sc.y + 40, 11, st.saucerCount % 3 === 2 || (want('saucer') && blink), '#ff3d6a', 'М');
    // орбита: стрелки
    if (tb.orbit) {
      const [ox, oy] = tb.orbit;
      for (let k = 0; k < 3; k++) this.arrowIns(ox, oy + 90 - k * 36, 0, 12, want('orbit') ? blink : (Math.floor(st.t * 6) + k) % 3 === 0, L.insert);
    }
    // круг: крутится
    if (tb.disc) {
      const D = tb.disc;
      const im = art(tb.id === 'park' ? 'carousel' : 'vinyl');
      g.save();
      g.globalAlpha = 0.45;
      g.fillStyle = '#000';
      g.beginPath();
      g.arc(D.x + 4, D.y + 7, D.r, 0, Math.PI * 2);
      g.fill();
      g.restore();
      sprite(g, im, D.x, D.y, D.r * 2.1, D.r * 2.1, st.t * Math.sign(D.spin) * 2.2);
      if (want('disc') && blink) this.ring(D.x, D.y, D.r + 6, L.insert);
    }
    // магнит: зеркальный шар или чёрная дыра
    if (tb.magnet) {
      const M = tb.magnet;
      const holding = st.balls.some((b) => b.held > 0 && Math.hypot(b.x - M.x, b.y - M.y) < 2);
      if (tb.id === 'kosmos') sprite(g, art('blackhole'), M.x, M.y, M.r * 2, M.r * 2, -st.t * (holding ? 6 : 1.2));
      else {
        g.save();
        if (holding || (want('magnet') && blink)) {
          g.shadowColor = '#ff8af8';
          g.shadowBlur = 30 * s;
        }
        sprite(g, art('mirrorball'), M.x, M.y, 62, 62, st.t * 0.6);
        g.restore();
      }
      if (want('magnet') && blink) this.ring(M.x, M.y, 40, L.insert);
    }
    // сбиваемые мишени
    const drop = tinted('drop', L.target);
    tb.targets.forEach(([ax, ay, bx, by], i) => {
      const a = Math.atan2(by - ay, bx - ax);
      const len = Math.hypot(bx - ax, by - ay);
      if (st.targets[i]) {
        g.save();
        g.shadowColor = 'rgba(0,0,0,0.6)';
        g.shadowBlur = 6 * s;
        g.shadowOffsetY = 3 * s;
        sprite(g, drop, (ax + bx) / 2, (ay + by) / 2, len + 2, 12, a);
        g.restore();
      } else {
        g.save();
        g.translate((ax + bx) / 2, (ay + by) / 2);
        g.rotate(a);
        g.fillStyle = 'rgba(0,0,0,0.7)';
        g.fillRect(-len / 2, -2, len, 4);
        g.restore();
      }
    });
    // стойки: загораются; лампа с буквой перед каждой
    const stand = tinted('standup', L.stand);
    const standOn = tinted('standup', '#ffffff');
    tb.standups.forEach(([ax, ay, bx, by], i) => {
      const a = Math.atan2(by - ay, bx - ax);
      const len = Math.hypot(bx - ax, by - ay);
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      g.save();
      if (st.standLit[i] > 0) {
        g.shadowColor = L.stand;
        g.shadowBlur = 20 * s;
      }
      sprite(g, st.standLit[i] > 0 ? standOn : stand, mx, my, len + 4, 14, a);
      g.restore();
      // лампа — со стороны поля (к центру)
      let nx = -(by - ay) / len;
      let ny = (bx - ax) / len;
      if ((284 - mx) * nx + (600 - my) * ny < 0) [nx, ny] = [-nx, -ny];
      this.insert(mx + nx * 24, my + ny * 24, 10, st.stands[i] || (want('stands') && blink && !st.stands[i]), L.stand, tb.standWord[i] ?? '');
    });
    // вертушки: пластина вертится вокруг оси
    tb.spinners.forEach(([ax, ay, bx, by], i) => {
      const a = Math.atan2(by - ay, bx - ax);
      const len = Math.hypot(bx - ax, by - ay);
      const th = Math.max(2.5, Math.abs(Math.cos(st.spins[i].a)) * 22);
      sprite(g, art('spinner'), (ax + bx) / 2, (ay + by) / 2, len - 6, th, a);
      sprite(g, tinted('post', '#c8c8d0'), ax, ay, 10, 10);
      sprite(g, tinted('post', '#c8c8d0'), bx, by, 10, 10);
    });
    // рогатки: резина по лицу, вспышка
    const rub = tinted('rubber', L.rubber);
    const rubLit = tinted('rubber', '#ffffff');
    SLING_TRI.forEach((f, i) => {
      g.save();
      if (st.slingLit[i] > 0) {
        g.shadowColor = '#ffffff';
        g.shadowBlur = 20 * s;
      }
      strip(g, st.slingLit[i] > 0 ? rubLit : rub, f[0], f[1], f[4], f[5], 8, 3);
      g.restore();
    });
    // грибки
    const bump = art(`bumper-${tb.id}` as ArtName);
    tb.bumpers.forEach(([x, y], i) => {
      const lit = st.bumpLit[i] > 0;
      g.save();
      g.globalAlpha = 0.45;
      g.fillStyle = '#000';
      g.beginPath();
      g.arc(x + 5, y + 8, 29, 0, Math.PI * 2);
      g.fill();
      g.restore();
      g.save();
      if (lit) {
        g.shadowColor = L.insert;
        g.shadowBlur = 36 * s;
      }
      sprite(g, bump, x, y, lit ? 64 : 60, lit ? 64 : 60);
      if (lit) {
        g.globalCompositeOperation = 'lighter';
        g.globalAlpha = 0.45;
        sprite(g, bump, x, y, 64, 64);
      }
      g.restore();
    });
    // пружина
    const pl = st.plunger;
    const plg = art('plunger');
    if (plg) {
      const top = 1050 + pl * 40;
      const hh = TH + 40 - top;
      g.drawImage(plg, 564 - 9, top, 18, hh);
    }
    // флипперы: картинка от оси к концу, правый — зеркально
    const fim = art(`flipper-${tb.id}` as ArtName);
    tb.flippers.forEach((f, i) => {
      const a = st.flips[i].a;
      const [tx, ty] = flipperTip(f, a);
      if (!fim) return;
      const len = f.len + 19;
      g.save();
      g.globalAlpha = 0.4;
      g.translate(f.x + 4, f.y + 7);
      g.rotate(a);
      g.drawImage(fim, -13, -13, len + 6, 26);
      g.restore();
      g.save();
      g.translate(f.x, f.y);
      g.rotate(a);
      if (f.side === 'R') g.scale(1, -1);
      g.drawImage(fim, -14, -14, len + 7, 28);
      g.restore();
      void tx;
      void ty;
    });
    // шары на поле
    for (const b of st.balls) if (b.ramp == null) this.ball(b.x, b.y, tb.id === 'kosmos' && tb.magnet && b.held > 0 && Math.hypot(b.x - tb.magnet.x, b.y - tb.magnet.y) < 2 ? 0.55 : 1);
    // рампы поверх
    if (this.rampCv) {
      g.save();
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.globalAlpha = 0.9;
      g.drawImage(this.rampCv, sx, sy);
      g.restore();
    }
    for (const b of st.balls) if (b.ramp != null) this.ball(b.x, b.y, 1.12, true);
    // вспышка
    if (this.flash > 0) {
      g.fillStyle = `rgba(255,255,255,${this.flash * 0.15})`;
      g.fillRect(0, 0, TW, TH);
      this.flash = Math.max(0, this.flash - dt * 2);
    }
    if (st.tilt) {
      g.save();
      g.font = 'bold 120px "PT Sans", Arial, sans-serif';
      g.textAlign = 'center';
      g.fillStyle = blink ? 'rgba(255,40,40,0.85)' : 'rgba(255,40,40,0.4)';
      g.fillText('TILT', 284, 600);
      g.restore();
    }
    this.dmd();
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  private ball(x: number, y: number, k = 1, high = false) {
    const g = this.g;
    const r = BALL_R * k;
    g.fillStyle = 'rgba(0,0,0,0.4)';
    g.beginPath();
    g.arc(x + (high ? 9 : 3), y + (high ? 14 : 5), r, 0, Math.PI * 2);
    g.fill();
    sprite(g, art('ball'), x, y, r * 2.12, r * 2.12);
  }

  private ring(x: number, y: number, r: number, col: string) {
    const g = this.g;
    g.save();
    g.shadowColor = col;
    g.shadowBlur = 18 * this.scale;
    g.strokeStyle = col;
    g.lineWidth = 3;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.stroke();
    g.restore();
  }

  /** Лампа-вставка с подписью: линза модели, тонированная цветом; горит — ярко и со свечением. */
  private insert(x: number, y: number, r: number, on: boolean, col: string, label: string) {
    const g = this.g;
    g.save();
    if (on) {
      g.shadowColor = col;
      g.shadowBlur = 22 * this.scale;
    } else g.globalAlpha = 0.55;
    const lens = tinted('insert', on ? col : shade(col));
    if (lens) sprite(g, lens, x, y, r * 2.3, r * 2.3);
    else {
      g.fillStyle = on ? col : 'rgba(20,16,30,0.75)';
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
    }
    g.shadowBlur = 0;
    g.globalAlpha = 1;
    g.fillStyle = on ? '#1a0a00' : 'rgba(255,255,255,0.75)';
    g.font = `bold ${Math.round(r * 1.1)}px "PT Sans", Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, x, y + 1);
    g.restore();
  }

  /** Лампа-стрелка (повёрнута на a; 0 — вверх). */
  private arrowIns(x: number, y: number, a: number, r: number, on: boolean, col: string) {
    const g = this.g;
    g.save();
    if (on) {
      g.shadowColor = col;
      g.shadowBlur = 18 * this.scale;
    } else g.globalAlpha = 0.5;
    sprite(g, tinted('arrow', on ? col : shade(col)), x, y, r * 2.2, r * 2.2, a);
    g.restore();
  }

  /** Табло: оранжевые точки, как у автоматов 90-х; рамка — хромированная рейка. */
  private dmd() {
    const g = this.g;
    const st = this.st;
    const x0 = 30;
    const y0 = -DMD + 6;
    const w = 520;
    const hh = DMD - 18;
    g.fillStyle = '#0a0604';
    g.beginPath();
    g.roundRect(x0, y0, w, hh, 8);
    g.fill();
    const rail = art('rail');
    if (rail) stripLine(g, rail, [x0, y0, x0 + w, y0, x0 + w, y0 + hh, x0, y0 + hh, x0, y0], 8);
    const big = st.msgT > 0 && st.msg ? st.msg : String(st.score).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    const best = store.get<number>(BEST(this.tb.id), 0);
    const small = st.over ? `ЛУЧШИЙ ${best}  ·  ПУСК — ЗАНОВО` : `ШАР ${st.ball}  ·  ЗАПАС ${Math.max(0, st.left)}  ·  ×${st.mult}${st.msgT > 0 ? '  ·  ' + st.score : ''}`;
    const mis = missionOf(st);
    const third = st.over ? '' : mis ? `ЗАДАНИЕ: ${mis.label}${mis.n > 1 ? `  ${mis.prog}/${mis.n}` : ''}${st.mlevel ? `  ·  КРУГ ${st.mlevel + 1}` : ''}` : '';
    g.save();
    g.beginPath();
    g.roundRect(x0 + 4, y0 + 4, w - 8, hh - 8, 6);
    g.clip();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = '#ff7a1a';
    g.shadowBlur = 10 * this.scale;
    g.fillStyle = '#ff9a2a';
    g.font = 'bold 44px "Courier New", monospace';
    g.fillText(big, x0 + w / 2, y0 + 36);
    g.font = 'bold 17px "Courier New", monospace';
    g.fillStyle = '#ffb860';
    g.fillText(small, x0 + w / 2, y0 + 72);
    g.fillStyle = '#ffd08a';
    g.fillText(third, x0 + w / 2, y0 + 96);
    // сетка точек поверх текста
    g.shadowBlur = 0;
    g.fillStyle = 'rgba(10,6,4,0.55)';
    for (let yy = y0; yy < y0 + hh; yy += 4) g.fillRect(x0, yy, w, 1.4);
    for (let xx = x0; xx < x0 + w; xx += 4) g.fillRect(xx, y0, 1.4, hh);
    g.restore();
  }

  destroy() {
    if (!this.cleanup.length && this.paused) {
      cancelAnimationFrame(this.raf);
      this.el.remove();
      return;
    }
    this.save();
    cancelAnimationFrame(this.raf);
    this.cleanup.forEach((f) => f());
    this.music?.pause();
    this.music = null;
    this.el.remove();
  }
}

/** Погасшая лампа — тот же цвет, темнее. */
function shade(col: string): string {
  const n = parseInt(col.slice(1), 16);
  const f = (v: number) => Math.round(v * 0.35);
  return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`;
}

const mod: ArcadeModule = {
  kind: 'arcade',
  id: 'pinbol',
  title: 'Пинбол',
  about: 'Пинбол на три стола: луна-парк, дискотека и космос. Рампы-горки, вертушки, мишени, карусель, магнит-ловушка, задания стола, джекпот и мультибол.',
  controls: `<p><b>Флипперы:</b> левый — <kbd>Shift</kbd> слева, <kbd>Z</kbd>, <kbd>←</kbd> или <kbd>A</kbd>; правый — <kbd>Shift</kbd> справа, <kbd>/</kbd>, <kbd>→</kbd> или <kbd>D</kbd>.
    На телефоне — левая и правая половина экрана.</p>
    <p><b>Пружина:</b> держите <kbd>Пробел</kbd> или <kbd>↓</kbd> (или палец на экране) и отпустите: чем дольше держали, тем сильнее пуск.
    Мигает буква наверху — попадёте в неё мягким пуском, получите «мастерский пуск».</p>
    <p><b>Толкнуть стол:</b> <kbd>↑</kbd> или <kbd>W</kbd> — третий толчок подряд даёт TILT: флипперы гаснут, шар пропал без бонуса.</p>
    <p><b>Пауза:</b> <kbd>Esc</kbd> — там же «В меню игры».</p>`,
  modes: TABLES.map((t) => ({ id: t.id, label: t.title, hint: t.missions.map((m) => m.label.replace(/ ×\d+| \d+$/, '').toLowerCase()).slice(0, 3).join(', ') })),
  starts: [],
  soloHome: true,
  rules: `<h3>Цель</h3><p>Набрать как можно больше очков тремя шарами. Шар катится по наклонному столу вниз, к стоку между флипперами — отбивайте его флипперами обратно на поле.
    Лучший счёт каждого стола попадает в таблицу рекордов.</p>
    <h3>Пуск и спасение</h3><p>Шар ждёт в жёлобе справа: натяните пружину и отпустите. Мягкий пуск в мигающую букву наверху — «мастерский пуск», 5000 очков.
    Первые секунды после пуска упавший шар возвращается в жёлоб («шар спасён»). Горит зелёная стрелка в левом ауте — <b>отбойник</b>: шар, упавший туда, выбьет обратно на поле.</p>
    <h3>Элементы стола</h3><ul>
    <li><b>Грибки</b> отшвыривают шар с хлопком — 100 очков, <b>рогатки</b> над флипперами бьют его вбок.</li>
    <li><b>Буквы наверху</b> — дорожки: соберите все четыре, и множитель бонуса вырастет (до ×5, на ×5 — призовой шар). Флипперами огни сдвигаются по кругу.</li>
    <li><b>Сбиваемые мишени</b> падают от удара; сбейте все — в лунке загорится <b>джекпот</b> на 25 000.</li>
    <li><b>Мишени-стойки</b> не падают, а загораются; зажгите все три — снова горит отбойник и 7500 очков.</li>
    <li><b>Рампа-горка</b>: шар с разгона въезжает на прозрачную горку и скатывается к флипперу — 3000 очков, две подряд — комбо 10 000. Слабый удар не вытянет подъём, и шар скатится назад.</li>
    <li><b>Вертушка</b>: шар проходит сквозь неё и раскручивает пластину — 100 очков за каждые пол-оборота.</li>
    <li><b>Лунка</b> ловит шар и выплёвывает; каждая третья запускает <b>мультибол</b> — второй шар на поле.</li></ul>
    <h3>Столы</h3><ul>
    <li><b>Луна-парк</b> — американские горки, вертящаяся карусель (закручивает шар вбок), тир-стойки, лунка-касса.</li>
    <li><b>Дискотека</b> — четыре грибка, рампа «Танцпол», зеркальный шар-магнит (тянет шар, ловит и выбрасывает), крутящаяся пластинка.</li>
    <li><b>Космос</b> — орбита по левому краю с вертушкой-спутником, рампа «Ракета», чёрная дыра (магнит-ловушка).</li></ul>
    <h3>Задания</h3><p>У каждого стола — цепочка из пяти заданий (табло пишет текущее и сколько набрано, его цель мигает на столе):
    например, «Горки ×2», «Карусель ×5», «Тир». Задание — 15 000 очков, все пять — <b>суперджекпот</b> 100 000, и круг начинается заново, дороже.</p>
    <h3>Бонус и TILT</h3><p>Когда шар уходит в сток, считается бонус за шар, умноженный на множитель. Стол можно подтолкнуть, но третий толчок подряд — TILT: флипперы гаснут, бонуса нет.</p>`,
  thumb(el) {
    el.classList.add('pb-thumb');
    for (const t of TABLES) {
      const cell = h('<div class="pb-thumb-cell"></div>');
      el.appendChild(cell);
      new Pinball(cell, { mode: t.id, onScore: () => {} }, true);
    }
  },
  mount(root, opts) {
    return new Pinball(root, opts);
  },
};

export default mod;
