/* Карта приключений: чистая детерминированная логика (DESIGN.md §3, §10). Состояние — обычный JSON: сохранение, сеть и запись партии — одна и та же вещь.
 * act() проверяет действие, меняет мир и возвращает события; показ их играет. Бой — отдельное состояние: мир ставит pending, клиент играет бой, applyBattle() забирает итог. */
import { Rng } from '../../../gops/sim/rng';
import type { BattleSetup, BattleState, HeroStats } from '../battle';
import { CREATURES, factionCreatures } from '../creatures';
import { type HeroPick, CLASSES, classOf, factionClasses } from '../heroes';
import { type School, SPELLS, SPELL_LEVEL } from '../spells';
import { FACTION_RES, MINE_INCOME, NATIVE, OBJECTS, type ObjDef, type Purse, RES, ROAD_COST, type ResId, TERRAINS, TERRAIN_INDEX, WATER } from './data';
import {
  type AdvHero, ARMY_SLOTS, ART_SLOTS, ARTIFACTS, type Army, MAX_SKILLS, SHARD, SKILLS, addToArmy, armyEmpty, armySize, heroAtk, heroDef, heroKnow, heroLuck, heroMaxMana, heroMaxMp, heroMorale, heroPower, heroSemki, heroVision, isMight, skillLevel, skillValue, xpForLevel,
} from './hero';
import {
  BRANCHES, BUILDINGS, DECREES, RESEARCH_AMBER, RESEARCH_DAYS, type Town, type TownFaction, buildCost, buildError, buildingDef, canUpgrade, creaturePrice, forgeCap, forgePerDay, fortLevel, guildLevel, hallIncome, has, isCast, marketRate, townCreature, weeklyGrowth,
} from './town';

export const HERO_COST = 2500;
export const MAX_HEROES = 8;
/** Сколько дней живёт игрок без города. */
const TOWNLESS_DAYS = 7;
const TOWN_VISION = 8;
const FOG_RADIUS = 8;

export interface MapObject {
  id: number;
  kind: string;
  /** Вход. */
  cell: number;
  owner: number;
  /** Отряд: нейтралы, охрана сокровищницы, гарнизон. */
  army?: Army;
  /** Сколько: ресурс кучи, найм в жилище. */
  n?: number;
  art?: string;
  spell?: string;
  /** Портал: номер пары. */
  pair?: number;
  key?: string;
  text?: string;
  quest?: Quest;
  /** Узник в клетке. */
  captive?: HeroPick;
  /** Неделя, когда брали в последний раз. */
  week?: number;
  /** Занятые клетки объекта: чтобы снять их при удалении. */
  cells?: number[];
  /** Номер картинки декора. */
  reward?: Purse;
}

export interface Quest {
  /** Что принести. */
  cre?: string;
  count?: number;
  art?: string;
  reward: Purse;
  xp: number;
  done?: boolean;
}

export interface Player {
  id: number;
  name: string;
  faction: TownFaction;
  res: Record<ResId, number>;
  /** Открытые клетки: 0 и 1. */
  explored: number[];
  alive: boolean;
  /** Дней без города. */
  townless: number;
  keys: string[];
  /** Сколько обелисков посещено (номера объектов). */
  obelisks: number[];
  /** Лом Кузни: разбитые механизмы, вид → число. */
  scrap: Record<string, number>;
}

export type BattleSide = { k: 'hero'; id: number } | { k: 'obj'; id: number } | { k: 'town'; id: number };
export interface PendingBattle {
  t: 'battle';
  hero: number;
  def: BattleSide;
  seed: number;
}
export interface PendingChoice {
  t: 'choice';
  hero: number;
  obj: number;
  title: string;
  options: { id: string; text: string }[];
}

export interface Decor {
  cell: number;
  art: string;
  /** Ширина спрайта в клетках. */
  size: number;
}

export interface World {
  seed: number;
  rng: number;
  w: number;
  h: number;
  /** Уровней: 1 или 2. Номер клетки = x + y·w + z·w·h. */
  levels: number;
  terrain: number[];
  road: number[];
  /** 1 — клетка закрыта (горы, деревья, тело объекта). */
  block: number[];
  decor: Decor[];
  objects: MapObject[];
  /** Вход → объект. */
  entries: Record<number, number>;
  towns: Town[];
  heroes: AdvHero[];
  players: Player[];
  /** Какой день: 0 — первый. */
  day: number;
  current: number;
  pending: PendingBattle | PendingChoice | null;
  nextObj: number;
  nextHero: number;
  shard: number;
  /** Куда указывает обелиск: сдвиг от осколка. */
  shardHint: number[];
  winner: number;
  over: boolean;
  /** Событие недели: текст показан в начале. */
  weekNote: string;
}

export type AdvEvent =
  | { e: 'step'; hero: number; from: number; to: number }
  | { e: 'msg'; title?: string; text: string; icon?: string }
  | { e: 'gain'; player: number; res: Purse }
  | { e: 'flag'; obj: number; owner: number }
  | { e: 'remove'; obj: number }
  | { e: 'add'; obj: number }
  | { e: 'open'; what: 'town'; town: number; hero: number }
  | { e: 'open'; what: 'dwelling' | 'tradepost' | 'tavern' | 'shipyard' | 'garrison'; obj: number; hero: number }
  | { e: 'meet'; a: number; b: number }
  | { e: 'battle' }
  | { e: 'choice' }
  | { e: 'level'; hero: number; level: number }
  | { e: 'teleport'; hero: number; to: number }
  | { e: 'boat'; hero: number; on: boolean }
  | { e: 'heroDead'; hero: number; owner: number }
  | { e: 'heroNew'; hero: number }
  | { e: 'capture'; town: number; owner: number }
  | { e: 'built'; town: number; b: string }
  | { e: 'recruit'; town: number; cre: string; count: number }
  | { e: 'day'; day: number; week: boolean; note?: string }
  | { e: 'turn'; player: number }
  | { e: 'sfx'; name: string }
  | { e: 'dig'; found: boolean }
  | { e: 'lost'; player: number }
  | { e: 'over'; winner: number };

export type AdvAction =
  | { t: 'move'; hero: number; to: number }
  | { t: 'end' }
  | { t: 'choose'; id: string }
  | { t: 'skill'; hero: number; skill: string | null }
  | { t: 'build'; town: number; b: string }
  | { t: 'recruit'; town: number; cre: string; count: number }
  | { t: 'upgrade'; town: number; ref: ArmyRef; slot: number }
  | { t: 'hire'; hero: number; obj: number; count: number }
  | { t: 'tavern'; town: number | null; hero: number | null; pick: HeroPick }
  | { t: 'market'; give: ResId; get: ResId; amount: number; hero?: number }
  | { t: 'transfer'; from: ArmyRef; fromSlot: number; to: ArmyRef; toSlot: number; count?: number }
  | { t: 'equip'; hero: number; art: string; slot: string }
  | { t: 'unequip'; hero: number; slot: string }
  | { t: 'giveArt'; from: number; to: number; art: string }
  | { t: 'cast'; hero: number; spell: string }
  | { t: 'boat'; hero: number; obj: number }
  | { t: 'townBoat'; town: number }
  | { t: 'dig'; hero: number }
  | { t: 'decree'; town: number; id: string }
  | { t: 'research'; town: number; school: string }
  | { t: 'repair'; town: number; cre: string; count: number }
  | { t: 'dismiss'; hero: number };

export type ArmyRef = { h: number } | { t: number } | { o: number };

// ------------------------------------------------------------------ клетки

export const cellOf = (w: World, x: number, y: number, z = 0): number => x + y * w.w + z * w.w * w.h;
export const levelOf = (w: World, c: number): number => Math.trunc(c / (w.w * w.h));
export const xOf = (w: World, c: number): number => c % w.w;
export const yOf = (w: World, c: number): number => Math.trunc(c / w.w) % w.h;
const DIRS: [number, number][] = [[1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1], [1, 1]];
export const heroById = (w: World, id: number): AdvHero | undefined => w.heroes.find((h) => h.id === id);
export const townById = (w: World, id: number): Town | undefined => w.towns.find((t) => t.id === id);
export const objById = (w: World, id: number): MapObject | undefined => w.objects.find((o) => o.id === id);
export const heroAt = (w: World, c: number): AdvHero | undefined => w.heroes.find((h) => h.cell === c);
export const townAt = (w: World, c: number): Town | undefined => w.towns.find((t) => t.cell === c);
export const objAt = (w: World, c: number): MapObject | undefined => (w.entries[c] !== undefined ? objById(w, w.entries[c]) : undefined);
export const defOf = (o: MapObject): ObjDef => OBJECTS[o.kind];
export const isStack = (o: MapObject): boolean => o.kind === 'stack';

export function neighbors(w: World, c: number): number[] {
  const x = xOf(w, c);
  const y = yOf(w, c);
  const z = levelOf(w, c);
  const out: number[] = [];
  for (const [dx, dy] of DIRS) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx >= 0 && ny >= 0 && nx < w.w && ny < w.h) out.push(cellOf(w, nx, ny, z));
  }
  return out;
}

/** Отряд, стерегущий клетку: стоит на ней или рядом. */
export function guardOf(w: World, c: number): MapObject | undefined {
  const own = objAt(w, c);
  if (own && isStack(own)) return own;
  let best: MapObject | undefined;
  for (const n of neighbors(w, c)) {
    const o = objAt(w, n);
    if (o && isStack(o) && (!best || o.id < best.id)) best = o;
  }
  return best;
}

