/* «Шарики» — экран: карта ста уровней (тетрадный лист) и поле — двор (три фона по очереди), канавка-спираль, открытый люк в конце,
 * цепочка стеклянных шариков (катятся — крутятся), резиновая лягушка в середине (поворачивается за указателем, шар во рту
 * и следующий на спине). Лопнули — осколки, очки, «Комбо ×N», тряска. Нажать — выстрел, правая кнопка или пробел — поменять шары.
 * На телефоне — нажать, куда стрелять; кнопка «⇄» — поменять. Прогресс — на этом устройстве. Картинки — tools/arcade-art. */
import type { ArcadeModule, ArcadeOpts } from '../../core/arcade';
import { cover, Fx, Sprites } from '../../core/arcade-fx';
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

const BALL = ['ball0', 'ball1', 'ball2', 'ball3', 'ball4', 'ball5'] as const;
const BG = ['bg1', 'bg2', 'bg3'] as const;
const ART = new Sprites('shariki', [...BG, ...BALL, 'frog', 'hole', 'map'] as const);

class Game {
  private el: HTMLElement;
  private z: Zuma | null = null;
  private cv!: HTMLCanvasElement;
  private g!: CanvasRenderingContext2D;
  private raf = 0;
  private last = 0;
  private ended = false;
  private fx = new Fx();
  private t = 0;
  /** Отдача лягушки после выстрела (1 → 0). */
  private kick = 0;
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
    window.addEventListener('resize', this.onResize);
    this.showMap();
  }

  /** Экран выше, чем шире (телефон стоя), — поле повёрнуто на 90°: двор снят сверху, так он занимает весь экран. */
  private turned = false;
  private onResize = () => {
    if (this.z && this.isTall() !== this.turned) this.layout();
  };
  private isTall = () => window.innerHeight > window.innerWidth * 1.1;

  private layout() {
    this.turned = this.isTall();
    this.el.classList.toggle('zm-tall', this.turned);
    this.cv.width = (this.turned ? FH : FW) * 2;
    this.cv.height = (this.turned ? FW : FH) * 2;
    // поле (x, y) → холст (FH − y, x)
    if (this.turned) this.g.setTransform(0, 2, -2, 0, FH * 2, 0);
    else this.g.setTransform(2, 0, 0, 2, 0, 0);
    this.fx.textAngle = this.turned ? -Math.PI / 2 : 0;
  }

  private showMap() {
    this.el.classList.remove('zm-tall');
    cancelAnimationFrame(this.raf);
    this.z = null;
    const pr = loadProgress();
    let s = `<div class="zm-map" style="--map:url('${ART.url('map')}')"><div class="zm-map-t">Сто дорожек — выберите уровень</div><div class="zm-grid">`;
    for (let n = 1; n <= 100; n++) {
      const open = n <= pr.open;
      const ball = open ? ` style="--ball:url('${ART.url(BALL[(n - 1) % 6])}')"` : '';
      s += `<button class="zm-lv${open ? '' : ' locked'}${pr.best[n] ? ' done' : ''}" data-n="${n}"${ball} ${open ? '' : 'disabled'}><b>${n}</b><span>${pr.best[n] ? pr.best[n] : open ? '' : '🔒'}</span></button>`;
    }
    this.el.innerHTML = s + '</div></div>';
    this.el.querySelectorAll<HTMLButtonElement>('.zm-lv').forEach((b) => (b.onclick = () => this.start(+b.dataset.n!)));
    this.el.querySelector(`[data-n="${Math.min(100, pr.open)}"]`)?.scrollIntoView({ block: 'center' });
  }

  private start(n: number) {
    Sound.ui();
    this.z = new Zuma(n, (Math.random() * 1e9) | 0);
    this.ended = false;
    this.fx = new Fx();
    this.el.innerHTML = `<div class="zm-play"><div class="zm-hud"></div><canvas></canvas>
      <div class="zm-btns"><button class="btn" data-b="map">← Уровни</button><button class="btn" data-b="swap">⇄ Поменять</button><button class="btn" data-b="again">Заново</button></div></div>`;
    this.cv = this.el.querySelector('canvas') as HTMLCanvasElement;
    this.g = this.cv.getContext('2d')!;
    this.layout();
    (this.el.querySelector('[data-b=map]') as HTMLButtonElement).onclick = () => this.showMap();
    (this.el.querySelector('[data-b=again]') as HTMLButtonElement).onclick = () => this.start(n);
    (this.el.querySelector('[data-b=swap]') as HTMLButtonElement).onclick = () => this.z?.swap();
    // точка экрана → точка поля (в повёрнутом поле экранный y — это x поля)
    const local = (e: PointerEvent) => {
      const r = this.cv.getBoundingClientRect();
      const u = (e.clientX - r.left) / r.width;
      const v = (e.clientY - r.top) / r.height;
      return this.turned ? { x: v * FW, y: (1 - u) * FH } : { x: u * FW, y: v * FH };
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
      const before = z.shots.length;
      z.shoot();
      if (z.shots.length > before) this.kick = 1;
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
    this.t += dt / 1000;
    this.kick = Math.max(0, this.kick - dt / 180);
    for (const s of z.sounds) {
      if (s === 'shot') Sound.beep(900, 0.03, 0.08);
      else if (s === 'hit') Sound.beep(500, 0.03, 0.08);
      else if (s === 'win') Sound.win();
      else if (s === 'lose') Sound.nomove();
    }
    z.sounds.length = 0;
    for (const p of z.pops) {
      const [c] = COLORS[p.color % COLORS.length];
      for (const [x, y] of p.pts) this.fx.burst(x, y, c, 7, 200, 4);
      const [mx, my] = p.pts[p.pts.length >> 1];
      this.fx.text(mx, my - 14, `+${p.points}`, '#fff6c0', 30);
      if (p.combo > 1) {
        this.fx.text(mx, my - 44, `Комбо ×${p.combo}`, '#ffd040', 36 + Math.min(4, p.combo) * 4);
        this.fx.shake(3 + p.combo * 1.5);
      }
      // звон стекла: каждое следующее комбо — выше
      Sound.beep(1200 + Math.min(6, p.combo) * 260, 0.06, 0.1);
      Sound.capture();
    }
    z.pops.length = 0;
    this.fx.update(dt);
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

  /** Шарик: картинка (крутится — rot), пока не загрузилась — градиент. */
  private ball(x: number, y: number, color: number, r = D / 2, rot = 0) {
    const g = this.g;
    const im = ART.get(BALL[color % BALL.length]);
    if (im) {
      g.save();
      g.translate(x, y);
      g.rotate(rot);
      g.drawImage(im, -r * 1.1, -r * 1.1, r * 2.2, r * 2.2);
      g.restore();
      return;
    }
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
    g.save();
    const [ox, oy] = this.fx.offset();
    g.translate(ox, oy);
    // двор: у каждого третьего уровня свой фон
    const bgi = ART.get(BG[(z.spec.n - 1) % 3]);
    if (bgi) cover(g, bgi, -8, -8, FW + 16, FH + 16);
    else {
      const bg = g.createRadialGradient(FW / 2, FH / 2, 50, FW / 2, FH / 2, FW * 0.7);
      bg.addColorStop(0, '#b8a070');
      bg.addColorStop(1, '#7a6a3a');
      g.fillStyle = bg;
      g.fillRect(0, 0, FW, FH);
    }
    // канавка: светлый край сверху-слева, тёмная выемка, тень внутри
    const pts = z.path.pts;
    g.lineCap = 'round';
    g.lineJoin = 'round';
    g.beginPath();
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.save();
    g.translate(-1.5, -1.5);
    g.strokeStyle = 'rgba(255,240,210,0.35)';
    g.lineWidth = D + 12;
    g.stroke();
    g.restore();
    g.strokeStyle = 'rgba(35,25,15,0.7)';
    g.lineWidth = D + 10;
    g.stroke();
    g.strokeStyle = 'rgba(70,55,35,0.85)';
    g.lineWidth = D + 2;
    g.stroke();
    g.save();
    g.translate(2, 3);
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = D - 6;
    g.stroke();
    g.restore();
    // люк в конце; голова цепочки близко — вокруг люка красное свечение
    const [hx, hy] = pts[pts.length - 1];
    const pulse = z.danger() > 0.8 ? 0.5 + 0.5 * Math.sin(this.t * 12) : 0;
    if (pulse) {
      const glow = g.createRadialGradient(hx, hy, 10, hx, hy, 70);
      glow.addColorStop(0, `rgba(255,40,20,${0.55 * pulse})`);
      glow.addColorStop(1, 'rgba(255,40,20,0)');
      g.fillStyle = glow;
      g.fillRect(hx - 70, hy - 70, 140, 140);
    }
    const hole = ART.get('hole');
    if (hole) g.drawImage(hole, hx - 62, hy - 62, 124, 124);
    else {
      const hg = g.createRadialGradient(hx, hy, 4, hx, hy, 34);
      hg.addColorStop(0, '#000');
      hg.addColorStop(1, 'rgba(30,20,10,0.5)');
      g.fillStyle = hg;
      g.beginPath();
      g.arc(hx, hy, 34, 0, Math.PI * 2);
      g.fill();
    }
    // цепочка: тени, потом шарики (поворот по пройденному пути — катятся)
    g.fillStyle = 'rgba(0,0,0,0.28)';
    for (const b of z.balls) {
      if (b.s < 0) continue;
      const [x, y] = z.at(b.s);
      g.beginPath();
      g.arc(x + 3, y + 4, D / 2, 0, Math.PI * 2);
      g.fill();
    }
    for (const b of z.balls) {
      if (b.s < 0) continue;
      const [x, y] = z.at(b.s);
      this.ball(x, y, b.color, D / 2, b.s / (D / 2));
    }
    // выстрелы
    for (const s of z.shots) this.ball(s.x, s.y, s.color, D / 2, this.t * 10);
    // прицел: точки цвета шара во рту
    const { x, y } = z.spec.frog;
    const ca = Math.cos(z.aim);
    const sa = Math.sin(z.aim);
    g.fillStyle = COLORS[z.cur % COLORS.length][1];
    for (let d = 70; d < 300; d += 18) {
      g.globalAlpha = 0.6 * (1 - (d - 70) / 230);
      g.beginPath();
      g.arc(x + ca * d, y + sa * d, 2.6, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    // лягушка (на картинке рот смотрит вверх), после выстрела — отдача назад
    const fx = x - ca * this.kick * 7;
    const fy = y - sa * this.kick * 7;
    g.save();
    g.translate(fx, fy);
    g.rotate(z.aim + Math.PI / 2);
    g.fillStyle = 'rgba(0,0,0,0.3)';
    g.beginPath();
    g.ellipse(5, 10, 50, 56, 0, 0, Math.PI * 2);
    g.fill();
    const frog = ART.get('frog');
    if (frog) g.drawImage(frog, -76, -76, 152, 152);
    else {
      const body = g.createRadialGradient(-10, -10, 5, 0, 0, 46);
      body.addColorStop(0, '#8ad860');
      body.addColorStop(1, '#2a7a1a');
      g.fillStyle = body;
      g.beginPath();
      g.ellipse(0, 0, 38, 44, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.restore();
    // шар во рту и следующий на спине
    this.ball(fx + ca * 54, fy + sa * 54, z.cur);
    this.ball(fx - ca * 30, fy - sa * 30, z.next, 9);
    this.fx.draw(g);
    g.restore();
    // опасно: края поля краснеют
    if (pulse) {
      const v = g.createRadialGradient(FW / 2, FH / 2, FH * 0.45, FW / 2, FH / 2, FW * 0.65);
      v.addColorStop(0, 'rgba(200,0,0,0)');
      v.addColorStop(1, `rgba(200,0,0,${0.35 * pulse})`);
      g.fillStyle = v;
      g.fillRect(0, 0, FW, FH);
    }
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('resize', this.onResize);
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
