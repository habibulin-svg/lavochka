/* Камера для больших полей (менеджеры, «Вестерн» и подобные) — по образцу кинь-двинь: поле целиком вписано в окно, приближение
 * колесом, щипком и кнопками, сдвиг перетаскиванием, миникарта при зуме (уходит из угла, где фишки), кнопки «Вся карта», «Где ход»,
 * «Следить». Слежение за ходом — с мёртвой зоной: пока нужное в средней части кадра, камера стоит; дальние перелёты — с отъездом.
 * Игрок сам двинул камеру — она не мешает ему до его следующего хода (release).
 *
 * Разметка: wrap (окно, position: relative) → board (поле: картинка и всё, что на нём, в координатах поля). Камера ставит board
 * размер «поле целиком» и transform; кнопки и миникарту добавляет в wrap сама. Координаты точек — в пикселях картинки поля. */
import { h } from './util';
import './boardcam.css';

export interface CamPoint {
  x: number;
  y: number;
}

export interface CamDot extends CamPoint {
  key: number;
  /** Картинка фишки (пуговица) или цвет. */
  img?: string;
  color?: string;
  on?: boolean;
}

export interface BoardCamOpts {
  /** Размер картинки поля (в её пикселях заданы все точки). */
  w: number;
  h: number;
  /** Миникарта. */
  mini: string;
  /** Размер фишки — доля ширины поля (запас вокруг клеток в кадре). */
  token: number;
  /** Ширина исходной картинки — до её разрешения можно приближать. */
  src?: number;
  /** Ключ localStorage для «Следить». */
  followKey: string;
  demo: boolean;
  speed: () => number;
  /** Фишки на миникарте. */
  dots: () => CamDot[];
  /** Места поля, которые миникарта тоже не закрывает (клетка, куда игрок ставит фишку). */
  spots?: () => CamPoint[];
  /** «Где ход» (и первый кадр): что показать. */
  turn: () => CamPoint[];
  /** Камера сдвинулась (для отрисовки того, что живёт в экранных координатах). */
  moved?: () => void;
}

interface Cam {
  z: number;
  fx: number;
  fy: number;
}

const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
/** Место под кнопками вида внизу. */
const BAR = 54;

export class BoardCam {
  bw = 0;
  bh = 0;
  private cam: Cam = { z: 1, fx: 0.5, fy: 0.5 };
  private goal: (Cam & { ax?: number; ay?: number; bx?: number; by?: number }) | null = null;
  private tween: { from: Cam; to: Cam; t0: number; ms: number; bump: number; done: () => void } | null = null;
  private raf = 0;
  follow = true;
  /** Игрок сам двигал камеру. */
  manual = false;
  /** Масштаб, который держит слежение (0 — первого кадра ещё не было). */
  private pz = 0;
  private ptrs = new Map<number, { x: number; y: number }>();
  private gesture: { x0: number; y0: number; moved: boolean; dist?: number } | null = null;
  private eat = false;
  private oy = 0;
  private corner: 'bl' | 'tl' | 'tr' = 'bl';
  private mini: HTMLElement;
  private miniVp: HTMLElement;
  private miniDots = new Map<number, HTMLElement>();
  private bar: HTMLElement;
  private followBtn: HTMLButtonElement;
  private ready = false;
  private ro: ResizeObserver;

