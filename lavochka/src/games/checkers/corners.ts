/* Уголки — правила (без DOM). Доска 8×8, играют все поля. Белые начинают из угла a1, чёрные — из угла h8;
 * цель — первым переставить все свои шашки в дом соперника.
 *
 * Ход — одной шашкой: шаг на соседнее свободное поле или цепочка прыжков через соседние шашки (свои и чужие)
 * на свободное поле за ними; остановиться можно на любом поле цепочки. Классические — только по вертикали и горизонтали,
 * диагональные — во все восемь сторон.
 * Белые ходят первыми, поэтому если они закончили — чёрным дают ещё один ход: успели — ничья.
 * Против запирания (как на игровых серверах): кто после 40-го хода (в диагональных — 30-го) держит шашки в своём доме
 * или вернул туда шашку — проиграл; после 80-го хода проигрывает тот, у кого вне дома соперника шашек больше.
 */
import type { Options } from '../../core/types';

export type Home = '3x3' | '3x4' | 'corner';
export type Moves = 'classic' | 'diagonal';

export interface CCfg {
  variant: 'ugolki';
  home: Home;
  moves: Moves;
}

export function ccfgFrom(o: Options): CCfg {
  const home = String(o.ugHome);
  return {
    variant: 'ugolki',
    home: home === '3x4' || home === 'corner' ? home : '3x3',
    moves: o.ugMoves === 'diagonal' ? 'diagonal' : 'classic',
  };
}

export interface CMove {
  from: number;
  path: number[];
  caps: number[];
  promo: boolean;
}

export type CEndReason = 'home' | 'equal' | 'stayed' | 'returned' | 'eighty' | 'nomoves' | 'resign' | 'agreed' | 'repetition';

export interface CState {
  game: 'corners';
  cfg: CCfg;
  n: 8;
  /** 'w' / 'b' / '' */
  board: string[];
  turn: 0 | 1;
  /** Сколько ходов сделал каждый. */
  made: [number, number];
  moves: { text: string; seat: number }[];
  last: { from: number; path: number[]; caps: number[] } | null;
  keys: string[];
  /** Белые уже собрали все шашки в доме соперника — у чёрных последний ход. */
  whiteDone: boolean;
  phase: 'play' | 'draw' | 'over';
  offer: number;
  winner: number | null;
  reason: CEndReason | null;
  /** Для общей отрисовки с шашками. */
  fuk: number[];
}

export type CAction =
  | { type: 'move'; from: number; path: number[] }
  | { type: 'resign' }
  | { type: 'offer' }
  | { type: 'accept' }
  | { type: 'decline' };

export type CEvent =
  | { type: 'move'; seat: number; move: CMove; text: string; num: number; missed: false }
  | { type: 'offer'; seat: number }
  | { type: 'decline'; seat: number }
  | { type: 'end'; winner: number | null; reason: CEndReason };

const N = 8;
const ORTHO = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];
const DIAG = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** Сколько ходов дают на то, чтобы вывести шашки из дома. */
export const leaveBy = (cfg: CCfg) => (cfg.moves === 'diagonal' ? 30 : 40);
export const FINAL_MOVE = 80;

/** Поля дома белых (угол a1); дом чёрных — зеркально (угол h8). */
export function homeOf(cfg: CCfg, c: number): number[] {
  const out: number[] = [];
  for (let r = 0; r < N; r++)
    for (let f = 0; f < N; f++) {
      let inside: boolean;
      if (cfg.home === '3x3') inside = r < 3 && f < 3;
      else if (cfg.home === '3x4') inside = r < 3 && f < 4;
      else inside = r + f < 4; // углом: 4 + 3 + 2 + 1
      if (inside) out.push(c === 0 ? r * N + f : (N - 1 - r) * N + (N - 1 - f));
    }
  return out;
}

const sqName = (sq: number) => 'abcdefgh'[sq % N] + (Math.floor(sq / N) + 1);

export function cNewGame(cfg: CCfg): CState {
  const board = Array<string>(N * N).fill('');
  for (const sq of homeOf(cfg, 0)) board[sq] = 'w';
  for (const sq of homeOf(cfg, 1)) board[sq] = 'b';
  return cFromBoard(cfg, board, 0);
}

export function cFromBoard(cfg: CCfg, board: string[], turn: 0 | 1): CState {
  const s: CState = {
    game: 'corners',
    cfg,
    n: 8,
    board,
    turn,
    made: [0, 0],
    moves: [],
    last: null,
    keys: [],
    whiteDone: false,
    phase: 'play',
    offer: -1,
    winner: null,
    reason: null,
    fuk: [],
  };
  s.keys = [cKey(s)];
  return s;
}

const cKey = (s: Pick<CState, 'board' | 'turn'>) => s.board.map((p) => p || '.').join('') + s.turn;

function stepTo(sq: number, dr: number, df: number): number {
  const r = Math.floor(sq / N) + dr;
  const f = (sq % N) + df;
  return r < 0 || r >= N || f < 0 || f >= N ? -1 : r * N + f;
}

