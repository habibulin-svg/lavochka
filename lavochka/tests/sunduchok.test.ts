/* Сундучок: память стола не выводится из скрытой руки (вариант с мастью). */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { apply, cfgFrom, makeView, newState } from '../src/games/sunduchok/engine';

describe('Сундучок', () => {
  it('с мастью: отдача одной карты ранга не выдаёт, что у отдавшего остался ещё король', () => {
    const s = newState(cfgFrom({ suit: true }), [0, 1]);
    s.hands[0] = [{ r: 13, s: 'H' }, { r: 7, s: 'C' }];
    s.hands[1] = [{ r: 13, s: 'S' }, { r: 13, s: 'D' }, { r: 8, s: 'C' }];
    s.known[1] = [13];
    s.bazaar = [{ r: 9, s: 'C' }];
    s.turn = 0;
    const r = apply(s, 0, { type: 'ask', target: 1, rank: 13, suit: 'S' }, new SeededRng(1));
    expect(r).not.toBeNull();
    const v = makeView(r!.state, [0]);
    expect(v.known[1]).not.toContain(13);
  });
});
