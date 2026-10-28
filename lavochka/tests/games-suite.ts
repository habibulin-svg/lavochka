/* Проверки каждой игры: боты доигрывают партии, пресеты работают, показ правил проходит по правилам.
 * Игры поделены на части (games-1…8.test.ts): одним файлом прогон шёл ~11 минут в одном потоке, и vitest падал
 * с «Timeout calling onTaskUpdate». */
import { describe, expect, it } from 'vitest';
import { RiggedRng, SeededRng } from '../src/core/rng';
import type { GameDef } from '../src/core/types';
import { DEFS } from '../src/games/defs';
import { botSeats, defaults, simulate } from './harness';

/** Быстрая проверка (npm run check:quick): GAMES_ONLY — какие игры гонять ('' — никакие, '*' — все), по партии на число игроков. */
const QUICK = process.env.GAMES_ONLY != null;
/** Сколько партий на каждое число игроков. В полной проверке — 4, вручную можно больше: SIM_GAMES=50 npm test. */
const GAMES = Number(process.env.SIM_GAMES || (QUICK ? 1 : 4));
/** Сколько ходов сильный бот играет своим уровнем (каждый третий свой ход, остальные — лёгким, см. simulate). В длинном прогоне SIM_GAMES — без предела. */
const STRONG_MOVES = process.env.SIM_GAMES ? Infinity : 4;

/** Игры для быстрой проверки. Папка, которой нет среди игр (холдем живёт в «Покере»), — гоняем все. */
function selected(all: string[]): string[] {
  const only = process.env.GAMES_ONLY;
  if (only == null || only === '*') return all;
  const ids = only.split(',').filter(Boolean);
  return ids.some((id) => !all.includes(id)) ? all : ids;
}
/** Уровни ботов по партиям: каждый уровень играет, но «все сложные» — нет (это самые долгие партии, а силу ботов
 * проверяют тесты своих игр). */
const LEVEL_MIXES = [[0], [1], [0, 2], [2, 1, 0]];
export const PARTS = 8;

/** Игры части part (0…PARTS-1) — через одну, чтобы тяжёлые не собрались в одном файле. Часть считается по полному
 * списку, а фильтр GAMES_ONLY — потом: игра всегда в своём файле, остальные файлы просто пусты (а не падают). */
export function gameSuites(part: number) {
  const all = Object.keys(DEFS).sort();
  const sel = new Set(selected(all));
  const ids = all.filter((id, i) => i % PARTS === part && sel.has(id));
  if (!ids.length) {
    describe.skip(`часть ${part + 1}: игр нет`, () => it('—', () => {}));
    return;
  }
  describe.each(ids)('%s', (id) => {
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
        // промежуточные числа игроков (в «Яйцах» их семь) — одна партия, смесь уровней по кругу
        const edge = n === def.players.min || n === def.players.max || n === def.players.default;
        const games = edge || process.env.SIM_GAMES ? Array.from({ length: GAMES }, (_, k) => k) : [n % LEVEL_MIXES.length];
        for (const k of games) {
          const levels = LEVEL_MIXES[k % LEVEL_MIXES.length];
          const res = await simulate(def, botSeats(def, n, levels), defaults(def), 1000 * n + k, undefined, STRONG_MOVES);
          expect(res.error, `${n} игроков, партия ${k}`).toBeUndefined();
          expect(res.finished, `${n} игроков, партия ${k}: не закончилась за ${res.steps} ходов`).toBe(true);
        }
      }
    }, 300_000);

    it('каждый готовый набор правил играбелен', async () => {
      const def = await load();
      for (const p of def.presets || []) {
        const opts = { ...defaults(def), ...p.options };
        // запас шагов: серии («Лукоморье» — четыре части подряд) ботам приходится проходить долго
        // наборы правил проверяем на лёгких ботах: важно, что правила играбельны, а не сила игры (сильные — в 5–20 раз дольше)
        const res = await simulate(def, botSeats(def, def.players.default, [0]), opts, 77, 400_000);
        expect(res.error, `пресет ${p.id}`).toBeUndefined();
        expect(res.finished, `пресет ${p.id}`).toBe(true);
      }
    }, 300_000);

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
}
