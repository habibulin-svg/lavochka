/* «Чудовище Джио-Джанги» — движок экспедиции: движение по графу поля, деньги, снаряжение,
 * карточки ситуаций, съёмка и охота, переправы и болота, привалы, финиш и подсчёт.
 * Без DOM: это гоняет и сервер, и тесты. Картинка поля — public/djio/field.webp. */
import type { Rng } from '../../core/types';
import data from './data.json';
import {
  ANIMALS, CARDS, CROSSINGS, FREE_AT_STOP, SHOT_PRICE, START_MONEY, SWAMP, itemOf, stopAt,
  type CardEffect, type ItemId,
} from './rules';

interface RawCell {
  n: number;
  x: number;
  y: number;
  kind: 'card' | 'swamp' | 'danger' | 'cross';
  next: number[];
}

export const W = (data as { w: number }).w;
export const H = (data as { h: number }).h;
export const CELLS: RawCell[] = (data as { cells: RawCell[] }).cells;
/** Индекс клетки по её номеру на поле. */
export const IDX: { [n: number]: number } = {};
CELLS.forEach((c, i) => (IDX[c.n] = i));
/** Соседи по дороге. */
export const NEIGH: number[][] = CELLS.map((c) => c.next.map((n) => IDX[n]));

/** Где нарисованы чудовища: к этим местам приписаны красные клетки (по близости). */
const LAIRS: { id: string; x: number; y: number }[] = [
  { id: 'ptero', x: 461, y: 2060 },
  { id: 'eipa', x: 2399, y: 4305 },
  { id: 'monster', x: 3137, y: 369 },
  { id: 'croc', x: 4551, y: 2952 },
  { id: 'snake', x: 4674, y: 4305 },
];
/** Какое чудовище живёт у этой красной клетки. */
export const LAIR_OF: (string | null)[] = CELLS.map((c) => {
  if (c.kind !== 'danger') return null;
  let best = LAIRS[0];
  let bd = Infinity;
  for (const l of LAIRS) {
    const d = (l.x - c.x) ** 2 + (l.y - c.y) ** 2;
    if (d < bd) {
      bd = d;
      best = l;
    }
  }
  return best.id;
});
/** Насколько далеко клетка от большого дома (по числу переходов): чтобы понять, кто «дошёл до чудовищ». */
export const FROM_HOUSE: number[] = (() => {
  const d = CELLS.map(() => -1);
  const h = IDX[5];
  d[h] = 0;
  const q = [h];
  while (q.length) {
    const cur = q.shift()!;
    for (const n of NEIGH[cur]) if (d[n] < 0) {
      d[n] = d[cur] + 1;
      q.push(n);
    }
  }
  return d;
})();

/** Клетка-опасность с туземцами (по правилам их несколько): остальные — звери. */
export const NATIVES_AT = new Set(CELLS.filter((c) => c.kind === 'danger' && c.n % 3 === 0).map((c) => IDX[c.n]));

export type Phase = 'buy' | 'roll' | 'move' | 'card' | 'choice' | 'shoot' | 'wait' | 'stop' | 'over';

export interface State {
  seats: number[];
  /** Где стоит фишка (индекс клетки). */
  pos: number[];
  money: number[];
  items: ItemId[][];
  /** Шкуры убитых чудовищ. */
  skins: { [id: string]: number };
  turn: number;
  phase: Phase;
  /** Сколько шагов осталось в этом ходу. */
  left: number;
  last: number;
  /** Ведёт лошадь на поводу: без прибавки 6. */
  lead: boolean;
  /** Ждёт эту грань кубика (0 — не ждёт). */
  waits: number[];
  /** Куплено предметов за подготовку (по одному за ход). */
  buys: number;
  /** Колода карточек ситуаций и открытая карточка. */
  deck: number[];
  card: number | null;
  /** Ожидание ответа игрока: что именно он выбирает. */
  ask: { kind: 'give' | 'natives'; options: ItemId[]; money?: number } | null;
  /** Серия выстрелов. */
  shots: number;
  hits: number;
  animal: string | null;
  /** Сколько снимков сделано за этот ход. */
  film: number;
  /** Кто уже уходил из большого дома (вернувшийся первым заканчивает партию). */
  away: boolean[];
  /** Сколько бросков сделано: боту пора домой. */
  moves: number;
  /** Кто уже добрался до чудовищ: только после этого возвращение домой заканчивает партию. */
  far: boolean[];
  over: boolean;
  winner: number | null;
  log: string[];
}

