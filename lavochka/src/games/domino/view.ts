/* Домино — отрисовка: дворовый стол (крашеные доски), кости слоновой кости с латунным гвоздиком.
 * Ряд выкладывается «змейкой» от центра: дойдя до края, поворачивает; в осле от дубля — крестом в четыре стороны.
 * Своя рука — внизу; выбрал кость → подсветились места, куда её можно поставить → нажал на место.
 * Хот-сит: перед ходом — занавеска «передайте ход». */
import { Sound } from '../../core/audio';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import {
  bazaarLeft,
  ends,
  handCount,
  isDouble,
  placements,
  sameBone,
  sideOf,
  teams,
  type Bone,
  type Chain,
  type Event,
  type Placement,
  type Tile,
  type View,
} from './engine';
import './domino.css';

const NS = 'http://www.w3.org/2000/svg';
const W = 1000;
const H = 720;
/** Единица ряда: кость — 2×1 единицы. */
const U = 40;
const CX = W / 2;
const CY = 330;
/** Границы ряда в единицах от центра. */
const XB = 10;
const YB = 5.2;

type V2 = [number, number];

/** Положение кости ряда: центр (в единицах), направление, поперёк ли (дубль). */
interface Slot {
  c: V2;
  dir: V2;
  cross: boolean;
  tile: Tile;
}

const ARMS: { run: V2; turn: V2 }[] = [
  { run: [-1, 0], turn: [0, -1] },
  { run: [1, 0], turn: [0, 1] },
  { run: [0, -1], turn: [1, 0] },
  { run: [0, 1], turn: [-1, 0] },
];

/** Раскладка ряда «змейкой». extra — ещё одна кость (призрак для подсказки) на руку arm. */
function layout(chain: Chain, extra?: { arm: number; tile: Tile }): { center: Slot | null; arms: Slot[][] } {
  if (!chain.center) {
    if (extra && extra.arm < 0) {
      const d = extra.tile.a === extra.tile.b;
      return { center: { c: [0, 0], dir: [1, 0], cross: d, tile: extra.tile }, arms: [[], [], [], []] };
    }
    return { center: null, arms: [[], [], [], []] };
  }
  const ct = chain.center;
  const cd = ct.a === ct.b;
  const center: Slot = { c: [0, 0], dir: [1, 0], cross: cd, tile: ct };
  // полуразмеры центральной кости: по горизонтали и вертикали
  const hx = cd ? 0.5 : 1;
  const hy = cd ? 1 : 0.5;
  const arms: Slot[][] = [];
  for (let i = 0; i < 4; i++) {
    const tiles = chain.arms[i].tiles.slice();
    if (extra && extra.arm === i) tiles.push(extra.tile);
    const cfgA = ARMS[i];
    let dir: V2 = cfgA.run;
    let pos: V2 = [dir[0] * hx, dir[1] * hy];
    let hw = i < 2 ? hy : hx; // полуширина предыдущей кости поперёк хода
    let mode: 'run' | 'short' = 'run';
    let runDir: V2 = cfgA.run;
    const out: Slot[] = [];
    for (const t of tiles) {
      const dbl = t.a === t.b;
      const L = dbl ? 1 : 2;
      const horiz = dir[0] !== 0;
      const bound = horiz ? XB : YB;
      const coord = horiz ? pos[0] : pos[1];
      const sign = horiz ? dir[0] : dir[1];
      if (mode === 'run' && Math.abs(coord + sign * (L + 0.2)) > bound) {
        // поворот на короткое колено
        const nd = cfgA.turn;
        pos = [pos[0] - dir[0] * 0.5 + nd[0] * hw, pos[1] - dir[1] * 0.5 + nd[1] * hw];
        dir = nd;
        mode = 'short';
      }
      const len = dbl ? 1 : 2;
      const c: V2 = [pos[0] + (dir[0] * len) / 2, pos[1] + (dir[1] * len) / 2];
      out.push({ c, dir, cross: dbl, tile: t });
      pos = [pos[0] + dir[0] * len, pos[1] + dir[1] * len];
      hw = dbl ? 1 : 0.5;
      // после короткого колена — сразу обратно
      if (mode === 'short') {
        const nd: V2 = [-runDir[0], -runDir[1]];
        pos = [pos[0] - dir[0] * 0.5 + nd[0] * hw, pos[1] - dir[1] * 0.5 + nd[1] * hw];
        runDir = nd;
        dir = nd;
        mode = 'run';
        hw = 0.5;
      }
    }
    arms.push(out);
  }
  return { center, arms };
}

