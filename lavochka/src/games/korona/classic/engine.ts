/**
 * «Корона Эмбера», «Классика 1994» — движок по книге правил 1994 года (docs/analysis/korona-classic.md).
 *
 * Ход: бросок → выбор конечной клетки (`go`, «остановиться проходом» — на лазарете, заготконторе, обменном пункте,
 * провале и полях, где тебя ждут карты) → на клетке лежат карты приключений — выполняешь их (по номерам), иначе
 * условия поля. Условия полей и карт — сценарии (script.ts), их исполняет `run()`: операции идут по порядку,
 * вопрос игроку ставится в `prompt` и ждёт `answer`. Бой — `fight` (до боя — средства защиты, бросок, после
 * поражения — защита от последствий).
 */
import type { Rng } from '../../../core/types';
import { EDGES1, ROAD_BY_ID, RINGS_PJ, ROOM_PJ, cell as cellGeo } from '../data';
import { ADV } from './cards';
import { CELL_OPS, FALL_NEED, cellKind } from './cells';
import { ADV_TEXT, ITEMS, PRINCES, TRAVELLERS, advText, cellName, cellsNamed, itemNamed, norm } from './data';
import type { Align, Battle, Branch, Cond, Op, Pts, Stat, Status, World } from './script';
import { STATS } from './script';
import { SPECIAL } from './special';
import type { CHero, CState, Fight, FieldCard, Frame, Prompt, Thing } from './state';

export interface Seat {
  seat: number;
  kind: 'human' | 'bot';
  name: string;
  level?: number;
}

export type Action =
  | { type: 'roll' }
  | { type: 'go'; path: number[] }
  | { type: 'answer'; key: string }
  /** применить вещь в удобный момент (тюк с провизией, бурдюк, амулет №6, мухомор, пентаграмма, лофофора) */
  | { type: 'use'; id: string };

export type Event =
  | { type: 'roll'; seat: number; die: number; dice?: number[]; why?: string }
  | { type: 'step'; seat: number; cell: number }
  | { type: 'sector'; seat: number; cell: number; sector: number }
  | { type: 'card'; seat: number; n: number; title: string; text: string }
  | { type: 'pts'; seat: number; p: Pts; delta: number }
  | { type: 'say'; seat: number; text: string }
  | { type: 'fight'; seat: number; foe: string; foeV: number; foeRoll: number; me: number; myRoll: number; res: 'win' | 'lose' | 'draw' }
  | { type: 'thing'; seat: number; id: string; gain: boolean }
  | { type: 'zone'; seat: number; text: string }
  | { type: 'turn'; seat: number }
  | { type: 'over'; winner: number };

/** Сбор событий одного действия. */
export interface X {
  ev: Event[];
  rng: Rng;
}

// ---------- граф поля 1 ----------

const NEIGH: Record<number, number[]> = {};
for (const [a, b] of EDGES1) {
  (NEIGH[a] ??= []).push(b);
  (NEIGH[b] ??= []).push(a);
}
export const neighbours = (n: number): number[] => NEIGH[n] ?? [];

/** Мир клетки по правилам: Сила, Ум, Магия, Золото; межмировые (лазарет, заготконтора, обменные пункты, провалы) — null. */
export function worldOf(n: number): World | null {
  const w = (cellGeo(n)?.world ?? '').toLowerCase();
  if (w.includes('маги')) return 'Магия';
  if (w.includes('ума')) return 'Ум';
  if (w.includes('силы')) return 'Сила';
  if (w.includes('золот')) return 'Золото';
  return null;
}
/** Каким качеством бьются в Мире. */
export const statOfWorld = (w: World | null): Stat => (w === 'Ум' ? 'ПУ' : w === 'Магия' ? 'ПМ' : 'ПС');

/** Центр Мира (для «по часовой стрелке»). */
const CENTRE: Partial<Record<World, { x: number; y: number }>> = {};
for (const w of ['Сила', 'Ум', 'Магия', 'Золото'] as World[]) {
  const cs = Object.keys(NEIGH).map(Number).filter((n) => worldOf(n) === w).map((n) => cellGeo(n)!);
  CENTRE[w] = { x: cs.reduce((s, c) => s + c.x + c.w / 2, 0) / cs.length, y: cs.reduce((s, c) => s + c.y + c.h / 2, 0) / cs.length };
}
const angle = (n: number, w: World) => {
  const c = cellGeo(n)!;
  const o = CENTRE[w]!;
  return Math.atan2(c.y + c.h / 2 - o.y, c.x + c.w / 2 - o.x);
};
/** Следующая клетка по часовой стрелке в том же Мире (на экране y вниз — часовая = рост угла). */
export function clockwise(n: number, prev?: number): number {
  const w = worldOf(n);
  const nb = neighbours(n).filter((m) => m !== prev);
  const same = w ? nb.filter((m) => worldOf(m) === w) : nb;
  const list = same.length ? same : nb.length ? nb : neighbours(n);
  if (!w || list.length === 1) return list[0];
  const a0 = angle(n, w);
  const turn = (m: number) => {
    let d = angle(m, w) - a0;
    while (d <= 0) d += Math.PI * 2;
    return d;
  };
  return [...list].sort((a, b) => turn(a) - turn(b))[0];
}

/** Двери подполей: войдя, ход кончается, путник бродит по секторам. */
const DOOR: Record<number, { sub: number; exit: number }> = { 26: { sub: 25, exit: 33 }, 29: { sub: 28, exit: 35 } };

// ---------- партия ----------

const shuffle = <T>(a: T[], rng: Rng): T[] => {
  const d = [...a];
  for (let i = d.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [d[i], d[j]] = [d[j], d[i]];
  }
  return d;
};

export function newHero(seat: number, tr: number, shelf: number[]): CHero {
  const t = TRAVELLERS[tr];
  const things: Thing[] = [];
  // личный предмет путника: «всегда имеет лошадь / шлем / бластер / кольт»
  if (t.own) {
    const card = ITEMS.find((i) => i.kind === 'owned' && i.name === t.own && i.place && norm(i.place) === norm(t.name));
    if (card) {
      things.push({ id: `i${card.id}` });
      const k = shelf.indexOf(card.id);
      if (k >= 0) shelf.splice(k, 1);
    }
  }
  return {
    seat, tr, sex: t.sex, align: t.align, honest: t.honest, patient: t.patient, chaos: false,
    life: t.life, st: { ...t.st }, po: 0, gold: t.gold,
    cell: t.start, sector: null, zone: 'world', node: 'fall', ring: 0, gate: null, room: 0, prince: null,
    things, friends: [], status: [], skip: 0, lastPath: [],
  };
}

export function newState(seats: Seat[], rng: Rng, opts: { deck?: number } = {}): CState {
  const ids = seats.map((s) => s.seat).sort((a, b) => a - b);
  const shelf = ITEMS.filter((i) => i.kind !== 'owned' || !TRAVELLERS.some((t) => t.own && i.place && norm(i.place) === norm(t.name))).map((i) => i.id);
  // личные предметы лежат у карт путников, на поле предметов их нет — вернём при смене путника
  const order = shuffle(TRAVELLERS.map((t) => t.id), rng);
  const heroes: Record<number, CHero> = {};
  const kinds: CState['kinds'] = {};
  const names: CState['names'] = {};
  const levels: CState['levels'] = {};
  ids.forEach((seat, k) => {
    heroes[seat] = newHero(seat, order[k], shelf);
    const s = seats.find((x) => x.seat === seat)!;
    kinds[seat] = s.kind;
    names[seat] = s.name;
    levels[seat] = s.level ?? 1;
  });
  // «Игру начинает дама. Если таковой нет, либо дам более одной — жребий»
  const ladies = ids.filter((s) => heroes[s].sex === 'ж');
  const first = ladies.length === 1 ? ladies[0] : ids[rng.int(ids.length)];
  const all = ADV_TEXT.map((a) => a.n).filter((n) => ADV[n]);
  const deck = shuffle(all, rng).slice(0, opts.deck ?? all.length);
  return {
    seats: ids, kinds, names, levels, heroes, turn: first, phase: 'roll', die: 0,
    deck, discard: [], field: {}, shelf, bank: 0, mafia: 0,
    run: [], prompt: null, fight: null, comet: 0, storm: null, king: null,
    log: ids.map((s) => `${names[s]} — ${TRAVELLERS[heroes[s].tr].name}.`).concat(`Первым ходит ${names[first]}.`),
    winner: null, round: 1,
  };
}

// ---------- мелкие изменения ----------

export const H = (s: CState, seat: number) => s.heroes[seat];
const tr = (h: CHero) => TRAVELLERS[h.tr];
export const say = (s: CState, x: X, seat: number, text: string) => {
  x.ev.push({ type: 'say', seat, text });
  s.log.push(text);
  if (s.log.length > 200) s.log.splice(0, s.log.length - 200);
};
export const who = (s: CState, seat: number) => s.names[seat];

/** Вещь по id. */
export const itemOf = (t: Thing) => (t.id.startsWith('i') ? ITEMS[Number(t.id.slice(1))] : undefined);
export const advOf = (t: Thing) => (t.id.startsWith('a') ? Number(t.id.slice(1)) : undefined);

