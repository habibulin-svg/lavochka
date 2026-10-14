/* «Чудовище Джио-Джанги» — движок экспедиции: сборы, ход по ленте клеток (граф снят с картинки поля,
 * каждая клетка ленты — узел), привалы, карточки ситуаций, болота, переправы, туземцы и враги,
 * съёмка и охота, возвращение в гостиницу и подсчёт.
 * Без DOM: это гоняет и сервер, и тесты. Картинка поля — public/djio/field.webp (координаты — в пикселях исходника W×H). */
import type { Rng } from '../../core/types';
import data from './data.json';
import {
  ANIMALS, CARDS, CROSSINGS, FOES, FREE_AT_STOP, SHOT_PRICE, START_MONEY, STOPS, itemOf,
  type CardEffect, type ItemId, type StopKind,
} from './rules';

export type CellKind = 'plain' | 'card' | 'swamp' | 'danger' | 'cross' | StopKind;

export interface Cell {
  x: number;
  y: number;
  kind: CellKind;
  next: number[];
  /** Красная клетка: кто здесь (зверь или враг). */
  what?: string;
  /** Тупик у логова зверя: остановка обязательна. */
  lair?: boolean;
}

export const W = (data as { w: number }).w;
export const H = (data as { h: number }).h;
export const CELLS: Cell[] = (data as unknown as { cells: Cell[] }).cells;
export const NEIGH: number[][] = CELLS.map((c) => c.next);
export const HOTEL = CELLS.findIndex((c) => c.kind === 'hotel');
export const isStop = (i: number) => !!STOPS[CELLS[i].kind as StopKind];
export const isAnimal = (i: number) => CELLS[i].kind === 'danger' && !!ANIMALS.find((a) => a.id === CELLS[i].what);

/** Расстояния по ленте (в клетках) от набора клеток. */
export function distFrom(targets: number[]): number[] {
  const d = CELLS.map(() => -1);
  const q: number[] = [];
  for (const t of targets) {
    d[t] = 0;
    q.push(t);
  }
  for (let h = 0; h < q.length; h++) {
    const cur = q[h];
    for (const n of NEIGH[cur]) if (d[n] < 0) {
      d[n] = d[cur] + 1;
      q.push(n);
    }
  }
  return d;
}
export const TO_HOTEL = distFrom([HOTEL]);
export const TO_ANIMAL = distFrom(CELLS.map((_, i) => i).filter(isAnimal));

/** Реки: синие клетки одной переправы (с клетками ленты между ними) — одна группа. Переправа разыгрывается,
 *  когда фишка входит в группу с суши; дальше по той же реке идут без новых бросков. */
export const RIVER: number[] = (() => {
  const g = CELLS.map(() => -1);
  const span = CELLS.map(() => false);
  const parent = CELLS.map((_, i) => i);
  const root = (i: number): number => (parent[i] === i ? i : (parent[i] = root(parent[i])));
  const cross = CELLS.map((c, i) => (c.kind === 'cross' ? i : -1)).filter((i) => i >= 0);
  for (const c of cross) {
    span[c] = true;
    const prev = new Map<number, number>([[c, -1]]);
    let layer = [c];
    for (let d = 0; d < 3; d++) {
      const nx: number[] = [];
      for (const u of layer) for (const n of NEIGH[u]) if (!prev.has(n)) {
        prev.set(n, u);
        nx.push(n);
        if (CELLS[n].kind === 'cross') {
          parent[root(n)] = root(c);
          for (let k = prev.get(n)!; k !== c && k >= 0; k = prev.get(k)!) span[k] = true;
        }
      }
      layer = nx;
    }
  }
  CELLS.forEach((_, i) => {
    if (!span[i]) return;
    // клетка ленты между синими — к той реке, чья синяя клетка рядом
    const c = CELLS[i].kind === 'cross' ? i : cross.find((x) => distFrom([x])[i] <= 3) ?? i;
    g[i] = root(c);
  });
  return g;
})();
/** Вход в реку с суши (или с другой реки). */
export const intoRiver = (from: number, to: number) => RIVER[to] >= 0 && RIVER[from] !== RIVER[to];

export type Phase = 'buy' | 'roll' | 'move' | 'ask' | 'shoot' | 'over';

/** Вопрос игроку: подарок на привале, выбор на карточке, туземцы, переправа, зверь напал. */
export interface Ask {
  kind: 'gift' | 'give' | 'buy' | 'natives' | 'cross' | 'beast';
  options: string[];
  /** Сколько стоит выбор (базар). */
  price?: number;
}

/** Перестрелка: серия выстрелов лучшим оружием. */
export interface Fight {
  foe: string;
  need: number;
  hits: number;
  shots: number;
  /** Враг или карточка: не попал за серию — гибель (зверь же бьёт в ответ). */
  oneShot: boolean;
}