const owned = (w: World, p: number): MapObject[] => w.objects.filter((o) => o.owner === p);
export const playerTowns = (w: World, p: number): Town[] => w.towns.filter((t) => t.owner === p);
export const playerHeroes = (w: World, p: number): AdvHero[] => w.heroes.filter((h) => h.owner === p);

const distSq = (w: World, a: number, b: number): number => {
  if (levelOf(w, a) !== levelOf(w, b)) return 1 << 28;
  const dx = xOf(w, a) - xOf(w, b);
  const dy = yOf(w, a) - yOf(w, b);
  return dx * dx + dy * dy;
};

/** Туман Затонья: чужой герой рядом с городом с колодцем видит хуже (DESIGN.md §5.2). */
function inForeignFog(w: World, h: AdvHero): boolean {
  return w.towns.some((t) => t.faction === 'zatonye' && t.owner !== h.owner && t.owner >= 0 && has(t, 'fogwell') && distSq(w, t.cell, h.cell) <= FOG_RADIUS * FOG_RADIUS);
}
/** Свой герой в тумане не виден чужому. */
export function heroHiddenFrom(w: World, h: AdvHero, player: number): boolean {
  if (h.owner === player) return false;
  return w.towns.some((t) => t.faction === 'zatonye' && t.owner === h.owner && has(t, 'fogwell') && distSq(w, t.cell, h.cell) <= FOG_RADIUS * FOG_RADIUS);
}

export function reveal(w: World, player: number, c: number, r: number): void {
  const p = w.players[player];
  if (!p) return;
  const cx = xOf(w, c);
  const cy = yOf(w, c);
  const z = levelOf(w, c);
  const lim = r * r + r;
  for (let y = Math.max(0, cy - r); y <= Math.min(w.h - 1, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x <= Math.min(w.w - 1, cx + r); x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= lim) p.explored[cellOf(w, x, y, z)] = 1;
    }
  }
}

export const visionOf = (w: World, h: AdvHero): number => Math.max(1, heroVision(h) - (inForeignFog(w, h) ? 2 : 0));
function revealHero(w: World, h: AdvHero): void {
  reveal(w, h.owner, h.cell, visionOf(w, h));
}

function rngOf(w: World): Rng {
  return new Rng(w.rng);
}
function rollInt(w: World, a: number, b: number): number {
  const r = rngOf(w);
  const v = r.int(a, b);
  w.rng = r.s;
  return v;
}

function pay(p: Player, cost: Purse): void {
  for (const [k, v] of Object.entries(cost) as [ResId, number][]) p.res[k] -= v;
}
function give(p: Player, res: Purse): void {
  for (const [k, v] of Object.entries(res) as [ResId, number][]) p.res[k] += v;
}
export function canPay(p: Player, cost: Purse): boolean {
  return (Object.entries(cost) as [ResId, number][]).every(([k, v]) => p.res[k] >= v);
}

// ------------------------------------------------------------------ путь

/** Цена шага в клетку to. */
export function stepCost(w: World, h: AdvHero, from: number, to: number): number {
  const diag = xOf(w, from) !== xOf(w, to) && yOf(w, from) !== yOf(w, to);
  let cost: number;
  if (h.boat) cost = 100;
  else {
    const t = TERRAINS[w.terrain[to]];
    const faction = classOf(h.pick.cls).faction as TownFaction;
    const road = w.road[to];
    const native = NATIVE[faction] === t.id;
    const base = native ? 100 : 100 + Math.trunc(((t.cost - 100) * (100 - skillValue(h, 'pathfinding'))) / 100);
    // Гать Затонья: своё болото — как дорога
    const gat = t.id === 'swamp' && w.towns.some((x) => x.owner === h.owner && has(x, 'gat'));
    cost = road ? Math.min(base, ROAD_COST[road]) : gat ? 50 : base;
  }
  return diag ? Math.trunc((cost * 141) / 100) : cost;
}

/** Куда можно шагнуть и нельзя ли идти дальше: 0 — нельзя, 1 — проход, 2 — конец пути (вход, охрана, герой). */
function stepKind(w: World, h: AdvHero, c: number, see: number): 0 | 1 | 2 {
  const other = heroAt(w, c);
  if (other && other !== h) return heroHiddenFrom(w, other, see) ? 1 : 2;
  const obj = objAt(w, c);
  const town = townAt(w, c);
  const water = w.terrain[c] === WATER;
  if (h.boat) {
    if (obj || town) return 2;
    if (!water) return w.block[c] ? 0 : 2;
    return w.block[c] ? 0 : guardOf(w, c) ? 2 : 1;
  }
  if (obj || town) return 2;
  if (water || w.block[c]) return 0;
  return guardOf(w, c) ? 2 : 1;
}

export interface Reach {
  /** Сколько очков хода до клетки; −1 — не дойти. */
  dist: Int32Array;
  prev: Int32Array;
}

/** Дейкстра от героя: кратчайшие пути по цене хода. */
export function reachOf(w: World, h: AdvHero, see = h.owner): Reach {
  const n = w.w * w.h * w.levels;
  const dist = new Int32Array(n).fill(-1);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const heap: [number, number][] = [[0, h.cell]];
  dist[h.cell] = 0;
  const push = (d: number, c: number): void => {
    heap.push([d, c]);
    let i = heap.length - 1;
    while (i > 0) {
      const up = (i - 1) >> 1;
      if (heap[up][0] <= heap[i][0]) break;
      [heap[up], heap[i]] = [heap[i], heap[up]];
      i = up;
    }
  };
  const pop = (): [number, number] => {
    const top = heap[0];
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const a = i * 2 + 1;
        const b = a + 1;
        let m = i;
        if (a < heap.length && heap[a][0] < heap[m][0]) m = a;
        if (b < heap.length && heap[b][0] < heap[m][0]) m = b;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [d, c] = pop();
    if (done[c]) continue;
    done[c] = 1;
    const stop = c !== h.cell && stepKind(w, h, c, see) === 2;
    // дальше конца пути нельзя; только сам отряд: щелчок по нему ведёт к клетке рядом
    if (stop && (objAt(w, c) || townAt(w, c) || heroAt(w, c))) continue;
    for (const nb of neighbors(w, c)) {
      if (done[nb] || stepKind(w, h, nb, see) === 0) continue;
      if (stop && !objAt(w, nb)?.kind.startsWith('stack')) continue;
      const nd = d + stepCost(w, h, c, nb);
      if (dist[nb] < 0 || nd < dist[nb]) {
        dist[nb] = nd;
        prev[nb] = c;
        push(nd, nb);
      }
    }
  }
  return { dist, prev };
}

/** Клетки пути, без начальной. Пусто — не дойти. */
export function pathOf(r: Reach, to: number): number[] {
  if (r.dist[to] < 0) return [];
  const out: number[] = [];
  for (let c = to; r.prev[c] >= 0; c = r.prev[c]) out.push(c);
  return out.reverse();
}

/** На какой день дойдёт каждый шаг: 0 — сегодня. Показ пути: зелёный и жёлтый. */
export function pathDays(w: World, h: AdvHero, path: number[]): number[] {
  let mp = h.mp;
  let day = 0;
  let from = h.cell;
  const max = heroMaxMp(h);
  return path.map((c) => {
    const cost = stepCost(w, h, from, c);
    if (cost > mp) {
      day++;
      mp = max;
    }
    mp -= cost;
    from = c;
    return day;
  });
}

// ------------------------------------------------------------------ опыт

/** Два варианта навыка: что есть — поднять, остальное — новое (DESIGN.md §5.9). */
function skillOptions(w: World, h: AdvHero): string[] {
  const might = isMight(h) ? 0 : 1;
  const r = rngOf(w);
  const up = h.skills.filter((s) => s.lv < 3).map((s) => s.id);
  const fresh = h.skills.length < MAX_SKILLS ? SKILLS.filter((s) => skillLevel(h, s.id) === 0) : [];
  const out: string[] = [];
  const pickUp = (): void => {
    const left = up.filter((x) => !out.includes(x));
    if (left.length) out.push(left[r.below(left.length)]);
  };
  const pickNew = (): void => {
    const left = fresh.filter((x) => !out.includes(x.id));
    let sum = 0;
    for (const s of left) sum += s.weight[might];
    if (!sum) return;
    let roll = r.below(sum);
    for (const s of left) {
      roll -= s.weight[might];
      if (roll < 0) {
        out.push(s.id);
        return;
      }
    }
  };
  pickUp();
  pickNew();
  if (out.length < 2) pickNew();
  if (out.length < 2) pickUp();
  w.rng = r.s;
  return out;
}

const STATS = ['atk', 'def', 'power', 'know'] as const;
function levelUp(w: World, h: AdvHero, ev: AdvEvent[]): void {
  h.level++;
  const weights = isMight(h) ? [40, 35, 15, 10] : [10, 15, 40, 35];
  let roll = rollInt(w, 0, 99);
  let stat: (typeof STATS)[number] = 'atk';
  for (let i = 0; i < 4; i++) {
    roll -= weights[i];
    if (roll < 0) {
      stat = STATS[i];
      break;
    }
  }
  h[stat]++;
  h.ups.push({ stat, options: skillOptions(w, h) });
  ev.push({ e: 'level', hero: h.id, level: h.level });
}

export function gainXp(w: World, h: AdvHero, n: number, ev: AdvEvent[]): void {
  h.xp += Math.trunc((n * (100 + skillValue(h, 'learning'))) / 100);
  while (h.xp >= xpForLevel(h.level + 1)) levelUp(w, h, ev);
}

/** Может ли герой выучить заклинание: 3-й круг — только с Мудростью. */
const canLearn = (h: AdvHero, spell: string): boolean => (SPELL_LEVEL[spell] ?? 1) < 3 || skillLevel(h, 'wisdom') > 0;