/** До Провала — не больше 14 собственных ПС/ПУ/ПМ/ПО (корона регента своего мира при нужных ПО снимает предел). */
function capOf(h: CHero, p: Pts): number {
  if (p === 'ПЖ' || p === 'т') return Infinity;
  if (h.zone !== 'world') return Infinity;
  const cap = h.status.find((x) => x.k === 'cap') as Extract<Status, { k: 'cap' }> | undefined;
  if (cap && p !== 'ПО') return Math.min(14, cap.n);
  if (p !== 'ПО' && h.regent && statOfWorld(h.regent) === p) {
    const crown = h.things.map(itemOf).find((i) => i?.kind === 'crown');
    if (crown && h.po >= crown.po) return Infinity;
  }
  return 14;
}

const get = (h: CHero, p: Pts) => (p === 'ПЖ' ? h.life : p === 'ПО' ? h.po : p === 'т' ? h.gold : h.st[p]);
const setRaw = (h: CHero, p: Pts, v: number) => {
  if (p === 'ПЖ') h.life = v;
  else if (p === 'ПО') h.po = v;
  else if (p === 'т') h.gold = v;
  else h.st[p] = v;
};

/** Изменить пункт без компенсации (с пределом). */
export function bump(s: CState, x: X, seat: number, p: Pts, d: number): number {
  const h = H(s, seat);
  if (d > 0 && p === 'т' && h.status.some((st) => st.k === 'nogold')) return 0;
  const was = get(h, p);
  const v = Math.max(0, Math.min(capOf(h, p), was + d));
  if (v === was) return 0;
  setRaw(h, p, v);
  x.ev.push({ type: 'pts', seat, p, delta: v - was });
  return v - was;
}

/**
 * Потерять n пунктов по правилу компенсации: нет ПС — платишь ПУ или ПМ (1:1), нет ПМ — ПС или ПУ, нет денег — ПУ
 * (1 за 5 талеров), ничего нет — ПЖ. Опыт неприкосновенен. Безумный (ПУ 0) за ум платит жизнью.
 */
export function lose(s: CState, x: X, seat: number, p: Pts, n: number) {
  const h = H(s, seat);
  if (n <= 0) return;
  if (p === 'ПО') {
    bump(s, x, seat, 'ПО', -n);
    return;
  }
  if (p === 'ПЖ') {
    bump(s, x, seat, 'ПЖ', -n);
    return;
  }
  const have = get(h, p);
  const paid = Math.min(have, n);
  if (paid) bump(s, x, seat, p, -paid);
  let left = n - paid;
  if (!left) return;
  if (p === 'т') {
    // нет денег — теряешь ум: 1 ПУ за 5 талеров (неполные 5 — тоже 1 ПУ)
    const pu = Math.ceil(left / 5);
    return lose(s, x, seat, 'ПУ', pu);
  }
  if (p === 'ПУ') {
    // безумному (и вообще без ума) — жизнью; правило компенсации за ум отдельно не названо — платят жизнью
    bump(s, x, seat, 'ПЖ', -left);
    return;
  }
  // ПС → ПУ или ПМ; ПМ → ПС или ПУ (по возможности — тем, чего больше)
  const alt: Stat[] = p === 'ПС' ? ['ПУ', 'ПМ'] : ['ПС', 'ПУ'];
  for (const a of [...alt].sort((u, v) => h.st[v] - h.st[u])) {
    const k = Math.min(h.st[a], left);
    if (k) bump(s, x, seat, a, -k);
    left -= k;
    if (!left) return;
  }
  if (left) bump(s, x, seat, 'т', -Math.min(h.gold, left * 5)) || bump(s, x, seat, 'ПЖ', -left);
}

/** Изменить пункт: прибавка с пределом, потеря — по компенсации. */
export function add(s: CState, x: X, seat: number, p: Pts, n: number) {
  if (n >= 0) bump(s, x, seat, p, n);
  else lose(s, x, seat, p, -n);
}

// ---------- вещи ----------

export const isAmulet = (t: Thing) => itemOf(t)?.kind === 'amulet';
export const isMagic = (t: Thing) => itemOf(t)?.kind === 'magic' || (advOf(t) != null && ADV[advOf(t)!]?.kind === 'магический предмет');
export const isTrophy = (t: Thing) => advOf(t) != null && !!(t as Thing & { trophy?: unknown }).pts === false && TROPHY.has(advOf(t)!);
/** Номера карт, которые сейчас трофеи (запоминаются при взятии). */
const TROPHY = new Set<number>();
/** Предметы, которые считаются в лимит 4: предметы, магические, принадлежащие, амулеты (не трофеи и не карты в руке). */
export const counts = (t: Thing) => {
  const i = itemOf(t);
  if (i) return i.kind !== 'smuggle' && i.kind !== 'friend' && !i.name.startsWith('долговой') && !i.name.startsWith('телохранитель');
  const a = advOf(t);
  return a != null && (ADV[a]?.kind === 'предмет' || ADV[a]?.kind === 'магический предмет');
};
/** Сколько вещей можно нести: 4, с лошадью — 6, друзья-носильщики — плюс их. */
export function capacity(h: CHero): number {
  let n = h.things.some((t) => itemOf(t)?.name === 'лошадь') ? 6 : 4;
  for (const f of h.friends) n += f.carries ?? 0;
  return n;
}
/** Можешь пользоваться вещью: хватает ПО (принц — всегда), не сломана, амулеты в силе. */
export function usable(h: CHero, t: Thing): boolean {
  if (t.broken) return false;
  const i = itemOf(t);
  if (i?.kind === 'amulet' && h.status.some((x) => x.k === 'noamulets')) return false;
  if (h.prince != null) return true;
  const need = i ? i.po : (t as Thing).pts ?? 0;
  return h.po >= (i ? need : ADV[advOf(t)!]?.note ? 0 : 0);
}
export const hasItem = (h: CHero, name: string) => h.things.some((t) => itemOf(t)?.name === name.toLowerCase());
export const hasGun = (h: CHero) => h.things.some((t) => usable(h, t) && /кольт|бластер|ружь/.test(itemOf(t)?.name ?? ''));
export const hasFire = (h: CHero) => h.things.some((t) => advOf(t) === 11 || advOf(t) === 12);

/** Положить вещь путнику (сверх лимита — оставить на поле; второй магический предмет — выбрать). */
export function giveThing(s: CState, x: X, seat: number, t: Thing) {
  const h = H(s, seat);
  h.things.push(t);
  x.ev.push({ type: 'thing', seat, id: t.id, gain: true });
  const carried = h.things.filter(counts);
  if (carried.length > capacity(h)) {
    // лишнее остаётся на поле: по правилам игрок выбирает; оставляем последнюю взятую
    dropThing(s, x, seat, t, 'field');
    say(s, x, seat, `${who(s, seat)}: больше вещей не унести — ${thingName(t)} остаётся на поле.`);
  }
}

/** Снять вещь: на поле предметов (shelf), в отбой карт приключений или на текущее поле. */
export function dropThing(s: CState, x: X, seat: number, t: Thing, to: 'shelf' | 'discard' | 'field' | 'none' = 'shelf') {
  const h = H(s, seat);
  const k = h.things.indexOf(t);
  if (k >= 0) h.things.splice(k, 1);
  else {
    const f = h.friends.indexOf(t);
    if (f >= 0) h.friends.splice(f, 1);
  }
  x.ev.push({ type: 'thing', seat, id: t.id, gain: false });
  const i = itemOf(t);
  const a = advOf(t);
  if (to === 'none') return;
  if (i) {
    if (to === 'field') leaveThing(s, h.cell, t);
    else s.shelf.push(i.id);
  } else if (a != null) {
    if (to === 'field') putCard(s, h.cell, { n: a });
    else s.discard.push(a);
  }
}
const leaveThing = (s: CState, cellN: number, t: Thing) => {
  const list = (s.field[cellN] ??= []);
  // вещь-карта предмета на поле: храним при ближайшей карте поля или отдельно (как «вещи под охраной» пустой карты)
  list.push({ n: 0, things: [t] });
};
export const thingName = (t: Thing) => itemOf(t)?.name ?? advText(advOf(t) ?? 0)?.title.toLowerCase() ?? t.id;

/** Взять карту предмета с поля предметов по имени. */
export function takeItem(s: CState, x: X, seat: number, name: string): boolean {
  const ids = itemNamed(name).map((i) => i.id).filter((id) => s.shelf.includes(id));
  if (!ids.length) return false;
  s.shelf.splice(s.shelf.indexOf(ids[0]), 1);
  const card = ITEMS[ids[0]];
  giveThing(s, x, seat, { id: `i${card.id}`, uses: card.uses ?? undefined });
  return true;
}

// ---------- карты на полях ----------

export function putCard(s: CState, cellN: number, fc: FieldCard) {
  const list = (s.field[cellN] ??= []);
  list.push(fc);
  list.sort((a, b) => a.n - b.n);
}
export function takeCard(s: CState, cellN: number, n: number): FieldCard | undefined {
  const list = s.field[cellN] ?? [];
  const k = list.findIndex((c) => c.n === n);
  if (k < 0) return undefined;
  const [fc] = list.splice(k, 1);
  if (!list.length) delete s.field[cellN];
  return fc;
}

