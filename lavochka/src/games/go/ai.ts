/* Го — боты. Монте-Карло: для ходов-кандидатов (рядом с камнями, в начале — звёзды и центр) — случайные доигрывания до конца,
 * выбор по UCB1, итог — ход с лучшей долей побед. Бюджет — по времени (на 19×19 сильным не будет — честно сказано в правилах).
 *   Лёгкий — 0,25 с и только «на глазок»: снять камень в атари, спасти свой, иначе ход рядом;
 *   Средний — 0,7 с доигрываний;
 *   Сложный — 1,8 с.
 * Пасует, когда ходить некуда (только свои глаза) или соперник спасовал, а по доигрываниям партия выиграна. */
import type { Rng } from '../../core/types';
import { colorOf, group, hoshi, isEyeLike, isLegal, legalMoves, neighbors, other, place, playout, territory, tibetBonus, type Action, type State } from './engine';

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
const fast = !!env?.VITEST && !env?.SIM_GAMES;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Итог доигрыша для цвета c: 1 — победа (в тибетском го — с бонусом за центр и штрафом за углы). */
function result(s: State, b: number[], c: number): number {
  const t = territory(b, s.n);
  const tb = s.cfg.rules === 'tibetan' ? tibetBonus(t, s.center) : [0, 0];
  let blk = tb[0];
  let wht = s.komi + tb[1];
  for (const o of t) {
    if (o === 1) blk++;
    else if (o === 2) wht++;
  }
  if (blk === wht) return 0.5;
  const blackWins = blk > wht;
  return (c === 1) === blackWins ? 1 : 0;
}

function candidates(s: State): number[] {
  const n = s.n;
  const c = colorOf(s.turn);
  const all = legalMoves(s).filter((p) => !isEyeLike(s.board, n, p, c));
  if (n <= 9) return all;
  const stones = s.board.some((x) => x);
  if (!stones) return hoshi(n).filter((p) => all.includes(p));
  const near = new Set<number>();
  for (let p = 0; p < n * n; p++) {
    if (!s.board[p]) continue;
    const x = p % n;
    const y = (p - x) / n;
    for (let dy = -2; dy <= 2; dy++)
      for (let dx = -2; dx <= 2; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && yy >= 0 && xx < n && yy < n) near.add(yy * n + xx);
      }
  }
  for (const h of hoshi(n)) near.add(h);
  return all.filter((p) => near.has(p));
}

/** «На глазок»: снять камни в атари, увести свою группу из атари, иначе случайный ход рядом. */
function quick(s: State, cands: number[], rng: Rng): number {
  const n = s.n;
  const c = colorOf(s.turn);
  for (const p of cands) {
    const r = place(s.board, n, p, c);
    if (r && r.captured.length) return p;
  }
  for (const p of cands)
    for (const q of neighbors(n, p))
      if (s.board[q] === c && group(s.board, n, q).libs === 1) {
        const r = place(s.board, n, p, c);
        if (r && group(r.board, n, p).libs >= 2) return p;
      }
  return cands[rng.int(cands.length)];
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.over || s.turn !== seat) return null;
  const n = s.n;
  const c = colorOf(seat);
  if (fast) {
    // тесты: случайный законный ход не в своё око и не в свою территорию, иначе пас
    const t = territory(s.board, n);
    const order = Array.from({ length: n * n }, (_, i) => i);
    for (let k = order.length; k > 0; k--) {
      const i = rng.int(k);
      const p = order[i];
      order[i] = order[k - 1];
      if (s.board[p] || t[p] === c || isEyeLike(s.board, n, p, c)) continue;
      if (isLegal(s, p)) return { type: 'play', p };
    }
    return { type: 'pass' };
  }
  const cands = candidates(s);
  if (!cands.length) return { type: 'pass' };
  if (level === 0) {
    // лёгкий спасует, если соперник спасовал и ходы — только внутрь своей территории
    const t = territory(s.board, n);
    const useful = cands.filter((p) => t[p] !== c);
    if (!useful.length || (s.passes && rng.next() < 0.5)) return { type: 'pass' };
    return { type: 'play', p: quick(s, useful, rng) };
  }
  const budget = fast ? 0 : level === 1 ? 700 : 1800;
  const minRuns = fast ? Math.min(12, cands.length * 2) : cands.length;
  const wins = new Float64Array(cands.length);
  const runs = new Float64Array(cands.length);
  const t0 = now();
  let total = 0;
  // базовая оценка паса: кто выигрывает, если доиграть с текущей позиции
  let passWins = 0;
  let passRuns = 0;
  while (total < minRuns || now() - t0 < budget) {
    let i = 0;
    if (total < cands.length) i = total;
    else {
      let best = -1;
      for (let k = 0; k < cands.length; k++) {
        const u = wins[k] / runs[k] + Math.sqrt((2 * Math.log(total)) / runs[k]);
        if (u > best) {
          best = u;
          i = k;
        }
      }
    }
    const r = place(s.board, n, cands[i], c);
    const b = r ? playout(r.board, n, other(c), rng) : s.board;
    wins[i] += result(s, b, c);
    runs[i]++;
    total++;
    if (s.passes && total % 8 === 0) {
      passWins += result(s, playout(s.board, n, other(c), rng), c);
      passRuns++;
    }
    if (fast && total >= minRuns) break;
    if (total > 20000) break;
  }
  let bi = 0;
  for (let k = 1; k < cands.length; k++) if (wins[k] / runs[k] > wins[bi] / runs[bi]) bi = k;
  const rate = wins[bi] / runs[bi];
  // соперник спасовал, а мы и так выигрываем — пас, чтобы закончить партию
  if (s.passes && passRuns && passWins / passRuns >= Math.min(0.9, rate)) return { type: 'pass' };
  if (rate < 0.02 && s.moves > n * n) return { type: 'pass' };
  return { type: 'play', p: cands[bi] };
}
