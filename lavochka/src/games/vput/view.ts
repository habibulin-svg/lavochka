/* В путь-дорогу — отрисовка. Поле нарисовано по фото коробки «Малыша»: белый лист, зелёные полосы, кольцевые дорожки
 * (скруглённые, как на поле, — суперэллипс), клетки по общим лучам из центра, остановки «А» и синие стрелки.
 * Город и парки — вырезки из фото (public/tex/vput). Автобусы — открытые пластиковые «ванночки» сверху, ребята — фигурки
 * на подставках. Ход: бросок — кнопкой (или тапом по полю), затем касание пешехода (или ребят в городе) и подсвеченной
 * клетки; автобусы двигает кнопка; посадка — касание своего пешехода под автобусом или кнопка. */
import { Sound } from '../../core/audio';
import { DiceTray } from '../../core/dice';
import { h, sleep, touchScreen } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { ARROWS, boardable, CELLS, CITY, fwd, legal, RAYS, RIDING, STOP, type Action, type Event, type State } from './engine';
import './vput.css';

const TEX = `${import.meta.env.BASE_URL}tex/vput/`;
const CX = 806;
const CY = 575;
const A = 515;
const B = 367;
const NN = 2.59;
const INNER: [number, number] = [-130, -11];
const OUTER: [number, number] = [12, 128];
const VB = { x: 56, y: -32, w: 1500, h: 1214 };
const COL = [
  { fill: '#f2c814', light: '#fff07a', dark: '#8a6a00', head: '#ffe88a' },
  { fill: '#e0262a', light: '#ff7a6e', dark: '#6a0608', head: '#ff9a8a' },
  { fill: '#1f6e38', light: '#4cb066', dark: '#0a3518', head: '#7ad08e' },
  { fill: '#1e3290', light: '#5a72d8', dark: '#0a1448', head: '#8aa0ff' },
];
const PARKS = ['yellow', 'red', 'green', 'blue'];
/** Угол парка: знаки x и y от центра. */
const PARK_DIR: [number, number][] = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
];

const rad = (d: number) => (d * Math.PI) / 180;
function R(t: number, da: number): number {
  return 1 / ((Math.abs(Math.cos(t)) / (A + da)) ** NN + (Math.abs(Math.sin(t)) / (B + da)) ** NN) ** (1 / NN);
}
function pt(deg: number, da: number): [number, number] {
  const t = rad(deg);
  const r = R(t, da);
  return [CX + r * Math.cos(t), CY + r * Math.sin(t)];
}
const f1 = (n: number) => n.toFixed(1);

/** Замкнутый контур дорожки на отступе da. */
function loop(da: number): string {
  let d = '';
  for (let i = 0; i < 240; i++) {
    const [x, y] = pt((i * 360) / 240, da);
    d += `${i ? 'L' : 'M'}${f1(x)} ${f1(y)}`;
  }
  return d + 'Z';
}

const cellA0 = (k: number) => RAYS[k];
const cellA1 = (k: number) => (k === CELLS - 1 ? 360 : RAYS[k + 1]);
const mid = (k: number) => (cellA0(k) + cellA1(k)) / 2;
/** Контур клетки k на кольце [da0, da1]. */
function cellPath(k: number, [da0, da1]: [number, number]): string {
  const a0 = cellA0(k);
  const a1 = cellA1(k);
  const pts: [number, number][] = [];
  for (let i = 0; i <= 8; i++) pts.push(pt(a0 + ((a1 - a0) * i) / 8, da1));
  for (let i = 8; i >= 0; i--) pts.push(pt(a0 + ((a1 - a0) * i) / 8, da0));
  return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${f1(x)} ${f1(y)}`).join('') + 'Z';
}
const center = (k: number, ring: [number, number]) => pt(mid(k), (ring[0] + ring[1]) / 2);
/** Направление вдоль дорожки (вперёд — против часовой) в градусах для поворота фигур. */
const along = (k: number) => mid(k) - 90;

function parkRect(i: number): [number, number, number, number] {
  const [sx, sy] = PARK_DIR[i];
  const x = sx < 0 ? CX - 750 : CX + 410;
  const y = sy < 0 ? CY - 607 : CY + 282;
  return [x, y, 340, 325];
}

/** Знак остановки «А →» или синяя стрелка, повёрнутые «лицом» к центру. */
function sign(k: number, ring: [number, number], body: string): string {
  const [x, y] = center(k, ring);
  return `<g transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(mid(k) - 90)})">${body}</g>`;
}
const STOP_SIGN = `<text x="-22" y="20" class="vp-a">А</text><path d="M14 2h26m-10-9l10 9-10 9" class="vp-arr"/>`;
/** Выход из города: от города вниз (на нижней клетке) и направо — по ходу. */
const BLUE_ARROW = `<path d="M-12 -34V0H20m-10-10l10 10-10 10" class="vp-blue"/>`;

