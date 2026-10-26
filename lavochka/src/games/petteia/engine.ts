/* Петтейя и латрункули — правила без DOM. Античные игры «на войско»: фишки ходят по прямым линиям сетки,
 * а берут «в клещи» — ходом ставят свою фишку так, чтобы чужая оказалась между ней и другой вашей по прямой.
 * Самому вставать между двумя чужими можно — так не берут (у Шедлера — только если этим же ходом берёшь).
 * Правил не сохранилось, всё — реконструкции (см. docs/STATE.md, «Решения, принятые без пользователя»):
 *   Петтейя — 8×8, по 8 фишек в последнем ряду, ход как у ладьи; кто остался с одной фишкой или без хода — проиграл.
 *   Латрункули по Ковальскому — 8×12 (12 в ширину), по 12 фишек и дукс (полководец); ход как у ладьи, в углу берут двумя
 *     фишками на соседних клетках; дукса не берут, но дукс, которому некуда шагнуть (кругом фишки и край, среди них враг), — проигрыш.
 *   По Беллу — 8×8, по 16 фишек и дукс, сначала расстановка по две фишки за ход (дукс — последним); ход на клетку,
 *     дукс может перепрыгнуть соседнего врага; после взятия — ещё ход; дукс берут как простую фишку.
 *   По Шедлеру — 8×8, по 16 фишек, расстановка по одной; ход на клетку или прыжок через соседнюю фишку (цепочкой).
 * Долго без взятий (quiet) — у кого больше фишек, тот и выиграл, поровну — ничья. */
import type { Options, Rng } from '../../core/types';

export type Kind = 'petteia' | 'kowalski' | 'bell' | 'schadler';
export type Look = 'marble' | 'clay';

export interface Rules {
  w: number;
  h: number;
  /** Расстановка: ряд у края / по Ковальскому / выставляют по очереди. */
  setup: 'row' | 'kowalski' | 'place';
  men: number;
  dux: boolean;
  /** Сколько фишек ставят за ход в расстановке. */
  perTurn: number;
  /** Ход: как ладья / на соседнюю клетку. */
  move: 'rook' | 'step';
  /** Прыжок через соседнюю фишку: никто / дукс через врага / любая фишка через любую, цепочкой. */
  jump: 'none' | 'dux' | 'all';
  /** Дукса не берут, запертый дукс — проигрыш. */
  duxImmune: boolean;
  /** В углу берут двумя фишками на соседних клетках. */
  corner: boolean;
  /** Взял — ходишь ещё. */
  bonus: boolean;
  /** Встать между двумя чужими — только если этим ходом берёшь. */
  noSuicide: boolean;
  /** Проиграл, у кого осталось столько фишек (или меньше). */
  minLeft: number;
  /** Полуходов без взятия до подсчёта. */
  quiet: number;
}

export const RULES: Record<Kind, Rules> = {
  petteia: { w: 8, h: 8, setup: 'row', men: 8, dux: false, perTurn: 1, move: 'rook', jump: 'none', duxImmune: false, corner: false, bonus: false, noSuicide: false, minLeft: 1, quiet: 80 },
  kowalski: { w: 12, h: 8, setup: 'kowalski', men: 12, dux: true, perTurn: 1, move: 'rook', jump: 'none', duxImmune: true, corner: true, bonus: false, noSuicide: false, minLeft: 1, quiet: 100 },
  bell: { w: 8, h: 8, setup: 'place', men: 16, dux: true, perTurn: 2, move: 'step', jump: 'dux', duxImmune: false, corner: true, bonus: true, noSuicide: false, minLeft: 0, quiet: 60 },
  schadler: { w: 8, h: 8, setup: 'place', men: 16, dux: false, perTurn: 1, move: 'step', jump: 'all', duxImmune: false, corner: false, bonus: false, noSuicide: true, minLeft: 1, quiet: 60 },
};

export interface Cfg {
  kind: Kind;
  look: Look;
}

