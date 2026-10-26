/* «Морская игра» — отрисовка. Поле нарисовано кодом точно по фото 1001.jpg (разрешение пользователя): зелёная левая и красная
 * правая половины, белая и чёрная окантовка, синее крестообразное море с сеткой, белые кружки на скрещениях, компасы в углах.
 * Корабли — пластиковые корпуса с фото комплекта (public/morskaya/), лежат носом по курсу; цифра на корме — класс, как в
 * описании (1 — броненосец … 6 — подлодка). Береговые пушки — «взрывы», мины — чёрные шары с рожками.
 * Ход: касание корабля, затем кружок впереди (ход) или метка сбоку (поворот). Мины — кнопкой. */
import { Sound } from '../../core/audio';
import { PointBoard } from '../../core/pointboard';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { ahead, col, COLS, GUNS, LAND, legal, N, NUM, QUIET, row, ROWS, START_CELLS, type Action, type Event, type Kind, type State } from './engine';
import './morskaya.css';

const BASE = `${import.meta.env.BASE_URL}morskaya/`;
const S = 80;
const MX = 150;
const MY = 90;
const W = MX * 2 + (COLS - 1) * S;
const H = MY * 2 + (ROWS - 1) * S;
const GREEN = '#1c9b82';
const RED = '#e2432d';
/** Корпус по классу: ряд (a/b) и размер 1…4 на фото. */
const HULL: Record<Kind, [string, number]> = { bb: ['a4', 1], cr: ['a3', 0.9], gb: ['b3', 0.84], dd: ['a2', 0.76], ms: ['a1', 0.62], ss: ['b1', 0.66] };
const DV = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

const nx = (p: number) => MX + col(p) * S;
const ny = (p: number) => MY + row(p) * S;

