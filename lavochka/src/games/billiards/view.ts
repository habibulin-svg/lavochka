/* Бильярд — отрисовка (2D, вид сверху): стол из фото-фактур (table2d.ts), шары-сферы с вращением и бликами ламп (balls.ts), кий с тенью (cue2d.ts),
 * подсказка прицела: линия до «шара-призрака», куда пойдёт прицельный и куда отскочит биток.
 * Управление. Мышь: вести — прицел; нажать и тянуть назад — кий оттягивается, сверху шкала силы; отпустить — удар (без оттяжки — отмена);
 * стрелки ←/→ — тонкая наводка (с Shift — ещё тоньше), с Shift мышь наводит медленно. Палец: водить по столу — прицел; взяться за кий
 * или биток и тянуть назад — сила; отпустить — удар. Винт — шар в углу стола. Американка — нажатием выбрать биток; заказ лузы — нажатием на лузу.
 * С руки — биток следует за указателем (пальцем), отпустить — поставить.
 * Удар: кий оттягивается и бьёт, шары едут по кадрам, что прислал хозяин партии (физика — physics.ts), звук — по записанным ударам (sound.ts).
 * На узком (портретном) экране стол повёрнут вдоль экрана. */
import { Sound } from '../../core/audio';
import { esc, h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { BallSprite, ballTexture, linRGB, randomOrientation, roll, type Lamp } from './balls';
import { CUE_POOL, CUE_RUSSIAN, CUE_SNOOKER, drawCue, type CueLook } from './cue2d';
import { SEATS, VARIANT_NAME } from './def';
import {
  ballName,
  cueBalls,
  geoOf,
  kindOf,
  legalTargets,
  ownBalls,
  placeOk,
  POCKET_NAMES,
  snookerMarks,
  SNK_NAMES,
  tableOf,
  type Action,
  type Event,
  type View,
} from './engine';
import { HIT_BALL, HIT_CUE, HIT_POCKET, HIT_RAIL, SIZE_FT, type Ball, type Geometry, type TableSpec } from './physics';
import * as Sfx from './sound';
import { drawTable, frameOf, lampsOf, onTableArt, styleOf } from './table2d';
import '../../core/boardcam.css';
import './billiards.css';

/** Самая большая оттяжка кия, м. */
const PULL = 0.3;
/** Зазор между наклейкой и битком при прицеливании, м. */
const GAP = 0.012;

type Drag = { kind: 'power' | 'aim' | 'place'; sx: number; sy: number; moved: boolean };

interface Fall {
  id: number;
  x: number;
  y: number;
  pocket: number;
  t0: number;
}

class BilliardsView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private wrap!: HTMLElement;
  private cv!: HTMLCanvasElement;
  private g!: CanvasRenderingContext2D;
  private panel!: HTMLElement;
  private banner!: HTMLElement;
  private hud!: { power: HTMLElement; fill: HTMLElement; label: HTMLElement; spin: HTMLCanvasElement; spinBox: HTMLElement };
  private v: View | null = null;
  private geo!: Geometry;
  private spec!: TableSpec;
  // раскладка: пикселей холста в метре, поворот, начало координат стола на холсте
  private S = 100;
  private dpr = 1;
  private rot = false;
  private ox = 0;
  private oy = 0;
  private cssW = 0;
  private cssH = 0;
  private layer: HTMLCanvasElement | null = null;
  private layerKey = '';
  private lamps: Lamp[] = [];
  private rim: [number, number, number] = [0, 0.2, 0];
  // шары
  private sprites = new Map<number, BallSprite>();
  private orient = new Map<number, Float64Array>();
  private falls: Fall[] = [];
  private inPockets: number[][] = [[], [], [], [], [], []];
  // управление
  private actSeat: number | null = null;
  private aim = 0;
  private power = 0.4;
  private spin = { x: 0, y: 0 };
  private cue = 0;
  private callPocket: number | null = null;
  private drag: Drag | null = null;
  private dragPower = 0;
  private hover: { x: number; y: number } | null = null;
  private fineAngle: number | null = null;
  /** Кий: где и как (во время прицеливания — по aim и оттяжке, в анимации — свой). */
  private cueAnim: { angle: number; pull: number; alpha: number; ball: number } | null = null;
  /** Удар отправлен, ждём событие — кий держим. */
  private pending: { angle: number; pull: number; ball: number } | null = null;
  /** Во время анимации — позиции из кадров. */
  private anim: Ball[] | null = null;
  private busy = false;
  private raf = 0;
  private ro!: ResizeObserver;
  private onKey = (e: KeyboardEvent) => this.key(e);
  /** Приближение стола (телефон): масштаб к «столу целиком», точка стола в центре экрана, пальцы щипка. */
  private zoomZ = 1;
  private focus: [number, number] | null = null;
  private baseS = 1;
  private ptrs = new Map<number, { x: number; y: number }>();
  private pinch: { d0: number; z0: number; tx: number; ty: number } | null = null;
  private zoomBar!: HTMLElement;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.wrap = h(`<div class="bl-wrap"><canvas class="bl-canvas"></canvas>
      <div class="bl-power" hidden><div class="bl-power-bar"><div class="bl-power-fill"></div><div class="bl-power-ticks"></div></div><span class="bl-power-label">Сила</span></div>
      <div class="bl-spinbox" hidden><canvas class="bl-spin" width="160" height="160"></canvas><span>винт</span></div>
      <div class="cs-banner bl-banner" hidden></div></div>`);
    root.appendChild(this.wrap);
    this.cv = this.wrap.querySelector('.bl-canvas') as HTMLCanvasElement;
    this.g = this.cv.getContext('2d')!;
    this.banner = this.wrap.querySelector('.bl-banner') as HTMLElement;
    this.hud = {
      power: this.wrap.querySelector('.bl-power') as HTMLElement,
      fill: this.wrap.querySelector('.bl-power-fill') as HTMLElement,
      label: this.wrap.querySelector('.bl-power-label') as HTMLElement,
      spin: this.wrap.querySelector('.bl-spin') as HTMLCanvasElement,
      spinBox: this.wrap.querySelector('.bl-spinbox') as HTMLElement,
    };
    this.panel = h(`<div class="bl-panel"></div>`);
    ctx.controls.appendChild(this.panel);
    this.zoomBar = h(`<div class="bc-cam zm-bar zm-bl"><span class="bc-zoom">
        <button class="bc-cb" data-z="out" title="Отдалить">−</button><button class="bc-cb" data-z="all" title="Весь стол">⤢</button><button class="bc-cb" data-z="in" title="Приблизить">+</button>
      </span></div>`);
    this.zoomBar.hidden = !!ctx.demo;
    this.wrap.appendChild(this.zoomBar);
    this.zoomBar.addEventListener('pointerdown', (e) => e.stopPropagation());
    this.zoomBar.addEventListener('click', (e) => {
      e.stopPropagation();
      const z = ((e.target as HTMLElement).closest('[data-z]') as HTMLElement | null)?.dataset.z;
      if (z === 'all') this.setZoom(1);
      else if (z) {
        // приближаем к битку — к нему обычно и нужно присмотреться
        const cb = this.balls().find((b) => b.id === this.cue && b.on);
        if (z === 'in' && this.zoomZ === 1 && cb) this.focus = [cb.x, cb.y];
        this.setZoom(this.zoomZ * (z === 'in' ? 1.5 : 1 / 1.5));
      }
    });
    this.setZoom(1);
    this.cv.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    this.cv.addEventListener('pointerdown', (e) => this.touch(e, 'down'), true);
    this.cv.addEventListener('pointermove', (e) => this.touch(e, 'move'), true);
    this.cv.addEventListener('pointerup', (e) => this.touch(e, 'up'), true);
    this.cv.addEventListener('pointercancel', (e) => this.touch(e, 'up'), true);
    this.cv.addEventListener('pointermove', (e) => this.pointer(e, 'move'));
    this.cv.addEventListener('pointerdown', (e) => this.pointer(e, 'down'));
    this.cv.addEventListener('pointerup', (e) => this.pointer(e, 'up'));
    this.cv.addEventListener('pointercancel', () => {
      this.drag = null;
      this.dragPower = 0;
      this.kick();
    });
    this.cv.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && !this.drag) {
        this.hover = null;
        this.kick();
      }
    });
    this.cv.addEventListener('contextmenu', (e) => e.preventDefault());
    this.spinControl();
    window.addEventListener('keydown', this.onKey);
    onTableArt(() => {
      this.layerKey = '';
      this.kick();
    });
    this.ro = new ResizeObserver(() => {
      this.layerKey = '';
      this.kick();
    });
    this.ro.observe(this.wrap);
  }

  // ---------------------------------------------------------------- раскладка и координаты

  private layout() {
    const v = this.v;
    if (!v) return false;
    this.geo = geoOf(v.cfg);
    this.spec = this.geo.spec;
    const r = this.wrap.getBoundingClientRect();
    if (r.width < 10 || r.height < 10) return false;
    this.cssW = r.width;
    this.cssH = r.height;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(r.width * this.dpr);
    const H = Math.round(r.height * this.dpr);
    if (this.cv.width !== W || this.cv.height !== H) {
      this.cv.width = W;
      this.cv.height = H;
    }
    const F = frameOf(this.geo);
    const tw = this.spec.w + 2 * F;
    const th = this.spec.h + 2 * F;
    const top = (this.ctx.demo ? 6 : 34) * this.dpr;
    const m = 6 * this.dpr;
    // портрет — стол вдоль экрана
    this.rot = H > W * 1.1;
    const aw = W - 2 * m;
    const ah = H - top - m;
    this.S = this.rot ? Math.min(aw / th, ah / tw) : Math.min(aw / tw, ah / th);
    const sw = (this.rot ? th : tw) * this.S;
    const sh = (this.rot ? tw : th) * this.S;
    const left = (W - sw) / 2;
    const tp = top + (ah - sh) / 2;
    // начало координат стола (0, 0) на холсте
    if (this.rot) {
      // x стола — вниз, y стола — влево
      this.ox = left + (this.spec.h + F) * this.S;
      this.oy = tp + F * this.S;
    } else {
      this.ox = left + F * this.S;
      this.oy = tp + F * this.S;
    }
    this.baseS = this.S;
    if (this.zoomZ > 1) {
      // приближение: точка focus — в центре холста, стол не уходит краем внутрь кадра
      const S = (this.S *= this.zoomZ);
      const cx = W / 2;
      const cy = (top + H) / 2;
      const f = this.focus ?? [this.spec.w / 2, this.spec.h / 2];
      const hx = (this.rot ? H - top : W) / 2 / S;
      const hy = (this.rot ? W : H - top) / 2 / S;
      const clampTo = (v: number, half: number, size: number) => (size + 2 * F <= 2 * half ? size / 2 : Math.min(size + F - half, Math.max(-F + half, v)));
      const fx = clampTo(f[0], hx, this.spec.w);
      const fy = clampTo(f[1], hy, this.spec.h);
      this.focus = [fx, fy];
      if (this.rot) {
        this.ox = cx + fy * S;
        this.oy = cy - fx * S;
      } else {
        this.ox = cx - fx * S;
        this.oy = cy - fy * S;
      }
    }
    this.lamps = lampsOf(this.geo);
    this.rim = linRGB(styleOf(v.cfg.variant).cloth).map((c) => c * 0.55) as [number, number, number];
    return true;
  }

  /** Перо холста — в осях стола (метры). */
  private world(g = this.g) {
    if (this.rot) g.setTransform(0, this.S, -this.S, 0, this.ox, this.oy);
    else g.setTransform(this.S, 0, 0, this.S, this.ox, this.oy);
  }
  private toCanvas(x: number, y: number): [number, number] {
    return this.rot ? [this.ox - y * this.S, this.oy + x * this.S] : [this.ox + x * this.S, this.oy + y * this.S];
  }
  private local(e: PointerEvent) {
    const r = this.cv.getBoundingClientRect();
    const X = ((e.clientX - r.left) / r.width) * this.cv.width;
    const Y = ((e.clientY - r.top) / r.height) * this.cv.height;
    return this.rot ? { x: (Y - this.oy) / this.S, y: (this.ox - X) / this.S } : { x: (X - this.ox) / this.S, y: (Y - this.oy) / this.S };
  }
  /** Масштаб стола (1 — весь стол). */
  private setZoom(z: number) {
    this.zoomZ = Math.min(4, Math.max(1, z));
    if (this.zoomZ === 1) this.focus = null;
    this.zoomBar.querySelector<HTMLButtonElement>('[data-z="out"]')!.disabled = this.zoomZ <= 1;
    this.zoomBar.querySelector<HTMLButtonElement>('[data-z="all"]')!.disabled = this.zoomZ <= 1;
    this.zoomBar.querySelector<HTMLButtonElement>('[data-z="in"]')!.disabled = this.zoomZ >= 4;
    this.kick();
  }

  /** Точка стола p оказывается под точкой холста (mx, my) при масштабе z. */
  private anchor(p: { x: number; y: number }, mx: number, my: number, z: number) {
    const W = this.cv.width;
    const H = this.cv.height;
    const top = (this.ctx.demo ? 6 : 34) * this.dpr;
    const S = this.baseS * z;
    const cx = W / 2;
    const cy = (top + H) / 2;
    this.focus = this.rot ? [p.x - (my - cy) / S, p.y + (mx - cx) / S] : [p.x - (mx - cx) / S, p.y - (my - cy) / S];
    this.setZoom(z);
  }

  private canvasXY(e: { clientX: number; clientY: number }) {
    const r = this.cv.getBoundingClientRect();
    return { X: ((e.clientX - r.left) / r.width) * this.cv.width, Y: ((e.clientY - r.top) / r.height) * this.cv.height };
  }

  private wheel(e: WheelEvent) {
    if (this.ctx.demo) return;
    e.preventDefault();
    const { X, Y } = this.canvasXY(e);
    this.anchor(this.local(e as unknown as PointerEvent), X, Y, this.zoomZ * Math.exp(-e.deltaY * 0.0015));
  }

  /** Два пальца — щипок и сдвиг стола (прицел при этом отменяется); один палец — как раньше, прицел. */
  private touch(e: PointerEvent, kind: 'down' | 'move' | 'up') {
    if (this.ctx.demo || e.pointerType === 'mouse') return;
    if (kind === 'up') {
      this.ptrs.delete(e.pointerId);
      if (this.pinch) {
        e.stopImmediatePropagation();
        if (!this.ptrs.size) this.pinch = null;
      }
      return;
    }
    if (kind === 'down') this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    else if (this.ptrs.has(e.pointerId)) this.ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.ptrs.size < 2) return;
    e.stopImmediatePropagation();
    const [a, b] = [...this.ptrs.values()];
    const mid = { clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 };
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (!this.pinch) {
      this.drag = null;
      this.dragPower = 0;
      const p = this.local(mid as unknown as PointerEvent);
      this.pinch = { d0: d, z0: this.zoomZ, tx: p.x, ty: p.y };
      return;
    }
    const { X, Y } = this.canvasXY(mid);
    this.anchor({ x: this.pinch.tx, y: this.pinch.ty }, X, Y, (this.pinch.z0 * d) / Math.max(1, this.pinch.d0));
  }

  /** Направление прицела на экране (единичный вектор в пикселях). */
  private screenDir(a: number): [number, number] {
    return this.rot ? [-Math.sin(a), Math.cos(a)] : [Math.cos(a), Math.sin(a)];
  }

  private balls(): Ball[] {
    return this.anim ?? this.v?.balls ?? [];
  }
  private cueBall(): Ball | undefined {
    return this.v?.balls.find((b) => b.id === this.cue && b.on);
  }
  private cueLook(): CueLook {
    const k = kindOf(this.v!.cfg.variant);
    return k === 'pool' ? CUE_POOL : k === 'snooker' ? CUE_SNOOKER : CUE_RUSSIAN;
  }

  // ---------------------------------------------------------------- управление

  private myTurn() {
    return this.actSeat != null && this.v != null && !this.busy && this.v.turn === this.actSeat && !this.pending;
  }
  private aiming() {
    return this.myTurn() && this.v!.phase === 'shot' && !!this.cueBall();
  }

  private aimAt(p: { x: number; y: number }) {
    const cb = this.cueBall();
    if (!cb) return;
    if (Math.hypot(p.x - cb.x, p.y - cb.y) < this.spec.r * 0.5) return;
    this.aim = Math.atan2(p.y - cb.y, p.x - cb.x);
  }

  private pointer(e: PointerEvent, kind: 'move' | 'down' | 'up') {
    const v = this.v;
    if (!v || this.ctx.demo) return;
    const p = this.local(e);
    const mouse = e.pointerType === 'mouse';
    if (kind !== 'up' || !mouse) this.hover = p;
    if (!this.myTurn()) return void this.kick();
    if (v.phase === 'place') {
      if (kind === 'down') {
        Sound.unlock();
        this.drag = { kind: 'place', sx: e.clientX, sy: e.clientY, moved: false };
        this.cv.setPointerCapture(e.pointerId);
      }
      if (kind === 'up' && (this.drag || mouse)) {
        this.drag = null;
        if (placeOk(v, p.x, p.y)) this.send({ type: 'place', x: p.x, y: p.y });
        else Sound.ui();
      }
      return void this.kick();
    }
    const cb = this.cueBall();
    if (!cb) return;
    if (kind === 'down') {
      Sound.unlock();
      if (mouse && e.button !== 0) return;
      const nearCue = this.nearCue(p);
      this.drag = { kind: mouse || nearCue ? 'power' : 'aim', sx: e.clientX, sy: e.clientY, moved: false };
      this.dragPower = 0;
      this.cv.setPointerCapture(e.pointerId);
      return void this.kick();
    }
    if (kind === 'move') {
      const d = this.drag;
      if (d) {
        if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) > 5) d.moved = true;
        if (d.kind === 'power') {
          const [ax, ay] = this.screenDir(this.aim);
          const pull = -((e.clientX - d.sx) * ax + (e.clientY - d.sy) * ay);
          const full = Math.max(140, Math.min(320, Math.min(this.cssW, this.cssH) * 0.45));
          this.dragPower = Math.max(0, Math.min(1, pull / full));
        } else if (d.moved) this.aimAt(p);
      } else if (mouse) {
        if (e.shiftKey) {
          // тонкая наводка: угол меняется в 10 раз медленнее
          const a = Math.atan2(p.y - cb.y, p.x - cb.x);
          if (this.fineAngle != null) {
            let da = a - this.fineAngle;
            if (da > Math.PI) da -= 2 * Math.PI;
            if (da < -Math.PI) da += 2 * Math.PI;
            this.aim += da * 0.1;
          }
          this.fineAngle = a;
        } else {
          this.fineAngle = null;
          this.aimAt(p);
        }
      }
      return void this.kick();
    }
    // отпустили
    const d = this.drag;
    this.drag = null;
    if (!d) return;
    if (d.kind === 'power' && this.dragPower > 0.015) {
      this.power = this.dragPower;
      this.shoot();
      return;
    }
    this.dragPower = 0;
    if (!d.moved && !this.tap(p) && !mouse) this.aimAt(p);
    this.kick();
  }

  /** Палец на битке или на кие — значит, тянем кий. */
  private nearCue(p: { x: number; y: number }) {
    const cb = this.cueBall()!;
    const rr = this.spec.r;
    const tol = Math.max(rr * 2.2, (22 * this.dpr) / this.S);
    if (Math.hypot(p.x - cb.x, p.y - cb.y) < tol) return true;
    // отрезок кия
    const dx = -Math.cos(this.aim);
    const dy = -Math.sin(this.aim);
    const u = (p.x - cb.x) * dx + (p.y - cb.y) * dy;
    if (u < 0 || u > this.cueLook().len) return false;
    const perp = Math.abs((p.x - cb.x) * -dy + (p.y - cb.y) * dx);
    return perp < tol * 0.8;
  }

  /** Нажатие без движения: выбор битка (американка) или заказ лузы. */
  private tap(p: { x: number; y: number }): boolean {
    const v = this.v!;
    const t = this.spec;
    const hit = v.balls.find((b) => b.on && (b.x - p.x) ** 2 + (b.y - p.y) ** 2 < t.r * t.r * 2.2);
    if (hit && hit.id !== this.cue && cueBalls(v).includes(hit.id)) {
      this.cue = hit.id;
      Sound.ui();
      this.renderPanel();
      return true;
    }
    if (this.needsCall()) {
      const pk = this.geo.pockets.findIndex((q) => (q.cx - p.x) ** 2 + (q.cy - p.y) ** 2 < (q.hole * 1.8) ** 2);
      if (pk >= 0) {
        this.callPocket = pk;
        Sound.ui();
        this.updateCall();
        return true;
      }
    }
    return false;
  }

  private key(e: KeyboardEvent) {
    if (!this.aiming() || (e.target as HTMLElement)?.closest?.('input, textarea')) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const step = e.shiftKey ? 0.0004 : 0.004;
      this.aim += (e.key === 'ArrowLeft' ? -1 : 1) * step * (this.rot ? -1 : 1);
      e.preventDefault();
      this.kick();
    } else if (e.key === 'Escape' && this.drag) {
      this.drag = null;
      this.dragPower = 0;
      this.kick();
    }
  }

  private needsCall() {
    const v = this.v!;
    return v.cfg.variant === 'classic' || (v.cfg.variant === 'pool8' && this.predict()?.ball === 8);
  }

  private shoot() {
    const v = this.v!;
    const pr = this.predict();
    let call: { ball: number; pocket: number } | undefined;
    if (this.needsCall()) {
      const ball = pr?.ball ?? v.balls.find((b) => b.on && b.id !== 0)!.id;
      call = { ball, pocket: this.callPocket ?? pr?.pocket ?? 0 };
    }
    this.pending = { angle: this.aim, pull: this.dragPower * PULL, ball: this.cue };
    this.dragPower = 0;
    this.send({ type: 'shot', cue: this.cue, angle: this.aim, power: this.power, spinX: this.spin.x, spinY: this.spin.y, call });
    // ответа нет (ход отклонён) — снять кий через секунду
    setTimeout(() => {
      if (this.pending && !this.busy) {
        this.pending = null;
        this.kick();
      }
    }, 1500);
  }

  private send(a: Action) {
    const seat = this.actSeat;
    if (seat == null) return;
    Sound.unlock();
    this.actSeat = null;
    this.callPocket = null;
    this.renderPanel();
    this.ctx.act(seat, a);
  }

  /** Куда придёт биток: первый шар (куда тот покатится, куда отскочит биток, ближайшая по направлению луза) или борт. */
  private predict(): { x: number; y: number; ball: number | null; dir: number | null; tan: number | null; pocket: number | null } | null {
    const v = this.v;
    const cb = this.cueBall();
    if (!v || !cb) return null;
    const t = this.spec;
    const dx = Math.cos(this.aim);
    const dy = Math.sin(this.aim);
    let best = Infinity;
    let ball: Ball | null = null;
    for (const b of v.balls) {
      if (!b.on || b.id === cb.id) continue;
      const fx = b.x - cb.x;
      const fy = b.y - cb.y;
      const proj = fx * dx + fy * dy;
      if (proj <= 0) continue;
      const perp2 = fx * fx + fy * fy - proj * proj;
      const rr = 4 * t.r * t.r;
      if (perp2 > rr) continue;
      const d = proj - Math.sqrt(rr - perp2);
      if (d < best) {
        best = d;
        ball = b;
      }
    }
    const lim = (pos: number, d: number, max: number) => (d > 0 ? (max - t.r - pos) / d : d < 0 ? (t.r - pos) / d : Infinity);
    const wall = Math.min(lim(cb.x, dx, t.w), lim(cb.y, dy, t.h));
    if (!ball || wall < best) return { x: cb.x + dx * wall, y: cb.y + dy * wall, ball: null, dir: null, tan: null, pocket: null };
    const gx = cb.x + dx * best;
    const gy = cb.y + dy * best;
    const dir = Math.atan2(ball.y - gy, ball.x - gx);
    // биток уходит по касательной (правило 90°) — в ту сторону, куда смещён удар
    const cross = dx * Math.sin(dir) - dy * Math.cos(dir);
    const tan = dir + (cross > 0 ? -Math.PI / 2 : Math.PI / 2);
    let pocket = 0;
    let bestA = Infinity;
    this.geo.pockets.forEach((q, k) => {
      let a = Math.abs(Math.atan2(q.y - ball!.y, q.x - ball!.x) - dir);
      if (a > Math.PI) a = 2 * Math.PI - a;
      if (a < bestA) {
        bestA = a;
        pocket = k;
      }
    });
    return { x: gx, y: gy, ball: ball.id, dir, tan, pocket };
  }

  // ---------------------------------------------------------------- винт

  private spinControl() {
    const sp = this.hud.spin;
    let down = false;
    const set = (e: PointerEvent) => {
      const r = sp.getBoundingClientRect();
      let x = ((e.clientX - r.left) / r.width) * 2 - 1;
      let y = -(((e.clientY - r.top) / r.height) * 2 - 1);
      x /= 0.8;
      y /= 0.8;
      const d = Math.hypot(x, y);
      if (d > 1) {
        x /= d;
        y /= d;
      }
      this.spin = { x: Math.round(x * 20) / 20, y: Math.round(y * 20) / 20 };
      this.paintSpin();
    };
    sp.addEventListener('pointerdown', (e) => {
      down = true;
      sp.setPointerCapture(e.pointerId);
      set(e);
    });
    sp.addEventListener('pointermove', (e) => down && set(e));
    sp.addEventListener('pointerup', () => (down = false));
    sp.addEventListener('dblclick', () => {
      this.spin = { x: 0, y: 0 };
      this.paintSpin();
    });
    this.paintSpin();
  }

  private paintSpin() {
    const g = this.hud.spin.getContext('2d')!;
    const N = 160;
    const c = N / 2;
    const R = N * 0.4;
    g.clearRect(0, 0, N, N);
    const gr = g.createRadialGradient(c - R * 0.35, c - R * 0.4, R * 0.05, c, c, R);
    gr.addColorStop(0, '#ffffff');
    gr.addColorStop(0.5, '#ece8de');
    gr.addColorStop(1, '#a9a49a');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(c, c, R, 0, Math.PI * 2);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,0.25)';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(c - R, c);
    g.lineTo(c + R, c);
    g.moveTo(c, c - R);
    g.lineTo(c, c + R);
    g.stroke();
    // предел — дальше кий соскальзывает
    g.setLineDash([4, 4]);
    g.beginPath();
    g.arc(c, c, R * 0.8, 0, Math.PI * 2);
    g.stroke();
    g.setLineDash([]);
    const x = c + this.spin.x * R * 0.8;
    const y = c - this.spin.y * R * 0.8;
    g.fillStyle = '#2f5f9e';
    g.beginPath();
    g.arc(x, y, R * 0.16, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.6)';
    g.beginPath();
    g.arc(x - R * 0.05, y - R * 0.05, R * 0.05, 0, Math.PI * 2);
    g.fill();
    const lbl = this.hud.spinBox.querySelector('span')!;
    const sx = this.spin.x;
    const sy = this.spin.y;
    lbl.textContent = Math.hypot(sx, sy) < 0.1 ? 'винт: центр' : sy > 0.25 ? 'накат' : sy < -0.25 ? 'оттяжка' : sx > 0 ? 'правый винт' : 'левый винт';
  }

  // ---------------------------------------------------------------- рисование

  private kick() {
    if (this.raf) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      this.draw();
    });
  }

  private draw(now = performance.now()) {
    const v = this.v;
    if (!v || !this.layout()) return;
    const g = this.g;
    const W = this.cv.width;
    const H = this.cv.height;
    // статичный слой
    const key = `${v.cfg.variant}:${v.cfg.size}:${v.cfg.wide}:${W}x${H}:${this.rot}:${this.zoomZ.toFixed(3)}:${this.focus?.map((x) => x.toFixed(3)).join(',')}`;
    if (key !== this.layerKey || !this.layer) {
      this.layerKey = key;
      this.layer = this.layer ?? document.createElement('canvas');
      this.layer.width = W;
      this.layer.height = H;
      const lg = this.layer.getContext('2d')!;
      lg.setTransform(1, 0, 0, 1, 0, 0);
      lg.clearRect(0, 0, W, H);
      this.world(lg);
      drawTable(lg, this.geo, v.cfg.variant, this.S);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, W, H);
    g.drawImage(this.layer, 0, 0);
    const t = this.spec;
    const st = styleOf(v.cfg.variant);
    this.world();

    // шары в сетках луз
    if (st.nets) this.drawPocketBalls();

    // зона «с руки»
    const placing = this.myTurn() && v.phase === 'place';
    if (placing) {
      g.fillStyle = 'rgba(255,255,230,0.07)';
      if (v.zone === 'kitchen') g.fillRect(0, 0, t.w / 4, t.h);
      else if (v.zone === 'D') {
        const { baulk, dRad } = snookerMarks(t);
        g.beginPath();
        g.arc(baulk, t.h / 2, dRad, Math.PI / 2, Math.PI * 1.5);
        g.fill();
      }
    }

    // подсказка прицела
    const aiming = this.aiming();
    const cb = this.cueBall();
    if (aiming && cb) this.drawGuide(cb);

    // тени и шары
    const list = this.balls().filter((b) => b.on);
    for (const b of list) this.shadow(b.x, b.y, 1);
    for (const f of this.falls) this.drawFall(f, now);
    for (const b of list) this.drawBall(b);

    // выбранный биток (американка)
    if (aiming && cb && cueBalls(v).length > 1) {
      g.strokeStyle = 'rgba(255,215,90,0.9)';
      g.lineWidth = 2 / this.S;
      g.beginPath();
      g.arc(cb.x, cb.y, t.r * 1.25, 0, Math.PI * 2);
      g.stroke();
    }

    // с руки: призрак битка
    if (placing && this.hover) {
      const ok = placeOk(v, this.hover.x, this.hover.y);
      g.globalAlpha = ok ? 0.9 : 0.35;
      this.shadow(this.hover.x, this.hover.y, 0.6);
      this.drawBall({ id: 0, x: this.hover.x, y: this.hover.y, on: true }, true);
      g.globalAlpha = 1;
      this.world();
    }

    // кий
    const look = this.cueLook();
    if (this.cueAnim) {
      const b = this.balls().find((x) => x.id === this.cueAnim!.ball);
      if (b && this.cueAnim.alpha > 0.01) {
        const { angle, pull, alpha } = this.cueAnim;
        drawCue(g, b.x - Math.cos(angle) * (t.r + GAP + pull), b.y - Math.sin(angle) * (t.r + GAP + pull), angle, look, this.S, alpha, this.rot);
      }
    } else if (this.pending && cb) {
      const { angle, pull } = this.pending;
      drawCue(g, cb.x - Math.cos(angle) * (t.r + GAP + pull), cb.y - Math.sin(angle) * (t.r + GAP + pull), angle, look, this.S, 1, this.rot);
    } else if (aiming && cb) {
      const pull = this.drag?.kind === 'power' ? this.dragPower * PULL : 0;
      drawCue(g, cb.x - Math.cos(this.aim) * (t.r + GAP + pull), cb.y - Math.sin(this.aim) * (t.r + GAP + pull), this.aim, look, this.S, 1, this.rot);
    }
    g.setTransform(1, 0, 0, 1, 0, 0);
    this.updateHud();
  }

  private drawGuide(cb: Ball) {
    const g = this.g;
    const v = this.v!;
    const t = this.spec;
    const pr = this.predict();
    if (!pr) return;
    const px1 = 1 / this.S;
    const dx = Math.cos(this.aim);
    const dy = Math.sin(this.aim);
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(255,255,255,0.7)';
    g.lineWidth = 1.4 * px1 * this.dpr;
    g.beginPath();
    g.moveTo(cb.x + dx * t.r, cb.y + dy * t.r);
    g.lineTo(pr.x - dx * t.r, pr.y - dy * t.r);
    g.stroke();
    // шар-призрак
    g.fillStyle = 'rgba(255,255,255,0.1)';
    g.beginPath();
    g.arc(pr.x, pr.y, t.r, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    if (pr.ball != null && pr.dir != null && pr.tan != null) {
      const tb = v.balls.find((b) => b.id === pr.ball)!;
      const legal = legalTargets(v, v.turn).includes(pr.ball) || (v.cfg.variant !== 'pool8' && v.cfg.variant !== 'snooker');
      // направление прицельного и битка: длина — по «полноте» удара
      const full = Math.abs(Math.cos(pr.dir - this.aim));
      const len = 0.12 + 0.35 * full;
      g.strokeStyle = legal ? 'rgba(255,240,160,0.9)' : 'rgba(255,90,70,0.95)';
      g.lineWidth = 2 * px1 * this.dpr;
      g.beginPath();
      g.moveTo(tb.x + Math.cos(pr.dir) * t.r, tb.y + Math.sin(pr.dir) * t.r);
      g.lineTo(tb.x + Math.cos(pr.dir) * (t.r + len), tb.y + Math.sin(pr.dir) * (t.r + len));
      g.stroke();
      if (full < 0.995) {
        g.strokeStyle = 'rgba(255,255,255,0.4)';
        g.lineWidth = 1.2 * px1 * this.dpr;
        g.setLineDash([5 * px1 * this.dpr, 5 * px1 * this.dpr]);
        g.beginPath();
        g.moveTo(pr.x, pr.y);
        g.lineTo(pr.x + Math.cos(pr.tan) * (0.08 + 0.3 * (1 - full)), pr.y + Math.sin(pr.tan) * (0.08 + 0.3 * (1 - full)));
        g.stroke();
        g.setLineDash([]);
      }
      if (!legal) {
        g.strokeStyle = 'rgba(255,90,70,0.9)';
        g.beginPath();
        g.arc(tb.x, tb.y, t.r * 1.3, 0, Math.PI * 2);
        g.stroke();
      }
    }
    // заказанная луза
    if (this.needsCall()) {
      const k = this.callPocket ?? pr.pocket;
      if (k != null) {
        const q = this.geo.pockets[k];
        g.strokeStyle = '#ffd24a';
        g.lineWidth = 3 * px1 * this.dpr;
        g.beginPath();
        g.arc(q.cx, q.cy, q.hole * 1.15, 0, Math.PI * 2);
        g.stroke();
      }
    }
    g.lineCap = 'butt';
  }

  /** Мягкие тени от ламп и контактная тень под шаром. */
  private shadow(x: number, y: number, k: number) {
    const g = this.g;
    const r = this.spec.r;
    for (const l of this.lamps) {
      // от большого плафона тень мягкая и короткая
      const dx = x - l.x;
      const dy = y - l.y;
      const sx = x + (dx / l.z) * r * 0.55;
      const sy = y + (dy / l.z) * r * 0.55;
      const rr = r * (1.25 + Math.min(l.hx, l.hy) * 2);
      const gr = g.createRadialGradient(sx, sy, r * 0.25, sx, sy, rr);
      gr.addColorStop(0, `rgba(0,0,0,${(0.5 / Math.sqrt(this.lamps.length)) * k})`);
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      g.beginPath();
      g.arc(sx, sy, rr, 0, Math.PI * 2);
      g.fill();
    }
    const gr = g.createRadialGradient(x, y, 0, x, y, r * 0.75);
    gr.addColorStop(0, `rgba(0,0,0,${0.55 * k})`);
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.beginPath();
    g.arc(x, y, r * 0.75, 0, Math.PI * 2);
    g.fill();
  }

  private orientation(id: number) {
    let m = this.orient.get(id);
    if (!m) this.orient.set(id, (m = randomOrientation(id + 1)));
    return m;
  }

  /** Шар: спрайт перерисовывается, только если сдвинулся или повернулся. */
  private drawBall(b: Ball, ghost = false, scale = 1, dark = 0) {
    const v = this.v!;
    const id = ghost ? -1 : b.id;
    let sp = this.sprites.get(id);
    if (!sp) this.sprites.set(id, (sp = new BallSprite()));
    const m = ghost ? this.orientation(0) : this.orientation(b.id);
    const rp = this.spec.r * this.S * scale;
    const key = `${v.cfg.variant}:${rp.toFixed(2)}:${Math.round(b.x * 200)}:${Math.round(b.y * 200)}:${this.rot}:${m[0].toFixed(4)}${m[4].toFixed(4)}${m[8].toFixed(4)}${m[1].toFixed(4)}`;
    if (sp.key !== key) {
      sp.key = key;
      sp.paint(ballTexture(v.cfg.variant, b.id), m, rp, b.x, b.y, this.spec.r, this.lamps, this.rot, this.rim);
    }
    const [X, Y] = this.toCanvas(b.x, b.y);
    const g = this.g;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(sp.canvas, X - sp.size / 2, Y - sp.size / 2);
    if (dark > 0) {
      g.fillStyle = `rgba(0,0,0,${dark})`;
      g.beginPath();
      g.arc(X, Y, rp, 0, Math.PI * 2);
      g.fill();
    }
    this.world();
  }

  /** Шар уходит в лузу: докатывается к центру провала, проваливается (темнеет, уменьшается). */
  private drawFall(f: Fall, now: number) {
    const q = this.geo.pockets[f.pocket];
    const k = Math.min(1, (now - f.t0) / 220);
    const x = f.x + (q.cx - f.x) * Math.min(1, k * 1.6);
    const y = f.y + (q.cy - f.y) * Math.min(1, k * 1.6);
    if (k >= 1) return;
    this.drawBall({ id: f.id, x, y, on: true }, false, 1 - 0.3 * k, 0.15 + 0.75 * k);
  }

  private pocketSlot(pk: number, i: number): [number, number] {
    const q = this.geo.pockets[pk];
    const r = this.spec.r * 0.8;
    const a = Math.atan2(q.ay, q.ax) + (i % 2 ? 1 : -1) * Math.ceil(i / 2) * 0.9;
    const d = i ? r * 0.9 : 0;
    return [q.cx + q.ax * r * 0.3 + Math.cos(a) * d, q.cy + q.ay * r * 0.3 + Math.sin(a) * d];
  }

  private drawPocketBalls() {
    this.inPockets.forEach((ids, pk) => {
      ids.slice(-5).forEach((id, i) => {
        const [x, y] = this.pocketSlot(pk, i);
        this.drawBall({ id, x, y, on: true }, false, 0.82, 0.62);
      });
    });
  }

  // ---------------------------------------------------------------- шкала силы

  private updateHud() {
    const show = this.aiming() || !!this.pending;
    this.hud.power.hidden = !show;
    this.hud.spinBox.hidden = !this.aiming();
    if (!show) return;
    const dragging = this.drag?.kind === 'power';
    const p = dragging ? this.dragPower : this.pending ? this.power : 0;
    this.hud.fill.style.width = `${(p * 100).toFixed(1)}%`;
    this.hud.power.classList.toggle('on', dragging || !!this.pending);
    this.hud.label.textContent = dragging || this.pending ? `Сила ${Math.round(p * 100)}%` : this.ctx.demo ? '' : 'Нажмите и тяните назад';
  }

  // ---------------------------------------------------------------- панель

  private renderPanel() {
    const v = this.v;
    if (!v) return;
    const t = v.cfg.variant;
    const kind = kindOf(t);
    const score = v.seats
      .map((p) => {
        const grp = t === 'pool8' && v.groups[p] ? ` · ${v.groups[p] === 'solid' ? 'сплошные' : v.groups[p] === 'stripe' ? 'полосатые' : 'все'}` : '';
        const val =
          t === 'pool8' ? (v.groups[p] ? `${ownBalls(v, p).length} осталось` : 'стол открыт') : `${v.score[p]}${t === 'classic' || t === 'snooker' ? ' очков' : ' шаров'}`;
        return `<div class="bl-score${v.turn === p ? ' on' : ''}" style="--c:${SEATS[p].color}"><b>${esc(this.plain(p))}</b> ${val}${grp}</div>`;
      })
      .join('');
    const ft = SIZE_FT[kind][v.cfg.size];
    const table = `${kind === 'pool' ? 'пул' : kind === 'snooker' ? 'снукер' : 'русский'}, ${ft} футов${v.cfg.wide ? ', лузы пошире' : ''}`;
    let on = '';
    if (t === 'snooker' && v.phase !== 'over') {
      const s = v.snk ?? 'red';
      on = `<div class="bl-on">На очереди: <b>${s === 'red' ? 'красный' : s === 'colour' ? 'любой цветной' : SNK_NAMES[s as number]}</b>${v.brk ? ` · серия ${v.brk}` : ''}</div>`;
    }
    const mine = this.myTurn();
    this.panel.innerHTML = `<div class="bl-title">${VARIANT_NAME[t]} <small>${table}</small></div>${score}${on}
      ${v.last ? `<div class="bl-last">${esc(this.plain(v.last.seat))}: ${esc(v.last.text)}</div>` : ''}
      <div class="bl-call"></div>
      ${
        mine && v.phase === 'place'
          ? `<div class="bl-hint">Поставьте биток ${v.zone === 'kitchen' ? 'в «доме» (левая четверть стола)' : v.zone === 'D' ? 'в «D» у левого борта' : 'куда угодно'} — нажмите на стол.</div>`
          : mine && v.phase === 'shot'
            ? `<div class="bl-hint">Прицел — мышью или пальцем по столу. Удар — нажать и тянуть назад, отпустить.${cueBalls(v).length > 1 ? ' Битком может быть любой шар — нажмите на него.' : ''}</div>`
            : ''
      }`;
    this.updateCall();
  }

  private updateCall() {
    const el = this.panel.querySelector('.bl-call') as HTMLElement | null;
    if (!el || !this.v) return;
    if (!this.aiming() || !this.needsCall()) {
      el.textContent = '';
      return;
    }
    const pr = this.predict();
    const pk = this.callPocket ?? pr?.pocket;
    el.innerHTML =
      pr?.ball != null ? `Заказ: <b>${ballName(this.v.cfg, pr.ball)}</b> → ${POCKET_NAMES[pk ?? 0]} <small>(луза — нажатием)</small>` : 'Заказ: наведите на шар';
  }

  private plain(seat: number) {
    return this.ctx.name(seat).replace(/<[^>]+>/g, '');
  }

  // ---------------------------------------------------------------- состояние

  setView(v: View) {
    const prev = this.v;
    this.v = v;
    if (!prev || prev.cfg.variant !== v.cfg.variant || prev.cfg.size !== v.cfg.size || prev.cfg.wide !== v.cfg.wide) {
      this.layerKey = '';
      this.inPockets = [[], [], [], [], [], []];
      this.sprites.clear();
    }
    this.banner.hidden = true;
    this.anim = null;
    this.falls = [];
    this.cueAnim = null;
    if (!cueBalls(v).includes(this.cue)) this.cue = 0;
    // сетки: убрать выставленные обратно, добавить упавшие, о которых не знали
    const onT = new Set(v.balls.filter((b) => b.on).map((b) => b.id));
    this.inPockets = this.inPockets.map((ids) => ids.filter((id) => !onT.has(id)));
    const known = new Set(this.inPockets.flat());
    let k = 0;
    for (const b of v.balls) if (!b.on && b.id !== 0 && !known.has(b.id)) this.inPockets[k++ % 6].push(b.id);
    this.layout();
    this.renderPanel();
    this.kick();
  }

  async play(events: Event[], v: View) {
    this.busy = true;
    try {
      for (const ev of events) {
        if (ev.type === 'shot') await this.animate(ev);
        else if (ev.type === 'place') {
          Sound.place();
          await sleep(150);
        } else if (ev.type === 'end') {
          Sound.win();
          this.banner.textContent = ev.winners.length ? `Победа: ${ev.winners.map((p) => this.plain(p)).join(', ')}` : 'Партия проиграна';
          this.banner.hidden = false;
        }
      }
    } finally {
      this.busy = false;
      this.anim = null;
      this.pending = null;
      this.cueAnim = null;
      Sfx.rolling(0);
    }
    const banner = this.banner.hidden ? null : this.banner.textContent;
    this.setView(v);
    if (banner) {
      this.banner.textContent = banner;
      this.banner.hidden = false;
    }
  }

  private frameLoop(step: (now: number) => boolean): Promise<void> {
    return new Promise((done) => {
      const tick = (now: number) => {
        if (!this.v) return done();
        const more = step(now);
        this.draw(now);
        if (more) requestAnimationFrame(tick);
        else done();
      };
      requestAnimationFrame(tick);
    });
  }

  private async animate(ev: Extract<Event, { type: 'shot' }>) {
    const speed = Math.max(0.25, this.ctx.speed());
    const fr = ev.frames;
    if (!fr.length || !this.v) return;
    const ids = ev.ids;
    const n = ids.length;
    // кадры → полные позиции
    const xs: Float64Array[] = [];
    const ys: Float64Array[] = [];
    const pk: Int8Array[] = [];
    {
      const x = new Float64Array(n);
      const y = new Float64Array(n);
      const p = new Int8Array(n).fill(-2);
      for (const f of fr) {
        for (let i = 0; i < f.p.length; i += 3) {
          const j = f.p[i];
          if (f.p[i + 1] < 0) {
            p[j] = f.p[i + 2];
          } else {
            x[j] = f.p[i + 1] / 1000;
            y[j] = f.p[i + 2] / 1000;
            p[j] = -2;
          }
        }
        xs.push(x.slice());
        ys.push(y.slice());
        pk.push(p.slice());
      }
    }
    const at = (f: number): Ball[] => ids.map((id, j) => ({ id, x: xs[f][j], y: ys[f][j], on: pk[f][j] === -2 }));
    this.anim = at(0);
    const cueId = ev.cue;
    const t = this.spec;

    // ---- кий: прицел, оттяжка, удар
    const pull = Math.min(1, ev.power * 1.15) * PULL;
    const own = this.pending;
    this.pending = null;
    const startPull = own ? own.pull : 0;
    if (!own) {
      // соперник или бот: кий появляется, оттягивается
      const t0 = performance.now();
      const dur = 520 / speed;
      await this.frameLoop((now) => {
        const k = Math.min(1, (now - t0) / dur);
        const e = 1 - (1 - k) ** 3;
        this.cueAnim = { angle: ev.angle, pull: 0.06 + (pull - 0.06) * e, alpha: Math.min(1, k * 3), ball: cueId };
        return k < 1;
      });
      await sleep(140 / speed);
    }
    {
      const from = own ? startPull : pull;
      const t0 = performance.now();
      const dur = (45 + 40 * (1 - ev.power)) / speed;
      await this.frameLoop((now) => {
        const k = Math.min(1, (now - t0) / dur);
        this.cueAnim = { angle: ev.angle, pull: from - (from + GAP * 0.9) * k * k, alpha: 1, ball: cueId };
        return k < 1;
      });
    }

    // ---- шары
    const style = styleOf(this.v.cfg.variant);
    const hits = ev.hits ?? [];
    let hi = 0;
    const end = fr[fr.length - 1].t;
    const start = performance.now();
    const last = this.anim.map((b) => [b.x, b.y]);
    const gone = new Set<number>();
    this.falls = [];
    const pan = (xcm: number) => (this.rot ? 0 : ((xcm / 100) / t.w) * 2 - 1);
    let prevT = 0;
    await this.frameLoop((now) => {
      const tt = (now - start) * speed;
      // звуки
      while (hi < hits.length && hits[hi][0] <= tt) {
        const hh = hits[hi++];
        const sp = hh[2] / 100;
        if (hh[1] === HIT_CUE) Sfx.cueStrike(sp, { pan: pan(hh[3]) });
        else if (hh[1] === HIT_BALL) Sfx.ballClick(sp, { pan: pan(hh[3]) });
        else if (hh[1] === HIT_RAIL) Sfx.cushionThud(sp, { pan: pan(hh[3]) });
        else if (hh[1] === HIT_POCKET) Sfx.pocketDrop(sp, style.nets, this.inPockets[hh[5]]?.length > 0, { pan: pan(hh[3]) });
      }
      // кий: проходит чуть вперёд и тает
      if (this.cueAnim) {
        const k = Math.min(1, tt / 260);
        this.cueAnim = { ...this.cueAnim, pull: -GAP * 0.9 - 0.03 * Math.sin(Math.min(1, k * 2) * Math.PI * 0.5), alpha: 1 - k };
        if (k >= 1) this.cueAnim = null;
      }
      let i = 0;
      while (i < fr.length - 1 && fr[i + 1].t <= tt) i++;
      const a = i;
      const b = Math.min(fr.length - 1, i + 1);
      const k = fr[b].t > fr[a].t ? Math.max(0, Math.min(1, (tt - fr[a].t) / (fr[b].t - fr[a].t))) : 1;
      let speedSum = 0;
      const dt = Math.max(1, tt - prevT) / 1000;
      prevT = tt;
      this.anim = ids.map((id, j) => {
        const onA = pk[a][j] === -2;
        const onB = pk[b][j] === -2;
        if (!onA || (!onB && k >= 1)) {
          if (!gone.has(id) && (pk[a][j] >= 0 || pk[b][j] >= 0)) {
            gone.add(id);
            const p = pk[a][j] >= 0 ? pk[a][j] : pk[b][j];
            this.falls.push({ id, x: last[j][0], y: last[j][1], pocket: p, t0: now });
            // в сетку (вернувшиеся на стол уберёт setView)
            if (style.nets) setTimeout(() => this.inPockets[p].push(id), 220 / speed);
          }
          return { id, x: last[j][0], y: last[j][1], on: false };
        }
        const x = onB ? xs[a][j] + (xs[b][j] - xs[a][j]) * k : xs[a][j];
        const y = onB ? ys[a][j] + (ys[b][j] - ys[a][j]) * k : ys[a][j];
        const ddx = x - last[j][0];
        const ddy = y - last[j][1];
        if (ddx || ddy) {
          roll(this.orientation(id), ddx, ddy, t.r);
          speedSum += Math.hypot(ddx, ddy) / dt;
        }
        last[j][0] = x;
        last[j][1] = y;
        return { id, x, y, on: true };
      });
      Sfx.rolling(Math.min(1, (speedSum / speed) / 4));
      return tt < end || this.falls.some((f) => now - f.t0 < 220);
    });
    Sfx.rolling(0);
    this.falls = [];
    await sleep(200 / speed);
  }

  setTurn(_toAct: number[], interactive: number[]) {
    if (this.busy) return;
    const v = this.v;
    if (!v || this.ctx.demo) return;
    this.actSeat = interactive.find((x) => x === v.turn) ?? null;
    if (this.actSeat != null) {
      if (!cueBalls(v).includes(this.cue)) this.cue = 0;
      const cb = this.cueBall() ?? v.balls.find((b) => b.id === 0);
      const t = tableOf(v.cfg);
      // прицел по умолчанию — в ближайший разрешённый шар (на разбое — в пирамиду)
      if (cb && !this.hover) {
        const legal = legalTargets(v, v.turn)
          .map((id) => v.balls.find((b) => b.id === id && b.on))
          .filter((b): b is Ball => !!b && b.id !== cb.id);
        const near = legal.sort((a, b) => Math.hypot(a.x - cb.x, a.y - cb.y) - Math.hypot(b.x - cb.x, b.y - cb.y))[0];
        this.aim = near ? Math.atan2(near.y - cb.y, near.x - cb.x) : Math.atan2(t.h / 2 - cb.y, t.w * 0.75 - cb.x);
      }
    }
    this.renderPanel();
    this.kick();
  }

  status(v: View, toAct: number[], interactive: number[]) {
    if (v.phase === 'over') return 'Партия окончена';
    const mine = interactive.includes(toAct[0]);
    const name = this.ctx.name(toAct[0]);
    if (v.phase === 'place') return mine ? 'Поставьте биток с руки' : `${name} ставит биток…`;
    if (!mine) return `Бьёт ${name}…`;
    if (v.cfg.variant === 'pool8') {
      const g = v.groups[v.turn];
      return g ? (ownBalls(v, v.turn).length ? `Ваш удар: ${g === 'solid' ? 'сплошные' : g === 'stripe' ? 'полосатые' : 'любые'}` : 'Ваш удар: восьмёрка!') : 'Ваш удар: стол открыт';
    }
    if (v.cfg.variant === 'snooker') {
      const s = v.snk ?? 'red';
      return `Ваш удар: ${s === 'red' ? 'красный' : s === 'colour' ? 'цветной' : SNK_NAMES[s as number]}`;
    }
    return 'Ваш удар';
  }

  playerStats(v: View, seat: number) {
    if (v.cfg.variant === 'pool8') return v.groups[seat] ? (v.groups[seat] === 'solid' ? 'сплошные' : v.groups[seat] === 'stripe' ? 'полосатые' : '') : '';
    return `${v.score[seat]}${v.cfg.variant === 'classic' || v.cfg.variant === 'snooker' ? ' очк.' : ' шар.'}`;
  }

  destroy() {
    this.ro.disconnect();
    window.removeEventListener('keydown', this.onKey);
    if (this.raf) cancelAnimationFrame(this.raf);
    Sfx.rolling(0);
    this.v = null;
  }
}

export function createView(): GameView<View, Event> {
  return new BilliardsView();
}
