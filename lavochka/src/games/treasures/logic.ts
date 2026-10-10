/* «Клад» — «три в ряд» на 100 уровней, логика без DOM. Поле 8×8: сокровища семи видов, земля под фишками (собрал ряд на земле — расчистил),
 * камни (не двигаются, разбиваются взрывом рядом). Поменять соседние — если вышел ряд из 3+, ряды исчезают, сверху падают новые.
 * Четыре в ряд — «лопата» (чистит строку или столбец), пять — «самородок» (убирает все фишки одного вида), уголок/тройник — «динамит» (3×3).
 * Уровень: цель — очки за число ходов или расчистить всю землю («откопать клад»); параметры — от номера уровня (генератор с семенем). */

export const N = 8;
export type Special = 'none' | 'row' | 'col' | 'bomb' | 'nugget';

export interface Tile {
  kind: number;
  special: Special;
  id: number;
}

export interface Cell {
  tile: Tile | null;
  dirt: number;
  stone: boolean;
}

export interface LevelSpec {
  n: number;
  kinds: number;
  moves: number;
  goal: 'score' | 'dirt';
  target: number;
  dirt: number;
  stones: number;
  stars: [number, number, number];
}

export function levelSpec(n: number): LevelSpec {
  const kinds = n < 15 ? 5 : n < 55 ? 6 : 7;
  const goal = n % 3 === 0 ? 'dirt' : 'score';
  const moves = Math.max(16, 30 - Math.floor(n / 8));
  const dirt = goal === 'dirt' ? Math.min(44, 8 + Math.floor(n * 0.45)) : n > 40 ? Math.floor((n - 40) / 6) : 0;
  const stones = n > 25 ? Math.min(8, 1 + Math.floor((n - 25) / 10)) : 0;
  const target = goal === 'score' ? 1200 + n * 140 : 0;
  const base = goal === 'score' ? target : 600 + n * 60;
  return { n, kinds, moves, goal, target, dirt, stones, stars: [base, Math.round(base * 1.5), Math.round(base * 2.2)] };
}

export interface Step {
  /** Что исчезло (клетки) и какие спецфишки сработали. */
  removed: [number, number][];
  /** Новые спецфишки (появились на месте ряда). */
  made: { x: number; y: number; special: Special; id?: number }[];
  /** Падение: id фишки → откуда (y, может быть отрицательным для новых) и куда. */
  falls: { id: number; x: number; from: number; to: number }[];
  /** Фишки, созданные на этом шаге (новые сверху и спецфишки), — для анимации. */
  added: Tile[];
  points: number;
}

function rng(seed: number) {
  let s = seed | 0 || 1;
  return () => {
    s = (s * 16807) % 2147483647;
    return s / 2147483647;
  };
}

export class Board {
  cells: Cell[][] = [];
  score = 0;
  moves: number;
  dirtLeft = 0;
  private nextId = 1;
  private rnd: () => number;

  constructor(
    readonly spec: LevelSpec,
    seed = spec.n * 7919 + 13
  ) {
    this.rnd = rng(seed);
    this.moves = spec.moves;
    for (let y = 0; y < N; y++) {
      const row: Cell[] = [];
      for (let x = 0; x < N; x++) row.push({ tile: null, dirt: 0, stone: false });
      this.cells.push(row);
    }
    // земля — пятнами снизу, камни — случайно
    const free = () => {
      for (let k = 0; k < 500; k++) {
        const x = Math.floor(this.rnd() * N);
        const y = Math.floor(N / 3 + this.rnd() * (N - N / 3));
        if (!this.cells[y][x].dirt && !this.cells[y][x].stone) return [x, y];
      }
      return null;
    };
    for (let i = 0; i < spec.dirt; i++) {
      const p = free();
      if (p) this.cells[p[1]][p[0]].dirt = spec.n > 60 && this.rnd() < 0.3 ? 2 : 1;
    }
    for (let i = 0; i < spec.stones; i++) {
      const p = free();
      if (p) this.cells[p[1]][p[0]].stone = true;
    }
    this.dirtLeft = this.cells.flat().reduce((a, c) => a + c.dirt, 0);
    // фишки без готовых рядов и с хотя бы одним ходом
    for (let tries = 0; tries < 50; tries++) {
      for (let y = 0; y < N; y++)
        for (let x = 0; x < N; x++) {
          const c = this.cells[y][x];
          if (c.stone) continue;
          let k: number;
          do k = Math.floor(this.rnd() * spec.kinds);
          while ((x >= 2 && this.kindAt(x - 1, y) === k && this.kindAt(x - 2, y) === k) || (y >= 2 && this.kindAt(x, y - 1) === k && this.kindAt(x, y - 2) === k));
          c.tile = this.newTile(k);
        }
      if (this.hasMove()) break;
    }
  }

