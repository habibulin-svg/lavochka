/* Шашки: генератор ходов (perft), бой назад, ветки, дамка посреди боя, правило большинства, турецкий удар, поддавки, фук, ничьи, боты. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { tuning } from '../src/games/checkers/ai';
import { def } from '../src/games/checkers/def';
import { apply, cfgFrom, fromList, legalMoves, newGame, play, sqOf, type Action, type State } from '../src/games/checkers/engine';
import { botSeats, simulate } from './harness';

function perft(s: State, d: number): number {
  const ms = legalMoves(s);
  if (d === 1) return ms.length;
  let n = 0;
  for (const m of ms) n += perft(play(s, m), d - 1);
  return n;
}

const RU = cfgFrom({});
const INT = cfgFrom({ variant: 'international' });
const BR = cfgFrom({ variant: 'brazil' });

/** Ход по полям: go(s, 'c3', 'e5', 'g7'). */
function go(s: State, ...sqs: string[]): State {
  const [from, ...path] = sqs.map((x) => sqOf(s.n, x));
  const r = apply(s, s.turn, { type: 'move', from, path });
  expect(r, sqs.join('-')).not.toBeNull();
  return r!.state;
}

const names = (s: State) => legalMoves(s).map((m) => [m.from, ...m.path].map((x) => 'abcdefghij'[x % s.n] + (Math.floor(x / s.n) + 1)).join(':'));

describe('генератор ходов', () => {
  it('начальная расстановка', () => {
    const r = newGame(RU);
    expect(r.board.filter((p) => p === 'w').length).toBe(12);
    expect(r.board.filter((p) => p === 'b').length).toBe(12);
    const i = newGame(INT);
    expect(i.board.filter((p) => p === 'w').length).toBe(20);
    expect(i.board[sqOf(10, 'a1')]).toBe('w');
  });
  it('perft из начальной позиции: русские', () => {
    expect([1, 2, 3, 4].map((d) => perft(newGame(RU), d))).toEqual([7, 49, 302, 1469]);
  });
  it('perft из начальной позиции: международные', () => {
    expect([1, 2, 3, 4].map((d) => perft(newGame(INT), d))).toEqual([9, 81, 658, 4265]);
  });
});

