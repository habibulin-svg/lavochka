/* «Пасьянсы» — решатель и бот. Без DOM.
 * Решатель видит всю раздачу (им заранее отбираются раздачи по сложности — tools/solitaire/seeds.ts).
 * Бот видит только свой view: закрытые карты — null, ход колодой он не просчитывает. */
import type { Rng } from '../../core/types';
import { card, cloneBoard, hashOf, heur, legal, play, red, top, val, type Board, type Ctx, type Move } from './engine';

/** Бессмысленный ход: разбить готовую последовательность или переложить весь столбец на пустое место. */
function pointless(c: Ctx, b: Board, m: Move) {
  if (m.t !== 'mv') return false;
  const kf = c.kinds[m.f];
  if (kf === 'found') return true;
  if (kf !== 'tab' || c.kinds[m.to] !== 'tab') return false;
  const p = b.p[m.f];
  if (m.n === p.length && !b.p[m.to].length) return true;
  const under = p[p.length - m.n - 1];
  if (under == null || !b.up[under]) return false;
  const x = card(c, p[p.length - m.n]);
  const y = card(c, under);
  const how = c.g.build?.(c.cfg);
  if (!how || !x || !y || val(y) !== val(x) + 1) return false;
  if (how === 'alt' && red(x) === red(y)) return false;
  if (how === 'suit' && x.s !== y.s) return false;
  return c.g.canPick(c, b, m.f, m.n + 1);
}

const ENV_NOMACRO = !!(globalThis as any).process?.env?.SOL_NOMACRO;
const DEPTH_W = Number((globalThis as any).process?.env?.SOL_DW ?? 0);

export interface Solution {
  ok: boolean;
  nodes: number;
  path: Move[];
  /** Сколько карт удалось убрать в лучшей позиции (для отладки и оценки). */
  best?: number;
}

interface Node {
  b: Board;
  m: Move[] | null;
  up: Node | null;
  s: number;
}

/** Куча по убыванию оценки. */
class Heap {
  a: Node[] = [];
  push(x: Node) {
    const a = this.a;
    a.push(x);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].s >= a[i].s) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): Node | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].s > a[m].s) m = l;
        if (r < a.length && a[r].s > a[m].s) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/** Ходы из позиции. Если у пасьянса есть сброс, колода не ходит сама по себе: вместо неё — «прокрутить колоду k раз
 * и сыграть то, что открылось» (иначе решатель тонет в позициях, где колода просто перевёрнута на разное число карт). */
function expand(c: Ctx, b: Board): { path: Move[]; b: Board }[] {
  const out: { path: Move[]; b: Board }[] = [];
  const waste = !ENV_NOMACRO && c.kinds.includes('waste');
  for (const m of legal(c, b)) {
    if (waste && m.t === 'stock') continue;
    if (pointless(c, b, m)) continue;
    const nb = play(c, b, m, false);
    if (nb) out.push({ path: [m], b: nb });
  }
  if (!waste) return out;
  const touches = (m: Move) => m.t === 'mv' && (c.kinds[m.f] === 'waste' || c.kinds[m.f] === 'stock' || c.kinds[m.to] === 'waste' || c.kinds[m.to] === 'stock');
  const cards = b.p.reduce((s, p, i) => (c.kinds[i] === 'stock' || c.kinds[i] === 'waste' ? s + p.length : s), 0);
  const limit = 2 * cards + 8;
  const path: Move[] = [];
  const first = hashOf(b, c.kinds);
  let x = b;
  for (let k = 0; k < limit; k++) {
    const nx = play(c, x, { t: 'stock' }, false);
    if (!nx) break;
    path.push({ t: 'stock' });
    x = nx;
    if (hashOf(x, c.kinds) === first) break;
    for (const m of legal(c, x)) {
      if (m.t === 'stock' || !touches(m)) continue;
      const nb = play(c, x, m, false);
      if (nb) out.push({ path: [...path, m], b: nb });
    }
  }
  // колода прокручена до конца без хода — тоже позиция (при ограниченных проходах важно, где остановиться)
  if (path.length && x !== b) out.push({ path: path.slice(), b: x });
  return out;
}

/** Поиск «сначала лучшая позиция» с памятью позиций. budget — сколько позиций раскрыть. */
export function solve(c: Ctx, b0: Board, budget = 100_000): Solution {
  const seen = new Set<string>([hashOf(b0, c.kinds)]);
  const open = new Heap();
  open.push({ b: cloneBoard(b0), m: null, up: null, s: 0 });
  let nodes = 0;
  let best = 0;
  const trace = (n: Node) => {
    const path: Move[][] = [];
    for (let x: Node | null = n; x && x.m; x = x.up) path.push(x.m);
    return path.reverse().flat();
  };
  while (nodes < budget) {
    const cur = open.pop();
    if (!cur) break;
    nodes++;
    best = Math.max(best, c.g.progress(c, cur.b));
    for (const e of expand(c, cur.b)) {
      const node: Node = { b: e.b, m: e.path, up: cur, s: 0 };
      if (e.b.end === 1) return { ok: true, nodes, path: trace(node) };
      const k = hashOf(e.b, c.kinds);
      if (seen.has(k)) continue;
      seen.add(k);
      node.s = heur(c, e.b) + DEPTH_W * e.b.moves;
      open.push(node);
    }
  }
  return { ok: false, nodes, path: [], best };
}

