/* «Доиграй против движка» — общее для урока (шаг fight) и партии мастера (добить сдавшегося):
 * ученик ведёт позицию за сторону, чей ход, Stockfish отвечает; упустил выигрыш (или ничью) — сначала. */
import { Sound } from '../../core/audio';
import { esc, sleep } from '../../core/util';
import type { Arrow, Board, Mark } from '../chess/board';
import { inCheck, insufficient, legalMoves, play, type State } from '../chess/engine';
import { fromUci, position, toFen } from '../chess/notation';
import { score, stockfish } from '../chess/stockfish';

export interface FightGoal {
  /** queen — провести пешку в ферзи (и не отдать), mate — поставить мат, draw — продержаться moves ходов или добиться ничьей. */
  goal: 'queen' | 'mate' | 'draw';
  moves?: number;
  say?: string;
  hint?: string;
}

export interface FightOpts extends FightGoal {
  board: Board;
  fen: string;
  /** Текст задания над счётчиком (HTML). */
  text: string;
  arrows?: Arrow[];
  marks?: Mark[];
  /** Экран ещё тот же (не ушли на другой шаг или раздел). */
  live: () => boolean;
  tell: (html: string, kind?: 'ok' | 'bad' | 'info') => void;
  buttons: (list: { text: string; primary?: boolean; on: () => void }[]) => void;
  /** Конец попытки: ok — получилось. */
  onEnd?: (ok: boolean) => void;
  /** Свои кнопки после конца (кроме «Ещё раз»/«Сначала»). */
  extra?: { text: string; primary?: boolean; on: () => void }[];
}

/** Конец по правилам: мат, пат, голые короли. null — играем дальше. */
const over = (x: State): 'mate' | 'draw' | null => (legalMoves(x).length ? (insufficient(x.board) ? 'draw' : null) : inCheck(x) ? 'mate' : 'draw');

/** Запустить; вернёт «прервать» (ответы движка после него не придут на доску). */
export function runFight(o: FightOpts): () => void {
  const me = position(o.fen).turn;
  const need = o.moves ?? 12;
  const goal = o.goal === 'queen' ? 'Проведи пешку в ферзи' : o.goal === 'mate' ? 'Поставь мат' : `Продержись ${need} ходов`;
  let s = position(o.fen);
  let n = 0;
  let run = 0;
  const live = (id: number) => id === run && o.live();
  o.board.flip(me === 1);
  /** Оценка за ученика: мат — ±10000. */
  const mine = (a: { lines: { cp: number; mate: number | null }[] }) => (a.lines[0] ? score(a.lines[0]) * (me === 0 ? 1 : -1) : 0);
  const status = (extra = '') => o.tell(`${o.text}<br><small>${goal} против движка · твоих ходов: <b>${n}</b></small>${extra}`);
  const extra = o.extra ?? [];
  const end = (ok: boolean, why: string) => {
    o.board.input(null);
    if (ok) {
      Sound.win();
      o.tell(`<b>Получилось!</b> ${why}${o.say ? ' ' + esc(o.say) : ''}`, 'ok');
      o.buttons([{ text: '↻ Ещё раз', on: start }, ...extra]);
    } else {
      Sound.nomove();
      o.tell(`${why} Попробуй сначала.${o.hint ? ' ' + esc(o.hint) : ''}`, 'bad');
      o.buttons([{ text: '↻ Сначала', primary: true, on: start }, ...extra]);
    }
    o.onEnd?.(ok);
  };
  const turn = () =>
    o.board.input(me, async (m) => {
      const id = run;
      if (!live(id)) return;
      n++;
      s = play(s, m);
      o.board.set(s, { from: m.from, to: m.to });
      o.board.draw();
      m.captured ? Sound.capture() : Sound.place();
      o.board.input(null);
      const e = over(s);
      if (e === 'mate') return end(true, 'Мат!');
      if (e === 'draw') return o.goal === 'draw' ? end(true, 'Ничья — ты устоял.') : end(false, 'Ничья — а была победа.');
      status('<br>Движок думает…');
      let a;
      try {
        a = await stockfish.analyse(toFen(s), { depth: 16, ms: 1500 });
      } catch {
        return live(id) ? status('<br>Движок не запустился — проверь связь и нажми «Сначала».') : undefined;
      }
      if (!live(id)) return;
      const v = mine(a);
      if (o.goal === 'queen' && m.promo) return v >= 400 ? end(true, 'Пешка стала ферзём, и удержать его соперник не может.') : end(false, 'Ферзь появился, да сразу пропадает.');
      if (o.goal !== 'draw' && v < 150) return end(false, 'Этим ходом выигрыш упущен — теперь движок спасается.');
      if (o.goal === 'draw' && v < -400) return end(false, 'Позиция уже проиграна.');
      if (o.goal === 'draw' && n >= need) return end(true, `Продержался ${need} ходов — позиция ничейная.`);
      const r = a.best ? fromUci(s, a.best) : null;
      if (!r) return end(o.goal === 'draw', 'Движку нечем ходить.');
      await sleep(300);
      if (!live(id)) return;
      s = play(s, r);
      o.board.set(s, { from: r.from, to: r.to });
      r.captured ? Sound.capture() : Sound.place();
      const e2 = over(s);
      if (e2 === 'mate') return end(false, 'Мат тебе.');
      if (e2 === 'draw') return o.goal === 'draw' ? end(true, 'Ничья — ты устоял.') : end(false, 'Ничья — а была победа.');
      status();
      turn();
    });
  const start = () => {
    if (!o.live()) return;
    run++;
    s = position(o.fen);
    n = 0;
    o.board.set(s);
    o.board.draw(o.arrows, o.marks);
    status();
    o.buttons([{ text: '↻ Сначала', on: start }, ...(o.hint ? [{ text: '💡 Подсказка', on: () => status(`<br>${esc(o.hint!)}`) }] : []), ...extra]);
    turn();
  };
  start();
  return () => {
    run++;
    o.board.input(null);
  };
}
