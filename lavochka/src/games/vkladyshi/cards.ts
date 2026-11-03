/* «Вкладыши» — карты из настоящих вкладышей. Факты с вкладыша (марка, л.с., км/ч, сборная, подпись) лежат в inserts.json
 * (распознаны локальной моделью, tools/wrappers/ocr.py → make_cards.py); боевые числа считаются здесь формулами — баланс правится в одном месте.
 * Без DOM: модуль гоняют сервер и тесты. Дизайн — docs/vkladyshi/DESIGN.md. */
import raw from './inserts.json';

/** Коллекция = фракция со своим стилем игры. */
export type Coll = 'turbo' | 'bomb' | 'final' | 'love' | 'lazer';
export type Rarity = 0 | 1 | 2 | 3; // обычный, нечастый, редкий, «никто не видел»
export type Kw = 'rush' | 'wall' | 'armor' | 'pair';

export type Target = 'enemy' | 'enemyUnit' | 'allyUnit' | 'anyUnit' | 'none';
/** Эффект карты: при выкладывании («Выход»), при уходе со стола («Прощание») или сам по себе (заклинание — «приём»). */
export interface Fx {
  /** что делает */
  k: 'dmg' | 'heal' | 'buff' | 'draw' | 'armor' | 'stun' | 'team' | 'aoe' | 'mana';
  n: number;
  m?: number;
  /** на кого (для heal 'none' — свой герой) */
  to: Target;
}

export interface SetInfo {
  key: string;
  coll: Coll;
  title: string;
  /** подпись года/серии для альбома */
  sub: string;
  /** id коллекции на wrappers.ru — откуда скан */
  src: number;
}

export interface Fact {
  id: string;
  set: string;
  n: number;
  /** картинка относительно public/vkladyshi/ */
  img: string;
  name?: string;
  kind?: string;
  cc?: number | null;
  hp?: number | null;
  speed?: number | null;
  year?: number | null;
  team?: string | null;
  player?: string | null;
  photo?: boolean;
  ru?: string | null;
  en?: string | null;
  range?: string | null;
  /** скорость техники Lazer как напечатано (строкой) */
  spd?: string | null;
}

export interface Card {
  id: string;
  set: string;
  coll: Coll;
  n: number;
  img: string;
  /** имя на карте («BMW M3», «Мёллер», «…уладить ссору») */
  name: string;
  /** вторая строка: характеристики с вкладыша, сборная */
  sub: string;
  rarity: Rarity;
  cost: number;
  /** заклинание («приём») — без атаки и здоровья */
  spell: boolean;
  atk: number;
  hp: number;
  kw: Kw[];
  /** эффект при выкладывании / розыгрыше приёма */
  play?: Fx;
  /** эффект «Прощание» */
  death?: Fx;
  /** сборная (для «Пары» и фото команды) */
  team?: string;
}

export const COLL_NAME: Record<Coll, string> = { turbo: 'Turbo', bomb: 'BomBibom', final: 'Final', love: 'Love is…', lazer: 'Lazer' };
export const COLL_STYLE: Record<Coll, string> = {
  turbo: 'Гараж: крепкие машины, числа с вкладыша',
  bomb: 'Гонка: дешёвые и шустрые, рывок',
  final: 'Сборная: игроки одной сборной сильнее рядом',
  love: 'Любовь: приёмы — лечить, беречь, усиливать',
  lazer: 'Техника: дорого, но броня и залпы',
};
export const RARITY_NAME = ['обычный', 'нечастый', 'редкий', 'никто не видел'];
export const KW_NAME: Record<Kw, string> = { rush: 'Рывок', wall: 'Стенка', armor: 'Броня', pair: 'Пара' };
export const KW_HINT: Record<Kw, string> = {
  rush: 'бьёт в тот же ход, как вышел',
  wall: 'пока стоит — бить можно только его',
  armor: 'первый удар по нему не наносит урона',
  pair: '+1 к атаке за каждого соседа той же сборной (коллекции)',
};

export const SETS: SetInfo[] = (raw as { sets: SetInfo[] }).sets;
export const FACTS: Fact[] = (raw as { facts: Fact[] }).facts;
const SET_BY_KEY = new Map(SETS.map((s) => [s.key, s]));
export const setInfo = (key: string) => SET_BY_KEY.get(key)!;