function boardSvg(): string {
  let o = `<defs>
    <clipPath id="vp-city"><path d="${loop(INNER[0])}"/></clipPath>
    <filter id="vp-sh" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="4"/></filter>
    <filter id="vp-paper" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="3" result="n"/>
      <feColorMatrix in="n" type="matrix" values="0 0 0 0 0.5  0 0 0 0 0.48  0 0 0 0 0.4  0 0 0 0.06 0"/><feComposite in2="SourceGraphic" operator="in" result="t"/>
      <feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="t"/></feMerge></filter>
  </defs>`;
  o += `<rect x="${CX - 750}" y="${CY - 607}" width="1500" height="1214" rx="4" class="vp-sheet" filter="url(#vp-paper)"/>`;
  // зелёные полосы между парками
  o += `<rect x="${CX - 398}" y="${CY - 592}" width="796" height="145" class="vp-green"/>`;
  o += `<rect x="${CX - 398}" y="${CY + 447}" width="796" height="145" class="vp-green"/>`;
  o += `<rect x="${CX - 728}" y="${CY - 268}" width="150" height="536" class="vp-green"/>`;
  o += `<rect x="${CX + 578}" y="${CY - 268}" width="150" height="536" class="vp-green"/>`;
  PARKS.forEach((p, i) => {
    const [x, y, w, hh] = parkRect(i);
    o += `<image href="${TEX}park-${p}.webp" x="${x}" y="${y}" width="${w}" height="${hh}" preserveAspectRatio="none"/>`;
  });
  // дорожки: белое поле, зелёная разделительная полоса, клетки
  o += `<path d="${loop(OUTER[1] + 14)}" class="vp-sheet"/>`;
  o += `<path d="${loop(OUTER[0])}${loop(INNER[1])}" class="vp-green" fill-rule="evenodd"/>`;
  let lines = '';
  for (let k = 0; k < CELLS; k++) {
    for (const ring of [INNER, OUTER]) {
      const [x0, y0] = pt(RAYS[k], ring[0]);
      const [x1, y1] = pt(RAYS[k], ring[1]);
      lines += `M${f1(x0)} ${f1(y0)}L${f1(x1)} ${f1(y1)}`;
    }
  }
  o += `<path d="${lines}" class="vp-line"/>`;
  o += `<image href="${TEX}city.webp" x="413" y="330" width="787" height="491" clip-path="url(#vp-city)" preserveAspectRatio="none"/>`;
  o += `<path d="${loop(INNER[0])}" class="vp-cityedge"/>`;
  for (const k of STOP) o += sign(k, OUTER, STOP_SIGN);
  for (const k of ARROWS) o += sign(k, INNER, BLUE_ARROW);
  return o;
}

function busSvg(seat: number, load: number, x: number, y: number, rot: number, cls = ''): string {
  const c = COL[seat];
  let heads = '';
  for (let i = 0; i < load; i++) heads += `<circle cx="${-30 + i * 30}" cy="0" r="10" fill="${c.head}" stroke="${c.dark}" stroke-width="2"/>`;
  return `<g class="vp-bus ${cls}" data-bus="${seat}" transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(rot)})">
    <rect x="-58" y="-22" width="124" height="52" rx="24" fill="#000" opacity="0.4" filter="url(#vp-sh)"/>
    <rect x="-62" y="-26" width="124" height="52" rx="24" fill="${c.fill}" stroke="${c.dark}" stroke-width="3"/>
    <rect x="-54" y="-18" width="108" height="36" rx="17" fill="${c.dark}" opacity="0.55"/>
    <rect x="-52" y="-16" width="104" height="32" rx="15" fill="${c.fill}" opacity="0.55"/>
    <path d="M-44 -24v48M-26 -24v48M-8 -24v48M10 -24v48M28 -24v48" stroke="${c.light}" stroke-width="2" opacity="0.5"/>
    ${heads}
  </g>`;
}

