/* Учебник — позиции шагов урока (без DOM: им пользуются и экран урока, и проверка tools/kruzhok/lessons-check.ts). */
import { legalMoves, play, sq, type State } from '../chess/engine';
import { fromUci, position, START_FEN, toFen } from '../chess/notation';
import type { Lesson } from './data';

/** Позиция в начале каждого шага: своя (fen) или та, что сложилась после прошлого шага. */
export function stepPositions(l: Lesson): string[] {
  const out: string[] = [];
  let fen = l.steps[0]?.fen ?? START_FEN;
  for (const st of l.steps) {
    // «собери звёздочки» — своя доска без королей; следующий шаг продолжает прежнюю позицию
    if (st.stars) {
      out.push(st.fen ?? fen);
      continue;
    }
    if (st.fen) fen = st.fen;
    out.push(fen);
    let s = position(fen);
    for (const u of [...(st.play ?? []), ...(st.try ? [st.try.good[0], ...(st.try.reply ? [st.try.reply] : [])] : [])]) {
      const m = fromUci(s, u);
      if (!m) break;
      s = play(s, m);
    }
    fen = toFen(s);
  }
  return out;
}

/** «Собери звёздочки»: ходят только белые — после хода очередь снова их, чёрные фигуры стоят как мишени. */
export function whiteAgain(s: State): State {
  return { ...s, turn: 0, ep: -1, keys: [], moves: [] };
}

/** Упражнение кончено: звёзд не осталось и чёрных фигур тоже. */
export const starsDone = (s: State, left: number[]) => !left.length && !s.board.some((p) => p && p === p.toLowerCase());

/** Сколько ходов нужно самое меньшее (поиск в ширину; -1 — не собрать за limit ходов). */
export function starsBest(fen: string, at: string[], limit = 40): number {
  const start = whiteAgain(position(fen));
  const all = at.map(sq);
  const key = (s: State, left: number[]) => s.board.join(',') + '|' + left.join(',');
  let front: [State, number[]][] = [[start, all]];
  const seen = new Set([key(start, all)]);
  for (let d = 0; d <= limit; d++) {
    const next: [State, number[]][] = [];
    for (const [s, left] of front) {
      if (starsDone(s, left)) return d;
      for (const m of legalMoves(s)) {
        if (m.promo && m.promo !== 'Q') continue;
        const t = whiteAgain(play(s, m));
        const l = left.filter((x) => x !== m.to);
        const k = key(t, l);
        if (seen.has(k)) continue;
        seen.add(k);
        next.push([t, l]);
      }
    }
    if (!next.length) return -1;
    front = next;
  }
  return -1;
}