export function cfgFrom(o: Options): Cfg {
  const k = o.kind;
  return {
    kind: k === 'kowalski' || k === 'bell' || k === 'schadler' ? k : 'petteia',
    look: o.look === 'clay' ? 'clay' : 'marble',
  };
}

/** Фишки: 1, 2 — простые мест 0 и 1; 3, 4 — дуксы. */
export const MAN = [1, 2];
export const DUX = [3, 4];
export const sideOf = (v: number) => (v === 1 || v === 3 ? 0 : v ? 1 : -1);
export const isDux = (v: number) => v === 3 || v === 4;

export interface State {
  cfg: Cfg;
  w: number;
  h: number;
  board: number[];
  turn: number;
  phase: 'place' | 'play';
  /** Сколько ещё выставить: простых и дукс. */
  hand: [number, number];
  duxHand: [boolean, boolean];
  /** Сколько поставлено за текущий ход расстановки. */
  placed: number;
  /** Фишка, которая прыгает цепочкой (−1 — нет). */
  chain: number;
  /** Откуда начался ход с цепочкой прыжков. */
  chainFrom: number;
  ply: number;
  quiet: number;
  over: boolean;
  winner: number | null;
  last: number[];
  lost: [number, number];
}

/** scatter — «Расставить случайно»: все оставшиеся свои фишки — на случайные пустые клетки своей половины. */
export type Action = { type: 'place'; to: number } | { type: 'move'; from: number; to: number } | { type: 'stop' } | { type: 'scatter' };
export type Why = 'all' | 'stuck' | 'dux' | 'quiet' | 'long';
export type Event =
  | { type: 'place'; seat: number; to: number; piece: number }
  | { type: 'move'; seat: number; from: number; to: number; piece: number; jump: boolean; taken: number[]; bonus: boolean }
  | { type: 'stop'; seat: number; taken: number[] }
  | { type: 'phase' }
  | { type: 'end'; winner: number | null; why: Why };

const LIMIT = 500;

export const rulesOf = (s: State) => RULES[s.cfg.kind];

export function newState(cfg: Cfg): State {
  const R = RULES[cfg.kind];
  const { w, h } = R;
  const board = Array(w * h).fill(0);
  const s: State = {
    cfg,
    w,
    h,
    board,
    turn: 0,
    phase: R.setup === 'place' ? 'place' : 'play',
    hand: [0, 0],
    duxHand: [false, false],
    placed: 0,
    chain: -1,
    chainFrom: -1,
    ply: 0,
    quiet: 0,
    over: false,
    winner: null,
    last: [],
    lost: [0, 0],
  };
  if (R.setup === 'place') {
    s.hand = [R.men, R.men];
    s.duxHand = [R.dux, R.dux];
  } else if (R.setup === 'row') {
    for (let x = 0; x < w; x++) {
      board[(h - 1) * w + x] = 1;
      board[x] = 2;
    }
  } else {
    // Ковальский: первая линия — простые, дукс во второй линии правее середины (у каждого — со своей стороны)
    for (let x = 0; x < w; x++) {
      board[(h - 1) * w + x] = 1;
      board[x] = 2;
    }
    board[(h - 2) * w + w / 2] = 3;
    board[w + w / 2 - 1] = 4;
  }
  return s;
}

export const setup = (_seats: number[], o: Options) => newState(cfgFrom(o));
export const toAct = (s: State) => (s.over ? [] : [s.turn]);

export function at(s: { w: number; h: number }, x: number, y: number) {
  return x >= 0 && y >= 0 && x < s.w && y < s.h ? y * s.w + x : -1;
}
const DIRS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/** Клетки для расстановки: любая пустая. */
function placeSpots(s: State): number[] {
  const out: number[] = [];
  s.board.forEach((v, p) => {
    if (!v) out.push(p);
  });
  return out;
}

