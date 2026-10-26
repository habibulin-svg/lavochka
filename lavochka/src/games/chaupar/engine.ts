/* Чаупар и пачиси — индийские игры на кресте (без DOM). Подключаются пресетами «Шиш-беша» (shishbesh/def.ts).
 *
 * Реконструкция — по en.wikipedia «Pachisi» и «Chaupar» (спорное — в docs/STATE.md, «Решения, принятые без пользователя»).
 * Поле — крест из четырёх рукавов по 3 столбца × 8 клеток и центр (чарконі). Места и цвета — как в шиш-беше:
 * 0 красный, 1 зелёный, 2 жёлтый, 3 синий; рукав места = номер места (0 низ, 1 право, 2 верх, 3 лево на неповёрнутой доске),
 * ходят по очереди и по кругу против часовой стрелки.
 *
 * Путь фишки (позиция p относительно владельца):
 *   -1      — ждёт у края полотна (ещё не вошла);
 *    0..6   — вниз по среднему столбцу своего рукава (от центра);
 *    7..74  — внешний круг из 68 клеток против часовой, 7 — торец своего среднего столбца;
 *   75      — снова торец своего столбца, 76..82 — вверх по нему к центру;
 *   83      — в центре (дошла).
 * Средний столбец своего рукава (кроме торца) — только для своих фишек. Замки (12): торцы средних столбцов и
 * 4-я клетка от торца на каждом внешнем столбце — там не рубят, а на замок с фишкой противника не встать.
 *
 * Броски: «пасы» — три длинные кости с гранями 1, 2, 5, 6, каждая кость — отдельный ход любой фишкой; войти — костью «6»;
 * три одинаковые — ещё бросок. «Каури» — шесть раковин: число раскрытых 0 → 25, 1 → 10 (или 1 — на выбор), 2…6 → столько же;
 * 25, 10 и 6 — «милость»: вводят фишку (или ходят) и дают ещё бросок. За рубку — ещё бросок. В центр — точным броском.
 * Пары (вчетвером): сидящие напротив — союзники, друг друга не рубят; побеждает пара, первой заведшая все восемь фишек.
 */
import type { Options, Rng } from '../../core/types';

export const PIECES = 4;
export const GOAL = 83;
/** Клеток внешнего круга и в его четверти (на один рукав). */
export const RING = 68;
export const QUARTER = 17;
export const PASA_FACES = [1, 2, 5, 6];
export const SHELLS = 6;
/** Каури: число раскрытых раковин → очки. */
export const COWRIE_VALUE = [25, 10, 2, 3, 4, 5, 6];
/** Броски-«милости»: вводят фишку и дают ещё бросок. */
export const GRACE = [6, 10, 25];

export type Throws = 'pasa' | 'cowrie';

export interface CCfg {
  throws: Throws;
  /** Вчетвером: напротив — союзники. */
  pairs: boolean;
}

export function ccfgFrom(o: Options): CCfg {
  return { throws: o.throws === 'cowrie' ? 'cowrie' : 'pasa', pairs: o.pairs !== false };
}

export interface CPlayer {
  seat: number;
  pieces: number[];
}

export interface CState {
  ch: true;
  cfg: CCfg;
  players: CPlayer[];
  cur: number;
  phase: 'roll' | 'move' | 'over';
  /** Очки бросков: три кости у пасов, одно число у каури. */
  dice: number[];
  used: boolean[];
  /** Каури: какие раковины легли ртом вверх (для показа). */
  shells?: boolean[];
  bonus: boolean;
  winner: number | null;
  winners?: number[];
  turn: number;
}

export type CAction = { type: 'roll' } | { type: 'move'; piece: number; die: number; to: number };

export interface CMove {
  piece: number;
  die: number;
  value: number;
  from: number;
  to: number;
}

export interface CTurnEnd {
  again: boolean;
  reason: 'triple' | 'grace' | 'capture' | null;
  next: number;
}

export type CEvent =
  | { ch: true; type: 'roll'; seat: number; dice: number[]; shells?: boolean[]; noMoves?: boolean; turnEnd?: CTurnEnd }
  | {
      ch: true;
      type: 'move';
      seat: number;
      piece: number;
      from: number;
      to: number;
      value: number;
      path: number[];
      captured: { seat: number; piece: number; from: number }[];
      castle: boolean;
      home: boolean;
      win?: boolean;
      /** Пара доиграла: место дошло всеми фишками, но ждёт союзника. */
      done?: boolean;
      forfeit?: boolean;
      turnEnd?: CTurnEnd;
    };

