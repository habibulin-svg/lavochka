import { describe, expect, it } from 'vitest';
import { CAMPAIGNS, CUTSCENE_TEXT } from '../../src/geroi/campaign';
import { buildScenario } from '../../src/geroi/campaign/types';
import { holds } from '../../src/geroi/sim/adv/scenario';
import { act } from '../../src/geroi/sim/adv/world';
import { existsSync } from 'node:fs';
import { SALE_OPEN } from '../../src/geroi/sale';
import { scenarioSuite } from './scenario-suite';

const ALL = CAMPAIGNS.flatMap((c) => c.scenarios.map((s) => ({ c, s })));

describe('geroi/campaign: сценарии кампаний', () => {
  it('у каждой кампании есть сценарии и ролики с текстом', () => {
    for (const c of CAMPAIGNS) {
      expect(c.scenarios.length).toBeGreaterThan(0);
      for (const id of [...c.scenarios.flatMap((s) => s.before), ...c.finale, ...(c.ending?.options.flatMap((o) => o.cut) ?? [])]) {
        expect(CUTSCENE_TEXT[id], id).toBeTruthy();
        // ролики платной части ещё генерируются: требуем их, когда откроется продажа (как тест ассетов)
        if (!c.paid || SALE_OPEN) expect(existsSync(`public/geroi/a/cutscenes/${id}.mp4`), id).toBe(true);
      }
    }
  });

  scenarioSuite(ALL.filter((x) => !x.c.paid));

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