/** Прыжки фишки с клетки p (через соседнюю на пустую за ней). */
export function jumpsFrom(s: State, p: number): number[] {
  const R = rulesOf(s);
  const v = s.board[p];
  if (R.jump === 'none' || (R.jump === 'dux' && !isDux(v))) return [];
  const x0 = p % s.w;
  const y0 = (p - x0) / s.w;
  const out: number[] = [];
  for (const [dx, dy] of DIRS) {
    const q = at(s, x0 + dx, y0 + dy);
    const t = at(s, x0 + 2 * dx, y0 + 2 * dy);
    if (q < 0 || t < 0 || !s.board[q] || s.board[t]) continue;
    if (R.jump === 'dux' && sideOf(s.board[q]) === sideOf(v)) continue; // дукс прыгает только через врага
    out.push(t);
  }
  return out;
}

/** Продолжение цепочки: прыжки, кроме как обратно на уже пройденные клетки. */
export const chainJumps = (s: State) => jumpsFrom(s, s.chain).filter((q) => !s.last.includes(q));

/** Обычные ходы (без прыжков) фишки с клетки p. */
export function stepsFrom(s: State, p: number): number[] {
  const R = rulesOf(s);
  const x0 = p % s.w;
  const y0 = (p - x0) / s.w;
  const out: number[] = [];
  for (const [dx, dy] of DIRS) {
    let x = x0 + dx;
    let y = y0 + dy;
    for (let q = at(s, x, y); q >= 0 && !s.board[q]; q = at(s, (x += dx), (y += dy))) {
      out.push(q);
      if (R.move === 'step') break;
    }
  }
  return out;
}

/** Взятия, если фишка стороны seat окажется на клетке to (доска — уже после хода). */
function captures(s: State, to: number, seat: number): number[] {
  const R = rulesOf(s);
  const w = s.w;
  const tx = to % w;
  const ty = (to - tx) / w;
  const out: number[] = [];
  const enemy = (q: number) => q >= 0 && sideOf(s.board[q]) === 1 - seat && !(R.duxImmune && isDux(s.board[q]));
  const mine = (q: number) => q >= 0 && sideOf(s.board[q]) === seat;
  for (const [dx, dy] of DIRS) {
    const q = at(s, tx + dx, ty + dy);
    if (!enemy(q)) continue;
    if (mine(at(s, tx + 2 * dx, ty + 2 * dy))) out.push(q);
    else if (R.corner) {
      // угол: враг в углу, наши — на обеих соседних клетках
      const qx = tx + dx;
      const qy = ty + dy;
      if ((qx === 0 || qx === w - 1) && (qy === 0 || qy === s.h - 1)) {
        const other = dx ? at(s, qx, qy + (qy === 0 ? 1 : -1)) : at(s, qx + (qx === 0 ? 1 : -1), qy);
        if (mine(other)) out.push(q);
      }
    }
  }
  return out;
}

/** Стоит ли фишка на to между двумя чужими по прямой (после хода). */
function between(s: State, to: number, seat: number): boolean {
  const tx = to % s.w;
  const ty = (to - tx) / s.w;
  const enemy = (q: number) => q >= 0 && sideOf(s.board[q]) === 1 - seat;
  return (enemy(at(s, tx - 1, ty)) && enemy(at(s, tx + 1, ty))) || (enemy(at(s, tx, ty - 1)) && enemy(at(s, tx, ty + 1)));
}

/** Нарушает ли ход запрет «не вставать между двумя чужими без взятия» (только у Шедлера). */
function suicide(s: State, from: number, to: number, seat: number): boolean {
  if (!rulesOf(s).noSuicide) return false;
  // ход «понарошку» на той же доске и откат
  const b = s.board;
  b[to] = b[from];
  b[from] = 0;
  const bad = between(s, to, seat) && !captures(s, to, seat).length;
  b[from] = b[to];
  b[to] = 0;
  return bad;
}

