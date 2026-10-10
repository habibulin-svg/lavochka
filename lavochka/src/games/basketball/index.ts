/* Настольный баскетбол — коробка сбоку: стенка-спортзал, пол с горбом и ямками, щиты, кольца с сеткой, катапульты с рычагами,
 * шкала силы у каждой, табло. Мяч в своей катапульте — держите кнопку (сила растёт), отпустите — бросок.
 * Красные: пробел или Z; синие (вдвоём): Enter или M. На телефоне — большие кнопки под полем. */
import type { ArcadeModule, ArcadeOpts } from '../../core/arcade';
import { Sound } from '../../core/audio';
import { h } from '../../core/util';
import { Basket, BALL_R, BOARD, CATS, floor, HGT, RIM, W, type BMode } from './logic';
import './basketball.css';

const S = 900;
const PAD = 30;
const TOP = 70;
const CW = W * S + PAD * 2;
const CH = HGT * S + TOP + PAD;
const TEAM = [
  { body: '#c8241c', name: 'красные' },
  { body: '#2050b0', name: 'синие' },
];

class Court {
  private el: HTMLElement;
  private cv: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private game: Basket;
  private raf = 0;
  private last = 0;
  private flash = 0;
  private reported = false;
  private onKey = (e: KeyboardEvent) => this.key(e, true);
  private onKeyUp = (e: KeyboardEvent) => this.key(e, false);

