/* Учебник — позиции шагов урока (без DOM: им пользуются и экран урока, и проверка tools/kruzhok/lessons-check.ts). */
import { play } from '../chess/engine';
import { fromUci, position, START_FEN, toFen } from '../chess/notation';
import type { Lesson } from './data';

/** Позиция в начале каждого шага: своя (fen) или та, что сложилась после прошлого шага. */
export function stepPositions(l: Lesson): string[] {
  const out: string[] = [];
  let fen = l.steps[0]?.fen ?? START_FEN;
  for (const st of l.steps) {
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
