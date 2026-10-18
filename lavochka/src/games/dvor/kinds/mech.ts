/* Волна 7 «А у нас во дворе»: шестерёнки (передачи велика), турнир (футбол двор на двор), земелька (площади
 * многоугольников на клетчатом поле). Без DOM. */
import type { Rng } from '../../../core/types';
import { shuffle } from '../../../core/rng';

// ---------------------------------------------------------------- шестерёнки

/** Связь со следующей шестерёнкой: зубья (крутит в другую сторону), цепь (в ту же), перекрещённый ремень (в другую). */
export type Link = 'mesh' | 'chain' | 'cross';

export interface GearsData {
  teeth: number[];
  links: Link[];
  /** Первая делает столько оборотов по часовой стрелке. */
  turns: number;
  /** О какой шестерёнке спрашивают (номер). */
  ask: number;
}

export interface GearsAns {
  turns: number;
  /** true — по часовой. */
  cw: boolean;
}

export function solveGears(d: GearsData): GearsAns {
  let cw = true;
  for (let i = 0; i < d.ask; i++) if (d.links[i] !== 'chain') cw = !cw;
  return { turns: (d.turns * d.teeth[0]) / d.teeth[d.ask], cw };
}

export const checkGears = (d: GearsData, a: unknown) => {
  const s = solveGears(d);
  const x = a as GearsAns | null;
  return !!x && Number(x.turns) === s.turns && x.cw === s.cw;
};

/** Уровень: 0 — три шестерёнки на зубьях; 1 — четыре, одна цепь; 2 — пять-шесть, цепь и перекрёстный ремень. */
export function genGears(level: number, rng: Rng): { data: GearsData; sol: GearsAns } {
  const n = [3, 4, 5 + rng.int(2)][level] ?? 4;
  const TEETH = [8, 10, 12, 15, 16, 20, 24, 30, 36, 40, 48];
  for (let attempt = 0; attempt < 500; attempt++) {
    const teeth = Array.from({ length: n }, () => TEETH[rng.int(TEETH.length)]);
    const links: Link[] = Array.from({ length: n - 1 }, () => 'mesh' as Link);
    if (level >= 1) links[rng.int(n - 1)] = 'chain';
    if (level === 2) {
      const free = links.map((l, i) => (l === 'mesh' ? i : -1)).filter((i) => i >= 0);
      links[free[rng.int(free.length)]] = 'cross';
    }
    const turns = 1 + rng.int(level === 0 ? 4 : 8);
    const ask = level === 2 ? 2 + rng.int(n - 2) : n - 1;
    const r = (turns * teeth[0]) / teeth[ask];
    if (!Number.isInteger(r) || r === turns || r > 60) continue;
    const d: GearsData = { teeth, links, turns, ask };
    return { data: d, sol: solveGears(d) };
  }
  throw new Error('шестерёнки: не сложилось');
}

// ---------------------------------------------------------------- турнир

export interface TurnirData {
  teams: string[];
  /** Очки каждой команды в конце: 3 за победу, 1 за ничью. */
  points: number[];
  /** Известные результаты: [i, j, r] — r: 1 победа i, 0 ничья, -1 победа j. */
  known: [number, number, number][];
  /** О каком матче спрашивают, или null — «сколько ничьих». */
  ask: [number, number] | null;
}

const YARDS = ['«Гаражи»', '«Пятиэтажка»', '«Школьный»', '«Стройка»', '«Овраг»', '«Котельная»'];

function pairsOf(n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) out.push([i, j]);
  return out;
}

const ptsOf = (n: number, res: Map<string, number>) => {
  const p = new Array(n).fill(0);
  for (const [k, r] of res) {
    const [i, j] = k.split('-').map(Number);
    if (r === 1) p[i] += 3;
    else if (r === -1) p[j] += 3;
    else (p[i] += 1), (p[j] += 1);
  }
  return p;
};

/** Все раскладки неизвестных матчей, сходящиеся с очками (с отсечением: перебор и недобор очков). */
function completions(d: TurnirData, limit = 200000): Map<string, number>[] {
  const n = d.teams.length;
  const known = new Map(d.known.map(([i, j, r]) => [`${i}-${j}`, r]));
  const unknown = pairsOf(n).filter(([i, j]) => !known.has(`${i}-${j}`));
  const pts = ptsOf(n, known);
  // сколько неизвестных матчей ещё осталось у каждой команды
  const left = new Array(n).fill(0);
  for (const [i, j] of unknown) left[i]++, left[j]++;
  const out: Map<string, number>[] = [];
  const cur = new Map(known);
  const ok = (t: number) => pts[t] <= d.points[t] && pts[t] + 3 * left[t] >= d.points[t];
  const go = (k: number) => {
    if (out.length >= limit) return;
    if (k === unknown.length) {
      if (pts.every((v, i) => v === d.points[i])) out.push(new Map(cur));
      return;
    }
    const [i, j] = unknown[k];
    left[i]--;
    left[j]--;
    for (const r of [1, 0, -1]) {
      const pi = r === 1 ? 3 : r === 0 ? 1 : 0;
      const pj = r === -1 ? 3 : r === 0 ? 1 : 0;
      pts[i] += pi;
      pts[j] += pj;
      if (ok(i) && ok(j)) {
        cur.set(`${i}-${j}`, r);
        go(k + 1);
      }
      pts[i] -= pi;
      pts[j] -= pj;
    }
    cur.delete(`${i}-${j}`);
    left[i]++;
    left[j]++;
  };
  go(0);
  return out;
}

