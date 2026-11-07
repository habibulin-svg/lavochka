/* Пинбол — экран аркады: стол на canvas (рисованная подложка + борта, грибки, огни поверх), табло с точечными цифрами,
 * флипперы с клавиатуры и касанием, пружина, подтолкнуть стол, звуки, музыка стола (выключатель запоминается),
 * сохранение партии: пауза, уход со страницы — партия сохраняется и продолжается при следующем входе. */
import type { ArcadeModule, ArcadeOpts } from '../../core/arcade';
import { audioOut, click, Sound, tone } from '../../core/audio';
import { store } from '../../core/settings';
import { h } from '../../core/util';
import { BALL_R, flipperTip, laneShift, newGame, step, tableOf, TABLES, TH, TW, type PbEvent, type PbInput, type PbState, type TableDef } from './logic';
import './pinbol.css';

const DMD = 120;
const PREF_MUSIC = 'pinbol.music';
const SAVE = (t: string) => `pinbol.save.${t}`;
const BEST = (t: string) => `pinbol.best.${t}`;

interface Look {
  rail: [string, string];
  bumper: [string, string, string];
  insert: string;
  sling: string;
  rubber: string;
  flipper: [string, string];
  frame: [string, string];
  bg: [string, string];
}

const LOOKS: Record<string, Look> = {
  park: { rail: ['#fff4d0', '#c9a24a'], bumper: ['#ff4a3a', '#ffd23a', '#ffffff'], insert: '#ffd23a', sling: '#ffffff', rubber: '#e8322a', flipper: ['#ffffff', '#e8322a'], frame: ['#7a1f10', '#3a0c06'], bg: ['#ff9a4a', '#5a1a5a'] },
  disco: { rail: ['#f0e8ff', '#ff3df2'], bumper: ['#2ef9ff', '#ff3df2', '#ffffff'], insert: '#ff3df2', sling: '#2ef9ff', rubber: '#ff3df2', flipper: ['#ffffff', '#2ef9ff'], frame: ['#2a0a4a', '#0c0418'], bg: ['#4a1a8a', '#0c0418'] },
  kosmos: { rail: ['#e8f4ff', '#7a9ab8'], bumper: ['#ff8a2a', '#e8eef8', '#ffffff'], insert: '#7af0ff', sling: '#e8eef8', rubber: '#ff8a2a', flipper: ['#ffffff', '#ff8a2a'], frame: ['#0a1a4a', '#03081e'], bg: ['#123a8a', '#05081e'] },
};

const img = (src: string) => {
  const i = new Image();
  i.src = src;
  return i;
};
const ART: Record<string, HTMLImageElement> = {};
const art = (id: string) => (ART[id] ??= img(`/pinbol/${id}.webp`));

