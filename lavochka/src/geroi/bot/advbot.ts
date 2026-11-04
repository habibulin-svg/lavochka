/* ИИ карты приключений (DESIGN.md §12, этап 5). Бот ходит теми же действиями, что человек (`act`), и видит только свой туман:
 * объекты и города — на открытых клетках, чужие герои — если не спрятаны. Один вызов — одно действие; память хода (`BotMem`) — чистый JSON,
 * её возит Web Worker вместе с миром.
 * Лёгкий — один герой, цели с шумом, нанимает половину, строит что попало, рискует в боях. Средний — два героя, порядок построек, осторожен.
 * Сложный — три героя, порядок построек с рынком под нехватку, точнее меряет силу, защищает замок и раньше идёт на соперника. */
import { Rng } from '../../gops/sim/rng';
import { CREATURES } from '../sim/creatures';
import { classOf } from '../sim/heroes';
import { travel } from '../sim/adv/fair';
import { FACTION_RES, RES, RES_VALUE, MINE_INCOME, type ResId, WATER } from '../sim/adv/data';
import { type AdvHero, ARMY_SLOTS, armyPower, heroAtk, heroDef, heroMaxMana, heroMaxMp, skillLevel } from '../sim/adv/hero';
import { type Town, type TownFaction, buildCost, buildError, buildingDef, creaturePrice, fortLevel, has, isCast, townCreature } from '../sim/adv/town';
import {
  type AdvAction, type ArmyRef, type BattleSide, battleSetup, HERO_COST, MAX_HEROES, type MapObject, type World, actionError, defOf, guardOf, heroHiddenFrom, neighbors, playerHeroes, playerTowns, reachOf, stepCost, xOf, yOf,
} from '../sim/adv/world';
import { act as battleAct, createBattle } from '../sim/battle';
import { type BotLevel, botAction } from './bot';

export interface BotMem {
  /** День и игрок, к которым относится память: новый ход — новая память. */
  key: string;
  /** Герои, которым на этот ход больше некуда идти. */
  skip: number[];
  /** Последний ход героем: тот же ход с той же клетки — значит, застрял. */
  last: { hero: number; cell: number; mp: number; to: number } | null;
  /** Что уже решено за этот ход: `b<город>` — стройка, `r<город>` — найм у Лёгкого. */
  done: string[];
  /** Разыгранные на копии бои: ключ — герой, цель и силы сторон. */
  fights: Record<string, boolean>;
}

export const newMem = (): BotMem => ({ key: '', skip: [], last: null, done: [], fights: {} });

interface Tune {
  heroes: number;
  /** Во сколько раз своя сила должна превышать чужую, чтобы лезть в бой. */
  risk: number;
  /** Доля найма из доступного. */
  hire: number;
  noise: number;
  /** С какого дня идти на чужой замок при перевесе. */
  attackDay: number;
}
const TUNE: Record<BotLevel, Tune> = {
  easy: { heroes: 1, risk: 1.05, hire: 0.5, noise: 0.9, attackDay: 40 },
  medium: { heroes: 2, risk: 1.5, hire: 1, noise: 0, attackDay: 28 },
  hard: { heroes: 3, risk: 1.3, hire: 1, noise: 0, attackDay: 21 },
};

/** Порядок построек: жилища и доход вперемешку, как ходит опытный игрок. */
const BUILD_ORDER = [
  'hall2', 'dwell2', 'dwell3', 'smithy', 'market', 'guild1', 'dwell4', 'hall3', 'fort2', 'dwell5', 'up1', 'up2', 'up3', 'dwell6', 'skhod', 'furnace', 'lab', 'gat',
  'up4', 'fort3', 'dwell7', 'up5', 'storehouse', 'up6', 'guild2', 'hall4', 'up7', 'guild3', 'fogwell', 'scrapyard', 'observatory',
];
const SKILL_ORDER = [
  'logistics', 'offense', 'armorer', 'archery', 'leadership', 'tactics', 'luck', 'pathfinding', 'wisdom', 'earth', 'air', 'fire', 'water', 'sorcery', 'resistance',
  'estates', 'firstaid', 'learning', 'scouting', 'mysticism', 'diplomacy', 'scholar', 'navigation', 'eagle',
];