function learnFromTown(h: AdvHero, t: Town, ev: AdvEvent[]): void {
  const got: string[] = [];
  const lv = guildLevel(t);
  for (let i = 0; i < lv; i++) {
    for (const sp of t.guild[i]) {
      if (!h.spells.includes(sp) && canLearn(h, sp)) {
        h.spells.push(sp);
        got.push(SPELLS[sp].name);
      }
    }
  }
  if (got.length) ev.push({ e: 'msg', title: 'Гильдия магов', text: `Выучено: ${got.join(', ')}.` });
}

function refillInTown(h: AdvHero, t: Town): void {
  if (guildLevel(t) > 0) h.mana = Math.max(h.mana, heroMaxMana(h));
}

// ------------------------------------------------------------------ объекты

function removeObj(w: World, o: MapObject, ev: AdvEvent[]): void {
  w.objects.splice(w.objects.indexOf(o), 1);
  delete w.entries[o.cell];
  for (const c of o.cells ?? []) w.block[c] = 0;
  ev.push({ e: 'remove', obj: o.id });
}

/** Новый объект в мир: отметить вход и занятые клетки. */
export function placeObject(w: World, o: Omit<MapObject, 'id'>): MapObject {
  const obj: MapObject = { ...o, id: w.nextObj++ };
  w.objects.push(obj);
  w.entries[obj.cell] = obj.id;
  for (const c of obj.cells ?? []) w.block[c] = 1;
  return obj;
}

function giveArtifact(h: AdvHero, art: string, ev: AdvEvent[]): void {
  const a = ARTIFACTS[art];
  const slot = ART_SLOTS.find((s) => s.slot === a.slot && !h.arts[s.id]);
  if (slot) h.arts[slot.id] = art;
  else h.bag.push(art);
  ev.push({ e: 'msg', title: 'Находка', text: a.name, icon: `icons/${art}` });
  ev.push({ e: 'sfx', name: 'artifact' });
}

function capture(w: World, o: MapObject, h: AdvHero, ev: AdvEvent[]): void {
  if (o.owner === h.owner) return;
  o.owner = h.owner;
  ev.push({ e: 'flag', obj: o.id, owner: h.owner });
  ev.push({ e: 'sfx', name: defOf(o).effect.t === 'mine' ? 'mine-capture' : 'flag' });
  reveal(w, h.owner, o.cell, 3);
}

/** Сокровищница: награда по силе охраны, артефакт ступенью выше у сильных. */
function treasuryReward(w: World, o: MapObject, h: AdvHero, ev: AdvEvent[]): void {
  const res = o.reward ?? { semki: 3000 };
  give(w.players[h.owner], res);
  ev.push({ e: 'gain', player: h.owner, res });
  if (o.art) giveArtifact(h, o.art, ev);
  ev.push({ e: 'sfx', name: 'chest-open' });
}

/** Победа над охраной: что отдаёт объект. */
function afterGuard(w: World, o: MapObject, h: AdvHero, ev: AdvEvent[]): void {
  const fx = defOf(o).effect;
  switch (fx.t) {
    case 'stack':
      removeObj(w, o, ev);
      break;
    case 'treasury':
      treasuryReward(w, o, h, ev);
      o.army = undefined;
      o.week = -2;
      break;
    case 'artifact':
      giveArtifact(h, o.art!, ev);
      removeObj(w, o, ev);
      break;
    case 'prison':
      freeCaptive(w, o, h, ev);
      break;
    case 'garrison':
    case 'mine':
    case 'dwelling':
      o.army = fx.t === 'garrison' ? emptyArmy() : undefined;
      capture(w, o, h, ev);
      if (fx.t === 'dwelling') ev.push({ e: 'open', what: 'dwelling', obj: o.id, hero: h.id });
      break;
    default:
      o.army = undefined;
  }
}

function freeCaptive(w: World, o: MapObject, h: AdvHero, ev: AdvEvent[]): void {
  if (playerHeroes(w, h.owner).length >= MAX_HEROES) {
    ev.push({ e: 'msg', title: 'Клетка', text: 'Героев и так восемь: узника некуда взять.' });
    return;
  }
  const free = neighbors(w, o.cell).find((c) => stepKind(w, h, c, h.owner) === 1);
  if (free === undefined) {
    ev.push({ e: 'msg', title: 'Клетка', text: 'Рядом нет места: отойди и зайди снова.' });
    return;
  }
  const hero = makeHero(w, o.captive!, h.owner, free);
  hero.army = emptyArmy();
  addToArmy(hero.army, factionCreatures(classOf(o.captive!.cls).faction).find((c) => c.tier === 1 && !c.up)!.id, 5);
  hero.mp = 0;
  w.heroes.push(hero);
  revealHero(w, hero);
  ev.push({ e: 'heroNew', hero: hero.id });
  ev.push({ e: 'msg', title: 'Клетка', text: 'Узник на свободе и присоединился к тебе.' });
  removeObj(w, o, ev);
}

function stackFight(w: World, h: AdvHero, o: MapObject, ev: AdvEvent[]): void {
  w.pending = { t: 'battle', hero: h.id, def: { k: 'obj', id: o.id }, seed: rollInt(w, 1, 2147483646) };
  ev.push({ e: 'battle' });
}

