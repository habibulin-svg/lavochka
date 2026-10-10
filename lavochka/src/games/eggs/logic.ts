/* «Яйца динозавров» — стрелялка «лопни три одинаковых», логика без DOM. Сетка — шестиугольная: 8 яиц в ряду, нечётные ряды сдвинуты на пол-яйца.
 * Динозаврик внизу стреляет яйцом под углом, яйцо отскакивает от стенок и прилипает к сетке. Три и больше одного цвета, связанных между собой, лопаются;
 * яйца, что больше ничем не держатся за потолок, падают (очки вдвое). Каждые K выстрелов потолок опускается на ряд. Яйцо ниже черты — проигрыш,
 * поле чистое — победа. Сто уровней: узор, число цветов и рядов, частота опускания — по номеру. Единицы — диаметры яйца (поле 8,5 × 13). */

export const COLS = 8;
export const ROWS = 13;
/** Расстояние между рядами (в диаметрах). */
export const ROW_H = 0.866;
export const FIELD_W = COLS + 0.5;
/** Черта: яйцо в этом ряду (с учётом опускания) — проигрыш. */
export const DEAD_ROW = 11;
/** Где пушка (центр вылета). */
export const SHOOTER_Y = ROWS * ROW_H + 0.9;

export type Grid = (number | null)[][];

export interface LevelSpec {
  n: number;
  colors: number;
  rows: number;
  /** Узор: 0 — сплошь, 1 — пирамида, 2 — шахматка с дырами, 3 — полосы. */
  pattern: number;
  dropEvery: number;
}

export function levelSpec(n: number): LevelSpec {
  return {
    n,
    colors: n < 8 ? 3 : n < 25 ? 4 : n < 60 ? 5 : 6,
    rows: Math.min(8, 4 + Math.floor(n / 12)),
    pattern: n % 4,
    dropEvery: Math.max(5, 10 - Math.floor(n / 15)),
  };
}

const odd = (r: number, shift: number) => (r + shift) % 2 === 1;

export class Bubbles {
  readonly spec: LevelSpec;
  grid: Grid = [];
  /** Сдвиг чётности: после опускания потолка ряды меняют смещение. */
  shift = 0;
  /** Сколько раз опустился потолок. */
  drops = 0;
  shots = 0;
  score = 0;
  cur: number;
  next: number;
  won = false;
  lost = false;
  private seed: number;

  constructor(n: number, seed = n * 7907 + 3) {
    this.spec = levelSpec(n);
    this.seed = seed;
    for (let r = 0; r < ROWS; r++) this.grid.push(Array(COLS).fill(null));
    const sp = this.spec;
    for (let r = 0; r < sp.rows; r++)
      for (let c = 0; c < COLS; c++) {
        if (odd(r, 0) && c === COLS - 1) continue;
        let put = true;
        if (sp.pattern === 1) put = c >= Math.floor(r / 2) && c < COLS - Math.floor(r / 2) - (odd(r, 0) ? 1 : 0);
        if (sp.pattern === 2) put = (r + c) % 3 !== 0;
        const color = sp.pattern === 3 ? Math.floor(r / 2) % sp.colors : Math.floor(this.rnd() * sp.colors);
        if (put) this.grid[r][c] = color;
      }
    this.cur = this.pick();
    this.next = this.pick();
  }

  private rnd() {
    this.seed = (this.seed * 16807) % 2147483647;
    return this.seed / 2147483647;
  }

  /** Цвет для заряда — из тех, что на поле. */
  private pick(): number {
    const have = new Set<number>();
    for (const row of this.grid) for (const v of row) if (v != null) have.add(v);
    const list = [...have];
    return list.length ? list[Math.floor(this.rnd() * list.length)] : 0;
  }

  /** Центр ячейки (в диаметрах; y вниз от потолка). */
  center(r: number, c: number): [number, number] {
    return [c + 0.5 + (odd(r, this.shift) ? 0.5 : 0), (r + this.drops) * ROW_H + 0.5];
  }

  validCell(r: number, c: number) {
    return r >= 0 && r < ROWS && c >= 0 && c < COLS && !(odd(r, this.shift) && c === COLS - 1);
  }

  neighbors(r: number, c: number): [number, number][] {
    const o = odd(r, this.shift);
    const d = o
      ? [[-1, 0], [-1, 1], [0, -1], [0, 1], [1, 0], [1, 1]]
      : [[-1, -1], [-1, 0], [0, -1], [0, 1], [1, -1], [1, 0]];
    return d.map(([dr, dc]) => [r + dr, c + dc] as [number, number]).filter(([rr, cc]) => this.validCell(rr, cc));
  }

