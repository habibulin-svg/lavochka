/* Французское таро: обязательный ход в масть и козырем, перебивать, Эскюз, прикуп и снос, удлеры и счёт, пуанье,
 * впятером — тайный напарник, вид скрывает чужие руки; партии ботов на 3, 4 и 5 игроков доходят до конца. */
import { describe, expect, it } from 'vitest';
import { minor } from '../src/cards/tarot';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/tarot/ai';
import { def } from '../src/games/tarot/def';
import { apply, attackPoints, canCall, canDiscard, cfgFrom, EXCUSE, half, legal, makeView, newState, PETIT, poigneeCards, setup, trickWinner, type State } from '../src/games/tarot/engine';

const W = (r: number) => minor('W', r);
const C = (r: number) => minor('C', r);
const S = (r: number) => minor('S', r);
const rng = new SeededRng(1);

function play(s: State, trick: [number, number][], hands: Record<number, number[]>): State {
  const st: State = { ...s, phase: 'play', taker: 0, contract: 2, trick: trick.map(([seat, card]) => ({ seat, card })) };
  for (const [k, h] of Object.entries(hands)) st.hands[Number(k)] = h;
  return st;
}

describe('таро: правила хода', () => {
  const s0 = newState(cfgFrom({}), [0, 1, 2, 3]);
  it('в масть — обязательно; Эскюз — всегда можно', () => {
    const s = play(s0, [[0, W(5)]], { 1: [W(2), W(14), 7, EXCUSE, C(3)] });
    expect(legal(s, 1).sort((a, b) => a - b)).toEqual([EXCUSE, W(2), W(14)].sort((a, b) => a - b));
  });
  it('нет масти — бить козырем; на козырь — перебивать, если можешь', () => {
    const s = play(s0, [[0, W(5)], [1, 12]], { 2: [5, 15, 20, C(3)] });
    expect(legal(s, 2).sort((a, b) => a - b)).toEqual([15, 20]);
    const t = play(s0, [[0, W(5)], [1, 12]], { 2: [5, 9, C(3)] });
    expect(legal(t, 2).sort((a, b) => a - b)).toEqual([5, 9]);
    const u = play(s0, [[0, W(5)]], { 1: [C(3), S(4)] });
    expect(legal(u, 1).length).toBe(2);
  });
  it('Эскюзом начатая взятка — масть по следующей карте; Эскюз взятку не берёт', () => {
    const s = play(s0, [[0, EXCUSE], [1, C(4)]], { 2: [C(10), 3] });
    expect(legal(s, 2)).toEqual([C(10)]);
    expect(trickWinner([{ seat: 0, card: EXCUSE }, { seat: 1, card: C(4) }, { seat: 2, card: C(10) }, { seat: 3, card: C(2) }])).toBe(2);
    expect(trickWinner([{ seat: 0, card: W(14) }, { seat: 1, card: PETIT }, { seat: 2, card: W(13) }])).toBe(1);
  });
  it('очки: 91 на колоду', () => {
    expect(Array.from({ length: 78 }, (_, i) => half(i)).reduce((a, b) => a + b, 0)).toBe(182);
  });
  it('снос: не короли и не удлеры, козыри — только если иначе не набрать', () => {
    const hand = [W(14), PETIT, 7, C(3), C(4)];
    expect(canDiscard(hand, W(14), 2)).toBe(false);
    expect(canDiscard(hand, PETIT, 2)).toBe(false);
    expect(canDiscard(hand, 7, 2)).toBe(false);
    expect(canDiscard(hand, 7, 3)).toBe(true);
    expect(canDiscard(hand, C(3), 2)).toBe(true);
  });
  it('пуанье: показывают ровно столько козырей, Эскюз — только если не хватает', () => {
    const hand = [EXCUSE, 2, 3, 4, 5, 6, 7, 8, 9, 10, W(1)];
    expect(poigneeCards(hand, 1, 4)).toHaveLength(10);
    expect(poigneeCards(hand, 1, 4)).toContain(EXCUSE);
    expect(poigneeCards([...hand, 11], 1, 4)).not.toContain(EXCUSE);
  });
  it('впятером: все короли на руке — зовут даму', () => {
    const s = newState(cfgFrom({}), [0, 1, 2, 3, 4]);
    s.hands[0] = [W(14), C(14), S(14), minor('P', 14)];
    expect(canCall(s, 0)).toEqual([W(13), C(13), S(13), minor('P', 13)]);
  });
});

describe('таро: сдача и счёт', () => {
  it('Эскюз остаётся у хозяина, взявшему — полочка', () => {
    const s = newState(cfgFrom({}), [0, 1, 2, 3]);
    s.taker = 0;
    s.contract = 1;
    s.taken = [{ w: 1, cards: [EXCUSE, W(2), W(3), W(4)], ex: 0 }];
    const a = attackPoints(s);
    // у взявшего Эскюз (9 половинок) минус полочка (1) взамен
    expect(a.halfPts).toBe(8);
    expect(a.oudlers).toBe(1);
  });
  it('торги: все пасуют — пересдача; взявший при малой видит прикуп и сносит', () => {
    let s = setup([0, 1, 2, 3], {}, new SeededRng(3));
    const d0 = s.deal;
    for (let i = 0; i < 4; i++) s = apply(s, s.turn, { type: 'pass' }, rng)!.state;
    expect(s.deal).toBe(d0 + 1);
    const first = s.turn;
    s = apply(s, first, { type: 'bid', c: 1 }, rng)!.state;
    for (let i = 0; i < 3; i++) s = apply(s, s.turn, { type: 'pass' }, rng)!.state;
    expect(s.phase).toBe('discard');
    expect(s.hands[first]).toHaveLength(24);
    const v = makeView(s, [(first + 1) % 4]);
    expect(v.hands[first]).toEqual([]);
    expect(v.chien).toEqual([]);
  });
  it('партии ботов: втроём, вчетвером и впятером доходят до конца, очки сходятся в ноль', () => {
    for (const n of [3, 4, 5]) {
      for (const level of [1, 2, 3]) {
        const r = new SeededRng(100 + n * 10 + level);
        const seats = Array.from({ length: n }, (_, seat) => ({ seat, kind: 'bot' as const, name: '', level }));
        let s = def.setup(seats, { rounds: 1 }, r);
        for (let guard = 0; guard < 5000 && !s.over; guard++) {
          const seat = def.toAct(s)[0];
          const a = choose(def.view(s, [seat]), seat, level, r);
          const res = def.apply(s, seat, a!, r);
          expect(res, `n=${n} lv=${level} ${JSON.stringify(a)}`).toBeTruthy();
          s = res!.state;
        }
        expect(s.over).toBe(true);
        expect(s.seats.reduce((a, x) => a + s.score[x], 0)).toBe(0);
      }
    }
  });
});
