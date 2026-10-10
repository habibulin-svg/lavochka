/* «Яйца динозавров» — экран: карта ста уровней и поле — заросли папоротника, каменный потолок (опускается), красная черта,
 * пятнистые яйца, динозаврик-пушка внизу (яйцо на изготовку и следующее), прицел с отскоком от стенок, полёт яйца, лопанье и падение.
 * Мышью — целиться, нажать — выстрел; пробел или «⇄» — поменять яйца. */
import type { ArcadeModule, ArcadeOpts } from '../../core/arcade';
import { Sound } from '../../core/audio';
import { store } from '../../core/settings';
import { h, sleep } from '../../core/util';
import { Bubbles, COLS, DEAD_ROW, FIELD_W, ROW_H, ROWS, SHOOTER_Y } from './logic';
import './eggs.css';

const U = 56;
const CW = FIELD_W * U;
const CH = (SHOOTER_Y + 1.3) * U;
const KEY = 'eggs.progress';
const EGG = [
  ['#7ac850', '#2a6a1a'],
  ['#5aa0e8', '#1a4a90'],
  ['#e85a4a', '#8a1a10'],
  ['#f0d040', '#9a7a08'],
  ['#b070e0', '#5a2a8a'],
  ['#f09a40', '#9a4a08'],
];

interface Progress {
  open: number;
  best: Record<number, number>;
}
const loadProgress = (): Progress => store.get<Progress>(KEY, { open: 1, best: {} });

class Game {
  private el: HTMLElement;
  private b: Bubbles | null = null;
  private cv!: HTMLCanvasElement;
  private g!: CanvasRenderingContext2D;
  private aim = -Math.PI / 2;
  private flying: { color: number; path: [number, number][]; t: number } | null = null;
  private popping: { x: number; y: number; color: number; t: number; fall: boolean }[] = [];
  private busy = false;
  private raf = 0;
  private onKey = (e: KeyboardEvent) => {
    if (!this.b || (e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.key === ' ') {
      e.preventDefault();
      this.swap();
    }
  };

  constructor(
    root: HTMLElement,
    private opts: ArcadeOpts
  ) {
    this.el = h('<div class="eg-dev"></div>');
    root.appendChild(this.el);
    window.addEventListener('keydown', this.onKey);
    this.showMap();
  }

  private swap() {
    if (!this.b || this.busy) return;
    [this.b.cur, this.b.next] = [this.b.next, this.b.cur];
    Sound.ui();
  }

  private showMap() {
    cancelAnimationFrame(this.raf);
    this.b = null;
    const pr = loadProgress();
    let s = '<div class="eg-map"><div class="eg-map-t">Сто кладок — выберите уровень</div><div class="eg-grid">';
    for (let n = 1; n <= 100; n++) {
      const open = n <= pr.open;
      s += `<button class="eg-lv${open ? '' : ' locked'}${pr.best[n] ? ' done' : ''}" data-n="${n}" ${open ? '' : 'disabled'}><b>${n}</b><span>${pr.best[n] ?? (open ? '' : '🔒')}</span></button>`;
    }
    this.el.innerHTML = s + '</div></div>';
    this.el.querySelectorAll<HTMLButtonElement>('.eg-lv').forEach((x) => (x.onclick = () => this.start(+x.dataset.n!)));
    this.el.querySelector(`[data-n="${Math.min(100, pr.open)}"]`)?.scrollIntoView({ block: 'center' });
  }

  private start(n: number) {
    Sound.ui();
    this.b = new Bubbles(n, (Math.random() * 1e9) | 0);
    this.flying = null;
    this.popping = [];
    this.busy = false;
    this.el.innerHTML = `<div class="eg-play"><div class="eg-hud"></div><canvas width="${CW * 2}" height="${CH * 2}"></canvas>
      <div class="eg-btns"><button class="btn" data-b="map">← Уровни</button><button class="btn" data-b="swap">⇄</button><button class="btn" data-b="again">Заново</button></div></div>`;
    this.cv = this.el.querySelector('canvas') as HTMLCanvasElement;
    this.g = this.cv.getContext('2d')!;
    this.g.setTransform(2, 0, 0, 2, 0, 0);
    (this.el.querySelector('[data-b=map]') as HTMLButtonElement).onclick = () => this.showMap();
    (this.el.querySelector('[data-b=again]') as HTMLButtonElement).onclick = () => this.start(n);
    (this.el.querySelector('[data-b=swap]') as HTMLButtonElement).onclick = () => this.swap();
    const angleTo = (e: PointerEvent) => {
      const r = this.cv.getBoundingClientRect();
      const x = ((e.clientX - r.left) / r.width) * FIELD_W;
      const y = ((e.clientY - r.top) / r.height) * (CH / U);
      return Math.max(-Math.PI + 0.12, Math.min(-0.12, Math.atan2(y - SHOOTER_Y, x - FIELD_W / 2)));
    };
    this.cv.addEventListener('pointermove', (e) => (this.aim = angleTo(e)));
    this.cv.addEventListener('pointerdown', (e) => {
      Sound.unlock();
      this.aim = angleTo(e);
      void this.fire();
    });
    this.hud();
    const loop = () => {
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    cancelAnimationFrame(this.raf);
    this.raf = requestAnimationFrame(loop);
  }

  private hud() {
    const b = this.b;
    if (!b) return;
    const left = b.spec.dropEvery - (b.shots % b.spec.dropEvery);
    (this.el.querySelector('.eg-hud') as HTMLElement).innerHTML = `<span>Уровень <b>${b.spec.n}</b></span><span>очки <b>${b.score}</b></span><span>потолок опустится через <b>${left}</b></span>`;
  }

  private async fire() {
    const b = this.b;
    if (!b || this.busy || b.won || b.lost) return;
    this.busy = true;
    const color = b.cur;
    const res = b.shoot(this.aim);
    if (!res) {
      this.busy = false;
      return;
    }
    Sound.beep(800, 0.03, 0.08);
    // полёт по траектории (снаряд скрыт в сетке, пока летит — поэтому сначала уберём его из отображения)
    const cell = res.cell;
    const hidden = cell && b.grid[cell[0]][cell[1]] === color ? cell : null;
    this.flying = { color, path: res.path, t: 0 };
    if (hidden) b.grid[hidden[0]][hidden[1]] = null;
    const len = res.path.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - res.path[i - 1][0], p[1] - res.path[i - 1][1]) : 0), 0);
    const dur = Math.max(120, len * 28);
    const t0 = performance.now();
    await new Promise<void>((done) => {
      const step = () => {
        this.flying!.t = Math.min(1, (performance.now() - t0) / dur);
        if (this.flying!.t >= 1) return done();
        requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    });
    if (hidden) b.grid[hidden[0]][hidden[1]] = color;
    this.flying = null;
    // лопнули и упали
    if (res.popped.length) {
      Sound.capture();
      for (const [r, c, col] of res.popped) {
        const [x, y] = b.center(r, c);
        this.popping.push({ x, y, color: col, t: 0, fall: false });
      }
      for (const [r, c, col] of res.fell) {
        const [x, y] = b.center(r, c);
        this.popping.push({ x, y, color: col, t: 0, fall: true });
      }
    } else Sound.beep(400, 0.03, 0.06);
    this.hud();
    await sleep(80);
    this.busy = false;
    if (b.won || b.lost) {
      await sleep(500);
      this.finish();
    }
  }

