import { describe, expect, it } from 'vitest';
import { CAMPAIGNS, CUTSCENE_TEXT } from '../../src/geroi/campaign';
import { type Difficulty, buildScenario, takeCarry } from '../../src/geroi/campaign/types';
import { OBJECTS, WATER } from '../../src/geroi/sim/adv/data';
import { holds } from '../../src/geroi/sim/adv/scenario';
import { type World, act, neighbors } from '../../src/geroi/sim/adv/world';
import { existsSync } from 'node:fs';

const ALL = CAMPAIGNS.flatMap((c) => c.scenarios.map((s) => ({ c, s })));

/** Клетки, куда можно дойти пешком от героев и городов человека (отряды не мешают — их бьют). */
function walkable(w: World, from: number[]): Uint8Array {
  const seen = new Uint8Array(w.w * w.h);
  const q = [...from];
  for (const c of from) seen[c] = 1;
  for (let i = 0; i < q.length; i++) {
    for (const nb of neighbors(w, q[i])) {
      if (seen[nb] || w.terrain[nb] === WATER || w.block[nb]) continue;
      seen[nb] = 1;
      q.push(nb);
    }
  }
  return seen;
}

describe('geroi/campaign: сценарии кампаний', () => {
  it('у каждой кампании есть сценарии и ролики с текстом', () => {
    for (const c of CAMPAIGNS) {
      expect(c.scenarios.length).toBeGreaterThan(0);
      for (const id of [...c.scenarios.flatMap((s) => s.before), ...c.finale]) {
        expect(CUTSCENE_TEXT[id], id).toBeTruthy();
        expect(existsSync(`public/geroi/a/cutscenes/${id}.mp4`), id).toBe(true);
      }
    }
  });

  for (const { c, s } of ALL) {
    describe(`${c.title}: ${s.title}`, () => {
      const w = buildScenario(s, 'normal', null);

      it('собирается одинаково, мир — JSON', () => {
        const b = buildScenario(s, 'normal', null);
        expect(JSON.stringify(b)).toBe(JSON.stringify(w));
        expect(JSON.parse(JSON.stringify(w))).toEqual(w);
      });

      it('главный герой и метки заданий на месте', () => {
        expect(w.heroes.some((h) => h.tag === 'main' && h.owner === 0)).toBe(true);
        const tags = new Set([...w.objects, ...w.towns, ...w.heroes].map((x) => x.tag).filter(Boolean));
        const want = (cond: unknown): string[] => {
          const x = cond as { t: string; tags?: string[]; tag?: string; at?: unknown; of?: unknown[] };
          if (x.t === 'own') return x.tags!;
          if (x.t === 'quest') return [x.tag!];
          if (x.t === 'near' && typeof x.at === 'string') return [x.at];
          if (x.t === 'all' || x.t === 'any') return x.of!.flatMap(want);
          return [];
        };
        const spawned = new Set(s.spec.triggers.flatMap((t) => t.do.map((a) => ('tag' in a ? a.tag : undefined)).filter(Boolean)));
        for (const g of s.spec.goals) for (const tag of want(g.cond)) expect(tags.has(tag) || spawned.has(tag), `${g.id}: ${tag}`).toBe(true);
        for (const g of s.spec.goals) {
          if (g.cond.t === 'gone') for (const tag of g.cond.tags) expect(tags.has(tag) || spawned.has(tag), `${g.id}: ${tag}`).toBe(true);
        }
      });

      it('все входы достижимы от человека (по суше или лодкой с верфи)', () => {
        const mine = [...w.heroes.filter((h) => h.owner === 0).map((h) => h.cell), ...w.towns.filter((t) => t.owner === 0).map((t) => t.cell)];
        const seen = walkable(w, mine);
        const boats = w.objects.some((o) => OBJECTS[o.kind].effect.t === 'boat' || o.kind === 'shipyard');
        for (const o of w.objects) {
          if (boats && !seen[o.cell]) continue;
          expect(seen[o.cell], `${o.kind} ${o.cell % w.w},${Math.trunc(o.cell / w.w)}`).toBe(1);
        }
        for (const t of w.towns) expect(seen[t.cell], t.name).toBe(1);
      });

      it('в первый день не выиграно и не проиграно', () => {
        const x = buildScenario(s, 'normal', null);
        act(x, { t: 'end' });
        expect(x.over).toBe(false);
        expect(x.scn!.goals.some((g) => !g.done && !g.optional)).toBe(true);
      });

      it('сложность меняет охрану, герой переходит из прошлого сценария', () => {
        const by = (d: Difficulty): number => buildScenario(s, d, null).objects.reduce((n, o) => n + (o.army?.reduce((m, st) => m + (st?.count ?? 0), 0) ?? 0), 0);
        expect(by('hard')).toBeGreaterThanOrEqual(by('easy'));
        const main = w.heroes.find((h) => h.tag === 'main')!;
        const carry = { ...takeCarry(main), level: 7, atk: 9 };
        const x = buildScenario({ ...s, carry: true }, 'normal', carry);
        const m2 = x.heroes.find((h) => h.tag === 'main')!;
        expect(m2.level).toBe(7);
        expect(m2.atk).toBe(9);
      });
    });
  }

  it('«Сход»: задания засчитываются, все четыре — победа', () => {
    const s = CAMPAIGNS[0].scenarios[0];
    const w = buildScenario(s, 'normal', null);
    const scn = w.scn!;
    for (const tag of ['mill', 'quarry']) w.objects.find((o) => o.tag === tag)!.owner = 0;
    w.objects.splice(w.objects.findIndex((o) => o.tag === 'bandits'), 1);
    act(w, { t: 'end' });
    expect(scn.goals.filter((g) => g.done).map((g) => g.id).sort()).toEqual(['bandits', 'mill', 'quarry']);
    expect(w.over).toBe(false);
    const main = w.heroes.find((h) => h.tag === 'main')!;
    main.army[0]!.count = 25;
    expect(holds(w, scn, s.spec.goals[3].cond)).toBe(true);
    act(w, { t: 'end' });
    expect(w.over).toBe(true);
    expect(scn.result).toBe('win');
  });

  it('гибель главного героя — поражение', () => {
    const s = CAMPAIGNS[0].scenarios[0];
    const w = buildScenario(s, 'normal', null);
    w.heroes = w.heroes.filter((h) => h.tag !== 'main');
    act(w, { t: 'end' });
    expect(w.scn!.result).toBe('lose');
  });
});