export interface State {
  seats: number[];
  pos: number[];
  money: number[];
  items: ItemId[][];
  /** Шкуры убитых зверей (id зверя). */
  skins: string[][];
  turn: number;
  phase: Phase;
  /** Сборы: кто уже закончил покупать; сколько куплено в этот ход. */
  done: boolean[];
  bought: number;
  /** Сколько предметов за ход покупают на сборах (по правилам — один). */
  perTurn: number;
  /** Ход: сколько шагов осталось, откуда пришли (назад нельзя), где начали. */
  left: number;
  die: number;
  back: number;
  from: number;
  /** Ведёт лошадь на поводу: без прибавки 6. */
  lead: boolean[];
  /** Ждёт эту грань кубика (0 — не ждёт). */
  wait: number[];
  deck: number[];
  /** Последняя открытая карточка. */
  card: number | null;
  ask: Ask | null;
  fight: Fight | null;
  /** Побывал у зверей (или у костра): возвращение в гостиницу закончит игру. */
  away: boolean[];
  /** Сколько раз снимал зверя (боту — пора ли домой). */
  films: number[];
  /** Кто первым дошёл до привала (клетка → место): подарок только первому. */
  first: { [cell: number]: number };
  rounds: number;
  winner: number | null;
  over: boolean;
}

export type Action =
  | { type: 'buy'; item: ItemId }
  | { type: 'sell'; item: ItemId }
  | { type: 'done' }
  | { type: 'roll' }
  | { type: 'film' }
  | { type: 'lead'; on: boolean }
  | { type: 'step'; to: number }
  | { type: 'pick'; pick: string }
  | { type: 'shoot' }
  | { type: 'smoke' };

export type Event =
  | { type: 'buy'; seat: number; item: ItemId; price: number }
  | { type: 'sell'; seat: number; item: ItemId; price: number }
  | { type: 'done'; seat: number }
  | { type: 'roll'; seat: number; die: number; bonus: number }
  | { type: 'step'; seat: number; from: number; to: number; last: boolean }
  | { type: 'stop'; seat: number; cell: number }
  | { type: 'card'; seat: number; card: number }
  | { type: 'money'; seat: number; delta: number; total: number }
  | { type: 'item'; seat: number; item: ItemId; take: boolean }
  | { type: 'gift'; seat: number; item: ItemId }
  | { type: 'wait'; seat: number; die: number; need: number }
  | { type: 'need'; seat: number; item: ItemId; ok: boolean; wait: number }
  | { type: 'swamp'; seat: number; die: number; what: 'bugs' | 'bog'; saved: string }
  | { type: 'rope'; seat: number; dice: number[]; ok: boolean }
  | { type: 'cross'; seat: number; how: string; die: number; ok: boolean; lost: ItemId[] }
  | { type: 'foe'; seat: number; foe: string }
  | { type: 'natives'; seat: number; pick: string }
  | { type: 'beast'; seat: number; die: number; animal: string; calm: boolean }
  | { type: 'film'; seat: number; kind: keyof typeof SHOT_PRICE | null; sum: number; animal: string }
  | { type: 'shoot'; seat: number; die: number; hit: boolean; hits: number; need: number; left: number; foe: string }
  | { type: 'attack'; seat: number; die: number; ok: boolean; animal: string }
  | { type: 'kill'; seat: number; foe: string }
  | { type: 'smoke'; seat: number }
  | { type: 'die'; seat: number; why: string }
  | { type: 'home'; seat: number }
  | { type: 'win'; seat: number; score: number };

const clone = (s: State): State => ({
  ...s,
  pos: s.pos.slice(),
  money: s.money.slice(),
  items: s.items.map((x) => x.slice()),
  skins: s.skins.map((x) => x.slice()),
  done: s.done.slice(),
  lead: s.lead.slice(),
  wait: s.wait.slice(),
  deck: s.deck.slice(),
  away: s.away.slice(),
  films: s.films.slice(),
  first: { ...s.first },
  ask: s.ask ? { ...s.ask, options: s.ask.options.slice() } : null,
  fight: s.fight ? { ...s.fight } : null,
});

const d6 = (rng: Rng) => rng.int(6) + 1;
export const has = (s: State, seat: number, item: ItemId) => s.items[seat].includes(item);
export const hasHorse = (s: State, seat: number) => has(s, seat, 'horse');
const isWeapon = (i: ItemId) => !!itemOf(i).shots;
const isCamera = (i: ItemId) => i === 'photo' || i === 'cine' || i === 'video';
/** Оружие для стрельбы: самое надёжное из имеющегося. */
export function bestWeapon(s: State, seat: number): ItemId | null {
  const list = s.items[seat].filter(isWeapon);
  if (!list.length) return null;
  const power = (i: ItemId) => (itemOf(i).shots ?? 0) * (itemOf(i).hits?.length ?? 0);
  return list.reduce((a, b) => (power(b) > power(a) ? b : a));
}
/** Серия выстрелов: два револьвера — стреляют двумя руками, серия вдвое. */
export function seriesOf(s: State, seat: number): number {
  const w = bestWeapon(s, seat);
  if (!w) return 0;
  const n = itemOf(w).shots ?? 1;
  return w === 'revolver' && s.items[seat].filter((i) => i === 'revolver').length > 1 ? n * 2 : n;
}
/** Лучший аппарат для съёмки. */
export const camera = (s: State, seat: number): keyof typeof SHOT_PRICE | null =>
  has(s, seat, 'video') ? 'video' : has(s, seat, 'cine') ? 'cine' : has(s, seat, 'photo') ? 'photo' : null;
