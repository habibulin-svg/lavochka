/* Шахматный кружок — свои партии ученика с компьютером (из «Шахмат»): последние 30 партий ходами и разбор ошибок
 * Stockfish в браузере. Нужны личному маршруту Михалыча (docs/analysis/chess-kruzhok.md, этап 7): какие ошибки
 * ученик делает чаще — зевает фигуры, упускает тактику или мат, путается в эндшпиле.
 * Разбор — по ходам ученика: насколько ход хуже лучшего; заметное ухудшение — ошибка, тип — по тому, что было и
 * что стало. Классификация — без DOM (classify), сам разбор — в браузере (reviewPending). */
import { store } from '../../core/settings';
import { play, type State } from '../chess/engine';
import { fromUci, position, START_FEN, toFen } from '../chess/notation';
import { touch } from './cloud';

export type MistakeKind = 'hang' | 'tactic' | 'mate' | 'endgame' | 'opening' | 'other';
export type Phase = 'opening' | 'middle' | 'end';

export interface Mistake {
  /** Номер полухода (позиция до хода — fens[ply]). */
  ply: number;
  kind: MistakeKind;
  phase: Phase;
  /** Потеря, сантипешки (мат — 1000). */
  loss: number;
}

export interface MyGame {
  at: number;
  /** За кого играл ученик: 0 — белые. */
  side: 0 | 1;
  /** 1 — победа ученика, 0.5 — ничья, 0 — поражение. */
  result: 1 | 0.5 | 0;
  moves: string[];
  /** Разбор (нет — ещё не разобрана). */
  review?: { mistakes: Mistake[]; mine: number };
}

const KEY = 'kruzhok.games';
const MAX = 30;

export const loadMyGames = () => store.get<MyGame[]>(KEY, []);
const saveMyGames = (g: MyGame[]) => {
  store.set(KEY, g.slice(-MAX));
  touch();
};

/** Записать законченную партию с компьютером (повтор той же партии не пишется). */
export function logMyGame(moves: string[], side: 0 | 1, winner: number | null) {
  if (moves.length < 8) return; // бросил в самом начале — не партия
  const all = loadMyGames();
  const last = all[all.length - 1];
  if (last && last.moves.join() === moves.join()) return;
  all.push({ at: Date.now(), side, result: winner == null ? 0.5 : winner === side ? 1 : 0, moves });
  saveMyGames(all);
}

/** Материал без королей: ферзь 9, ладья 5, лёгкие 3, пешка 1 — для фазы партии. */
function material(s: State): number {
  const V: Record<string, number> = { q: 9, r: 5, b: 3, n: 3, p: 1 };
  return s.board.reduce((a, p) => a + (p ? V[p.toLowerCase()] ?? 0 : 0), 0);
}

export const phaseOf = (ply: number, s: State): Phase => (ply < 20 ? 'opening' : material(s) <= 26 ? 'end' : 'middle');

/** Тип ошибки по оценкам (за ученика, мат — ±10000): before — лучшая до хода, after — после хода;
 * bestTakes — лучший ход что-то брал (упущенная тактика), replyTakes — лучший ответ соперника берёт (зевок). */
export function classify(o: { before: number; after: number; bestTakes: boolean; replyTakes: boolean; phase: Phase }): MistakeKind {
  if (o.before >= 9000 && o.after < 9000) return 'mate';
  if (o.after <= -9000 && o.before > -9000) return 'mate';
  if (o.replyTakes) return 'hang';
  if (o.bestTakes) return 'tactic';
  if (o.phase === 'end') return 'endgame';
  if (o.phase === 'opening') return 'opening';
  return 'other';
}

/** Порог ошибки: ход хуже лучшего на 1,5 пешки (в выигранной позиции — пока перевес не ушёл ниже +3). */
export function isMistake(before: number, after: number): boolean {
  if (before - after < 150) return false;
  if (before >= 600 && after >= 300 && before < 9000) return false;
  return true;
}

export interface Analyser {
  analyse(fen: string, o: { depth: number; ms: number }): Promise<{ best: string | null; lines: { cp: number; mate: number | null }[] }>;
}

const sc = (l?: { cp: number; mate: number | null }) => (l ? (l.mate != null ? Math.sign(l.mate) * (10000 - Math.abs(l.mate)) : l.cp) : 0);

/** Разобрать одну партию: оценка до и после каждого хода ученика. */
export async function reviewGame(g: MyGame, sf: Analyser, alive: () => boolean = () => true): Promise<MyGame['review'] | null> {
  let s = position(START_FEN);
  const mistakes: Mistake[] = [];
  let mine = 0;
  for (let i = 0; i < g.moves.length; i++) {
    const m = fromUci(s, g.moves[i]);
    if (!m) return null;
    if (s.turn === g.side) {
      if (!alive()) return null;
      mine++;
      const a = await sf.analyse(toFen(s), { depth: 10, ms: 400 });
      const next = play(s, m);
      const b = await sf.analyse(toFen(next), { depth: 10, ms: 400 });
      const before = sc(a.lines[0]);
      const after = -sc(b.lines[0]);
      if (isMistake(before, after)) {
        const best = a.best ? fromUci(s, a.best) : null;
        const reply = b.best ? fromUci(next, b.best) : null;
        const phase = phaseOf(i, s);
        mistakes.push({ ply: i, phase, loss: Math.min(1000, before - after), kind: classify({ before, after, bestTakes: !!best?.captured && best.to !== m.to, replyTakes: !!reply?.captured, phase }) });
      }
      s = next;
    } else s = play(s, m);
  }
  return { mistakes, mine };
}

/** Разобрать неразобранные партии (по одной, начиная с новых); onEach — после каждой. */
export async function reviewPending(sf: Analyser, alive: () => boolean, onEach?: () => void): Promise<number> {
  let n = 0;
  for (;;) {
    const all = loadMyGames();
    const i = all.map((g, k) => (g.review ? -1 : k)).filter((k) => k >= 0).pop();
    if (i == null || !alive()) return n;
    const r = await reviewGame(all[i], sf, alive);
    if (!alive()) return n;
    const fresh = loadMyGames();
    const j = fresh.findIndex((g) => g.at === all[i].at);
    if (j >= 0) {
      fresh[j].review = r ?? { mistakes: [], mine: 0 };
      saveMyGames(fresh);
    }
    n++;
    onEach?.();
  }
}
