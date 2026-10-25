/* «Наша игротека» — правила двенадцати игр по брошюре набора (составители Л. М. Эйдельс, Ю. Е. Давыдов). Без DOM.
 * Место 0 всегда начинает и стоит внизу поля (в «Лисе и гусях» первой ставит лису место 1 — так в брошюре).
 *
 *  Волк и овцы — волк (0) ходит по линиям вперёд и назад, овцы (1) — только вперёд. Волк прорвался (ни одной овцы позади) — победа волка,
 *    заперт — победа овец.
 *  Так-тикль — 4×4, по 4 фишки через одну; шаг на соседнюю клетку по стороне. Три в ряд (и по диагонали) — победа.
 *  Квартет — 5×5 (поле «Сиджи»): расставить по 4, потом шаг в любую сторону; четыре в ряд или квадратом 2×2 — победа.
 *  Лиса и гуси — 13 (или 17) гусей (0) против лисы (1); гуси — вперёд и вбок по сплошным линиям (вариант — и назад),
 *    лиса — по сплошным (вариант — и по штриховым), прыжком через гуся снимает его, прыжки можно продолжать.
 *    Лиса заперта — гуси выиграли; гусей меньше девяти (или им некуда ходить) — лиса.
 *  Леопарды и коровы — 2 леопарда (0) против 24 коров (1), фишки выставляют по очереди, леопарды прыгают через коров;
 *    8 съеденных — победа леопардов, оба заперты — коров.
 *  Мельница — по 9 фишек, ряды и по диагоналям, можно перепрыгнуть одну фишку на свободный кружок за ней;
 *    остались две фишки — проигрыш. Дополнительно: с тремя фишками — «полёт».
 *  Болотуду — 5×6, по 12, ставят по две (между ними не меньше двух пустых клеток), ходят по стороне;
 *    новая тройка в ряд снимает фишку соперника, примыкающую к тройке. Две фишки — проигрыш, повторение — ничья.
 *  Сенегальские шашки — поле «Болотуду», по 14; вперёд и вбок, бить обязательно (прыжком), дошедшая до последнего ряда
 *    снимается. Когда шашки разошлись — у кого больше, тот выиграл.
 *  Сиджа — 5×5, по 12, ставят по две (кроме центра), ходят в любую сторону, зажатая с двух сторон фишка снимается.
 *    Больше снял — выиграл.
 *  Алькуерк — 5×5, по 12; вперёд, вбок и вперёд по диагонали; прыжки с поворотами; пропустил возможный прыжок в цепочке —
 *    своя фишка снимается. Очки: 2 за победу + по 2 за свои оставшиеся (за запертые — по 1).
 *  Хасами шоги — 9×9, по 18; на клетку вперёд или вбок, прыжок через чужую без снятия; зажатую снимают; пять в ряд
 *    по вертикали или диагонали в пяти средних рядах — победа.
 *  Турецкие шашки — движок «Шашек» (вариант turkish). */
import type { Options } from '../../core/types';
import { apply as ckApply, legalMoves as ckLegal, newGame as ckNew, cfgFrom as ckCfg, colorOf, isKing, type State as CkState } from '../checkers/engine';
import { geo, type BoardId, type Geo } from './geo';

export type GameId = 'sheep' | 'tickle' | 'quartet' | 'fox' | 'leopards' | 'mill' | 'bolotudu' | 'senegal' | 'sidja' | 'alquerque' | 'hasami' | 'turk';
export const GAMES: GameId[] = ['sheep', 'tickle', 'quartet', 'fox', 'leopards', 'mill', 'bolotudu', 'senegal', 'sidja', 'alquerque', 'hasami', 'turk'];

export const BOARD_OF: Record<GameId, BoardId> = {
  sheep: 'sheep',
  tickle: 'tickle',
  quartet: 'sidja',
  fox: 'fox',
  leopards: 'leopards',
  mill: 'mill',
  bolotudu: 'bolotudu',
  senegal: 'bolotudu',
  sidja: 'sidja',
  alquerque: 'alquerque',
  hasami: 'hasami',
  turk: 'turk',
};

export const TITLES: Record<GameId, string> = {
  sheep: 'Волк и овцы',
  tickle: 'Так-тикль',
  quartet: 'Квартет',
  fox: 'Лиса и гуси',
  leopards: 'Леопарды и коровы',
  mill: 'Мельница',
  bolotudu: 'Болотуду',
  senegal: 'Сенегальские шашки',
  sidja: 'Сиджа',
  alquerque: 'Алькуерк',
  hasami: 'Хасами шоги',
  turk: 'Турецкие шашки',
};

/** Имена сторон: [место 0, место 1]. */
export const SIDES: Record<GameId, [string, string]> = {
  sheep: ['Волк', 'Овцы'],
  fox: ['Гуси', 'Лиса'],
  leopards: ['Леопарды', 'Коровы'],
  tickle: ['Белые', 'Красные'],
  quartet: ['Белые', 'Красные'],
  mill: ['Белые', 'Красные'],
  bolotudu: ['Белые', 'Красные'],
  senegal: ['Белые', 'Красные'],
  sidja: ['Белые', 'Красные'],
  alquerque: ['Белые', 'Красные'],
  hasami: ['Белые', 'Красные'],
  turk: ['Белые', 'Красные'],
};