  private newTile(kind: number, special: Special = 'none'): Tile {
    return { kind, special, id: this.nextId++ };
  }

  kindAt(x: number, y: number): number {
    const t = this.cells[y]?.[x]?.tile;
    return t ? t.kind : -1;
  }

  get won(): boolean {
    return this.spec.goal === 'dirt' ? this.dirtLeft === 0 : this.score >= this.spec.target;
  }

  get lost(): boolean {
    return !this.won && this.moves <= 0;
  }

  stars(): number {
    return this.spec.stars.filter((s) => this.score >= s).length;
  }

  /** Найти ряды 3+ (по строкам и столбцам). */
  private matches(): { cells: [number, number][]; dir: 'h' | 'v' }[] {
    const out: { cells: [number, number][]; dir: 'h' | 'v' }[] = [];
    for (let y = 0; y < N; y++) {
      let x = 0;
      while (x < N) {
        const k = this.kindAt(x, y);
        let e = x + 1;
        while (k >= 0 && e < N && this.kindAt(e, y) === k) e++;
        if (k >= 0 && e - x >= 3) out.push({ cells: Array.from({ length: e - x }, (_, i) => [x + i, y]), dir: 'h' });
        x = e;
      }
    }
    for (let x = 0; x < N; x++) {
      let y = 0;
      while (y < N) {
        const k = this.kindAt(x, y);
        let e = y + 1;
        while (k >= 0 && e < N && this.kindAt(x, e) === k) e++;
        if (k >= 0 && e - y >= 3) out.push({ cells: Array.from({ length: e - y }, (_, i) => [x, y + i]), dir: 'v' });
        y = e;
      }
    }
    return out;
  }

  canSwap(ax: number, ay: number, bx: number, by: number): boolean {
    if (Math.abs(ax - bx) + Math.abs(ay - by) !== 1) return false;
    const a = this.cells[ay]?.[ax];
    const b = this.cells[by]?.[bx];
    if (!a?.tile || !b?.tile) return false;
    // две спецфишки или самородок — всегда можно
    if (a.tile.special === 'nugget' || b.tile.special === 'nugget') return true;
    [a.tile, b.tile] = [b.tile, a.tile];
    const ok = this.matches().length > 0;
    [a.tile, b.tile] = [b.tile, a.tile];
    return ok;
  }