/** Вернуть карту в середину оставшейся колоды. */
export function toMiddle(s: CState, n: number) {
  const mid = Math.floor(s.deck.length / 2);
  s.deck.splice(mid, 0, n);
}

/** Верхняя карта колоды (колода кончилась — перетасовать отбой). */
export function drawTop(s: CState, x: X): number | undefined {
  if (!s.deck.length && s.discard.length) {
    s.deck = shuffle(s.discard, x.rng);
    s.discard = [];
  }
  return s.deck.shift();
}

// ---------- условия ----------

export function check(s: CState, seat: number, c: Cond): boolean {
  const h = H(s, seat);
  if ('not' in c) return !check(s, seat, c.not);
  if ('any' in c) return c.any.some((k) => check(s, seat, k));
  if ('all' in c) return c.all.every((k) => check(s, seat, k));
  if ('align' in c) return (Array.isArray(c.align) ? c.align : [c.align]).includes(h.align);
  if ('honest' in c) return h.honest === c.honest;
  if ('patient' in c) return h.patient === c.patient;
  if ('sex' in c) return h.sex === c.sex;
  if ('world' in c) {
    const w = worldOf(h.cell);
    return !!w && (Array.isArray(c.world) ? c.world : [c.world]).includes(w);
  }
  if ('busy' in c) return busy(h);
  if ('sum' in c) {
    const v = h.st.ПС + h.st.ПУ + h.st.ПМ;
    return (c.min == null || v >= c.min) && (c.max == null || v <= c.max);
  }
  if ('pts' in c) {
    const v = get(h, c.pts);
    return (c.min == null || v >= c.min) && (c.max == null || v <= c.max);
  }
  if ('item' in c) return hasItem(h, c.item);
  if ('adv' in c) return h.things.some((t) => advOf(t) === c.adv) || h.friends.some((t) => advOf(t) === c.adv);
  if ('has' in c) {
    switch (c.has) {
      case 'horse':
        return hasItem(h, 'лошадь');
      case 'friend':
        return h.friends.length > 0;
      case 'item':
        return h.things.some((t) => counts(t) && !isAmulet(t));
      case 'amulet':
        return h.things.some(isAmulet);
      case 'magic':
        return h.things.some(isMagic);
      case 'helmet':
        return hasItem(h, 'шлем');
      case 'fire':
        return hasFire(h);
      case 'gun':
        return hasGun(h);
      case 'trophy':
        return h.things.some((t) => advOf(t) != null && TROPHIES.has(advOf(t)!));
      case 'gold':
        return h.gold > 0;
      case 'crown':
        return h.things.some((t) => itemOf(t)?.kind === 'crown');
    }
  }
  return false;
}
/** «Выполняешь условия другой карты»: идёшь строго определённым путём. */
export const busy = (h: CHero) => h.status.some((st) => st.k === 'cw' || st.k === 'even' || st.k === 'route' || st.k === 'fly' || st.k === 'world' || st.k === 'name');
/** Карты-трофеи (номер → трофей), заполняется при взятии. */
export const TROPHIES = new Map<number, import('./script').Trophy>();

// ---------- исполнение сценариев ----------

/** Поставить сценарий на исполнение (наверх стека). */
export function push(s: CState, f: Omit<Frame, 'i'>) {
  s.run.push({ ...f, i: 0 });
}

/** Задать вопрос и остановить исполнение. */
export function ask(s: CState, p: Prompt) {
  s.prompt = p;
}

/** Кнопка «Бросить кубик» для человека; бот и сам бросок — в ответе. */
function askRoll(s: CState, seat: number, kind: string, q: string, data?: Record<string, unknown>) {
  ask(s, { seat, q, kind, opts: [{ label: 'Бросить кубик', key: 'roll' }], data });
}

const rollDice = (x: X, n: number) => Array.from({ length: n }, () => 1 + x.rng.int(6));

/** Итог карты, у которой сценарий кончился без явной судьбы: в отбой. */
function finishFrame(s: CState, f: Frame) {
  if (f.card && !f.fated) s.discard.push(f.card);
}

/**
 * Крутить сценарии, пока не понадобится ответ игрока или пока стек не опустеет. Возвращает true, если всё
 * исполнено (ход можно передавать).
 */
export function run(s: CState, x: X): boolean {
  for (let guard = 0; guard < 2000; guard++) {
    if (s.prompt || s.fight?.stage) {
      if (s.fight && !s.prompt) fightStep(s, x);
      if (s.prompt) return false;
      continue;
    }
    if (s.winner != null) return true;
    const f = s.run[s.run.length - 1];
    if (!f) return true;
    const h = H(s, f.seat);
    if (h.zone === 'dead') {
      s.run.pop();
      continue;
    }
    // ушёл с клетки посреди серии карт — остальные карты остаются на поле, где взяты
    if (f.card && f.i === 0 && f.at != null && h.cell !== f.at) {
      s.run.pop();
      putCard(s, f.at, { n: f.card });
      continue;
    }
    if (f.i === 0 && f.card) {
      const t = advText(f.card)!;
      x.ev.push({ type: 'card', seat: f.seat, n: f.card, title: t.title, text: t.text });
      s.log.push(`${who(s, f.seat)}: «${t.title}».`);
    }
    if (f.i >= f.ops.length) {
      s.run.pop();
      finishFrame(s, f);
      continue;
    }
    const op = f.ops[f.i++];
    exec(s, x, f, op);
    deathCheck(s, x, f.seat);
  }
  return true;
}

function frameOf(s: CState, f: Frame, ops: Op[]) {
  // вложенные операции — тот же контекст карты, но судьбу карты решает внешний кадр
  push(s, { seat: f.seat, ops, card: undefined, at: f.at, cell: f.cell });
  (s.run[s.run.length - 1] as Frame & { parent?: number }).parent = f.card;
}

/** Ветвь броска по сумме. */
const pick = (br: Branch[], v: number) => br.find((b) => (b.r && v >= b.r[0] && v <= b.r[1]) || b.v?.includes(v)) ?? br.find((b) => b.else);

/** Карта, чей сценарий сейчас исполняется (с учётом вложенных кадров). */
export function cardOf(s: CState): number | undefined {
  for (let k = s.run.length - 1; k >= 0; k--) {
    const f = s.run[k] as Frame & { parent?: number };
    if (f.card) return f.card;
    if (f.parent) return f.parent;
  }
  return undefined;
}
function outerFrame(s: CState): Frame | undefined {
  for (let k = s.run.length - 1; k >= 0; k--) if (s.run[k].card) return s.run[k];
  return undefined;
}