/** Цвет фишек места: 'w' — белые, 'b' — красные. Сторона с множеством фишек (овцы, гуси, коровы) — красные. */
export function colorOfSeat(g: GameId, seat: number): 'w' | 'b' {
  if (g === 'fox') return seat === 0 ? 'b' : 'w';
  if (g === 'leopards' || g === 'sheep') return seat === 0 ? 'w' : 'b';
  return seat === 0 ? 'w' : 'b';
}

export interface Cfg {
  game: GameId;
  /** Лиса и гуси: 13 или 17 гусей. */
  geese: 13 | 17;
  /** Лиса ходит и по штриховым линиям. */
  foxDiag: boolean;
  /** Гусям можно назад. */
  geeseBack: boolean;
  /** Мельница: с тремя фишками — «полёт». */
  fly: boolean;
}

export function cfgFrom(o: Options): Cfg {
  const game = GAMES.includes(o.game as GameId) ? (o.game as GameId) : 'sheep';
  return { game, geese: Number(o.geese) === 17 ? 17 : 13, foxDiag: o.foxDiag === true, geeseBack: o.geeseBack === true, fly: o.fly === true };
}

export type EndWhy =
  | 'broke' // волк прорвался
  | 'trapped' // заперт (волк, лиса, леопарды) / соперник без ходов
  | 'line' // ряд (так-тикль, квартет, хасами)
  | 'eaten' // съедено достаточно (лиса, леопарды)
  | 'few' // осталось две фишки (мельница, болотуду)
  | 'all' // сняты все фишки
  | 'apart' // шашки разошлись (сенегальские) — по счёту
  | 'count' // долго без снятий — по счёту (сиджа, сенегальские)
  | 'repeat' // повторение — ничья
  | 'quiet' // долго без толку — ничья
  | 'checkers'; // турецкие — по движку шашек

export interface State {
  cfg: Cfg;
  /** 0 — пусто, 1 — фишка места 0, 2 — места 1. */
  board: number[];
  turn: number;
  /** Фишек ещё не выставлено. */
  hand: [number, number];
  /** Первая фишка, выставленная в этот ход (ставят по две), иначе −1. */
  first: number;
  /** Фишка посреди цепочки прыжков, −1 — нет. */
  chain: number;
  /** Откуда начата цепочка (алькуерк: туда возвращаться нельзя). */
  origin: number;
  /** Снять фишек соперника (мельница, болотуду) и откуда можно снимать (болотуду; null — любую). */
  take: number;
  takeSet: number[] | null;
  /** Пропусков подряд (сиджа). */
  passes: number;
  /** Полуходов без снятия. */
  quiet: number;
  ply: number;
  /** Сколько фишек соперника снял каждый. */
  caps: [number, number];
  /** Сколько своих фишек каждый вывел за последний ряд (сенегальские) или потерял «за фук» (алькуерк). */
  lost: [number, number];
  /** Ключи позиций для повторения (болотуду). */
  keys: string[];
  over: boolean;
  winner: number | null;
  why: EndWhy | null;
  /** Очки победителя (алькуерк). */
  points: number;
  last: number[];
  /** Турецкие шашки: позиция движка шашек и начатый ход (поля, пройденные по цепочке взятий). */
  ck: CkState | null;
  pend: number[];
}

export type Action =
  | { type: 'place'; to: number }
  | { type: 'move'; from: number; to: number }
  | { type: 'take'; at: number }
  | { type: 'stop' }
  | { type: 'pass' }
  /** Турецкие: весь ход шашки сразу (боты). */
  | { type: 'path'; from: number; path: number[] };

export type Event =
  | { type: 'place'; seat: number; to: number }
  | { type: 'move'; seat: number; from: number; to: number; over: number[]; jump: boolean; caps: number[]; king?: boolean }
  | { type: 'take'; seat: number; at: number }
  | { type: 'out'; seat: number; at: number }
  | { type: 'huff'; seat: number; at: number }
  | { type: 'pass'; seat: number }
  | { type: 'end'; winner: number | null; why: EndWhy; points: number };

const QUIET = 60;
const LIMIT = 400;

export const G = (s: { cfg: Cfg }): Geo => geo(BOARD_OF[s.cfg.game]);
const me = (seat: number) => seat + 1;
/** Направление «вперёд» по рядам: место 0 стоит внизу и идёт вверх. */
const fwd = (seat: number) => (seat === 0 ? -1 : 1);

export function count(s: State, seat: number): number {
  let n = 0;
  for (const v of s.board) if (v === me(seat)) n++;
  return n;
}

// ---------------------------------------------------------------- начальные позиции

