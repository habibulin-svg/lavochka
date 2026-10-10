/* Настольный хоккей — коробка и площадка: деревянный борт, лёд с разметкой, прорези, металлические фигурки с клюшками, табло.
 * Управление: красные — WASD (куда тянуть фигурку) и Q/E (крутить клюшку), против компьютера — ещё стрелки и пробел;
 * синие (вдвоём) — стрелки и , / . . Ведёт та фигурка, что ближе к шайбе (подсвечена). На телефоне — левая половина экрана — «джойстик»,
 * справа — кнопки ⟲ ⟳. */
import type { ArcadeModule, ArcadeOpts } from '../../core/arcade';
import { Sound } from '../../core/audio';
import { h } from '../../core/util';
import { BODY_R, CORNER, figPos, GOAL, H, Hockey, PUCK_R, STICK, W, type HockeyMode, type Input } from './logic';
import './hockey.css';

const S = 1000;
const PAD = 40;
const TOP = 70;
const CW = W * S + PAD * 2;
const CH = H * S + PAD + TOP;
const TEAM = [
  { body: '#c8241c', dark: '#6e1210', name: 'красные' },
  { body: '#2050b0', dark: '#0e2a60', name: 'синие' },
];

class Rink {
  private el: HTMLElement;
  private cv: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private game: Hockey;
  private keys = new Set<string>();
  private raf = 0;
  private last = 0;
  private goalT = 0;
  private reported = false;
  private touch: { id: number; x0: number; y0: number; dx: number; dy: number } | null = null;
  private touchTurn = 0;
  private onKey = (e: KeyboardEvent) => this.key(e, true);
  private onKeyUp = (e: KeyboardEvent) => this.key(e, false);

