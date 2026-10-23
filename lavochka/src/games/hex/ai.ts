/* Гекс — боты. Основа — случайные доигрывания: доску до конца заполняют камнями наугад (в гексе на полной доске всегда
 * есть победитель) и для каждой пустой клетки считают, как часто выигрывал тот, кому она досталась («все ходы как первый»).
 * Сверху — простые правила: выиграть одним ходом, закрыть выигрыш соперника, спасти «мост» (два своих камня через клетку
 * с двумя общими пустыми соседями — соперник занял один, берём второй).
 *   Лёгкий — мало доигрываний и шум, мосты не спасает;
 *   Средний — больше доигрываний, мост спасает через раз;
 *   Сложный — ещё больше доигрываний, мост спасает всегда. */
import type { Rng } from '../../core/types';
import { BLACK, canSwap, colorOf, connection, neighbors, WHITE, type Action, type State } from './engine';

/** Победитель заполненной доски: BLACK или WHITE. */
function fullWinner(b: number[], n: number): number {
  return connection(b, n, BLACK) ? BLACK : WHITE;
}

function winsAt(s: State, p: number, c: number): boolean {
  const b = s.board;
  b[p] = c;
  const ok = !!connection(b, s.n, c);
  b[p] = 0;
  return ok;
}

/** Ход, спасающий мост после хода соперника last (или -1). */
function saveBridge(s: State, c: number): number {
  const n = s.n;
  const L = s.last;
  if (L < 0) return -1;
  const mine = neighbors(n, L).filter((q) => s.board[q] === c);
  for (let i = 0; i < mine.length; i++)
    for (let j = i + 1; j < mine.length; j++) {
      const a = mine[i];
      const b = mine[j];
      if (neighbors(n, a).includes(b)) continue;
      const common = neighbors(n, a).filter((q) => q !== L && neighbors(n, b).includes(q));
      for (const q of common) if (!s.board[q]) return q;
    }
  return -1;
}

function center(n: number) {
  const c = (n - 1) / 2;
  return c * n + c;
}

function distCenter(n: number, p: number): number {
  const x = p % n;
  const y = (p - x) / n;
  const c = (n - 1) / 2;
  const dx = x - c;
  const dy = y - c;
  return (Math.abs(dx) + Math.abs(dy) + Math.abs(dx + dy)) / 2;
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.over || s.turn !== seat) return null;
  const n = s.n;
  const c = colorOf(seat);
  const o = c === BLACK ? WHITE : BLACK;
  const empty: number[] = [];
  for (let p = 0; p < n * n; p++) if (!s.board[p]) empty.push(p);
  if (!empty.length) return null;

  // первый ход: без обмена — в центр, с обменом — не слишком сильный, ближе к краю
  if (s.moves === 0) {
    if (!s.cfg.swap) return { type: 'play', p: center(n) };
    const ok = empty.filter((p) => {
      const d = distCenter(n, p);
      return d >= n / 4 && d <= n / 3 + 1;
    });
    return { type: 'play', p: ok[rng.int(ok.length)] };
  }
  // обмен: забрать сильный первый ход (близко к центру)
  if (canSwap(s)) {
    const near = distCenter(n, s.last) < n / 4;
    if (level === 0 ? rng.next() < 0.3 : near) return { type: 'swap' };
  }

  const board = s.board.slice();
  const t: State = { ...s, board };
  for (const p of empty) if (winsAt(t, p, c)) return { type: 'play', p };
  for (const p of empty) if (winsAt(t, p, o)) return { type: 'play', p };
  if (level > 0) {
    const br = saveBridge(s, c);
    if (br >= 0 && (level === 2 || rng.next() < 0.5)) return { type: 'play', p: br };
  }

  const tries = ([150, 1200, 3500][level] * 121) / (n * n);
  const wins = new Float64Array(n * n);
  const seen = new Float64Array(n * n);
  const cells = empty.slice();
  const b = board;
  for (let k = 0; k < tries; k++) {
    for (let i = cells.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      const x = cells[i];
      cells[i] = cells[j];
      cells[j] = x;
    }
    for (let i = 0; i < cells.length; i++) b[cells[i]] = i % 2 === 0 ? c : o;
    const won = fullWinner(b, n) === c;
    for (let i = 0; i < cells.length; i += 2) {
      seen[cells[i]]++;
      if (won) wins[cells[i]]++;
    }
    for (const p of cells) b[p] = 0;
  }
  let best = empty[0];
  let bv = -Infinity;
  for (const p of empty) {
    const v = seen[p] ? wins[p] / seen[p] : 0;
    const score = v + (level === 0 ? rng.next() * 0.25 : rng.next() * 0.001);
    if (score > bv) {
      bv = score;
      best = p;
    }
  }
  return { type: 'play', p: best };
}