export function newState(cfg: Cfg): State {
  const g = geo(BOARD_OF[cfg.game]);
  const board = Array<number>(g.pts.length).fill(0);
  let hand: [number, number] = [0, 0];
  let turn = 0;
  const put = (r: number, c: number, seat: number) => {
    const p = g.at(r, c);
    if (p >= 0) board[p] = me(seat);
  };
  let ck: CkState | null = null;
  switch (cfg.game) {
    case 'sheep':
      put(0, 3, 0);
      for (const c of [0, 2, 4, 6]) put(7, c, 1);
      break;
    case 'tickle':
      // как на поле: сверху ● ○ ● ○, снизу ○ ● ○ ●
      for (const c of [0, 2]) put(0, c, 1);
      for (const c of [1, 3]) put(0, c, 0);
      for (const c of [0, 2]) put(3, c, 0);
      for (const c of [1, 3]) put(3, c, 1);
      break;
    case 'quartet':
      hand = [4, 4];
      break;
    case 'fox':
      for (let c = 0; c < 7; c++) put(4, c, 0);
      for (const r of [5, 6]) for (let c = 2; c <= 4; c++) put(r, c, 0);
      if (cfg.geese === 17) for (const [r, c] of [[2, 0], [3, 0], [2, 6], [3, 6]]) put(r, c, 0);
      hand = [0, 1];
      turn = 1;
      break;
    case 'leopards':
      hand = [2, 24];
      break;
    case 'mill':
      hand = [9, 9];
      break;
    case 'bolotudu':
      hand = [12, 12];
      break;
    case 'sidja':
      hand = [12, 12];
      break;
    case 'senegal':
      for (const r of [3, 4]) for (let c = 0; c < 6; c++) put(r, c, 0);
      for (const r of [0, 1]) for (let c = 0; c < 6; c++) put(r, c, 1);
      put(2, 4, 0);
      put(2, 5, 0);
      put(2, 0, 1);
      put(2, 1, 1);
      break;
    case 'alquerque':
      for (const r of [3, 4]) for (let c = 0; c < 5; c++) put(r, c, 0);
      for (const r of [0, 1]) for (let c = 0; c < 5; c++) put(r, c, 1);
      put(2, 3, 0);
      put(2, 4, 0);
      put(2, 0, 1);
      put(2, 1, 1);
      break;
    case 'hasami':
      for (const r of [7, 8]) for (let c = 0; c < 9; c++) put(r, c, 0);
      for (const r of [0, 1]) for (let c = 0; c < 9; c++) put(r, c, 1);
      break;
    case 'turk':
      ck = ckNew(ckCfg({ variant: 'turkish' }));
      break;
  }
  return {
    cfg,
    board,
    turn,
    hand,
    first: -1,
    chain: -1,
    origin: -1,
    take: 0,
    takeSet: null,
    passes: 0,
    quiet: 0,
    ply: 0,
    caps: [0, 0],
    lost: [0, 0],
    keys: [],
    over: false,
    winner: null,
    why: null,
    points: 0,
    last: [],
    ck,
    pend: [],
  };
}

export const setup = (_seats: number[], o: Options) => newState(cfgFrom(o));
export const toAct = (s: State) => (s.over ? [] : [s.turn]);

// ---------------------------------------------------------------- турецкие шашки: поле движка шашек ↔ точки поля

/** Поле движка шашек (ряд 0 — у белых) → точка нашего поля (ряд 0 — сверху). */
export const ckToPt = (sq: number) => (7 - Math.floor(sq / 8)) * 8 + (sq % 8);
export const ptToCk = (p: number) => (7 - Math.floor(p / 8)) * 8 + (p % 8);

/** Ходы шашек, которые начинаются начатым путём. */
function turkMoves(s: State) {
  if (!s.ck) return [];
  const ms = ckLegal(s.ck);
  if (!s.pend.length) return ms;
  const from = ptToCk(s.pend[0]);
  const done = s.pend.slice(1).map(ptToCk);
  return ms.filter((m) => m.from === from && done.every((q, i) => m.path[i] === q));
}

// ---------------------------------------------------------------- ходы

type Jump = { to: number; over: number };

/** Прыжки из p через фишку, подходящую под over, на пустую точку за ней — по связям, которые пропускает ok. */
function jumps(s: State, p: number, ok: (dr: number, dc: number, alt: boolean) => boolean, overOk: (v: number) => boolean): Jump[] {
  const g = G(s);
  const out: Jump[] = [];
  for (const l of g.links[p]) {
    if (!ok(l.dr, l.dc, l.alt) || !overOk(s.board[l.to])) continue;
    const r = g.next(l.to, l.dr, l.dc);
    if (r >= 0 && !s.board[r]) out.push({ to: r, over: l.to });
  }
  return out;
}

function steps(s: State, p: number, ok: (dr: number, dc: number, alt: boolean) => boolean): number[] {
  const out: number[] = [];
  for (const l of G(s).links[p]) if (ok(l.dr, l.dc, l.alt) && !s.board[l.to]) out.push(l.to);
  return out;
}

