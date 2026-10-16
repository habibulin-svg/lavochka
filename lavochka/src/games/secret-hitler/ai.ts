/* Тайный Гитлер — боты. Видят только свой view.
 * Лёгкий — почти наугад (но либерал принимает либеральное). Средний — по своей роли и простым подозрениям (кто принимал фашистские законы).
 * Сложный — ведёт оценку подозрительности по законам, заявлениям (сверяет «пришло/передал/получил»), проверкам и голосам;
 * фашисты-боты врут правдоподобно: валят на колоду («пришло ФФФ»), на партнёра по сессии, «проверяют» своих как либералов. */
import type { Rng } from '../../core/types';
import { alive, eligible, fascistsFor, type Action, type Gov, type Party, type Role, type View } from './engine';

const fasCount = (cards: Party[] | undefined) => (cards ?? []).filter((c) => c === 'F').length;
const pick = <T>(a: T[], rng: Rng): T => a[rng.int(a.length)];
const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
const logit = (p: number) => Math.log(p / (1 - p));

/** Вероятность, что x — из фашистской партии (с точки зрения me; me = null — «как видит стол», только открытое). */
export function suspicion(v: View, me: number | null, level: number): Record<number, number> {
  const n = v.seats.length;
  const know = me != null ? v.know[me] ?? {} : {};
  const myRole: Role | undefined = me != null ? know[me] : undefined;
  const totalF = fascistsFor(n) + 1;
  const knownF = Object.entries(know).filter(([x, r]) => +x !== me && r !== 'liberal').length;
  const unknown = v.seats.filter((x) => x !== me && !(x in know)).length;
  const restF = Math.max(0, totalF - knownF - (myRole && myRole !== 'liberal' ? 1 : 0));
  const p0 = Math.min(0.9, Math.max(0.05, unknown ? restF / unknown : 0.3));
  const sc: Record<number, number> = {};
  for (const x of v.seats) sc[x] = 0;
  const add = (x: number, d: number) => (sc[x] += d);
  const certain: Record<number, number> = {};

  if (level >= 1) {
    for (const g of v.govs) evidence(v, g, me, level, add, certain);
  }
  // свои проверки — наверняка
  if (me != null) for (const r of v.inv) if (r.by === me) certain[r.target] = r.party === 'F' ? 1 : 0;

  const out: Record<number, number> = {};
  for (const x of v.seats) {
    if (x === me) out[x] = myRole && myRole !== 'liberal' ? 1 : 0;
    else if (x in know) out[x] = know[x] === 'liberal' ? 0 : 1;
    else if (x in certain) out[x] = certain[x];
    else if (restF === 0) out[x] = 0;
    else out[x] = sigmoid(logit(p0) + sc[x]);
  }
  return out;
}

