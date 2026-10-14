/* Яхтзи, Генерал, Покер на костях — правила (без DOM). Пять костей, до трёх бросков за ход, между бросками часть костей
 * можно отложить.
 *
 * Яхтзи: 13 граф. Верх — единицы…шестёрки (сумма своих), 63 и больше — бонус 35. Низ: тройка и каре — сумма всех костей,
 * фулл-хаус 25, малый стрит (4 подряд) 30, большой (5 подряд) 40, яхтзи (5 одинаковых) 50, шанс — сумма. Повторный яхтзи
 * при записанных 50 — +100 и «джокер»: обязан в верхнюю графу своего числа, если свободна, иначе в любую нижнюю по полной
 * цене (фулл 25, стриты 30/40), иначе ноль в любую верхнюю.
 * Генерал: 11 граф — верх 1…6 без бонуса; стрит 20 (1-2-3-4-5, 2-3-4-5-6, 3-4-5-6-1), фулл 30, покер (каре) 40,
 * генерал 50, двойной генерал 100. Комбинация с первого броска («с руки») — на 5 больше; генерал с руки — сразу победа.
 * Покер на костях: без таблицы — кон за коном все бросают до трёх раз, старшая комбинация берёт кон; до N побед.
 * Порядок: ничего < пара < две пары < тройка < малый стрит (1–5) < большой стрит (2–6) < фулл < каре < покер.
 */
import type { Options, Rng } from '../../core/types';

export type Variant = 'yahtzee' | 'generala' | 'poker';

export interface Cfg {
  variant: Variant;
  /** Покер: до скольких выигранных конов. */
  wins: number;
}

export function cfgFrom(o: Options): Cfg {
  const variant: Variant = o.variant === 'generala' || o.variant === 'poker' ? o.variant : 'yahtzee';
  return { variant, wins: [3, 5, 7].includes(Number(o.wins)) ? Number(o.wins) : 3 };
}

export type Cat = 'n1' | 'n2' | 'n3' | 'n4' | 'n5' | 'n6' | 'three' | 'four' | 'full' | 'small' | 'large' | 'yahtzee' | 'chance' | 'straight' | 'poker' | 'generala' | 'double';

export const UPPER: Cat[] = ['n1', 'n2', 'n3', 'n4', 'n5', 'n6'];
export const CATS: Record<'yahtzee' | 'generala', Cat[]> = {
  yahtzee: [...UPPER, 'three', 'four', 'full', 'small', 'large', 'yahtzee', 'chance'],
  generala: [...UPPER, 'straight', 'full', 'poker', 'generala', 'double'],
};

export const CAT_NAME: Record<Cat, string> = {
  n1: 'Единицы',
  n2: 'Двойки',
  n3: 'Тройки',
  n4: 'Четвёрки',
  n5: 'Пятёрки',
  n6: 'Шестёрки',
  three: 'Тройка',
  four: 'Каре',
  full: 'Фулл-хаус',
  small: 'Малый стрит',
  large: 'Большой стрит',
  yahtzee: 'Яхтзи',
  chance: 'Шанс',
  straight: 'Стрит',
  poker: 'Покер',
  generala: 'Генерал',
  double: 'Двойной генерал',
};

export const counts = (d: number[]) => {
  const c = [0, 0, 0, 0, 0, 0, 0];
  for (const x of d) c[x]++;
  return c;
};
const sum = (d: number[]) => d.reduce((a, b) => a + b, 0);
const hasRun = (c: number[], from: number, len: number) => {
  for (let i = from; i < from + len; i++) if (!c[((i - 1) % 6) + 1]) return false;
  return true;
};
export const isFive = (d: number[]) => d.length === 5 && d.every((x) => x === d[0]);