/** Счёт игрока: деньги, шкуры и снаряжение по ценам покупки. */
export const scoreOf = (s: State, seat: number) =>
  s.money[seat] +
  s.skins[seat].reduce((sum, id) => sum + (ANIMALS.find((a) => a.id === id)?.skin ?? 0), 0) +
  s.items[seat].reduce((sum, i) => sum + itemOf(i).price, 0);
/** Сколько карточек предмета ещё не разобрано. */
export const leftOf = (s: State, item: ItemId) => itemOf(item).count - s.seats.reduce((n, x) => n + s.items[x].filter((i) => i === item).length, 0);
/** Что можно купить: есть в наборе и хватает денег (лошадь — одна, аппаратура — по одной каждого вида). */
export function canBuy(s: State, seat: number, item: ItemId): boolean {
  if (leftOf(s, item) <= 0 || s.money[seat] < itemOf(item).price) return false;
  if ((item === 'horse' || isCamera(item)) && has(s, seat, item)) return false;
  return true;
}
/** Где можно купить и продать: гостиница и монастырь. */
export const shopAt = (s: State, seat: number) => {
  const k = CELLS[s.pos[seat]].kind;
  return k === 'hotel' || k === 'monastery';
};

export function newState(seats: number[], rng: Rng, perTurn = 1): State {
  const deck = CARDS.map((c) => c.n);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const n = Math.max(...seats) + 1;
  const arr = <T>(v: () => T) => Array.from({ length: n }, v);
  return {
    seats: seats.slice(),
    pos: arr(() => HOTEL),
    money: arr(() => START_MONEY),
    items: arr(() => [] as ItemId[]),
    skins: arr(() => [] as string[]),
    turn: seats[0],
    phase: 'buy',
    done: arr(() => false),
    bought: 0,
    perTurn,
    left: 0,
    die: 0,
    back: -1,
    from: HOTEL,
    lead: arr(() => false),
    wait: arr(() => 0),
    deck,
    card: null,
    ask: null,
    fight: null,
    away: arr(() => false),
    films: arr(() => 0),
    first: {},
    rounds: 0,
    winner: null,
    over: false,
  };
}

/** Сколько кругов длится экспедиция, если никто так и не вернулся: дальше — подсчёт. */
export const MAX_ROUNDS = 150;

const nextSeat = (s: State, seat: number) => s.seats[(s.seats.indexOf(seat) + 1) % s.seats.length];

function finish(s: State, ev: Event[]) {
  s.over = true;
  s.phase = 'over';
  let best = s.seats[0];
  for (const x of s.seats) if (scoreOf(s, x) > scoreOf(s, best)) best = x;
  s.winner = best;
  ev.push({ type: 'win', seat: best, score: scoreOf(s, best) });
}

/** Передать ход. */
function pass(s: State, seat: number, ev: Event[]) {
  s.ask = null;
  s.fight = null;
  s.left = 0;
  s.back = -1;
  const nx = nextSeat(s, seat);
  if (s.phase === 'buy') {
    // сборы: по кругу, пока все не закончат
    s.bought = 0;
    let t = nx;
    for (let k = 0; k < s.seats.length && s.done[t]; k++) t = nextSeat(s, t);
    if (!s.done[t]) {
      s.turn = t;
      s.phase = 'buy';
      return;
    }
    s.turn = s.seats[0];
    s.phase = 'roll';
    s.rounds = 1;
    return;
  }
  if (nx === s.seats[0]) s.rounds++;
  s.turn = nx;
  s.phase = 'roll';
  if (s.rounds > MAX_ROUNDS) finish(s, ev);
}

function give(s: State, seat: number, item: ItemId, ev: Event[]) {
  if (leftOf(s, item) <= 0) return false;
  if ((item === 'horse' || isCamera(item)) && has(s, seat, item)) return false;
  s.items[seat].push(item);
  ev.push({ type: 'item', seat, item, take: true });
  return true;
}
function take(s: State, seat: number, item: ItemId, ev: Event[]) {
  const i = s.items[seat].indexOf(item);
  if (i < 0) return false;
  s.items[seat].splice(i, 1);
  ev.push({ type: 'item', seat, item, take: false });
  return true;
}
function addMoney(s: State, seat: number, delta: number, ev: Event[]) {
  if (!delta) return;
  s.money[seat] = Math.max(0, s.money[seat] + delta);
  ev.push({ type: 'money', seat, delta, total: s.money[seat] });
}

/** Гибель: всё пропало, экспедиция начинается сначала — из гостиницы с новым кредитом. */
function death(s: State, seat: number, why: string, ev: Event[]) {
  ev.push({ type: 'die', seat, why });
  s.items[seat] = [];
  s.skins[seat] = [];
  s.money[seat] = START_MONEY;
  s.pos[seat] = HOTEL;
  s.away[seat] = false;
  s.films[seat] = 0;
  s.wait[seat] = 0;
  s.lead[seat] = false;
  pass(s, seat, ev);
}

