/* Покер — сила стартовых рук и диапазоны для ботов (без DOM).
 *   prePct — место руки среди всех стартовых рук вида: 0 — лучшая, 1 — худшая (доля рук сильнее).
 *     Холдем — таблица tools/poker/preflop.ts (169 классов); Short Deck и пайнэппл — та же таблица на своей колоде
 *     (пайнэппл — лучшая пара из трёх); Омаха, Омаха-5, Куршевель — своя оценка «на глаз» (пары, одномастность,
 *     связанность, тузы; в хай-лоу — младшие с тузом); стад — первые три карты (две в стад-5), дро и лоуболл — сколько
 *     карт годится оставить; место — по выборке случайных рук.
 *   openWidth — какую долю рук открывать рейзом первым, по числу игроков позади (таблица-«чарт» для регуляра).
 *   madeStr — сила руки на доске 0…1 с учётом дро: по ней диапазон соперника сужается после его ставок. */
import type { Card } from '../../cards/deck';
import { allCards } from './hands';
import { CLASSES, classIndex, fastHigh, fastOmaha } from './eval';
import type { Game } from './engine';
import PRE from './data/preflop.json';

interface PreTable {
  classes: string[];
  pct: number[];
  push: Record<string, number[]>;
  call: Record<string, number[][]>;
}
export const PREFLOP = PRE as PreTable;
if (PREFLOP.classes.join() !== CLASSES.join()) throw new Error('preflop.json: другой порядок классов — пересчитай tools/poker/preflop.ts');

/** Холдем: место класса двух карт. */
export const holdemPct = (a: Card, b: Card) => PREFLOP.pct[classIndex(a, b)];

/** Омаха: оценка старта «на глаз» (больше — лучше). */
function omahaRaw(cs: Card[], hilo: boolean): number {
  const byR = new Map<number, number>();
  const byS = new Map<string, number[]>();
  for (const c of cs) {
    byR.set(c.r, (byR.get(c.r) ?? 0) + 1);
    byS.set(c.s, [...(byS.get(c.s) ?? []), c.r]);
  }
  let v = 0;
  for (const [r, n] of byR) {
    if (n === 2) v += r * 0.8;
    else if (n >= 3) v += r * 0.3 - 5;
  }
  for (const rs of byS.values()) {
    if (rs.length < 2) continue;
    const top = Math.max(...rs);
    v += 2 + top / 2 + (top === 14 ? 3 : 0) - (rs.length >= 3 ? (rs.length - 2) * 2 : 0);
  }
  const u = [...byR.keys()].sort((a, b) => b - a);
  for (let i = 0; i < u.length; i++)
    for (let j = i + 1; j < u.length; j++) {
      const g = u[i] - u[j];
      if (g <= 3) v += (4 - g) * 0.9;
    }
  v += cs.reduce((a, c) => a + c.r, 0) / 8;
  if (hilo) {
    const low = new Set(cs.map((c) => (c.r === 14 ? 1 : c.r)).filter((r) => r <= 8));
    v += low.size * 1.3 + (byR.has(14) ? 2.5 : 0) + (byR.has(2) || byR.has(3) ? 1.5 : 0);
  }
  return v;
}

/** Стад: первые карты (пары, три к флешу или стриту, старшие; в раззе и лоу — младшие). */
function studRaw(game: Game, cs: Card[], hilo: boolean): number {
  const lowR = (c: Card) => (c.r === 14 ? 1 : c.r);
  const byR = new Map<number, number>();
  for (const c of cs) byR.set(c.r, (byR.get(c.r) ?? 0) + 1);
  if (game === 'razz') {
    const u = [...new Set(cs.map(lowR))].sort((a, b) => a - b);
    return 40 - u.reduce((a, r) => a + r, 0) - (cs.length - u.length) * 12;
  }
  let v = Math.max(...cs.map((c) => c.r)) / 2;
  for (const [r, n] of byR) if (n >= 2) v += n === 3 ? 60 + r : 20 + r * 1.6;
  if (cs.length >= 3 && cs.every((c) => c.s === cs[0].s)) v += 14;
  const rs = [...byR.keys()].sort((a, b) => a - b);
  if (rs.length === cs.length && rs[rs.length - 1] - rs[0] <= 4) v += 10;
  if (hilo) {
    const low = new Set(cs.map(lowR).filter((r) => r <= 8));
    if (low.size === cs.length) v += 8 + (byR.has(14) ? 6 : 0);
  }
  return v;
}

