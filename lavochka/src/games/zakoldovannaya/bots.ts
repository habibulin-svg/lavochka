/* Боты «Заколдованной страны»: герой (лёгкий — бесшабашный, средний, сложный — бережёт себя, ищет потайные двери,
 * лечится, бьёт слабых) и ведущий (бросает за опасности, решает «по усмотрению ведущего»). Бот видит только свой view. */
import type { Rng } from '../../core/types';
import { CLASSES, SPELL } from './book';
import { turnSet } from './combat';
import type { Action, View } from './engine';
import { autoCreate } from './engine';
import { meleeAttack, missileAttacks, type Hero } from './hero';
import { spellsOfLevel } from './heroact';
import { MONSTER, special } from './monsters';
import { GM } from './state';
import { CAMPAIGNS, sceneByKey } from './content';
import { ADJ, MAP, nodeOfSite, planOf, route, siteAt, siteTitle } from './world';

export const LEVELS = ['Лёгкий', 'Средний', 'Сложный'];

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  if (seat === GM) return gmBot(v, rng);
  const h = v.heroes.find((x) => x.seat === seat);
  if (!h) return null;
  if (v.phase === 'create') return autoCreate(h);
  if (v.combat) return combatBot(v, h, level, rng);
  const wt = v.scene?.wait;
  if (wt) {
    if (wt.k === 'ask') {
      // ночлег выбирают за самого раненого в отряде
      const worst = v.heroes.filter((x) => !x.dead && !x.stone && x.cls).reduce((a, x) => (x.hp / x.hpMax < a.hp / a.hpMax ? x : a), h);
      // что уже выбирали недавно (меню по кругу, переходы туда-сюда) — реже
      const recent = v.story.slice(-80).map((e) => e.text);
      const opts = (wt.opts ?? []).map((o) => {
        const n = recent.filter((t) => t?.endsWith(`«${o.text}»`)).length;
        return n >= 2 ? { ...o, bot: (o.bot ?? 1) * 0.1 ** (n - 1) } : o;
      });
      return { t: 'answer', i: pickOpt(opts, level, worst, rng, v.scene!.asks) };
    }
    if (wt.k === 'roll') return { t: 'roll' };
    if (wt.k === 'shop') return shopBot(v, h, level);
    if (wt.k === 'gamble') {
      const g = wt.game;
      if (level >= 1 && g.game !== 'hp' && h.gold >= 20 && !(g.stakes[seat] >= 2)) return { t: 'bet', n: 5, ...(g.game === 'cards' ? { picks: [1 + rng.int(6), ((rng.int(5) + 1 + rng.int(6)) % 6) + 1].filter((x, i, a) => a.indexOf(x) === i) } : {}) };
      return { t: 'gamble-quit' };
    }
    return null;
  }
  const pend = h.pending[0];
  if (pend?.kind === 'hp') return { t: 'lvl-hp' };
  if (pend?.kind === 'spell') {
    const list = spellsOfLevel(pend.level);
    const useful = list.find((s) => /heal|kill|escape|ward/.test(s.kind)) ?? list[0];
    return { t: 'lvl-spell', id: useful.id };
  }
  if (v.party.leader !== seat && v.heroes.some((x) => x.seat === v.party.leader && !x.dead && !x.stone)) return null;
  return leaderBot(v, h, level, rng);
}

const LEAVE = /уйти|выйти|уходи|дальше|отказ|не (пить|брать|трогать|играть|давать|ходить)|пройти мимо|отступить|хватит|встать|в путь/i;