const empties = (s: State) => s.board.flatMap((v, p) => (v ? [] : [p]));
const mineAt = (s: State, seat: number) => s.board.flatMap((v, p) => (v === me(seat) ? [p] : []));

/** Правила прыжков/шагов по играм: какие связи разрешены месту. */
function stepOk(s: State, seat: number): (dr: number, dc: number, alt: boolean) => boolean {
  const c = s.cfg;
  const f = fwd(seat);
  switch (c.game) {
    case 'sheep':
      // овцы стоят внизу и идут вверх, хотя они — место 1
      return seat === 0 ? () => true : (dr) => dr === -1;
    case 'tickle':
    case 'bolotudu':
      return (_dr, _dc, alt) => !alt;
    case 'quartet':
    case 'sidja':
    case 'mill':
    case 'leopards':
      return () => true;
    case 'fox':
      return seat === 0 ? (dr, _dc, alt) => !alt && (dr === f || dr === 0 || c.geeseBack) : (_dr, _dc, alt) => !alt || c.foxDiag;
    case 'senegal':
    case 'hasami':
      return (dr, _dc, alt) => !alt && (dr === f || dr === 0);
    case 'alquerque':
      return (dr) => dr === f || dr === 0;
    default:
      return () => false;
  }
}

/** Прыжки-взятия месту (лиса, леопарды, сенегальские, алькуерк). */
function captures(s: State, seat: number, p: number): Jump[] {
  const opp = (v: number) => v === me(1 - seat);
  const c = s.cfg;
  switch (c.game) {
    case 'fox':
      return seat === 1 ? jumps(s, p, (_dr, _dc, alt) => !alt || c.foxDiag, opp) : [];
    case 'leopards':
      return seat === 0 ? jumps(s, p, () => true, opp) : [];
    case 'senegal':
      return jumps(s, p, (dr, _dc, alt) => !alt && (dr === fwd(seat) || dr === 0), opp);
    case 'alquerque':
      return jumps(s, p, () => true, opp).filter((j) => j.to !== s.origin);
    default:
      return [];
  }
}

/** Двух выставленных за ход фишек разделяют не меньше двух пустых клеток (по любой линии). */
const farEnough = (g: Geo, a: number, b: number) => Math.max(Math.abs(g.pts[a].r - g.pts[b].r), Math.abs(g.pts[a].c - g.pts[b].c)) >= 3;

function placeTargets(s: State): number[] {
  const g = G(s);
  let free = empties(s);
  if (s.cfg.game === 'sidja') free = free.filter((p) => p !== g.at(2, 2));
  if (s.cfg.game === 'bolotudu' && s.first >= 0) {
    const far = free.filter((p) => farEnough(g, p, s.first));
    if (far.length) free = far;
  }
  return free;
}

/** Есть ли среди ходов ход со снятием (сиджа: зажать). */
function canCapture(s: State, seat: number, moves: Action[]): boolean {
  for (const a of moves) if (a.type === 'move' && clamps(s, seat, a.from, a.to).length) return true;
  return false;
}

/** Сколько ходов у места в фазе ходов — для оценки ботов (без расстановки и пропусков). */
export const moveCount = (s: State, seat: number) => moveActions(s, seat).length;

/** Ходы в фазе ходов (без расстановки, снятий и цепочек). */
function moveActions(s: State, seat: number): Action[] {
  const out: Action[] = [];
  const c = s.cfg;
  const ok = stepOk(s, seat);
  const pcs = mineAt(s, seat);
  if (c.game === 'senegal') {
    for (const p of pcs) for (const j of captures(s, seat, p)) out.push({ type: 'move', from: p, to: j.to });
    if (out.length) return out; // бить обязательно
  }
  const flying = c.game === 'mill' && c.fly && pcs.length === 3;
  for (const p of pcs) {
    if (flying) {
      for (const q of empties(s)) out.push({ type: 'move', from: p, to: q });
      continue;
    }
    for (const q of steps(s, p, ok)) out.push({ type: 'move', from: p, to: q });
    if (c.game === 'mill') for (const j of jumps(s, p, () => true, (v) => v > 0)) out.push({ type: 'move', from: p, to: j.to });
    else if (c.game === 'hasami') for (const j of jumps(s, p, ok, (v) => v === me(1 - seat))) out.push({ type: 'move', from: p, to: j.to });
    else if (c.game !== 'senegal') for (const j of captures(s, seat, p)) out.push({ type: 'move', from: p, to: j.to });
  }
  if (c.game === 'alquerque' && s.ply === 0) {
    const mid = G(s).at(2, 2);
    return out.filter((a) => a.type === 'move' && a.to === mid);
  }
  return out;
}

