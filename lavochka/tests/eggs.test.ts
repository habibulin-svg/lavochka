/* «Яйца динозавров»: уровни 1–100 строятся, яйцо прилипает к сетке, тройка лопается, оторвавшиеся падают, прицельная стрельба проходит лёгкий уровень. */
import { describe, expect, it } from 'vitest';
import { Bubbles, COLS } from '../src/games/eggs/logic';

describe('Яйца динозавров', () => {
  it('уровни строятся, заряды — из цветов на поле', () => {
    for (let n = 1; n <= 100; n++) {
      const b = new Bubbles(n);
      const have = new Set(b.grid.flat().filter((v) => v != null));
      expect(have.size, `уровень ${n}`).toBeGreaterThan(0);
      expect(have.has(b.cur)).toBe(true);
    }
  });
  it('выстрел вверх прилипает к сетке', () => {
    const b = new Bubbles(1);
    const before = b.grid.flat().filter((v) => v != null).length;
    const r = b.shoot(-Math.PI / 2)!;
    expect(r.cell).not.toBeNull();
    const after = b.grid.flat().filter((v) => v != null).length;
    expect(after === before + 1 || r.popped.length > 0).toBe(true);
  });
  it('тройка лопается, висящие падают', () => {
    const b = new Bubbles(1);
    for (const row of b.grid) row.fill(null);
    // потолок: 0,0 цвета 1; под ним держится 1,0 (цвет 2) за счёт 0,0 и 0,1 цвета 0
    b.grid[0][3] = 0;
    b.grid[0][4] = 0;
    b.grid[1][3] = 2;
    b.cur = 0;
    // целимся в правый край ряда 0 — должно прилипнуть рядом и лопнуть три нуля
    let best = 0;
    for (let i = 0; i <= 200; i++) {
      const a = -Math.PI + 0.12 + (i / 200) * (Math.PI - 0.24);
      const t = b.trace(a);
      if (t.cell && t.cell[0] === 0 && (t.cell[1] === 5 || t.cell[1] === 2)) {
        best = a;
        break;
      }
    }
    expect(best).not.toBe(0);
    const r = b.shoot(best)!;
    expect(r.popped.length).toBe(3);
    expect(r.fell.length).toBe(1);
  });
  it('прицельная стрельба проходит лёгкие уровни', () => {
    let wins = 0;
    for (const n of [1, 2, 3, 4]) {
      const b = new Bubbles(n);
      for (let i = 0; i < 200 && !b.won && !b.lost; i++) b.shoot(b.bestAngle());
      if (b.won) wins++;
      expect(b.score).toBeGreaterThan(0);
    }
    expect(wins).toBeGreaterThan(0);
    expect(COLS).toBe(8);
  });
});
