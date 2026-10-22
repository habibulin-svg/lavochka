/* Китайский покер — боты. Видят только свой вид: свои ряды и руку, открытые ряды соперников.
 *   Лёгкий — раскладывает «на глаз»: оценка неполной раскладки (пары, флеш- и стрит-дро, угроза фола) с долей случайности;
 *   Средний и Сложный — для лучших вариантов «на глаз» доигрывают раздачу наугад: будущие карты — из невиденных,
 *     раскладка их — тем же глазомером; выбирают вариант с лучшим средним итогом (роялти, фол, фантазия).
 *     Сложный берёт больше вариантов и больше розыгрышей.
 * Фантазия (все карты сразу): перебор низа и середины из лучших пятёрок, верх — сильнейший, что не даёт фола. */
import type { Rng } from '../../../core/types';
import type { Card } from '../../../cards/deck';
import { combos, high, highCat } from '../hands';
import { fantasyFor, isFoul, needDiscard, royalty, rowValue, SIZE, topValue, unseen, type OAction, type OCfg, type OView, type Slot } from './engine';

const placedN = (rows: Card[][]) => rows[0].length + rows[1].length + rows[2].length;

/** Все раскладки руки по рядам с k картами в сброс. */
export function assignments(rows: Card[][], held: Card[], k: number): Slot[][] {
  const out: Slot[][] = [];
  const cap = rows.map((r, i) => SIZE[i] - r.length);
  const cur: Slot[] = [];
  const rec = (i: number, xs: number) => {
    if (i === held.length) {
      if (xs === k) out.push(cur.slice());
      return;
    }
    if (xs < k) {
      cur.push('x');
      rec(i + 1, xs + 1);
      cur.pop();
    }
    for (const r of [0, 1, 2] as const)
      if (cap[r] > 0) {
        cap[r]--;
        cur.push(r);
        rec(i + 1, xs);
        cur.pop();
        cap[r]++;
      }
  };
  rec(0, 0);
  return out;
}

export function put(rows: Card[][], held: Card[], to: Slot[]): Card[][] {
  const r = rows.map((x) => x.slice());
  to.forEach((t, i) => t !== 'x' && r[t].push(held[i]));
  return r;
}

const TOP_S = (rows: Card[][]) => {
  const v = topValue(rows[0]);
  const c = highCat(v);
  const r = Math.floor(v / 15 ** 4) % 15;
  return c === 3 ? 1.6 : c === 1 ? 0.3 + (r / 14) * 0.9 : (r / 14) * 0.3;
};
const MID_S = [0.1, 0.35, 0.6, 0.8, 0.9, 0.95, 0.98, 1, 1];
const BOT_S = [0, 0.1, 0.3, 0.5, 0.65, 0.75, 0.88, 0.97, 1];

/** Итог полной раскладки «в очках»: роялти, сила рядов, фантазия; фол — большой минус. */
export function finalValue(rows: Card[][], cfg: OCfg, inFant: boolean): number {
  if (isFoul(rows)) return -14;
  let v = royalty(rows[0], 0) + royalty(rows[1], 1) + royalty(rows[2], 2);
  v += 2 * (TOP_S(rows) + MID_S[highCat(high(rows[1]))] + BOT_S[highCat(high(rows[2]))]);
  const f = fantasyFor(rows, cfg, inFant);
  if (f) v += 5 + (f - 13) * 1.5;
  return v;
}

/** Задел ряда: пары и сеты, одномастность, стрит-дро. */
function potential(cards: Card[], row: number): number {
  if (!cards.length) return 0;
  const cnt = new Map<number, number>();
  for (const c of cards) cnt.set(c.r, (cnt.get(c.r) ?? 0) + 1);
  const g = [...cnt.values()].sort((a, b) => b - a);
  let v = g[0] === 4 ? 4 : g[0] === 3 ? (g[1] === 2 ? 3.6 : 2.2) : g[0] === 2 ? (g[1] === 2 ? 1.4 : 0.8) : 0;
  if (row > 0 && cards.length < 5) {
    const suits = new Set(cards.map((c) => c.s));
    if (suits.size === 1 && cards.length >= 2) v += 0.35 * cards.length;
    const rs = [...cnt.keys()];
    if (rs.length === cards.length && cards.length >= 2) {
      const lo = Math.min(...rs);
      const hi = Math.max(...rs);
      const loA = rs.includes(14) ? Math.min(...rs.map((r) => (r === 14 ? 1 : r))) : lo;
      const hiA = rs.includes(14) ? Math.max(...rs.map((r) => (r === 14 ? 1 : r))) : hi;
      if (hi - lo <= 4 || hiA - loA <= 4) v += 0.25 * cards.length;
    }
  }
  return v;
}

/** Оценка неполной раскладки «на глаз». */
export function heur(rows: Card[][], cfg: OCfg, inFant: boolean): number {
  if (placedN(rows) === 13) return finalValue(rows, cfg, inFant);
  let v = 0.5 * potential(rows[0], 0) + 1.0 * potential(rows[1], 1) + 1.1 * potential(rows[2], 2);
  // угроза фола: верхний ряд уже сильнее нижнего
  for (const [a, b] of [[0, 1], [1, 2]] as const) {
    if (!rows[a].length || !rows[b].length) continue;
    if (rowValue(rows[a], a) > rowValue(rows[b], b)) v -= rows[b].length === SIZE[b] ? 14 : 2 + rows[b].length;
  }
  // перегруз верха, пока середина и низ пусты
  const top = topValue(rows[0]);
  const tc = highCat(top);
  const tr = Math.floor(top / 15 ** 4) % 15;
  if (tc >= 1) {
    if (tr >= 6) v += 0.6 * (tc === 3 ? 10 + tr : tr - 5);
    if (cfg.fant !== 'off' && (tc === 3 || tr >= 12)) v += 2.5;
    const free = SIZE[1] - rows[1].length + SIZE[2] - rows[2].length;
    if (tr >= 10) v -= 0.25 * (tr - 9) * (free / 10) * 4;
  }
  // в середину и низ — старшие карты, наверх — младшие
  for (const c of rows[0]) if (highCat(top) === 0) v -= (c.r - 8) * 0.05;
  void inFant;
  return v;
}

