/* Верю — не верю: проверка одной карты не раскрывает остальные карты стопки. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import type { Card } from '../src/cards/deck';
import { apply, cfgFrom, newState } from '../src/games/bluff/engine';

const c = (r: number, s: Card['s']): Card => ({ r, s });

describe('верю — не верю', () => {
  it('в режиме «одна карта» событие и reveal содержат только открытую карту', () => {
    const s = newState(cfgFrom({ one: true }), [0, 1, 2]);
    s.hands[0] = [c(7, 'S'), c(8, 'H'), c(9, 'D')];
    s.hands[1] = [c(10, 'S')];
    s.hands[2] = [c(11, 'S')];
    s.turn = 0;
    const rng = new SeededRng(4);
    const a = apply(s, 0, { type: 'lead', cards: [c(7, 'S'), c(8, 'H'), c(9, 'D')], rank: 7 }, rng)!;
    const r = apply(a.state, 1, { type: 'check', index: 1 }, rng)!;
    const ev = r.events.find((e) => e.type === 'check');
    expect(ev && ev.type === 'check' && ev.cards).toEqual([c(8, 'H')]);
    expect(r.state.reveal!.cards).toEqual([c(8, 'H')]);
  });
});
