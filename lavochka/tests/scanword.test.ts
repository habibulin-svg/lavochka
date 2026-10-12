import { beforeAll, describe, expect, it } from 'vitest';
import { loadClues } from '../src/words/clues';
import { newState, type WordData } from '../src/games/puzzles/engine';

/** Каждая голубая клетка сканворда (не картинка) несёт хотя бы один вопрос. */
function deadCells(seed: number, size: string, level: number): number {
  const s = newState('scanword', level, size, seed, [0]);
  const d = s.data as WordData & { pics?: { x: number; y: number; w: number; h: number }[] };
  const pic = new Set<number>();
  for (const p of d.pics ?? []) for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) pic.add(y * s.w + x);
  if (!d.pics) return -1; // разреженный запасной вариант
  const has = new Set(d.words.map((w) => w.at));
  let dead = 0;
  d.block.forEach((b, i) => b && !pic.has(i) && !has.has(i) && dead++);
  return dead;
}

describe('сканворд', () => {
  beforeAll(() => loadClues(), 60_000);
  it('нет голубых клеток без вопроса', () => {
    const n = Number(process.env.SCAN_SEEDS ?? 4);
    const bad: string[] = [];
    for (const size of ['small', 'medium', 'large'])
      for (let seed = 1; seed <= n; seed++) {
        const d = deadCells(seed * 7919, size, 1 + (seed % 3));
        if (d < 0) bad.push(`${size} №${seed * 7919}: разреженный`);
        else if (d) bad.push(`${size} №${seed * 7919}: ${d}`);
      }
    expect(bad).toEqual([]);
  }, 600_000);
});
