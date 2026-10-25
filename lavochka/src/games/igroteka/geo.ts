/* «Наша игротека» — геометрия десяти полей издания. Без DOM.
 * Каждая точка (или клетка) — место для фишки: r, c — «условные» ряд и столбец (по ним считаются направления),
 * x, y — пиксели картинки поля 900 px (public/igroteka/<поле>.webp, координаты — tools/igroteka/cut.py → boards.json).
 * Связь — линия на поле между соседними точками: dr, dc — шаг в условных координатах (прыжок — два шага с одним и тем же
 * dr, dc подряд), alt — «вторая» линия: штриховая диагональ (лиса и гуси, мельница) или диагональ клеток. */
import boards from './boards.json';

export type BoardId = 'sheep' | 'tickle' | 'sidja' | 'fox' | 'leopards' | 'mill' | 'bolotudu' | 'alquerque' | 'hasami' | 'turk';

export interface Pt {
  r: number;
  c: number;
  x: number;
  y: number;
}

export interface Link {
  to: number;
  dr: number;
  dc: number;
  alt: boolean;
}

export interface Geo {
  id: BoardId;
  w: number;
  h: number;
  pts: Pt[];
  links: Link[][];
  /** Точка по условным координатам. */
  at(r: number, c: number): number;
  /** Сосед по связи с шагом (dr, dc), −1 — нет. */
  next(p: number, dr: number, dc: number): number;
  /** Шаг между соседними точками поля в пикселях — под размер фишки. */
  pitch: number;
}

type Raw = { w: number; h: number; pts: [number, number][] };
const RAW = boards as unknown as Record<BoardId, Raw>;

function make(id: BoardId, cells: [number, number, number][], pitch: number): { g: Geo; add: (a: number, b: number, alt?: boolean) => void } {
  const raw = RAW[id];
  const pts: Pt[] = cells.map(([r, c, k]) => ({ r, c, x: raw.pts[k][0], y: raw.pts[k][1] }));
  const links: Link[][] = pts.map(() => []);
  const idx = new Map<string, number>();
  pts.forEach((p, i) => idx.set(`${p.r},${p.c}`, i));
  const g: Geo = {
    id,
    w: raw.w,
    h: raw.h,
    pts,
    links,
    pitch,
    at: (r, c) => idx.get(`${r},${c}`) ?? -1,
    next(p, dr, dc) {
      for (const l of links[p]) if (l.dr === dr && l.dc === dc) return l.to;
      return -1;
    },
  };
  const add = (a: number, b: number, alt = false) => {
    if (a < 0 || b < 0) return;
    const dr = pts[b].r - pts[a].r;
    const dc = pts[b].c - pts[a].c;
    links[a].push({ to: b, dr, dc, alt });
    links[b].push({ to: a, dr: -dr, dc: -dc, alt });
  };
  return { g, add };
}

/** Поле клеток rows × cols: соседи по стороне и (alt) по углу. */
function cellBoard(id: BoardId, rows: number, cols: number): Geo {
  const cells: [number, number, number][] = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push([r, c, r * cols + c]);
  const raw = RAW[id];
  const { g, add } = make(id, cells, Math.abs(raw.pts[1][0] - raw.pts[0][0]));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const p = g.at(r, c);
      if (c + 1 < cols) add(p, g.at(r, c + 1));
      if (r + 1 < rows) add(p, g.at(r + 1, c));
      if (r + 1 < rows && c + 1 < cols) add(p, g.at(r + 1, c + 1), true);
      if (r + 1 < rows && c > 0) add(p, g.at(r + 1, c - 1), true);
    }
  return g;
}

/** Поле 5×5 «алькуерк»: стороны клеток и диагонали через точки с чётной суммой ряда и столбца. */
function alquerqueGrid(id: BoardId, cells: [number, number, number][], pitch: number) {
  const m = make(id, cells, pitch);
  const { g, add } = m;
  for (let r = 0; r < 5; r++)
    for (let c = 0; c < 5; c++) {
      const p = g.at(r, c);
      if (c < 4) add(p, g.at(r, c + 1));
      if (r < 4) add(p, g.at(r + 1, c));
      if ((r + c) % 2 === 0) {
        if (r < 4 && c < 4) add(p, g.at(r + 1, c + 1), true);
        if (r < 4 && c > 0) add(p, g.at(r + 1, c - 1), true);
      }
    }
  return m;
}