export type Action =
  | { type: 'buy'; item: ItemId }
  | { type: 'ready' }
  | { type: 'roll' }
  | { type: 'lead'; on: boolean }
  | { type: 'step'; to: number }
  | { type: 'stop' }
  | { type: 'ok' }
  | { type: 'pick'; pick: ItemId | 'money' | 'horse' | 'smoke' }
  | { type: 'shoot' }
  | { type: 'skip' };

export type Event =
  | { type: 'buy'; seat: number; item: ItemId; price: number }
  | { type: 'ready'; seat: number; left: number }
  | { type: 'roll'; seat: number; die: number; bonus: number }
  | { type: 'step'; seat: number; to: number }
  | { type: 'stop'; seat: number; cell: number }
  | { type: 'card'; seat: number; card: number }
  | { type: 'money'; seat: number; delta: number; total: number }
  | { type: 'item'; seat: number; item: ItemId; take: boolean }
  | { type: 'horse'; seat: number; on: boolean }
  | { type: 'swamp'; seat: number; kind: 'bugs' | 'bog'; saved: string }
  | { type: 'cross'; seat: number; kind: string; die: number; ok: boolean; lost: number }
  | { type: 'shoot'; seat: number; die: number; hit: boolean; hits: number; need: number; animal: string }
  | { type: 'attack'; seat: number; die: number; saved: boolean; animal: string }
  | { type: 'film'; seat: number; kind: keyof typeof SHOT_PRICE; sum: number; animal: string }
  | { type: 'wait'; seat: number; die: number; need: number }
  | { type: 'die'; seat: number; why: string }
  | { type: 'home'; seat: number }
  | { type: 'win'; seat: number };

const clone = (s: State): State => ({
  ...s,
  pos: s.pos.slice(),
  money: s.money.slice(),
  items: s.items.map((x) => x.slice()),
  skins: { ...s.skins },
  waits: s.waits.slice(),
  deck: s.deck.slice(),
  log: s.log.slice(),
  ask: s.ask ? { ...s.ask, options: s.ask.options.slice() } : null,
});

export const has = (s: State, seat: number, item: ItemId) => s.items[seat].includes(item);
/** Лошадь считается и карточкой предмета, и отдельным признаком. */
export const hasHorse = (s: State, seat: number) => has(s, seat, 'horse');
const weapons = (s: State, seat: number) => s.items[seat].filter((i) => itemOf(i).shots);
/** Оружие для стрельбы: самое надёжное из имеющегося. */
export const bestWeapon = (s: State, seat: number): ItemId | null => {
  const list = weapons(s, seat);
  if (!list.length) return null;
  return list.reduce((a, b) => ((itemOf(b).hits?.length ?? 0) > (itemOf(a).hits?.length ?? 0) ? b : a));
};
/** Счёт игрока: деньги, шкуры и снаряжение по ценам покупки. */
export const scoreOf = (s: State, seat: number) => {
  const skins = ANIMALS.reduce((sum, a) => sum + a.skin * (s.skins[`${seat}:${a.id}`] ?? 0), 0);
  const gear = s.items[seat].reduce((sum, i) => sum + itemOf(i).price, 0);
  return s.money[seat] + skins + gear;
};

/** Начало партии: у каждого 150 000, все стоят у большого дома, покупают по одному предмету за ход. */
export function newState(seats: number[], rng: Rng): State {
  const deck = CARDS.map((c) => c.n);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  const house = IDX[5];
  return {
    seats: seats.slice(),
    pos: CELLS.map(() => house),
    money: CELLS.map(() => START_MONEY),
    items: CELLS.map(() => [] as ItemId[]),
    skins: {},
    turn: seats[0],
    phase: 'buy',
    left: 0,
    last: 0,
    lead: false,
    waits: CELLS.map(() => 0),
    buys: 0,
    deck,
    card: null,
    ask: null,
    shots: 0,
    hits: 0,
    animal: null,
    film: 0,
    away: CELLS.map(() => false),
    moves: 0,
    far: CELLS.map(() => false),
    over: false,
    winner: null,
    log: [],
  };
}

