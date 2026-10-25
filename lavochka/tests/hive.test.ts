/* Улей: постановка, один улей, ворота, ходы насекомых, мокрица, окружение пчелы, боты. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/hive/ai';
import * as hv from '../src/games/hive/engine';

/** Позиция: «q,r» → стопка снизу вверх, буква — насекомое (заглавная — белые, строчная — чёрные). */
function pos(cells: Record<string, string>, turn = 0, opts = {}) {
  const s = hv.setup(opts);
  for (const [k, st] of Object.entries(cells)) {
    s.cells[k] = st.split('').map((ch) => ({ o: ch === ch.toUpperCase() ? 0 : 1, b: ch.toUpperCase() as hv.Bug }));
    for (const p of s.cells[k]) s.hand[p.o][p.b]--, s.placed[p.o]++;
  }
  s.turn = turn;
  s.ply = 10;
  return s;
}
const dests = (s: hv.State, from: string) =>
  hv
    .legal(s)
    .filter((m): m is Extract<hv.Action, { type: 'move' }> => m.type === 'move' && m.from === from)
    .map((m) => m.to)
    .sort();

describe('Улей', () => {
  it('начало: первая фишка в центр, вторая рядом, дальше — только у своих', () => {
    let s = hv.setup({});
    expect(new Set(hv.legal(s).map((m) => (m as { at: string }).at))).toEqual(new Set(['0,0']));
    s = hv.step(s, { type: 'place', bug: 'G', at: '0,0' })!.state;
    expect(hv.placeCells(s).length).toBe(6);
    s = hv.step(s, { type: 'place', bug: 'G', at: '1,0' })!.state;
    // белым — только клетки, не касающиеся чёрного кузнечика
    for (const k of hv.placeCells(s)) expect(hv.around(k).includes('1,0')).toBe(false);
  });

  it('пчела — не позже четвёртого хода; турнирное правило — не первым', () => {
    const s = pos({ '0,0': 'G', '1,0': 'g', '-1,0': 'A', '2,0': 'a', '-2,0': 'S', '3,0': 's' });
    expect(hv.placeBugs(s)).toEqual(['Q']);
    expect(hv.placeBugs(hv.setup({ tourney: true }))).not.toContain('Q');
  });

  it('пока пчела в запасе — ходить нельзя', () => {
    const s = pos({ '0,0': 'A', '1,0': 'q' });
    expect(hv.legal(s).every((m) => m.type === 'place')).toBe(true);
  });

  it('один улей: фишку-перемычку не двигают', () => {
    const s = pos({ '0,0': 'Q', '1,0': 'A', '2,0': 'q' });
    expect(dests(s, '1,0')).toEqual([]);
  });

  it('пчела — на клетку, ворота не пускают', () => {
    // пчела в «кармане» между двумя соседями: в щель не протиснуться
    const s = pos({ '0,0': 'Q', '1,-1': 'A', '-1,0': 'G', '0,1': 'q', '1,1': 'a' });
    expect(dests(s, '0,0')).toEqual([]);
    const free = pos({ '0,0': 'Q', '1,0': 'q' });
    expect(dests(free, '0,0')).toEqual(['0,1', '1,-1'].sort());
  });

  it('кузнечик прыгает по прямой через ряд', () => {
    const s = pos({ '0,0': 'G', '1,0': 'Q', '2,0': 'q', '3,0': 'a' });
    expect(dests(s, '0,0')).toEqual(['4,0']);
  });

  it('паук — ровно на три клетки', () => {
    const s = pos({ '0,0': 'S', '1,0': 'Q', '2,0': 'q' });
    const d = dests(s, '0,0');
    expect(d).toEqual(['2,1', '3,-1']);
  });

  it('муравей обходит весь улей, но не в замкнутую лунку', () => {
    const s = pos({ '0,0': 'A', '1,0': 'Q', '2,0': 'q' });
    expect(dests(s, '0,0').length).toBe(7);
  });

  it('жук залезает на улей, фишка под ним не ходит, стопка — цвета жука', () => {
    let s = pos({ '0,0': 'B', '1,0': 'Q', '2,0': 'q' });
    expect(dests(s, '0,0')).toContain('1,0');
    s = hv.step(s, { type: 'move', from: '0,0', to: '1,0' })!.state;
    expect(s.cells['1,0'].map((p) => p.b)).toEqual(['Q', 'B']);
    s.turn = 0;
    expect(dests(s, '1,0').length).toBeGreaterThan(0);
  });

  it('божья коровка: две по верху и вниз', () => {
    const s = pos({ '0,0': 'L', '1,0': 'Q', '2,0': 'q' }, 0, { ladybug: true });
    const d = dests(s, '0,0');
    expect(d.length).toBeGreaterThan(0);
    for (const k of d) expect(['0,0', '1,0', '2,0']).not.toContain(k);
    expect(d).toContain('3,0');
  });

  it('комар ходит как сосед; рядом только с комаром — стоит', () => {
    const s = pos({ '0,0': 'M', '1,0': 'Q', '2,0': 'q', '1,-1': 'g' }, 0, { mosquito: true });
    // как кузнечик (сосед g): через него — на 2,-2
    expect(dests(s, '0,0')).toContain('2,-2');
    const lone = pos({ '0,0': 'M', '1,0': 'm', '2,0': 'Q', '3,0': 'q' }, 0, { mosquito: true });
    expect(dests(lone, '0,0')).toEqual([]);
  });

  it('мокрица переносит соседа через себя; перенесённый стоит ход', () => {
    let s = pos({ '0,0': 'P', '1,0': 'Q', '-1,0': 'q', '-2,0': 'a' }, 0, { pillbug: true });
    const th = hv.legal(s).filter((m) => m.type === 'throw');
    expect(th.some((m) => m.type === 'throw' && m.from === '-1,0')).toBe(false); // чёрная пчела держит муравья
    expect(th.some((m) => m.type === 'throw' && m.from === '1,0')).toBe(true);
    const a = th.find((m) => m.type === 'throw' && m.from === '1,0')!;
    s = hv.step(s, a)!.state;
    expect(s.last!.thrown).toBe(true);
  });

  it('пчела окружена — победа; обе — ничья', () => {
    const ring = { '1,0': 'A', '1,-1': 'G', '0,-1': 'S', '-1,0': 'B', '-1,1': 'g' };
    const s = pos({ '0,0': 'q', '-2,0': 'Q', ...ring, '3,-2': 'a' }, 0);
    // ставим шестую
    s.hand[0].G = 2;
    s.placed[0] = 5;
    const r = hv.apply(s, { type: 'move', from: '-2,0', to: '0,1' });
    expect(r.state.over).toBe(true);
  });

  it('боты доигрывают партию', () => {
    for (const opts of [{}, { mosquito: true, ladybug: true, pillbug: true }] as Record<string, boolean>[]) {
      let s = hv.setup(opts);
      const rng = new SeededRng(7);
      for (let i = 0; i < 120 && !s.over; i++) {
        const a = choose(s, s.turn, 1, rng)!;
        s = hv.step(s, a)!.state;
      }
      expect(s.ply).toBeGreaterThan(10);
    }
  });
});
