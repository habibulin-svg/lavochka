/* Кампании платной части (3–7, CAMPAIGNS2.md): общие проверки сценариев, Сложный бот на месте человека, «Долг», «Котлован», финал. */
import { describe, expect, it } from 'vitest';
import { CAMPAIGNS } from '../../src/geroi/campaign';
import { buildScenario } from '../../src/geroi/campaign/types';
import { bumpLevel, holds } from '../../src/geroi/sim/adv/scenario';
import { act } from '../../src/geroi/sim/adv/world';
import { playBotGame } from '../../src/geroi/bot/advplay';
import { scenarioSuite } from './scenario-suite';

const ALL = CAMPAIGNS.flatMap((c) => c.scenarios.map((s) => ({ c, s })));

describe('geroi/campaign2: кампании платной части', () => {
  scenarioSuite(ALL.filter((x) => x.c.paid));

  /** Мерка баланса: Сложный бот на месте человека проходит хотя бы этот сценарий кампании (герой — как пришёл бы из прошлых). */
  const BOT_PASS: [string, number][] = [['c3-4', 6], ['c4-1', 1], ['c5-3', 1], ['c6-2', 1], ['c7-2', 1]];
  for (const [id, level] of BOT_PASS) {
    it(`Сложный бот на месте человека проходит «${id}»`, () => {
      const s = ALL.find((x) => x.s.id === id)!.s;
      const w = buildScenario(s, 'normal', null);
      bumpLevel(w.heroes.find((h) => h.tag === 'main')!, level);
      playBotGame(w, w.players.map((p) => p.bot ?? 'hard'), 60);
      expect(w.scn!.result, w.scn!.goals.map((g) => g.id + (g.done ? '✓' : '')).join(' ')).toBe('win');
    }, 60000);
  }

  it('у платных кампаний замок, у финала — условия и выбор концовки', () => {
    for (const id of ['c3', 'c4', 'c5', 'c6', 'c7']) expect(CAMPAIGNS.find((c) => c.id === id)?.paid, id).toBe(true);
    const fin = CAMPAIGNS.find((c) => c.id === 'c7')!;
    expect(fin.needs).toEqual({ all: ['c1', 'c2'], some: { of: ['c3', 'c4', 'c5', 'c6'], n: 2 } });
    expect(fin.ending!.options.map((o) => o.id)).toEqual(['home', 'stay']);
    expect(fin.scenarios.length).toBe(3);
    expect(CAMPAIGNS.flatMap((c) => c.scenarios).length).toBe(27);
  });

  it('«Долг»: собрал семки к сроку — долг уходит сам, победа', () => {
    const s = ALL.find((x) => x.s.id === 'c5-2')!.s;
    const w = buildScenario(s, 'normal', null);
    w.day = 14;
    w.players[0].res.semki = 30000;
    act(w, { t: 'end' });
    expect(w.scn!.flags).toContain('paid');
    expect(w.players[0].res.semki).toBeLessThan(30000);
    expect(w.scn!.result).toBe('win');
  });

  it('«Котлован»: сердце засчитывается только после Старшого', () => {
    const s = ALL.find((x) => x.s.id === 'c7-3')!.s;
    const w = buildScenario(s, 'normal', null);
    const heart = w.objects.find((o) => o.tag === 'heart')!;
    const main = w.heroes.find((h) => h.tag === 'main')!;
    main.cell = heart.cell + 1;
    expect(holds(w, w.scn!, s.spec.goals[1].cond)).toBe(false);
    w.heroes = w.heroes.filter((h) => h.tag !== 'starshoy');
    expect(holds(w, w.scn!, s.spec.goals[1].cond)).toBe(true);
  });

});
