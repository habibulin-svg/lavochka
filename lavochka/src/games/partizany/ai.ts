/* Партизаны — боты. Видят только свой view.
 * Лёгкий — почти наугад (партизан берёт себя в группу, предатель срывает всё). Средний — считает срывы на участников.
 * Сложный — перебирает все раскладки предателей, согласные с итогами операций и проверками, и взвешивает их (плюс голоса);
 * предатель-бот не срывает лишнего (один срыв, если хватает одного), поначалу иногда «помогает» ради доверия;
 * снайпер стреляет в того, кто вернее всех обходил предателей. */
import type { Rng } from '../../core/types';
import { checkable, sideOf, traitorsFor, type Action, type Role, type View } from './engine';

const pick = <T>(a: T[], rng: Rng): T => a[rng.int(a.length)];

function combos(a: number[], k: number): number[][] {
  if (k === 0) return [[]];
  if (a.length < k) return [];
  const [x, ...rest] = a;
  return [...combos(rest, k - 1).map((c) => [x, ...c]), ...combos(rest, k)];
}

/** Вероятность «x — предатель» с точки зрения me (null — только открытое). */
export function suspicion(v: View, me: number | null, level: number): Record<number, number> {
  const know = me != null ? v.know[me] ?? {} : {};
  const T = traitorsFor(v.seats.length);
  const out: Record<number, number> = {};
  const knownT = v.seats.filter((x) => know[x] && sideOf(know[x]) === 'T');
  // предатель и разведчик знают всех предателей
  if (me != null && (sideOf(know[me]) === 'T' || know[me] === 'scout')) {
    for (const x of v.seats) out[x] = knownT.includes(x) ? 1 : 0;
    return out;
  }
  const clean = me != null ? [me] : [];
  if (me != null) for (const c of v.checks) if (c.by === me && c.side === 'P') clean.push(c.target);
  const sure = me != null ? v.checks.filter((c) => c.by === me && c.side === 'T').map((c) => c.target) : [];
  const pool = v.seats.filter((x) => !clean.includes(x));

  if (level < 2) {
    // средний/лёгкий: срывы делятся на участников
    for (const x of v.seats) out[x] = clean.includes(x) ? 0 : sure.includes(x) ? 1 : T / Math.max(1, pool.length);
    if (level === 0) return out;
    const sc: Record<number, number> = {};
    for (const x of v.seats) sc[x] = 0;
    for (const o of v.ops) {
      if (o.fails == null) continue;
      const t = o.tries.find((r) => r.passed)!;
      const others = t.team.filter((x) => !clean.includes(x));
      for (const x of others) sc[x] += o.fails ? o.fails / others.length : -0.15;
    }
    for (const x of pool) if (!sure.includes(x)) out[x] = Math.min(0.97, Math.max(0.03, out[x] + sc[x] * 0.35));
    return out;
  }

  // сложный: все раскладки предателей среди «неясных»
  const need = T - sure.length;
  const rest = pool.filter((x) => !sure.includes(x));
  const w: Record<number, number> = {};
  for (const x of v.seats) w[x] = 0;
  let total = 0;
  for (const c of combos(rest, need)) {
    const set = new Set([...c, ...sure]);
    let p = 1;
    for (const o of v.ops) {
      if (o.fails == null) continue;
      const t = o.tries.find((r) => r.passed)!;
      const k = t.team.filter((x) => set.has(x)).length;
      if (o.fails > k) {
        p = 0;
        break;
      }
      // предатель в группе срывает с вероятностью ~0.75
      p *= o.fails ? Math.pow(0.75, o.fails) * Math.pow(0.6, k - o.fails) : Math.pow(0.3, k);
    }
    if (!p) continue;
    // голоса: кто утверждал группы, которые потом сорвались, и отвергал чистые
    for (const o of v.ops)
      for (const t of o.tries) {
        if (!t.votes) continue;
        const spyIn = t.team.some((x) => set.has(x));
        for (const [xs, yes] of Object.entries(t.votes)) {
          const x = +xs;
          if (!set.has(x)) continue;
          p *= spyIn === yes ? 1.08 : 0.94;
        }
      }
    // открытые заявления о проверках: правда партизана или ложь предателя
    for (const cl of v.claims) {
      if (cl.side == null) continue;
      const truth = set.has(cl.target) ? 'T' : 'P';
      if (!set.has(cl.by)) p *= truth === cl.side ? 1 : 0.02;
      else p *= truth === cl.side ? 0.6 : 0.9;
    }
    total += p;
    for (const x of set) w[x] += p;
  }
  for (const x of v.seats) out[x] = clean.includes(x) ? 0 : sure.includes(x) ? 1 : total ? w[x] / total : T / Math.max(1, pool.length);
  return out;
}

const roleOf = (v: View, me: number): Role => v.know[me]?.[me] ?? 'partisan';
const isT = (v: View, me: number, x: number) => !!v.know[me]?.[x] && sideOf(v.know[me][x]) === 'T';

function lowest(xs: number[], score: (x: number) => number, k: number): number[] {
  return xs
    .map((x) => [x, score(x)] as const)
    .sort((a, b) => a[1] - b[1])
    .slice(0, k)
    .map((p) => p[0]);
}

