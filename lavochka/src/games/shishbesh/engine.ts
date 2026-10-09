/* Шиш-беш — правила (чистая логика, без DOM).
 *
 * Позиция фишки p хранится относительно её владельца:
 *   -1        — в парке (вне поля)
 *    0        — на стартовом поле (выступ в конце своего луча, вне круга)
 *    1..48    — на круге (1 — первая клетка своей дорожки, 48 — торец своего луча)
 *   49..52    — в домике (4 клетки своего цвета)
 * Глобальная клетка круга: g = (p - 1 + 12*seat) % 48.
 * Четверть круга — 12 клеток: 0..4 к центру, 5 — угол креста, 6..10 от центра по соседнему лучу, 11 — торец соседнего луча.
 * У клеток 2 и 8 каждой четверти (3-е поле с края луча) есть «домик»-укрытие на одну фишку.
 */
import type { Rng } from '../../core/types';

export const LOOP = 48;
export const LOOP_END = 48;
export const HOME_START = 49;
export const HOME_END = 52;
export const PIECES = 4;

export interface Player {
  seat: number;
  pieces: number[];
  house: boolean[];
}

export interface State {
  players: Player[];
  /** Индекс в players того, чей ход. */
  cur: number;
  phase: 'roll' | 'move' | 'over';
  dice: [number, number];
  used: [boolean, boolean];
  bonus: boolean;
  winner: number | null;
  turn: number;
}

export type Action = { type: 'roll' } | { type: 'move'; piece: number; die: number; to: number };

export type MoveKind = 'enter' | 'step' | 'home' | 'jump';

export interface Move {
  piece: number;
  die: number;
  value: number;
  from: number;
  to: number;
  kind: MoveKind;
}

export interface TurnEnd {
  again: boolean;
  reason: 'double' | 'capture' | 'both' | null;
  next: number;
}

export type Event =
  | { type: 'roll'; seat: number; dice: [number, number]; noMoves?: boolean; turnEnd?: TurnEnd }
  | {
      type: 'move';
      seat: number;
      piece: number;
      from: number;
      to: number;
      kind: MoveKind;
      value: number;
      path: number[];
      captured: { seat: number; piece: number; from: number }[];
      house: boolean;
      win?: boolean;
      forfeit?: boolean;
      turnEnd?: TurnEnd;
    };

export const clone = (o: State): State => JSON.parse(JSON.stringify(o));
export const onLoop = (p: number) => p >= 1 && p <= LOOP_END;
export const isCorner = (p: number) => onLoop(p) && (p - 1) % 12 === 5;
export const toGlobal = (seat: number, p: number) => (p - 1 + 12 * seat) % LOOP;
export const isHouseG = (g: number) => g % 12 === 2 || g % 12 === 8;
export const wrap = (p: number, delta: number) => ((((p - 1 + delta) % LOOP) + LOOP) % LOOP) + 1;
export const playerBySeat = (s: State, seat: number) => s.players.find((p) => p.seat === seat);

/** Все фишки, стоящие на глобальной клетке g. */
export function piecesAt(s: State, g: number) {
  const out: { pi: number; k: number; house: boolean }[] = [];
  s.players.forEach((pl, pi) => {
    pl.pieces.forEach((p, k) => {
      if (onLoop(p) && toGlobal(pl.seat, p) === g) out.push({ pi, k, house: !!pl.house[k] });
    });
  });
  return out;
}

/** Фишка сидит в домике-укрытии, а на его клетке стоит другая фишка — выйти нельзя. */
export function isBlocked(s: State, pi: number, k: number) {
  const pl = s.players[pi];
  if (!pl.house[k]) return false;
  const g = toGlobal(pl.seat, pl.pieces[k]);
  return piecesAt(s, g).some((o) => !o.house);
}

/** Можно ли фишке игрока pi встать на клетку круга t (позиция владельца). */
function canLand(s: State, pi: number, k: number, t: number) {
  const pl = s.players[pi];
  const g = toGlobal(pl.seat, t);
  const here = piecesAt(s, g).filter((o) => !(o.pi === pi && o.k === k));
  if (isHouseG(g) && !here.some((o) => o.house)) return true; // свободный домик
  return !here.some((o) => o.pi === pi && !o.house); // на клетке своя фишка — нельзя
}

/** Куда может пойти фишка k игрока pi значением кубика d. */
export function pieceTargets(s: State, pi: number, k: number, d: number) {
  const pieces = s.players[pi].pieces;
  const p = pieces[k];
  const res: { to: number; kind: MoveKind }[] = [];
  const ownAt = (pos: number) => pieces.some((q, i) => i !== k && q === pos);
  const homeFree = (a: number, b: number) => {
    for (let x = Math.max(a, HOME_START); x <= b; x++) if (ownAt(x)) return false;
    return true;
  };

  if (p === -1) {
    if (d === 6 && !ownAt(0)) res.push({ to: 0, kind: 'enter' });
    return res;
  }
  if (p >= HOME_START) {
    const t = p + d;
    if (t <= HOME_END && homeFree(p + 1, t)) res.push({ to: t, kind: 'home' });
    return res;
  }
  if (isBlocked(s, pi, k)) return res;
  const t = p + d;
  if (t <= LOOP_END) {
    if (canLand(s, pi, k, t)) res.push({ to: t, kind: 'step' });
  } else if (t <= HOME_END && homeFree(HOME_START, t)) {
    res.push({ to: t, kind: 'home' });
  }
  if (isCorner(p)) {
    // «1» — по прямым стрелкам на соседние углы, «3» — по диагонали.
    const jumps = d === 1 ? [wrap(p, 12), wrap(p, -12)] : d === 3 ? [wrap(p, 24)] : [];
    for (const j of jumps) if (canLand(s, pi, k, j)) res.push({ to: j, kind: 'jump' });
  }
  return res;
}

