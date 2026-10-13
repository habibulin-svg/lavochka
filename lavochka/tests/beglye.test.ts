/* «Беглые»: кубик со знаками, монастырь, острог по этапу, плен, гибель и финиш. */
import { describe, expect, it } from 'vitest';
import { RiggedRng, SeededRng } from '../src/core/rng';
import { def } from '../src/games/beglye/def';
import {
  CELLS, FACES, FINISH, NEIGH, START, TO_FINISH, apply, newState, type State,
} from '../src/games/beglye/engine';

const rng = (seed = 5) => new RiggedRng(new SeededRng(seed));

/** Бросок с подкрученной гранью (индекс в FACES). */
function roll(s: State, seat: number, face: string, r = rng()): State {
  const i = FACES.findIndex((f) => f.id === face);
  r.rig([i]);
  const res = apply(s, seat, { type: 'roll' }, r);
  expect(res, `бросок ${face}`).not.toBeNull();
  return res!.state;
}

describe('Беглые', () => {
  it('граф: 481 клетка, монастырь и устье Дона на местах, всё связано', () => {
    expect(CELLS.length).toBe(481);
    expect(CELLS[START].kind).toBe('start');
    expect(CELLS[FINISH].kind).toBe('finish');
    // от монастыря достижимы все клетки (обрывы разметки сшиты мостами)
    const seen = new Set<number>([START]);
    const q = [START];
    while (q.length) {
      const cur = q.shift()!;
      for (const n of NEIGH[cur]) if (!seen.has(n)) {
        seen.add(n);
        q.push(n);
      }
    }
    expect(seen.size).toBe(CELLS.length);
    expect(TO_FINISH[START]).toBeGreaterThan(0);
  });

  it('обычный ход: бросок и один пункт по любой дороге', () => {
    const s = newState([0, 1]);
    const r = roll(s, 0, 'a');
    expect(r.phase).toBe('move');
    expect(r.left).toBe(1);
    const to = NEIGH[r.pos[0]].find((n) => n !== START) ?? NEIGH[r.pos[0]][0];
    const step = apply(r, 0, { type: 'step', to }, rng())!;
    expect(step.state.pos[0]).toBe(to);
    expect(step.state.turn).toBe(1); // ход перешёл
  });

  it('монастырь держит до «Побега», а «Побег» даёт лишний бросок', () => {
    let s = newState([0, 1]);
    const monk = CELLS.findIndex((c) => c.signs.includes('monastery') && c.id !== 'mon');
    s = { ...s, pos: s.pos.map((p, i) => (i === 0 ? monk : p)) };
    s = roll(s, 0, 'c'); // на грани «c» есть монастырь
    expect(s.hold[0]).toBe('monastery');
    expect(s.turn).toBe(1); // сидит — ход перешёл
    s = roll({ ...s, turn: 0, phase: 'roll' }, 0, 'yuriev'); // Юрьев день выпускает
    expect(s.hold[0]).toBe('none');
    expect(s.phase).toBe('move');
  });

  it('второй «арест» отправляет в острог, откуда ведут по этапу', () => {
    const arrestCell = CELLS.findIndex((c) => c.signs.includes('arrest'));
    let s = newState([0, 1]);
    s = { ...s, pos: s.pos.map((p, i) => (i === 0 ? arrestCell : p)) };
    s = roll(s, 0, 'c'); // первый арест — просто идём дальше
    expect(s.hold[0]).toBe('none');
    s = { ...s, pos: s.pos.map((p, i) => (i === 0 ? arrestCell : p)), turn: 0, phase: 'roll' };
    s = roll(s, 0, 'c'); // второй арест — острог
    expect(s.hold[0]).toBe('ostrog');
    // на следующем ходу без «Побега» этап двигает фишку к монастырю
    const before = s.pos[0];
    s = roll({ ...s, turn: 0, phase: 'roll' }, 0, 'a');
    expect(s.pos[0]).not.toBe(before);
    expect(s.hold[0]).toBe('ostrog');
  });

  it('гибель возвращает в монастырь', () => {
    const deathCell = CELLS.findIndex((c) => c.signs.includes('death'));
    let s = newState([0, 1]);
    s = { ...s, pos: s.pos.map((p, i) => (i === 0 ? deathCell : p)) };
    s = roll(s, 0, 'c');
    expect(s.pos[0]).toBe(START);
    expect(s.hold[0]).toBe('none');
  });

  it('дошедший до устья Дона побеждает', () => {
    const s = newState([0, 1]);
    const near = NEIGH[FINISH][0];
    const before = { ...s, pos: s.pos.map((p, i) => (i === 0 ? near : p)), phase: 'move' as const, left: 1, turn: 0 };
    const res = apply(before, 0, { type: 'step', to: FINISH }, rng())!;
    expect(res.state.winner).toBe(0);
    expect(res.events.some((e) => e.type === 'win')).toBe(true);
    expect(def.result(res.state)?.winners).toEqual([0]);
  });

  it('боты доигрывают партии на 2–6 игроках', async () => {
    const { botSeats, defaults, simulate } = await import('./harness');
    for (const n of [2, 3, 6]) {
      const res = await simulate(def, botSeats(def, n), defaults(def), 400 + n, 40000);
      expect(res.error, `${n} игроков`).toBeUndefined();
      expect(res.finished, `${n} игроков`).toBe(true);
    }
  }, 120_000);
});