export function legal(s: State): Action[] {
  if (s.over) return [];
  const seat = s.turn;
  const c = s.cfg;
  if (c.game === 'turk') {
    const ms = turkMoves(s);
    const out: Action[] = [];
    const seen = new Set<number>();
    const k = s.pend.length;
    for (const m of ms) {
      const from = k ? s.pend[k - 1] : ckToPt(m.from);
      const to = ckToPt(m.path[k ? k - 1 : 0]);
      if (seen.has(from * 100 + to)) continue;
      seen.add(from * 100 + to);
      out.push({ type: 'move', from, to });
    }
    return out;
  }
  if (s.take > 0) {
    const set = s.takeSet ?? mineAt(s, 1 - seat);
    return set.filter((p) => s.board[p] === me(1 - seat)).map((at) => ({ type: 'take', at }) as Action);
  }
  if (s.chain >= 0) {
    const out: Action[] = captures(s, seat, s.chain).map((j) => ({ type: 'move', from: s.chain, to: j.to }) as Action);
    out.push({ type: 'stop' });
    return out;
  }
  if (s.hand[seat] > 0) return placeTargets(s).map((to) => ({ type: 'place', to }) as Action);
  // леопарды ходят, пока коровы ещё выставляются; коровы ходят только после расстановки
  const out = moveActions(s, seat);
  if (c.game === 'sidja' && s.passes === 0 && (!out.length || !canCapture(s, seat, out))) out.push({ type: 'pass' });
  if ((c.game === 'senegal' || c.game === 'hasami') && !out.length) out.push({ type: 'pass' });
  return out;
}

// ---------------------------------------------------------------- последствия хода

const DIR8: [number, number][] = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, -1],
  [-1, 1],
];

/** Сиджа и хасами: фишки соперника, зажатые пришедшей на to фишкой (по прямой и по диагонали). */
function clamps(s: State, seat: number, from: number, to: number): number[] {
  const g = G(s);
  const b = s.board;
  const out: number[] = [];
  for (const [dr, dc] of DIR8) {
    const q = g.next(to, dr, dc);
    if (q < 0 || b[q] !== me(1 - seat)) continue;
    const r = g.next(q, dr, dc);
    if (r >= 0 && r !== from && b[r] === me(seat)) out.push(q);
  }
  return out;
}

/** Длина ряда своих фишек через p по направлению (dr, dc) и его клетки. */
function run(s: State, p: number, dr: number, dc: number): number[] {
  const g = G(s);
  const v = s.board[p];
  const cells = [p];
  for (const k of [1, -1]) {
    let q = g.next(p, dr * k, dc * k);
    while (q >= 0 && s.board[q] === v) {
      cells.push(q);
      q = g.next(q, dr * k, dc * k);
    }
  }
  return cells;
}

/** Ряды игры (наборы точек), какие надо собрать: мельница — 20 рядов по 3; так-тикль, квартет, хасами — линии. */
const linesCache = new Map<GameId, number[][]>();
export function lines(game: GameId): number[][] {
  const hit = linesCache.get(game);
  if (hit) return hit;
  const g = geo(BOARD_OF[game]);
  const out: number[][] = [];
  const straight = (k: number, dirs: [number, number][], rows?: [number, number]) => {
    for (const p of g.pts) {
      if (rows && (p.r < rows[0] || p.r > rows[1])) continue;
      for (const [dr, dc] of dirs) {
        const cells: number[] = [];
        for (let i = 0; i < k; i++) {
          const q = g.at(p.r + dr * i, p.c + dc * i);
          if (q < 0 || (rows && (g.pts[q].r < rows[0] || g.pts[q].r > rows[1]))) break;
          cells.push(q);
        }
        if (cells.length === k) out.push(cells);
      }
    }
  };
  if (game === 'tickle') straight(3, [[0, 1], [1, 0], [1, 1], [1, -1]]);
  else if (game === 'quartet') {
    straight(4, [[0, 1], [1, 0], [1, 1], [1, -1]]);
    for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) out.push([g.at(r, c), g.at(r, c + 1), g.at(r + 1, c), g.at(r + 1, c + 1)]);
  } else if (game === 'hasami') straight(5, [[1, 0], [1, 1], [1, -1]], [2, 6]);
  else if (game === 'mill') {
    for (let k = 0; k < 3; k++) {
      const e = 6 - k;
      out.push([g.at(k, k), g.at(k, 3), g.at(k, e)], [g.at(e, k), g.at(e, 3), g.at(e, e)], [g.at(k, k), g.at(3, k), g.at(e, k)], [g.at(k, e), g.at(3, e), g.at(e, e)]);
    }
    out.push([g.at(0, 3), g.at(1, 3), g.at(2, 3)], [g.at(4, 3), g.at(5, 3), g.at(6, 3)], [g.at(3, 0), g.at(3, 1), g.at(3, 2)], [g.at(3, 4), g.at(3, 5), g.at(3, 6)]);
    out.push([g.at(0, 0), g.at(1, 1), g.at(2, 2)], [g.at(0, 6), g.at(1, 5), g.at(2, 4)], [g.at(6, 0), g.at(5, 1), g.at(4, 2)], [g.at(6, 6), g.at(5, 5), g.at(4, 4)]);
  }
  linesCache.set(game, out);
  return out;
}

