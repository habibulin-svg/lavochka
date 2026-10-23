/* Перекати-поле — отрисовка (SVG), по коробке «Малыша»: зелёное глянцевое поле с углублёнными клетками и лотками
 * для кубиков сверху и снизу (или синий лоток), либо бумажное поле печатной версии. Кубики видны чуть сверху и спереди:
 * верхняя грань и полоска передней. Шляпка вверху — квадрат её цвета на верхней грани; на передней — полоска спереди;
 * на дальней или боковой — кайма с того края; внизу — пунктирный квадратик. Кубик на финише в зачёте — с галочкой.
 * Пока кубик выбран, под мышью — призрак: как он ляжет после переката. */
import { Sound } from '../../core/audio';
import { PointBoard } from '../../core/pointboard';
import { h, sleep } from '../../core/util';
import type { GameView, ViewCtx } from '../../core/view';
import { kubikov } from './def';
import { DOWN, EAST, NORTH, SOUTH, UP, WEST, dirOf, done, goalRow, homeRow, legal as legalOf, locked, roll, seatOf, X, Y, type Event, type State } from './engine';
import './perekati.css';

/** Поле у края и лотки для кубиков (у пластиковых видов). */
const M = 0.55;
const trayH = (s: State) => (s.cfg.look === 'paper' ? 0 : 1.05);
const top = (s: State) => M + trayH(s);
const CX = (s: State, p: number) => M + X(s.cfg, p) + 0.5;
const CY = (s: State, p: number) => top(s) + Y(s.cfg, p) + 0.5;
const size = (s: State): [number, number] => [s.cfg.w + 2 * M, s.cfg.l + 2 * top(s)];

/** Цвета кубиков: тело (светлый, основной, тёмный) и шляпка (светлый, основной, тёмный). */
const BODY = [
  ['#ffe680', '#f2c419', '#a07c00'],
  ['#ff7a6e', '#d8262a', '#7a0c10'],
];
const HAT = [
  ['#6a9cff', '#1c4fc8', '#0a2470'],
  ['#5a5a5e', '#1e1e22', '#000000'],
];
/** Пластик поля: светлый, основной, тёмный, дно клетки. */
const PLASTIC: Record<string, string[]> = {
  green: ['#5fd06a', '#1f9a30', '#0b5a18', '#137a24'],
  blue: ['#5a8cf0', '#1a4fc0', '#0a2a78', '#143e9e'],
};

function defs(s: State): string {
  let g = '';
  for (const seat of [0, 1]) {
    const [bl, b, bd] = BODY[seat];
    const [hl, hc, hd] = HAT[seat];
    g += `<linearGradient id="pk-b${seat}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${bl}"/><stop offset="0.45" stop-color="${b}"/><stop offset="1" stop-color="${bd}"/></linearGradient>`;
    g += `<linearGradient id="pk-h${seat}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${hl}"/><stop offset="0.45" stop-color="${hc}"/><stop offset="1" stop-color="${hd}"/></linearGradient>`;
  }
  const pl = PLASTIC[s.cfg.look];
  if (pl) {
    g += `<linearGradient id="pk-pl" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${pl[0]}"/><stop offset="0.3" stop-color="${pl[1]}"/><stop offset="1" stop-color="${pl[2]}"/></linearGradient>`;
    // углубление: сверху-слева тень, снизу-справа отсвет кромки
    g += `<linearGradient id="pk-well" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${pl[2]}"/><stop offset="0.25" stop-color="${pl[3]}"/><stop offset="0.8" stop-color="${pl[1]}"/><stop offset="1" stop-color="${pl[0]}"/></linearGradient>`;
  }
  g += `<linearGradient id="pk-gloss" x1="0" y1="0" x2="0.35" y2="1"><stop offset="0" stop-color="#fff" stop-opacity="0.12"/><stop offset="0.5" stop-color="#fff" stop-opacity="0"/></linearGradient>`;
  g += `<radialGradient id="pk-sh" cx="50%" cy="50%" r="50%"><stop offset="0.6" stop-color="#000" stop-opacity="0.45"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>`;
  g += `<filter id="pk-paper" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="1.6" numOctaves="3" seed="4" result="n"/><feColorMatrix in="n" type="matrix" values="0 0 0 0 0.45  0 0 0 0 0.4  0 0 0 0 0.25  0 0 0 0.16 -0.02" result="g"/><feComposite in="g" in2="SourceGraphic" operator="in" result="t"/><feMerge><feMergeNode in="SourceGraphic"/><feMergeNode in="t"/></feMerge></filter>`;
  return `<defs>${g}</defs>`;
}

