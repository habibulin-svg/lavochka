/* Балда: проверка хода, конец партии, боты находят слова. Словарь — настоящий, из public/dict. */
import { beforeAll, describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { allMoves, choose } from '../src/games/balda/ai';
import { apply, cfgFrom, check, newGame, openCells } from '../src/games/balda/engine';
import { dictSize, hasPrefix, hasWord, loadDict } from '../src/words/dict';

beforeAll(() => loadDict());

const game = (o = {}) => newGame([0, 1], cfgFrom(o), new SeededRng(1), 'балда');

describe('словарь', () => {
  it('загружен, слова и префиксы', () => {
    expect(dictSize()).toBeGreaterThan(40000);
    expect(hasWord('балда') && hasWord('кол') && !hasWord('колх')).toBe(true);
    expect(hasPrefix('бал') && !hasPrefix('ъъ')).toBe(true);
  });
});

describe('балда: ход', () => {
  it('слово в средней строке, открыты клетки над и под ним', () => {
    const s = game();
    expect(s.grid.slice(10, 15).join('')).toBe('балда');
    expect(openCells(s).sort((a, b) => a - b)).toEqual([5, 6, 7, 8, 9, 15, 16, 17, 18, 19]);
  });
  it('«бак» засчитан, повтор и чужие слова — нет', () => {
    const s = game();
    const r = apply(s, 0, { type: 'word', cell: 6, letter: 'к', path: [10, 11, 6] })!;
    expect(r.state.players[0].score).toBe(3);
    expect(r.state.cur).toBe(1);
    expect(check(r.state, { cell: 5, letter: 'к', path: [10, 11, 6] }).ok).toBe(false);
    expect(check(s, { cell: 6, letter: 'к', path: [11, 6] }).ok).toBe(false); // «ак» — не слово
    expect(check(s, { cell: 6, letter: 'к', path: [10, 11] }).ok).toBe(false); // новой буквы нет
    expect(check(s, { cell: 6, letter: 'к', path: [10, 6] }).ok).toBe(false); // не соседи
    expect(check(s, { cell: 6, letter: 'к', path: [10, 11, 6] }).ok).toBe(true);
    expect(check({ ...s, used: [...s.used, 'бак'] }, { cell: 6, letter: 'к', path: [10, 11, 6] }).ok).toBe(false);
    expect(apply(s, 1, { type: 'pass' })).toBeNull(); // не его ход
  });
  it('диагональ — только по настройке', () => {
    const s = game({ diag: true });
    expect(openCells(s)).toContain(5);
    expect(check(s, { cell: 5, letter: 'к', path: [10, 11, 5] }).ok).toBe(true); // А(11) и 5 — углом
    expect(check(game(), { cell: 5, letter: 'к', path: [10, 11, 5] }).ok).toBe(false);
  });
  it('все пропустили — конец; сдался — победа другому', () => {
    let s = game();
    s = apply(s, 0, { type: 'pass' })!.state;
    const r = apply(s, 1, { type: 'pass' })!;
    expect(r.state.over).toBe(true);
    const q = apply(game(), 0, { type: 'resign' })!;
    expect(q.state.over).toBe(true);
  });
});

describe('балда: боты', () => {
  it('находят ходы, и все они проходят проверку', () => {
    const s = game();
    const moves = allMoves(s);
    expect(moves.length).toBeGreaterThan(20);
    for (const m of moves.slice(0, 50)) expect(check(s, m).ok).toBe(true);
  });
  it('сложный ходит длиннее лёгкого', () => {
    const s = game();
    const rng = new SeededRng(3);
    const len = (lvl: number) => {
      const a = choose(s, 0, lvl, rng);
      return a.type === 'word' ? a.path.length : 0;
    };
    expect(len(2)).toBeGreaterThan(len(0));
  });
});
