import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { type LevelData, decodeMask, dryLevel } from '../../src/gops/level';
import { type MissionDef, buildMission, tickMission } from '../../src/gops/sim/mission';
import { step } from '../../src/gops/sim/world';

const MISSIONS: MissionDef[] = JSON.parse(readFileSync(join(__dirname, '../../../docs/gops/levels/missions.json'), 'utf8'));
const level = (id: string): LevelData => dryLevel(JSON.parse(readFileSync(join(__dirname, `../../public/gops/levels/${id}.json`), 'utf8')));

// Генератор ставил старт и финиш гонки под воду (r13 — боец тонул при высадке): уровень после dryLevel играбелен с первой секунды.
describe('уровни кампании: никто не тонет при высадке', () => {
  for (const def of MISSIONS) {
    it(def.id, () => {
      const lv = level(def.id);
      for (const p of [...lv.spawns, ...(lv.race ? [lv.race.start, lv.race.finish] : [])]) expect(p[1]).toBeLessThan(lv.water_y);
      const { world, run } = buildMission(def, { mask: decodeMask(lv), waterY: lv.water_y, spawns: lv.spawns, race: lv.race }, 7);
      // высадка и первые секунды без ввода: ни один боец не утонул, миссия не кончилась
      for (let i = 0; i < 240 && world.phase !== 'over'; i++) {
        step(world, {});
        tickMission(world, run);
      }
      expect(world.worms.filter((x) => x.state === 'dead').map((x) => x.id)).toEqual([]);
      expect(run.result).toBeNull();
    });
  }
});
