/* Шашки — боты: перебор альфа-бета, бой досчитывается до тишины (взятия обязательны — ветвей мало).
 *   Лёгкий — смотрит на ход-два вперёд, часто ошибается, с «фуком» иногда забывает бить;
 *   Средний — четыре полухода;
 *   Сложный — до восьми полуходов (с ограничением по числу позиций), ценит центр, дамки и тыл.
 * В поддавках оценка наоборот: чем меньше своих шашек и ходов, тем лучше. */
import type { Rng } from '../../core/types';
import { colorOf, isKing, legalMoves, play, posKey, properMoves, RULES, type Action, type Move, type State } from './engine';

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
/** Быстрый прогон проверок: боты думают мельче. Тест силы включает полную глубину сам. */
export const tuning = { fast: !!env?.VITEST && !env?.SIM_GAMES };

const WIN = 100000;

/** Оценка позиции за белых. */
export function evaluate(s: Pick<State, 'board' | 'n' | 'cfg'>): number {
  const { board, n } = s;
  let sc = 0;
  if (s.cfg.giveaway) {
    // в поддавках важно избавиться от шашек; дамка — обуза, её трудно отдать
    for (const p of board) if (p) sc += (colorOf(p) === 0 ? -1 : 1) * (isKing(p) ? 160 : 100);
    return sc;
  }
  for (let sq = 0; sq < board.length; sq++) {
    const p = board[sq];
    if (!p) continue;
    const c = colorOf(p);
    const r = Math.floor(sq / n);
    const f = sq % n;
    const adv = c === 0 ? r : n - 1 - r;
    const center = Math.min(f, n - 1 - f);
    let v: number;
    if (isKing(p)) v = n === 10 ? 330 : RULES[s.cfg.variant].flying ? 300 : 200;
    else {
      v = 100 + adv * adv * (n === 8 ? 1.2 : 0.8) + center * 3;
      // тыл держит поля превращения, пока у соперника много шашек
      if (adv === 0) v += 6;
      // краевые шашки малоподвижны
      if (f === 0 || f === n - 1) v -= 4;
    }
    // столбовые: всё, что под верхней шашкой, — запас (свои) или пленные (чужие); и то и другое — в пользу хозяина башни
    if (p.length > 1) v += (p.length - 1) * 45 + [...p.slice(1)].filter((x) => colorOf(x) === c).length * 25;
    sc += c === 0 ? v : -v;
  }
  return sc;
}

interface Ctx {
  nodes: number;
  limit: number;
}

const persp = (s: State) => (s.turn === 0 ? 1 : -1) * evaluate(s);

/** Без ходов: в обычных — проигрыш, в поддавках — победа. */
const stuck = (s: State, ply: number) => (s.cfg.giveaway ? WIN - ply : -WIN + ply);

function search(s: State, depth: number, alpha: number, beta: number, ply: number, ctx: Ctx): number {
  ctx.nodes++;
  const ms = properMoves(s);
  if (!ms.length) return stuck(s, ply);
  const forced = ms[0].caps.length > 0;
  // тишина: досчитываем бой, дальше — оценка
  if (depth <= 0 && (!forced || depth < -8)) return persp(s);
  if (ms.length > 1) ms.sort((a, b) => b.caps.length - a.caps.length || +b.promo - +a.promo);
  for (const m of ms) {
    const v = -search(play(s, m), depth - 1, -beta, -alpha, ply + 1, ctx);
    if (v >= beta) return beta;
    if (v > alpha) alpha = v;
    if (ctx.nodes > ctx.limit) break;
  }
  return alpha;
}

function rootScores(s: State, depth: number, limit: number): { m: Move; v: number }[] {
  const ctx: Ctx = { nodes: 0, limit };
  const recent = s.keys.slice(-10);
  return properMoves(s)
    .map((m) => {
      const n = play(s, m);
      const v = -search(n, depth - 1, -WIN - 1, WIN + 1, 1, ctx);
      // повторять позицию — значит соглашаться на ничью
      return { m, v: recent.includes(posKey(n)) ? Math.min(v, 0) : v };
    })
    .sort((a, b) => b.v - a.v);
}

const toAction = (m: Move): Action => ({ type: 'move', from: m.from, path: m.path });

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.phase === 'over') return null;
  if (s.phase === 'draw') {
    const v = (seat === 0 ? 1 : -1) * evaluate(s);
    return { type: v < (level >= 2 ? -60 : -120) ? 'accept' : 'decline' };
  }
  if (s.turn !== seat) return null;
  // взять за фук: в обычных — почти всегда, в поддавках — никогда (это подарок сопернику)
  if (s.fuk.length && !s.cfg.giveaway && (level > 0 || rng.next() < 0.8)) return { type: 'fuk', sq: s.fuk[rng.int(s.fuk.length)] };
  const legal = properMoves(s);
  if (!legal.length) return null;
  if (legal.length === 1) return toAction(legal[0]);
  if (level === 0) {
    // с фуком лёгкий иногда «не видит» взятия
    if (s.cfg.fuk && legal[0].caps.length && rng.next() < 0.2) {
      const quiet = legalMoves(s).filter((m) => !m.caps.length);
      if (quiet.length) return toAction(quiet[rng.int(quiet.length)]);
    }
    if (rng.next() < 0.2) return toAction(legal[rng.int(legal.length)]);
    const sc = rootScores(s, 2, 1e9);
    const good = sc.filter((x) => x.v >= sc[0].v - 60);
    return toAction(good[rng.int(good.length)].m);
  }
  if (level === 1) {
    const sc = rootScores(s, tuning.fast ? 2 : 4, 40000);
    const good = sc.filter((x) => x.v >= sc[0].v - 12);
    return toAction(good[rng.int(good.length)].m);
  }
  const big = s.n > 8;
  const depth = tuning.fast ? 3 : big ? 6 : 8;
  const sc = rootScores(s, depth, tuning.fast ? 6000 : big ? 120000 : 200000);
  const top = sc.filter((x) => x.v >= sc[0].v - 4);
  return toAction(top[rng.int(top.length)].m);
}