/** Дро и лоуболл: сколько карт можно оставить и насколько они хороши (по правилам обмена бота). */
function drawRaw(game: Game, cs: Card[]): number {
  const lowR = (c: Card) => (c.r === 14 ? (game === 'td27' || game === 'badeucy' ? 14 : 1) : c.r);
  if (game === 'draw5') {
    const byR = new Map<number, number>();
    for (const c of cs) byR.set(c.r, (byR.get(c.r) ?? 0) + 1);
    const v = fastHighOrPartial(cs);
    return v / 15 ** 5 + Math.max(...[...byR.entries()].filter(([, n]) => n >= 2).map(([r]) => r / 20), 0);
  }
  const u = [...new Set(cs.map(lowR))].filter((r) => r <= 8).sort((a, b) => a - b);
  const suits = new Set(cs.map((c) => c.s)).size;
  return u.length * 10 - (u[u.length - 1] ?? 9) - u.reduce((a, r) => a + r, 0) / 10 + (game.startsWith('bad') ? suits * 3 : 0);
}
const fastHighOrPartial = (cs: Card[]) => (cs.length >= 5 ? fastHigh(cs) : 0);

/** Сырые оценки (больше — лучше) для видов без таблицы. */
function raw(game: Game, hole: Card[], hilo: boolean): number {
  if (game === 'stud7' || game === 'stud5' || game === 'razz') return studRaw(game, hole, hilo);
  if (game === 'draw5' || game === 'td27' || game === 'tda5' || game === 'badugi' || game === 'badeucy' || game === 'badacey') return drawRaw(game, hole);
  if (game === 'shortdeck') return -holdemPct(hole[0], hole[1]);
  if (game === 'pineapple' || game === 'crazy') {
    let best = 1;
    for (let i = 0; i < hole.length; i++) for (let j = i + 1; j < hole.length; j++) best = Math.min(best, holdemPct(hole[i], hole[j]));
    return -best;
  }
  // Омаха-5 и Куршевель: лучшие четыре из пяти плюс немного за пятую
  if (hole.length === 5) {
    let best = -Infinity;
    for (let k = 0; k < 5; k++) best = Math.max(best, omahaRaw(hole.filter((_, i) => i !== k), hilo));
    return best + 1;
  }
  return omahaRaw(hole, hilo);
}

const cdfs = new Map<string, number[]>();
/** Распределение сырых оценок по случайным рукам вида (считается один раз, лениво). */
function cdf(game: Game, n: number, hilo: boolean): number[] {
  const key = `${game}:${n}:${hilo}`;
  let c = cdfs.get(key);
  if (c) return c;
  const deck = allCards(game === 'shortdeck');
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x80000000);
  c = [];
  for (let k = 0; k < 3000; k++) {
    const d = deck.slice();
    const h: Card[] = [];
    for (let i = 0; i < n; i++) h.push(d.splice(Math.floor(rnd() * d.length), 1)[0]);
    c.push(raw(game, h, hilo));
  }
  c.sort((a, b) => b - a);
  cdfs.set(key, c);
  return c;
}

/** Место стартовой руки: 0 — лучшая, 1 — худшая. */
export function prePct(game: Game, hole: Card[], hilo = false): number {
  if (game === 'holdem' && hole.length === 2) return holdemPct(hole[0], hole[1]);
  const c = cdf(game, hole.length, hilo);
  const v = raw(game, hole, hilo);
  let lo = 0;
  let hi = c.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (c[m] > v) lo = m + 1;
    else hi = m;
  }
  return Math.min(1, (lo + 0.5) / c.length);
}

/** Лучшая пара из 2–3 карт (пайнэппл) — класс холдема для таблиц пуш/фолда. */
export function bestClass(hole: Card[]): number {
  let best = -1;
  let bp = 2;
  for (let i = 0; i < hole.length; i++)
    for (let j = i + 1; j < hole.length; j++) {
      const k = classIndex(hole[i], hole[j]);
      if (PREFLOP.pct[k] < bp) {
        bp = PREFLOP.pct[k];
        best = k;
      }
    }
  return best;
}

/** Открытие рейзом первым: доля рук регуляра по числу игроков позади (включая блайнды); вдвоём — шире. */
export function openWidth(behind: number, players: number): number {
  if (players === 2) return 0.8;
  const T = [1, 0.42, 0.46, 0.28, 0.2, 0.16, 0.13, 0.11, 0.1];
  return T[Math.min(8, Math.max(1, behind))];
}

// ---------------------------------------------------------------- сила на доске

