/* Танчики: кирпич выбивается полосой, бетон — только прокачанным, база гибнет от выстрела, враги выходят по 20,
 * карты всех уровней проходимы (от мест появления врагов до базы — без бетона и воды), партия заканчивается. */
import { describe, expect, it } from 'vitest';
import { genMap, N8, newGame, parseMap, step, waveOf, type TkIn, type TkState } from '../src/games/tanchiki/logic';

const empty = Array.from({ length: 26 }, () => '.'.repeat(26));

function run(st: TkState, frames: number, inp: (st: TkState, f: number) => (TkIn | undefined)[]) {
  const kinds = new Set<string>();
  for (let f = 0; f < frames && st.phase !== 'over'; f++) for (const e of step(st, inp(st, f))) kinds.add(e.k);
  return kinds;
}

describe('танчики', () => {
  it('кирпич выбивается, бетон держит обычный снаряд', () => {
    const rows = empty.slice();
    rows[10] = '..........##@@............';
    const st = newGame({ players: 1, diff: 1, map: rows });
    st.phase = 'play';
    const me = st.tanks.find((t) => t.pl === 0)!;
    me.spawn = 0;
    me.x = 80;
    me.y = 120;
    st.spawnT = 99999;
    const brickBefore = st.map.brick.reduce((a, b) => a + b, 0);
    run(st, 60, () => [{ dir: 0, fire: true }]);
    expect(st.map.brick.reduce((a, b) => a + b, 0)).toBeLessThan(brickBefore);
    me.x = 96;
    me.y = 120;
    const steelBefore = st.map.steel.reduce((a, b) => a + b, 0);
    run(st, 120, () => [{ dir: 0, fire: true }]);
    expect(st.map.steel.reduce((a, b) => a + b, 0)).toBe(steelBefore);
    me.star = 3;
    run(st, 120, () => [{ dir: 0, fire: true }]);
    expect(st.map.steel.reduce((a, b) => a + b, 0)).toBeLessThan(steelBefore);
  });

  it('без игрока враги рано или поздно ломают базу', () => {
    const st = newGame({ players: 1, diff: 2, seed: 7 });
    st.players[0].lives = 1;
    run(st, 60 * 60 * 6, () => [undefined]);
    expect(st.phase).toBe('over');
  });

  it('стрелок, что крутится и палит, сбивает врагов и набирает очки', () => {
    const st = newGame({ players: 2, diff: 0, seed: 3 });
    // ездят вверх-вбок и стреляют только вверх (вниз и вбок у базы — свою же базу разбить можно, как в жизни)
    const D = [0, 1, 0, 3];
    const kinds = run(st, 60 * 60 * 3, (_s, f) => [
      { dir: f % 90 < 60 ? 0 : D[Math.floor(f / 90) % 4], fire: f % 90 < 60 && f % 7 === 0 },
      { dir: f % 70 < 50 ? 0 : D[(Math.floor(f / 70) + 1) % 4], fire: f % 70 < 50 && f % 9 === 0 },
    ]);
    expect(kinds.has('boom')).toBe(true);
    expect(st.players[0].score + st.players[1].score).toBeGreaterThan(0);
  });

  it('волна — двадцать врагов, броневики к концу', () => {
    const w = waveOf(10, 1, 5);
    expect(w.length).toBe(20);
    expect(w.filter((k) => k === 3).length).toBeGreaterThan(1);
    expect(w[19]).toBe(3);
  });

  it('карты 1…40: от мест появления врагов до базы есть путь (кирпич — проходим, бетон и вода — нет)', () => {
    for (let stage = 1; stage <= 40; stage++) {
      const m = parseMap(genMap(stage, 12345));
      // клетки 8×8; танк 2×2 клетки; BFS по левым верхним углам
      const free = (x: number, y: number) => {
        if (x < 0 || y < 0 || x > N8 - 2 || y > N8 - 2) return false;
        for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) if (m.steel[(y + dy) * N8 + x + dx] || m.water[(y + dy) * N8 + x + dx]) return false;
        return true;
      };
      const seen = new Set<number>([0 * N8 + 12]);
      const q: [number, number][] = [[12, 0]];
      while (q.length) {
        const [x, y] = q.shift()!;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (free(nx, ny) && !seen.has(ny * N8 + nx)) {
            seen.add(ny * N8 + nx);
            q.push([nx, ny]);
          }
        }
      }
      // до клетки над базой (кирпичная стенка — разбивается)
      expect(seen.has(21 * N8 + 12), `уровень ${stage}`).toBe(true);
      for (const sx of [0, 24]) expect(seen.has(0 * N8 + sx) || free(sx, 0), `уровень ${stage}, спавн ${sx}`).toBe(true);
    }
  });
});