/** Сила героя с армией: цифры героя дают по 5 % за очко атаки и защиты. */
export function heroPower(h: AdvHero): number {
  return (armyPower(h.army) * (100 + 5 * (heroAtk(h) + heroDef(h)))) / 100;
}
function townPower(t: Town): number {
  const f = fortLevel(t);
  return (armyPower(t.garrison) * (100 + 25 * f + (has(t, 'smithy') ? 10 : 0))) / 100;
}


/** Что даст объект герою: в семках. 0 — незачем идти. */
function objValue(w: World, h: AdvHero, o: MapObject, me: number): number {
  const fx = defOf(o).effect;
  const week = Math.trunc(w.day / 7);
  switch (fx.t) {
    case 'pile':
      return (o.n ?? fx.min) * RES_VALUE[fx.res];
    case 'chest':
      return o.n ?? 1500;
    case 'campfire':
      return (o.n ?? 500) + 1500;
    case 'artifact':
      return 2500;
    case 'mine':
      return o.owner === me ? 0 : MINE_INCOME[fx.res] * RES_VALUE[fx.res] * 8;
    case 'mill':
      return o.week === week ? 0 : fx.n * RES_VALUE[fx.res];
    case 'shrine':
      return o.spell && !h.spells.includes(o.spell) ? (fx.level === 3 && !skillLevel(h, 'wisdom') ? 0 : 800 * fx.level) : 0;
    case 'stat':
    case 'xp':
      return h.visited.includes(o.id) ? 0 : 1800;
    case 'well':
      return h.wellDay !== w.day && h.mana * 2 < heroMaxMana(h) ? 400 : 0;
    case 'fountain':
      return h.luckNext ? 0 : 200;
    case 'stables':
      return h.stabled ? 0 : 500;
    case 'prison':
      return o.captive && playerHeroes(w, me).length < MAX_HEROES ? 4000 : 0;
    case 'obelisk':
      return w.players[me].obelisks.includes(o.id) ? 0 : 300;
    case 'treasury':
      return o.week === -2 ? 0 : 6000;
    case 'dwelling':
      if (o.owner !== me) return 1500;
      return (o.n ?? 0) > 0 ? Math.min(w.players[me].res.semki, (o.n ?? 0) * CREATURES[fx.cre].cost) : 0;
    case 'garrison':
      return o.owner === me ? 0 : 1000;
    case 'stack':
      return 300;
    default:
      return 0;
  }
}

/** Сила охраны объекта, или 0. */
function guardPower(o: MapObject, me: number): number {
  if (!o.army || o.owner === me) return 0;
  return armyPower(o.army);
}

const cheb = (w: World, a: number, b: number): number => Math.max(Math.abs(xOf(w, a) - xOf(w, b)), Math.abs(yOf(w, a) - yOf(w, b)));

/** Цель героя: клетка и её оценка. */
interface Target {
  cell: number;
  score: number;
}

interface Cand {
  cell: number;
  score: number;
  fight?: BattleSide;
  foe: number;
}

/** Бой на копии: средний урон, Средние боты. Ответ — победа и доля потерянной силы. */
function simFight(w: World, h: AdvHero, def: BattleSide): { won: boolean; loss: number } {
  const copy: World = { ...w, pending: { t: 'battle', hero: h.id, def, seed: 7 } };
  const s = createBattle(battleSetup(copy).setup);
  s.expect = true;
  for (let i = 0; i < 4000 && !s.over; i++) battleAct(s, botAction(s, 'medium'));
  const before = armyPower(h.army);
  let after = 0;
  for (const u of s.units) if (u.side === 0 && u.count > 0) after += CREATURES[u.cre].power * u.count;
  return { won: s.over && s.winner === 0, loss: before ? 1 - after / before : 1 };
}