  constructor(
    root: HTMLElement,
    private mode: HockeyMode,
    private opts: ArcadeOpts
  ) {
    this.el = h(`<div class="hk-dev"><canvas width="${CW * 2}" height="${CH * 2}"></canvas>
      <div class="hk-touch"><button data-t="-1">⟲</button><button data-t="1">⟳</button></div></div>`);
    root.appendChild(this.el);
    this.cv = this.el.querySelector('canvas') as HTMLCanvasElement;
    this.g = this.cv.getContext('2d')!;
    this.g.scale(2, 2);
    this.game = new Hockey(mode, 5, 3, (Math.random() * 1e9) | 0);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    this.cv.addEventListener('pointerdown', (e) => this.pointer(e, 'down'));
    this.cv.addEventListener('pointermove', (e) => this.pointer(e, 'move'));
    this.cv.addEventListener('pointerup', (e) => this.pointer(e, 'up'));
    this.cv.addEventListener('pointercancel', (e) => this.pointer(e, 'up'));
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('[data-t]')) {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        Sound.unlock();
        this.touchTurn = +b.dataset.t!;
      });
      const up = () => (this.touchTurn = 0);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointerleave', up);
    }
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private key(e: KeyboardEvent, down: boolean) {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const known = ['w', 'a', 's', 'd', 'q', 'e', 'ц', 'ф', 'ы', 'в', 'й', 'у', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' ', ',', '.', 'б', 'ю', 'Enter'];
    if (!known.includes(k) || (e.target as HTMLElement)?.tagName === 'INPUT') return;
    e.preventDefault();
    Sound.unlock();
    if (down && k === 'Enter' && this.game.over) return this.restart();
    if (down) this.keys.add(k);
    else this.keys.delete(k);
  }

  private restart() {
    this.game = new Hockey(this.mode, 5, 3, (Math.random() * 1e9) | 0);
    this.reported = false;
  }

  private local(e: PointerEvent) {
    const r = this.cv.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * CW, y: ((e.clientY - r.top) / r.height) * CH };
  }

  private pointer(e: PointerEvent, kind: 'down' | 'move' | 'up') {
    const p = this.local(e);
    if (kind === 'down') {
      Sound.unlock();
      if (this.game.over) return this.restart();
      this.touch = { id: e.pointerId, x0: p.x, y0: p.y, dx: 0, dy: 0 };
      this.cv.setPointerCapture(e.pointerId);
    } else if (this.touch && e.pointerId === this.touch.id) {
      if (kind === 'up') this.touch = null;
      else {
        this.touch.dx = Math.max(-1, Math.min(1, (p.x - this.touch.x0) / 60));
        this.touch.dy = Math.max(-1, Math.min(1, (p.y - this.touch.y0) / 60));
      }
    }
  }

  private input(team: 0 | 1): Input {
    const k = this.keys;
    const duel = this.mode === 'duel';
    const has = (...xs: string[]) => xs.some((x) => k.has(x));
    if (team === 0) {
      const arrows = !duel;
      let dx = (has('d', 'в') || (arrows && has('ArrowRight')) ? 1 : 0) - (has('a', 'ф') || (arrows && has('ArrowLeft')) ? 1 : 0);
      let dy = (has('s', 'ы') || (arrows && has('ArrowDown')) ? 1 : 0) - (has('w', 'ц') || (arrows && has('ArrowUp')) ? 1 : 0);
      let turn = (has('e', 'у') || (arrows && has(' ', '.', 'ю')) ? 1 : 0) - (has('q', 'й') || (arrows && has(',', 'б')) ? 1 : 0);
      if (this.touch) {
        dx = this.touch.dx;
        dy = this.touch.dy;
      }
      if (this.touchTurn) turn = this.touchTurn;
      return { dx, dy, turn };
    }
    return {
      dx: (has('ArrowRight') ? 1 : 0) - (has('ArrowLeft') ? 1 : 0),
      dy: (has('ArrowDown') ? 1 : 0) - (has('ArrowUp') ? 1 : 0),
      turn: (has('.', 'ю') ? 1 : 0) - (has(',', 'б') ? 1 : 0),
    };
  }

  private frame(t: number) {
    const dt = Math.min(50, t - this.last);
    this.last = t;
    const g = this.game;
    g.update(dt, [this.input(0), this.input(1)]);
    for (const s of g.sounds) {
      if (s === 'hit') Sound.beep(900, 0.02, 0.1);
      else if (s === 'wall') Sound.beep(300, 0.03, 0.08);
      else if (s === 'post') Sound.beep(2600, 0.06, 0.08);
      else if (s === 'whistle') Sound.beep(3000, 0.18, 0.05);
      else if (s === 'goal') {
        Sound.win();
        this.goalT = 1.2;
      }
    }
    g.sounds.length = 0;
    this.goalT = Math.max(0, this.goalT - dt / 1000);
    if (g.over && !this.reported) {
      this.reported = true;
      if (this.mode !== 'duel') this.opts.onScore(g.result());
    }
    this.draw();
    this.raf = requestAnimationFrame((tt) => this.frame(tt));
  }

  private X = (x: number) => PAD + x * S;
  private Y = (y: number) => TOP + y * S;

  private draw() {
    const c = this.g;
    const g = this.game;
    // коробка
    const wood = c.createLinearGradient(0, 0, 0, CH);
    wood.addColorStop(0, '#9a5a24');
    wood.addColorStop(1, '#5a2e10');
    c.fillStyle = wood;
    c.beginPath();
    c.roundRect(0, TOP - PAD, CW, H * S + PAD * 2, 30);
    c.fill();
    // табло
    c.fillStyle = '#141414';
    c.beginPath();
    c.roundRect(CW / 2 - 160, 6, 320, 46, 10);
    c.fill();
    c.font = 'bold 30px "Courier New", monospace';
    c.textAlign = 'center';
    c.fillStyle = TEAM[0].body;
    c.fillText(String(g.score[0]), CW / 2 - 110, 40);
    c.fillStyle = TEAM[1].body;
    c.fillText(String(g.score[1]), CW / 2 + 110, 40);
    c.fillStyle = '#ffd24a';
    const sec = Math.ceil(g.time);
    c.fillText(`${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`, CW / 2, 40);
    // лёд
    c.save();
    c.beginPath();
    c.roundRect(this.X(0), this.Y(0), W * S, H * S, CORNER * S);
    c.clip();
    const ice = c.createLinearGradient(0, this.Y(0), 0, this.Y(H));
    ice.addColorStop(0, '#f4f8fc');
    ice.addColorStop(1, '#dce8f2');
    c.fillStyle = ice;
    c.fillRect(this.X(0), this.Y(0), W * S, H * S);
    // разметка
    c.strokeStyle = '#d23a2a';
    c.lineWidth = 5;
    c.beginPath();
    c.moveTo(this.X(W / 2), this.Y(0));
    c.lineTo(this.X(W / 2), this.Y(H));
    c.stroke();
    c.strokeStyle = '#2a5ac0';
    c.lineWidth = 6;
    for (const x of [W * 0.33, W * 0.67]) {
      c.beginPath();
      c.moveTo(this.X(x), this.Y(0));
      c.lineTo(this.X(x), this.Y(H));
      c.stroke();
    }
    c.strokeStyle = '#d23a2a';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(this.X(W / 2), this.Y(H / 2), 0.07 * S, 0, Math.PI * 2);
    c.stroke();
    for (const x of [0, W]) {
      c.fillStyle = 'rgba(80,140,220,0.35)';
      c.beginPath();
      c.arc(this.X(x), this.Y(H / 2), 0.06 * S, x === 0 ? -Math.PI / 2 : Math.PI / 2, x === 0 ? Math.PI / 2 : (3 * Math.PI) / 2);
      c.fill();
    }
    // прорези
    c.strokeStyle = 'rgba(40,40,50,0.8)';
    c.lineCap = 'round';
    c.lineWidth = 7;
    for (const f of g.figs) {
      c.beginPath();
      c.moveTo(this.X(f.slot.ax), this.Y(f.slot.ay));
      c.lineTo(this.X(f.slot.bx), this.Y(f.slot.by));
      c.stroke();
    }
    c.lineCap = 'butt';
    c.restore();
    // ворота
    for (const x of [0, W]) {
      const dir = x === 0 ? -1 : 1;
      c.fillStyle = 'rgba(255,255,255,0.85)';
      c.strokeStyle = '#c8241c';
      c.lineWidth = 3;
      c.beginPath();
      c.rect(this.X(x) + (dir < 0 ? -0.03 * S : 0), this.Y(H / 2 - GOAL / 2), 0.03 * S, GOAL * S);
      c.fill();
      c.stroke();
      c.strokeStyle = 'rgba(0,0,0,0.15)';
      c.lineWidth = 1;
      for (let i = 1; i < 6; i++) {
        c.beginPath();
        c.moveTo(this.X(x) + (dir < 0 ? -0.03 * S : 0), this.Y(H / 2 - GOAL / 2) + (i * GOAL * S) / 6);
        c.lineTo(this.X(x) + (dir < 0 ? 0 : 0.03 * S), this.Y(H / 2 - GOAL / 2) + (i * GOAL * S) / 6);
        c.stroke();
      }
    }
    // шайба
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.beginPath();
    c.arc(this.X(g.px) + 2, this.Y(g.py) + 3, PUCK_R * S, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#111';
    c.beginPath();
    c.arc(this.X(g.px), this.Y(g.py), PUCK_R * S, 0, Math.PI * 2);
    c.fill();
    // фигурки
    g.figs.forEach((f, i) => {
      const p = figPos(f);
      const x = this.X(p.x);
      const y = this.Y(p.y);
      const tm = TEAM[f.team];
      const active = g.active[f.team] === i && (f.team === 0 || this.mode === 'duel');
      // клюшка
      c.strokeStyle = '#3a2a1a';
      c.lineWidth = 4;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + Math.cos(f.a) * STICK * S, y + Math.sin(f.a) * STICK * S);
      c.stroke();
      c.strokeStyle = '#111';
      c.lineWidth = 6;
      c.beginPath();
      c.moveTo(x + Math.cos(f.a) * STICK * S * 0.75, y + Math.sin(f.a) * STICK * S * 0.75);
      c.lineTo(x + Math.cos(f.a) * STICK * S, y + Math.sin(f.a) * STICK * S);
      c.stroke();
      c.lineCap = 'butt';
      // тело
      c.fillStyle = 'rgba(0,0,0,0.25)';
      c.beginPath();
      c.arc(x + 3, y + 4, BODY_R * S, 0, Math.PI * 2);
      c.fill();
      const body = c.createRadialGradient(x - 5, y - 6, 2, x, y, BODY_R * S);
      body.addColorStop(0, '#ffffff');
      body.addColorStop(0.25, tm.body);
      body.addColorStop(1, tm.dark);
      c.fillStyle = body;
      c.beginPath();
      c.arc(x, y, BODY_R * S, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#f0d0a8';
      c.beginPath();
      c.arc(x, y, BODY_R * S * 0.45, 0, Math.PI * 2);
      c.fill();
      if (active) {
        c.strokeStyle = '#ffd24a';
        c.lineWidth = 3;
        c.beginPath();
        c.arc(x, y, BODY_R * S + 5, 0, Math.PI * 2);
        c.stroke();
      }
    });
    // надписи
    c.textAlign = 'center';
    if (this.goalT > 0) this.banner('ГОЛ!', g.lastGoal != null ? `забили ${TEAM[g.lastGoal].name}` : '');
    else if (g.over) {
      const [a, b] = g.score;
      const t = this.mode === 'duel' ? (a === b ? 'Ничья' : `Победили ${TEAM[a > b ? 0 : 1].name}`) : a > b ? 'Победа!' : a === b ? 'Ничья' : 'Поражение';
      this.banner(t, `${a} : ${b} · Enter или нажатие — ещё раз`);
    }
    c.textAlign = 'start';
  }

  private banner(title: string, sub: string) {
    const c = this.g;
    c.fillStyle = 'rgba(10,20,40,0.75)';
    c.beginPath();
    c.roundRect(CW / 2 - 220, this.Y(H / 2) - 50, 440, 100, 16);
    c.fill();
    c.fillStyle = '#ffe9a0';
    c.font = 'bold 40px "PT Serif", Georgia, serif';
    c.fillText(title, CW / 2, this.Y(H / 2) + 4);
    c.fillStyle = '#e8f0f8';
    c.font = '16px "PT Sans", Arial, sans-serif';
    c.fillText(sub, CW / 2, this.Y(H / 2) + 32);
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
  id: 'hockey',
  title: 'Настольный хоккей',
  about: 'Тот самый, на штырьках: шесть фигурок на прорезях, клюшки крутятся. Против компьютера или вдвоём за одной клавиатурой. До 5 шайб или 3 минуты.',
  controls: `<p>Красные: <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> — куда вести фигурку, <kbd>Q</kbd> <kbd>E</kbd> — крутить клюшку
    (против компьютера — ещё стрелки и <kbd>Пробел</kbd>).</p>
    <p>Синие (вдвоём): стрелки и <kbd>,</kbd> <kbd>.</kbd>. Ведёт фигурка, что ближе к шайбе, — она подсвечена.</p>
    <p>На телефоне: тяните пальцем по полю — куда вести, кнопки ⟲ ⟳ — клюшка.</p>`,
  modes: [
    { id: 'bot0', label: 'Лёгкий', hint: 'Против компьютера, лёгкий' },
    { id: 'bot1', label: 'Средний', hint: 'Против компьютера, средний' },
    { id: 'bot2', label: 'Сложный', hint: 'Против компьютера, сложный' },
    { id: 'duel', label: 'Вдвоём', hint: 'Двое за одной клавиатурой' },
  ],
  mount(root, opts) {
    const m = (['bot0', 'bot1', 'bot2', 'duel'] as const).includes(opts.mode as HockeyMode) ? (opts.mode as HockeyMode) : 'bot1';
    return new Rink(root, m, opts);
  },
};

export default mod;
