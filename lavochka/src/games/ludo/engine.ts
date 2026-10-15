/* Людо и парчис — правила на родных досках (без DOM). Подключаются пресетами «Шиш-беша» (shishbesh/def.ts).
 *
 * Места и цвета — как в шиш-беше: 0 красный, 1 зелёный, 2 жёлтый, 3 синий. У каждого 4 фишки.
 * Положение фишки — шаги её пути: -1 — во дворе (дома), 0 — на своём старте, дальше по общему кругу,
 * затем по своей дорожке к центру; GOAL — дошла.
 *
 * Людо (en.wikipedia «Ludo»): доска 15×15, круг 52 клетки, по часовой стрелке. Свой круг — 51 клетка (0–50),
 * дорожка домой 5 клеток (51–55), центр — 56. Выход — на 6; шестёрка — ещё бросок; три шестёрки подряд — ход сгорает.
 * Встал на чужую фишку не на безопасной клетке (старты и звёзды через 8 от старта) — она идёт во двор.
 * В дом — точным броском. Варианты: «бонусы» (за рубку и за приход домой — ещё бросок), «блоки» (две свои фишки
 * на клетке — ни пройти, ни встать; рубить их нельзя).
 *
 * Парчис (es.wikipedia «Parchís»): 68 клеток с номерами, против часовой стрелки; выходы 5 / 22 / 39 / 56,
 * входы в коридоры 68 / 17 / 34 / 51, коридор 7 клеток, центр. 12 безопасных клеток (seguro).
 * Свой путь: 0–63 по кругу, 64–70 коридор, 71 — центр. Выход — на 5 (обязателен, если можно вывести);
 * шестёрка — ещё бросок, а если во дворе никого — считается за 7; третья шестёрка подряд — фишка, ходившая последней,
 * идёт во двор (если она не в коридоре). Рубка (кроме seguro) — +20 клеток любой своей фишкой, приход в центр — +10.
 * Две фишки одного цвета на клетке — барьер: сквозь него никто не ходит; выпала шестёрка — обязан разбить свой барьер,
 * если можешь. На клетке не больше двух фишек; на выходе своя фишка рубит чужую, если клетка занята двумя.
 * В центр — точным броском.
 */
import type { Options } from '../../core/types';

export type Kind = 'ludo' | 'parchis';

export interface LCfg {
  kind: Kind;
  /** Людо: ещё бросок за рубку и за приход домой. */
  bonus: boolean;
  /** Людо: блоки из двух своих фишек. */
  blocks: boolean;
}

export function lcfgFrom(o: Options): LCfg {
  const kind: Kind = o.game === 'parchis' ? 'parchis' : 'ludo';
  return { kind, bonus: kind === 'ludo' && !!o.ludoBonus, blocks: kind === 'ludo' && !!o.ludoBlocks };
}

/** Размеры пути. */
export const PATH = {
  ludo: { N: 52, last: 50, goal: 56, start: [1, 14, 27, 40] as number[], safe: [1, 9, 14, 22, 27, 35, 40, 48] },
  parchis: { N: 68, last: 63, goal: 71, start: [], safe: [] as number[] },
};
/** Парчис: клетки — номера 1…68 (индекс = номер − 1). Выходы по местам (0 красный, 1 зелёный, 2 жёлтый, 3 синий). */
export const P_EXIT = [39, 56, 5, 22];
export const P_SAFE = [5, 12, 17, 22, 29, 34, 39, 46, 51, 56, 63, 68];
/** Людо: старт по местам (индекс клетки круга): красный — левый нижний двор, зелёный — левый верхний, жёлтый — правый верхний, синий — правый нижний. */
export const L_START = [1, 14, 27, 40];

/** Порядок ходов: людо — по часовой (красный, зелёный, жёлтый, синий), парчис — против (жёлтый, синий, красный, зелёный). */
export const ORDER: Record<Kind, number[]> = { ludo: [0, 1, 2, 3], parchis: [2, 3, 0, 1] };

export interface LState {
  lg: true;
  cfg: LCfg;
  /** Места в порядке ходов. */
  seats: number[];
  /** Фишки по местам (индекс — место 0–3; у пустых мест — []). */
  pieces: number[][];
  cur: number;
  phase: 'roll' | 'move' | 'over';
  /** Выпавшее и сколько ходить (в парчисе 6 → 7). */
  die: number;
  value: number;
  /** Парчис: бонус к ходу (20 за рубку, 10 за центр) — ходится отдельно после основного. */
  bonus: number[];
  sixes: number;
  /** Последняя ходившая фишка текущего игрока (для третьей шестёрки в парчисе). */
  lastPiece: number;
  winner: number | null;
  turn: number;
}

export type LAction = { type: 'roll' } | { type: 'move'; piece: number };

export interface Captured {
  seat: number;
  piece: number;
}

