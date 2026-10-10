/* Шахматы — правила (без DOM): классические и Фишер 960, часы с добавлением, ничья по согласию, сдача.
 *
 * Доска — 64 клетки, индекс = горизонталь * 8 + вертикаль (a1 = 0, h1 = 7, a8 = 56).
 * Фигуры — буквы FEN: PNBRQK — белые, pnbrqk — чёрные, '' — пусто. Место 0 — белые, 1 — чёрные.
 * Рокировка хранится как вертикаль ладьи (так же работает и в Фишере 960): король встаёт на g/c, ладья — на f/d.
 */
import type { Options, Rng } from '../../core/types';

export type Variant = 'classic' | '960';
export type Promo = 'Q' | 'R' | 'B' | 'N';

export interface Cfg {
  variant: Variant;
  /** Часы: минут на партию каждому (0 — без часов). */
  clock: number;
  /** Добавление за ход, секунд. */
  inc: number;
}

export const DEFAULT_CFG: Cfg = { variant: 'classic', clock: 0, inc: 0 };

export function cfgFrom(o: Options): Cfg {
  return {
    variant: o.variant === '960' ? '960' : 'classic',
    clock: Math.max(0, Math.min(180, Number(o.clock) || 0)),
    inc: Math.max(0, Math.min(60, Number(o.inc) || 0)),
  };
}

export interface Castle {
  /** Вертикаль ладьи, с которой ещё можно рокироваться, или -1. */
  wK: number;
  wQ: number;
  bK: number;
  bQ: number;
}

export interface Move {
  from: number;
  to: number;
  piece: string;
  captured: string;
  promo?: Promo;
  ep?: boolean;
  /** Рокировка: 'K' — короткая, 'Q' — длинная; to — куда встаёт король, rook — откуда ладья. */
  castle?: 'K' | 'Q';
  rook?: number;
}

export interface MoveRec {
  san: string;
  from: number;
  to: number;
  seat: number;
}

export type EndReason = 'mate' | 'stalemate' | 'resign' | 'time' | 'repetition' | 'fifty' | 'material' | 'agreed';

export interface State {
  cfg: Cfg;
  board: string[];
  turn: 0 | 1;
  castle: Castle;
  /** Клетка, через которую только что прошла пешка (для взятия на проходе), или -1. */
  ep: number;
  /** Полуходы без взятий и ходов пешкой (правило 50 ходов). */
  half: number;
  /** Номер хода. */
  full: number;
  /** Ключи позиций — для троекратного повторения. */
  keys: string[];
  moves: MoveRec[];
  last: { from: number; to: number } | null;
  phase: 'play' | 'draw' | 'over';
  /** Кто предложил ничью (phase = 'draw'). */
  offer: number;
  winner: number | null;
  reason: EndReason | null;
  /** Оставшееся время, мс, и когда начался текущий ход (время хозяина партии). */
  clock: [number, number];
  turnStart: number;
  /** Кто что взял: captured[0] — фигуры, взятые белыми. */
  captured: [string[], string[]];
  /** Номер начальной позиции Фишера (518 — классическая). */
  sp: number;
}

export type Action =
  | { type: 'move'; from: number; to: number; promo?: Promo }
  | { type: 'resign' }
  | { type: 'offer' }
  | { type: 'accept' }
  | { type: 'decline' }
  | { type: 'flag' };

export type Event =
  | { type: 'start'; sp: number; variant: Variant }
  | { type: 'move'; seat: number; move: Move; san: string; check: boolean; num: number }
  | { type: 'offer'; seat: number }
  | { type: 'decline'; seat: number }
  | { type: 'end'; winner: number | null; reason: EndReason };

// ---------------------------------------------------------------- клетки

export const fileOf = (sq: number) => sq & 7;
export const rankOf = (sq: number) => sq >> 3;
export const sqName = (sq: number) => 'abcdefgh'[fileOf(sq)] + (rankOf(sq) + 1);
export const colorOf = (p: string): 0 | 1 => (p === p.toUpperCase() ? 0 : 1);
const own = (p: string, c: number) => p !== '' && colorOf(p) === c;
const kindOf = (p: string) => p.toUpperCase();
const side = (c: number, k: string) => (c === 0 ? k : k.toLowerCase());

