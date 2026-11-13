import { describe, expect, it } from 'vitest';
import { checkMark, fromUci, position } from '../src/games/chess/notation';
import { dueMistakes, recordPuzzle, loadProgress, REPEAT_DAYS } from '../src/games/kruzhok/progress';
import { update, START } from '../src/games/kruzhok/rating';

describe('кружок: глубокое ревью', () => {
  it('мат любым ходом распознаётся (альтернативное решение задачи/этюда)', () => {
    // белые: Лa1 и Крc6/… — простейший мат ладьёй по последней горизонтали, у задачи «задуман» другой ход
    const s = position('6k1/5ppp/8/8/8/8/8/R3K3 w - - 0 1');
    const m = fromUci(s, 'a1a8')!;
    expect(checkMark(s, m)).toBe('#');
    const other = fromUci(s, 'a1a7')!;
    expect(checkMark(s, other)).not.toBe('#');
  });

  it('рейтинг меняется только за первую попытку, ошибка ставит задачу в очередь повтора', () => {
    const t0 = 1_700_000_000_000;
    let p = loadProgress();
    const r0 = p.rating.r;
    const a = recordPuzzle(p, 'zz1', 1200, false, t0);
    expect(a.first).toBe(true);
    expect(a.progress.rating.r).toBeLessThan(r0);
    p = a.progress;
    const b = recordPuzzle(p, 'zz1', 1200, true, t0 + 1000);
    expect(b.first).toBe(false);
    expect(b.progress.rating.r).toBe(p.rating.r);
    // верный повтор — срок через 3 дня, три повтора подряд — из очереди
    expect(dueMistakes(b.progress, t0 + 86400_000 * 0.5)).toEqual([]);
    expect(b.progress.mistakes.zz1.n).toBe(1);
    let q = b.progress;
    for (let i = 0; i < REPEAT_DAYS.length - 1; i++) q = recordPuzzle(q, 'zz1', 1200, true, t0 + 2000 + i).progress;
    expect(q.mistakes.zz1).toBeUndefined();
  });

  it('Глико: рейтинг конечен и в пределах при любых исходах', () => {
    let r = { ...START };
    for (let i = 0; i < 200; i++) r = update(r, 2800, false, i * 1000);
    expect(r.r).toBeGreaterThanOrEqual(400);
    for (let i = 0; i < 400; i++) r = update(r, 600, true, 1e9 + i * 1000);
    expect(r.r).toBeLessThanOrEqual(3000);
    expect(Number.isFinite(r.rd)).toBe(true);
  });
});
