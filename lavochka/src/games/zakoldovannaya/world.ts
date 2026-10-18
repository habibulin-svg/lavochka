/* Мир: карта (граф дорог), раскладка замков, путь отряда, дни и ночи, дорожные встречи, вход в замки и комнаты. */
import type { Rng } from '../../core/types';
import { CAMPAIGNS, sceneByKey, siteById } from './content';
import { BOOK_TITLES } from './content/book';
import { die, heal, hero, leader, living, rollD, say, story, sys, type Ctx } from './ctx';
import mapJson from './data/map.json';
import plansJson from './data/plans.json';
import { alive } from './hero';
import { MONSTERS } from './monsters';
import { restoreSpells, startScene } from './interp';
import { GM, type State } from './state';

// ---------- карта

export interface MapNode {
  id: number;
  x: number;
  y: number;
  kind: 'road' | 'castle' | 'forpost';
}
export const MAP = mapJson as unknown as { size: [number, number]; nodes: MapNode[]; castles: number[]; start: number; edges: [number, number, number][] };
export const ADJ: number[][] = MAP.nodes.map(() => []);
export const BRIDGE = new Set<string>();
for (const [a, b, br] of MAP.edges) {
  ADJ[a].push(b);
  ADJ[b].push(a);
  if (br) BRIDGE.add(`${a}-${b}`).add(`${b}-${a}`);
}

/** Сколько переходов до узла от Форпоста. */
export function hops(from: number): number[] {
  const d = MAP.nodes.map(() => Infinity);
  d[from] = 0;
  const q = [from];
  while (q.length) {
    const v = q.shift()!;
    for (const u of ADJ[v]) if (d[u] === Infinity) {
      d[u] = d[v] + 1;
      q.push(u);
    }
  }
  return d;
}

/** Кратчайший путь (для ботов и подсказки). */
export function route(from: number, to: number): number[] | null {
  if (from === to) return [from];
  const prev = new Map<number, number>([[from, -1]]);
  const q = [from];
  while (q.length) {
    const v = q.shift()!;
    for (const u of ADJ[v]) if (!prev.has(u)) {
      prev.set(u, v);
      if (u === to) {
        const path = [u];
        let x = v;
        while (x !== -1) {
          path.unshift(x);
          x = prev.get(x)!;
        }
        return path;
      }
      q.push(u);
    }
  }
  return null;
}

/** Книжная раскладка: лёгкие замки — ближе к Форпосту, Владения Чёрного мага — дальше всех. */
const BY_DANGER = ['c1', 'c3', 'c8', 'c4', 'c7', 'c13', 'c6', 'c2', 'c5', 'c14', 'c12', 'c9', 'c15', 'c11', 'c10'];
export function bookLayout(): string[] {
  const d = hops(MAP.start);
  const order = MAP.castles.map((n, i) => ({ i, d: d[n] })).sort((a, b) => a.d - b.d || a.i - b.i);
  const slots: string[] = Array(MAP.castles.length).fill('');
  order.forEach((o, k) => (slots[o.i] = BY_DANGER[k]));
  return slots;
}
export function shuffledLayout(rng: Rng): string[] {
  const ids = [...BY_DANGER];
  for (let i = ids.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [ids[i], ids[j]] = [ids[j], ids[i]];
  }
  return ids;
}

/** Место (замок) в этом узле карты. */
export function siteAt(s: State, node: number): string | null {
  if (node === MAP.start) return 'forpost';
  const i = MAP.castles.indexOf(node);
  if (i >= 0) return s.world.slots[i] || null;
  const camp = CAMPAIGNS[s.mode];
  return camp?.places?.find((p) => p.node === node)?.site ?? null;
}
export function nodeOfSite(s: State, site: string): number | null {
  if (site === 'forpost') return MAP.start;
  const i = s.world.slots.indexOf(site);
  if (i >= 0) return MAP.castles[i];
  return CAMPAIGNS[s.mode]?.places?.find((p) => p.site === site)?.node ?? null;
}

export function siteTitle(s: State, site: string): string {
  return siteById(site, s.mode)?.title ?? BOOK_TITLES[site] ?? site;
}

// ---------- планы замков

export interface PlanRoom {
  id: string;
  x: number;
  y: number;
  r: number;
  kind: string;
  img?: number;
  floor?: string;
}
export interface Plan {
  images: (string | null)[];
  sizes: [number, number][];
  rooms: PlanRoom[];
  links: { a: string; b: string; kind: 'door' | 'secret' | 'open' | 'up' | 'down' | 'gate' }[];
  entry: string[];
  note?: string;
}
export const PLANS = plansJson as unknown as Record<string, Plan>;

export function planOf(s: State, site: string): Plan | undefined {
  const camp = CAMPAIGNS[s.mode];
  const own = camp?.sites?.[site];
  return (own?.plan as Plan | undefined) ?? PLANS[site];
}

