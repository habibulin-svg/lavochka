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