function pickTarget(w: World, h: AdvHero, level: BotLevel, main: boolean, rng: Rng, mem: BotMem): Target | null {
  const me = h.owner;
  const p = w.players[me];
  const tune = TUNE[level];
  const r = reachOf(w, h);
  const mine = heroPower(h);
  const list: Cand[] = [];
  const consider = (cell: number, value: number, fight?: BattleSide, foe = 0): void => {
    const d = r.dist[cell];
    if (d <= 0 || value <= 0) return;
    // клетку стережёт отряд: дойти — значит драться с ним
    const g = guardOf(w, cell);
    if (g && !fight && g.owner !== me) {
      fight = { k: 'obj', id: g.id };
      foe = guardPower(g, me);
    }
    let score = (value * 1000) / (d + 400);
    if (tune.noise) score *= 1 - tune.noise / 2 + rng.f() * tune.noise;
    list.push({ cell, score, fight, foe });
  };
  const threat = enemyThreat(w, me);
  // объекты и нейтралы
  for (const o of w.objects) {
    if (!p.explored[o.cell]) continue;
    const foe = guardPower(o, me);
    let v = objValue(w, h, o, me);
    if (o.kind === 'stack') {
      // отряд стережёт то, что рядом: польза — от соседей
      for (const x of w.objects) if (x !== o && x.kind !== 'stack' && cheb(w, x.cell, o.cell) <= 2) v += objValue(w, h, x, me) / 2;
      v += Math.trunc(foe / 4);
    }
    consider(o.cell, v, foe > 0 ? { k: 'obj', id: o.id } : undefined, foe);
  }
  // города: свои — забрать гарнизон или защитить, чужие — взять
  for (const t of w.towns) {
    // к дню наступления разведка «знает», где чужие замки (решение: иначе за туманом и охраной партия не кончается)
    if (!p.explored[t.cell] && !(t.owner !== me && w.day >= tune.attackDay)) continue;
    if (t.owner === me) {
      const g = armyPower(t.garrison);
      let v = g > 0 && (main || g > heroPower(h)) ? g + 300 : 0;
      if (main && threat.has(t.id)) v += 12000;
      consider(t.cell, v);
    } else {
      const foe = townPower(t);
      const early = w.day < tune.attackDay && foe > 0;
      consider(t.cell, (t.owner < 0 ? 8000 : 25000) / (early ? 3 : 1), foe > 0 ? { k: 'town', id: t.id } : undefined, foe);
    }
  }
  // чужие герои: бить, если по силам
  for (const e of w.heroes) {
    if (e.owner === me || !p.explored[e.cell] || heroHiddenFrom(w, e, me)) continue;
    consider(e.cell, 5000 + heroPower(e) / 4, { k: 'hero', id: e.id }, heroPower(e));
  }
  // вода: чужой замок по суше не достать — главный герой садится в лодку, а с лодки высаживается поближе к нему
  const known = knownTowns(w, me, level);
  if (main && wantsBoat(w, h, r, level)) {
    const boats = w.objects.filter((o) => o.kind === 'boat' && p.explored[o.cell] && r.dist[o.cell] > 0);
    for (const o of boats) consider(o.cell, 4000);
    // своей лодки нет — к верфи, там купим
    if (!boats.length) for (const o of w.objects) if (o.kind === 'shipyard' && p.explored[o.cell]) consider(o.cell, 3500);
  }
  const sailing = h.boat && known.length > 0;
  if (sailing) {
    // высаживаться туда, откуда до чужого замка дойти пешком, и чем ближе пешком — тем лучше
    const n = w.w * w.h;
    const faction = classOf(h.pick.cls).faction as TownFaction;
    const walks = known.map((t) => travel(w, t.cell, faction, false));
    for (let c = 0; c < n; c++) {
      if (r.dist[c] <= 0 || w.terrain[c] === WATER) continue;
      let best = -1;
      for (const d of walks) if (d[c] >= 0 && (best < 0 || d[c] < best)) best = d[c];
      if (best >= 0) consider(c, 40000000 / (best + 1500));
    }
  }
  // разведка: открытая клетка у края тумана (в лодке к врагу — не отвлекаемся)
  const n = sailing ? 0 : w.w * w.h;
  const step = level === 'hard' ? 1 : 2;
  for (let c = 0; c < n; c += step) {
    if (!p.explored[c] || r.dist[c] <= 0 || w.terrain[c] === WATER) continue;
    let dark = 0;
    for (const nb of neighbors(w, c)) if (!p.explored[nb]) dark++;
    if (dark) consider(c, 120 + dark * 30);
  }
  list.sort((x, y) => y.score - x.score);
  // Средний и Сложный терпят потери: главный — до половины (Сложный — до трети), разведчик почти без потерь
  const limit = level === 'hard' ? (main ? 0.35 : 0.2) : main ? 0.5 : 0.25;
  for (const c of list) {
    if (!c.fight) return c;
    if (level === 'easy') {
      if (mine >= c.foe * tune.risk) return c;
      continue;
    }
    if (mine < c.foe * 0.6) continue;
    if (mine >= c.foe * 6) return c;
    const key = `${h.id}:${c.fight.k}${c.fight.id}:${Math.round(mine)}:${Math.round(c.foe)}`;
    let ok = mem.fights[key];
    if (ok === undefined) {
      const f = simFight(w, h, c.fight);
      ok = mem.fights[key] = f.won && f.loss <= limit;
    }
    if (ok) return c;
  }
  return null;
}

