/* Проверки каждой игры: боты доигрывают партии, пресеты работают, показ правил проходит по правилам. */
import { describe, expect, it } from 'vitest';
import { RiggedRng, SeededRng } from '../src/core/rng';
import type { GameDef } from '../src/core/types';
import { CATALOG } from '../src/games/catalog';
import { DEFS } from '../src/games/defs';
import { botSeats, defaults, simulate } from './harness';

/** Сколько партий на каждое число игроков. В CI/хуке — мало, вручную можно больше: SIM_GAMES=50 npm test. */
const GAMES = Number(process.env.SIM_GAMES || 4);
const LEVEL_MIXES = [[0], [1], [2], [0, 1, 2]];

describe('каталог', () => {
  it('готовые игры каталога зарегистрированы для сервера и наоборот', () => {
    const ready = CATALOG.filter((g) => g.load && !g.arcade).map((g) => g.id).sort();
    expect(Object.keys(DEFS).sort()).toEqual(ready);
  });
  it('id в каталоге уникальны', () => {
    const ids = CATALOG.map((g) => g.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe.each(Object.keys(DEFS))('%s', (id) => {
  const load = (): Promise<GameDef> => DEFS[id]();

  it('описание игры согласовано', async () => {
    const def = await load();
    expect(def.id).toBe(id);
    expect(def.seats.length).toBeGreaterThanOrEqual(def.players.max);
    expect(def.bot.levels.length).toBeGreaterThan(0);
    for (let n = def.players.min; n <= def.players.max; n++) {
      const seats = def.seatsFor ? def.seatsFor(n) : [];
      if (def.seatsFor) expect(new Set(seats).size, `seatsFor(${n})`).toBe(n);
    }
    expect(def.rules.sections.length).toBeGreaterThan(0);
  });

  it('боты доигрывают партии на любом числе игроков', async () => {
    const def = await load();
    for (let n = def.players.min; n <= def.players.max; n++) {
      for (let k = 0; k < GAMES; k++) {
        const levels = LEVEL_MIXES[k % LEVEL_MIXES.length];
        const res = await simulate(def, botSeats(def, n, levels), defaults(def), 1000 * n + k);
        expect(res.error, `${n} игроков, партия ${k}`).toBeUndefined();
        expect(res.finished, `${n} игроков, партия ${k}: не закончилась за ${res.steps} ходов`).toBe(true);
      }
    }
  }, 180_000);

  it('каждый готовый набор правил играбелен', async () => {
    const def = await load();
    for (const p of def.presets || []) {
      const opts = { ...defaults(def), ...p.options };
      const res = await simulate(def, botSeats(def, def.players.default), opts, 77);
      expect(res.error, `пресет ${p.id}`).toBeUndefined();
      expect(res.finished, `пресет ${p.id}`).toBe(true);
    }
  }, 180_000);

  it('показ правил: каждый шаг допустим', async () => {
    const def = await load();
    for (const sec of def.rules.sections) {
      const demo = sec.demo;
      if (!demo) continue;
      const rng = new RiggedRng(new SeededRng(20240607));
      let state = demo.setup ? demo.setup(def, rng) : def.setup(demo.seats, { ...defaults(def), ...(demo.options || {}) }, rng);
      demo.steps.forEach((st, i) => {
        rng.rig(st.rig);
        const res = def.apply(state, st.seat, st.action, rng);
        expect(res, `«${sec.title}», шаг ${i + 1}: ход отклонён`).not.toBeNull();
        state = res!.state;
        JSON.stringify(def.view(state, 'all'));
      });
    }
  });

  it('позиция для превью корректна', async () => {
    const def = await load();
    if (!def.showcase) return;
    const st = def.showcase();
    expect(() => JSON.stringify(def.view(st, 'all'))).not.toThrow();
  });
});
