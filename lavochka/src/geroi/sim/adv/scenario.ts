/* Сценарий кампании (DESIGN.md §9, этап 8): задания, поражение и события живут в самом мире (`world.scn`) — чистый JSON,
 * поэтому сохранение, боты и показ работают как в обычной партии. Проверка — после каждого действия и итога боя. */
import type { HeroPick } from '../heroes';
import { type Purse, WATER } from './data';
import { SHARD, addToArmy } from './hero';
import { type AdvEvent, type World, allied, cellOf, emptyArmy, heroById, makeHero, neighbors, placeObject, playerHeroes, playerTowns, reveal, xOf, yOf } from './world';

/** Клетка в описании сценария: [x, y] или метка объекта, города, героя. */
export type At = [number, number] | string;

export type Cond =
  /** Объекты и города с этими метками у игрока (или союзника); n — сколько из них хватит. */
  | { t: 'own'; tags: string[]; n?: number }
  /** Отряды, герои с этими метками исчезли (разбиты). */
  | { t: 'gone'; tags: string[] }
  /** В армиях героев игрока не меньше n существ из списка. */
  | { t: 'army'; cre: string[]; n: number }
  | { t: 'built'; b: string }
  /** Герой игрока не дальше r клеток от метки. */
  | { t: 'near'; at: At; r: number }
  /** Осколок у героя игрока. */
  | { t: 'shard' }
  /** Опыты Академии: закончено веток. */
  | { t: 'studied'; n: number }
  /** Настал день (0 — первый). */
  | { t: 'day'; day: number }
  /** Просьба провидца с меткой выполнена. */
  | { t: 'quest'; tag: string }
  | { t: 'flag'; id: string }
  /** Герой с меткой пал. */
  | { t: 'heroDead'; tag: string }
  | { t: 'noTowns' }
  | { t: 'all'; of: Cond[] }
  | { t: 'any'; of: Cond[] }
  | { t: 'not'; c: Cond };

export type ScnAct =
  /** Сообщение игроку. */
  | { t: 'msg'; title?: string; text: string }
  /** Нейтральный отряд у клетки. */
  | { t: 'stack'; at: At; cre: string; n: number; tag?: string }
  /** Отряд рядом с героем игрока: на r клеток от него (звездопад, засада). */
  | { t: 'ambush'; cre: string; n: number; r: number; tag?: string }
  /** Герой у клетки: войско, уровень, метка. */
  | { t: 'hero'; owner: number; pick: HeroPick; at: At; army: [string, number][]; level?: number; tag?: string }
  /** Союз: игрок переходит в команду. */
  | { t: 'team'; player: number; team: number }
  | { t: 'res'; player: number; res: Purse }
  | { t: 'reveal'; at: At; r: number }
  /** Открыть скрытое задание. */
  | { t: 'show'; goal: string }
  | { t: 'flag'; id: string }
  /** Флаг объекта или города с меткой — игроку. */
  | { t: 'give'; tag: string; player: number };

export interface Goal {
  id: string;
  text: string;
  cond: Cond;
  done?: boolean;
  /** Не видно, пока событие не откроет. */
  hidden?: boolean;
  /** Не нужно для победы. */
  optional?: boolean;
}

export interface Trigger {
  id: string;
  when: Cond;
  /** Повторять через столько дней, пока условие верно. */
  every?: number;
  do: ScnAct[];
}

export interface ScnState {
  id: string;
  /** Место человека. */
  human: number;
  goals: Goal[];
  /** Любое верно — поражение. */
  lose: { text: string; cond: Cond }[];
  triggers: Trigger[];
  /** Событие → день, когда сработало. */
  fired: Record<string, number>;
  flags: string[];
  /** Метки, которые уже были на карте: «разбит» значит, что был и пропал. */
  seen: string[];
  /** Сила отрядов из событий: множитель сложности. */
  guard?: number;
  result?: 'win' | 'lose';
  /** Почему кончилось. */
  why?: string;
}

/** Вещь с меткой: объект, город или герой. */
interface Tagged {
  cell: number;
  owner: number;
  tag?: string;
}

function tagged(w: World, tag: string): Tagged[] {
  return [...w.objects, ...w.towns, ...w.heroes].filter((x) => x.tag === tag);
}

