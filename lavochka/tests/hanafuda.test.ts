/* Ханафуда: колода, яку коикои, очки го-стопа, ход с руки и из колоды, ппок/чок/ттадак, коикои и удвоения, боты. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { CARDS, CURTAIN, MOON, RAIN, SAKE, BOAR, DEER, BUTTERFLY, CRANE, PHOENIX } from '../src/games/hanafuda/cards';
import { choose, HARD } from '../src/games/hanafuda/ai';
import * as hf from '../src/games/hanafuda/engine';
import { goTally, koiYaku, total } from '../src/games/hanafuda/yaku';

const rng = new SeededRng(1);
const KR = { viewing: true, sakeKasu: true };

function pos(opts: Record<string, string | number | boolean>, hands: number[][], table: number[], deck: number[], caps: number[][] = []): hf.State {
  const n = hands.length;
  const s = hf.newState(hf.cfgFrom(opts), Array.from({ length: n }, (_, i) => i));
  s.hands = hands.map((h) => h.slice());
  s.table = table.slice();
  s.caps = Array.from({ length: n }, (_, i) => (caps[i] ?? []).slice());
  const used = new Set([...hands.flat(), ...table, ...s.caps.flat(), ...deck]);
  s.deck = [...deck, ...CARDS.map((c) => c.id).filter((i) => !used.has(i))];
  s.round = 1;
  s.oya = 0;
  s.turn = 0;
  return s;
}

const step = (s: hf.State, seat: number, a: hf.Action) => {
  const r = hf.apply(s, seat, a, rng);
  expect(r, JSON.stringify(a)).not.toBeNull();
  return r!;
};

describe('Ханафуда', () => {
  it('колода: 48 карт, 5 светов, 9 животных, 10 лент, 24 пустых', () => {
    expect(CARDS.length).toBe(48);
    const n = (k: string) => CARDS.filter((c) => c.kind === k).length;
    expect([n('hikari'), n('tane'), n('tan'), n('kasu')]).toEqual([5, 9, 10, 24]);
    expect(CARDS.filter((c) => c.ribbon === 'poem').length).toBe(3);
    expect(CARDS.filter((c) => c.ribbon === 'blue').length).toBe(3);
  });

  it('сдача: коикои 8+8, го-стоп вдвоём 10+8, втроём 7+6', () => {
    const a = hf.setup([0, 1], { mode: 'koikoi' }, new SeededRng(3));
    expect(a.hands[0].length + a.hands[1].length + a.table.length + a.deck.length).toBe(48);
    expect([a.hands[0].length, a.table.length, a.deck.length]).toEqual([8, 8, 24]);
    const b = hf.setup([0, 1], { mode: 'gostop' }, new SeededRng(3));
    expect([b.hands[0].length, b.table.length, b.deck.length]).toEqual([10, 8, 20]);
    const c = hf.setup([0, 1, 2], { mode: 'gostop' }, new SeededRng(3));
    expect([c.hands[2].length, c.table.length, c.deck.length]).toEqual([7, 6, 21]);
    // коикои втроём не бывает — движок играет го-стоп
    expect(hf.setup([0, 1, 2], { mode: 'koikoi' }, new SeededRng(3)).cfg.mode).toBe('gostop');
  });

  it('яку коикои: светы, ханами/цукими, иносикатё, ленты', () => {
    expect(total(koiYaku([CRANE, CURTAIN, MOON, RAIN, PHOENIX], KR))).toBe(10);
    expect(koiYaku([CRANE, CURTAIN, MOON, PHOENIX], KR)[0].pts).toBe(8);
    expect(koiYaku([CRANE, CURTAIN, RAIN, PHOENIX], KR)[0].pts).toBe(7);
    expect(koiYaku([CRANE, CURTAIN, RAIN], KR)).toEqual([]);
    expect(total(koiYaku([CURTAIN, MOON, SAKE], KR))).toBe(10);
    expect(total(koiYaku([CURTAIN, MOON, SAKE], { viewing: false, sakeKasu: true }))).toBe(0);
    expect(total(koiYaku([BOAR, DEER, BUTTERFLY], KR))).toBe(5);
    // акатан (1, 5, 9) + две лишние ленты = 7, плюс пять лент — 1
    expect(total(koiYaku([1, 5, 9, 13, 17], KR))).toBe(5 + 2 + 1);
    // касу: 9 пустых + сакэ = 10 → 1; сакэ — ещё и животное
    const kasu = CARDS.filter((c) => c.kind === 'kasu').slice(0, 9).map((c) => c.id);
    expect(total(koiYaku([...kasu, SAKE], KR))).toBe(1);
    expect(total(koiYaku([...kasu, SAKE], { viewing: true, sakeKasu: false }))).toBe(0);
  });

  it('очки го-стопа: светы с дождём, годори, ленты без ивы, пи с двойными', () => {
    expect(goTally([CRANE, CURTAIN, MOON]).total).toBe(3);
    expect(goTally([CRANE, CURTAIN, RAIN]).total).toBe(2);
    expect(goTally([4, 12, 29]).total).toBe(5);
    expect(goTally([1, 5, 9]).total).toBe(3);
    expect(goTally([13, 17, 25, 42, 21]).lines.map((l) => l.pts)).toEqual([3]);
    // 8 пустых + гроза (2) = 10 → 1 очко
    const pi = [2, 3, 6, 7, 10, 11, 14, 15, 43];
    expect(goTally(pi).pi).toBe(10);
    expect(goTally(pi).total).toBe(1);
    // чашка сакэ — туда, где выгоднее: 8 пустых + сакэ двойной = 10
    expect(goTally([...pi.slice(0, 8), SAKE]).total).toBe(1);
  });

  it('ход: карта с руки берёт пару, колода — свою; две на столе — выбор', () => {
    let s = pos({ mode: 'koikoi' }, [[0, 5, 26], [3, 9, 13]], [2, 6, 7, 28], [30, 11]);
    expect(hf.moves(s, 0).filter((m) => m.type === 'play' && m.card === 5).length).toBe(2);
    s = step(s, 0, { type: 'play', card: 0 }).state;
    expect(s.phase).toBe('draw');
    s = step(s, 0, { type: 'draw' }).state;
    expect(s.caps[0].sort((a, b) => a - b)).toEqual([0, 2, 28, 30]);
    expect(s.turn).toBe(1);
    // открытая карта, которой две пары на столе, — выбор
    let t = pos({ mode: 'koikoi' }, [[26, 40], [3, 13]], [6, 7, 22], [5]);
    t = step(t, 0, { type: 'play', card: 26 }).state;
    t = step(t, 0, { type: 'draw' }).state;
    expect(t.phase).toBe('pick');
    expect(hf.apply(t, 0, { type: 'pick', card: 22 }, rng)).toBeNull();
    t = step(t, 0, { type: 'pick', card: 7 }).state;
    expect(t.caps[0].sort((a, b) => a - b)).toEqual([5, 7]);
  });

  it('го-стоп: ппок застревает, съеденный ппок — пустая с соперника', () => {
    let s = pos({ mode: 'gostop' }, [[1, 5], [0, 9]], [2, 10], [3, 7, 11], [[39], [31]]);
    s = step(s, 0, { type: 'play', card: 1 }).state;
    const r = step(s, 0, { type: 'draw' });
    s = r.state;
    expect(r.events.some((e) => e.type === 'stick')).toBe(true);
    expect(s.table.filter((c) => c >> 2 === 0).length).toBe(3);
    s = step(s, 1, { type: 'play', card: 0 }).state;
    const r2 = step(s, 1, { type: 'draw' });
    expect(r2.events.some((e) => e.type === 'steal' && e.card === 39)).toBe(true);
    expect(r2.state.caps[1]).toEqual(expect.arrayContaining([0, 1, 2, 3, 39]));
  });

  it('го-стоп: чок и ттадак забирают пустые', () => {
    let s = pos({ mode: 'gostop' }, [[5, 26], [3, 9]], [10, 22], [6], [[], [31, 35]]);
    s = step(s, 0, { type: 'play', card: 5 }).state;
    const r = step(s, 0, { type: 'draw' });
    expect(r.events.some((e) => e.type === 'take' && e.why === 'jjok')).toBe(true);
    expect(r.events.filter((e) => e.type === 'steal').length).toBe(1);
    let t = pos({ mode: 'gostop' }, [[4, 26], [3, 9]], [6, 7, 22], [5], [[], [31]]);
    t = step(t, 0, { type: 'play', card: 4, onto: 6 }).state;
    const r2 = step(t, 0, { type: 'draw' });
    expect(r2.events.some((e) => e.type === 'take' && e.why === 'ttadak' && e.cards.length === 4)).toBe(true);
  });

  it('коикои: собрал яку — решение; «стоп» — очки ×2 за 7+, ×2 за чужое коикои', () => {
    let s = pos({ mode: 'koikoi', months: 1 }, [[SAKE, 1, 5], [3, 7, 11]], [34, 22, 26], [42, 16], [[CURTAIN, MOON], [13]]);
    s = step(s, 0, { type: 'play', card: SAKE }).state;
    s = step(s, 0, { type: 'draw' }).state;
    expect(s.phase).toBe('call');
    const r = step(s, 0, { type: 'call', go: false });
    expect(r.state.over).toBe(true);
    expect(r.state.score[0]).toBe(20);
    // соперник сказал коикои, а остановил его я
    let t = pos({ mode: 'koikoi', months: 1, double7: false }, [[SAKE, 1, 5], [3, 7, 11]], [34, 22, 26], [42, 16], [[CURTAIN, MOON], [13]]);
    t.calls[1] = 1;
    t = step(t, 0, { type: 'play', card: SAKE }).state;
    t = step(t, 0, { type: 'draw' }).state;
    expect(step(t, 0, { type: 'call', go: false }).state.score[0]).toBe(20);
  });

  it('го-стоп: «го» прибавляет, штрафы удваивают', () => {
    const s = pos({ mode: 'gostop' }, [[], []], [], [], [[CRANE, CURTAIN, MOON, 4, 12, 29], [2]]);
    // 3 (светы) + 5 (годори) = 8; у соперника нет светов — кван-бак
    expect(hf.goPayment(s, 0, 1).pts).toBe(16);
    s.calls[0] = 3;
    // (8 + 2) × 2 за третье го × 2 кван-бак
    expect(hf.goPayment(s, 0, 1).pts).toBe(40);
  });

  it('недопустимое отбрасывается; чужие руки не видны', () => {
    const s = hf.setup([0, 1], { mode: 'koikoi' }, new SeededRng(5));
    const other = s.oya === 0 ? 1 : 0;
    expect(hf.apply(s, other, { type: 'play', card: s.hands[other][0] }, rng)).toBeNull();
    expect(hf.apply(s, s.oya, { type: 'draw' }, rng)).toBeNull();
    const v = hf.makeView(s, [other]);
    expect(v.hands[s.oya]).toEqual([]);
    expect(v.counts[s.oya]).toBe(8);
    expect((v as unknown as { deck?: number[] }).deck).toBeUndefined();
  });

  it('боты всех уровней доигрывают партии (коикои и го-стоп втроём)', () => {
    HARD.worlds = 3;
    for (const [opts, n] of [
      [{ mode: 'koikoi', months: 3 }, 2],
      [{ mode: 'gostop', months: 3 }, 3],
      [{ mode: 'gostop', months: 3 }, 2],
    ] as const) {
      for (let seed = 1; seed <= 3; seed++) {
        const r = new SeededRng(seed);
        const seats = Array.from({ length: n }, (_, i) => i);
        let s = hf.setup(seats, opts, r);
        for (let k = 0; k < 3000 && !s.over; k++) {
          const seat = hf.toAct(s)[0];
          const a = choose(hf.makeView(s, [seat]), seat, (seat + seed) % 3, r);
          expect(a).not.toBeNull();
          const res = hf.apply(s, seat, a!, r);
          expect(res, JSON.stringify(a)).not.toBeNull();
          s = res!.state;
        }
        expect(s.over).toBe(true);
        expect(s.round).toBe(3);
        if (opts.mode === 'gostop') expect(s.seats.reduce((a, x) => a + s.score[x], 0)).toBe(0);
      }
    }
  });
});
