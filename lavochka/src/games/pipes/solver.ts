/* «Водопроводчик» — решатель для ботов и показа правил: у каждой клетки — возможные повороты её куска,
 * стыки между клетками «открыт / закрыт / неизвестно». Распространение ограничений, а где не хватает — перебор с проверкой связности. */
import { DIRS, OPP, rotCW, step, watered } from './engine';

type C = { w: number; h: number; wrap: boolean };

function options(m: number): number[] {
  const out: number[] = [];
  let t = m;
  for (let k = 0; k < 4; k++) {
    if (!out.includes(t)) out.push(t);
    t = rotCW(t);
  }
  return out;
}

/** Решение: какой должна стать каждая клетка (биты сторон). null — не нашлось. */
export function solve(c: C, tiles: number[], src: number, budget = 200_000): number[] | null {
  const n = tiles.length;
  const nb: number[][] = [];
  for (let i = 0; i < n; i++) nb.push(DIRS.map((d) => step(c, i, d)));
  // домены: повороты, не смотрящие за край
  const dom0: number[][] = tiles.map((m, i) => options(m).filter((o) => DIRS.every((d, k) => !(o & d) || nb[i][k] >= 0)));
  let nodes = 0;

  const propagate = (dom: number[][], queue: number[]): boolean => {
    const inQ = new Array(n).fill(false);
    queue.forEach((i) => (inQ[i] = true));
    while (queue.length) {
      const i = queue.pop()!;
      inQ[i] = false;
      for (let k = 0; k < 4; k++) {
        const j = nb[i][k];
        if (j < 0) continue;
        const d = DIRS[k];
        // что клетка i может сказать о стыке со j
        let canOpen = false;
        let canClose = false;
        for (const o of dom[i]) (o & d ? (canOpen = true) : (canClose = true));
        const before = dom[j].length;
        const od = OPP[d];
        dom[j] = dom[j].filter((o) => ((o & od) ? canOpen : canClose));
        // два конца (по одному выходу) не могут смотреть друг на друга, если клеток больше двух
        if (n > 2 && dom[i].length === 1 && (dom[i][0] & d) && DIRS.filter((x) => dom[i][0] & x).length === 1)
          dom[j] = dom[j].filter((o) => !((o & od) && [1, 2, 4, 8].includes(o)));
        if (!dom[j].length) return false;
        if (dom[j].length !== before && !inQ[j]) {
          inQ[j] = true;
          queue.push(j);
        }
      }
    }
    return true;
  };

  const search = (dom: number[][]): number[] | null => {
    if (++nodes > budget) return null;
    let pick = -1;
    for (let i = 0; i < n; i++) if (dom[i].length > 1 && (pick < 0 || dom[i].length < dom[pick].length)) pick = i;
    if (pick < 0) {
      const t = dom.map((d) => d[0]);
      return watered(c, t, src).every(Boolean) ? t : null;
    }
    for (const o of dom[pick]) {
      const next = dom.map((d) => d.slice());
      next[pick] = [o];
      if (!propagate(next, [pick])) continue;
      const r = search(next);
      if (r) return r;
    }
    return null;
  };

  const dom = dom0.map((d) => d.slice());
  if (!propagate(dom, [...Array(n).keys()])) return null;
  return search(dom);
}