/** Куда можно пройти из комнаты (потайные — только открытые). */
export function exits(s: State, site: string, room: string): { to: string; kind: string; hidden?: boolean }[] {
  const p = planOf(s, site);
  if (!p) return [];
  const out: { to: string; kind: string; hidden?: boolean }[] = [];
  for (const l of p.links) {
    const other = l.a === room ? l.b : l.b === room ? l.a : null;
    if (other == null) continue;
    // лестница и ход вниз проходимы в обе стороны
    const opened = s.world.opened.includes(`${site}:${room}>${other}`);
    if (l.kind === 'secret' && !opened) {
      out.push({ to: other, kind: l.kind, hidden: true });
      continue;
    }
    out.push({ to: other, kind: l.kind });
  }
  // открытые сценой проходы (не по плану)
  for (const k of s.world.opened) {
    const [sr, to] = k.split('>');
    if (sr === `${site}:${room}` && !out.some((o) => o.to === to)) out.push({ to, kind: 'open' });
  }
  return out;
}

// ---------- путь по карте

export const STEPS_PER_DAY = 6;

/** Отряд идёт по пути (узлы подряд, первый — где стоит). Останавливается на встрече. */
export function travel(c: Ctx, path: number[]): boolean {
  const w = c.s.where;
  if (w.k !== 'map' || path.length < 2 || path[0] !== w.node) return false;
  for (let i = 1; i < path.length; i++) if (!ADJ[path[i - 1]].includes(path[i])) return false;
  const walked: number[] = [w.node];
  for (let i = 1; i < path.length; i++) {
    const from = path[i - 1];
    const to = path[i];
    w.node = to;
    walked.push(to);
    if (!c.s.world.seen.includes(to)) c.s.world.seen.push(to);
    c.s.world.steps++;
    const bridge = BRIDGE.has(`${from}-${to}`);
    const atSite = siteAt(c.s, to);
    // сюжет кампании
    if (fireTriggers(c, { on: 'node', node: to })) break;
    if (c.s.world.steps >= STEPS_PER_DAY) {
      c.ev.push({ k: 'move', path: walked });
      nightfall(c);
      return true;
    }
    if (!atSite && roadEncounter(c, { bridge, node: to })) break;
  }
  if (!c.s.scene) c.ev.push({ k: 'move', path: walked });
  else c.ev.unshift({ k: 'move', path: walked });
  return true;
}

/** Метки встречи подходят месту и времени? */
function fits(c: Ctx, tags: string[] | undefined, at: { bridge: boolean; node: number; night?: boolean }): boolean {
  const t = tags ?? [];
  if (t.includes('night') !== !!at.night) return false;
  if (t.includes('bridge') && !at.bridge) return false;
  if (t.includes('castle') && !ADJ[at.node].some((n) => MAP.castles.includes(n))) return false;
  if (t.includes('forpost') && hops(MAP.start)[at.node] > 3) return false;
  return true;
}

/** Дорожная встреча «Прочее»: по шансу берётся следующая подходящая сцена колоды. */
export function roadEncounter(c: Ctx, at: { bridge: boolean; node: number; night?: boolean }, force = false): boolean {
  if (!force && c.rng.int(100) >= c.s.opts.road) return false;
  const deck = c.s.world.deck;
  for (let i = deck.length - 1; i >= 0; i--) {
    const key = deck[i];
    const sc = sceneByKey(key, c.s.mode);
    if (!sc || !fits(c, sc.tags, at)) continue;
    deck.splice(i, 1);
    story(c, { k: 'title', text: at.night ? 'Ночью…' : 'В пути' });
    startScene(c, key);
    return true;
  }
  // «Прочее» исчерпано — «ведущий должен использовать свою фантазию»: случайная встреча по силам отряда
  if (!deck.length && c.s.mode === 'book') return wildEncounter(c, at.night);
  return false;
}

/** Случайная встреча, когда книжные кончились: опасность по уровню отряда (стоимость), бросок агрессивности. */
export function wildEncounter(c: Ctx, night?: boolean): boolean {
  const live = living(c.s);
  if (!live.length) return false;
  const lvl = Math.max(...live.map((h) => h.level));
  const cap = 60 + lvl * 250;
  const pool = MONSTERS.filter((m) => m.kd != null && m.attacks.length && typeof m.value === 'number' && m.value > 0 && m.value <= cap && !['chernyy_mag', 'bargul', 'tron', 'frankenshtein'].includes(m.id));
  if (!pool.length) return false;
  const m = pool[c.rng.int(pool.length)];
  const n = m.value != null && (m.value as number) < 60 ? 1 + c.rng.int(Math.min(4, live.length + 1)) : 1;
  c.s.custom = [
    { say: `${night ? 'Ночью к костру' : 'На дороге'} — ${m.name.toLowerCase()}${n > 1 ? ` (${n})` : ''}.`, img: m.id },
    { aggression: [[{ say: 'Спит и не замечает вас.' }], [{ say: 'Провожает отряд взглядом, но не нападает.' }], [{ ask: 'Встречный грубит и загораживает дорогу. Что делаете?', opts: [{ text: 'Обойти стороной', bot: 2, do: [] }, { text: 'Принять бой', do: [{ fight: [{ m: m.id, n }] }] }] }], [{ fight: [{ m: m.id, n }] }]] },
  ];
  story(c, { k: 'title', text: night ? 'Ночью…' : 'В пути' });
  startScene(c, 'custom');
  return true;
}