export function legalMoves(s: State): Move[] {
  if (s.phase !== 'move') return [];
  const pi = s.cur;
  const out: Move[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < 2; i++) {
    if (s.used[i]) continue;
    const d = s.dice[i];
    for (let k = 0; k < PIECES; k++) {
      for (const tg of pieceTargets(s, pi, k, d)) {
        const key = k + ':' + tg.to + ':' + tg.kind + ':' + d;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ piece: k, die: i, value: d, from: s.players[pi].pieces[k], to: tg.to, kind: tg.kind });
      }
    }
  }
  return out;
}

/** Переставляет фишку (мутирует s), решает вопрос с домиком и рубкой. */
export function movePiece(s: State, pi: number, k: number, to: number) {
  const pl = s.players[pi];
  pl.pieces[k] = to;
  pl.house[k] = false;
  const captured: { seat: number; piece: number; from: number }[] = [];
  let house = false;
  if (onLoop(to)) {
    const g = toGlobal(pl.seat, to);
    const here = piecesAt(s, g).filter((o) => !(o.pi === pi && o.k === k));
    if (isHouseG(g) && !here.some((o) => o.house)) {
      pl.house[k] = true; // занимаем укрытие — из него не выбивают
      house = true;
    } else {
      for (const o of here) {
        if (o.house || o.pi === pi) continue;
        const op = s.players[o.pi];
        captured.push({ seat: op.seat, piece: o.k, from: op.pieces[o.k] });
        op.pieces[o.k] = -1;
        op.house[o.k] = false;
      }
    }
  }
  return { captured, house };
}

export function newGame(seats: number[], rng: Rng): State {
  const players = seats
    .slice()
    .sort((a, b) => a - b)
    .map((seat) => ({ seat, pieces: [-1, -1, -1, -1], house: [false, false, false, false] }));
  return {
    players,
    cur: rng.int(players.length),
    phase: 'roll',
    dice: [0, 0],
    used: [true, true],
    bonus: false,
    winner: null,
    turn: 1,
  };
}

// Дубль или срубленная фишка — тот же игрок бросает ещё раз.
function finishTurn(s: State): TurnEnd {
  const dbl = s.dice[0] === s.dice[1];
  const again = dbl || s.bonus;
  const reason = s.bonus ? (dbl ? 'both' : 'capture') : dbl ? 'double' : null;
  s.phase = 'roll';
  s.used = [true, true];
  s.bonus = false;
  if (!again) s.cur = (s.cur + 1) % s.players.length;
  s.turn++;
  return { again, reason, next: s.players[s.cur].seat };
}

export function applyRoll(state: State, dice: [number, number]) {
  if (state.phase !== 'roll') return null;
  const s = clone(state);
  s.dice = [dice[0], dice[1]];
  s.used = [false, false];
  s.bonus = false;
  s.phase = 'move';
  const ev: Event = { type: 'roll', seat: s.players[s.cur].seat, dice: [dice[0], dice[1]] };
  if (legalMoves(s).length === 0) {
    ev.noMoves = true;
    ev.turnEnd = finishTurn(s);
  }
  return { state: s, event: ev };
}

export function applyMove(state: State, mv: { piece: number; die: number; to: number }) {
  const legal = legalMoves(state).find((m) => m.piece === mv.piece && m.die === mv.die && m.to === mv.to);
  if (!legal) return null;
  const s = clone(state);
  const pl = s.players[s.cur];
  const from = pl.pieces[legal.piece];
  const { captured, house } = movePiece(s, s.cur, legal.piece, legal.to);
  s.used[legal.die] = true;
  if (captured.length) s.bonus = true;

  let path: number[];
  if (legal.kind === 'enter') path = [0];
  else if (legal.kind === 'jump') path = [legal.to];
  else {
    path = [];
    for (let x = from + 1; x <= legal.to; x++) path.push(x);
  }

  const ev: Extract<Event, { type: 'move' }> = {
    type: 'move',
    seat: pl.seat,
    piece: legal.piece,
    from,
    to: legal.to,
    kind: legal.kind,
    value: legal.value,
    path,
    captured,
    house,
  };

  if (pl.pieces.every((p) => p >= HOME_START)) {
    s.phase = 'over';
    s.winner = pl.seat;
    ev.win = true;
  } else if (s.used.every(Boolean)) {
    ev.turnEnd = finishTurn(s);
  } else if (legalMoves(s).length === 0) {
    ev.forfeit = true;
    ev.turnEnd = finishTurn(s);
  }
  return { state: s, event: ev as Event };
}
