/* Точки: окружение по диагоналям, «домик», освобождение пленных, крест, конец по согласию и по заполнению, боты. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { def } from '../src/games/dots/def';
import { tuning } from '../src/games/dots/ai';
import { apply, cfgFrom, newState, type Action, type State } from '../src/games/dots/engine';
import { botSeats, simulate } from './harness';

const small = () => newState(cfgFrom({ size: 'small', cross: false }), [0, 1]);
const W = 16;
function put(s: State, ...xy: [number, number][]): State {
  for (const [x, y] of xy) {
    const r = apply(s, s.turn, { type: 'dot', p: y * W + x });
    expect(r, `${x},${y}`).not.toBeNull();
    s = r!.state;
  }
  return s;
}

describe('окружение', () => {
  it('ромб вокруг точки — пленная, внутри — территория', () => {
    const s = put(small(), [4, 5], [5, 5], [5, 4], [10, 9], [6, 5], [10, 10], [5, 6]);
    expect(s.scores[0]).toBe(1);
    expect(s.takenBy[5 * W + 5]).toBe(0);
    expect(s.owner[5 * W + 5]).toBe(0);
    expect(apply(s, s.turn, { type: 'dot', p: 5 * W + 5 })).toBeNull();
  });
  it('у края не окружают', () => {
    const s = put(small(), [1, 0], [0, 0], [0, 1], [10, 10]);
    expect(s.scores[0]).toBe(0);
  });
  it('домик: точка внутрь — сразу пленная', () => {
    const s = put(small(), [4, 5], [10, 9], [5, 4], [10, 10], [6, 5], [11, 9], [5, 6], [5, 5]);
    expect(s.scores[0]).toBe(1);
    expect(s.takenBy[5 * W + 5]).toBe(0);
  });
  it('большое окружение освобождает своих пленных', () => {
    // красный окружил синюю (5,5), синий окружает весь красный ромб
    let s = put(small(), [4, 5], [5, 5], [5, 4], [3, 5], [6, 5], [5, 3], [5, 6], [7, 5], [10, 12], [5, 7], [11, 12], [4, 4], [12, 12], [6, 4], [13, 12], [4, 6], [12, 11], [6, 6]);
    expect(s.scores[0]).toBe(0);
    expect(s.scores[1]).toBeGreaterThanOrEqual(4);
    expect(s.takenBy[5 * W + 5]).toBe(-1);
  });
  it('крест вдвоём и конец по согласию', () => {
    let s = newState(cfgFrom({ size: 'small', cross: true }), [0, 1]);
    expect(s.dots.filter((d) => d >= 0).length).toBe(4);
    s = put(s, [1, 1], [2, 2], [3, 3], [4, 4]);
    s = apply(s, 0, { type: 'finish' })!.state;
    expect(def.toAct(s)).toEqual([1]);
    const d = apply(s, 1, { type: 'decline' })!.state;
    expect(d.phase).toBe('play');
    const e = apply(s, 1, { type: 'accept' })!.state;
    expect(e.phase).toBe('over');
    expect(e.winners).toEqual([0, 1]);
  });
});

describe('боты', () => {
  it('средний обыгрывает лёгкого', async () => {
    tuning.fast = false;
    let mid = 0;
    let easy = 0;
    for (let g = 0; g < 4; g++) {
      const seats = botSeats(def, 2).map((x, i) => ({ ...x, level: (g + i) % 2 ? 1 : 0 }));
      const r = await simulate(def, seats, { size: 'small', cross: true }, 40 + g, 2000);
      if (!r.finished || r.winners.length !== 1) continue;
      for (const w of r.winners) seats.find((x) => x.seat === w)!.level === 1 ? mid++ : easy++;
    }
    tuning.fast = true;
    expect(mid).toBeGreaterThan(easy);
  }, 120_000);
  it('ход бота допустим', async () => {
    const s = newState(cfgFrom({}), [0, 1]);
    for (const lv of [0, 1, 2]) {
      const a = (await def.bot.choose(s, 0, lv, new SeededRng(lv))) as Action;
      expect(apply(s, 0, a)).not.toBeNull();
    }
  });
});
