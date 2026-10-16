/* Домино — боты. Видят только свою руку, ряд и то, на какие числа другие уже не могли ходить.
 *   Лёгкий — кладёт любую подходящую кость;
 *   Средний — сбрасывает тяжёлые кости и дубли, бережёт разнообразие руки, в «пятёрках» берёт очки;
 *   Сложный — ещё и «режет» соперника (ставит на концы, которых у него нет), не мешает напарнику,
 *   считает выложенные кости, в осле закрывает стороны, выгодные соперникам, в генерале бережёт 0-0 и 6-6 на выход. */
import type { Rng } from '../../core/types';
import { bazaarLeft, canDraw, endSum, ends, fivesVariant, isDouble, isKolbasa, kolMoves, nextSeat, pips, placeTilePreview, placements, sameBone, sideOf, teams, type Action, type Bone, type Placement, type State, type View } from './engine';

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

const special = (b: Bone) => isDouble(b) && (b[0] === 0 || b[0] === 6);

function score(s: State, seat: number, p: Placement, level: number): number {
  const hand = s.hands[seat];
  const rest = hand.filter((b) => !sameBone(b, p.bone));
  let v = pips(p.bone) * 2 + (isDouble(p.bone) ? 9 : 0);
  // разнообразие: сколько разных чисел останется в руке
  const kinds = new Set<number>();
  for (const b of rest) {
    kinds.add(b[0]);
    kinds.add(b[1]);
  }
  v += kinds.size * 2;
  const after = placeTilePreview(s, p, seat);
  if (fivesVariant(s.cfg)) {
    const sum = endSum(after, s.cfg);
    if (sum > 0 && sum % 5 === 0) v += sum * (level === 0 ? 0 : 2);
  }
  if (s.cfg.variant === 'general' && level >= 1 && special(p.bone)) {
    // генерал: 0-0 и 6-6 — на выход; раньше времени не тратить
    const finishing = rest.every((b) => special(b));
    v += finishing ? 60 : -60;
  }
  if (level < 2) return v;
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
  // пятёрки: не оставлять следующему лёгкие очки — сколько его ответов на один конец дадут кратное пяти
  if (fivesVariant(s.cfg) && opp) {
    const sum = endSum(after, s.cfg);
    let gifts = 0;
    for (const e of es)
      for (let x = 0; x <= 6; x++) {
        const t = sum - e + x;
        if (t > 0 && t % 5 === 0 && !s.lacks[next].includes(e)) gifts++;
      }
    v -= gifts * 0.8;
  }
  return v;
}

/** Колбаса: режем, сколько можно больше; дубль — в стык; иначе к концу. */
function chooseKolbasa(s: State, level: number, rng: Rng): Action {
  const front = (s as Partial<View>).front ?? s.hands[s.turn][0];
  if (!front) return { type: 'skip' };
  const moves = kolMoves(s, front);
  if (!moves.length) return { type: 'skip' };
  if (level === 0) return moves[rng.int(moves.length)];
  const val = (m: Action) => {
    if (m.type === 'cut') return 100 + 2 * m.k;
    if (m.type === 'insert') return 5;
    // к концу: на сложном — ставим так, чтобы концы линий не совпали с костями, которыми соперник мог бы резать
    if (level >= 2 && m.type === 'play' && m.arm >= 0) {
      const after = placeTilePreview(s, { bone: front, arm: m.arm }, s.turn);
      const e = ends(after, s.cfg).map((x) => x.v);
      return e.length === 2 && e[0] === e[1] ? 3 : 4;
    }
    return 4;
  };
  return moves.map((m) => ({ m, v: val(m) + rng.next() })).sort((a, b) => b.v - a.v)[0].m;
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.phase === 'over' || s.turn !== seat) return null;
  if (isKolbasa(s.cfg)) return chooseKolbasa(s, level, rng);
  const hand = s.hands[seat];
  const more = s.phase === 'more';
  const opts = placements(s, hand, more);
  if (!opts.length) {
    if (more) return { type: 'enough' };
    return canDraw(s, bazaarLeft(s)) ? { type: 'draw' } : { type: 'pass' };
  }
  // доложить дубли: лёгкий — как получится, остальные — всегда (кроме генеральских раньше времени)
  if (more && level === 0 && rng.next() < 0.4) return { type: 'enough' };
  let pick: Placement;
  if (level === 0) pick = opts[rng.int(opts.length)];
  else {
    const scored = opts.map((p) => ({ p, v: score(s, seat, p, level) + rng.next() * (level === 1 ? 3 : 0.5) }));
    scored.sort((a, b) => b.v - a.v);
    if (more && s.cfg.variant === 'general' && special(scored[0].p.bone) && scored[0].v < 0) return { type: 'enough' };
    pick = scored[0].p;
  }
  const act: Action = { type: 'play', bone: pick.bone as Bone, arm: pick.arm };
  // осёл: закрыть сторону дублем, если на это число у меня больше нечего класть, а соперник на него ходит
  if (s.cfg.variant === 'osel' && isDouble(pick.bone) && pick.arm >= 0 && level >= 1) {
    const v = pick.bone[0];
    const rest = hand.filter((b) => !sameBone(b, pick.bone));
    const mine = rest.some((b) => b[0] === v || b[1] === v);
    const next = nextSeat(s, seat);
    const nextLacks = s.lacks[next].includes(v);
    // закрывать есть смысл, когда этого числа на столе уже много — остальные у соперников
    if (!mine && !nextLacks && countOnTable(s)[v] >= 4) act.close = true;
  }
  return act;
}
