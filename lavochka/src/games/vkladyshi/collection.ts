/* «Вкладыши» — коллекция игрока: копилка монет, вкладыши, жвачки, колоды. Здесь — чистые правила над объектом Collection;
 * где он хранится, решает bank.ts (браузер у гостя, сервер у вошедшего — server/vkladyshi.ts считает теми же функциями).
 * У каждого экземпляра — происхождение: «дворовые» (выиграны, наградные, из жвачек за заработанные монеты) и «домашние»
 * (из жвачек за купленные монеты): домашние не ставятся на кон и не меняются (решение 2026-11-02). */
import { CARDS, DECK_SIZE, MAX_COPIES, SETS, card, hash, starterDeck, type Card, type Coll } from './cards';

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
export interface LogLine {
  at: number;
  text: string;
}
export interface Collection {
  v: 1;
  /** заработанные монеты */
  coins: number;
  /** купленные за рубли монеты: тратятся первыми, вкладыши из таких жвачек — домашние */
  hcoins?: number;
  owned: Record<string, Owned>;
  /** жвачек без редкого подряд — по серии жвачки */
  pity: Record<string, number>;
  decks: Deck[];
  active: number;
  wins: number;
  games: number;
  /** открытые жвачки (для альбома «новое») */
  opened: number;
  /** журнал конов, обменов и покупок (последние LOG_KEEP) — защита от «развели» */
  log?: LogLine[];
  /** браузерная коллекция уже перенесена на сервер */
  imported?: boolean;
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
/** Монеты за рубли (ларёк). Цены разные — по сумме платежа сервер сверяет набор. */
export const COIN_PACKS = [
  { id: 's', rub: 99, coins: 300 },
  { id: 'm', rub: 249, coins: 900 },
  { id: 'l', rub: 499, coins: 2000 },
];
export const LOG_KEEP = 50;
/** Сколько вкладышей можно поставить на кон / выложить в обмен за раз. */
export const STAKE_MAX = 5;

export function fresh(): Collection {
  const owned: Record<string, Owned> = {};
  // стартовый набор — две колоды «из старых запасов», дворовые
  for (const id of [...starterDeck('garage'), ...starterDeck('team')]) {
    const o = (owned[id] ??= { y: 0, h: 0 });
    o.y = Math.min(MAX_COPIES, o.y + 1);
  }
  return { v: 1, coins: 200, owned, pity: {}, decks: [{ name: 'Гараж', ids: starterDeck('garage') }, { name: 'Сборная', ids: starterDeck('team') }], active: 0, wins: 0, games: 0, opened: 0 };
}

const KNOWN = new Set(CARDS.map((x) => x.id));

/** Привести прочитанное к делу: нет такого — свежая; вкладышей, которых больше нет в данных (пересборка), — тихо выкидываем. */
export function normalize(c: Collection | null | undefined): Collection {
  if (!c || c.v !== 1 || !c.owned || typeof c.owned !== 'object') return fresh();
  for (const id of Object.keys(c.owned)) if (!KNOWN.has(id)) delete c.owned[id];
  c.decks = (Array.isArray(c.decks) ? c.decks : []).map((d) => ({ name: String(d.name ?? 'Колода'), ids: (d.ids ?? []).filter((id) => c.owned[id]) }));
  if (!c.decks.length) c.decks = [{ name: 'Колода', ids: [] }];
  if (!(c.active >= 0 && c.active < c.decks.length)) c.active = 0;
  return c;
}

export const count = (c: Collection, id: string) => (c.owned[id]?.y ?? 0) + (c.owned[id]?.h ?? 0);
/** Сколько дворовых этого номера свободно (не лежит на кону / в обмене). */
export const free = (c: Collection, id: string, reserved?: Map<string, number>) => Math.max(0, (c.owned[id]?.y ?? 0) - (reserved?.get(id) ?? 0));
export const coinsOf = (c: Collection) => c.coins + (c.hcoins ?? 0);

export function addLog(c: Collection, text: string, at = Date.now()) {
  c.log = [{ at, text }, ...(c.log ?? [])].slice(0, LOG_KEEP);
}

/** Награда за партию — возвращает, сколько монет начислено. */
export function reward(c: Collection, win: boolean): number {
  const coins = win ? REWARD.win : REWARD.loss;
  c.coins += coins;
  c.games += 1;
  if (win) c.wins += 1;
  return coins;
}

/** Есть ли у игрока эти дворовые вкладыши (с повторами), не считая отложенных; текст ошибки или null. */
export function checkYard(c: Collection, ids: string[], reserved?: Map<string, number>): string | null {
  const n = new Map<string, number>();
  for (const id of ids) n.set(id, (n.get(id) ?? 0) + 1);
  for (const [id, k] of n) {
    if (!KNOWN.has(id)) return 'нет такого вкладыша';
    if (k > free(c, id, reserved)) return (c.owned[id]?.h ?? 0) > 0 ? `«${card(id).name}» — домашний, на кон и в обмен не идёт` : `«${card(id).name}» — столько свободных нет`;
  }
  return null;
}

/** Передать дворовые вкладыши: у from убрать, to — добавить дворовыми. Проверка — до вызова (checkYard). */
export function moveYard(from: Collection, to: Collection, ids: string[]) {
  for (const id of ids) {
    const o = from.owned[id];
    if (!o || o.y <= 0) throw new Error('нечего передать: ' + id);
    o.y -= 1;
    if (o.y + o.h <= 0) delete from.owned[id];
    (to.owned[id] ??= { y: 0, h: 0 }).y += 1;
  }
  // колода, где теперь не хватает, — без лишних копий
  from.decks = from.decks.map((d) => {
    const used = new Map<string, number>();
    return {
      ...d,
      ids: d.ids.filter((id) => {
        const k = (used.get(id) ?? 0) + 1;
        used.set(id, k);
        return k <= count(from, id);
      }),
    };
  });
}

function rollRarity(r: number): number {
  let acc = 0;
  for (let i = 0; i < ODDS.length; i++) {
    acc += ODDS[i];
    if (r * 100 < acc) return i;
  }
  return 0;
}

/** Открыть жвачку: списать монеты, выдать PACK_SIZE вкладышей. rand — источник случайности (в браузере Math.random, на сервере — crypto).
 * Купленные монеты тратятся первыми; если в оплату пошла хоть одна купленная монета — вкладыши домашние (смешанную оплату не «отмываем»). */
export function openGum(c: Collection, gumId: string, rand: () => number = Math.random): Card[] | null {
  const g = GUMS.find((x) => x.id === gumId);
  if (!g || coinsOf(c) < g.price) return null;
  const pool = CARDS.filter((x) => g.sets.includes(x.set));
  if (!pool.length) return null;
  const hc = c.hcoins ?? 0;
  const home = hc > 0;
  const fromH = Math.min(hc, g.price);
  c.hcoins = hc - fromH;
  c.coins -= g.price - fromH;
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
    if (home) o.h += 1;
    else o.y += 1;
  }
  c.pity[g.id] = got.some((x) => x.rarity >= 2) ? 0 : pity;
  c.opened += 1;
  return got;
}

/** Сдать повторы сверх двух в обменный фонд — монеты. Сначала уходят домашние (за них — купленные монеты), дворовые на кону не трогаем. */
export function dustExtras(c: Collection, reserved?: Map<string, number>): number {
  let coins = 0;
  for (const [id, o] of Object.entries(c.owned)) {
    let extra = o.y + o.h - MAX_COPIES;
    if (extra <= 0) continue;
    const price = DUST[card(id).rarity];
    const h = Math.min(extra, o.h);
    o.h -= h;
    extra -= h;
    c.hcoins = (c.hcoins ?? 0) + h * price;
    const y = Math.min(extra, free(c, id, reserved));
    o.y -= y;
    c.coins += y * price;
    coins += (h + y) * price;
  }
  return coins;
}

export function deckValid(c: Collection, ids: string[]): string | null {
  if (ids.length !== DECK_SIZE) return `в колоде ${ids.length} из ${DECK_SIZE}`;
  const n = new Map<string, number>();
  for (const id of ids) n.set(id, (n.get(id) ?? 0) + 1);
  for (const [id, k] of n) {
    if (!KNOWN.has(id)) return 'нет такого вкладыша';
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