  hasMove(): boolean {
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        if (x + 1 < N && this.canSwap(x, y, x + 1, y)) return true;
        if (y + 1 < N && this.canSwap(x, y, x, y + 1)) return true;
      }
    return false;
  }

  /** Ход: поменять и разрешить каскад. null — ход невозможен. */
  swap(ax: number, ay: number, bx: number, by: number): Step[] | null {
    if (this.moves <= 0 || this.won || !this.canSwap(ax, ay, bx, by)) return null;
    const a = this.cells[ay][ax];
    const b = this.cells[by][bx];
    [a.tile, b.tile] = [b.tile, a.tile];
    this.moves--;
    const steps: Step[] = [];
    // самородок: убирает все фишки вида того, с кем поменялся
    const nug = a.tile!.special === 'nugget' ? [ax, ay, b.tile!.kind] : b.tile!.special === 'nugget' ? [bx, by, a.tile!.kind] : null;
    if (nug) {
      const rm: [number, number][] = [[nug[0], nug[1]]];
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) if (this.kindAt(x, y) === nug[2]) rm.push([x, y]);
      steps.push(this.resolve(rm, [], 1));
    }
    let chain = 1;
    for (let guard = 0; guard < 40; guard++) {
      const ms = this.matches();
      if (!ms.length) break;
      const rm: [number, number][] = [];
      const made: Step['made'] = [];
      // пересечения рядов — динамит
      const count = new Map<string, number>();
      for (const m of ms) for (const [x, y] of m.cells) count.set(`${x},${y}`, (count.get(`${x},${y}`) ?? 0) + 1);
      for (const m of ms) {
        rm.push(...m.cells);
        const cross = m.cells.find(([x, y]) => (count.get(`${x},${y}`) ?? 0) > 1);
        // где появится спецфишка: на месте хода, если он в ряду, иначе посередине
        const at = m.cells.find(([x, y]) => (x === ax && y === ay) || (x === bx && y === by)) ?? m.cells[Math.floor(m.cells.length / 2)];
        if (cross && !made.some((q) => q.x === cross[0] && q.y === cross[1])) made.push({ x: cross[0], y: cross[1], special: 'bomb' });
        else if (m.cells.length >= 5) made.push({ x: at[0], y: at[1], special: 'nugget' });
        else if (m.cells.length === 4) made.push({ x: at[0], y: at[1], special: m.dir === 'h' ? 'col' : 'row' });
      }
      steps.push(this.resolve(rm, made, chain));
      chain++;
    }
    // ходов не осталось — перемешать
    if (!this.hasMove() && !this.won) this.shuffle();
    return steps;
  }

  /** Убрать клетки (со срабатыванием спецфишек), поставить новые спецфишки, уронить, досыпать. */
  private resolve(rm0: [number, number][], made: Step['made'], chain: number): Step {
    const kill = new Set<string>();
    const queue = [...rm0];
    while (queue.length) {
      const [x, y] = queue.pop()!;
      const key = `${x},${y}`;
      if (kill.has(key)) continue;
      const c = this.cells[y]?.[x];
      if (!c) continue;
      kill.add(key);
      const t = c.tile;
      if (!t) continue;
      if (made.some((m) => m.x === x && m.y === y) && t.special === 'none') continue;
      if (t.special === 'row') for (let i = 0; i < N; i++) queue.push([i, y]);
      else if (t.special === 'col') for (let i = 0; i < N; i++) queue.push([x, i]);
      else if (t.special === 'bomb') for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) queue.push([x + dx, y + dy]);
      else if (t.special === 'nugget') for (let yy = 0; yy < N; yy++) for (let xx = 0; xx < N; xx++) if (this.kindAt(xx, yy) === t.kind) queue.push([xx, yy]);
    }
    const removed: [number, number][] = [];
    const added: Tile[] = [];
    let points = 0;
    for (const key of kill) {
      const [x, y] = key.split(',').map(Number);
      const c = this.cells[y][x];
      const keep = made.find((m) => m.x === x && m.y === y);
      if (c.stone) {
        // камень достаёт только взрыв спецфишки — и разбивает
        c.stone = false;
        removed.push([x, y]);
        points += 30;
        continue;
      }
      if (!c.tile) continue;
      if (c.dirt) {
        c.dirt--;
        this.dirtLeft--;
        points += 20;
      }
      if (keep) {
        c.tile = this.newTile(c.tile.kind, keep.special);
        keep.id = c.tile.id;
        added.push(c.tile);
        removed.push([x, y]);
        points += 60;
        continue;
      }
      removed.push([x, y]);
      c.tile = null;
      points += 10;
    }
    points *= chain;
    this.score += points;
    // падение
    const falls: Step['falls'] = [];
    for (let x = 0; x < N; x++) {
      // по столбцу снизу вверх, камни — опора: падаем сегментами между камнями
      let write = N - 1;
      for (let y = N - 1; y >= -1; y--) {
        if (y === -1 || this.cells[y][x].stone) {
          // досыпать сверху сегмент [y+1 .. write]
          let k = 0;
          for (let wy = write; wy > y; wy--) {
            if (this.cells[wy][x].tile) continue;
            const t = this.newTile(Math.floor(this.rnd() * this.spec.kinds));
            added.push(t);
            this.cells[wy][x].tile = t;
            k++;
            falls.push({ id: t.id, x, from: (y === -1 ? -1 : y) - k + 1 - 1, to: wy });
          }
          write = y - 1;
          continue;
        }
        const t = this.cells[y][x].tile;
        if (!t) continue;
        if (write !== y) {
          this.cells[write][x].tile = t;
          this.cells[y][x].tile = null;
          falls.push({ id: t.id, x, from: y, to: write });
        }
        write--;
      }
    }
    return { removed, made, falls, added, points };
  }

  private shuffle() {
    const tiles = this.cells.flat().filter((c) => c.tile).map((c) => c.tile!);
    for (let tries = 0; tries < 30; tries++) {
      for (let i = tiles.length - 1; i > 0; i--) {
        const j = Math.floor(this.rnd() * (i + 1));
        [tiles[i], tiles[j]] = [tiles[j], tiles[i]];
      }
      let k = 0;
      for (const row of this.cells) for (const c of row) if (c.tile) c.tile = tiles[k++];
      if (!this.matches().length && this.hasMove()) return;
    }
  }

  /** Подсказка: какой ход есть. */
  hint(): [number, number, number, number] | null {
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        if (x + 1 < N && this.canSwap(x, y, x + 1, y)) return [x, y, x + 1, y];
        if (y + 1 < N && this.canSwap(x, y, x, y + 1)) return [x, y, x, y + 1];
      }
    return null;
  }
}
