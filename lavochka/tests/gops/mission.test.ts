import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Bot } from '../../src/gops/bot/bot';
import { type LevelData, decodeMask } from '../../src/gops/level';
import { ONE, toPx } from '../../src/gops/sim/fx';
import { type MissionDef, buildMission, missionStars, objectiveText, tickMission } from '../../src/gops/sim/mission';
import { type World, explode, step, wormById } from '../../src/gops/sim/world';

const MISSIONS: MissionDef[] = JSON.parse(readFileSync(join(__dirname, '../../../docs/gops/levels/missions.json'), 'utf8'));
const level = (id: string): LevelData => JSON.parse(readFileSync(join(__dirname, `../../public/gops/levels/${id}.json`), 'utf8'));

function build(id: string, seed = 5) {
  const def = MISSIONS.find((m) => m.id === id)!;
  const lv = level(id);
  return buildMission(def, { mask: decodeMask(lv), waterY: lv.water_y, spawns: lv.spawns, race: lv.race }, seed);
}

/** До начала хода игрока. */
function toPlayerTurn(w: World, run: ReturnType<typeof build>['run']) {
  for (let i = 0; i < 4000 && !(w.phase === 'turn' && w.team === 0); i++) {
    step(w, {});
    tickMission(w, run);
  }
}

/** Закончить ход (пропуском) и дождаться следующего хода игрока. */
function skipTurn(w: World, run: ReturnType<typeof build>['run']) {
  step(w, { weapon: 'kuryu' });
  tickMission(w, run);
  step(w, { fire: true });
  tickMission(w, run);
  for (let i = 0; i < 6000 && !run.result && !(w.phase === 'turn' && w.team === 0 && w.left === w.scheme.turnTime * 60 - 1); i++) {
    step(w, {});
    tickMission(w, run);
  }
}

describe('gops/mission: миссии из missions.json', () => {
  it('все 66 миссий собираются: бригады, предметы цели, у строки цели есть текст', () => {
    expect(MISSIONS.length).toBe(66);
    for (const def of MISSIONS) {
      const { world: w, run } = build(def.id);
      expect(w.teams.length, def.id).toBe(1 + def.enemies.length);
      expect(w.teams[0].worms.length, def.id).toBe(def.player.count);
      const o = def.objective;
      const count = (k: string) => w.objs.filter((x) => x.kind === k).length;
      if (o.type === 'reach_point') expect(count('flag'), def.id).toBe(o.points?.length ?? 1);
      if (o.type === 'race_time') expect(count('flag'), def.id).toBeGreaterThanOrEqual(1);
      if (o.type === 'targets') expect(count('target'), def.id).toBe(o.count);
      if (o.type === 'destroy_objects') expect(count('target'), def.id).toBe(o.count);
      if (o.type === 'protect') expect(count('ward'), def.id).toBe(1);
      if (o.type === 'rescue') expect(count('hostage'), def.id).toBe(o.count);
      if (o.type === 'collect_crates') expect(w.crates.length, def.id).toBe(o.count);
      for (const x of w.objs) expect(x.y, `${def.id} ${x.look}`).toBeLessThan(w.waterY);
      expect(objectiveText(w, run).length, def.id).toBeGreaterThan(3);
    }
  });

  it('«выбей всех»: враги выбыли — победа, без потерь — все звёзды за победу и потери', () => {
    const { world: w, run } = build('m01');
    toPlayerTurn(w, run);
    for (const x of w.worms) if (x.team !== 0) x.hp = 0;
    skipTurn(w, run);
    expect(run.result).toBe('win');
    expect(missionStars(w, run)).toBeGreaterThanOrEqual(2);
  });

  it('флажки берутся по порядку, все взяты — победа', () => {
    const { world: w, run } = build('t01');
    toPlayerTurn(w, run);
    const me = wormById(w, w.active)!;
    for (const f of w.objs.filter((x) => x.kind === 'flag')) {
      me.x = f.x * ONE;
      me.y = f.y * ONE;
      step(w, {});
      tickMission(w, run);
    }
    expect(run.result).toBe('win');
  });

  it('подопечного разнесли — поражение', () => {
    const { world: w, run } = build('m04');
    toPlayerTurn(w, run);
    const ward = w.objs.find((x) => x.kind === 'ward')!;
    explode(w, ward.x, ward.y, 60, 200);
    explode(w, ward.x, ward.y, 60, 200);
    tickMission(w, run);
    expect(run.result).toBe('lose');
  });

  it('продержаться N ходов — победа после N-го хода игрока', () => {
    const { world: w, run } = build('m08');
    const turns = (run.def.objective as { turns: number }).turns;
    toPlayerTurn(w, run);
    // противник не стреляет: забираем у него оружие
    for (const t of w.teams.slice(1)) t.ammo = { kuryu: -1 };
    for (let i = 0; i < turns && !run.result; i++) skipTurn(w, run);
    expect(run.result).toBe('win');
  });

  it('мишени сбиваются выстрелом, бочки рвутся цепочкой', () => {
    const { world: w, run } = build('m02');
    toPlayerTurn(w, run);
    for (const t of w.objs.filter((x) => x.kind === 'target')) explode(w, t.x, t.y, 30, 50);
    tickMission(w, run);
    expect(run.result).toBe('win');
    expect(w.events.some((e) => e.t === 'explode' && e.r === 40)).toBe(true);
  });

  it('каждая миссия идёт ботами без ошибок и одинаково при одном сиде', () => {
    const play = (id: string) => {
      const { world: w, run } = build(id, 3);
      const bots = w.teams.map((_, i) => new Bot(i === 0 ? 'medium' : run.def.enemies[i - 1].bot, mulberry(i + 1)));
      for (let i = 0; i < 1800 && !run.result && w.phase !== 'over'; i++) {
        step(w, bots[w.team].input(w));
        tickMission(w, run);
      }
      return `${run.result}:${w.worms.map((x) => x.hp).join(',')}:${w.objs.map((x) => toPx(x.y * ONE)).join(',')}`;
    };
    for (const def of MISSIONS.filter((_, i) => i % 3 === 0)) expect(play(def.id), def.id).toBe(play(def.id));
  }, 120_000);
});

function mulberry(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
