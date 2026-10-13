/**
 * «Корона Эмбера» — движок (первая версия: поле 1 и выход в Эмбер).
 *
 * Ход: бросок кубика — сколько полей пройти, шаг — только к соседу по сетке (roads.json;
 * на поле 1 клетки это панели, дорог нет), между мирами переход по знакам «⇄» и «↕» из links.json.
 * Клетки: обменный пункт (обмен характеристик и покупка), лазарет (лечение ПЖ), ПРОВАЛ (выход
 * в Королевство Эмбер при 13 по всем характеристикам и без поклажи), лицей (таблица учения),
 * ведьмин луг (нечисть +1 ПМ, добрые +1 ПЖ), прочие — взятие карточек приключений.
 *
 * Что ещё не сделано (следующие заходы): бои по карточкам, торговый каталог и 70 предметов,
 * поле 2 (лабиринт, покои, тронный зал с коронацией, арена). Тексты карточек уже вынуты
 * (cards.json), номера и картинки на месте.
 */
import type { Rng } from '../../core/types';
import { CELLS, LINKS, PLAY_CELLS, ZONES, cardByNumber, cell, cellsOfWorld, linksOf, worldOf } from './data';
import { CELL_RULES, DECK_SIZE, LIFE_MAX, PACK_LIMIT, START, START_LIFE, START_THALERS, STATS, type Stat } from './rules';

export interface Seat {
  seat: number;
  kind: 'human' | 'bot';
  name: string;
  level?: number;
}

export interface Hero {
  /** клетка на поле 1 */
  cell: number;
  /** жизни */
  life: number;
  /** характеристики */
  st: Record<Stat, number>;
  /** талеры */
  thalers: number;
  /** предметы (индексы карточек предметов) */
  items: number[];
  /** в Эмбер (поля 2) */
  ember: boolean;
}

export type Phase = 'roll' | 'step' | 'card' | 'over';

export interface State {
  seats: number[];
  kinds: Record<number, 'human' | 'bot'>;
  names: Record<number, string>;
  levels: Record<number, number>;
  heroes: Record<number, Hero>;
  turn: number;
  phase: Phase;
  die: number;
  left: number;
  deck: number[];
  /** показанная карточка (её номер в колоде) */
  card: number | null;
  log: string[];
  winner: number | null;
}

export type Action =
  | { type: 'roll' }
  | { type: 'step'; to: number }
  | { type: 'exchange'; from: Stat; to: Stat }
  | { type: 'heal'; life: number }
  | { type: 'ok' }
  | { type: 'fall' };

export type Event =
  | { type: 'roll'; seat: number; die: number }
  | { type: 'step'; seat: number; cell: number }
  | { type: 'card'; seat: number; num: number | null; text: string }
  | { type: 'money'; seat: number; delta: number }
  | { type: 'stat'; seat: number; stat: Stat; delta: number }
  | { type: 'life'; seat: number; delta: number }
  | { type: 'fall'; seat: number; ok: boolean }
  | { type: 'turn'; seat: number }
  | { type: 'over'; winner: number };

export interface X {
  ev: Event[];
}

