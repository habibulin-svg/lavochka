/* «Полёт» — боты. Выбора в игре почти нет: крутить стрелку и переставлять самолёт на подсвеченную точку. Уровни
 * различаются знаниями — как часто бот верно отвечает на вопросы о пиктограммах и сигналах (60 / 80 / 95 %). */
import type { Rng } from '../../core/types';
import { legal, rightAnswer, type Action, type State } from './engine';

const SURE = [0.6, 0.8, 0.95];

export function choose(v: State, seat: number, level: number, rng: Rng): Action | null {
  const acts = legal(v, seat);
  if (!acts.length) return null;
  if (v.phase === 'question' && v.question) {
    const q = v.question;
    const right = rightAnswer(q);
    if (rng.next() < (SURE[level] ?? 0.8)) return { type: 'answer', i: right };
    const wrong = q.options.map((_, i) => i).filter((i) => i !== right);
    return { type: 'answer', i: wrong[rng.int(wrong.length)] };
  }
  return acts[0];
}