const nextSeat = (s: State, seat: number) => s.seats[(s.seats.indexOf(seat) + 1) % s.seats.length];
const pass = (s: State, seat: number, ev: Event[]) => {
  s.turn = nextSeat(s, seat);
  s.phase = s.phase === 'buy' && s.buys < s.seats.length ? 'buy' : 'roll';
  s.card = null;
  s.ask = null;
  s.animal = null;
  s.hits = 0;
  s.shots = 0;
  s.film = 0;
  void ev;
};
/** Сколько предметов ещё лежит в наборе (по числу карточек в правилах). */
const leftInDeck = (s: State, item: ItemId) => {
  const cap = itemOf(item).count;
  const taken = s.seats.reduce((n, x) => n + s.items[x].filter((i) => i === item).length, 0);
  return cap - taken;
};
const give = (s: State, seat: number, item: ItemId, ev: Event[]) => {
  if (leftInDeck(s, item) <= 0) return false;
  s.items[seat] = [...s.items[seat], item];
  ev.push({ type: 'item', seat, item, take: true });
  return true;
};
const takeAway = (s: State, seat: number, item: ItemId, ev: Event[]) => {
  if (!has(s, seat, item)) return false;
  s.items[seat] = s.items[seat].filter((i) => i !== item);
  ev.push({ type: 'item', seat, item, take: false });
  return true;
};
const addMoney = (s: State, seat: number, delta: number, ev: Event[]) => {
  s.money[seat] = Math.max(0, s.money[seat] + delta);
  ev.push({ type: 'money', seat, delta, total: s.money[seat] });
};

/** Карточка ситуаций: тянем верхнюю и применяем, если эффект не требует ответа игрока. */
function drawCard(s: State, seat: number, ev: Event[], rng: Rng) {
  const n = s.deck.shift() ?? CARDS[0].n;
  s.deck.push(n);
  s.card = n;
  s.phase = 'card';
  ev.push({ type: 'card', seat, card: n });
  void rng;
  void seat;
}

/** Эффект карточки: часть применяется сразу, часть — ответом игрока (ask). */
function applyCard(s: State, seat: number, ev: Event[], rng: Rng) {
  const card = CARDS.find((c) => c.n === s.card)!;
  const e: CardEffect = card.effect;
  s.phase = 'roll';
  if (e.k === 'safe') return;
  if (e.k === 'give') {
    if (e.money) addMoney(s, seat, e.money, ev);
    if (e.horse) give(s, seat, 'horse', ev);
    for (const it of e.items ?? []) give(s, seat, it, ev);
    if (e.choose) {
      s.ask = { kind: 'give', options: e.choose.filter((i) => leftInDeck(s, i) > 0) };
      if (s.ask.options.length) s.phase = 'choice';
      else s.ask = null;
    }
    return;
  }
  if (e.k === 'lose') {
    if (e.money) addMoney(s, seat, -e.money, ev);
    if (e.horse) takeAway(s, seat, 'horse', ev);
    if (e.items === 'all') {
      const keep = e.keepWeapons ? (i: ItemId) => !!itemOf(i).shots || !!SHOT_PRICE[i as keyof typeof SHOT_PRICE] : () => false;
      for (const it of s.items[seat].slice()) if (!keep(it)) takeAway(s, seat, it, ev);
      addMoney(s, seat, -s.money[seat], ev);
    } else for (const it of e.items ?? []) takeAway(s, seat, it, ev);
    return;
  }
  if (e.k === 'need') {
    if (has(s, seat, e.item)) return;
    if (e.die) {
      restart(s, seat, ev, card.title);
      return;
    }
    s.waits[seat] = e.wait ?? 6;
    s.phase = 'wait';
    return;
  }
  if (e.k === 'shoot') {
    const w = bestWeapon(s, seat);
    if (!w) {
      // стрелять нечем — считаем, что дымовые шашки спасают, если они есть, иначе гибель
      if (takeAway(s, seat, 'smoke', ev)) return;
      restart(s, seat, ev, card.title);
      return;
    }
    startFight(s, seat, ev, e.hits, 'monster');
    return;
  }
  if (e.k === 'natives') {
    const opts: ItemId[] = (['presents', 'smoke'] as ItemId[]).filter((i) => has(s, seat, i));
    if (s.money[seat] >= 10000) opts.push('aid'); // «отсчитайте 10 000» — отметим деньгами
    if (!opts.length) {
      restart(s, seat, ev, card.title);
      return;
    }
    s.ask = { kind: 'natives', options: opts };
    s.phase = 'choice';
    return;
  }
}

