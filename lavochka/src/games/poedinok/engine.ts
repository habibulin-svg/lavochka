/* «Поединок» (Duel, «Электромера») — кубики перекатываются по жёлтому полю 9×8. Материалы и решения —
 * docs/analysis/materials-poedinok.md. Без DOM.
 *
 * Клетки: c + 9·r, r = 0 — верхний ряд (дом чёрных, место 1), r = 7 — нижний (дом белых, место 0; белые ходят первыми).
 * Кубик — верхняя, северная и восточная грани (остальные — 7 − противоположная). Ход — ровно столько перекатов,
 * сколько точек сверху в начале хода (король — один), по прямой или с одним поворотом под прямым углом, только по свободным
 * клеткам; в последней может стоять чужой кубик — он взят. Побеждает взявший короля или поставивший своего короля
 * во «дворец» — стартовую клетку чужого короля. */
import type { Options } from '../../core/types';

export const COLS = 9;
export const ROWS = 8;
export const N = COLS * ROWS;
/** Дворцы: место 0 (белые) — нижний центр, место 1 (чёрные) — верхний центр. */
export const PALACE = [7 * COLS + 4, 4];
/** Ничья, если столько полуходов подряд без взятия. */
export const QUIET = 120;

export interface Die {
  owner: number;
  king: boolean;
  t: number;
  n: number;
  e: number;
}

export type Dir = 'n' | 's' | 'e' | 'w';
export const DIRS: Dir[] = ['n', 'e', 's', 'w'];
const DV: Record<Dir, [number, number]> = { n: [0, -1], s: [0, 1], e: [1, 0], w: [-1, 0] };

export interface Cfg {
  /** Только взятие короля (без «дворца»). */
  noPalace: boolean;
}
export function cfgFrom(o: Options): Cfg {
  return { noPalace: o.win === 'king' };
}

export interface State {
  cfg: Cfg;
  cells: (Die | null)[];
  turn: number;
  over: boolean;
  winner: number | null;
  why: '' | 'king' | 'palace' | 'stuck' | 'quiet';
  last: number[];
  /** Путь последнего хода (клетки от старта до конца) — для показа. */
  path: number[];
  quiet: number;
  passes: number;
  plies: number;
  /** Сколько кубиков взято у каждого места. */
  lost: [number, number];
}

/** Ход: откуда, направление до поворота, сколько шагов до поворота (k), направление после (null — прямо). */
export type Action = { type: 'move'; from: number; d1: Dir; k: number; d2: Dir | null } | { type: 'pass' };

export type Event =
  | { type: 'move'; seat: number; from: number; to: number; path: number[]; took: Die | null }
  | { type: 'pass'; seat: number }
  | { type: 'end'; winner: number | null; why: State['why'] };

export const col = (p: number) => p % COLS;
export const row = (p: number) => Math.floor(p / COLS);

/** Перекатить кубик на одну клетку в сторону d. */
export function roll(d: Die, dir: Dir): Die {
  const s = 7 - d.n;
  const w = 7 - d.e;
  const b = 7 - d.t;
  if (dir === 'n') return { ...d, t: s, n: d.t };
  if (dir === 's') return { ...d, t: d.n, n: b };
  if (dir === 'e') return { ...d, t: w, e: d.t };
  return { ...d, t: d.e, e: b };
}

function stepCell(p: number, dir: Dir): number {
  const [dx, dy] = DV[dir];
  const c = col(p) + dx;
  const r = row(p) + dy;
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return -1;
  return r * COLS + c;
}

const PERP: Record<Dir, Dir[]> = { n: ['e', 'w'], s: ['e', 'w'], e: ['n', 's'], w: ['n', 's'] };

/** Начальная раскладка (верх, сторона «к себе» = 3, «к сопернику» = 4, восток/запад — по правой системе):
 * слева направо 5, 1, 2, 6, король, 6, 2, 1, 5 (для сидящего снизу). */
const START: [number, number][] = [
  [5, 6],
  [1, 5],
  [2, 1],
  [6, 2],
  [0, 0],
  [6, 2],
  [2, 1],
  [1, 5],
  [5, 6],
];

export function newState(cfg: Cfg): State {
  const cells: (Die | null)[] = Array(N).fill(null);
  for (let c = 0; c < COLS; c++) {
    const [t, e] = START[c];
    const king = t === 0;
    // белые внизу: к себе — юг (3), к сопернику — север (4)
    cells[7 * COLS + c] = { owner: 0, king, t: king ? 1 : t, n: 4, e: king ? 2 : e };
    // чёрные вверху смотрят на юг: север (к себе) — 3, восток и запад меняются местами
    cells[c] = { owner: 1, king, t: king ? 1 : t, n: 3, e: king ? 2 : 7 - e };
  }
  return { cfg, cells, turn: 0, over: false, winner: null, why: '', last: [], path: [], quiet: 0, passes: 0, plies: 0, lost: [0, 0] };
}