// ---------------------------------------------------------------- рисунок кости

const PIPS: Record<number, V2[]> = {
  0: [],
  1: [[0, 0]],
  2: [[-1, -1], [1, 1]],
  3: [[-1, -1], [0, 0], [1, 1]],
  4: [[-1, -1], [1, -1], [-1, 1], [1, 1]],
  5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]],
  6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]],
};

/** Кость: центр (x, y) в пикселях, s — единица, angle — поворот (0 — горизонтально, a слева). */
function boneSvg(a: number, b: number, x: number, y: number, s: number, angle: number, cls = '', attrs = ''): string {
  const w = s * 2 - 2;
  const hh = s - 2;
  const half = (n: number, cx: number) =>
    PIPS[n].map(([px, py]) => `<circle cx="${cx + px * s * 0.26}" cy="${py * s * 0.26}" r="${s * 0.1}" class="dm-pip"/>`).join('');
  return `<g class="dm-bone ${cls}" transform="translate(${x},${y}) rotate(${angle})" ${attrs}>
    <rect x="${-w / 2}" y="${-hh / 2}" width="${w}" height="${hh}" rx="${s * 0.16}" class="dm-face"/>
    <rect x="${-w / 2 + 1.5}" y="${-hh / 2 + 1.5}" width="${w - 3}" height="${hh - 3}" rx="${s * 0.13}" class="dm-shine"/>
    <line x1="0" y1="${-hh / 2 + s * 0.12}" x2="0" y2="${hh / 2 - s * 0.12}" class="dm-mid"/>
    <circle r="${s * 0.09}" class="dm-pin"/>
    ${half(a, -s / 2)}${half(b, s / 2)}
  </g>`;
}

function backSvg(x: number, y: number, s: number, angle: number): string {
  const w = s * 2 - 2;
  const hh = s - 2;
  return `<g class="dm-back" transform="translate(${x},${y}) rotate(${angle})"><rect x="${-w / 2}" y="${-hh / 2}" width="${w}" height="${hh}" rx="${s * 0.16}"/><circle r="${s * 0.09}" class="dm-pin"/></g>`;
}

const angleOf = (dir: V2) => (dir[0] === 1 ? 0 : dir[0] === -1 ? 180 : dir[1] === 1 ? 90 : -90);

