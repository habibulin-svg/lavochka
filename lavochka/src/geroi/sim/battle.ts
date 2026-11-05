/* Бой «Героев»: чистая детерминированная логика (DESIGN.md §4, §10). Состояние — обычный JSON: сохранение, сеть и запись партии — одна и та же вещь.
 * act() проверяет действие, меняет состояние и возвращает события; отрисовка играет их по порядку и логику не трогает. */
import { Rng } from '../../gops/sim/rng';
import { CREATURES, type CreatureDef, type Faction, hasAb } from './creatures';
import { type HeroPick, classOf } from './heroes';
import { CELLS, FIELD_H, FIELD_W, cellOf, cellX, cellY, hexDist, mirrorCell, neighbors } from './hex';
import { SPELLS, type School, type SpellDef } from './spells';

export const MAX_ROUNDS = 60;
/** Шанс морали и удачи за единицу, ‰. */
const FORTUNE_PER_POINT = 42;
const CHANCE_PROC = 250;
/** Сколько раз за бой отряд лечит, чинит или проклинает. */
const AID_USES = 3;
const SKY: School[] = ['fire', 'water', 'earth', 'air'];
const BOG_SPEED = 2;
/** «Разгон» Плотины: +4 % урона за пройденный гекс, не больше +40 %. */
const RUSH_PER_STEP = 4;
const RUSH_MAX = 40;
/** «Буря» Плотины: каждый 3-й раунд чужие летуны теряют столько скорости. */
const STORM_SPEED = 2;
/** Ранг отряда Острога: +1 к атаке и защите за ранг (на карте — опыт в боях и на плацу). */
export const RANK_MAX = 5;
/** Карманники Базара: семок за каждое существо в ударе (на карте уходят в казну). */
const STEAL_PER = 2;

/** Цифры героя с карты приключений: уровень, навыки, вещи. В «Арене» их нет — там всё от класса. */
export interface HeroStats {
  atk: number;
  def: number;
  power: number;
  know: number;
  mana: number;
  morale: number;
  luck: number;
  spells: string[];
  /** Навыки, %: рукопашная, стрельба, броня, стойкость к магии, урон заклинаний. */
  offense?: number;
  archery?: number;
  armorer?: number;
  resist?: number;
  sorcery?: number;
  /** Сила магии по школам. */
  schools?: Partial<Record<School, number>>;
  /** Тактика: скорость в первом раунде. */
  tactics?: number;
}

export interface SideSetup {
  /** Нет героя — нейтральный отряд или гарнизон: нули и без книги. */
  hero: HeroPick | null;
  /** rank — ранг отряда Острога (0–5). */
  army: { cre: string; count: number; rank?: number }[];
  stats?: HeroStats;
  /** Подпись стороны без героя. */
  label?: string;
}

export interface BattleSetup {
  seed: number;
  field: string;
  sides: [SideSetup, SideSetup];
  /** Осада: уровень стен у стороны 1 (1–3). */
  siege?: number;
  /** Чьи стены рисовать. */
  siegeFaction?: string;
}

export type EffectKind = 'atk' | 'def' | 'speed' | 'poison' | 'stun' | 'root' | 'hidden';

export interface Effect {
  k: EffectKind;
  v: number;
  /** Сколько концов раунда осталось. */
  n: number;
  /** Удушение Затонья: усиливается, пока цель стоит на месте. */
  grows?: boolean;
}

export interface Unit {
  id: number;
  side: 0 | 1;
  cre: string;
  cell: number;
  count: number;
  start: number;
  /** Здоровье верхнего существа. */
  top: number;
  shots: number;
  aid: number;
  retaled: boolean;
  acted: boolean;
  waited: boolean;
  defending: boolean;
  moraled: boolean;
  /** Сходил с места в этом раунде (для удушения). */
  moved: boolean;
  /** Прошлый удар уже увёл в туман. */
  misted?: boolean;
  /** Ранг Острога: +1 к атаке и защите за ранг. */
  rank?: number;
  effects: Effect[];
}

export interface HeroState extends Partial<Pick<HeroStats, 'offense' | 'archery' | 'armorer' | 'resist' | 'sorcery' | 'schools' | 'tactics'>> {
  pick: HeroPick | null;
  label?: string;
  faction: Faction;
  atk: number;
  def: number;
  power: number;
  know: number;
  mana: number;
  morale: number;
  luck: number;
  spells: string[];
  cast: boolean;
}

export interface BattleState {
  seed: number;
  rng: number;
  round: number;
  field: string;
  sides: [HeroState, HeroState];
  units: Unit[];
  queue: number[];
  waited: number[];
  current: number;
  obstacles: { cell: number; art: number }[];
  bog: number[];
  /** Чья топь: её не боится эта сторона. −1 — топи нет. */
  bogOwner: number;
  /** Осада: стены стороны 1. Пусто — обычный бой. */
  walls?: WallSeg[];
  /** Сколько башен бьёт в начале раунда. */
  towers?: number;
  siegeFaction?: string;
  /** Уровень стен. */
  fort?: number;
  sky: School[];
  over: boolean;
  /** Победитель; −1 — ничья. */
  winner: number;
  /** Расчёт бота: средний урон и без случайностей, настоящих бросков бот не видит. */
  expect?: boolean;
  /** «Подлянка» Базара: спрятанная ловушка (видит только хозяин). Нет — нет ловушки. */
  trap?: { cell: number; owner: number };
  /** Сколько семок унесли карманники каждой стороны. */
  loot?: [number, number];
}

/** Кусок стены: держит клетку, пока цел. Ворота свои пропускают. */
export interface WallSeg {
  cell: number;
  hp: number;
  gate: boolean;
  /** Башня: стоит до конца боя. */
  tower?: boolean;
}

/** Столбец стены и ряды; ворота посередине, башни — по краям ворот. */
export const WALL_X = 11;
const GATE_ROW = 5;
const TOWER_ROWS = [2, 8];

export type Action =
  | { t: 'move'; to: number }
  | { t: 'attack'; target: number; from: number }
  | { t: 'shoot'; target: number }
  | { t: 'aid'; target: number }
  | { t: 'cast'; spell: string; cell: number }
  | { t: 'wait' }
  | { t: 'defend' }
  | { t: 'flee' };

