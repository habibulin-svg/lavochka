/* «Яйца динозавров» — экран: карта ста уровней и поле — заросли папоротника, каменный потолок (опускается), красная черта,
 * пятнистые яйца, динозаврик-пушка внизу (яйцо на изготовку и следующее), прицел с отскоком от стенок, полёт яйца, лопанье и падение.
 * Мышью — целиться, нажать — выстрел; пробел или «⇄» — поменять яйца. */
import type { ArcadeModule, ArcadeOpts } from '../../core/arcade';
import { cover, Fx, Sprites } from '../../core/arcade-fx';
import { Sound } from '../../core/audio';
import { store } from '../../core/settings';
import { h, sleep } from '../../core/util';
import { Bubbles, COLS, DEAD_ROW, FIELD_W, ROW_H, ROWS, SHOOTER_Y } from './logic';
import './eggs.css';

const U = 56;
const CW = FIELD_W * U;
// снизу место под динозаврика-игрушку
const CH = (SHOOTER_Y + 1.9) * U;
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

/** Картинки (tools/arcade-art): яйца по цвету — как EGG, фоны по уровню, динозаврик-игрушка, каменный потолок, карта. */
const EGGS = ['egg0', 'egg1', 'egg2', 'egg3', 'egg4', 'egg5'] as const;
const BG = ['bg1', 'bg2', 'bg3'] as const;
const ART = new Sprites('eggs', [...EGGS, ...BG, 'dino', 'ceiling', 'map'] as const);

class Game {
  private el: HTMLElement;
  private b: Bubbles | null = null;
  private cv!: HTMLCanvasElement;
  private g!: CanvasRenderingContext2D;
  private aim = -Math.PI / 2;
  private flying: { color: number; path: [number, number][]; t: number } | null = null;
  private popping: { x: number; y: number; color: number; t: number; fall: boolean; vx: number }[] = [];
  private fx = new Fx();
  private last = performance.now();
  private t = 0;
  /** Очки до выстрела — чтобы показать, сколько принёс выстрел. */
  private shown = 0;
  /** Показанное опускание потолка — догоняет b.drops плавно. */
  private drop = 0;
  private dropsSeen = 0;
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
    let s = `<div class="eg-map" style="--map:url('${ART.url('map')}')"><div class="eg-map-t">Сто кладок — выберите уровень</div><div class="eg-grid">`;
    for (let n = 1; n <= 100; n++) {
      const open = n <= pr.open;
      const egg = open ? ` style="--egg:url('${ART.url(EGGS[(n - 1) % 6])}')"` : '';
      s += `<button class="eg-lv${open ? '' : ' locked'}${pr.best[n] ? ' done' : ''}" data-n="${n}"${egg} ${open ? '' : 'disabled'}><b>${n}</b><span>${pr.best[n] ?? (open ? '' : '🔒')}</span></button>`;
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
    this.fx = new Fx();
    this.shown = 0;
    this.drop = 0;
    this.dropsSeen = 0;
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
      const before = this.shown;
      let sx = 0;
      let sy = 0;
      for (const [r, c, col] of res.popped) {
        const [x, y] = b.center(r, c);
        sx += x;
        sy += y;
        this.popping.push({ x, y, color: col, t: 0, fall: false, vx: 0 });
        // скорлупа разлетается
        this.fx.burst(x * U, y * U, EGG[col % EGG.length][0], 8, 190, 5);
      }
      for (const [r, c, col] of res.fell) {
        const [x, y] = b.center(r, c);
        this.popping.push({ x, y, color: col, t: 0, fall: true, vx: (Math.random() - 0.5) * 1.6 });
      }
      const n = res.popped.length;
      this.fx.text((sx / n) * U, (sy / n) * U, `+${b.score - before}`, '#fff6c0', 26 + Math.min(10, n + res.fell.length));
      if (res.fell.length) {
        this.fx.text((sx / n) * U, (sy / n) * U - 34, `Обвал ×2!`, '#ffd040', 30);
        this.fx.shake(4 + Math.min(6, res.fell.length));
        Sound.beep(1500, 0.08, 0.1);
      }
    } else Sound.beep(400, 0.03, 0.06);
    this.shown = b.score;
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