/** Соседи по сетке + знаки между мирами. */
const NEIGH: Record<number, number[]> = {};
{
  // Сетку строим по настоящим координатам клеток, а не по столбцу/ряду из отчёта:
  // там встречаются коллизии (две клетки в одной позиции), из-за которых клетка
  // оставалась без соседей. Центры клеток clustering-ом разбиваем на столбцы и ряды.
  const list = PLAY_CELLS.filter((c) => c.w >= 100);
  const cx = list.map((c) => c.x + c.w / 2);
  const cy = list.map((c) => c.y + c.h / 2);
  const cluster = (vals: number[], tol: number): number[] => {
    const sorted = [...vals].sort((a, b) => a - b);
    const idx: number[] = [];
    let last = -1e9;
    let k = -1;
    for (const v of sorted) {
      if (v - last > tol) {
        k += 1;
        last = v;
      }
      idx.push(k);
    }
    const map = new Map<number, number>();
    sorted.forEach((v, i) => map.set(v, idx[i]));
    return vals.map((v) => map.get(v) ?? 0);
  };
  const sizes = list.map((c) => Math.min(c.w, c.h));
  const step = sizes.sort((a, b) => a - b)[Math.floor(sizes.length / 2)] || 220;
  const cols = cluster(cx, step * 0.6);
  const rows = cluster(cy, step * 0.6);
  const grid = new Map<string, number>();
  list.forEach((c, i) => grid.set(`${cols[i]},${rows[i]}`, c.n));
  for (const [key, n] of grid) {
    const [col, row] = key.split(',').map(Number);
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const m = grid.get(`${col + dc},${row + dr}`);
      if (m && m !== n) {
        NEIGH[n] = NEIGH[n] ?? [];
        if (!NEIGH[n].includes(m)) NEIGH[n].push(m);
      }
    }
  }
  // знаки «⇄» и стрелки «↕» связывают клетки разных миров (в том числе межмировые)
  for (const l of LINKS) {
    if (l.from == null || l.to == null || l.from === l.to) continue;
    for (const [a, b] of [[l.from, l.to], [l.to, l.from]] as const) {
      NEIGH[a] = NEIGH[a] ?? [];
      if (!NEIGH[a].includes(b)) NEIGH[a].push(b);
    }
  }
  for (const n of Object.keys(NEIGH)) NEIGH[Number(n)].sort((a, b) => a - b);
}

export const neighbours = (n: number): number[] => NEIGH[n] ?? [];

/** Вид клетки по её названию (в отчёте названия — единственный признак типа). */
export function kindOf(n: number): 'exchange' | 'hospital' | 'fall' | 'lyceum' | 'meadow' | 'plain' {
  const c = cell(n);
  const name = (c?.name ?? '').toUpperCase();
  if (name.includes('ОБМЕННЫЙ')) return 'exchange';
  if (name.includes('ЛАЗАРЕТ')) return 'hospital';
  if (name.includes('ПРОВАЛ')) return 'fall';
  if (name.includes('ЛИЦЕЙ')) return 'lyceum';
  if (name.includes('ВЕДЬМИН') || name.includes('РОЩА')) return 'meadow';
  return 'plain';
}

const START_CELL = PLAY_CELLS.reduce((best, c) => (c.y > best.y || (c.y === best.y && c.x < best.x) ? c : best), PLAY_CELLS[0]).n;