export function exec(s: CState, x: X, f: Frame, op: Op) {
  const seat = f.seat;
  const h = H(s, seat);
  switch (op.t) {
    case 'say':
      say(s, x, seat, op.s);
      return;
    case 'add':
      add(s, x, seat, op.p, op.n);
      return;
    case 'zero':
      bump(s, x, seat, op.p, -get(h, op.p));
      return;
    case 'set': {
      const v = get(h, op.p);
      if (op.up ? v < op.n : v !== op.n) bump(s, x, seat, op.p, op.n - v);
      return;
    }
    case 'tax': {
      const k = Math.ceil(h.gold * op.part);
      bump(s, x, seat, 'т', -k);
      return;
    }
    case 'convert': {
      const [fp, fn] = op.from;
      if (get(h, fp) < fn) {
        if (op.else) frameOf(s, f, op.else);
        else lose(s, x, seat, fp, fn);
        return;
      }
      bump(s, x, seat, fp, -fn);
      bump(s, x, seat, op.to[0], op.to[1]);
      return;
    }
    case 'roll': {
      // человек бросает сам; итог — в обработчике ответа
      askRoll(s, seat, 'roll', op.dice === 2 ? 'Дважды брось кубик' : op.dice === 3 ? 'Трижды брось кубик' : 'Брось кубик', { op, times: op.times ?? 1 });
      return;
    }
    case 'choice': {
      const opts = op.opts.map((o, k) => ({ label: o.label, key: String(k), ok: !o.if || check(s, seat, o.if) })).filter((o) => o.ok);
      if (opts.length === 1) {
        frameOf(s, f, op.opts[Number(opts[0].key)].ops);
        return;
      }
      ask(s, { seat, q: op.q, kind: 'choice', opts: opts.map(({ label, key }) => ({ label, key })), data: { op } });
      return;
    }
    case 'if':
      if (check(s, seat, op.c)) frameOf(s, f, op.then);
      else if (op.else) frameOf(s, f, op.else);
      return;
    case 'battle':
      startFight(s, x, seat, op, cardOf(s));
      return;
    case 'move':
      moveTo(s, x, seat, op.to, !!op.cond);
      return;
    case 'skip':
      h.skip += op.n;
      say(s, x, seat, `${who(s, seat)} пропускает ${op.n === 1 ? 'ход' : `${op.n} хода`}.`);
      return;
    case 'align': {
      const order: Align[] = ['злой', 'нейтральный', 'добрый'];
      const to = op.to ?? order[Math.max(0, Math.min(2, order.indexOf(h.align) + (op.step ?? 0)))];
      if (to !== h.align) {
        h.align = to;
        say(s, x, seat, `${who(s, seat)} становится: ${to}.`);
        // сменил характер — друзья, которым ты теперь враг, уходят и остаются на поле
        for (const fr of [...h.friends]) {
          const n = advOf(fr);
          if (n != null && !friendOk(h, n)) {
            dropThing(s, x, seat, fr, 'field');
            say(s, x, seat, `${thingName(fr)} уходит от ${who(s, seat)}.`);
          }
        }
      }
      return;
    }
    case 'chaos':
      h.chaos = true;
      say(s, x, seat, `${who(s, seat)} завербован Хаосом.`);
      return;
    case 'card': {
      const of = outerFrame(s);
      const n = cardOf(s);
      if (!n) return;
      if (of) of.fated = true;
      if (op.fate === 'discard') s.discard.push(n);
      else if (op.fate === 'middle') toMiddle(s, n);
      else if (op.fate === 'leave') putCard(s, h.cell, { n });
      else if (op.fate === 'keep') {
        if (!h.things.some((t) => advOf(t) === n)) giveThing(s, x, seat, { id: `a${n}` });
      } else if (op.fate === 'adjacent') {
        const nb = neighbours(h.cell);
        putCard(s, nb[x.rng.int(nb.length)], { n });
      }
      return;
    }
    case 'settle': {
      const of = outerFrame(s);
      const n = cardOf(s);
      if (!n) return;
      if (of) of.fated = true;
      const to = cellsNamed(op.cell);
      const c = to[0];
      if (c == null) return;
      putCard(s, c, { n, settled: true });
      say(s, x, seat, `«${advText(n)!.title}» поселяется на поле «${cellName(c)}».`);
      // поселился — встреча будет там; дальше по карте сейчас не идём
      s.run.length = Math.max(0, s.run.indexOf(of!));
      return;
    }
    case 'trophy': {
      const n = cardOf(s);
      if (!n) return;
      const of = outerFrame(s);
      if (of) of.fated = true;
      TROPHIES.set(n, op.tr);
      giveThing(s, x, seat, { id: `a${n}` });
      return;
    }
    case 'friend': {
      const n = cardOf(s);
      if (!n) return;
      const of = outerFrame(s);
      if (of) of.fated = true;
      h.friends.push({ id: `a${n}`, with: op.with, hunts: op.hunts, carries: op.carries });
      x.ev.push({ type: 'thing', seat, id: `a${n}`, gain: true });
      say(s, x, seat, `«${advText(n)!.title}» идёт с ${who(s, seat)}.`);
      return;
    }
    case 'own': {
      const n = cardOf(s);
      if (!n) return;
      const of = outerFrame(s);
      if (of) of.fated = true;
      if (op.magic) {
        const old = h.things.find(isMagic);
        if (old) dropThing(s, x, seat, old, 'field');
      }
      giveThing(s, x, seat, { id: `a${n}`, pts: op.po });
      if (op.bonus) for (const [k, v] of Object.entries(op.bonus)) bump(s, x, seat, k as Stat, v!);
      return;
    }
    case 'gain':
      gainItem(s, x, seat, op);
      return;
    case 'lose':
      loseThing(s, x, seat, op.what, op.else, f);
      return;
    case 'status':
      h.status.push(JSON.parse(JSON.stringify(op.st)));
      return;
    case 'each': {
      const w = worldOf(h.cell);
      for (const o of s.seats) {
        const oh = H(s, o);
        if (oh.zone !== 'world') continue;
        if (!op.everywhere && worldOf(oh.cell) !== w) continue;
        if (op.who && !check(s, o, op.who)) continue;
        push(s, { seat: o, ops: op.ops });
      }
      return;
    }
    case 'contest': {
      const best = contest(s, x, op.dice);
      if (op.prize) bump(s, x, best, 'т', op.prize);
      if (op.pay && best !== seat) {
        const paid = Math.min(h.gold, op.pay);
        bump(s, x, seat, 'т', -paid);
        bump(s, x, best, 'т', paid);
        if (paid < op.pay) h.status.push({ k: 'debt', т: op.pay - paid, to: 'player' });
      }
      return;
    }
    case 'cell':
      cellConditions(s, x, seat, true);
      return;
    case 'draw':
      drawCards(s, x, seat, op.n);
      return;
    case 'shop':
      shop(s, x, seat);
      return;
    case 'stop': {
      // закончить сценарий внешней карты
      const of = outerFrame(s) ?? f;
      const k = s.run.indexOf(of);
      for (const fr of s.run.splice(k + 1)) void fr;
      of.i = of.ops.length;
      return;
    }
    case 'special': {
      const fn = SPECIAL[op.id];
      if (fn) fn(s, x, seat, op, f);
      else say(s, x, seat, `(особое правило «${op.id}» ещё не сделано)`);
      return;
    }
  }
}

/** Все бросают dice кубиков, наибольший (равные перебрасывают) — победитель. */
function contest(s: CState, x: X, dice: number): number {
  let pool = s.seats.filter((o) => H(s, o).zone !== 'dead' && H(s, o).zone !== 'out');
  for (let k = 0; k < 20 && pool.length > 1; k++) {
    const r = pool.map((o) => ({ o, v: rollDice(x, dice).reduce((a, b) => a + b, 0) }));
    for (const e of r) x.ev.push({ type: 'roll', seat: e.o, die: e.v, why: 'спор' });
    const top = Math.max(...r.map((e) => e.v));
    pool = r.filter((e) => e.v === top).map((e) => e.o);
  }
  return pool[0];
}

// ---------- друзья ----------

/** Подходит ли друг по характеру: «друг для добрых, для прочих враг» (по тексту вида карты). */
export function friendOk(h: CHero, n: number): boolean {
  if (h.prince != null) return true;
  const kind = (advText(n)?.kind ?? '').toLowerCase();
  if (!kind.startsWith('друг')) return true;
  if (kind.includes('для всех')) return true;
  const forWhom = /друг для (\S+)/.exec(kind)?.[1] ?? '';
  if (forWhom.startsWith('добр')) return h.align === 'добрый';
  if (forWhom.startsWith('зл')) return h.align === 'злой';
  if (forWhom.startsWith('нейтр')) return h.align === 'нейтральный';
  if (forWhom.startsWith('честн')) return h.honest;
  if (forWhom.startsWith('нечестн')) return !h.honest;
  if (forWhom.startsWith('мужч')) return h.sex === 'м';
  if (forWhom.startsWith('женщ')) return h.sex === 'ж';
  return true;
}

// ---------- предметы ----------

function gainItem(s: CState, x: X, seat: number, op: Extract<Op, { t: 'gain' }>) {
  if (op.item) {
    if (!takeItem(s, x, seat, op.item)) say(s, x, seat, `Карты «${op.item}» на поле предметов нет.`);
    return;
  }
  const pool = s.shelf.map((id) => ITEMS[id]).filter((i) => (op.any === 'amulet' ? i.kind === 'amulet' : op.any === 'item' ? i.kind === 'item' : i.kind === 'item' || i.kind === 'amulet'));
  const names = [...new Set(pool.map((i) => i.name))];
  if (!names.length) return;
  ask(s, { seat, q: 'Выбери карту с поля предметов', kind: 'gainPick', opts: names.map((n) => ({ label: n, key: n })) });
}

function loseThing(s: CState, x: X, seat: number, what: string, orElse: Op[] | undefined, f: Frame) {
  const h = H(s, seat);
  const pickBy = (fn: (t: Thing) => boolean) => h.things.filter(fn);
  const notOwned = (t: Thing) => itemOf(t)?.kind !== 'owned';
  let list: Thing[] = [];
  let all = false;
  let comp: [Pts, number] = ['ПС', 2];
  switch (what) {
    case 'item':
      list = pickBy((t) => counts(t) && !isAmulet(t) && !isMagic(t) && notOwned(t));
      break;
    case 'magic':
      list = pickBy(isMagic);
      comp = ['ПМ', 2];
      break;
    case 'amulet':
      list = pickBy(isAmulet);
      comp = ['ПМ', 2];
      break;
    case 'item-or-amulet':
      list = pickBy((t) => counts(t) && notOwned(t));
      break;
    case 'helmet':
      list = pickBy((t) => itemOf(t)?.name === 'шлем');
      break;
    case 'horse':
      list = pickBy((t) => itemOf(t)?.name === 'лошадь');
      comp = ['ПС', 1];
      break;
    case 'friend':
      list = [...h.friends];
      comp = ['ПС', 1];
      break;
    case 'horse-or-friend':
      list = [...pickBy((t) => itemOf(t)?.name === 'лошадь'), ...h.friends];
      comp = ['ПС', 1];
      break;
    case 'items':
      list = pickBy((t) => counts(t) && !isAmulet(t) && notOwned(t));
      all = true;
      break;
    case 'amulets':
      list = pickBy(isAmulet);
      all = true;
      break;
    case 'magics':
      list = pickBy(isMagic);
      all = true;
      break;
    case 'trophies':
      list = pickBy((t) => advOf(t) != null && TROPHIES.has(advOf(t)!));
      all = true;
      break;
    case 'friends':
      list = [...h.friends];
      all = true;
      break;
  }
  if (all) {
    for (const t of list) dropThing(s, x, seat, t, 'shelf');
    return;
  }
  if (!list.length) {
    if (orElse) frameOf(s, f, orElse);
    else lose(s, x, seat, comp[0], comp[1]);
    return;
  }
  if (list.length === 1) {
    dropThing(s, x, seat, list[0], 'shelf');
    return;
  }
  ask(s, { seat, q: 'Что отдаёшь?', kind: 'losePick', opts: list.map((t) => ({ label: thingName(t), key: t.id })) });
}