const lineAt = (s: State, p: number, seat: number) => lines(s.cfg.game).some((l) => l.includes(p) && l.every((q) => s.board[q] === me(seat)));
const hasLine = (s: State, seat: number) => lines(s.cfg.game).some((l) => l.every((q) => s.board[q] === me(seat)));
const millsAt = (s: State, p: number, seat: number) => lines('mill').filter((l) => l.includes(p) && l.every((q) => s.board[q] === me(seat))).length;

/** Волк прорвался: ни одной овцы ниже волка (на одном ряду — тоже не помешают) (овцы ходят только вверх — догнать уже не смогут). */
function wolfThrough(s: State): boolean {
  const g = G(s);
  const w = s.board.indexOf(1);
  if (w < 0) return false;
  return s.board.every((v, p) => v !== 2 || g.pts[p].r <= g.pts[w].r);
}

/** Сенегальские: могут ли ещё встретиться шашки (белые идут вверх, красные вниз). */
function canMeet(s: State): boolean {
  const g = G(s);
  let maxW = -1;
  let minB = 99;
  s.board.forEach((v, p) => {
    if (v === 1) maxW = Math.max(maxW, g.pts[p].r);
    else if (v === 2) minB = Math.min(minB, g.pts[p].r);
  });
  return maxW >= 0 && minB < 99 && maxW >= minB;
}

/** Алькуерк: очки победителя — 2 за победу и по 2 за свои фишки; если соперник заперт — по 1 за каждую его запертую. */
function alqPoints(s: State, winner: number, blocked: boolean): number {
  return 2 + (blocked ? count(s, 1 - winner) : 2 * count(s, winner));
}

const posKey = (s: State) => s.board.join('') + s.turn;