export function newState(seats: Seat[], opts: { deck?: number } = {}, rng?: Rng): State {
  const ids = seats.map((s) => s.seat).sort((a, b) => a - b);
  const heroes: Record<number, Hero> = {};
  const kinds: Record<number, 'human' | 'bot'> = {};
  const names: Record<number, string> = {};
  const levels: Record<number, number> = {};
  for (const s of seats) {
    heroes[s.seat] = { cell: START_CELL, life: START_LIFE, st: { ...START }, thalers: START_THALERS, items: [], ember: false };
    kinds[s.seat] = s.kind;
    names[s.seat] = s.name;
    levels[s.seat] = s.level ?? 2;
  }
  const deckSize = Math.min(opts.deck ?? DECK_SIZE, DECK_SIZE);
  const deck = Array.from({ length: deckSize }, (_, i) => i + 1);
  const r = rng ?? ({ int: (n: number) => Math.floor(Math.random() * n) } as Rng);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = r.int(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return {
    seats: ids,
    kinds,
    names,
    levels,
    heroes,
    turn: ids[0],
    phase: 'roll',
    die: 0,
    left: 0,
    deck,
    card: null,
    log: ['Караван вышел из ворот.'],
    winner: null,
  };
}

const pass = (s: State, x: X): State => {
  const i = s.seats.indexOf(s.turn);
  const next = s.seats[(i + 1) % s.seats.length];
  const st: State = { ...s, turn: next, phase: 'roll', die: 0, left: 0, card: null };
  x.ev.push({ type: 'turn', seat: next });
  return st;
};

const give = (s: State, x: X, seat: number, stat: Stat, d: number): State => {
  const h = s.heroes[seat];
  const v = Math.max(0, h.st[stat] + d);
  x.ev.push({ type: 'stat', seat, stat, delta: v - h.st[stat] });
  return { ...s, heroes: { ...s.heroes, [seat]: { ...h, st: { ...h.st, [stat]: v } } } };
};

const money = (s: State, x: X, seat: number, d: number): State => {
  const h = s.heroes[seat];
  const v = Math.max(0, h.thalers + d);
  x.ev.push({ type: 'money', seat, delta: v - h.thalers });
  return { ...s, heroes: { ...s.heroes, [seat]: { ...h, thalers: v } } };
};

const life = (s: State, x: X, seat: number, d: number): State => {
  const h = s.heroes[seat];
  const v = Math.min(LIFE_MAX, Math.max(0, h.life + d));
  x.ev.push({ type: 'life', seat, delta: v - h.life });
  return { ...s, heroes: { ...s.heroes, [seat]: { ...h, life: v } } };
};

/** Сойти на клетку: выполняем её правила. */
function arrive(s: State, x: X, seat: number): State {
  const h = s.heroes[seat];
  const kind = kindOf(h.cell);
  let st = s;
  if (kind === 'exchange') {
    // вход стоит 5 талеров, если ничего не меняешь и не покупаешь
    st = money(st, x, seat, h.thalers >= CELL_RULES.exchange.entryFine ? -CELL_RULES.exchange.entryFine : 0);
    st = { ...st, phase: 'card' };
    x.ev.push({ type: 'card', seat, num: null, text: 'ОБМЕННЫЙ ПУНКТ: можно обменять характеристики или купить за 5 талеров. Вход — 5 талеров.' });
    return st;
  }
  if (kind === 'hospital') {
    const fee = h.life < CELL_RULES.hospital.healTo ? (CELL_RULES.hospital.healTo - h.life) * CELL_RULES.hospital.pricePerLife : 0;
    if (fee > 0 && h.thalers >= fee) {
      st = money(st, x, seat, -fee);
      st = life(st, x, seat, CELL_RULES.hospital.healTo - h.life);
    }
    st = { ...st, phase: 'card' };
    x.ev.push({ type: 'card', seat, num: null, text: `ЛАЗАРЕТ: лечат до ${CELL_RULES.hospital.healTo} ПЖ по ${CELL_RULES.hospital.pricePerLife} талера за ПЖ.` });
    return st;
  }
  if (kind === 'fall') {
    const need = CELL_RULES.fall.need;
    const ready = STATS.every((k) => h.st[k] >= need) && h.items.length === 0;
    x.ev.push({ type: 'fall', seat, ok: ready });
    if (ready) {
      st = { ...st, phase: 'over', winner: seat, log: [...st.log, `${s.names[seat]} вышел в Королевство Эмбер.`] };
      x.ev.push({ type: 'over', winner: seat });
      return st;
    }
    st = give(st, x, seat, 'ПУ', -1);
    st = { ...st, phase: 'card' };
    x.ev.push({ type: 'card', seat, num: null, text: `ПРОВАЛ: нужен ${need} по всем характеристикам и пустая котомка. Не вышел — теряешь 1 ПУ.` });
    return st;
  }
  if (kind === 'meadow') {
    st = life(st, x, seat, CELL_RULES.witchMeadow.goodLife);
    st = draw(st, x, seat);
    return st;
  }
  if (kind === 'lyceum') {
    const d1 = 1 + (s.turn % 6);
    const d2 = 1 + ((s.turn + 3) % 6);
    const sum = d1 + d2;
    const table: Record<number, [Stat, number][]> = {
      2: [['ПС', -2]],
      3: [['ПУ', -999]],
      5: [['ПУ', -2]],
      6: [['ПУ', -2], ['ПМ', -2]],
      7: [['ПС', -1], ['ПУ', -1], ['ПМ', -1]],
      8: [['ПУ', 2]],
      9: [['ПУ', 2], ['ПМ', 1]],
      10: [['ПУ', 2], ['ПМ', 2]],
      11: [['ПС', 2], ['ПУ', 2], ['ПМ', 2]],
      12: [['ПС', 2], ['ПУ', 2], ['ПМ', 2]],
    };
    for (const [stat, d] of table[sum] ?? []) st = give(st, x, seat, stat, d === -999 ? -st.heroes[seat].st[stat] : d);
    st = { ...st, phase: 'card' };
    x.ev.push({ type: 'card', seat, num: null, text: `ЛИЦЕЙ: выпало ${d1} и ${d2} (сумма ${sum}).` });
    return st;
  }
  return draw(st, x, seat);
}

/** Взять карточку приключений. */
function draw(s: State, x: X, seat: number): State {
  if (!s.deck.length) return pass(s, x);
  const deck = [...s.deck];
  const num = deck.shift()!;
  const c = cardByNumber(num);
  const text = c?.text ?? `Карточка №${num}`;
  x.ev.push({ type: 'card', seat, num, text });
  const st: State = { ...s, deck, card: num, phase: 'card', log: [...s.log, `${s.names[seat]}: ${text.slice(0, 80)}`] };
  return st;
}

export function apply(s: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s.winner != null || seat !== s.turn) return null;
  const x: X = { ev: [] };
  const h = s.heroes[seat];
  if (a.type === 'roll') {
    if (s.phase !== 'roll') return null;
    const die = 1 + rng.int(6);
    x.ev.push({ type: 'roll', seat, die });
    let st: State = { ...s, die, left: die, phase: 'step' };
    const here = kindOf(h.cell);
    if (here === 'exchange' || here === 'hospital' || here === 'fall') {
      // на таких клетках сначала разбираемся с полем
      st = arrive(st, x, seat);
      if (st.phase === 'card') return { state: st, events: x.ev };
    }
    return { state: st, events: x.ev };
  }
  if (a.type === 'step') {
    if (s.phase !== 'step' || s.left <= 0) return null;
    if (!neighbours(h.cell).includes(a.to)) return null;
    const heroes = { ...s.heroes, [seat]: { ...h, cell: a.to } };
    x.ev.push({ type: 'step', seat, cell: a.to });
    let st: State = { ...s, heroes, left: s.left - 1 };
    if (st.left === 0) {
      st = arrive(st, x, seat);
      if (st.phase !== 'card') st = pass(st, x);
    }
    return { state: st, events: x.ev };
  }
  if (a.type === 'exchange') {
    if (kindOf(h.cell) !== 'exchange') return null;
    const from = h.st[a.from];
    if (from < 2) return null;
    let st = give(s, x, seat, a.from, -2);
    st = give(st, x, seat, a.to, 1);
    return { state: st, events: x.ev };
  }
  if (a.type === 'heal') {
    if (kindOf(h.cell) !== 'hospital') return null;
    const want = Math.min(a.life, CELL_RULES.hospital.healTo - h.life);
    if (want <= 0) return null;
    const fee = want * CELL_RULES.hospital.pricePerLife;
    if (h.thalers < fee) return null;
    let st = money(s, x, seat, -fee);
    st = life(st, x, seat, want);
    return { state: st, events: x.ev };
  }
  if (a.type === 'fall') {
    if (kindOf(h.cell) !== 'fall') return null;
    return apply(s, seat, { type: 'ok' }, rng);
  }
  if (a.type === 'ok') {
    if (s.phase !== 'card') return null;
    const st = pass({ ...s, card: null }, x);
    return { state: st, events: x.ev };
  }
  return null;
}

