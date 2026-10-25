/* «Наша игротека» — боты. Общий перебор с альфа-бета (core/minimax), оценка — своя у каждой игры:
 *   ряды (так-тикль, квартет, хасами) — свои фишки в ещё не перекрытых рядах; волк — путь до нижнего ряда и подвижность;
 *   лиса и леопарды — съеденные, подвижность охотника и «подставленные» фишки; мельница и болотуду — фишки, «полумельницы»,
 *   подвижность; сенегальские, сиджа, алькуерк — разница фишек (снятых) и подвижность.
 *   Лёгкий — на 1 полуход с шумом; Средний — на 3; Сложный — на 5 (волк и овцы, так-тикль — глубже: ходов мало; сиджа, хасами — мельче: ходов много).
 * Турецкие шашки — бот «Шашек» (весь ход сразу). */
import { bestMove, type SearchGame } from '../../core/minimax';
import type { Rng } from '../../core/types';
import { choose as ckChoose } from '../checkers/ai';
import { count, G, legal, lines, moveCount, step, type Action, type State } from './engine';

const own = (seat: number) => seat + 1;

const mobility = (s: State, seat: number) => moveCount(s, seat);

/** Ряды: за каждый ряд без чужих фишек — растущий вес по числу своих. */
function lineScore(s: State, seat: number): number {
  let v = 0;
  for (const l of lines(s.cfg.game)) {
    let a = 0;
    let b = 0;
    for (const p of l) {
      if (s.board[p] === own(seat)) a++;
      else if (s.board[p]) b++;
    }
    if (a && !b) v += a * a * a;
    else if (b && !a) v -= b * b * b;
  }
  return v;
}

/** Волк: длина кратчайшего пути до нижнего ряда по пустым точкам (овец не двигаем); 99 — не пройти. */
function wolfDist(s: State): number {
  const g = G(s);
  const w = s.board.indexOf(1);
  if (w < 0) return 99;
  const dist = new Map<number, number>([[w, 0]]);
  const q = [w];
  while (q.length) {
    const p = q.shift()!;
    const d = dist.get(p)!;
    if (g.pts[p].r === 7) return d;
    for (const l of g.links[p]) if (!s.board[l.to] && !dist.has(l.to)) {
      dist.set(l.to, d + 1);
      q.push(l.to);
    }
  }
  return 99;
}

/** Сколько фишек соперника охотник может съесть прямо сейчас (точки под прыжком). */
function hanging(s: State, hunter: number): number {
  const t = { ...s, turn: hunter, take: 0, first: -1, hand: [0, 0] as [number, number] };
  const g = G(s);
  let n = 0;
  for (const a of legal(t)) if (a.type === 'move' && !g.links[a.from].some((l) => l.to === a.to)) n++;
  return n;
}