function pickOpt(opts: { i: number; text: string; bot?: number; risky?: boolean }[], level: number, h: Hero, rng: Rng, asks = 0): number {
  // меню по кругу: после нескольких ответов — к выходу
  if (asks >= 5) {
    const out = opts.find((o) => LEAVE.test(o.text));
    if (out) return out.i;
    if (asks >= 12) return opts[opts.length - 1].i;
  }
  // ранен — к ночлегу, если он есть среди вариантов
  if (h.hp < h.hpMax * 0.6) {
    const inn = opts.find((o) => /ночлег|переночевать|отдохнуть|комнату/i.test(o.text));
    if (inn) return inn.i;
  }
  const careful = level >= 1 && h.hp < h.hpMax * 0.5;
  const weights = opts.map((o) => Math.max(0, (o.bot ?? 1) * (o.risky && (careful || level === 2) ? 0.2 : 1)));
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum <= 0) return opts[0].i;
  if (level === 2) return opts[weights.indexOf(Math.max(...weights))].i;
  let r = rng.next() * sum;
  for (let k = 0; k < opts.length; k++) {
    r -= weights[k];
    if (r <= 0) return opts[k].i;
  }
  return opts[opts.length - 1].i;
}

function shopBot(v: View, h: Hero, level: number): Action {
  const wt = v.scene!.wait!;
  if ((wt as { done?: number[] }).done?.includes(h.seat)) return { t: 'shop-done' };
  const shop = v.scene!.shop as { kind?: string; stock?: { id: string; price: number }[] } | undefined;
  if (level >= 1 && shop?.kind === 'trurl') {
    if (!h.eq.armor && h.gold >= 30) return { t: 'buy', id: h.cls === 'mag' ? 'kozha' : 'kozha_silver' };
    if (h.eq.launcher === 'bow_short' && h.gold >= 5 && !h.items.some((x) => x.id === 'arrow_short' && x.n >= 6)) return { t: 'buy', id: 'arrow_short', n: 5 };
    if (!h.items.some((x) => x.id === 'sack') && h.gold > 60) return { t: 'buy', id: 'sack' };
  }
  return { t: 'shop-done' };
}

// ---------- бой

function combatBot(v: View, h: Hero, level: number, rng: Rng): Action {
  const cm = v.combat!;
  if (cm.phase === 'init') return { t: 'init' };
  if (cm.phase === 'saves') return { t: 'save' };
  if (cm.strike?.seat === h.seat) return { t: 'strike' };
  const all = cm.foes.filter((f) => !f.dead && !f.fled);
  if (!all.length) return { t: 'pass' };
  // оружие не берёт (только заклинанием, неуязвим к мечу/топору) — таких не бьём; одни такие — уходим
  const wid = meleeAttack(h).id;
  const foes = all.filter((f) => {
    const m = MONSTER[f.m];
    if (special(m, 'spellOnly')) return false;
    const im = special(m, 'weaponImmune');
    return !im?.weapons?.some((w) => (w.includes('меч') && /sword/.test(wid)) || (w.includes('топор') && /axe/.test(wid)));
  });
  if (!foes.length) {
    const sp = h.spells.find((s) => /^(kill|escape|repel|fear|fireball)/.test(SPELL[s.id]?.kind ?? '') && (s.left ?? 1) > 0);
    if (sp) return { t: 'cast', id: sp.id, target: all[0].uid };
    const shootable = all.find((f) => !special(MONSTER[f.m], 'spellOnly'));
    if (shootable && missileAttacks(h).length) return { t: 'shoot', i: 0, target: shootable.uid };
    return cm.noFlee || cm.phase === 'volley' ? { t: 'pass' } : { t: 'flee' };
  }
  // слабейший (по ранам) — добить
  const target = level >= 1 ? [...foes].sort((a, b) => b.hurt - a.hurt || (a.hp ?? 0) - (b.hp ?? 0))[0] : foes[rng.int(foes.length)];
  const miss = missileAttacks(h);
  if (cm.phase === 'volley') return miss.length ? { t: 'shoot', i: 0, target: target.uid } : { t: 'pass' };
  // бегство, когда плохо
  if (level >= 1 && !cm.noFlee && h.hp <= Math.max(2, h.hpMax * (level === 2 ? 0.35 : 0.2))) {
    const heal = h.items.find((x) => x.id === 'bottle' && x.known && x.bottle && [5, 6, 7, 8, 10].includes(x.bottle));
    if (heal) return { t: 'drink', bottle: heal.bottle! };
    const esc = h.spells.find((s) => /escape/.test(SPELL[s.id]?.kind ?? '') && (s.left ?? 1) > 0);
    if (esc) return { t: 'cast', id: esc.id };
    return { t: 'flee' };
  }
  // заклинания: молния, луч — по сильному
  if (level === 2) {
    const big = [...foes].sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0];
    const kill = h.spells.find((s) => /^kill|web|weaken/.test(SPELL[s.id]?.kind ?? '') && (s.left ?? 1) > 0);
    if (kill && big) return { t: 'cast', id: kill.id, target: big.uid };
    const tk = h.cls ? CLASSES[h.cls].turn : undefined;
    if (tk && foes.some((f) => turnSet(tk).has(f.m))) return { t: 'turn' };
  }
  if (miss.length && (level === 0 || !h.eq.melee || meleeAttack(h).dmg.length < 3)) return { t: 'shoot', i: 0, target: target.uid };
  return { t: 'attack', target: target.uid };
}