/** Герой вошёл на вход объекта: true — дальше идти нельзя. */
function visit(w: World, h: AdvHero, o: MapObject, ev: AdvEvent[]): void {
  const p = w.players[h.owner];
  const def = defOf(o);
  const fx = def.effect;
  if (o.army && !armyEmpty(o.army) && o.owner !== h.owner) {
    stackFight(w, h, o, ev);
    return;
  }
  const week = Math.trunc(w.day / 7);
  const once = (): boolean => {
    if (h.visited.includes(o.id)) {
      ev.push({ e: 'msg', title: def.name, text: 'Здесь этот герой уже был.' });
      return false;
    }
    h.visited.push(o.id);
    return true;
  };
  switch (fx.t) {
    case 'pile': {
      const res = { [fx.res]: o.n ?? fx.min } as Purse;
      give(p, res);
      ev.push({ e: 'gain', player: p.id, res }, { e: 'sfx', name: fx.res === 'semki' ? 'pickup-semki' : 'pickup-res' });
      removeObj(w, o, ev);
      break;
    }
    case 'chest':
      w.pending = { t: 'choice', hero: h.id, obj: o.id, title: 'Сундук', options: [{ id: 'semki', text: `${o.n ?? 1500} семок` }, { id: 'xp', text: `${(o.n ?? 1500) - 500} опыта` }] };
      ev.push({ e: 'choice' }, { e: 'sfx', name: 'chest-open' });
      break;
    case 'campfire': {
      const rare = RES[1 + rollInt(w, 0, RES.length - 2)];
      const res: Purse = { semki: o.n ?? 500, [rare]: rollInt(w, 2, 5) };
      give(p, res);
      ev.push({ e: 'gain', player: p.id, res }, { e: 'sfx', name: 'pickup-res' });
      removeObj(w, o, ev);
      break;
    }
    case 'artifact':
      giveArtifact(h, o.art!, ev);
      removeObj(w, o, ev);
      break;
    case 'mine':
      capture(w, o, h, ev);
      ev.push({ e: 'msg', title: def.name, text: `Теперь твоё: ${MINE_INCOME[fx.res]} в день.` });
      break;
    case 'mill': {
      if (o.week === week) {
        ev.push({ e: 'msg', title: def.name, text: 'На этой неделе уже брали.' });
        break;
      }
      o.week = week;
      const res = { [fx.res]: fx.n } as Purse;
      give(p, res);
      ev.push({ e: 'gain', player: p.id, res }, { e: 'sfx', name: 'pickup-res' });
      break;
    }
    case 'watchtower':
      reveal(w, p.id, o.cell, 20);
      ev.push({ e: 'msg', title: def.name, text: 'С вышки видно далеко.' }, { e: 'sfx', name: 'learn' });
      break;
    case 'shrine': {
      const sp = o.spell!;
      if (h.spells.includes(sp)) ev.push({ e: 'msg', title: def.name, text: `«${SPELLS[sp].name}» герой уже знает.` });
      else if (!canLearn(h, sp)) ev.push({ e: 'msg', title: def.name, text: `«${SPELLS[sp].name}» — 3-й круг: нужна Мудрость.` });
      else {
        h.spells.push(sp);
        ev.push({ e: 'msg', title: def.name, text: `Выучено: ${SPELLS[sp].name}.` }, { e: 'sfx', name: 'shrine' });
      }
      break;
    }
    case 'stat':
      if (once()) {
        h[fx.stat]++;
        ev.push({ e: 'msg', title: def.name, text: '+1 к атаке.' }, { e: 'sfx', name: 'levelup' });
      }
      break;
    case 'xp':
      if (once()) {
        gainXp(w, h, fx.n, ev);
        ev.push({ e: 'msg', title: def.name, text: `+${fx.n} опыта.` }, { e: 'sfx', name: 'learn' });
      }
      break;
    case 'well':
      if (h.wellDay === w.day) ev.push({ e: 'msg', title: def.name, text: 'Сегодня герой уже пил.' });
      else {
        h.wellDay = w.day;
        h.mana = Math.max(h.mana, heroMaxMana(h));
        ev.push({ e: 'msg', title: def.name, text: 'Мана полна.' }, { e: 'sfx', name: 'shrine' });
      }
      break;
    case 'fountain':
      h.luckNext = 1;
      ev.push({ e: 'msg', title: def.name, text: '+1 к удаче в следующем бою.' }, { e: 'sfx', name: 'luck' });
      break;
    case 'stables':
      if (!h.stabled) {
        h.stabled = true;
        h.mp += 400;
        ev.push({ e: 'msg', title: def.name, text: 'Свежие кони: +400 хода до конца недели.' }, { e: 'sfx', name: 'horse-snort' });
      } else ev.push({ e: 'msg', title: def.name, text: 'Кони уже свежие.' });
      break;
    case 'tavern':
      ev.push({ e: 'open', what: 'tavern', obj: o.id, hero: h.id });
      break;
    case 'tradepost':
      ev.push({ e: 'open', what: 'tradepost', obj: o.id, hero: h.id });
      break;
    case 'shipyard':
      ev.push({ e: 'open', what: 'shipyard', obj: o.id, hero: h.id });
      break;
    case 'prison':
      freeCaptive(w, o, h, ev);
      break;
    case 'obelisk': {
      if (!p.obelisks.includes(o.id)) p.obelisks.push(o.id);
      const total = w.objects.filter((x) => x.kind === 'obelisk').length + p.obelisks.filter((id) => !objById(w, id)).length;
      const left = Math.max(0, total - p.obelisks.length);
      const x = xOf(w, w.shard) + Math.trunc((w.shardHint[0] * left) / Math.max(1, total));
      const y = yOf(w, w.shard) + Math.trunc((w.shardHint[1] * left) / Math.max(1, total));
      reveal(w, p.id, cellOf(w, Math.max(0, Math.min(w.w - 1, x)), Math.max(0, Math.min(w.h - 1, y)), levelOf(w, w.shard)), 5);
      ev.push({ e: 'msg', title: def.name, text: left ? `Обелиск показал кусок карты. Осталось обелисков: ${left}.` : 'Все обелиски пройдены: место осколка отмечено. Копай там.' }, { e: 'sfx', name: 'shrine' });
      break;
    }
    case 'portal': {
      const other = w.objects.find((x) => x.pair === o.pair && x.id !== o.id);
      const free = other && [other.cell, ...neighbors(w, other.cell)].find((c) => !heroAt(w, c) && (c === other.cell || stepKind(w, h, c, h.owner) === 1));
      if (free === undefined) ev.push({ e: 'msg', title: def.name, text: 'Портал не работает: выход занят.' });
      else {
        h.cell = free;
        revealHero(w, h);
        ev.push({ e: 'teleport', hero: h.id, to: free }, { e: 'sfx', name: 'teleport' });
      }
      break;
    }
    case 'seer': {
      const q = o.quest;
      if (!q || q.done) {
        ev.push({ e: 'msg', title: def.name, text: 'Провидец молча кивает: просьба выполнена.' });
        break;
      }
      const need = q.cre ? `${q.count} × ${CREATURES[q.cre].name}` : ARTIFACTS[q.art!].name;
      const ok = q.cre ? h.army.reduce((n, s) => (s && s.cre === q.cre ? n + s.count : n), 0) >= (q.count ?? 1) && h.army.some((s) => s && s.cre !== q.cre) : Object.values(h.arts).includes(q.art!) || h.bag.includes(q.art!);
      if (!ok) {
        ev.push({ e: 'msg', title: def.name, text: `«Принеси мне: ${need}. Я не останусь в долгу».` });
        break;
      }
      w.pending = { t: 'choice', hero: h.id, obj: o.id, title: `Отдать провидцу: ${need}?`, options: [{ id: 'give', text: 'Отдать' }, { id: 'no', text: 'Не сейчас' }] };
      ev.push({ e: 'choice' });
      break;
    }
    case 'key':
      if (!p.keys.includes(o.key!)) p.keys.push(o.key!);
      ev.push({ e: 'msg', title: def.name, text: `Выдан ключ: ${o.key}.` }, { e: 'sfx', name: 'artifact' });
      break;
    case 'gate':
      if (p.keys.includes(o.key!)) {
        ev.push({ e: 'msg', title: def.name, text: 'Застава поднимает шлагбаум.' }, { e: 'sfx', name: 'gate' });
        removeObj(w, o, ev);
      } else ev.push({ e: 'msg', title: def.name, text: `Без ключа не пройти: ${o.key}.` });
      break;
    case 'sign':
      ev.push({ e: 'msg', title: def.name, text: o.text ?? 'Надпись стёрлась.' });
      break;
    case 'garrison':
      capture(w, o, h, ev);
      ev.push({ e: 'open', what: 'garrison', obj: o.id, hero: h.id });
      break;
    case 'treasury':
      if (o.week === -2) ev.push({ e: 'msg', title: def.name, text: 'Здесь уже пусто.' });
      else {
        treasuryReward(w, o, h, ev);
        o.week = -2;
      }
      break;
    case 'dwelling':
      capture(w, o, h, ev);
      ev.push({ e: 'open', what: 'dwelling', obj: o.id, hero: h.id });
      break;
    case 'boat':
      break;
    case 'stack':
      stackFight(w, h, o, ev);
      break;
  }
}

function enterTown(w: World, h: AdvHero, t: Town, ev: AdvEvent[]): void {
  if (t.owner === h.owner) {
    learnFromTown(h, t, ev);
    refillInTown(h, t);
    ev.push({ e: 'open', what: 'town', town: t.id, hero: h.id });
    return;
  }
  if (!armyEmpty(t.garrison)) {
    w.pending = { t: 'battle', hero: h.id, def: { k: 'town', id: t.id }, seed: rollInt(w, 1, 2147483646) };
    ev.push({ e: 'battle' });
    return;
  }
  takeTown(w, t, h, ev);
}

function takeTown(w: World, t: Town, h: AdvHero, ev: AdvEvent[]): void {
  t.owner = h.owner;
  reveal(w, h.owner, t.cell, TOWN_VISION);
  ev.push({ e: 'capture', town: t.id, owner: h.owner }, { e: 'sfx', name: 'flag' });
  checkPlayers(w, ev);
  if (!w.over) {
    learnFromTown(h, t, ev);
    ev.push({ e: 'open', what: 'town', town: t.id, hero: h.id });
  }
}

/** Идём по пути: остановка на первом событии или когда кончился ход. */
function walk(w: World, h: AdvHero, path: number[], ev: AdvEvent[]): void {
  for (const c of path) {
    const other = heroAt(w, c);
    if (other && other !== h) {
      if (other.owner === h.owner) {
        ev.push({ e: 'meet', a: h.id, b: other.id });
        meet(w, h, other, ev);
      } else {
        w.pending = { t: 'battle', hero: h.id, def: { k: 'hero', id: other.id }, seed: rollInt(w, 1, 2147483646) };
        ev.push({ e: 'battle' });
      }
      return;
    }
    // нейтральный отряд бьём с места, не заходя на него
    const stack = objAt(w, c);
    if (stack && isStack(stack)) {
      if (h.mp <= 0) return;
      stackFight(w, h, stack, ev);
      return;
    }
    const cost = stepCost(w, h, h.cell, c);
    const fresh = h.mp === heroMaxMp(h);
    if (cost > h.mp && !fresh) return;
    const from = h.cell;
    const obj = objAt(w, c);
    if (h.boat && w.terrain[c] !== WATER) {
      // сойти на берег: лодка остаётся у берега, ход кончился
      h.boat = false;
      placeObject(w, { kind: 'boat', cell: from, owner: -1 });
      ev.push({ e: 'add', obj: w.nextObj - 1 }, { e: 'boat', hero: h.id, on: false });
      h.mp = 0;
    } else if (obj?.kind === 'boat') {
      h.boat = true;
      ev.push({ e: 'boat', hero: h.id, on: true }, { e: 'sfx', name: 'water-splash' });
      removeObj(w, obj, ev);
      h.mp = Math.max(0, h.mp - cost);
    } else h.mp = Math.max(0, h.mp - cost);
    h.cell = c;
    h.dir = dirOf(w, from, c);
    revealHero(w, h);
    ev.push({ e: 'step', hero: h.id, from, to: c });
    const town = townAt(w, c);
    if (town) return enterTown(w, h, town, ev);
    const here = objAt(w, c);
    if (here) return visit(w, h, here, ev);
    const guard = guardOf(w, c);
    if (guard) return stackFight(w, h, guard, ev);
    if (h.mp <= 0) return;
  }
}

export function dirOf(w: World, from: number, to: number): number {
  const dx = Math.sign(xOf(w, to) - xOf(w, from));
  const dy = Math.sign(yOf(w, to) - yOf(w, from));
  const i = DIRS.findIndex(([a, b]) => a === dx && b === dy);
  return i < 0 ? 0 : i;
}

/** Встреча своих: грамотные делятся заклинаниями. */
function meet(w: World, a: AdvHero, b: AdvHero, ev: AdvEvent[]): void {
  const lv = Math.max(skillLevel(a, 'scholar'), skillLevel(b, 'scholar'));
  if (!lv) return;
  const swap = (x: AdvHero, y: AdvHero): void => {
    for (const sp of x.spells) if ((SPELL_LEVEL[sp] ?? 1) <= lv && !y.spells.includes(sp) && canLearn(y, sp)) y.spells.push(sp);
  };
  swap(a, b);
  swap(b, a);
  ev.push({ e: 'sfx', name: 'learn' });
  void w;
}

// ------------------------------------------------------------------ день и неделя

const WEEK_NOTES = ['Неделя ветра. Всё спокойно.', 'Неделя семечка: все при деле.', 'Неделя кваса. Отряды довольны.', 'Неделя дороги: купцы тянутся через край.', 'Неделя дождя. Брод поднялся и опал.', 'Неделя ужа. Опасности никакой.'];

