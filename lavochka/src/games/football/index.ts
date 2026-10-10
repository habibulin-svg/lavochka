/* Настольный футбол — коробка и поле: зелёное поле с разметкой и ямками у ног, фигурки (замах ногой при ударе), табло, рычаги по линиям.
 * Красные: Z X C V — рычаги вратаря, защиты, полузащиты, нападения; W/S — вратарь вверх-вниз (против компьютера — ещё 1 2 3 4 и стрелки).
 * Синие (вдвоём): M , . / — нападение, полузащита, защита, вратарь; ↑/↓ — вратарь. Мышью/пальцем — нажать на свою фигурку или на рычаг под полем. */
import type { ArcadeModule, ArcadeOpts } from '../../core/arcade';
import { Sound } from '../../core/audio';
import { h } from '../../core/util';
import { BALL_R, BODY_R, Football, footPos, GOAL, H, W, type FootMode, type Line } from './logic';
import './football.css';

const S = 1000;
const PAD = 40;
const TOP = 70;
const CW = W * S + PAD * 2;
const CH = H * S + PAD + TOP;
const TEAM = [
  { body: '#c8241c', dark: '#6e1210', name: 'красные' },
  { body: '#2050b0', dark: '#0e2a60', name: 'синие' },
];
const LINE_NAME: Record<Line, string> = { G: 'Вр', D: 'Защ', M: 'Пз', F: 'Нап' };
const ORDER: Line[] = ['G', 'D', 'M', 'F'];

class Pitch {
  private el: HTMLElement;
  private cv: HTMLCanvasElement;
  private g: CanvasRenderingContext2D;
  private game: Football;
  private keys = new Set<string>();
  private raf = 0;
  private last = 0;
  private goalT = 0;
  private reported = false;
  private onKey = (e: KeyboardEvent) => this.key(e, true);
  private onKeyUp = (e: KeyboardEvent) => this.key(e, false);