// ---------- клетки ----------

/** Выполнить то, что ждёт на клетке: карты на поле (по номерам) или условия поля. */
export function cellConditions(s: CState, x: X, seat: number, again = false) {
  const h = H(s, seat);
  const here = (s.field[h.cell] ?? []).filter((c) => c.n > 0);
  if (here.length && !again) {
    for (const fc of [...here].sort((a, b) => b.n - a.n)) runFieldCard(s, x, seat, fc);
    return;
  }
  const ops = CELL_OPS[h.cell];
  if (!ops?.length) return;
  // Мир Золота: условия поля по желанию (кроме полицейского участка)
  if (worldOf(h.cell) === 'Золото' && cellKind(h.cell) !== 'police') {
    ask(s, { seat, q: `«${cellName(h.cell)}»: выполнить условия поля?`, kind: 'goldCell', opts: [{ label: 'Да', key: 'yes' }, { label: 'Нет, жду хода', key: 'no' }] });
    return;
  }
  push(s, { seat, ops, cell: h.cell });
}

/** Сценарий карты, лежащей на поле: поселённый зверь — с места встречи. */
export function runFieldCard(s: CState, x: X, seat: number, fc: FieldCard) {
  const h = H(s, seat);
  takeCard(s, h.cell, fc.n);
  const def = ADV[fc.n];
  if (!def) return;
  let ops = def.ops;
  if (fc.settled) {
    const k = ops.findIndex((o) => JSON.stringify(o).includes('"settle"'));
    ops = ops.slice(k + 1);
  }
  push(s, { seat, ops, card: fc.n, at: h.cell });
  // деньги и вещи под охраной остаются при карте, пока её не победят (обработчики в special)
  const top = s.run[s.run.length - 1] as Frame & { guard?: FieldCard };
  top.guard = fc;
}

/** Взять n верхних карт и выполнить по возрастанию номеров. */
export function drawCards(s: CState, x: X, seat: number, n: number) {
  const h = H(s, seat);
  const got: number[] = [];
  for (let k = 0; k < n; k++) {
    const c = drawTop(s, x);
    if (c != null) got.push(c);
  }
  got.sort((a, b) => a - b);
  // в стек — в обратном порядке (наверху — наименьший номер)
  for (const c of [...got].reverse()) push(s, { seat, ops: ADV[c].ops, card: c, at: h.cell });
}

/** Переместиться: на поле (и выполнить его условия, если cond). */
export function moveTo(s: CState, x: X, seat: number, to: import('./script').Where, cond: boolean) {
  const h = H(s, seat);
  let target: number | undefined;
  if ('cell' in to) target = cellsNamed(to.cell)[0];
  else if ('start' in to) target = tr(h).start;
  else if ('walk' in to) target = cellsNamed(to.walk)[0];
  else if ('cw' in to) {
    let at = h.cell;
    let prev: number | undefined;
    for (let k = 0; k < to.cw; k++) {
      const nx = clockwise(at, prev);
      prev = at;
      at = nx;
      x.ev.push({ type: 'step', seat, cell: at });
    }
    target = at;
  } else if ('nearest' in to) {
    const cands = to.nearest.flatMap(cellsNamed);
    const d = distances(h.cell);
    const best = Math.min(...cands.map((c) => d.get(c) ?? 99));
    const near = cands.filter((c) => (d.get(c) ?? 99) === best);
    if (near.length > 1) {
      ask(s, { seat, q: 'Куда?', kind: 'moveTo', opts: near.map((c) => ({ label: cellName(c), key: String(c) })), data: { cond } });
      return;
    }
    target = near[0];
  } else if ('any' in to || 'steps' in to) {
    const opts = 'any' in to ? Object.keys(NEIGH).map(Number).filter((c) => worldOf(c)) : [...routes(s, seat, h.cell, to.steps).keys()];
    ask(s, { seat, q: 'На какое поле?', kind: 'moveTo', opts: opts.map((c) => ({ label: cellName(c), key: String(c) })), data: { cond } });
    return;
  }
  if (target == null) return;
  placeAt(s, x, seat, target, cond);
}

/** Поставить фишку на клетку (с дверьми подполей) и, если cond, выполнить её условия. */
export function placeAt(s: CState, x: X, seat: number, target: number, cond: boolean) {
  const h = H(s, seat);
  const door = DOOR[target] ?? Object.values(DOOR).find((d) => d.sub === target);
  h.cell = target;
  x.ev.push({ type: 'step', seat, cell: target });
  if (door) {
    h.cell = door.sub;
    h.sector = 0;
    x.ev.push({ type: 'sector', seat, cell: door.sub, sector: 0 });
    say(s, x, seat, `${who(s, seat)} должен пройти ${door.sub === 25 ? 'Храм Бааля' : 'Перевал'} за один тур.`);
    if (cond) push(s, { seat, ops: [{ t: 'special', id: 'rosette' }] });
    return;
  }
  arrived(s, x, seat);
  if (cond) cellConditions(s, x, seat);
}

/** Что снимается приходом на поле (лазарет лечит сухотку, Храм Бааля снимает проклятия …) и маршрут регента. */
export function arrived(s: CState, x: X, seat: number) {
  const h = H(s, seat);
  const here = norm(cellName(h.cell));
  h.status = h.status.filter((st) => {
    if ('until' in st && st.until && norm(st.until) === here) {
      say(s, x, seat, `${who(s, seat)}: здесь снимается «${st.k}».`);
      if (st.k === 'cw' && st.po) bump(s, x, seat, 'ПО', st.po);
      return false;
    }
    return true;
  });
  const route = h.status.find((st) => st.k === 'route') as Extract<Status, { k: 'route' }> | undefined;
  if (route && norm(route.cells[route.done]) === here) {
    route.done++;
    if (route.done >= route.cells.length) {
      h.status = h.status.filter((st) => st !== route);
      SPECIAL.regent?.(s, x, seat, { t: 'special', id: 'regent', n: route.adv }, s.run[s.run.length - 1]);
    }
  }
}

// ---------- движение ----------

/** Расстояния по проходам. */
export function distances(from: number): Map<number, number> {
  const d = new Map<number, number>([[from, 0]]);
  const q = [from];
  for (let i = 0; i < q.length; i++) {
    for (const m of neighbours(q[i])) {
      if (!d.has(m)) {
        d.set(m, d.get(q[i])! + 1);
        q.push(m);
      }
    }
  }
  return d;
}

/** Можно ли «остановиться проходом» на клетке: лазарет (если есть деньги), заготконтора, обменные пункты, провалы
 * и поля, куда тебя зовут твои карты (сдать трофей, получить деньги …). */
export function canPassStop(s: CState, seat: number, n: number): boolean {
  const h = H(s, seat);
  const k = cellKind(n);
  if (k === 'hospital') return h.gold > 0 || h.st.ПУ === 0;
  if (k === 'office' || k === 'exchange' || k === 'fall') return true;
  if (DOOR[n]) return false;
  const name = norm(cellName(n));
  for (const t of h.things) {
    const a = advOf(t);
    if (a == null) continue;
    const tr = TROPHIES.get(a);
    if (tr?.sales.some((sl) => norm(sl.cell) === name)) return true;
    if (tr?.pass && name === norm('Пещера сокровищ')) return true;
    if (PASS_STOP[a]?.some((c) => norm(c) === name)) return true;
  }
  for (const st of h.status) if ('until' in st && st.until && norm(st.until) === name) return true;
  const route = h.status.find((st) => st.k === 'route') as Extract<Status, { k: 'route' }> | undefined;
  if (route && norm(route.cells[route.done] ?? '') === name) return true;
  // контрабанда: пункт назначения
  for (const t of h.things) {
    const i = itemOf(t);
    if (i?.kind === 'smuggle' && i.text.includes(cellName(n).replace(/[«»]/g, ''))) return true;
  }
  return false;
}
/** Поля «останавливаешься там проходом» у карт, которые держишь в руке (документы, жетоны …) — из сценариев special. */
export const PASS_STOP: Record<number, string[]> = {
  6: ['Детективное бюро'], 8: ['Игровые автоматы'], 37: ['Магшоп'], 4: ['Оружейная лавка'], 50: ['Казино'], 57: ['Отель'],
  63: ['Кабак'], 64: ['Золотая шахта'], 68: ['Тараканьи бега'], 79: ['Покинутый дом'], 86: ['Биржа'], 117: ['Заготконтора', 'Банк', 'Черная касса мафии'],
  143: ['Банк'], 161: ['Банк'], 99: ['Конные варвары'], 140: ['Ведьмин луг'],
};