export function solveTurnir(d: TurnirData): number {
  const c = completions(d)[0];
  if (!c) return 0;
  if (!d.ask) return [...c.values()].filter((r) => r === 0).length;
  return c.get(`${d.ask[0]}-${d.ask[1]}`) ?? 0;
}

/** Уровень: 0 — 4 команды, «сколько ничьих» (по сумме очков); 1 — 4 команды, как сыграли двое; 2 — 5 команд. */
export function genTurnir(level: number, rng: Rng): { data: TurnirData; sol: number } {
  const n = level === 2 ? 5 : 4;
  for (let attempt = 0; attempt < 500; attempt++) {
    const teams = shuffle(YARDS, rng).slice(0, n);
    const res = new Map<string, number>();
    for (const [i, j] of pairsOf(n)) {
      const x = rng.next();
      res.set(`${i}-${j}`, x < 0.4 ? 1 : x < 0.65 ? 0 : -1);
    }
    const points = ptsOf(n, res);
    if (level === 0) {
      const d: TurnirData = { teams, points, known: [], ask: null };
      return { data: d, sol: [...res.values()].filter((r) => r === 0).length };
    }
    const all = shuffle(pairsOf(n), rng);
    const ask = all[0];
    const d: TurnirData = { teams, points, known: [], ask };
    // открываем результаты, пока ответ про спрошенный матч не станет однозначным
    for (const [i, j] of all.slice(1)) {
      const c = completions(d);
      const vals = new Set(c.map((m) => m.get(`${ask[0]}-${ask[1]}`)));
      if (vals.size === 1) break;
      d.known.push([i, j, res.get(`${i}-${j}`)!]);
    }
    const vals = new Set(completions(d).map((m) => m.get(`${ask[0]}-${ask[1]}`)));
    if (vals.size !== 1) continue;
    // слишком много известно — неинтересно
    if (d.known.length > pairsOf(n).length - 3) continue;
    return { data: d, sol: res.get(`${ask[0]}-${ask[1]}`)! };
  }
  throw new Error('турнир: не сложилось');
}

// ---------------------------------------------------------------- земелька (площадь многоугольника на клетках)

export interface ZemData {
  w: number;
  h: number;
  /** Вершины многоугольника по узлам сетки. */
  pts: [number, number][];
}

/** Площадь по формуле шнурования, в клетках (может быть с половинкой). */
export function areaOf(pts: [number, number][]): number {
  let s = 0;
  pts.forEach(([x, y], i) => {
    const [x2, y2] = pts[(i + 1) % pts.length];
    s += x * y2 - x2 * y;
  });
  return Math.abs(s) / 2;
}

export const solveZem = (d: ZemData) => areaOf(d.pts);

export const checkZem = (d: ZemData, a: unknown) => Number(String(a).replace(',', '.')) === areaOf(d.pts);

/** Выпуклая оболочка точек (Эндрю). */
function hull(ps: [number, number][]): [number, number][] {
  const p = ps.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [];
  for (const q of p) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop();
    lower.push(q);
  }
  const upper: [number, number][] = [];
  for (const q of p.reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop();
    upper.push(q);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

/** Уровень: 0 — прямоугольный многоугольник (только по линиям клеток); 1 — треугольник/четырёхугольник со скосами;
 * 2 — пяти-шестиугольник со скосами. */
export function genZem(level: number, rng: Rng): { data: ZemData; sol: number } {
  const w = 10;
  const h = 8;
  for (let attempt = 0; attempt < 500; attempt++) {
    let pts: [number, number][];
    if (level === 0) {
      // «буква Г / П»: прямоугольник с вырезанным углом
      const x0 = 1 + rng.int(2);
      const y0 = 1 + rng.int(2);
      const x1 = x0 + 4 + rng.int(4);
      const y1 = y0 + 3 + rng.int(3);
      if (x1 > w - 1 || y1 > h - 1) continue;
      const cx = x0 + 1 + rng.int(x1 - x0 - 1);
      const cy = y0 + 1 + rng.int(y1 - y0 - 1);
      pts = [[x0, y0], [cx, y0], [cx, cy], [x1, cy], [x1, y1], [x0, y1]];
    } else {
      const k = level === 1 ? 3 + rng.int(2) : 5 + rng.int(2);
      const raw: [number, number][] = Array.from({ length: k + 2 }, () => [rng.int(w + 1), rng.int(h + 1)]);
      pts = hull(raw);
      if (pts.length !== k) continue;
      // хоть одна сторона наискосок
      if (pts.every(([x, y], i) => x === pts[(i + 1) % k][0] || y === pts[(i + 1) % k][1])) continue;
    }
    const s = areaOf(pts);
    if (s < 6 || s > 45) continue;
    return { data: { w, h, pts }, sol: s };
  }
  throw new Error('земелька: не сложилось');
}