/* ---------------- клетки ---------------- */

/** Начать перестрелку. Стрелять нечем: враг убивает, зверь нападает. */
function startFight(s: State, seat: number, foe: string, need: number, oneShot: boolean, ev: Event[]) {
  const shots = seriesOf(s, seat);
  if (!shots) {
    if (oneShot) {
      death(s, seat, `нечем стрелять — ${foeName(foe)}`, ev);
      return;
    }
    if (beastStrikes(s, seat, foe, ev)) pass(s, seat, ev);
    return;
  }
  s.fight = { foe, need, hits: 0, shots, oneShot };
  s.phase = 'shoot';
}

export const foeName = (id: string) => ANIMALS.find((a) => a.id === id)?.name ?? FOES[id]?.name ?? id;

/** Зверь бьёт в ответ: столько бросков, сколько у него нападений; 4–6 — гибель. Возвращает, жив ли. */
function beastStrikes(s: State, seat: number, foe: string, ev: Event[]): boolean {
  const a = ANIMALS.find((x) => x.id === foe);
  const n = a?.attacks ?? 1;
  for (let i = 0; i < n; i++) {
    const die = d6(rngNow!);
    const ok = die <= 3;
    ev.push({ type: 'attack', seat, die, ok, animal: foeName(foe) });
    if (!ok) {
      death(s, seat, foeName(foe), ev);
      return false;
    }
  }
  return true;
}

/** rng текущего хода: нужен вспомогательным функциям, которые бросают кубик. */
let rngNow: Rng | null = null;

/** Зверь на красной клетке: 1–3 — спокоен, можно снимать; 4–6 — нападает. */
function beast(s: State, seat: number, ev: Event[], rng: Rng) {
  const id = CELLS[s.pos[seat]].what!;
  const a = ANIMALS.find((x) => x.id === id)!;
  s.away[seat] = true;
  const die = d6(rng);
  const calm = die <= 3;
  ev.push({ type: 'beast', seat, die, animal: a.name, calm });
  if (calm) {
    const kind = camera(s, seat);
    const sum = kind ? SHOT_PRICE[kind] * a.rare : 0;
    ev.push({ type: 'film', seat, kind, sum, animal: a.name });
    if (sum) {
      addMoney(s, seat, sum, ev);
      s.films[seat]++;
    }
    pass(s, seat, ev);
    return;
  }
  const opts: string[] = [];
  if (seriesOf(s, seat)) opts.push('shoot');
  if (has(s, seat, 'smoke')) opts.push('smoke');
  if (!opts.length) {
    if (beastStrikes(s, seat, id, ev)) pass(s, seat, ev);
    return;
  }
  s.ask = { kind: 'beast', options: opts };
  s.phase = 'ask';
}

function swamp(s: State, seat: number, ev: Event[], rng: Rng) {
  const die = d6(rng);
  if (die <= 3) {
    // москиты: спецодежда или аптечка спасают, иначе лихорадка — ждать «шестёрку»
    const saved = has(s, seat, 'suit') ? 'спецодежда' : has(s, seat, 'aid') ? 'аптечка' : '';
    ev.push({ type: 'swamp', seat, die, what: 'bugs', saved });
    if (!saved) s.wait[seat] = 6;
    pass(s, seat, ev);
    return;
  }
  // трясина: строго по порядку — лошадь, потом всё, кроме оружия, потом верёвка
  if (hasHorse(s, seat)) {
    ev.push({ type: 'swamp', seat, die, what: 'bog', saved: 'лошадь' });
    take(s, seat, 'horse', ev);
    pass(s, seat, ev);
    return;
  }
  const junk = s.items[seat].filter((i) => !isWeapon(i));
  if (junk.length || s.skins[seat].length) {
    ev.push({ type: 'swamp', seat, die, what: 'bog', saved: 'вещи' });
    for (const it of junk) take(s, seat, it, ev);
    s.skins[seat] = [];
    pass(s, seat, ev);
    return;
  }
  ev.push({ type: 'swamp', seat, die, what: 'bog', saved: 'верёвка' });
  // верёвка: три броска, хоть раз 4–6 — выбрался
  const dice = [d6(rng), d6(rng), d6(rng)];
  const ok = dice.some((d) => d >= 4);
  ev.push({ type: 'rope', seat, dice, ok });
  if (ok) pass(s, seat, ev);
  else death(s, seat, 'трясина', ev);
}

/** Переправа: какие способы доступны. */
export function crossOptions(s: State, seat: number): string[] {
  return CROSSINGS.filter((c) => (c.id === 'boat' ? has(s, seat, 'boat') : s.money[seat] >= c.price)).map((c) => c.id);
}

