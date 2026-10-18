import { describe, expect, it } from 'vitest';
import { SeededRng } from '../src/core/rng';
import { KINDS } from '../src/games/dvor/kinds';
import { candidates } from '../src/games/dvor/kinds/bulls';
import { countKenken } from '../src/games/dvor/kinds/kenken';
import { countStopki } from '../src/games/dvor/kinds/stopki';
import { STAGES, KIDS } from '../src/games/dvor/stages';

describe('двор: типы задач', () => {
  for (const K of Object.values(KINDS))
    it(`${K.title}: решатель бота проходит проверку на всех уровнях`, () => {
      for (let lv = 0; lv < 3; lv++)
        for (let seed = 1; seed <= 12; seed++) {
          const st = STAGES.find((s) => s.kinds.includes(K.id)) ?? STAGES[0];
          const { data, sol } = K.gen(lv, new SeededRng(seed * 101 + lv), { names: KIDS, stage: st.id });
          expect(K.check(data, sol, K.solve(data)), `${K.id} lv${lv} seed${seed}`).toBe(true);
          expect(K.check(data, sol, null)).toBe(false);
          expect(K.hint(data, sol, 0, new SeededRng(1))).not.toBeNull();
        }
    }, 60_000);

  it('решение единственное (быки, стопки, квадрат)', () => {
    for (let lv = 0; lv < 3; lv++)
      for (let seed = 1; seed <= 8; seed++) {
        const rng = () => new SeededRng(seed * 7 + lv);
        expect(candidates(KINDS.bulls.gen(lv, rng(), { names: KIDS, stage: 'fantiki' }).data).length).toBe(1);
        expect(countStopki(KINDS.stopki.gen(lv, rng(), { names: KIDS, stage: 'stroika' }).data)).toBe(1);
        expect(countKenken(KINDS.kenken.gen(lv, rng(), { names: KIDS, stage: 'minus5' }).data)).toBe(1);
      }
  }, 60_000);

  it('«Кто где» складывается на теме каждого этапа', () => {
    for (const s of STAGES.filter((x) => x.zebra))
      for (let lv = 0; lv < 3; lv++) {
        const { data, sol } = KINDS.zebra.gen(lv, new SeededRng(lv + 5), { names: KIDS, stage: s.id });
        expect(KINDS.zebra.check(data, sol, KINDS.zebra.solve(data)), `${s.id} lv${lv}`).toBe(true);
      }
  }, 60_000);

  it('у каждого этапа есть типы и вступления к ним', () => {
    for (const s of STAGES) {
      expect(s.kinds.length).toBeGreaterThanOrEqual(2);
      for (const k of s.kinds) {
        expect(KINDS[k], `${s.id}: ${k}`).toBeTruthy();
        expect(s.lead[k], `${s.id}: вступление к ${k}`).toBeTruthy();
      }
    }
  });
});