const KNIGHT = [
  [1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2],
];
const KING = [
  [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
];
const ROOK_D = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
];
const BISHOP_D = [
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

function step(sq: number, df: number, dr: number): number {
  const f = fileOf(sq) + df;
  const r = rankOf(sq) + dr;
  return f < 0 || f > 7 || r < 0 || r > 7 ? -1 : r * 8 + f;
}

/** Бьёт ли сторона by клетку sq. */
export function attacked(board: string[], sq: number, by: number): boolean {
  const dir = by === 0 ? 1 : -1;
  // пешки: бьют по диагонали вперёд, значит стоят на шаг «назад» от клетки
  for (const df of [-1, 1]) {
    const s = step(sq, df, -dir);
    if (s >= 0 && board[s] === side(by, 'P')) return true;
  }
  for (const [df, dr] of KNIGHT) {
    const s = step(sq, df, dr);
    if (s >= 0 && board[s] === side(by, 'N')) return true;
  }
  for (const [df, dr] of KING) {
    const s = step(sq, df, dr);
    if (s >= 0 && board[s] === side(by, 'K')) return true;
  }
  for (const [dirs, kinds] of [
    [ROOK_D, 'RQ'],
    [BISHOP_D, 'BQ'],
  ] as const) {
    for (const [df, dr] of dirs) {
      let s = step(sq, df, dr);
      while (s >= 0) {
        const p = board[s];
        if (p) {
          if (colorOf(p) === by && kinds.includes(kindOf(p))) return true;
          break;
        }
        s = step(s, df, dr);
      }
    }
  }
  return false;
}

export function kingSq(board: string[], c: number): number {
  return board.indexOf(side(c, 'K'));
}

export const inCheck = (s: Pick<State, 'board' | 'turn'>, c: number = s.turn) => attacked(s.board, kingSq(s.board, c), 1 - c);

// ---------------------------------------------------------------- ходы

function pseudo(s: State, c: number, out: Move[], capturesOnly = false) {
  const b = s.board;
  const dir = c === 0 ? 1 : -1;
  const startRank = c === 0 ? 1 : 6;
  const lastRank = c === 0 ? 7 : 0;
  for (let sq = 0; sq < 64; sq++) {
    const p = b[sq];
    if (!own(p, c)) continue;
    const k = kindOf(p);
    if (k === 'P') {
      const push = (to: number, captured: string, ep = false) => {
        if (rankOf(to) === lastRank) for (const promo of ['Q', 'R', 'B', 'N'] as Promo[]) out.push({ from: sq, to, piece: p, captured, promo });
        else out.push({ from: sq, to, piece: p, captured, ep });
      };
      const one = step(sq, 0, dir);
      if (one >= 0 && !b[one] && (!capturesOnly || rankOf(one) === lastRank)) {
        push(one, '');
        const two = step(sq, 0, 2 * dir);
        if (rankOf(sq) === startRank && !b[two] && !capturesOnly) out.push({ from: sq, to: two, piece: p, captured: '' });
      }
      for (const df of [-1, 1]) {
        const t = step(sq, df, dir);
        if (t < 0) continue;
        if (b[t] && colorOf(b[t]) !== c) push(t, b[t]);
        else if (t === s.ep) push(t, side(1 - c, 'P'), true);
      }
      continue;
    }
    if (k === 'N' || k === 'K') {
      for (const [df, dr] of k === 'N' ? KNIGHT : KING) {
        const t = step(sq, df, dr);
        if (t < 0 || own(b[t], c) || (capturesOnly && !b[t])) continue;
        out.push({ from: sq, to: t, piece: p, captured: b[t] });
      }
      continue;
    }
    const dirs = k === 'R' ? ROOK_D : k === 'B' ? BISHOP_D : [...ROOK_D, ...BISHOP_D];
    for (const [df, dr] of dirs) {
      let t = step(sq, df, dr);
      while (t >= 0) {
        if (own(b[t], c)) break;
        if (!capturesOnly || b[t]) out.push({ from: sq, to: t, piece: p, captured: b[t] });
        if (b[t]) break;
        t = step(t, df, dr);
      }
    }
  }
}

/** Рокировки (общие правила, годятся и для Фишера 960). */
function castles(s: State, c: number, out: Move[]) {
  const b = s.board;
  const rank = c === 0 ? 0 : 7;
  const ksq = kingSq(b, c);
  if (ksq < 0 || rankOf(ksq) !== rank) return;
  if (attacked(b, ksq, 1 - c)) return;
  const rights: ['K' | 'Q', number][] = c === 0 ? [['K', s.castle.wK], ['Q', s.castle.wQ]] : [['K', s.castle.bK], ['Q', s.castle.bQ]];
  for (const [kind, rf] of rights) {
    if (rf < 0) continue;
    const rsq = rank * 8 + rf;
    if (b[rsq] !== side(c, 'R')) continue;
    const kt = rank * 8 + (kind === 'K' ? 6 : 2);
    const rt = rank * 8 + (kind === 'K' ? 5 : 3);
    const lo = Math.min(ksq, kt, rsq, rt);
    const hi = Math.max(ksq, kt, rsq, rt);
    let ok = true;
    for (let x = lo; x <= hi && ok; x++) if (x !== ksq && x !== rsq && b[x]) ok = false;
    if (!ok) continue;
    // король не проходит через битые поля (включая конечное); короля и ладью с их мест убираем —
    // в Фишере 960 ладья может заслонять короля от чужой ладьи на той же горизонтали
    const tmp = b.slice();
    tmp[ksq] = '';
    tmp[rsq] = '';
    const kd = kt >= ksq ? 1 : -1;
    for (let x = ksq; ok; x += kd) {
      if (attacked(tmp, x, 1 - c)) ok = false;
      if (x === kt) break;
    }
    if (!ok) continue;
    out.push({ from: ksq, to: kt, piece: b[ksq], captured: '', castle: kind, rook: rsq });
  }
}

/** Сделать ход на копии доски (без проверок). */
export function play(s: State, m: Move): State {
  const b = s.board.slice();
  const c = colorOf(m.piece);
  const castle = { ...s.castle };
  if (m.castle) {
    const rank = c === 0 ? 0 : 7;
    b[m.from] = '';
    b[m.rook!] = '';
    b[m.to] = m.piece;
    b[rank * 8 + (m.castle === 'K' ? 5 : 3)] = side(c, 'R');
  } else {
    b[m.from] = '';
    if (m.ep) b[m.to - (c === 0 ? 8 : -8)] = '';
    b[m.to] = m.promo ? side(c, m.promo) : m.piece;
  }
  // права на рокировку
  if (kindOf(m.piece) === 'K') {
    if (c === 0) castle.wK = castle.wQ = -1;
    else castle.bK = castle.bQ = -1;
  }
  const lose = (sq: number) => {
    if (sq === 0 * 8 + castle.wK) castle.wK = -1;
    if (sq === 0 * 8 + castle.wQ) castle.wQ = -1;
    if (sq === 7 * 8 + castle.bK) castle.bK = -1;
    if (sq === 7 * 8 + castle.bQ) castle.bQ = -1;
  };
  if (!m.castle) {
    lose(m.from);
    lose(m.to);
  }
  const pawn = kindOf(m.piece) === 'P';
  const ep = pawn && Math.abs(m.to - m.from) === 16 ? (m.from + m.to) / 2 : -1;
  return {
    ...s,
    board: b,
    castle,
    ep,
    half: pawn || m.captured ? 0 : s.half + 1,
    full: s.full + (c === 1 ? 1 : 0),
    turn: (1 - s.turn) as 0 | 1,
    last: { from: m.from, to: m.to },
  };
}

/** Ходы без проверки, не остаётся ли король под шахом (рокировки — уже законные). Для перебора у ботов. */
export function pseudoMoves(s: State): Move[] {
  const out: Move[] = [];
  pseudo(s, s.turn, out);
  castles(s, s.turn, out);
  return out;
}

/** Только взятия и превращения (без проверки шаха) — для досчёта разменов у ботов. */
export function pseudoCaptures(s: State): Move[] {
  const out: Move[] = [];
  pseudo(s, s.turn, out, true);
  return out;
}

/** Все законные ходы стороны, которая ходит. */
export function legalMoves(s: State): Move[] {
  const c = s.turn;
  const out: Move[] = [];
  pseudo(s, c, out);
  castles(s, c, out);
  return out.filter((m) => {
    if (m.castle) return true; // поля короля уже проверены
    const n = play(s, m);
    return !attacked(n.board, kingSq(n.board, c), 1 - c);
  });
}

// ---------------------------------------------------------------- начальная позиция

/** Расстановка последней горизонтали Фишера 960 по номеру (Шарнагль). 518 — классическая. */
export function backRank(n: number): string[] {
  const r: string[] = new Array(8).fill('');
  const free = () => r.map((p, i) => (p ? -1 : i)).filter((i) => i >= 0);
  let x = n;
  const b1 = x % 4;
  x = Math.floor(x / 4);
  r[b1 * 2 + 1] = 'B';
  const b2 = x % 4;
  x = Math.floor(x / 4);
  r[b2 * 2] = 'B';
  const q = x % 6;
  x = Math.floor(x / 6);
  r[free()[q]] = 'Q';
  const KN = [
    [0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4],
  ][x];
  const f = free();
  r[f[KN[0]]] = 'N';
  r[f[KN[1]]] = 'N';
  const rest = free();
  r[rest[0]] = 'R';
  r[rest[1]] = 'K';
  r[rest[2]] = 'R';
  return r;
}

export function newGame(cfg: Cfg, sp = 518, now = 0): State {
  const back = backRank(sp);
  const board: string[] = new Array(64).fill('');
  for (let f = 0; f < 8; f++) {
    board[f] = back[f];
    board[8 + f] = 'P';
    board[48 + f] = 'p';
    board[56 + f] = back[f].toLowerCase();
  }
  const rooks = back.map((p, i) => (p === 'R' ? i : -1)).filter((i) => i >= 0);
  const s: State = {
    cfg,
    board,
    turn: 0,
    castle: { wK: rooks[1], wQ: rooks[0], bK: rooks[1], bQ: rooks[0] },
    ep: -1,
    half: 0,
    full: 1,
    keys: [],
    moves: [],
    last: null,
    phase: 'play',
    offer: -1,
    winner: null,
    reason: null,
    clock: [cfg.clock * 60000, cfg.clock * 60000],
    turnStart: now,
    captured: [[], []],
    sp,
  };
  s.keys = [posKey(s)];
  return s;
}

/** Клетка по имени: sq('e4'). */
export const sq = (name: string) => 'abcdefgh'.indexOf(name[0]) + (Number(name[1]) - 1) * 8;

/** Позиция из FEN (для показа правил и тестов). Рокировка — буквами KQkq. */
export function fromFen(fen: string, cfg: Cfg = DEFAULT_CFG): State {
  const [place, turn, cast = '-', ep = '-', half = '0', full = '1'] = fen.trim().split(/\s+/);
  const s = newGame(cfg);
  s.board = new Array(64).fill('');
  place.split('/').forEach((row, i) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) f += Number(ch);
      else s.board[(7 - i) * 8 + f++] = ch;
    }
  });
  s.turn = turn === 'b' ? 1 : 0;
  s.castle = {
    wK: cast.includes('K') ? 7 : -1,
    wQ: cast.includes('Q') ? 0 : -1,
    bK: cast.includes('k') ? 7 : -1,
    bQ: cast.includes('q') ? 0 : -1,
  };
  s.ep = ep === '-' ? -1 : 'abcdefgh'.indexOf(ep[0]) + (Number(ep[1]) - 1) * 8;
  s.half = Number(half) || 0;
  s.full = Number(full) || 1;
  s.keys = [posKey(s)];
  return s;
}

