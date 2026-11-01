import { describe, expect, it } from 'vitest';
import { Mask } from '../../src/gops/sim/mask';

/** Число земли в круге — по определению: (x−cx)² + (y−cy)² ≤ r². */
function brute(m: Mask, cx: number, cy: number, r: number): number {
  let n = 0;
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r && m.solid(x, y)) n++;
  return n;
}

function ground(w = 200, h = 100, top = 60): Mask {
  const m = new Mask(w, h);
  m.fillRect(0, top, w, h - top);
  return m;
}

describe('gops/mask: битмап ландшафта', () => {
  it('создание, solid/set, за краем — воздух', () => {
    const m = new Mask(10, 8);
    expect(m.w).toBe(10);
    expect(m.h).toBe(8);
    expect(m.d.length).toBe(80);
    expect(m.solid(3, 3)).toBe(false);
    m.set(3, 3, 1);
    expect(m.solid(3, 3)).toBe(true);
    expect(m.d[3 * 10 + 3]).toBe(1);
    m.set(-1, 0, 1); // вне карты — молча игнорируется
    m.set(10, 0, 1);
    expect(m.solid(-1, 0) || m.solid(10, 0) || m.solid(0, -1) || m.solid(0, 8)).toBe(false);
    const copy = new Mask(10, 8, m.d);
    expect(copy.d).not.toBe(m.d); // данные копируются
    expect(copy.solid(3, 3)).toBe(true);
  });

  it('fillRect обрезается по краям', () => {
    const m = new Mask(20, 20);
    m.fillRect(-5, -5, 10, 10);
    expect(m.count()).toBe(25);
    m.fillRect(15, 15, 100, 100);
    expect(m.count()).toBe(50);
  });

  it('fillCircle / carveCircle: ровно пиксели круга, возврат — сколько изменилось', () => {
    const m = new Mask(100, 100);
    const added = m.fillCircle(50, 50, 10);
    expect(added).toBe(m.count());
    expect(added).toBe(317); // число целых точек в круге r=10
    expect(m.fillCircle(50, 50, 10)).toBe(0);
    const g = ground();
    const before = brute(g, 100, 60, 20);
    expect(g.carveCircle(100, 60, 20)).toBe(before);
    expect(brute(g, 100, 60, 20)).toBe(0);
    expect(g.solid(100, 81)).toBe(true);
    expect(g.solid(100, 80)).toBe(false);
    // круг у края карты
    const e = new Mask(30, 30);
    e.fillRect(0, 0, 30, 30);
    expect(e.carveCircle(0, 0, 5)).toBe(brute(new Mask(30, 30, e.d.map(() => 1)), 0, 0, 5));
  });

  it('carveSegment: тоннель — капсула от точки до точки', () => {
    const g = ground(200, 100, 0);
    const n = g.carveSegment(20, 50, 120, 50, 6);
    expect(n).toBeGreaterThan(100 * 13 - 10);
    for (let x = 20; x <= 120; x += 10) {
      expect(g.solid(x, 50)).toBe(false);
      expect(g.solid(x, 56)).toBe(false);
      expect(g.solid(x, 57)).toBe(true);
    }
    expect(g.solid(14, 50)).toBe(false); // полукруг на конце
    expect(g.solid(13, 50)).toBe(true);
    const d = ground(200, 100, 0);
    d.carveSegment(10, 10, 90, 90, 3); // диагональ
    for (let t = 10; t <= 90; t += 5) expect(d.solid(t, t)).toBe(false);
    expect(d.solid(10, 30)).toBe(true);
  });

  it('countCircle и hitsCircle', () => {
    const g = ground();
    expect(g.countCircle(100, 30, 9)).toBe(0);
    expect(g.hitsCircle(100, 30, 9)).toBe(false);
    expect(g.countCircle(100, 55, 9)).toBe(brute(g, 100, 55, 9));
    expect(g.hitsCircle(100, 51, 9)).toBe(true); // нижняя точка круга — y=60
    expect(g.hitsCircle(100, 50, 9)).toBe(false);
  });

  it('normal: от земли к центру круга', () => {
    const g = ground();
    const [nx, ny] = g.normal(100, 55, 9);
    expect(ny).toBeLessThan(0); // земля снизу → нормаль вверх
    expect(Math.abs(nx)).toBeLessThan(Math.abs(ny) / 10);
    const wall = new Mask(100, 100);
    wall.fillRect(60, 0, 40, 100);
    const [wx, wy] = wall.normal(55, 50, 9);
    expect(wx).toBeLessThan(0);
    expect(Math.abs(wy)).toBeLessThan(Math.abs(wx) / 10);
    expect(new Mask(50, 50).normal(25, 25, 5)).toEqual([0, 0]);
    for (const v of g.normal(100, 55, 9)) expect(Number.isInteger(v)).toBe(true);
  });

  it('raycast: первый твёрдый пиксель по линии или null', () => {
    const g = ground();
    expect(g.raycast(100, 0, 100, 99)).toEqual([100, 60]);
    expect(g.raycast(10, 10, 190, 10)).toBeNull();
    expect(g.raycast(0, 0, 80, 80)).toEqual([60, 60]);
    expect(g.raycast(100, 70, 100, 90)).toEqual([100, 70]); // старт внутри земли
    const w = new Mask(100, 10);
    w.set(50, 5, 1);
    expect(w.raycast(90, 5, 0, 5)).toEqual([50, 5]); // справа налево
  });

  it('surfaceBelow: первая земля в столбце от y вниз, иначе −1', () => {
    const g = ground();
    expect(g.surfaceBelow(10, 0)).toBe(60);
    expect(g.surfaceBelow(10, 65)).toBe(65);
    expect(g.surfaceBelow(-5, 0)).toBe(-1);
    expect(new Mask(10, 10).surfaceBelow(5, 0)).toBe(-1);
  });

  it('hash: зависит от содержимого, одинаков для одинаковых масок', () => {
    const a = ground(), b = ground();
    expect(a.hash()).toBe(b.hash());
    b.set(5, 5, 1);
    expect(a.hash()).not.toBe(b.hash());
    expect(Number.isInteger(a.hash()) && a.hash() >= 0).toBe(true);
  });

  it('скорость: 1000 взрывов r=30 на карте 1920×704 — меньше 300 мс', () => {
    const m = new Mask(1920, 704);
    m.fillRect(0, 300, 1920, 404);
    const t = performance.now();
    for (let i = 0; i < 1000; i++) m.carveCircle((i * 97) % 1920, 300 + ((i * 53) % 400), 30);
    expect(performance.now() - t).toBeLessThan(300);
  });
});
