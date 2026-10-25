/* «Идут танки» — боты. Видят свой view: метки мин не знает никто, чужие ракеты скрыты (у соперника две «Ц-П» и одна «П»).
 * Лёгкий — бросает и едет любым танком, охотно бьёт. Средний — оценка: бой, продвижение к цели (кружков по дорогам до
 * свободного чужого старта), не вставать на разрушенный мост и под удар чужого танка, обходить чужие мины; летит, если
 * выгодно. Сложный — ещё не задерживается на дугах над своей половиной (там бомбят), прячет свою «П» на дуге без своих
 * танков, возвращает танк на самый безопасный старт. */
import type { Rng } from '../../core/types';
import { arcsOf, legal, ready, routes, type Action, type State, type Tank } from './engine';
import { ARCS, BRIDGES, LINKS, N, STARTS } from './map';

/** Штраф сложному за стоянку на дуге над своей половиной (подобрано партиями: против среднего ~6:4 с кубиком, ~3:1 без). */
const ARC_RISK = 5;

/** Кружков по дорогам до ближайшего свободного чужого старта (занятый своим дошедшим танком — не цель). */
function dist(s: State, side: number): number[] {
  const d = Array(N).fill(99);
  const q: number[] = [];
  for (const p of STARTS[1 - side]) {
    if (s.tanks.some((t) => t.p === p && t.state === 'done')) continue;
    d[p] = 0;
    q.push(p);
  }
  while (q.length) {
    const p = q.shift()!;
    for (const [nb] of LINKS[p])
      if (d[nb] > d[p] + 1) {
        d[nb] = d[p] + 1;
        q.push(nb);
      }
  }
  return d;
}

/** Может ли чужой танк доехать до клетки p в свой ход (до 3 кружков; в варианте без кубика — до 4). */
function threatened(s: State, p: number, side: number): boolean {
  const max = s.cfg.dice ? 3 : 4;
  for (const t of s.tanks) {
    if (t.side === side || t.state !== 'board') continue;
    for (let v = 1; v <= max; v++) if (routes(s, t, v).some((r) => r.path[r.path.length - 1] === p)) return true;
  }
  return false;
}

function moveScore(s: State, a: Extract<Action, { type: 'move' }>, me: number, level: number, D: number[], DO: number[]): number {
  const t = s.tanks.find((x) => x.id === a.id)!;
  const end = a.path[a.path.length - 1];
  let v = (Math.min(D[t.p], 40) - Math.min(D[end], 40)) * 1.5;
  const enemy = s.tanks.find((x) => x.p === end && x.side !== me && x.state === 'board');
  if (enemy) v += 12 + Math.max(0, 15 - DO[enemy.p]);
  if (STARTS[1 - me].includes(end)) v += 20;
  if (BRIDGES.has(end) && !enemy) v -= 8;
  // чужие мины на пути — половина шанса, что разобьёт
  const mines = a.path.filter((p) => s.mines.some((m) => m.p === p && m.side !== me)).length;
  v -= mines * 4;
  // сложный: дуга над своей половиной — сюда прилетит чужой самолёт
  if (level >= 2 && s.planes[1 - me].some((f) => f >= 0)) {
    const onArc = (p: number) => ARCS.some((a) => a.side === me && a.cells.includes(p));
    if (onArc(end)) v -= ARC_RISK;
    if (onArc(t.p)) v += (ARC_RISK) * 0.8;
  }
  if (!STARTS[1 - me].includes(end) && threatened({ ...s, tanks: s.tanks.map((x) => (x.id === t.id ? { ...x, p: end } : x)) }, end, me)) v -= 6;
  return v;
}