export function cellAt(w: World, at: At): number {
  if (typeof at === 'string') return tagged(w, at)[0]?.cell ?? -1;
  return cellOf(w, at[0], at[1]);
}

function cheb(w: World, a: number, b: number): number {
  return Math.max(Math.abs(xOf(w, a) - xOf(w, b)), Math.abs(yOf(w, a) - yOf(w, b)));
}

/** Свободная клетка поближе: суша, не закрыта, без входа, героя и города. */
export function freeNear(w: World, c: number, minR = 0): number {
  if (c < 0) return -1;
  const busy = new Set<number>([...w.heroes.map((h) => h.cell), ...w.towns.map((t) => t.cell)]);
  const seen = new Set([c]);
  const q = [c];
  for (let i = 0; i < q.length && i < 4000; i++) {
    const x = q[i];
    if (cheb(w, x, c) >= minR && w.terrain[x] !== WATER && !w.block[x] && w.entries[x] === undefined && !busy.has(x)) return x;
    for (const n of neighbors(w, x)) {
      if (seen.has(n)) continue;
      seen.add(n);
      q.push(n);
    }
  }
  return -1;
}

export function holds(w: World, s: ScnState, c: Cond): boolean {
  const me = s.human;
  switch (c.t) {
    case 'own': {
      const n = c.n ?? c.tags.length;
      let got = 0;
      for (const tag of c.tags) if (tagged(w, tag).some((x) => allied(w, x.owner, me))) got++;
      return got >= n;
    }
    case 'gone':
      return c.tags.every((tag) => s.seen.includes(tag) && !w.objects.some((o) => o.tag === tag) && !w.heroes.some((h) => h.tag === tag));
    case 'army': {
      let n = 0;
      for (const h of playerHeroes(w, me)) for (const st of h.army) if (st && c.cre.includes(st.cre)) n += st.count;
      return n >= c.n;
    }
    case 'built':
      return playerTowns(w, me).some((t) => t.built.includes(c.b));
    case 'near': {
      const at = cellAt(w, c.at);
      return at >= 0 && playerHeroes(w, me).some((h) => cheb(w, h.cell, at) <= c.r);
    }
    case 'shard':
      return playerHeroes(w, me).some((h) => Object.values(h.arts).includes(SHARD) || h.bag.includes(SHARD));
    case 'studied':
      return playerTowns(w, me).reduce((sum, t) => sum + Object.values(t.studied).reduce((a, b) => a + b, 0), 0) >= c.n;
    case 'day':
      return w.day >= c.day;
    case 'quest':
      return w.objects.some((o) => o.tag === c.tag && o.quest?.done);
    case 'flag':
      return s.flags.includes(c.id);
    case 'heroDead':
      return s.seen.includes(c.tag) && !w.heroes.some((h) => h.tag === c.tag);
    case 'noTowns':
      return playerTowns(w, me).length === 0;
    case 'all':
      return c.of.every((x) => holds(w, s, x));
    case 'any':
      return c.of.some((x) => holds(w, s, x));
    case 'not':
      return !holds(w, s, c.c);
  }
}