function pedSvg(seat: number, x: number, y: number, attrs = ''): string {
  const c = COL[seat];
  return `<g class="vp-ped" ${attrs} transform="translate(${f1(x)} ${f1(y)})">
    <ellipse cx="5" cy="7" rx="17" ry="15" fill="#000" opacity="0.4" filter="url(#vp-sh)"/>
    <circle r="16" fill="${c.fill}" stroke="${c.dark}" stroke-width="2.5"/>
    <ellipse cx="0" cy="2" rx="9" ry="7" fill="${c.dark}" opacity="0.45"/>
    <circle cx="-1" cy="-3" r="7.5" fill="${c.light}" stroke="${c.dark}" stroke-width="1.5"/>
  </g>`;
}

/** Ребята в городе: у угла своего парка. */
function cityXY(seat: number, i: number): [number, number] {
  const [sx, sy] = PARK_DIR[seat];
  return [CX + sx * (250 - i * 40), CY + sy * 150];
}

/** Место пешехода на клетке: несколько — рядом вдоль дорожки. */
function pedXY(k: number, idx: number, count: number): [number, number] {
  const [x, y] = center(k, INNER);
  const t = rad(along(k));
  const off = (idx - (count - 1) / 2) * 34;
  return [x + Math.cos(t) * off, y + Math.sin(t) * off];
}


