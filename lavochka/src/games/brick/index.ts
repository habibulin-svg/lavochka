/* Brick Game — корпус и экран: жёлтый «тетрис 9999 в 1», ЖК-матрица 10×20 с бледными «призраками» точек,
 * табло (счёт, рекорд, «следующая» 4×4 или жизни, скорость, уровень), крестовина, большая кнопка поворота,
 * маленькие «Старт/Пауза», «Звук», «Сброс». Перед игрой: ← → — скорость, ↑ ↓ — уровень, большая кнопка или «Старт» — начать.
 * Клавиатура: стрелки, пробел (поворот/выстрел), Enter или P (старт/пауза), S (звук), R (сброс). */
import { localRecords, type ArcadeModule, type ArcadeOpts } from '../../core/arcade';
import { Sound } from '../../core/audio';
import { settings, store } from '../../core/settings';
import { h } from '../../core/util';
import { GAMES, H, makeGame, W, type BrickSound, type Game, type GameId, type Key } from './logic';
import './brick.css';

const CELL = 18;
const PAD = 8;
const SIDE = 92;
const CW = PAD * 2 + W * CELL + SIDE;
const CH = PAD * 2 + H * CELL;
const ON = '#1c2418';
const GHOST = 'rgba(28,36,24,0.09)';
const LCD = '#9fae8c';

/** Звуки — пищалкой, как у настоящей. */
const BEEPS: Record<BrickSound, [number, number][]> = {
  move: [[1900, 0.015]],
  turn: [[2300, 0.02]],
  drop: [[700, 0.04]],
  line: [
    [1500, 0.05],
    [1900, 0.05],
    [2400, 0.08],
  ],
  eat: [[2600, 0.03]],
  hit: [[1300, 0.03]],
  crash: [
    [400, 0.12],
    [250, 0.2],
  ],
  shot: [[3000, 0.015]],
  level: [
    [1200, 0.06],
    [1800, 0.06],
    [2400, 0.06],
    [3000, 0.1],
  ],
};

type Phase = 'select' | 'play' | 'pause' | 'over';

/** Семисегментная цифра на холсте. */
function digit(g: CanvasRenderingContext2D, x: number, y: number, s: number, d: string, lit: string, ghost: string) {
  const SEG: Record<string, string> = { '0': 'abcdef', '1': 'bc', '2': 'abged', '3': 'abgcd', '4': 'fgbc', '5': 'afgcd', '6': 'afgedc', '7': 'abc', '8': 'abcdefg', '9': 'abcdfg', ' ': '' };
  const on = SEG[d] ?? '';
  const t = Math.max(1.5, s * 0.16);
  const w = s * 0.6;
  const rects: Record<string, [number, number, number, number]> = {
    a: [x + t, y, w - 2 * t, t],
    b: [x + w - t, y + t, t, s / 2 - t],
    c: [x + w - t, y + s / 2, t, s / 2 - t],
    d: [x + t, y + s - t, w - 2 * t, t],
    e: [x, y + s / 2, t, s / 2 - t],
    f: [x, y + t, t, s / 2 - t],
    g: [x + t, y + s / 2 - t / 2, w - 2 * t, t],
  };
  for (const [k, r] of Object.entries(rects)) {
    g.fillStyle = on.includes(k) ? lit : ghost;
    g.fillRect(r[0], r[1], r[2], r[3]);
  }
}

function number(g: CanvasRenderingContext2D, x: number, y: number, s: number, n: number, len: number) {
  const str = String(Math.max(0, Math.floor(n))).slice(-len).padStart(len, ' ');
  for (let i = 0; i < len; i++) digit(g, x + i * s * 0.75, y, s, str[i], ON, GHOST);
}

/** Точка матрицы: рамка и квадрат внутри — как на настоящем экране. */
function dot(g: CanvasRenderingContext2D, x: number, y: number, size: number, lit: boolean) {
  g.strokeStyle = lit ? ON : GHOST;
  g.fillStyle = lit ? ON : GHOST;
  g.lineWidth = Math.max(1, size * 0.1);
  const p = size * 0.08;
  g.strokeRect(x + p, y + p, size - 2 * p, size - 2 * p);
  const q = size * 0.28;
  g.fillRect(x + q, y + q, size - 2 * q, size - 2 * q);
}