/** Переправа выбранным способом. Неудача — назад на берег (кроме порогов: там гибель). */
function cross(s: State, seat: number, how: string, ev: Event[], rng: Rng) {
  const c = CROSSINGS.find((x) => x.id === how)!;
  if (c.price) addMoney(s, seat, -c.price, ev);
  const die = d6(rng);
  const ok = !c.bad.includes(die);
  const lost: ItemId[] = [];
  if (!ok && c.id !== 'rapids') {
    // тонет лишнее по усмотрению — отдаём самое дешёвое, кроме лошади
    for (let i = 0; i < c.lose; i++) {
      const junk = s.items[seat].filter((x) => x !== 'horse').sort((a, b) => itemOf(a).price - itemOf(b).price);
      if (!junk.length) break;
      take(s, seat, junk[0], ev);
      lost.push(junk[0]);
    }
    if (c.id === 'boat') take(s, seat, 'boat', ev);
  }
  ev.push({ type: 'cross', seat, how: c.name, die, ok, lost });
  if (!ok && c.id === 'rapids') {
    death(s, seat, 'пороги', ev);
    return;
  }
  if (!ok) {
    // назад на берег
    const bank = s.back >= 0 ? s.back : s.from;
    ev.push({ type: 'step', seat, from: s.pos[seat], to: bank, last: true });
    s.pos[seat] = bank;
  }
  pass(s, seat, ev);
}

function natives(s: State, seat: number, ev: Event[]) {
  const opts: string[] = [];
  if (has(s, seat, 'presents')) opts.push('presents');
  if (s.money[seat] >= 10000) opts.push('money');
  if (has(s, seat, 'smoke')) opts.push('smoke');
  if (!hasHorse(s, seat) && leftOf(s, 'horse') > 0 && s.money[seat] >= 40000) opts.push('horse');
  for (const it of new Set(s.items[seat])) if (it !== 'presents' && it !== 'smoke') opts.push(`item:${it}`);
  if (!opts.length) {
    death(s, seat, 'туземцы-людоеды', ev);
    return;
  }
  s.ask = { kind: 'natives', options: opts };
  s.phase = 'ask';
}

function drawCard(s: State, seat: number, ev: Event[]) {
  const n = s.deck.shift() ?? CARDS[0].n;
  s.deck.push(n);
  s.card = n;
  ev.push({ type: 'card', seat, card: n });
  const card = CARDS.find((c) => c.n === n)!;
  const e: CardEffect = card.effect;
  if (e.k === 'give') {
    if (e.money) addMoney(s, seat, e.money, ev);
    if (e.horse) give(s, seat, 'horse', ev);
    for (const it of e.items ?? []) give(s, seat, it, ev);
    if (e.choose) {
      const opts = e.choose.filter((i) => leftOf(s, i) > 0 && !(i === 'horse' && hasHorse(s, seat)));
      if (opts.length) {
        s.ask = { kind: 'give', options: opts };
        s.phase = 'ask';
        return;
      }
    }
    pass(s, seat, ev);
    return;
  }
  if (e.k === 'buy') {
    const opts = e.choose.filter((i) => leftOf(s, i) > 0 && !(i === 'horse' && hasHorse(s, seat)));
    if (opts.length && s.money[seat] >= e.price) {
      s.ask = { kind: 'buy', options: [...opts, 'none'], price: e.price };
      s.phase = 'ask';
      return;
    }
    pass(s, seat, ev);
    return;
  }
  if (e.k === 'lose') {
    if (e.money) addMoney(s, seat, -e.money, ev);
    if (e.horse) take(s, seat, 'horse', ev);
    if (e.items === 'all') {
      for (const it of s.items[seat].slice()) if (!isWeapon(it) && !isCamera(it)) take(s, seat, it, ev);
      addMoney(s, seat, -s.money[seat], ev);
    } else for (const it of e.items ?? []) take(s, seat, it, ev);
    pass(s, seat, ev);
    return;
  }
  if (e.k === 'need') {
    const ok = has(s, seat, e.item) || (!!e.alt && has(s, seat, e.alt));
    ev.push({ type: 'need', seat, item: e.item, ok, wait: ok || e.die ? 0 : e.wait ?? 6 });
    if (!ok && e.die) {
      death(s, seat, card.title.toLowerCase(), ev);
      return;
    }
    if (!ok) s.wait[seat] = e.wait ?? 6;
    pass(s, seat, ev);
    return;
  }
  if (e.k === 'shoot') {
    // зверь с карточки: дымовые шашки или серия выстрелов
    const opts: string[] = [];
    if (seriesOf(s, seat)) opts.push('shoot');
    if (has(s, seat, 'smoke')) opts.push('smoke');
    if (!opts.length) {
      death(s, seat, card.title.toLowerCase(), ev);
      return;
    }
    s.fight = { foe: card.title, need: e.hits, hits: 0, shots: seriesOf(s, seat), oneShot: true };
    s.ask = { kind: 'beast', options: opts };
    s.phase = 'ask';
    return;
  }
  if (e.k === 'natives') {
    natives(s, seat, ev);
    return;
  }
  pass(s, seat, ev);
}

