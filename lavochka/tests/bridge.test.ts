/* Бридж: гонор в роббере. */
import { describe, expect, it } from 'vitest';


describe('бридж: гонор в роббере', () => {
  it('4 из 5 старших козырей — 100, все 5 — 150, четыре туза в бескозырке — 150', async () => {
    const { honours } = await import('../src/games/bridge/engine');
    const C = (s: string, r: number) => ({ s, r }) as import('../src/cards/deck').Card;
    const deal = [[C('S', 14), C('S', 13), C('S', 12), C('S', 11)], [C('H', 14), C('D', 14), C('C', 14), C('S', 14)], [], []];
    expect(honours(deal, 'S')).toEqual([0, 100]);
    expect(honours([[...deal[0], C('S', 10)], [], [], []], 'S')).toEqual([0, 150]);
    expect(honours([[], deal[1], [], []], 'N')).toEqual([1, 150]);
    expect(honours(deal, 'H')).toBeNull();
  });
});

describe('бридж: скрытые данные', () => {
  it('очки силы чужих рук не уходят в вид (кроме мини-бриджа, где они открыты)', async () => {
    const { def } = await import('../src/games/bridge/def');
    const { SeededRng } = await import('../src/core/rng');
    const seats = [0, 1, 2, 3].map((seat) => ({ seat, kind: 'bot' as const, name: 'x', level: 1 }));
    const s = def.setup(seats, { format: 'rubber' }, new SeededRng(3));
    const v = def.view(s, [0]);
    expect(v.hcp[0]).toBe(s.hcp[0]);
    expect(v.hcp[1] + v.hcp[2] + v.hcp[3]).toBe(0);
    expect(v.deal.flat()).toHaveLength(0);
    const m = def.setup(seats, { format: 'mini' }, new SeededRng(3));
    expect(def.view(m, [0]).hcp).toEqual(m.hcp);
  });
});
