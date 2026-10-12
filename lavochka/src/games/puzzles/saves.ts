/* «Головоломки» — недорешённые и решённые на этом устройстве. Головоломку задают настройки и сид, поэтому хранится
 * только строка введённого: продолжить можно и одному, и снова за сетевым столом. */
import { store } from '../../core/settings';
import { allClues } from '../../words/clues';
import type { Options } from '../../core/types';
import { CROSS_SIZES, KIND_LABEL, PICROSS_LEVELS, SCAN_SIZES, SUDOKU_LEVELS, WORD_LEVELS, type State } from './engine';

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
  /** Кроссворд/сканворд: размер базы вопросов — с другой базой тот же номер сложится иначе. */
  base?: number;
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
  const lv = (s.kind === 'sudoku' ? SUDOKU_LEVELS : s.kind === 'picross' ? PICROSS_LEVELS : WORD_LEVELS)[s.level - 1] ?? '';
  const size =
        s.kind === 'sudoku'
      ? ''
      : s.kind === 'picross'
        ? ` ${s.size.replace('x', '×')}`
        : s.kind === 'crossword'
          ? ` на ${CROSS_SIZES[s.size]?.target ?? ''} слов`
          : ` ${SCAN_SIZES[s.size]?.w ?? ''}×${SCAN_SIZES[s.size]?.h ?? ''}`;
  return `${KIND_LABEL[s.kind]}${size} · ${lv.toLowerCase()} · № ${s.seed}`;
}

export function optsOf(s: Pick<State, 'kind' | 'size' | 'level' | 'seed'>): Options {
  if (s.kind === 'crossword') return { kind: s.kind, cSize: s.size, cLevel: s.level, seed: s.seed };
  if (s.kind === 'scanword') return { kind: s.kind, scSize: s.size, scLevel: s.level, seed: s.seed };
  return s.kind === 'sudoku' ? { kind: s.kind, sLevel: s.level, seed: s.seed } : { kind: s.kind, pSize: s.size, pLevel: s.level, seed: s.seed };
}

export function listSaves(): SaveEntry[] {
  return Object.values(store.get<Record<string, SaveEntry>>(SAVES, {})).sort((a, b) => b.at - a.at);
}

export function getSave(key: string): SaveEntry | null {
  return store.get<Record<string, SaveEntry>>(SAVES, {})[key] ?? null;
}

/** Сохранение ещё можно продолжить (для слов — база та же). */
export const resumable = (e: SaveEntry) => e.base == null || e.base === allClues().length;

export function putSave(e: SaveEntry) {
  const all = store.get<Record<string, SaveEntry>>(SAVES, {});
  if ((e.opts.kind === 'crossword' || e.opts.kind === 'scanword') && e.base == null) e.base = allClues().length;
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