export interface HitInfo {
  t: number;
  dmg: number;
  kills: number;
  /** Сколько осталось в отряде и здоровье верхнего — для показа. */
  left: number;
}

export type BattleEvent =
  | { e: 'round'; n: number }
  | { e: 'turn'; u: number }
  | { e: 'move'; u: number; path: number[] }
  | { e: 'hit'; u: number; hits: HitInfo[]; shot?: boolean; retal?: boolean; luck?: boolean }
  | { e: 'die'; u: number }
  | { e: 'skip'; u: number; why: 'stun' | 'morale' }
  | { e: 'morale'; u: number }
  | { e: 'wait'; u: number }
  | { e: 'defend'; u: number }
  | { e: 'spell'; side: number; spell: string; cell: number; hits: HitInfo[]; heals: { t: number; left: number }[]; marks: number[] }
  | { e: 'aid'; u: number; t: number; left: number; curse?: boolean }
  | { e: 'proc'; t: number; k: 'poison' | 'blind' | 'root' | 'swallow' | 'mist' | 'storm' | 'trap' | 'pull' | 'steal' }
  | { e: 'poison'; t: number; dmg: number; left: number }
  | { e: 'wall'; cell: number; hp: number }
  | { e: 'tower'; t: number; dmg: number; left: number }
  | { e: 'over'; winner: number; why?: 'flee' | 'rounds' };

const creOf = (u: Unit): CreatureDef => CREATURES[u.cre];
export const unitById = (s: BattleState, id: number): Unit => s.units[id];
export const alive = (s: BattleState): Unit[] => s.units.filter((u) => u.count > 0);
export const currentUnit = (s: BattleState): Unit | null => (s.current >= 0 ? s.units[s.current] : null);

/** Вторая клетка большого существа: позади, со стороны своего края. */
export const tailOf = (side: number, cell: number): number => (side === 0 ? cell - 1 : cell + 1);
const fitsBig = (side: number, cell: number): boolean => (side === 0 ? cellX(cell) >= 1 : cellX(cell) <= FIELD_W - 2);
export const cellsOf = (u: Unit): number[] => (hasAb(creOf(u), 'big') ? [u.cell, tailOf(u.side, u.cell)] : [u.cell]);
const cellsAt = (u: Unit, cell: number): number[] => (hasAb(creOf(u), 'big') ? [cell, tailOf(u.side, cell)] : [cell]);

/** Занятость клеток; ворота пропускают защитников (side = 1). */
export function occupancy(s: BattleState, side = -1): Int16Array {
  const occ = new Int16Array(CELLS).fill(-1);
  for (const o of s.obstacles) occ[o.cell] = -2;
  for (const c of s.walls ?? []) if (c.hp > 0 && !(c.gate && side === 1)) occ[c.cell] = -2;
  for (const u of s.units) if (u.count > 0) for (const c of cellsOf(u)) occ[c] = u.id;
  return occ;
}

export const unitAt = (s: BattleState, cell: number): Unit | null => {
  for (const u of s.units) if (u.count > 0 && cellsOf(u).includes(cell)) return u;
  return null;
};

const effectSum = (u: Unit, k: EffectKind): number => u.effects.reduce((sum, e) => (e.k === k ? sum + e.v : sum), 0);
const hasEffect = (u: Unit, k: EffectKind): boolean => u.effects.some((e) => e.k === k);
export const isHidden = (u: Unit): boolean => hasEffect(u, 'hidden');
export const isRooted = (u: Unit): boolean => hasEffect(u, 'root');

const onForeignBog = (s: BattleState, u: Unit): boolean => s.bogOwner >= 0 && s.bogOwner !== u.side && !hasAb(creOf(u), 'pass') && !hasAb(creOf(u), 'fly') && s.bog.includes(u.cell);

/** «Строй дружины» Острога: в первом раунде +1 скорость и +2 защиты. */
const inFormation = (s: BattleState, u: Unit): boolean => s.round === 1 && creOf(u).faction === 'ostrog';

export function speedOf(s: BattleState, u: Unit): number {
  const tactics = s.round === 1 ? s.sides[u.side].tactics ?? 0 : 0;
  return Math.max(1, creOf(u).speed + effectSum(u, 'speed') + tactics + (inFormation(s, u) ? 1 : 0) - (onForeignBog(s, u) ? BOG_SPEED : 0));
}
export const attackOf = (s: BattleState, u: Unit): number => Math.max(0, creOf(u).atk + s.sides[u.side].atk + effectSum(u, 'atk') + (u.rank ?? 0));
export function defenseOf(s: BattleState, u: Unit): number {
  const d = Math.max(0, creOf(u).def + s.sides[u.side].def + effectSum(u, 'def') + (u.rank ?? 0) + (inFormation(s, u) ? 2 : 0));
  return u.defending ? d + Math.trunc((d * 3) / 10) + 1 : d;
}
const totalHp = (u: Unit): number => (u.count > 0 ? (u.count - 1) * creOf(u).hp + u.top : 0);
/** Сила отряда с учётом ран: ею оценивают позицию и решают бой по лимиту раундов. */
export const unitValue = (u: Unit): number => (creOf(u).power * totalHp(u)) / creOf(u).hp;
export const sideValue = (s: BattleState, side: number): number => s.units.reduce((sum, u) => (u.side === side ? sum + unitValue(u) : sum), 0);

/** Куда может дойти отряд: расстояние (−1 — нельзя) и предыдущая клетка пути. */
export interface Reach {
  dist: Int16Array;
  prev: Int16Array;
}

