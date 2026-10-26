import { describe, expect, it } from 'vitest';
import { choose } from '../src/games/patolli/ai';
import { def } from '../src/games/patolli/def';
import { apply, applyMove, applyRoll, cellOf, cfgFrom, kindOf, legalMoves, newState, throwValue, type State } from '../src/games/patolli/engine';
import { SeededRng } from '../src/core/rng';

const beans = (c: number) => [0, 1, 2, 3, 4].map((i) => (i < c ? 1 : 0));

/** Позиция: пути фишек мест (остальные в чаше), ходит turn. */
function pos(pieces: number[][], opts = {}, turn = 0): State {
  const s = newState(cfgFrom(opts), pieces.length, turn);
  s.pos = s.pos.map((row, i) => row.map((_, k) => pieces[i][k] ?? -1));
  return s;
}

function game(levels: number[], seed: number, opts = {}): State {
  const rng = new SeededRng(seed);
  const seats = levels.map((level, seat) => ({ seat, kind: 'bot' as const, name: String(seat), level }));
  let s = def.setup(seats, { ...opts }, rng) as State;
  for (let i = 0; i < 20000 && s.phase !== 'over'; i++) {
    const a = choose(s, s.turn, levels[s.turn], rng);
    if (!a) throw new Error('бот не нашёл хода');
    const r = apply(s, s.turn, a, rng);
    if (!r) throw new Error('недопустимый ход бота');
    s = r.state;
  }
  return s;
}

describe('патолли', () => {
  it('поле: 52 клетки, по лучу два треугольника и два полукруга, четыре середины', () => {
    const k = Array.from({ length: 52 }, (_, c) => kindOf(c));
    expect(k.filter((x) => x === 'tri').length).toBe(8);
    expect(k.filter((x) => x === 'cap').length).toBe(8);
    expect(k.filter((x) => x === 'mid').length).toBe(4);
  });

  it('бобы: по Дурану пять точек — 10, ни одной — подношение; современные — ноль это 10', () => {
    const d = cfgFrom({});
    const m = cfgFrom({ throws: 'modern' });
    expect(throwValue(d, beans(3))).toBe(3);
    expect(throwValue(d, beans(5))).toBe(10);
    expect(throwValue(d, beans(0))).toBe(0);
    expect(throwValue(m, beans(0))).toBe(10);
    expect(throwValue(m, beans(5))).toBe(5);
  });

  it('подношение: ставка в кон, ход переходит', () => {
    const s = applyRoll(pos([[], []]), beans(0)).state;
    expect(s.stakes[0]).toBe(9);
    expect(s.pot).toBe(1);
    expect(s.turn).toBe(1);
  });

  it('вход только на единицу', () => {
    expect(legalMoves(applyRoll(pos([[], []]), beans(2)).state)).toEqual([]);
    const s = applyMove(applyRoll(pos([[], []]), beans(1)).state, -1)!.state;
    expect(s.pos[0]).toContain(0);
  });

  it('треугольник — ставка в кон, полукруг — ещё бросок', () => {
    let s = applyMove(applyRoll(pos([[1], [30]]), beans(2)).state, 1)!.state;
    expect(s.pot).toBe(1);
    expect(s.turn).toBe(1);
    s = applyMove(applyRoll(pos([[1], [30]]), beans(4)).state, 1)!.state;
    expect(kindOf(cellOf(s.arms[0], 5))).toBe('cap');
    expect(s.turn).toBe(0);
    expect(s.phase).toBe('roll');
  });

  it('сбить можно только в середине; вне середины занятая клетка закрыта', () => {
    // место 0 — луч 3, место 1 — луч 1; середина между лучами 0 и 1 — клетка 12 (путь 25 у места 0, 51 у места 1)
    let s = applyMove(applyRoll(pos([[22], [51]]), beans(3)).state, 22)!.state;
    expect(s.pos[1]).not.toContain(51);
    expect(s.stakes).toEqual([11, 9]);
    // путь 2 места 1 (клетка 15) = путь 28 места 0
    s = applyRoll(pos([[26], [2]]), beans(2)).state;
    expect(legalMoves(s)).toEqual([]);
  });

  it('круг пройден точным броском: соперник платит, кон забирает', () => {
    const t = pos([[49], [10]]);
    t.pot = 2;
    expect(legalMoves(applyRoll(t, beans(4)).state)).toEqual([]);
    const s = applyMove(applyRoll(t, beans(3)).state, 49)!.state;
    expect(s.pos[0]).toContain(52);
    expect(s.stakes).toEqual([13, 9]);
    expect(s.pot).toBe(0);
  });

  it('нечем платить — выбыл, вдвоём это конец', () => {
    const t = pos([[], []]);
    t.stakes = [0, 5];
    const s = applyRoll(t, beans(0)).state;
    expect(s.phase).toBe('over');
    expect(s.winners).toEqual([1]);
  });

  it('боты доигрывают партии во всех пресетах', () => {
    for (const p of def.presets!) {
      for (const n of [2, 4]) {
        const s = game(Array(n).fill(1), 7 + n, p.options);
        expect(s.phase).toBe('over');
        expect(s.winners.length).toBeGreaterThan(0);
      }
    }
  });

  it('сложный бот обыгрывает лёгкого', () => {
    let w = 0;
    for (let i = 0; i < 12; i++) {
      const s = game(i % 2 ? [2, 0] : [0, 2], 100 + i, { pieces: 3, enter: 'any' });
      const strong = i % 2 ? 0 : 1;
      if (s.winners.includes(strong)) w++;
    }
    expect(w).toBeGreaterThanOrEqual(7);
  });
});