/** Ход закончен на клетке — разыграть её. */
function settle(s: State, seat: number, ev: Event[], rng: Rng) {
  const i = s.pos[seat];
  const cell = CELLS[i];
  s.left = 0;
  if (cell.kind === 'hotel') {
    if (s.away[seat]) {
      // вернулся первым — экспедиция окончена, считаем деньги и добычу
      ev.push({ type: 'home', seat });
      finish(s, ev);
      return;
    }
    pass(s, seat, ev);
    return;
  }
  if (isStop(i)) {
    ev.push({ type: 'stop', seat, cell: i });
    if (cell.kind === 'fire') s.away[seat] = true;
    if (s.first[i] == null) {
      s.first[i] = seat;
      const opts = FREE_AT_STOP.filter((it) => leftOf(s, it) > 0);
      if (opts.length) {
        s.ask = { kind: 'gift', options: opts };
        s.phase = 'ask';
        return;
      }
    }
    pass(s, seat, ev);
    return;
  }
  if (cell.kind === 'card') return drawCard(s, seat, ev);
  if (cell.kind === 'swamp') return swamp(s, seat, ev, rng);
  if (cell.kind === 'cross') {
    // на берегу останавливаются; переправа — только если пришли с суши
    const fromLand = s.back >= 0 && intoRiver(s.back, i);
    if (!fromLand) return pass(s, seat, ev);
    const opts = crossOptions(s, seat);
    s.ask = { kind: 'cross', options: opts };
    s.phase = 'ask';
    return;
  }
  if (cell.kind === 'danger') {
    const what = cell.what ?? 'natives';
    if (isAnimal(i)) return beast(s, seat, ev, rng);
    ev.push({ type: 'foe', seat, foe: what });
    if (what === 'natives') return natives(s, seat, ev);
    startFight(s, seat, what, 1, true, ev);
    return;
  }
  pass(s, seat, ev);
}

/** Куда можно шагнуть: по ленте в любую сторону, но не назад в этом же ходу. */
export function options(s: State, seat: number): number[] {
  const here = s.pos[seat];
  return NEIGH[here].filter((n) => n !== s.back);
}

/** Обязательная остановка на клетке: постройки, тупик у логова, берег перед переправой. */
function mustStop(s: State, from: number, to: number): boolean {
  if (isStop(to) || CELLS[to].lair) return true;
  return intoRiver(from, to);
}

/** Шаг (и дальше сам, пока дорога одна). */
function walk(s: State, seat: number, to: number, ev: Event[], rng: Rng) {
  for (;;) {
    const from = s.pos[seat];
    s.pos[seat] = to;
    s.back = from;
    s.left--;
    const stop = mustStop(s, from, to);
    const opts = options(s, seat);
    const last = stop || s.left <= 0 || !opts.length;
    ev.push({ type: 'step', seat, from, to, last });
    if (last) {
      settle(s, seat, ev, rng);
      return;
    }
    if (opts.length > 1) return; // развилка — выбирает игрок
    to = opts[0];
  }
}

function roll(s: State, seat: number, ev: Event[], rng: Rng) {
  const die = d6(rng);
  if (s.wait[seat]) {
    const need = s.wait[seat];
    ev.push({ type: 'wait', seat, die, need });
    if (die !== need) {
      pass(s, seat, ev);
      return;
    }
    s.wait[seat] = 0;
  }
  const onCross = RIVER[s.pos[seat]] >= 0;
  const bonus = hasHorse(s, seat) && !s.lead[seat] && !onCross ? 6 : 0;
  ev.push({ type: 'roll', seat, die, bonus });
  s.die = die + bonus;
  s.left = s.die;
  s.back = -1;
  s.from = s.pos[seat];
  s.phase = 'move';
  const opts = options(s, seat);
  if (!opts.length) settle(s, seat, ev, rng);
  else if (opts.length === 1) walk(s, seat, opts[0], ev, rng);
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.over || seat !== s0.turn) return null;
  const s = clone(s0);
  const ev: Event[] = [];
  rngNow = rng;
  const ok = act(s, seat, a, ev, rng);
  rngNow = null;
  return ok ? { state: s, events: ev } : null;
}