export function reachOf(s: BattleState, u: Unit): Reach {
  const dist = new Int16Array(CELLS).fill(-1);
  const prev = new Int16Array(CELLS).fill(-1);
  dist[u.cell] = 0;
  const c = creOf(u);
  if (isRooted(u) || hasAb(c, 'still')) return { dist, prev };
  const occ = occupancy(s, u.side);
  const big = hasAb(c, 'big');
  const free = (cell: number): boolean => {
    if (big && !fitsBig(u.side, cell)) return false;
    for (const x of big ? [cell, tailOf(u.side, cell)] : [cell]) if (occ[x] !== -1 && occ[x] !== u.id) return false;
    return true;
  };
  const speed = speedOf(s, u);
  if (hasAb(c, 'fly')) {
    for (let cell = 0; cell < CELLS; cell++) {
      const d = hexDist(u.cell, cell);
      if (d > 0 && d <= speed && free(cell)) {
        dist[cell] = d;
        prev[cell] = u.cell;
      }
    }
    return { dist, prev };
  }
  // сквозь препятствия идут ладейщики и морока, но встать на него нельзя
  const pass = hasAb(c, 'pass');
  const walled = new Set((s.walls ?? []).filter((w) => w.hp > 0 && !(w.gate && u.side === 1)).map((w) => w.cell));
  const walkable = (cell: number): boolean => {
    if (!pass) return free(cell);
    // стену не пройти и тем, кто идёт сквозь камни и топь
    if (walled.has(cell)) return false;
    if (big && !fitsBig(u.side, cell)) return false;
    for (const x of big ? [cell, tailOf(u.side, cell)] : [cell]) if (occ[x] >= 0 && occ[x] !== u.id) return false;
    return true;
  };
  const front = [u.cell];
  const seen = new Int16Array(CELLS).fill(-1);
  seen[u.cell] = 0;
  for (let i = 0; i < front.length; i++) {
    const at = front[i];
    if (seen[at] >= speed) continue;
    for (const n of neighbors(at)) {
      if (seen[n] >= 0 || !walkable(n)) continue;
      seen[n] = seen[at] + 1;
      prev[n] = at;
      front.push(n);
      if (free(n)) dist[n] = seen[n];
    }
  }
  return { dist, prev };
}

export function pathTo(r: Reach, from: number, to: number): number[] {
  const path = [to];
  for (let at = to; at !== from && r.prev[at] >= 0; at = r.prev[at]) path.unshift(r.prev[at]);
  return path;
}

const adjacentCells = (a: number[], b: number[]): boolean => a.some((x) => b.some((y) => hexDist(x, y) === 1));
export const adjacent = (a: Unit, b: Unit): boolean => adjacentCells(cellsOf(a), cellsOf(b));
export const canTarget = (u: Unit): boolean => u.count > 0 && !isHidden(u);
/** Клетки, откуда отряд достаёт цель в ближнем бою (включая ту, где стоит). */
export function attackCells(s: BattleState, u: Unit, t: Unit, r: Reach = reachOf(s, u)): number[] {
  const tc = cellsOf(t);
  const out: number[] = [];
  for (let cell = 0; cell < CELLS; cell++) if (r.dist[cell] >= 0 && adjacentCells(cellsAt(u, cell), tc)) out.push(cell);
  return out;
}

export function canShoot(s: BattleState, u: Unit): boolean {
  if (creOf(u).shots === 0 || u.shots <= 0) return false;
  return !s.units.some((e) => e.side !== u.side && e.count > 0 && adjacent(u, e));
}

function rng(s: BattleState): Rng {
  return new Rng(s.rng);
}
function proc(s: BattleState, chance: number): boolean {
  if (s.expect) return false;
  const r = rng(s);
  const hit = r.below(1000) < chance;
  s.rng = r.s;
  return hit;
}

/** Базовый урон отряда: до 10 существ бросаем каждому, больше — 10 бросков в масштабе (DESIGN §4). */
function rollBase(s: BattleState, a: Unit): number {
  const c = creOf(a);
  if (s.expect) return (a.count * (c.dmin + c.dmax)) / 2;
  const r = rng(s);
  const n = Math.min(10, a.count);
  let sum = 0;
  for (let i = 0; i < n; i++) sum += r.int(c.dmin, c.dmax);
  s.rng = r.s;
  return a.count > 10 ? (sum * a.count) / 10 : sum;
}

/** Множитель урона в ‰ (без удачи): +5 % за единицу перевеса до +300 %, −2,5 % за единицу недостачи до −70 %. */
export function damageFactor(s: BattleState, a: Unit, t: Unit, opts: { ranged?: boolean; steps?: number; retal?: boolean } = {}): number {
  const c = creOf(a);
  const diff = attackOf(s, a) - defenseOf(s, t);
  let m = diff >= 0 ? 1000 + Math.min(60, diff) * 50 : 1000 - Math.min(28, -diff) * 25;
  if (hasAb(c, 'antiBig') && hasAb(creOf(t), 'big')) m = Math.trunc((m * 3) / 2);
  if (opts.steps && hasAb(c, 'charge')) m = Math.trunc((m * (100 + opts.steps * 5)) / 100);
  if (opts.steps && c.faction === 'plotina') m = Math.trunc((m * (100 + Math.min(RUSH_MAX, opts.steps * RUSH_PER_STEP))) / 100);
  // «Предки смотрят»: последний живой отряд Курганов бьёт вдвое
  if (c.faction === 'kurgany' && !s.units.some((x) => x !== a && x.side === a.side && x.count > 0)) m *= 2;
  if (opts.ranged) {
    if (!hasAb(c, 'noRangePen') && hexDist(a.cell, t.cell) > 10) m = Math.trunc(m / 2);
  } else if (c.shots > 0 && !hasAb(c, 'noMeleePen')) m = Math.trunc(m / 2);
  const own = s.sides[a.side];
  const skill = opts.ranged ? own.archery : own.offense;
  if (skill) m = Math.trunc((m * (100 + skill)) / 100);
  const armor = s.sides[t.side].armorer;
  if (armor) m = Math.trunc((m * (100 - armor)) / 100);
  return m;
}