export const setup = (opts: Options) => newState(cfgFrom(opts));

export function toAct(s: State): number[] {
  return s.over ? [] : [s.turn];
}

export interface Route {
  a: Extract<Action, { type: 'move' }>;
  to: number;
  path: number[];
  die: Die;
}

/** Все пути кубика с клетки p. */
export function routes(s: State, p: number): Route[] {
  const d = s.cells[p];
  if (!d) return [];
  const L = d.king ? 1 : d.t;
  const out: Route[] = [];
  for (const d1 of DIRS) {
    let cur = p;
    let die = d;
    const path = [p];
    let ok = true;
    for (let k = 1; k <= L && ok; k++) {
      const q = stepCell(cur, d1);
      if (q < 0) break;
      const t = s.cells[q];
      die = d.king ? die : roll(die, d1);
      path.push(q);
      cur = q;
      if (k === L) {
        if (!t || t.owner !== d.owner) out.push({ a: { type: 'move', from: p, d1, k, d2: null }, to: q, path: [...path], die });
        break;
      }
      if (t) {
        ok = false;
        break;
      }
      // поворот после k шагов
      for (const d2 of PERP[d1]) {
        let c2 = cur;
        let die2 = die;
        const path2 = [...path];
        for (let j = 1; j <= L - k; j++) {
          const q2 = stepCell(c2, d2);
          if (q2 < 0) break;
          const t2 = s.cells[q2];
          die2 = d.king ? die2 : roll(die2, d2);
          path2.push(q2);
          c2 = q2;
          if (j === L - k) {
            if (!t2 || t2.owner !== d.owner) out.push({ a: { type: 'move', from: p, d1, k, d2 }, to: q2, path: path2, die: die2 });
            break;
          }
          if (t2) break;
        }
      }
    }
  }
  return out;
}

export function legal(s: State, seat: number): Action[] {
  if (s.over || s.turn !== seat) return [];
  const out: Action[] = [];
  for (let p = 0; p < N; p++) {
    const d = s.cells[p];
    if (d && d.owner === seat) for (const r of routes(s, p)) out.push(r.a);
  }
  if (!out.length) out.push({ type: 'pass' });
  return out;
}

const same = (a: Extract<Action, { type: 'move' }>, b: Extract<Action, { type: 'move' }>) => a.from === b.from && a.d1 === b.d1 && a.k === b.k && a.d2 === b.d2;

export function apply(s0: State, seat: number, a: Action): { state: State; events: Event[] } | null {
  if (s0.over || seat !== s0.turn || !a || typeof a !== 'object') return null;
  const s: State = { ...s0, cells: [...s0.cells], lost: [...s0.lost] as [number, number] };
  const events: Event[] = [];
  if (a.type === 'pass') {
    if (legal(s0, seat).some((x) => x.type === 'move')) return null;
    s.passes++;
    s.plies++;
    events.push({ type: 'pass', seat });
    if (s.passes >= 2) return end(s, null, 'stuck', events);
    s.turn = 1 - seat;
    return { state: s, events };
  }
  if (a.type !== 'move') return null;
  const d = s0.cells[a.from];
  if (!d || d.owner !== seat) return null;
  const r = routes(s0, a.from).find((x) => same(x.a, a));
  if (!r) return null;
  const took = s0.cells[r.to];
  s.cells[a.from] = null;
  s.cells[r.to] = r.die;
  s.last = [a.from, r.to];
  s.path = r.path;
  s.passes = 0;
  s.plies++;
  s.quiet = took ? 0 : s.quiet + 1;
  if (took) s.lost[took.owner]++;
  events.push({ type: 'move', seat, from: a.from, to: r.to, path: r.path, took });
  if (took && took.king) return end(s, seat, 'king', events);
  if (d.king && !s.cfg.noPalace && r.to === PALACE[1 - seat]) return end(s, seat, 'palace', events);
  if (s.quiet >= QUIET) return end(s, null, 'quiet', events);
  s.turn = 1 - seat;
  return { state: s, events };
}

function end(s: State, winner: number | null, why: State['why'], events: Event[]) {
  s.over = true;
  s.winner = winner;
  s.why = why;
  events.push({ type: 'end', winner, why });
  return { state: s, events };
}
