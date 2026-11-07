/* Бот Brick Game 2026: перебирает все повороты и столбцы текущей фигуры, оценивает поле после установки
 * (высота, дыры, неровность, снятые ряды — веса в духе известной эвристики Делашери), сильный ещё и заглядывает
 * на следующую фигуру. Возвращает установку — как её отправил бы игрок. */
import { cellsOf, dropY, fits, H, lockPiece, removeRows, rotCount, W, type Piece, type Place, type Tet } from './tetris';

interface Eval {
  holes: number;
  agg: number;
  bump: number;
  wells: number;
  max: number;
}

function evalGrid(grid: number[]): Eval {
  const hs: number[] = [];
  let holes = 0;
  for (let x = 0; x < W; x++) {
    let h = 0;
    let seen = false;
    for (let y = 0; y < H; y++) {
      const v = grid[y * W + x];
      if (v && !seen) {
        seen = true;
        h = H - y;
      } else if (!v && seen) holes++;
    }
    hs.push(h);
  }
  let bump = 0;
  let wells = 0;
  for (let x = 0; x < W; x++) {
    if (x < W - 1) bump += Math.abs(hs[x] - hs[x + 1]);
    const l = x ? hs[x - 1] : 99;
    const r = x < W - 1 ? hs[x + 1] : 99;
    const d = Math.min(l, r) - hs[x];
    if (d > 2) wells += d - 2;
  }
  return { holes, agg: hs.reduce((a, b) => a + b, 0), bump, wells, max: Math.max(...hs) };
}

const LEVELS = [
  { holes: 2.5, agg: 0.4, bump: 0.15, wells: 0.2, lines: 0.6, tetris: 0, look: false, noise: 2.5 },
  { holes: 4.5, agg: 0.5, bump: 0.2, wells: 0.35, lines: 0.8, tetris: 2, look: false, noise: 0.8 },
  { holes: 7.5, agg: 0.51, bump: 0.18, wells: 0.4, lines: 0.76, tetris: 6, look: true, noise: 0.1 },
];

function score(grid: number[], lines: number, lv: (typeof LEVELS)[number]): number {
  const e = evalGrid(grid);
  // высоко — тогда снимать любые ряды и не копить колодец под «четвёрку»
  const danger = e.max > 13 ? 3 : 1;
  return -lv.holes * e.holes - lv.agg * e.agg * danger - lv.bump * e.bump - lv.wells * e.wells + lv.lines * lines * danger + (lines === 4 ? lv.tetris : 0);
}

/** Все установки фигуры k на поле grid (сверху вниз, без хитрых подсовываний). */
function placements(grid: number[], k: number): { p: Piece; grid: number[]; lines: number }[] {
  const out: { p: Piece; grid: number[]; lines: number }[] = [];
  const t = { grid } as Tet;
  for (let r = 0; r < rotCount(k); r++)
    for (let x = 0; x < W; x++) {
      const p: Piece = { k, r, x, y: 1 };
      if (!fits(t, p)) continue;
      p.y = dropY(t, p);
      const g2 = grid.slice();
      const t2 = { grid: g2 } as Tet;
      const rows = lockPiece(t2, p);
      removeRows(t2, rows);
      out.push({ p, grid: t2.grid, lines: rows.length });
    }
  return out;
}

/** panic — бот не успевает подумать при такой скорости: ставит почти наугад. */
export function bestPlace(t: Tet, level: number, rnd: () => number, panic = 0): Place | null {
  const cur = t.cur;
  if (!cur) return null;
  const lv = LEVELS[Math.max(0, Math.min(2, level))];
  const noise = lv.noise + panic * 12;
  const all = placements(t.grid, cur.k).map((a) => ({ a, v: score(a.grid, a.lines, lv) + (rnd() - 0.5) * noise }));
  all.sort((x, y) => y.v - x.v);
  // заглядывает на следующую фигуру только для пяти лучших (иначе дорого)
  if (lv.look && t.next && !panic)
    for (const c of all.slice(0, 5)) {
      let nb = -Infinity;
      for (const b of placements(c.a.grid, t.next)) nb = Math.max(nb, score(b.grid, b.lines, lv));
      if (nb > -Infinity) c.v = c.v * 0.4 + nb * 0.6;
    }
  all.sort((x, y) => y.v - x.v);
  const best: Piece | null = all[0]?.a.p ?? null;
  if (!best) return null;
  return [t.seq, best.k, best.r % rotCount(best.k), best.x, best.y];
}

/** Можно ли дойти до установки сверху (без подсовывания): фигура проходит от верха до места по своему столбцу. */
export function reachable(t: Tet, pl: Place): boolean {
  const [, k, r, x, y] = pl;
  for (let yy = 1; yy <= y; yy++) if (!fits(t, { k, r, x, y: yy })) return false;
  void cellsOf;
  return true;
}
