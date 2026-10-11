/* Кинь-двинь — отрисовка: оригинальное поле, пуговицы игроков на клетках (несколько на одной — веером).
 * Ход как за столом: бросил кубик (кнопка, пробел или тап по полю), нашёл свою пуговицу, взял её (нажатие или перетаскивание),
 * посмотрел, куда идти (подсвечены шаги и клетка), поставил. По знаку пуговица перелетает сама.
 * Поле — пирамида тайлов из исходного скана (tools/hodilki/tiles.py): сразу проявляется размытая миниатюра, потом общая карта,
 * при зуме подгружаются только видимые куски нужного уровня. Камера плавная: колесо/щипок/кнопки, перелёт с отъездом на дальних
 * переходах, «следить за ходом»; при зуме в углу — миникарта. */
import { Sound } from '../../core/audio';
import { DiceTray } from '../../core/dice';
import { h, sleep, touchScreen } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { signText, target, type Board, type Event, type State } from './core';
import { boardOf } from './def';
import './hodilki.css';

const NS = 'http://www.w3.org/2000/svg';
const FOLLOW_KEY = 'hodilki.follow';
const TILE = 512;
/** Ширина общей карты view.webp — до неё тайлы не нужны. */
const VIEW_W = 1600;

interface Cam {
  z: number;
  fx: number;
  fy: number;
}

const strip = (s: string) => s.replace(/<[^>]+>/g, '');
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

