/* Шен («Собаки и шакалы», «58 лунок») — древнеегипетская гонка. Без DOM.
 *
 * Доска-щит: у каждого игрока своя дорожка из 29 лунок — 10 вниз по средней колонне (лунка 1 — под кроной пальмы),
 * потом 19 вверх по краю и по дуге, — и общая финишная лунка «шен» (30) на макушке. Собаки идут по левой дорожке,
 * шакалы — по правой; дорожки не пересекаются.
 * Нумерация лунок, переходы 6–20 и 8–10 и лунки 15 и 25 — по доске из гробницы Ренисенеба (Картер и Карнарвон 1912,
 * Ludii «58 Holes»); правила по умолчанию — реконструкция «Вокруг света» (vokrugsveta.ru/article/296189).
 * Спорное — в docs/STATE.md, «Решения, принятые без пользователя».
 *
 * Бросок — четыре палочки (плоская светлая сторона и выпуклая тёмная): очки — число светлых, ни одной светлой — 5.
 *
 * «Шен» (по умолчанию): в начале у каждого одна фишка в лунке 1, остальные в руке. Фишка ходит только вперёд и не обгоняет
 * свои; встав на конец «змейки» (перехода), обязательно идёт по ней — вперёд с 6 на 20 и с 8 на 10, назад с 20 на 6 и с 10 на 8.
 * Пройдя лунку «нефер» (15 или 25) своим ходом, игрок выводит новую фишку в лунку 1 (если та занята — как только освободится);
 * встав на «нефер» — бросает ещё раз. В шен входят точным броском: вошедшая фишка возвращается в руку, а у соперника снимается
 * отстающая фишка — насовсем. Если на доске не осталось фишек, из руки сразу выходит новая. Без фишек — проигрыш.
 *
 * «Картер» (Картер и Карнарвон, 1912): все пять фишек в руке, вводятся броском на лунку 1–5; можно обгонять свои, но не вставать
 * на них; переходы только отбрасывают назад (с 20 на 6, с 10 на 8); на 15 и 25 — ещё бросок; побеждает тот, кто первым
 * приведёт в шен все фишки. */
import type { Options, Rng } from '../../core/types';

/** Лунок на дорожке игрока; 30 — шен. */
export const TRACK = 29;
export const SHEN = 30;
/** Переходы («змейки»): нижний конец — верхний. */
export const LINES: [number, number][] = [
  [6, 20],
  [8, 10],
];
/** Лунки «нефер». */
export const NEFER = [15, 25];
/** Предел партии в полуходах. */
export const MAX_PLY = 4000;

export type Mode = 'shen' | 'carter';
export type Snakes = 'both' | 'fwd' | 'back';

export interface Cfg {
  mode: Mode;
  /** Фишек у игрока. */
  pieces: number;
  /** Куда ведут переходы. */
  snakes: Snakes;
  /** Свои фишки не обгоняют друг друга. */
  noPass: boolean;
  /** Доска: слоновая кость или дерево (только вид). */
  look: 'ivory' | 'wood';
}

export function cfgFrom(o: Options): Cfg {
  const mode: Mode = o.mode === 'carter' ? 'carter' : 'shen';
  const snakes = o.snakes === 'fwd' || o.snakes === 'back' ? o.snakes : o.snakes === 'both' ? 'both' : mode === 'carter' ? 'back' : 'both';
  return {
    mode,
    pieces: Math.max(2, Math.min(5, Number(o.pieces ?? 5) || 5)),
    snakes,
    noPass: o.noPass == null ? mode === 'shen' : o.noPass === true,
    look: o.look === 'wood' ? 'wood' : 'ivory',
  };
}

export interface State {
  cfg: Cfg;
  turn: number;
  phase: 'roll' | 'move' | 'over';
  /** Палочки последнего броска: 1 — светлая сторона вверх. */
  sticks: number[];
  value: number;
  /** Лунки (1…29), где стоят фишки места, по возрастанию. */
  pegs: [number[], number[]];
  /** Фишки в руке (ещё не вышли или вернулись из шена). */
  hand: [number, number];
  /** «Картер»: фишки, пришедшие в шен. */
  home: [number, number];
  /** «Шен»: снятые насовсем. */
  lost: [number, number];
  /** «Шен»: право вывести фишку, пока лунка 1 занята. */
  rights: [number, number];
  /** Ещё бросок после этого хода. */
  again: boolean;
  winner: number | null;
  ply: number;
}

/** from — лунка фишки, 0 — ввод из руки («Картер»). */
export type Action = { type: 'roll' } | { type: 'move'; from: number };

