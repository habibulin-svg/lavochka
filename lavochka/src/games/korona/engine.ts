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
  /** жизни принца на поле 2 (отдельный счётчик, при входе в лабиринт остаётся только он) */
  pj: number;
  /** стал принцем в столице Эмбера */
  prince: boolean;
  /** где герой на поле 2 */
  zone: 'capital' | 'labyrinth' | 'palace' | 'chambers' | 'throne' | 'arena';
  /** кольцо лабиринта: 0 — внешнее, 2 — внутреннее */
  ring: number;
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
  | { type: 'stop' }
  | { type: 'exchange'; from: Stat; to: Stat }
  | { type: 'buyStat'; stat: Stat }
  | { type: 'heal'; life: number }
  | { type: 'ok' }
  | { type: 'fall' }
  // поле 2 «Королевство Эмбер»
  | { type: 'prince' }
  | { type: 'labyrinth' }
  | { type: 'ringRoll' }
  | { type: 'toPalace' }
  | { type: 'toChambers' }
  | { type: 'toArena' }
  | { type: 'toThrone' }
  | { type: 'duel'; rolls: [number, number][] }
  | { type: 'coronate' }
  | { type: 'buyPj' }
  | { type: 'exchangePj'; from: Stat };

export type Event =
  | { type: 'roll'; seat: number; die: number }
  | { type: 'step'; seat: number; cell: number }
  | { type: 'card'; seat: number; num: number | null; text: string }
  | { type: 'money'; seat: number; delta: number }
  | { type: 'stat'; seat: number; stat: Stat; delta: number }
  | { type: 'life'; seat: number; delta: number }
  | { type: 'fall'; seat: number; ok: boolean }
  | { type: 'turn'; seat: number }
  | { type: 'pj'; seat: number; delta: number }
  | { type: 'zone'; seat: number; zone: string }
  | { type: 'duel'; seat: number; rolls: [number, number][]; lost: number[] }
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
    heroes[s.seat] = { cell: START_CELL, life: START_LIFE, st: { ...START }, thalers: START_THALERS, items: [], ember: false, pj: 0, prince: false, zone: 'capital', ring: 0 };
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
function arrive(s: State, x: X, seat: number, rng: Rng): State {
  const h = s.heroes[seat];
  const kind = kindOf(h.cell);
  let st = s;
  if (kind === 'exchange') {
    // по правилам вход стоит 5 талеров, только если ничего не меняешь и не покупаешь;
    // в упрощённой версии плату не берём вовсе, иначе покупка характеристик не окупается
    st = { ...st, phase: 'card' };
    x.ev.push({ type: 'card', seat, num: null, text: 'ОБМЕННЫЙ ПУНКТ: можно обменять характеристики или купить за 5 талеров. Вход — 5 талеров.' });
    return st;
  }
  if (kind === 'hospital') {
    // «бесплатно лечат только безумных (ПУ равны 0) и восстанавливают ПУ до 3»
    if (h.st['ПУ'] === 0) st = give(st, x, seat, 'ПУ', CELL_RULES.hospital.madRestorePu);
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
      // не конец партии: герой уходит на поле 2 и становится принцем в столице
      const hero2 = { ...st.heroes[seat], ember: true, zone: 'capital' as const, prince: false, pj: 0, ring: 0, items: [] };
      x.ev.push({ type: 'zone', seat, zone: 'capital' });
      st = { ...st, heroes: { ...st.heroes, [seat]: hero2 }, phase: 'card', log: [...st.log, `${s.names[seat]} вышел в столицу Королевства Эмбер.`] };
      x.ev.push({ type: 'card', seat, num: null, text: 'СТОЛИЦА КОРОЛЕВСТВА ЭМБЕР. Ты становишься Принцем: возьми карту принца (свои ПС, ПУ, ПМ и ПЖ прибавляются к его качествам), предметы, амулеты и деньги сохраняются. Перед входом в лабиринт можно обменять 5 характеристик на 1 ПЖ или купить 1 ПЖ за 20 талеров.' });
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
      // лицей — место, где герой растёт: на хороших суммах прибавляем и силу, и магию,
      // иначе четвёрку 13 не набрать (упрощение для сборника, в оригинале рост идёт и от карточек)
      8: [['ПУ', 2], ['ПМ', 1]],
      9: [['ПУ', 2], ['ПМ', 1], ['ПС', 1]],
      10: [['ПУ', 2], ['ПМ', 2], ['ПС', 1]],
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
const NUM_WORDS: Record<string, number> = { один: 1, одна: 1, два: 2, две: 2, три: 3, четыре: 4, пять: 5, шесть: 6 };

/** Эффект карточки по её тексту: «возьми 2 ПУ», «теряешь 1ПС», «получи 5 талеров». */
function cardEffect(s: State, x: X, seat: number, text: string): State {
  let st = s;
  const t = text.replace(/\s+/g, ' ');
  const statOf = (w: string): Stat | null => {
    const u = w.toUpperCase();
    return (['ПС', 'ПУ', 'ПМ', 'ПО'] as Stat[]).find((k) => u.startsWith(k)) ?? null;
  };
  const num = (w: string): number => (/^\d+$/.test(w) ? Number(w) : (NUM_WORDS[w.toLowerCase()] ?? 1));
  const add = /(возьми|возьмите|получи|получишь|возьми себе|прибавь)\s+(\d+|один|одна|два|две|три|четыре|пять|шесть)\s*(ПС|ПУ|ПМ|ПО|ПЖ|талер\w*)/gi;
  const lose = /(теряешь|потеряешь|отложи|отдай|лишаешься)\s+(\d+|один|одна|два|две|три|четыре|пять|шесть)\s*(ПС|ПУ|ПМ|ПО|ПЖ|талер\w*)/gi;
  for (const m of t.matchAll(add)) {
    const n = num(m[2]);
    const target = m[3].toUpperCase();
    if (target.startsWith('ПЖ')) st = life(st, x, seat, n);
    else if (target.startsWith('ТАЛЕР')) st = money(st, x, seat, n);
    else {
      const k = statOf(target);
      if (k) st = give(st, x, seat, k, n);
    }
  }
  for (const m of t.matchAll(lose)) {
    const n = num(m[2]);
    const target = m[3].toUpperCase();
    if (target.startsWith('ПЖ')) st = life(st, x, seat, -n);
    else if (target.startsWith('ТАЛЕР')) st = money(st, x, seat, -n);
    else {
      const k = statOf(target);
      if (k) st = give(st, x, seat, k, -n);
    }
  }
  return st;
}

function draw(s: State, x: X, seat: number): State {
  if (!s.deck.length) return pass(s, x);
  const deck = [...s.deck];
  const num = deck.shift()!;
  const c = cardByNumber(num);
  const text = c?.text ?? `Карточка №${num}`;
  x.ev.push({ type: 'card', seat, num, text });
  const withEffect = cardEffect(s, x, seat, text);
  const st: State = { ...withEffect, deck, card: num, phase: 'card', log: [...s.log, `${s.names[seat]}: ${text.slice(0, 80)}`] };
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
    // клетка срабатывает не при броске, а когда движение по ней закончилось
    // (arrive вызывается при left === 0 или по «остановиться» после шага)
    const st: State = { ...s, die, left: die, phase: 'step' };
    return { state: st, events: x.ev };
  }
  if (a.type === 'step') {
    if (s.phase !== 'step' || s.left <= 0) return null;
    if (!neighbours(h.cell).includes(a.to)) return null;
    const heroes = { ...s.heroes, [seat]: { ...h, cell: a.to } };
    x.ev.push({ type: 'step', seat, cell: a.to });
    let st: State = { ...s, heroes, left: s.left - 1 };
    if (st.left === 0) {
      st = arrive(st, x, seat, rng);
      if (st.phase !== 'card') st = pass(st, x);
    }
    return { state: st, events: x.ev };
  }
  if (a.type === 'stop') {
    if (s.phase !== 'step') return null;
    // клетка срабатывает, только если в этот ход на неё пришли: стоять и «собирать» её нельзя
    const moved = s.left < s.die;
    let st = moved ? arrive({ ...s, left: 0 }, x, seat, rng) : { ...s, left: 0 };
    if (st.phase !== 'card') st = pass(st, x);
    return { state: st, events: x.ev };
  }
  if (a.type === 'buyStat') {
    // «можешь купить за 5 талеров 1ПС или 1ПУ» — покупка характеристики на обменном пункте
    if (kindOf(h.cell) !== 'exchange') return null;
    if (h.thalers < CELL_RULES.exchange.buyPrice) return null;
    let st = money(s, x, seat, -CELL_RULES.exchange.buyPrice);
    st = give(st, x, seat, a.stat, 1);
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
  // ---- поле 2 «Королевство Эмбер» ----
  if (a.type === 'prince') {
    if (!h.ember || h.prince) return null;
    const st = { ...s, heroes: { ...s.heroes, [seat]: { ...h, prince: true, pj: h.pj || Math.max(2, h.life) } } };
    x.ev.push({ type: 'pj', seat, delta: st.heroes[seat].pj });
    return { state: pass(st, x), events: x.ev };
  }
  if (a.type === 'labyrinth') {
    // при входе в лабиринт остаётся только ПЖ
    if (!h.ember || h.zone !== 'capital') return null;
    const st = { ...s, heroes: { ...s.heroes, [seat]: { ...h, zone: 'labyrinth' as const, ring: 0, items: [], thalers: 0 } } };
    x.ev.push({ type: 'zone', seat, zone: 'labyrinth' });
    return { state: st, events: x.ev };
  }
  if (a.type === 'ringRoll') {
    if (!h.ember || h.zone !== 'labyrinth') return null;
    const die = 1 + rng.int(6);
    // ворота: слева 4-6 взять N ПЖ, справа 1-3 отложить M ПЖ; по кольцам 2/4, 3/5, 1/3
    const table = [
      { take: 2, give: 4 },
      { take: 3, give: 5 },
      { take: 1, give: 3 },
    ][Math.min(h.ring, 2)];
    const left = die >= 4;
    const d = left ? table.take : -table.give;
    const pj = Math.max(0, h.pj + d);
    let st: State = { ...s, heroes: { ...s.heroes, [seat]: { ...h, pj, ring: Math.min(h.ring + 1, 2) } } };
    x.ev.push({ type: 'roll', seat, die });
    x.ev.push({ type: 'pj', seat, delta: pj - h.pj });
    if (pj <= 0) {
      // принц погиб в лабиринте — возвращается в столицу
      st = { ...st, heroes: { ...st.heroes, [seat]: { ...st.heroes[seat], pj: 2, zone: 'capital', ring: 0 } } };
      x.ev.push({ type: 'duel', seat, rolls: [], lost: [seat] });
    } else if (st.heroes[seat].ring === 2 && die >= 4) {
      st = { ...st, heroes: { ...st.heroes, [seat]: { ...st.heroes[seat], zone: 'palace' } } };
      x.ev.push({ type: 'zone', seat, zone: 'palace' });
    }
    return { state: st, events: x.ev };
  }
  if (a.type === 'toPalace') {
    if (!h.ember || h.zone !== 'labyrinth') return null;
    const st = { ...s, heroes: { ...s.heroes, [seat]: { ...h, zone: 'palace' as const } } };
    x.ev.push({ type: 'zone', seat, zone: 'palace' });
    return { state: st, events: x.ev };
  }
  if (a.type === 'toChambers' || a.type === 'toThrone' || a.type === 'toArena') {
    if (!h.ember || h.zone !== 'palace') return null;
    const zone = a.type === 'toChambers' ? 'chambers' : a.type === 'toThrone' ? 'throne' : 'arena';
    const st = { ...s, heroes: { ...s.heroes, [seat]: { ...h, zone: zone as typeof h.zone } } };
    x.ev.push({ type: 'zone', seat, zone });
    return { state: st, events: x.ev };
  }
  if (a.type === 'duel') {
    // поединок принцев: каждый дважды бросает, меньший теряет 1 ПЖ; при равном максимуме
    // максимумы теряют по 1, остальные — столько, сколько максимумов
    if (!h.ember || h.zone !== 'arena') return null;
    const sums = a.rolls.map(([x1, y1]) => x1 + y1);
    const best = Math.max(...sums);
    const tops = sums.filter((v) => v === best).length;
    const heroes = { ...s.heroes };
    const lost: number[] = [];
    s.seats.forEach((other, idx) => {
      const oh = heroes[other];
      if (!oh?.ember) return;
      const mine = sums[idx] ?? 0;
      const d = mine === best ? 1 : tops;
      if (mine === best && tops > 1) {
        // при равном максимуме: они теряют по 1, остальные — по числу максимумов
      }
      const pj = Math.max(0, oh.pj - d);
      if (pj < oh.pj) lost.push(other);
      heroes[other] = { ...oh, pj };
    });
    x.ev.push({ type: 'duel', seat, rolls: a.rolls, lost });
    const alive = s.seats.filter((other) => heroes[other]?.ember && heroes[other].pj > 0);
    let st: State = { ...s, heroes };
    if (alive.length === 1 && heroes[alive[0]].zone === 'arena') {
      st = { ...st, heroes: { ...st.heroes, [alive[0]]: { ...st.heroes[alive[0]], zone: 'chambers' } } };
      x.ev.push({ type: 'zone', seat: alive[0], zone: 'chambers' });
    }
    return { state: st, events: x.ev };
  }
  if (a.type === 'coronate') {
    if (!h.ember || h.zone !== 'throne') return null;
    const st: State = { ...s, winner: seat, phase: 'over', log: [...s.log, `${s.names[seat]} — Владыка Королевства Эмбер.`] };
    x.ev.push({ type: 'over', winner: seat });
    return { state: st, events: x.ev };
  }
  if (a.type === 'buyPj') {
    if (!h.ember || h.thalers < 20) return null;
    const st = money({ ...s, heroes: { ...s.heroes, [seat]: { ...h, pj: h.pj + 1 } } }, x, seat, -20);
    x.ev.push({ type: 'pj', seat, delta: 1 });
    return { state: st, events: x.ev };
  }
  if (a.type === 'exchangePj') {
    if (!h.ember || h.st[a.from] < 5) return null;
    let st = give(s, x, seat, a.from, -5);
    st = { ...st, heroes: { ...st.heroes, [seat]: { ...st.heroes[seat], pj: st.heroes[seat].pj + 1 } } };
    x.ev.push({ type: 'pj', seat, delta: 1 });
    return { state: st, events: x.ev };
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
