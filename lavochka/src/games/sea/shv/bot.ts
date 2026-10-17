/* «Путешествие в Швамбранию» — боты. Лёгкий отвечает на вопросники через раз и выбирает пути наугад;
 * средний знает больше слов и откупается от пиратов; сложный считает путь: Южным проливом короче даже с риском
 * попасть под батареи, в Бухту Добычи — только когда кончаются марки, из плена — кратчайшим путём на север. */
import type { Rng } from '../../../core/types';
import { seatNow, type ShvAction, type ShvState } from './engine';
import { wordsFor } from './words';

const KNOW = [0.5, 0.72, 0.9];

export function chooseShv(s: ShvState, seat: number, level: number, rng: Rng): ShvAction | null {
  const sh = s.ships[seatNow(s)];
  const coin = () => rng.next() < 0.5;
  switch (s.phase) {
    case 'quiz':
      if (sh.quiz?.why === 'bay' && level >= 1 && sh.marks >= 12) return { type: 'pass' };
      return { type: 'qspin' };
    case 'answer': {
      const q = s.quiz!;
      const ws = wordsFor(q.book, q.q, q.letters);
      if (!ws.length || rng.next() >= KNOW[level]) return { type: 'giveup' };
      const w = ws[rng.int(ws.length)];
      return { type: 'answer', text: w.charAt(0).toUpperCase() + w.slice(1) };
    }
    case 'judge':
      return { type: 'judge', ok: true };
    case 'bayFail':
      return { type: 'bay', retry: level >= 1 ? sh.marks < 6 : coin() };
    case 'spin':
      return { type: 'spin' };
    case 'sail':
      return { type: 'sail' };
    case 'fork': {
      if (s.pending?.fork === 'n4') {
        const ice = level === 0 ? coin() : level === 1 ? rng.next() < 0.4 : false;
        return { type: 'fork', way: ice && (!s.frozen || sh.iceOk) ? 'ice' : 'south' };
      }
      const bay = level === 0 ? coin() : sh.marks < (level === 1 ? 8 : 6);
      return { type: 'fork', way: bay ? 'bay' : 'straight' };
    }
    case 'pirates':
      return { type: 'pirates', pay: level === 0 ? coin() : sh.marks >= 2 };
    case 'escape':
      return { type: 'escape', way: level === 0 ? (coin() ? 'N' : 'W') : level === 1 && s.pennant && coin() ? 'W' : 'N' };
    case 'tow':
      return { type: 'tow', yes: level === 0 ? coin() : sh.marks < (level === 1 ? 10 : 6) };
  }
  return null;
}