/** Начать бой: серия выстрелов лучшим оружием. */
function startFight(s: State, seat: number, ev: Event[], need: number, animal: string) {
  const w = bestWeapon(s, seat);
  s.animal = animal;
  s.hits = 0;
  s.shots = w ? itemOf(w).shots ?? 1 : 0;
  s.phase = s.shots > 0 ? 'shoot' : 'roll';
  if (s.shots <= 0) {
    restart(s, seat, ev, `нечем стрелять (${animal})`);
    return;
  }
  void need;
}

/** Красная клетка: 1–3 — зверь далеко, можно снимать; 4–6 — нападает, надо стрелять. */
function dangerCell(s: State, seat: number, ev: Event[], rng: Rng) {
  const animalId = LAIR_OF[s.pos[seat]];
  const animal = ANIMALS.find((a) => a.id === animalId) ?? ANIMALS[0];
  const die = rng.int(6) + 1;
  if (die <= 3) {
    // съёмка: платят за каждый ход съёмки, аппаратура по очереди старшинства
    const kind: keyof typeof SHOT_PRICE | null = has(s, seat, 'video') ? 'video' : has(s, seat, 'cine') ? 'cine' : has(s, seat, 'photo') ? 'photo' : null;
    if (!kind) {
      pass(s, seat, ev);
      return;
    }
    const sum = SHOT_PRICE[kind] * animal.rare;
    addMoney(s, seat, sum, ev);
    ev.push({ type: 'film', seat, kind, sum, animal: animal.name });
    pass(s, seat, ev);
    return;
  }
  if (NATIVES_AT.has(s.pos[seat])) {
    applyCard(s, seat, ev, rng);
    const card = CARDS.find((c) => c.effect.k === 'natives');
    if (card) {
      s.card = card.n;
      applyCard(s, seat, ev, rng);
    }
    return;
  }
  startFight(s, seat, ev, animal.hits, animal.id);
}

/** Зелёная клетка: болото. */
function swampCell(s: State, seat: number, ev: Event[], rng: Rng) {
  const die = rng.int(6) + 1;
  if (SWAMP.bugs.includes(die)) {
    if (has(s, seat, 'suit') || has(s, seat, 'aid')) {
      ev.push({ type: 'swamp', seat, kind: 'bugs', saved: 'одежда' });
      pass(s, seat, ev);
      return;
    }
    s.waits[seat] = SWAMP.wait;
    s.phase = 'wait';
    ev.push({ type: 'swamp', seat, kind: 'bugs', saved: '' });
    return;
  }
  // трясина: сначала лошадь, потом вещи, потом верёвка
  if (hasHorse(s, seat)) {
    takeAway(s, seat, 'horse', ev);
    ev.push({ type: 'swamp', seat, kind: 'bog', saved: 'лошадь' });
    s.phase = 'move';
    s.left = 1;
    return;
  }
  const junk = s.items[seat].filter((i) => !itemOf(i).shots);
  if (junk.length) {
    for (const it of junk) takeAway(s, seat, it, ev);
    ev.push({ type: 'swamp', seat, kind: 'bog', saved: 'вещи' });
    s.phase = 'move';
    s.left = 1;
    return;
  }
  // верёвка: бросок — 4–6 спасают
  const rope = rng.int(6) + 1;
  if (rope >= 4) {
    ev.push({ type: 'swamp', seat, kind: 'bog', saved: 'верёвка' });
    s.phase = 'move';
    s.left = 1;
    return;
  }
  restart(s, seat, ev, 'трясина');
}

