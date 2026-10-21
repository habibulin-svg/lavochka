/* Шахматы — Михалыч за доской в партии с компьютером: «Как я сходил?» (оценка до и после хода по Stockfish),
 * «Подскажи» (лучший ход — Михалыч даёт намёк) и разговор. По сети и вдвоём за одним экраном не показывается:
 * подсказки против живого соперника — нечестно. В Фишере 960 молчит (движку нужна другая запись рокировки). */
import { levelOf, mountMihalych, type MihalychEngine } from './mihalych';
import { legalMoves, newGame, play, san, type State } from './engine';
import { fromUci, lineRu, position as newPos, ruSan, toFen } from './notation';
import { evalText, stockfish } from './stockfish';
import { loadProgress } from '../kruzhok/progress';

/** Позиции партии с начала: fens[i] — до i-го хода. */
function replay(st: State): string[] | null {
  let s = newGame(st.cfg, st.sp);
  const fens = [toFen(s)];
  for (const rec of st.moves) {
    const m = legalMoves(s).find((x) => x.from === rec.from && (x.to === rec.to || x.rook === rec.to) && (!x.promo || san(s, x) === rec.san)) ?? null;
    if (!m) return null;
    s = play(s, m);
    fens.push(toFen(s));
  }
  return fens;
}

const sideName = (t: number) => (t === 0 ? 'белые' : 'чёрные');

export function mountCoach(host: HTMLElement, mySeat: number, getState: () => State | null) {
  const mh = mountMihalych(host, () => {
    const st = getState();
    const fen = st ? toFen(st) : undefined;
    return {
      where: 'game',
      level: levelOf(loadProgress().rating.r),
      fen,
      side: st ? sideName(st.turn) : undefined,
      moves: st ? st.moves.slice(-10).map((m) => m.san).join(' ') : undefined,
    };
  });

  /** Мой последний ход: оценка до и после, лучший ход и ответ соперника. */
  const review = async (): Promise<MihalychEngine> => {
    const st = getState();
    if (!st) return {};
    const fens = replay(st);
    let i = st.moves.length - 1;
    while (i >= 0 && st.moves[i].seat !== mySeat) i--;
    if (!fens || i < 0) return {};
    const before = await stockfish.analyse(fens[i], { depth: 13, ms: 2500, cancel: true });
    const after = await stockfish.analyse(fens[i + 1], { depth: 13, ms: 2500 });
    const bm = before.best ? fromUci(newPos(fens[i]), before.best) : null;
    return {
      at: fens[i],
      played: st.moves[i].san,
      before: before.lines[0] ? evalText(before.lines[0]) + ' (за белых)' : undefined,
      after: after.lines[0] ? evalText(after.lines[0]) + ' (за белых)' : undefined,
      best: bm ? ruSan(newPos(fens[i]), bm) : undefined,
      line: before.lines[0] ? lineRu(fens[i], before.lines[0].pv, 6) : undefined,
      reply: after.lines[0] ? lineRu(fens[i + 1], after.lines[0].pv, 4) : undefined,
    };
  };

  const hint = async (): Promise<MihalychEngine> => {
    const st = getState();
    if (!st) return {};
    const fen = toFen(st);
    const a = await stockfish.analyse(fen, { depth: 14, ms: 3000, cancel: true });
    const m = a.best ? fromUci(st, a.best) : null;
    return { best: m ? ruSan(st, m) : undefined, line: a.lines[0] ? lineRu(fen, a.lines[0].pv, 6) : undefined, eval: a.lines[0] ? evalText(a.lines[0]) + ' (за белых)' : undefined };
  };

  return {
    /** Позиция сменилась: какие вопросы сейчас уместны. */
    update() {
      const st = getState();
      if (!st || st.cfg.variant === '960') return mh.actions([]);
      const mine = st.moves.some((m) => m.seat === mySeat);
      mh.actions([
        ...(mine ? [{ label: 'Как я сходил?', kind: 'review' as const, say: 'Михалыч, как тебе мой последний ход?', engine: review }] : []),
        ...(st.phase === 'play' && st.turn === mySeat ? [{ label: 'Что тут делать?', kind: 'hint' as const, say: 'Михалыч, о чём тут думать?', engine: hint }] : []),
      ]);
      mh.typed({ kind: 'chat', engine: hint });
    },
    destroy() {
      stockfish.stop();
      mh.destroy();
    },
  };
}

