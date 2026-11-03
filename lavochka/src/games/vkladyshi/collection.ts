/* «Вкладыши» — коллекция игрока: копилка монет, вкладыши, жвачки, колоды. Пока хранится в браузере (store);
 * перенос на сервер — вместе с игрой на кон и обменом (DESIGN.md §8). У каждого экземпляра — происхождение:
 * «дворовые» (выиграны, наградные, из жвачек за заработанные монеты) и «домашние» (из жвачек за купленные — когда появится покупка):
 * домашние не ставятся на кон и не меняются (решение 2026-11-02). */
import { store } from '../../core/settings';
import { CARDS, DECK_SIZE, MAX_COPIES, SETS, card, hash, starterDeck, type Card, type Coll } from './cards';

const KEY = 'vk.collection';

export interface Owned {
  /** дворовые экземпляры */
  y: number;
  /** домашние экземпляры */
  h: number;
}
export interface Deck {
  name: string;
  ids: string[];
}
export interface Collection {
  v: 1;
  coins: number;
  owned: Record<string, Owned>;
  /** жвачек без редкого подряд — по серии жвачки */
  pity: Record<string, number>;
  decks: Deck[];
  active: number;
  wins: number;
  games: number;
  /** открытые жвачки (для альбома «новое») */
  opened: number;
}

/** Жвачка в ларьке — по одной на группу серий. */
export interface Gum {
  id: string;
  title: string;
  coll: Coll;
  sets: string[];
  price: number;
}
export const GUMS: Gum[] = ([
  { id: 'turbo', title: 'Turbo', coll: 'turbo', sets: ['turbo1', 'turbo2', 'turbo3', 'turbo4', 'turbo5'], price: 60 },
  { id: 'bomb', title: 'BomBibom', coll: 'bomb', sets: ['bomb1', 'bomb2'], price: 50 },
  { id: 'final', title: 'Final', coll: 'final', sets: ['final90', 'final92', 'final94', 'final96', 'finalred'], price: 60 },
  { id: 'love', title: 'Love is…', coll: 'love', sets: SETS.filter((s) => s.coll === 'love').map((s) => s.key), price: 50 },
  { id: 'lazer', title: 'Lazer', coll: 'lazer', sets: ['lazer'], price: 70 },
] as Gum[]).map((g) => ({ ...g, sets: g.sets.filter((k) => SETS.some((s) => s.key === k)) }));

export const PACK_SIZE = 3;
/** Шанс редкости на каждый вкладыш в жвачке, % (показывается на витрине). */
export const ODDS = [72, 21, 6, 1];
/** Редкий (или лучше) гарантирован не позже этой жвачки серии. */
export const PITY = 10;
/** Сколько монет дают за повтор сверх двух — по редкости. */
export const DUST = [5, 10, 30, 120];
export const REWARD = { win: 40, loss: 10 };

function fresh(): Collection {
  const owned: Record<string, Owned> = {};
  // стартовый набор — две колоды «из старых запасов», дворовые
  for (const id of [...starterDeck('garage'), ...starterDeck('team')]) {
    const o = (owned[id] ??= { y: 0, h: 0 });
    o.y = Math.min(MAX_COPIES, o.y + 1);
  }
  return { v: 1, coins: 200, owned, pity: {}, decks: [{ name: 'Гараж', ids: starterDeck('garage') }, { name: 'Сборная', ids: starterDeck('team') }], active: 0, wins: 0, games: 0, opened: 0 };
}

export function load(): Collection {
  const c = store.get<Collection | null>(KEY, null);
  if (!c || c.v !== 1) return fresh();
  // вкладыши, которых больше нет в данных (пересборка), — тихо выкидываем
  for (const id of Object.keys(c.owned)) if (!CARDS.some((x) => x.id === id)) delete c.owned[id];
  c.decks = c.decks.map((d) => ({ ...d, ids: d.ids.filter((id) => c.owned[id]) }));
  return c;
}

export function save(c: Collection) {
  store.set(KEY, c);
}

export const count = (c: Collection, id: string) => (c.owned[id]?.y ?? 0) + (c.owned[id]?.h ?? 0);