class BrickDevice {
  private el: HTMLElement;
  private cv: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private game: Game | null = null;
  private phase: Phase = 'select';
  private speed = store.get<number>('brick.speed', 1);
  private level = store.get<number>('brick.level', 1);
  private sound = store.get<boolean>('brick.sound', true);
  private m = new Uint8Array(W * H);
  private next = new Uint8Array(16);
  private raf = 0;
  private last = 0;
  private t = 0;
  private overT = 0;
  private held = new Map<Key, ReturnType<typeof setTimeout>>();
  private keyOf: Record<string, Key | 'start' | 'sound' | 'reset'> = {
    ArrowLeft: 'left',
    ArrowRight: 'right',
    ArrowUp: 'up',
    ArrowDown: 'down',
    ' ': 'rotate',
    x: 'rotate',
    Enter: 'start',
    p: 'start',
    s: 'sound',
    r: 'reset',
  };
  private onKey = (e: KeyboardEvent) => this.key(e, true);
  private onKeyUp = (e: KeyboardEvent) => this.key(e, false);

  constructor(
    root: HTMLElement,
    private gameId: GameId,
    private opts: ArcadeOpts
  ) {
    const info = GAMES.find((x) => x.id === gameId)!;
    this.el = h(`<div class="bk-dev">
      <div class="bk-head"><span class="bk-logo">BRICK GAME</span><span class="bk-sub">${info.letter} · ${info.label}</span></div>
      <div class="bk-glass"><canvas width="${CW * 2}" height="${CH * 2}"></canvas></div>
      <div class="bk-brand">9999 in 1</div>
      <div class="bk-smalls">
        <button data-b="start"><i></i><span>старт/пауза</span></button>
        <button data-b="sound"><i></i><span>звук</span></button>
        <button data-b="reset"><i></i><span>сброс</span></button>
      </div>
      <div class="bk-controls">
        <div class="bk-pad">
          <button data-b="up" class="u">▲</button><button data-b="left" class="l">◀</button><button data-b="right" class="r">▶</button><button data-b="down" class="d">▼</button>
        </div>
        <button data-b="rotate" class="bk-rot"><span>поворот</span></button>
      </div>
    </div>`);
    root.appendChild(this.el);
    this.cv = this.el.querySelector('canvas') as HTMLCanvasElement;
    this.g = this.cv.getContext('2d')!;
    this.g.scale(2, 2);
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('[data-b]')) {
      const k = b.dataset.b as Key | 'start' | 'sound' | 'reset';
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        b.setPointerCapture?.(e.pointerId);
        Sound.unlock();
        this.down(k);
      });
      const up = () => this.up(k);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointercancel', up);
      b.addEventListener('lostpointercapture', up);
      b.addEventListener('contextmenu', (e) => e.preventDefault());
    }
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private key(e: KeyboardEvent, down: boolean) {
    const k = this.keyOf[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    if (!k || (e.target as HTMLElement)?.tagName === 'INPUT') return;
    e.preventDefault();
    if (down && e.repeat) return;
    if (down) this.down(k);
    else this.up(k);
  }

  private down(k: Key | 'start' | 'sound' | 'reset') {
    if (k === 'sound') {
      this.sound = !this.sound;
      store.set('brick.sound', this.sound);
      if (this.sound) this.beep('turn');
      return;
    }
    if (k === 'reset') {
      this.game = null;
      this.phase = 'select';
      return;
    }
    if (k === 'start') {
      if (this.phase === 'select') this.begin();
      else if (this.phase === 'play') this.phase = 'pause';
      else if (this.phase === 'pause') this.phase = 'play';
      return;
    }
    if (this.phase === 'select') {
      if (k === 'left') this.speed = Math.max(1, this.speed - 1);
      else if (k === 'right') this.speed = Math.min(10, this.speed + 1);
      else if (k === 'down') this.level = Math.max(1, this.level - 1);
      else if (k === 'up') this.level = Math.min(10, this.level + 1);
      else if (k === 'rotate') return this.begin();
      store.set('brick.speed', this.speed);
      store.set('brick.level', this.level);
      this.beep('move');
      return;
    }
    if (this.phase !== 'play' || !this.game) return;
    this.game.press(k);
    // автоповтор: влево-вправо (и вниз в змейке/арканоиде)
    if (k === 'left' || k === 'right' || (k === 'down' && this.gameId !== 'tetris') || (k === 'up' && this.gameId === 'tanks')) {
      const rep = (delay: number) => {
        this.held.set(
          k,
          setTimeout(() => {
            if (this.phase === 'play') this.game?.press(k);
            rep(this.gameId === 'tetris' ? 55 : 90);
          }, delay)
        );
      };
      clearTimeout(this.held.get(k));
      rep(170);
    }
  }

  private up(k: Key | 'start' | 'sound' | 'reset') {
    if (k === 'start' || k === 'sound' || k === 'reset') return;
    clearTimeout(this.held.get(k));
    this.held.delete(k);
    this.game?.release(k);
  }

  private begin() {
    this.game = makeGame(this.gameId, this.speed, this.level, (Math.random() * 2 ** 31) | 0);
    this.phase = 'play';
    this.beep('level');
  }

  private beep(s: BrickSound) {
    if (!this.sound || !settings.sound) return;
    let at = 0;
    for (const [f, d] of BEEPS[s]) {
      setTimeout(() => Sound.beep(f, d, 0.08), at * 1000);
      at += d + 0.01;
    }
  }

  private frame(t: number) {
    const dt = Math.min(50, t - this.last);
    this.last = t;
    this.t += dt;
    const g = this.game;
    if (g && this.phase === 'play') {
      g.update(dt);
      // одна пищалка за кадр — самая важная
      if (g.sounds.length) {
        const order: BrickSound[] = ['crash', 'level', 'line', 'eat', 'hit', 'drop', 'shot', 'turn', 'move'];
        this.beep(order.find((s) => g.sounds.includes(s))!);
        g.sounds.length = 0;
      }
      if (g.over) {
        this.phase = 'over';
        this.overT = 0;
        for (const tm of this.held.values()) clearTimeout(tm);
        this.held.clear();
        this.opts.onScore(g.score);
      }
    }
    if (this.phase === 'over') {
      this.overT += dt;
      if (this.overT > 2600) {
        this.phase = 'select';
        this.game = null;
      }
    }
    this.draw();
    this.raf = requestAnimationFrame((tt) => this.frame(tt));
  }

  private draw() {
    const c = this.g;
    c.fillStyle = LCD;
    c.fillRect(0, 0, CW, CH);
    const m = this.m;
    const nx = this.next;
    m.fill(0);
    nx.fill(0);
    if (this.game && this.phase !== 'select') this.game.draw(m, nx);
    if (this.phase === 'select') this.splash(m);
    if (this.phase === 'over') {
      // «шторка»: снизу вверх заливается, потом сверху вниз гаснет
      const k = Math.min(H * 2, Math.floor(this.overT / 55));
      for (let y = 0; y < H; y++) {
        const row = H - 1 - y;
        if (k < H ? y < k : y >= k - H) for (let x = 0; x < W; x++) m[row * W + x] = 1;
        else if (k >= H) for (let x = 0; x < W; x++) m[row * W + x] = 0;
      }
    }
    // рамка матрицы
    c.strokeStyle = ON;
    c.lineWidth = 1.5;
    c.strokeRect(PAD - 3, PAD - 3, W * CELL + 6, H * CELL + 6);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) dot(c, PAD + x * CELL, PAD + y * CELL, CELL, !!m[y * W + x]);
    // табло
    const sx = PAD * 2 + W * CELL + 4;
    c.fillStyle = ON;
    c.font = 'bold 9px Arial';
    const label = (txt: string, y: number, x = sx) => {
      c.fillStyle = ON;
      c.fillText(txt, x, y);
    };
    const hi = Math.max(localRecords('brick', this.gameId)[0]?.score ?? 0, this.game?.score ?? 0);
    label('СЧЁТ', PAD + 10);
    number(c, sx, PAD + 14, 16, this.game?.score ?? 0, 6);
    label('РЕКОРД', PAD + 52);
    number(c, sx, PAD + 56, 16, hi, 6);
    label(this.game?.lives != null ? 'ЖИЗНИ' : 'ДАЛЕЕ', PAD + 96);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) dot(c, sx + x * 14, PAD + 100 + y * 14, 14, !!nx[y * 4 + x]);
    label('СКОРОСТЬ', PAD + 178);
    number(c, sx, PAD + 182, 20, this.game?.speed ?? this.speed, 2);
    label('УРОВЕНЬ', PAD + 224);
    number(c, sx, PAD + 228, 20, this.game?.level ?? this.level, 2);
    c.globalAlpha = this.phase === 'pause' && Math.floor(this.t / 400) % 2 === 0 ? 1 : 0.1;
    label('ПАУЗА', PAD + 290);
    c.globalAlpha = this.sound ? 1 : 0.1;
    label('♪ ЗВУК', PAD + 306);
    c.globalAlpha = 1;
    if (this.phase === 'select') {
      label('← → скорость', PAD + 330, sx - 2);
      label('↑ ↓ уровень', PAD + 343, sx - 2);
      label('СТАРТ — играть', PAD + 356, sx - 2);
    }
  }

  /** Заставка перед игрой: буква игры и бегущая змейка по краю. */
  private splash(m: Uint8Array) {
    const info = GAMES.find((x) => x.id === this.gameId)!;
    const FONT: Record<string, string[]> = {
      A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
      B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
      C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
      D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
      E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
      F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
    };
    const f = FONT[info.letter];
    f.forEach((row, y) => [...row].forEach((ch, x) => ch === '#' && (m[(5 + y) * W + 2 + x] = 1)));
    // бегущая точка по периметру
    const per: number[] = [];
    for (let x = 0; x < W; x++) per.push(x);
    for (let y = 1; y < H; y++) per.push(y * W + W - 1);
    for (let x = W - 2; x >= 0; x--) per.push((H - 1) * W + x);
    for (let y = H - 2; y > 0; y--) per.push(y * W);
    const p = Math.floor(this.t / 60) % per.length;
    for (let i = 0; i < 6; i++) m[per[(p + per.length - i) % per.length]] = 1;
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    for (const tm of this.held.values()) clearTimeout(tm);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
    this.el.remove();
  }
}

const mod: ArcadeModule = {
  kind: 'arcade',
  id: 'brick',
  title: 'Brick Game',
  about: 'Тот самый «тетрис 9999 в 1»: тетрис, змейка, гонки, арканоид, стрелялка и танки на ЖК-матрице 10×20.',
  controls: `<p>Стрелки — двигать, <kbd>Пробел</kbd> — поворот (в гонках — газ, в арканоиде — подача, в стрелялке и танках — огонь).</p>
    <p>Перед игрой: <kbd>←</kbd> <kbd>→</kbd> — скорость, <kbd>↑</kbd> <kbd>↓</kbd> — уровень, <kbd>Enter</kbd> — старт.</p>
    <p><kbd>P</kbd> — пауза, <kbd>S</kbd> — звук, <kbd>R</kbd> — сброс. На телефоне — кнопки на корпусе.</p>`,
  modes: GAMES.map((g) => ({ id: g.id, label: `${g.letter} · ${g.label}`, hint: g.hint })),
  mount(root, opts) {
    return new BrickDevice(root, (GAMES.some((g) => g.id === opts.mode) ? opts.mode : 'tetris') as GameId, opts);
  },
};

export default mod;