export interface Move {
  from: number;
  /** Куда встала по броску. */
  land: number;
  /** Где оказалась после перехода (= land, если перехода нет). */
  to: number;
  /** Лунки по пути (последняя — land). */
  path: number[];
  /** Прошла «нефер» своим ходом (сколько раз). */
  nefer: number;
  /** Встала на «нефер» — ещё бросок. */
  again: boolean;
}

export type Event =
  | { type: 'roll'; seat: number; sticks: number[]; value: number; none: boolean; first?: boolean }
  | { type: 'move'; seat: number; from: number; land: number; to: number; path: number[]; again: boolean; took: number | null; nefer: number }
  | { type: 'enter'; seat: number }
  | { type: 'turn'; seat: number; again: boolean }
  | { type: 'end'; winner: number | null; why: 'shen' | 'out' | 'limit' };

/** Очки броска палочек. */
export const throwValue = (sticks: number[]) => {
  const n = sticks.filter((x) => x).length;
  return n === 0 ? 5 : n;
};
/** Вероятность выбросить v (1…5). */
export const PROB = [0, 4 / 16, 6 / 16, 4 / 16, 1 / 16, 1 / 16];

/** Куда ведёт переход из лунки h (или h, если никуда). */
export function snakeFrom(cfg: Cfg, h: number): number {
  for (const [lo, hi] of LINES) {
    if (h === lo && cfg.snakes !== 'back') return hi;
    if (h === hi && cfg.snakes !== 'fwd') return lo;
  }
  return h;
}

export function newState(cfg: Cfg, turn = 0): State {
  const shen = cfg.mode === 'shen';
  return {
    cfg,
    turn,
    phase: 'roll',
    sticks: [],
    value: 0,
    pegs: shen ? [[1], [1]] : [[], []],
    hand: shen ? [cfg.pieces - 1, cfg.pieces - 1] : [cfg.pieces, cfg.pieces],
    home: [0, 0],
    lost: [0, 0],
    rights: [0, 0],
    again: false,
    winner: null,
    ply: 0,
  };
}

const roll4 = (rng: Rng) => [0, 1, 2, 3].map(() => rng.int(2));

/** Начало: оба бросают палочки, у кого меньше — ходит первым на выпавшее число (по «Вокруг света»). */
export function setup(o: Options, rng: Rng): State {
  const cfg = cfgFrom(o);
  for (let i = 0; i < 30; i++) {
    const a = roll4(rng);
    const b = roll4(rng);
    const va = throwValue(a);
    const vb = throwValue(b);
    if (va === vb) continue;
    const first = va < vb ? 0 : 1;
    const s = newState(cfg, first);
    s.sticks = first === 0 ? a : b;
    s.value = Math.min(va, vb);
    s.phase = 'move';
    if (!legalMoves(s).length) {
      s.phase = 'roll';
      s.sticks = [];
      s.value = 0;
    }
    return s;
  }
  return newState(cfg, 0);
}

export const toAct = (s: State) => (s.phase === 'over' ? [] : [s.turn]);

/** Сколько у места фишек в игре (на доске и в руке). */
export const alive = (s: State, seat: number) => s.pegs[seat].length + s.hand[seat];

function tryMove(s: State, seat: number, from: number, v: number): Move | null {
  const own = s.pegs[seat];
  if (from === 0) {
    if (s.cfg.mode !== 'carter' || s.hand[seat] <= 0) return null;
  } else if (!own.includes(from)) return null;
  const land = from + v;
  if (land > SHEN) return null; // в шен — только точным броском
  const path: number[] = [];
  for (let h = from + 1; h <= land; h++) path.push(h);
  if (land < SHEN && own.includes(land)) return null;
  if (s.cfg.noPass && path.some((h) => h < SHEN && own.includes(h))) return null;
  let to = land;
  if (land < SHEN) {
    const t = snakeFrom(s.cfg, land);
    if (t !== land && !own.includes(t)) to = t; // конец перехода занят своей — остаёмся
  }
  const nefer = s.cfg.mode === 'shen' ? path.filter((h) => NEFER.includes(h)).length : 0;
  return { from, land, to, path, nefer, again: NEFER.includes(land) };
}

export function legalMoves(s: State): Move[] {
  if (s.phase !== 'move') return [];
  const seat = s.turn;
  const out: Move[] = [];
  const froms = s.cfg.mode === 'carter' && s.hand[seat] > 0 ? [0, ...s.pegs[seat]] : s.pegs[seat];
  for (const f of froms) {
    const m = tryMove(s, seat, f, s.value);
    if (m) out.push(m);
  }
  return out;
}

export function legal(s: State): Action[] {
  if (s.phase === 'over') return [];
  if (s.phase === 'roll') return [{ type: 'roll' }];
  return legalMoves(s).map((m) => ({ type: 'move', from: m.from }));
}

