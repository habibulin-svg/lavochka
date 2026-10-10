/* Балда — боты. Перебор: для каждой открытой клетки и каждой буквы ищем цепочки по полю, отсекая по префиксам словаря.
 *   Лёгкий — знает в основном короткие слова (до 4–5 букв) и берёт случайное;
 *   Средний — выбирает среди длинных, но не всегда самое длинное;
 *   Сложный — самое длинное; при равенстве — то, после которого сопернику хуже (смотрит его лучший ответ). */
import type { Rng } from '../../core/types';
import { ALPHABET, hasPrefix, hasWord } from '../../words/dict';
import { neighbors, openCells, type Action, type Cfg, type State } from './engine';

export interface Found {
  cell: number;
  letter: string;
  path: number[];
  word: string;
}

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
export const tuning = { fast: !!env?.VITEST && !env?.SIM_GAMES };

const nbCache = new Map<string, number[][]>();
function nbs(cfg: Cfg): number[][] {
  const key = `${cfg.size}:${cfg.diag}`;
  let v = nbCache.get(key);
  if (!v) {
    v = [...Array(cfg.size * cfg.size).keys()].map((c) => neighbors(cfg, c));
    nbCache.set(key, v);
  }
  return v;
}

/** Все допустимые ходы (по одному пути на слово). Открытая клетка в обходе — «любая буква»: ветвимся по буквам прямо в ней,
 *  поэтому пути, которые её не задевают, проходятся один раз, а не на каждую букву. */
export function allMoves(s: State, letters = ALPHABET): Found[] {
  const cfg = s.cfg;
  const nb = nbs(cfg);
  const g = s.grid;
  const used = new Set(s.used);
  const out = new Map<string, Found>();
  const path: number[] = [];
  const inPath = new Uint8Array(g.length);
  for (const cell of openCells(s)) {
    let letter = '';
    const step = (c: number, w: string, has: boolean) => {
      if (!hasPrefix(w)) return;
      path.push(c);
      inPath[c] = 1;
      if (has && w.length >= cfg.min && !used.has(w) && !out.has(w) && hasWord(w)) out.set(w, { cell, letter, path: path.slice(), word: w });
      for (const x of nb[c]) if (!inPath[x] && (g[x] || (x === cell && !has))) visit(x, w, has);
      path.pop();
      inPath[c] = 0;
    };
    const visit = (c: number, pre: string, has: boolean) => {
      if (c !== cell) return step(c, pre + g[c], has);
      for (const L of letters) {
        letter = L;
        step(c, pre + L, true);
      }
    };
    for (let c = 0; c < g.length; c++) if (g[c] || c === cell) visit(c, '', false);
  }
  return [...out.values()];
}

const pick = <T>(a: T[], rng: Rng) => a[rng.int(a.length)];

function bestReply(s: State, mv: Found): number {
  const t: State = { ...s, grid: s.grid.slice(), used: [...s.used, mv.word] };
  t.grid[mv.cell] = mv.letter;
  let best = 0;
  for (const m of allMoves(t)) best = Math.max(best, m.word.length);
  return best;
}

export function choose(s: State, _seat: number, level: number, rng: Rng): Action {
  const moves = allMoves(s);
  if (!moves.length) return { type: 'pass' };
  const act = (m: Found): Action => ({ type: 'word', cell: m.cell, letter: m.letter, path: m.path });
  if (level <= 0) {
    // лёгкий: «словарный запас» поменьше
    const cap = 4 + rng.int(2);
    const known = moves.filter((m) => m.word.length <= cap);
    return act(pick(known.length ? known : moves, rng));
  }
  moves.sort((a, b) => b.word.length - a.word.length);
  const top = moves[0].word.length;
  if (level === 1) {
    const pool = moves.filter((m) => m.word.length >= top - 1 - rng.int(2));
    return act(pick(pool, rng));
  }
  const bestOnes = moves.filter((m) => m.word.length === top);
  if (tuning.fast || bestOnes.length === 1) return act(pick(bestOnes, rng));
  const cand = bestOnes.length > 6 ? bestOnes.sort(() => rng.next() - 0.5).slice(0, 6) : bestOnes;
  let choice = cand[0];
  let worst = Infinity;
  for (const m of cand) {
    const r = bestReply(s, m);
    if (r < worst) {
      worst = r;
      choice = m;
    }
  }
  return act(choice);
}