// ---------- вожак: куда идти

/** Сюжетные цели кампаний — как игрок читает дневник: открытое задание (и его текущая запись) → место и ключевые комнаты.
 * Из открытых берётся самая ранняя ступень (tier), среди её мест — ближайшее, где ещё есть дело. */
interface Goal {
  q: string;
  re?: RegExp;
  not?: RegExp;
  site: string;
  rooms?: string[];
  tier: number;
}
const GOALS: Record<string, Goal[]> = {
  k1: [
    { q: 'part1', site: 'c1', rooms: ['5', '6'], tier: 1 },
    { q: 'part2', site: 'c2', rooms: ['8'], tier: 1 },
    { q: 'part3', site: 'c12', rooms: ['11'], tier: 1 },
    { q: 'red', site: 'k1-forge', rooms: ['smithy', 'furnace', 'boys'], tier: 2 },
    { q: 'red', not: /у вас есть|дал согласие/, site: 'c9', rooms: ['2'], tier: 2 },
    { q: 'fin', site: 'c10', rooms: ['32', '37'], tier: 3 },
    { q: 'staff', re: /выкован/, site: 'c10', rooms: ['32', '37'], tier: 3 },
  ],
  k2: [
    { q: 'dog', site: 'k2-zavod', tier: 1 },
    { q: 'dog', re: /мельниц/, site: 'k2-mill', tier: 2 },
    { q: 'ck', site: 'c4', rooms: ['5.1', '5.2', '5.3', '5.6', '4'], tier: 3 },
    { q: 'nord', site: 'k2-zastava', tier: 4 },
    { q: 'grd', site: 'c7', rooms: ['18', '15', '3'], tier: 5 },
    { q: 'hot', site: 'c8', rooms: ['3', '18'], tier: 6 },
    { q: 'nor', site: 'k2-usadba', tier: 7 },
    { q: 'nor', site: 'k2-nora', tier: 7 },
    { q: 'sud', site: 'c7', tier: 8 },
  ],
  k3: [
    { q: 'smith', site: 'k3-kuznya', tier: 1 },
    { q: 'white', re: /у нас/, site: 'k3-kuznya', tier: 1 },
    { q: 'white', not: /у нас/, site: 'c1', rooms: ['2'], tier: 1 },
    { q: 'zapl', site: 'k3-zaplatki', tier: 2 },
    { q: 'gnomes', site: 'c13', rooms: ['1'], tier: 3 },
    { q: 'gnomes', site: 'c12', rooms: ['42'], tier: 3 },
    { q: 'gnomes', site: 'c9', rooms: ['17'], tier: 3 },
    { q: 'gnomes', site: 'c14', rooms: ['11'], tier: 3 },
    { q: 'gnomes', site: 'c6', rooms: ['20'], tier: 3 },
    { q: 'ugolki', site: 'k3-ugolki', tier: 4 },
    { q: 'pass', site: 'k3-pass', tier: 5 },
    { q: 'gold', site: 'k3-nora', tier: 6 },
    { q: 'main', re: /Золотую нору/, site: 'k3-nora', tier: 6 },
    { q: 'final', re: /Собрать совет/, site: 'k3-kuznya', tier: 7 },
    { q: 'final', not: /Собрать совет/, site: 'c9', rooms: ['25', '27'], tier: 7 },
  ],
};

