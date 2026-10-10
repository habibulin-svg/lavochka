/* ГОПС: взрыв крестом ломает первый ящик и гаснет на гараже, цепная реакция, битва ботов доходит до трёх побед, в районе — люк открывается без врагов. */
import { describe, expect, it } from 'vitest';
import { Gops, GW, GH } from '../src/games/gops/logic';

const idle = [{ dx: 0, dy: 0, bomb: false }, { dx: 0, dy: 0, bomb: false }];

describe('ГОПС', () => {
  it('поле: забор по краю, гаражи через клетку, старты свободны', () => {
    const g = new Gops('battle', 0, 4, 1, 5);
    for (let x = 0; x < GW; x++) expect(g.grid[0][x]).toBe('wall');
    expect(g.grid[2][2]).toBe('wall');
    for (const [x, y] of Gops.starts) expect(g.grid[y][x]).toBe('floor');
  });
  it('взрыв: ломает ящик, не проходит гараж, рвёт соседнюю петарду', () => {
    const g = new Gops('story', 1, 1, 1, 7);
    g.enemies = [];
    for (let y = 1; y < GH - 1; y++) for (let x = 1; x < GW - 1; x++) if (g.grid[y][x] === 'crate') g.grid[y][x] = 'floor';
    g.grid[1][5] = 'crate';
    g.grid[1][6] = 'crate';
    g.players[0].x = 9;
    g.players[0].y = 9;
    g.bombs.push({ x: 3, y: 1, t: 0.01, fire: 5, owner: 9 }, { x: 3, y: 3, t: 99, fire: 1, owner: 9 });
    g.update(20, idle);
    expect(g.grid[1][5]).toBe('floor');
    expect(g.grid[1][6]).toBe('crate');
    expect(g.flames.some((f) => f.x === 2 && f.y === 2)).toBe(false);
    expect(g.bombs.length).toBe(0); // вторая взорвалась цепью
  });
  it('битва четырёх ботов: раунды кончаются, кто-то набирает три победы', () => {
    const g = new Gops('battle', 0, 4, 1, 11);
    let rounds = 0;
    for (let i = 0; i < 60 * 60 * 15 && !g.over; i++) {
      g.update(16, []);
      if (g.roundWinner != null) {
        rounds++;
        g.nextRound();
      }
    }
    expect(rounds).toBeGreaterThan(0);
    expect(g.over).toBe(true);
  });
  it('район без врагов — люк открыт, вход в него — следующий район', () => {
    const g = new Gops('story', 1, 1, 1, 3);
    g.enemies = [];
    g.update(16, idle);
    expect(g.exitOpen).toBe(true);
    // поставить люк под игрока
    const p = g.players[0];
    g.bonus[p.y][p.x] = 'exit';
    g.update(16, idle);
    expect(g.level).toBe(2);
  });
});