/** Оценка удара для подсказки: сколько урона и сколько падёт, без бросков. */
export function damageEstimate(s: BattleState, a: Unit, t: Unit, opts: { ranged?: boolean; steps?: number } = {}): { min: number; max: number; killMin: number; killMax: number } {
  const c = creOf(a);
  const m = damageFactor(s, a, t, opts);
  const hits = hasAb(c, 'strike2') && !opts.ranged ? 2 : 1;
  const min = Math.max(1, Math.trunc((a.count * c.dmin * m) / 1000)) * hits;
  const max = Math.max(1, Math.trunc((a.count * c.dmax * m) / 1000)) * hits;
  const hp = creOf(t).hp;
  const fallen = (d: number): number => (d >= totalHp(t) ? t.count : t.count - (Math.trunc((totalHp(t) - d - 1) / hp) + 1));
  return { min, max, killMin: fallen(min), killMax: fallen(max) };
}

/** Снять здоровье; возвращает, что показать. Павшего убирает из очередей. */
function wound(s: BattleState, t: Unit, dmg: number): HitInfo {
  const hp = creOf(t).hp;
  const before = t.count;
  const total = totalHp(t) - dmg;
  if (total <= 0) {
    t.count = 0;
    t.top = 0;
    s.queue = s.queue.filter((id) => id !== t.id);
    s.waited = s.waited.filter((id) => id !== t.id);
  } else {
    t.count = Math.trunc((total - 1) / hp) + 1;
    t.top = total - (t.count - 1) * hp;
  }
  return { t: t.id, dmg, kills: before - t.count, left: t.count };
}

function addEffect(t: Unit, e: Effect): void {
  // запрет на ход должен пережить конец раунда, если отряд уже сходил
  const n = (e.k === 'stun' || e.k === 'root') && t.acted ? e.n + 1 : e.n;
  const same = t.effects.find((x) => x.k === e.k && (e.k === 'poison' || e.k === 'stun' || e.k === 'root' || e.k === 'hidden' || x.v === e.v));
  if (same) {
    same.v = Math.max(same.v, e.v);
    same.n = Math.max(same.n, n);
    same.grows = same.grows || e.grows;
  } else t.effects.push({ ...e, n });
}

/** Один удар или выстрел со всеми последствиями. */
function strike(s: BattleState, a: Unit, t: Unit, ev: BattleEvent[], o: { ranged?: boolean; steps?: number; retal?: boolean; wall?: boolean }): void {
  const c = creOf(a);
  const base = rollBase(s, a);
  const luck = !s.expect && s.sides[a.side].luck > 0 && proc(s, s.sides[a.side].luck * FORTUNE_PER_POINT);
  const targets = [t];
  if ((o.ranged && hasAb(c, 'aoe')) || (!o.ranged && hasAb(c, 'sweep'))) {
    const around = new Set(cellsOf(t).flatMap((x) => neighbors(x)));
    for (const e of s.units) if (e.side !== a.side && e !== t && canTarget(e) && cellsOf(e).some((x) => around.has(x))) targets.push(e);
  }
  const hits: HitInfo[] = [];
  let dealt = 0;
  for (const x of targets) {
    const m = damageFactor(s, a, x, o);
    // сосед по «Стенке» бьёт вполсилы
    const dmg = Math.max(1, Math.trunc((base * m * (luck ? 2 : 1) * (o.wall ? 1 : 2)) / 2000));
    dealt = x === t ? dmg : dealt;
    hits.push(wound(s, x, dmg));
  }
  ev.push({ e: 'hit', u: a.id, hits, shot: o.ranged, retal: o.retal, luck: luck || undefined });
  for (const x of targets) if (x.count === 0) ev.push({ e: 'die', u: x.id });
  if (t.count > 0) {
    if (hasAb(c, 'poison') && !hasAb(creOf(t), 'machine') && !hasAb(creOf(t), 'ghost')) {
      addEffect(t, { k: 'poison', v: Math.max(1, Math.trunc(dealt / 8)), n: 3 });
      ev.push({ e: 'proc', t: t.id, k: 'poison' });
    }
    if (hasAb(c, 'root') && !o.ranged) {
      addEffect(t, { k: 'root', v: 1, n: 1 });
      ev.push({ e: 'proc', t: t.id, k: 'root' });
    }
    if (hasAb(c, 'blind') && proc(s, CHANCE_PROC)) {
      addEffect(t, { k: 'stun', v: 1, n: 1 });
      ev.push({ e: 'proc', t: t.id, k: 'blind' });
    }
    if (hasAb(c, 'swallow') && totalHp(t) < totalHp(a) && proc(s, CHANCE_PROC)) {
      addEffect(t, { k: 'stun', v: 1, n: 1 });
      addEffect(t, { k: 'hidden', v: 1, n: 1 });
      ev.push({ e: 'proc', t: t.id, k: 'swallow' });
    }
    if (o.ranged && hasAb(c, 'pull')) pull(s, a, t, ev);
  }
  if (hasAb(c, 'steal') && !o.ranged && !o.retal) {
    const loot = s.loot ?? [0, 0];
    loot[a.side] += a.count * STEAL_PER;
    s.loot = loot;
    ev.push({ e: 'proc', t: a.id, k: 'steal' });
  }
}

/** Гарпун: цель (не большая, не на корню) подтягивается на гекс к стрелку, если там свободно. */
function pull(s: BattleState, a: Unit, t: Unit, ev: BattleEvent[]): void {
  const ct = creOf(t);
  if (hasAb(ct, 'big') || hasAb(ct, 'still') || isRooted(t) || t.count === 0) return;
  const occ = occupancy(s, t.side);
  const d0 = hexDist(t.cell, a.cell);
  const to = neighbors(t.cell).find((n) => occ[n] === -1 && hexDist(n, a.cell) < d0 && hexDist(n, a.cell) >= 1);
  if (to === undefined) return;
  ev.push({ e: 'move', u: t.id, path: [t.cell, to] });
  t.cell = to;
  ev.push({ e: 'proc', t: t.id, k: 'pull' });
}

/** Может ли отряд ответить на удар сейчас. */
const canRetal = (u: Unit): boolean => u.count > 0 && !hasEffect(u, 'stun') && (!u.retaled || hasAb(creOf(u), 'manyRetal'));
/** Пехота Затулья стоит «стенкой»: не стрелки, не летуны и не большие. */
const isWallInfantry = (u: Unit): boolean => {
  const c = creOf(u);
  return c.faction === 'zatulye' && c.shots === 0 && !hasAb(c, 'fly') && !hasAb(c, 'big');
};