/** Очки за графу при этих костях. first — бросок был первым (Генерал «с руки»). joker — повторный яхтзи по правилу джокера. */
export function catScore(cat: Cat, d: number[], variant: 'yahtzee' | 'generala', first = false, joker = false): number {
  const c = counts(d);
  const max = Math.max(...c);
  const up = UPPER.indexOf(cat);
  if (up >= 0) return c[up + 1] * (up + 1);
  const full = c.includes(3) && c.includes(2);
  if (variant === 'yahtzee') {
    switch (cat) {
      case 'three':
        return max >= 3 ? sum(d) : 0;
      case 'four':
        return max >= 4 ? sum(d) : 0;
      case 'full':
        return full || joker ? 25 : 0;
      case 'small':
        return joker || hasRun(c, 1, 4) || hasRun(c, 2, 4) || hasRun(c, 3, 4) ? 30 : 0;
      case 'large':
        return joker || hasRun(c, 1, 5) || hasRun(c, 2, 5) ? 40 : 0;
      case 'yahtzee':
        return max === 5 ? 50 : 0;
      case 'chance':
        return sum(d);
    }
    return 0;
  }
  const bonus = first ? 5 : 0;
  switch (cat) {
    case 'straight':
      return hasRun(c, 1, 5) || hasRun(c, 2, 5) || hasRun(c, 3, 5) ? 20 + bonus : 0;
    case 'full':
      return full ? 30 + bonus : 0;
    case 'poker':
      return max >= 4 ? 40 + bonus : 0;
    case 'generala':
      return max === 5 ? 50 : 0;
    case 'double':
      return max === 5 ? 100 : 0;
  }
  return 0;
}

// ---------------------------------------------------------------- покер на костях

export const HAND_NAME = ['ничего', 'пара', 'две пары', 'тройка', 'малый стрит', 'большой стрит', 'фулл', 'каре', 'покер'];

/** Сила руки: [ранг комбинации, затем значения для сравнения по старшинству]. */
export function pokerRank(d: number[]): number[] {
  const c = counts(d);
  const groups: [number, number][] = [];
  for (let v = 6; v >= 1; v--) if (c[v]) groups.push([c[v], v]);
  groups.sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  const vals = groups.map((g) => g[1]);
  if (groups[0][0] === 5) return [8, ...vals];
  if (groups[0][0] === 4) return [7, ...vals];
  if (groups[0][0] === 3 && groups[1][0] === 2) return [6, ...vals];
  if (c[1] && c[2] && c[3] && c[4] && c[5] && !c[6]) return [4];
  if (c[2] && c[3] && c[4] && c[5] && c[6] && !c[1]) return [5];
  if (groups[0][0] === 3) return [3, ...vals];
  if (groups[0][0] === 2 && groups[1][0] === 2) return [2, ...vals];
  if (groups[0][0] === 2) return [1, ...vals];
  return [0, ...vals];
}

