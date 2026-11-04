/* Сеть карты «Героев» (DESIGN.md §12, этап 7): сервер авторитетный — держит мир, проверяет действия, ходит за ботов и пропавших.
 * Каждому месту уходит свой вид мира (`worldView`): без чужих ресурсов, гарнизонов, тумана и спрятанных героев; события из тумана вырезаются (`eventsView`).
 * Бои на карте идут теми же сообщениями, что Арена (`start`/`step`/`result`): клиент играет их обычным Game. */
import type { VoiceMember } from '../../core/protocol';
import type { BotLevel } from '../bot/bot';
import type { Action, BattleEvent, BattleState } from '../sim/battle';
import { RES, type ResId } from '../sim/adv/data';
import { type GenOptions, GUARDS, MAP_SIZES, WATERS } from '../sim/adv/gen';
import { ARMY_SLOTS } from '../sim/adv/hero';
import { TEMPLATES } from '../sim/adv/templates';
import type { TownFaction } from '../sim/adv/town';
import { type AdvAction, type AdvEvent, type ArmyRef, type World, emptyArmy, heroById, heroHiddenFrom } from '../sim/adv/world';
import { CLASSES, type HeroPick } from '../sim/heroes';
import type { ClockView, ResultView } from './protocol';
import type { MapRecord, RecStep } from './record';

export const MAP_FACTIONS: TownFaction[] = ['zatulye', 'zatonye', 'kuznya', 'akademiya'];
export const BOT_LEVELS: BotLevel[] = ['easy', 'medium', 'hard'];

/** Место в лобби и в партии. */
export interface MapSeatView {
  name: string;
  faction: TownFaction;
  hero: HeroPick;
  /** Бот на месте; null — место для человека. */
  bot: BotLevel | null;
  /** Человек занял место. */
  taken: boolean;
  /** Человек на связи. */
  on: boolean;
  /** Союз: номер команды (1, 2); null — сам за себя. */
  team: number | null;
}

export interface MapClock {
  /** Запас хода по местам, мс. */
  bank: number[];
  /** Чьи часы идут (в общий день — у всех, кто ещё ходит; бой и боты — стоят). */
  running: number[];
  /** Общий день: все ходят разом, пока армии далеко. */
  free: boolean;
  /** Кто закончил день (в общий день и в очереди после сближения). */
  done: boolean[];
}

/** Шаг драфта: забанить героя, забанить фракцию, выбрать фракцию и героя. */
export interface MapDraftStep {
  seat: number;
  kind: 'hero' | 'faction' | 'pick';
}

export interface MapDraftView {
  steps: MapDraftStep[];
  /** Текущий шаг. */
  i: number;
  /** Забаненное. */
  factions: TownFaction[];
  heroes: HeroPick[];
  /** Сколько осталось на шаг, мс. */
  ms: number;
}

export type MapClientMsg =
  | { t: 'mcreate'; game: 'geroi'; name: string; token: string; gen: GenOptions }
  | { t: 'join'; game: 'geroi'; code: string; name: string; token: string }
  /** Своё место: фракция и герой. */
  | { t: 'mseat'; faction: TownFaction; hero: HeroPick }
  /** Хозяин: настройки карты. */
  | { t: 'mgen'; gen: GenOptions }
  /** Хозяин: место — бот такого уровня или свободно для человека. */
  | { t: 'mbot'; seat: number; bot: BotLevel | null }
  /** Хозяин: одновременные ходы. */
  | { t: 'msimul'; on: boolean }
  /** Хозяин: команда места (союзы 2×2); null — сам за себя. */
  | { t: 'mteam'; seat: number; team: number | null }
  /** Хозяин: драфт фракций и героев перед картой. */
  | { t: 'mdraftopt'; on: boolean }
  /** Шаг драфта: бан героя (hero), бан фракции (faction), выбор (оба). */
  | { t: 'mdraft'; faction?: TownFaction; hero?: HeroPick }
  | { t: 'start' }
  | { t: 'adv'; a: AdvAction }
  /** Ход в бою на карте. */
  | { t: 'act'; a: Action }
  /** Сдаться в бою (герой бежит). */
  | { t: 'bresign' }
  /** Сдать партию. */
  | { t: 'resign' }
  | { t: 'chat'; text: string }
  | { t: 'voice'; on: boolean; video?: boolean }
  | { t: 'rtc'; to: string; data: unknown }
  /** Запись партии (только после конца). */
  | { t: 'mrec' }
  | { t: 'ping' };

