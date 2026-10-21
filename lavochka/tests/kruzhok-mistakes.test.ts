/* Работа над ошибками в задачах кружка: ошибся — в очередь на повтор через 1, 3, 7 дней; три верных повтора — из очереди. */
import { describe, expect, it } from 'vitest';
import { dueMistakes, loadProgress, recordPuzzle, resetProgress } from '../src/games/kruzhok/progress';

const DAY = 86400_000;

describe('работа над ошибками', () => {
  it('ошибка — в очередь, верные повторы двигают срок, третий — убирает', () => {
    resetProgress();
    const t0 = 1_800_000_000_000;
    let p = recordPuzzle(loadProgress(), 'abc', 1300, false, t0).progress;
    expect(dueMistakes(p, t0 + DAY / 2)).toEqual([]);
    expect(dueMistakes(p, t0 + DAY)).toEqual(['abc']);
    // повтор верно: рейтинг не меняется (не первая попытка), срок — через 3 дня
    const r = p.rating.r;
    p = recordPuzzle(p, 'abc', 1300, true, t0 + DAY).progress;
    expect(p.rating.r).toBe(r);
    expect(dueMistakes(p, t0 + 3 * DAY)).toEqual([]);
    expect(dueMistakes(p, t0 + 4 * DAY)).toEqual(['abc']);
    p = recordPuzzle(p, 'abc', 1300, true, t0 + 4 * DAY).progress;
    p = recordPuzzle(p, 'abc', 1300, true, t0 + 11 * DAY).progress;
    expect(p.mistakes.abc).toBeUndefined();
    // снова ошибка — снова в очередь с начала
    p = recordPuzzle(p, 'abc', 1300, false, t0 + 12 * DAY).progress;
    expect(p.mistakes.abc).toEqual({ at: t0 + 12 * DAY, n: 0 });
  });
});
