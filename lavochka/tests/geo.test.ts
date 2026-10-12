/* «География»: наборы и вопросы собираются для всех сочетаний, очки за скорость, попытки на карте. */
import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { ENTITIES, members, REGION_COUNTRIES, SETS } from '../src/games/geo/data';
import { apply, newState, optsOf } from '../src/games/geo/def';

describe('география', () => {
  it('у каждого объекта есть название и слой; id уникальны', () => {
    expect(new Set(ENTITIES.map((e) => e.id)).size).toBe(ENTITIES.length);
    for (const e of ENTITIES) expect(e.n && e.l).toBeTruthy();
  });

  it('наборы не пустые: 193+ страны, 89 регионов РФ, 51 штат с округом', () => {
    expect(members({ set: 'world' }).length).toBeGreaterThanOrEqual(195);
    expect(members({ set: 'world', hard: true }).length).toBeGreaterThan(members({ set: 'world' }).length);
    expect(members({ set: 'ru' }).length).toBe(89);
    expect(members({ set: 'us' }).length).toBe(51);
    for (const c of REGION_COUNTRIES) expect(members({ set: 'reg', country: c.id }).length, c.id).toBeGreaterThan(3);
  });

  it('вопросы собираются для всех наборов и режимов, варианты различны', () => {
    const faces = ['name', 'flag', 'arms', 'capital', 'outline'];
    for (const set of SETS.map((s) => s.id))
      for (const ask of faces)
        for (const pick of [...faces, 'parent']) {
          if (ask === pick) continue;
          const s = newState([0], optsOf({ mode: 'quiz', set, ask, pick, count: 0, hard: true }), new SeededRng(7));
          expect(s.qs.length, `${set} ${ask}→${pick}`).toBeGreaterThan(0);
          for (const q of s.qs) {
            expect(new Set(q.opts).size).toBe(q.opts!.length);
            expect(q.opts!.length).toBeGreaterThanOrEqual(2);
          }
        }
  });

  it('на карте три попытки: 3, 2, 1 очко', () => {
    const s0 = newState([0], optsOf({ mode: 'map', set: 'eu' }), new SeededRng(1), ['AUT', 'PRT']);
    let r = apply(s0, 0, { type: 'pick', id: 'CHE' })!;
    expect(r.state.fin[0]).toBe(false);
    r = apply(r.state, 0, { type: 'pick', id: 'AUT' })!;
    expect(r.state.score[0]).toBe(2);
    expect(r.state.i).toBe(1);
    expect(apply(r.state, 0, { type: 'pick', id: 'XXX' })).toBeNull();
  });

  it('на скорость: первому верному +2, второму +1', () => {
    const s0 = newState([0, 1, 2], optsOf({ mode: 'quiz', set: 'eu', ask: 'name', pick: 'capital', fast: true }), new SeededRng(3), ['FRA']);
    let s = apply(s0, 2, { type: 'pick', id: 'FRA' })!.state;
    s = apply(s, 0, { type: 'pick', id: 'FRA' })!.state;
    const wrong = s0.qs[0].opts!.find((x) => x !== 'FRA')!;
    const r = apply(s, 1, { type: 'pick', id: wrong })!;
    expect(r.state.score).toEqual({ 0: 4, 1: 0, 2: 5 });
    expect(r.state.over).toBe(true);
  });
});