function act(s: State, seat: number, a: Action, ev: Event[], rng: Rng): boolean {
  const phase = s.phase;
  switch (a.type) {
    case 'buy': {
      const shop = phase === 'buy' || (phase === 'roll' && shopAt(s, seat));
      if (!shop || !itemOf(a.item) || !canBuy(s, seat, a.item)) return false;
      const price = itemOf(a.item).price;
      s.money[seat] -= price;
      s.items[seat].push(a.item);
      ev.push({ type: 'buy', seat, item: a.item, price });
      if (phase === 'buy') {
        s.bought++;
        if (s.bought >= s.perTurn) pass(s, seat, ev);
      }
      return true;
    }
    case 'sell': {
      if (phase !== 'roll' || CELLS[s.pos[seat]].kind !== 'monastery' || !has(s, seat, a.item)) return false;
      const price = itemOf(a.item).price;
      s.items[seat].splice(s.items[seat].indexOf(a.item), 1);
      s.money[seat] += price;
      ev.push({ type: 'sell', seat, item: a.item, price });
      return true;
    }
    case 'done': {
      if (phase !== 'buy') return false;
      s.done[seat] = true;
      ev.push({ type: 'done', seat });
      pass(s, seat, ev);
      return true;
    }
    case 'lead': {
      if (phase !== 'roll' || !hasHorse(s, seat)) return false;
      s.lead[seat] = a.on;
      return true;
    }
    case 'roll': {
      if (phase !== 'roll') return false;
      roll(s, seat, ev, rng);
      return true;
    }
    case 'film': {
      // съёмка продолжается: стоишь у зверя — вместо хода снова бросаешь на съёмку
      if (phase !== 'roll' || !isAnimal(s.pos[seat]) || s.wait[seat]) return false;
      beast(s, seat, ev, rng);
      return true;
    }
    case 'step': {
      if (phase !== 'move' || s.left <= 0 || !options(s, seat).includes(a.to)) return false;
      walk(s, seat, a.to, ev, rng);
      return true;
    }
    case 'pick': {
      if (phase !== 'ask' || !s.ask || !s.ask.options.includes(a.pick)) return false;
      const ask = s.ask;
      s.ask = null;
      if (ask.kind === 'gift') {
        give(s, seat, a.pick as ItemId, ev);
        ev.push({ type: 'gift', seat, item: a.pick as ItemId });
        pass(s, seat, ev);
      } else if (ask.kind === 'give') {
        give(s, seat, a.pick as ItemId, ev);
        pass(s, seat, ev);
      } else if (ask.kind === 'buy') {
        if (a.pick !== 'none') {
          addMoney(s, seat, -(ask.price ?? 0), ev);
          give(s, seat, a.pick as ItemId, ev);
        }
        pass(s, seat, ev);
      } else if (ask.kind === 'natives') {
        ev.push({ type: 'natives', seat, pick: a.pick });
        if (a.pick === 'presents') take(s, seat, 'presents', ev);
        else if (a.pick === 'smoke') take(s, seat, 'smoke', ev);
        else if (a.pick === 'money') addMoney(s, seat, -10000, ev);
        else if (a.pick === 'horse') {
          addMoney(s, seat, -40000, ev);
          give(s, seat, 'horse', ev);
        } else take(s, seat, a.pick.slice(5) as ItemId, ev);
        pass(s, seat, ev);
      } else if (ask.kind === 'cross') {
        cross(s, seat, a.pick, ev, rng);
      } else if (ask.kind === 'beast') {
        if (a.pick === 'smoke') {
          take(s, seat, 'smoke', ev);
          ev.push({ type: 'smoke', seat });
          pass(s, seat, ev);
        } else {
          const f = s.fight;
          if (f) {
            s.phase = 'shoot';
          } else {
            const id = CELLS[s.pos[seat]].what!;
            const an = ANIMALS.find((x) => x.id === id)!;
            startFight(s, seat, id, an.hits, false, ev);
          }
        }
      }
      return true;
    }
    case 'smoke': {
      if (phase !== 'shoot' || !s.fight || !has(s, seat, 'smoke') || (s.fight.oneShot && !!FOES[s.fight.foe])) return false;
      take(s, seat, 'smoke', ev);
      ev.push({ type: 'smoke', seat });
      pass(s, seat, ev);
      return true;
    }
    case 'shoot': {
      const f = s.fight;
      if (phase !== 'shoot' || !f) return false;
      const w = bestWeapon(s, seat);
      if (!w) return false;
      const die = d6(rng);
      const hit = (itemOf(w).hits ?? []).includes(die);
      if (hit) f.hits++;
      f.shots--;
      ev.push({ type: 'shoot', seat, die, hit, hits: f.hits, need: f.need, left: f.shots, foe: foeName(f.foe) });
      if (f.hits >= f.need) {
        ev.push({ type: 'kill', seat, foe: f.foe });
        if (ANIMALS.find((x) => x.id === f.foe)) s.skins[seat].push(f.foe);
        pass(s, seat, ev);
        return true;
      }
      if (f.shots > 0) return true;
      if (f.oneShot) {
        death(s, seat, foeName(f.foe), ev);
        return true;
      }
      // серия кончилась, зверь жив — его ответный ход, потом новая серия
      if (beastStrikes(s, seat, f.foe, ev)) {
        f.hits = 0;
        f.shots = seriesOf(s, seat);
      }
      return true;
    }
  }
  return false;
}

export const toAct = (s: State) => (s.over ? [] : [s.turn]);

/** Скрытого нет: колода карточек лежит рубашкой вверх — порядок не показываем. */
export const view = (s: State): State => ({ ...s, deck: [] });

const money = (n: number) => `${n.toLocaleString('ru-RU')} $`;
const itemName = (id: string) => (id.startsWith('item:') ? itemOf(id.slice(5) as ItemId).name : itemOf(id as ItemId)?.name ?? id);

/** Подпись варианта выбора (кнопка и журнал). */
export function pickLabel(ask: Ask, pick: string): string {
  if (ask.kind === 'natives') {
    if (pick === 'presents') return 'Отдать подарки';
    if (pick === 'money') return 'Отсчитать 10 000 $';
    if (pick === 'smoke') return 'Бросить дымовые шашки';
    if (pick === 'horse') return 'Купить у них лошадь — 40 000 $';
    return `Отдать: ${itemName(pick)}`;
  }
  if (ask.kind === 'cross') {
    const c = CROSSINGS.find((x) => x.id === pick)!;
    return `${c.name}${c.price ? ` — ${money(c.price)}` : ''}`;
  }
  if (ask.kind === 'beast') return pick === 'shoot' ? 'Стрелять' : 'Бросить дымовую шашку и уйти';
  if (ask.kind === 'buy') return pick === 'none' ? 'Ничего не брать' : `Купить: ${itemName(pick)} — ${money(ask.price ?? 0)}`;
  return `Взять: ${itemName(pick)}`;
}