export function legal(s: State): Action[] {
  if (s.over) return [];
  const seat = s.turn;
  if (s.phase === 'place') return placeSpots(s).map((to) => ({ type: 'place', to }));
  if (s.chain >= 0) {
    const out: Action[] = chainJumps(s).map((to) => ({ type: 'move', from: s.chain, to }));
    out.push({ type: 'stop' });
    return out;
  }
  const out: Action[] = [];
  s.board.forEach((v, p) => {
    if (sideOf(v) !== seat) return;
    for (const q of stepsFrom(s, p)) if (!suicide(s, p, q, seat)) out.push({ type: 'move', from: p, to: q });
    for (const q of jumpsFrom(s, p)) out.push({ type: 'move', from: p, to: q });
  });
  return out;
}

/** Есть ли у ходящего хоть один ход (без построения списка). */
function hasMove(s: State): boolean {
  if (s.phase === 'place') return s.board.includes(0);
  for (let p = 0; p < s.board.length; p++) {
    if (sideOf(s.board[p]) !== s.turn) continue;
    if (jumpsFrom(s, p).length) return true;
    for (const q of stepsFrom(s, p)) if (!suicide(s, p, q, s.turn)) return true;
  }
  return false;
}

export const count = (s: State, seat: number) => s.board.reduce((n, v) => n + (sideOf(v) === seat ? 1 : 0), 0);

/** Заперт ли дукс стороны seat: все четыре соседние клетки заняты или за краем, и хоть одна — врагом. */
export function duxLocked(s: State, seat: number): boolean {
  const p = s.board.indexOf(DUX[seat]);
  if (p < 0) return false;
  const x = p % s.w;
  const y = (p - x) / s.w;
  let foe = false;
  for (const [dx, dy] of DIRS) {
    const q = at(s, x + dx, y + dy);
    if (q >= 0 && !s.board[q]) return false;
    if (q >= 0 && sideOf(s.board[q]) === 1 - seat) foe = true;
  }
  return foe;
}

function clone(s: State): State {
  return { ...s, board: s.board.slice(), hand: [s.hand[0], s.hand[1]], duxHand: [s.duxHand[0], s.duxHand[1]], lost: [s.lost[0], s.lost[1]] };
}

function finish(s: State, events: Event[], winner: number | null, why: Why) {
  s.over = true;
  s.winner = winner;
  s.chain = -1;
  events.push({ type: 'end', winner, why });
  return { state: s, events };
}

/** После завершённого хода (с взятиями): итоги и передача хода. */
function settle(s: State, events: Event[], seat: number, taken: number[]) {
  const R = rulesOf(s);
  for (const q of taken) {
    s.board[q] = 0;
    s.lost[1 - seat]++;
  }
  s.chain = -1;
  s.chainFrom = -1;
  s.ply++;
  s.quiet = taken.length ? 0 : s.quiet + 1;
  const foe = 1 - seat;
  if (count(s, foe) <= R.minLeft) return finish(s, events, seat, 'all');
  if (R.duxImmune && duxLocked(s, foe)) return finish(s, events, seat, 'dux');
  const again = R.bonus && taken.length > 0;
  s.turn = again ? seat : foe;
  if (!hasMove(s)) return finish(s, events, s.turn === seat ? foe : seat, 'stuck');
  if (s.quiet >= R.quiet) {
    const a = count(s, 0);
    const b = count(s, 1);
    return finish(s, events, a === b ? null : a > b ? 0 : 1, 'quiet');
  }
  if (s.ply >= LIMIT) return finish(s, events, null, 'long');
  return { state: s, events };
}