/** Дело в комнате сделано: сцена (с подменой кампании) сыграна до конца, а сцена-меню без конца — побывали в ней
 * после последней записи задания в дневнике. */
function roomDone(v: View, site: string, room: string, text: string): boolean {
  const over = CAMPAIGNS[v.mode]?.rooms?.[`${site}:${room}`];
  const key = over ? `camp:${v.mode}:${over}` : `site:${site}:${room}`;
  const sc = sceneByKey(key, v.mode);
  if (!sc) return v.world.visited.includes(`${site}:${room}`);
  if (v.world.done.includes(key)) return true;
  return !!sc.title && (seenSince(v, text, (e) => e.k === 'title' && e.text === sc.title, () => false) || wroteIn(v, text, sc.title));
}

/** Запись в дневник сделала сама эта сцена (ближайший заголовок перед записью — её). */
function wroteIn(v: View, text: string, title: string): boolean {
  let at = v.story.length - 1;
  while (at >= 0 && !(v.story[at].k === 'sys' && v.story[at].text === `Дневник: ${text}`)) at--;
  while (at >= 0 && v.story[at].k !== 'title') at--;
  return at >= 0 && v.story[at].text === title;
}

/** Было ли в журнале что-то после последней записи задания в дневнике (запись ушла из журнала — решает old). */
function seenSince(v: View, text: string, hit: (e: View['story'][number]) => boolean, old: () => boolean): boolean {
  let at = v.story.length - 1;
  while (at >= 0 && !(v.story[at].k === 'sys' && v.story[at].text === `Дневник: ${text}`)) at--;
  if (at < 0) return old();
  for (let i = at + 1; i < v.story.length; i++) if (hit(v.story[i])) return true;
  return false;
}

/** Место-меню (без плана) выход не считает — заходили ли туда после последней записи задания в дневнике. */
function cameSince(v: View, text: string, site: string): boolean {
  const title = siteTitle(v as never, site);
  return seenSince(v, text, (e) => e.k === 'title' && e.text === title, () => v.world.visited.some((x) => x.startsWith(site + ':')));
}

/** Текущие сюжетные цели: место → ключевые комнаты, где ещё не было дела (пустой список — просто зайти). */
function storyGoals(v: View): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const list = GOALS[v.mode];
  if (!list) return out;
  const open = new Map(v.world.quests.filter((q) => !q.done).map((q) => [q.id, q.text]));
  let tier = Infinity;
  for (const g of list) {
    const text = open.get(g.q);
    if (text == null || g.tier > tier) continue;
    if (g.re && !g.re.test(text)) continue;
    if (g.not && g.not.test(text)) continue;
    const left = Number(v.world.flags?.[`left:${g.site}`] ?? 0);
    const rooms = (g.rooms ?? []).filter((r) => !roomDone(v, g.site, r, text));
    // ключевые комнаты пройдены — здесь делать нечего; без комнат — зайти, пока не выходили (сцены-меню — один раз)
    const pending = g.rooms ? rooms.length > 0 && left < 6 : planOf(v as never, g.site) ? left < 3 : !cameSince(v, text, g.site);
    if (!pending) continue;
    if (g.tier < tier) {
      tier = g.tier;
      out.clear();
    }
    out.set(g.site, [...(out.get(g.site) ?? []), ...rooms]);
  }
  return out;
}