function score(s: State, me: number): number {
  if (s.over) return s.winner == null ? 0 : s.winner === me ? 10000 - s.ply : -10000 + s.ply;
  const sg = me === 0 ? 1 : -1; // оценки ниже — с точки зрения места 0
  const c = s.cfg;
  let v = 0;
  switch (c.game) {
    case 'sheep': {
      const d = wolfDist(s);
      v = (d >= 99 ? -400 : -d * 12) + mobility(s, 0) * 15;
      break;
    }
    case 'tickle':
    case 'quartet':
    case 'hasami':
      v = lineScore(s, 0) + (c.game === 'hasami' ? (count(s, 0) - count(s, 1)) * 30 : 0);
      if (c.game === 'hasami') {
        // продвижение к средним рядам
        const g = G(s);
        s.board.forEach((x, p) => {
          const r = g.pts[p].r;
          if (x === 1 && r <= 6 && r >= 2) v += 2;
          if (x === 2 && r <= 6 && r >= 2) v -= 2;
        });
      }
      break;
    case 'fox': {
      const geese = count(s, 0);
      v = geese * 60 - mobility(s, 1) * 12 - hanging(s, 1) * 25;
      // гуси держатся вместе и не отстают
      const g = G(s);
      s.board.forEach((x, p) => {
        if (x !== 1) return;
        for (const l of g.links[p]) if (!l.alt && s.board[l.to] === 1) v += 2;
      });
      break;
    }
    case 'leopards':
      v = s.caps[0] * 120 + mobility(s, 0) * 10 + hanging(s, 0) * 30;
      break;
    case 'mill':
    case 'bolotudu': {
      v = (count(s, 0) + s.hand[0] - count(s, 1) - s.hand[1]) * 100;
      if (c.game === 'mill') {
        for (const l of lines('mill')) {
          let a = 0;
          let b = 0;
          let e = 0;
          for (const p of l) {
            if (s.board[p] === 1) a++;
            else if (s.board[p] === 2) b++;
            else e++;
          }
          if (a === 2 && e === 1) v += 14;
          if (b === 2 && e === 1) v -= 14;
        }
      } else {
        // пары в ряд со свободной третьей клеткой
        const g = G(s);
        s.board.forEach((x, p) => {
          if (!x) return;
          for (const [dr, dc] of [
            [0, 1],
            [1, 0],
          ]) {
            const q = g.next(p, dr, dc);
            if (q >= 0 && s.board[q] === x) v += x === 1 ? 6 : -6;
          }
        });
      }
      if (s.take > 0) v += s.turn === 0 ? 80 : -80;
      if (s.hand[0] + s.hand[1] === 0) v += (mobility(s, 0) - mobility(s, 1)) * 3;
      break;
    }
    case 'senegal':
      v = (count(s, 0) - count(s, 1)) * 100 + (mobility(s, 0) - mobility(s, 1)) * 2;
      break;
    case 'sidja':
      v = (s.caps[0] - s.caps[1]) * 100;
      if (s.hand[0] + s.hand[1] === 0) v += (mobility(s, 0) - mobility(s, 1)) * 3;
      break;
    case 'alquerque':
      v = (count(s, 0) - count(s, 1)) * 100 + (mobility(s, 0) - mobility(s, 1)) * 2;
      break;
  }
  return v * sg;
}

const game: SearchGame<State, Action> = {
  moves: legal,
  play: (s, m) => step(s, m).state,
  side: (s) => s.turn,
  over: (s) => s.over,
  score,
  order: (s, m) => (m.type === 'take' ? 3 : m.type === 'move' && !G(s).links[m.from].some((l) => l.to === m.to) ? 2 : m.type === 'stop' ? 0 : 1),
};

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.over || s.turn !== seat) return null;
  if (s.cfg.game === 'turk') {
    if (!s.ck) return null;
    if (s.pend.length) {
      // начатый человеком ход доводить не придётся: бот ходит целиком
      const a = legal(s)[0];
      return a ?? null;
    }
    const a = ckChoose(s.ck, seat, level, rng);
    return a && a.type === 'move' ? { type: 'path', from: a.from, path: a.path } : null;
  }
  let depth = level <= 0 ? 1 : level === 1 ? 3 : 5;
  if (s.cfg.game === 'sheep' || s.cfg.game === 'tickle') depth = level <= 0 ? 2 : level === 1 ? 4 : 8;
  // много ходов у каждого — сложный смотрит мельче, чтобы думать не дольше секунды
  if (s.cfg.game === 'sidja' || s.cfg.game === 'hasami') depth = Math.min(depth, level === 1 ? 2 : 3);
  if (s.cfg.game === 'leopards' || s.cfg.game === 'mill') depth = Math.min(depth, 4);
  // в расстановке ходов много — смотрим мельче
  if (s.hand[0] + s.hand[1] > 0 && depth > 3) depth = 3;
  return bestMove(game, s, depth, rng, level <= 0 ? 120 : level === 1 ? 10 : 0);
}
