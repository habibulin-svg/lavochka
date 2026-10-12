/* «Головоломки» — недорешённые и решённые на этом устройстве. Головоломку задают настройки и сид, поэтому хранится
 * только строка введённого: продолжить можно и одному, и снова за сетевым столом. */
import { store } from '../../core/settings';
import type { Options } from '../../core/types';
import { KIND_LABEL, PICROSS_LEVELS, SUDOKU_LEVELS, type State } from './engine';

export interface SaveEntry {
  key: string;
  title: string;
  /** Настройки партии с сидом — для «Продолжить». */
  opts: Options;
  fill: string;
  /** 0…1 */
  progress: number;
  elapsed: number;
  at: number;
}

export interface SolvedEntry {
  title: string;
  elapsed: number;
  hints: number;
  at: number;
}

const SAVES = 'puzzles.saves';
const SOLVED = 'puzzles.solved';

export const keyOf = (s: Pick<State, 'kind' | 'size' | 'level' | 'seed'>) => `${s.kind}:${s.size}:${s.level}:${s.seed}`;

export function titleOf(s: Pick<State, 'kind' | 'size' | 'level' | 'seed'>): string {
  const lv = (s.kind === 'sudoku' ? SUDOKU_LEVELS : PICROSS_LEVELS)[s.level - 1] ?? '';
  const size = s.kind === 'sudoku' ? '' : ` ${s.size.replace('x', '×')}`;
  return `${KIND_LABEL[s.kind]}${size} · ${lv.toLowerCase()} · № ${s.seed}`;
}

export function optsOf(s: Pick<State, 'kind' | 'size' | 'level' | 'seed'>): Options {
  return s.kind === 'sudoku' ? { kind: s.kind, sLevel: s.level, seed: s.seed } : { kind: s.kind, pSize: s.size, pLevel: s.level, seed: s.seed };
}

export function listSaves(): SaveEntry[] {
  return Object.values(store.get<Record<string, SaveEntry>>(SAVES, {})).sort((a, b) => b.at - a.at);
}

export function getSave(key: string): SaveEntry | null {
  return store.get<Record<string, SaveEntry>>(SAVES, {})[key] ?? null;
}

export function putSave(e: SaveEntry) {
  const all = store.get<Record<string, SaveEntry>>(SAVES, {});
  all[e.key] = e;
  // не копим бесконечно: держим 40 последних
  const keys = Object.values(all)
    .sort((a, b) => b.at - a.at)
    .slice(40)
    .map((x) => x.key);
  for (const k of keys) delete all[k];
  store.set(SAVES, all);
}

export function dropSave(key: string) {
  const all = store.get<Record<string, SaveEntry>>(SAVES, {});
  delete all[key];
  store.set(SAVES, all);
}

export function addSolved(e: SolvedEntry) {
  const list = store.get<SolvedEntry[]>(SOLVED, []);
  list.unshift(e);
  store.set(SOLVED, list.slice(0, 30));
}

export function listSolved(): SolvedEntry[] {
  return store.get<SolvedEntry[]>(SOLVED, []);
}

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