/** Синяя клетка: переправа. */
function crossCell(s: State, seat: number, ev: Event[], rng: Rng) {
  const can = CROSSINGS.filter((c) => (c.id === 'boat' ? has(s, seat, 'boat') : c.price <= s.money[seat]));
  if (!can.length) {
    // нечем переправляться — остаёмся на берегу
    pass(s, seat, ev);
    return;
  }
  // выбираем самое надёжное из доступного: свой плот, лодка местных, пороги
  const pick = can.find((c) => c.id === 'raft') ?? can.find((c) => c.id === 'local') ?? can.find((c) => c.id === 'boat') ?? can[0];
  if (pick.price) addMoney(s, seat, -pick.price, ev);
  const die = rng.int(6) + 1;
  const ok = !pick.bad.includes(die);
  let lost = 0;
  if (!ok) {
    if (pick.id === 'rapids') {
      ev.push({ type: 'cross', seat, kind: pick.name, die, ok, lost: 0 });
      restart(s, seat, ev, 'пороги');
      return;
    }
    for (let i = 0; i < pick.lose; i++) {
      const junk = s.items[seat].filter((x) => x !== 'horse');
      if (!junk.length) break;
      if (takeAway(s, seat, junk[junk.length - 1], ev)) lost++;
    }
  }
  ev.push({ type: 'cross', seat, kind: pick.name, die, ok, lost });
  pass(s, seat, ev);
}

/** Ход: бросок кубика (с лошадью +6, если не ведут на поводу). */
function roll(s: State, seat: number, ev: Event[], rng: Rng) {
  if (s.waits[seat]) {
    const die = rng.int(6) + 1;
    const need = s.waits[seat];
    ev.push({ type: 'wait', seat, die, need });
    if (die !== need) {
      pass(s, seat, ev);
      s.phase = 'roll';
      return;
    }
    // выпало нужное — свободен и ходит в этот же ход
    s.waits[seat] = 0;
  }
  const die = rng.int(6) + 1;
  s.moves++;
  const bonus = hasHorse(s, seat) && !s.lead ? 6 : 0;
  s.last = die + bonus;
  s.left = s.last;
  s.film = 0;
  s.phase = 'move';
  ev.push({ type: 'roll', seat, die, bonus });
  if (!NEIGH[s.pos[seat]].length) pass(s, seat, ev);
}