describe('правила', () => {
  it('бить обязательно, простая бьёт назад', () => {
    const s = fromList(RU, { w: ['e5', 'a1'], b: ['d4', 'h8'] });
    expect(names(s)).toEqual(['e5:c3']);
  });
  it('русские: любая ветка боя; международные и бразильские: больше всех', () => {
    const pos = { w: ['c3'], b: ['b4', 'd4', 'd6', 'h8'] };
    expect(names(fromList(RU, pos)).sort()).toEqual(['c3:a5', 'c3:e5:c7']);
    expect(names(fromList(BR, pos))).toEqual(['c3:e5:c7']);
  });
  it('русские: простая становится дамкой посреди боя и бьёт дальше', () => {
    const s = fromList(RU, { w: ['b6'], b: ['c7', 'f6', 'a1'] });
    expect(names(s).sort()).toEqual(['b6:d8:g5', 'b6:d8:h4']);
    const n = go(s, 'b6', 'd8', 'h4');
    expect(n.board[sqOf(8, 'h4')]).toBe('W');
    expect(n.board[sqOf(8, 'c7')]).toBe('');
    expect(n.board[sqOf(8, 'f6')]).toBe('');
  });
  it('бразильские: прошла последний ряд посреди боя — осталась простой', () => {
    // b6:d8, дальше простая бьёт e7 назад: d8:f6
    const s = fromList(BR, { w: ['b6'], b: ['c7', 'e7', 'a1'] });
    expect(names(s)).toEqual(['b6:d8:f6']);
    expect(go(s, 'b6', 'd8', 'f6').board[sqOf(8, 'f6')]).toBe('w');
  });
  it('дамка бьёт издалека и обязана встать туда, откуда бьёт дальше', () => {
    // a1 бьёт d4: можно встать на e5, f6, g7 — но бой дальше только с f6 (через e7 на d8)… и с e5 (через f4 на g3)
    const s = fromList(RU, { W: ['a1'], b: ['d4', 'e7', 'f4', 'h8'] });
    const ms = names(s);
    expect(ms.every((m) => m.split(':').length >= 3)).toBe(true);
    expect(ms).toContain('a1:f6:d8');
    expect(ms).not.toContain('a1:g7');
  });
  it('турецкий удар: через побитую шашку второй раз не прыгают, она мешает до конца хода', () => {
    // дамка c1 бьёт d2 (на e3), потом f4 (на g5), потом e7 (на d8 / c… ) — обратно через d2 нельзя
    const s = fromList(RU, { W: ['c1'], b: ['d2', 'f4', 'f6', 'h8'] });
    for (const m of legalMoves(s)) expect(new Set(m.caps).size).toBe(m.caps.length);
  });
  it('без ходов — проигрыш; в поддавках — победа', () => {
    let s = fromList(RU, { w: ['c3'], b: ['d4'] }, 0);
    s = go(s, 'c3', 'e5');
    expect([s.phase, s.winner, s.reason]).toEqual(['over', 0, 'nomoves']);
    let g = fromList(cfgFrom({ giveaway: true }), { w: ['c3'], b: ['d4'] }, 0);
    g = go(g, 'c3', 'e5');
    expect([g.phase, g.winner]).toEqual(['over', 1]);
    // запертая шашка: ходить нечем
    let z = fromList(RU, { w: ['a1'], b: ['b2', 'c3', 'h8'] }, 1);
    z = go(z, 'h8', 'g7');
    expect([z.phase, z.winner, z.reason]).toEqual(['over', 1, 'nomoves']);
  });
  it('фук: не побил — соперник снимает шашку и ходит', () => {
    let s = fromList(cfgFrom({ fuk: true }), { w: ['c3', 'g3', 'a1'], b: ['d4', 'h8'] });
    s = go(s, 'g3', 'h4');
    expect(s.fuk).toEqual([sqOf(8, 'c3')]);
    expect(apply(s, 1, { type: 'fuk', sq: sqOf(8, 'a1') })).toBeNull();
    const f = apply(s, 1, { type: 'fuk', sq: sqOf(8, 'c3') })!.state;
    expect(f.board[sqOf(8, 'c3')]).toBe('');
    expect(f.turn).toBe(1);
    // без фука пропустить взятие нельзя
    expect(apply(fromList(RU, { w: ['c3', 'g3'], b: ['d4', 'h8'] }), 0, { type: 'move', from: sqOf(8, 'g3'), path: [sqOf(8, 'h4')] })).toBeNull();
  });
  it('ничья: повторение и 15 ходов дамками', () => {
    let s = fromList(RU, { W: ['e1'], B: ['h8'] });
    for (let i = 0; i < 2 && s.phase === 'play'; i++) {
      s = go(s, 'e1', 'f2');
      s = go(s, 'h8', 'g7');
      s = go(s, 'f2', 'e1');
      if (s.phase === 'play') s = go(s, 'g7', 'h8');
    }
    expect(s.reason).toBe('repetition');
    // 15 ходов дамками без взятий: счётчик на 29 полуходах — ещё один ход, и ничья
    const k = go({ ...fromList(RU, { W: ['e1'], B: ['h8'] }), kq: 29 }, 'e1', 'f2');
    expect(k.reason).toBe('kings');
  });
  it('ничья по согласию и сдача', () => {
    let s = newGame(RU);
    s = go(s, 'c3', 'd4');
    s = go(s, 'f6', 'g5');
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
  it('берут больше, когда можно', async () => {
    tuning.fast = false;
    const s = fromList(RU, { w: ['c3', 'a1'], b: ['b4', 'd4', 'd6', 'h8'] });
    const a = (await def.bot.choose(s, 0, 2, new SeededRng(1))) as Action;
    expect(a).toMatchObject({ type: 'move', from: sqOf(8, 'c3'), path: [sqOf(8, 'e5'), sqOf(8, 'c7')] });
    tuning.fast = true;
  });
  it('сложный обыгрывает лёгкого', async () => {
    tuning.fast = false;
    let hard = 0;
    let easy = 0;
    for (let g = 0; g < 4; g++) {
      const seats = botSeats(def, 2).map((x, i) => ({ ...x, level: (g + i) % 2 ? 2 : 0 }));
      const r = await simulate(def, seats, { variant: 'russian', giveaway: false, fuk: false }, 70 + g, 400);
      if (!r.finished || r.winners.length !== 1) continue;
      for (const w of r.winners) seats[w].level === 2 ? hard++ : easy++;
    }
    tuning.fast = true;
    expect(hard).toBeGreaterThan(easy);
  }, 120_000);
});