/** Награда за партию с ботом — возвращает, сколько монет начислено. */
export function reward(win: boolean): number {
  const c = load();
  const coins = win ? REWARD.win : REWARD.loss;
  c.coins += coins;
  c.games += 1;
  if (win) c.wins += 1;
  save(c);
  return coins;
}

function rollRarity(r: number): number {
  let acc = 0;
  for (let i = 0; i < ODDS.length; i++) {
    acc += ODDS[i];
    if (r * 100 < acc) return i;
  }
  return 0;
}

/** Открыть жвачку: списать монеты, выдать PACK_SIZE вкладышей. rand — источник случайности (в браузере Math.random). */
export function openGum(c: Collection, gumId: string, rand: () => number = Math.random): Card[] | null {
  const g = GUMS.find((x) => x.id === gumId);
  if (!g || c.coins < g.price) return null;
  const pool = CARDS.filter((x) => g.sets.includes(x.set));
  if (!pool.length) return null;
  c.coins -= g.price;
  const got: Card[] = [];
  const pity = (c.pity[g.id] ?? 0) + 1;
  for (let i = 0; i < PACK_SIZE; i++) {
    let r = rollRarity(rand());
    if (i === PACK_SIZE - 1 && pity >= PITY && !got.some((x) => x.rarity >= 2)) r = Math.max(r, 2);
    // нет вкладышей такой редкости в серии — ближайшая ниже
    let cand: Card[] = [];
    for (let k = r; k >= 0 && !cand.length; k--) cand = pool.filter((x) => x.rarity === k);
    const pick = cand[Math.floor(rand() * cand.length)];
    got.push(pick);
    const o = (c.owned[pick.id] ??= { y: 0, h: 0 });
    o.y += 1;
  }
  c.pity[g.id] = got.some((x) => x.rarity >= 2) ? 0 : pity;
  c.opened += 1;
  save(c);
  return got;
}

/** Сдать повторы сверх двух в обменный фонд — монеты. */
export function dustExtras(c: Collection): number {
  let coins = 0;
  for (const [id, o] of Object.entries(c.owned)) {
    const extra = o.y - MAX_COPIES;
    if (extra <= 0) continue;
    o.y -= extra;
    coins += extra * DUST[card(id).rarity];
  }
  c.coins += coins;
  save(c);
  return coins;
}

export function deckValid(c: Collection, ids: string[]): string | null {
  if (ids.length !== DECK_SIZE) return `в колоде ${ids.length} из ${DECK_SIZE}`;
  const n = new Map<string, number>();
  for (const id of ids) n.set(id, (n.get(id) ?? 0) + 1);
  for (const [id, k] of n) {
    if (k > MAX_COPIES) return `«${card(id).name}» — больше двух`;
    if (k > count(c, id)) return `«${card(id).name}» — столько нет в альбоме`;
  }
  return null;
}

/** Колода для опции партии. */
export const deckSpec = (ids: string[]) => `c:${ids.join(';')}`;

/** Сложить колоду из своего альбома автоматически: по кривой цены, сильнейшие (для кнопки «Собрать само»). */
export function autoDeck(c: Collection, colls?: Coll[]): string[] {
  const have = CARDS.filter((x) => count(c, x.id) > 0 && (!colls || colls.includes(x.coll)));
  const score = (x: Card) => (x.spell ? 3 : x.atk + x.hp) - x.cost * 1.6 + x.rarity + x.kw.length * 0.7 + hash(x.id) * 0.1;
  const out: string[] = [];
  const curve = [1, 3, 4, 4, 3, 3, 1, 1, 0, 0];
  for (let cost = 0; cost < curve.length; cost++) {
    const xs = have.filter((x) => x.cost === cost).sort((a, b) => score(b) - score(a));
    for (const x of xs) {
      for (let k = 0; k < Math.min(MAX_COPIES, count(c, x.id)) && out.filter((i) => card(i).cost === cost).length < curve[cost]; k++) out.push(x.id);
    }
  }
  const rest = have.sort((a, b) => score(b) - score(a));
  for (const x of rest) for (let k = out.filter((i) => i === x.id).length; k < Math.min(MAX_COPIES, count(c, x.id)) && out.length < DECK_SIZE; k++) out.push(x.id);
  return out.slice(0, DECK_SIZE);
}