function newWeek(w: World, ev: AdvEvent[]): string {
  const week = Math.trunc(w.day / 7);
  for (const t of w.towns) {
    for (let tier = 1; tier <= 7; tier++) {
      const dw = has(t, `dwell${tier}`);
      if (!dw) continue;
      const c = townCreature(t, tier, false);
      if (isCast(c)) continue;
      t.avail[tier - 1] += weeklyGrowth(t, tier);
    }
    t.bonus = [0, 0, 0, 0, 0, 0, 0];
    t.tavern = tavernOffer(w, t.faction);
    if (t.faction === 'zatulye' && has(t, 'skhod') && t.owner >= 0) t.decrees = rollDecrees(w);
  }
  for (const o of w.objects) {
    const fx = defOf(o).effect;
    if (fx.t === 'dwelling') o.n = (o.n ?? 0) + CREATURES[fx.cre].weekly;
    // нейтралы подрастают на восьмую часть в неделю
    if (fx.t === 'stack' && o.army?.[0]) o.army[0].count += Math.max(1, o.army[0].count >> 3);
  }
  for (const h of w.heroes) h.stabled = false;
  void ev;
  return WEEK_NOTES[(week + (w.seed % WEEK_NOTES.length)) % WEEK_NOTES.length];
}

function rollDecrees(w: World): string[] {
  const all = Object.keys(DECREES);
  const r = rngOf(w);
  for (let i = all.length - 1; i > 0; i--) {
    const j = r.below(i + 1);
    [all[i], all[j]] = [all[j], all[i]];
  }
  w.rng = r.s;
  return all.slice(0, 3);
}

export function tavernOffer(w: World, f: TownFaction): { cls: string; n: number }[] {
  const used = new Set(w.heroes.map((h) => `${h.pick.cls}-${h.pick.n}`));
  const r = rngOf(w);
  const own = factionClasses(f).flatMap((c) => [1, 2, 3, 4].map((n) => ({ cls: c.id, n }))).filter((p) => !used.has(`${p.cls}-${p.n}`));
  const any = CLASSES.flatMap((c) => [1, 2, 3, 4].map((n) => ({ cls: c.id, n }))).filter((p) => !used.has(`${p.cls}-${p.n}`));
  const out: { cls: string; n: number }[] = [];
  if (own.length) out.push(own[r.below(own.length)]);
  const rest = any.filter((p) => !out.includes(p));
  if (rest.length) out.push(rest[r.below(rest.length)]);
  w.rng = r.s;
  return out;
}

export function dailyIncome(w: World, p: number): Purse {
  const out: Purse = {};
  const add = (k: ResId, v: number): void => {
    out[k] = (out[k] ?? 0) + v;
  };
  for (const t of playerTowns(w, p)) {
    add('semki', hallIncome(t));
    if (has(t, 'storehouse')) add(FACTION_RES[t.faction][1], t.faction === 'kuznya' ? 1 : 1);
  }
  for (const o of owned(w, p)) {
    const fx = defOf(o).effect;
    if (fx.t === 'mine') add(fx.res, MINE_INCOME[fx.res]);
  }
  for (const h of playerHeroes(w, p)) {
    const s = heroSemki(h);
    if (s) add('semki', s);
  }
  return out;
}

function newDay(w: World, ev: AdvEvent[]): void {
  w.day++;
  const week = w.day % 7 === 0;
  let note: string | undefined;
  if (week) note = newWeek(w, ev);
  w.weekNote = note ?? w.weekNote;
  for (const p of w.players) if (p.alive) give(p, dailyIncome(w, p.id));
  for (const t of w.towns) {
    t.builtToday = false;
    if (t.faction === 'kuznya') t.forge = Math.min(forgeCap(t), t.forge + forgePerDay(t));
    if (t.research) {
      t.research.left--;
      if (t.research.left <= 0) {
        const { school } = t.research;
        const done = (t.studied[school] ?? 0) + 1;
        t.studied[school] = done;
        t.research = null;
        const sp = BRANCHES[school][done - 1];
        const lv = Math.max(0, (SPELL_LEVEL[sp] ?? 1) - 1);
        if (!t.guild[lv].includes(sp)) t.guild[lv].push(sp);
        if (t.owner >= 0) ev.push({ e: 'msg', title: t.name, text: `Опыт закончен: ${SPELLS[sp].name}.` });
      }
    }
  }
  for (const h of w.heroes) {
    h.mp = heroMaxMp(h);
    h.mana = Math.min(Math.max(h.mana, heroMaxMana(h)), h.mana + 1 + skillValue(h, 'mysticism'));
  }
  ev.push({ e: 'day', day: w.day, week, note });
  ev.push({ e: 'sfx', name: week ? 'newweek' : 'newday' });
}

function checkPlayers(w: World, ev: AdvEvent[]): void {
  for (const p of w.players) {
    if (!p.alive) continue;
    const towns = playerTowns(w, p.id).length;
    const heroes = playerHeroes(w, p.id).length;
    if (towns === 0 && (heroes === 0 || p.townless >= TOWNLESS_DAYS)) {
      p.alive = false;
      for (const h of playerHeroes(w, p.id)) ev.push({ e: 'heroDead', hero: h.id, owner: p.id });
      w.heroes = w.heroes.filter((h) => h.owner !== p.id);
      ev.push({ e: 'lost', player: p.id });
    }
  }
  const left = w.players.filter((p) => p.alive);
  if (left.length <= 1 && !w.over) {
    w.over = true;
    w.winner = left[0]?.id ?? -1;
    ev.push({ e: 'over', winner: w.winner });
  }
}

function endTurn(w: World, ev: AdvEvent[]): void {
  const n = w.players.length;
  let i = w.current;
  for (let tries = 0; tries < n; tries++) {
    i = (i + 1) % n;
    if (i === 0) {
      newDay(w, ev);
      for (const p of w.players) {
        if (!p.alive) continue;
        p.townless = playerTowns(w, p.id).length ? 0 : p.townless + 1;
      }
      checkPlayers(w, ev);
      if (w.over) return;
    }
    if (w.players[i].alive) break;
  }
  w.current = i;
  ev.push({ e: 'turn', player: i });
}

// ------------------------------------------------------------------ действия

function armyOf(w: World, r: ArmyRef): Army | null {
  if ('h' in r) return heroById(w, r.h)?.army ?? null;
  if ('t' in r) return townById(w, r.t)?.garrison ?? null;
  return objById(w, r.o)?.army ?? null;
}
const refCell = (w: World, r: ArmyRef): number => ('h' in r ? heroById(w, r.h)?.cell ?? -1 : 't' in r ? townById(w, r.t)?.cell ?? -1 : objById(w, r.o)?.cell ?? -1);
const refOwner = (w: World, r: ArmyRef): number => ('h' in r ? heroById(w, r.h)?.owner ?? -9 : 't' in r ? townById(w, r.t)?.owner ?? -9 : objById(w, r.o)?.owner ?? -9);

/** Рядом: на одной клетке (герой в воротах) или на соседней. */
function within(w: World, a: number, b: number): boolean {
  return a === b || neighbors(w, a).includes(b);
}

export function emptyArmy(): Army {
  return Array<null>(ARMY_SLOTS).fill(null);
}

