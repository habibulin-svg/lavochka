import { describe, expect, it } from 'vitest';
import { playBotGame } from '../../src/geroi/bot/advplay';
import { type Faction } from '../../src/geroi/sim/creatures';
import { factionClasses } from '../../src/geroi/sim/heroes';
import { generateMap } from '../../src/geroi/sim/adv/gen';
import type { TownFaction } from '../../src/geroi/sim/adv/town';
import { type World, act, actionError, allied, heroAt, playerHeroes, reveal } from '../../src/geroi/sim/adv/world';

const TF: TownFaction[] = ['zatulye', 'zatonye', 'kuznya', 'akademiya'];

/** Четверо, 2×2: команды 1 (места 0, 2) и 2 (места 1, 3). */
function four(seed: number): World {
  const w = generateMap(
    { seed, players: TF.map((f, i) => ({ name: `И${i}`, faction: f, hero: { cls: factionClasses(f as Faction)[0].id, n: 1 } })) },
    { template: 'four', size: 'm', water: 'lakes', guard: 'normal', seed },
  );
  w.players.forEach((p, i) => (p.team = i % 2 ? 2 : 1));
  return w;
}

describe('geroi/allies: союзы 2×2', () => {
  it('союзник: свой для своих, чужой для остальных; ничей — никому', () => {
    const w = four(3);
    expect(allied(w, 0, 2)).toBe(true);
    expect(allied(w, 0, 1)).toBe(false);
    expect(allied(w, 0, -1)).toBe(false);
    expect(allied(w, 1, 1)).toBe(true);
  });

  it('обзор общий: открытое одному — открыто союзнику, не сопернику', () => {
    const w = four(4);
    const c = w.w * 20 + 20;
    const before1 = w.players[1].explored[c];
    reveal(w, 0, c, 2);
    expect(w.players[0].explored[c]).toBe(1);
    expect(w.players[2].explored[c]).toBe(1);
    expect(w.players[1].explored[c]).toBe(before1);
  });

  it('ресурсы — только союзнику и не больше, чем есть', () => {
    const w = four(5);
    w.current = 0;
    const had = w.players[2].res.wood;
    expect(actionError(w, { t: 'gift', to: 1, res: 'wood', amount: 1 })).toBe('Не союзник');
    expect(actionError(w, { t: 'gift', to: 2, res: 'wood', amount: 99999 })).toBe('Не хватает');
    act(w, { t: 'gift', to: 2, res: 'wood', amount: 3 });
    expect(w.players[2].res.wood).toBe(had + 3);
  });

  it('герой союзника: встреча вместо боя; отряд отдать можно, забрать — нет', () => {
    const w = four(6);
    w.current = 0;
    const a = playerHeroes(w, 0)[0];
    const b = playerHeroes(w, 2)[0];
    // ставим союзника рядом
    const near = [a.cell + 1, a.cell - 1, a.cell + w.w, a.cell - w.w].find((c) => !w.block[c] && !heroAt(w, c))!;
    b.cell = near;
    const ev = act(w, { t: 'move', hero: a.id, to: near });
    expect(ev.some((e) => e.e === 'meet')).toBe(true);
    expect(w.pending).toBeNull();
    const free = b.army.findIndex((s) => !s);
    const from = a.army.findIndex((s) => s);
    if (a.army.filter((s) => s).length > 1) expect(actionError(w, { t: 'transfer', from: { h: a.id }, fromSlot: from, to: { h: b.id }, toSlot: free })).toBeNull();
    const theirs = b.army.findIndex((s) => s);
    expect(actionError(w, { t: 'transfer', from: { h: b.id }, fromSlot: theirs, to: { h: a.id }, toSlot: a.army.findIndex((s) => !s) })).toBe('Чужой отряд');
  });

  it('боты 2×2 доигрывают: побеждает команда, союзники друг друга не выбивают', () => {
    const w = four(7);
    const lost: number[] = [];
    const r = playBotGame(w, ['medium', 'medium', 'medium', 'medium'], 200, 'easy');
    for (const p of w.players) if (!p.alive) lost.push(p.id);
    expect(r.winner).toBeGreaterThanOrEqual(0);
    const team = w.players[r.winner].team;
    // все выжившие — из команды победителя, соперники выбыли
    expect(w.players.filter((p) => p.alive).every((p) => p.team === team)).toBe(true);
    expect(w.players.filter((p) => p.team !== team).every((p) => !p.alive)).toBe(true);
  }, 120_000);
});