/** Кто ходит и что может. */
export function status(s: State): { seat: number; phase: Phase; die: number; left: number } {
  return { seat: s.turn, phase: s.phase, die: s.die, left: s.left };
}

/** Итог партии: победитель вышел в Эмбер (в первой версии — этим партия и кончается). */
export function result(s: State): { winner: number; text: string; scores: number[] } | null {
  if (s.winner == null) return null;
  const scores = s.seats.map((seat) => {
    const h = s.heroes[seat];
    return h.thalers + STATS.reduce((sum, k) => sum + h.st[k], 0) * 5 + h.life * 10;
  });
  return {
    winner: s.winner,
    text: `${s.names[s.winner]} вышел в Королевство Эмбер. До коронации дело дойдёт на поле 2.`,
    scores,
  };
}

/** Сколько предметов влезает в котомку. */
export const packFree = (h: Hero): number => Math.max(0, PACK_LIMIT - h.items.length);

/** Подсказка для вида: клетки, куда можно шагнуть сейчас. */
export const stepTargets = (s: State, seat: number): number[] => (s.phase === 'step' ? neighbours(s.heroes[seat].cell) : []);

/** Список миров и клеток — для отладки и ботов. */
export const worldCells = cellsOfWorld;
export { ZONES, worldOf, linksOf, cardByNumber, CELLS };
