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

/* «Шайба»: гонка двух шайб по двум трекам, кубик с клюшками и квадратики, финиш = гол. */
describe('кинь-двинь: «Шайба»', () => {
  const race = BOARDS.find((b) => b.id === 'shayba')!;
  const two = [0, 1].map((seat) => ({ seat, kind: 'human' as const, name: 'x', level: 0 }));

  it('два трека по 30 клеток со своими стартом и воротами', () => {
    const tracks = race.race!.tracks;
    expect(tracks.length).toBe(2);
    for (const t of tracks) {
      expect(t.length).toBe(30);
      expect(race.cells[t[0]].label).toBe('1');
      expect(race.cells[t[29]].label).toBe('30');
    }
    // дорожки не пересекаются
    expect(tracks[0].every((i) => !tracks[1].includes(i))).toBe(true);
  });

  it('играют вдвоём или командами: допустимы только 2, 4 и 6 игроков; на других полях — как раньше', () => {
    expect(def.countsFor!({ map: 'shayba' })).toEqual([2, 4, 6]);
    expect(def.countsFor!({ map: 'krugosvet' })).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(def.countsHint!({ map: 'shayba' })).toContain('2 на 2');
    expect(def.countsHint!({ map: 'krugosvet' })).toBeUndefined();
  });

  it('настройка «Голов до победы» показывается только у «Шайбы» (по умолчанию 3, можно 1, 5, 7)', () => {
    const o = def.options!.find((x) => x.key === 'goals')!;
    expect(o.showIf!({ map: 'shayba' })).toBe(true);
    expect(o.showIf!({ map: 'krugosvet' })).toBe(false);
    expect(o.default).toBe('3');
    expect(o.choices!.map((c) => c.value)).toEqual(['1', '3', '5', '7']);
  });

  it('в командах напарники через одного ходят одной шайбой', () => {
    const rng = new RiggedRng(new SeededRng(11));
    const four = [0, 1, 2, 3].map((seat) => ({ seat, kind: 'human' as const, name: 'x', level: 0 }));
    const s0 = def.setup(four, { map: 'shayba' }, rng) as State;
    const track = race.race!.tracks[0];
    rng.rig([2]); // Вовка (место 0) — грань 3
    let r = def.apply(s0, 0, { type: 'roll' }, rng)!;
    r = def.apply(r.state, 0, { type: 'move' }, rng)!;
    // шайба дорожки 0 сдвинулась, и у напарника (место 2) она там же
    expect(r.state.pos[0]).toBe(track[3]);
    expect(r.state.pos[2]).toBe(track[3]);
    expect(r.state.turn).toBe(1);
    // Ленка, потом напарник Вовки — он бросает той же шайбой
    rng.rig([0]);
    r = def.apply(r.state, 1, { type: 'roll' }, rng)!;
    r = def.apply(r.state, 1, { type: 'move' }, rng)!;
    expect(r.state.turn).toBe(2);
    rng.rig([0]);
    r = def.apply(r.state, 2, { type: 'roll' }, rng)!;
    r = def.apply(r.state, 2, { type: 'move' }, rng)!;
    expect(r.state.pos[0]).toBe(track[4]);
    expect(r.state.pos[2]).toBe(track[4]);
  });

  it('очки ведут вперёд по своей дорожке, красная клюшка — назад, зелёная — вперёд', () => {
    const rng = new RiggedRng(new SeededRng(3));
    let s = def.setup(two, { map: 'shayba' }, rng) as State;
    const track = race.race!.tracks[0];
    // грань 3
    rng.rig([2]);
    let r = def.apply(s, 0, { type: 'roll' }, rng)!;
    expect(r.events[0]).toMatchObject({ type: 'roll', die: 3, kind: 'pips' });
    r = def.apply(r.state, 0, { type: 'move' }, rng)!;
    s = r.state;
    expect(s.pos[0]).toBe(track[3]);
    expect(s.turn).toBe(1);
    // зелёная клюшка: грань 6 и квадратик с двумя точками
    rng.rig([5, 8]);
    r = def.apply(s, 1, { type: 'roll' }, rng)!;
    expect(r.events[0]).toMatchObject({ die: 6, kind: 'green', card: 2, slot: 8 });
    r = def.apply(r.state, 1, { type: 'move' }, rng)!;
    s = r.state;
    expect(s.pos[1]).toBe(race.race!.tracks[1][2]);
    // красная клюшка: грань 5 и квадратик с тремя точками — назад
    rng.rig([4, 14]);
    r = def.apply(s, 0, { type: 'roll' }, rng)!;
    expect(r.events[0]).toMatchObject({ die: 5, kind: 'red', card: 3 });
    expect(r.state.last).toBe(-3);
    r = def.apply(r.state, 0, { type: 'move' }, rng)!;
    expect(r.state.pos[0]).toBe(track[0]);
  });

  it('назад дальше центра шайба не уходит', () => {
    const rng = new RiggedRng(new SeededRng(4));
    let s = def.setup(two, { map: 'shayba' }, rng) as State;
    const track = race.race!.tracks[0];
    s = { ...s, pos: s.pos.map((p, i) => (i === 0 ? track[1] : p)) };
    rng.rig([4, 14]); // красная клюшка, квадратик на 3
    let r = def.apply(s, 0, { type: 'roll' }, rng)!;
    r = def.apply(r.state, 0, { type: 'move' }, rng)!;
    expect(r.state.pos[0]).toBe(track[0]);
  });

  it('клетка 30 — гол: шайба в центр, счёт растёт, лишние очки пропадают', () => {
    const rng = new RiggedRng(new SeededRng(5));
    let s = def.setup(two, { map: 'shayba' }, rng) as State;
    const track = race.race!.tracks[0];
    s = { ...s, pos: s.pos.map((p, i) => (i === 0 ? track[28] : p)) };
    rng.rig([5]); // грань 6 — очков больше, чем осталось
    let r = def.apply(s, 0, { type: 'roll' }, rng)!;
    r = def.apply(r.state, 0, { type: 'move' }, rng)!;
    expect(r.events.some((e) => e.type === 'goal' && e.track === 0 && e.goals === 1)).toBe(true);
    expect(r.state.pos[0]).toBe(track[0]);
    expect(r.state.goals![0]).toBe(1);
    expect(r.state.turn).toBe(1);
  });

  it('партия кончается по числу голов; в команде побеждают все, кто на дорожке', () => {
    const rng = new RiggedRng(new SeededRng(6));
    const four = [0, 1, 2, 3].map((seat) => ({ seat, kind: 'human' as const, name: 'x', level: 0 }));
    let s = def.setup(four, { map: 'shayba', goals: '2' }, rng) as State;
    expect(s.target).toBe(2);
    const track = race.race!.tracks[0];
    s = { ...s, goals: [1, 0], pos: s.pos.map((p, i) => (i === 0 ? track[28] : p)) };
    rng.rig([0]); // грань 1 — как раз в ворота
    let r = def.apply(s, 0, { type: 'roll' }, rng)!;
    r = def.apply(r.state, 0, { type: 'move' }, rng)!;
    expect(r.state.winner).toBe(0);
    const res = def.result(r.state)!;
    expect(res.winners).toEqual([0, 2]);
    expect(res.text).toContain('2 : 0');
  });

  it('показ правил «Шайбы» включает клюшку с квадратиком', () => {
    const section = def.rules.sections.find((x) => x.title === 'Шайба')!;
    expect(section).toBeTruthy();
    const kinds = section.demo!.steps.filter((st) => st.rig && st.rig.length > 1);
    expect(kinds.length).toBeGreaterThan(0);
  });
});