/** Сводка ошибки действия; null — можно. */
export function actionError(w: World, a: AdvAction): string | null {
  if (w.over) return 'Партия окончена';
  if (w.pending && a.t !== 'choose' && a.t !== 'skill') return 'Сначала закончи начатое';
  const me = w.current;
  const p = w.players[me];
  const mine = (id: number): AdvHero | null => {
    const h = heroById(w, id);
    return h && h.owner === me ? h : null;
  };
  const myTown = (id: number): Town | null => {
    const t = townById(w, id);
    return t && t.owner === me ? t : null;
  };
  switch (a.t) {
    case 'end':
      return null;
    case 'choose':
      return w.pending?.t === 'choice' && w.pending.options.some((o) => o.id === a.id) ? null : 'Выбирать нечего';
    case 'move': {
      const h = mine(a.hero);
      if (!h) return 'Чужой герой';
      if (h.ups.length) return 'Сначала выбери навык';
      if (a.to === h.cell) return null;
      return reachOf(w, h).dist[a.to] < 0 ? 'Туда не пройти' : null;
    }
    case 'skill': {
      const h = mine(a.hero);
      const up = h?.ups[0];
      if (!up) return 'Нет повышения';
      return a.skill === null ? (up.options.length ? 'Надо выбрать' : null) : up.options.includes(a.skill) ? null : 'Нет такого навыка';
    }
    case 'build': {
      const t = myTown(a.town);
      if (!t) return 'Чужой город';
      const err = buildError(t, a.b);
      if (err) return err;
      return canPay(p, buildCost(t, a.b)) ? null : 'Не хватает ресурсов';
    }
    case 'recruit': {
      const t = myTown(a.town);
      if (!t) return 'Чужой город';
      const c = CREATURES[a.cre];
      if (!c || c.faction !== t.faction || a.count < 1) return 'Нельзя нанять';
      if (!has(t, c.up ? `up${c.tier}` : `dwell${c.tier}`)) return 'Жилище не построено';
      if (isCast(c)) {
        if (c.cost * a.count > t.forge) return 'Плавка не тянет столько';
      } else if (a.count > t.avail[c.tier - 1]) return 'Столько нет';
      if (!canPay(p, creaturePrice(c, a.count))) return 'Не хватает ресурсов';
      return t.garrison.some((s) => s?.cre === a.cre || !s) ? null : 'В гарнизоне нет места';
    }
    case 'upgrade': {
      const t = myTown(a.town);
      if (!t) return 'Чужой город';
      const army = armyOf(w, a.ref);
      if (!army || refOwner(w, a.ref) !== me || !within(w, refCell(w, a.ref), t.cell)) return 'Отряда тут нет';
      const s = army[a.slot];
      const up = s && canUpgrade(t, s.cre);
      if (!s || !up) return 'Улучшать нечего';
      return canPay(p, { semki: (up.cost - CREATURES[s.cre].cost) * s.count }) ? null : 'Не хватает семок';
    }
    case 'hire': {
      const h = mine(a.hero);
      const o = objById(w, a.obj);
      if (!h || !o || !within(w, h.cell, o.cell) || o.owner !== me) return 'Сначала захвати жилище';
      const fx = defOf(o).effect;
      if (fx.t !== 'dwelling' || a.count < 1 || a.count > (o.n ?? 0)) return 'Столько нет';
      if (!canPay(p, { semki: hireCost(h, fx.cre, a.count) })) return 'Не хватает семок';
      return h.army.some((s) => s?.cre === fx.cre || !s) ? null : 'В армии нет места';
    }
    case 'tavern': {
      if (playerHeroes(w, me).length >= MAX_HEROES) return 'Героев и так восемь';
      if (!canPay(p, { semki: HERO_COST })) return 'Не хватает семок';
      const cell = tavernCell(w, a.town, a.hero, me);
      if (cell < 0) return 'Нет места рядом с трактиром';
      const t = a.town !== null ? myTown(a.town) : null;
      if (t && !has(t, 'tavern')) return 'Трактира нет';
      if (w.heroes.some((h) => h.pick.cls === a.pick.cls && h.pick.n === a.pick.n)) return 'Этот герой уже в деле';
      return null;
    }
    case 'market': {
      if (!playerTowns(w, me).some((t) => has(t, 'market')) && !(a.hero !== undefined && mine(a.hero) && objAt(w, mine(a.hero)!.cell)?.kind === 'tradepost')) return 'Нет рынка';
      if (a.give === a.get || a.amount < 1 || p.res[a.give] < a.amount) return 'Нельзя';
      return marketRate(a.give, a.get, a.amount) > 0 ? null : 'Слишком мало';
    }
    case 'transfer': {
      const from = armyOf(w, a.from);
      const to = armyOf(w, a.to);
      if (!from || !to) return 'Нет отряда';
      if (refOwner(w, a.from) !== me || refOwner(w, a.to) !== me) return 'Чужой отряд';
      if (!within(w, refCell(w, a.from), refCell(w, a.to))) return 'Слишком далеко';
      const s = from[a.fromSlot];
      const d = to[a.toSlot];
      if (!s) return 'Слот пуст';
      if (a.fromSlot >= ARMY_SLOTS || a.toSlot >= ARMY_SLOTS || a.fromSlot < 0 || a.toSlot < 0) return 'Нет слота';
      const n = a.count ?? s.count;
      if (n < 1 || n > s.count) return 'Нет столько';
      if (a.count !== undefined && d && d.cre !== s.cre) return 'Деление — только на пустой слот или в такой же отряд';
      if (from !== to && n === s.count && (!d || d.cre === s.cre) && 'h' in a.from && armySize(from) === 1) return 'Герой не может остаться без армии';
      return null;
    }
    case 'equip': {
      const h = mine(a.hero);
      const sl = ART_SLOTS.find((x) => x.id === a.slot);
      if (!h || !sl || !h.bag.includes(a.art) || ARTIFACTS[a.art].slot !== sl.slot) return 'Нельзя надеть';
      return null;
    }
    case 'unequip': {
      const h = mine(a.hero);
      return h?.arts[a.slot] ? null : 'Снимать нечего';
    }
    case 'giveArt': {
      const f = mine(a.from);
      const t = mine(a.to);
      if (!f || !t || !within(w, f.cell, t.cell)) return 'Герои не рядом';
      return f.bag.includes(a.art) ? null : 'Сначала в сумку';
    }
    case 'cast': {
      const h = mine(a.hero);
      const sp = SPELLS[a.spell];
      if (!h || !sp || sp.kind !== 'adv' || !h.spells.includes(a.spell)) return 'Нет заклинания';
      if (h.mana < sp.mana) return 'Мало маны';
      if (a.spell === 'town-portal' && !playerTowns(w, me).length) return 'Некуда';
      if (a.spell === 'summon-boat' && (h.boat || boatCell(w, h) < 0)) return 'Рядом нет воды';
      return null;
    }
    case 'boat': {
      const h = mine(a.hero);
      const o = objById(w, a.obj);
      if (!h || !o || defOf(o).effect.t !== 'shipyard' || !within(w, h.cell, o.cell)) return 'Верфи нет';
      if (shoreCell(w, o.cell) < 0) return 'Нет воды рядом';
      return canPay(p, { semki: 1000, wood: 10 }) ? null : 'Не хватает ресурсов';
    }
    case 'townBoat': {
      const t = myTown(a.town);
      if (!t || !has(t, 'shipyard')) return 'Верфи нет';
      if (shoreCell(w, t.cell) < 0) return 'Город не у воды';
      return canPay(p, { semki: 1000, wood: 10 }) ? null : 'Не хватает ресурсов';
    }
    case 'dig': {
      const h = mine(a.hero);
      if (!h || h.boat) return 'Копать некому';
      if (h.mp < heroMaxMp(h)) return 'Копают с утра: нужен полный запас хода';
      if (objAt(w, h.cell) || townAt(w, h.cell)) return 'Тут не покопаешь';
      return null;
    }
    case 'decree': {
      const t = myTown(a.town);
      return t && t.decrees.includes(a.id) ? null : 'Указа нет';
    }
    case 'research': {
      const t = myTown(a.town);
      if (!t || !has(t, 'lab') || t.research) return 'Лаборатория занята';
      const next = BRANCHES[a.school]?.[t.studied[a.school] ?? 0];
      if (!next) return 'Ветка изучена';
      return canPay(p, { amber: RESEARCH_AMBER }) ? null : 'Мало янтаря';
    }
    case 'repair': {
      const t = myTown(a.town);
      if (!t || !has(t, 'scrapyard')) return 'Ремонтного двора нет';
      const n = p.scrap[a.cre] ?? 0;
      if (a.count < 1 || a.count > n) return 'Столько лома нет';
      if (!canPay(p, repairCost(a.cre, a.count))) return 'Не хватает ресурсов';
      return t.garrison.some((s) => s?.cre === a.cre || !s) ? null : 'В гарнизоне нет места';
    }
    case 'dismiss': {
      const h = mine(a.hero);
      if (!h) return 'Чужой герой';
      return playerHeroes(w, me).length > 1 || playerTowns(w, me).length ? null : 'Последний герой';
    }
  }
}

export const hireCost = (h: AdvHero, cre: string, count: number): number => Math.trunc((CREATURES[cre].cost * count * (100 - skillValue(h, 'diplomacy'))) / 100);
export const repairCost = (cre: string, count: number): Purse => {
  const full = creaturePrice(CREATURES[cre], count);
  const out: Purse = {};
  for (const [k, v] of Object.entries(full) as [ResId, number][]) out[k] = v >> 1;
  return out;
};

/** Свободная клетка воды рядом с городом или верфью. */
function shoreCell(w: World, near: number): number {
  const x = xOf(w, near);
  const y = yOf(w, near);
  const z = levelOf(w, near);
  for (let r = 1; r <= 4; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w.w || ny >= w.h) continue;
        const c = cellOf(w, nx, ny, z);
        if (w.terrain[c] === WATER && !w.block[c] && !objAt(w, c) && !heroAt(w, c)) return c;
      }
    }
  }
  return -1;
}
const boatCell = (w: World, h: AdvHero): number => shoreCell(w, h.cell);

function tavernCell(w: World, town: number | null, hero: number | null, me: number): number {
  const at = town !== null ? townById(w, town)?.cell : hero !== null ? heroById(w, hero)?.cell : undefined;
  if (at === undefined) return -1;
  if (!heroAt(w, at)) return at;
  const probe = w.heroes.find((h) => h.owner === me) ?? null;
  const free = neighbors(w, at).find((c) => !w.block[c] && w.terrain[c] !== WATER && !heroAt(w, c) && !objAt(w, c) && !townAt(w, c) && !guardOf(w, c));
  void probe;
  return free ?? -1;
}