// ---------------------------------------------------------------- бот

export type BotMove = Move | { t: 'think' } | { t: 'giveup' } | { t: 'auto' };

/** Ходы без колоды, которые бот может просчитать (по открытым картам). */
function known(c: Ctx, b: Board): { m: Move; b: Board; h: number }[] {
  const out: { m: Move; b: Board; h: number }[] = [];
  for (const m of legal(c, b)) {
    if (m.t !== 'mv' || pointless(c, b, m)) continue;
    const nb = play(c, b, m, false);
    if (nb) out.push({ m, b: nb, h: nb.end === 1 ? 1e9 : heur(c, nb) });
  }
  return out;
}

/** Лучший ход с просмотром на depth ходов вперёд; null — улучшить позицию нечем. */
export function bestMove(c: Ctx, b: Board, depth: number, rng?: Rng, noise = 0): Move | null {
  const h0 = heur(c, b);
  const seen = new Set<string>([hashOf(b, c.kinds)]);
  const deep = (x: Board, d: number): number => {
    if (d <= 0 || x.end) return x.end === 1 ? 1e9 : heur(c, x);
    let best = heur(c, x);
    for (const n of known(c, x)) {
      const k = hashOf(n.b, c.kinds);
      if (seen.has(k)) continue;
      seen.add(k);
      best = Math.max(best, deep(n.b, d - 1));
    }
    return best;
  };
  let pick: Move | null = null;
  let score = h0;
  for (const n of known(c, b)) {
    // первый шаг должен сам по себе не ухудшать позицию сильно: иначе бот гоняет карты туда-сюда
    const v = Math.max(n.h, depth > 1 ? deep(n.b, depth - 1) - 1 : n.h) + (rng && noise ? rng.next() * noise : 0);
    if (v > score) {
      score = v;
      pick = n.m;
    }
  }
  return pick;
}

/** Сколько ходов без толку бот готов сделать, прежде чем сдаться: колоду — пройти раза два. */
export function stallLimit(c: Ctx, b: Board) {
  const stock = b.p.reduce((s, p, i) => (c.kinds[i] === 'stock' || c.kinds[i] === 'waste' ? s + p.length : s), 0);
  return 2 * stock + 30;
}

/** План по открытым картам: поиск «сначала лучшая позиция» среди ходов без колоды (budget позиций);
 * первый ход пути к позиции лучше нынешней. null — улучшить нечем. */
export function plan(c: Ctx, b0: Board, budget: number): Move | null {
  const h0 = heur(c, b0);
  const seen = new Set<string>([hashOf(b0, c.kinds)]);
  const open = new Heap();
  open.push({ b: b0, m: null, up: null, s: h0 });
  let best: Node | null = null;
  let nodes = 0;
  while (nodes < budget) {
    const cur = open.pop();
    if (!cur) break;
    nodes++;
    for (const n of known(c, cur.b)) {
      const k = hashOf(n.b, c.kinds);
      if (seen.has(k)) continue;
      seen.add(k);
      // путь длиннее — чуть хуже: из равных позиций выбираем ближнюю
      const node: Node = { b: n.b, m: [n.m], up: cur, s: n.h - 0.01 * (n.b.moves - b0.moves) };
      if (n.b.end === 1) {
        best = node;
        nodes = budget;
        break;
      }
      if (node.s > h0 + 0.5 && (!best || node.s > best.s)) best = node;
      open.push(node);
    }
  }
  if (!best) return null;
  let x: Node = best;
  while (x.up && x.up.m) x = x.up;
  return x.m![0];
}

/** Сколько позиций бот просматривает на ход: лёгкий — только ход вперёд, сложный — далеко. */
const BUDGET = [1, 40, 250];

/** Ход бота: лёгкий думает долго и ходит неточно, сложный — планирует по всем открытым картам. */
export function botMove(c: Ctx, b: Board, level: number, rng: Rng): BotMove {
  const pace = [0.55, 0.3, 0.1][level] ?? 0.3;
  if (rng.next() < pace) return { t: 'think' };
  if (b.moves > 3000 || b.stall > stallLimit(c, b)) return { t: 'giveup' };
  const m = level === 0 ? bestMove(c, b, 1, rng, 40) : plan(c, b, BUDGET[level] ?? 40);
  if (m) return m;
  if (c.g.canStock(c, b)) return { t: 'stock' };
  // улучшить нечем и колода закрыта (паук: пустой столбец) — лучший из оставшихся ходов; бесконечно не пойдёт — сдастся по stall
  const any = known(c, b).sort((x, z) => z.h - x.h)[0];
  return any ? any.m : { t: 'giveup' };
}

/** Подсказка игроку: лучший ход по открытым картам, иначе — колода. */
export function hint(c: Ctx, b: Board): Move | null {
  const m = plan(c, b, 250);
  if (m) return m;
  return c.g.canStock(c, b) ? { t: 'stock' } : null;
}

export { top };