class Pinball {
  private el: HTMLElement;
  private cv: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private stat: HTMLCanvasElement | null = null;
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
    const saved = demo ? null : store.get<PbState | null>(SAVE(this.tb.id), null);
    if (saved && saved.table === this.tb.id && !saved.over && Array.isArray(saved.balls)) {
      this.st = saved;
      this.resumed = true;
    } else this.st = newGame(this.tb.id);
    this.el = h(`<div class="pb-wrap"><canvas class="pb-cv"></canvas></div>`);
    root.appendChild(this.el);
    this.cv = this.el.querySelector('canvas') as HTMLCanvasElement;
    this.g = this.cv.getContext('2d')!;
    art(this.tb.id).onload = () => (this.statKey = '');
    if (demo) {
      this.paused = true;
      this.st.score = [48250, 126700, 73400][TABLES.indexOf(this.tb)] ?? 0;
      this.st.lanes = this.st.lanes.map((_, i) => i % 2 === 0);
      this.st.mult = 3;
      this.st.balls = [{ x: 330, y: 470, vx: 0, vy: 0, held: 0 }, { x: 236, y: 880, vx: 0, vy: 0, held: 0 }];
      this.st.bumpLit[1] = 0.2;
      this.st.flips[0].a = tableOf(this.tb.id).flippers[0].up;
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
    this.render(dt);
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

  private drawStatic() {
    const key = `${this.cv.width}x${this.cv.height}:${this.tb.id}:${art(this.tb.id).complete}`;
    if (key === this.statKey && this.stat) return;
    this.statKey = key;
    const c = (this.stat ??= document.createElement('canvas'));
    c.width = this.cv.width;
    c.height = this.cv.height;
    const g = c.getContext('2d')!;
    const L = this.look;
    const s = this.scale;
    // фон за столом — корпус автомата
    const bg = g.createLinearGradient(0, 0, c.width, c.height);
    bg.addColorStop(0, L.frame[0]);
    bg.addColorStop(1, L.frame[1]);
    g.fillStyle = bg;
    g.fillRect(0, 0, c.width, c.height);
    g.setTransform(s, 0, 0, s, this.ox, this.oy);
    // рама вокруг поля
    g.save();
    g.lineWidth = 26;
    g.strokeStyle = L.rail[1];
    g.shadowColor = 'rgba(0,0,0,0.6)';
    g.shadowBlur = 30 * s;
    this.fieldPath(g);
    g.stroke();
    g.restore();
    // поле: подложка-картинка или градиент
    g.save();
    this.fieldPath(g);
    g.clip();
    const fg = g.createLinearGradient(0, 0, 0, TH);
    fg.addColorStop(0, L.bg[0]);
    fg.addColorStop(1, L.bg[1]);
    g.fillStyle = fg;
    g.fillRect(0, 0, TW, TH + 60);
    const im = art(this.tb.id);
    if (im.complete && im.naturalWidth) {
      const k = Math.max(TW / im.naturalWidth, (TH + 60) / im.naturalHeight);
      const iw = im.naturalWidth * k;
      const ih = im.naturalHeight * k;
      g.drawImage(im, (TW - iw) / 2, (TH + 60 - ih) / 2, iw, ih);
      // рисунок приглушаем — шар и огни должны читаться поверх
      g.fillStyle = 'rgba(10,6,24,0.3)';
      g.fillRect(0, 0, TW, TH + 60);
    }
    // затемнение по краям и низ — элементы читаются поверх рисунка
    const vg = g.createRadialGradient(284, 520, 120, 284, 560, 720);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = vg;
    g.fillRect(0, 0, TW, TH + 60);
    // жёлоб пружины
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(548, 300, 32, TH);
    // зона флипперов потемнее
    const dg = g.createLinearGradient(0, 860, 0, TH);
    dg.addColorStop(0, 'rgba(0,0,0,0)');
    dg.addColorStop(1, 'rgba(0,0,0,0.55)');
    g.fillStyle = dg;
    g.fillRect(0, 860, TW, TH);
    g.restore();
    // борта и направляющие: металлические рейки
    g.lineCap = 'round';
    g.lineJoin = 'round';
    for (const pl of this.tb.walls) {
      g.beginPath();
      g.moveTo(pl[0], pl[1]);
      for (let i = 2; i < pl.length; i += 2) g.lineTo(pl[i], pl[i + 1]);
      g.strokeStyle = 'rgba(0,0,0,0.5)';
      g.lineWidth = 11;
      g.stroke();
      g.strokeStyle = L.rail[1];
      g.lineWidth = 8;
      g.stroke();
      g.strokeStyle = L.rail[0];
      g.lineWidth = 2.5;
      g.stroke();
    }
    // рогатки: белый пластик, резинка по лицу
    const slings: number[][] = [
      [108, 800, 108, 900, 168, 935],
      [460, 800, 460, 900, 400, 935],
    ];
    for (const sl of slings) {
      g.beginPath();
      g.moveTo(sl[0], sl[1]);
      g.lineTo(sl[2], sl[3]);
      g.lineTo(sl[4], sl[5]);
      g.closePath();
      g.fillStyle = L.sling;
      g.globalAlpha = 0.85;
      g.fill();
      g.globalAlpha = 1;
    }
    // столбики
    for (const [x, y, r] of this.tb.posts) {
      g.beginPath();
      g.arc(x, y, r + 2, 0, Math.PI * 2);
      g.fillStyle = L.rubber;
      g.fill();
      g.beginPath();
      g.arc(x, y, r * 0.55, 0, Math.PI * 2);
      g.fillStyle = '#f4f4f4';
      g.fill();
    }
    // лунка
    const sc = this.tb.saucer;
    const sg = g.createRadialGradient(sc.x, sc.y, 2, sc.x, sc.y, 18);
    sg.addColorStop(0, '#000');
    sg.addColorStop(0.7, '#111');
    sg.addColorStop(1, L.rail[1]);
    g.fillStyle = sg;
    g.beginPath();
    g.arc(sc.x, sc.y, 18, 0, Math.PI * 2);
    g.fill();
    g.setTransform(1, 0, 0, 1, 0, 0);
  }

  private render(dt: number) {
    this.layout();
    this.drawStatic();
    const g = this.g;
    const st = this.st;
    const L = this.look;
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
    const glowOn = (col: string, b = 14) => {
      g.shadowColor = col;
      g.shadowBlur = b * s;
    };
    // огни дорожек: буквы
    this.tb.lanes.forEach(([x, y], i) => {
      const on = st.lanes[i];
      const skill = st.save > 6 && st.skill === i && st.inLane === false && st.balls.length === 1;
      const lit = on || (skill && blink) || (st.inLane && st.skill === i && blink);
      this.insert(x, y + 34, 15, lit, L.insert, this.tb.word[i] ?? '');
    });
    // множитель бонуса
    [2, 3, 4, 5].forEach((m, i) => this.insert(214 + i * 46, 760, 14, st.mult >= m, '#ffd23a', `×${m}`));
    // спасение шара
    this.insert(284, 1062, 12, st.save > 0 && (st.save > 2 || blink), '#3aff8a', '◆');
    // джекпот у лунки
    const sc = this.tb.saucer;
    if (st.jackpot) {
      g.save();
      glowOn('#ffd23a', 24);
      g.strokeStyle = blink ? '#ffd23a' : '#ff8a2a';
      g.lineWidth = 4;
      g.beginPath();
      g.arc(sc.x, sc.y, 24, 0, Math.PI * 2);
      g.stroke();
      g.restore();
    }
    this.insert(sc.x, sc.y + 40, 11, st.saucerCount % 3 === 2, '#ff3d6a', 'М');
    // орбита: стрелки
    if (this.tb.orbit) {
      const [ox, oy] = this.tb.orbit;
      for (let k = 0; k < 3; k++) this.arrow(ox, oy + 90 - k * 36, (Math.floor(st.t * 6) + k) % 3 === 0 ? L.insert : 'rgba(255,255,255,0.18)');
    }
    // сбиваемые мишени
    this.tb.targets.forEach(([ax, ay, bx, by], i) => {
      const up = st.targets[i];
      g.save();
      g.lineCap = 'butt';
      if (up) glowOn(L.insert, 8);
      g.strokeStyle = up ? L.insert : 'rgba(0,0,0,0.6)';
      g.lineWidth = up ? 9 : 4;
      g.beginPath();
      g.moveTo(ax, ay);
      g.lineTo(bx, by);
      g.stroke();
      if (up) {
        g.shadowBlur = 0;
        g.strokeStyle = 'rgba(255,255,255,0.75)';
        g.lineWidth = 2;
        g.stroke();
      }
      g.restore();
    });
    // рогатки: вспышка резинки
    const faces: number[][] = [
      [108, 800, 168, 935],
      [460, 800, 400, 935],
    ];
    faces.forEach((f, i) => {
      g.save();
      if (st.slingLit[i] > 0) glowOn('#ffffff', 20);
      g.strokeStyle = st.slingLit[i] > 0 ? '#ffffff' : L.rubber;
      g.lineWidth = 6;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(f[0], f[1]);
      g.lineTo(f[2], f[3]);
      g.stroke();
      g.restore();
    });
    // грибки
    this.tb.bumpers.forEach(([x, y], i) => {
      const lit = st.bumpLit[i] > 0;
      g.save();
      g.fillStyle = 'rgba(0,0,0,0.4)';
      g.beginPath();
      g.arc(x + 4, y + 6, 30, 0, Math.PI * 2);
      g.fill();
      if (lit) glowOn(L.bumper[1], 30);
      g.fillStyle = L.rubber;
      g.beginPath();
      g.arc(x, y, 28, 0, Math.PI * 2);
      g.fill();
      g.shadowBlur = 0;
      const cg = g.createRadialGradient(x - 7, y - 8, 3, x, y, 24);
      cg.addColorStop(0, '#ffffff');
      cg.addColorStop(0.35, lit ? '#ffffff' : L.bumper[1]);
      cg.addColorStop(1, L.bumper[0]);
      g.fillStyle = cg;
      g.beginPath();
      g.arc(x, y, 23, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = lit ? L.bumper[1] : 'rgba(255,255,255,0.85)';
      g.beginPath();
      g.arc(x, y, 9, 0, Math.PI * 2);
      g.fill();
      g.restore();
    });
    // пружина
    const pl = st.plunger;
    g.fillStyle = '#c8c8d0';
    g.fillRect(556, 1052 + pl * 40, 16, 6);
    g.strokeStyle = '#8a8a98';
    g.lineWidth = 2;
    g.beginPath();
    for (let k = 0; k <= 8; k++) g.lineTo(k % 2 ? 558 : 570, 1058 + pl * 40 + (k * (40 - pl * 30)) / 8);
    g.stroke();
    // флипперы
    this.tb.flippers.forEach((f, i) => {
      const a = st.flips[i].a;
      const [tx, ty] = flipperTip(f, a);
      g.save();
      g.fillStyle = 'rgba(0,0,0,0.4)';
      this.capsule(f.x + 4, f.y + 6, tx + 4, ty + 6, 12, 7);
      g.fill();
      g.fillStyle = L.flipper[1];
      this.capsule(f.x, f.y, tx, ty, 12, 7);
      g.fill();
      const fg = g.createLinearGradient(f.x, f.y - 10, f.x, f.y + 10);
      fg.addColorStop(0, '#ffffff');
      fg.addColorStop(1, L.flipper[0]);
      g.fillStyle = fg;
      this.capsule(f.x, f.y, tx, ty, 9, 4.5);
      g.fill();
      g.fillStyle = '#9aa0aa';
      g.beginPath();
      g.arc(f.x, f.y, 3.5, 0, Math.PI * 2);
      g.fill();
      g.restore();
    });
    // шары: хром
    for (const b of st.balls) {
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath();
      g.arc(b.x + 3, b.y + 5, BALL_R, 0, Math.PI * 2);
      g.fill();
      const bg = g.createRadialGradient(b.x - 4, b.y - 5, 1, b.x, b.y, BALL_R);
      bg.addColorStop(0, '#ffffff');
      bg.addColorStop(0.35, '#d8dce4');
      bg.addColorStop(0.75, '#7a808c');
      bg.addColorStop(1, '#3a3e48');
      g.fillStyle = bg;
      g.beginPath();
      g.arc(b.x, b.y, BALL_R, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(0,0,0,0.7)';
      g.lineWidth = 1.5;
      g.stroke();
    }
    // вспышка от грибков
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

  /** Лампа-вставка с подписью. */
  private insert(x: number, y: number, r: number, on: boolean, col: string, label: string) {
    const g = this.g;
    g.save();
    if (on) {
      g.shadowColor = col;
      g.shadowBlur = 18 * this.scale;
    }
    g.fillStyle = on ? col : 'rgba(20,16,30,0.75)';
    g.strokeStyle = on ? '#ffffff' : col;
    g.lineWidth = 2;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
    g.shadowBlur = 0;
    g.globalAlpha = on ? 1 : 0.6;
    g.stroke();
    g.fillStyle = on ? '#1a0a00' : col;
    g.font = `bold ${Math.round(r * 1.1)}px "PT Sans", Arial, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(label, x, y + 1);
    g.restore();
  }

  private arrow(x: number, y: number, col: string) {
    const g = this.g;
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(x, y - 14);
    g.lineTo(x + 12, y + 6);
    g.lineTo(x - 12, y + 6);
    g.closePath();
    g.fill();
  }

  private capsule(ax: number, ay: number, bx: number, by: number, r0: number, r1: number) {
    const g = this.g;
    const a = Math.atan2(by - ay, bx - ax);
    g.beginPath();
    g.arc(ax, ay, r0, a + Math.PI / 2, a - Math.PI / 2);
    g.arc(bx, by, r1, a - Math.PI / 2, a + Math.PI / 2);
    g.closePath();
  }

  /** Табло: оранжевые точки, как у автоматов 90-х. */
  private dmd() {
    const g = this.g;
    const st = this.st;
    const x0 = 30;
    const y0 = -DMD + 8;
    const w = 520;
    const hh = DMD - 22;
    g.fillStyle = '#0a0604';
    g.strokeStyle = '#3a2a18';
    g.lineWidth = 4;
    g.beginPath();
    g.roundRect(x0, y0, w, hh, 10);
    g.fill();
    g.stroke();
    const big = st.msgT > 0 && st.msg ? st.msg : String(st.score).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
    const best = store.get<number>(BEST(this.tb.id), 0);
    const small = st.over ? `ЛУЧШИЙ ${best}  ·  ПУСК — ЗАНОВО` : `ШАР ${st.ball}  ·  ЗАПАС ${Math.max(0, st.left)}  ·  ×${st.mult}${st.msgT > 0 ? '  ·  ' + st.score : ''}`;
    g.save();
    g.beginPath();
    g.roundRect(x0, y0, w, hh, 10);
    g.clip();
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.shadowColor = '#ff7a1a';
    g.shadowBlur = 10 * this.scale;
    g.fillStyle = '#ff9a2a';
    g.font = 'bold 46px "Courier New", monospace';
    g.fillText(big, x0 + w / 2, y0 + 36);
    g.font = 'bold 18px "Courier New", monospace';
    g.fillStyle = '#ffb860';
    g.fillText(small, x0 + w / 2, y0 + 76);
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

const mod: ArcadeModule = {
  kind: 'arcade',
  id: 'pinbol',
  title: 'Пинбол',
  about: 'Пинбол на три стола: луна-парк, дискотека и космос. Грибки, рогатки, мишени, лунка с джекпотом и мультибол.',
  controls: `<p><b>Флипперы:</b> левый — <kbd>Shift</kbd> слева, <kbd>Z</kbd>, <kbd>←</kbd> или <kbd>A</kbd>; правый — <kbd>Shift</kbd> справа, <kbd>/</kbd>, <kbd>→</kbd> или <kbd>D</kbd>.
    На телефоне — левая и правая половина экрана.</p>
    <p><b>Пружина:</b> держите <kbd>Пробел</kbd> или <kbd>↓</kbd> (или палец на экране) и отпустите: чем дольше держали, тем сильнее пуск.
    Мигает буква наверху — попадёте в неё мягким пуском, получите «мастерский пуск».</p>
    <p><b>Толкнуть стол:</b> <kbd>↑</kbd> или <kbd>W</kbd> — третий толчок подряд даёт TILT: флипперы гаснут, шар пропал без бонуса.</p>
    <p><b>Очки:</b> все четыре буквы наверху — множитель бонуса (флипперами огни сдвигаются по кругу); все мишени — горит джекпот в лунке;
    каждая третья лунка — мультибол. Бонус за шар умножается на множитель. Первые секунды после пуска шар спасают.</p>`,
  modes: TABLES.map((t) => ({ id: t.id, label: t.title, hint: t.word })),
  starts: [],
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