class MorskayaView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private pb!: PointBoard<State, Action>;
  private info!: HTMLElement;
  private hint!: HTMLElement;
  private s: State | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.info = h(`<div class="ms-info"></div>`);
    ctx.controls.appendChild(this.info);
    this.hint = h(`<div class="ms-hint"></div>`);
    if (!ctx.demo) ctx.controls.appendChild(this.hint);
    this.pb = new PointBoard<State, Action>(
      root,
      ctx,
      {
        count: () => N * 5,
        size: () => [W, H],
        xy: (_s, q) => this.xy(q),
        board: () => this.board(),
        pieces: (s) => s.ships.map((x) => ({ p: x.p, kind: `${x.side}${x.kind}${x.dir}` })),
        piece: (_s, kind, x, y) => this.ship(kind, x, y),
        legal: (s, seat) => legal(s, seat),
        spot: (a) => this.spot(a),
        label: (a) => (a.type === 'mine' ? (this.s?.mines.includes(this.s.ships.find((x) => x.id === a.id)?.p ?? -1) ? '⚓ Тральщик снимает мину' : '💣 Тральщик ставит мину') : '…'),
        zoom: true,
        hit: 30,
        ring: 30,
      },
      'ms'
    );
    this.pb.extra = (s) => this.marks(s);
  }

  /** q < N — узел; N + p·4 + d — метка поворота у узла p в сторону d. */
  private xy(q: number): [number, number] {
    if (q < N) return [nx(q), ny(q)];
    const p = Math.floor((q - N) / 4);
    const d = (q - N) % 4;
    return [nx(p) + DV[d][0] * S * 0.4, ny(p) + DV[d][1] * S * 0.4];
  }

  private spot(a: Action) {
    const s = this.s;
    if (!s || a.type === 'mine') return null;
    const sh = s.ships.find((x) => x.id === a.id);
    if (!sh) return null;
    if (a.type === 'fwd') return { from: sh.p, to: ahead(sh.p, sh.dir) };
    const d = (sh.dir + (a.d === 'r' ? 1 : 3)) % 4;
    return { from: sh.p, to: N + sh.p * 4 + d };
  }

  private board(): string {
    const x0 = nx(0) - S / 2;
    const x1 = nx(COLS - 1) + S / 2;
    const y0 = ny(0) - S / 2;
    const y1 = ny((ROWS - 1) * COLS) + S / 2;
    // крестообразное море: без угловых клеток
    const sea = `M${x0 + S},${y0} H${x1 - S} V${y0 + S} H${x1} V${y1 - S} H${x1 - S} V${y1} H${x0 + S} V${y1 - S} H${x0} V${y0 + S} H${x0 + S} Z`;
    let o = `<defs>
      <filter id="ms-sh" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="2" dy="3" stdDeviation="2.5" flood-opacity="0.5"/></filter>
      <pattern id="ms-paper" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="#000" opacity="0"/><circle cx="1" cy="1" r="0.6" fill="#fff" opacity="0.06"/></pattern>
    </defs>
    <rect x="0" y="0" width="${W / 2}" height="${H}" fill="${GREEN}"/><rect x="${W / 2}" y="0" width="${W / 2}" height="${H}" fill="${RED}"/>
    <rect x="0" y="0" width="${W}" height="${H}" fill="url(#ms-paper)"/>
    <path d="${sea}" fill="none" stroke="#f4f1e6" stroke-width="44" stroke-linejoin="miter"/>
    <path d="${sea}" fill="none" stroke="#1b2024" stroke-width="26" stroke-linejoin="miter"/>
    <path d="${sea}" fill="#2d93cf"/>`;
    // сетка
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        const p = r * COLS + c;
        if (LAND.has(p)) continue;
        for (const [dc, dr] of [
          [1, 0],
          [0, 1],
        ]) {
          const q = (r + dr) * COLS + (c + dc);
          if (c + dc >= COLS || r + dr >= ROWS || LAND.has(q)) continue;
          o += `<line x1="${nx(p)}" y1="${ny(p)}" x2="${nx(q)}" y2="${ny(q)}" stroke="#1d5f8f" stroke-width="2"/>`;
        }
      }
    o += `<line x1="${W / 2}" y1="${y0}" x2="${W / 2}" y2="${y1}" stroke="#e8f4fb" stroke-opacity="0.35" stroke-width="2"/>`;
    for (let p = 0; p < N; p++) if (!LAND.has(p)) o += `<circle cx="${nx(p)}" cy="${ny(p)}" r="14" fill="#f6f6f2"/>`;
    // цифры расстановки (как в описании)
    for (const side of [0, 1])
      for (const [p, k] of START_CELLS[side]) o += `<text x="${nx(p) + 12}" y="${ny(p) + 26}" class="ms-num">${NUM[k]}</text>`;
    // береговые пушки — «взрывы»
    for (const side of [0, 1]) for (const p of GUNS[side]) o += this.burst(nx(p), ny(p), side);
    o += this.compass(70, 70) + this.compass(W - 70, H - 70);
    // корабли-картинки на полях, как на поле из коробки
    o += `<image href="${BASE}g-a4.webp" x="-80" y="-14" width="160" height="34" transform="translate(52 ${H / 2 - 40}) rotate(90)" opacity="0.75"/>
      <image href="${BASE}g-b4.webp" x="-80" y="-14" width="160" height="34" transform="translate(52 ${H / 2 + 200}) rotate(90)" opacity="0.75"/>
      <image href="${BASE}r-a4.webp" x="-80" y="-14" width="160" height="34" transform="translate(${W - 52} ${H / 2 + 40}) rotate(-90)" opacity="0.75"/>
      <image href="${BASE}r-b4.webp" x="-80" y="-14" width="160" height="34" transform="translate(${W - 52} ${H / 2 - 200}) rotate(-90)" opacity="0.75"/>`;
    return o;
  }

  private burst(x: number, y: number, side: number): string {
    let d = '';
    for (let i = 0; i < 16; i++) {
      const a = (i * Math.PI) / 8;
      const r = i % 2 ? 9 : 19;
      d += `${i ? 'L' : 'M'}${(x + Math.cos(a) * r).toFixed(1)},${(y + Math.sin(a) * r).toFixed(1)} `;
    }
    return `<path d="${d}Z" fill="${side === 0 ? '#ffd23a' : '#ff8a3a'}" stroke="#a01810" stroke-width="2" opacity="0.92"/>`;
  }

  private compass(x: number, y: number): string {
    return `<g transform="translate(${x} ${y})"><circle r="44" fill="#f8f4e2" stroke="#d9b03a" stroke-width="4"/><circle r="36" fill="none" stroke="#2d93cf" stroke-width="2"/>
      <path d="M0,-34 L6,-6 L34,0 L6,6 L0,34 L-6,6 L-34,0 L-6,-6 Z" fill="#d8322a"/><path d="M0,-34 L6,-6 L0,0 Z M34,0 L6,6 L0,0 Z M0,34 L-6,6 L0,0 Z M-34,0 L-6,-6 L0,0 Z" fill="#2a8a2a"/>
      <text y="-37" class="ms-cmp">С</text><text y="47" class="ms-cmp">Ю</text></g>`;
  }

  private ship(kind: string, x: number, y: number): string {
    const side = Number(kind[0]);
    const k = kind.slice(1, 3) as Kind;
    const dir = Number(kind[3]);
    const [img, sc] = HULL[k];
    const len = S * 1.18 * sc;
    const hh = len * 0.25;
    const rot = 90 + dir * 90;
    const back = [x - DV[dir][0] * len * 0.3, y - DV[dir][1] * len * 0.3];
    return `<g><image href="${BASE}${side === 0 ? 'g' : 'r'}-${img}.webp" x="${-len / 2}" y="${-hh / 2}" width="${len}" height="${hh}" transform="translate(${x} ${y}) rotate(${rot})" filter="url(#ms-sh)"/>
      <circle cx="${back[0]}" cy="${back[1]}" r="9" fill="#fffbe8" stroke="${side === 0 ? '#0e5a48' : '#7a1408'}" stroke-width="2"/><text x="${back[0]}" y="${back[1] + 4}" class="ms-badge">${NUM[k]}</text></g>`;
  }

  /** Мины и метки поворота у выбранного корабля. */
  private marks(s: State): string {
    let o = '';
    for (const p of s.mines) {
      const x = nx(p) - 20;
      const y = ny(p) - 20;
      o += `<g class="ms-mine" transform="translate(${x} ${y})"><circle r="9" fill="#151515"/>${[0, 1, 2, 3, 4, 5].map((i) => `<line x1="0" y1="0" x2="${(Math.cos((i * Math.PI) / 3) * 13).toFixed(1)}" y2="${(Math.sin((i * Math.PI) / 3) * 13).toFixed(1)}" stroke="#151515" stroke-width="2.5"/>`).join('')}<circle cx="-3" cy="-3" r="2.5" fill="#fff" opacity="0.6"/></g>`;
    }
    const sel = this.pb.selected;
    if (sel >= 0 && sel < N) {
      const sh = s.ships.find((x) => x.p === sel);
      if (sh)
        for (const d of [(sh.dir + 1) % 4, (sh.dir + 3) % 4]) {
          const [x, y] = this.xy(N + sh.p * 4 + d);
          o += `<path class="ms-turn" d="M${x},${y} m${DV[d][0] * 9},${DV[d][1] * 9} l${-DV[d][0] * 12 - DV[d][1] * 8},${-DV[d][1] * 12 + DV[d][0] * 8} l${DV[d][1] * 16},${-DV[d][0] * 16} z"/>`;
        }
    }
    return o;
  }

  private text() {
    const s = this.s;
    if (!s) return;
    const n = (sd: number) => s.ships.filter((x) => x.side === sd).length;
    this.info.innerHTML = `<div>${this.ctx.name(0)}: кораблей <b>${n(0)}</b>, мин в запасе ${s.stock[0]}</div>
      <div>${this.ctx.name(1)}: кораблей <b>${n(1)}</b>, мин в запасе ${s.stock[1]}</div>
      <small>«Взрыв» на кубике — ${s.cfg.faces} из 6 граней. Без потоплений: ${s.quiet} из ${QUIET} полуходов.</small>`;
    this.hint.textContent = 'Нажмите на корабль, затем на кружок впереди — ход, или на стрелку сбоку — поворот (тоже ход). В корму бить нельзя, в нос — только старшему.';
  }

  setView(v: State) {
    this.s = v;
    this.pb.mark(v.last);
    this.pb.set(v);
    this.text();
  }

  async play(events: Event[], v: State) {
    for (const ev of events) {
      if (ev.type === 'fwd') {
        const prev = this.s ?? v;
        const sh = prev.ships.find((x) => x.id === ev.id);
        const kind = sh ? `${sh.side}${sh.kind}${sh.dir}` : '';
        const gone = ev.took ? [{ p: ev.to, kind: `${ev.took.side}${ev.took.kind}${ev.took.dir}` }] : [];
        this.s = v;
        this.pb.show(v, ev.sunk ? null : { from: ev.from, to: ev.to, kind }, ev.sunk ? [...gone, { p: ev.to, kind }] : gone);
        if (ev.took) Sound.capture();
        else Sound.step();
        for (const r of ev.rolls) {
          Sound.diceRoll(0.4);
          await sleep(350 / this.ctx.speed());
          if (r.boom) Sound.nomove();
        }
        await sleep(300 / this.ctx.speed());
      } else if (ev.type === 'turn' || ev.type === 'mine') {
        this.s = v;
        this.pb.set(v);
        Sound.place();
        await sleep(200 / this.ctx.speed());
      } else if (ev.type === 'end') {
        if (ev.winner == null) Sound.nomove();
        else Sound.win();
      }
    }
    this.s = v;
    this.pb.mark(v.last);
    this.pb.set(v);
    this.text();
  }

  setTurn(toAct: number[], interactive: number[]) {
    const s = this.s;
    this.pb.turn(s && !s.over && !this.ctx.demo ? (interactive.find((x) => toAct.includes(x)) ?? null) : null);
  }

  status(v: State, toAct: number[], interactive: number[]) {
    const names = ['зелёные', 'красные'];
    if (v.over) return v.winner == null ? 'Ничья' : `Победили ${names[v.winner]}${v.why === 'quiet' ? ' — по очкам' : ''}`;
    if (!interactive.some((x) => toAct.includes(x))) return `Ходят ${names[v.turn]}…`;
    return 'Ваш ход: один корабль';
  }

  playerStats(v: State, seat: number) {
    return `${v.ships.filter((x) => x.side === seat).length} кораблей`;
  }
}

export function createView(): GameView<State, Event> {
  return new MorskayaView();
}