const SD_SWAP: Record<number, number> = { 3: 4, 4: 3, 5: 6, 6: 5 };
const catOf = (v: number, sd: boolean) => {
  const c = Math.floor(v / 15 ** 5);
  return sd ? (SD_SWAP[c] ?? c) : c;
};
const k1 = (v: number) => Math.floor(v / 15 ** 4) % 15;

/** Сила руки на доске 0…1 (с дро, пока не ривер) и отдельно — сила дро. */
export function madeStr(hole: Card[], board: Card[], omaha: boolean, sd: boolean): { s: number; draw: number } {
  if (board.length < 3) return { s: 0.3, draw: 0 };
  const v = omaha ? fastOmaha(hole, board) : fastHigh([...hole, ...board], sd);
  const cat = catOf(v, sd);
  const brd = board.length >= 5 ? catOf(fastHigh(board, sd), sd) : boardCat(board);
  const top = Math.max(...board.map((c) => c.r));
  let s: number;
  if (cat >= 4) s = brd >= cat ? 0.35 : 0.86 + Math.min(0.12, (cat - 4) * 0.03);
  else if (cat === 3) s = brd >= 3 ? 0.3 : 0.8;
  else if (cat === 2) s = brd >= 1 ? 0.55 : 0.72;
  else if (cat === 1) {
    const pr = k1(v);
    if (brd >= 1) s = 0.12 + (Math.max(...hole.map((c) => c.r)) >= 13 ? 0.05 : 0);
    else if (pr > top) s = 0.62 + (pr - top) * 0.01;
    else if (pr === top) s = 0.47 + (Math.max(...hole.filter((c) => c.r !== pr).map((c) => c.r), 2) / 14) * 0.08;
    else if (board.filter((c) => c.r > pr).length === 1) s = 0.33;
    else s = 0.22;
  } else s = 0.04 + (Math.max(...hole.map((c) => c.r)) >= 13 ? 0.04 : 0);
  let draw = 0;
  if (board.length < 5 && cat < 5) {
    // флеш-дро: четыре одной масти, хотя бы одна своя (в Омахе — две свои)
    for (const su of ['S', 'C', 'D', 'H']) {
      const mine = hole.filter((c) => c.s === su).length;
      const on = board.filter((c) => c.s === su).length;
      if ((omaha ? mine >= 2 && on >= 2 : mine >= 1 && mine + on >= 4) && on <= 3) draw = Math.max(draw, 0.24);
    }
    if (cat < 4) {
      let mask = 0;
      for (const c of [...hole, ...board]) mask |= 1 << c.r;
      if (mask & (1 << 14)) mask |= 2;
      let hmask = 0;
      for (const c of hole) hmask |= 1 << c.r;
      let st = 0;
      for (let lo = 1; lo <= 10; lo++) {
        const w = (mask >> lo) & 31;
        const bits = ((w & 1) + ((w >> 1) & 1) + ((w >> 2) & 1) + ((w >> 3) & 1) + ((w >> 4) & 1)) as number;
        if (bits < 4 || !((hmask >> lo) & 31)) continue;
        // четыре подряд — двусторонний, с дыркой — «гатшот»
        st = Math.max(st, (w & 15) === 15 || (w & 30) === 30 ? 0.18 : 0.09);
      }
      draw += st;
    }
  }
  return { s: Math.min(0.99, s + draw * (board.length === 3 ? 1 : 0.7)), draw };
}

/** Категория доски из 3–4 карт: 0 — разные, 1 — пара, 2 — две пары, 3 — сет. */
function boardCat(board: Card[]): number {
  const m = new Map<number, number>();
  for (const c of board) m.set(c.r, (m.get(c.r) ?? 0) + 1);
  const n = [...m.values()].sort((a, b) => b - a);
  return n[0] >= 3 ? 3 : n[0] === 2 && n[1] === 2 ? 2 : n[0] === 2 ? 1 : 0;
}

/** Мокрая доска: две+ одной масти или три карты в окне из пяти. */
export function wet(board: Card[]): number {
  const su = new Map<string, number>();
  for (const c of board) su.set(c.s, (su.get(c.s) ?? 0) + 1);
  const flush = Math.max(...su.values());
  const rs = [...new Set(board.map((c) => c.r))].sort((a, b) => a - b);
  let conn = 0;
  for (let i = 0; i < rs.length; i++) conn = Math.max(conn, rs.filter((r) => r >= rs[i] && r <= rs[i] + 4).length);
  return (flush >= 3 ? 0.6 : flush === 2 ? 0.3 : 0) + (conn >= 3 ? 0.5 : conn === 2 ? 0.15 : 0);
}