  /** Полёт яйца: шаги до прилипания. Возвращает путь (точки) и ячейку. */
  trace(angle: number): { path: [number, number][]; cell: [number, number] | null } {
    let x = FIELD_W / 2;
    let y = SHOOTER_Y;
    let dx = Math.cos(angle);
    let dy = Math.sin(angle);
    const path: [number, number][] = [[x, y]];
    const step = 0.05;
    for (let i = 0; i < 2000; i++) {
      x += dx * step;
      y += dy * step;
      if (x < 0.5) {
        x = 1 - x;
        dx = -dx;
        path.push([0.5, y]);
      }
      if (x > FIELD_W - 0.5) {
        x = 2 * (FIELD_W - 0.5) - x;
        dx = -dx;
        path.push([FIELD_W - 0.5, y]);
      }
      // потолок
      const top = this.drops * ROW_H + 0.5;
      let hit = y <= top;
      if (!hit)
        for (let r = 0; r < ROWS && !hit; r++)
          for (let c = 0; c < COLS; c++) {
            if (this.grid[r][c] == null) continue;
            const [cx, cy] = this.center(r, c);
            if ((cx - x) ** 2 + (cy - y) ** 2 < 0.8 * 0.8) {
              hit = true;
              break;
            }
          }
      if (hit) {
        path.push([x, y]);
        return { path, cell: this.snap(x, Math.max(y, top)) };
      }
      if (dy > -0.05 && i > 1000) break;
    }
    return { path, cell: null };
  }

  /** Ближайшая пустая ячейка к точке. */
  private snap(x: number, y: number): [number, number] | null {
    let best: [number, number] | null = null;
    let bd = Infinity;
    for (let r = 0; r < ROWS; r++)
      for (let c = 0; c < COLS; c++) {
        if (!this.validCell(r, c) || this.grid[r][c] != null) continue;
        // ячейка должна касаться потолка или соседа
        const attached = r === 0 || this.neighbors(r, c).some(([rr, cc]) => this.grid[rr][cc] != null);
        if (!attached && r !== 0) continue;
        const [cx, cy] = this.center(r, c);
        const d = (cx - x) ** 2 + (cy - y) ** 2;
        if (d < bd) {
          bd = d;
          best = [r, c];
        }
      }
    return best;
  }

  /** Выстрел под углом (рад, вверх — отрицательный y). Результат: лопнувшие и упавшие ячейки. */
  shoot(angle: number): { path: [number, number][]; cell: [number, number] | null; popped: [number, number, number][]; fell: [number, number, number][] } | null {
    if (this.won || this.lost) return null;
    const a = Math.max(-Math.PI + 0.12, Math.min(-0.12, angle));
    const { path, cell } = this.trace(a);
    const res = { path, cell, popped: [] as [number, number, number][], fell: [] as [number, number, number][] };
    const color = this.cur;
    this.cur = this.next;
    this.next = this.pick();
    this.shots++;
    if (cell) {
      const [r, c] = cell;
      this.grid[r][c] = color;
      // связные того же цвета
      const seen = new Set<string>([`${r},${c}`]);
      const q: [number, number][] = [[r, c]];
      while (q.length) {
        const [rr, cc] = q.pop()!;
        for (const [nr, nc] of this.neighbors(rr, cc)) {
          const k = `${nr},${nc}`;
          if (!seen.has(k) && this.grid[nr][nc] === color) {
            seen.add(k);
            q.push([nr, nc]);
          }
        }
      }
      if (seen.size >= 3) {
        for (const k of seen) {
          const [rr, cc] = k.split(',').map(Number);
          res.popped.push([rr, cc, color]);
          this.grid[rr][cc] = null;
        }
        this.score += seen.size * 10;
        // оторвавшиеся — падают
        const held = new Set<string>();
        const q2: [number, number][] = [];
        for (let cc = 0; cc < COLS; cc++) if (this.grid[0][cc] != null) {
          held.add(`0,${cc}`);
          q2.push([0, cc]);
        }
        while (q2.length) {
          const [rr, cc] = q2.pop()!;
          for (const [nr, nc] of this.neighbors(rr, cc)) {
            const k = `${nr},${nc}`;
            if (!held.has(k) && this.grid[nr][nc] != null) {
              held.add(k);
              q2.push([nr, nc]);
            }
          }
        }
        for (let rr = 0; rr < ROWS; rr++)
          for (let cc = 0; cc < COLS; cc++)
            if (this.grid[rr][cc] != null && !held.has(`${rr},${cc}`)) {
              res.fell.push([rr, cc, this.grid[rr][cc]!]);
              this.grid[rr][cc] = null;
            }
        this.score += res.fell.length * 20;
      }
    }
    // заряды — только существующие цвета
    const have = new Set(this.grid.flat().filter((v) => v != null));
    if (have.size && !have.has(this.cur)) this.cur = this.pick();
    if (have.size && !have.has(this.next)) this.next = this.pick();
    if (!have.size) {
      this.won = true;
      this.score += 500;
      return res;
    }
    // потолок опускается
    if (this.shots % this.spec.dropEvery === 0) this.drops++;
    if (this.grid.some((row, r) => r + this.drops >= DEAD_ROW && row.some((v) => v != null))) this.lost = true;
    return res;
  }

  /** Лучший угол для бота/подсказки: перебор углов, оценка — сколько лопнет (и упадёт). */
  bestAngle(): number {
    let best = -Math.PI / 2;
    let bv = -Infinity;
    for (let i = 0; i <= 120; i++) {
      const a = -Math.PI + 0.12 + (i / 120) * (Math.PI - 0.24);
      const { cell } = this.trace(a);
      if (!cell) continue;
      const [r, c] = cell;
      let same = 0;
      for (const [nr, nc] of this.neighbors(r, c)) if (this.grid[nr][nc] === this.cur) same++;
      const v = same * 3 - r * 0.1 + (same >= 2 ? 10 : 0);
      if (v > bv) {
        bv = v;
        best = a;
      }
    }
    return best;
  }
}