function leaderBot(v: View, h: Hero, level: number, rng: Rng): Action | null {
  const where = v.where;
  const s = v as unknown as Parameters<typeof planOf>[0];
  const live = v.heroes.filter((x) => !x.dead && !x.stone && x.cls);
  // отдыхать в Форпосте имеет смысл, только если ночлег лечит и у раненых есть 5 монет (лёгкий терпит дольше)
  const canRest = v.opts.rest !== 'off';
  const hurt = (k: number) => {
    const low = live.filter((x) => x.hp < x.hpMax * k);
    // ночлег в меню виден тому, кто отвечает (вожаку), — и у него должны быть деньги
    return canRest && low.length > 0 && low.every((x) => x.gold >= 5) && h.gold >= 5;
  };
  const allHurt = hurt(level ? 0.5 : 0.3);
  // павших несут в храм Форпоста (по правилу «Форпост»), если хватает на воскрешение
  const revive = v.opts.death === 'forpost' && v.heroes.some((x) => x.dead && x.cls) && v.heroes.reduce((a, x) => a + (x.dead ? 0 : x.gold), 0) >= 100;
  if (where.k === 'site') {
    const plan = planOf(s, where.site);
    if (!plan) return null;
    const visited = new Set(v.world.visited.filter((x) => x.startsWith(where.site + ':')).map((x) => x.slice(where.site.length + 1)));
    // в бедственном положении — к выходу

    // ближайшая непройденная комната по известным ходам
    const open = (l: { a: string; b: string; kind: string }) => l.kind !== 'secret' || v.world.opened.includes(`${where.site}:${l.a}>${l.b}`);
    const adj = (r: string) => (r === where.room ? v.exits.filter((e) => !e.hidden).map((e) => e.to) : plan.links.filter((l) => (l.a === r || l.b === r) && open(l)).map((l) => (l.a === r ? l.b : l.a)));
    // сюжет: сперва ключевые комнаты (хоть и пройденные — сцена ещё не сыграна), потом непройденные
    const goalsNow = storyGoals(v);
    const key = new Set(goalsNow.get(where.site) ?? []);
    // кампания: слабый отряд (до 3-го уровня) не зачищает книжный замок, где сюжетных дел нет, — к выходу
    const timid = !!GOALS[v.mode] && /^c\d+$/.test(where.site) && !goalsNow.has(where.site) && Math.max(...live.map((x) => x.level)) < 3;
    const wantOut = hurt(level ? 0.35 : 0.25) || revive || timid;
    const target = wantOut ? (r: string) => plan.entry.includes(r) : key.size ? (r: string) => key.has(r) : (r: string) => !visited.has(r);
    if (wantOut && plan.entry.includes(where.room)) return { t: 'leave' };
    const prev = new Map<string, string | null>([[where.room, null]]);
    const q = [where.room];
    let found: string | null = null;
    while (q.length && !found) {
      const r = q.shift()!;
      for (const n of adj(r)) {
        if (prev.has(n)) continue;
        prev.set(n, r);
        if (target(n)) {
          found = n;
          break;
        }
        q.push(n);
      }
    }
    if (!found && key.size && !wantOut) {
      // до ключевой комнаты не дойти известными ходами — обычный обход
      const q3 = [where.room];
      const seen = new Map<string, string | null>([[where.room, null]]);
      while (q3.length && !found) {
        const r = q3.shift()!;
        for (const n of adj(r)) {
          if (seen.has(n)) continue;
          seen.set(n, r);
          prev.set(n, r);
          if (!visited.has(n)) {
            found = n;
            break;
          }
          q3.push(n);
        }
      }
    }
    if (found) {
      let step = found;
      while (prev.get(step) && prev.get(step) !== where.room) step = prev.get(step)!;
      return { t: 'room', id: step };
    }
    // искать потайную дверь (сложный и средний — в тупиках)
    const tried = (v.world.flags?.[`${where.site}:${where.room}:search`] as string | undefined) ?? '';
    if (level >= 1 && !tried.split(',').includes(String(h.seat)) && v.exits.length <= 1 && rng.int(3) > 0) return { t: 'search' };
    if (plan.entry.includes(where.room)) return { t: 'leave' };
    // к выходу
    const back = new Map<string, string | null>([[where.room, null]]);
    const q2 = [where.room];
    let ex: string | null = null;
    while (q2.length && !ex) {
      const r = q2.shift()!;
      for (const n of adj(r)) {
        if (back.has(n)) continue;
        back.set(n, r);
        if (plan.entry.includes(n)) {
          ex = n;
          break;
        }
        q2.push(n);
      }
    }
    if (ex) {
      let step = ex;
      while (back.get(step) && back.get(step) !== where.room) step = back.get(step)!;
      return { t: 'room', id: step };
    }
    // выхода не видно (завели сценой или потайным ходом) — искать дверь, иначе бродить
    if (!tried.split(',').includes(String(h.seat))) return { t: 'search' };
    const ways = v.exits.filter((e) => !e.hidden);
    return ways.length ? { t: 'room', id: ways[rng.int(ways.length)].to } : { t: 'search' };
  }
  // на карте
  const node = where.node;
  const siteHere = siteAt(s, node);
  const unfinished = (site: string) => {
    const plan = planOf(s, site);
    if (!plan) return false;
    // дважды вышли — больше ничего не найдём
    if (Number(v.world.flags?.[`left:${site}`] ?? 0) >= 2) return false;
    const seen = v.world.visited.filter((x) => x.startsWith(site + ':')).length;
    return seen < plan.rooms.length * 0.6;
  };
  // отдохнуть в Форпосте
  if (allHurt || revive) {
    if (node === MAP.start) return { t: 'enter' };
    const r = route(node, MAP.start);
    if (r) return { t: 'go', path: r.slice(0, 7) };
  }
  // сюжетная цель кампании — ближайшее место, где ещё есть дело
  const goals = storyGoals(v);
  if (siteHere && goals.has(siteHere)) return { t: 'enter' };
  let way: number[] | null = null;
  for (const site of goals.keys()) {
    const n = nodeOfSite(s, site);
    const r = n == null ? null : route(node, n);
    if (r && (!way || r.length < way.length)) way = r;
  }
  if (way && way.length > 1) return { t: 'go', path: way.slice(0, 8) };
  if (siteHere && siteHere !== 'forpost' && unfinished(siteHere)) return { t: 'enter' };
  // ближайший непройденный замок; Чёрного мага — в последнюю очередь
  const order = v.world.slots.filter((x) => x && unfinished(x) && x !== 'c10');
  const goal = order.length ? order : ['c10'];
  let best: number[] | null = null;
  for (const site of goal) {
    const n = nodeOfSite(s, site);
    if (n == null) continue;
    const r = route(node, n);
    if (r && (!best || r.length < best.length)) best = r;
  }
  if (best && best.length > 1) return { t: 'go', path: best.slice(0, 8) };
  if (siteHere && siteHere !== 'forpost' && Number(v.world.flags?.[`left:${siteHere}`] ?? 0) < 4) return { t: 'enter' };
  const nb = ADJ[node];
  return { t: 'go', path: [node, nb[rng.int(nb.length)]] };
}

// ---------- ведущий

function gmBot(v: View, rng: Rng): Action | null {
  const cm = v.combat;
  if (cm) {
    if (cm.phase === 'init') return { t: 'gm-init' };
    if (cm.phase === 'foes') return { t: 'gm-foes' };
    return null;
  }
  const wt = v.scene?.wait;
  if (wt?.k === 'ask') {
    const opts = wt.opts ?? [];
    return { t: 'answer', i: opts[rng.int(opts.length)].i };
  }
  return null;
}