export function choose(v: View, me: number, level: number, rng: Rng): Action | null {
  const role = roleOf(v, me);
  const traitor = sideOf(role) === 'T';
  const op = v.ops[v.op];
  const noise = () => (level === 0 ? rng.next() * 0.9 : level === 1 ? rng.next() * 0.2 : rng.next() * 0.05);

  switch (v.phase) {
    case 'night':
      return { type: 'ready' };

    case 'propose': {
      const size = op.size;
      const others = v.seats.filter((x) => x !== me);
      if (level === 0) {
        const team = [me, ...others.sort(() => rng.next() - 0.5).slice(0, size - 1)];
        return { type: 'team', members: team };
      }
      if (traitor) {
        // себя и самых «чистых» в глазах стола, без других предателей
        const pub = suspicion(v, null, level);
        const libs = others.filter((x) => !isT(v, me, x));
        return { type: 'team', members: [me, ...lowest(libs, (x) => pub[x] + noise(), size - 1)] };
      }
      const s = suspicion(v, me, level);
      // разведчик знает всё, но сложный прячется: иногда берёт «серого»
      return { type: 'team', members: [me, ...lowest(others, (x) => s[x] + noise(), size - 1)] };
    }

    case 'vote': {
      const team = v.team;
      const inTeam = team.includes(me);
      if (v.rejects >= 4) return { type: 'vote', yes: !traitor || team.some((x) => isT(v, me, x)) };
      if (level === 0) return { type: 'vote', yes: inTeam || rng.next() < 0.55 };
      if (traitor) {
        const spies = team.filter((x) => isT(v, me, x)).length;
        if (spies >= op.need) return { type: 'vote', yes: true };
        // чистая группа: против, но не всегда (не выдать себя); сложный голосует как стол, пока счёт позволяет
        if (level >= 2) {
          const pub = suspicion(v, null, level);
          const risk = Math.max(...team.map((x) => pub[x]), 0);
          const late = v.ops.filter((o) => o.ok === true).length >= 2;
          return { type: 'vote', yes: !late && (v.op === 0 || risk < 0.25) && rng.next() < 0.7 };
        }
        return { type: 'vote', yes: v.op === 0 && rng.next() < 0.5 };
      }
      const s = suspicion(v, me, level);
      const risk = Math.max(...team.filter((x) => x !== me).map((x) => s[x]), 0);
      // первая попытка первой операции — данных нет, большинство соглашается
      if (v.op === 0 && v.rejects === 0) return { type: 'vote', yes: true };
      // сравнить с группой, которую набрал бы сам (себя и самых чистых): хуже неё — против
      const mine = lowest(v.seats.filter((x) => x !== me), (x) => s[x], op.size - 1);
      const best = Math.max(...mine.map((x) => s[x]), 0);
      const slack = v.rejects >= 3 ? 0.25 : 0.12;
      // сложный строже: группа с заметным риском не проходит, даже если лучше не набрать
      if (level >= 2 && v.rejects < 3) return { type: 'vote', yes: risk + noise() <= Math.min(best + 0.06, 0.42) };
      return { type: 'vote', yes: risk + noise() <= best + slack };
    }

    case 'mission': {
      if (!traitor) return { type: 'card', fail: false };
      if (level === 0) return { type: 'card', fail: true };
      const spies = v.team.filter((x) => isT(v, me, x));
      // решающая операция — срываем
      if (v.ops.filter((o) => o.ok === false).length === 2 || v.ops.filter((o) => o.ok === true).length === 2) {
        const order = spies.slice().sort((a, b) => a - b);
        return { type: 'card', fail: order.indexOf(me) < op.need };
      }
      if (spies.length < op.need) return { type: 'card', fail: false };
      // лишних срывов не надо: срывают первые по номеру
      const order = spies.slice().sort((a, b) => a - b);
      if (order.indexOf(me) >= op.need) return { type: 'card', fail: false };
      // сложный: в начале и в маленькой группе срыв почти выдаёт — иногда «помогает» ради доверия
      if (level >= 2 && v.op === 0 && rng.next() < 0.6) return { type: 'card', fail: false };
      if (level >= 2 && v.team.length === 2 && rng.next() < 0.5) return { type: 'card', fail: false };
      return { type: 'card', fail: true };
    }

    case 'check': {
      const c = checkable(v);
      if (!c.length) return null;
      if (level === 0 || traitor) return { type: 'check', target: traitor ? pick(c.filter((x) => !isT(v, me, x)).length ? c.filter((x) => !isT(v, me, x)) : c, rng) : pick(c, rng) };
      const s = suspicion(v, me, level);
      return { type: 'check', target: lowest(c, (x) => Math.abs(s[x] - 0.5) + noise(), 1)[0] };
    }

    case 'claim': {
      const c = v.checks.filter((x) => x.by === me).pop();
      if (!c) return { type: 'claim', side: null };
      if (!traitor || level === 0) return { type: 'claim', side: c.side };
      // предатель: своего обеляет, партизана иногда очерняет
      if (isT(v, me, c.target)) return { type: 'claim', side: 'P' };
      return { type: 'claim', side: rng.next() < (level >= 2 ? 0.4 : 0.25) ? 'T' : 'P' };
    }

    case 'hunt': {
      const cands = v.seats.filter((x) => !isT(v, me, x));
      if (!cands.length) return null;
      if (level === 0) return { type: 'shoot', target: pick(cands, rng) };
      // кто вернее всех обходил предателей: в своих группах и голосах
      const score: Record<number, number> = {};
      for (const x of cands) score[x] = 0;
      for (const o of v.ops)
        for (const t of o.tries) {
          const spyIn = t.team.some((x) => isT(v, me, x));
          if (t.leader in score) score[t.leader] += spyIn ? -1 : 1;
          if (t.votes) for (const [xs, yes] of Object.entries(t.votes)) if (+xs in score) score[+xs] += spyIn === !yes ? 0.6 : -0.4;
        }
      for (const cl of v.claims) if (cl.by in score && cl.side === 'T' && isT(v, me, cl.target)) score[cl.by] += 0.5;
      return { type: 'shoot', target: lowest(cands, (x) => -score[x] + noise() * 2, 1)[0] };
    }
  }
  return null;
}
