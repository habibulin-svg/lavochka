/* «Сапёр» — логика поля без DOM: соседи (обычные, на торе, ходом коня), раскрытие поляны, вывод «точно мина / точно пусто»,
 * грубая оценка вероятностей для угадывания и проверка, что поле решается без угадывания. Ею пользуются генератор и боты. */

const NB = new Map<string, number[][]>();
const KING = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]];
const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];

/** Соседи каждой клетки поля w × h. Тор — края склеены; конь — соседи на ход коня. */
export function neighbours(w: number, h: number, torus: boolean, knight: boolean): number[][] {
  const key = `${w}x${h}:${+torus}${+knight}`;
  const hit = NB.get(key);
  if (hit) return hit;
  const out: number[][] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const set = new Set<number>();
      for (const [dx, dy] of knight ? KNIGHT : KING) {
        let nx = x + dx;
        let ny = y + dy;
        if (torus) {
          nx = (nx + w) % w;
          ny = (ny + h) % h;
        } else if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const j = ny * w + nx;
        if (j !== y * w + x) set.add(j);
      }
      out.push([...set]);
    }
  NB.set(key, out);
  return out;
}

export function countNums(nbr: number[][], mine: boolean[]): number[] {
  return nbr.map((ns) => ns.reduce((k, j) => k + (mine[j] ? 1 : 0), 0));
}

/** Открыть клетку и поляну вокруг нулей. Флажки (blocked) не открываются. Возвращает открытые клетки. */
export function flood(nbr: number[][], num: number[], open: boolean[], start: number, blocked?: (i: number) => boolean): number[] {
  const got: number[] = [];
  if (open[start]) return got;
  const stack = [start];
  open[start] = true;
  while (stack.length) {
    const i = stack.pop()!;
    got.push(i);
    if (num[i] !== 0) continue;
    for (const j of nbr[i]) {
      if (open[j] || blocked?.(j)) continue;
      open[j] = true;
      stack.push(j);
    }
  }
  return got;
}

/**
 * Один шаг вывода по открытым числам. mine — уже известные мины (они не открыты).
 * level 0 — только по одной клетке; 1 — ещё и по парам чисел (одно «внутри» другого); 2 — плюс общий счёт мин (total).
 */
export function deduce(nbr: number[][], open: boolean[], num: number[], mine: boolean[], level: number, total?: number): { safe: Set<number>; mines: Set<number> } {
  const safe = new Set<number>();
  const mines = new Set<number>();
  const cons: { cells: number[]; r: number }[] = [];
  const byCell = new Map<number, number[]>();
  for (let i = 0; i < open.length; i++) {
    if (!open[i] || num[i] <= 0) continue;
    const u: number[] = [];
    let f = 0;
    for (const j of nbr[i]) {
      if (mine[j]) f++;
      else if (!open[j]) u.push(j);
    }
    if (!u.length) continue;
    const r = num[i] - f;
    if (r <= 0) u.forEach((j) => safe.add(j));
    else if (r === u.length) u.forEach((j) => mines.add(j));
    else {
      const k = cons.length;
      cons.push({ cells: u.sort((a, b) => a - b), r });
      for (const j of u) {
        const l = byCell.get(j);
        if (l) l.push(k);
        else byCell.set(j, [k]);
      }
    }
  }
  if (level >= 1 && !safe.size && !mines.size) {
    for (let a = 0; a < cons.length; a++) {
      const A = cons[a];
      const seen = new Set<number>();
      for (const c of A.cells)
        for (const b of byCell.get(c)!) {
          if (b === a || seen.has(b)) continue;
          seen.add(b);
          const B = cons[b];
          if (B.cells.length <= A.cells.length) continue;
          const inB = new Set(B.cells);
          if (!A.cells.every((x) => inB.has(x))) continue;
          const inA = new Set(A.cells);
          const diff = B.cells.filter((x) => !inA.has(x));
          const rd = B.r - A.r;
          if (rd === 0) diff.forEach((x) => safe.add(x));
          else if (rd === diff.length) diff.forEach((x) => mines.add(x));
        }
    }
  }
  if (level >= 2 && total != null && !safe.size && !mines.size) {
    const unknown: number[] = [];
    let known = 0;
    for (let i = 0; i < open.length; i++) {
      if (mine[i]) known++;
      else if (!open[i]) unknown.push(i);
    }
    const rest = total - known;
    if (rest === 0) unknown.forEach((x) => safe.add(x));
    else if (rest === unknown.length) unknown.forEach((x) => mines.add(x));
  }
  return { safe, mines };
}

/** Вывод до упора: все мины, которые можно вывести (известные растут), и все точно пустые закрытые клетки. */
export function deduceAll(nbr: number[][], open: boolean[], num: number[], mine0: boolean[], level: number, total?: number): { safe: number[]; mine: boolean[] } {
  const mine = mine0.slice();
  for (let guard = 0; guard < 400; guard++) {
    const d = deduce(nbr, open, num, mine, level, total);
    if (d.safe.size) return { safe: [...d.safe], mine };
    if (!d.mines.size) break;
    d.mines.forEach((i) => (mine[i] = true));
  }
  return { safe: [], mine };
}

/** Грубая вероятность мины для закрытых неизвестных клеток (для угадывания): у края — худшее из соседних чисел, вглубь — средняя плотность. */
export function probs(nbr: number[][], open: boolean[], num: number[], mine: boolean[], total: number): Map<number, number> {
  const p = new Map<number, number>();
  for (let i = 0; i < open.length; i++) {
    if (!open[i] || num[i] <= 0) continue;
    const u: number[] = [];
    let f = 0;
    for (const j of nbr[i]) {
      if (mine[j]) f++;
      else if (!open[j]) u.push(j);
    }
    if (!u.length) continue;
    const q = Math.max(0, num[i] - f) / u.length;
    for (const j of u) p.set(j, Math.max(p.get(j) ?? 0, q));
  }
  let known = 0;
  let frontierMines = 0;
  const inner: number[] = [];
  for (let i = 0; i < open.length; i++) {
    if (mine[i]) known++;
    else if (!open[i] && !p.has(i)) inner.push(i);
  }
  p.forEach((q) => (frontierMines += q));
  const dens = inner.length ? Math.min(1, Math.max(0, (total - known - frontierMines * 0.7) / inner.length)) : 0;
  for (const i of inner) p.set(i, dens);
  return p;
}

/** Решается ли поле без угадывания, если начать с клетки start. */
export function solvable(nbr: number[][], mine: boolean[], start: number, total: number): boolean {
  const num = countNums(nbr, mine);
  if (mine[start]) return false;
  const open = new Array(mine.length).fill(false);
  flood(nbr, num, open, start);
  let known: boolean[] = new Array(mine.length).fill(false);
  const safeTotal = mine.length - total;
  let opened = open.filter(Boolean).length;
  for (let guard = 0; guard < 5000 && opened < safeTotal; guard++) {
    const d = deduceAll(nbr, open, num, known, 2, total);
    known = d.mine;
    if (!d.safe.length) return false;
    for (const i of d.safe) {
      if (mine[i]) return false;
      opened += flood(nbr, num, open, i).length;
    }
  }
  return opened >= safeTotal;
}