function doAct(w: World, s: ScnState, a: ScnAct, ev: AdvEvent[]): void {
  switch (a.t) {
    case 'msg':
      ev.push({ e: 'msg', title: a.title, text: a.text, to: s.human });
      break;
    case 'stack':
    case 'ambush': {
      let c: number;
      if (a.t === 'stack') c = freeNear(w, cellAt(w, a.at));
      else {
        const hs = playerHeroes(w, s.human);
        // по очереди дней — к разным героям
        const h = hs[w.day % Math.max(1, hs.length)];
        c = h ? freeNear(w, h.cell, a.r) : -1;
      }
      if (c < 0) break;
      const army = emptyArmy();
      addToArmy(army, a.cre, scaled(s, a.n));
      const o = placeObject(w, { kind: 'stack', cell: c, owner: -1, army, ...(a.tag ? { tag: a.tag } : {}) });
      if (a.tag) mark(s, a.tag);
      reveal(w, s.human, c, 2);
      ev.push({ e: 'add', obj: o.id });
      break;
    }
    case 'hero': {
      const c = freeNear(w, cellAt(w, a.at));
      if (c < 0) break;
      const h = makeHero(w, a.pick, a.owner, c);
      h.army = emptyArmy();
      for (const [cre, n] of a.army) addToArmy(h.army, cre, allied(w, a.owner, s.human) ? n : scaled(s, n));
      if (a.level) bumpLevel(h, a.level);
      if (a.tag) {
        h.tag = a.tag;
        mark(s, a.tag);
      }
      w.heroes.push(h);
      reveal(w, a.owner, c, 4);
      ev.push({ e: 'heroNew', hero: h.id });
      break;
    }
    case 'team':
      w.players[a.player].team = a.team;
      break;
    case 'res': {
      const p = w.players[a.player];
      for (const [k, v] of Object.entries(a.res)) p.res[k as keyof typeof p.res] += v ?? 0;
      ev.push({ e: 'gain', player: a.player, res: a.res });
      break;
    }
    case 'reveal':
      reveal(w, s.human, cellAt(w, a.at), a.r);
      break;
    case 'show': {
      const g = s.goals.find((x) => x.id === a.goal);
      if (g) g.hidden = false;
      break;
    }
    case 'flag':
      if (!s.flags.includes(a.id)) s.flags.push(a.id);
      break;
    case 'give': {
      for (const x of [...w.objects, ...w.towns].filter((o) => o.tag === a.tag)) {
        x.owner = a.player;
        if ('kind' in x) ev.push({ e: 'flag', obj: x.id, owner: a.player });
      }
      break;
    }
  }
}

/** Герой сценария сразу старше: цифры класса растут поровну, как при повышениях. */
export function bumpLevel(h: { level: number; atk: number; def: number; power: number; know: number }, level: number): void {
  const stats = ['atk', 'def', 'power', 'know'] as const;
  for (let lv = h.level; lv < level; lv++) h[stats[lv % 4]]++;
  h.level = Math.max(h.level, level);
}

const scaled = (s: ScnState, n: number): number => Math.max(1, Math.round(n * (s.guard ?? 1)));

function mark(s: ScnState, tag: string): void {
  if (!s.seen.includes(tag)) s.seen.push(tag);
}

/** Метки, что есть на карте с начала. */
export function markSeen(w: World, s: ScnState): void {
  for (const x of [...w.objects, ...w.heroes, ...w.towns]) if (x.tag) mark(s, x.tag);
}

/** После каждого действия: события, задания, конец. */
export function scnCheck(w: World, ev: AdvEvent[]): void {
  const s = w.scn;
  if (!s || s.result) return;
  // события могут цеплять друг друга: несколько проходов
  for (let pass = 0; pass < 4; pass++) {
    let any = false;
    for (const t of s.triggers) {
      const last = s.fired[t.id];
      if (last !== undefined && (!t.every || w.day - last < t.every)) continue;
      if (!holds(w, s, t.when)) continue;
      s.fired[t.id] = w.day;
      any = true;
      for (const a of t.do) doAct(w, s, a, ev);
    }
    if (!any) break;
  }
  for (const g of s.goals) {
    if (g.done || !holds(w, s, g.cond)) continue;
    g.done = true;
    g.hidden = false;
    ev.push({ e: 'msg', title: 'Задание выполнено', text: g.text, to: s.human });
  }
  const me = w.players[s.human];
  const lost = !me.alive ? { text: 'Все города и герои потеряны.' } : s.lose.find((l) => holds(w, s, l.cond));
  if (lost) {
    s.result = 'lose';
    s.why = lost.text;
    w.over = true;
    w.winner = w.players.find((p) => p.alive && !allied(w, p.id, s.human))?.id ?? -1;
    ev.push({ e: 'over', winner: w.winner });
    return;
  }
  if (s.goals.every((g) => g.done || g.optional)) {
    s.result = 'win';
    w.over = true;
    w.winner = s.human;
    ev.push({ e: 'over', winner: s.human });
  }
}

/** Главный герой сценария: метка `main`. */
export const mainHero = (w: World): ReturnType<typeof heroById> => w.heroes.find((h) => h.tag === 'main');