function melee(s: BattleState, a: Unit, t: Unit, steps: number, ev: BattleEvent[]): void {
  const c = creOf(a);
  const responders: Unit[] = [];
  if (!hasAb(c, 'noRetal')) {
    if (canRetal(t)) responders.push(t);
    // «Стенка»: сосед цели, который сам достаёт ударившего, отвечает вместе с ней
    if (isWallInfantry(t)) {
      const n = s.units.find((x) => x !== t && x.side === t.side && isWallInfantry(x) && canRetal(x) && adjacent(x, t) && adjacent(x, a));
      if (n) responders.push(n);
    }
  }
  strike(s, a, t, ev, { steps });
  for (const r of responders) {
    if (r.count === 0 || a.count === 0 || s.over) continue;
    r.retaled = true;
    strike(s, r, a, ev, { retal: true, wall: r !== t });
  }
  if (a.count > 0 && t.count > 0 && hasAb(c, 'strike2')) strike(s, a, t, ev, { steps });
  // в туман — через раз: иначе змея вообще нельзя было бы ударить
  if (a.count > 0 && hasAb(c, 'mist') && !a.misted) {
    addEffect(a, { k: 'hidden', v: 1, n: 2 });
    a.misted = true;
    ev.push({ e: 'proc', t: a.id, k: 'mist' });
  } else a.misted = false;
}

/** Сила магии с учётом «Созвездий» Академии. */
export function spellPower(s: BattleState, side: number, sp: SpellDef): number {
  const h = s.sides[side];
  return h.power + (h.schools?.[sp.school] ?? 0) + (h.faction === 'akademiya' && s.sky[s.round % s.sky.length] === sp.school ? 3 : 0);
}

export function spellError(s: BattleState, side: number, spell: string, cell: number): string | null {
  const h = s.sides[side];
  const sp = SPELLS[spell];
  if (!sp || !h.spells.includes(spell)) return 'нет такого заклинания';
  if (h.cast) return 'герой уже колдовал в этом раунде';
  if (h.mana < sp.mana) return 'мало маны';
  if (cell < 0 || cell >= CELLS) return 'нет такой клетки';
  if (sp.kind === 'aoe') return null;
  const t = unitAt(s, cell);
  if (!t || isHidden(t)) return 'нет цели';
  const foe = t.side !== side;
  if (sp.kind === 'heal' || sp.kind === 'buff') {
    if (foe) return 'только на своих';
    if (sp.kind === 'heal' && hasAb(creOf(t), 'machine')) return 'механизмы магия не лечит';
    return null;
  }
  return foe ? null : 'только на врагов';
}

function restore(t: Unit, amount: number): number {
  const c = creOf(t);
  const total = Math.min(t.start * c.hp, totalHp(t) + amount);
  t.count = Math.trunc((total - 1) / c.hp) + 1;
  t.top = total - (t.count - 1) * c.hp;
  return t.count;
}

function castSpell(s: BattleState, side: number, spell: string, cell: number, ev: BattleEvent[]): void {
  const h = s.sides[side];
  const sp = SPELLS[spell];
  const power = spellPower(s, side, sp);
  h.mana -= sp.mana;
  h.cast = true;
  const amount = sp.kind === 'damage' || sp.kind === 'aoe' ? Math.trunc(((sp.base + sp.perPower * power) * (100 + (h.sorcery ?? 0))) / 100) : sp.base + sp.perPower * power;
  const foeResist = s.sides[1 - side].resist ?? 0;
  const hits: HitInfo[] = [];
  const heals: { t: number; left: number }[] = [];
  const marks: number[] = [];
  const dead: Unit[] = [];
  const hurt = (t: Unit): void => {
    const dmg = hasAb(creOf(t), 'spellRes') ? Math.trunc(amount / 2) : amount;
    hits.push(wound(s, t, Math.max(1, Math.trunc((dmg * (100 - foeResist)) / 100))));
    if (t.count === 0) dead.push(t);
  };
  const t = unitAt(s, cell);
  switch (sp.kind) {
    case 'damage':
      hurt(t!);
      break;
    case 'aoe': {
      const area = new Set([cell, ...neighbors(cell)]);
      for (const u of s.units) if (u.side !== side && canTarget(u) && cellsOf(u).some((x) => area.has(x))) hurt(u);
      break;
    }
    case 'heal':
      t!.effects = t!.effects.filter((e) => !(e.v < 0 || e.k === 'poison'));
      heals.push({ t: t!.id, left: restore(t!, amount) });
      break;
    case 'stun':
      addEffect(t!, { k: 'stun', v: 1, n: 1 });
      marks.push(t!.id);
      break;
    default: {
      const rounds = (sp.rounds ?? 1) + Math.trunc(power / 3);
      // проклятия Затонья душат: растут, пока цель стоит (DESIGN §5.2)
      addEffect(t!, { k: sp.stat!, v: sp.base, n: rounds, grows: sp.kind === 'curse' && h.faction === 'zatonye' });
      marks.push(t!.id);
    }
  }
  ev.push({ e: 'spell', side, spell, cell, hits, heals, marks });
  for (const d of dead) ev.push({ e: 'die', u: d.id });
}

export function aidError(s: BattleState, u: Unit, target: number): string | null {
  const c = creOf(u);
  const t = s.units[target];
  if (!t || t.count === 0 || u.aid <= 0) return 'нельзя';
  if (hasAb(c, 'curseCast')) return t.side !== u.side && !isHidden(t) ? null : 'нужен враг';
  if (t.side !== u.side) return 'нужен свой';
  if (hasAb(c, 'heal')) {
    if (hasAb(creOf(t), 'machine')) return 'механизмы не лечатся';
  } else if (hasAb(c, 'repair')) {
    if (!hasAb(creOf(t), 'machine')) return 'чинит только механизмы';
  } else return 'не умеет';
  return totalHp(t) < t.start * creOf(t).hp || t.effects.some((e) => e.v < 0 || e.k === 'poison') ? null : 'цель цела';
}

