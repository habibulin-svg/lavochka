/* «Магистраль»: правила по руководству — оплата 15/30 коп., сеанс 2 мин, финиш раньше контрольного → ПРИЗ → призовая игра,
 * столкновение — взрыв и автоматическое возобновление, число машин автомата на каждой трассе. */
import { describe, expect, it } from 'vitest';
import {
  CAR_H, chooseTrack, coin, CRASH_TIME, FINISH, greenIndicator, newMag, OVER_TIME, SESSION, start, step, TRACKS, V_MAX,
  type MagEvent, type MagState,
} from '../src/games/avtomaty/magistral/logic';

const DT = 1 / 30;
function run(s: MagState, sec: number, each?: () => void, ev: MagEvent[] = []) {
  for (let t = 0; t < sec; t += DT) {
    each?.();
    step(s, DT, ev);
  }
  return ev;
}

describe('Магистраль', () => {
  it('15 коп. — один игрок, 30 — двое; во время игры монета уходит в возврат', () => {
    const s = newMag(1);
    expect(start(s)).toBe(false);
    coin(s);
    coin(s);
    expect(coin(s)).toBe(false); // больше двух не берёт
    chooseTrack(s, 'race');
    expect(start(s)).toBe(true);
    expect(s.players[0].on && s.players[1].on).toBe(true);
    const ev: MagEvent[] = [];
    expect(coin(s, ev)).toBe(false);
    expect(ev).toContain('rejected');
  });

  it('машин автомата на трассе: учебная — 3, ночная — 2', () => {
    for (const [t, n] of [['learn', 3], ['night', 2], ['ice', 3]] as const) {
      const s = newMag(7);
      coin(s);
      chooseTrack(s, t);
      start(s);
      run(s, 5, () => (s.players[0].pedal = 0.6));
      expect(s.players[0].cars.length).toBe(n);
    }
  });

  it('столкновение — взрыв, машина стоит, потом движение возобновляется само', () => {
    const s = newMag(3);
    coin(s);
    start(s);
    const p = s.players[0];
    p.cars = [{ x: p.x, y: p.y - CAR_H * 0.5, w: 44, vy: 0, vx: 0, kind: 'car' }];
    const ev = run(s, 0.1, () => (p.pedal = 1));
    expect(ev).toContain('crash');
    expect(p.boom).not.toBeNull();
    expect(p.speed).toBe(0);
    run(s, CRASH_TIME + 0.2, () => (p.pedal = 1));
    expect(p.crash).toBe(0);
    expect(p.speed).toBeGreaterThan(0);
  });

  it('без столкновений на полной скорости — финиш раньше контрольного, ПРИЗ, призовая игра, всего 4 минуты', () => {
    expect(FINISH / V_MAX).toBeLessThan(SESSION);
    const s = newMag(5);
    coin(s);
    chooseTrack(s, 'learn');
    start(s);
    const p = s.players[0];
    const ev: MagEvent[] = [];
    // дорога пустая — машины убираем
    run(s, SESSION - 1, () => {
      p.pedal = 1;
      p.cars = [];
    }, ev);
    expect(ev).toContain('finish');
    expect(ev).toContain('prize');
    expect(greenIndicator(s)).toBeLessThan(1);
    run(s, 2, () => (p.cars = []), ev);
    expect(s.prizeRound).toBe(true);
    expect(s.mode).toBe('play');
    run(s, SESSION + 1, () => (p.cars = []), ev);
    expect(s.mode).toBe('over');
    run(s, OVER_TIME + 0.2, undefined, ev);
    expect(s.mode).toBe('attract');
  });

  it('медленная езда — контрольный индикатор раньше, приза нет', () => {
    const s = newMag(9);
    coin(s);
    chooseTrack(s, TRACKS[4].id);
    start(s);
    const ev = run(s, SESSION + 0.5, () => (s.players[0].pedal = 0.4));
    expect(ev).not.toContain('finish');
    expect(s.mode).toBe('over');
  });
});
