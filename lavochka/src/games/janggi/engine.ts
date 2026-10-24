/* Чанги (корейские шахматы) — правила, без DOM.
 *
 * Доска 9 × 10 точек без реки (p = r * 9 + f; r = 0 — ряд Чо, синих, место 0, ходят первыми; r = 9 — Хан, красные, место 1).
 * Дворцы 3×3 с диагоналями: по диагоналям дворца ходят генерал, советники, колесницы, пушки и солдаты (в чужом дворце).
 * Фигуры: K генерал, A советник, E слон (шаг прямо + два по диагонали, с подножками), H конь, R колесница, C пушка, P солдат.
 * Пушка ходит и бьёт только прыжком через одну фигуру — не через пушку и не по пушке. Генералы друг друга не бьют:
 * встали на одну вертикаль без фигур между (бикджан) — соперник обязан разорвать, иначе партия решается по очкам.
 * Пропустить ход можно, если нет шаха. Очки: колесница 13, пушка 7, конь 5, слон 3, советник 3, солдат 2; Хан получает 1,5 за второй ход. */
import type { Options } from '../../core/types';

export const FILES = 9;
export const RANKS = 10;
export const N = FILES * RANKS;

/** Расстановка коней и слонов у каждой стороны (слева направо от себя): «мас» — конь-слон, «сам» — слон-конь. */
export type Setup = 'HEEH' | 'EHHE' | 'HEHE' | 'EHEH';
export interface Cfg {
  setup: Setup;
  labels: 'hanja' | 'ru';
}
export function cfgFrom(o: Options): Cfg {
  const setup = (['HEEH', 'EHHE', 'HEHE', 'EHEH'] as Setup[]).includes(o.setup as Setup) ? (o.setup as Setup) : 'HEEH';
  return { setup, labels: o.labels === 'ru' ? 'ru' : 'hanja' };
}

export interface Move {
  from: number;
  to: number;
}
export type EndReason = 'mate' | 'points' | 'bikjang' | 'repetition' | 'resign';

export interface State {
  cfg: Cfg;
  board: string[];
  turn: 0 | 1;
  /** Подряд пропущенных ходов. */
  passes: number;
  /** Бикджан объявлен ходом стороны (−1 — нет). */
  bik: number;
  keys: string[];
  ply: number;
  captured: [string[], string[]];
  last: Move | null;
  over: boolean;
  winner: number | null;
  reason: EndReason | null;
  score: [number, number] | null;
}
export type View = State;

export type Action = { type: 'move'; from: number; to: number } | { type: 'pass' } | { type: 'resign' };
export type Event =
  | { type: 'move'; seat: number; from: number; to: number; piece: string; captured: string; check: boolean; bik: boolean }
  | { type: 'pass'; seat: number }
  | { type: 'end'; winner: number | null; reason: EndReason; score: [number, number] | null };

export const fileOf = (p: number) => p % FILES;
export const rankOf = (p: number) => Math.floor(p / FILES);
export const at = (f: number, r: number) => (f < 0 || f >= FILES || r < 0 || r >= RANKS ? -1 : r * FILES + f);
export const colorOf = (x: string): 0 | 1 => (x === x.toUpperCase() ? 0 : 1);
const kindOf = (x: string) => x.toUpperCase();
const side = (c: number, k: string) => (c === 0 ? k : k.toLowerCase());

export function startBoard(setup: Setup): string[] {
  const b = new Array(N).fill('');
  const [l1, l2, r1, r2] = setup.split('');
  const back = ['R', l1, l2, 'A', '', 'A', r1, r2, 'R'];
  for (let f = 0; f < FILES; f++) {
    if (back[f]) b[at(f, 0)] = back[f];
    // у Хан — зеркально (смотрит с другой стороны), так что его «левый» — наш правый
    if (back[f]) b[at(FILES - 1 - f, 9)] = back[f].toLowerCase();
  }
  b[at(4, 1)] = 'K';
  b[at(4, 8)] = 'k';
  for (const f of [1, 7]) {
    b[at(f, 2)] = 'C';
    b[at(f, 7)] = 'c';
  }
  for (const f of [0, 2, 4, 6, 8]) {
    b[at(f, 3)] = 'P';
    b[at(f, 6)] = 'p';
  }
  return b;
}