/** Чужие города, о которых бот знает: открытые, а с дня наступления — все. */
function knownTowns(w: World, me: number, level: BotLevel): Town[] {
  const p = w.players[me];
  return w.towns.filter((t) => t.owner !== me && (p.explored[t.cell] || w.day >= TUNE[level].attackDay));
}

/** Нужна ли вода: чужие замки известны, а по суше ни до одного не дойти. */
function wantsBoat(w: World, h: AdvHero, r: { dist: Int32Array }, level: BotLevel): boolean {
  if (h.boat || w.day < 10) return false;
  const known = knownTowns(w, h.owner, level);
  return known.length > 0 && !known.some((t) => r.dist[t.cell] > 0);
}

/** Свои города, к которым близко подошёл сильный чужой герой. */
function enemyThreat(w: World, me: number): Set<number> {
  const out = new Set<number>();
  const p = w.players[me];
  for (const t of playerTowns(w, me)) {
    for (const e of w.heroes) {
      if (e.owner === me || !p.explored[e.cell] || heroHiddenFrom(w, e, me)) continue;
      if (cheb(w, e.cell, t.cell) <= 14 && heroPower(e) > townPower(t)) out.add(t.id);
    }
  }
  return out;
}

const refFree = (army: (null | { cre: string })[], cre: string): number => {
  const same = army.findIndex((s) => s?.cre === cre);
  return same >= 0 ? same : army.findIndex((s) => !s);
};

/** Что строить: первое возможное по порядку (Лёгкий — случайное возможное). */
function buildChoice(w: World, t: Town, level: BotLevel, rng: Rng): string | null {
  const ok = (b: string): boolean => !!buildingDef(t, b) && !actionError(w, { t: 'build', town: t.id, b });
  if (level === 'easy') {
    const list = Object.keys(BUILDING_IDS(t)).filter(ok);
    return list.length && rng.below(2) === 0 ? list[rng.below(list.length)] : null;
  }
  let waiting = 0;
  for (const b of BUILD_ORDER) {
    if (!buildingDef(t, b) || has(t, b)) continue;
    if (buildError(t, b)) continue;
    if (ok(b)) return b;
    // Средний копит на одно из трёх ближайших; Сложный берёт любое возможное по порядку
    if (level === 'medium' && ++waiting >= 3) return null;
  }
  return null;
}
const BUILDING_IDS = (t: Town): Record<string, unknown> => Object.fromEntries(BUILD_ORDER.filter((b) => buildingDef(t, b)).map((b) => [b, 1]));

/** Сложный докупает на рынке недостающий ресурс под постройку. */
function marketFor(w: World, t: Town): AdvAction | null {
  const p = w.players[w.current];
  if (!playerTowns(w, w.current).some((x) => has(x, 'market'))) return null;
  for (const b of BUILD_ORDER) {
    if (!buildingDef(t, b) || has(t, b) || buildError(t, b)) continue;
    const cost = buildCost(t, b);
    for (const k of RES) {
      const need = (cost[k] ?? 0) - p.res[k];
      if (need <= 0 || k === 'semki') continue;
      const give: ResId = 'semki';
      const amount = need * RES_VALUE[k] * 2;
      if (p.res.semki - amount < (cost.semki ?? 0) + 1000) return null;
      const a: AdvAction = { t: 'market', give, get: k, amount };
      return actionError(w, a) ? null : a;
    }
    break;
  }
  // запас редких ресурсов фракции: отливка Кузни и дорогие жилища
  if (p.res.semki > 20000) {
    for (const k of FACTION_RES[t.faction]) {
      if (p.res[k] >= 8) continue;
      const a: AdvAction = { t: 'market', give: 'semki', get: k, amount: 8 * RES_VALUE[k] * 2 };
      if (!actionError(w, a)) return a;
    }
  }
  return null;
}

