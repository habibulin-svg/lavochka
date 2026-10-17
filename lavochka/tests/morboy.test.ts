/* «Морской бой»: логика по техописанию — 10 пусков, попадание с упреждением, реверс, призовая игра, конец. */
import { describe, expect, it } from 'vitest';
import {
  coin, fire, LAUNCHES, newSea, PRIZE_LAUNCHES, ships, SHIP_V, step, TRACK_TIME, trackOfAim, trackX, TRACKS, turn,
  type SeaEvent, type SeaState,
} from '../src/games/avtomaty/morboy/logic';

const DT = 1 / 60;
const run = (s: SeaState, sec: number, ev: SeaEvent[] = []) => {
  for (let t = 0; t < sec; t += DT) step(s, DT, ev);
  return ev;
};
/** Ждём, пока какой-нибудь корабль окажется так, что торпеда по трассе k застанет его в точке трассы. */
function aimAndFire(s: SeaState, maxSec = 40): boolean {
  for (let t = 0; t < maxSec; t += DT) {
    for (const sh of ships(s)) {
      const at = sh.x + s.dir * SHIP_V * TRACK_TIME;
      for (let k = 0; k < TRACKS; k++) {
        if (Math.abs(at - trackX(k)) < 0.3 && s.ready) {
          turn(s, trackX(k));
          if (trackOfAim(s.aim) === k && fire(s)) return true;
        }
      }
    }
    step(s, DT);
  }
  return false;
}

describe('Морской бой', () => {
  it('упреждение — 6…10 см, как в техописании', () => {
    const lead = SHIP_V * TRACK_TIME;
    expect(lead).toBeGreaterThanOrEqual(6);
    expect(lead).toBeLessThanOrEqual(10);
  });

  it('без монеты не стреляет; монета во время игры уходит в возврат', () => {
    const s = newSea();
    expect(fire(s)).toBe(false);
    expect(coin(s)).toBe(true);
    const ev: SeaEvent[] = [];
    expect(coin(s, ev)).toBe(false);
    expect(ev).toContain('rejected');
  });

  it('пуск — только при горящем «ПУСК»; десять промахов — игра окончена, корабли стоят', () => {
    const s = newSea();
    coin(s);
    turn(s, -19); // на крайнюю трассу, куда корабль в первые секунды не доходит
    expect(fire(s)).toBe(true);
    expect(fire(s)).toBe(false); // торпеда ещё идёт
    const ev: SeaEvent[] = [];
    for (let i = 1; i < LAUNCHES; i++) {
      run(s, TRACK_TIME + 2, ev);
      fire(s);
    }
    run(s, 4, ev);
    expect(s.launches).toBe(LAUNCHES);
    expect(s.playing).toBe(false);
    expect(ev).toContain('over');
    const chain = s.chain;
    run(s, 2);
    expect(s.chain).toBe(chain);
  });

  it('с упреждением — попадание, «ТОРПЕДИРОВАНО», реверс; десять из десяти — три призовых пуска', () => {
    const s = newSea();
    coin(s);
    const ev: SeaEvent[] = [];
    let dir = s.dir;
    for (let i = 0; i < LAUNCHES; i++) {
      expect(aimAndFire(s)).toBe(true);
      run(s, TRACK_TIME + 0.05, ev);
      expect(s.hits).toBe(i + 1);
      expect(s.torpedoed).toBe(true);
      expect(s.dir).toBe(-dir); // цели развернулись
      dir = s.dir;
      run(s, 2, ev); // затемнение
    }
    expect(ev).toContain('prize');
    expect(s.prize).toBe(true);
    expect(s.playing).toBe(true);
    for (let i = 0; i < PRIZE_LAUNCHES; i++) {
      expect(aimAndFire(s)).toBe(true);
      run(s, TRACK_TIME + 2.2, ev);
    }
    expect(s.launches).toBe(LAUNCHES + PRIZE_LAUNCHES);
    expect(s.playing).toBe(false);
    expect(s.litHit).toBe(3); // 11–13-е попадания — номера 1…3
  });
});
