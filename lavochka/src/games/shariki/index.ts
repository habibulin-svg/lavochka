/* «Шарики» — экран: карта ста уровней и поле — двор, канавка-спираль, яма в конце, цепочка блестящих шаров, лягушка в середине
 * (поворачивается за указателем, шар во рту и следующий на спине). Нажать — выстрел, правая кнопка или пробел — поменять шары.
 * На телефоне — нажать, куда стрелять; кнопка «⇄» — поменять. Прогресс — на этом устройстве. */
import type { ArcadeModule, ArcadeOpts } from '../../core/arcade';
import { Sound } from '../../core/audio';
import { store } from '../../core/settings';
import { h } from '../../core/util';
import { D, FH, FW, Zuma } from './logic';
import './shariki.css';

const KEY = 'shariki.progress';
const COLORS = [
  ['#e8302a', '#ff9a8a'],
  ['#f0c020', '#fff0a0'],
  ['#2a9a3a', '#9af0a0'],
  ['#2a5ad8', '#a0c0ff'],
  ['#9a3ac8', '#e0a8ff'],
  ['#f4f4f0', '#ffffff'],
];

interface Progress {
  open: number;
  best: Record<number, number>;
}
const loadProgress = (): Progress => store.get<Progress>(KEY, { open: 1, best: {} });

class Game {
  private el: HTMLElement;
  private z: Zuma | null = null;
  private cv!: HTMLCanvasElement;
  private g!: CanvasRenderingContext2D;
  private raf = 0;
  private last = 0;
  private ended = false;
  private onKey = (e: KeyboardEvent) => {
    if (!this.z || (e.target as HTMLElement)?.tagName === 'INPUT') return;
    if (e.key === ' ') {
      e.preventDefault();
      this.z.swap();
      Sound.ui();
    }
  };

  constructor(
    root: HTMLElement,
    private opts: ArcadeOpts
  ) {
    this.el = h('<div class="zm-dev"></div>');
    root.appendChild(this.el);
    window.addEventListener('keydown', this.onKey);
    this.showMap();
  }

  private showMap() {
    cancelAnimationFrame(this.raf);
    this.z = null;
    const pr = loadProgress();
    let s = '<div class="zm-map"><div class="zm-map-t">Сто дорожек — выберите уровень</div><div class="zm-grid">';
    for (let n = 1; n <= 100; n++) {
      const open = n <= pr.open;
      s += `<button class="zm-lv${open ? '' : ' locked'}${pr.best[n] ? ' done' : ''}" data-n="${n}" ${open ? '' : 'disabled'}><b>${n}</b><span>${pr.best[n] ? pr.best[n] : open ? '' : '🔒'}</span></button>`;
    }
    this.el.innerHTML = s + '</div></div>';
    this.el.querySelectorAll<HTMLButtonElement>('.zm-lv').forEach((b) => (b.onclick = () => this.start(+b.dataset.n!)));
    this.el.querySelector(`[data-n="${Math.min(100, pr.open)}"]`)?.scrollIntoView({ block: 'center' });
  }

