import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { countSolutions, generate, grade } from '../src/games/puzzles/sudoku';

/** Уровни судоку: лёгкий, средний, сложный — одиночками (открытых всё меньше), эксперт — пары/крестокрыл; перебора нет нигде. */
describe('судоку: уровни', () => {
  it('решение единственное и находится логикой', () => {
    const givens: number[][] = [[], [], [], [], []];
    for (let lv = 1; lv <= 4; lv++)
      for (let seed = 1; seed <= 6; seed++) {
        const p = generate(new SeededRng(seed * 31 + lv), lv);
        expect(countSolutions(p.puzzle, 2).count, `lv${lv} seed${seed}`).toBe(1);
        const g = grade(p.puzzle);
        if (lv <= 3) expect(g, `lv${lv} seed${seed}`).toBe(1);
        else expect([2, 3], `lv${lv} seed${seed}`).toContain(g);
        givens[lv].push(p.puzzle.filter(Boolean).length);
      }
    const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    // открытых цифр: лёгкий > средний > сложный
    expect(avg(givens[1])).toBeGreaterThan(avg(givens[2]));
    expect(avg(givens[2])).toBeGreaterThan(avg(givens[3]));
  }, 60_000);
});