export function cmpRank(a: number[], b: number[]): number {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

// ---------------------------------------------------------------- состояние

export interface State {
  cfg: Cfg;
  seats: number[];
  turn: number;
  dice: number[];
  held: boolean[];
  /** Сколько бросков сделано в этом ходу (0 — ещё не бросал). */
  rolls: number;
  /** Таблица: графа → очки (null — пусто). */
  sheet: Record<string, number | null>[];
  /** Бонус за повторные яхтзи. */
  ybonus: number[];
  /** Ходов сделано всеми (для номера круга). */
  moves: number;
  /** Покер: победы и итог текущего кона (лучшие кости каждого). */
  wins: number[];
  hands: (number[] | null)[];
  pround: number;
  /** Генерал с руки — мгновенная победа. */
  instant: number | null;
  over: boolean;
  /** Последний итог кона покера — для показа. */
  last: { winners: number[]; hands: (number[] | null)[] } | null;
}

export type Action = { type: 'roll'; hold?: boolean[] } | { type: 'score'; cat: Cat } | { type: 'stand' };

export type Event =
  | { type: 'roll'; seat: number; dice: number[]; held: boolean[]; n: number }
  | { type: 'score'; seat: number; cat: Cat; pts: number; bonus: number; dice: number[] }
  | { type: 'instant'; seat: number }
  | { type: 'stand'; seat: number; dice: number[]; rank: number[] }
  | { type: 'pround'; winners: number[]; hands: (number[] | null)[]; wins: number[] }
  | { type: 'end'; winners: number[] };

const nextIn = (list: number[], seat: number) => list[(list.indexOf(seat) + 1) % list.length];

export const catsOf = (cfg: Cfg): Cat[] => (cfg.variant === 'poker' ? [] : CATS[cfg.variant]);

export function newState(cfg: Cfg, seats: number[]): State {
  const sheet = [0, 1, 2, 3, 4, 5].map(() => Object.fromEntries(catsOf(cfg).map((c) => [c, null])) as Record<string, number | null>);
  return {
    cfg,
    seats: seats.slice(),
    turn: seats[0],
    dice: [1, 2, 3, 4, 5],
    held: [false, false, false, false, false],
    rolls: 0,
    sheet,
    ybonus: [0, 0, 0, 0, 0, 0],
    moves: 0,
    wins: [0, 0, 0, 0, 0, 0],
    hands: [null, null, null, null, null, null],
    pround: 1,
    instant: null,
    over: false,
    last: null,
  };
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  const s = newState(cfgFrom(opts), seats);
  // первым ходит выбросивший больше (кубик по кругу) — здесь просто по жребию
  s.turn = seats[rng.int(seats.length)];
  return s;
}

export const toAct = (s: State): number[] => (s.over ? [] : [s.turn]);

export function upperSum(sh: Record<string, number | null>) {
  return UPPER.reduce((a, c) => a + (sh[c] ?? 0), 0);
}

export function total(s: State, seat: number): number {
  if (s.cfg.variant === 'poker') return s.wins[seat];
  const sh = s.sheet[seat];
  const all = catsOf(s.cfg).reduce((a, c) => a + (sh[c] ?? 0), 0);
  const bonus = s.cfg.variant === 'yahtzee' && upperSum(sh) >= 63 ? 35 : 0;
  return all + bonus + s.ybonus[seat];
}

/** Повторный яхтзи по правилу джокера: куда можно записать. */
export function jokerCats(s: State, seat: number): Cat[] | null {
  if (s.cfg.variant !== 'yahtzee' || !isFive(s.dice) || s.sheet[seat].yahtzee == null) return null;
  const sh = s.sheet[seat];
  const own = UPPER[s.dice[0] - 1];
  if (sh[own] == null) return [own];
  const low = (['three', 'four', 'full', 'small', 'large', 'chance'] as Cat[]).filter((c) => sh[c] == null);
  if (low.length) return low;
  return UPPER.filter((c) => sh[c] == null);
}

/** Куда можно записать сейчас и сколько. */
export function options(s: State, seat: number): { cat: Cat; pts: number }[] {
  if (s.cfg.variant === 'poker' || s.rolls === 0) return [];
  const sh = s.sheet[seat];
  const jk = jokerCats(s, seat);
  const v = s.cfg.variant;
  const free = catsOf(s.cfg).filter((c) => sh[c] == null);
  // двойной генерал пишется, только когда генерал уже записан (не нулём)
  const ok = free.filter((c) => c !== 'double' || (sh.generala ?? 0) > 0);
  const list = jk ?? (ok.length ? ok : free);
  return list.map((cat) => ({ cat, pts: catScore(cat, s.dice, v, s.rolls === 1, !!jk) }));
}

function rollDice(s: State, hold: boolean[], rng: Rng) {
  const held = s.rolls === 0 ? [false, false, false, false, false] : hold.map((x) => !!x);
  s.dice = s.dice.map((d, i) => (held[i] ? d : 1 + rng.int(6)));
  s.held = held;
  s.rolls++;
}

function nextTurn(s: State) {
  s.turn = nextIn(s.seats, s.turn);
  s.rolls = 0;
  s.held = [false, false, false, false, false];
}

function finishTable(s: State, ev: Event[]) {
  const done = s.seats.every((p) => catsOf(s.cfg).every((c) => s.sheet[p][c] != null));
  if (!done) return;
  s.over = true;
  const top = Math.max(...s.seats.map((p) => total(s, p)));
  ev.push({ type: 'end', winners: s.seats.filter((p) => total(s, p) === top) });
}

function pokerStand(s: State, seat: number, ev: Event[]) {
  s.hands[seat] = s.dice.slice();
  ev.push({ type: 'stand', seat, dice: s.dice.slice(), rank: pokerRank(s.dice) });
  if (s.seats.every((p) => s.hands[p])) {
    // кон: старшая рука
    let best: number[] | null = null;
    for (const p of s.seats) if (!best || cmpRank(pokerRank(s.hands[p]!), best) > 0) best = pokerRank(s.hands[p]!);
    const winners = s.seats.filter((p) => cmpRank(pokerRank(s.hands[p]!), best!) === 0);
    // ничья — кон никому
    if (winners.length === 1) s.wins[winners[0]]++;
    s.last = { winners, hands: s.hands.slice() };
    ev.push({ type: 'pround', winners, hands: s.hands.slice(), wins: s.wins.slice() });
    s.hands = [null, null, null, null, null, null];
    const champ = s.seats.filter((p) => s.wins[p] >= s.cfg.wins);
    if (champ.length) {
      s.over = true;
      ev.push({ type: 'end', winners: champ });
      return;
    }
    s.pround++;
    // следующий кон начинает следующий по кругу за начинавшим
    nextTurn(s);
    return;
  }
  nextTurn(s);
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.over || seat !== s0.turn || !a || typeof a !== 'object') return null;
  const s: State = { ...s0, dice: s0.dice.slice(), held: s0.held.slice(), sheet: s0.sheet.map((x) => ({ ...x })), ybonus: s0.ybonus.slice(), wins: s0.wins.slice(), hands: s0.hands.slice() };
  const ev: Event[] = [];
  if (a.type === 'roll') {
    if (s.rolls >= 3) return null;
    const hold = Array.isArray(a.hold) && a.hold.length === 5 ? a.hold : [false, false, false, false, false];
    if (s.rolls > 0 && hold.every(Boolean)) return null;
    rollDice(s, hold, rng);
    ev.push({ type: 'roll', seat, dice: s.dice.slice(), held: s.held.slice(), n: s.rolls });
    if (s.cfg.variant === 'generala' && s.rolls === 1 && isFive(s.dice)) {
      // генерал с руки — сразу победа
      s.instant = seat;
      s.over = true;
      ev.push({ type: 'instant', seat }, { type: 'end', winners: [seat] });
      return { state: s, events: ev };
    }
    if (s.cfg.variant === 'poker' && s.rolls === 3) pokerStand(s, seat, ev);
    return { state: s, events: ev };
  }
  if (a.type === 'stand') {
    if (s.cfg.variant !== 'poker' || s.rolls === 0) return null;
    pokerStand(s, seat, ev);
    return { state: s, events: ev };
  }
  if (a.type === 'score') {
    const opt = options(s, seat).find((o) => o.cat === a.cat);
    if (!opt) return null;
    let bonus = 0;
    if (s.cfg.variant === 'yahtzee' && isFive(s.dice) && (s.sheet[seat].yahtzee ?? 0) > 0) {
      bonus = 100;
      s.ybonus[seat] += 100;
    }
    s.sheet[seat][a.cat] = opt.pts;
    s.moves++;
    ev.push({ type: 'score', seat, cat: a.cat, pts: opt.pts, bonus, dice: s.dice.slice() });
    nextTurn(s);
    finishTable(s, ev);
    return { state: s, events: ev };
  }
  return null;
}

export const makeView = (s: State): State => s;