function evidence(v: View, g: Gov, me: number | null, level: number, add: (x: number, d: number) => void, certain: Record<number, number>) {
  const pc = g.presClaim;
  const cc = g.chancClaim;
  const iAmPres = me === g.pres;
  const iAmChanc = me === g.chanc;
  if (g.policy === 'F') {
    add(g.pres, 0.5);
    add(g.chanc, 0.6);
    if (level >= 2) {
      if (pc && !pc.silent && pc.drew === 3) {
        add(g.pres, -0.35);
        add(g.chanc, -0.45);
      }
      if (pc && !pc.silent && cc && !cc.silent && pc.passed !== cc.got) {
        // заявления не сходятся — один из двоих врёт
        add(g.pres, 0.8);
        add(g.chanc, 0.8);
      } else if (pc && !pc.silent && pc.passed != null && pc.passed < 2 && cc && !cc.silent && cc.got === pc.passed) {
        // оба говорят, что у канцлера был либеральный, — а принят фашистский
        add(g.chanc, 1.6);
        add(g.pres, -0.3);
      }
      if (pc?.silent) add(g.pres, 0.5);
      if (cc?.silent) add(g.chanc, 0.5);
    }
  } else if (g.policy === 'L') {
    add(g.pres, -0.45);
    add(g.chanc, -0.45);
  }
  // своя сессия: я знаю правду
  if (iAmPres && g.gave) {
    const gaveF = fasCount(g.gave);
    if (g.policy === 'F' && gaveF < 2) certain[g.chanc] = 1;
    else if (cc && !cc.silent && cc.got !== gaveF) add(g.chanc, 3);
  }
  if (iAmChanc && g.gave) {
    const gotF = fasCount(g.gave);
    if (pc && !pc.silent && pc.passed !== gotF) add(g.pres, 3);
    // говорит, что пришёл либеральный, а мне отдал два фашистских — сам сбросил либеральный
    if (pc && !pc.silent && gotF === 2 && pc.drew != null && pc.drew < 3) add(g.pres, 1.5);
  }
  // голоса (сложный): кто поддержал фашистское правительство
  if (level >= 2 && g.votes && g.passed && g.policy) {
    for (const [x, ja] of Object.entries(g.votes)) {
      if (g.policy === 'F' && ja) add(+x, 0.15);
      if (g.policy === 'L' && !ja) add(+x, 0.12);
    }
  }
  // заявление о проверке
  const pw = g.powerClaim;
  if (g.power === 'investigate' && g.target != null && pw && !pw.silent && pw.party) {
    if (me != null && g.target === me && pw.party === 'F' && v.know[me]?.[me] === 'liberal') certain[g.pres] = 1;
    else if (g.target !== me) add(g.target, pw.party === 'F' ? 1.1 : -0.7);
  }
}

const roleOf = (v: View, me: number): Role => v.know[me]?.[me] ?? 'liberal';
/** Знает ли бот своих (фашист — всегда, Гитлер — в 5–6). */
const team = (v: View, me: number) => v.seats.filter((x) => x !== me && v.know[me]?.[x] && v.know[me][x] !== 'liberal');
const hitlerOf = (v: View, me: number) => v.seats.find((x) => v.know[me]?.[x] === 'hitler');
const isF = (v: View, me: number, x: number) => !!v.know[me]?.[x] && v.know[me][x] !== 'liberal';

function minBy<T>(a: T[], f: (x: T) => number): T {
  return a.reduce((b, x) => (f(x) < f(b) ? x : b));
}