/** Куда можно прийти броском: конечная клетка → путь. */
export function routes(s: CState, seat: number, from: number, die: number): Map<number, number[]> {
  const out = new Map<number, number[]>();
  const h = H(s, seat);
  const lockedWorld = noLeave(s, h) ? worldOf(from) : undefined;
  const walk = (at: number, prev: number | null, left: number, path: number[]) => {
    if (path.length) {
      if (left === 0 || DOOR[at]) {
        if (!out.has(at)) out.set(at, path);
        return;
      }
      if (canPassStop(s, seat, at) && !out.has(at)) out.set(at, path);
    }
    let next = neighbours(at).filter((m) => m !== prev);
    if (!next.length) next = neighbours(at);
    if (lockedWorld !== undefined) next = next.filter((m) => worldOf(m) === lockedWorld);
    for (const m of next) walk(m, at, left - 1, [...path, m]);
  };
  walk(from, null, die, []);
  return out;
}
export function legalPath(s: CState, seat: number, from: number, die: number, path: number[]): boolean {
  const r = routes(s, seat, from, die);
  return [...r.values()].some((p) => p.length === path.length && p.every((c, k) => c === path[k]));
}
/** Не может покинуть Мир: безумный, проклятие, очарованность, невезение, зелёная комета, кошка. */
export function noLeave(s: CState, h: CHero): boolean {
  if (s.comet > 0) return true;
  if (h.st.ПУ === 0 && h.prince == null) return true;
  return h.status.some((st) => st.k === 'world' || st.k === 'even' || st.k === 'unlucky');
}

// ---------- бой ----------

const FOE_MODS: Record<string, { kinds: string[]; p: Stat; d: number }[]> = {
  'ВЕДЬМИН ЛУГ': [{ kinds: ['нечисть'], p: 'ПМ', d: 1 }],
  ПУСТЫНЯ: [{ kinds: ['змеи и драконы'], p: 'ПС', d: 1 }],
  'ЗОНА МУТАЦИЙ': [{ kinds: ['зверь', 'враг'], p: 'ПУ', d: 2 }],
  'ВЫЖЖЕННАЯ ЗЕМЛЯ': [{ kinds: ['нечисть'], p: 'ПУ', d: 1 }],
  'ПОКИНУТЫЙ ДОМ': [{ kinds: ['нечисть', 'враг', 'зверь'], p: 'ПМ', d: 3 }],
};

export function startFight(s: CState, x: X, seat: number, b: Battle, card?: number) {
  const h = H(s, seat);
  const def = card ? ADV[card] : undefined;
  const w = worldOf(h.cell);
  const stats = b.foe ?? { name: advText(card ?? 0)?.title ?? 'противник', ...def?.stats, kind: def?.kind };
  const want = b.stat ?? statOfWorld(w);
  const known = (['ПС', 'ПУ', 'ПМ'] as Stat[]).filter((k) => (stats as unknown as Record<string, unknown>)[k] != null);
  const stat = known.includes(want) ? want : known[0] ?? want;
  let v = Number((stats as unknown as Record<string, number>)[stat] ?? 0);
  const kind = (b.foe?.kind ?? def?.kind ?? '') as string;
  for (const m of FOE_MODS[norm(cellName(h.cell))] ?? []) if (m.kinds.includes(kind) && m.p === stat) v += m.d;
  // особенности путников: Фея (нечисть −1 ПМ, враги −1 ПС, звери −1 ПУ), Монах (нечисть −1 ПМ), Следопыт (звери −1 ПУ и −1 ПМ)
  const tname = tr(h).name;
  if (h.zone === 'world') {
    if (/ФЕЯ/.test(tname)) v -= (kind === 'нечисть' && stat === 'ПМ') || (kind === 'враг' && stat === 'ПС') || (kind === 'зверь' && stat === 'ПУ') ? 1 : 0;
    if (/МОНАХ/.test(tname) && kind === 'нечисть' && stat === 'ПМ') v -= 1;
    if (/СЛЕДОПЫТ/.test(tname) && kind === 'зверь' && (stat === 'ПУ' || stat === 'ПМ')) v -= 1;
  }
  if (card && s.field[h.cell]?.some((c) => c.n === card && c.bewitched)) v *= 2;
  const count = b.count ?? 1;
  if (b.together) v *= count;
  // охота: только с огнестрельным оружием или с другом-охотником (Эльф-путник — без оружия)
  if (b.hunt && !hasGun(h) && !h.friends.some((f) => f.hunts) && !/ЭЛЬФ/.test(tname)) {
    say(s, x, seat, `${who(s, seat)}: охотиться не на кого — нужно огнестрельное оружие или друг-охотник.`);
    // противник остаётся на поле
    const of = outerFrame(s);
    if (card && of && !of.fated) {
      of.fated = true;
      putCard(s, h.cell, { n: card });
    }
    stopCard(s);
    return;
  }
  s.fight = {
    seat, card, foe: { name: stats.name ?? 'противник', kind, v, stat }, left: b.together ? 1 : count,
    hunt: !!b.hunt, without: b.without ?? [], win: b.win, lose: b.lose, draw: b.draw,
    champion: { kind: 'self' }, stage: 'pre', boost: 0, used: [],
  };
}

/** Прервать сценарий текущей карты (противник остался на поле и т.п.). */
export function stopCard(s: CState) {
  const of = outerFrame(s);
  if (!of) return;
  const k = s.run.indexOf(of);
  s.run.length = k + 1;
  of.i = of.ops.length;
}

/** Собственный показатель путника в бою + предметы + друзья ВМЕСТЕ. */
export function myPower(s: CState, seat: number, fight: Fight): number {
  const h = H(s, seat);
  const p = fight.foe.stat;
  if (fight.champion.kind === 'friend') {
    const fr = h.friends[fight.champion.i];
    return ADV[advOf(fr)!]?.stats?.[p] ?? 0;
  }
  if (fight.champion.kind === 'ghost') return fight.champion.v;
  let v = h.st[p] * (fight.double ? 2 : 1) + fight.boost;
  const noItems = fight.without.includes('items') || fight.without.includes('weapons') || norm(cellName(h.cell)) === 'ПОЛЫЕ ХОЛМЫ' || h.sector != null;
  if (!noItems) {
    for (const t of h.things) {
      if (!usable(h, t)) continue;
      const i = itemOf(t);
      if (i?.bonus[p]) v += i.bonus[p]!;
      const a = advOf(t);
      if (a != null && t.pts == null) {
        // карты-предметы с прибавкой (книга заклинаний, перстень, палица, шкура нетопыря) кладут пункты на карту героя
      }
    }
  }
  if (!fight.without.includes('friends')) for (const fr of h.friends) if (fr.with === 'вместе') v += ADV[advOf(fr)!]?.stats?.[p] ?? 0;
  // Кладбище: злые +2 ПМ, нейтральные −1, добрые −2
  if (norm(cellName(h.cell)) === 'КЛАДБИЩЕ' && p === 'ПМ') v += h.align === 'злой' ? 2 : h.align === 'нейтральный' ? -1 : -2;
  return v;
}

/** Шаг боя (когда нет вопроса). */
function fightStep(s: CState, x: X) {
  const f = s.fight!;
  if (f.stage === 'pre') {
    const opts = preFightOptions(s, f);
    if (!opts.length) {
      f.stage = 'roll';
    } else {
      ask(s, { seat: f.seat, q: `${f.foe.name}: ${f.foe.stat} ${f.foe.v} против твоих ${myPower(s, f.seat, f)}`, kind: 'pre', opts: [{ label: f.hunt ? 'Охотиться' : 'Биться', key: 'fight' }, ...opts, ...(f.hunt ? [{ label: 'Не охотиться', key: 'pass' }] : [])] });
      return;
    }
  }
  if (f.stage === 'roll') {
    askRoll(s, f.seat, 'fightRoll', `Бой: ${f.foe.name} (${f.foe.stat} ${f.foe.v}) против ${myPower(s, f.seat, f)}`);
    return;
  }
  if (f.stage === 'post') {
    const opts = postLossOptions(s, f);
    if (!opts.length) return endFight(s, x, 'lose');
    ask(s, { seat: f.seat, q: 'Ты проиграл. Чем защититься?', kind: 'post', opts: [...opts, { label: 'Принять поражение', key: 'accept' }] });
  }
}

