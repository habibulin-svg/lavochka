/* «Полководец»: местность, ходы и поражение по таблице, приказы генералов, артиллерия, маршал и капитуляция, партии ботов. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/polkovodec/ai';
import { apply, at, cfgFrom, commanderFor, hits, moves, newState, setup, toAct, type Kind, type State } from '../src/games/polkovodec/engine';
import { COLS, FORTS, ROWS, TERRAIN } from '../src/games/polkovodec/terrain';

const rng = new SeededRng(1);
function pos(list: [number, Kind, number, number][]): State {
  const s = newState(cfgFrom({}), 2);
  s.pieces = list.map(([side, kind, c, r], i) => ({ id: i + 1, side, army: side, kind, p: at(c, r), wet: 0 }));
  s.nextId = 100;
  return s;
}

describe('Полководец', () => {
  it('поле 36×27, шесть крепостей, армии расставлены', () => {
    expect(TERRAIN.length).toBe(ROWS);
    expect(TERRAIN.every((r) => r.length === COLS)).toBe(true);
    expect(FORTS.length).toBe(6);
    const s = setup({}, 2);
    expect(s.pieces.filter((p) => p.side === 0).length).toBe(s.pieces.filter((p) => p.side === 1).length);
    expect(s.forts.filter((f) => f.owner === 0).length + s.forts.filter((f) => f.owner === 1).length).toBeGreaterThanOrEqual(4);
  });

  it('схема 2 брошюры: гусар бьёт улана по диагонали на 3 и встаёт на его место', () => {
    const s = pos([[0, 'marshal', 10, 13], [0, 'hussar', 12, 14], [1, 'ulan', 15, 11], [1, 'marshal', 33, 13]]);
    expect(hits(s, s.pieces[1])).toContain(at(15, 11));
    const r = apply(s, 0, { type: 'hit', id: 2, to: at(15, 11) }, rng)!.state;
    expect(r.pieces.find((p) => p.id === 2)!.p).toBe(at(15, 11));
    expect(r.pieces.some((p) => p.id === 3)).toBe(false);
  });

  it('мушкетёр бьёт только по диагонали; пушка — на 5 и остаётся', () => {
    const s = pos([[0, 'marshal', 10, 13], [0, 'musk', 12, 13], [1, 'musk', 13, 13], [1, 'gren', 13, 14], [0, 'gun', 10, 16], [1, 'cuir', 14, 16], [1, 'marshal', 33, 13]]);
    expect(hits(s, s.pieces[1])).toEqual([at(13, 14)]);
    const r = apply(s, 0, { type: 'hit', id: 5, to: at(14, 16) }, rng)!.state;
    expect(r.pieces.find((p) => p.id === 5)!.p).toBe(at(10, 16));
  });

  it('приказ — только в зоне командира, один на командира', () => {
    const s = pos([[0, 'marshal', 2, 13], [0, 'musk', 12, 13], [1, 'marshal', 33, 13]]);
    expect(commanderFor(s, s.pieces[1])).toBeNull();
    const t = pos([[0, 'marshal', 8, 13], [0, 'musk', 12, 13], [0, 'musk', 12, 14], [1, 'marshal', 33, 13]]);
    const r = apply(t, 0, { type: 'move', id: 2, to: at(13, 13) }, rng)!.state;
    expect(r.turn).toBe(1); // приказ маршала истрачен — ход перешёл
  });

  it('кавалерия не входит в горы, по дороге — вдвое дальше', () => {
    const s = pos([[0, 'marshal', 4, 9], [0, 'dragoon', 4, 8], [1, 'marshal', 33, 13]]);
    expect([...moves(s, s.pieces[1]).keys()]).not.toContain(at(2, 6));
    const road = pos([[0, 'marshal', 18, 14], [0, 'cuir', 20, 15], [1, 'marshal', 33, 13]]);
    expect(moves(road, road.pieces[1]).has(at(20, 11))).toBe(true); // 4 по дороге вверх (20,14..11)
  });

  it('маршал убит без складов — капитуляция и победа', () => {
    const s = pos([[0, 'marshal', 10, 13], [0, 'hussar', 12, 14], [1, 'marshal', 15, 11]]);
    s.stock[1] = 0;
    const r = apply(s, 0, { type: 'hit', id: 2, to: at(15, 11) }, rng)!.state;
    expect(r.over).toBe(true);
    expect(r.winner).toBe(0);
  });

  it('партии ботов доходят до конца', () => {
    for (const n of [2, 3]) {
      const g = new SeededRng(n);
      let s = setup({ size: 'small' }, n);
      for (let i = 0; i < 20000 && !s.over; i++) {
        const seat = toAct(s)[0];
        s = apply(s, seat, choose(s, seat, i % 3, g)!, g)!.state;
      }
      expect(s.over).toBe(true);
    }
  }, 120000);
});