  private egg(x: number, y: number, color: number, a = 1, rot = 0) {
    const g = this.g;
    const [c, d] = EGG[color % EGG.length];
    const px = x * U;
    const py = y * U;
    const im = ART.get(EGGS[color % EGGS.length]);
    if (im) {
      g.save();
      g.globalAlpha = a;
      g.translate(px, py);
      if (rot) g.rotate(rot);
      g.drawImage(im, -U * 0.56, -U * 0.56, U * 1.12, U * 1.12);
      g.restore();
      return;
    }
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
    const now = performance.now();
    const dt = Math.min(50, now - this.last);
    this.last = now;
    this.t += dt / 1000;
    this.fx.update(dt);
    g.save();
    const [ox, oy] = this.fx.offset();
    g.translate(ox, oy);
    // двор: у каждого третьего уровня свой фон, верх притемнён — яйца на нём читаются
    const bgi = ART.get(BG[(b.spec.n - 1) % 3]);
    if (bgi) {
      cover(g, bgi, -8, -8, CW + 16, CH + 16);
      const dim = g.createLinearGradient(0, 0, 0, CH);
      dim.addColorStop(0, 'rgba(10,15,5,0.45)');
      dim.addColorStop(0.75, 'rgba(10,15,5,0.15)');
      dim.addColorStop(1, 'rgba(10,15,5,0)');
      g.fillStyle = dim;
      g.fillRect(-8, -8, CW + 16, CH + 16);
    } else {
      const bg = g.createLinearGradient(0, 0, 0, CH);
      bg.addColorStop(0, '#2a4a1a');
      bg.addColorStop(1, '#5a7a2a');
      g.fillStyle = bg;
      g.fillRect(0, 0, CW, CH);
    }
    // потолок съезжает на ряд плавно (lag — сколько ещё не доехал), за выстрел до опускания — дрожит
    if (b.drops > this.dropsSeen) {
      this.dropsSeen = b.drops;
      this.fx.shake(5, 0.35);
      for (let x = 0.5; x < FIELD_W; x += 1.1) this.fx.burst(x * U, b.drops * ROW_H * U + 6, '#8a8178', 2, 90, 3);
      Sound.beep(120, 0.15, 0.2);
    }
    this.drop = Math.min(b.drops, this.drop + dt / 350);
    const lag = (this.drop - b.drops) * ROW_H * U;
    const warn = !b.won && !b.lost && b.shots % b.spec.dropEvery === b.spec.dropEvery - 1;
    const jx = warn ? Math.sin(this.t * 40) * 1.5 : 0;
    g.save();
    g.translate(jx, lag);
    // каменный потолок: над плитой — камень, нижний край плиты — по линии потолка
    const top = b.drops * ROW_H * U;
    const ceil = ART.get('ceiling');
    if (ceil) {
      const ch = (CW * ceil.naturalHeight) / ceil.naturalWidth;
      const cy = top + 10 - ch * 0.66;
      if (cy > -8) {
        g.fillStyle = '#4e4a46';
        g.fillRect(-8, -8, CW + 16, cy + 20);
      }
      g.drawImage(ceil, -8, cy, CW + 16, ch);
    } else {
      g.fillStyle = '#6a5a4a';
      g.fillRect(0, 0, CW, top + 6);
      g.fillStyle = '#4a3a2a';
      g.fillRect(0, top, CW, 6);
    }
    // яйца — вместе с потолком
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const v = b.grid[r][c];
        if (v == null) continue;
        const [x, y] = b.center(r, c);
        this.egg(x, y, v);
      }
    g.restore();
    // черта: красная, светится сильнее, когда яйца близко
    const lineY = (DEAD_ROW * ROW_H + 0.05) * U;
    let lowest = 0;
    for (let r = 0; r < ROWS; r++) if (b.grid[r].some((v) => v != null)) lowest = r;
    const near = lowest + b.drops >= DEAD_ROW - 2 ? 0.5 + 0.5 * Math.sin(this.t * 10) : 0;
    g.save();
    g.shadowColor = '#ff3020';
    g.shadowBlur = 6 + near * 14;
    g.setLineDash([10, 8]);
    g.strokeStyle = near ? `rgba(255,${80 - near * 60},40,1)` : '#e8402a';
    g.lineWidth = 2 + near * 2;
    g.beginPath();
    g.moveTo(0, lineY);
    g.lineTo(CW, lineY);
    g.stroke();
    g.restore();
    // лопнувшие (вспухают и исчезают) и падающие (кувыркаются вниз)
    for (const p of this.popping) {
      p.t += dt / 1000 / (p.fall ? 0.9 : 0.25);
      if (p.fall) this.egg(p.x + p.t * p.vx, p.y + p.t * p.t * 12, p.color, Math.max(0, 1 - p.t * 0.8), p.t * p.vx * 3);
      else {
        g.save();
        const k = 1 + p.t * 0.4;
        g.translate(p.x * U, p.y * U);
        g.scale(k, k);
        g.translate(-p.x * U, -p.y * U);
        this.egg(p.x, p.y, p.color, Math.max(0, 1 - p.t));
        g.restore();
      }
    }
    this.popping = this.popping.filter((p) => p.t < 1);
    // прицел: точки цвета яйца, до первого касания и после отскока
    if (!this.busy && !b.won && !b.lost) {
      const tr = b.trace(this.aim);
      const pts = tr.path.slice(0, 3);
      g.fillStyle = EGG[b.cur % EGG.length][0];
      let walked = 0;
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1];
        const [x1, y1] = pts[i];
        const seg = Math.hypot(x1 - x0, y1 - y0);
        for (let d = (0.35 - (walked % 0.35)) % 0.35; d < seg; d += 0.35) {
          const k = d / seg;
          const fade = Math.max(0, 1 - (walked + d) / 9);
          if (fade <= 0) break;
          g.globalAlpha = 0.85 * fade;
          g.beginPath();
          g.arc((x0 + (x1 - x0) * k) * U, (y0 + (y1 - y0) * k) * U, 3, 0, Math.PI * 2);
          g.fill();
        }
        walked += seg;
      }
      g.globalAlpha = 1;
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
    // динозаврик: резиновая игрушка сидит внизу и наклоняется туда, куда целится
    const sx = (FIELD_W / 2) * U;
    const sy = SHOOTER_Y * U;
    const dino = ART.get('dino');
    if (dino) {
      // на картинке у игрушки на голове яйцо (на 0.68 высоты от ног) — туда и кладём яйцо на изготовку, оно же точка вылета
      const lean = (this.aim + Math.PI / 2) * 0.15;
      const s = U * 2.6;
      const feet = sy + s * 0.68;
      g.save();
      g.translate(sx, feet);
      g.fillStyle = 'rgba(0,0,0,0.35)';
      g.beginPath();
      g.ellipse(0, 0, s * 0.3, s * 0.06, 0, 0, Math.PI * 2);
      g.fill();
      g.rotate(lean);
      g.drawImage(dino, -s / 2, -s * 0.86, s, s);
      g.restore();
      if (!this.flying) this.egg(FIELD_W / 2 + (Math.sin(lean) * s * 0.68) / U, (feet - Math.cos(lean) * s * 0.68) / U, b.cur);
      this.egg(FIELD_W / 2 + 1.9, SHOOTER_Y + 1.1, b.next, 0.9);
      this.fx.draw(g);
      g.restore();
      return;
    }
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
    this.fx.draw(g);
    g.restore();
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