export function setup(_seats: number[], opts: Options, rng: Rng, now = Date.now()): State {
  const cfg = cfgFrom(opts);
  return newGame(cfg, cfg.variant === '960' ? rng.int(960) : 518, now);
}

export function posKey(s: State): string {
  const c = s.castle;
  return s.board.map((p) => p || '.').join('') + s.turn + [c.wK, c.wQ, c.bK, c.bQ].join(',') + s.ep;
}

// ---------------------------------------------------------------- запись ходов

const RU: Record<string, string> = { K: 'Кр', Q: 'Ф', R: 'Л', B: 'С', N: 'К', P: '' };

export function san(s: State, m: Move, all: Move[] = legalMoves(s)): string {
  if (m.castle) return m.castle === 'K' ? '0-0' : '0-0-0';
  const k = kindOf(m.piece);
  let t = RU[k];
  if (k === 'P') {
    if (m.captured) t += 'abcdefgh'[fileOf(m.from)];
  } else {
    const same = all.filter((x) => x !== m && x.piece === m.piece && x.to === m.to && x.from !== m.from && !x.castle);
    if (same.length) {
      if (!same.some((x) => fileOf(x.from) === fileOf(m.from))) t += 'abcdefgh'[fileOf(m.from)];
      else if (!same.some((x) => rankOf(x.from) === rankOf(m.from))) t += String(rankOf(m.from) + 1);
      else t += sqName(m.from);
    }
  }
  if (m.captured) t += ':';
  t += sqName(m.to);
  if (m.promo) t += RU[m.promo];
  if (m.ep) t += ' e.p.';
  return t;
}