/** Найм в городе: сверху вниз, сколько хватает. */
function recruitChoice(w: World, t: Town, level: BotLevel): AdvAction | null {
  const p = w.players[w.current];
  for (let tier = 7; tier >= 1; tier--) {
    for (const up of [true, false]) {
      const c = townCreature(t, tier, up);
      if (!has(t, up ? `up${tier}` : `dwell${tier}`)) continue;
      // улучшено — берём только улучшенных: место в гарнизоне не бесконечно
      if (!up && has(t, `up${tier}`)) continue;
      let n = isCast(c) ? Math.trunc(t.forge / c.cost) : t.avail[tier - 1];
      if (level === 'easy') n = Math.trunc(n * TUNE.easy.hire);
      const unit = creaturePrice(c, 1);
      for (const k of RES) if (unit[k]) n = Math.min(n, Math.trunc(p.res[k] / unit[k]!));
      // хватит ли на целую пачку: цена у отливаемых не строго линейна
      while (n > 0 && actionError(w, { t: 'recruit', town: t.id, cre: c.id, count: n })) n--;
      if (n > 0) return { t: 'recruit', town: t.id, cre: c.id, count: n };
    }
  }
  return null;
}

function tavernChoice(w: World, towns: Town[]): AdvAction | null {
  for (const t of towns) {
    for (const pick of t.tavern) {
      const a: AdvAction = { t: 'tavern', town: t.id, hero: null, pick };
      if (!actionError(w, a)) return a;
    }
  }
  return null;
}

/** Улучшить отряд в гарнизоне или у своего героя в воротах. */
function upgradeChoice(w: World, t: Town): AdvAction | null {
  const refs: ArmyRef[] = [{ t: t.id }, ...w.heroes.filter((h) => h.owner === t.owner && (h.cell === t.cell || neighbors(w, h.cell).includes(t.cell))).map((h) => ({ h: h.id }))];
  for (const ref of refs) {
    for (let slot = 0; slot < ARMY_SLOTS; slot++) {
      const a: AdvAction = { t: 'upgrade', town: t.id, ref, slot };
      if (!actionError(w, a)) return a;
    }
  }
  return null;
}

/** Главный герой — самый сильный. */
function mainHero(w: World, me: number): AdvHero | null {
  let best: AdvHero | null = null;
  for (const h of playerHeroes(w, me)) if (!best || heroPower(h) > heroPower(best)) best = h;
  return best;
}