/** Поле: пластиковое (зелёное или синее) с лотками или бумажное. */
function board(s: State): string {
  const c = s.cfg;
  const [W, H] = size(s);
  let o = defs(s);
  if (c.look === 'paper') {
    o += `<rect x="0.04" y="0.04" width="${W - 0.08}" height="${H - 0.08}" fill="#fdf8cf" stroke="#111" stroke-width="0.05" filter="url(#pk-paper)"/>`;
    o += `<rect x="${M - 0.16}" y="${M - 0.16}" width="${c.w + 0.32}" height="${c.l + 0.32}" fill="none" stroke="#111" stroke-width="0.035"/>`;
    for (let p = 0; p < c.w * c.l; p++) {
      const y = Y(c, p);
      const fill = y === homeRow(c, 0) ? '#fbe98a' : y === homeRow(c, 1) ? '#f7a4a0' : '#9ef7f7';
      o += `<rect x="${M + X(c, p) + 0.06}" y="${top(s) + y + 0.06}" width="0.88" height="0.88" rx="0.04" fill="${fill}" stroke="#111" stroke-width="0.03"/>`;
    }
    // разделительные линии стартовых рядов
    for (const yy of [1, c.l - 1]) o += `<line x1="${M - 0.16}" x2="${M + c.w + 0.16}" y1="${top(s) + yy}" y2="${top(s) + yy}" stroke="#111" stroke-width="0.035"/>`;
    return o;
  }
  // пластик
  o += `<rect x="0" y="0" width="${W}" height="${H}" rx="0.22" fill="url(#pk-pl)"/>`;
  o += `<rect x="0" y="0" width="${W}" height="${H}" rx="0.22" fill="url(#pk-gloss)"/>`;
  // лотки для кубиков сверху и снизу
  for (const ty of [M * 0.7, H - M * 0.7 - 0.82]) {
    o += `<rect x="${M + 0.12}" y="${ty}" width="${c.w - 0.24}" height="0.82" rx="0.08" fill="url(#pk-well)"/>`;
    o += `<rect x="${M + 0.12}" y="${ty}" width="${c.w - 0.24}" height="0.82" rx="0.08" fill="none" stroke="#000" stroke-opacity="0.25" stroke-width="0.025"/>`;
  }
  for (let p = 0; p < c.w * c.l; p++) {
    const x = M + X(c, p);
    const y = top(s) + Y(c, p);
    o += `<rect x="${x + 0.07}" y="${y + 0.07}" width="0.86" height="0.86" rx="0.07" fill="url(#pk-well)"/>`;
    o += `<rect x="${x + 0.07}" y="${y + 0.07}" width="0.86" height="0.86" rx="0.07" fill="none" stroke="#000" stroke-opacity="0.22" stroke-width="0.02"/>`;
    o += `<path d="M${x + 0.12} ${y + 0.92}H${x + 0.88}V${y + 0.12}" fill="none" stroke="#fff" stroke-opacity="0.22" stroke-width="0.02"/>`;
  }
  // финиш каждого — у края соперника: полоска его цвета снаружи
  for (const seat of [0, 1]) {
    const yy = top(s) + goalRow(c, seat) + (seat === 0 ? -0.1 : 1.04);
    o += `<rect x="${M + 0.1}" y="${yy}" width="${c.w - 0.2}" height="0.06" rx="0.03" fill="${BODY[seat][1]}" opacity="0.85"/>`;
  }
  return o;
}