  constructor(
    root: HTMLElement,
    private mode: BMode,
    private opts: ArcadeOpts
  ) {
    const duel = mode === 'duel';
    this.el = h(`<div class="bb-dev"><canvas width="${CW * 2}" height="${CH * 2}"></canvas>
      <div class="bb-btns"><button data-team="0" style="--c:${TEAM[0].body}">Бросок</button>${duel ? `<button data-team="1" style="--c:${TEAM[1].body}">Бросок</button>` : ''}</div></div>`);
    root.appendChild(this.el);
    this.cv = this.el.querySelector('canvas') as HTMLCanvasElement;
    this.g = this.cv.getContext('2d')!;
    this.g.scale(2, 2);
    this.game = new Basket(mode, 21, 3, (Math.random() * 1e9) | 0);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    this.cv.addEventListener('pointerdown', () => this.game.over && this.restart());
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('[data-team]')) {
      const t = +b.dataset.team! as 0 | 1;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        Sound.unlock();
        if (this.game.over) return this.restart();
        this.game.press(t, true);
      });
      const up = () => this.game.press(t, false);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointerleave', up);
    }
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private key(e: KeyboardEvent, down: boolean) {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const duel = this.mode === 'duel';
    let team: 0 | 1 | null = null;
    if (k === ' ' || k === 'z' || k === 'я' || (!duel && k === 'Enter')) team = 0;
    else if (duel && (k === 'Enter' || k === 'm' || k === 'ь')) team = 1;
    if (team == null || (e.target as HTMLElement)?.tagName === 'INPUT') return;
    e.preventDefault();
    if (e.repeat) return;
    Sound.unlock();
    if (down && this.game.over) return this.restart();
    this.game.press(team, down);
  }

  private restart() {
    this.game = new Basket(this.mode, 21, 3, (Math.random() * 1e9) | 0);
    this.reported = false;
  }

  private frame(t: number) {
    const dt = Math.min(50, t - this.last);
    this.last = t;
    const g = this.game;
    g.update(dt);
    for (const s of g.sounds) {
      if (s === 'shot') Sound.beep(500, 0.05, 0.12);
      else if (s === 'rim') Sound.beep(1800, 0.05, 0.08);
      else if (s === 'board') Sound.beep(400, 0.04, 0.1);
      else if (s === 'bounce') Sound.beep(180, 0.04, 0.12);
      else if (s === 'whistle') Sound.beep(3000, 0.18, 0.05);
      else if (s === 'score') {
        Sound.win();
        this.flash = 1;
      }
    }
    g.sounds.length = 0;
    this.flash = Math.max(0, this.flash - dt / 1000);
    if (g.over && !this.reported) {
      this.reported = true;
      if (this.mode !== 'duel') this.opts.onScore(g.result());
    }
    this.draw();
    this.raf = requestAnimationFrame((tt) => this.frame(tt));
  }

  private X = (x: number) => PAD + x * S;
  private Y = (y: number) => TOP + (HGT - y) * S;

  private draw() {
    const c = this.g;
    const g = this.game;
    // коробка
    c.fillStyle = '#6a3a18';
    c.beginPath();
    c.roundRect(0, TOP - PAD * 0.6, CW, HGT * S + PAD * 1.6, 18);
    c.fill();
    // стенка-спортзал
    const wall = c.createLinearGradient(0, this.Y(HGT), 0, this.Y(0));
    wall.addColorStop(0, '#e8d8b0');
    wall.addColorStop(1, '#c8b088');
    c.fillStyle = wall;
    c.fillRect(this.X(0), this.Y(HGT), W * S, HGT * S);
    c.strokeStyle = 'rgba(120,80,40,0.18)';
    for (let i = 1; i < 12; i++) {
      c.beginPath();
      c.moveTo(this.X((i * W) / 12), this.Y(HGT));
      c.lineTo(this.X((i * W) / 12), this.Y(0));
      c.stroke();
    }
    c.fillStyle = 'rgba(180,40,30,0.15)';
    c.font = 'bold 34px "PT Serif", Georgia, serif';
    c.textAlign = 'center';
    c.fillText('СПОРТЛОТО', this.X(W / 2), this.Y(HGT * 0.62));
    // табло
    c.fillStyle = '#141414';
    c.beginPath();
    c.roundRect(CW / 2 - 160, 6, 320, 46, 10);
    c.fill();
    c.font = 'bold 30px "Courier New", monospace';
    c.fillStyle = TEAM[0].body;
    c.fillText(String(g.score[0]), CW / 2 - 110, 40);
    c.fillStyle = TEAM[1].body;
    c.fillText(String(g.score[1]), CW / 2 + 110, 40);
    c.fillStyle = '#ffd24a';
    const sec = Math.ceil(g.time);
    c.fillText(`${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`, CW / 2, 40);
    // пол (паркет)
    c.beginPath();
    c.moveTo(this.X(0), this.Y(0) + PAD * 0.4);
    for (let i = 0; i <= 200; i++) {
      const x = (i / 200) * W;
      c.lineTo(this.X(x), this.Y(floor(x)));
    }
    c.lineTo(this.X(W), this.Y(0) + PAD * 0.4);
    c.closePath();
    const parquet = c.createLinearGradient(0, this.Y(0.15), 0, this.Y(0));
    parquet.addColorStop(0, '#d89a50');
    parquet.addColorStop(1, '#a0642a');
    c.fillStyle = parquet;
    c.fill();
    // щиты и кольца
    for (const side of [0, 1]) {
      const bx = side === 0 ? BOARD.x : W - BOARD.x;
      c.fillStyle = '#f4f4f0';
      c.strokeStyle = '#333';
      c.lineWidth = 2;
      c.fillRect(this.X(bx) - 5, this.Y(BOARD.top), 10, (BOARD.top - BOARD.bottom) * S);
      c.strokeRect(this.X(bx) - 5, this.Y(BOARD.top), 10, (BOARD.top - BOARD.bottom) * S);
      c.fillStyle = '#555';
      c.fillRect(this.X(side === 0 ? 0 : W) - 4, this.Y(BOARD.top - 0.02), 8 * (side === 0 ? 1 : -1) + (bx - (side === 0 ? 0 : W)) * S, 5);
      const cx = side === 0 ? RIM.from : W - RIM.from;
      // сетка
      c.strokeStyle = 'rgba(255,255,255,0.85)';
      c.lineWidth = 1.5;
      for (let i = 0; i <= 4; i++) {
        const x0 = cx - RIM.half + (i * 2 * RIM.half) / 4;
        c.beginPath();
        c.moveTo(this.X(x0), this.Y(RIM.y));
        c.lineTo(this.X(cx + (x0 - cx) * 0.55), this.Y(RIM.y - 0.06));
        c.stroke();
      }
      c.beginPath();
      c.moveTo(this.X(cx - RIM.half * 0.55), this.Y(RIM.y - 0.06));
      c.lineTo(this.X(cx + RIM.half * 0.55), this.Y(RIM.y - 0.06));
      c.stroke();
      // дужка
      c.strokeStyle = '#e8501a';
      c.lineWidth = 4;
      c.beginPath();
      c.moveTo(this.X(cx - RIM.half), this.Y(RIM.y));
      c.lineTo(this.X(cx + RIM.half), this.Y(RIM.y));
      c.stroke();
      c.fillStyle = TEAM[side === 1 ? 0 : 1].body;
      c.font = 'bold 12px Arial';
      c.fillText(side === 1 ? 'сюда — красные' : 'сюда — синие', this.X(cx), this.Y(BOARD.top) - 8);
    }
    // катапульты и шкалы силы
    CATS.forEach((cat, t) => {
      const x = this.X(cat.x);
      const y = this.Y(floor(cat.x));
      c.strokeStyle = '#333';
      c.lineWidth = 5;
      c.lineCap = 'round';
      const arm = g.holding[t] ? 0.3 + g.charge[t] * 0.4 : 0.5;
      const dir = t === 0 ? -1 : 1;
      c.beginPath();
      c.moveTo(x, y + 6);
      c.lineTo(x + dir * Math.cos(arm) * 40, y + 6 + Math.sin(arm) * 18);
      c.stroke();
      c.lineCap = 'butt';
      c.fillStyle = TEAM[t].body;
      c.beginPath();
      c.ellipse(x, y + 4, 16, 6, 0, 0, Math.PI * 2);
      c.fill();
      // шкала
      const mx = t === 0 ? this.X(0.04) : this.X(W - 0.06);
      c.fillStyle = 'rgba(0,0,0,0.3)';
      c.fillRect(mx, this.Y(0.3), 14, 0.22 * S);
      const lvl = g.charge[t];
      c.fillStyle = lvl > 0.85 ? '#e8301a' : lvl > 0.5 ? '#f0b020' : '#3aa040';
      c.fillRect(mx, this.Y(0.08) - lvl * 0.22 * S, 14, lvl * 0.22 * S);
      if (g.owner === t) {
        c.fillStyle = TEAM[t].body;
        c.font = 'bold 13px "PT Sans", Arial';
        c.fillText('ваш мяч!', x, y + 26);
      }
    });
    // мяч
    const bx = this.X(g.x);
    const by = this.Y(g.y);
    const R = BALL_R * S;
    const grad = c.createRadialGradient(bx - R * 0.3, by - R * 0.3, 1, bx, by, R);
    grad.addColorStop(0, '#ffb070');
    grad.addColorStop(1, '#c85a14');
    c.fillStyle = grad;
    c.beginPath();
    c.arc(bx, by, R, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = '#3a1a08';
    c.lineWidth = 1.2;
    c.beginPath();
    c.moveTo(bx - R, by);
    c.lineTo(bx + R, by);
    c.moveTo(bx, by - R);
    c.lineTo(bx, by + R);
    c.stroke();
    if (this.flash > 0) {
      c.fillStyle = `rgba(255,220,80,${this.flash * 0.25})`;
      c.fillRect(this.X(0), this.Y(HGT), W * S, HGT * S);
    }
    if (g.over) {
      const [a, b] = g.score;
      const tt = this.mode === 'duel' ? (a === b ? 'Ничья' : `Победили ${TEAM[a > b ? 0 : 1].name}`) : a > b ? 'Победа!' : a === b ? 'Ничья' : 'Поражение';
      c.fillStyle = 'rgba(20,10,0,0.75)';
      c.beginPath();
      c.roundRect(CW / 2 - 220, this.Y(HGT / 2) - 50, 440, 100, 16);
      c.fill();
      c.fillStyle = '#ffe9a0';
      c.font = 'bold 40px "PT Serif", Georgia, serif';
      c.fillText(tt, CW / 2, this.Y(HGT / 2) + 4);
      c.fillStyle = '#f0e8d8';
      c.font = '16px "PT Sans", Arial, sans-serif';
      c.fillText(`${a} : ${b} · нажмите — ещё раз`, CW / 2, this.Y(HGT / 2) + 32);
    }
    c.textAlign = 'start';
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKeyUp);
    this.el.remove();
  }
}