  private finish() {
    const b = this.b;
    if (!b) return;
    const pr = loadProgress();
    if (b.won) {
      Sound.win();
      pr.best[b.spec.n] = Math.max(pr.best[b.spec.n] ?? 0, b.score);
      pr.open = Math.max(pr.open, Math.min(100, b.spec.n + 1));
      store.set(KEY, pr);
      this.opts.onScore(Object.values(pr.best).reduce((a, x) => a + x, 0));
    } else Sound.nomove();
    const box = h(`<div class="eg-end"><h2>${b.won ? 'Кладка разбита!' : 'Яйца дошли до черты'}</h2><p>Очки: <b>${b.score}</b></p>
      <div>${b.won && b.spec.n < 100 ? '<button class="btn primary" data-e="next">Дальше</button>' : ''}<button class="btn" data-e="again">Ещё раз</button><button class="btn" data-e="map">Уровни</button></div></div>`);
    this.el.querySelector('.eg-play')?.appendChild(box);
    (box.querySelector('[data-e=again]') as HTMLButtonElement).onclick = () => this.start(b.spec.n);
    (box.querySelector('[data-e=map]') as HTMLButtonElement).onclick = () => this.showMap();
    const nx = box.querySelector('[data-e=next]') as HTMLButtonElement | null;
    if (nx) nx.onclick = () => this.start(b.spec.n + 1);
  }

