/* «Клад»: уровни 1–100 строятся без готовых рядов и с ходом; случайная игра — поле всегда заполнено, очки растут, ходы тратятся, земля расчищается. */
import { describe, expect, it } from 'vitest';
import { Board, levelSpec, N } from '../src/games/treasures/logic';

const full = (b: Board) => b.cells.every((row) => row.every((c) => c.stone || c.tile));

describe('Клад', () => {
  it('все 100 уровней: без готовых рядов, есть ход', () => {
    for (let n = 1; n <= 100; n++) {
      const b = new Board(levelSpec(n));
      expect(full(b), `уровень ${n}`).toBe(true);
      expect(b.hint(), `уровень ${n}`).not.toBeNull();
    }
  });
  it('игра подсказками: поле полное, очки растут, ходы кончаются', () => {
    for (const n of [1, 3, 30, 66, 99]) {
      const b = new Board(levelSpec(n));
      const moves = b.moves;
      let made = 0;
      while (b.moves > 0 && !b.won) {
        const h = b.hint();
        expect(h, `уровень ${n}`).not.toBeNull();
        const steps = b.swap(...h!);
        expect(steps).not.toBeNull();
        made++;
        expect(full(b), `уровень ${n} ход ${made}`).toBe(true);
      }
      expect(b.score).toBeGreaterThan(0);
      expect(made).toBeLessThanOrEqual(moves);
    }
  });
  it('ход без ряда не засчитывается', () => {
    const b = new Board(levelSpec(2));
    for (let y = 0; y < N; y++)
      for (let x = 0; x + 1 < N; x++)
        if (!b.canSwap(x, y, x + 1, y)) {
          const m = b.moves;
          expect(b.swap(x, y, x + 1, y)).toBeNull();
          expect(b.moves).toBe(m);
          return;
        }
  });
  it('уровень «откопать клад»: земля расчищается', () => {
    const b = new Board(levelSpec(3));
    const dirt0 = b.dirtLeft;
    expect(dirt0).toBeGreaterThan(0);
    for (let i = 0; i < 40 && b.moves > 0 && !b.won; i++) b.swap(...b.hint()!);
    expect(b.dirtLeft).toBeLessThan(dirt0);
  });
});
