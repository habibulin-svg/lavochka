/* Таврели (пресет шахмат): башни и плен, отделение части башни и освобождение пленных, превращение ратника и обратное,
 * волхв всегда наверху, рокировка, взятие на проходе, мат; боты доигрывают партию. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { cfgFrom } from '../src/games/chess/engine';
import { chooseT } from '../src/games/chess/tavreli/ai';
import { applyT, fromList, legalMoves, newTGame, sq, sqName, top, type TState } from '../src/games/chess/tavreli/engine';

const cfg = () => cfgFrom({ variant: 'tavreli' });
const mv = (s: TState, from: string, to: string, n?: number) => {
  const r = applyT(s, s.turn, { type: 'move', from: sq(from), to: sq(to), n }, 0);
  expect(r, `${from}-${to}`).not.toBeNull();
  return r!.state;
};
const stack = (s: TState, at: string) => s.board[sq(at)].map((t) => (t.c ? t.k.toLowerCase() : t.k)).join('');
const targets = (s: TState, from: string) => [...new Set(legalMoves(s).filter((m) => m.from === sq(from)).map((m) => sqName(m.to)))].sort();

describe('таврели', () => {
  it('начальная расстановка: ратники со знаками своих фигур, перед волхвом — хелги', () => {
    const s = newTGame(cfg());
    expect(stack(s, 'e1')).toBe('V');
    expect(stack(s, 'd1')).toBe('K');
    expect(s.board[sq('e2')][0].s).toBe('H');
    expect(s.board[sq('a7')][0].s).toBe('R');
    // всадник может встать и на свою таврель — построить башню
    expect(targets(s, 'b1')).toEqual(['a3', 'c3', 'd2']);
    expect(targets(s, 'e1')).toEqual(['d1', 'd2', 'e2', 'f1', 'f2']);
  });

  it('плен: таврель встаёт сверху, ничего не снимается; башню отбивают целиком', () => {
    let s = fromList({ e1: 'V', f4: 'N', d1: 'K', e8: 'v', d5: 'p:K', c6: 'p:B' }, cfg());
    s = mv(s, 'f4', 'd5');
    expect(stack(s, 'd5')).toBe('pN');
    s = mv(s, 'c6', 'd5');
    expect(stack(s, 'd5')).toBe('pNp');
    s = mv(s, 'd1', 'd5');
    expect(stack(s, 'd5')).toBe('pNpK');
    expect(s.board.flat().length).toBe(6);
  });

  it('часть башни уходит — пленник наверху оставшейся свободен', () => {
    let s = fromList({ e1: 'V', d4: 'P:K b R', g8: 'v', a7: 'p:R' }, cfg());
    s = mv(s, 'd4', 'd7', 1);
    expect(stack(s, 'd4')).toBe('Pb');
    expect(top(s.board[sq('d4')])!.c).toBe(1);
    s = mv(s, 'd4', 'g7', 2);
    expect(stack(s, 'g7')).toBe('Pb');
    expect(stack(s, 'd4')).toBe('');
  });

  it('на волхва ставить нельзя, а сам он встаёт на башню и становится верхушкой', () => {
    const s = fromList({ e1: 'V', e2: 'P:H', f1: 'R', e8: 'v' }, cfg());
    expect(targets(s, 'f1')).not.toContain('e1');
    const t = mv(s, 'e1', 'e2');
    expect(stack(t, 'e2')).toBe('PV');
  });

  it('превращение ратника в свою фигуру и обратно, когда на него встают', () => {
    let s = fromList({ e1: 'V', c7: 'P:B', e7: 'P:H', h8: 'v', a7: 'p:R', b8: 'r' }, cfg());
    s = mv(s, 'c7', 'c8');
    expect(stack(s, 'c8')).toBe('B');
    expect(s.board[sq('c8')][0].pr).toBe(1);
    s = mv(s, 'b8', 'c8');
    expect(stack(s, 'c8')).toBe('Pr');
    s = mv(s, 'e7', 'e8');
    expect(stack(s, 'e8')).toBe('H');
  });

  it('ратник: вперёд на чужую нельзя, на свою можно; взятие на проходе берёт только ратника', () => {
    let s = fromList({ e1: 'V', e5: 'P:H', d4: 'N', d3: 'P:K', e8: 'v', d7: 'p:K', e6: 'p:H' }, cfg(), 1);
    expect(targets(s, 'e6')).toEqual([]);
    s = mv(s, 'd7', 'd5');
    expect(s.ep).toBe(sq('d6'));
    s = mv(s, 'e5', 'd6');
    expect(stack(s, 'd6')).toBe('pP');
    expect(stack(s, 'd5')).toBe('');
    s = mv(s, 'e8', 'f7');
    // свой ратник встаёт на своего всадника
    expect(targets(s, 'd3')).toEqual(['d4']);
  });

  it('рокировка и мат хелги', () => {
    let s = fromList({ a1: 'R', e1: 'V', h1: 'R', a8: 'r', e8: 'v', h8: 'r' }, cfg());
    s = mv(s, 'e1', 'g1');
    expect(stack(s, 'f1')).toBe('R');
    s = mv(s, 'e8', 'c8');
    expect(stack(s, 'd8')).toBe('r');
    let m = fromList({ e1: 'V', a2: 'P:R', d4: 'H', h8: 'v', h7: 'p:R', g7: 'p:N', a7: 'p:R' }, cfg());
    m = mv(m, 'd4', 'f5');
    m = mv(m, 'a7', 'a6');
    m = mv(m, 'f5', 'f8');
    expect(m.phase).toBe('over');
    expect(m.reason).toBe('mate');
    expect(m.winner).toBe(0);
  });

  it('боты всех уровней доигрывают партию', () => {
    for (const [a, b] of [[0, 2], [1, 0], [2, 1]]) {
      const rng = new SeededRng(7 + a);
      let s = newTGame(cfg());
      let guard = 0;
      while (s.phase === 'play' && guard++ < 600) {
        const lv = s.turn === 0 ? a : b;
        const act = chooseT(s, s.turn, lv, rng);
        expect(act).not.toBeNull();
        const r = applyT(s, s.turn, act!, 0);
        expect(r).not.toBeNull();
        s = r!.state;
      }
      expect(s.phase).toBe('over');
    }
  }, 120000);
});