/** Конец дня: привал, ночная встреча, утро. */
export function nightfall(c: Ctx): void {
  c.s.world.night = true;
  story(c, { k: 'title', text: `Ночь ${c.s.world.day}-го дня` });
  say(c, 'Темнеет. Отряд разводит костёр у дороги.');
  const w = c.s.where;
  const node = w.k === 'map' ? w.node : w.node;
  // ночная встреча: утро наступит после сцены (afterScene); не было — сразу утро
  if (roadEncounter(c, { bridge: false, node, night: true })) return;
  morning(c);
}

export function morning(c: Ctx): void {
  c.s.world.day++;
  c.s.world.steps = 0;
  c.s.world.night = false;
  for (const h of living(c.s)) {
    if (c.s.opts.rest === 'always') heal(h, 1);
    if (c.s.opts.spells === 'rest') restoreSpells(h);
  }
  sys(c, `Утро ${c.s.world.day}-го дня.`);
  if (!c.s.scene) fireTriggers(c, { on: 'day' });
}

// ---------- места и комнаты

export function enterSite(c: Ctx): boolean {
  const w = c.s.where;
  if (w.k !== 'map') return false;
  const site = siteAt(c.s, w.node);
  if (!site) return false;
  if (c.s.world.flags[`closed:${site}`]) {
    sys(c, 'На месте замка — лишь развалины. Входить больше некуда.');
    return true;
  }
  const def = siteById(site, c.s.mode);
  const plan = planOf(c.s, site);
  const title = siteTitle(c.s, site);
  story(c, { k: 'title', text: title });
  if (!plan) {
    // место без плана (Форпост) — одна сцена-меню
    c.s.where = { k: 'site', site, room: Object.keys(def?.rooms ?? {})[0] ?? 'gate', node: w.node };
    enterRoom(c, c.s.where.room);
    return true;
  }
  const entry = plan.entry[0];
  c.s.where = { k: 'site', site, room: entry, node: w.node };
  if (fireTriggers(c, { on: 'site', site })) return true;
  if (def?.enter && !c.s.world.visited.includes(`${site}:*`)) {
    c.s.world.visited.push(`${site}:*`);
    if (startScene(c, `enter:${site}`)) {
      // вступление ждёт игроков — войти в первую комнату после него; уже кончилось — сразу
      if (c.s.scene) c.s.scene.then ??= { goto: entry };
      else if (c.s.where.k === 'site' && c.s.where.room === entry && !c.s.world.visited.includes(`${site}:${entry}`)) enterRoom(c, entry);
      return true;
    }
  }
  enterRoom(c, entry);
  return true;
}

export function enterRoom(c: Ctx, room: string): void {
  const w = c.s.where;
  if (w.k !== 'site') return;
  w.room = room;
  const vk = `${w.site}:${room}`;
  if (!c.s.world.visited.includes(vk)) c.s.world.visited.push(vk);
  c.ev.push({ k: 'room', site: w.site, room });
  if (fireTriggers(c, { on: 'room', site: w.site, room })) return;
  const camp = CAMPAIGNS[c.s.mode];
  const over = camp?.rooms?.[vk];
  const key = over ? `camp:${c.s.mode}:${over}` : `site:${w.site}:${room}`;
  const sc = sceneByKey(key, c.s.mode);
  if (sc && !c.s.world.done.includes(key)) {
    startScene(c, key);
    return;
  }
  if (sc?.after) say(c, sc.after);
  else if (sc) sys(c, 'Здесь вы уже были.');
  else {
    const def = siteById(w.site, c.s.mode);
    const p = planOf(c.s, w.site)?.rooms.find((r) => r.id === room);
    if (p?.kind === 'outside') sys(c, 'Вы у входа.');
    else sys(c, def?.empty ?? (p?.kind === 'corridor' ? 'Пустой коридор.' : p?.kind === 'yard' ? 'Двор. Никого.' : 'Пусто.'));
  }
}