/** Средства до боя. */
function preFightOptions(s: CState, f: Fight): { label: string; key: string }[] {
  const h = H(s, f.seat);
  const out: { label: string; key: string }[] = [];
  if (f.used.length) return [];
  const noAmulets = f.without.includes('amulets') || norm(cellName(h.cell)) === 'ПОЛЫЕ ХОЛМЫ' || h.sector != null;
  const noItems = f.without.includes('items') || norm(cellName(h.cell)) === 'ПОЛЫЕ ХОЛМЫ' || h.sector != null;
  for (const t of h.things) {
    if (!usable(h, t)) continue;
    const i = itemOf(t);
    if (!noItems && i?.name === 'граната') out.push({ label: 'Бросить гранату', key: `use:${t.id}` });
    if (!noAmulets && i?.kind === 'amulet' && i.num === 1) out.push({ label: 'Амулет №1', key: `use:${t.id}` });
    if (!noAmulets && i?.kind === 'amulet' && i.num === 2 && (f.foe.kind === 'зверь' || f.foe.kind === 'змеи и драконы')) out.push({ label: 'Амулет №2', key: `use:${t.id}` });
    if (!noAmulets && i?.kind === 'amulet' && i.num === 3 && (f.foe.kind === 'враг' || f.foe.kind === 'нечисть')) out.push({ label: 'Амулет №3', key: `use:${t.id}` });
  }
  h.friends.forEach((fr, k) => {
    if (fr.with === 'вместо' || fr.charm) out.push({ label: `Пусть бьётся ${thingName(fr)}`, key: `champ:${k}` });
  });
  for (const extra of SPECIAL_PRE(s, f)) out.push(extra);
  return out;
}
/** Средства до боя у карт-предметов и особенностей путников — в special.ts. */
let SPECIAL_PRE: (s: CState, f: Fight) => { label: string; key: string }[] = () => [];
export const setSpecialPre = (fn: typeof SPECIAL_PRE) => (SPECIAL_PRE = fn);
let SPECIAL_POST: (s: CState, f: Fight) => { label: string; key: string }[] = () => [];
export const setSpecialPost = (fn: typeof SPECIAL_POST) => (SPECIAL_POST = fn);

/** Защита после поражения. */
function postLossOptions(s: CState, f: Fight): { label: string; key: string }[] {
  const h = H(s, f.seat);
  if (f.champion.kind !== 'self') return [];
  const out: { label: string; key: string }[] = [];
  const w = worldOf(h.cell);
  const noArmor = f.without.includes('armor') || f.without.includes('items') || h.sector != null || norm(cellName(h.cell)) === 'ПОЛЫЕ ХОЛМЫ';
  for (const t of h.things) {
    if (!usable(h, t) || f.used.includes(t.id)) continue;
    const i = itemOf(t);
    if (!noArmor && i?.name === 'бронежилет' && (w === 'Сила' || w === 'Ум')) out.push({ label: 'Бронежилет', key: `armor:${t.id}` });
    if (!noArmor && i?.name === 'кольчуга' && w === 'Магия') out.push({ label: 'Кольчуга', key: `armor:${t.id}` });
    if (!noArmor && i?.name === 'мифриловая кольчуга' && w && w !== 'Золото') out.push({ label: 'Мифриловая кольчуга', key: `armor:${t.id}` });
  }
  for (const extra of SPECIAL_POST(s, f)) if (!f.used.includes(extra.key)) out.push(extra);
  return out;
}

/** Итог боя: сценарий победы / поражения / ничьей. */
export function endFight(s: CState, x: X, res: 'win' | 'lose' | 'draw') {
  const f = s.fight!;
  s.fight = null;
  const h = H(s, f.seat);
  const top = s.run[s.run.length - 1];
  const parent = top ?? { seat: f.seat, ops: [], i: 0 };
  if (res === 'win') {
    // друг, бившийся вместо, отдаёт трофеи; заговорённый — тратит заговор
    frameOf(s, parent, f.win);
  } else if (res === 'lose') {
    if (f.champion.kind === 'friend') {
      // друг погиб: его карта в отбой, противник остаётся на поле, сам ничего не выполняешь
      const fr = h.friends[f.champion.i];
      if (fr) {
        dropThing(s, x, f.seat, fr, 'discard');
        say(s, x, f.seat, `${thingName(fr)} погиб в битве.`);
      }
      leaveFoe(s, f);
      return;
    }
    if (f.champion.kind === 'ghost') {
      leaveFoe(s, f);
      return;
    }
    frameOf(s, parent, f.lose);
  } else {
    if (f.draw) frameOf(s, parent, f.draw);
    else leaveFoe(s, f);
  }
}
/** Противник остаётся на поле битвы, карта дальше не выполняется. */
export function leaveFoe(s: CState, f: Fight) {
  const h = H(s, f.seat);
  const of = outerFrame(s);
  if (f.card && of && !of.fated) {
    of.fated = true;
    putCard(s, h.cell, { n: f.card });
  }
  stopCard(s);
}

// ---------- смерть ----------

/** ПЖ = 0 — путник умирает: игрок берёт новую карту путника и начинает сначала (или выходит). */
function deathCheck(s: CState, x: X, seat: number) {
  const h = H(s, seat);
  if (h.life > 0 || h.zone === 'dead' || h.zone === 'out') return;
  if (h.zone !== 'world' && h.zone !== 'road') {
    if (h.prince != null && h.zone !== 'arena') return;
  }
  say(s, x, seat, `${who(s, seat)}: ${TRAVELLERS[h.tr].name} погибает.`);
  // всё имущество — на поле предметов, друзья — в отбой
  for (const t of [...h.things]) dropThing(s, x, seat, t, itemOf(t) ? 'shelf' : 'discard');
  for (const t of [...h.friends]) dropThing(s, x, seat, t, 'discard');
  // снять все сценарии этого игрока
  s.run = s.run.filter((fr) => fr.seat !== seat);
  if (s.fight?.seat === seat) s.fight = null;
  if (s.prompt?.seat === seat) s.prompt = null;
  if (s.king != null) {
    h.zone = 'out';
    return;
  }
  const used = new Set(s.seats.map((o) => H(s, o).tr));
  const free = TRAVELLERS.map((t) => t.id).filter((id) => !used.has(id));
  const next = free.length ? free[x.rng.int(free.length)] : h.tr;
  s.heroes[seat] = newHero(seat, next, s.shelf);
  say(s, x, seat, `${who(s, seat)} начинает сначала: ${TRAVELLERS[next].name}.`);
}

// ---------- обменный пункт, лавки (обработчики в special) ----------

function shop(s: CState, x: X, seat: number) {
  SPECIAL.shop?.(s, x, seat, { t: 'special', id: 'shop' }, s.run[s.run.length - 1]);
}

// ---------- передача хода ----------

export function pass(s: CState, x: X) {
  s.phase = 'roll';
  s.die = 0;
  let i = s.seats.indexOf(s.turn);
  for (let k = 0; k < s.seats.length * 4; k++) {
    i = (i + 1) % s.seats.length;
    if (i === 0) {
      s.round++;
      if (s.comet > 0) s.comet--;
      if (s.storm && --s.storm.turns <= 0) s.storm = null;
    }
    const seat = s.seats[i];
    const h = H(s, seat);
    if (h.zone === 'out' || h.zone === 'dead') continue;
    if (h.skip > 0) {
      h.skip--;
      say(s, x, seat, `${who(s, seat)} пропускает ход.`);
      continue;
    }
    s.turn = seat;
    h.fallUsed = false;
    x.ev.push({ type: 'turn', seat });
    beforeTurn(s, x, seat);
    return;
  }
}

/** Перед ходом: потери «перед каждым ходом», преследователи, паралич (обработчики статусов — special). */
function beforeTurn(s: CState, x: X, seat: number) {
  SPECIAL.beforeTurn?.(s, x, seat, { t: 'special', id: 'beforeTurn' }, { seat, ops: [], i: 0 });
  // ходы статусов
  const h = H(s, seat);
  h.status = h.status.filter((st) => {
    if ('turns' in st && typeof st.turns === 'number') {
      st.turns--;
      return st.turns > 0;
    }
    return true;
  });
}

// ---------- действия ----------

export function apply(s0: CState, seat: number, a: Action, rng: Rng): { state: CState; events: Event[] } | null {
  if (s0.winner != null) return null;
  const s: CState = JSON.parse(JSON.stringify(s0));
  const x: X = { ev: [], rng };
  const done = () => {
    if (run(s, x) && !s.prompt && !s.fight && s.phase === 'run') endTurn(s, x);
    return { state: s, events: x.ev };
  };
  if (a.type === 'answer') {
    if (!s.prompt || s.prompt.seat !== seat) return null;
    if (!s.prompt.opts.some((o) => o.key === a.key)) return null;
    const p = s.prompt;
    s.prompt = null;
    answer(s, x, p, a.key);
    return done();
  }
  if (a.type === 'use') {
    const fn = SPECIAL.use;
    if (!fn) return null;
    fn(s, x, seat, { t: 'special', id: 'use' }, { seat, ops: [], i: 0, card: undefined, at: undefined, cell: Number(a.id.length) });
    return done();
  }
  if (seat !== s.turn || s.prompt || s.fight) return null;
  const h = H(s, seat);
  if (a.type === 'roll') {
    if (s.phase !== 'roll') return null;
    if (h.zone !== 'world') return SPECIAL.field2 ? (SPECIAL.field2(s, x, seat, { t: 'special', id: 'field2' }, { seat, ops: [], i: 0 }), done()) : null;
    if (h.sector != null) {
      s.phase = 'run';
      push(s, { seat, ops: [{ t: 'special', id: 'rosette' }] });
      return done();
    }
    const die = moveRoll(s, x, seat);
    if (die <= 0) {
      s.phase = 'run';
      return done();
    }
    s.die = die;
    s.phase = 'pick';
    return { state: s, events: x.ev };
  }
  if (a.type === 'go') {
    if (s.phase !== 'pick' || !Array.isArray(a.path) || !legalPath(s, seat, h.cell, s.die, a.path)) return null;
    for (const c of a.path) x.ev.push({ type: 'step', seat, cell: c });
    h.lastPath = [h.cell, ...a.path];
    s.phase = 'run';
    const end = a.path[a.path.length - 1];
    placeAt(s, x, seat, end, true);
    return done();
  }
  return null;
}