const finish = (s: BattleState, winner: number, ev: BattleEvent[], why?: 'flee' | 'rounds'): void => {
  s.over = true;
  s.winner = winner;
  s.current = -1;
  s.queue = [];
  s.waited = [];
  ev.push({ e: 'over', winner, why });
};

function checkOver(s: BattleState, ev: BattleEvent[]): boolean {
  if (s.over) return true;
  const a = s.units.some((u) => u.side === 0 && u.count > 0);
  const b = s.units.some((u) => u.side === 1 && u.count > 0);
  if (a && b) return false;
  finish(s, a ? 0 : b ? 1 : -1, ev);
  return true;
}

function makeQueue(s: BattleState): number[] {
  const first = s.round % 2;
  return alive(s)
    .sort((a, b) => speedOf(s, b) - speedOf(s, a) || (a.side === b.side ? a.id - b.id : a.side === first ? -1 : 1))
    .map((u) => u.id);
}

function startRound(s: BattleState, ev: BattleEvent[]): void {
  if (s.round >= MAX_ROUNDS) {
    const a = sideValue(s, 0);
    const b = sideValue(s, 1);
    return finish(s, a === b ? -1 : a > b ? 0 : 1, ev, 'rounds');
  }
  s.round++;
  s.sides[0].cast = false;
  s.sides[1].cast = false;
  ev.push({ e: 'round', n: s.round });
  for (const u of s.units) {
    if (u.count === 0) continue;
    u.acted = false;
    u.waited = false;
    u.retaled = false;
    u.moraled = false;
    const poison = u.effects.find((e) => e.k === 'poison');
    if (poison) {
      const h = wound(s, u, poison.v);
      ev.push({ e: 'poison', t: u.id, dmg: h.dmg, left: h.left });
      if (u.count === 0) ev.push({ e: 'die', u: u.id });
    }
  }
  storm(s, ev);
  siegeRound(s, ev);
  if (checkOver(s, ev)) return;
  s.queue = makeQueue(s);
  s.waited = [];
}

/** «Буря» Плотины: каждый 3-й раунд чужие летуны теряют скорость до конца раунда. Плотина с обеих сторон — бури нет. */
function storm(s: BattleState, ev: BattleEvent[]): void {
  if (s.round % 3 !== 0) return;
  const p = s.sides.map((h) => h.faction === 'plotina');
  if (p[0] === p[1]) return;
  const foe = p[0] ? 1 : 0;
  for (const u of s.units) {
    if (u.side !== foe || u.count === 0 || !hasAb(creOf(u), 'fly')) continue;
    u.effects.push({ k: 'speed', v: -STORM_SPEED, n: 1 });
    ev.push({ e: 'proc', t: u.id, k: 'storm' });
  }
}

/** Начало раунда в осаде: таран бьёт ворота, затем стену рядом; башни стреляют по самому сильному. Без бросков: одинаково и в расчёте бота. */
function siegeRound(s: BattleState, ev: BattleEvent[]): void {
  if (!s.walls) return;
  const gate = s.walls.find((w) => w.gate && w.hp > 0);
  const seg = gate ?? s.walls.filter((w) => w.hp > 0 && !w.tower).sort((a, b) => Math.abs(cellY(a.cell) - GATE_ROW) - Math.abs(cellY(b.cell) - GATE_ROW))[0];
  if (seg) {
    seg.hp--;
    ev.push({ e: 'wall', cell: seg.cell, hp: seg.hp });
  }
  for (let i = 0; i < (s.towers ?? 0); i++) {
    const foes = s.units.filter((u) => u.side === 0 && u.count > 0 && !isHidden(u));
    if (!foes.length) break;
    const t = foes.reduce((a, b) => (unitValue(b) > unitValue(a) ? b : a));
    const h = wound(s, t, 30 + (s.fort ?? 1) * 15);
    ev.push({ e: 'tower', t: t.id, dmg: h.dmg, left: h.left });
    if (t.count === 0) ev.push({ e: 'die', u: t.id });
  }
}

function endRound(s: BattleState): void {
  for (const u of s.units) {
    if (u.count === 0) continue;
    for (const e of u.effects) {
      if (e.grows && !u.moved && e.v < 0) e.v--;
      e.n--;
    }
    u.effects = u.effects.filter((e) => e.n > 0);
    u.moved = false;
  }
}

/** Мораль отряда: механизмам и духам её нет; у Курганов потерявший половину не дрогнет и получает +1. */
function moraleOf(s: BattleState, u: Unit): number {
  const c = creOf(u);
  if (hasAb(c, 'machine') || hasAb(c, 'ghost')) return 0;
  const m = s.sides[u.side].morale;
  if (c.faction === 'kurgany' && u.count * 2 < u.start) return Math.max(0, m) + 1;
  return m;
}

/** Следующий отряд: очередь, потом выждавшие (самый медленный — первым), потом новый раунд. */
function nextTurn(s: BattleState, ev: BattleEvent[]): void {
  for (;;) {
    if (s.over) return;
    if (!s.queue.length) {
      if (s.waited.length) {
        s.queue = s.waited;
        s.waited = [];
      } else {
        endRound(s);
        startRound(s, ev);
        continue;
      }
    }
    const id = s.queue.shift()!;
    const u = s.units[id];
    if (u.count === 0) continue;
    u.defending = false;
    u.effects = u.effects.filter((e) => e.k !== 'hidden');
    if (hasEffect(u, 'stun')) {
      u.effects = u.effects.filter((e) => e.k !== 'stun');
      u.acted = true;
      ev.push({ e: 'skip', u: id, why: 'stun' });
      continue;
    }
    const morale = moraleOf(s, u);
    if (morale < 0 && proc(s, -morale * FORTUNE_PER_POINT)) {
      u.acted = true;
      ev.push({ e: 'skip', u: id, why: 'morale' });
      continue;
    }
    s.current = id;
    ev.push({ e: 'turn', u: id });
    return;
  }
}

