/* В путь-дорогу — боты.
 * Главное решение — какого пешехода вести и куда: свой автобус каждый ход уезжает на клетку, а до своего следующего хода
 * он проедет столько клеток, сколько игроков за столом. Пешехода выгодно поставить туда, где автобус окажется «над ним»
 * в это окно. Лёгкий ходит наугад и иногда зевает посадку; Средний ставит под автобус ближайшего окна;
 * Сложный ещё считает, как пешеход догонит автобус в следующие ходы, и раньше выводит ребят из города. */
import type { Rng } from '../../core/types';
import { boardable, CELLS, CITY, legal, type Action, type State } from './engine';

/** Через сколько ходов автобусов (с учётом нынешнего) автобус встанет над клеткой c. */
const wait = (bus: number, c: number) => (((bus - c) % CELLS) + CELLS) % CELLS;

function walkScore(s: State, seat: number, a: Action & { type: 'walk' }, hard: boolean): number {
  const bus = s.bus[seat];
  if (bus < 0) return 0;
  const n = s.players;
  const w = wait(bus, a.to);
  let v = 0;
  if (w === 0) v += 100; // сразу под автобусом — садимся до его хода
  else if (w <= n) v += 70 - w; // автобус проедет над ним до нашего следующего хода
  else v += hard ? 30 - Math.min(w - n, 6) * 4 : -w;
  // остальные свои пешеходы, которых этот ход не трогает, — тоже в окне?
  if (hard) {
    const from = s.peds[seat][a.ped];
    if (from === CITY) v += 6; // вывести ребят пораньше — больше шансов
    for (let i = 0; i < s.peds[seat].length; i++) {
      if (i === a.ped) continue;
      const c = s.peds[seat][i];
      if (c >= 0 && wait(bus, c) <= n) v -= 3; // не тянуть одного, если другой и так дождётся
    }
  }
  return v;
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  const ms = legal(s, seat);
  if (!ms.length) return null;
  const board = ms.find((m) => m.type === 'board');
  if (board && boardable(s, seat).length) {
    if (level > 0 || rng.next() > 0.25) return board;
  }
  if (s.phase === 'board') return ms.find((m) => m.type === 'pass') ?? ms[0];
  if (s.phase !== 'walk') return ms.find((m) => m.type !== 'board') ?? ms[0];
  if (level <= 0) return ms[rng.int(ms.length)];
  let best: Action[] = [];
  let bv = -Infinity;
  for (const m of ms) {
    if (m.type !== 'walk') continue;
    const v = walkScore(s, seat, m, level >= 2) + rng.next() * (level === 1 ? 4 : 0.5);
    if (v > bv) {
      bv = v;
      best = [m];
    }
  }
  return best[0] ?? ms[0];
}