  constructor(
    private wrap: HTMLElement,
    private board: HTMLElement,
    private o: BoardCamOpts
  ) {
    try {
      this.follow = localStorage.getItem(o.followKey) !== '0';
    } catch {
      /* по умолчанию — следить */
    }
    wrap.classList.add('bc-wrap');
    board.classList.add('bc-board');
    this.mini = h(`<div class="bc-mini" hidden><img alt="" draggable="false" src="${o.mini}"><div class="bc-mini-vp"></div></div>`);
    this.mini.style.aspectRatio = `${o.w} / ${o.h}`;
    this.miniVp = this.mini.querySelector('.bc-mini-vp') as HTMLElement;
    this.bar = h(`<div class="bc-cam">
        <button class="bc-cb" data-z="all" title="Вся карта (0)"><b>⤢</b><span>Вся карта</span></button>
        <button class="bc-cb" data-z="turn" title="Показать, где ход"><b>◎</b><span>Где ход</span></button>
        <button class="bc-cb bc-follow" data-z="follow" title="Камера сама следит за ходом"><b>●</b><span>Следить</span></button>
        <span class="bc-zoom"><button class="bc-cb" data-z="out" title="Отдалить (−)"><b>−</b></button><button class="bc-cb" data-z="in" title="Приблизить (+)"><b>+</b></button></span>
      </div>`);
    this.bar.hidden = o.demo;
    this.followBtn = this.bar.querySelector('.bc-follow') as HTMLButtonElement;
    this.followBtn.classList.toggle('on', this.follow);
    wrap.append(this.mini, this.bar);
    this.bar.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const z = ((e.target as HTMLElement).closest('[data-z]') as HTMLElement | null)?.dataset.z;
      if (z === 'in') this.zoomBy(1.6);
      else if (z === 'out') this.zoomBy(1 / 1.6);
      else if (z === 'all') this.overview();
      else if (z === 'turn') {
        this.manual = false;
        void this.frame(this.o.turn(), [], true);
      } else if (z === 'follow') {
        this.follow = !this.follow;
        this.manual = false;
        this.followBtn.classList.toggle('on', this.follow);
        try {
          localStorage.setItem(o.followKey, this.follow ? '1' : '0');
        } catch {
          /* без сохранения */
        }
        if (this.follow) void this.frame(this.o.turn(), [], true);
      }
    });
    this.mini.addEventListener('pointerdown', (e) => {
      e.stopPropagation();
      const r = this.mini.getBoundingClientRect();
      this.manual = true;
      void this.fly({ z: this.cam.z, fx: (e.clientX - r.left) / r.width, fy: (e.clientY - r.top) / r.height });
    });
    this.mini.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
    });
    if (!o.demo) {
      wrap.addEventListener('wheel', this.onWheel, { passive: false });
      wrap.addEventListener('pointerdown', this.onDown);
      wrap.addEventListener('pointermove', this.onMove);
      wrap.addEventListener('pointerup', this.onUp);
      wrap.addEventListener('pointercancel', this.onUp);
      // перетаскивание — не нажатие
      wrap.addEventListener('click', this.onClickCapture, true);
      document.addEventListener('keydown', this.onKey);
    }
    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(wrap);
  }

  destroy() {
    this.ro.disconnect();
    document.removeEventListener('keydown', this.onKey);
    cancelAnimationFrame(this.raf);
  }

  /** Другое поле: миникарта и сброс кадра. */
  setMini(src: string) {
    (this.mini.querySelector('img') as HTMLImageElement).src = src;
    this.cam = { z: 1, fx: 0.5, fy: 0.5 };
    this.pz = 0;
    this.ready = false;
    this.apply(this.cam);
  }

  get zoom() {
    return this.cam.z;
  }

  /** Поле видно (картинка загрузилась): можно делать первый крупный кадр. */
  shown() {
    this.ready = true;
    this.fit();
  }

  /** Игроку снова можно следить за ходом сам — камера опять ведёт (его ход). */
  release() {
    this.manual = false;
  }

  private vp() {
    return { w: this.wrap.clientWidth, h: this.wrap.clientHeight };
  }

  private maxZ() {
    if (!this.bw) return 4;
    return Math.max(2.5, Math.min(6, ((this.o.src ?? this.o.w) * 1.3) / this.bw));
  }

  fit() {
    const r = this.vp();
    const k = Math.min(Math.max(0, r.w - 12) / this.o.w, Math.max(0, r.h - (this.o.demo ? 12 : BAR + 8)) / this.o.h);
    this.bw = this.o.w * k;
    this.bh = this.o.h * k;
    this.board.style.width = `${this.bw}px`;
    this.board.style.height = `${this.bh}px`;
    this.board.style.setProperty('--u', this.bw / 100 + 'px');
    this.wrap.style.setProperty('--u', this.bw / 100 + 'px');
    this.apply(this.cam);
    if (!this.pz && this.bw && this.ready && !this.o.demo) void this.frame(this.o.turn());
  }

  private clamp(c: Cam): Cam {
    const r = this.vp();
    const z = Math.max(1, Math.min(this.maxZ(), c.z));
    const cl = (f: number, size: number, view: number) => {
      const half = view / (2 * z * size);
      return half >= 0.5 ? 0.5 : Math.max(half, Math.min(1 - half, f));
    };
    return { z, fx: cl(c.fx, this.bw || 1, r.w), fy: cl(c.fy, this.bh || 1, r.h) };
  }

  private apply(c: Cam) {
    if (!this.bw) return;
    const r = this.vp();
    this.cam = this.clamp(c);
    const { z, fx, fy } = this.cam;
    // общая карта чуть выше центра — под ней кнопки вида
    this.oy = this.o.demo ? 0 : (BAR / 2) * Math.max(0, Math.min(1, 2 - z));
    this.board.style.transform = `translate(${r.w / 2 - fx * this.bw * z}px, ${r.h / 2 - this.oy - fy * this.bh * z}px) scale(${z})`;
    this.wrap.classList.toggle('bc-zoomed', z > 1.02);
    this.mini.hidden = z < 1.15 || this.o.demo;
    this.drawMini();
    this.o.moved?.();
  }

  /** Точка поля → экран (относительно wrap). */
  toScreen(p: CamPoint) {
    const r = this.vp();
    const { z, fx, fy } = this.cam;
    return { x: r.w / 2 - fx * this.bw * z + (p.x / this.o.w) * this.bw * z, y: r.h / 2 - this.oy - fy * this.bh * z + (p.y / this.o.h) * this.bh * z };
  }

  /** Экран (clientX/Y) → точка поля. */
  toImg(clientX: number, clientY: number): CamPoint {
    const r = this.board.getBoundingClientRect();
    return { x: ((clientX - r.left) / r.width) * this.o.w, y: ((clientY - r.top) / r.height) * this.o.h };
  }

  private step = (now: number) => {
    this.raf = 0;
    const tw = this.tween;
    if (tw) {
      const t = Math.min(1, (now - tw.t0) / tw.ms);
      const e = ease(t);
      const lz = Math.log(tw.from.z) + (Math.log(tw.to.z) - Math.log(tw.from.z)) * e - tw.bump * Math.sin(Math.PI * t);
      this.apply({ z: Math.exp(lz), fx: tw.from.fx + (tw.to.fx - tw.from.fx) * e, fy: tw.from.fy + (tw.to.fy - tw.from.fy) * e });
      if (t >= 1) {
        this.tween = null;
        this.board.classList.remove('bc-moving');
        tw.done();
      } else this.raf = requestAnimationFrame(this.step);
      return;
    }
    const g = this.goal;
    if (!g) return;
    let z = Math.exp(Math.log(this.cam.z) + (Math.log(g.z) - Math.log(this.cam.z)) * 0.25);
    if (Math.abs(Math.log(g.z / z)) < 0.002) z = g.z;
    let fx: number;
    let fy: number;
    if (g.ax != null) {
      const r = this.vp();
      fx = (r.w / 2 - g.ax + g.bx! * z) / z / this.bw;
      fy = (r.h / 2 - this.oy - g.ay! + g.by! * z) / z / this.bh;
    } else {
      fx = this.cam.fx + (g.fx - this.cam.fx) * 0.25;
      fy = this.cam.fy + (g.fy - this.cam.fy) * 0.25;
    }
    this.apply({ z, fx, fy });
    if (z === g.z && (g.ax != null || (Math.abs(fx - g.fx) < 1e-4 && Math.abs(fy - g.fy) < 1e-4))) {
      this.goal = null;
      this.board.classList.remove('bc-moving');
    } else this.raf = requestAnimationFrame(this.step);
  };

  private kick() {
    this.board.classList.add('bc-moving');
    if (!this.raf) this.raf = requestAnimationFrame(this.step);
  }

  private stop() {
    if (this.tween) {
      const d = this.tween.done;
      this.tween = null;
      d();
    }
    this.goal = null;
    this.board.classList.remove('bc-moving');
  }

  private zoomAt(px: number, py: number, z: number) {
    if (this.tween) this.stop();
    const cur = this.cam;
    const r = this.vp();
    const tz = this.clamp({ ...cur, z }).z;
    const base = this.goal?.ax != null && Math.abs(this.goal.ax - px) < 2 && Math.abs(this.goal.ay! - py) < 2 ? this.goal : null;
    const bx = base ? base.bx! : (px - (r.w / 2 - cur.fx * this.bw * cur.z)) / cur.z;
    const by = base ? base.by! : (py - (r.h / 2 - this.oy - cur.fy * this.bh * cur.z)) / cur.z;
    this.goal = { z: tz, fx: cur.fx, fy: cur.fy, ax: px, ay: py, bx, by };
    this.kick();
  }

  zoomBy(k: number) {
    const r = this.vp();
    this.manual = true;
    this.zoomAt(r.w / 2, r.h / 2, (this.goal?.z ?? this.cam.z) * k);
    this.pz = this.goal?.z ?? this.cam.z;
  }

  overview() {
    this.manual = true;
    this.pz = 1;
    void this.fly({ z: 1, fx: 0.5, fy: 0.5 });
  }

  /** Перелёт: на дальних переходах камера отъезжает, чтобы было видно, откуда и куда. */
  private fly(to: Cam, ms?: number): Promise<void> {
    this.stop();
    const from = { ...this.cam };
    to = this.clamp(to);
    const r = this.vp();
    const dx = Math.abs(to.fx - from.fx) * this.bw;
    const dy = Math.abs(to.fy - from.fy) * this.bh;
    const zBoth = Math.max(1, Math.min(r.w / (dx + r.w / Math.max(from.z, to.z)), r.h / (dy + r.h / Math.max(from.z, to.z))));
    const mid = (Math.log(from.z) + Math.log(to.z)) / 2;
    const bump = Math.max(0, mid - Math.log(zBoth));
    const far = Math.hypot(dx * from.z, dy * from.z) / Math.max(1, Math.hypot(r.w, r.h));
    const dur = ms ?? Math.min(1500, 450 + 380 * bump + 250 * Math.min(1, far));
    if (Math.abs(Math.log(to.z / from.z)) < 0.01 && dx < 1 && dy < 1) {
      this.apply(to);
      return Promise.resolve();
    }
    return new Promise((done) => {
      this.tween = { from, to, t0: performance.now(), ms: dur / Math.max(0.5, this.o.speed()), bump, done };
      this.kick();
    });
  }

  /** Показать точки pts (ход); others — тоже желательно в кадре (остальные фишки). force — по кнопке, даже без слежения. */
  frame(pts: CamPoint[], others: CamPoint[] = [], force = false): Promise<void> {
    if (!this.bw || !pts.length || this.o.demo || (!force && (!this.follow || this.manual))) return Promise.resolve();
    if (!force && this.gesture) return Promise.resolve();
    const r = this.vp();
    const tk = this.o.token;
    const first = !this.pz;
    if (force || first) {
      // крупно: фишка на экране — около 44 px
      this.pz = Math.max(1.6, Math.min(this.maxZ() * 0.8, 44 / (tk * this.bw)));
      const xs = pts.map((p) => p.x / this.o.w);
      const ys = pts.map((p) => p.y / this.o.h);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
      const w = (x1 - x0 + tk * 6) * this.bw;
      const hh = (y1 - y0) * this.bh + tk * 6 * this.bw;
      return this.fly({ z: Math.max(1, Math.min(this.pz, r.w / w, r.h / hh)), fx: (x0 + x1) / 2, fy: (y0 + y1) / 2 });
    }
    // мёртвая зона: пока нужное в средней части кадра, камера стоит; масштаб держится, отъезд — если не влезает
    const c = this.cam;
    const p = tk * 1.5;
    const py = (p * this.bw) / this.bh;
    const all = [...pts, ...others];
    const bx = all.map((q) => q.x / this.o.w);
    const by = all.map((q) => q.y / this.o.h);
    const [x0, x1, y0, y1] = [Math.min(...bx), Math.max(...bx), Math.min(...by), Math.max(...by)];
    const fitZ = Math.min((r.w * 0.8) / ((x1 - x0 + 2 * p) * this.bw), ((r.h - BAR) * 0.8) / ((y1 - y0 + 2 * py) * this.bh));
    const bz = Math.min(this.pz, fitZ);
    const z = this.clamp({ ...c, z: c.z > fitZ ? fitZ : c.z < bz * 0.75 ? bz : c.z }).z;
    const axis = (f: number, lo: number, hi: number, view: number, size: number, p: number) => {
      const half = view / (2 * z * size);
      if (lo - p >= f - half * 0.8 && hi + p <= f + half * 0.8) return f;
      const aim = Math.min(half * 0.8, Math.max(half * 0.5, (hi - lo) / 2 + p));
      return Math.max(hi + p - aim, Math.min(lo - p + aim, f));
    };
    const to = this.clamp({ z, fx: axis(c.fx, x0, x1, r.w, this.bw, p), fy: axis(c.fy, y0, y1, r.h, this.bh, py) });
    const still = Math.abs(Math.log(to.z / c.z)) < 0.03 && Math.abs(to.fx - c.fx) * this.bw * z < 2 && Math.abs(to.fy - c.fy) * this.bh * z < 2;
    return still ? Promise.resolve() : this.fly(to);
  }

  private drawMini() {
    if (this.mini.hidden) return;
    const r = this.vp();
    const { z, fx, fy } = this.cam;
    const w = Math.min(1, r.w / (z * this.bw));
    const hh = Math.min(1, r.h / (z * this.bh));
    Object.assign(this.miniVp.style, { left: `${(fx - w / 2) * 100}%`, top: `${(fy - hh / 2) * 100}%`, width: `${w * 100}%`, height: `${hh * 100}%` });
    const dots = this.o.dots();
    const keep = new Set<number>();
    for (const d of dots) {
      keep.add(d.key);
      let el = this.miniDots.get(d.key);
      if (!el) {
        el = h(`<i class="bc-mini-dot"></i>`);
        if (d.img) el.style.backgroundImage = `url(${d.img})`;
        else if (d.color) el.style.background = d.color;
        this.mini.appendChild(el);
        this.miniDots.set(d.key, el);
      }
      el.style.left = `${(d.x / this.o.w) * 100}%`;
      el.style.top = `${(d.y / this.o.h) * 100}%`;
      el.classList.toggle('on', !!d.on);
    }
    for (const [k, el] of this.miniDots)
      if (!keep.has(k)) {
        el.remove();
        this.miniDots.delete(k);
      }
    // миникарта не закрывает фишки
    const mw = this.mini.offsetWidth;
    const mh = this.mini.offsetHeight;
    if (!mw || !mh) return;
    const pts = [...dots, ...(this.o.spots?.() ?? [])].map((d) => this.toScreen(d));
    const pad = 28;
    const free = (c: 'bl' | 'tl' | 'tr') => {
      const x0 = c === 'tr' ? r.w - 10 - mw : 10;
      const y0 = c === 'bl' ? r.h - 10 - mh : 10;
      return !pts.some((p) => p.x > x0 - pad && p.x < x0 + mw + pad && p.y > y0 - pad && p.y < y0 + mh + pad);
    };
    if (!free(this.corner)) {
      const next = (['bl', 'tl', 'tr'] as const).find(free);
      if (next) this.corner = next;
    } else if (this.corner !== 'bl' && free('bl')) this.corner = 'bl';
    this.mini.dataset.corner = this.corner;
  }

  // ---------- жесты ----------

  private onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (!this.wrap.isConnected) return;
    if (e.key === '+' || e.key === '=') this.zoomBy(1.6);
    else if (e.key === '-') this.zoomBy(1 / 1.6);
    else if (e.key === '0') this.overview();
  };

  private onWheel = (e: WheelEvent) => {
    if ((e.target as HTMLElement).closest('.bc-ui')) return;
    e.preventDefault();
    const r = this.wrap.getBoundingClientRect();
    this.manual = true;
    const dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
    const k = Math.exp(-Math.max(-120, Math.min(120, dy)) * 0.0035);
    this.zoomAt(e.clientX - r.left, e.clientY - r.top, (this.goal?.z ?? this.cam.z) * k);
    this.pz = this.goal?.z ?? this.cam.z;
  };

  private onDown = (e: PointerEvent) => {
    if ((e.target as HTMLElement).closest('.bc-cam, .bc-mini, .bc-ui, button, a, input')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (!this.ptrs.size) this.eat = false;
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.ptrs.size === 2) {
      this.stop();
      const [a, b] = [...this.ptrs.values()];
      this.gesture = { x0: (a.x + b.x) / 2, y0: (a.y + b.y) / 2, moved: true, dist: Math.hypot(a.x - b.x, a.y - b.y) };
    } else this.gesture = { x0: e.clientX, y0: e.clientY, moved: false };
  };

  private onMove = (e: PointerEvent) => {
    const p = this.ptrs.get(e.pointerId);
    const g = this.gesture;
    if (!p || !g) return;
    p.x = e.clientX;
    p.y = e.clientY;
    const r = this.wrap.getBoundingClientRect();
    if (this.ptrs.size >= 2) {
      const [a, b] = [...this.ptrs.values()];
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      this.manual = true;
      this.panBy(mx - g.x0, my - g.y0);
      if (g.dist) this.pinch(mx - r.left, my - r.top, dist / g.dist);
      g.x0 = mx;
      g.y0 = my;
      g.dist = dist;
      return;
    }
    const dx = e.clientX - g.x0;
    const dy = e.clientY - g.y0;
    if (!g.moved && Math.hypot(dx, dy) < 6) return;
    if (this.cam.z <= 1.02) return;
    if (!g.moved) {
      this.stop();
      this.wrap.setPointerCapture(e.pointerId);
    }
    g.moved = true;
    this.manual = true;
    this.panBy(dx, dy);
    g.x0 = e.clientX;
    g.y0 = e.clientY;
  };

  private panBy(dx: number, dy: number) {
    const c = this.cam;
    this.apply({ z: c.z, fx: c.fx - dx / (this.bw * c.z), fy: c.fy - dy / (this.bh * c.z) });
  }

  private pinch(px: number, py: number, k: number) {
    const c = this.cam;
    const r = this.vp();
    const z = Math.max(1, Math.min(this.maxZ(), c.z * k));
    const bx = (px - (r.w / 2 - c.fx * this.bw * c.z)) / c.z;
    const by = (py - (r.h / 2 - this.oy - c.fy * this.bh * c.z)) / c.z;
    this.apply({ z, fx: (r.w / 2 - px + bx * z) / z / this.bw, fy: (r.h / 2 - this.oy - py + by * z) / z / this.bh });
    this.pz = this.cam.z;
  }

  private onUp = (e: PointerEvent) => {
    if (!this.ptrs.delete(e.pointerId)) return;
    const g = this.gesture;
    if (this.ptrs.size) {
      const [a] = [...this.ptrs.values()];
      this.gesture = { x0: a.x, y0: a.y, moved: true };
      this.eat = true;
      return;
    }
    this.gesture = null;
    if (g?.moved) this.eat = true;
  };

  private onClickCapture = (e: MouseEvent) => {
    if (!this.eat) return;
    this.eat = false;
    e.stopPropagation();
    e.preventDefault();
  };
}