/** Применить ход без проверки. */
export function step(s0: State, a: Action): { state: State; events: Event[] } {
  const s: State = { ...s0, board: s0.board.slice(), hand: [s0.hand[0], s0.hand[1]], caps: [s0.caps[0], s0.caps[1]], lost: [s0.lost[0], s0.lost[1]], last: [] };
  const seat = s0.turn;
  const opp = 1 - seat;
  const c = s.cfg;
  const g = G(s);
  const ev: Event[] = [];
  const end = (winner: number | null, why: EndWhy, points = 0) => {
    s.over = true;
    s.winner = winner;
    s.why = why;
    s.points = points;
    s.take = 0;
    s.chain = -1;
    ev.push({ type: 'end', winner, why, points });
    return { state: s, events: ev };
  };

  if (c.game === 'turk') return turkStep(s, a, ev);

  let jumped = false;
  let pass = false;
  if (a.type === 'pass') {
    s.passes++;
    pass = true;
    ev.push({ type: 'pass', seat });
  } else s.passes = 0;

  if (a.type === 'take') {
    s.board[a.at] = 0;
    s.caps[seat]++;
    s.take--;
    if (s.takeSet) s.takeSet = s.takeSet.filter((p) => p !== a.at);
    s.quiet = 0;
    s.last = [a.at];
    ev.push({ type: 'take', seat, at: a.at });
    if (s.take > 0 && legal(s).length) return { state: s, events: ev };
    s.take = 0;
    s.takeSet = null;
  } else if (a.type === 'place') {
    s.board[a.to] = me(seat);
    s.hand[seat]--;
    s.last = [a.to];
    ev.push({ type: 'place', seat, to: a.to });
    if (c.game === 'mill') {
      const m = millsAt(s, a.to, seat);
      if (m) {
        s.take = Math.min(m, count(s, opp));
        s.takeSet = null;
        if (s.take) return { state: s, events: ev };
      }
    }
    if ((c.game === 'quartet' || c.game === 'tickle') && lineAt(s, a.to, seat)) return end(seat, 'line');
    // по две фишки за ход
    if ((c.game === 'bolotudu' || c.game === 'sidja') && s.first < 0 && s.hand[seat] > 0) {
      s.first = a.to;
      if (legal(s).length) return { state: s, events: ev };
    }
    s.first = -1;
  } else if (a.type === 'stop') {
    // алькуерк: оборвал цепочку, а прыгать ещё было куда — своя фишка снимается
    if (c.game === 'alquerque' && captures(s, seat, s.chain).length) {
      s.board[s.chain] = 0;
      s.lost[seat]++;
      ev.push({ type: 'huff', seat, at: s.chain });
    }
    s.chain = -1;
    s.origin = -1;
  } else if (a.type === 'move') {
    const from = a.from;
    const to = a.to;
    const isJump = !g.links[from].some((l) => l.to === to);
    const over: number[] = [];
    let capsHere: number[] = [];
    const flying = c.game === 'mill' && c.fly && count(s0, seat) === 3 && !g.links[from].some((l) => l.to === to);
    if (isJump && !flying) {
      // прыжок: ищем, через что
      for (const l of g.links[from]) if (g.next(l.to, l.dr, l.dc) === to) over.push(l.to);
    }
    s.board[from] = 0;
    s.board[to] = me(seat);
    s.last = [from, to];
    const eats = over.length > 0 && (c.game === 'fox' || c.game === 'leopards' || c.game === 'senegal' || c.game === 'alquerque');
    if (eats) {
      for (const q of over) {
        s.board[q] = 0;
        s.caps[seat]++;
      }
      capsHere = over.slice();
      jumped = true;
    }
    if (c.game === 'sidja' || c.game === 'hasami') {
      capsHere = clamps(s, seat, from, to);
      for (const q of capsHere) {
        s.board[q] = 0;
        s.caps[seat]++;
      }
    }
    ev.push({ type: 'move', seat, from, to, over, jump: isJump && !flying, caps: capsHere });
    if (capsHere.length) s.quiet = 0;
    else s.quiet++;
    // сенегальские: дошедшая до последнего ряда шашка снимается
    if (c.game === 'senegal' && g.pts[to].r === (seat === 0 ? 0 : 4)) {
      s.board[to] = 0;
      s.lost[seat]++;
      ev.push({ type: 'out', seat, at: to });
    }
    // цепочки прыжков: лиса, леопарды, алькуерк
    if (jumped && (c.game === 'fox' || c.game === 'leopards' || c.game === 'alquerque')) {
      if (s.chain < 0) s.origin = from;
      s.chain = to;
      if (c.game === 'leopards' && s.caps[0] >= 8) return end(0, 'eaten');
      if (c.game === 'fox' && count(s, 0) < 9) return end(1, 'eaten');
      if (captures(s, seat, to).length) {
        s.ply++;
        return { state: s, events: ev };
      }
    }
    s.chain = -1;
    s.origin = -1;
    if (c.game === 'mill') {
      const m = millsAt(s, to, seat);
      if (m) {
        s.take = Math.min(m, count(s, opp));
        s.takeSet = null;
        if (s.take) {
          s.ply++;
          return { state: s, events: ev };
        }
      }
    }
    if (c.game === 'bolotudu') {
      let n = 0;
      const near = new Set<number>();
      for (const [dr, dc] of [
        [0, 1],
        [1, 0],
      ]) {
        const cells = run(s, to, dr, dc);
        if (cells.length < 3) continue;
        n++;
        for (const p of cells) for (const l of g.links[p]) if (s.board[l.to] === me(opp)) near.add(l.to);
      }
      if (n && near.size) {
        s.take = Math.min(n, near.size);
        s.takeSet = [...near];
        s.ply++;
        return { state: s, events: ev };
      }
    }
    if ((c.game === 'tickle' || c.game === 'quartet' || c.game === 'hasami') && hasLine(s, seat)) return end(seat, 'line');
  }
  s.ply++;

  // --- ход переходит
  if (c.game === 'leopards' && s.caps[0] >= 8) return end(0, 'eaten');
  if (c.game === 'fox' && count(s, 0) < 9) return end(1, 'eaten');
  if (c.game === 'sheep' && wolfThrough(s)) return end(0, 'broke');
  if ((c.game === 'mill' || c.game === 'bolotudu') && s.hand[opp] === 0 && count(s, opp) + s.hand[opp] < 3) return end(seat, 'few');
  if ((c.game === 'alquerque' || c.game === 'sidja' || c.game === 'senegal') && count(s, opp) === 0 && s.hand[opp] === 0) {
    return end(seat, 'all', c.game === 'alquerque' ? alqPoints(s, seat, false) : 0);
  }
  if (c.game === 'senegal' && !canMeet(s)) return endByCount(s, ev, 'apart', true);
  if (c.game === 'bolotudu' && s.hand[0] + s.hand[1] === 0) {
    const k = posKey({ ...s, turn: opp });
    s.keys = [...s.keys.slice(-40), k];
    if (s.keys.filter((x) => x === k).length >= 3) return end(null, 'repeat');
  }
  s.turn = opp;
  s.first = -1;
  const next = legal(s);
  const onlyPass = next.length === 1 && next[0].type === 'pass';
  if (!next.length || (onlyPass && (c.game === 'senegal' || c.game === 'hasami') && pass)) {
    // соперник без ходов
    if (c.game === 'senegal') return endByCount(s, ev, 'apart', true);
    if (c.game === 'hasami') return end(null, 'quiet');
    if (c.game === 'sidja') return endByCount(s, ev, 'count', false);
    if (c.game === 'alquerque') return end(seat, 'trapped', alqPoints(s, seat, true));
    return end(seat, 'trapped');
  }
  if (c.game === 'sidja' && s.hand[0] + s.hand[1] === 0 && s.quiet >= 40) return endByCount(s, ev, 'count', false);
  if (c.game === 'senegal' && s.quiet >= QUIET) return endByCount(s, ev, 'count', true);
  if (s.quiet >= QUIET * 2 || s.ply >= LIMIT) return end(null, 'quiet');
  // охотникам (лиса, леопарды) нужно больше времени, чтобы запереть или подловить
  if (s.quiet >= (c.game === 'fox' || c.game === 'leopards' ? 100 : QUIET) && c.game !== 'sidja') return end(null, 'quiet');
  return { state: s, events: ev };

  function endByCount(st: State, evs: Event[], why: EndWhy, onBoard: boolean) {
    // сенегальские — у кого больше шашек на доске; сиджа — кто больше снял
    const a0 = onBoard ? count(st, 0) : st.caps[0];
    const a1 = onBoard ? count(st, 1) : st.caps[1];
    st.over = true;
    st.winner = a0 === a1 ? null : a0 > a1 ? 0 : 1;
    st.why = why;
    st.take = 0;
    evs.push({ type: 'end', winner: st.winner, why, points: 0 });
    return { state: st, events: evs };
  }
}