export function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'buy':
      return `${name(ev.seat)} покупает «${itemOf(ev.item).name}» за ${money(ev.price)}.`;
    case 'sell':
      return `${name(ev.seat)} продаёт «${itemOf(ev.item).name}» за ${money(ev.price)}.`;
    case 'done':
      return `${name(ev.seat)} закончил сборы.`;
    case 'roll':
      return `${name(ev.seat)} бросает кубик: ${ev.die}${ev.bonus ? ` + ${ev.bonus} (лошадь)` : ''}.`;
    case 'step':
      return null;
    case 'stop': {
      const st = STOPS[CELLS[ev.cell].kind as StopKind];
      return st ? `${st.name}. ${st.text}` : null;
    }
    case 'card': {
      const c = CARDS.find((x) => x.n === ev.card)!;
      return `<b>${c.title}</b> — ${c.text}`;
    }
    case 'money':
      return ev.delta >= 0
        ? `${name(ev.seat)} получает ${money(ev.delta)} (всего ${money(ev.total)}).`
        : `${name(ev.seat)} платит ${money(-ev.delta)} (осталось ${money(ev.total)}).`;
    case 'item':
      return ev.take ? `${name(ev.seat)} берёт «${itemOf(ev.item).name}».` : `${name(ev.seat)} лишается «${itemOf(ev.item).name}».`;
    case 'gift':
      return `${name(ev.seat)} первым дошёл до привала — «${itemOf(ev.item).name}» даром.`;
    case 'wait':
      return ev.die === ev.need ? `Выпало ${ev.die} — ${name(ev.seat)} снова в пути!` : `${name(ev.seat)} ждёт «${ev.need}», выпало ${ev.die} — стоит на месте.`;
    case 'need':
      return ev.ok ? `Снаряжение выручило — «${itemOf(ev.item).name}» при себе.` : ev.wait ? `Нет «${itemOf(ev.item).name}» — стоять, пока не выпадет ${ev.wait}.` : null;
    case 'swamp':
      return ev.what === 'bugs'
        ? ev.saved
          ? `Болото, ${ev.die}: москиты, но выручает ${ev.saved}.`
          : `Болото, ${ev.die}: москиты, жёлтая лихорадка — стоять, пока не выпадет 6.`
        : `Болото, ${ev.die}: трясина! Спасает ${ev.saved}.`;
    case 'rope':
      return `Верёвка: ${ev.dice.join(', ')} — ${ev.ok ? 'выбрался!' : 'не удержался…'}`;
    case 'cross':
      return ev.ok
        ? `Переправа (${ev.how}): ${ev.die} — на том берегу.`
        : `Переправа (${ev.how}): ${ev.die} — беда!${ev.lost.length ? ` Утонуло: ${ev.lost.map((i) => itemOf(i).name).join(', ')}.` : ''}`;
    case 'foe':
      return `<b>${FOES[ev.foe]?.name ?? ev.foe}</b> — ${FOES[ev.foe]?.text ?? ''}`;
    case 'natives':
      return `Туземцы: ${pickLabel({ kind: 'natives', options: [] }, ev.pick).toLowerCase()} — и путь свободен.`;
    case 'beast':
      return ev.calm ? `${ev.animal}: ${ev.die} — зверь вдалеке и спокоен, можно снимать.` : `${ev.animal}: ${ev.die} — зверь готовится напасть!`;
    case 'film':
      return ev.kind ? `Съёмка: ${ev.animal} — ${money(ev.sum)} сразу.` : 'Снимать нечем — аппаратуры нет.';
    case 'shoot':
      return `Выстрел: ${ev.die} — ${ev.hit ? 'попадание' : 'мимо'} (${ev.hits} из ${ev.need}, в серии осталось ${ev.left}).`;
    case 'attack':
      return `${ev.animal} нападает: ${ev.die} — ${ev.ok ? 'пронесло' : 'конец'}.`;
    case 'kill':
      return ANIMALS.find((a) => a.id === ev.foe) ? `${name(ev.seat)} убил зверя: шкура «${foeName(ev.foe)}».` : `${name(ev.seat)} отбился: ${foeName(ev.foe).toLowerCase()} повержен.`;
    case 'smoke':
      return `${name(ev.seat)} бросает дымовую шашку и уходит.`;
    case 'die':
      return `💀 ${name(ev.seat)} погибает (${ev.why}) — экспедиция начинается сначала, из гостиницы.`;
    case 'home':
      return `🏠 ${name(ev.seat)} вернулся в гостиницу — экспедиция окончена, считаем деньги.`;
    case 'win':
      return `🏆 Больше всех — у ${name(ev.seat)}: ${money(ev.score)}.`;
    default:
      return null;
  }
}