export const isC = (s: unknown): s is CState => !!s && (s as CState).ch === true;
const clone = (s: CState): CState => JSON.parse(JSON.stringify(s));

/** Клетка внешнего круга (0..67) для позиции p места seat; null — не на круге (свой столбец, ждёт, дошла). */
export function ringOf(seat: number, p: number): number | null {
  if (p >= 7 && p <= 75) return (QUARTER * seat + p - 7) % RING;
  return null;
}

export const isCastle = (g: number) => [0, 4, 13].includes(g % QUARTER);

/** Клетка поля: рукав, столбец (-1, 0, +1; +1 — сторона по ходу), ряд от центра (0..7). */
export function cellOfRing(g: number): [number, number, number] {
  const a = Math.floor(g / QUARTER);
  const i = g % QUARTER;
  if (i === 0) return [a, 0, 7];
  if (i <= 8) return [a, 1, 8 - i];
  return [(a + 1) % 4, -1, i - 9];
}

/** Где на поле стоит фишка: клетка [рукав, столбец, ряд]; null — вне клеток (ждёт или в центре). */
export function cellOf(seat: number, p: number): [number, number, number] | null {
  if (p < 0 || p >= GOAL) return null;
  if (p <= 6) return [seat, 0, p];
  if (p <= 75) return cellOfRing(ringOf(seat, p)!);
  return [seat, 0, 82 - p];
}

const allies = (s: CState, a: number, b: number) => a === b || (pairsOn(s) && (a + 2) % 4 === b);
export const pairsOn = (s: CState) => s.cfg.pairs && s.players.length === 4;

/** Кто стоит на клетке круга g. */
export function onRing(s: CState, g: number) {
  const out: { pi: number; k: number; seat: number }[] = [];
  s.players.forEach((pl, pi) => pl.pieces.forEach((p, k) => ringOf(pl.seat, p) === g && out.push({ pi, k, seat: pl.seat })));
  return out;
}

const done = (pl: CPlayer) => pl.pieces.every((p) => p === GOAL);

/** Куда может пойти фишка k текущего игрока на d. */
export function target(s: CState, k: number, d: number): number | null {
  const pl = s.players[s.cur];
  const p = pl.pieces[k];
  if (p === GOAL) return null;
  if (p < 0) {
    const grace = s.cfg.throws === 'pasa' ? d === 6 : GRACE.includes(d);
    return grace ? 0 : null;
  }
  const to = p + d;
  if (to > GOAL) return null;
  const g = ringOf(pl.seat, to);
  if (g != null && isCastle(g) && onRing(s, g).some((o) => !allies(s, o.seat, pl.seat))) return null;
  return to;
}