class VputView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private svg!: SVGSVGElement;
  private gPieces!: SVGGElement;
  private gHi!: SVGGElement;
  private tray!: DiceTray;
  private btns!: HTMLElement;
  private info!: HTMLElement;
  private s: State | null = null;
  private seat: number | null = null;
  private sel: number | null = null;
  /** Пешеход, который сейчас едет по клеткам (не рисовать его на месте). */
  private moving: { seat: number; ped: number; cell: number } | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    const wrap = h(`<div class="vp-wrap"><svg class="vp-board" viewBox="${VB.x} ${VB.y} ${VB.w} ${VB.h}" xmlns="http://www.w3.org/2000/svg">
      <g class="vp-g">${boardSvg()}</g><g class="vp-hi"></g><g class="vp-p"></g></svg></div>`);
    root.appendChild(wrap);
    this.svg = wrap.querySelector('svg') as SVGSVGElement;
    this.gHi = this.svg.querySelector('.vp-hi') as SVGGElement;
    this.gPieces = this.svg.querySelector('.vp-p') as SVGGElement;
    const ctl = h(`<div class="vp-ctl"><div class="vp-tray"></div><div class="vp-btns"></div><div class="vp-info"></div>
      ${ctx.demo ? '' : `<div class="hint small-hint">${touchScreen() ? 'Бросок и автобусы — кнопкой или тапом по полю.' : ''} Ход — касание пешехода и подсвеченной клетки.</div>`}</div>`);
    ctx.controls.appendChild(ctl);
    this.tray = new DiceTray(ctl.querySelector('.vp-tray') as HTMLElement, 1);
    this.btns = ctl.querySelector('.vp-btns') as HTMLElement;
    this.info = ctl.querySelector('.vp-info') as HTMLElement;
    this.svg.addEventListener('click', (e) => this.click(e));
  }

  seatName(_v: State, seat: number) {
    return ['Жёлтые', 'Красные', 'Зелёные', 'Синие'][seat] ?? null;
  }

  private acts(): Action[] {
    return this.s && this.seat != null ? legal(this.s, this.seat) : [];
  }

  private send(a: Action) {
    const seat = this.seat;
    if (seat == null) return;
    this.seat = null;
    this.sel = null;
    Sound.unlock();
    this.ctx.act(seat, a);
    this.draw();
  }

  /** Источник хода пешехода: клетка пешехода или город. */
  private sources(): Map<string, Action[]> {
    const s = this.s!;
    const m = new Map<string, Action[]>();
    for (const a of this.acts()) {
      if (a.type !== 'walk') continue;
      const c = s.peds[this.seat!][a.ped];
      const key = c === CITY ? 'city' : `c${c}`;
      m.set(key, [...(m.get(key) || []), a]);
    }
    return m;
  }

  private click(e: MouseEvent) {
    const s = this.s;
    if (!s || this.seat == null) return;
    const el = (e.target as Element).closest('[data-cell],[data-city],[data-ped],[data-bus]') as SVGElement | null;
    if (!el) return;
    const acts = this.acts();
    // посадка: свой пешеход под автобусом или сам автобус
    const board = acts.find((a) => a.type === 'board');
    if (board && (el.dataset.bus === String(this.seat) || (el.dataset.ped && el.dataset.ped.startsWith(`${this.seat}:`)))) {
      e.preventDefault();
      this.send(board);
      return;
    }
    if (s.phase !== 'walk') return;
    const src = this.sources();
    let key: string | null = null;
    if (el.dataset.city === String(this.seat)) key = 'city';
    else if (el.dataset.ped && el.dataset.ped.startsWith(`${this.seat}:`)) key = `c${el.dataset.cell ?? ''}`;
    if (key && src.has(key)) {
      this.sel = this.sel === (key === 'city' ? -1 : Number(key.slice(1))) ? null : key === 'city' ? -1 : Number(key.slice(1));
      Sound.ui();
      this.draw();
      return;
    }
    if (el.dataset.cell != null && this.sel != null) {
      const to = Number(el.dataset.cell);
      const list = src.get(this.sel < 0 ? 'city' : `c${this.sel}`) || [];
      const a = list.find((x) => x.type === 'walk' && x.to === to);
      if (a) {
        e.preventDefault();
        this.send(a);
      }
    }
  }

  private draw() {
    const s = this.s;
    if (!s) return;
    // пешеходы
    let o = '';
    const onCell = new Map<number, { seat: number; ped: number }[]>();
    s.peds.forEach((ps, seat) =>
      ps.forEach((c, ped) => {
        if (this.moving && this.moving.seat === seat && this.moving.ped === ped) c = this.moving.cell;
        if (c >= 0) onCell.set(c, [...(onCell.get(c) || []), { seat, ped }]);
      })
    );
    s.peds.forEach((ps, seat) => {
      let i = 0;
      ps.forEach((c, ped) => {
        if (c === CITY && !(this.moving && this.moving.seat === seat && this.moving.ped === ped)) {
          const [x, y] = cityXY(seat, i++);
          o += pedSvg(seat, x, y, `data-city="${seat}"`);
        }
      });
    });
    for (const [k, list] of onCell) list.forEach((p, i) => {
      const [x, y] = pedXY(k, i, list.length);
      o += pedSvg(p.seat, x, y, `data-ped="${p.seat}:${p.ped}" data-cell="${k}"`);
    });
    // автобусы
    s.bus.forEach((b, seat) => {
      if (b >= 0) {
        const [x, y] = center(b, OUTER);
        o += busSvg(seat, s.load[seat], x, y, along(b));
      } else {
        const [px, py, w, hh] = parkRect(s.parkedIn[seat] >= 0 ? s.parkedIn[seat] : seat);
        o += busSvg(seat, s.load[seat], px + w / 2, py + hh / 2, 0, 'vp-parked');
      }
    });
    this.gPieces.innerHTML = o;
    // подсветка и кнопки
    let hi = '';
    for (const k of s.last) hi += `<path d="${cellPath(k, INNER)}" class="vp-last"/>`;
    const acts = this.acts();
    this.btns.innerHTML = '';
    if (this.seat != null && s.phase === 'walk') {
      const src = this.sources();
      if (src.size === 1 && this.sel == null) {
        const only = [...src.keys()][0];
        this.sel = only === 'city' ? -1 : Number(only.slice(1));
      }
      if (this.sel == null) {
        for (const key of src.keys()) {
          if (key === 'city') {
            const [x, y] = cityXY(this.seat, 0);
            hi += `<circle cx="${f1(x)}" cy="${f1(y)}" r="30" class="vp-can"/>`;
          } else hi += `<path d="${cellPath(Number(key.slice(1)), INNER)}" class="vp-can-cell"/>`;
        }
      } else {
        if (this.sel < 0) {
          const [x, y] = cityXY(this.seat, 0);
          hi += `<circle cx="${f1(x)}" cy="${f1(y)}" r="30" class="vp-sel"/>`;
        } else hi += `<path d="${cellPath(this.sel, INNER)}" class="vp-sel-cell"/>`;
        for (const a of src.get(this.sel < 0 ? 'city' : `c${this.sel}`) || [])
          if (a.type === 'walk') hi += `<path d="${cellPath(a.to, INNER)}" class="vp-target" data-cell="${a.to}"/>`;
      }
    }
    if (this.seat != null) {
      for (const p of boardable(s, this.seat)) {
        if (!acts.some((a) => a.type === 'board')) break;
        hi += `<path d="${cellPath(s.peds[this.seat][p], INNER)}" class="vp-boardable"/><path d="${cellPath(s.bus[this.seat], OUTER)}" class="vp-boardable"/>`;
        break;
      }
      const btn = (label: string, a: Action, main = false) => {
        const b = h<HTMLButtonElement>(`<button class="btn ${main ? 'primary' : ''}"${main ? ' data-tap' : ''}>${label}</button>`);
        b.onclick = () => this.send(a);
        this.btns.appendChild(b);
      };
      for (const a of acts) {
        if (a.type === 'roll') btn('Бросить кубик', a, true);
        else if (a.type === 'board') btn('Посадить в автобус', a, s.phase === 'board');
        else if (a.type === 'drive') btn('Двинуть автобусы', a, true);
        else if (a.type === 'pass') btn('Не сажать', a);
      }
    }
    this.gHi.innerHTML = hi;
    // цели — поверх фишек, чтобы ловить касание
    if (this.seat != null && s.phase === 'walk' && this.sel != null) {
      for (const a of this.sources().get(this.sel < 0 ? 'city' : `c${this.sel}`) || [])
        if (a.type === 'walk') this.gPieces.insertAdjacentHTML('beforeend', `<path d="${cellPath(a.to, INNER)}" class="vp-hit" data-cell="${a.to}"/>`);
    }
    this.text();
  }

  private text() {
    const s = this.s;
    if (!s) return;
    const rows = Array.from({ length: s.players }, (_, i) => {
      const city = s.peds[i].filter((c) => c === CITY).length;
      const road = s.peds[i].filter((c) => c >= 0).length;
      return `<div><span class="vp-dot" style="background:${COL[i].fill}"></span> в городе ${city} · на дорожке ${road} · в автобусе <b>${s.load[i]}</b></div>`;
    }).join('');
    this.info.innerHTML = rows;
  }

  setView(v: State) {
    this.s = v;
    this.sel = null;
    if (v.die) this.tray.show([v.die]);
    this.draw();
  }

  async play(events: Event[], v: State) {
    const sp = () => this.ctx.speed();
    let cur = this.s ?? v;
    for (const ev of events) {
      if (ev.type === 'roll') {
        await this.tray.roll([ev.die], sp());
      } else if (ev.type === 'walk') {
        // идёт по клеткам: из города — с клетки со стрелкой
        const path: number[] = [];
        if (ev.from === CITY) {
          const arrow = ARROWS.find((a) => fwd(a, v.die - 1) === ev.to) ?? ARROWS[0];
          for (let c = arrow; ; c = fwd(c)) {
            path.push(c);
            if (c === ev.to) break;
          }
        } else for (let c = fwd(ev.from); ; c = fwd(c)) {
          path.push(c);
          if (c === ev.to || path.length > CELLS) break;
        }
        for (const c of path) {
          this.moving = { seat: ev.seat, ped: ev.ped, cell: c };
          this.s = cur;
          this.draw();
          Sound.step();
          await sleep(150 / sp());
        }
        this.moving = null;
        cur = { ...cur, peds: cur.peds.map((ps, i) => (i === ev.seat ? ps.map((c, j) => (j === ev.ped ? ev.to : c)) : ps)), last: [ev.to] };
      } else if (ev.type === 'drive') {
        cur = { ...cur, bus: ev.to };
        this.s = cur;
        this.draw();
        if (ev.parked.length) Sound.win();
        else Sound.place();
        await sleep(380 / sp());
      } else if (ev.type === 'board') {
        cur = {
          ...cur,
          peds: cur.peds.map((ps, i) => (i === ev.seat ? ps.map((c, j) => (j === ev.ped ? RIDING : c)) : ps)),
          load: cur.load.map((l, i) => (i === ev.seat ? l + 1 : l)),
        };
        this.s = cur;
        this.draw();
        Sound.capture();
        await sleep(300 / sp());
      } else if (ev.type === 'end') {
        if (ev.winner != null) Sound.win();
      }
    }
    this.s = v;
    this.draw();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const s = this.s;
    this.seat = s && !s.over && !this.ctx.demo ? (interactive.find((x) => toAct.includes(x)) ?? null) : null;
    this.sel = null;
    this.draw();
  }

  status(v: State, toAct: number[], interactive: number[]) {
    if (v.over) return v.winner == null ? 'Ничья' : `${this.ctx.name(v.winner)} — в парке!`;
    const mine = interactive.find((x) => toAct.includes(x));
    if (v.phase === 'board') return mine != null ? 'Автобус над вашим пешеходом — посадить?' : 'Ждём посадку…';
    if (mine == null) return `Ходит ${this.ctx.name(v.turn)}…`;
    if (v.phase === 'roll') return 'Бросайте кубик';
    if (v.phase === 'walk') return `Выпало ${v.die}: выведите пешехода или передвиньте`;
    return boardable(v, mine).length ? 'Можно посадить пешехода, потом — двинуть автобусы' : 'Двиньте все автобусы на клетку';
  }
}

export function createView(): GameView<State, Event> {
  return new VputView();
}