class DominoView implements GameView<View, Event> {
  private ctx!: ViewCtx;
  private svg!: SVGSVGElement;
  private gTable!: SVGGElement;
  private gHands!: SVGGElement;
  private gGhost!: SVGGElement;
  private gBanner!: SVGGElement;
  private btns!: HTMLElement;
  private cover!: HTMLElement;
  private v: View | null = null;
  private viewer = 0;
  private hidden = false;
  private actSeat: number | null = null;
  private selected: Bone | null = null;
  private opts: Placement[] = [];
  private pendingClose: Placement | null = null;
  private fresh: Tile | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    const wrap = h(`<div class="dm-wrap">
        <svg class="dm-board" xmlns="${NS}" viewBox="0 0 ${W} ${H}">
          <defs>
            <linearGradient id="dmIvory" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fbf4e2"/><stop offset="1" stop-color="#e2d4b4"/></linearGradient>
            <radialGradient id="dmBrass"><stop offset="0" stop-color="#ffe9a8"/><stop offset=".6" stop-color="#c9963a"/><stop offset="1" stop-color="#7a5414"/></radialGradient>
            <filter id="dmShadow" x="-20%" y="-30%" width="140%" height="160%"><feDropShadow dx="1.5" dy="2.5" stdDeviation="1.6" flood-color="#0a1408" flood-opacity=".55"/></filter>
          </defs>
          <g class="dm-planks"></g>
          <g class="dm-table"></g><g class="dm-ghost"></g><g class="dm-hands"></g><g class="dm-banner"></g>
        </svg>
        <div class="dm-cover" hidden><div class="dm-cover-box"><div class="dm-cover-t"></div><button class="btn primary">Показать кости</button></div></div>
      </div>`);
    root.appendChild(wrap);
    this.svg = wrap.querySelector('svg') as SVGSVGElement;
    this.gTable = this.svg.querySelector('.dm-table') as SVGGElement;
    this.gGhost = this.svg.querySelector('.dm-ghost') as SVGGElement;
    this.gHands = this.svg.querySelector('.dm-hands') as SVGGElement;
    this.gBanner = this.svg.querySelector('.dm-banner') as SVGGElement;
    this.drawPlanks(this.svg.querySelector('.dm-planks') as SVGGElement);
    this.cover = wrap.querySelector('.dm-cover') as HTMLElement;
    (this.cover.querySelector('button') as HTMLButtonElement).onclick = () => {
      Sound.unlock();
      this.hidden = false;
      this.cover.hidden = true;
      this.draw();
    };
    const ctl = h(`<div class="dm-controls"><div class="dm-btns"></div>${ctx.demo ? '' : '<div class="hint small-hint">Нажмите на свою кость, потом — на подсвеченное место в ряду.</div>'}</div>`);
    ctx.controls.appendChild(ctl);
    this.btns = ctl.querySelector('.dm-btns') as HTMLElement;
    this.svg.addEventListener('click', (e) => this.onClick(e));
  }

  /** Стол во дворе: крашеные доски, облупившаяся краска, пара гвоздей. */
  private drawPlanks(g: SVGGElement) {
    let s = `<rect width="${W}" height="${H}" rx="18" fill="#2f5a34"/>`;
    const n = 7;
    for (let i = 0; i < n; i++) {
      const y = (H / n) * i;
      const tone = ['#3a6a3e', '#356339', '#3d6f41', '#33603a'][i % 4];
      s += `<rect x="0" y="${y + 2}" width="${W}" height="${H / n - 4}" fill="${tone}"/>`;
      s += `<rect x="0" y="${y + H / n - 3}" width="${W}" height="3" fill="#1a2e1a" opacity=".55"/>`;
      // облупилась краска — проглядывает дерево
      for (let k = 0; k < 3; k++) {
        const px = ((i * 337 + k * 211) % (W - 120)) + 40;
        const py = y + 10 + ((i * 53 + k * 29) % Math.max(10, H / n - 30));
        s += `<ellipse cx="${px}" cy="${py}" rx="${18 + ((i + k) % 3) * 9}" ry="${4 + (k % 2) * 2}" fill="#8a6a42" opacity=".35"/>`;
      }
      for (const nx of [26, W - 26]) s += `<circle cx="${nx}" cy="${y + H / n / 2}" r="3" fill="#2a2a24"/><circle cx="${nx - 0.8}" cy="${y + H / n / 2 - 0.8}" r="1.2" fill="#8a8a7a"/>`;
    }
    s += `<rect width="${W}" height="${H}" rx="18" fill="none" stroke="#1a2e1a" stroke-width="6"/>`;
    g.innerHTML = s;
  }

  // ---------------------------------------------------------------- места за столом

  /** Место на экране: 0 — снизу (своя рука), 1 — слева, 2 — сверху, 3 — справа. */
  private spot(seat: number) {
    return (seat - this.viewer + 4) % 4;
  }

  private faceUp(seat: number) {
    if (this.ctx.demo) return true;
    return seat === this.viewer && !this.hidden && this.ctx.mySeats.includes(seat);
  }

  private chooseViewer(v: View, toAct: number[]) {
    const mine = this.ctx.mySeats.filter((x) => v.seats.includes(x));
    if (!mine.length) {
      this.viewer = v.seats.includes(this.viewer) ? this.viewer : v.seats[0];
      return;
    }
    if (mine.length === 1) {
      this.viewer = mine[0];
      return;
    }
    const next = toAct.find((x) => mine.includes(x));
    if (next != null && next !== this.viewer) {
      this.viewer = next;
      this.hidden = true;
    } else if (!mine.includes(this.viewer)) this.viewer = mine[0];
  }

  // ---------------------------------------------------------------- отрисовка

  private px(c: V2): V2 {
    return [CX + c[0] * U, CY + c[1] * U];
  }

  private slotSvg(sl: Slot, cls = '', attrs = '') {
    const [x, y] = this.px(sl.c);
    // кость рисуется горизонтально «a слева»; дубль — поперёк хода
    let ang = angleOf(sl.dir);
    if (sl.cross) ang += 90;
    return boneSvg(sl.tile.a, sl.tile.b, x, y, U, ang, cls, attrs);
  }

  private draw() {
    const v = this.v;
    if (!v) return;
    const lay = layout(v.chain);
    let t = '';
    const all: Slot[] = [];
    if (lay.center) all.push(lay.center);
    for (const arm of lay.arms) all.push(...arm);
    for (const sl of all) t += this.slotSvg(sl, sl.tile === this.fresh ? 'dm-fresh' : '', 'filter="url(#dmShadow)"');
    // закрытые стороны осла — красный крестик на конце
    v.chain.arms.forEach((arm, i) => {
      if (!arm.closed || !lay.arms[i].length) return;
      const last = lay.arms[i][lay.arms[i].length - 1];
      const [x, y] = this.px([last.c[0] + last.dir[0] * 1.1, last.c[1] + last.dir[1] * 1.1]);
      t += `<g class="dm-closed" transform="translate(${x},${y})"><circle r="11"/><path d="M-5 -5L5 5M5 -5L-5 5"/></g>`;
    });
    // базар
    const bz = bazaarLeft(v);
    if (bz) {
      for (let i = 0; i < Math.min(bz, 8); i++) t += backSvg(70 + (i % 4) * 4, 70 + Math.floor(i / 4) * 30 - i * 1.5, 22, 90);
      t += `<text class="dm-label" x="72" y="128">базар: ${bz}</text>`;
    }
    this.gTable.innerHTML = t;
    this.drawHands();
    this.drawGhosts();
  }

  private drawHands() {
    const v = this.v!;
    let s = '';
    for (const seat of v.seats) {
      const sp = this.spot(seat);
      const n = handCount(v, seat);
      const up = this.faceUp(seat);
      const hand = up ? v.hands[seat] : [];
      if (sp === 0 && up) {
        // рука из базара бывает длинной — ужимаем
        const gap = Math.min(54, 900 / Math.max(1, hand.length));
        const size = gap / 1.12;
        const x0 = CX - ((hand.length - 1) * gap) / 2;
        const playable = new Set(this.actSeat === seat ? placements(v, hand, v.phase === 'more').map((p) => `${p.bone[0]}-${p.bone[1]}`) : []);
        hand.forEach((b, i) => {
          const key = `${b[0]}-${b[1]}`;
          const sel = this.selected && sameBone(this.selected, b);
          const cls = `${playable.has(key) ? 'dm-can' : ''} ${sel ? 'dm-sel' : ''}`;
          s += boneSvg(b[0], b[1], x0 + i * gap, H - 58 - (sel ? 14 : 0), size, 90, `dm-hand ${cls}`, `data-bone="${key}" filter="url(#dmShadow)"`);
        });
      } else {
        // чужие руки — рубашками (в показе правил — лицом)
        const size = 20;
        const list = up && this.ctx.demo ? v.hands[seat] : Array.from({ length: n }, () => null);
        list.forEach((b, i) => {
          const off = (i - (list.length - 1) / 2) * size * 1.1;
          let x: number;
          let y: number;
          let ang: number;
          if (sp === 0) [x, y, ang] = [CX + off * 1.4, H - 50, 90];
          else if (sp === 2) [x, y, ang] = [CX + off, 46, 90];
          else if (sp === 1) [x, y, ang] = [44, CY + off, 0];
          else [x, y, ang] = [W - 44, CY + off, 0];
          s += b ? boneSvg(b[0], b[1], x, y, size, ang, 'dm-small') : backSvg(x, y, size, ang);
        });
      }
      // метка пары
      if (teams(v)) {
        const [lx, ly] = sp === 0 ? [CX + 300, H - 22] : sp === 2 ? [CX + 160, 30] : sp === 1 ? [70, CY - 120] : [W - 70, CY - 120];
        s += `<text class="dm-team" x="${lx}" y="${ly}">пара ${sideOf(v, seat) === 0 ? 'А' : 'Б'}</text>`;
      }
      if (this.actSeat === seat || (v.turn === seat && v.phase !== 'over')) {
        const [lx, ly] = sp === 0 ? [CX - 300, H - 22] : sp === 2 ? [CX - 160, 30] : sp === 1 ? [70, CY + 130] : [W - 70, CY + 130];
        s += `<text class="dm-turn" x="${lx}" y="${ly}">◆ ходит</text>`;
      }
    }
    this.gHands.innerHTML = s;
  }

  /** Подсказка: куда встанет выбранная кость. */
  private drawGhosts() {
    const v = this.v!;
    let g = '';
    if (this.selected && this.actSeat != null) {
      for (const p of this.opts.filter((x) => sameBone(x.bone, this.selected!))) {
        const e = ends(v.chain, v.cfg).find((x) => x.arm === p.arm);
        const tile: Tile = p.arm < 0 ? { a: p.bone[0], b: p.bone[1], seat: this.actSeat } : { a: e!.v, b: p.bone[0] === e!.v ? p.bone[1] : p.bone[0], seat: this.actSeat };
        const lay = layout(v.chain, { arm: p.arm, tile });
        const sl = p.arm < 0 ? lay.center! : lay.arms[p.arm][lay.arms[p.arm].length - 1];
        g += this.slotSvg(sl, 'dm-ghost-bone', `data-arm="${p.arm}"`);
      }
    }
    this.gGhost.innerHTML = g;
  }

  // ---------------------------------------------------------------- ход

  private onClick(e: MouseEvent) {
    const v = this.v;
    const seat = this.actSeat;
    if (!v || seat == null || this.hidden) return;
    const ghost = (e.target as Element).closest('[data-arm]') as SVGElement | null;
    if (ghost && this.selected) {
      const p = this.opts.find((x) => sameBone(x.bone, this.selected!) && x.arm === +ghost.dataset.arm!);
      if (p) this.tryPlay(p);
      return;
    }
    const bone = (e.target as Element).closest('[data-bone]') as SVGElement | null;
    if (bone) {
      const [a, b] = bone.dataset.bone!.split('-').map(Number) as Bone;
      const mine = this.opts.filter((x) => sameBone(x.bone, [a, b]));
      if (!mine.length) {
        Sound.nomove();
        return;
      }
      // одно место — ставим сразу (если двойного смысла нет)
      const spots = new Set(mine.map((x) => x.arm));
      if (spots.size === 1 && this.ctx.autoSingle()) return this.tryPlay(mine[0]);
      this.selected = [a, b];
      Sound.ui();
      this.draw();
      return;
    }
    this.selected = null;
    this.draw();
  }

  private tryPlay(p: Placement) {
    const v = this.v!;
    if (v.cfg.variant === 'osel' && isDouble(p.bone) && p.arm >= 0) {
      this.pendingClose = p;
      this.renderButtons();
      return;
    }
    this.send({ type: 'play', bone: p.bone, arm: p.arm });
  }

  private send(a: Parameters<ViewCtx['act']>[1]) {
    const seat = this.actSeat;
    if (seat == null) return;
    Sound.unlock();
    this.clearTurn();
    this.ctx.act(seat, a);
  }

  private clearTurn() {
    this.actSeat = null;
    this.selected = null;
    this.opts = [];
    this.pendingClose = null;
    this.btns.innerHTML = '';
    if (this.v) this.draw();
  }

  private button(text: string, primary: boolean, on: () => void) {
    const b = h<HTMLButtonElement>(`<button class="btn ${primary ? 'primary' : ''}">${text}</button>`);
    b.onclick = () => {
      Sound.unlock();
      on();
    };
    this.btns.appendChild(b);
  }

  private renderButtons() {
    this.btns.innerHTML = '';
    const v = this.v;
    const seat = this.actSeat;
    if (!v || seat == null || this.ctx.demo || this.hidden) return;
    if (this.pendingClose) {
      const p = this.pendingClose;
      this.btns.appendChild(h(`<div class="dm-ask">Дубль ${p.bone[0]}-${p.bone[1]}: закрыть эту сторону?</div>`));
      this.button('Поставить', true, () => this.send({ type: 'play', bone: p.bone, arm: p.arm }));
      this.button('Поставить и «Закрыто!»', false, () => this.send({ type: 'play', bone: p.bone, arm: p.arm, close: true }));
      this.button('Отмена', false, () => {
        this.pendingClose = null;
        this.renderButtons();
      });
      return;
    }
    if (v.phase === 'more') {
      this.btns.appendChild(h('<div class="dm-ask">Можно доложить дубли</div>'));
      this.button('Хватит', true, () => this.send({ type: 'enough' }));
      return;
    }
    if (!this.opts.length) {
      if (bazaarLeft(v)) this.button(`Взять из базара (${bazaarLeft(v)})`, true, () => this.send({ type: 'draw' }));
      else this.button('Пропустить — «еду!»', true, () => this.send({ type: 'pass' }));
    }
  }

  setView(v: View) {
    this.v = v;
    this.fresh = null;
    this.gBanner.innerHTML = '';
    this.draw();
  }

  async play(events: Event[], v: View) {
    const speed = this.ctx.speed();
    this.clearTurn();
    for (const ev of events) {
      if (ev.type === 'play') {
        this.v = { ...this.v!, chain: chainAfter(this.v!.chain, ev), hands: this.v!.hands.map((hh, i) => (i === ev.seat ? hh.filter((b) => !sameBone(b, ev.bone)) : hh)), counts: this.v!.counts.map((c, i) => (i === ev.seat ? c - 1 : c)) };
        this.fresh = ev.tile;
        this.draw();
        Sound.place();
        await sleep(420 / speed);
      } else if (ev.type === 'draw') {
        Sound.card();
        await sleep(200 / speed);
      } else if (ev.type === 'pass') {
        Sound.nomove();
        await this.banner('Еду!', 600 / speed);
      } else if (ev.type === 'round') {
        Sound.place();
        const r = ev.res;
        const txt = r.fish ? (r.winner == null ? 'Рыба! Яйца' : 'Рыба!') : 'Кон окончен';
        await this.banner(txt, 1500 / speed);
      } else if (ev.type === 'deal') {
        Sound.shuffle();
      } else if (ev.type === 'end') {
        Sound.win();
        this.v = v;
        this.draw();
        await this.banner('Козёл!', 0);
      }
    }
    this.v = v;
    this.fresh = null;
    this.draw();
  }

  private async banner(text: string, ms: number) {
    this.gBanner.innerHTML = `<g class="dm-bannerbox"><rect x="${CX - 200}" y="${CY - 40}" width="400" height="80" rx="14"/><text x="${CX}" y="${CY + 2}">${text}</text></g>`;
    if (!ms) return;
    await sleep(ms);
    this.gBanner.innerHTML = '';
  }

  setTurn(toAct: number[], interactive: number[]) {
    this.clearTurn();
    const v = this.v;
    if (!v || v.phase === 'over' || this.ctx.demo) {
      if (v) this.draw();
      return;
    }
    this.chooseViewer(v, toAct);
    const seat = interactive.find((x) => x === this.viewer) ?? null;
    if (this.hidden && interactive.length && this.ctx.mySeats.length > 1) {
      (this.cover.querySelector('.dm-cover-t') as HTMLElement).innerHTML = `Ход: ${this.ctx.name(this.viewer)}.<br><small>Передайте ход — остальным не подглядывать!</small>`;
      this.cover.hidden = false;
    } else {
      this.hidden = false;
      this.cover.hidden = true;
    }
    this.actSeat = seat;
    if (seat != null) this.opts = placements(v, v.hands[seat], v.phase === 'more');
    this.draw();
    this.renderButtons();
    // покрывало сняли — кнопки появятся после
    (this.cover.querySelector('button') as HTMLButtonElement).onclick = () => {
      Sound.unlock();
      this.hidden = false;
      this.cover.hidden = true;
      this.draw();
      this.renderButtons();
    };
  }

  status(v: View, toAct: number[], interactive: number[]) {
    const name = (p: number) => this.ctx.name(p);
    if (v.phase === 'over') return v.goat != null ? `Козёл — ${v.seats.filter((x) => sideOf(v, x) === v.goat).map(name).join(' и ')}` : 'Партия окончена';
    const who = toAct[0];
    if (who == null) return '';
    const mine = interactive.includes(who);
    if (v.phase === 'more') return mine ? 'Можно доложить дубли — или «хватит»' : `${name(who)} докладывает дубли…`;
    if (!mine) return `Ходит ${name(who)}…`;
    const can = placements(v, v.hands[who], false).length > 0;
    if (!v.chain.center) return v.opener ? `Ваш ход: начинайте с ${v.opener[0]}-${v.opener[1]}` : 'Ваш ход: начинайте любой костью';
    return can ? 'Ваш ход' : bazaarLeft(v) ? 'Нечем ходить — берите из базара' : 'Нечем ходить — пропускайте';
  }

  playerStats(v: View, seat: number) {
    const side = sideOf(v, seat);
    return `<span title="Костей на руке">${handCount(v, seat)} к.</span> · <span title="Записано очков">${v.scores[side]} оч.${v.hang[side] ? ` <small>(+${v.hang[side]})</small>` : ''}</span>`;
  }
}

/** Ряд после события хода (для пошагового показа без ожидания нового состояния). */
function chainAfter(c: Chain, ev: Extract<Event, { type: 'play' }>): Chain {
  const chain: Chain = { center: c.center, arms: c.arms.map((a) => ({ tiles: a.tiles.slice(), closed: a.closed })) };
  if (ev.center) chain.center = ev.tile;
  else {
    chain.arms[ev.arm].tiles.push(ev.tile);
    if (ev.close) chain.arms[ev.arm].closed = true;
  }
  return chain;
}

export function createView(): GameView<View, Event> {
  return new DominoView();
}
