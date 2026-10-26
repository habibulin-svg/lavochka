/* Сёги: ходы фигур, зона и обязательное превращение, сбросы (нифу, утифудзумэ, «мёртвые» поля), мат, животные сёги, боты. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/shogi/ai';
import { def, sq } from '../src/games/shogi/def';
import { apply, cfgFrom, legal, newState, type Mode, type State } from '../src/games/shogi/engine';

function pos(list: string, mode: Mode = 'shogi', hand0: Record<string, number> = {}, turn: 0 | 1 = 0): State {
  const s = newState(cfgFrom({ mode }));
  s.board.fill(null);
  for (const t of list.split(/\s+/).filter(Boolean)) {
    const pr = t[0] === '+';
    const c = pr ? t[1] : t[0];
    s.board[sq(mode, t.slice(pr ? 2 : 1))] = { o: c === c.toUpperCase() ? 0 : 1, k: c.toUpperCase(), pr };
  }
  Object.assign(s.hands[0], hand0);
  s.turn = turn;
  s.keys = [];
  return s;
}
const nm = (s: State, p: number) => 'abcdefghi'[p % (s.cfg.mode === 'shogi' ? 9 : s.cfg.mode === 'mini' ? 5 : 3)] + (Math.floor(p / (s.cfg.mode === 'shogi' ? 9 : s.cfg.mode === 'mini' ? 5 : 3)) + 1);
const from = (s: State, f: string) => [...new Set(legal(s).filter((m) => !m.drop && m.from === sq(s.cfg.mode, f)).map((m) => nm(s, m.to)))].sort();

describe('сёги', () => {
  it('начальная позиция: 30 ходов', () => {
    expect(legal(newState(cfgFrom({}))).length).toBe(30);
  });
  it('конь прыгает только вперёд, серебро — вперёд и по диагоналям', () => {
    expect(from(pos('Ke1 Nb1 ke9'), 'b1')).toEqual(['a3', 'c3']);
    expect(from(pos('Ke1 Se5 ke9'), 'e5')).toEqual(['d4', 'd6', 'e6', 'f4', 'f6']);
  });
  it('пешка на последней горизонтали превращается обязательно', () => {
    const ms = legal(pos('Ke1 Pc8 ke9 ')).filter((m) => m.from === sq('shogi', 'c8'));
    expect(ms.length).toBe(1);
    expect(ms[0].promo).toBe(true);
    const opt = legal(pos('Ke1 Pc6 ke9')).filter((m) => m.from === sq('shogi', 'c6'));
    expect(opt.length).toBe(2);
  });
  it('сброс: нифу и мёртвые поля', () => {
    const s = pos('Ke1 Pc3 ke9', 'shogi', { P: 1, N: 1 });
    const drops = legal(s).filter((m) => m.drop === 'P').map((m) => nm(s, m.to));
    expect(drops.some((x) => x[0] === 'c')).toBe(false);
    expect(drops.some((x) => x.endsWith('9'))).toBe(false);
    const kn = legal(s).filter((m) => m.drop === 'N').map((m) => nm(s, m.to));
    expect(kn.some((x) => x.endsWith('8') || x.endsWith('9'))).toBe(false);
  });
  it('утифудзумэ: мат сбросом пешки запрещён', () => {
    // белый король a9 зажат: b9 и a8… сброс пешки на a8 был бы матом
    const s = pos('Ke1 Gb7 La7 ka9 lb9', 'shogi', { P: 1 });
    expect(legal(s).some((m) => m.drop === 'P' && m.to === sq('shogi', 'a8'))).toBe(false);
  });
  it('мат — победа', () => {
    const s = pos('Ke1 Gd7 ke9', 'shogi', { G: 1 });
    const r = apply(s, 0, { type: 'drop', kind: 'G', to: sq('shogi', 'e8') })!;
    expect(r.state.reason).toBe('mate');
  });
  it('животные сёги: цыплёнок становится курицей, лев в последнем ряду побеждает', () => {
    let s = newState(cfgFrom({ mode: 'dobutsu' }));
    expect(legal(s).length).toBeGreaterThan(0);
    const t = pos('Kb2 kc4', 'dobutsu');
    const r = apply(t, 0, { type: 'move', from: sq('dobutsu', 'b2'), to: sq('dobutsu', 'a2') })!;
    expect(r.state.over).toBe(false);
    const u = pos('Ka3 kc1', 'dobutsu');
    const w = apply(u, 0, { type: 'move', from: sq('dobutsu', 'a3'), to: sq('dobutsu', 'a4') })!;
    expect(w.state.reason).toBe('try');
    s = pos('Kb1 Pb3 ka4', 'dobutsu');
    const c = apply(s, 0, { type: 'move', from: sq('dobutsu', 'b3'), to: sq('dobutsu', 'b4') })!;
    expect(c.state.board[sq('dobutsu', 'b4')]!.pr).toBe(true);
  });
  it('боты доигрывают все пресеты', () => {
    for (const p of def.presets!) {
      const rng = new SeededRng(4);
      let s = newState(cfgFrom(p.options!));
      let i = 0;
      const t0 = Date.now();
      for (; i < 400 && !s.over; i++) {
        const a = choose(def.view(s, [s.turn]), s.turn, i % 3, rng);
        expect(a, `${p.id}: ${i}`).not.toBeNull();
        const r = apply(s, s.turn, a!);
        expect(r, `${p.id}: ${JSON.stringify(a)}`).not.toBeNull();
        s = r!.state;
      }
      console.log(p.id, i, 'ходов', Date.now() - t0, 'мс', s.reason);
      expect(s.over, p.id).toBe(true);
    }
  }, 600000);
});

describe('сёги: импас', () => {
  it('очки за фигуры: ладья и слон по 5, остальные по 1 (и в руке тоже)', async () => {
    const sh = await import('../src/games/shogi/engine');
    const pos = { board: Array(81).fill(null), hands: [{ R: 1, P: 3 }, {}] as [Record<string, number>, Record<string, number>], turn: 0 as const, mode: 'shogi' as const };
    pos.board[0] = { o: 0, k: 'B', pr: false };
    pos.board[1] = { o: 0, k: 'G', pr: false };
    pos.board[2] = { o: 0, k: 'K', pr: false };
    expect(sh.impassePoints(pos, 0)).toBe(5 + 1 + 5 + 3);
    expect(sh.IMPASSE_NEED).toBe(24);
  });
});