/** Отряд закончил действие: боевой дух может дать ещё один ход, раз за раунд. */
function endTurn(s: BattleState, u: Unit, ev: BattleEvent[]): void {
  if (checkOver(s, ev)) return;
  u.acted = true;
  const morale = moraleOf(s, u);
  if (u.count > 0 && !u.moraled && morale > 0 && proc(s, morale * FORTUNE_PER_POINT)) {
    u.moraled = true;
    ev.push({ e: 'morale', u: u.id });
    ev.push({ e: 'turn', u: u.id });
    return;
  }
  nextTurn(s, ev);
}

/** Что не так с действием; null — можно. */
export function actionError(s: BattleState, a: Action): string | null {
  if (s.over) return 'бой окончен';
  const u = currentUnit(s);
  if (!u) return 'нет хода';
  switch (a.t) {
    case 'flee':
    case 'defend':
      return null;
    case 'wait':
      return u.waited ? 'уже ждал' : null;
    case 'move': {
      if (a.to === u.cell) return 'уже здесь';
      return a.to >= 0 && a.to < CELLS && reachOf(s, u).dist[a.to] > 0 ? null : 'не дойти';
    }
    case 'attack': {
      const t = s.units[a.target];
      if (!t || t.side === u.side || !canTarget(t)) return 'нет цели';
      if (a.from < 0 || a.from >= CELLS || reachOf(s, u).dist[a.from] < 0) return 'не дойти';
      return adjacentCells(cellsAt(u, a.from), cellsOf(t)) ? null : 'не достать';
    }
    case 'shoot': {
      const t = s.units[a.target];
      if (!t || t.side === u.side || !canTarget(t)) return 'нет цели';
      return canShoot(s, u) ? null : 'не может стрелять';
    }
    case 'aid':
      return aidError(s, u, a.target);
    case 'cast':
      return spellError(s, u.side, a.spell, a.cell);
  }
}

/** Применить действие. Незаконное — ошибка программы: сеть и интерфейс сперва спрашивают actionError. */
export function act(s: BattleState, a: Action): BattleEvent[] {
  const err = actionError(s, a);
  if (err) throw new Error(`Бой: ${a.t} — ${err}`);
  const u = currentUnit(s)!;
  const ev: BattleEvent[] = [];
  const stepTo = (to: number): number => {
    if (to === u.cell) return 0;
    const r = reachOf(s, u);
    let path = pathTo(r, u.cell, to);
    // «Подлянка»: чужой, ступивший на ловушку, встаёт на ней и пропускает следующий ход; летуны её не задевают
    const trap = s.trap;
    let caught = false;
    if (trap && trap.owner !== u.side && !hasAb(creOf(u), 'fly')) {
      const i = path.indexOf(trap.cell);
      const occ = occupancy(s, u.side);
      if (i > 0 && (occ[trap.cell] === -1 || occ[trap.cell] === u.id) && (!hasAb(creOf(u), 'big') || fitsBig(u.side, trap.cell))) {
        path = path.slice(0, i + 1);
        caught = true;
      }
    }
    const dest = path[path.length - 1];
    ev.push({ e: 'move', u: u.id, path });
    u.cell = dest;
    u.moved = true;
    if (caught) {
      s.trap = undefined;
      // ход уже идёт: запрет должен пережить конец этого раунда
      addEffect(u, { k: 'stun', v: 1, n: 2 });
      ev.push({ e: 'proc', t: u.id, k: 'trap' });
      return -1;
    }
    return r.dist[dest];
  };
  switch (a.t) {
    case 'flee':
      finish(s, 1 - u.side, ev, 'flee');
      return ev;
    case 'defend':
      u.defending = true;
      ev.push({ e: 'defend', u: u.id });
      break;
    case 'wait':
      u.waited = true;
      s.waited.unshift(u.id);
      ev.push({ e: 'wait', u: u.id });
      nextTurn(s, ev);
      return ev;
    case 'move':
      stepTo(a.to);
      break;
    case 'attack': {
      const steps = stepTo(a.from);
      // попал в ловушку по пути — до цели не дошёл
      if (steps >= 0) melee(s, u, s.units[a.target], steps, ev);
      break;
    }
    case 'shoot':
      u.shots--;
      strike(s, u, s.units[a.target], ev, { ranged: true });
      break;
    case 'aid': {
      const t = s.units[a.target];
      const c = creOf(u);
      u.aid--;
      if (hasAb(c, 'curseCast')) {
        addEffect(t, { k: 'speed', v: -2, n: 2, grows: true });
        ev.push({ e: 'aid', u: u.id, t: t.id, left: t.count, curse: true });
      } else {
        t.effects = t.effects.filter((e) => !(e.v < 0 || e.k === 'poison'));
        ev.push({ e: 'aid', u: u.id, t: t.id, left: restore(t, Math.trunc((u.count * c.dmax * 3) / 2)) });
      }
      break;
    }
    case 'cast':
      castSpell(s, u.side, a.spell, a.cell, ev);
      // заклинание — не ход отряда
      checkOver(s, ev);
      if (u.count === 0 && !s.over) nextTurn(s, ev);
      return ev;
  }
  endTurn(s, u, ev);
  return ev;
}

/** Сдача в любой момент (сеть: кнопка, долгое отсутствие). */
export function resign(s: BattleState, side: number): BattleEvent[] {
  if (s.over) return [];
  const ev: BattleEvent[] = [];
  finish(s, 1 - side, ev, 'flee');
  return ev;
}

/** Ряды расстановки при N отрядах. */
const ROWS: number[][] = [[], [5], [3, 7], [2, 5, 8], [1, 4, 6, 9], [0, 3, 5, 7, 10], [0, 2, 4, 6, 8, 10], [0, 2, 4, 5, 6, 8, 10]];

function connected(blocked: Set<number>): boolean {
  const seen = new Set<number>();
  const front: number[] = [];
  for (let y = 0; y < FIELD_H; y++) front.push(cellOf(0, y));
  for (let i = 0; i < front.length; i++) {
    const at = front[i];
    if (seen.has(at) || blocked.has(at)) continue;
    seen.add(at);
    if (cellX(at) === FIELD_W - 1) return true;
    front.push(...neighbors(at));
  }
  return false;
}

