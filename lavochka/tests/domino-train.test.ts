/* Домино — мексиканский поезд: раздача, свой/общий/чужой открытый поезд, дубль надо закрыть, паровозик, конец кона. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { MEX, newTrain, trainApply, trainDeal, trainMoves, trainView, type TState } from '../src/games/domino/train';

const rng = () => new SeededRng(5);

function pos(hands: TState['hands'], extra: Partial<TState> = {}): TState {
  const s = newTrain({ variant: 'train', rounds: 7 }, [0, 1, 2]);
  s.round = 1;
  s.engine = 6;
  s.hands = hands;
  return Object.assign(s, extra);
}

describe('мексиканский поезд', () => {
  it('раздача: станция 6-6 вне колоды, втроём по 7', () => {
    const s = trainDeal(newTrain({ variant: 'train', rounds: 7 }, [0, 1, 2]), rng()).state;
    expect(s.engine).toBe(6);
    expect(s.seats.map((x) => s.hands[x].length)).toEqual([7, 7, 7]);
    expect(s.yard.length).toBe(27 - 21);
    expect([...s.hands.flat(), ...s.yard].some((b) => b[0] === 6 && b[1] === 6)).toBe(false);
  });

  it('ходить можно в свой и мексиканский, в чужой — только с паровозиком', () => {
    const s = pos([[[6, 1]], [], [], []]);
    expect(trainMoves(s, 0, s.hands[0]).map((m) => m.train).sort()).toEqual([0, MEX]);
    const o = { ...s, open: [false, true, false, false, true] };
    expect(trainMoves(o, 0, o.hands[0]).map((m) => m.train).sort()).toEqual([0, 1, MEX]);
  });

  it('дубль — ходи ещё и закрой; не закрыл — висит для всех', () => {
    let s = pos([[[6, 2], [2, 2], [0, 1]], [[2, 5], [6, 3]], [[1, 4]], []], { yard: [] });
    s = trainApply(s, 0, { type: 'play', bone: [6, 2], train: 0 }, rng())!.state;
    s = trainApply(s, 1, { type: 'play', bone: [6, 3], train: 1 }, rng())!.state;
    expect(trainApply(s, 2, { type: 'play', bone: [1, 4], train: MEX }, rng())).toBeNull();
    // Санёк не может ходить 1-4 (на станции 6) — пропуск, паровозик
    s = trainApply(s, 2, { type: 'pass' }, rng())!.state;
    expect(s.open[2]).toBe(true);
    s = trainApply(s, 0, { type: 'play', bone: [2, 2], train: 0 }, rng())!.state;
    expect(s.turn).toBe(0);
    expect(s.due).toBe(0);
    // закрыть нечем — пропуск; дубль висит, Петрович обязан закрыть
    s = trainApply(s, 0, { type: 'pass' }, rng())!.state;
    expect(trainMoves(s, 1, s.hands[1]).map((m) => m.train)).toEqual([0]);
    s = trainApply(s, 1, { type: 'play', bone: [2, 5], train: 0 }, rng())!.state;
    expect(s.due).toBeNull();
  });

  it('вышел — кон окончен, остальные пишут очки с рук', () => {
    const s = pos([[[6, 1]], [[3, 4]], [[0, 2]], []], { yard: [] });
    const r = trainApply(s, 0, { type: 'play', bone: [6, 1], train: 0 }, rng())!;
    expect(r.events.some((e) => e.type === 'tround')).toBe(true);
    expect(r.state.scores.slice(0, 3)).toEqual([0, 7, 2]);
    expect(r.state.engine).toBe(5);
  });

  it('чужие руки не видны', () => {
    const s = trainDeal(newTrain({ variant: 'train', rounds: 7 }, [0, 1]), rng()).state;
    const v = trainView(s, [0]);
    expect(v.hands[1]).toEqual([]);
    expect(v.counts[1]).toBe(8);
  });
});