/** «Расставить случайно»: все оставшиеся свои фишки (дукс — последним) разом — на пустые клетки своей половины доски. */
function scatter(s0: State, seat: number, rng?: Rng): { state: State; events: Event[] } {
  const s = clone(s0);
  const events: Event[] = [];
  const rand = (n: number) => (rng ? rng.int(n) : Math.floor(Math.random() * n));
  const mine = (p: number) => (seat === 0 ? p >= (s.h / 2) * s.w : p < (s.h / 2) * s.w);
  while (s.hand[seat] > 0 || s.duxHand[seat]) {
    const free = placeSpots(s);
    const spots = free.filter(mine).length ? free.filter(mine) : free;
    const to = spots[rand(spots.length)];
    const dux = s.hand[seat] === 0;
    const piece = dux ? DUX[seat] : MAN[seat];
    s.board[to] = piece;
    if (dux) s.duxHand[seat] = false;
    else s.hand[seat]--;
    events.push({ type: 'place', seat, to, piece });
  }
  s.last = [];
  s.placed = 0;
  const foe = 1 - seat;
  if (s.hand[foe] + (s.duxHand[foe] ? 1 : 0) > 0) {
    s.turn = foe;
    return { state: s, events };
  }
  s.phase = 'play';
  s.turn = 0;
  events.push({ type: 'phase' });
  if (!hasMove(s)) return finish(s, events, 1, 'stuck');
  return { state: s, events };
}

/** Применить ход без проверки. */
export function step(s0: State, a: Action): { state: State; events: Event[] } {
  const s = clone(s0);
  const seat = s.turn;
  const R = rulesOf(s);
  const events: Event[] = [];
  if (a.type === 'place') {
    const dux = s.hand[seat] === 0 && s.duxHand[seat];
    const piece = dux ? DUX[seat] : MAN[seat];
    s.board[a.to] = piece;
    if (dux) s.duxHand[seat] = false;
    else s.hand[seat]--;
    s.last = [a.to];
    events.push({ type: 'place', seat, to: a.to, piece });
    s.placed++;
    const left = (q: number) => s.hand[q] + (s.duxHand[q] ? 1 : 0);
    if (!left(0) && !left(1)) {
      s.phase = 'play';
      s.placed = 0;
      s.turn = 0;
      events.push({ type: 'phase' });
      if (!hasMove(s)) return finish(s, events, 1, 'stuck');
      return { state: s, events };
    }
    // дукс ставят отдельным ходом, после всех простых
    if (s.placed >= R.perTurn || !left(seat) || dux || (s.hand[seat] === 0 && s.duxHand[seat])) {
      s.placed = 0;
      if (left(1 - seat)) s.turn = 1 - seat;
    }
    return { state: s, events };
  }
  if (a.type === 'scatter') return scatter(s0, seat);
  if (a.type === 'stop') {
    const to = s.chain;
    const taken = captures(s, to, seat);
    events.push({ type: 'stop', seat, taken });
    return settle(s, events, seat, taken);
  }
  const piece = s.board[a.from];
  const fx = a.from % s.w;
  const fy = (a.from - fx) / s.w;
  const tx = a.to % s.w;
  const ty = (a.to - tx) / s.w;
  const jump = R.move === 'step' && Math.abs(fx - tx) + Math.abs(fy - ty) === 2;
  s.board[a.from] = 0;
  s.board[a.to] = piece;
  s.last = s.chain >= 0 ? [...s.last, a.to] : [a.from, a.to];
  if (jump && R.jump === 'all') {
    // цепочка прыжков: можно прыгать дальше, взятие — когда фишка остановится
    if (s.chainFrom < 0) s.chainFrom = a.from;
    s.chain = a.to;
    if (chainJumps(s).length) {
      events.push({ type: 'move', seat, from: a.from, to: a.to, piece, jump, taken: [], bonus: false });
      return { state: s, events };
    }
  }
  const taken = captures(s, a.to, seat);
  events.push({ type: 'move', seat, from: a.from, to: a.to, piece, jump, taken, bonus: R.bonus && taken.length > 0 });
  return settle(s, events, seat, taken);
}

export function apply(s: State, seat: number, a: Action, rng?: Rng): { state: State; events: Event[] } | null {
  if (s.over || seat !== s.turn || !a) return null;
  if (a.type === 'scatter') return s.phase === 'place' ? scatter(s, seat, rng) : null;
  const ok = legal(s).some((b) => b.type === a.type && (b.type === 'stop' || (b.to === (a as { to: number }).to && (b.type !== 'move' || b.from === (a as { from: number }).from))));
  return ok ? step(s, a) : null;
}