  private egg(x: number, y: number, color: number, a = 1) {
    const g = this.g;
    const [c, d] = EGG[color % EGG.length];
    const px = x * U;
    const py = y * U;
    g.globalAlpha = a;
    const gr = g.createRadialGradient(px - U * 0.15, py - U * 0.18, 2, px, py, U * 0.5);
    gr.addColorStop(0, '#fffbe8');
    gr.addColorStop(0.45, c);
    gr.addColorStop(1, d);
    g.fillStyle = gr;
    g.beginPath();
    g.ellipse(px, py + 1, U * 0.4, U * 0.47, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(40,20,0,0.35)';
    for (const [dx, dy, r] of [
      [-0.12, 0.05, 0.05],
      [0.14, -0.08, 0.04],
      [0.05, 0.2, 0.035],
      [-0.05, -0.2, 0.03],
    ])
      {
        g.beginPath();
        g.arc(px + dx * U, py + dy * U, r * U, 0, Math.PI * 2);
        g.fill();
      }
    g.globalAlpha = 1;
  }

  private draw() {
    const b = this.b;
    if (!b) return;
    const g = this.g;
    // заросли
    const bg = g.createLinearGradient(0, 0, 0, CH);
    bg.addColorStop(0, '#2a4a1a');
    bg.addColorStop(1, '#5a7a2a');
    g.fillStyle = bg;
    g.fillRect(0, 0, CW, CH);
    g.fillStyle = 'rgba(20,60,10,0.5)';
    for (let i = 0; i < 9; i++) {
      const x = (i * 97) % CW;
      g.beginPath();
      g.moveTo(x, CH);
      g.quadraticCurveTo(x + 30, CH - 160, x + 70, CH - 220);
      g.quadraticCurveTo(x + 40, CH - 140, x + 60, CH);
      g.fill();
    }
    // каменный потолок
    const top = b.drops * ROW_H * U;
    g.fillStyle = '#6a5a4a';
    g.fillRect(0, 0, CW, top + 6);
    g.fillStyle = '#4a3a2a';
    g.fillRect(0, top, CW, 6);
    // черта
    g.setLineDash([10, 8]);
    g.strokeStyle = '#e8402a';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(0, (DEAD_ROW * ROW_H + 0.05) * U);
    g.lineTo(CW, (DEAD_ROW * ROW_H + 0.05) * U);
    g.stroke();
    g.setLineDash([]);
    // яйца
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const v = b.grid[r][c];
        if (v == null) continue;
        const [x, y] = b.center(r, c);
        this.egg(x, y, v);
      }
    // лопнувшие и падающие
    for (const p of this.popping) {
      p.t += 0.04;
      if (p.fall) this.egg(p.x, p.y + p.t * p.t * 12, p.color, Math.max(0, 1 - p.t));
      else this.egg(p.x, p.y, p.color, Math.max(0, 1 - p.t * 2));
    }
    this.popping = this.popping.filter((p) => p.t < 1);
    // прицел: первый отрезок и отскок
    if (!this.busy && !b.won && !b.lost) {
      const tr = b.trace(this.aim);
      g.setLineDash([4, 8]);
      g.strokeStyle = 'rgba(255,255,220,0.5)';
      g.lineWidth = 2;
      g.beginPath();
      tr.path.slice(0, 3).forEach(([x, y], i) => (i ? g.lineTo(x * U, y * U) : g.moveTo(x * U, y * U)));
      g.stroke();
      g.setLineDash([]);
    }
    // летящее яйцо
    if (this.flying) {
      const f = this.flying;
      const path = f.path;
      const total = path.reduce((a, p, i) => (i ? a + Math.hypot(p[0] - path[i - 1][0], p[1] - path[i - 1][1]) : 0), 0);
      let need = total * f.t;
      let pos = path[0];
      for (let i = 1; i < path.length; i++) {
        const seg = Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
        if (need <= seg) {
          const k = seg ? need / seg : 0;
          pos = [path[i - 1][0] + (path[i][0] - path[i - 1][0]) * k, path[i - 1][1] + (path[i][1] - path[i - 1][1]) * k];
          break;
        }
        need -= seg;
        pos = path[i];
      }
      this.egg(pos[0], pos[1], f.color);
    }
    // динозаврик
    const sx = (FIELD_W / 2) * U;
    const sy = SHOOTER_Y * U;
    g.save();
    g.translate(sx, sy);
    g.rotate(this.aim + Math.PI / 2);
    g.fillStyle = '#4a9a3a';
    g.beginPath();
    g.ellipse(0, 18, 34, 26, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#3a7a2a';
    g.beginPath();
    g.ellipse(0, -6, 18, 30, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = '#fff';
    for (const ex of [-9, 9]) {
      g.beginPath();
      g.arc(ex, 6, 5, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#111';
    for (const ex of [-9, 9]) {
      g.beginPath();
      g.arc(ex, 5, 2.2, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    if (!this.flying) this.egg(FIELD_W / 2 + Math.cos(this.aim) * 0.55, SHOOTER_Y + Math.sin(this.aim) * 0.55, b.cur);
    this.egg(FIELD_W / 2 + 1.4, SHOOTER_Y + 0.4, b.next, 0.85);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    this.el.remove();
  }
}

const mod: ArcadeModule = {
  kind: 'arcade',
  id: 'eggs',
  title: 'Яйца динозавров',
  about: 'Динозаврик стреляет яйцами: три одинаковых рядом — лопаются, всё, что повисло, падает. Каменный потолок опускается. Сто уровней.',
  controls: `<p>Мышью — целиться (яйцо отскакивает от стенок), нажать — выстрел, <kbd>Пробел</kbd> или «⇄» — поменять яйца.</p>
    <p>Яйцо ниже красной черты — уровень проигран. Упавшие яйца — очки вдвое.</p>`,
  modes: [{ id: 'levels', label: 'Сто уровней' }],
  mount(root, opts) {
    return new Game(root, opts);
  },
};

export default mod;
