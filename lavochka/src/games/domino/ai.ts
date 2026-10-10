/* Домино — боты. Видят только свою руку, ряд и то, на какие числа другие уже не могли ходить.
 *   Лёгкий — кладёт любую подходящую кость;
 *   Средний — сбрасывает тяжёлые кости и дубли, бережёт разнообразие руки;
 *   Сложный — ещё и «режет» соперника (ставит на концы, которых у него нет), не мешает напарнику,
 *   считает выложенные кости и в осле закрывает стороны, которые выгодны соперникам. */
import type { Rng } from '../../core/types';
import { bazaarLeft, ends, isDouble, nextSeat, pips, placeTilePreview, placements, sideOf, teams, type Action, type Bone, type Placement, type State } from './engine';

function countOnTable(s: State): number[] {
  const seen = Array(7).fill(0);
  const add = (a: number, b: number) => {
    seen[a]++;
    if (b !== a) seen[b]++;
  };
  if (s.chain.center) add(s.chain.center.a, s.chain.center.b);
  for (const arm of s.chain.arms) for (const t of arm.tiles) add(t.a, t.b);
  return seen;
}

function score(s: State, seat: number, p: Placement, level: number): number {
  const hand = s.hands[seat];
  const rest = hand.filter((b) => b !== p.bone);
  let v = pips(p.bone) * 2 + (isDouble(p.bone) ? 9 : 0);
  // разнообразие: сколько разных чисел останется в руке
  const kinds = new Set<number>();
  for (const b of rest) {
    kinds.add(b[0]);
    kinds.add(b[1]);
  }
  v += kinds.size * 2;
  if (level < 2) return v;
  const after = placeTilePreview(s, p, seat);
  const es = ends(after, s.cfg).map((e) => e.v);
  const table = countOnTable({ ...s, chain: after } as State);
  const next = nextSeat(s, seat);
  const opp = teams(s) ? sideOf(s, next) !== sideOf(s, seat) : true;
  // концы, которых у следующего нет — он поедет за базаром или пропустит
  for (const e of es) {
    if (s.lacks[next].includes(e)) v += opp ? 7 : -7;
    // у меня есть на этот конец — смогу продолжить
    if (rest.some((b) => b[0] === e || b[1] === e)) v += 3;
    // число почти выложено — соперник вряд ли подставит
    if (table[e] >= 6) v += 2;
  }
  // напарник: не ставить на концы, которых у него нет
  if (teams(s)) {
    const partner = s.seats.find((x) => x !== seat && sideOf(s, x) === sideOf(s, seat));
    if (partner != null) for (const e of es) if (s.lacks[partner].includes(e)) v -= 4;
  }
  return v;
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.phase === 'over' || s.turn !== seat) return null;
  const hand = s.hands[seat];
  const more = s.phase === 'more';
  const opts = placements(s, hand, more);
  if (!opts.length) {
    if (more) return { type: 'enough' };
    return bazaarLeft(s) ? { type: 'draw' } : { type: 'pass' };
  }
  // доложить дубли (осёл): лёгкий — как получится, остальные — всегда, дубли трудно сбросить
  if (more && level === 0 && rng.next() < 0.4) return { type: 'enough' };
  let pick: Placement;
  if (level === 0) pick = opts[rng.int(opts.length)];
  else {
    const scored = opts.map((p) => ({ p, v: score(s, seat, p, level) + rng.next() * (level === 1 ? 3 : 0.5) }));
    scored.sort((a, b) => b.v - a.v);
    pick = scored[0].p;
  }
  const act: Action = { type: 'play', bone: pick.bone as Bone, arm: pick.arm };
  // осёл: закрыть сторону дублем, если на это число у меня больше нечего класть, а соперник на него ходит
  if (s.cfg.variant === 'osel' && isDouble(pick.bone) && pick.arm >= 0 && level >= 1) {
    const v = pick.bone[0];
    const rest = hand.filter((b) => b !== pick.bone);
    const mine = rest.some((b) => b[0] === v || b[1] === v);
    const next = nextSeat(s, seat);
    const nextLacks = s.lacks[next].includes(v);
    // закрывать есть смысл, когда этого числа на столе уже много — остальные у соперников
    if (!mine && !nextLacks && countOnTable(s)[v] >= 4) act.close = true;
  }
  return act;
}
