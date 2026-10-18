/* Боты «Заколдованной страны»: герой (лёгкий — бесшабашный, средний, сложный — бережёт себя, ищет потайные двери,
 * лечится, бьёт слабых) и ведущий (бросает за опасности, решает «по усмотрению ведущего»). Бот видит только свой view. */
import type { Rng } from '../../core/types';
import { CLASSES, SPELL } from './book';
import { turnSet } from './combat';
import type { Action, View } from './engine';
import { autoCreate } from './engine';
import { meleeAttack, missileAttacks, type Hero } from './hero';
import { spellsOfLevel } from './heroact';
import { GM } from './state';
import { ADJ, MAP, nodeOfSite, planOf, route } from './world';

export const LEVELS = ['Лёгкий', 'Средний', 'Сложный'];

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  if (seat === GM) return gmBot(v, rng);
  const h = v.heroes.find((x) => x.seat === seat);
  if (!h) return null;
  if (v.phase === 'create') return autoCreate(h);
  if (v.combat) return combatBot(v, h, level, rng);
  const wt = v.scene?.wait;
  if (wt) {
    if (wt.k === 'ask') return { t: 'answer', i: pickOpt(wt.opts ?? [], level, h, rng, v.scene!.asks) };
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
  const foes = cm.foes.filter((f) => !f.dead && !f.fled);
  if (!foes.length) return { t: 'pass' };
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

function leaderBot(v: View, h: Hero, level: number, rng: Rng): Action | null {
  const where = v.where;
  const s = v as unknown as Parameters<typeof planOf>[0];
  const live = v.heroes.filter((x) => !x.dead && !x.stone && x.cls);
  // отдыхать в Форпосте имеет смысл, только если ночлег лечит и у всех есть 5 монет
  const allHurt = live.every((x) => x.hp < x.hpMax * 0.5) && live.every((x) => x.gold >= 5);
  if (where.k === 'site') {
    const plan = planOf(s, where.site);
    if (!plan) return null;
    const visited = new Set(v.world.visited.filter((x) => x.startsWith(where.site + ':')).map((x) => x.slice(where.site.length + 1)));
    // в бедственном положении — к выходу
    const wantOut = level >= 1 && allHurt && v.opts.rest !== 'off';
    // ближайшая непройденная комната по известным ходам
    const adj = (r: string) => (r === where.room ? v.exits.filter((e) => !e.hidden).map((e) => e.to) : plan.links.filter((l) => (l.a === r || l.b === r) && l.kind !== 'secret').map((l) => (l.a === r ? l.b : l.a)));
    const target = wantOut ? (r: string) => plan.entry.includes(r) : (r: string) => !visited.has(r);
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
    return { t: 'leave' };
  }
  // на карте
  const node = where.node;
  const siteHere = v.world.slots[MAP.castles.indexOf(node)] ?? (node === MAP.start ? 'forpost' : null);
  const unfinished = (site: string) => {
    const plan = planOf(s, site);
    if (!plan) return false;
    // дважды вышли — больше ничего не найдём
    if (Number(v.world.flags?.[`left:${site}`] ?? 0) >= 2) return false;
    const seen = v.world.visited.filter((x) => x.startsWith(site + ':')).length;
    return seen < plan.rooms.length * 0.6;
  };
  // отдохнуть в Форпосте
  if (level >= 1 && allHurt && v.opts.rest !== 'off') {
    if (node === MAP.start) return { t: 'enter' };
    const r = route(node, MAP.start);
    if (r) return { t: 'go', path: r.slice(0, 7) };
  }
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
