/* «Морская игра» — боты: альфа-бета (core/minimax). Броски кубика (мины, береговые пушки) в переборе не разыгрываются,
 * а считаются ожидаемой потерей: вероятность «взрыва» × ценность корабля. Оценка — флот, угрозы (кого соперник может
 * потопить следующим ходом), продвижение к противнику. Лёгкий — глубина 1 с шумом, средний — 2, сложный — 3.
 * Тральщик ставит мину, если рядом корабли противника, а свой путь чистит от мин. */
import { bestMove, type SearchGame } from '../../core/minimax';
import type { Rng } from '../../core/types';
import { ahead, apply, canHit, col, legal, rollsAt, type Action, type Kind, type State } from './engine';

const V: Record<Kind, number> = { bb: 90, cr: 70, gb: 50, dd: 40, ms: 40, ss: 50 };
type P = State & { risk: [number, number] };
const never: Rng = { next: () => 0.999, int: (n: number) => n - 1, getState: () => 0 };

function play(p: P, a: Action): P {
  let risk = p.risk;
  if (a.type === 'fwd') {
    const sh = p.ships.find((x) => x.id === a.id)!;
    const q = ahead(sh.p, sh.dir);
    const n = rollsAt(p, sh, q).length;
    if (n) {
      const lose = 1 - Math.pow(1 - p.cfg.faces / 6, n);
      risk = [...risk] as [number, number];
      risk[sh.side] += lose * V[sh.kind];
    }
  }
  const r = apply(p, p.turn, a, never);
  return r ? { ...r.state, risk } : p;
}

function evaluate(p: P, me: number): number {
  if (p.over) return p.winner === me ? 100000 : p.winner == null ? 0 : -100000;
  // тяга вперёд — до середины поля (10 за узел), дальше — погоня за ближайшим (6 за узел)
  let v = 0;
  for (const sh of p.ships) {
    const s = sh.side === me ? 1 : -1;
    v += s * V[sh.kind];
    // ближе к берегу противника — смелее
    const adv = sh.side === 0 ? col(sh.p) : 10 - col(sh.p);
    v += s * Math.min(adv, 5) * 10;
    // сближение с противником: без него флоты топчутся у своих берегов
    let near = 20;
    for (const e of p.ships) if (e.side !== sh.side) near = Math.min(near, Math.abs(col(e.p) - col(sh.p)) + Math.abs(Math.floor(e.p / 11) - Math.floor(sh.p / 11)));
    v -= s * near * 6;
  }
  v -= p.risk[me] - p.risk[1 - me];
  // угрозы: кого сторона, которая сейчас ходит, может потопить сразу
  let threat = 0;
  for (const sh of p.ships) {
    if (sh.side !== p.turn) continue;
    const q = ahead(sh.p, sh.dir);
    const t = q >= 0 ? p.ships.find((x) => x.p === q) : null;
    if (t && t.side !== sh.side && canHit(sh.kind, sh.dir, t.kind, t.dir)) threat = Math.max(threat, V[t.kind]);
  }
  v += (p.turn === me ? 1 : -1) * threat * 0.6;
  return v;
}

const game: SearchGame<P, Action> = {
  moves: (p) => legal(p, p.turn).filter((a) => a.type !== 'mine'),
  play,
  side: (p) => p.turn,
  over: (p) => p.over,
  score: evaluate,
  order: (p, a) => {
    if (a.type !== 'fwd') return 0;
    const sh = p.ships.find((x) => x.id === a.id)!;
    const q = ahead(sh.p, sh.dir);
    return p.ships.some((x) => x.p === q) ? 100 : 1;
  },
};

export function choose(v: State, seat: number, level: number, rng: Rng): Action | null {
  if (v.over || v.turn !== seat) return null;
  const acts = legal(v, seat);
  if (!acts.length) return null;
  // мины (не ход): снять мину под своим тральщиком на своём пути; поставить — если рядом противник
  if (level > 0 && !v.mined) {
    const ms = v.ships.find((x) => x.side === seat && x.kind === 'ms');
    if (ms && acts.some((a) => a.type === 'mine')) {
      const enemyNear = v.ships.some((x) => x.side !== seat && Math.abs(col(x.p) - col(ms.p)) + Math.abs(Math.floor(x.p / 11) - Math.floor(ms.p / 11)) <= 3);
      const onMine = v.mines.includes(ms.p);
      if (onMine || (enemyNear && v.stock[seat] > 0 && rng.next() < (level >= 2 ? 0.8 : 0.4))) return { type: 'mine', id: ms.id };
    }
  }
  const p: P = { ...v, risk: [0, 0] };
  return bestMove(game, p, [1, 2, 3][level] ?? 2, rng, level === 0 ? 60 : level === 1 ? 6 : 0);
}
