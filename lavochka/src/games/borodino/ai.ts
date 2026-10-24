/* «Бородино» — боты. Французы наступают: подводят части к русским, ставят батареи на 2–3 клетки, атакуют там, где ожидаемый исход
 * в их пользу. Русские обороняются: держат позиции, подтягивают резервы к угрожаемым местам, контратакуют выгодно.
 * Лёгкий — ходит почти наугад и атакует при равных шансах; средний — по оценке шансов таблицы; сложный — ещё и подбирает
 * наименьший достаточный состав атаки, ведёт части командующими и держит резервы. */
import type { Rng } from '../../core/types';
import { center, dist, isForest, isRedoubt, isShrub, isVillage, level as hexLevel, neighbors } from './hex';
import { alive, canJoin, canTarget, CRT_TABLE, crtCol, FR, inZoc, isCombat, leader, obliged, odds, reach, side, strengthOf, U, unitAt, type Action, type Res, type State } from './engine';
import { commands } from './units';

const enemies = (v: State, sd: number) => U.map((_, i) => i).filter((i) => side(i) !== sd && isCombat(i) && alive(v, i));
const mine = (v: State, sd: number) => U.map((_, i) => i).filter((i) => side(i) === sd && alive(v, i));

/** Ожидаемый исход атаки: выигрыш минус потери (в очках силы). */
function expect(v: State, att: number[], def: number): number {
  const o = odds(v, att, def);
  const col = crtCol(o.diff);
  const ds = strengthOf(v, def);
  const dh = v.u[def].hex;
  const adj = att.filter((i) => dist(v.u[i].hex, dh) === 1);
  const as = adj.reduce((a, i) => a + U[i].str, 0);
  const minA = adj.length ? Math.min(...adj.map((i) => U[i].str)) : 0;
  let e = 0;
  for (let r = 0; r < 6; r++) {
    const res: Res = CRT_TABLE[r][col];
    const val: Record<Res, number> = {
      ЗУ: ds + 2,
      З2: ds * 0.45 + 1,
      З1: ds * 0.3 + 0.5,
      А1: -as * 0.12,
      А2: -as * 0.2,
      АУ: -as,
      '*': ds - minA,
    };
    e += val[res];
  }
  return e / 6;
}

function attackers(v: State, def: number): number[] {
  const out: number[] = [];
  for (const i of mine(v, v.side)) if (isCombat(i) && canJoin(v, i, def) === null) out.push(i);
  return out;
}

function chooseAttack(v: State, level: number, rng: Rng): Action | null {
  const must = obliged(v);
  const targets = enemies(v, v.side).filter((e) => canTarget(v, e));
  let best: { a: Action; e: number } | null = null;
  for (const t of targets) {
    const all = attackers(v, t);
    if (!all.length) continue;
    let set = all;
    if (level === 2) {
      // наименьший состав, который даёт почти тот же столбец
      const sorted = all.slice().sort((x, y) => U[y].str - U[x].str);
      const full = crtCol(odds(v, all, t).diff);
      set = [];
      for (const i of sorted) {
        set.push(i);
        if (crtCol(odds(v, set, t).diff) >= Math.min(full, 13)) break;
      }
      // обязанные к атаке рядом с этой целью — тоже в состав
      for (const i of must) if (all.includes(i) && !set.includes(i)) set.push(i);
    }
    let e = expect(v, set, t);
    if (must.some((i) => set.includes(i))) e += 3;
    if (level === 0) e += rng.next() * 4 - 2;
    if (!best || e > best.e) best = { a: { type: 'attack', def: t, att: set }, e };
  }
  if (!best) return null;
  const thr = level === 0 ? -1 : level === 1 ? 0.3 : 0.8;
  if (best.e >= thr) return best.a;
  // обязательная атака: ищем цель для обязанной части
  if (must.length) {
    let pick: { a: Action; e: number } | null = null;
    for (const i of must) {
      for (const t of targets) {
        if (canJoin(v, i, t) !== null) continue;
        const set = attackers(v, t);
        const e = expect(v, set, t);
        if (!pick || e > pick.e) pick = { a: { type: 'attack', def: t, att: set }, e };
      }
    }
    if (pick) return pick.a;
  }
  return null;
}

/** Оборонительная ценность клетки. */
function cover(h: number): number {
  return (isVillage(h) ? 2 : 0) + (isShrub(h) ? 1 : 0) + (isRedoubt(h) ? 3 : 0) + hexLevel(h) * 0.7 + (isForest(h) ? 0.5 : 0);
}

function nearestEnemy(v: State, sd: number, h: number): { d: number; e: number } {
  let d = 99;
  let e = -1;
  for (const j of enemies(v, sd)) {
    const k = dist(h, v.u[j].hex);
    if (k < d) {
      d = k;
      e = j;
    }
  }
  return { d, e };
}

/** Насколько клетка опасна: сила врагов рядом против своей. */
function threat(v: State, sd: number, h: number, own: number): number {
  let t = 0;
  for (const m of neighbors(h)) {
    const j = unitAt(v, m);
    if (j >= 0 && side(j) !== sd && !v.u[j].dem) t += U[j].str;
  }
  return t - own;
}

