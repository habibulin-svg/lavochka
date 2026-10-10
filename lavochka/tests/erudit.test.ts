/* Эрудит: наборы фишек, премии, проверка выкладки, подсчёт, звёздочка, конец партии, боты. */
import { beforeAll, describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { findMoves } from '../src/games/erudit/ai';
import { apply, CENTER, cfgFrom, evaluate, makeView, N, newGame, PREMIUM, premiumOf, SETS, type State } from '../src/games/erudit/engine';
import { loadDict } from '../src/words/dict';

beforeAll(() => loadDict());

const at = (r: number, c: number) => r * N + c;
const game = (racks: string[][], o = {}): State => {
  const s = newGame([0, 1], cfgFrom(o), new SeededRng(5));
  s.racks = racks.map((r) => r.slice());
  s.cur = 0;
  return s;
};

describe('эрудит: набор и поле', () => {
  it('131 фишка в «Эрудите», 104 — в «Скрэббле»', () => {
    const total = (k: string) => Object.values(SETS[k].tiles).reduce((a, [n]) => a + n, 0);
    expect(total('erudit')).toBe(131);
    expect(total('scrabble')).toBe(104);
    const s = newGame([0, 1], cfgFrom({}), new SeededRng(1));
    expect(s.bag.length + s.racks.flat().length).toBe(131);
  });
  it('премии: 8 красных, 16 синих + центр, 12 жёлтых, 24 зелёных', () => {
    const count = (p: string) => PREMIUM.filter((x) => x === p).length;
    expect([count('W3'), count('W2'), count('L3'), count('L2')]).toEqual([8, 17, 12, 24]);
    expect(premiumOf({ set: 'erudit' }, CENTER)).toBe('');
    expect(premiumOf({ set: 'scrabble' }, CENTER)).toBe('W2');
  });
});

describe('эрудит: выкладка', () => {
  it('первое слово — через центр; КОТ = 5 очков', () => {
    const s = game([['к', 'о', 'т', 'а', 'р', 'с', 'и'], ['л', 'е', 'с', 'н', 'о', 'д', 'м']]);
    const off = evaluate(s, [at(6, 5), at(6, 6), at(6, 7)].map((cell, i) => ({ cell, letter: 'кот'[i] })), s.racks[0]);
    expect(off.ok).toBe(false);
    const v = evaluate(s, [at(7, 5), at(7, 6), at(7, 7)].map((cell, i) => ({ cell, letter: 'кот'[i] })), s.racks[0]);
    expect(v.ok && v.score.points).toBe(5);
    const sc = game([['к', 'о', 'т', 'а', 'р', 'с', 'и'], []], { set: 'scrabble' });
    const w = evaluate(sc, [at(7, 5), at(7, 6), at(7, 7)].map((cell, i) => ({ cell, letter: 'кот'[i] })), sc.racks[0]);
    expect(w.ok && w.score.points).toBe((2 + 1 + 1) * 2);
  });
  it('поперёк: СОМ через О — 9 очков, пропуск и отрыв — нельзя', () => {
    const s = game([[], ['л', 'е', 'с', 'н', 'о', 'д', 'м']]);
    for (const [i, ch] of [...'кот'].entries()) s.board[at(7, 5 + i)] = { ch };
    s.cur = 1;
    const v = evaluate(s, [{ cell: at(6, 6), letter: 'с' }, { cell: at(8, 6), letter: 'м' }], s.racks[1]);
    expect(v.ok && v.score.points).toBe(9);
    expect(evaluate(s, [{ cell: at(2, 2), letter: 'с' }], s.racks[1]).ok).toBe(false);
    expect(evaluate(s, [{ cell: at(5, 6), letter: 'с' }, { cell: at(8, 6), letter: 'м' }], s.racks[1]).ok).toBe(false);
  });
  it('все 7 фишек — бонус 15', () => {
    const s2 = game([['п', 'а', 'л', 'а', 'т', 'к', 'а'], []]);
    const v2 = evaluate(s2, [...'палатка'].map((ch, i) => ({ cell: at(7, 4 + i), letter: ch })), s2.racks[0]);
    expect(v2.ok && v2.score.bonus).toBe(true);
  });
  it('звёздочка: 0 очков, выкуп своей буквой', () => {
    const s = game([['*', 'о', 'т', 'а', 'р', 'с', 'и'], ['к', 'е', 'л', 'н', 'о', 'д', 'м']]);
    const r = apply(s, 0, { type: 'play', tiles: [{ cell: at(7, 5), letter: '*', as: 'к' }, { cell: at(7, 6), letter: 'о' }, { cell: at(7, 7), letter: 'т' }] }, new SeededRng(1))!;
    expect(r.state.scores[0]).toBe(3);
    expect(r.state.board[at(7, 5)]).toEqual({ ch: 'к', joker: true });
    // Серёга выкупает звёздочку своей К и тут же кладёт её как Д: ДОМ по столбцу через О
    const t = r.state;
    const v = evaluate(t, [{ cell: at(6, 6), letter: '*', as: 'д' }, { cell: at(8, 6), letter: 'м' }], [...t.racks[1]], at(7, 5));
    expect(v.ok).toBe(true);
    const u = apply(t, 1, { type: 'play', tiles: [{ cell: at(6, 6), letter: '*', as: 'д' }, { cell: at(8, 6), letter: 'м' }], take: at(7, 5) }, new SeededRng(1))!;
    expect(u.state.board[at(7, 5)]).toEqual({ ch: 'к' });
    expect(u.state.board[at(6, 6)]).toEqual({ ch: 'д', joker: true });
    // забрал — а выложить не выложил: нельзя
    expect(evaluate(t, [{ cell: at(8, 6), letter: 'м' }], [...t.racks[1]], at(7, 5)).ok).toBe(false);
  });
});

describe('эрудит: конец и скрытые фишки', () => {
  it('все пропускают два круга — конец, остатки вычитаются', () => {
    let s = game([['к', 'о'], ['т']]);
    const rng = new SeededRng(1);
    for (let i = 0; i < 4; i++) s = apply(s, s.seats[s.cur], { type: 'pass' }, rng)!.state;
    expect(s.over).toBe(true);
    expect(s.scores).toEqual([-3, -2]);
  });
  it('чужая рука и мешок не видны', () => {
    const s = newGame([0, 1], cfgFrom({}), new SeededRng(2));
    const v = makeView(s, [0]);
    expect(v.racks[0].length).toBe(7);
    expect(v.racks[1]).toEqual([]);
    expect(v.bag).toEqual([]);
    expect(v.counts[1]).toBe(7);
  });
});

describe('эрудит: боты', () => {
  it('находят ходы, и все они проходят проверку движка', () => {
    const s = game([['к', 'о', 'т', 'а', 'р', 'с', 'и'], []]);
    const v = makeView(s, [0]);
    const moves = findMoves(v, s.racks[0]);
    expect(moves.length).toBeGreaterThan(10);
    for (const m of moves.slice(0, 40)) expect(evaluate(s, m.tiles, s.racks[0]).ok).toBe(true);
  });
});