/** Ценность полёта: танк до ракеты — танк точно разбит, самолёт — с вероятностью 2/3; после ракеты — 1/3 разбить. */
function flyScore(s: State, a: Extract<Action, { type: 'fly' }>, me: number, level: number): number {
  const op = 1 - me;
  const arc = ARCS[a.arc];
  const from = s.planes[me][a.plane];
  const order = from === 0 ? arc.cells.map((p, i) => ({ p, i })) : arc.cells.map((p, i) => ({ p, i })).reverse();
  const target = order.find((x) => s.tanks.some((t) => t.side === op && t.state === 'board' && t.p === x.p));
  if (!target) return -99;
  const tank = s.tanks.find((t) => t.side === op && t.state === 'board' && t.p === target.p)!;
  const first = from === 0 ? target.i < arc.rocket : target.i >= arc.rocket;
  const tankV = 10 + Math.max(0, 14 - dist(s, op)[tank.p]);
  const planeV = 6;
  const pHit = 2 / 3;
  return first ? tankV - pHit * planeV : (1 - pHit) * tankV - pHit * planeV;
}

export function choose(v: State, seat: number, level: number, rng: Rng): Action | null {
  const acts = legal(v, seat);
  if (!acts.length) return null;
  if (v.phase === 'rockets') {
    if (level < 2) return rng.next() < 0.5 ? { type: 'keep' } : acts[1 + rng.int(3)];
    // своя «П» (промах) — на дугу, где своих танков нет
    const mine = arcsOf(seat);
    const r = v.rockets[seat];
    const busy = mine.map((a) => a.cells.filter((p) => v.tanks.some((t) => t.side === seat && t.state === 'board' && t.p === p)).length);
    const miss = r.indexOf('miss');
    const calm = busy.indexOf(Math.min(...busy));
    if (miss < 0 || miss === calm) return { type: 'keep' };
    return { type: 'swap', a: miss, b: calm };
  }
  if (v.phase === 'return') {
    const opts = acts.filter((a): a is Extract<Action, { type: 'return' }> => a.type === 'return');
    if (!opts.length) return { type: 'noreturn' };
    if (level < 2) return opts[rng.int(opts.length)];
    return opts.find((a) => !threatened(v, a.at, seat)) ?? opts[0];
  }
  if (level === 0) {
    const fly = acts.filter((a) => a.type === 'fly');
    if (fly.length && rng.next() < 0.25) return fly[rng.int(fly.length)];
    const roll = acts.find((a) => a.type === 'roll');
    if (roll) return roll;
    const mv = acts.filter((a): a is Extract<Action, { type: 'move' }> => a.type === 'move');
    const hits = mv.filter((a) => v.tanks.some((t) => t.p === a.path[a.path.length - 1] && t.side !== seat && t.state === 'board'));
    if (hits.length) return hits[rng.int(hits.length)];
    return mv.length ? mv[rng.int(mv.length)] : acts[rng.int(acts.length)];
  }
  // полёт — до броска, если выгоден
  const flies = acts.filter((a): a is Extract<Action, { type: 'fly' }> => a.type === 'fly');
  if (flies.length) {
    const best = flies.map((a) => ({ a, sc: flyScore(v, a, seat, level) })).sort((x, y) => y.sc - x.sc)[0];
    if (best.sc > 4) return best.a;
  }
  const D = dist(v, seat);
  const DO = dist(v, 1 - seat);
  // разворот — если впереди к цели дальше, а сзади ближе
  const back = ready(v, seat).find((t: Tank) => {
    const ahead = routes(v, t, 1)[0];
    const behind = routes(v, { ...t, dir: -t.dir }, 1)[0];
    if (!behind) return false;
    const fa = ahead ? D[ahead.path[0]] : 99;
    return D[behind.path[0]] < D[t.p] && fa > D[t.p];
  });
  if (back) {
    const rev = acts.find((a) => a.type === 'reverse' && a.id === back.id);
    if (rev) return rev;
  }
  const roll = acts.find((a) => a.type === 'roll');
  if (roll) return roll;
  const mv = acts.filter((a): a is Extract<Action, { type: 'move' }> => a.type === 'move');
  if (!mv.length) return acts[0];
  return mv.map((a) => ({ a, sc: moveScore(v, a, seat, level, D, DO) + rng.next() * (level === 1 ? 1 : 0.2) })).sort((x, y) => y.sc - x.sc)[0].a;
}