function build(id: BoardId): Geo {
  switch (id) {
    case 'sheep': {
      // тёмные поля 8×8: в верхнем ряду — столбцы 1, 3, 5, 7
      const cells: [number, number, number][] = [];
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if ((r + c) % 2 === 1) cells.push([r, c, r * 8 + c]);
      const { g, add } = make(id, cells, 92);
      for (const p of g.pts) {
        add(g.at(p.r, p.c), g.at(p.r + 1, p.c + 1));
        add(g.at(p.r, p.c), g.at(p.r + 1, p.c - 1));
      }
      return g;
    }
    case 'fox': {
      // крест 7×7 без угловых квадратов 2×2; штриховые диагонали — в каждом квадрате креста
      const on = (r: number, c: number) => r >= 0 && r < 7 && c >= 0 && c < 7 && ((r >= 2 && r <= 4) || (c >= 2 && c <= 4));
      const cells: [number, number, number][] = [];
      for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) if (on(r, c)) cells.push([r, c, r * 7 + c]);
      const { g, add } = make(id, cells, 100);
      for (const p of g.pts) {
        const a = g.at(p.r, p.c);
        add(a, g.at(p.r, p.c + 1));
        add(a, g.at(p.r + 1, p.c));
        const sq = (r: number, c: number) => on(r, c) && on(r + 1, c) && on(r, c + 1) && on(r + 1, c + 1);
        if (sq(p.r, p.c)) add(a, g.at(p.r + 1, p.c + 1), true);
        if (sq(p.r, p.c - 1)) add(a, g.at(p.r + 1, p.c - 1), true);
      }
      return g;
    }
    case 'mill': {
      // три квадрата в сетке 7×7 (кольцо k: от k до 6 − k), середины сторон соединены, углы — штриховыми диагоналями
      const cells: [number, number, number][] = [];
      for (let k = 0; k < 3; k++) {
        const e = 6 - k;
        for (const [r, c] of [
          [k, k],
          [k, 3],
          [k, e],
          [3, e],
          [e, e],
          [e, 3],
          [e, k],
          [3, k],
        ])
          cells.push([r, c, r * 7 + c]);
      }
      const { g, add } = make(id, cells, 103);
      for (let k = 0; k < 3; k++)
        for (let i = 0; i < 8; i++) {
          const a = cells[k * 8 + i];
          const b = cells[k * 8 + ((i + 1) % 8)];
          add(g.at(a[0], a[1]), g.at(b[0], b[1]));
        }
      for (let k = 0; k < 2; k++) {
        const e = 6 - k;
        add(g.at(k, 3), g.at(k + 1, 3));
        add(g.at(e, 3), g.at(e - 1, 3));
        add(g.at(3, k), g.at(3, k + 1));
        add(g.at(3, e), g.at(3, e - 1));
        add(g.at(k, k), g.at(k + 1, k + 1), true);
        add(g.at(k, e), g.at(k + 1, e - 1), true);
        add(g.at(e, k), g.at(e - 1, k + 1), true);
        add(g.at(e, e), g.at(e - 1, e - 1), true);
      }
      return g;
    }
    case 'alquerque': {
      const cells: [number, number, number][] = [];
      for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) cells.push([r, c, r * 5 + c]);
      return alquerqueGrid(id, cells, 160).g;
    }
    case 'leopards': {
      // квадрат 5×5 как у алькуерка + четыре треугольника у середин сторон: вершина — середина стороны,
      // средняя линия (3 точки) и внешняя (3 точки); боковые линии треугольника продолжают диагонали квадрата
      const cells: [number, number, number][] = [];
      for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) cells.push([r, c, r * 5 + c]);
      const tri: [number, number][][] = [
        [[-1, 1], [-1, 2], [-1, 3], [-2, 0], [-2, 2], [-2, 4]],
        [[5, 1], [5, 2], [5, 3], [6, 0], [6, 2], [6, 4]],
        [[1, -1], [2, -1], [3, -1], [0, -2], [2, -2], [4, -2]],
        [[1, 5], [2, 5], [3, 5], [0, 6], [2, 6], [4, 6]],
      ];
      let k = 25;
      for (const t of tri) for (const [r, c] of t) cells.push([r, c, k++]);
      const { g, add } = alquerqueGrid(id, cells, 115);
      const apex: [number, number][] = [
        [0, 2],
        [4, 2],
        [2, 0],
        [2, 4],
      ];
      tri.forEach((t, i) => {
        const A = g.at(apex[i][0], apex[i][1]);
        const P = t.map(([r, c]) => g.at(r, c));
        for (let j = 0; j < 3; j++) {
          add(A, P[j], j !== 1);
          add(P[j], P[j + 3], j !== 1);
        }
        add(P[0], P[1]);
        add(P[1], P[2]);
        add(P[3], P[4]);
        add(P[4], P[5]);
      });
      return g;
    }
    case 'tickle':
      return cellBoard(id, 4, 4);
    case 'sidja':
      return cellBoard(id, 5, 5);
    case 'bolotudu':
      return cellBoard(id, 5, 6);
    case 'hasami':
      return cellBoard(id, 9, 9);
    case 'turk':
      return cellBoard(id, 8, 8);
  }
}

const cache = new Map<BoardId, Geo>();
export function geo(id: BoardId): Geo {
  let g = cache.get(id);
  if (!g) cache.set(id, (g = build(id)));
  return g;
}
