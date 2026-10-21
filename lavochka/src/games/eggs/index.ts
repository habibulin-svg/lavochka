/* «Яйца динозавров» — экран: карта ста уровней и поле — заросли папоротника, каменный потолок (опускается), красная черта,
 * пятнистые яйца, динозаврик-пушка внизу (яйцо на изготовку и следующее), прицел с отскоком от стенок, полёт яйца, лопанье и падение.
 * Мышью — целиться, нажать — выстрел; пробел или «⇄» — поменять яйца. */
import type { ArcadeModule, ArcadeOpts } from '../../core/arcade';
import { Fx } from '../../core/arcade-fx';
import { Sound } from '../../core/audio';
import { store } from '../../core/settings';
import { h, sleep } from '../../core/util';
import { Bubbles, COLS, DEAD_ROW, FIELD_W, ROW_H, ROWS, SHOOTER_Y } from './logic';
import { along, ART, drawAim, drawBack, drawCeiling, drawDino, drawEgg, drawLine, EGG, EGGS, FIELD_H, pathLen } from './paint';
import './eggs.css';

const U = 56;
const CW = FIELD_W * U;
const CH = FIELD_H * U;
const KEY = 'eggs.progress';
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
  private popping: { x: number; y: number; color: number; t: number; fall: boolean; vx: number }[] = [];
  /** Лопнувшие и упавшие этим выстрелом — b.shoot уже убрал их из сетки, а пока яйцо летит, они висят на месте. */
  private ghosts: [number, number, number][] = [];
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
    this.ghosts = [];
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
    this.ghosts = [...res.popped, ...res.fell].filter(([r, c]) => !cell || r !== cell[0] || c !== cell[1]);
    if (hidden) b.grid[hidden[0]][hidden[1]] = null;
    const len = pathLen(res.path);
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
    this.ghosts = [];
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
    drawEgg(this.g, U, x, y, color, a, rot);
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
    drawBack(g, CW, CH, b.spec.n - 1);
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
    drawCeiling(g, CW, top);
    // яйца — вместе с потолком
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const v = b.grid[r][c];
        if (v == null) continue;
        const [x, y] = b.center(r, c);
        this.egg(x, y, v);
      }
    for (const [r, c, col] of this.ghosts) {
      const [x, y] = b.center(r, c);
      this.egg(x, y, col);
    }
    g.restore();
    // черта: красная, светится сильнее, когда яйца близко
    let lowest = 0;
    for (let r = 0; r < ROWS; r++) if (b.grid[r].some((v) => v != null)) lowest = r;
    const near = lowest + b.drops >= DEAD_ROW - 2 ? 0.5 + 0.5 * Math.sin(this.t * 10) : 0;
    drawLine(g, U, CW, near);
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
      drawAim(g, U, b.trace(this.aim).path, b.cur);
    }
    // летящее яйцо
    if (this.flying) {
      const [fx, fy] = along(this.flying.path, this.flying.t);
      this.egg(fx, fy, this.flying.color);
    }
    // динозаврик: резиновая игрушка сидит внизу и наклоняется туда, куда целится
    const [ex, ey] = drawDino(g, U, this.aim);
    if (!this.flying) this.egg(ex, ey, b.cur);
    this.egg(FIELD_W / 2 + 1.9, SHOOTER_Y + 1.1, b.next, 0.9);
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
  net: { label: 'Дуэль и битва', hint: 'по сети или с ботами: падлянки сопернику, до десяти игроков', load: () => import('./net').then((m) => m.default) },
  mount(root, opts) {
    return new Game(root, opts);
  },
};

export default mod;