/** Шаг по дороге. */
function step(s: State, seat: number, to: number, ev: Event[]) {
  if (to !== IDX[5]) s.away[seat] = true;
  // до чудовищ добрался (или ушёл далеко от дома) — теперь возвращение завершает экспедицию
  if (CELLS[to].kind === 'danger' || (FROM_HOUSE[to] ?? 0) >= 25) s.far[seat] = true;
  s.pos[seat] = to;
  s.left--;
  ev.push({ type: 'step', seat, to });
  const stop = stopAt(CELLS[to].n);
  if (stop) {
    ev.push({ type: 'stop', seat, cell: to });
    s.phase = 'stop';
    return;
  }
  if (CELLS[to].kind === 'danger' && s.left > 0) {
    // у чудовищ останавливаются обязательно
    s.left = 0;
  }
  if (s.left <= 0) {
    s.phase = 'roll';
    return;
  }
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.over || s0.winner != null || seat !== s0.turn) return null;
  const s = clone(s0);
  const ev: Event[] = [];
  const phase = s.phase;

  if (a.type === 'buy') {
    if (phase !== 'buy') return null;
    const it = itemOf(a.item);
    if (s.money[seat] < it.price || leftInDeck(s, a.item) <= 0) return null;
    addMoney(s, seat, -it.price, ev);
    give(s, seat, a.item, ev);
    ev.push({ type: 'buy', seat, item: a.item, price: it.price });
    s.buys++;
    const done = s.buys >= s.seats.length * 2; // по два предмета каждому — и в путь
    pass(s, seat, ev);
    if (done) s.phase = 'roll';
    return { state: s, events: ev };
  }
  if (a.type === 'ready') {
    if (phase !== 'buy') return null;
    // больше не покупаем: все остальные тоже заканчивают сборы
    s.buys = s.seats.length * 2;
    ev.push({ type: 'ready', seat, left: leftInDeck(s, 'horse') });
    pass(s, seat, ev);
    s.phase = 'roll';
    return { state: s, events: ev };
  }
  if (a.type === 'ok') {
    if (phase !== 'card') return null;
    applyCard(s, seat, ev, rng);
    if (s.phase === 'over') return { state: s, events: ev };
    if (s.phase === 'choice' || s.phase === 'shoot' || s.phase === 'wait' || s.phase === 'move') return { state: s, events: ev };
    pass(s, seat, ev);
    return { state: s, events: ev };
  }
  if (a.type === 'pick') {
    if (phase !== 'choice' || !s.ask) return null;
    if (s.ask.kind === 'give') {
      if (a.pick === 'money' || a.pick === 'horse' || a.pick === 'smoke') return null;
      if (!s.ask.options.includes(a.pick)) return null;
      give(s, seat, a.pick, ev);
    } else {
      if (a.pick === 'money') addMoney(s, seat, -10000, ev);
      else if (a.pick === 'horse') takeAway(s, seat, 'horse', ev);
      else if (a.pick === 'smoke') takeAway(s, seat, 'smoke', ev);
      else if (a.pick === 'presents') takeAway(s, seat, 'presents', ev);
      else if (a.pick === 'aid') takeAway(s, seat, 'aid', ev);
      else return null;
    }
    s.ask = null;
    pass(s, seat, ev);
    return { state: s, events: ev };
  }
  if (a.type === 'lead') {
    if (phase !== 'roll') return null;
    s.lead = a.on;
    return { state: s, events: ev };
  }
  if (a.type === 'roll') {
    if (phase !== 'roll' && phase !== 'wait') return null;
    roll(s, seat, ev, rng);
    if (s.phase === 'wait') s.phase = 'roll';
    return { state: s, events: ev };
  }
  if (a.type === 'step') {
    if (phase !== 'move' || s.left <= 0) return null;
    if (!NEIGH[s.pos[seat]].includes(a.to)) return null;
    step(s, seat, a.to, ev);
    if (s.phase === 'move' && s.left <= 0) s.phase = 'roll';
    return { state: s, events: ev };
  }
  if (a.type === 'stop') {
    if (phase !== 'move' && phase !== 'stop') return null;
    settle(s, seat, ev, rng);
    return { state: s, events: ev };
  }
  if (a.type === 'shoot') {
    if (phase !== 'shoot' || !s.animal) return null;
    const w = bestWeapon(s, seat);
    if (!w) return null;
    const die = rng.int(6) + 1;
    const hit = (itemOf(w).hits ?? []).includes(die);
    if (hit) s.hits++;
    s.shots--;
    const animal = ANIMALS.find((x) => x.id === s.animal) ?? ANIMALS[0];
    ev.push({ type: 'shoot', seat, die, hit, hits: s.hits, need: animal.hits, animal: animal.name });
    if (s.hits >= animal.hits) {
      const key = `${seat}:${animal.id}`;
      s.skins[key] = (s.skins[key] ?? 0) + 1;
      s.phase = 'roll';
      s.animal = null;
      pass(s, seat, ev);
      return { state: s, events: ev };
    }
    if (s.shots <= 0) {
      // ответный ход животного
      let died = false;
      for (let i = 0; i < animal.attacks; i++) {
        const d = rng.int(6) + 1;
        const saved = d <= 3;
        ev.push({ type: 'attack', seat, die: d, saved, animal: animal.name });
        if (!saved) died = true;
      }
      if (died) {
        restart(s, seat, ev, animal.name);
        return { state: s, events: ev };
      }
      s.shots = itemOf(w).shots ?? 1;
      return { state: s, events: ev };
    }
    return { state: s, events: ev };
  }
  return null;
}

/** Гибель: игрок теряет всё и начинает экспедицию заново (правила: «начинайте игру с начала»). */
function restart(s: State, seat: number, ev: Event[], why: string) {
  ev.push({ type: 'die', seat, why });
  s.items[seat] = [];
  s.money[seat] = START_MONEY;
  s.pos[seat] = IDX[5];
  s.away[seat] = false;
  s.far[seat] = false;
  s.waits[seat] = 0;
  s.animal = null;
  s.hits = 0;
  s.shots = 0;
  s.card = null;
  s.ask = null;
  pass(s, seat, ev);
  s.phase = 'roll';
}

/** Закончить ход на клетке: разыграть её цвет. */
function settle(s: State, seat: number, ev: Event[], rng: Rng) {
  const cell = CELLS[s.pos[seat]];
  const st = stopAt(cell.n);
  if (st?.kind === 'house' && s.away[seat] && s.far[seat]) {
    // вернулся домой первым — экспедиция окончена, считаем деньги и добычу
    s.over = true;
    s.pos[seat] = s.pos[seat];
    ev.push({ type: 'home', seat });
    let best = s.seats[0];
    for (const x of s.seats) if (scoreOf(s, x) > scoreOf(s, best)) best = x;
    s.winner = best;
    ev.push({ type: 'win', seat: best });
    return;
  }
  if (st) {
    // привал: первый здесь даром берёт одну вещь из нераскупленных
    const free = FREE_AT_STOP.find((i) => leftInDeck(s, i) > 0);
    if (free && !s.log.includes(`free:${seat}:${cell.n}`)) {
      give(s, seat, free, ev);
      s.log.push(`free:${seat}:${cell.n}`);
    }
    pass(s, seat, ev);
    return;
  }
  if (cell.kind === 'card') {
    drawCard(s, seat, ev, rng);
    return;
  }
  if (cell.kind === 'swamp') {
    swampCell(s, seat, ev, rng);
    return;
  }
  if (cell.kind === 'cross') {
    crossCell(s, seat, ev, rng);
    return;
  }
  if (cell.kind === 'danger') {
    dangerCell(s, seat, ev, rng);
    return;
  }
  pass(s, seat, ev);
}

