/* «Головоломки» — боты-помощники. Решения в view нет: бот решает сам по условию (судоку — перебором, пикросс — построчной логикой),
 * а вписывает не всё сразу: уровень — как часто он что-то делает. В судоку идёт «по-человечески» — следующей по логике клеткой. */
import type { Rng } from '../../core/types';
import type { Action, State } from './engine';
import * as sudoku from './sudoku';
import * as picross from './picross';

/** Вероятность вписать клетку за ход (остальное — «думает»). */
const PACE = [0.1, 0.25, 0.5];

const cache = new Map<string, string[]>();

function solutionOf(v: State): string[] | null {
  const key = `${v.kind}:${v.seed}:${v.size}:${v.level}`;
  const hit = cache.get(key);
  if (hit) return hit;
  let sol: string[] | null = null;
  if (v.kind === 'sudoku') {
    const grid = v.cells.map((c, i) => (v.fixed[i] ? Number(c) : 0));
    const r = sudoku.countSolutions(grid, 1);
    sol = r.solution ? r.solution.map(String) : null;
  } else if (v.data) {
    const known = v.cells.map((c, i) => (v.fixed[i] ? (c === '#' ? 1 : 0) : -1));
    const g = picross.lineSolve(v.w, v.h, v.data.rows, v.data.cols, known);
    if (g && g.every((x) => x !== -1)) sol = g.map((x) => (x ? '#' : '.'));
  }
  if (sol) {
    if (cache.size > 20) cache.clear();
    cache.set(key, sol);
  }
  return sol;
}

export function choose(v: State, seat: number, level: number, rng: Rng): Action {
  if (rng.next() >= PACE[Math.max(0, Math.min(2, level))]) return { type: 'think' };
  const sol = solutionOf(v);
  if (!sol) return { type: 'hint' };
  if (v.kind === 'sudoku') {
    // сначала исправить чужую ошибку, если её видно по проверке; иначе — следующая по логике клетка
    const wrong = v.wrong.find((i) => v.cells[i] !== sol[i]);
    if (wrong != null) return { type: 'set', is: [wrong], v: sol[wrong] };
    const grid = v.cells.map((c, i) => (c && c === sol[i] ? Number(c) : 0));
    const st = sudoku.nextLogicalStep(grid, 3);
    if (st?.cell != null && !v.fixed[st.cell]) return { type: 'set', is: [st.cell], v: String(st.digit) };
    const open = v.cells.map((c, i) => i).filter((i) => !v.fixed[i] && v.cells[i] !== sol[i]);
    if (!open.length) return { type: 'think' };
    const i = open[rng.int(open.length)];
    return { type: 'set', is: [i], v: sol[i] };
  }
  // пикросс: закрасить нужную клетку или стереть лишнюю
  const bad = v.cells.map((c, i) => i).filter((i) => !v.fixed[i] && (sol[i] === '#') !== (v.cells[i] === '#'));
  if (!bad.length) return { type: 'think' };
  const i = bad[rng.int(bad.length)];
  return { type: 'set', is: [i], v: sol[i] === '#' ? '#' : 'x' };
}
