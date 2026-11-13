import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Bot, type BotLevel } from '../../src/gops/bot/bot';
import { type LevelData, dealSpawns, decodeMask } from '../../src/gops/level';
import { CORE_AMMO } from '../../src/gops/sim/weapons';
import { createWorld, step } from '../../src/gops/sim/world';

const level = (id: string): LevelData =>
  JSON.parse(readFileSync(join(__dirname, `../../public/gops/levels/${id}.json`), 'utf8'));

/** Детерминированный rand для ботов. */
function lcg(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

function match(id: string, a: BotLevel, b: BotLevel, seed: number, n = 3) {
  const lv = level(id);
  const sp = dealSpawns(lv.spawns, 2, n);
  const w = createWorld({
    mask: decodeMask(lv), waterY: lv.water_y, seed,
    teams: sp.map((s) => ({ spawns: s, hp: 100, ammo: { ...CORE_AMMO } })),
  });
  const bots = [new Bot(a, lcg(seed)), new Bot(b, lcg(seed + 1))];
  let turns = 0, dealt = 0;
  for (let t = 0; t < 60 * 60 * 20 && w.phase !== 'over'; t++) {
    step(w, bots[w.team].input(w));
    for (const e of w.events) {
      if (e.t === 'hit') dealt += e.dmg;
      if (e.t === 'turn') turns++;
    }
  }
  return { w, turns, dealt };
}

describe('gops/bot: партии ботов', () => {
  it('сильный против слабого на нескольких картах: урон идёт, партии кончаются', () => {
    let hardWins = 0, finished = 0;
    for (const [i, id] of ['m03', 'm05'].entries()) {
      const { w, turns, dealt } = match(id, 'hard', 'easy', 100 + i, 2);
      expect(dealt).toBeGreaterThan(0);
      if (w.phase === 'over') finished++;
      if (w.winner === 0) hardWins++;
      expect(turns).toBeGreaterThan(1);
    }
    expect(finished).toBeGreaterThanOrEqual(1);
    expect(hardWins).toBeGreaterThanOrEqual(1);
  }, 120_000);

  it('бот не берёт оружие, которое по условию миссии ещё не выдали (задержка)', () => {
    const lv = level('m03');
    const sp = dealSpawns(lv.spawns, 2, 2);
    const w = createWorld({
      mask: decodeMask(lv), waterY: lv.water_y, seed: 5,
      teams: sp.map((s) => ({ spawns: s, hp: 100, ammo: { ...CORE_AMMO } })),
    });
    w.delays = { mukha: 99, limonka: 99, obrez: 99, sling: 99, makarov: 99, carbide: 99, mortar: 99, kalash: 99, uppercut: 99, kukuruznik: 99 };
    const bot = new Bot('medium', lcg(5));
    const used = new Set<string>();
    for (let t = 0; t < 60 * 60 * 2 && w.phase !== 'over'; t++) {
      const inp = bot.input(w);
      if (inp.weapon) used.add(inp.weapon);
      step(w, inp);
    }
    for (const id of used) expect(w.delays[id] ?? 0).toBe(0);
  }, 60_000);
});