export function choose(v: View, me: number, level: number, rng: Rng): Action | null {
  const role = roleOf(v, me);
  const fasci = role === 'fascist' || (role === 'hitler' && team(v, me).length > 0);
  const live = alive(v);
  const noise = () => (level === 0 ? rng.next() * 0.8 : level === 1 ? rng.next() * 0.25 : rng.next() * 0.08);
  const sus = () => suspicion(v, me, level);
  const pub = () => suspicion(v, null, level);
  const g = v.govs[v.govs.length - 1];

  switch (v.phase) {
    case 'night':
      return { type: 'ready' };

    case 'nominate': {
      const cands = eligible(v);
      if (!cands.length) return null;
      if (level === 0) return { type: 'nominate', target: role === 'liberal' || rng.next() < 0.5 ? pick(cands, rng) : (team(v, me).find((x) => cands.includes(x)) ?? pick(cands, rng)) };
      if (role === 'fascist' || (role === 'hitler' && fasci)) {
        const p = pub();
        const h = hitlerOf(v, me);
        if (v.fas >= 3 && h != null && h !== me && cands.includes(h) && (level >= 2 ? p[h] < 0.6 : rng.next() < 0.6)) return { type: 'nominate', target: h };
        const mates = team(v, me).filter((x) => cands.includes(x) && (v.fas < 3 || x !== h));
        if (mates.length && rng.next() < (level >= 2 ? 0.35 : 0.5)) return { type: 'nominate', target: minBy(mates, (x) => p[x]) };
        const libs = cands.filter((x) => !isF(v, me, x));
        return { type: 'nominate', target: minBy(libs.length ? libs : cands, (x) => p[x] + noise()) };
      }
      const s = sus();
      const risk = (x: number) => s[x] + (v.fas >= 3 && !v.notHitler.includes(x) ? 0.1 : 0) + noise();
      return { type: 'nominate', target: minBy(cands, risk) };
    }

    case 'vote': {
      const pres = v.pres;
      const chanc = v.chanc!;
      if (level === 0) return { type: 'vote', ja: role === 'liberal' ? rng.next() < 0.65 : isF(v, me, pres) || isF(v, me, chanc) || rng.next() < 0.5 };
      if (fasci) {
        const h = hitlerOf(v, me);
        if (v.fas >= 3 && chanc === h) return { type: 'vote', ja: true };
        if (isF(v, me, pres) || isF(v, me, chanc) || pres === me || chanc === me) return { type: 'vote', ja: level < 2 || rng.next() < 0.9 };
        // либеральное правительство: под конец — против, иначе как все
        if (v.lib >= (level >= 2 ? 2 : 3) && v.tracker < 2 && rng.next() < 0.7) return { type: 'vote', ja: false };
        const p = pub();
        return { type: 'vote', ja: Math.max(p[pres], p[chanc]) < 0.5 + noise() };
      }
      const s = sus();
      if (pres === me || chanc === me) {
        const other = pres === me ? chanc : pres;
        return { type: 'vote', ja: s[other] < 0.75 };
      }
      let thr = 0.45 + (role === 'hitler' ? 0.1 : 0);
      if (v.tracker === 2) thr += 0.2;
      if (v.fas >= 3 && !v.notHitler.includes(chanc)) thr -= 0.08;
      if (v.fas >= 5) thr -= 0.05;
      return { type: 'vote', ja: Math.max(s[pres], s[chanc]) + noise() * 0.5 < thr };
    }

    case 'pres': {
      const hand = v.hand ?? [];
      if (!hand.length) return null;
      const iF = hand.indexOf('F');
      const iL = hand.indexOf('L');
      const discardF = { type: 'discard', index: iF >= 0 ? iF : 0 } as Action;
      const discardL = { type: 'discard', index: iL >= 0 ? iL : 0 } as Action;
      if (level === 0) return role === 'liberal' && rng.next() < 0.7 ? discardF : { type: 'discard', index: rng.int(hand.length) };
      if (role === 'liberal' || (role === 'hitler' && !fasci)) return role === 'hitler' && rng.next() < 0.2 ? discardL : discardF;
      if (role === 'hitler') return rng.next() < 0.75 ? discardF : discardL;
      const mate = isF(v, me, v.chanc!);
      if (mate || v.lib >= 4 || v.fas >= 5) return discardL;
      // либеральный канцлер: поначалу притвориться либералом
      const pL = level >= 2 ? (v.fas < 2 ? 0.7 : 0.9) : 0.6;
      return rng.next() < pL ? discardL : discardF;
    }

    case 'chanc': {
      const hand = v.hand ?? [];
      if (!hand.length) return null;
      const iF = hand.indexOf('F');
      const iL = hand.indexOf('L');
      const enactF = { type: 'enact', index: iF >= 0 ? iF : 0 } as Action;
      const enactL = { type: 'enact', index: iL >= 0 ? iL : 0 } as Action;
      const canVeto = v.fas >= 5 && !v.vetoDenied;
      if (role === 'liberal' || (role === 'hitler' && !fasci)) {
        if (level >= 1 && canVeto && iL < 0) return { type: 'veto' };
        if (level === 0 && rng.next() < 0.2) return { type: 'enact', index: rng.int(hand.length) };
        if (role === 'hitler' && (v.fas >= 5 || v.lib >= 4)) return enactF;
        return role === 'hitler' && rng.next() < 0.15 ? enactF : enactL;
      }
      if (level === 0) return rng.next() < 0.6 ? enactF : enactL;
      if (v.fas >= 5 || v.lib >= 4 || isF(v, me, v.pres)) return enactF;
      if (role === 'hitler') return rng.next() < 0.3 ? enactF : enactL;
      const pF = level >= 2 ? (v.fas < 2 ? 0.8 : 0.95) : 0.75;
      return rng.next() < pF ? enactF : enactL;
    }

    case 'veto': {
      const hand = v.hand ?? [];
      const hasL = hand.includes('L');
      if (level === 0) return { type: 'vetoAnswer', yes: rng.next() < 0.5 };
      return { type: 'vetoAnswer', yes: fasci ? !hand.includes('F') : !hasL };
    }

    case 'power': {
      const others = live.filter((x) => x !== me);
      switch (v.power) {
        case 'peek':
          return { type: 'peek' };
        case 'investigate': {
          const c = others.filter((x) => !v.investigated.includes(x));
          const list = c.length ? c : others;
          if (level === 0) return { type: 'investigate', target: pick(list, rng) };
          if (fasci) {
            const p = pub();
            const libs = list.filter((x) => !isF(v, me, x));
            return { type: 'investigate', target: minBy(libs.length ? libs : list, (x) => p[x] + noise()) };
          }
          const s = sus();
          // самый неясный: ближе всех к середине, при равенстве — подозрительнее
          return { type: 'investigate', target: minBy(list, (x) => Math.abs(s[x] - 0.55) + noise()) };
        }
        case 'special': {
          if (level === 0) return { type: 'special', target: pick(others, rng) };
          if (fasci) {
            const mates = team(v, me).filter((x) => others.includes(x));
            if (mates.length) return { type: 'special', target: pick(mates, rng) };
          }
          const s = fasci ? pub() : sus();
          return { type: 'special', target: minBy(others, (x) => s[x] + noise()) };
        }
        case 'kill': {
          if (level === 0) return { type: 'kill', target: pick(others, rng) };
          if (fasci) {
            const p = pub();
            const libs = others.filter((x) => !isF(v, me, x));
            return { type: 'kill', target: minBy(libs.length ? libs : others, (x) => p[x] + noise()) };
          }
          const s = sus();
          return { type: 'kill', target: minBy(others, (x) => -s[x] - (v.notHitler.includes(x) ? 0 : 0.1) + noise()) };
        }
      }
      return null;
    }

    case 'claim':
      return claim(v, me, g, level, fasci, rng);
  }
  return null;
}

