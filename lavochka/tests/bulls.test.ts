/* Быки и коровы / «Логика»: подсчёт, дуэль с уравнивающей попыткой, коны и очки, скрытие кодов, боты. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/bulls/ai';
import { apply, cfgFrom, makeView, newState, score, toAct, type State } from '../src/games/bulls/engine';

const DUEL = { symbols: 'digits', len: 4, repeats: false, mode: 'duel' };
const LOGIKA = { symbols: 'colors', len: 5, colors: 8, repeats: true, mode: 'rounds', rows: 12, rounds: 2 };

describe('быки и коровы', () => {
  it('быки и коровы считаются и с повторами', () => {
    expect(score([1, 2, 3, 4], [1, 2, 4, 3], 10)).toEqual([2, 2]);
    expect(score([1, 2, 3, 4], [5, 6, 7, 8], 10)).toEqual([0, 0]);
    // повторы: в коде одна синяя на своём месте, в попытке синих три
    expect(score([0, 1, 2, 2, 3], [1, 1, 1, 0, 4], 8)).toEqual([1, 1]);
  });

  it('дуэль: начинавшему угадавшему — уравнивающая попытка соперника', () => {
    let s = newState(cfgFrom(DUEL), 2, new SeededRng(1));
    expect(toAct(s).sort()).toEqual([0, 1]);
    s = apply(s, 0, { type: 'secret', code: [9, 0, 1, 2] })!.state;
    s = apply(s, 1, { type: 'secret', code: [4, 7, 2, 5] })!.state;
    expect(s.phase).toBe('guess');
    // повторяющиеся цифры нельзя
    expect(apply(s, 0, { type: 'guess', code: [1, 1, 2, 3] })).toBeNull();
    s = apply(s, 0, { type: 'guess', code: [4, 7, 2, 5] })!.state;
    expect(s.phase).toBe('guess');
    expect(toAct(s)).toEqual([1]);
    const miss = apply(s, 1, { type: 'guess', code: [1, 2, 3, 4] })!.state;
    expect(miss.winners).toEqual([0]);
    const draw = apply(s, 1, { type: 'guess', code: [9, 0, 1, 2] })!.state;
    expect(draw.phase).toBe('over');
    expect(draw.winners).toEqual([]);
  });

  it('чужой код не виден, свой — виден', () => {
    let s = newState(cfgFrom(DUEL), 2, new SeededRng(1));
    s = apply(s, 0, { type: 'secret', code: [9, 0, 1, 2] })!.state;
    const v = makeView(s, [1]);
    expect(v.secrets[0]).toEqual([]);
    expect(makeView(s, [0]).secrets[0]).toEqual([9, 0, 1, 2]);
  });

  it('Логика: очко за ряд, роли меняются, меньше — лучше', () => {
    let s = newState(cfgFrom(LOGIKA), 2, new SeededRng(1));
    expect(toAct(s)).toEqual([1]);
    s = apply(s, 1, { type: 'secret', code: [0, 1, 1, 2, 3] })!.state;
    s = apply(s, 0, { type: 'guess', code: [0, 0, 1, 1, 4] })!.state;
    s = apply(s, 0, { type: 'guess', code: [0, 1, 1, 2, 3] })!.state;
    expect(s.scores[0]).toBe(2);
    expect(s.round).toBe(1);
    expect(toAct(s)).toEqual([0]);
    s = apply(s, 0, { type: 'secret', code: [5, 5, 5, 5, 5] })!.state;
    s = apply(s, 1, { type: 'guess', code: [5, 5, 5, 5, 5] })!.state;
    expect(s.phase).toBe('over');
    expect(s.winners).toEqual([1]);
  });

  it('не разгадал за все ряды — рядов плюс одно очко', () => {
    let s = newState(cfgFrom({ ...LOGIKA, rows: 6 }), 2, new SeededRng(1));
    s = apply(s, 1, { type: 'secret', code: [0, 1, 2, 3, 4] })!.state;
    for (let i = 0; i < 6; i++) s = apply(s, 0, { type: 'guess', code: [7, 7, 7, 7, 7] })!.state;
    expect(s.scores[0]).toBe(7);
    expect(s.past[0].solved).toBe(false);
  });

  it('сложный бот разгадывает 4 цифры в среднем быстрее 7 попыток', () => {
    let total = 0;
    const G = 8;
    for (let g = 0; g < G; g++) {
      const rng = new SeededRng(50 + g);
      let s: State = newState(cfgFrom(DUEL), 1, rng);
      while (s.phase !== 'over') s = apply(s, 0, choose(s, 0, 2, rng)!)!.state;
      expect(s.winners).toEqual([0]);
      total += s.past[0].tries.length;
    }
    expect(total / G).toBeLessThan(7);
  }, 60_000);
});
