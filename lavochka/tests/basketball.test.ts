/* Настольный баскетбол: точный бросок попадает в кольцо, мяч скатывается в ямку катапульты, сильный бот набирает больше слабого. */
import { describe, expect, it } from 'vitest';
import { Basket, CATS, floor, BALL_R } from '../src/games/basketball/logic';

describe('баскетбол', () => {
  for (const team of [0, 1] as const)
    it(`бросок с нужной силой попадает (${team === 0 ? 'красные' : 'синие'})`, () => {
      const g = new Basket('duel', 99, 3, 1);
      g.x = CATS[team].x;
      g.y = floor(g.x) + BALL_R;
      g.vx = g.vy = 0;
      g.owner = team;
      g.launch(team, Basket.needed(team));
      for (let i = 0; i < 300 && g.score[team] === 0; i++) g.update(16);
      expect(g.score[team]).toBe(2);
    });
  it('мяч сверху скатывается в чью-нибудь катапульту', () => {
    const g = new Basket('duel', 99, 3, 2);
    for (let i = 0; i < 1000 && g.owner < 0; i++) g.update(16);
    expect(g.owner).toBeGreaterThanOrEqual(0);
  });
  it('сильный бот набирает больше слабого', () => {
    let a = 0;
    let b = 0;
    for (let seed = 1; seed <= 4; seed++) {
      const g = new Basket('duel', 999, 2, seed);
      for (let i = 0; i < 120 * 60 && !g.over; i++) {
        g.bot(0, 2, 1 / 60);
        g.bot(1, 0, 1 / 60);
        g.update(1000 / 60);
      }
      a += g.score[0];
      b += g.score[1];
    }
    expect(a).toBeGreaterThan(b);
  });
});