function shuffled(a: Card[], n: number, rng: Rng): Card[] {
  const b = a.slice();
  for (let i = 0; i < Math.min(n, b.length - 1); i++) {
    const j = i + rng.int(b.length - i);
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b.slice(0, n);
}

/** Доиграть раздачу глазомером: будущие карты — по порядку из pool. */
function rollout(rows0: Card[][], pool: Card[], cfg: OCfg, inFant: boolean): Card[][] {
  let rows = rows0;
  let i = 0;
  const n = cfg.mode === 'ofcp' ? 3 : 1;
  const k = cfg.mode === 'ofcp' ? 1 : 0;
  while (placedN(rows) < 13 && i + n <= pool.length) {
    const cards = pool.slice(i, i + n);
    i += n;
    let best = -Infinity;
    let pick = rows;
    for (const a of assignments(rows, cards, k)) {
      const r = put(rows, cards, a);
      const v = heur(r, cfg, inFant);
      if (v > best) {
        best = v;
        pick = r;
      }
    }
    rows = pick;
  }
  return rows;
}

/** Фантазия: лучшие низ и середина, верх — сильнейший без фола. Возвращает раскладку руки. */
export function fantasySet(held: Card[], cfg: OCfg): Slot[] {
  const idx = held.map((_, i) => i);
  const bots = combos(idx, 5)
    .map((b) => ({ b, v: high(b.map((i) => held[i])) }))
    .sort((x, y) => y.v - x.v)
    .slice(0, 10);
  let best = -Infinity;
  let res: Slot[] | null = null;
  for (const { b, v: bv } of bots) {
    const rest = idx.filter((i) => !b.includes(i));
    const mids = combos(rest, 5)
      .map((m) => ({ m, v: high(m.map((i) => held[i])) }))
      .filter((x) => x.v <= bv)
      .sort((x, y) => y.v - x.v)
      .slice(0, 16);
    for (const { m, v: mv } of mids) {
      const rest2 = rest.filter((i) => !m.includes(i));
      const tops = combos(rest2, 3)
        .map((t) => ({ t, v: topValue(t.map((i) => held[i])) }))
        .filter((x) => x.v <= mv)
        .sort((x, y) => y.v - x.v);
      if (!tops.length) continue;
      const t = tops[0].t;
      const rows = [t, m, b].map((r) => r.map((i) => held[i]));
      const val = finalValue(rows, cfg, true);
      if (val > best) {
        best = val;
        res = idx.map((i) => (t.includes(i) ? 0 : m.includes(i) ? 1 : b.includes(i) ? 2 : 'x'));
      }
    }
  }
  // совсем без шансов (не бывает при 13+ картах, но на всякий случай) — как легло
  return res ?? idx.map((i) => (i < 3 ? 0 : i < 8 ? 1 : i < 13 ? 2 : 'x'));
}

export function chooseOfc(v: OView, seat: number, level: number, rng: Rng): OAction | null {
  const held = v.held[seat];
  if (!held?.length || held.some((c) => !c)) return null;
  const rows = v.rows[seat];
  const inFant = v.fant[seat] > 0;
  if (inFant && placedN(rows) === 0 && held.length >= 13) return { type: 'place', to: fantasySet(held, v.cfg) };
  const k = needDiscard(v, seat);
  const cands = assignments(rows, held, k).map((a) => ({ a, r: put(rows, held, a) }));
  // последний круг — считаем точно
  if (placedN(cands[0].r) === 13) {
    let best = cands[0];
    let bv = -Infinity;
    for (const c of cands) {
      const val = finalValue(c.r, v.cfg, inFant) + (level === 0 ? rng.next() * 2 : 0);
      if (val > bv) {
        bv = val;
        best = c;
      }
    }
    return { type: 'place', to: best.a };
  }
  const scored = cands.map((c) => ({ ...c, h: heur(c.r, v.cfg, inFant) + (level === 0 ? rng.next() * 1.5 : 0) })).sort((x, y) => y.h - x.h);
  if (level === 0) return { type: 'place', to: scored[0].a };
  const top = scored.slice(0, level === 1 ? 5 : 10);
  const samples = level === 1 ? 6 : 16;
  const pool = unseen(v, seat);
  const left = 13 - placedN(top[0].r);
  const need = v.cfg.mode === 'ofcp' ? Math.ceil(left / 2) * 3 : left;
  const sum = top.map(() => 0);
  for (let t = 0; t < samples; t++) {
    const fut = shuffled(pool, need, rng);
    top.forEach((c, i) => (sum[i] += finalValue(rollout(c.r, fut, v.cfg, inFant), v.cfg, inFant)));
  }
  let bi = 0;
  for (let i = 1; i < top.length; i++) if (sum[i] > sum[bi]) bi = i;
  return { type: 'place', to: top[bi].a };
}