export function act(w: World, a: AdvAction): AdvEvent[] {
  const err = actionError(w, a);
  if (err) throw new Error(`Карта: ${a.t} — ${err}`);
  const ev: AdvEvent[] = [];
  const p = w.players[w.current];
  switch (a.t) {
    case 'end':
      endTurn(w, ev);
      break;
    case 'move': {
      const h = heroById(w, a.hero)!;
      if (a.to === h.cell) {
        const town = townAt(w, h.cell);
        if (town) enterTown(w, h, town, ev);
        else {
          const o = objAt(w, h.cell);
          if (o) visit(w, h, o, ev);
        }
        break;
      }
      walk(w, h, pathOf(reachOf(w, h), a.to), ev);
      break;
    }
    case 'choose':
      resolveChoice(w, a.id, ev);
      break;
    case 'skill': {
      const h = heroById(w, a.hero)!;
      h.ups.shift();
      if (a.skill) {
        const s = h.skills.find((x) => x.id === a.skill);
        if (s) s.lv++;
        else h.skills.push({ id: a.skill, lv: 1 });
        ev.push({ e: 'sfx', name: 'levelup' });
      }
      h.mana = Math.min(h.mana, Math.max(h.mana, heroMaxMana(h)));
      break;
    }
    case 'build': {
      const t = townById(w, a.town)!;
      pay(p, buildCost(t, a.b));
      t.built.push(a.b);
      t.builtToday = true;
      t.discount = 0;
      const d = buildingDef(t, a.b)!;
      if (a.b.startsWith('dwell')) {
        const tier = Number(a.b.slice(5));
        const c = townCreature(t, tier, false);
        if (!isCast(c)) t.avail[tier - 1] += c.weekly;
      }
      if (a.b === 'skhod') t.decrees = rollDecrees(w);
      if (a.b === 'observatory') for (const o of owned(w, t.owner)) reveal(w, t.owner, o.cell, 6);
      void d;
      ev.push({ e: 'built', town: t.id, b: a.b }, { e: 'sfx', name: 'build' });
      break;
    }
    case 'recruit': {
      const t = townById(w, a.town)!;
      const c = CREATURES[a.cre];
      pay(p, creaturePrice(c, a.count));
      if (isCast(c)) t.forge -= c.cost * a.count;
      else t.avail[c.tier - 1] -= a.count;
      addToArmy(t.garrison, a.cre, a.count);
      ev.push({ e: 'recruit', town: t.id, cre: a.cre, count: a.count }, { e: 'sfx', name: isCast(c) ? 'forge' : 'recruit' });
      break;
    }
    case 'upgrade': {
      const t = townById(w, a.town)!;
      const army = armyOf(w, a.ref)!;
      const s = army[a.slot]!;
      const up = canUpgrade(t, s.cre)!;
      pay(p, { semki: (up.cost - CREATURES[s.cre].cost) * s.count });
      s.cre = up.id;
      ev.push({ e: 'sfx', name: 'recruit' });
      break;
    }
    case 'hire': {
      const h = heroById(w, a.hero)!;
      const o = objById(w, a.obj)!;
      const fx = defOf(o).effect as { t: 'dwelling'; cre: string };
      pay(p, { semki: hireCost(h, fx.cre, a.count) });
      o.n = (o.n ?? 0) - a.count;
      addToArmy(h.army, fx.cre, a.count);
      ev.push({ e: 'sfx', name: 'recruit' });
      break;
    }
    case 'tavern': {
      const cell = tavernCell(w, a.town, a.hero, w.current);
      pay(p, { semki: HERO_COST });
      const h = makeHero(w, a.pick, w.current, cell);
      startArmy(h);
      w.heroes.push(h);
      revealHero(w, h);
      const t = a.town !== null ? townById(w, a.town) : undefined;
      if (t) t.tavern = t.tavern.filter((x) => !(x.cls === a.pick.cls && x.n === a.pick.n));
      ev.push({ e: 'heroNew', hero: h.id }, { e: 'sfx', name: 'recruit' });
      break;
    }
    case 'market': {
      const got = marketRate(a.give, a.get, a.amount);
      p.res[a.give] -= a.amount;
      p.res[a.get] += got;
      ev.push({ e: 'sfx', name: 'market' });
      break;
    }
    case 'transfer': {
      const from = armyOf(w, a.from)!;
      const to = armyOf(w, a.to)!;
      const s = from[a.fromSlot]!;
      const d = to[a.toSlot];
      const n = a.count ?? s.count;
      if (from === to && a.fromSlot === a.toSlot) break;
      if (d && d.cre === s.cre) {
        d.count += n;
        s.count -= n;
        if (s.count === 0) from[a.fromSlot] = null;
      } else if (!d) {
        to[a.toSlot] = { cre: s.cre, count: n };
        s.count -= n;
        if (s.count === 0) from[a.fromSlot] = null;
      } else {
        from[a.fromSlot] = d;
        to[a.toSlot] = s;
      }
      break;
    }
    case 'equip': {
      const h = heroById(w, a.hero)!;
      h.bag.splice(h.bag.indexOf(a.art), 1);
      if (h.arts[a.slot]) h.bag.push(h.arts[a.slot]);
      h.arts[a.slot] = a.art;
      h.mana = Math.min(h.mana, heroMaxMana(h));
      break;
    }
    case 'unequip': {
      const h = heroById(w, a.hero)!;
      h.bag.push(h.arts[a.slot]);
      delete h.arts[a.slot];
      h.mana = Math.min(h.mana, heroMaxMana(h));
      break;
    }
    case 'giveArt': {
      const f = heroById(w, a.from)!;
      const t = heroById(w, a.to)!;
      f.bag.splice(f.bag.indexOf(a.art), 1);
      t.bag.push(a.art);
      break;
    }
    case 'cast': {
      const h = heroById(w, a.hero)!;
      const sp = SPELLS[a.spell];
      h.mana -= sp.mana;
      if (a.spell === 'view-air') {
        reveal(w, h.owner, h.cell, 12);
        ev.push({ e: 'sfx', name: 'spell-air' });
      } else if (a.spell === 'town-portal') {
        const towns = playerTowns(w, h.owner).filter((t) => !heroAt(w, t.cell));
        if (!towns.length) {
          h.mana += sp.mana;
          ev.push({ e: 'msg', title: sp.name, text: 'Все свои ворота заняты.' });
          break;
        }
        towns.sort((x, y) => distSq(w, x.cell, h.cell) - distSq(w, y.cell, h.cell));
        h.cell = towns[0].cell;
        h.boat = false;
        h.mp = Math.max(0, h.mp - 300);
        revealHero(w, h);
        ev.push({ e: 'teleport', hero: h.id, to: h.cell }, { e: 'sfx', name: 'teleport' });
      } else {
        const c = boatCell(w, h);
        const o = placeObject(w, { kind: 'boat', cell: c, owner: -1 });
        ev.push({ e: 'add', obj: o.id }, { e: 'sfx', name: 'water-splash' });
      }
      break;
    }
    case 'boat':
    case 'townBoat': {
      const near = a.t === 'boat' ? objById(w, a.obj)!.cell : townById(w, a.town)!.cell;
      pay(p, { semki: 1000, wood: 10 });
      const o = placeObject(w, { kind: 'boat', cell: shoreCell(w, near), owner: -1 });
      ev.push({ e: 'add', obj: o.id }, { e: 'sfx', name: 'build' });
      break;
    }
    case 'dig': {
      const h = heroById(w, a.hero)!;
      h.mp = 0;
      const found = h.cell === w.shard && !Object.values(h.arts).includes(SHARD);
      ev.push({ e: 'dig', found }, { e: 'sfx', name: 'dig' });
      if (found) {
        giveArtifact(h, SHARD, ev);
        w.shard = -1;
      } else ev.push({ e: 'msg', title: 'Раскопки', text: 'Одна глина.' });
      break;
    }
    case 'decree':
      applyDecree(w, townById(w, a.town)!, a.id, ev);
      break;
    case 'research': {
      const t = townById(w, a.town)!;
      pay(p, { amber: RESEARCH_AMBER });
      t.research = { school: a.school, left: RESEARCH_DAYS };
      ev.push({ e: 'sfx', name: 'learn' });
      break;
    }
    case 'repair': {
      const t = townById(w, a.town)!;
      pay(p, repairCost(a.cre, a.count));
      p.scrap[a.cre] -= a.count;
      addToArmy(t.garrison, a.cre, a.count);
      ev.push({ e: 'sfx', name: 'forge' });
      break;
    }
    case 'dismiss': {
      const h = heroById(w, a.hero)!;
      w.heroes.splice(w.heroes.indexOf(h), 1);
      ev.push({ e: 'heroDead', hero: h.id, owner: h.owner });
      checkPlayers(w, ev);
      break;
    }
  }
  return ev;
}

function applyDecree(w: World, t: Town, id: string, ev: AdvEvent[]): void {
  t.decrees = [];
  const p = w.players[t.owner];
  switch (id) {
    case 'growth':
      t.bonus = t.bonus.map((_, i) => (i < 3 ? factionCreatures(t.faction).find((c) => c.tier === i + 1)!.weekly : 0));
      break;
    case 'semki':
      give(p, { semki: 2000 });
      ev.push({ e: 'gain', player: p.id, res: { semki: 2000 } });
      break;
    case 'xp': {
      const h = heroAt(w, t.cell);
      if (h) gainXp(w, h, 500, ev);
      break;
    }
    case 'discount':
      t.discount = 25;
      break;
    case 'militia':
      addToArmy(t.garrison, townCreature(t, 1, false).id, townCreature(t, 1, false).weekly);
      break;
  }
  ev.push({ e: 'sfx', name: 'flag' });
}

function resolveChoice(w: World, id: string, ev: AdvEvent[]): void {
  const c = w.pending as PendingChoice;
  w.pending = null;
  const h = heroById(w, c.hero)!;
  const o = objById(w, c.obj);
  if (!o) return;
  const fx = defOf(o).effect;
  if (fx.t === 'chest') {
    const n = o.n ?? 1500;
    if (id === 'semki') {
      give(w.players[h.owner], { semki: n });
      ev.push({ e: 'gain', player: h.owner, res: { semki: n } });
    } else gainXp(w, h, n - 500, ev);
    removeObj(w, o, ev);
  } else if (fx.t === 'seer' && id === 'give') {
    const q = o.quest!;
    if (q.cre) {
      let left = q.count ?? 1;
      for (let i = 0; i < h.army.length && left > 0; i++) {
        const s = h.army[i];
        if (s?.cre !== q.cre) continue;
        const n = Math.min(left, s.count);
        s.count -= n;
        left -= n;
        if (s.count === 0) h.army[i] = null;
      }
    } else if (q.art) {
      const slot = Object.keys(h.arts).find((k) => h.arts[k] === q.art);
      if (slot) delete h.arts[slot];
      else h.bag.splice(h.bag.indexOf(q.art), 1);
    }
    q.done = true;
    give(w.players[h.owner], q.reward);
    ev.push({ e: 'gain', player: h.owner, res: q.reward }, { e: 'sfx', name: 'artifact' });
    gainXp(w, h, q.xp, ev);
  }
}