// ---------------------------------------------------------------- партия

/** Хватает ли материала, чтобы поставить мат хоть кому-то. */
export function insufficient(board: string[]): boolean {
  const pieces = board.filter((p) => p && kindOf(p) !== 'K');
  if (!pieces.length) return true;
  if (pieces.some((p) => 'PRQ'.includes(kindOf(p)))) return false;
  if (pieces.length === 1) return true; // король и лёгкая фигура против короля
  // только слоны, и все на полях одного цвета
  if (pieces.every((p) => kindOf(p) === 'B')) {
    const colors = new Set(board.map((p, i) => (p && kindOf(p) === 'B' ? (fileOf(i) + rankOf(i)) % 2 : -1)).filter((x) => x >= 0));
    return colors.size === 1;
  }
  return false;
}

/** Хватит ли стороне c материала на мат (для проигрыша по времени). */
function canMate(board: string[], c: number): boolean {
  const mine = board.filter((p) => own(p, c) && kindOf(p) !== 'K');
  if (mine.some((p) => 'PRQ'.includes(kindOf(p)))) return true;
  return mine.length >= 2;
}

export function toAct(s: State): number[] {
  if (s.phase === 'over') return [];
  if (s.phase === 'draw') return [1 - s.offer];
  return [s.turn];
}

