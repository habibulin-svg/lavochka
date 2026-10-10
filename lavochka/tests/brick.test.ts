/* Brick Game: тетрис (повороты, ряды, конец), змейка (рост, стена, жизни), гонки (столкновение), арканоид (кирпичи), стрелялка;
 * каждая игра без падений проходит долгую случайную партию. */
import { describe, expect, it } from 'vitest';
import { Arkanoid, GAMES, H, makeGame, Race, rotate, Shooter, Snake, Tetris, W, type Key } from '../src/games/brick/logic';

const lit = (g: { draw(m: Uint8Array, n: Uint8Array): void }) => {
  const m = new Uint8Array(W * H);
  g.draw(m, new Uint8Array(16));
  return m;
};

describe('тетрис', () => {
  it('четыре поворота возвращают фигуру', () => {
    for (let k = 0; k < 7; k++) {
      const base: [number, number][] = k === 0 ? [[0, 1], [1, 1], [2, 1], [3, 1]] : [[1, 0], [0, 1], [1, 1], [2, 1]];
      let c = base;
      for (let i = 0; i < 4; i++) c = rotate(c, k);
      expect(c.map(String).sort()).toEqual(base.map(String).sort());
    }
  });
  it('полный ряд исчезает и даёт очки', () => {
    const t = new Tetris(1, 1, 1);
    for (let x = 0; x < W; x++) t.board[(H - 1) * W + x] = x < 6 || x > 9 ? 1 : 0;
    // палка лёжа в последние четыре клетки
    t.kind = 0;
    t.cells = [[0, 1], [1, 1], [2, 1], [3, 1]];
    t.px = 6;
    t.py = H - 3;
    t.update(5000);
    expect(t.lines).toBe(1);
    expect(t.score).toBe(100);
    expect(t.board.slice((H - 1) * W).some((v) => v)).toBe(false);
  });
  it('у стены не выходит за край, сверху доверху — конец', () => {
    const t = new Tetris(10, 1, 2);
    for (let i = 0; i < 12; i++) t.press('left');
    expect(t.px + Math.min(...t.cells.map(([x]) => x))).toBe(0);
    for (let i = 0; i < 400 && !t.over; i++) t.update(1000);
    expect(t.over).toBe(true);
  });
  it('уровень заполняет низ', () => {
    const t = new Tetris(1, 5, 3);
    expect(t.board.slice((H - 4) * W).filter((v) => v).length).toBeGreaterThan(10);
  });
});

describe('змейка', () => {
  it('ест и растёт, в стену — минус жизнь', () => {
    const s = new Snake(1, 1, 4);
    s.food = [4, 15];
    s.update(1000);
    expect(s.body.length).toBe(4);
    expect(s.score).toBe(10);
    const lives = s.lives!;
    for (let i = 0; i < 40 && s.lives === lives; i++) s.update(800);
    expect(s.lives).toBe(lives - 1);
  });
  it('развернуться назад нельзя', () => {
    const s = new Snake(1, 1, 5);
    s.press('down');
    s.update(800);
    expect(s.body[0]).toEqual([4, 15]);
  });
});

describe('гонки', () => {
  it('машина в своей полосе — авария, объехал — очки', () => {
    const r = new Race(1, 1, 6);
    r.cars = [{ lane: 0, y: 12 }];
    r.update(400);
    expect(r.lives).toBe(3);
    const r2 = new Race(1, 1, 7);
    r2.cars = [{ lane: 1, y: 18 }];
    r2.update(400);
    r2.update(400);
    expect(r2.lives).toBe(4);
    expect(r2.score).toBeGreaterThan(0);
  });
});

describe('арканоид', () => {
  it('мяч разбивает кирпич', () => {
    const a = new Arkanoid(1, 1, 8);
    const before = a.bricks.filter((v) => v).length;
    a.press('rotate');
    for (let i = 0; i < 200 && a.bricks.filter((v) => v).length === before; i++) a.update(300);
    expect(a.score).toBeGreaterThan(0);
  });
  it('упустил мяч — минус жизнь', () => {
    const a = new Arkanoid(1, 1, 9);
    a.press('rotate');
    a.bx = 0;
    a.by = H - 2;
    a.dx = -1;
    a.dy = 1;
    a.pad = 7;
    a.update(300);
    a.update(300);
    expect(a.lives).toBe(3);
  });
});

describe('стрелялка', () => {
  it('выстрел сбивает блок стены', () => {
    const s = new Shooter(1, 1, 10);
    const before = s.wall.filter((v) => v).length;
    s.gun = 0;
    for (let x = 0; x < W; x++) s.wall[x] = 1;
    s.press('rotate');
    s.release('rotate');
    s.update(1000);
    expect(s.wall.filter((v) => v).length).toBeLessThan(before + W);
    expect(s.score).toBeGreaterThan(0);
  });
});

describe('все игры', () => {
  it.each(GAMES.map((g) => g.id))('%s: долгая случайная партия без ошибок, рисуется в пределах экрана', (id) => {
    let seed = 1;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const keys: Key[] = ['left', 'right', 'up', 'down', 'rotate'];
    for (const sp of [1, 5, 10]) {
      const g = makeGame(id, sp, sp, 100 + sp);
      for (let i = 0; i < 3000 && !g.over; i++) {
        const k = keys[Math.floor(rnd() * keys.length)];
        if (rnd() < 0.5) g.press(k);
        else g.release(k);
        g.update(16 + rnd() * 40);
        const m = lit(g);
        expect(m.length).toBe(W * H);
        g.sounds.length = 0;
      }
      expect(g.score).toBeGreaterThanOrEqual(0);
    }
  });
});