export type MapServerMsg =
  | { t: 'created'; code: string }
  | { t: 'joined'; code: string }
  | { t: 'error'; text: string }
  | { t: 'mlobby'; gen: GenOptions; seats: MapSeatView[]; you: number; seat: number | null; host: boolean; simul: boolean; draft: boolean }
  | { t: 'mdraft'; d: MapDraftView; seat: number | null; seats: MapSeatView[] }
  /** Зрителю: шаги записи (с задержкой в день), мир он собирает сам. */
  | { t: 'mspec'; steps: RecStep[]; seats: MapSeatView[] }
  | { t: 'mrecord'; rec: MapRecord }
  /** Объявление всем: «армии сблизились — ходим по очереди». */
  | { t: 'mnote'; text: string }
  | { t: 'mstart'; world: World; seat: number | null; seats: MapSeatView[]; clock: MapClock; you: number; busy: string }
  | { t: 'mstep'; events: AdvEvent[]; world: World; clock: MapClock; seats: MapSeatView[]; actor: number }
  /** Что сейчас происходит у других: «Идёт бой…», «Ходит Петя». Пусто — ничего. */
  | { t: 'mbusy'; text: string }
  | { t: 'mnope'; why: string }
  | { t: 'mover'; winner: number; why: 'map' | 'resign' }
  // бой на карте — как в Арене
  | { t: 'start'; state: BattleState; seat: number | null; names: [string, string]; clock: ClockView; result?: ResultView; you: number }
  | { t: 'step'; events: BattleEvent[]; state: BattleState; clock: ClockView }
  | { t: 'nope'; why: string }
  | { t: 'result'; result: ResultView }
  | { t: 'peer'; name: string; on: boolean }
  | { t: 'chat'; name: string; text: string }
  | { t: 'voice'; members: VoiceMember[] }
  | { t: 'rtc'; from: string; data: unknown }
  | { t: 'pong' };

// ------------------------------------------------------------------ проверка входящего

const int = (x: unknown, max = 1 << 24): x is number => Number.isInteger(x) && (x as number) >= 0 && (x as number) < max;
const str = (x: unknown, max = 40): x is string => typeof x === 'string' && x.length > 0 && x.length <= max;
const isRes = (x: unknown): x is ResId => typeof x === 'string' && (RES as readonly string[]).includes(x);
function ref(x: unknown): ArmyRef | null {
  const r = x as Record<string, unknown> | null;
  if (!r || typeof r !== 'object') return null;
  if (int(r.h)) return { h: r.h };
  if (int(r.t)) return { t: r.t };
  if (int(r.o)) return { o: r.o };
  return null;
}
function pick(x: unknown): HeroPick | null {
  const p = x as Record<string, unknown> | null;
  return p && CLASSES.some((c) => c.id === p.cls) && int(p.n, 5) && p.n >= 1 ? { cls: p.cls as string, n: p.n } : null;
}

/** Действие карты из сети: только известные поля нужных типов; иначе null. Правила проверяет `actionError` на сервере. */
export function cleanAdvAction(raw: unknown): AdvAction | null {
  const a = raw as Record<string, unknown> | null;
  switch (a?.t) {
    case 'end':
      return { t: 'end' };
    case 'move':
      return int(a.hero) && int(a.to) ? { t: 'move', hero: a.hero, to: a.to } : null;
    case 'choose':
      return str(a.id) ? { t: 'choose', id: a.id } : null;
    case 'skill':
      return int(a.hero) && (a.skill === null || str(a.skill)) ? { t: 'skill', hero: a.hero, skill: a.skill as string | null } : null;
    case 'build':
      return int(a.town) && str(a.b) ? { t: 'build', town: a.town, b: a.b } : null;
    case 'recruit':
      return int(a.town) && str(a.cre) && int(a.count, 100000) ? { t: 'recruit', town: a.town, cre: a.cre, count: a.count } : null;
    case 'upgrade': {
      const r = ref(a.ref);
      return int(a.town) && r && int(a.slot, ARMY_SLOTS) ? { t: 'upgrade', town: a.town, ref: r, slot: a.slot } : null;
    }
    case 'hire':
      return int(a.hero) && int(a.obj) && int(a.count, 100000) ? { t: 'hire', hero: a.hero, obj: a.obj, count: a.count } : null;
    case 'tavern': {
      const p = pick(a.pick);
      const town = a.town === null ? null : int(a.town) ? a.town : undefined;
      const hero = a.hero === null ? null : int(a.hero) ? a.hero : undefined;
      return p && town !== undefined && hero !== undefined ? { t: 'tavern', town, hero, pick: p } : null;
    }
    case 'market':
      return isRes(a.give) && isRes(a.get) && int(a.amount, 10_000_000) ? { t: 'market', give: a.give, get: a.get, amount: a.amount, ...(int(a.hero) ? { hero: a.hero } : {}) } : null;
    case 'transfer': {
      const from = ref(a.from);
      const to = ref(a.to);
      if (!from || !to || !int(a.fromSlot, ARMY_SLOTS) || !int(a.toSlot, ARMY_SLOTS)) return null;
      if (a.count !== undefined && !int(a.count, 1_000_000)) return null;
      return { t: 'transfer', from, fromSlot: a.fromSlot, to, toSlot: a.toSlot, ...(a.count !== undefined ? { count: a.count as number } : {}) };
    }
    case 'equip':
      return int(a.hero) && str(a.art) && str(a.slot) ? { t: 'equip', hero: a.hero, art: a.art, slot: a.slot } : null;
    case 'unequip':
      return int(a.hero) && str(a.slot) ? { t: 'unequip', hero: a.hero, slot: a.slot } : null;
    case 'giveArt':
      return int(a.from) && int(a.to) && str(a.art) ? { t: 'giveArt', from: a.from, to: a.to, art: a.art } : null;
    case 'cast':
      return int(a.hero) && str(a.spell) ? { t: 'cast', hero: a.hero, spell: a.spell } : null;
    case 'boat':
      return int(a.hero) && int(a.obj) ? { t: 'boat', hero: a.hero, obj: a.obj } : null;
    case 'townBoat':
      return int(a.town) ? { t: 'townBoat', town: a.town } : null;
    case 'dig':
      return int(a.hero) ? { t: 'dig', hero: a.hero } : null;
    case 'decree':
      return int(a.town) && str(a.id) ? { t: 'decree', town: a.town, id: a.id } : null;
    case 'research':
      return int(a.town) && str(a.school) ? { t: 'research', town: a.town, school: a.school } : null;
    case 'repair':
      return int(a.town) && str(a.cre) && int(a.count, 100000) ? { t: 'repair', town: a.town, cre: a.cre, count: a.count } : null;
    case 'dismiss':
      return int(a.hero) ? { t: 'dismiss', hero: a.hero } : null;
    case 'gift':
      return int(a.to, 8) && isRes(a.res) && int(a.amount, 1_000_000) && a.amount > 0 ? { t: 'gift', to: a.to, res: a.res, amount: a.amount } : null;
    default:
      return null;
  }
}