  private start(n: number) {
    Sound.ui();
    this.z = new Zuma(n, (Math.random() * 1e9) | 0);
    this.ended = false;
    this.el.innerHTML = `<div class="zm-play"><div class="zm-hud"></div><canvas width="${FW * 2}" height="${FH * 2}"></canvas>
      <div class="zm-btns"><button class="btn" data-b="map">← Уровни</button><button class="btn" data-b="swap">⇄ Поменять</button><button class="btn" data-b="again">Заново</button></div></div>`;
    this.cv = this.el.querySelector('canvas') as HTMLCanvasElement;
    this.g = this.cv.getContext('2d')!;
    this.g.setTransform(2, 0, 0, 2, 0, 0);
    (this.el.querySelector('[data-b=map]') as HTMLButtonElement).onclick = () => this.showMap();
    (this.el.querySelector('[data-b=again]') as HTMLButtonElement).onclick = () => this.start(n);
    (this.el.querySelector('[data-b=swap]') as HTMLButtonElement).onclick = () => this.z?.swap();
    const local = (e: PointerEvent) => {
      const r = this.cv.getBoundingClientRect();
      return { x: ((e.clientX - r.left) / r.width) * FW, y: ((e.clientY - r.top) / r.height) * FH };
    };
    this.cv.addEventListener('pointermove', (e) => {
      const z = this.z;
      if (!z) return;
      const p = local(e);
      z.aim = Math.atan2(p.y - z.spec.frog.y, p.x - z.spec.frog.x);
    });
    this.cv.addEventListener('pointerdown', (e) => {
      const z = this.z;
      if (!z) return;
      Sound.unlock();
      if (e.button === 2) {
        z.swap();
        return;
      }
      const p = local(e);
      z.aim = Math.atan2(p.y - z.spec.frog.y, p.x - z.spec.frog.x);
      z.shoot();
    });
    this.cv.addEventListener('contextmenu', (e) => e.preventDefault());
    this.last = performance.now();
    cancelAnimationFrame(this.raf);
    const loop = (t: number) => {
      const dt = Math.min(50, t - this.last);
      this.last = t;
      this.tick(dt);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  private tick(dt: number) {
    const z = this.z;
    if (!z) return;
    z.update(dt);
    for (const s of z.sounds) {
      if (s === 'shot') Sound.beep(900, 0.03, 0.08);
      else if (s === 'hit') Sound.beep(500, 0.03, 0.08);
      else if (s === 'pop') Sound.capture();
      else if (s === 'combo') Sound.beep(1800, 0.08, 0.1);
      else if (s === 'win') Sound.win();
      else if (s === 'lose') Sound.nomove();
    }
    z.sounds.length = 0;
    this.draw();
    this.hud();
    if ((z.won || z.lost) && !this.ended) {
      this.ended = true;
      setTimeout(() => this.finish(), 600);
    }
  }

  private hud() {
    const z = this.z!;
    const left = z.spec.total - z.spawned + z.balls.length;
    (this.el.querySelector('.zm-hud') as HTMLElement).innerHTML = `<span>Уровень <b>${z.spec.n}</b></span><span>очки <b>${z.score}</b></span><span>шаров осталось <b>${left}</b></span>`;
  }

  private finish() {
    const z = this.z;
    if (!z) return;
    const pr = loadProgress();
    if (z.won) {
      pr.best[z.spec.n] = Math.max(pr.best[z.spec.n] ?? 0, z.score);
      pr.open = Math.max(pr.open, Math.min(100, z.spec.n + 1));
      store.set(KEY, pr);
      this.opts.onScore(Object.values(pr.best).reduce((a, x) => a + x, 0));
    }
    const box = h(`<div class="zm-end"><h2>${z.won ? 'Дорожка чистая!' : 'Шарики в яме'}</h2><p>Очки: <b>${z.score}</b></p>
      <div>${z.won && z.spec.n < 100 ? '<button class="btn primary" data-e="next">Дальше</button>' : ''}<button class="btn" data-e="again">Ещё раз</button><button class="btn" data-e="map">Уровни</button></div></div>`);
    this.el.querySelector('.zm-play')?.appendChild(box);
    (box.querySelector('[data-e=again]') as HTMLButtonElement).onclick = () => this.start(z.spec.n);
    (box.querySelector('[data-e=map]') as HTMLButtonElement).onclick = () => this.showMap();
    const nx = box.querySelector('[data-e=next]') as HTMLButtonElement | null;
    if (nx) nx.onclick = () => this.start(z.spec.n + 1);
  }

  private ball(x: number, y: number, color: number, r = D / 2) {
    const g = this.g;
    const [c, l] = COLORS[color % COLORS.length];
    const gr = g.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
    gr.addColorStop(0, l);
    gr.addColorStop(0.5, c);
    gr.addColorStop(1, 'rgba(0,0,0,0.6)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }

  private draw() {
    const z = this.z!;
    const g = this.g;
    // двор: утоптанная земля с травой
    const bg = g.createRadialGradient(FW / 2, FH / 2, 50, FW / 2, FH / 2, FW * 0.7);
    bg.addColorStop(0, '#b8a070');
    bg.addColorStop(1, '#7a6a3a');
    g.fillStyle = bg;
    g.fillRect(0, 0, FW, FH);
    // канавка
    const pts = z.path.pts;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(60,40,20,0.55)';
    g.lineWidth = D + 10;
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.stroke();
    g.strokeStyle = 'rgba(200,170,120,0.35)';
    g.lineWidth = D - 6;
    g.stroke();
    // яма
    const [hx, hy] = pts[pts.length - 1];
    const danger = z.danger();
    const hole = g.createRadialGradient(hx, hy, 4, hx, hy, 34);
    hole.addColorStop(0, '#000');
    hole.addColorStop(1, danger > 0.85 ? 'rgba(200,30,20,0.6)' : 'rgba(30,20,10,0.5)');
    g.fillStyle = hole;
    g.beginPath();
    g.arc(hx, hy, 34, 0, Math.PI * 2);
    g.fill();
    // цепочка
    for (const b of z.balls) {
      const [x, y] = z.at(b.s);
      if (b.s < 0) continue;
      this.ball(x, y, b.color);
    }
    // выстрелы
    for (const s of z.shots) this.ball(s.x, s.y, s.color);
    // лягушка
    const { x, y } = z.spec.frog;
    g.save();
    g.translate(x, y);
    g.rotate(z.aim + Math.PI / 2);
    g.fillStyle = 'rgba(0,0,0,0.25)';
    g.beginPath();
    g.ellipse(4, 6, 40, 46, 0, 0, Math.PI * 2);
    g.fill();
    const body = g.createRadialGradient(-10, -10, 5, 0, 0, 46);
    body.addColorStop(0, '#8ad860');
    body.addColorStop(1, '#2a7a1a');
    g.fillStyle = body;
    g.beginPath();
    g.ellipse(0, 0, 38, 44, 0, 0, Math.PI * 2);
    g.fill();
    // глаза
    for (const ex of [-16, 16]) {
      g.fillStyle = '#f4f4e0';
      g.beginPath();
      g.arc(ex, -30, 10, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#111';
      g.beginPath();
      g.arc(ex, -32, 4.5, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    // шар во рту и следующий на спине
    this.ball(x + Math.cos(z.aim) * 30, y + Math.sin(z.aim) * 30, z.cur);
    this.ball(x - Math.cos(z.aim) * 18, y - Math.sin(z.aim) * 18, z.next, 9);
    // прицел
    g.setLineDash([4, 8]);
    g.strokeStyle = 'rgba(255,255,255,0.35)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(x + Math.cos(z.aim) * 50, y + Math.sin(z.aim) * 50);
    g.lineTo(x + Math.cos(z.aim) * 220, y + Math.sin(z.aim) * 220);
    g.stroke();
    g.setLineDash([]);
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    this.el.remove();
  }
}

const mod: ArcadeModule = {
  kind: 'arcade',
  id: 'shariki',
  title: 'Шарики',
  about: 'Цепочка шариков катится по канавке к яме. Лягушка в середине стреляет шариками: три одного цвета подряд — исчезают. Сто уровней.',
  controls: `<p>Мышью — целиться, нажать — выстрел; правая кнопка или <kbd>Пробел</kbd> — поменять шар во рту и на спине.</p>
    <p>Разрыв в цепочке стягивается, если по краям одного цвета, — так получаются комбо. Докатился до ямы хоть один — уровень проигран.</p>`,
  modes: [{ id: 'levels', label: 'Сто уровней' }],
  mount(root, opts) {
    return new Game(root, opts);
  },
};

export default mod;