// ---------------------------------------------------------------- редкость
/** Дворовая память и справка коллекционеров: Turbo 1–10 и 31–40 попадались реже, 109 и 110 — легенды. */
const TURBO_RARE = new Set([...range(1, 10), ...range(31, 40)]);
const TURBO_LEGEND = new Set([109, 110, 52, 247, 329]);
/** Звёзды Final — «никто не видел» (по фамилии, как напечатано). */
const STARS = ['MARADONA', 'MATTHÄUS', 'MATTHAUS', 'GULLIT', 'VAN BASTEN', 'BAGGIO', 'KLINSMANN', 'VÖLLER', 'VOLLER', 'RIJKAARD', 'LINEKER', 'SCHILLACI', 'MILLA', 'ROMARIO', 'BEBETO', 'STOICHKOV', 'HAGI', 'ZOLA', 'SHEARER', 'ZIDANE', 'DEL PIERO', 'RONALDO', 'BRAUDE', 'BREHME', 'ZSAK', 'MEOLA', 'CANTONA', 'LAUDRUP', 'BERGKAMP', 'CANIGGIA', 'BATISTUTA'];

function range(a: number, b: number) {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

/** Детерминированный «бросок» по строке — чтобы карта без цифр (футболист, Love is) всегда получала одни и те же числа. */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------- машины: Turbo и BomBibom
function carCard(f: Fact, base: Omit<Card, 'cost' | 'atk' | 'hp' | 'kw' | 'spell' | 'rarity'>, coll: 'turbo' | 'bomb'): Card {
  const kind = f.kind ?? 'car';
  const r = hash(f.id);
  // недостающие цифры — по виду техники и объёму
  const cc = f.cc ?? (kind === 'moto' ? 700 : kind === 'truck' ? 9000 : 2000 + Math.round(r * 2000));
  const hp = f.hp ?? (kind === 'f1' ? 650 : Math.round(cc / 16));
  const speed = f.speed ?? (kind === 'moto' ? 210 : kind === 'f1' ? 320 : 180 + Math.round(r * 60));
  // «мощь» — атака, «масса» — здоровье, цена — от суммы
  const power = clamp(hp, 40, 900);
  let atk = 1 + Math.round(Math.log2(power / 40) * 1.25); // 40 л.с. → 1, 300 → 5, 600 → 6
  let hpv = 1 + Math.round(clamp(cc, 400, 12000) / 1100); // 1000 см³ → 2, 3000 → 4, 6000 → 6
  if (kind === 'moto') hpv = Math.max(1, hpv - 1);
  if (kind === 'truck') hpv += 2;
  const kw: Kw[] = [];
  const rushAt = coll === 'bomb' ? 215 : 245;
  if (speed >= rushAt || kind === 'f1') kw.push('rush');
  if (kind === 'truck' || cc >= 5500) kw.push('wall');
  if (kind === 'plane' || kind === 'boat') kw.push('armor');
  if (coll === 'bomb') {
    atk += 1;
    hpv = Math.max(1, hpv - 1);
  }
  atk = clamp(atk, 1, 8);
  hpv = clamp(hpv, 1, 9);
  let rarity: Rarity = 0;
  if (coll === 'turbo' && TURBO_LEGEND.has(f.n)) rarity = 3;
  else if ((coll === 'turbo' && TURBO_RARE.has(f.n)) || speed >= 290) rarity = 2;
  else if (r > 0.78) rarity = 1;
  if (rarity >= 2) hpv += 1;
  if (rarity === 3 && !kw.includes('armor')) kw.push('armor');
  // цена: бюджет «2 × цена + 1» на атаку и здоровье, ключевое слово — ещё одно очко
  const budget = atk + hpv + kw.length - (rarity >= 2 ? 1 : 0);
  let cost = clamp(Math.round((budget - 1) / 2), 1, 9);
  if (coll === 'bomb') cost = clamp(cost - (r > 0.5 ? 1 : 0), 1, 9);
  const parts = [f.cc ? `${f.cc} см³` : '', f.hp ? `${f.hp} л.с.` : '', f.speed ? `${f.speed} км/ч` : ''].filter(Boolean);
  return { ...base, sub: parts.join(' · ') || (f.year ? String(f.year) : ''), cost, atk, hp: hpv, kw, spell: false, rarity };
}

// ---------------------------------------------------------------- футбол: Final
function footballCard(f: Fact, base: Omit<Card, 'cost' | 'atk' | 'hp' | 'kw' | 'spell' | 'rarity'>): Card {
  const team = (f.team ?? '').trim() || 'Сборная';
  const r = hash(f.id);
  if (f.photo || !f.player) {
    // фото команды: игрок-«стенка», при выходе усиливает всех своих из той же сборной
    const cost = 4 + Math.round(r * 2);
    return { ...base, name: team, sub: 'фото команды', team, cost, atk: 2, hp: cost + 1, kw: ['wall'], spell: false, rarity: 1, play: { k: 'team', n: 1, m: 1, to: 'none' } };
  }
  const up = f.player.toUpperCase();
  const star = STARS.some((s) => up.includes(s));
  const cost = star ? 5 + Math.round(r * 2) : 1 + Math.floor(r * 5); // 1…5
  let atk = Math.max(1, Math.round(cost * (0.7 + r * 0.6)));
  let hp = Math.max(1, 2 * cost + 1 - atk - 1); // «Пара» стоит очко
  const kw: Kw[] = ['pair'];
  if (star) {
    atk += 1;
    hp += 1;
    if (r > 0.5) kw.push('rush');
  }
  const rarity: Rarity = star ? 3 : r > 0.8 ? 1 : 0;
  return { ...base, team, sub: team, cost, atk, hp, kw, spell: false, rarity };
}

// ---------------------------------------------------------------- Love is: приёмы
const LOVE_FX: { fx: Fx; cost: number; text: string }[] = [
  { fx: { k: 'heal', n: 4, to: 'none' }, cost: 1, text: 'вернуть 4 терпения' },
  { fx: { k: 'buff', n: 1, m: 2, to: 'allyUnit' }, cost: 1, text: '+1 к атаке и +2 к здоровью своему' },
  { fx: { k: 'armor', n: 1, to: 'allyUnit' }, cost: 1, text: 'своему — «Броня»' },
  { fx: { k: 'draw', n: 2, to: 'none' }, cost: 2, text: 'взять 2 вкладыша' },
  { fx: { k: 'heal', n: 8, to: 'none' }, cost: 3, text: 'вернуть 8 терпения' },
  { fx: { k: 'buff', n: 2, m: 2, to: 'allyUnit' }, cost: 2, text: '+2/+2 своему' },
  { fx: { k: 'stun', n: 1, to: 'enemyUnit' }, cost: 1, text: 'чужой пропускает ход — загляделся' },
  { fx: { k: 'mana', n: 1, to: 'none' }, cost: 0, text: '+1 копейка в этот ход' },
];

function loveCard(f: Fact, base: Omit<Card, 'cost' | 'atk' | 'hp' | 'kw' | 'spell' | 'rarity'>): Card {
  const r = hash(f.id);
  const pick = LOVE_FX[Math.floor(r * LOVE_FX.length)];
  const rarity: Rarity = r > 0.92 ? 2 : r > 0.75 ? 1 : 0;
  const play = { ...pick.fx };
  if (rarity === 2) play.n += 1;
  const cap = (f.ru || f.en || '…').replace(/^\.+\s*/, '…');
  return { ...base, name: cap, sub: pick.text, cost: pick.cost, atk: 0, hp: 0, kw: [], spell: true, rarity, play };
}

// ---------------------------------------------------------------- Lazer: техника
function militaryCard(f: Fact, base: Omit<Card, 'cost' | 'atk' | 'hp' | 'kw' | 'spell' | 'rarity'>): Card {
  const r = hash(f.id);
  const kind = f.kind ?? 'other';
  const rarity: Rarity = r > 0.85 ? 2 : r > 0.55 ? 1 : 0;
  const sub = [f.spd, f.range].filter(Boolean).join(' · ');
  if (kind === 'missile') return { ...base, sub, cost: 3, atk: 0, hp: 0, kw: [], spell: true, rarity, play: { k: 'dmg', n: 4, to: 'enemy' } };
  if (kind === 'ship' || kind === 'submarine')
    return { ...base, sub, cost: 7, atk: 4, hp: 8, kw: ['wall', 'armor'].slice(0, kind === 'ship' ? 2 : 1) as Kw[], spell: false, rarity, death: { k: 'aoe', n: 1, to: 'enemyUnit' } };
  if (kind === 'plane') return { ...base, sub, cost: 5, atk: 5, hp: 3, kw: ['rush'], spell: false, rarity };
  if (kind === 'helicopter') return { ...base, sub, cost: 4, atk: 3, hp: 3, kw: [], spell: false, rarity, play: { k: 'dmg', n: 2, to: 'enemyUnit' } };
  if (kind === 'tank') return { ...base, sub, cost: 5, atk: 4, hp: 6, kw: ['armor'], spell: false, rarity };
  return { ...base, sub, cost: 4, atk: 3, hp: 5, kw: [], spell: false, rarity };
}

function build(f: Fact): Card {
  const s = setInfo(f.set);
  const base = { id: f.id, set: f.set, coll: s.coll, n: f.n, img: f.img, name: f.name || f.player || `№${f.n}`, sub: '' };
  switch (s.coll) {
    case 'turbo':
    case 'bomb':
      return carCard(f, base, s.coll);
    case 'final':
      return footballCard(f, base);
    case 'love':
      return loveCard(f, base);
    case 'lazer':
      return militaryCard(f, base);
  }
}

export const CARDS: Card[] = FACTS.map(build);
const BY_ID = new Map(CARDS.map((c) => [c.id, c]));
export const card = (id: string): Card => BY_ID.get(id)!;
export const hasCard = (id: string) => BY_ID.has(id);

/** Текст эффекта для карты и подсказки. */
export function fxText(fx: Fx): string {
  const who = { enemy: 'врагу', enemyUnit: 'чужому вкладышу', allyUnit: 'своему', anyUnit: 'любому вкладышу', none: '' }[fx.to];
  switch (fx.k) {
    case 'dmg':
      return `${fx.n} урона ${who}`;
    case 'heal':
      return fx.to === 'none' ? `вернуть ${fx.n} терпения` : `вылечить ${who} на ${fx.n}`;
    case 'buff':
      return `+${fx.n}/+${fx.m ?? 0} ${who}`;
    case 'draw':
      return `взять ${fx.n}`;
    case 'armor':
      return `${who} — «Броня»`;
    case 'stun':
      return `${who} пропускает ход`;
    case 'team':
      return `своим той же сборной +${fx.n}/+${fx.m ?? 0}`;
    case 'aoe':
      return `${fx.n} урона всем чужим`;
    case 'mana':
      return `+${fx.n} копейка в этот ход`;
  }
}

// ---------------------------------------------------------------- колоды
export const DECK_SIZE = 20;
export const MAX_COPIES = 2;

export interface Starter {
  id: string;
  label: string;
  hint: string;
  colls: Coll[];
}

export const STARTERS: Starter[] = [
  { id: 'garage', label: 'Гараж (Turbo)', hint: COLL_STYLE.turbo, colls: ['turbo'] },
  { id: 'race', label: 'Гонка (BomBibom)', hint: COLL_STYLE.bomb, colls: ['bomb', 'turbo'] },
  { id: 'team', label: 'Сборная (Final + Love is)', hint: COLL_STYLE.final, colls: ['final', 'love'] },
  { id: 'army', label: 'Техника (Lazer + Turbo)', hint: COLL_STYLE.lazer, colls: ['lazer', 'turbo'] },
  { id: 'love', label: 'Любовь (Love is + Turbo)', hint: COLL_STYLE.love, colls: ['love', 'turbo'] },
];

/** Кривая цены стартовой колоды: сколько карт какой цены (сумма 20). */
const CURVE = [0, 3, 4, 4, 3, 3, 2, 1, 0, 0];

/** Стартовая колода: обычные и нечастые карты своих коллекций по кривой цены; выбор детерминирован (одна и та же у всех). */
export function starterDeck(id: string): string[] {
  const st = STARTERS.find((s) => s.id === id) ?? STARTERS[0];
  const pool = CARDS.filter((c) => st.colls.includes(c.coll) && c.rarity <= 1);
  // основная коллекция — 2/3 колоды
  const main = st.colls[0];
  const deck: string[] = [];
  const take = (pred: (c: Card) => boolean, n: number) => {
    const cand = pool.filter((c) => pred(c) && !deck.includes(c.id)).sort((a, b) => hash(a.id + st.id) - hash(b.id + st.id));
    for (const c of cand.slice(0, n)) deck.push(c.id);
  };
  for (let cost = 0; cost < CURVE.length; cost++) {
    const n = CURVE[cost];
    if (!n) continue;
    const nMain = st.colls.length > 1 ? Math.ceil((n * 2) / 3) : n;
    take((c) => c.coll === main && c.cost === cost, nMain);
  }
  // добор второй коллекцией и чем придётся до 20
  for (let cost = 0; deck.length < DECK_SIZE && cost < CURVE.length; cost++) take((c) => c.cost === cost, Math.max(0, CURVE[cost] - deck.filter((d) => card(d).cost === cost).length));
  if (deck.length < DECK_SIZE) take(() => true, DECK_SIZE - deck.length);
  return deck.slice(0, DECK_SIZE);
}

/** Колода из опции: имя стартовой или «c:» + id через точку с запятой. Неверные id выкидываются, недобор — из стартовой. */
export function deckFrom(spec: string): string[] {
  if (spec.startsWith('c:')) {
    const ids = spec.slice(2).split(';').filter(hasCard);
    const counts = new Map<string, number>();
    const out: string[] = [];
    for (const id of ids) {
      const k = (counts.get(id) ?? 0) + 1;
      if (k > MAX_COPIES) continue;
      counts.set(id, k);
      out.push(id);
    }
    if (out.length >= DECK_SIZE) return out.slice(0, DECK_SIZE);
    for (const id of starterDeck('garage')) if (out.length < DECK_SIZE) out.push(id);
    return out;
  }
  return starterDeck(spec);
}
