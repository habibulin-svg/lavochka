/* «Сражение»: состав армии, бой рангов, мины и Сапёр, Разведчик и Маршал, скрытые ранги, туда-обратно, партии ботов. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { choose } from '../src/games/srazhenie/ai';
import { apply, army, fight, FLAG, LAKE, makeView, MINE, newState, cfgFrom, setup, smartLayout, toAct, validLayout, zoneCell, type State } from '../src/games/srazhenie/engine';

function play(lv: [number, number], seed: number, opts = {}): State {
  const rng = new SeededRng(seed);
  let s = setup(opts, rng);
  for (let i = 0; i < 3000 && s.phase !== 'over'; i++) {
    const seat = toAct(s)[0];
    const a = choose(makeView(s, [seat]), seat, lv[seat], rng);
    expect(a).not.toBeNull();
    const r = apply(s, seat, a!, rng);
    expect(r).not.toBeNull();
    s = r!.state;
  }
  return s;
}

describe('Сражение', () => {
  it('армия — 40 фишек, расстановка «с умом» правильная, знамя в заднем ряду', () => {
    expect(army().length).toBe(40);
    for (let k = 0; k < 30; k++) {
      const L = smartLayout(new SeededRng(k));
      expect(validLayout(L)).toBe(true);
      expect(L.indexOf(FLAG)).toBeGreaterThanOrEqual(30);
    }
    const zone = new Set(Array.from({ length: 40 }, (_, i) => zoneCell(0, i)).concat(Array.from({ length: 40 }, (_, i) => zoneCell(1, i))));
    expect(zone.size).toBe(80);
    for (const p of LAKE) expect(zone.has(p)).toBe(false);
  });

  it('бой: меньший ранг сильнее, равные — оба, мина и Сапёр, Разведчик на Маршала', () => {
    expect(fight(3, 5)).toBe('win');
    expect(fight(5, 3)).toBe('lose');
    expect(fight(4, 4)).toBe('both');
    expect(fight(5, MINE)).toBe('lose');
    expect(fight(8, MINE)).toBe('win');
    expect(fight(10, 1)).toBe('win');
    expect(fight(1, 10)).toBe('win');
    expect(fight(10, 9)).toBe('lose');
    expect(fight(9, FLAG)).toBe('win');
  });

  it('чужие ранги скрыты до боя', () => {
    const s = setup({}, new SeededRng(1));
    const v = makeView(s, [0]);
    expect(v.cells.filter((c) => c && c.owner === 1).every((c) => c!.rank === null)).toBe(true);
    expect(v.cells.filter((c) => c && c.owner === 0).every((c) => c!.rank !== null)).toBe(true);
  });

  it('туда-обратно не больше трёх раз подряд', () => {
    const s0 = newState(cfgFrom({}));
    s0.phase = 'play';
    s0.cells[90] = { id: 1, owner: 0, rank: 5, moved: false, known: false };
    s0.cells[99] = { id: 2, owner: 0, rank: FLAG, moved: false, known: false };
    s0.cells[9] = { id: 101, owner: 1, rank: 5, moved: false, known: false };
    s0.cells[0] = { id: 102, owner: 1, rank: FLAG, moved: false, known: false };
    let s = s0;
    const rng = new SeededRng(2);
    const mv = (seat: number, from: number, to: number) => {
      const r = apply(s, seat, { type: 'move', from, to }, rng);
      if (r) s = r.state;
      return !!r;
    };
    expect(mv(0, 90, 80)).toBe(true);
    expect(mv(1, 9, 19)).toBe(true);
    expect(mv(0, 80, 90)).toBe(true);
    expect(mv(1, 19, 9)).toBe(true);
    expect(mv(0, 90, 80)).toBe(true);
    expect(mv(1, 9, 19)).toBe(true);
    expect(mv(0, 80, 90)).toBe(false);
  });

  it('партии ботов доходят до конца; сложный сильнее лёгкого', () => {
    let hard = 0;
    for (let k = 0; k < 10; k++) {
      const s = play(k % 2 ? [2, 0] : [0, 2], 100 + k);
      expect(s.phase).toBe('over');
      if (s.winner === (k % 2 ? 0 : 1)) hard++;
    }
    expect(hard).toBeGreaterThanOrEqual(7);
    const r = play([1, 2], 7, { move: 'run' });
    expect(r.phase).toBe('over');
  });
});