export type LEvent =
  | { lg: true; type: 'roll'; seat: number; die: number; value: number; noMoves: boolean; burnt?: boolean; penalty?: Captured | null; next: number; again: boolean }
  | { lg: true; type: 'move'; seat: number; piece: number; from: number; to: number; steps: number; bonus: boolean; captured: Captured[]; goal: boolean; win: boolean; gain: number; next: number; again: boolean };

export const isL = (s: unknown): s is LState => !!s && (s as LState).lg === true;

export const goalOf = (k: Kind) => PATH[k].goal;
const lastOf = (k: Kind) => PATH[k].last;

/** Клетка общего круга (индекс 0…N-1) для шага p места seat; null — фишка не на круге. */
export function cellOf(k: Kind, seat: number, p: number): number | null {
  if (p < 0 || p > lastOf(k)) return null;
  if (k === 'ludo') return (L_START[seat] + p) % 52;
  return (P_EXIT[seat] - 1 + p) % 68;
}

export function isSafe(k: Kind, cell: number): boolean {
  return k === 'ludo' ? PATH.ludo.safe.includes(cell) : P_SAFE.includes(cell + 1);
}

export function newLGame(seatList: number[], cfg: LCfg): LState {
  const order = ORDER[cfg.kind].filter((x) => seatList.includes(x));
  const pieces: number[][] = [[], [], [], []];
  for (const s of order) pieces[s] = [-1, -1, -1, -1];
  return { lg: true, cfg, seats: order, pieces, cur: 0, phase: 'roll', die: 0, value: 0, bonus: [], sixes: 0, lastPiece: -1, winner: null, turn: 1 };
}

const clone = (s: LState): LState => ({ ...s, pieces: s.pieces.map((p) => p.slice()), bonus: s.bonus.slice() });

/** Кто стоит на клетке круга: [{seat, piece}]. */
function onCell(s: LState, cell: number): Captured[] {
  const out: Captured[] = [];
  const k = s.cfg.kind;
  for (const seat of s.seats) s.pieces[seat].forEach((p, i) => cellOf(k, seat, p) === cell && out.push({ seat, piece: i }));
  return out;
}

/** Две фишки одного цвета на клетке круга — барьер/блок. */
function isWall(s: LState, cell: number): boolean {
  const who = onCell(s, cell);
  return s.seats.some((seat) => who.filter((w) => w.seat === seat).length >= 2);
}

export interface LMove {
  piece: number;
  from: number;
  to: number;
  steps: number;
}

/** Куда может пойти фишка на v шагов (null — нельзя). */
function target(s: LState, seat: number, piece: number, v: number): number | null {
  const k = s.cfg.kind;
  const from = s.pieces[seat][piece];
  const goal = goalOf(k);
  if (from < 0 || from >= goal) return null;
  const to = from + v;
  if (to > goal) return null;
  const walls = k === 'parchis' || s.cfg.blocks;
  for (let p = from + 1; p <= to; p++) {
    const cell = cellOf(k, seat, p);
    if (cell != null) {
      if (walls && isWall(s, cell)) return null; // барьер — ни пройти, ни встать
      if (p === to) {
        const here = onCell(s, cell);
        if (k === 'parchis' && here.length >= 2) return null;
      }
    } else if (p < goal && k === 'parchis') {
      // коридор: своих двое — барьер, третья не встанет
      const same = s.pieces[seat].filter((x) => x === p).length;
      if (same >= 2) return null;
    }
  }
  return to;
}

/** Можно ли вывести фишку со двора (людо — на 6, парчис — на 5). */
function canEnter(s: LState, seat: number): boolean {
  const k = s.cfg.kind;
  if (!s.pieces[seat].includes(-1)) return false;
  if (k === 'ludo') return s.die === 6 && !(s.cfg.blocks && isWallOf(s, cellOf(k, seat, 0)!, seat, true));
  if (s.die !== 5) return false;
  const here = onCell(s, cellOf(k, seat, 0)!);
  return here.filter((w) => w.seat === seat).length < 2;
}

/** Блок чужого цвета на клетке (людо с блоками: на свой старт при чужом блоке не выйти). */
function isWallOf(s: LState, cell: number, seat: number, foreign: boolean): boolean {
  const who = onCell(s, cell);
  return s.seats.some((x) => (foreign ? x !== seat : x === seat) && who.filter((w) => w.seat === x).length >= 2);
}

