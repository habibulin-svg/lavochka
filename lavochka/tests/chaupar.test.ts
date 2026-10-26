/* Чаупар и пачиси (пресеты шиш-беша): путь по кресту, замки, броски, пары. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { applyCMove, applyCRoll, cellOf, GOAL, isCastle, legalMoves, newCGame, RING, ringOf, throwDice, type CState } from '../src/games/chaupar/engine';

const game = (pieces: Record<number, number[]>, throws: 'pasa' | 'cowrie' = 'pasa', pairs = true): CState => {
  const s = newCGame(Object.keys(pieces).map(Number), new SeededRng(1), { throws, pairs });
  s.players.forEach((p) => (p.pieces = pieces[p.seat].slice()));
  s.cur = 0;
  return s;
};

describe('чаупар: поле', () => {
  it('12 замков: торцы средних столбцов и 4-я клетка от края внешних', () => {
    const castles = [...Array(RING).keys()].filter(isCastle);
    expect(castles).toHaveLength(12);
    for (const g of castles) {
      const [, col, row] = cellOf(0, g + 7)!;
      expect(col === 0 ? row === 7 : row === 4).toBe(true);
    }
  });

  it('путь: 84 шага, клетки круга разные, свой столбец — вниз и вверх', () => {
    const cells = new Set<string>();
    for (let p = 7; p <= 74; p++) cells.add(cellOf(0, p)!.join(','));
    expect(cells.size).toBe(68);
    expect(cellOf(0, 0)).toEqual([0, 0, 0]);
    expect(cellOf(0, 75)).toEqual(cellOf(0, 7));
    expect(cellOf(0, 82)).toEqual([0, 0, 0]);
    expect(cellOf(0, GOAL)).toBeNull();
    // рукав соседа по ходу начинается там, где кончается свой
    expect(ringOf(1, 7)).toBe(17);
  });
});

describe('чаупар: броски и ходы', () => {
  it('пасы — три кости с гранями 1, 2, 5, 6; каури: 0 → 25, 1 → 10', () => {
    const rng = new SeededRng(5);
    for (let i = 0; i < 50; i++) for (const d of throwDice({ throws: 'pasa', pairs: true }, rng).dice) expect([1, 2, 5, 6]).toContain(d);
    const one = { next: () => 0, int: () => 0, getState: () => 0 };
    expect(throwDice({ throws: 'cowrie', pairs: true }, one).dice).toEqual([25]);
  });

  it('вход только костью «6», каждая кость — отдельный ход', () => {
    const s = game({ 0: [-1, -1, -1, -1], 1: [-1, -1, -1, -1] });
    expect(legalMoves(applyCRoll(s, { dice: [5, 2, 1] })!.state)).toHaveLength(0);
    const t = applyCRoll(s, { dice: [6, 5, 2] })!.state;
    expect(legalMoves(t).map((m) => m.to)).toEqual([0]);
    const u = applyCMove(t, { piece: 0, die: 0, to: 0 })!.state;
    expect(legalMoves(u).map((m) => m.to).sort()).toEqual([2, 5]);
  });

  it('на замок с чужой фишкой не встать; в замке не рубят', () => {
    // зелёная (место 1) на клетке круга 13 — замок; красной до неё 5
    const s = applyCRoll(game({ 0: [15, -1, -1, -1], 1: [71, -1, -1, -1] }), { dice: [5, 5, 5] })!.state;
    expect(ringOf(1, 71)).toBe(13);
    expect(legalMoves(s)).toHaveLength(0);
  });

  it('рубка возвращает фишку и даёт ещё бросок', () => {
    const s = applyCRoll(game({ 0: [12, -1, -1, -1], 1: [65, -1, -1, -1] }), { dice: [2, 5, 1] })!.state;
    let r = applyCMove(s, { piece: 0, die: 0, to: 14 })!;
    expect(r.state.players[1].pieces[0]).toBe(-1);
    r = applyCMove(r.state, { piece: 0, die: 1, to: 19 })!;
    r = applyCMove(r.state, { piece: 0, die: 2, to: 20 })!;
    const ev = r.event as Extract<typeof r.event, { type: 'move' }>;
    expect(ev.turnEnd).toMatchObject({ again: true, reason: 'capture', next: 0 });
  });

  it('пары: союзника не рубят, побеждают вдвоём', () => {
    const s = applyCRoll(game({ 0: [12, -1, -1, -1], 1: [-1, -1, -1, -1], 2: [48, -1, -1, -1], 3: [-1, -1, -1, -1] }), { dice: [2, 1, 1] })!.state;
    const r = applyCMove(s, { piece: 0, die: 0, to: 14 })!;
    expect(r.state.players[2].pieces[0]).toBe(48);
    const w = applyCRoll(game({ 0: [GOAL, GOAL, GOAL, 81], 1: [-1, -1, -1, -1], 2: [GOAL, GOAL, GOAL, GOAL], 3: [-1, -1, -1, -1] }), { dice: [2, 1, 1] })!.state;
    const fin = applyCMove(w, { piece: 3, die: 0, to: GOAL })!.state;
    expect(fin.phase).toBe('over');
    expect(fin.winners).toEqual([0, 2]);
  });

  it('пачиси: милость вводит фишку и даёт ещё бросок', () => {
    const s = applyCRoll(game({ 0: [-1, -1, -1, -1], 1: [-1, -1, -1, -1] }, 'cowrie'), { dice: [10], shells: [true, false, false, false, false, false] })!.state;
    const r = applyCMove(s, { piece: 0, die: 0, to: 0 })!;
    const ev = r.event as Extract<typeof r.event, { type: 'move' }>;
    expect(ev.turnEnd).toMatchObject({ again: true, reason: 'grace' });
    expect(legalMoves(applyCRoll(game({ 0: [-1, -1, -1, -1], 1: [-1, -1, -1, -1] }, 'cowrie'), { dice: [3] })!.state)).toHaveLength(0);
  });
});

describe('пачиси: одна раковина', () => {
  it('10 можно сходить как 1 — фишке за шаг до центра есть ход', () => {
    const s = newCGame([0, 1], new SeededRng(1), { throws: 'cowrie', pairs: true });
    s.players[0].pieces = [GOAL - 1, GOAL, GOAL, GOAL];
    s.cur = 0;
    const t = applyCRoll(s, { dice: [10], shells: [true, false, false, false, false, false] })!.state;
    expect(legalMoves(t).map((m) => m.to)).toEqual([GOAL]);
  });
});
