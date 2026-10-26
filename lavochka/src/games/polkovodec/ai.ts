/* «Полководец» — боты. Каждый приказ — жадный выбор: взятие (ценность побитой фигуры, маршал — решающая), с поправкой
 * на то, не попадёт ли фигура сама под удар; иначе — марш к ближайшему противнику и к его крепостям, командиры держатся
 * позади своих войск. Лёгкий — без оглядки на ответный удар и со случайностью; средний — с оглядкой; сложный — ещё бережёт
 * маршала, бьёт сначала тех, кто угрожает, и пополняет армию в крепостях. */
import type { Rng } from '../../core/types';
import { col, COST, hits, isCmd, legal, row, type Action, type Piece, type State } from './engine';

const V = (p: Piece) => (p.kind === 'marshal' ? 400 : COST[p.kind] + 4);
const cheb = (a: number, b: number) => Math.max(Math.abs(col(a) - col(b)), Math.abs(row(a) - row(b)));

/** Угрожает ли соперник клетке p (после хода, в позиции s). */
function threatened(s: State, p: number, side: number): boolean {
  for (const e of s.pieces) if (e.side !== side && cheb(e.p, p) <= 5 && hits(s, e).includes(p)) return true;
  return false;
}

function after(s: State, pc: Piece, to: number, take: boolean, art: boolean): State {
  const pieces = s.pieces.filter((x) => !(take && x.p === to && x.side !== pc.side)).map((x) => (x.id === pc.id && !art ? { ...x, p: to } : x));
  return { ...s, pieces };
}

function score(s: State, a: Action, me: number, level: number, rng: Rng): number {
  if (a.type === 'end') return 0.5;
  if (a.type === 'recruit') return level >= 2 && s.stock[me] >= 20 ? 3 + rng.next() : -1;
  const pc = s.pieces.find((x) => x.id === a.id)!;
  const art = pc.kind === 'gun' || pc.kind === 'hart';
  let v = 0;
  if (a.type === 'hit') {
    const t = s.pieces.find((x) => x.p === a.to)!;
    v += V(t) * 2;
  }
  const dest = a.type === 'hit' && art ? pc.p : a.to;
  const s2 = after(s, pc, a.to, a.type === 'hit', art);
  if (level >= 1 && threatened(s2, dest, me)) v -= V(pc) * (level >= 2 ? 1.6 : 1.1);
  if (level >= 1 && a.type === 'move' && threatened(s, pc.p, me)) v += V(pc) * 0.9;
  const enemies = s.pieces.filter((x) => x.side !== me);
  if (a.type === 'move' && enemies.length) {
    const goal = (p: number) => Math.min(...enemies.map((e) => cheb(p, e.p) + (e.kind === 'marshal' ? -3 : 0)), ...s.forts.filter((f) => f.owner !== me).flatMap((f) => f.cells.map((c) => cheb(p, c) + 2)));
    const gain = goal(pc.p) - goal(a.to);
    if (isCmd(pc.kind)) {
      // командир — за войсками, в 3–5 клетках от своих
      const own = s.pieces.filter((x) => x.side === me && !isCmd(x.kind));
      const near = (p: number) => own.filter((x) => cheb(x.p, p) <= 6).length;
      v += (near(a.to) - near(pc.p)) * 0.6 + (pc.kind === 'marshal' ? -Math.max(0, gain) : gain * 0.3);
      if (pc.kind === 'marshal' && level >= 2 && threatened(s2, a.to, me)) v -= 300;
    } else v += gain * (art ? 0.4 : 1);
  }
  return v + (level === 0 ? rng.next() * 6 : level === 1 ? rng.next() : 0);
}

export function choose(v: State, seat: number, level: number, rng: Rng): Action | null {
  const acts = legal(v, seat);
  if (!acts.length) return null;
  let best = acts[0];
  let bv = -Infinity;
  for (const a of acts) {
    const sc = score(v, a, seat, level, rng);
    if (sc > bv) {
      bv = sc;
      best = a;
    }
  }
  return best;
}