function finish(s: State, winner: number | null, reason: EndReason, ev: Event[]) {
  s.phase = 'over';
  s.winner = winner;
  s.reason = reason;
  ev.push({ type: 'end', winner, reason });
}

/** Сколько времени ушло на ход: если между ходами больше получаса — партию, видимо, отложили и вернулись. */
function spent(s: State, now: number) {
  const e = now - s.turnStart;
  return e < 0 || e > 30 * 60000 ? 0 : e;
}

export function apply(s0: State, seat: number, a: Action, now: number = Date.now()): { state: State; events: Event[] } | null {
  if (!toAct(s0).includes(seat) || !a || typeof a !== 'object') return null;
  const ev: Event[] = [];
  const timed = s0.cfg.clock > 0;
  if (s0.phase === 'draw') {
    if (a.type === 'accept') {
      const s = { ...s0 };
      finish(s, null, 'agreed', ev);
      return { state: s, events: ev };
    }
    if (a.type === 'decline') {
      ev.push({ type: 'decline', seat });
      return { state: { ...s0, phase: 'play', offer: -1 }, events: ev };
    }
    return null;
  }
  switch (a.type) {
    case 'resign': {
      const s = { ...s0 };
      finish(s, 1 - seat, 'resign', ev);
      return { state: s, events: ev };
    }
    case 'offer': {
      if (s0.moves.length < 2) return null;
      ev.push({ type: 'offer', seat });
      return { state: { ...s0, phase: 'draw', offer: seat }, events: ev };
    }
    case 'flag': {
      if (!timed || spent(s0, now) < s0.clock[seat]) return null;
      const s = { ...s0, clock: [...s0.clock] as [number, number] };
      s.clock[seat] = 0;
      finish(s, canMate(s.board, 1 - seat) ? 1 - seat : null, 'time', ev);
      return { state: s, events: ev };
    }
    case 'move': {
      const all = legalMoves(s0);
      const m =
        all.find((x) => x.from === a.from && x.to === a.to && (!x.promo || x.promo === (a.promo || 'Q'))) ??
        all.find((x) => x.castle && x.from === a.from && x.rook === a.to);
      if (!m) return null;
      const clock = [...s0.clock] as [number, number];
      if (timed) {
        clock[seat] -= spent(s0, now);
        if (clock[seat] <= 0) {
          const s = { ...s0, clock };
          clock[seat] = 0;
          finish(s, canMate(s.board, 1 - seat) ? 1 - seat : null, 'time', ev);
          return { state: s, events: ev };
        }
        clock[seat] += s0.cfg.inc * 1000;
      }
      const name = san(s0, m, all);
      const s = play(s0, m);
      s.clock = clock;
      s.turnStart = now;
      s.offer = -1;
      s.captured = [s0.captured[0].slice(), s0.captured[1].slice()];
      if (m.captured) s.captured[seat].push(m.captured);
      const check = inCheck(s);
      const replies = legalMoves(s);
      const mate = check && !replies.length;
      const rec = name + (mate ? '#' : check ? '+' : '');
      s.moves = [...s0.moves, { san: rec, from: m.from, to: m.to, seat }];
      const key = posKey(s);
      s.keys = s.half === 0 ? [key] : [...s0.keys, key];
      ev.push({ type: 'move', seat, move: m, san: rec, check, num: s0.full });
      if (mate) finish(s, seat, 'mate', ev);
      else if (!replies.length) finish(s, null, 'stalemate', ev);
      else if (insufficient(s.board)) finish(s, null, 'material', ev);
      else if (s.keys.filter((k) => k === key).length >= 3) finish(s, null, 'repetition', ev);
      else if (s.half >= 100) finish(s, null, 'fifty', ev);
      return { state: s, events: ev };
    }
    default:
      return null;
  }
}