function clone(s: State): State {
  return {
    ...s,
    sticks: s.sticks.slice(),
    pegs: [s.pegs[0].slice(), s.pegs[1].slice()],
    hand: [s.hand[0], s.hand[1]],
    home: [s.home[0], s.home[1]],
    lost: [s.lost[0], s.lost[1]],
    rights: [s.rights[0], s.rights[1]],
  };
}

const sortPegs = (a: number[]) => a.sort((x, y) => x - y);

/** «Шен»: вывести фишки из руки в лунку 1, если есть право или на доске пусто. */
function enterPegs(s: State, ev: Event[]) {
  if (s.cfg.mode !== 'shen') return;
  for (const seat of [s.turn, 1 - s.turn]) {
    s.rights[seat] = Math.min(s.rights[seat], s.hand[seat]);
    if (s.hand[seat] <= 0 || s.pegs[seat].includes(1)) continue;
    if (s.rights[seat] > 0 || s.pegs[seat].length === 0) {
      if (s.rights[seat] > 0 && s.pegs[seat].length > 0) s.rights[seat]--;
      s.hand[seat]--;
      s.pegs[seat].unshift(1);
      ev.push({ type: 'enter', seat });
    }
  }
}

function finish(s: State, ev: Event[], winner: number | null, why: 'shen' | 'out' | 'limit') {
  s.phase = 'over';
  s.winner = winner;
  ev.push({ type: 'end', winner, why });
}

/** Счёт для предела партии: больше фишек в игре / в шене. */
const score = (s: State, seat: number) => (s.cfg.mode === 'shen' ? alive(s, seat) : s.home[seat] * 100 + s.pegs[seat].reduce((a, b) => a + b, 0));

function endTurn(s: State, ev: Event[], again: boolean) {
  s.phase = 'roll';
  s.again = false;
  if (!again) s.turn = 1 - s.turn;
  if (s.ply >= MAX_PLY) {
    const a = score(s, 0);
    const b = score(s, 1);
    return finish(s, ev, a === b ? null : a > b ? 0 : 1, 'limit');
  }
  ev.push({ type: 'turn', seat: s.turn, again });
}

/** Бросок с заданными палочками (показ правил подкручивает их через rig). */
export function applyRoll(s0: State, sticks: number[]): { state: State; events: Event[] } {
  const s = clone(s0);
  s.sticks = sticks.slice();
  s.value = throwValue(sticks);
  s.phase = 'move';
  s.ply++;
  const none = legalMoves(s).length === 0;
  const ev: Event[] = [{ type: 'roll', seat: s.turn, sticks: sticks.slice(), value: s.value, none }];
  if (none) endTurn(s, ev, false);
  return { state: s, events: ev };
}

export function applyMove(s0: State, from: number): { state: State; events: Event[] } | null {
  const m = legalMoves(s0).find((x) => x.from === from);
  if (!m) return null;
  const seat = s0.turn;
  const opp = 1 - seat;
  const s = clone(s0);
  s.ply++;
  if (from === 0) s.hand[seat]--;
  else s.pegs[seat] = s.pegs[seat].filter((h) => h !== from);
  let took: number | null = null;
  if (m.to === SHEN) {
    if (s.cfg.mode === 'shen') {
      s.hand[seat]++;
      // у соперника снимается отстающая фишка; нет на доске — из руки
      if (s.pegs[opp].length) {
        took = s.pegs[opp][0];
        s.pegs[opp] = s.pegs[opp].slice(1);
      } else if (s.hand[opp] > 0) {
        took = 0;
        s.hand[opp]--;
      }
      if (took != null) s.lost[opp]++;
    } else s.home[seat]++;
  } else s.pegs[seat] = sortPegs([...s.pegs[seat], m.to]);
  if (m.nefer) s.rights[seat] += m.nefer;
  const ev: Event[] = [{ type: 'move', seat, from, land: m.land, to: m.to, path: m.path, again: m.again, took, nefer: m.nefer }];
  if (s.cfg.mode === 'carter' && s.home[seat] >= s.cfg.pieces) {
    finish(s, ev, seat, 'shen');
    return { state: s, events: ev };
  }
  if (s.cfg.mode === 'shen' && alive(s, opp) === 0) {
    finish(s, ev, seat, 'out');
    return { state: s, events: ev };
  }
  enterPegs(s, ev);
  endTurn(s, ev, m.again);
  return { state: s, events: ev };
}

export function apply(s: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s.phase === 'over' || seat !== s.turn || !a || typeof a !== 'object') return null;
  if (a.type === 'roll') return s.phase === 'roll' ? applyRoll(s, roll4(rng)) : null;
  if (a.type === 'move' && s.phase === 'move' && typeof a.from === 'number') return applyMove(s, a.from);
  return null;
}