function scoreHex(v: State, i: number, h: number, level: number, rng: Rng): number {
  const sd = side(i);
  const d = U[i];
  const ne = nearestEnemy(v, sd, h);
  let s = 0;
  if (sd === FR) {
    // наступление: ближе к русским, лучше — рядом с целью, где можно выиграть бой
    if (d.kind === 'art') {
      s -= Math.abs(ne.d - 2) * 3;
      if (ne.d === 1) s -= 6;
      s += hexLevel(h) * 1.5;
    } else {
      s -= ne.d * 2;
      if (ne.d === 1 && v.u[i].dem) s -= 8;
      const th = threat(v, sd, h, d.str);
      if (ne.d === 1 && th > d.str) s -= level >= 1 ? 3 : 0;
      // поддержка своих рядом
      s += neighbors(h).filter((m) => {
        const j = unitAt(v, m);
        return j >= 0 && side(j) === sd;
      }).length * 0.6;
    }
  } else {
    // оборона: держаться за хорошую местность и рядом со своими, деморализованным — отойти
    s += cover(h) * 1.5;
    if (v.u[i].dem) s += Math.min(ne.d, 6);
    else if (d.kind !== 'art') {
      if (ne.d <= 1 && threat(v, sd, h, d.str) > d.str) s -= 4;
      // резервы — к местам, где врагов много
      if (level === 2) {
        let pressure = 0;
        for (const j of enemies(v, sd)) {
          const k = dist(h, v.u[j].hex);
          if (k <= 3) pressure += U[j].str / (k + 1);
        }
        s += Math.min(pressure, 20) * 0.15;
      }
      if (ne.d === 1 && !v.u[i].dem) s += 0.5;
    }
  }
  s += cover(h) * (sd === FR ? 0.4 : 0);
  if (level === 0) s += rng.next() * 4;
  else s += rng.next() * 0.2;
  return s;
}

function chooseMove(v: State, level: number, rng: Rng): Action | null {
  const sd = v.side;
  const units = mine(v, sd).filter((i) => !v.u[i].moved);
  // сначала части, потом командующие
  units.sort((a, b) => (U[a].kind === 'cmd' ? 1 : 0) - (U[b].kind === 'cmd' ? 1 : 0));
  for (const i of units) {
    const st = v.u[i];
    const d = U[i];
    if (d.kind === 'cmd') {
      const a = moveCommander(v, i, level);
      if (a) return a;
      continue;
    }
    if (d.kind === 'art') {
      const ne = nearestEnemy(v, sd, st.hex);
      if (!st.dem) {
        // батарея: французам — подтянуться, если враг дальше 3; русским — стоять (сложный отводит под угрозой)
        if (sd === FR && ne.d > 3 && !inZoc(v, 1 - sd, st.hex)) return { type: 'wheels', u: i };
        continue;
      }
      // на колёсах: доехать и развернуться
      const r = reach(v, i);
      let best = st.hex;
      let bs = scoreHex(v, i, st.hex, level, rng);
      for (const h of r.keys()) {
        const sc = scoreHex(v, i, h, level, rng);
        if (sc > bs) {
          bs = sc;
          best = h;
        }
      }
      if (best !== st.hex) return { type: 'move', u: i, to: best };
      if (ne.d <= 4) return { type: 'wheels', u: i };
      if (!st.moved) return { type: 'wheels', u: i };
      continue;
    }
    if (sd !== FR && level === 0 && rng.next() < 0.6) continue;
    const r = reach(v, i);
    if (!r.size) continue;
    let best = st.hex;
    let bs = scoreHex(v, i, st.hex, level, rng) + (sd === FR ? 0 : 1.5);
    for (const h of r.keys()) {
      const sc = scoreHex(v, i, h, level, rng);
      if (sc > bs + 0.3) {
        bs = sc;
        best = h;
      }
    }
    if (best !== st.hex) return { type: 'move', u: i, to: best };
  }
  return null;
}

function moveCommander(v: State, c: number, level: number): Action | null {
  if (level === 0) return null;
  const sd = side(c);
  const r = reach(v, c);
  // к самой сильной своей части у фронта, которой он командует
  let best = -1;
  let bs = -Infinity;
  for (const i of mine(v, sd)) {
    if (!isCombat(i) || !commands(U[c], U[i])) continue;
    const h = v.u[i].hex;
    if (h !== v.u[c].hex && !r.has(h)) continue;
    if (leader(v, i) >= 0 && leader(v, i) !== c) continue;
    const ne = nearestEnemy(v, sd, h);
    const sc = U[i].str - ne.d * 2 + (v.u[i].dem ? 6 : 0);
    if (sc > bs) {
      bs = sc;
      best = h;
    }
  }
  if (best >= 0 && best !== v.u[c].hex) return { type: 'move', u: c, to: best };
  return null;
}

export function choose(v: State, seat: number, level: number, rng: Rng): Action | null {
  if (v.side !== seat || v.phase === 'over') return null;
  switch (v.phase) {
    case 'deploy':
      return { type: 'ready' };
    case 'rally':
      return { type: 'rally' };
    case 'move':
      return chooseMove(v, level, rng) ?? { type: 'endMove' };
    case 'pursue': {
      const p = v.pursuit!;
      if (side(p.units[0]) === FR || level === 2 || cover(p.hex) >= 2) {
        const u = p.units.slice().sort((a, b) => U[b].str - U[a].str)[0];
        return { type: 'pursue', u };
      }
      return { type: 'pursue', u: null };
    }
    case 'combat':
      return chooseAttack(v, level, rng) ?? { type: 'endCombat' };
  }
  return null;
}

export const centerOf = (v: State, i: number) => center(v.u[i].hex);