class HodilkiView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  /** Поле партии — из состояния (настройка «Поле»). */
  private b: Board | null = null;
  private wrap!: HTMLElement;
  private board!: HTMLElement;
  private tiny!: HTMLImageElement;
  private base!: HTMLImageElement;
  private layers: HTMLElement[] = [];
  private tiles = new Map<string, HTMLImageElement>();
  private marks!: SVGSVGElement;
  private note!: HTMLElement;
  private mini!: HTMLElement;
  private miniVp!: HTMLElement;
  private miniDots = new Map<number, HTMLElement>();
  private tokens = new Map<number, HTMLElement>();
  private panel!: HTMLElement;
  private rollBtn!: HTMLButtonElement;
  private followBtn!: HTMLButtonElement;
  private tray!: DiceTray;
  private v: State | null = null;
  /** Где пуговица сейчас нарисована (во время анимации — не там, где в состоянии). */
  private shown: number[] = [];
  /** Чьё действие ждём от этого экрана и какое. */
  private actSeat: number | null = null;
  private phase: 'roll' | 'move' = 'roll';
  /** Пуговица взята (нажатием) — видны шаги и клетка. */
  private picked = false;
  private busy = false;
  private ro!: ResizeObserver;

  // ---- камера: поле «целиком» bw×bh, зум и центр кадра в долях поля ----
  private bw = 0;
  private bh = 0;
  private cam: Cam = { z: 1, fx: 0.5, fy: 0.5 };
  /** Плавная доводка (колесо, кнопки): к цели, точка anchor экрана остаётся под пальцем. */
  private goal: (Cam & { ax?: number; ay?: number; bx?: number; by?: number }) | null = null;
  /** Перелёт по кривой (следить за ходом, миникарта). */
  private tween: { from: Cam; to: Cam; t0: number; ms: number; bump: number; done: () => void } | null = null;
  private raf = 0;
  private follow = true;
  /** Игрок сам двигал камеру — не мешать ему до его следующего хода. */
  private manual = false;
  /** Масштаб, который держит слежение: выбранный игроком или первый кадр (0 — ещё не было). */
  private pz = 0;
  private ptrs = new Map<number, { x: number; y: number }>();
  private gesture: { kind: 'pan' | 'token'; x0: number; y0: number; moved: boolean; dist?: number } | null = null;
  private eatClick = false;
  private tilesQueued = false;

  private onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.code === 'Space') {
      if (this.actSeat == null || this.phase !== 'roll' || this.rollBtn.hidden) return;
      e.preventDefault();
      this.roll();
    } else if (e.key === '+' || e.key === '=') this.zoomBy(1.6);
    else if (e.key === '-') this.zoomBy(1 / 1.6);
    else if (e.key === '0') this.overview();
  };

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    try {
      this.follow = localStorage.getItem(FOLLOW_KEY) !== '0';
    } catch {
      /* по умолчанию — следить */
    }
    const wrap = h(`<div class="ks-wrap">
        <div class="ks-board">
          <img class="ks-tiny" alt="" draggable="false"><img class="ks-base" alt="поле" draggable="false">
          <svg class="ks-marks" xmlns="${NS}" preserveAspectRatio="none"></svg>
        </div>
        <div class="ks-note" hidden></div>
        <div class="ks-mini" hidden><img alt="" draggable="false"><div class="ks-mini-vp"></div></div>
        <div class="ks-cam">
          <button class="ks-cb" data-z="all" title="Вся карта (0)"><b>⤢</b><span>Вся карта</span></button>
          <button class="ks-cb" data-z="turn" title="Показать, где ход"><b>◎</b><span>Где ход</span></button>
          <button class="ks-cb ks-follow" data-z="follow" title="Камера сама следит за ходом"><b>●</b><span>Следить</span></button>
          <span class="ks-zoom"><button class="ks-cb" data-z="out" title="Отдалить (−)"><b>−</b></button><button class="ks-cb" data-z="in" title="Приблизить (+)"><b>+</b></button></span>
        </div>
      </div>`);
    root.appendChild(wrap);
    this.wrap = wrap;
    this.board = wrap.querySelector('.ks-board') as HTMLElement;
    this.tiny = wrap.querySelector('.ks-tiny') as HTMLImageElement;
    this.base = wrap.querySelector('.ks-base') as HTMLImageElement;
    this.marks = wrap.querySelector('.ks-marks') as SVGSVGElement;
    this.note = wrap.querySelector('.ks-note') as HTMLElement;
    this.mini = wrap.querySelector('.ks-mini') as HTMLElement;
    this.miniVp = wrap.querySelector('.ks-mini-vp') as HTMLElement;
    this.followBtn = wrap.querySelector('.ks-follow') as HTMLButtonElement;
    this.followBtn.classList.toggle('on', this.follow);
    (wrap.querySelector('.ks-cam') as HTMLElement).hidden = ctx.demo;
    // карта проявляется: размытая миниатюра → общая карта (тогда же — пуговицы)
    this.tiny.onload = () => this.board.classList.add('seen');
    this.base.onload = () => {
      this.board.classList.add('ready');
      this.ctx.hold?.(0);
    };
    wrap.querySelector('.ks-cam')!.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const z = ((e.target as HTMLElement).closest('[data-z]') as HTMLElement | null)?.dataset.z;
      if (z === 'in') this.zoomBy(1.6);
      else if (z === 'out') this.zoomBy(1 / 1.6);
      else if (z === 'all') this.overview();
      else if (z === 'turn') {
        this.manual = false;
        void this.frameTurn(true);
      } else if (z === 'follow') {
        this.follow = !this.follow;
        this.manual = false;
        this.followBtn.classList.toggle('on', this.follow);
        try {
          localStorage.setItem(FOLLOW_KEY, this.follow ? '1' : '0');
        } catch {
          /* без сохранения */
        }
        if (this.follow) void this.frameTurn(true);
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
    this.ro = new ResizeObserver(() => this.fit());
    this.ro.observe(wrap);

    this.panel = h(`<div class="ks-panel">
        <div class="ks-tray"></div>
        <button class="btn primary ks-roll" data-tap hidden>Бросить кубик</button>
        ${ctx.demo ? '' : `<div class="hint small-hint ks-hint">${touchScreen() ? 'Бросок — кнопкой или тапом по полю.' : 'Пробел — бросок.'} Потом возьмите свою пуговицу и поставьте на подсвеченную клетку. Карту можно приближать ${touchScreen() ? 'двумя пальцами' : 'колесом'} и двигать.</div>`}
      </div>`);
    ctx.controls.appendChild(this.panel);
    this.tray = new DiceTray(this.panel.querySelector('.ks-tray') as HTMLElement, 1);
    this.rollBtn = this.panel.querySelector('.ks-roll') as HTMLButtonElement;
    this.rollBtn.onclick = () => this.roll();
    if (!ctx.demo) document.addEventListener('keydown', this.onKey);

    wrap.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    wrap.addEventListener('pointerdown', (e) => this.onDown(e));
    wrap.addEventListener('pointermove', (e) => this.onMove(e));
    wrap.addEventListener('pointerup', (e) => this.onUp(e));
    wrap.addEventListener('pointercancel', (e) => this.onUp(e, true));
    wrap.addEventListener('click', (e) => this.onClick(e));
    wrap.addEventListener('pointerover', (e) => {
      if (e.pointerType === 'touch' || !this.canMove() || this.picked) return;
      if ((e.target as HTMLElement).closest('.ks-token.mine')) this.showMarks(true);
    });
    wrap.addEventListener('pointerout', (e) => {
      if (e.pointerType === 'touch' || this.picked || this.gesture) return;
      if ((e.target as HTMLElement).closest('.ks-token.mine')) this.showMarks(false);
    });
  }

  // ---------- ход ----------

  private roll() {
    if (this.actSeat == null || this.phase !== 'roll' || this.busy) return;
    const seat = this.actSeat;
    this.actSeat = null;
    this.rollBtn.hidden = true;
    Sound.unlock();
    this.ctx.act(seat, { type: 'roll' });
  }

  private canMove() {
    return this.actSeat != null && this.phase === 'move' && !this.busy && !!this.v;
  }

  /** Поставить пуговицу: dropped — уже стоит на клетке (перетащили), шагать не надо. */
  private commit(dropped: boolean) {
    if (!this.canMove() || !this.v || !this.b) return;
    const seat = this.actSeat!;
    const to = target(this.v, this.b, seat);
    this.actSeat = null;
    this.picked = false;
    this.showMarks(false);
    if (dropped) {
      this.shown[seat] = to;
      this.place();
      Sound.place();
    }
    this.syncTokens();
    Sound.unlock();
    this.ctx.act(seat, { type: 'move' });
  }

  private pick(on: boolean) {
    if (on && !this.canMove()) return;
    this.picked = on;
    const el = this.actSeat != null ? this.tokens.get(this.actSeat) : null;
    el?.classList.toggle('lifted', on);
    this.showMarks(on);
    if (on) Sound.ui();
  }

  /** Шаги и клетка назначения своей пуговицы. */
  private showMarks(on: boolean) {
    this.marks.replaceChildren();
    if (!on || !this.canMove() || !this.v || !this.b) return;
    const b = this.b;
    const seat = this.actSeat!;
    const from = this.v.pos[seat];
    const to = target(this.v, b, seat);
    const r = b.token * b.img.w * 0.62;
    const add = (tag: string, attrs: Record<string, string | number>, text?: string) => {
      const el = document.createElementNS(NS, tag);
      for (const [k, val] of Object.entries(attrs)) el.setAttribute(k, String(val));
      if (text) el.textContent = text;
      this.marks.appendChild(el);
    };
    const pts: number[] = [];
    for (let i = from; i <= to; i++) pts.push(i);
    add('polyline', { class: 'ks-trail', points: pts.map((i) => `${b.cells[i].x},${b.cells[i].y}`).join(' '), 'stroke-width': r * 0.22 });
    for (let i = from + 1; i < to; i++) {
      const c = b.cells[i];
      add('circle', { class: 'ks-stepdot', cx: c.x, cy: c.y, r: r * 0.42 });
      add('text', { class: 'ks-stepnum', x: c.x, y: c.y, 'font-size': r * 0.5 }, String(i - from));
    }
    const c = b.cells[to];
    add('circle', { class: 'ks-goal', cx: c.x, cy: c.y, r: r * 1.15, 'stroke-width': r * 0.2 });
    add('text', { class: 'ks-goalnum', x: c.x, y: c.y < r * 3 ? c.y + r * 1.6 : c.y - r * 1.6, 'font-size': r * 0.8 }, String(to - from));
  }

  // ---------- пуговицы ----------

  private place() {
    const v = this.v;
    const b = this.b;
    if (!v || !b) return;
    // сколько пуговиц на клетке — раздвинуть веером
    const at = new Map<number, number[]>();
    for (const s of v.seats) at.set(this.shown[s], [...(at.get(this.shown[s]) ?? []), s]);
    for (const s of v.seats) {
      let el = this.tokens.get(s);
      if (!el) {
        el = h(`<div class="ks-token" data-seat="${s}"><div class="ks-btn" style="background-image:url(/hodilki/buttons/${s}.webp)"></div></div>`);
        this.board.appendChild(el);
        this.tokens.set(s, el);
      }
      if (el.classList.contains('drag')) continue;
      const cell = b.cells[this.shown[s]];
      const group = at.get(this.shown[s])!;
      const i = group.indexOf(s);
      const off = group.length > 1 ? (i - (group.length - 1) / 2) * b.token * 70 : 0;
      el.style.left = `${(cell.x / b.img.w) * 100 + off}%`;
      el.style.top = `${(cell.y / b.img.h) * 100 + (group.length > 1 ? (i % 2) * b.token * 30 * (b.img.w / b.img.h) : 0)}%`;
    }
    this.syncTokens();
    this.drawMini();
  }

  /** Подсветка: чей ход, своя пуговица (можно взять). */
  private syncTokens() {
    const v = this.v;
    if (!v) return;
    for (const [s, el] of this.tokens) {
      el.classList.toggle('on', v.turn === s && v.winner == null);
      el.classList.toggle('mine', s === this.actSeat && this.canMove());
      if (s === this.actSeat && !this.picked && !el.classList.contains('drag') && !this.busy) el.classList.remove('lifted');
    }
  }

  /** Поставить карту поля (при первом показе и если поле другое). */
  private useBoard(map: string) {
    const b = boardOf(map);
    if (this.b === b) return;
    this.b = b;
    for (const el of this.tokens.values()) el.remove();
    this.tokens.clear();
    for (const el of this.miniDots.values()) el.remove();
    this.miniDots.clear();
    for (const l of this.layers) l.remove();
    this.tiles.clear();
    this.board.classList.remove('seen', 'ready');
    this.ctx.hold?.(20000);
    this.tiny.src = `${b.img.dir}/tiny.webp`;
    this.base.src = `${b.img.dir}/view.webp`;
    this.base.alt = b.title;
    (this.mini.querySelector('img') as HTMLImageElement).src = `${b.img.dir}/view.webp`;
    // слои тайлов: более подробный — выше
    this.layers = Array.from({ length: b.img.levels }, (_, lv) => {
      const l = document.createElement('div');
      l.className = 'ks-lv';
      l.style.zIndex = String(10 - lv);
      this.board.insertBefore(l, this.marks);
      return l;
    });
    this.marks.setAttribute('viewBox', `0 0 ${b.img.w} ${b.img.h}`);
    this.board.style.setProperty('--tk', `${b.token * 100}%`);
    this.mini.style.aspectRatio = `${b.img.w} / ${b.img.h}`;
    this.cam = { z: 1, fx: 0.5, fy: 0.5 };
    this.pz = 0;
    this.fit();
  }

  // ---------- камера ----------

  private vp() {
    return { w: this.wrap.clientWidth, h: this.wrap.clientHeight };
  }

  private maxZ() {
    if (!this.b || !this.bw) return 4;
    // до полного разрешения скана (с запасом на плотные экраны), но не меньше 3
    return Math.max(3, Math.min(8, (this.b.img.src[0] * 1.3) / this.bw));
  }

  private fit() {
    if (!this.b) return;
    const r = this.vp();
    // снизу — кнопки вида: общая карта их не перекрывает
    const k = Math.min(Math.max(0, r.w - 16) / this.b.img.w, Math.max(0, r.h - (this.ctx.demo ? 16 : 62)) / this.b.img.h);
    this.bw = this.b.img.w * k;
    this.bh = this.b.img.h * k;
    this.board.style.width = `${this.bw}px`;
    this.board.style.height = `${this.bh}px`;
    this.apply(this.cam);
  }

  /** Кадр без выхода краёв поля внутрь экрана. */
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
    // общая карта чуть выше центра — под ней панель кнопок вида
    const oy = this.ctx.demo ? 0 : 23 * Math.max(0, Math.min(1, 2 - z));
    this.board.style.transform = `translate(${r.w / 2 - fx * this.bw * z}px, ${r.h / 2 - oy - fy * this.bh * z}px) scale(${z})`;
    this.wrap.classList.toggle('zoomed', z > 1.02);
    this.mini.hidden = z < 1.15 || this.ctx.demo;
    this.drawMini();
    this.queueTiles();
  }

  /** Один кадр движка: перелёт по кривой или плавная доводка к цели. */
  private frame = (now: number) => {
    this.raf = 0;
    const tw = this.tween;
    if (tw) {
      const t = Math.min(1, (now - tw.t0) / tw.ms);
      const e = ease(t);
      const lz = Math.log(tw.from.z) + (Math.log(tw.to.z) - Math.log(tw.from.z)) * e - tw.bump * Math.sin(Math.PI * t);
      // сдвиг идёт, пока камера отъехала (центр кадра — по той же кривой)
      this.apply({ z: Math.exp(lz), fx: tw.from.fx + (tw.to.fx - tw.from.fx) * e, fy: tw.from.fy + (tw.to.fy - tw.from.fy) * e });
      if (t >= 1) {
        this.tween = null;
        this.board.classList.remove('moving');
        tw.done();
      } else this.raf = requestAnimationFrame(this.frame);
      return;
    }
    const g = this.goal;
    if (!g) return;
    const lz = Math.log(this.cam.z) + (Math.log(g.z) - Math.log(this.cam.z)) * 0.25;
    let z = Math.exp(lz);
    if (Math.abs(Math.log(g.z / z)) < 0.002) z = g.z;
    let fx: number;
    let fy: number;
    if (g.ax != null) {
      // точка поля (bx, by) остаётся под экранной (ax, ay)
      const r = this.vp();
      fx = (r.w / 2 - g.ax + g.bx! * z) / z / this.bw;
      fy = (r.h / 2 - g.ay! + g.by! * z) / z / this.bh;
    } else {
      fx = this.cam.fx + (g.fx - this.cam.fx) * 0.25;
      fy = this.cam.fy + (g.fy - this.cam.fy) * 0.25;
    }
    this.apply({ z, fx, fy });
    if (z === g.z && (g.ax != null || (Math.abs(fx - g.fx) < 1e-4 && Math.abs(fy - g.fy) < 1e-4))) {
      this.goal = null;
      this.board.classList.remove('moving');
    } else this.raf = requestAnimationFrame(this.frame);
  };

  private kick() {
    this.board.classList.add('moving');
    if (!this.raf) this.raf = requestAnimationFrame(this.frame);
  }

  private stopCam() {
    if (this.tween) {
      const d = this.tween.done;
      this.tween = null;
      d();
    }
    this.goal = null;
    this.board.classList.remove('moving');
  }

  /** Приблизить в k раз (плавно), точка экрана (px, py) остаётся на месте. */
  private zoomAt(px: number, py: number, z: number) {
    if (this.tween) this.stopCam();
    const cur = this.cam;
    const r = this.vp();
    const tz = this.clamp({ ...cur, z: z }).z;
    const base = this.goal?.ax != null && Math.abs(this.goal.ax - px) < 2 && Math.abs(this.goal.ay! - py) < 2 ? this.goal : null;
    const bx = base ? base.bx! : (px - (r.w / 2 - cur.fx * this.bw * cur.z)) / cur.z;
    const by = base ? base.by! : (py - (r.h / 2 - cur.fy * this.bh * cur.z)) / cur.z;
    this.goal = { z: tz, fx: cur.fx, fy: cur.fy, ax: px, ay: py, bx, by };
    this.prefetch({ z: tz, fx: (r.w / 2 - px + bx * tz) / tz / this.bw, fy: (r.h / 2 - py + by * tz) / tz / this.bh });
    this.kick();
  }

  private zoomBy(k: number) {
    const r = this.vp();
    this.manual = true;
    this.zoomAt(r.w / 2, r.h / 2, (this.goal?.z ?? this.cam.z) * k);
    this.pz = this.goal?.z ?? this.cam.z;
  }

  private overview() {
    this.manual = true;
    this.pz = 1;
    void this.fly({ z: 1, fx: 0.5, fy: 0.5 });
  }

  /** Перелёт: на дальних переходах камера отъезжает, чтобы было видно, откуда и куда. */
  private fly(to: Cam, ms?: number): Promise<void> {
    this.stopCam();
    const from = { ...this.cam };
    to = this.clamp(to);
    const r = this.vp();
    // насколько надо отъехать, чтобы в кадре были обе точки
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
    this.prefetch(to);
    return new Promise((done) => {
      this.tween = { from, to, t0: performance.now(), ms: dur / Math.max(0.5, this.ctx.speed()), bump, done };
      this.kick();
    });
  }

  /** Показать клетки (камера следит за ходом). force — по кнопке «Где ход», даже если слежение выключено. */
  private frameCells(cells: number[], force = false): Promise<void> {
    const b = this.b;
    if (!b || !this.bw || !cells.length || (!force && (!this.follow || this.manual))) return Promise.resolve();
    const xs = cells.map((i) => b.cells[i].x / b.img.w);
    const ys = cells.map((i) => b.cells[i].y / b.img.h);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const r = this.vp();
    const pad = b.token * 3;
    const w = (x1 - x0 + pad * 2) * this.bw;
    const hh = (y1 - y0) * this.bh + pad * 2 * this.bw;
    // крупно: пуговица на экране — около 46 px; дальше держим масштаб игрока, отъезжая, только если нужное не влезает
    const first = !this.pz;
    if (force || first) this.pz = Math.max(1.6, Math.min(this.maxZ() * 0.7, 46 / (b.token * this.bw)));
    if (force || first) return this.fly({ z: Math.max(1, Math.min(this.pz, r.w / w, r.h / hh)), fx: (x0 + x1) / 2, fy: (y0 + y1) / 2 });
    // мёртвая зона: пока нужное в средней части кадра, камера стоит. Масштаб тоже держится: отъезд — только если
    // нужное не влезает, приближение — только когда влезет заметно крупнее.
    const c = this.cam;
    const p = b.token * 1.5;
    const py = (p * this.bw) / this.bh;
    const box = (ids: number[]) => {
      const bx = ids.map((i) => b.cells[i].x / b.img.w);
      const by = ids.map((i) => b.cells[i].y / b.img.h);
      const [x0, x1, y0, y1] = [Math.min(...bx), Math.max(...bx), Math.min(...by), Math.max(...by)];
      return { x0, x1, y0, y1, fit: Math.min((r.w * 0.8) / ((x1 - x0 + 2 * p) * this.bw), (r.h * 0.8) / ((y1 - y0 + 2 * py) * this.bh)) };
    };
    // в кадре все пуговицы (и куда идёт ход), а не только того, кто ходит: чужие ходы внутри кадра камеру не двигают.
    // Разбежались — камера отъезжает, вплоть до всей карты; собрались — снова ближе.
    const t = box([...cells, ...(this.v?.seats.map((s) => this.shown[s]) ?? [])]);
    const bz = Math.min(this.pz, t.fit);
    const z = this.clamp({ ...c, z: c.z > t.fit ? t.fit : c.z < bz * 0.75 ? bz : c.z }).z;
    // вышло к краю — сдвиг ровно настолько, чтобы нужное оказалось ближе к середине (с запасом на следующий ход)
    const axis = (f: number, lo: number, hi: number, view: number, size: number, p: number) => {
      const half = view / (2 * z * size);
      if (lo - p >= f - half * 0.8 && hi + p <= f + half * 0.8) return f;
      const aim = Math.min(half * 0.8, Math.max(half * 0.5, (hi - lo) / 2 + p));
      return Math.max(hi + p - aim, Math.min(lo - p + aim, f));
    };
    const to = this.clamp({ z, fx: axis(c.fx, t.x0, t.x1, r.w, this.bw, p), fy: axis(c.fy, t.y0, t.y1, r.h, this.bh, py) });
    const still = Math.abs(Math.log(to.z / c.z)) < 0.03 && Math.abs(to.fx - c.fx) * this.bw * z < 2 && Math.abs(to.fy - c.fy) * this.bh * z < 2;
    return still ? Promise.resolve() : this.fly(to);
  }

  /** Кадр на ход: пуговица того, кто ходит, и куда она пойдёт. */
  private frameTurn(force = false) {
    const v = this.v;
    const b = this.b;
    if (!v || !b || v.winner != null) return Promise.resolve();
    const s = v.turn;
    const cells = [this.shown[s] ?? v.pos[s]];
    if ((v.phase ?? 'roll') === 'move') cells.push(target(v, b, s));
    return this.frameCells(cells, force);
  }

  // ---------- тайлы ----------

  private queueTiles() {
    if (this.tilesQueued) return;
    this.tilesQueued = true;
    requestAnimationFrame(() => {
      this.tilesQueued = false;
      this.updateTiles(this.cam, true);
    });
  }

  /** Тайлы кадра c заранее — пока камера летит туда. */
  private prefetch(c: Cam) {
    this.updateTiles(this.clamp(c), false);
  }

  /** Нужный уровень и видимые тайлы кадра c; show — переключить видимость слоёв под этот кадр. */
  private updateTiles(c: Cam, show: boolean) {
    const b = this.b;
    if (!b || !this.bw || !b.img.levels) return;
    const need = this.bw * c.z * (window.devicePixelRatio || 1);
    let lv = -1;
    if (need > VIEW_W * 1.1) {
      lv = 0;
      for (let l = b.img.levels - 1; l >= 0; l--) {
        if (b.img.src[0] / 2 ** l >= need * 0.85) {
          lv = l;
          break;
        }
      }
    }
    if (show) this.layers.forEach((el, l) => (el.style.display = lv >= 0 && l >= lv ? '' : 'none'));
    if (lv < 0) return;
    const lw = Math.ceil(b.img.src[0] / 2 ** lv);
    const lh = Math.ceil(b.img.src[1] / 2 ** lv);
    const r = this.vp();
    const hw = r.w / (2 * c.z * this.bw) + 0.02;
    const hv = r.h / (2 * c.z * this.bh) + 0.02;
    const c0 = Math.max(0, Math.floor(((c.fx - hw) * lw) / TILE));
    const c1 = Math.min(Math.ceil(lw / TILE) - 1, Math.floor(((c.fx + hw) * lw) / TILE));
    const r0 = Math.max(0, Math.floor(((c.fy - hv) * lh) / TILE));
    const r1 = Math.min(Math.ceil(lh / TILE) - 1, Math.floor(((c.fy + hv) * lh) / TILE));
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        const key = `${lv}/${col}_${row}`;
        if (this.tiles.has(key)) continue;
        const img = document.createElement('img');
        img.className = 'ks-tile';
        img.alt = '';
        img.draggable = false;
        img.decoding = 'async';
        img.onload = () => img.classList.add('ok');
        const tw = Math.min(TILE + 1, lw - col * TILE);
        const th = Math.min(TILE + 1, lh - row * TILE);
        img.style.cssText = `left:${((col * TILE) / lw) * 100}%;top:${((row * TILE) / lh) * 100}%;width:${(tw / lw) * 100}%;height:${(th / lh) * 100}%`;
        img.src = `${b.img.dir}/${key}.webp`;
        this.layers[lv].appendChild(img);
        this.tiles.set(key, img);
      }
    }
  }

  // ---------- миникарта ----------

  private drawMini() {
    if (this.mini.hidden || !this.b || !this.v) return;
    const r = this.vp();
    const { z, fx, fy } = this.cam;
    const w = Math.min(1, r.w / (z * this.bw));
    const hh = Math.min(1, r.h / (z * this.bh));
    Object.assign(this.miniVp.style, { left: `${(fx - w / 2) * 100}%`, top: `${(fy - hh / 2) * 100}%`, width: `${w * 100}%`, height: `${hh * 100}%` });
    for (const s of this.v.seats) {
      let d = this.miniDots.get(s);
      if (!d) {
        d = h(`<i class="ks-mini-dot" style="background-image:url(/hodilki/buttons/${s}.webp)"></i>`);
        this.mini.appendChild(d);
        this.miniDots.set(s, d);
      }
      const cell = this.b.cells[this.shown[s] ?? 0];
      d.style.left = `${(cell.x / this.b.img.w) * 100}%`;
      d.style.top = `${(cell.y / this.b.img.h) * 100}%`;
      d.classList.toggle('on', this.v.turn === s);
    }
  }

  // ---------- жесты ----------

  private onWheel(e: WheelEvent) {
    e.preventDefault();
    const r = this.wrap.getBoundingClientRect();
    this.manual = true;
    // колесо в строках или страницах — в пиксели
    const dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
    const k = Math.exp(-Math.max(-120, Math.min(120, dy)) * 0.0035);
    this.zoomAt(e.clientX - r.left, e.clientY - r.top, (this.goal?.z ?? this.cam.z) * k);
    this.pz = this.goal?.z ?? this.cam.z;
  }

  /** Точка экрана → координаты на картинке поля. */
  private toImg(clientX: number, clientY: number) {
    const r = this.board.getBoundingClientRect();
    const b = this.b!;
    return { x: ((clientX - r.left) / r.width) * b.img.w, y: ((clientY - r.top) / r.height) * b.img.h };
  }

  private nearest(x: number, y: number) {
    const b = this.b!;
    let best = -1;
    let bd = Infinity;
    b.cells.forEach((c, i) => {
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    return { i: best, d: bd };
  }

  private onDown(e: PointerEvent) {
    if (this.ctx.demo || (e.target as HTMLElement).closest('.ks-cam, .ks-mini')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const tok = (e.target as HTMLElement).closest('.ks-token') as HTMLElement | null;
    if (this.ptrs.size === 2) {
      // щипок: отпустить пуговицу, если тащили
      if (this.gesture?.kind === 'token') this.dropToken(null);
      this.stopCam();
      const [a, b] = [...this.ptrs.values()];
      this.gesture = { kind: 'pan', x0: (a.x + b.x) / 2, y0: (a.y + b.y) / 2, moved: true, dist: Math.hypot(a.x - b.x, a.y - b.y) };
    } else if (tok && this.canMove() && +tok.dataset.seat! === this.actSeat) {
      this.gesture = { kind: 'token', x0: e.clientX, y0: e.clientY, moved: false };
    } else {
      this.gesture = { kind: 'pan', x0: e.clientX, y0: e.clientY, moved: false };
    }
    this.wrap.setPointerCapture(e.pointerId);
  }

  private onMove(e: PointerEvent) {
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
    if (g.kind === 'token') {
      const el = this.tokens.get(this.actSeat!);
      if (!el || !this.canMove()) return;
      if (!g.moved) {
        g.moved = true;
        el.classList.add('drag', 'lifted');
        this.picked = true;
        this.showMarks(true);
      }
      const q = this.toImg(e.clientX, e.clientY);
      el.style.left = `${(q.x / this.b!.img.w) * 100}%`;
      el.style.top = `${(q.y / this.b!.img.h) * 100}%`;
      return;
    }
    if (this.cam.z <= 1.02) return;
    if (!g.moved) this.stopCam();
    g.moved = true;
    this.manual = true;
    this.panBy(dx, dy);
    g.x0 = e.clientX;
    g.y0 = e.clientY;
  }

  private panBy(dx: number, dy: number) {
    const c = this.cam;
    this.apply({ z: c.z, fx: c.fx - dx / (this.bw * c.z), fy: c.fy - dy / (this.bh * c.z) });
  }

  /** Щипок — сразу, без доводки (за пальцами). */
  private pinch(px: number, py: number, k: number) {
    const c = this.cam;
    const r = this.vp();
    const z = Math.max(1, Math.min(this.maxZ(), c.z * k));
    const bx = (px - (r.w / 2 - c.fx * this.bw * c.z)) / c.z;
    const by = (py - (r.h / 2 - c.fy * this.bh * c.z)) / c.z;
    this.apply({ z, fx: (r.w / 2 - px + bx * z) / z / this.bw, fy: (r.h / 2 - py + by * z) / z / this.bh });
    this.pz = this.cam.z;
  }

  private onUp(e: PointerEvent, cancel = false) {
    if (!this.ptrs.delete(e.pointerId)) return;
    const g = this.gesture;
    if (this.ptrs.size) {
      // после щипка остался один палец — дальше просто сдвиг
      const [a] = [...this.ptrs.values()];
      this.gesture = { kind: 'pan', x0: a.x, y0: a.y, moved: true };
      this.eatClick = true;
      return;
    }
    this.gesture = null;
    if (!g) return;
    if (g.moved) this.eatClick = true;
    if (g.kind === 'token') {
      if (g.moved) this.dropToken(cancel ? null : e);
      else {
        // нажали на свою пуговицу — взять / положить обратно
        this.eatClick = true;
        this.pick(!this.picked);
      }
    }
  }

  /** Отпустили перетаскиваемую пуговицу: на нужной клетке — ход, иначе вернуть на место. */
  private dropToken(e: PointerEvent | null) {
    const seat = this.actSeat;
    const el = seat != null ? this.tokens.get(seat) : null;
    if (!el || seat == null || !this.v || !this.b) return;
    el.classList.remove('drag');
    if (e && this.canMove()) {
      const q = this.toImg(e.clientX, e.clientY);
      const n = this.nearest(q.x, q.y);
      if (n.i === target(this.v, this.b, seat) && n.d < this.b.token * this.b.img.w * 1.6) return this.commit(true);
    }
    this.picked = false;
    el.classList.remove('lifted');
    this.showMarks(false);
    this.place();
    Sound.nomove();
  }

  private onClick(e: MouseEvent) {
    if ((e.target as HTMLElement).closest('.ks-cam, .ks-mini')) return;
    if (this.eatClick) {
      this.eatClick = false;
      e.preventDefault();
      return;
    }
    if (!this.canMove() || !this.v || !this.b) return;
    e.preventDefault();
    // пуговица взята: щелчок по клетке назначения — ход, мимо — положить обратно
    if (!this.picked) return;
    const q = this.toImg(e.clientX, e.clientY);
    const n = this.nearest(q.x, q.y);
    if (n.i === target(this.v, this.b, this.actSeat!) && n.d < this.b.token * this.b.img.w * 1.4) this.commit(false);
    else this.pick(false);
  }

  // ---------- состояние и анимации ----------

  private die(n: number | null) {
    if (n) this.tray.show([n]);
  }

  private say(text: string, good: boolean) {
    this.note.textContent = text;
    this.note.className = `ks-note ${good ? 'good' : 'bad'}`;
    this.note.hidden = false;
    this.note.animate([{ opacity: 0, transform: 'translate(-50%, -8px)' }, { opacity: 1, transform: 'translate(-50%, 0)' }], { duration: 220 });
  }

  setView(v: State) {
    this.useBoard(v.map);
    this.v = v;
    this.shown = v.pos.slice();
    this.die(v.last);
    this.note.hidden = true;
    this.place();
  }

  async play(events: Event[], v: State) {
    const speed = this.ctx.speed();
    this.busy = true;
    this.picked = false;
    this.showMarks(false);
    for (const ev of events) {
      if (ev.type === 'roll') {
        this.note.hidden = true;
        void this.frameCells([this.shown[ev.seat]]);
        await this.tray.roll([ev.die], speed);
      } else if (ev.type === 'move') {
        const last = ev.path[ev.path.length - 1];
        if (last == null || this.shown[ev.seat] === last) continue; // пуговицу уже поставили руками
        await this.frameCells([this.shown[ev.seat], last]);
        const el = this.tokens.get(ev.seat);
        el?.classList.add('lifted');
        await sleep(160 / speed);
        for (const p of ev.path) {
          this.shown[ev.seat] = p;
          this.place();
          Sound.step();
          await sleep(200 / speed);
        }
        el?.classList.remove('lifted');
        Sound.place();
        await sleep(120 / speed);
      } else if (ev.type === 'sign') {
        const good = ev.sign.k === 'again' || (ev.sign.k === 'jump' && ev.sign.good);
        this.say(`${strip(this.ctx.name(ev.seat))} ${signText(ev.sign)}${good ? '!' : '.'}`, good);
        await sleep(500 / speed);
        if (ev.to !== this.shown[ev.seat]) {
          // перелёт: камера показывает и откуда, и куда; место назначения подгружается заранее
          await this.frameCells([this.shown[ev.seat], ev.to]);
          const el = this.tokens.get(ev.seat);
          el?.classList.add('fly', 'lifted');
          await sleep(140 / speed);
          this.shown[ev.seat] = ev.to;
          this.place();
          if (good) Sound.jump();
          else Sound.nomove();
          await sleep(850 / speed);
          el?.classList.remove('fly', 'lifted');
          Sound.place();
          void this.frameCells([ev.to]);
        } else if (good) Sound.jump();
        else Sound.nomove();
        await sleep(400 / speed);
      } else if (ev.type === 'skip') {
        this.say(`${strip(this.ctx.name(ev.seat))} пропускает ход.`, false);
        await sleep(650 / speed);
      } else if (ev.type === 'win') Sound.win();
    }
    this.useBoard(v.map);
    this.v = v;
    this.shown = v.pos.slice();
    this.busy = false;
    this.place();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const v = this.v;
    this.phase = (v?.phase ?? 'roll') as 'roll' | 'move';
    this.actSeat = v && v.winner == null ? (interactive.find((x) => x === v.turn) ?? null) : null;
    if (this.actSeat == null) this.picked = false;
    this.rollBtn.hidden = this.actSeat == null || this.phase !== 'roll';
    this.showMarks(this.picked);
    this.syncTokens();
    // свой ход: камера снова следит (даже если до этого карту двигали) — показать свою пуговицу и куда идти
    if (this.actSeat != null) {
      if (this.phase === 'roll') this.manual = false;
      void this.frameTurn();
    }
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.winner != null) return `${this.ctx.name(v.winner)}: ${boardOf(v.map).winText}!`;
    const me = interactive.includes(toAct[0]);
    if ((v.phase ?? 'roll') === 'move') return me ? `Выпало ${v.last} — возьмите свою пуговицу и переставьте` : `Ходит ${this.ctx.name(toAct[0])}…`;
    return me ? 'Бросайте кубик' : `Бросает ${this.ctx.name(toAct[0])}…`;
  }

  playerStats(v: State, seat: number) {
    return `${v.pos[seat]} / ${boardOf(v.map).cells.length - 1}${v.skip[seat] ? ' · пропуск' : ''}`;
  }

  destroy() {
    this.ro.disconnect();
    this.stopCam();
    if (this.raf) cancelAnimationFrame(this.raf);
    document.removeEventListener('keydown', this.onKey);
  }
}

export function createView(): GameView<State, Event> {
  return new HodilkiView();
}