/** Бросок на ход с поправками (скалы, речка — −1 при уходе; лошадь +1; особенности; статусы — special). */
function moveRoll(s: CState, x: X, seat: number): number {
  const fn = SPECIAL.moveRoll;
  if (fn) {
    const box = { seat, ops: [] as Op[], i: 0, die: 0 } as Frame & { die: number };
    fn(s, x, seat, { t: 'special', id: 'moveRoll' }, box);
    return box.die;
  }
  const d = 1 + x.rng.int(6);
  x.ev.push({ type: 'roll', seat, die: d });
  return d;
}

/** Ход кончен: все сценарии исполнены. */
function endTurn(s: CState, x: X) {
  pass(s, x);
}

/** Ответ на вопрос. */
function answer(s: CState, x: X, p: Prompt, key: string) {
  const seat = p.seat;
  const f = s.run[s.run.length - 1];
  switch (p.kind) {
    case 'choice': {
      const op = p.data!.op as Extract<Op, { t: 'choice' }>;
      frameOf(s, f ?? { seat, ops: [], i: 0 }, op.opts[Number(key)].ops);
      return;
    }
    case 'roll': {
      const op = p.data!.op as Extract<Op, { t: 'roll' }>;
      const times = (p.data!.times as number) ?? 1;
      const dice = rollDice(x, op.dice ?? 1);
      const v = dice.reduce((a2, b) => a2 + b, 0);
      x.ev.push({ type: 'roll', seat, die: v, dice });
      const br = pick(op.br, v);
      // повтор броска (учитель боевых искусств — трижды): следующий бросок ставим под ветвью
      if (times > 1) push(s, { seat, ops: [{ ...op, times: times - 1 }] });
      if (br) frameOf(s, f ?? { seat, ops: [], i: 0 }, br.ops);
      return;
    }
    case 'gainPick':
      takeItem(s, x, seat, key);
      return;
    case 'losePick': {
      const h = H(s, seat);
      const t = h.things.find((t2) => t2.id === key) ?? h.friends.find((t2) => t2.id === key);
      if (t) dropThing(s, x, seat, t, 'shelf');
      return;
    }
    case 'moveTo':
      placeAt(s, x, seat, Number(key), !!p.data?.cond);
      return;
    case 'goldCell':
      if (key === 'yes') push(s, { seat, ops: CELL_OPS[H(s, seat).cell], cell: H(s, seat).cell });
      return;
    case 'pre':
      return preAnswer(s, x, key);
    case 'fightRoll':
      return fightRoll(s, x);
    case 'post':
      return postAnswer(s, x, key);
    default: {
      const fn = SPECIAL[`answer:${p.kind}`];
      if (fn) fn(s, x, seat, { t: 'special', id: p.kind }, f ?? { seat, ops: [], i: 0 }, p, key);
    }
  }
}

function preAnswer(s: CState, x: X, key: string) {
  const f = s.fight!;
  const h = H(s, f.seat);
  if (key === 'fight') {
    f.stage = 'roll';
    return;
  }
  if (key === 'pass') {
    s.fight = null;
    leaveFoe(s, f);
    return;
  }
  if (key.startsWith('champ:')) {
    f.champion = { kind: 'friend', i: Number(key.slice(6)) };
    f.used.push(key);
    f.stage = 'roll';
    return;
  }
  if (key.startsWith('use:')) {
    const t = h.things.find((t2) => t2.id === key.slice(4));
    const i = t && itemOf(t);
    f.used.push(key);
    if (!t || !i) return;
    if (i.name === 'граната') {
      dropThing(s, x, f.seat, t, 'shelf');
      say(s, x, f.seat, `${who(s, f.seat)} бросает гранату — ${f.foe.name} уничтожен.`);
      s.fight = null;
      const of = outerFrame(s);
      if (f.card && of && !of.fated) {
        of.fated = true;
        s.discard.push(f.card);
      }
      stopCard(s);
      return;
    }
    if (i.kind === 'amulet') {
      // №1: 1–3 отбрасывает на 4 поля, 4–6 побеждает (взять шкуру); №2/№3: 1–5 отбрасывает на 3/2 поля, 6 — побеждает
      const d = 1 + x.rng.int(6);
      x.ev.push({ type: 'roll', seat: f.seat, die: d, why: i.name });
      t.uses = (t.uses ?? i.uses ?? 1) - 1;
      if (t.uses <= 0) dropThing(s, x, f.seat, t, 'shelf');
      const wins = i.num === 1 ? d >= 4 : d === 6;
      if (wins) {
        say(s, x, f.seat, `${i.name} побеждает: ${f.foe.name}.`);
        f.stage = 'pre';
        endFight(s, x, 'win');
        return;
      }
      const far = i.num === 1 ? 4 : i.num === 2 ? 3 : 2;
      s.fight = null;
      const of = outerFrame(s);
      if (f.card && of && !of.fated) {
        of.fated = true;
        const opts = [...routes(s, f.seat, h.cell, far).keys()];
        putCard(s, opts.length ? opts[x.rng.int(opts.length)] : h.cell, { n: f.card });
      }
      say(s, x, f.seat, `${i.name} отбрасывает противника на ${far} поля.`);
      stopCard(s);
      return;
    }
  }
  const fn = SPECIAL['pre:' + key.split(':')[0]];
  if (fn) fn(s, x, f.seat, { t: 'special', id: key }, s.run[s.run.length - 1] ?? { seat: f.seat, ops: [], i: 0 });
}

function fightRoll(s: CState, x: X) {
  const f = s.fight!;
  const foeRoll = 1 + x.rng.int(6);
  const myRoll = rollWith(s, x, f);
  const foe = f.foe.v + foeRoll;
  const me = myPower(s, f.seat, f) + myRoll;
  const res = me > foe ? 'win' : me < foe ? 'lose' : 'draw';
  f.foeRoll = foeRoll;
  f.myRoll = myRoll;
  f.diff = me - foe;
  x.ev.push({ type: 'fight', seat: f.seat, foe: f.foe.name, foeV: f.foe.v, foeRoll, me: me - myRoll, myRoll, res });
  say(s, x, f.seat, `Бой с «${f.foe.name}»: ${foe} против ${me} — ${res === 'win' ? 'победа' : res === 'lose' ? 'поражение' : 'ничья'}.`);
  if (res === 'win') {
    if (--f.left > 0) {
      f.stage = 'roll';
      return;
    }
    return endFight(s, x, 'win');
  }
  if (res === 'draw') return endFight(s, x, 'draw');
  f.stage = 'post';
}
/** Свой бросок в бою (Амазонка магией — два броска, лучший; особенности — special). */
function rollWith(s: CState, x: X, f: Fight): number {
  const h = H(s, f.seat);
  const d = 1 + x.rng.int(6);
  if (/АМАЗОНКА/.test(tr(h).name) && f.foe.stat === 'ПМ' && f.champion.kind === 'self') return Math.max(d, 1 + x.rng.int(6));
  return d;
}

function postAnswer(s: CState, x: X, key: string) {
  const f = s.fight!;
  const h = H(s, f.seat);
  if (key === 'accept') return endFight(s, x, 'lose');
  if (key.startsWith('armor:')) {
    const t = h.things.find((t2) => t2.id === key.slice(6));
    f.used.push(key.slice(6));
    const i = t && itemOf(t);
    const d = 1 + x.rng.int(6);
    x.ev.push({ type: 'roll', seat: f.seat, die: d, why: i?.name });
    if (d <= 4) {
      say(s, x, f.seat, `${i?.name} защитила — последствия поражения не выполняешь.`);
      s.fight = null;
      leaveFoe(s, f);
    }
    return;
  }
  f.used.push(key);
  const fn = SPECIAL['post:' + key.split(':')[0]];
  if (fn) fn(s, x, f.seat, { t: 'special', id: key }, s.run[s.run.length - 1] ?? { seat: f.seat, ops: [], i: 0 });
}

// ---------- для вида и ботов ----------

export function result(s: CState): { winner: number; text: string; scores: number[] } | null {
  if (s.winner == null) return null;
  return { winner: s.winner, text: `${who(s, s.winner)} коронован — Владыка Королевства Эмбер.`, scores: s.seats.map((o) => progress(s, o)) };
}

/** Продвижение к короне (очки и боты). */
export function progress(s: CState, seat: number): number {
  const h = H(s, seat);
  const order: Record<string, number> = { world: 0, road: 1000, capital: 2000, labyrinth: 3000, palace: 4000, arena: 4500, chambers: 5000, dead: -1, out: -1 };
  if (h.zone === 'world') return STATS.reduce((sum, k) => sum + Math.min(FALL_NEED.min, h.st[k]), 0) * 10 + Math.min(FALL_NEED.min, h.po) * 10 + h.life;
  return order[h.zone] + h.ring * 100 + h.room * 100 + h.life;
}

export { ROAD_BY_ID, RINGS_PJ, ROOM_PJ, PRINCES };
