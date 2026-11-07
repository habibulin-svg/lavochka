/* Боты городков. Видят то же, что человек: свою фигуру и линию броска. Целятся в середину фигуры с приземлением в пригород,
 * сильные перебирают несколько бросков (прогоняют физику) и берут лучший; потом рука дрожит — тем сильнее, чем слабее бот. */
import type { Rng } from '../../core/types';
import { lineOf, resolve, type Action, type State } from './engine';
import { powFor } from './physics';

const gauss = (rng: Rng) => {
  let u = 0;
  for (let k = 0; k < 4; k++) u += rng.next();
  return (u - 2) * 1.7;
};

/** Разброс руки: угол (рад), сила, вбок (м). */
const SHAKE = [
  { ang: 0.024, pow: 0.032, tries: 0 },
  { ang: 0.016, pow: 0.024, tries: 4 },
  { ang: 0.01, pow: 0.015, tries: 8 },
];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  const i = s.seats.indexOf(seat);
  if (i < 0 || s.over || i !== s.cur) return null;
  const ps = s.p[i];
  const line = lineOf(s, i);
  const sh = SHAKE[clamp(level, 0, 2)];
  const rods = ps.rods;
  // середина и передний край того, что осталось
  const cx = rods.reduce((a, r) => a + r.x, 0) / rods.length;
  const front = Math.min(...rods.map((r) => r.y));
  const mk = (x: number, tx: number, landAt: number, spin: number): Action => {
    const ang = clamp(Math.atan2(tx - x, -line), -0.38, 0.38);
    return { type: 'throw', x, ang, pow: clamp(powFor(landAt, ang, line), 0, 1), spin, end: false };
  };
  // ближе к штрафной линии — рискованно; с полукона бьём «в лоб»
  const land0 = Math.max(-0.55, Math.min(front - 0.35, 0.3));
  // фигура разбросана («Письмо», остатки по углам) — целимся в один городок
  const spread = Math.max(...rods.map((r) => Math.abs(r.x - cx))) > 0.45;
  const pick = () => rods[Math.floor(rng.next() * rods.length)];
  const aimAt = (r: { x: number; y: number }) => ({ tx: r.x, land: clamp(r.y - 0.3 - rng.next() * 0.3, -0.55, 1.7) });
  const first = spread ? aimAt(pick()) : { tx: cx, land: land0 };
  let best: Action = mk(clamp(first.tx * 0.6, -1.2, 1.2), first.tx, first.land, rng.next() < 0.5 ? 0.7 : -0.7);
  if (sh.tries > 0) {
    let bestScore = -Infinity;
    for (let k = 0; k < sh.tries; k++) {
      const one = spread || k % 3 === 2 ? aimAt(pick()) : null;
      const x = k === 0 ? 0 : clamp((rng.next() - 0.5) * 2.4, -1.2, 1.2);
      const tx = one ? one.tx : cx + (k === 0 ? 0 : (rng.next() - 0.5) * 0.5);
      const land = one ? one.land : k === 0 ? land0 : clamp(land0 + (rng.next() - 0.5) * 0.7, -0.7, 1.2);
      const a = k === 0 && !one ? best : mk(x, tx, land, (rng.next() - 0.5) * 2);
      // оценка с небольшой дрожью, чтобы не брать «бросок по лезвию»
      let sc = 0;
      for (const d of [0, 1]) {
        const t = d ? { ...a, ang: a.ang + sh.ang, pow: clamp(a.pow - sh.pow, 0, 1) } : a;
        const r = resolve(s, i, t);
        sc += r.lost ? -3 : r.out.length + (r.after.length === 0 ? 2 : 0) - r.after.filter((l) => l.y < 0).length * 0.1;
      }
      if (sc > bestScore) (bestScore = sc), (best = a);
    }
  }
  return {
    ...best,
    ang: clamp(best.ang + gauss(rng) * sh.ang, -0.4, 0.4),
    pow: clamp(best.pow + gauss(rng) * sh.pow, 0, 1),
  };
}
