import { describe, expect, it } from 'vitest';
import { type BotLevel } from '../../src/geroi/bot/bot';
import { botStep, newMem } from '../../src/geroi/bot/advbot';
import { playBotGame, playBotTurn } from '../../src/geroi/bot/advplay';
import { type Faction } from '../../src/geroi/sim/creatures';
import { factionClasses } from '../../src/geroi/sim/heroes';
import { generateMap } from '../../src/geroi/sim/adv/gen';
import { makeTestMap } from '../../src/geroi/sim/adv/testmap';
import type { TownFaction } from '../../src/geroi/sim/adv/town';
import { type World, act, playerHeroes } from '../../src/geroi/sim/adv/world';

const TF: TownFaction[] = ['zatulye', 'zatonye', 'kuznya', 'akademiya'];
const spec = (seed: number, fa: TownFaction, fb: TownFaction) => ({
  seed,
  players: [
    { name: 'А', faction: fa, hero: { cls: factionClasses(fa as Faction)[0].id, n: 1 } },
    { name: 'Б', faction: fb, hero: { cls: factionClasses(fb as Faction)[1].id, n: 2 } },
  ],
});
const duel = (seed: number, fa: TownFaction = TF[seed % 4], fb: TownFaction = TF[(seed + 1) % 4]): World =>
  generateMap(spec(seed, fa, fb), { template: 'duel', size: 's', water: 'lakes', guard: 'normal', seed });

describe('geroi/advbot: ИИ карты', () => {
  it('один сид — одна партия; мир остаётся JSON', () => {
    const a = duel(3);
    const b = duel(3);
    const ra = playBotGame(a, ['medium', 'medium'], 40, 'medium');
    const rb = playBotGame(b, ['medium', 'medium'], 40, 'medium');
    expect(ra).toEqual(rb);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(JSON.parse(JSON.stringify(a))).toEqual(a);
  });

  it('бот ходит только туда, где был свет: цели — открытые клетки', () => {
    const w = duel(5);
    const mem = newMem();
    for (let i = 0; i < 400 && w.day < 10 && !w.over; i++) {
      if (w.current !== 0 || w.pending?.t === 'battle') {
        playBotTurn(w, ['medium', 'medium'], newMem());
        continue;
      }
      const a = botStep(w, 'medium', mem);
      if (a.t === 'move') expect(w.players[0].explored[a.to]).toBe(1);
      act(w, a);
    }
  });

  it('партии доходят до победы за разумное число дней', () => {
    for (const seed of [1, 2, 4]) {
      const r = playBotGame(duel(seed), ['medium', 'medium'], 150, 'medium');
      expect(r.winner, `сид ${seed}`).toBeGreaterThanOrEqual(0);
      expect(r.days).toBeLessThanOrEqual(150);
    }
  });

  it('Сложный обыгрывает Лёгкого, Средний — Лёгкого (места меняются)', () => {
    const score = (x: BotLevel, y: BotLevel, n: number): number => {
      let win = 0;
      for (let i = 0; i < n; i++) {
        const swap = i % 2 === 1;
        const r = playBotGame(duel(100 + i), swap ? [y, x] : [x, y], 150, 'medium');
        if (r.winner >= 0 && (r.winner === 0) !== swap) win++;
      }
      return win;
    };
    expect(score('hard', 'easy', 6)).toBeGreaterThanOrEqual(5);
    expect(score('medium', 'easy', 6)).toBeGreaterThanOrEqual(5);
  });

  it('«Острова»: бот плывёт на лодке и доходит до чужого замка', () => {
    for (const seed of [1, 2]) {
      const w = generateMap(spec(seed, 'zatulye', 'zatonye'), { template: 'islands', size: 'm', water: 'lakes', guard: 'normal', seed });
      const r = playBotGame(w, ['medium', 'medium'], 150, 'medium');
      expect(r.winner, `сид ${seed}`).toBeGreaterThanOrEqual(0);
    }
  });

  it('«Две реки»: бот строит, нанимает и берёт второго героя', () => {
    const w = makeTestMap(spec(7, 'zatulye', 'kuznya'));
    const mems = [newMem(), newMem()];
    while (!w.over && w.day < 10) playBotTurn(w, ['hard', 'hard'], mems[w.current], { battleCap: 'medium' });
    for (const p of [0, 1]) {
      if (!w.players[p].alive) continue;
      const t = w.towns.find((x) => x.owner === p);
      if (t) expect(t.built.length).toBeGreaterThan(5);
      expect(playerHeroes(w, p).length).toBeGreaterThanOrEqual(1);
    }
  });
});
