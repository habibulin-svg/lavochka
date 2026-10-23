/* Шатра: доска 62 поля и расстановка, ходы шатры по половинам, шашечное взятие и серии, обязательность, резерв, превращение, конец. */
import { describe, expect, it } from 'vitest';
import * as sh from '../src/games/shatra/engine';

const c = sh.cell;
function pos(cells: Record<number, string>, turn = 0, opts = {}) {
  const s = sh.newState(sh.cfgFrom(opts));
  s.board = new Array(sh.N).fill(null);
  s.reserve = [[], []];
  for (const [n, t] of Object.entries(cells)) s.board[c(Number(n))] = { o: t[0] === 'w' ? 0 : 1, k: t[1] as sh.Kind };
  s.turn = turn;
  s.ply = 10;
  return s;
}
const mv = (...nums: number[]): sh.Action => ({ type: 'move', path: nums.map(c) });
const targets = (s: sh.State, from: number) => sh.legal(s).filter((a) => a.type === 'move' && a.path[0] === c(from)).map((a) => (a.type === 'move' ? sh.num(a.path[a.path.length - 1]) : 0)).sort((a, b) => a - b);

describe('Шатра', () => {
  it('доска 62 поля, по 17 фигур, резерв — крепость и ворота', () => {
    expect(sh.N).toBe(62);
    const s = sh.setup({});
    expect(s.board.filter((p) => p?.o === 0).length).toBe(17);
    expect(s.board.filter((p) => p?.o === 1).length).toBe(17);
    expect(s.reserve[0].length).toBe(10);
    expect(s.board[c(53)]).toEqual({ o: 0, k: 'K' });
    expect(s.board[c(2)]).toEqual({ o: 1, k: 'Q' });
    // первый ход: 7 шатр (по 1 или 2 вперёд) и выставления
    const l = sh.legal(s);
    expect(l.filter((a) => a.type === 'move').length).toBe(14);
    expect(l.some((a) => a.type === 'drop')).toBe(true);
  });

  it('шатра: на своей половине — вперёд, у рва — и наискось, за рвом — во все стороны', () => {
    expect(targets(pos({ 42: 'wP' }), 42)).toEqual([35]);
    expect(targets(pos({ 35: 'wP' }), 35)).toEqual([27, 28, 29]);
    expect(targets(pos({ 21: 'wP' }), 21)).toEqual([13, 14, 15, 20, 22, 27, 28, 29]);
    expect(targets(pos({ 49: 'wP' }), 49)).toEqual([35, 42]);
  });

  it('взятие прыжком, серия до конца, бить обязательно', () => {
    const s = pos({ 29: 'wP', 22: 'bP', 14: 'bP', 53: 'wK', 3: 'bK', 47: 'wP' });
    const l = sh.legal(s);
    expect(l.every((a) => a.type === 'move' && a.path.length >= 3)).toBe(true);
    const r = sh.apply(s, mv(29, 15, 13))!;
    expect(r.state.board[c(22)]).toBeNull();
    expect(r.state.board[c(14)]).toBeNull();
    expect(r.state.lost[1]).toEqual(['P', 'P']);
    expect(sh.apply(s, mv(29, 15))).toBeNull(); // серию не бросают
  });

  it('дальнобойные бьют издалека и встают на любое свободное поле за фигурой', () => {
    const s = pos({ 46: 'wR', 18: 'bP', 53: 'wK', 3: 'bK' });
    const t = targets(s, 46);
    expect(t).toEqual([11]); // за шатрой на 18 — только 11, дальше край доски; бить обязательно — тихих ходов нет
    const q = pos({ 49: 'wQ', 35: 'bP', 53: 'wK', 3: 'bK' });
    expect(targets(q, 49)).toEqual([2, 5, 8, 10, 14, 21, 28]); // через ворота — в чужую крепость
  });

  it('бий может не бить', () => {
    const s = pos({ 28: 'wK', 21: 'bP', 3: 'bK' });
    const l = sh.legal(s);
    expect(l.some((a) => a.type === 'move' && a.path.length === 2 && sh.num(a.path[1]) === 29)).toBe(true);
    expect(l.some((a) => a.type === 'move' && sh.num(a.path[a.path.length - 1]) === 14)).toBe(true);
  });

  it('резерв: выставить на свою половину; в свою крепость не войти, пока резерв не пуст', () => {
    const s = sh.setup({});
    const r = sh.apply(s, { type: 'drop', from: c(61), to: c(42) })!;
    expect(r.state.reserve[0].includes(c(61))).toBe(false);
    expect(r.state.board[c(42)]?.k).toBe('Q');
    expect(sh.apply(s, { type: 'drop', from: c(61), to: c(25) })).toBeNull();
    // строгий порядок — первым 54
    const o = sh.setup({ order: true });
    expect(new Set(sh.legal(o).filter((a) => a.type === 'drop').map((a) => (a.type === 'drop' ? sh.num(a.from) : 0)))).toEqual(new Set([54]));
  });

  it('превращение: в срубленную фигуру по выбору; бий срублен — конец', () => {
    const s = pos({ 6: 'wP', 53: 'wK', 1: 'bK' });
    s.lost[0] = ['R', 'Q', 'P'];
    const r = sh.apply(s, mv(6, 3))!;
    expect(r.state.promote).toBe(c(3));
    expect(r.state.turn).toBe(0);
    expect(sh.legal(r.state).map((a) => (a.type === 'promote' ? a.kind : '')).sort()).toEqual(['Q', 'R']);
    const p = sh.apply(r.state, { type: 'promote', kind: 'R' })!;
    expect(p.state.board[c(3)]).toEqual({ o: 0, k: 'R' });
    expect(p.state.turn).toBe(1);
    const k = pos({ 28: 'wQ', 21: 'bK', 53: 'wK' });
    const e = sh.apply(k, mv(28, 14))!;
    expect(e.state.over).toBe(true);
    expect(e.state.winner).toBe(0);
  });
});