function claim(v: View, me: number, g: Gov, level: number, fasci: boolean, rng: Rng): Action {
  const lie = fasci || roleOf(v, me) === 'hitler';
  // заявление о проверке / трёх верхних
  if (g.presClaim && me === g.pres && (g.power === 'investigate' || g.power === 'peek') && !g.powerClaim) {
    if (g.power === 'investigate') {
      const r = v.inv.find((x) => x.by === me && x.target === g.target);
      const truth: Party = r?.party ?? 'L';
      if (!lie || level === 0) return { type: 'claim', party: truth };
      if (isF(v, me, g.target!)) return { type: 'claim', party: 'L' };
      // либерала — подставить (сложный — чаще)
      return { type: 'claim', party: rng.next() < (level >= 2 ? 0.55 : 0.3) ? 'F' : truth };
    }
    const pk = v.peeks.filter((x) => x.by === me).pop();
    return { type: 'claim', fas: fasCount(pk?.cards) };
  }
  const drew = fasCount(g.drew);
  const gave = fasCount(g.gave);
  if (me === g.pres && !g.presClaim) {
    if (!lie || level === 0 || g.policy !== 'F') return { type: 'claim', drew, passed: gave };
    // фашистский принят: свалить на колоду — «пришло ФФФ», если канцлер свой, иначе честно о переданном и «сбросил Ф»
    if (isF(v, me, g.chanc)) return { type: 'claim', drew: 3, passed: 2 };
    return { type: 'claim', drew: Math.min(3, gave + 1), passed: gave };
  }
  // канцлер
  if (!lie || level === 0 || g.policy !== 'F') return { type: 'claim', got: gave };
  return { type: 'claim', got: 2 };
}