export const toAct = (s: State) => (s.over ? [] : [s.turn]);

/** Вид: чужие карточки ситуаций не показываем (открытая карточка видна всем — она на столе). */
export const view = (s: State) => ({ ...s, deck: s.deck.slice(0, 1) });

export function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'buy':
      return `${name(ev.seat)} покупает «${itemOf(ev.item).name}» за ${ev.price.toLocaleString('ru-RU')} $.`;
    case 'ready':
      return `${name(ev.seat)} закончил сборы — экспедиция выходит.`;
    case 'roll': {
      const bonus = ev.bonus ? ` и лошадь добавляет ${ev.bonus}` : '';
      return `${name(ev.seat)} бросает кубик: ${ev.die}${bonus}.`;
    }
    case 'step':
      return `${name(ev.seat)} идёт по ленте.`;
    case 'stop': {
      const st = stopAt(CELLS[ev.cell].n);
      return `Остановка: ${st ? st.name : 'привал'}. ${st ? st.text : ''}`;
    }
    case 'card': {
      const c = CARDS.find((x) => x.n === ev.card)!;
      return `<b>${c.title}</b> — ${c.text}`;
    }
    case 'money':
      return ev.delta >= 0
        ? `${name(ev.seat)} получает ${ev.delta.toLocaleString('ru-RU')} $ (всего ${ev.total.toLocaleString('ru-RU')} $).`
        : `${name(ev.seat)} теряет ${(-ev.delta).toLocaleString('ru-RU')} $ (осталось ${ev.total.toLocaleString('ru-RU')} $).`;
    case 'item':
      return ev.take
        ? `${name(ev.seat)} берёт «${itemOf(ev.item).name}».`
        : `${name(ev.seat)} лишается «${itemOf(ev.item).name}».`;
    case 'horse':
      return ev.on ? `${name(ev.seat)} садится на лошадь.` : `${name(ev.seat)} ведёт лошадь на поводу.`;
    case 'swamp':
      return ev.kind === 'bugs'
        ? ev.saved
          ? `Болото: москиты, но ${ev.saved} выручает.`
          : 'Болото: москиты! Пока не выпадет шесть — стоять на месте.'
        : `Трясина: спасает ${ev.saved}.`;
    case 'cross':
      return ev.ok
        ? `Переправа (${ev.kind}): бросок ${ev.die} — всё обошлось.`
        : `Переправа (${ev.kind}): бросок ${ev.die} — беда! Потеряно предметов: ${ev.lost}.`;
    case 'shoot':
      return ev.hit
        ? `Выстрел: ${ev.die} — попадание (${ev.hits} из ${ev.need}).`
        : `Выстрел: ${ev.die} — мимо (${ev.hits} из ${ev.need}).`;
    case 'attack':
      return ev.saved ? `${ev.animal}: бросок ${ev.die} — пронесло.` : `${ev.animal}: бросок ${ev.die} — нападение!`;
    case 'film':
      return `Съёмка (${ev.kind}): ${ev.sum.toLocaleString('ru-RU')} $ за ${ev.animal}.`;
    case 'wait':
      return `Ждём цифру ${ev.need}: выпало ${ev.die}.`;
    case 'die':
      return `💀 ${name(ev.seat)} погибает: ${ev.why}. Начинает экспедицию заново.`;
    case 'home':
      return `🏠 ${name(ev.seat)} возвращается домой — экспедиция окончена, считаем деньги.`;
    case 'win':
      return `🏆 Победил ${name(ev.seat)}: больше всех денег!`;
    default:
      return null;
  }
}