/** Все ходы стороны: шаги и прыжки (каждое конечное поле — один раз, путь — кратчайшая цепочка). */
export function cMoves(s: Pick<CState, 'board' | 'turn' | 'cfg'>): CMove[] {
  const dirs = s.cfg.moves === 'diagonal' ? [...ORTHO, ...DIAG] : ORTHO;
  const me = s.turn === 0 ? 'w' : 'b';
  const out: CMove[] = [];
  for (let from = 0; from < N * N; from++) {
    if (s.board[from] !== me) continue;
    const seen = new Set<number>([from]);
    for (const [dr, df] of dirs) {
      const t = stepTo(from, dr, df);
      if (t >= 0 && !s.board[t] && !seen.has(t)) {
        seen.add(t);
        out.push({ from, path: [t], caps: [], promo: false });
      }
    }
    // прыжки — поиском в ширину; поле, с которого ушли, на время хода свободно
    const queue: { sq: number; path: number[] }[] = [{ sq: from, path: [] }];
    const jumped = new Set<number>([from]);
    while (queue.length) {
      const { sq, path } = queue.shift()!;
      for (const [dr, df] of dirs) {
        const mid = stepTo(sq, dr, df);
        if (mid < 0 || !s.board[mid] || mid === from) continue;
        const land = stepTo(mid, dr, df);
        if (land < 0 || (s.board[land] && land !== from) || jumped.has(land)) continue;
        jumped.add(land);
        const p = [...path, land];
        queue.push({ sq: land, path: p });
        if (land !== from && !seen.has(land)) {
          seen.add(land);
          out.push({ from, path: p, caps: [], promo: false });
        }
      }
    }
  }
  return out;
}

export const cToAct = (s: CState): number[] => (s.phase === 'over' ? [] : s.phase === 'draw' ? [1 - s.offer] : [s.turn]);

/** Сколько шашек стороны c уже в доме соперника. */
export const arrived = (s: Pick<CState, 'board' | 'cfg'>, c: number) => homeOf(s.cfg, 1 - c).filter((sq) => s.board[sq] === (c === 0 ? 'w' : 'b')).length;
const atHome = (s: Pick<CState, 'board' | 'cfg'>, c: number) => homeOf(s.cfg, c).filter((sq) => s.board[sq] === (c === 0 ? 'w' : 'b')).length;
export const pieceCount = (cfg: CCfg) => homeOf(cfg, 0).length;

function finish(s: CState, winner: number | null, reason: CEndReason, ev: CEvent[]) {
  s.phase = 'over';
  s.winner = winner;
  s.reason = reason;
  ev.push({ type: 'end', winner, reason });
}

export function cPlay(s: CState, m: CMove): CState {
  const b = s.board.slice();
  const to = m.path[m.path.length - 1];
  b[to] = b[m.from];
  b[m.from] = '';
  const made = [...s.made] as [number, number];
  made[s.turn]++;
  return { ...s, board: b, made, turn: (1 - s.turn) as 0 | 1, last: { from: m.from, path: m.path, caps: [] } };
}

export function cApply(s0: CState, seat: number, a: CAction): { state: CState; events: CEvent[] } | null {
  if (!cToAct(s0).includes(seat) || !a || typeof a !== 'object') return null;
  const ev: CEvent[] = [];
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
  if (a.type === 'resign') {
    const s = { ...s0 };
    finish(s, 1 - seat, 'resign', ev);
    return { state: s, events: ev };
  }
  if (a.type === 'offer') {
    if (s0.moves.length < 2) return null;
    ev.push({ type: 'offer', seat });
    return { state: { ...s0, phase: 'draw', offer: seat }, events: ev };
  }
  if (a.type !== 'move' || !Array.isArray(a.path)) return null;
  const m = cMoves(s0).find((x) => x.from === a.from && x.path.length === a.path.length && x.path.every((v, i) => v === a.path[i]));
  if (!m) return null;
  const near = Math.max(Math.abs((m.path[0] % N) - (m.from % N)), Math.abs(Math.floor(m.path[0] / N) - Math.floor(m.from / N))) === 1;
  const text = [m.from, ...m.path].map(sqName).join(near ? '-' : ':');
  const s = cPlay(s0, m);
  s.moves = [...s0.moves, { text, seat }];
  s.offer = -1;
  ev.push({ type: 'move', seat, move: m, text, num: s0.made[0] + (seat === 0 ? 1 : 0), missed: false });
  const key = cKey(s);
  s.keys = [...s0.keys, key];
  const total = pieceCount(s.cfg);
  const lim = leaveBy(s.cfg);
  const n = s.made[seat];
  const to = m.path[m.path.length - 1];
  const done = arrived(s, seat) === total;
  if (seat === 1 && s.whiteDone) {
    // ответный ход чёрных после того, как белые закончили
    finish(s, done ? null : 0, done ? 'equal' : 'home', ev);
  } else if (done) {
    if (seat === 0) s.whiteDone = true;
    else finish(s, 1, 'home', ev);
  } else if (n > lim && homeOf(s.cfg, seat).includes(to)) finish(s, 1 - seat, 'returned', ev);
  else if (n >= lim && atHome(s, seat) > 0) finish(s, 1 - seat, 'stayed', ev);
  else if (seat === 1 && s.made[1] >= FINAL_MOVE) {
    const out0 = total - arrived(s, 0);
    const out1 = total - arrived(s, 1);
    finish(s, out0 === out1 ? null : out0 > out1 ? 1 : 0, 'eighty', ev);
  } else if (s.keys.filter((k) => k === key).length >= 3) finish(s, null, 'repetition', ev);
  if (s.phase === 'play' && !s.whiteDone && !cMoves(s).length) finish(s, 1 - s.turn, 'nomoves', ev);
  if (s.phase === 'play' && s.whiteDone && !cMoves(s).length) finish(s, 0, 'home', ev);
  return { state: s, events: ev };
}