/** Настройки карты из сети: известный шаблон, размер, вода, охрана; число игроков — по шаблону. */
export function cleanGen(raw: unknown): GenOptions | null {
  const g = raw as Record<string, unknown> | null;
  if (!g || typeof g.template !== 'string' || !Object.hasOwn(TEMPLATES, g.template)) return null;
  if (typeof g.size !== 'string' || !Object.hasOwn(MAP_SIZES, g.size) || !TEMPLATES[g.template].sizes.includes(g.size as never)) return null;
  if (typeof g.water !== 'string' || !Object.hasOwn(WATERS, g.water)) return null;
  if (typeof g.guard !== 'string' || !Object.hasOwn(GUARDS, g.guard)) return null;
  if (!int(g.seed, 2 ** 31)) return null;
  return { template: g.template, size: g.size as GenOptions['size'], water: g.water as GenOptions['water'], guard: g.guard as GenOptions['guard'], seed: g.seed };
}

export const cleanPick = pick;

// ------------------------------------------------------------------ вид мира для места

const ZERO = Object.fromEntries(RES.map((r) => [r, 0])) as Record<ResId, number>;

/** Мир глазами места: чужие ресурсы, гарнизоны, трактиры, гильдии и туман — пусто; герои в тумане и спрятанные — не видны.
 * Зритель (seat = null) видит всё. Сам мир не меняется. */
export function worldView(w: World, seat: number | null): World {
  if (seat === null) return { ...w, rng: 0 };
  const ex = w.players[seat].explored;
  return {
    ...w,
    rng: 0,
    players: w.players.map((p) => (p.id === seat ? p : { ...p, res: { ...ZERO }, explored: [], obelisks: [], keys: [], scrap: {} })),
    heroes: w.heroes.filter((h) => h.owner === seat || (ex[h.cell] && !heroHiddenFrom(w, h, seat))),
    towns: w.towns.map((t) => (t.owner === seat ? t : {
      ...t, garrison: emptyArmy(), avail: t.avail.map(() => 0), tavern: [], guild: t.guild.map(() => []), decrees: [], research: null, studied: {}, forge: 0, bonus: t.bonus.map(() => 0), discount: 0,
    })),
    // чужое «начатое» (бой, выбор) — не своё дело
    pending: w.pending && heroById(w, w.pending.hero)?.owner === seat ? w.pending : null,
  };
}

/** События глазами места: свои — все; чужие — только то, что видно (шаг героя на открытой клетке, захват, день, выбывание, конец). */
export function eventsView(w: World, events: AdvEvent[], seat: number | null, actor: number): AdvEvent[] {
  if (seat === null || seat === actor) return events;
  const ex = w.players[seat].explored;
  const seen = (hero: number): boolean => {
    const h = heroById(w, hero);
    return !!h && !heroHiddenFrom(w, h, seat);
  };
  return events.filter((e) => {
    switch (e.e) {
      case 'step':
        return !!ex[e.to] && !!ex[e.from] && seen(e.hero);
      case 'teleport':
      case 'boat':
        return !!ex[heroById(w, e.hero)?.cell ?? -1] && seen(e.hero);
      case 'flag':
      case 'remove':
      case 'add':
      case 'capture':
      case 'day':
      case 'turn':
      case 'lost':
      case 'over':
        return true;
      case 'heroDead':
        return e.owner === seat;
      case 'gift':
        return e.to === seat;
      default:
        return false;
    }
  });
}