const mod: ArcadeModule = {
  kind: 'arcade',
  id: 'basketball',
  title: 'Настольный баскетбол',
  about: 'Катапульта на пружинке: мяч скатился в вашу ямку — держите кнопку, сила растёт, отпустите — бросок в кольцо. До 21 очка или 3 минуты.',
  controls: `<p>Красные: <kbd>Пробел</kbd> или <kbd>Z</kbd> (против компьютера — ещё <kbd>Enter</kbd>): держать — набрать силу, отпустить — бросок.</p>
    <p>Синие (вдвоём): <kbd>Enter</kbd> или <kbd>M</kbd>. На телефоне — кнопки «Бросок» под полем.</p>`,
  modes: [
    { id: 'bot0', label: 'Лёгкий', hint: 'Против компьютера, лёгкий' },
    { id: 'bot1', label: 'Средний', hint: 'Против компьютера, средний' },
    { id: 'bot2', label: 'Сложный', hint: 'Против компьютера, сложный' },
    { id: 'duel', label: 'Вдвоём', hint: 'Двое за одной клавиатурой' },
  ],
  mount(root, opts) {
    const m = (['bot0', 'bot1', 'bot2', 'duel'] as const).includes(opts.mode as BMode) ? (opts.mode as BMode) : 'bot1';
    return new Court(root, m, opts);
  },
};

export default mod;
