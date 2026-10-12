/* Кинь-двинь: разметка полей и знаки — ветки «туда и обратно», пропуск на несколько ходов, переходы. */
import { describe, expect, it } from 'vitest';
import { RiggedRng, SeededRng } from '../src/core/rng';
import { BOARDS, def } from '../src/games/hodilki/def';
import { finishOf, type State } from '../src/games/hodilki/core';

const seats = [0, 1].map((seat) => ({ seat, kind: 'human' as const, name: 'x', level: 0 }));

/** Бросок с заданным значением кубика и ход. */
function turn(s: State, seat: number, die: number, rng: RiggedRng) {
  rng.rig([die - 1]);
  const r1 = def.apply(s, seat, { type: 'roll' }, rng)!;
  expect(r1, 'бросок').not.toBeNull();
  const r2 = def.apply(r1.state, seat, { type: 'move' }, rng)!;
  expect(r2, 'ход').not.toBeNull();
  return r2;
}

describe('кинь-двинь: поля', () => {
  it.each(BOARDS.map((b) => b.id))('%s: знаки ведут на существующие клетки', (id) => {
    const b = BOARDS.find((x) => x.id === id)!;
    const end = finishOf(b);
    b.cells.forEach((c, i) => {
      expect(Number.isFinite(c.x) && Number.isFinite(c.y), `клетка ${i}`).toBe(true);
      expect(c.x >= 0 && c.x <= b.img.w && c.y >= 0 && c.y <= b.img.h, `клетка ${i} внутри поля`).toBe(true);
      const g = c.sign;
      if (!g) return;
      expect(i <= end, `знак на клетке ветки ${i}`).toBe(true);
      if (g.k === 'jump') expect(g.to >= 0 && g.to <= end && g.to !== i, `переход с ${c.label ?? i}`).toBe(true);
      if (g.k === 'route') {
        expect(g.cells.length).toBeGreaterThan(1);
        for (const k of g.cells.slice(0, -1)) expect(b.cells[k]?.off, `ветка с ${c.label}: клетка ${k}`).toBe(true);
        const last = g.cells[g.cells.length - 1];
        expect(last <= end && !b.cells[last].off, `ветка с ${c.label} выходит на путь`).toBe(true);
      }
    });
  });
});

describe('кинь-двинь: ветка «туда и обратно»', () => {
  it('Подвески: с 8 — в Крей и обратно на 8, потом дальше', () => {
    const rng = new RiggedRng(new SeededRng(1));
    let s = def.setup(seats, { map: 'podveski' }, rng) as State;
    const b = BOARDS.find((x) => x.id === 'podveski')!;
    const i8 = b.cells.findIndex((c) => c.label === '8');
    // Вовка: 6 + 2 = 8 (клетка 6 — переход на 10; поэтому 2, потом 6)
    let r = turn(s, 0, 2, rng);
    s = r.state;
    r = turn(s, 1, 1, rng);
    s = r.state;
    r = turn(s, 0, 6, rng);
    s = r.state;
    expect(s.pos[0]).toBe(i8);
    expect(r.events.some((e) => e.type === 'sign' && e.sign.k === 'route')).toBe(true);
    const route = s.route![0]!;
    expect(route[route.length - 1]).toBe(i8);
    // идём по ветке, пока не вернёмся на 8
    for (let k = 0; k < 40 && s.route?.[0]; k++) s = turn(s, s.turn, s.turn === 0 ? 6 : 1, rng).state;
    expect(s.route?.[0] ?? null).toBeNull();
    expect(s.pos[0]).toBe(i8);
    // дальше — по основному пути
    for (let k = 0; k < 5 && s.turn !== 0; k++) s = turn(s, s.turn, 1, rng).state;
    s = turn(s, 0, 1, rng).state;
    expect(s.pos[0]).toBe(i8 + 1);
  });

  it('Затерянный мир: пропуск двух ходов на 64', () => {
    const rng = new RiggedRng(new SeededRng(2));
    const s0 = def.setup(seats, { map: 'zatmir' }, rng) as State;
    const b = BOARDS.find((x) => x.id === 'zatmir')!;
    const i64 = b.cells.findIndex((c) => c.label === '64');
    const s: State = { ...s0, pos: s0.pos.map((p, i) => (i === 0 ? i64 - 1 : p)) };
    let r = turn(s, 0, 1, rng);
    expect(r.state.skip[0]).toBe(2);
    // Ленка ходит три раза подряд, пока Вовка пропускает
    let st = r.state;
    let lenka = 0;
    for (let k = 0; k < 3; k++) {
      expect(st.turn).toBe(1);
      st = turn(st, 1, 1, rng).state;
      lenka++;
    }
    expect(lenka).toBe(3);
    expect(st.turn).toBe(0);
  });
});
