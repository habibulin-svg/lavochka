/* Шахматы: генератор ходов (perft), рокировки в т.ч. Фишера 960, взятие на проходе, превращение, итоги, часы, боты. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { def } from '../src/games/chess/def';
import { tuning } from '../src/games/chess/ai';
import { apply, backRank, cfgFrom, fromFen, legalMoves, newGame, play, sq, DEFAULT_CFG, type Action, type State } from '../src/games/chess/engine';
import { botSeats, simulate } from './harness';

function perft(s: State, d: number): number {
  if (d === 0) return 1;
  const ms = legalMoves(s);
  if (d === 1) return ms.length;
  let n = 0;
  for (const m of ms) n += perft(play(s, m), d - 1);
  return n;
}

describe('генератор ходов', () => {
  it('perft из начальной позиции', () => {
    const s = newGame(DEFAULT_CFG);
    expect([1, 2, 3].map((d) => perft(s, d))).toEqual([20, 400, 8902]);
  });
  it('perft «Kiwipete»: рокировки, на проходе, превращения', () => {
    const s = fromFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
    expect([1, 2, 3].map((d) => perft(s, d))).toEqual([48, 2039, 97862]);
  });
  it('perft позиции 3 (эндшпиль, на проходе с шахом)', () => {
    const s = fromFen('8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1');
    expect([1, 2, 3, 4].map((d) => perft(s, d))).toEqual([14, 191, 2812, 43238]);
  });
  it('perft позиции 4 (превращения, рокировки под боем)', () => {
    const s = fromFen('r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1');
    expect([1, 2, 3].map((d) => perft(s, d))).toEqual([6, 264, 9467]);
  });
});

const mv = (s: State, from: string, to: string, promo?: 'Q' | 'R' | 'B' | 'N', now = 0) => {
  const r = apply(s, s.turn, { type: 'move', from: sq(from), to: sq(to), promo } as Action, now);
  expect(r, `${from}-${to}`).not.toBeNull();
  return r!.state;
};

describe('правила', () => {
  it('рокировка: обе стороны, нельзя через битое поле', () => {
    let s = fromFen('r3k2r/pppq1ppp/2npbn2/2b1p3/2B1P3/2NPBN2/PPPQ1PPP/R3K2R w KQkq - 0 1');
    s = mv(s, 'e1', 'g1');
    expect(s.board[sq('g1')]).toBe('K');
    expect(s.board[sq('f1')]).toBe('R');
    s = mv(s, 'e8', 'c8');
    expect(s.board[sq('c8')]).toBe('k');
    expect(s.board[sq('d8')]).toBe('r');
    const t = fromFen('4k3/8/8/8/8/8/5r2/R3K2R w KQ - 0 1');
    // поле f1 бьёт ладья f2 — короткая рокировка запрещена, длинная можно
    expect(legalMoves(t).some((m) => m.castle === 'K')).toBe(false);
    expect(legalMoves(t).some((m) => m.castle === 'Q')).toBe(true);
  });
  it('Фишер 960: 960 разных позиций, слоны на разных цветах, король между ладьями', () => {
    const seen = new Set<string>();
    for (let n = 0; n < 960; n++) {
      const r = backRank(n);
      seen.add(r.join(''));
      const b = r.flatMap((p, i) => (p === 'B' ? [i % 2] : []));
      expect(new Set(b).size).toBe(2);
      const k = r.indexOf('K');
      expect(r.indexOf('R')).toBeLessThan(k);
      expect(r.lastIndexOf('R')).toBeGreaterThan(k);
    }
    expect(seen.size).toBe(960);
    expect(backRank(518).join('')).toBe('RNBQKBNR');
  });
  it('Фишер 960: рокировка нажатием на свою ладью', () => {
    // позиция № 0: B B Q N N R K R — король g1, ладья h1: после 0-0 король g1, ладья f1
    let s = newGame(cfgFrom({ variant: '960' }), 0);
    s = { ...s, board: s.board.map((p, i) => (i === sq('f1') || i === sq('d1') || i === sq('e1') ? '' : p)) };
    const m = legalMoves(s).find((x) => x.castle === 'K');
    expect(m).toBeTruthy();
    const r = apply(s, 0, { type: 'move', from: sq('g1'), to: sq('h1') }, 0)!;
    expect(r).not.toBeNull();
    expect(r.state.board[sq('g1')]).toBe('K');
    expect(r.state.board[sq('f1')]).toBe('R');
    expect(r.state.board[sq('h1')]).toBe('');
  });
  it('взятие на проходе и превращение', () => {
    let s = fromFen('4k3/3p4/8/4P3/8/8/1p6/4K3 b - - 0 1');
    s = mv(s, 'd7', 'd5');
    s = mv(s, 'e5', 'd6');
    expect(s.board[sq('d5')]).toBe('');
    expect(s.moves[s.moves.length - 1].san).toContain('e:d6');
    s = mv(s, 'b2', 'b1', 'N');
    expect(s.board[sq('b1')]).toBe('n');
  });
  it('мат, пат, повторение, 50 ходов, недостаток материала', () => {
    let s = newGame(DEFAULT_CFG);
    for (const [a, b] of [['e2', 'e4'], ['e7', 'e5'], ['f1', 'c4'], ['b8', 'c6'], ['d1', 'h5'], ['g8', 'f6'], ['h5', 'f7']]) s = mv(s, a, b);
    expect([s.phase, s.winner, s.reason]).toEqual(['over', 0, 'mate']);
    s = mv(fromFen('k7/8/1Q6/8/8/8/8/7K w - - 0 1'), 'b6', 'c7');
    expect([s.phase, s.winner, s.reason]).toEqual(['over', null, 'stalemate']);
    s = newGame(DEFAULT_CFG);
    for (let i = 0; i < 2; i++) for (const [a, b] of [['g1', 'f3'], ['g8', 'f6'], ['f3', 'g1'], ['f6', 'g8']]) if (s.phase === 'play') s = mv(s, a, b);
    expect(s.reason).toBe('repetition');
    s = mv(fromFen('4k3/8/8/8/8/8/8/R3K3 w - - 99 80'), 'a1', 'a2');
    expect(s.reason).toBe('fifty');
    s = mv(fromFen('4k3/8/8/8/8/8/3n4/4K3 w - - 0 1'), 'e1', 'd2');
    expect(s.reason).toBe('material');
  });
  it('часы: время тратится, добавка прибавляется, флажок — проигрыш', () => {
    let s = newGame(cfgFrom({ clock: 1, inc: 2 }), 518, 1000);
    s = mv(s, 'e2', 'e4', undefined, 1000 + 10_000);
    expect(s.clock[0]).toBe(60_000 - 10_000 + 2000);
    expect(apply(s, 1, { type: 'flag' }, 1000 + 20_000)).toBeNull();
    const r = apply(s, 1, { type: 'flag' }, 11_000 + 61_000)!;
    expect([r.state.winner, r.state.reason]).toEqual([0, 'time']);
  });
  it('ничья по согласию и сдача', () => {
    let s = newGame(DEFAULT_CFG);
    s = mv(s, 'e2', 'e4');
    s = mv(s, 'e7', 'e5');
    s = apply(s, 0, { type: 'offer' })!.state;
    expect(def.toAct(s)).toEqual([1]);
    const d = apply(s, 1, { type: 'decline' })!.state;
    expect(d.phase).toBe('play');
    expect(apply(s, 1, { type: 'accept' })!.state.reason).toBe('agreed');
    const g = apply(d, 0, { type: 'resign' })!.state;
    expect([g.winner, g.reason]).toEqual([1, 'resign']);
  });
});

describe('боты', () => {
  it('ставят мат в один ход', async () => {
    tuning.fast = false;
    const s = fromFen('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1');
    for (const lv of [1, 2]) {
      const a = (await def.bot.choose(s, 0, lv, new SeededRng(1))) as Action;
      expect(a).toMatchObject({ type: 'move', from: sq('d1'), to: sq('d8') });
    }
    tuning.fast = true;
  });
  it('сложный обыгрывает лёгкого', async () => {
    tuning.fast = false;
    let hard = 0;
    let easy = 0;
    for (let g = 0; g < 4; g++) {
      const seats = botSeats(def, 2).map((x, i) => ({ ...x, level: (g + i) % 2 ? 2 : 0 }));
      const r = await simulate(def, seats, { variant: 'classic', clock: 0, inc: 0 }, 50 + g, 400);
      if (!r.finished) continue;
      for (const w of r.winners) if (r.winners.length === 1) (seats[w].level === 2 ? hard++ : easy++);
    }
    tuning.fast = true;
    expect(hard).toBeGreaterThan(easy);
  }, 120_000);
});