/** Дворец стороны c (по рядам) и чужой. */
const inPalaceOf = (p: number, c: number) => {
  const f = fileOf(p);
  const r = rankOf(p);
  return f >= 3 && f <= 5 && (c === 0 ? r <= 2 : r >= 7);
};
const inAnyPalace = (p: number) => inPalaceOf(p, 0) || inPalaceOf(p, 1);
/** Диагональ дворца между соседними точками: из угла в центр и обратно. */
function palaceDiag(a: number, b: number): boolean {
  if (!inAnyPalace(a) || !inAnyPalace(b) || inPalaceOf(a, 0) !== inPalaceOf(b, 0)) return false;
  const df = Math.abs(fileOf(a) - fileOf(b));
  const dr = Math.abs(rankOf(a) - rankOf(b));
  if (df !== 1 || dr !== 1) return false;
  const centre = (p: number) => fileOf(p) === 4 && (rankOf(p) === 1 || rankOf(p) === 8);
  return centre(a) || centre(b);
}

const ORTHO = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
];
const DIAG = [
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/** Псевдоходы стороны c. */
export function pseudo(b: string[], c: number, out: Move[] = []): Move[] {
  const mine = (q: number) => b[q] !== '' && colorOf(b[q]) === c;
  for (let p = 0; p < N; p++) {
    if (!mine(p)) continue;
    const k = kindOf(b[p]);
    const f = fileOf(p);
    const r = rankOf(p);
    const add = (q: number) => {
      if (q >= 0 && !mine(q)) out.push({ from: p, to: q });
    };
    switch (k) {
      case 'K':
      case 'A':
        for (const [df, dr] of ORTHO) {
          const q = at(f + df, r + dr);
          if (q >= 0 && inPalaceOf(q, c)) add(q);
        }
        for (const [df, dr] of DIAG) {
          const q = at(f + df, r + dr);
          if (q >= 0 && inPalaceOf(q, c) && palaceDiag(p, q)) add(q);
        }
        break;
      case 'H':
        for (const [df, dr] of ORTHO) {
          const leg = at(f + df, r + dr);
          if (leg < 0 || b[leg]) continue;
          for (const s of [-1, 1]) add(dr === 0 ? at(f + 2 * df, r + s) : at(f + s, r + 2 * dr));
        }
        break;
      case 'E':
        for (const [df, dr] of ORTHO) {
          const leg = at(f + df, r + dr);
          if (leg < 0 || b[leg]) continue;
          for (const s of [-1, 1]) {
            const [ddf, ddr] = dr === 0 ? [df, s] : [s, dr];
            const mid = at(f + df + ddf, r + dr + ddr);
            if (mid < 0 || b[mid]) continue;
            add(at(f + df + 2 * ddf, r + dr + 2 * ddr));
          }
        }
        break;
      case 'R':
      case 'C': {
        const lines: number[][] = ORTHO.map(([df, dr]) => {
          const ray: number[] = [];
          for (let q = at(f + df, r + dr); q >= 0; q = at(fileOf(q) + df, rankOf(q) + dr)) ray.push(q);
          return ray;
        });
        // диагонали дворца: из угла через центр в противоположный угол, из центра — в углы
        if (inAnyPalace(p))
          for (const [df, dr] of DIAG) {
            const ray: number[] = [];
            let cur = p;
            for (;;) {
              const q = at(fileOf(cur) + df, rankOf(cur) + dr);
              if (q < 0 || !palaceDiag(cur, q)) break;
              ray.push(q);
              cur = q;
            }
            if (ray.length) lines.push(ray);
          }
        for (const ray of lines) {
          if (k === 'R') {
            for (const q of ray) {
              if (b[q]) {
                add(q);
                break;
              }
              out.push({ from: p, to: q });
            }
          } else {
            let i = 0;
            while (i < ray.length && !b[ray[i]]) i++;
            if (i >= ray.length || kindOf(b[ray[i]]) === 'C') continue; // нет лафета или лафет — пушка
            for (let j = i + 1; j < ray.length; j++) {
              const q = ray[j];
              if (b[q]) {
                if (kindOf(b[q]) !== 'C') add(q);
                break;
              }
              out.push({ from: p, to: q });
            }
          }
        }
        break;
      }
      case 'P': {
        const dir = c === 0 ? 1 : -1;
        add(at(f, r + dir));
        add(at(f - 1, r));
        add(at(f + 1, r));
        // в чужом дворце — по диагонали вперёд
        for (const df of [-1, 1]) {
          const q = at(f + df, r + dir);
          if (q >= 0 && palaceDiag(p, q)) add(q);
        }
        break;
      }
    }
  }
  return out;
}

export const generalSq = (b: string[], c: number) => b.indexOf(side(c, 'K'));
export function inCheck(b: string[], c: number): boolean {
  const g = generalSq(b, c);
  return g < 0 || pseudo(b, 1 - c).some((m) => m.to === g);
}
/** Генералы на одной вертикали без фигур между ними. */
export function facing(b: string[]): boolean {
  const g = generalSq(b, 0);
  const o = generalSq(b, 1);
  if (g < 0 || o < 0 || fileOf(g) !== fileOf(o)) return false;
  for (let q = g + FILES; q < o; q += FILES) if (b[q]) return false;
  return true;
}
export function playBoard(b: string[], m: Move): string[] {
  const n = b.slice();
  n[m.to] = n[m.from];
  n[m.from] = '';
  return n;
}
export function legalMoves(b: string[], c: number): Move[] {
  return pseudo(b, c).filter((m) => !inCheck(playBoard(b, m), c));
}

export const VALUE: Record<string, number> = { R: 13, C: 7, H: 5, E: 3, A: 3, P: 2, K: 0 };
export function points(b: string[]): [number, number] {
  const s: [number, number] = [0, 1.5];
  for (const x of b) if (x) s[colorOf(x)] += VALUE[kindOf(x)];
  return s;
}

// ---------------------------------------------------------------- партия

export function newState(cfg: Cfg): State {
  const s: State = { cfg, board: startBoard(cfg.setup), turn: 0, passes: 0, bik: -1, keys: [], ply: 0, captured: [[], []], last: null, over: false, winner: null, reason: null, score: null };
  s.keys = [key(s)];
  return s;
}
export const setup = (opts: Options) => newState(cfgFrom(opts));
export const key = (s: { board: string[]; turn: number }) => s.board.map((x) => x || '.').join('') + s.turn;
export const toAct = (s: State) => (s.over ? [] : [s.turn]);
export const canPass = (s: State) => !s.over && !inCheck(s.board, s.turn);
export const legal = (s: State) => (s.over ? [] : legalMoves(s.board, s.turn));
export const MAX_PLY = 300;

function finish(s: State, winner: number | null, reason: EndReason, ev: Event[]) {
  s.over = true;
  s.reason = reason;
  if (reason === 'points' || reason === 'bikjang' || reason === 'repetition') {
    s.score = points(s.board);
    winner = s.score[0] > s.score[1] ? 0 : 1;
  }
  s.winner = winner;
  ev.push({ type: 'end', winner, reason, score: s.score });
}

export function apply(s0: State, seat: number, a: Action): { state: State; events: Event[] } | null {
  if (s0.over || seat !== s0.turn || !a) return null;
  const ev: Event[] = [];
  if (a.type === 'resign') {
    const s = { ...s0 };
    finish(s, 1 - seat, 'resign', ev);
    return { state: s, events: ev };
  }
  if (a.type === 'pass') {
    if (!canPass(s0)) return null;
    const s: State = { ...s0, turn: (1 - seat) as 0 | 1, passes: s0.passes + 1, ply: s0.ply + 1, last: null };
    ev.push({ type: 'pass', seat });
    // бикджан не разорван пропуском — по очкам; оба пропустили — тоже
    if (s0.bik === 1 - seat || s.passes >= 2) finish(s, null, s0.bik === 1 - seat ? 'bikjang' : 'points', ev);
    return { state: s, events: ev };
  }
  const m = legalMoves(s0.board, seat).find((x) => x.from === a.from && x.to === a.to);
  if (!m) return null;
  const piece = s0.board[m.from];
  const captured = s0.board[m.to];
  const board = playBoard(s0.board, m);
  const s: State = { ...s0, board, turn: (1 - seat) as 0 | 1, passes: 0, ply: s0.ply + 1, last: m, captured: [s0.captured[0].slice(), s0.captured[1].slice()] };
  if (captured) s.captured[seat].push(captured);
  const check = inCheck(board, 1 - seat);
  const bik = facing(board);
  // соперник не разорвал бикджан — партия по очкам
  if (s0.bik === 1 - seat && bik) {
    ev.push({ type: 'move', seat, from: m.from, to: m.to, piece, captured, check, bik });
    finish(s, null, 'bikjang', ev);
    return { state: s, events: ev };
  }
  s.bik = bik ? seat : -1;
  const k = key(s);
  s.keys = captured ? [k] : [...s0.keys, k];
  ev.push({ type: 'move', seat, from: m.from, to: m.to, piece, captured, check, bik });
  if (check && !legalMoves(board, 1 - seat).length) finish(s, seat, 'mate', ev);
  else if (s.keys.filter((x) => x === k).length >= 3) finish(s, null, 'repetition', ev);
  else if (s.ply >= MAX_PLY) finish(s, null, 'points', ev);
  return { state: s, events: ev };
}