function turkStep(s: State, a: Action, ev: Event[]): { state: State; events: Event[] } {
  const seat = s.turn;
  let full: { from: number; path: number[] } | null = null;
  if (a.type === 'path') full = { from: a.from, path: a.path };
  else if (a.type === 'move') {
    const pend = s.pend.length ? [...s.pend, a.to] : [a.from, a.to];
    const probe = { ...s, pend };
    const ms = turkMoves(probe);
    const exact = ms.find((m) => m.path.length === pend.length - 1);
    if (exact && ms.every((m) => m.path.length === exact.path.length)) full = { from: exact.from, path: exact.path };
    else if (ms.length === 1 && ms[0].path.length === pend.length - 1) full = { from: ms[0].from, path: ms[0].path };
    else {
      // ход ещё не закончен: шашка стоит на промежуточном поле
      const t: State = { ...s, pend, last: [a.from, a.to] };
      ev.push({ type: 'move', seat, from: a.from, to: a.to, over: [], jump: true, caps: [] });
      return { state: t, events: ev };
    }
  }
  if (!full || !s.ck) return { state: s, events: ev };
  const r = ckApply(s.ck, seat, { type: 'move', from: full.from, path: full.path });
  if (!r) return { state: s, events: ev };
  const ck = r.state;
  const t: State = { ...s, ck, pend: [], ply: s.ply + 1, turn: ck.turn };
  for (const e of r.events) {
    if (e.type === 'move') {
      const m = e.move;
      const pts = [m.from, ...m.path].map(ckToPt);
      // с промежуточного поля — только последний отрезок (первые уже показаны)
      const startAt = a.type === 'move' && s.pend.length ? s.pend.length - 1 : 0;
      const capsPts = m.caps.map(ckToPt);
      t.last = [pts[0], pts[pts.length - 1]];
      ev.push({ type: 'move', seat, from: pts[startAt], to: pts[pts.length - 1], over: [], jump: m.caps.length > 0, caps: capsPts, king: m.promo });
    } else if (e.type === 'end') {
      t.over = true;
      t.winner = e.winner;
      t.why = 'checkers';
      ev.push({ type: 'end', winner: e.winner, why: 'checkers', points: 0 });
    }
  }
  t.caps = [ck.taken[0], ck.taken[1]];
  return { state: t, events: ev };
}

export function apply(s: State, seat: number, a: Action): { state: State; events: Event[] } | null {
  if (s.over || seat !== s.turn || !a || typeof a !== 'object') return null;
  if (a.type === 'path') {
    if (s.cfg.game !== 'turk' || s.pend.length || !s.ck || !Array.isArray(a.path)) return null;
    const ok = ckLegal(s.ck).some((m) => m.from === a.from && m.path.length === a.path.length && m.path.every((q, i) => q === a.path[i]));
    return ok ? step(s, a) : null;
  }
  const ok = legal(s).some((m) => same(m, a));
  return ok ? step(s, a) : null;
}

export function same(m: Action, a: Action): boolean {
  if (m.type !== a.type) return false;
  if (m.type === 'place') return a.type === 'place' && m.to === a.to;
  if (m.type === 'take') return a.type === 'take' && m.at === a.at;
  if (m.type === 'move') return a.type === 'move' && m.from === a.from && m.to === a.to;
  return true;
}

/** Фишки на поле для показа: точка, цвет, дамка. */
export function pieces(s: State): { p: number; seat: number; king: boolean }[] {
  if (s.cfg.game === 'turk' && s.ck) {
    const out: { p: number; seat: number; king: boolean }[] = [];
    const moving = s.pend.length ? ptToCk(s.pend[0]) : -1;
    s.ck.board.forEach((v, sq) => {
      if (!v || sq === moving) return;
      out.push({ p: ckToPt(sq), seat: colorOf(v), king: isKing(v) });
    });
    if (moving >= 0) {
      const v = s.ck.board[moving];
      out.push({ p: s.pend[s.pend.length - 1], seat: colorOf(v), king: isKing(v) });
    }
    return out;
  }
  return s.board.flatMap((v, p) => (v ? [{ p, seat: v - 1, king: false }] : []));
}
