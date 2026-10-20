/* Каждый пресет каждой игры: при любом допустимом числе игроков партия раскладывается, а командный пресет и правда даёт команды
 * (раньше «Дурак 2 на 2» на трёх местах молча шёл без пар). */
import { describe, expect, it } from 'vitest';
import { DEFS } from '../src/games/defs';
import { SeededRng } from '../src/core/rng';
import type { GameDef, Options, SeatSpec } from '../src/core/types';

const defaults = (def: GameDef): Options => Object.fromEntries((def.options ?? []).map((o) => [o.key, o.default]));

function counts(def: GameDef, o: Options): number[] {
  const list = (def.countsFor?.(o) ?? []).filter((n) => n >= def.players.min && n <= def.players.max);
  if (list.length) return [...new Set(list)];
  return Array.from({ length: def.players.max - def.players.min + 1 }, (_, i) => def.players.min + i);
}

const seatsFor = (def: GameDef, n: number) => (def.seatsFor ? def.seatsFor(n) : Array.from({ length: n }, (_, i) => i));

/** Пресет, который обещает игру командами. */
const teamPreset = (o: Options) => o.teams === true || o.pairs === 'teams' || o.mode === 'teams' || o.mode === 'team';

describe('пресеты: каждый раскладывается, командные дают команды', () => {
  it('все игры', async () => {
    const problems: string[] = [];
    let checked = 0;
    for (const [id, load] of Object.entries(DEFS)) {
      const def = await load();
      const presets = def.presets?.length ? def.presets : [{ id: '(без пресета)', label: '', options: {} }];
      for (const p of presets) {
        const o = { ...defaults(def), ...p.options };
        for (const n of counts(def, o)) {
          const nums = seatsFor(def, n).sort((a, b) => a - b);
          const seats: SeatSpec[] = nums.map((seat) => ({ seat, kind: 'bot', level: 0, name: def.seats[seat]?.name ?? '?' }));
          try {
            const s = def.setup(seats, o, new SeededRng(7));
            if (!def.realtime && !def.result(s) && !def.toAct(s).length) problems.push(`${id}/${p.id} на ${n}: никто не ходит`);
          } catch (e) {
            problems.push(`${id}/${p.id} на ${n}: ${(e as Error).message}`);
            continue;
          }
          const teams = def.teams?.(o, nums) ?? null;
          if (teamPreset(o) && def.teams && !teams) problems.push(`${id}/${p.id} на ${n}: пресет командный, а команд нет`);
          if (teams) {
            const flat = teams.flat().sort((a, b) => a - b);
            if (JSON.stringify(flat) !== JSON.stringify(nums)) problems.push(`${id}/${p.id} на ${n}: команды ${JSON.stringify(teams)} не делят места ${nums}`);
          }
          checked++;
        }
      }
    }
    expect(problems).toEqual([]);
    expect(checked).toBeGreaterThan(100);
  }, 180_000);
});