function makeHero(setup: SideSetup): HeroState {
  if (!setup.hero) {
    const f = setup.army[0] ? CREATURES[setup.army[0].cre].faction : 'neutral';
    return { pick: null, label: setup.label, faction: f, atk: 0, def: 0, power: 0, know: 0, mana: 0, morale: 0, luck: 0, spells: [], cast: false, ...setup.stats };
  }
  const cls = classOf(setup.hero.cls);
  if (setup.stats) return { pick: setup.hero, faction: cls.faction, cast: false, ...setup.stats };
  return {
    pick: setup.hero, faction: cls.faction, atk: cls.atk, def: cls.def, power: cls.power, know: cls.know, mana: cls.know * 10,
    morale: cls.atk >= 5 ? 2 : 1, luck: cls.power >= 5 ? 2 : 1, spells: cls.spells, cast: false,
  };
}

export function createBattle(setup: BattleSetup): BattleState {
  const r = new Rng(setup.seed);
  const sides: [HeroState, HeroState] = [makeHero(setup.sides[0]), makeHero(setup.sides[1])];
  const units: Unit[] = [];
  setup.sides.forEach((sd, side) => {
    const rows = ROWS[Math.min(7, sd.army.length)];
    sd.army.slice(0, 7).forEach((st, i) => {
      const c = CREATURES[st.cre];
      if (!c) throw new Error(`Нет существа ${st.cre}`);
      const big = hasAb(c, 'big');
      const x = side === 0 ? (big ? 1 : 0) : big ? FIELD_W - 2 : FIELD_W - 1;
      units.push({
        id: units.length, side: side as 0 | 1, cre: st.cre, cell: cellOf(x, rows[i]), count: st.count, start: st.count, top: c.hp, shots: c.shots, aid: AID_USES,
        retaled: false, acted: false, waited: false, defending: false, moraled: false, moved: false, effects: [],
        ...(st.rank ? { rank: Math.max(0, Math.min(RANK_MAX, Math.trunc(st.rank))) } : {}),
      });
    });
  });
  // препятствия — зеркально, середина поля; проход слева направо есть всегда
  let obstacles: { cell: number; art: number }[] = [];
  for (let tries = 0; tries < 50; tries++) {
    const list: { cell: number; art: number }[] = [];
    const n = r.int(2, 4);
    for (let i = 0; i < n; i++) {
      const c = cellOf(r.int(3, 6), r.int(0, FIELD_H - 1));
      if (list.some((o) => o.cell === c)) continue;
      const art = r.int(1, 10);
      list.push({ cell: c, art });
      // в осаде правый край занят стеной: камни только перед ней
      if (!setup.siege) list.push({ cell: mirrorCell(c), art });
    }
    if (connected(new Set(list.map((o) => o.cell)))) {
      obstacles = list;
      break;
    }
  }
  // «Трясина» Затонья: 4–6 гексов топи; если Затонье с обеих сторон, топь обе обходит стороной
  const zat = sides.map((h) => h.faction === 'zatonye');
  const bogOwner = zat[0] === zat[1] ? -1 : zat[0] ? 0 : 1;
  const bog: number[] = [];
  if (bogOwner >= 0) {
    const n = r.int(2, 3);
    while (bog.length < n * 2) {
      const c = cellOf(r.int(3, 6), r.int(0, FIELD_H - 1));
      if (bog.includes(c) || obstacles.some((o) => o.cell === c)) continue;
      bog.push(c, setup.siege ? cellOf(r.int(3, 6), r.int(0, FIELD_H - 1)) : mirrorCell(c));
    }
  }
  const sky: School[] = [];
  for (let i = 0; i < 16; i++) sky.push(SKY[r.below(4)]);
  const s: BattleState = {
    seed: setup.seed, rng: r.s, round: 0, field: setup.field, sides, units, queue: [], waited: [], current: -1, obstacles, bog, bogOwner, sky, over: false, winner: -1,
  };
  // «Подлянка» Базара: ловушка на чужой половине середины поля; Базар с обеих сторон — ловушек нет
  const bz = sides.map((h) => h.faction === 'bazar');
  if (bz[0] !== bz[1]) {
    const owner = bz[0] ? 0 : 1;
    for (let i = 0; i < 40; i++) {
      const x = owner === 0 ? r.int(6, 9) : r.int(3, 6);
      const c = cellOf(Math.min(FIELD_W - 2, x), r.int(1, FIELD_H - 2));
      if (obstacles.some((o) => o.cell === c) || bog.includes(c)) continue;
      s.trap = { cell: c, owner };
      break;
    }
  }
  if (setup.siege) {
    s.fort = setup.siege;
    s.siegeFaction = setup.siegeFaction;
    s.towers = setup.siege - 1;
    s.walls = [];
    for (let y = 0; y < FIELD_H; y++) {
      const gate = y === GATE_ROW;
      // крепость — одна башня, твердыня — две
      const tower = setup.siege >= 2 && (y === TOWER_ROWS[1] || (setup.siege >= 3 && y === TOWER_ROWS[0]));
      s.walls.push({ cell: cellOf(WALL_X, y), hp: gate ? 1 + setup.siege : tower ? 99 : 2, gate, tower: tower || undefined });
    }
  }
  const ev: BattleEvent[] = [];
  startRound(s, ev);
  nextTurn(s, ev);
  return s;
}

/** Копия для расчётов бота; rng и списки свои, неизменное — общее. */
export function cloneBattle(s: BattleState): BattleState {
  return {
    ...s,
    sides: [{ ...s.sides[0] }, { ...s.sides[1] }],
    units: s.units.map((u) => ({ ...u, effects: u.effects.map((e) => ({ ...e })) })),
    queue: [...s.queue],
    waited: [...s.waited],
    walls: s.walls?.map((w) => ({ ...w })),
    trap: s.trap ? { ...s.trap } : undefined,
    loot: s.loot ? [...s.loot] : undefined,
  };
}

/** Какая школа сильнее у Академии в раунде n: небо видно вперёд. */
export const skyAt = (s: BattleState, round: number): School => s.sky[round % s.sky.length];
