/* Окей и руммикуб: комбинации, окей по индикатору, выход и семь пар, первая выкладка на 30, перестройка стола, боты. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/okey/ai';
import { def } from '../src/games/okey/def';
import * as ok from '../src/games/okey/engine';
import { partition, sevenPairs, validGroup, type Tile } from '../src/games/okey/tiles';

const CL = ['к', 'ж', 'с', 'ч'];
const T = (s: string): Tile => (s.startsWith('☺') ? { c: 0, n: 0, k: s.endsWith("'") ? 1 : 0 } : { c: CL.indexOf(s[0]), n: parseInt(s.slice(1)), k: s.endsWith("'") ? 1 : 0 });
const TS = (s: string) => s.split(/\s+/).filter(Boolean).map(T);
const plain = (t: Tile) => ({ wild: false, c: t.c, n: t.n });
const W = { wrap13: true };
const N = { wrap13: false };
const rng = new SeededRng(1);

describe('Окей и руммикуб', () => {
  it('комбинации: группы и ряды, 12-13-1 в окее, 13-1-2 нигде', () => {
    expect(validGroup(TS('к5 ж5 с5').map(plain), N)).toBe('set');
    expect(validGroup(TS('к5 к5\' с5').map(plain), N)).toBeNull();
    expect(validGroup(TS('к4 к5 к6 к7').map(plain), N)).toBe('run');
    expect(validGroup(TS('к12 к13 к1').map(plain), W)).toBe('run');
    expect(validGroup(TS('к12 к13 к1').map(plain), N)).toBeNull();
    expect(validGroup(TS('к13 к1 к2').map(plain), W)).toBeNull();
    expect(partition(TS('к3 к4 к5 ж7 с7 ч7 с10 с11 с12 с13'), plain, N)?.length).toBe(3);
  });

  it('окей: индикатор, окей-джокер, ложный окей, выход', () => {
    const s = ok.newState(ok.cfgFrom({}), [0, 1]);
    s.okey = { c: 3, n: 10 };
    s.indicator = T('ч9');
    s.racks[0] = TS('к3 к4 к5 ж7 с7 ч7 с10 с11 с12 с13 ж1 ж2 ч10 ж4 к13');
    s.phase = 'discard';
    s.turn = 0;
    const face = ok.faceOf(s);
    expect(face(T('ч10')).wild).toBe(true);
    expect(face(T('☺'))).toEqual({ wild: false, c: 3, n: 10 });
    expect(ok.canFinish(s, 0, T('к13'))).toBe('melds');
    expect(ok.canFinish(s, 0, T('к3'))).toBe(false);
    const r = ok.apply(s, 0, { type: 'discard', tile: T('к13'), finish: true }, rng)!;
    const hand = r.events.find((e) => e.type === 'hand') as Extract<ok.Event, { type: 'hand' }>;
    expect(hand.winner).toBe(0);
    expect(hand.delta[1]).toBe(-2);
  });

  it('семь пар', () => {
    expect(sevenPairs(TS("к1 к1' ж2 ж2' с3 с3' ч4 ч4' к5 к5' ж6 ж6' с7 с7'"), plain)).toBe(true);
    expect(sevenPairs(TS("к1 к1' ж2 ж2' с3 с3' ч4 ч4' к5 к5' ж6 ж6' с7 с8"), plain)).toBe(false);
  });

  it('окей: взять сброс соседа слева', () => {
    const s = ok.setup([0, 1, 2, 3], {}, new SeededRng(4));
    const first = s.turn;
    const t = s.racks[first][0];
    const r = ok.apply(s, first, { type: 'discard', tile: t }, rng)!;
    const nx = r.state.turn;
    const r2 = ok.apply(r.state, nx, { type: 'draw', from: 'left' }, rng)!;
    expect(r2.state.racks[nx].some((x) => x.c === t.c && x.n === t.n && x.k === t.k)).toBe(true);
  });

  it('руммикуб: первая выкладка от 30 только своими; потом — перестройка стола', () => {
    const s = ok.newState(ok.cfgFrom({ mode: 'rummikub' }), [0, 1]);
    s.racks[0] = TS('к10 ж10 с10 ч1 ч2 ч3 к5 к4');
    s.phase = 'turn';
    s.turn = 0;
    expect(ok.arrange(s, 0, TS('ч1 ч2 ч3'))).toBeNull(); // 6 < 30
    expect(ok.arrange(s, 0, TS('к10 ж10 с10'))).not.toBeNull();
    const r = ok.apply(s, 0, { type: 'play', tiles: TS('к10 ж10 с10 ч1 ч2 ч3') }, rng)!;
    expect(r.state.table.length).toBe(2);
    // ход соперника: пас; затем к4 к5 + к10 из группы? — нет: к4 к5 и к6 со стола нет; проверим доклад ч4 к ряду
    const t = r.state;
    t.turn = 0;
    t.racks[0] = TS('ч4 к5');
    const lay = ok.arrange(t, 0, TS('ч4'));
    expect(lay!.some((g) => g.length === 4)).toBe(true);
    // перестройка: ч10 разбивает группу десяток? нет — добавляется четвёртой
    t.racks[0] = TS('ч10 к5');
    expect(ok.arrange(t, 0, TS('ч10'))!.some((g) => g.length === 4 && g.every((x) => x.n === 10))).toBe(true);
  });

  it('боты доигрывают окей и руммикуб', () => {
    for (const p of def.presets!) {
      const r = new SeededRng(13);
      let s = ok.setup([0, 1, 2, 3], { ...p.options, start: 10, rounds: 1 }, r);
      for (let i = 0; i < 20000 && !s.over; i++) {
        const seat = s.turn;
        const a = choose(def.view(s, [seat]), seat, i % 3, r)!;
        const res = ok.apply(s, seat, a, r);
        expect(res, `${p.id}: ${JSON.stringify(a)} фаза ${s.phase}`).not.toBeNull();
        s = res!.state;
      }
      expect(s.over, p.id).toBe(true);
    }
  }, 300000);
});

describe('окей: показ индикатора и «Окей 101»', () => {
  const base = (mode: 'okey' | 'o101', racks: string[]) => {
    const s = ok.newState(ok.cfgFrom({ mode }), [0, 1]);
    racks.forEach((r, i) => (s.racks[i] = TS(r)));
    s.stock = TS('к1 к2 ж1 ж2 с1 с2 ч1 ч2');
    s.round = 1;
    s.turn = 0;
    s.indicator = T('ч9');
    s.okey = { c: 3, n: 10 };
    s.phase = 'discard';
    return s;
  };
  it('показ: вторая такая же, как индикатор, — в первый ход, остальным −1, один раз', () => {
    const s = base('okey', ['к3 к4 ч9 ж7', 'с1 с2']);
    const r = ok.apply(s, 0, { type: 'show' }, new SeededRng(1))!;
    expect(r.state.score).toEqual([20, 19]);
    expect(ok.apply(r.state, 0, { type: 'show' }, new SeededRng(1))).toBeNull();
    expect(ok.apply({ ...s, moves: 2 }, 0, { type: 'show' }, new SeededRng(1))).toBeNull();
  });
  it('101: открытие от 101, меньше — нельзя; выход — себе −101, неоткрывшемуся +202', () => {
    const s = base('o101', ['к10 к11 к12 к13 ж10 ж11 ж12 ж13 к9 ж9 с9 ч1', 'с1 с2 с3']);
    expect(ok.apply(s, 0, { type: 'play', tiles: TS('к10 к11 к12 к13') }, new SeededRng(1))).toBeNull(); // 46 < 101
    let r = ok.apply(s, 0, { type: 'play', tiles: TS('к10 к11 к12 к13 ж10 ж11 ж12 ж13 к9 ж9 с9') }, new SeededRng(1))!;
    expect(r.state.opened[0]).toBe(true);
    r = ok.apply(r.state, 0, { type: 'discard', tile: T('ч1') }, new SeededRng(1))!;
    const hand = r.events.find((e) => e.type === 'hand') as Extract<ok.Event, { type: 'hand' }>;
    expect(hand.delta[0]).toBe(-101);
    expect(hand.delta[1]).toBe(202);
  });
  it('101: открытие пятью парами — дальше только пары, штрафы вдвое', () => {
    const s = base('o101', ['к1 к1\' ж2 ж2\' с3 с3\' ч4 ч4\' к5 к5\' ж8', 'с1 с2 с3']);
    const r = ok.apply(s, 0, { type: 'play', tiles: TS('к1 к1\' ж2 ж2\' с3 с3\' ч4 ч4\' к5 к5\'') }, new SeededRng(1))!;
    expect(r.state.pairs![0]).toBe(true);
    const end = ok.apply(r.state, 0, { type: 'discard', tile: T('ж8') }, new SeededRng(1))!;
    const hand = end.events.find((e) => e.type === 'hand') as Extract<ok.Event, { type: 'hand' }>;
    expect(hand.delta[0]).toBe(-202);
    expect(hand.delta[1]).toBe(404);
  });
});
