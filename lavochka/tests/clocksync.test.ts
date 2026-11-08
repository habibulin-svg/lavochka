import { describe, expect, it } from 'vitest';
import { ClockSync, clampPress, pressWindow, WIN_MAX, WIN_MIN } from '../src/core/clocksync';
import { SeededRng } from '../src/core/rng';

/** Клиент с часами, сдвинутыми на skew, и связью: туда up мс, обратно down мс (+ случайная очередь до jit мс). */
function client(skew: number, up: number, down: number, jit: number, seed = 1) {
  const rng = new SeededRng(seed);
  const clk = new ClockSync();
  let t = 1_000_000;
  const q = () => rng.next() * jit;
  for (let i = 0; i < 12; i++) {
    t += 2000;
    const ts = t; // комната отправила ping
    const arrive = ts + down + q(); // дошёл до клиента
    const ct = arrive + skew; // часы клиента
    const rx = arrive + up + q(); // pong дошёл до комнаты
    clk.add(ts, ct, rx);
  }
  /** Нажатие в истинный момент T (часы комнаты): что пришлёт клиент и когда оно дойдёт. */
  const press = (T: number) => ({ at: T + skew, rx: T + up + q() });
  return { clk, press };
}

describe('синхронизация часов («кнопка»)', () => {
  it('смещение часов находится точно, несмотря на очереди', () => {
    const { clk } = client(-73_000, 40, 40, 60);
    expect(Math.abs(clk.off - -73_000)).toBeLessThan(25);
    expect(clk.rtt).toBeGreaterThanOrEqual(80);
  });

  it('кто нажал раньше на деле — тот и первый, даже с медленной связью', () => {
    const fast = client(5_000, 15, 15, 10, 2); // соседний двор по оптике
    const slow = client(-2_000, 220, 220, 40, 3); // мобильный интернет
    let ok = 0;
    for (let k = 0; k < 50; k++) {
      const T = 2_000_000 + k * 10_000;
      // медленный нажал на 40 мс раньше, но его сообщение приходит на ~200 мс позже
      const s = slow.press(T);
      const f = fast.press(T + 40);
      expect(s.rx).toBeGreaterThan(f.rx);
      const ts = slow.clk.toRoom(s.at, s.rx);
      const tf = fast.clk.toRoom(f.at, f.rx);
      if (ts < tf) ok++;
    }
    expect(ok).toBeGreaterThanOrEqual(48);
  });

  it('без поправки (по приходу) победил бы быстрый — поправка и правда нужна', () => {
    const fast = client(0, 15, 15, 0, 4);
    const slow = client(0, 220, 220, 0, 5);
    const s = slow.press(3_000_000);
    const f = fast.press(3_000_040);
    expect(f.rx).toBeLessThan(s.rx);
    expect(slow.clk.toRoom(s.at, s.rx)).toBeLessThan(fast.clk.toRoom(f.at, f.rx));
  });

  it('подделка «я нажал на секунду раньше» выигрывает не больше погрешности связи', () => {
    const c = client(0, 30, 30, 10, 6);
    const rx = 4_000_000;
    const cheat = c.clk.toRoom(rx - 1000, rx);
    expect(rx - cheat).toBeLessThanOrEqual(c.clk.rtt + c.clk.jitter + 30);
    // и из будущего — не позже прихода
    expect(c.clk.toRoom(rx + 5000, rx)).toBe(rx);
  });

  it('окно ожидания — по самому медленному, в разумных пределах', () => {
    expect(pressWindow([])).toBe(WIN_MIN);
    expect(pressWindow([20, 30])).toBe(WIN_MIN);
    expect(pressWindow([20, 300])).toBe(300);
    expect(pressWindow([5000])).toBe(WIN_MAX);
    const slow = client(0, 220, 220, 40, 7);
    // нажатие медленного успевает дойти до конца окна, открытого быстрым
    expect(slow.clk.lag).toBeGreaterThan(220);
  });

  it('clampPress', () => {
    expect(clampPress(100, 200, 50)).toBe(150);
    expect(clampPress(180, 200, 50)).toBe(180);
    expect(clampPress(300, 200, 50)).toBe(200);
  });
});