/** Пройти в соседнюю комнату. */
export function goRoom(c: Ctx, to: string): boolean {
  const w = c.s.where;
  if (w.k !== 'site') return false;
  const ex = exits(c.s, w.site, w.room).find((e) => e.to === to && !e.hidden);
  if (!ex) return false;
  if (ex.kind === 'up' || ex.kind === 'down') sys(c, ex.kind === 'up' ? 'Вы поднимаетесь по лестнице.' : 'Вы спускаетесь вниз.');
  enterRoom(c, to);
  return true;
}

/** Искать потайную дверь: «3» на трёхгранном кубике (или заклинание «Отпирание»). */
export function search(c: Ctx, seat: number, spell = false): boolean {
  const w = c.s.where;
  if (w.k !== 'site') return false;
  const h = hero(c, seat);
  if (!h || !alive(h)) return false;
  const key = `${w.site}:${w.room}:search`;
  const tried = (c.s.world.flags[key] as string | undefined)?.split(',') ?? [];
  if (!spell && tried.includes(String(seat))) return false;
  const hidden = exits(c.s, w.site, w.room).filter((e) => e.hidden);
  let ok = false;
  if (spell) {
    const sp = h.spells.find((x) => x.id === 'otpiranie');
    if (!sp) return false;
    sys(c, `${h.name} читает «Отпирание дверей и сундуков».`);
    ok = true;
  } else {
    c.s.world.flags[key] = [...tried, String(seat)].join(',');
    ok = rollD(c, seat, `${h.name}: ищет потайную дверь`, 'd3', [3]).ok;
  }
  if (ok && hidden.length) {
    for (const e of hidden) for (const k of [`${w.site}:${w.room}>${e.to}`, `${w.site}:${e.to}>${w.room}`]) if (!c.s.world.opened.includes(k)) c.s.world.opened.push(k);
    say(c, `Потайная дверь! Отсюда открылся ход${hidden.length > 1 ? 'ы' : ''}.`);
  } else sys(c, ok ? 'Стены как стены — потайных дверей нет.' : 'Ничего не нашли.');
  return true;
}

export function leaveSite(c: Ctx): boolean {
  const w = c.s.where;
  if (w.k !== 'site') return false;
  const plan = planOf(c.s, w.site);
  if (plan && !plan.entry.includes(w.room)) return false;
  c.s.where = { k: 'map', node: w.node };
  c.s.world.flags[`left:${w.site}`] = Number(c.s.world.flags[`left:${w.site}`] ?? 0) + 1;
  sys(c, `Отряд выходит: ${siteTitle(c.s, w.site)} остаётся позади.`);
  return true;
}

/** Перенос сценой: 'exit', 'site:<id>', 'node:<n>'. */
export function moveTo(c: Ctx, to: string): void {
  const w = c.s.where;
  if (to === 'exit') {
    if (w.k === 'site') c.s.world.flags[`left:${w.site}`] = Number(c.s.world.flags[`left:${w.site}`] ?? 0) + 1;
    c.s.where = { k: 'map', node: w.node };
    return;
  }
  const [k, v] = to.split(':');
  if (k === 'node') c.s.where = { k: 'map', node: Number(v) };
  else if (k === 'site') {
    const n = nodeOfSite(c.s, v);
    if (n != null) {
      c.s.where = { k: 'map', node: n };
      enterSite(c);
    }
  }
}

// ---------- сюжет кампаний

export function fireTriggers(c: Ctx, ev: { on: string; node?: number; site?: string; room?: string }): boolean {
  const camp = CAMPAIGNS[c.s.mode];
  if (!camp?.triggers) return false;
  for (const [i, t] of camp.triggers.entries()) {
    if (t.on !== ev.on) continue;
    if (t.node != null && t.node !== ev.node) continue;
    if (t.site != null && t.site !== ev.site) continue;
    if (t.room != null && t.room !== ev.room) continue;
    if (t.on === 'day' && (t.day ?? 0) > c.s.world.day) continue;
    if (t.on === 'flag' && (!t.flag || !c.s.world.flags[t.flag])) continue;
    const key = `trigger:${i}`;
    if (t.once !== false && c.s.world.flags[key]) continue;
    if (t.if) {
      // условие проверяет интерпретатор (evalCond) — без цикла импортов
      if (!condHook(c, t.if)) continue;
    }
    c.s.world.flags[key] = true;
    if (startScene(c, `camp:${c.s.mode}:${t.scene}`)) return true;
  }
  return false;
}
export let condHook: (c: Ctx, cond: any) => boolean = () => true;
export function setCondHook(f: typeof condHook) {
  condHook = f;
}

/** Павшие герои: по книге выбывают; по правилу «Форпост» — их приносят в храм. */
export function partyWiped(s: State): boolean {
  return !living(s).length;
}

export { die, leader, GM };