export function legalMoves(s: LState): LMove[] {
  if (s.phase !== 'move') return [];
  const seat = s.seats[s.cur];
  const k = s.cfg.kind;
  const mine = s.pieces[seat];
  const out: LMove[] = [];
  if (s.bonus.length) {
    const v = s.bonus[0];
    mine.forEach((p, i) => {
      const to = target(s, seat, i, v);
      if (to != null) out.push({ piece: i, from: p, to, steps: v });
    });
    return out;
  }
  if (canEnter(s, seat)) {
    const i = mine.indexOf(-1);
    out.push({ piece: i, from: -1, to: 0, steps: 0 });
    if (k === 'parchis') return out; // на 5 выводить обязательно
  }
  mine.forEach((p, i) => {
    const to = target(s, seat, i, s.value);
    if (to != null) out.push({ piece: i, from: p, to, steps: s.value });
  });
  // парчис: на шестёрке обязан разбить свой барьер
  if (k === 'parchis' && s.die === 6) {
    const walls = out.filter((m) => {
      const c = cellOf(k, seat, m.from);
      return (c != null && mine.filter((x) => cellOf(k, seat, x) === c).length >= 2) || (c == null && m.from > lastOf(k) && mine.filter((x) => x === m.from).length >= 2);
    });
    if (walls.length) return walls;
  }
  return out;
}

function nextPlayer(s: LState): number {
  return (s.cur + 1) % s.seats.length;
}

export function applyLRoll(s0: LState, die: number): { state: LState; events: LEvent[] } | null {
  if (s0.phase !== 'roll') return null;
  const s = clone(s0);
  const seat = s.seats[s.cur];
  const k = s.cfg.kind;
  s.die = die;
  s.sixes = die === 6 ? s.sixes + 1 : 0;
  s.value = k === 'parchis' && die === 6 && !s.pieces[seat].includes(-1) ? 7 : die;
  // третья шестёрка подряд
  if (s.sixes >= 3) {
    let penalty: Captured | null = null;
    if (k === 'parchis' && s.lastPiece >= 0) {
      const p = s.pieces[seat][s.lastPiece];
      if (p >= 0 && p <= lastOf(k)) {
        s.pieces[seat][s.lastPiece] = -1;
        penalty = { seat, piece: s.lastPiece };
      }
    }
    endTurn(s, false);
    return { state: s, events: [{ lg: true, type: 'roll', seat, die, value: s0.value, noMoves: true, burnt: true, penalty, next: s.seats[s.cur], again: false }] };
  }
  s.phase = 'move';
  const moves = legalMoves(s);
  if (!moves.length) {
    const again = die === 6;
    endTurn(s, again);
    return { state: s, events: [{ lg: true, type: 'roll', seat, die, value: s.value, noMoves: true, next: s.seats[s.cur], again }] };
  }
  return { state: s, events: [{ lg: true, type: 'roll', seat, die, value: s.value, noMoves: false, next: seat, again: false }] };
}

function endTurn(s: LState, again: boolean) {
  s.phase = 'roll';
  s.bonus = [];
  if (!again) {
    s.cur = nextPlayer(s);
    s.sixes = 0;
    s.lastPiece = -1;
    s.turn++;
  }
}

export function applyLMove(s0: LState, piece: number): { state: LState; events: LEvent[] } | null {
  const m = legalMoves(s0).find((x) => x.piece === piece);
  if (!m) return null;
  const s = clone(s0);
  const seat = s.seats[s.cur];
  const k = s.cfg.kind;
  const isBonus = s.bonus.length > 0;
  const gain = isBonus ? s.bonus.shift()! : 0;
  s.pieces[seat][piece] = m.to;
  s.lastPiece = piece;
  const captured: Captured[] = [];
  const cell = cellOf(k, seat, m.to);
  if (cell != null) {
    const others = onCell(s, cell).filter((w) => w.seat !== seat);
    const safe = isSafe(k, cell);
    if (k === 'ludo') {
      if (!safe && others.length) for (const o of others) captured.push(o);
    } else if (m.from === -1) {
      // выход: клетка была занята двумя — рубим чужую (последнюю пришедшую — любую)
      if (others.length && onCell(s, cell).length > 2) captured.push(others[others.length - 1]);
    } else if (!safe && others.length === 1) captured.push(others[0]);
  }
  for (const c of captured) s.pieces[c.seat][c.piece] = -1;
  const goal = m.to === goalOf(k);
  const win = s.pieces[seat].every((p) => p === goalOf(k));
  let again = false;
  if (k === 'parchis') {
    if (captured.length) s.bonus.push(20);
    if (goal) s.bonus.push(10);
    // бонус, которым нечем ходить, сгорает
    while (s.bonus.length && !legalMoves(s).length) s.bonus.shift();
  }
  if (win) {
    s.phase = 'over';
    s.winner = seat;
  } else if (s.bonus.length) {
    // ходим бонусом той же фазой
  } else {
    again = s.die === 6 || (s.cfg.bonus && (captured.length > 0 || goal));
    endTurn(s, again);
  }
  return {
    state: s,
    events: [{ lg: true, type: 'move', seat, piece, from: m.from, to: m.to, steps: m.steps, bonus: isBonus, captured, goal, win, gain, next: s.seats[s.cur], again }],
  };
}

export const lToAct = (s: LState): number[] => (s.phase === 'over' ? [] : [s.seats[s.cur]]);