export function legalMoves(s: CState): CMove[] {
  if (s.phase !== 'move') return [];
  const pl = s.players[s.cur];
  const out: CMove[] = [];
  const seen = new Set<string>();
  s.dice.forEach((d0, i) => {
    if (s.used[i]) return;
    // каури: одна раскрытая — 10 или 1 (иначе фишке за шаг до центра никогда не войти)
    for (const d of s.cfg.throws === 'cowrie' && d0 === 10 ? [10, 1] : [d0])
    for (let k = 0; k < PIECES; k++) {
      const to = target(s, k, d);
      if (to == null) continue;
      // одинаковые кости и фишки на одной клетке дают одинаковые ходы — оставляем один
      const key = `${pl.pieces[k]}:${to}:${d}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ piece: k, die: i, value: d, from: pl.pieces[k], to });
    }
  });
  return out;
}

export function newCGame(seats: number[], rng: Rng, cfg: CCfg): CState {
  const players = seats
    .slice()
    .sort((a, b) => a - b)
    .map((seat) => ({ seat, pieces: [-1, -1, -1, -1] }));
  const n = cfg.throws === 'pasa' ? 3 : 1;
  return {
    ch: true,
    cfg: { ...cfg },
    players,
    cur: rng.int(players.length),
    phase: 'roll',
    dice: Array(n).fill(0),
    used: Array(n).fill(true),
    bonus: false,
    winner: null,
    turn: 1,
  };
}

/** Бросок: rng.int(4) на каждую кость-пасу или rng.int(2) на каждую раковину (1 — ртом вверх). */
export function throwDice(cfg: CCfg, rng: Rng): { dice: number[]; shells?: boolean[] } {
  if (cfg.throws === 'pasa') return { dice: [0, 1, 2].map(() => PASA_FACES[rng.int(4)]) };
  const shells = Array.from({ length: SHELLS }, () => rng.int(2) === 1);
  return { dice: [COWRIE_VALUE[shells.filter(Boolean).length]], shells };
}

function nextActive(s: CState) {
  for (let i = 1; i <= s.players.length; i++) {
    const j = (s.cur + i) % s.players.length;
    if (!done(s.players[j])) return j;
  }
  return s.cur;
}

function finishTurn(s: CState): CTurnEnd {
  const triple = s.cfg.throws === 'pasa' && s.dice.every((d) => d === s.dice[0]);
  const grace = s.cfg.throws === 'cowrie' && GRACE.includes(s.dice[0]);
  const reason: CTurnEnd['reason'] = s.bonus ? 'capture' : triple ? 'triple' : grace ? 'grace' : null;
  const again = reason != null && !done(s.players[s.cur]);
  s.phase = 'roll';
  s.used = s.used.map(() => true);
  s.bonus = false;
  if (!again) s.cur = nextActive(s);
  s.turn++;
  return { again, reason, next: s.players[s.cur].seat };
}

export function applyCRoll(state: CState, thr: { dice: number[]; shells?: boolean[] }) {
  if (state.phase !== 'roll') return null;
  const s = clone(state);
  s.dice = thr.dice.slice();
  s.used = s.dice.map(() => false);
  if (thr.shells) s.shells = thr.shells.slice();
  else delete s.shells;
  s.bonus = false;
  s.phase = 'move';
  const ev: CEvent = { ch: true, type: 'roll', seat: s.players[s.cur].seat, dice: s.dice.slice() };
  if (thr.shells) ev.shells = thr.shells.slice();
  if (!legalMoves(s).length) {
    ev.noMoves = true;
    ev.turnEnd = finishTurn(s);
  }
  return { state: s, event: ev };
}

export function applyCMove(state: CState, mv: { piece: number; die: number; to: number }) {
  const legal = legalMoves(state).find((m) => m.die === mv.die && m.to === mv.to && (m.piece === mv.piece || state.players[state.cur].pieces[m.piece] === state.players[state.cur].pieces[mv.piece]));
  if (!legal) return null;
  const s = clone(state);
  const pl = s.players[s.cur];
  const k = mv.piece;
  const from = pl.pieces[k];
  pl.pieces[k] = legal.to;
  s.used[legal.die] = true;
  const captured: { seat: number; piece: number; from: number }[] = [];
  const g = ringOf(pl.seat, legal.to);
  const castle = g != null && isCastle(g);
  if (g != null && !castle) {
    for (const o of onRing(s, g)) {
      if (allies(s, o.seat, pl.seat)) continue;
      const op = s.players[o.pi];
      captured.push({ seat: op.seat, piece: o.k, from: op.pieces[o.k] });
      op.pieces[o.k] = -1;
    }
  }
  if (captured.length) s.bonus = true;
  const path: number[] = [];
  if (from < 0) path.push(legal.to);
  else for (let x = from + 1; x <= legal.to; x++) path.push(x);
  const ev: Extract<CEvent, { type: 'move' }> = {
    ch: true,
    type: 'move',
    seat: pl.seat,
    piece: k,
    from,
    to: legal.to,
    value: legal.value,
    path,
    captured,
    castle,
    home: legal.to === GOAL,
  };
  if (done(pl)) {
    const team = pairsOn(s) ? s.players.filter((p) => allies(s, p.seat, pl.seat)) : [pl];
    if (team.every(done)) {
      s.phase = 'over';
      s.winner = pl.seat;
      s.winners = team.map((p) => p.seat);
      ev.win = true;
      return { state: s, event: ev as CEvent };
    }
    ev.done = true;
    ev.turnEnd = finishTurn(s);
  } else if (s.used.every(Boolean)) ev.turnEnd = finishTurn(s);
  else if (!legalMoves(s).length) {
    ev.forfeit = true;
    ev.turnEnd = finishTurn(s);
  }
  return { state: s, event: ev as CEvent };
}

export const cToAct = (s: CState): number[] => (s.phase === 'over' ? [] : [s.players[s.cur].seat]);