/** Следующее действие бота за текущего игрока. */
export function botStep(w: World, level: BotLevel, mem: BotMem): AdvAction {
  const me = w.current;
  const key = `${w.day}:${me}`;
  if (mem.key !== key) {
    mem.key = key;
    mem.skip = [];
    mem.last = null;
    mem.done = [];
    mem.fights = {};
  }
  const p = w.players[me];
  const tune = TUNE[level];
  const rng = new Rng((w.rng ^ Math.imul(w.day + 1, 0x9e3779b1) ^ (me * 7919) ^ mem.skip.length) >>> 0);
  // начатое: выбор и навыки
  if (w.pending?.t === 'choice') {
    const ids = w.pending.options.map((o) => o.id);
    const want = ids.includes('give') ? 'give' : ids.includes('xp') && w.day >= 21 ? 'xp' : ids.includes('semki') ? 'semki' : ids[0];
    return { t: 'choose', id: want };
  }
  const heroes = playerHeroes(w, me);
  for (const h of heroes) {
    const up = h.ups[0];
    if (!up) continue;
    if (!up.options.length) return { t: 'skill', hero: h.id, skill: null };
    const pick = level === 'easy' ? up.options[rng.below(up.options.length)] : [...up.options].sort((a, b) => SKILL_ORDER.indexOf(a) - SKILL_ORDER.indexOf(b))[0];
    return { t: 'skill', hero: h.id, skill: pick };
  }
  const towns = playerTowns(w, me);
  // без героя город беззащитен и карта стоит: герой — раньше всего
  if (!heroes.length) {
    const a = tavernChoice(w, towns);
    if (a) return a;
  }
  // город: указ, постройка, рынок, найм
  for (const t of towns) {
    if (t.decrees.length) {
      const id = t.decrees.includes('growth') ? 'growth' : t.decrees.includes('semki') ? 'semki' : t.decrees[0];
      return { t: 'decree', town: t.id, id };
    }
    if (!t.builtToday && !mem.done.includes(`b${t.id}`)) {
      mem.done.push(`b${t.id}`);
      const b = buildChoice(w, t, level, rng);
      if (b) return { t: 'build', town: t.id, b };
      if ((level === 'hard' || (level === 'medium' && p.res.semki > 15000)) && mem.done.filter((x) => x === `m${t.id}`).length < 3) {
        const m = marketFor(w, t);
        if (m) {
          // докупили — постройку решаем заново
          mem.done.splice(mem.done.indexOf(`b${t.id}`), 1);
          mem.done.push(`m${t.id}`);
          return m;
        }
      }
    }
    if (mem.done.includes(`r${t.id}`)) continue;
    const rc = recruitChoice(w, t, level);
    if (rc) {
      if (level === 'easy') mem.done.push(`r${t.id}`);
      return rc;
    }
    if (level !== 'easy') {
      const ug = upgradeChoice(w, t);
      if (ug) return ug;
    }
  }
  // трактир: ещё герой
  if (heroes.length < tune.heroes && w.day >= 1 && p.res.semki >= HERO_COST + 1500) {
    const a = tavernChoice(w, towns);
    if (a) return a;
  }
  // главный герой в воротах забирает гарнизон
  const main = mainHero(w, me);
  for (const t of towns) {
    // гарнизон забирает самый сильный из героев в воротах
    let taker: AdvHero | null = null;
    for (const h of heroes) if ((h.cell === t.cell || neighbors(w, h.cell).includes(t.cell)) && (!taker || heroPower(h) > heroPower(taker))) taker = h;
    if (!taker) continue;
    for (let slot = 0; slot < ARMY_SLOTS; slot++) {
      const s = t.garrison[slot];
      if (!s) continue;
      const to = refFree(taker.army, s.cre);
      if (to < 0) continue;
      const a: AdvAction = { t: 'transfer', from: { t: t.id } as ArmyRef, fromSlot: slot, to: { h: taker.id }, toSlot: to };
      if (!actionError(w, a)) return a;
    }
  }
  // главный у верфи и без свободной лодки — покупает
  if (main && !main.boat) {
    for (const o of w.objects) {
      if (o.kind !== 'shipyard' || (main.cell !== o.cell && !neighbors(w, main.cell).includes(o.cell))) continue;
      const r = reachOf(w, main);
      if (!wantsBoat(w, main, r, level) || w.objects.some((b) => b.kind === 'boat' && r.dist[b.cell] > 0)) continue;
      const a: AdvAction = { t: 'boat', hero: main.id, obj: o.id };
      if (!actionError(w, a)) return a;
    }
  }
  // ходы героев: сначала главный
  const order = main ? [main, ...heroes.filter((h) => h !== main)] : heroes;
  for (const h of order) {
    if (mem.skip.includes(h.id) || h.mp <= 0) continue;
    const target = pickTarget(w, h, level, h === main, rng, mem);
    if (!target) {
      mem.skip.push(h.id);
      continue;
    }
    const r = reachOf(w, h);
    let first = target.cell;
    while (r.prev[first] >= 0 && r.prev[first] !== h.cell) first = r.prev[first];
    if (stepCost(w, h, h.cell, first) > h.mp && h.mp < heroMaxMp(h)) {
      mem.skip.push(h.id);
      continue;
    }
    if (mem.last && mem.last.hero === h.id && mem.last.cell === h.cell && mem.last.mp === h.mp && mem.last.to === target.cell) {
      mem.skip.push(h.id);
      continue;
    }
    mem.last = { hero: h.id, cell: h.cell, mp: h.mp, to: target.cell };
    return { t: 'move', hero: h.id, to: target.cell };
  }
  return { t: 'end' };
}