// ------------------------------------------------------------------ бой

const SCHOOLS: School[] = ['fire', 'water', 'earth', 'air'];
export function heroStats(h: AdvHero): HeroStats {
  const schools: Partial<Record<School, number>> = {};
  for (const s of SCHOOLS) {
    const v = skillValue(h, s);
    if (v) schools[s] = v;
  }
  return {
    atk: heroAtk(h), def: heroDef(h), power: heroPower(h), know: heroKnow(h), mana: h.mana, morale: heroMorale(h), luck: heroLuck(h),
    spells: h.spells.filter((s) => SPELLS[s]?.kind !== 'adv'),
    offense: skillValue(h, 'offense'), archery: skillValue(h, 'archery'), armorer: skillValue(h, 'armorer'), resist: skillValue(h, 'resistance'), sorcery: skillValue(h, 'sorcery'), schools, tactics: skillValue(h, 'tactics'),
  };
}

const armyList = (a: Army): { cre: string; count: number }[] => a.flatMap((s) => (s ? [{ cre: s.cre, count: s.count }] : []));

export interface WorldBattle {
  setup: BattleSetup;
  /** Осада: уровень стен. */
  fort: number;
}

/** Настройка боя по ожидающей встрече: сторона 0 — кто напал. */
export function battleSetup(w: World): WorldBattle {
  const b = w.pending as PendingBattle;
  const h = heroById(w, b.hero)!;
  const field = TERRAINS[w.terrain[h.cell]].field;
  const att = { hero: h.pick, army: armyList(h.army), stats: heroStats(h) };
  if (b.def.k === 'hero') {
    const d = heroById(w, b.def.id)!;
    return { setup: { seed: b.seed, field, sides: [att, { hero: d.pick, army: armyList(d.army), stats: heroStats(d) }] }, fort: 0 };
  }
  if (b.def.k === 'town') {
    const t = townById(w, b.def.id)!;
    const fort = fortLevel(t);
    const guard: HeroStats = { atk: 0, def: has(t, 'smithy') ? 2 : 0, power: 0, know: 0, mana: 0, morale: has(t, 'tavern') ? 1 : 0, luck: 0, spells: [] };
    return { setup: { seed: b.seed, field, sides: [att, { hero: null, label: t.name, army: armyList(t.garrison), stats: guard }], siege: fort || undefined, siegeFaction: t.faction }, fort };
  }
  const o = objById(w, b.def.id)!;
  return { setup: { seed: b.seed, field, sides: [att, { hero: null, label: isStack(o) ? CREATURES[armyList(o.army!)[0].cre].name : defOf(o).name, army: armyList(o.army!) }] }, fort: 0 };
}

/** Отряды после боя → армия: те же слоты, павшие слоты пустеют. */
function afterArmy(a: Army, s: BattleState, side: number): void {
  const units = s.units.filter((u) => u.side === side);
  let i = 0;
  for (let slot = 0; slot < a.length; slot++) {
    const st = a[slot];
    if (!st) continue;
    const u = units[i++];
    if (!u) continue;
    if (u.count > 0) st.count = u.count;
    else a[slot] = null;
  }
}

function killedXp(s: BattleState, side: number): number {
  let sum = 0;
  for (const u of s.units) if (u.side === side) sum += (u.start - u.count) * CREATURES[u.cre].hp;
  return sum;
}

/** Лекарь поднимает часть павших; лом Кузни копится у игрока. */
function afterLosses(w: World, h: AdvHero, s: BattleState, side: number): void {
  const units = s.units.filter((u) => u.side === side);
  const aid = skillValue(h, 'firstaid');
  const p = w.players[h.owner];
  for (const u of units) {
    const lost = u.start - u.count;
    if (lost <= 0) continue;
    const c = CREATURES[u.cre];
    if (aid) {
      const back = Math.trunc((lost * aid) / 100);
      if (back > 0) addToArmy(h.army, u.cre, back);
    }
    if (isCast(c) && classOf(h.pick.cls).faction === 'kuznya') p.scrap[u.cre] = (p.scrap[u.cre] ?? 0) + (lost >> 1);
  }
}

function killHero(w: World, h: AdvHero, ev: AdvEvent[]): void {
  w.heroes.splice(w.heroes.indexOf(h), 1);
  ev.push({ e: 'heroDead', hero: h.id, owner: h.owner });
}

/** Забрать итог боя в мир. Побег (нет победы над живой армией) — герой уходит, армия теряется. */
export function applyBattle(w: World, s: BattleState): AdvEvent[] {
  const b = w.pending as PendingBattle;
  w.pending = null;
  const ev: AdvEvent[] = [];
  const h = heroById(w, b.hero)!;
  h.luckNext = 0;
  h.mana = s.sides[0].mana;
  const won = s.winner === 0;
  const d = b.def;
  if (won) {
    afterArmy(h.army, s, 0);
    afterLosses(w, h, s, 0);
    gainXp(w, h, killedXp(s, 1), ev);
    if (skillLevel(h, 'eagle') && d.k === 'hero') {
      const foe = heroById(w, d.id)!;
      const known = foe.spells.filter((x) => !h.spells.includes(x) && canLearn(h, x));
      if (known.length && rollInt(w, 1, 100) <= skillValue(h, 'eagle')) {
        const sp = known[rollInt(w, 0, known.length - 1)];
        h.spells.push(sp);
        ev.push({ e: 'msg', title: 'Орлиный глаз', text: `Выучено в бою: ${SPELLS[sp].name}.` });
      }
    }
  } else {
    killHero(w, h, ev);
  }
  if (d.k === 'hero') {
    const foe = heroById(w, d.id)!;
    foe.mana = s.sides[1].mana;
    foe.luckNext = 0;
    if (won) {
      // победитель забирает вещи
      for (const art of [...Object.values(foe.arts), ...foe.bag]) giveArtifact(h, art, ev);
      killHero(w, foe, ev);
      gainXp(w, h, 500, ev);
    } else if (s.winner === 1) {
      afterArmy(foe.army, s, 1);
      afterLosses(w, foe, s, 1);
      gainXp(w, foe, killedXp(s, 0) + 500, ev);
      for (const art of [...Object.values(h.arts), ...h.bag]) giveArtifact(foe, art, ev);
    } else killHero(w, foe, ev);
  } else if (d.k === 'town') {
    const t = townById(w, d.id)!;
    if (won) {
      t.garrison = emptyArmy();
      takeTown(w, t, h, ev);
    } else afterArmy(t.garrison, s, 1);
  } else {
    const o = objById(w, d.id)!;
    if (won) afterGuard(w, o, h, ev);
    else if (o.army) afterArmy(o.army, s, 1);
  }
  checkPlayers(w, ev);
  return ev;
}

// ------------------------------------------------------------------ создание

export function makeHero(w: World, pick: HeroPick, owner: number, cell: number): AdvHero {
  const c = classOf(pick.cls);
  const h: AdvHero = {
    id: w.nextHero++, pick, owner, cell, level: 1, xp: 0, atk: c.atk, def: c.def, power: c.power, know: c.know, mana: c.know * 10, mp: 0, army: emptyArmy(),
    spells: [...c.spells], skills: [], arts: {}, bag: [], visited: [], luckNext: 0, stabled: false, boat: false, ups: [], wellDay: -1, dir: 6,
  };
  h.skills.push({ id: isMight(h) ? 'leadership' : 'wisdom', lv: 1 });
  h.mp = heroMaxMp(h);
  return h;
}

/** Начальная армия героя: младшие ступени своей фракции. */
export function startArmy(h: AdvHero): void {
  const f = classOf(h.pick.cls).faction;
  const list = factionCreatures(f).filter((c) => !c.up);
  addToArmy(h.army, list.find((c) => c.tier === 1)!.id, 22);
  addToArmy(h.army, list.find((c) => c.tier === 2)!.id, 7);
  addToArmy(h.army, list.find((c) => c.tier === 3)!.id, 3);
  h.mp = heroMaxMp(h);
}

const GUILD_POOL: string[][] = [
  ['fire-arrow', 'bloodlust', 'stone-skin', 'haste', 'weakness', 'gust', 'view-air', 'ice-bolt'],
  ['heal-light', 'slow', 'blessing', 'precision', 'sorrow', 'flash', 'summon-boat'],
  ['fireball', 'lightning', 'meteors', 'town-portal'],
];

export function makeTown(w: World, faction: TownFaction, owner: number, cell: number, name: string): Town {
  const r = rngOf(w);
  const take = (pool: string[], n: number): string[] => {
    const list = [...pool];
    const out: string[] = [];
    while (out.length < n && list.length) out.push(list.splice(r.below(list.length), 1)[0]);
    return out;
  };
  // у Академии гильдия пуста: заклинания дают опыты (DESIGN.md §5.4)
  const guild = faction === 'akademiya' ? [[], [], []] : [take(GUILD_POOL[0], 3), take(GUILD_POOL[1], 2), take(GUILD_POOL[2], 1)];
  w.rng = r.s;
  const t: Town = {
    id: w.towns.length, name, faction, owner, cell, built: ['hall1', 'fort1', 'tavern', 'dwell1'], builtToday: false, avail: [0, 0, 0, 0, 0, 0, 0], garrison: emptyArmy(), guild, decrees: [], bonus: [0, 0, 0, 0, 0, 0, 0], discount: 0,
    forge: faction === 'kuznya' ? 1500 : 0, research: null, studied: {}, tavern: [],
  };
  const c = townCreature(t, 1, false);
  t.avail[0] = c.weekly;
  return t;
}

export { BUILDINGS, TERRAIN_INDEX };