  constructor(
    root: HTMLElement,
    private mode: FootMode,
    private opts: ArcadeOpts
  ) {
    const duel = mode === 'duel';
    const levers = (team: 0 | 1) =>
      (team === 0 ? ORDER : [...ORDER].reverse()).map((l) => `<button data-team="${team}" data-line="${l}" style="--c:${TEAM[team].body}">${LINE_NAME[l]}</button>`).join('');
    this.el = h(`<div class="fb-dev"><canvas width="${CW * 2}" height="${CH * 2}"></canvas>
      <div class="fb-levers"><div>${levers(0)}<button data-keeper="0" data-dir="-1" style="--c:${TEAM[0].body}">▲</button><button data-keeper="0" data-dir="1" style="--c:${TEAM[0].body}">▼</button></div>
      ${duel ? `<div><button data-keeper="1" data-dir="-1" style="--c:${TEAM[1].body}">▲</button><button data-keeper="1" data-dir="1" style="--c:${TEAM[1].body}">▼</button>${levers(1)}</div>` : ''}</div></div>`);
    root.appendChild(this.el);
    this.cv = this.el.querySelector('canvas') as HTMLCanvasElement;
    this.g = this.cv.getContext('2d')!;
    this.g.scale(2, 2);
    this.game = new Football(mode, 5, 3, (Math.random() * 1e9) | 0);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKeyUp);
    this.cv.addEventListener('pointerdown', (e) => this.click(e));
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('[data-line]')) {
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        Sound.unlock();
        this.game.kickLine(+b.dataset.team! as 0 | 1, b.dataset.line as Line);
      });
    }
    for (const b of this.el.querySelectorAll<HTMLButtonElement>('[data-keeper]')) {
      const k = `keeper${b.dataset.keeper}${b.dataset.dir}`;
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.keys.add(k);
      });
      const up = () => this.keys.delete(k);
      b.addEventListener('pointerup', up);
      b.addEventListener('pointerleave', up);
    }
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private key(e: KeyboardEvent, down: boolean) {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const duel = this.mode === 'duel';
    const red: Record<string, Line> = { z: 'G', x: 'D', c: 'M', v: 'F', я: 'G', ч: 'D', с: 'M', м: 'F' };
    if (!duel) Object.assign(red, { '1': 'G', '2': 'D', '3': 'M', '4': 'F' });
    const blue: Record<string, Line> = { m: 'F', ',': 'M', '.': 'D', '/': 'G', ь: 'F', б: 'M', ю: 'D' };
    const move = ['w', 's', 'ц', 'ы', 'ArrowUp', 'ArrowDown'];
    if (!(k in red) && !(duel && k in blue) && !move.includes(k) && k !== 'Enter') return;
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    e.preventDefault();
    Sound.unlock();
    if (!down) return void this.keys.delete(k);
    if (e.repeat) return;
    if (k === 'Enter' && this.game.over) return this.restart();
    if (k in red) this.game.kickLine(0, red[k]);
    else if (duel && k in blue) this.game.kickLine(1, blue[k]);
    else this.keys.add(k);
  }

  private restart() {
    this.game = new Football(this.mode, 5, 3, (Math.random() * 1e9) | 0);
    this.reported = false;
  }

  private click(e: PointerEvent) {
    Sound.unlock();
    if (this.game.over) return this.restart();
    const r = this.cv.getBoundingClientRect();
    const x = (((e.clientX - r.left) / r.width) * CW - PAD) / S;
    const y = (((e.clientY - r.top) / r.height) * CH - TOP) / S;
    // ближайшая своя фигурка (в игре с компьютером — только красные)
    let best = -1;
    let bd = 0.05;
    this.game.figs.forEach((f, i) => {
      if (f.team === 1 && this.mode !== 'duel') return;
      const d = Math.hypot(f.x - x, f.y - y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    if (best >= 0) this.game.kickFig(best);
  }

  private frame(t: number) {
    const dt = Math.min(50, t - this.last);
    this.last = t;
    const g = this.game;
    const k = this.keys;
    const duel = this.mode === 'duel';
    const up0 = k.has('w') || k.has('ц') || k.has('keeper0-1') || (!duel && k.has('ArrowUp'));
    const dn0 = k.has('s') || k.has('ы') || k.has('keeper01') || (!duel && k.has('ArrowDown'));
    if (up0 !== dn0) g.moveKeeper(0, up0 ? -1 : 1, dt / 1000);
    if (duel) {
      const up1 = k.has('ArrowUp') || k.has('keeper1-1');
      const dn1 = k.has('ArrowDown') || k.has('keeper11');
      if (up1 !== dn1) g.moveKeeper(1, up1 ? -1 : 1, dt / 1000);
    }
    g.update(dt);
    for (const s of g.sounds) {
      if (s === 'kick') Sound.beep(700, 0.03, 0.12);
      else if (s === 'wall') Sound.beep(260, 0.03, 0.08);
      else if (s === 'post') Sound.beep(2400, 0.06, 0.08);
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
    const wood = c.createLinearGradient(0, 0, 0, CH);
    wood.addColorStop(0, '#8a5020');
    wood.addColorStop(1, '#4e280c');
    c.fillStyle = wood;
    c.beginPath();
    c.roundRect(0, TOP - PAD, CW, H * S + PAD * 2, 24);
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
    // поле полосами
    for (let i = 0; i < 10; i++) {
      c.fillStyle = i % 2 ? '#2f8a3a' : '#35963f';
      c.fillRect(this.X((i * W) / 10), this.Y(0), (W / 10) * S + 1, H * S);
    }
    c.strokeStyle = 'rgba(255,255,255,0.85)';
    c.lineWidth = 3;
    c.strokeRect(this.X(0), this.Y(0), W * S, H * S);
    c.beginPath();
    c.moveTo(this.X(W / 2), this.Y(0));
    c.lineTo(this.X(W / 2), this.Y(H));
    c.stroke();
    c.beginPath();
    c.arc(this.X(W / 2), this.Y(H / 2), 0.07 * S, 0, Math.PI * 2);
    c.stroke();
    for (const x of [0, W]) {
      const d = x === 0 ? 1 : -1;
      c.strokeRect(this.X(x) + (d > 0 ? 0 : -0.1 * S), this.Y(H / 2 - 0.15), 0.1 * S, 0.3 * S);
      c.strokeRect(this.X(x) + (d > 0 ? 0 : -0.04 * S), this.Y(H / 2 - 0.08), 0.04 * S, 0.16 * S);
    }
    // ямки у ног
    for (const f of g.figs) {
      const fx = f.x + Math.cos(f.face) * (BODY_R + BALL_R + 0.004);
      const fy = f.y + Math.sin(f.face) * (BODY_R + BALL_R + 0.004);
      const grad = c.createRadialGradient(this.X(fx), this.Y(fy), 1, this.X(fx), this.Y(fy), 0.05 * S);
      grad.addColorStop(0, 'rgba(0,40,0,0.25)');
      grad.addColorStop(1, 'rgba(0,40,0,0)');
      c.fillStyle = grad;
      c.beginPath();
      c.arc(this.X(fx), this.Y(fy), 0.05 * S, 0, Math.PI * 2);
      c.fill();
    }
    // ворота
    for (const x of [0, W]) {
      const d = x === 0 ? -1 : 1;
      c.fillStyle = 'rgba(255,255,255,0.8)';
      c.fillRect(this.X(x) + (d < 0 ? -0.03 * S : 0), this.Y(H / 2 - GOAL / 2), 0.03 * S, GOAL * S);
      c.strokeStyle = '#ddd';
      c.strokeRect(this.X(x) + (d < 0 ? -0.03 * S : 0), this.Y(H / 2 - GOAL / 2), 0.03 * S, GOAL * S);
    }
    // мяч
    c.fillStyle = 'rgba(0,0,0,0.25)';
    c.beginPath();
    c.arc(this.X(g.bx) + 2, this.Y(g.by) + 3, BALL_R * S, 0, Math.PI * 2);
    c.fill();
    const ball = c.createRadialGradient(this.X(g.bx) - 3, this.Y(g.by) - 3, 1, this.X(g.bx), this.Y(g.by), BALL_R * S);
    ball.addColorStop(0, '#ffffff');
    ball.addColorStop(1, '#bbbbbb');
    c.fillStyle = ball;
    c.beginPath();
    c.arc(this.X(g.bx), this.Y(g.by), BALL_R * S, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = '#222';
    c.beginPath();
    c.arc(this.X(g.bx), this.Y(g.by), BALL_R * S * 0.35, 0, Math.PI * 2);
    c.fill();
    // фигурки
    for (const f of g.figs) {
      const x = this.X(f.x);
      const y = this.Y(f.y);
      const tm = TEAM[f.team];
      // нога: замах при ударе
      const swing = f.kick > 0 ? Math.sin((1 - f.kick / 0.25) * Math.PI) : 0;
      const p = footPos(f);
      c.strokeStyle = '#1a1a1a';
      c.lineWidth = 6;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(this.X(p.x) + Math.cos(f.face) * swing * 12, this.Y(p.y) + Math.sin(f.face) * swing * 12);
      c.stroke();
      c.lineCap = 'butt';
      c.fillStyle = 'rgba(0,0,0,0.25)';
      c.beginPath();
      c.ellipse(x + 3, y + 4, BODY_R * S, BODY_R * S * 0.8, 0, 0, Math.PI * 2);
      c.fill();
      const body = c.createRadialGradient(x - 5, y - 5, 2, x, y, BODY_R * S);
      body.addColorStop(0, '#ffffff');
      body.addColorStop(0.3, tm.body);
      body.addColorStop(1, tm.dark);
      c.fillStyle = body;
      c.beginPath();
      c.ellipse(x, y, BODY_R * S * 0.8, BODY_R * S, 0, 0, Math.PI * 2);
      c.fill();
      c.fillStyle = '#f0d0a8';
      c.beginPath();
      c.arc(x, y, BODY_R * S * 0.42, 0, Math.PI * 2);
      c.fill();
      if (f.line === 'G') {
        c.strokeStyle = '#ffd24a';
        c.lineWidth = 2;
        c.beginPath();
        c.arc(x, y, BODY_R * S + 3, 0, Math.PI * 2);
        c.stroke();
      }
    }
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
    c.fillStyle = 'rgba(10,30,10,0.75)';
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
  id: 'football',
  title: 'Настольный футбол',
  about: 'Фигурки стоят на местах, у каждой рычаг: жмёшь — бьёт по мячу, если он у ноги. Мяч скатывается в ямки у ног. До 5 голов или 3 минуты.',
  controls: `<p>Красные: <kbd>Z</kbd> <kbd>X</kbd> <kbd>C</kbd> <kbd>V</kbd> — рычаги вратаря, защиты, полузащиты, нападения; <kbd>W</kbd>/<kbd>S</kbd> — вратарь
    (против компьютера — ещё <kbd>1</kbd>–<kbd>4</kbd> и стрелки).</p>
    <p>Синие (вдвоём): <kbd>M</kbd> <kbd>,</kbd> <kbd>.</kbd> <kbd>/</kbd> — нападение, полузащита, защита, вратарь; <kbd>↑</kbd>/<kbd>↓</kbd> — вратарь.</p>
    <p>Мышью или пальцем — нажать на свою фигурку или на рычаг под полем.</p>`,
  modes: [
    { id: 'bot0', label: 'Лёгкий', hint: 'Против компьютера, лёгкий' },
    { id: 'bot1', label: 'Средний', hint: 'Против компьютера, средний' },
    { id: 'bot2', label: 'Сложный', hint: 'Против компьютера, сложный' },
    { id: 'duel', label: 'Вдвоём', hint: 'Двое за одной клавиатурой' },
  ],
  mount(root, opts) {
    const m = (['bot0', 'bot1', 'bot2', 'duel'] as const).includes(opts.mode as FootMode) ? (opts.mode as FootMode) : 'bot1';
    return new Pitch(root, m, opts);
  },
};

export default mod;