/** Кубик места seat, шляпка face; ok — на финише в зачёте. alpha — прозрачность (призрак). */
function cube(seat: number, face: number, ok: boolean, x: number, y: number, alpha = 1): string {
  const S = 0.76;
  const hS = S / 2;
  const fr = 0.13; // видимая передняя грань
  const tx = x - hS;
  const ty = y - hS - fr / 2;
  const body = `url(#pk-b${seat})`;
  const hat = `url(#pk-h${seat})`;
  const hatC = HAT[seat][1];
  let o = `<g opacity="${alpha}">`;
  o += `<ellipse cx="${x + 0.04}" cy="${y + hS + 0.02}" rx="${hS * 1.12}" ry="${hS * 0.5}" fill="url(#pk-sh)"/>`;
  // передняя грань
  o += `<rect x="${tx}" y="${ty + S - 0.05}" width="${S}" height="${fr + 0.05}" rx="0.06" fill="${face === SOUTH ? HAT[seat][2] : BODY[seat][2]}"/>`;
  if (face === SOUTH) o += `<rect x="${tx + 0.03}" y="${ty + S}" width="${S - 0.06}" height="${fr - 0.03}" rx="0.03" fill="${hatC}"/>`;
  // верх
  o += `<rect x="${tx}" y="${ty}" width="${S}" height="${S}" rx="0.07" fill="${body}" stroke="${BODY[seat][2]}" stroke-width="0.018"/>`;
  // шляпка наверху — вставка её цвета с ободком цвета кубика (на настоящем кубике — вся грань)
  if (face === UP) o += `<rect x="${tx + 0.1}" y="${ty + 0.1}" width="${S - 0.2}" height="${S - 0.2}" rx="0.05" fill="${hat}" stroke="${HAT[seat][2]}" stroke-width="0.02"/>`;
  const band = 0.085;
  if (face === NORTH) o += `<rect x="${tx + 0.02}" y="${ty + 0.02}" width="${S - 0.04}" height="${band}" rx="0.04" fill="${hatC}"/>`;
  if (face === WEST) o += `<rect x="${tx + 0.02}" y="${ty + 0.02}" width="${band}" height="${S + fr - 0.05}" rx="0.04" fill="${hatC}"/>`;
  if (face === EAST) o += `<rect x="${tx + S - 0.02 - band}" y="${ty + 0.02}" width="${band}" height="${S + fr - 0.05}" rx="0.04" fill="${hatC}"/>`;
  if (face === DOWN) o += `<rect x="${x - 0.14}" y="${ty + hS - 0.14}" width="0.28" height="0.28" rx="0.04" fill="none" stroke="${hatC}" stroke-width="0.035" stroke-dasharray="0.06 0.045"/>`;
  // блик
  o += `<rect x="${tx + 0.08}" y="${ty + 0.07}" width="${S * 0.5}" height="${S * 0.16}" rx="0.04" fill="#fff" opacity="${face === UP ? 0.18 : 0.32}"/>`;
  if (ok) {
    const cx = tx + S - 0.17;
    const cy = ty + S - 0.17;
    o += `<circle cx="${cx}" cy="${cy}" r="0.12" fill="#fff8d8" stroke="#8a6a10" stroke-width="0.02"/>`;
    o += `<path d="M${cx - 0.06} ${cy}l0.045 0.05l0.08 -0.1" fill="none" stroke="#2a8a2a" stroke-width="0.035" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  return o + '</g>';
}

const kindAt = (s: State, p: number) => {
  const id = s.board[p];
  return `${seatOf(id)}:${s.face[id]}:${locked(s, p) ? 1 : 0}`;
};

/** Значок кубика места для подписей. */
const chip = (seat: number) => `<span class="pk-chip" style="background:${BODY[seat][1]};border-color:${HAT[seat][1]}"></span>`;

class PerekatiView implements GameView<State, Event> {
  private ctx!: ViewCtx;
  private pb!: PointBoard<State, { type: 'move'; from: number; to: number }>;
  private info!: HTMLElement;
  private s: State | null = null;

  mount(root: HTMLElement, ctx: ViewCtx) {
    this.ctx = ctx;
    this.info = h(`<div class="pk-info"></div>`);
    ctx.controls.appendChild(this.info);
    if (!ctx.demo)
      ctx.controls.appendChild(
        h(`<div class="pk-hint">Нажмите на свой кубик, потом на соседнюю клетку — кубик перекатится через ребро. Шляпка (грань другого цвета): вверху — цветной квадрат сверху, на боку — кайма с того края, внизу — пунктирный квадратик.</div>`)
      );
    this.pb = new PointBoard(
      root,
      ctx,
      {
        count: (s) => s.cfg.w * s.cfg.l,
        size,
        xy: (s, p) => [CX(s, p), CY(s, p)],
        board,
        pieces: (s) => s.board.flatMap((v, p) => (v >= 0 ? [{ p, kind: kindAt(s, p) }] : [])),
        piece: (_s, kind, x, y) => {
          const [seat, face, ok] = kind.split(':').map(Number);
          return cube(seat, face, ok === 1, x, y);
        },
        legal: (s, seat) => (s.turn === seat && !s.over ? legalOf(s) : []),
        spot: (a) => ({ from: a.from, to: a.to }),
        hit: 0.5,
        ring: 0.47,
      },
      'pk-wrap'
    );
    // призрак: как ляжет выбранный кубик
    this.pb.extra = (s) => {
      const from = this.pb.selected;
      const to = this.pb.hovered;
      if (from < 0 || to < 0 || s.board[to] >= 0 || s.turn == null) return '';
      if (!legalOf(s).some((a) => a.from === from && a.to === to)) return '';
      const id = s.board[from];
      const f = roll(s.face[id], dirOf(s.cfg, from, to));
      const ok = f === UP && Y(s.cfg, to) === goalRow(s.cfg, seatOf(id));
      return `<g pointer-events="none">${cube(seatOf(id), f, ok, CX(s, to), CY(s, to), 0.55)}</g>`;
    };
  }

  private text() {
    const s = this.s;
    if (!s) return;
    const n = s.cfg.w;
    let t = '';
    if (s.ply === 0 && !s.over) t += `<div>Жребий: первыми ходят ${this.ctx.name(s.turn).toLowerCase()}</div>`;
    t += `<div>На финише шляпкой вверх: ${chip(0)} <b>${done(s, 0)}</b> из ${n} · ${chip(1)} <b>${done(s, 1)}</b> из ${n}</div>`;
    t += `<small>У каждого ${kubikov(n)}; ход ${Math.floor(s.ply / 2) + 1}</small>`;
    this.info.innerHTML = t;
  }

  setView(v: State) {
    this.s = v;
    this.pb.mark(v.last);
    this.pb.set(v);
    this.text();
  }

  async play(events: Event[], v: State) {
    let cur: State = this.s ? { ...this.s, board: this.s.board.slice(), face: this.s.face.slice() } : v;
    const sp = () => this.ctx.speed();
    for (const ev of events) {
      if (ev.type === 'move') {
        const board = cur.board.slice();
        const face = cur.face.slice();
        const id = board[ev.from];
        board[ev.to] = id;
        board[ev.from] = -1;
        face[id] = ev.after;
        const after: State = { ...cur, board, face, last: [ev.from, ev.to] };
        this.pb.show(after, { from: ev.from, to: ev.to, kind: kindAt(after, ev.to) });
        if (ev.locked) Sound.home();
        else Sound.step();
        await sleep((ev.locked ? 520 : 340) / sp());
        cur = after;
      } else if (ev.type === 'end') {
        if (ev.winner != null) Sound.win();
        else Sound.nomove();
        await sleep(600 / sp());
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
    if (v.over) return v.winner == null ? 'Ничья' : `Победа: ${this.ctx.name(v.winner)}`;
    if (!interactive.includes(toAct[0])) return `Ходят ${this.ctx.name(toAct[0]).toLowerCase()}…`;
    return 'Ваш ход — перекатите кубик';
  }
}

export function createView(): GameView<State, Event> {
  return new PerekatiView();
}
