/* Пасьянс маджонг: раскладки без наложений, решаемая раздача действительно сходится, соединялка ищет путь. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { canPair, geoOf, left, linkPath, pairsOf, reshuffle, solvableDeal, tileSet } from '../src/games/mahjong/engine';
import { LAYOUTS } from '../src/games/mahjong/layouts';

describe('маджонг-пасьянс', () => {
  it.each(LAYOUTS.map((l) => [l.id, l] as const))('раскладка %s: чётная, ≤144, без наложений', (_id, l) => {
    expect(l.pos.length % 2).toBe(0);
    expect(l.pos.length).toBeLessThanOrEqual(144);
    for (let i = 0; i < l.pos.length; i++)
      for (let j = i + 1; j < l.pos.length; j++) {
        const a = l.pos[i];
        const b = l.pos[j];
        const overlap = a.z === b.z && Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2;
        expect(overlap, `${l.id}: ${i} и ${j}`).toBe(false);
      }
    // всё, что выше нулевого этажа, на чём-то лежит
    for (const p of l.pos) if (p.z > 0) expect(l.pos.some((q) => q.z === p.z - 1 && Math.abs(q.x - p.x) < 2 && Math.abs(q.y - p.y) < 2)).toBe(true);
  });

  it.each(LAYOUTS.map((l) => [l.id, l] as const))('раздача %s сходится по порядку построения', (_id, l) => {
    const g = geoOf(l);
    for (let seed = 1; seed <= 3; seed++) {
      const rng = new SeededRng(seed);
      const ids = tileSet(l.pos.length, rng);
      let t = solvableDeal(
        g,
        l.pos.map((_, i) => i),
        ids,
        rng
      );
      expect(t.filter((x) => x >= 0).length).toBe(l.pos.length);
      // жадно не обязательно сойдётся, а вот перемешивание всегда даёт ходы
      let guard = 0;
      while (left(t) > 0 && guard++ < 200) {
        const ps = pairsOf(g, t);
        if (!ps.length) {
          t = reshuffle(g, t, rng);
          continue;
        }
        const [a, b] = ps[0];
        expect(canPair(g, t, a, b)).toBe(true);
        t = t.slice();
        t[a] = -1;
        t[b] = -1;
      }
      expect(left(t), `${l.id}, сид ${seed}`).toBe(0);
    }
  });

  it('соединялка: путь с двумя поворотами через край', () => {
    const l = LAYOUTS.find((x) => x.id === 'connect')!;
    const g = geoOf(l);
    const t = l.pos.map((_, i) => i);
    // два угловых в верхнем ряду соединяются поверху, за краем поля
    expect(linkPath(g, t, 0, 17)).not.toBeNull();
    // соседние — напрямую
    expect(linkPath(g, t, 20, 21)?.length).toBe(2);
    // середина заперта со всех сторон
    expect(linkPath(g, t, 20, 40)).toBeNull();
  });
});
