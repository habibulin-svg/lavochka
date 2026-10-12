/* «Пасьянсы» — общее ядро без DOM: доска из стопок, ходы «взять n верхних карт со стопки i и положить на j»,
 * колода, отмена хода. Правила каждого пасьянса — в games/*.ts (что можно взять, куда положить, что делает колода).
 *
 * Карта на доске — номер в раздаче (0…n−1), сама карта — deck[номер]. Номер ничего не выдаёт: это место в перетасованной
 * колоде, а закрытые карты в view заменены на null. Ключ карты на сцене — тот же номер, поэтому переворот и полёт
 * получаются сами. */
import type { Card } from '../../cards/deck';

export type Kind = 'stock' | 'waste' | 'found' | 'tab' | 'cell' | 'slot';

export type GameId = 'klondike' | 'spider' | 'freecell' | 'pyramid' | 'tripeaks' | 'golf' | 'thieves' | 'scorpion' | 'well';

export interface Cfg {
  /** Косынка: по одной или по три. */
  draw: 1 | 3;
  /** Сколько раз можно пройти колоду (0 — без ограничения). */
  passes: number;
  /** Косынка: счёт «Вегас». */
  vegas: boolean;
  /** Паук: мастей. */
  suits: 1 | 2 | 4;
  /** Солитёр: свободных ячеек. */
  cells: number;
  /** Солитёр «Бейкер»: строить по масти. */
  baker: boolean;
  /** Три вершины / гольф: туз ложится на короля и наоборот. */
  wrap: boolean;
}

export interface Board {
  /** Стопки: номера карт снизу вверх. */
  p: number[][];
  /** Открыта ли карта (по номеру). */
  up: number[];
  /** Сколько раз колоду уже перевернули заново. */
  pass: number;
  moves: number;
  score: number;
  /** Ходов подряд без толку (ничего не ушло в дом и не открылось) — по нему бот понимает, что пора сдаваться. */
  stall: number;
  /** 0 — идёт, 1 — сошёлся, 2 — сдался. */
  end: 0 | 1 | 2;
  /** Снимки для отмены (в view не уходят). */
  hist?: string[];
  /** Свои поля пасьянса (колодец: сколько карт резерва открыто и т.п.). */
  x?: Record<string, number>;
}

/** Всё, что нужно правилам: сам пасьянс, настройки, колода (null — карта закрыта для этого зрителя). */
export interface Ctx {
  g: SolGame;
  cfg: Cfg;
  deck: (Card | null)[];
  kinds: Kind[];
}

export type Move = { t: 'mv'; f: number; n: number; to: number } | { t: 'stock' };

export interface SolGame {
  id: GameId;
  title: string;
  /** Колода раздачи по настройкам (две колоды, паук в одну-две масти). */
  cards(cfg: Cfg): Card[];
  kinds(cfg: Cfg): Kind[];
  /** Разложить карты 0…n−1 (уже перетасованы: номер — место в колоде). */
  deal(c: Ctx): Board;
  /** Можно ли взять n верхних карт со стопки i. */
  canPick(c: Ctx, b: Board, i: number, n: number): boolean;
  /** Можно ли положить n верхних карт со стопки i на стопку j. */
  canDrop(c: Ctx, b: Board, i: number, n: number, j: number): boolean;
  /** Сам ход, если он не просто перекладывание (пирамида: пара уходит в сброс). */
  move?(c: Ctx, b: Board, i: number, n: number, j: number): void;
  /** Ход колодой: false — нельзя. Доску меняет сам. */
  stock(c: Ctx, b: Board): boolean;
  /** Колода сейчас доступна (кнопка, подсветка). */
  canStock(c: Ctx, b: Board): boolean;
  /** После каждого хода: перевернуть открывшиеся карты, убрать собранные масти. */
  after?(c: Ctx, b: Board): void;
  won(c: Ctx, b: Board): boolean;
  /** Очки за ход (косынка, паук): прибавка к счёту. */
  scoreMove?(c: Ctx, b: Board, i: number, n: number, j: number): number;
  /** Сколько карт уже «убрано» — для сводки и эвристики. */
  progress(c: Ctx, b: Board): number;
  /** Всего карт, которые надо убрать. */
  total(c: Ctx): number;
  /** Начальный счёт. */
  startScore?(cfg: Cfg): number;
  /** Можно ли собрать всё автоматически (все карты открыты, колода пуста). */
  autoOk?(c: Ctx, b: Board): boolean;
  /** Как строятся столбцы вниз (для решателя: какие ходы бессмысленны). */
  build?(cfg: Cfg): 'alt' | 'suit' | 'any';
  /** Дома строятся от туза вверх по масти (для оценки позиции). */
  aceFound?: boolean;
  /** Солитёр: «безопасные» карты уходят в дом сами. */
  autoSafe?: boolean;
}

// ---------------------------------------------------------------- карты

/** Достоинство для пасьянса: туз — 1, король — 13. */
export const val = (c: Card) => (c.r === 14 ? 1 : c.r);
export const red = (c: Card) => c.s === 'H' || c.s === 'D';

export function fullDeck(n = 1): Card[] {
  const out: Card[] = [];
  for (let k = 0; k < n; k++) for (const s of ['S', 'H', 'C', 'D'] as const) for (let r = 2; r <= 14; r++) out.push({ s, r });
  return out;
}

// ---------------------------------------------------------------- доска

export const top = (b: Board, i: number) => b.p[i][b.p[i].length - 1];
export const card = (c: Ctx, id: number | undefined) => (id == null ? null : c.deck[id]);
export const isUp = (b: Board, id: number) => b.up[id] === 1;

export function cloneBoard(b: Board): Board {
  return { p: b.p.map((x) => x.slice()), up: b.up.slice(), pass: b.pass, moves: b.moves, score: b.score, stall: b.stall, end: b.end, hist: b.hist, x: b.x ? { ...b.x } : undefined };
}

/** Открыть верхнюю карту стопки. */
export function flipTop(b: Board, i: number) {
  const t = top(b, i);
  if (t != null) b.up[t] = 1;
}

/** Сколько открытых карт сверху стопки. */
export function upRun(b: Board, i: number) {
  const p = b.p[i];
  let n = 0;
  while (n < p.length && b.up[p[p.length - 1 - n]]) n++;
  return n;
}

/** Убывающая последовательность из n верхних карт: по чередованию цвета, по масти или любая. */
export function isRun(c: Ctx, b: Board, i: number, n: number, how: 'alt' | 'suit' | 'any') {
  const p = b.p[i];
  if (n < 1 || n > p.length) return false;
  for (let k = p.length - n; k < p.length; k++) {
    const x = c.deck[p[k]];
    if (!x || !b.up[p[k]]) return false;
    if (k === p.length - n) continue;
    const y = c.deck[p[k - 1]]!;
    if (val(y) !== val(x) + 1) return false;
    if (how === 'alt' && red(x) === red(y)) return false;
    if (how === 'suit' && x.s !== y.s) return false;
  }
  return true;
}

/** Карта, которую кладём (нижняя из n верхних). */
export const lead = (c: Ctx, b: Board, i: number, n: number) => c.deck[b.p[i][b.p[i].length - n]];

export function ctxOf(g: SolGame, cfg: Cfg, deck: (Card | null)[]): Ctx {
  return { g, cfg, deck, kinds: g.kinds(cfg) };
}

export function newBoard(c: Ctx, piles: number): Board {
  return { p: Array.from({ length: piles }, () => []), up: new Array(c.deck.length).fill(0), pass: 0, moves: 0, score: 0, stall: 0, end: 0 };
}

const snap = (b: Board) => JSON.stringify({ p: b.p, up: b.up, pass: b.pass, score: b.score, x: b.x });

function restore(b: Board, s: string) {
  const o = JSON.parse(s);
  b.p = o.p;
  b.up = o.up;
  b.pass = o.pass;
  b.score = o.score;
  b.x = o.x;
}

/** Сколько ходов отмены хранить. */
const UNDO = 300;

/** Сделать ход на доске (копии). null — ход недопустим. keep — хранить снимок для отмены. */
export function play(c: Ctx, b0: Board, m: Move, keep = true): Board | null {
  if (b0.end) return null;
  const b = cloneBoard(b0);
  const before = keep ? snap(b0) : '';
  const gain0 = c.g.progress(c, b0) * 1000 - hidden(c, b0);
  if (m.t === 'stock') {
    if (!c.g.canStock(c, b) || !c.g.stock(c, b)) return null;
  } else {
    const { f, n, to } = m;
    if (!Number.isInteger(f) || !Number.isInteger(to) || !Number.isInteger(n) || f === to) return null;
    if (f < 0 || to < 0 || f >= b.p.length || to >= b.p.length || n < 1 || n > b.p[f].length) return null;
    if (!c.g.canPick(c, b, f, n) || !c.g.canDrop(c, b, f, n, to)) return null;
    b.score += c.g.scoreMove?.(c, b, f, n, to) ?? 0;
    if (c.g.move) c.g.move(c, b, f, n, to);
    else b.p[to].push(...b.p[f].splice(b.p[f].length - n, n));
  }
  b.moves++;
  c.g.after?.(c, b);
  if (c.g.autoSafe) autoSafe(c, b);
  b.stall = c.g.progress(c, b) * 1000 - hidden(c, b) > gain0 ? 0 : b.stall + 1;
  if (keep) b.hist = [...(b0.hist ?? []).slice(-UNDO + 1), before];
  else b.hist = undefined;
  if (c.g.won(c, b)) b.end = 1;
  return b;
}

/** Закрытых карт на столе (колода не в счёт). */
function hidden(c: Ctx, b: Board) {
  let n = 0;
  b.p.forEach((p, i) => {
    if (c.kinds[i] === 'tab' || c.kinds[i] === 'slot') for (const id of p) if (!b.up[id]) n++;
  });
  return n;
}

export function undo(b0: Board): Board | null {
  if (b0.end || !b0.hist?.length) return null;
  const b = cloneBoard(b0);
  const h = b.hist!.slice();
  restore(b, h.pop()!);
  b.hist = h;
  b.moves++;
  b.stall = 0;
  return b;
}

/** Все допустимые ходы (для бота, подсказки и решателя). */
export function legal(c: Ctx, b: Board): Move[] {
  const out: Move[] = [];
  if (b.end) return out;
  const piles = b.p.length;
  for (let i = 0; i < piles; i++) {
    const len = b.p[i].length;
    if (!len) continue;
    const max = c.kinds[i] === 'tab' ? len : 1;
    for (let n = 1; n <= max; n++) {
      if (!c.g.canPick(c, b, i, n)) {
        if (n > upRun(b, i)) break;
        continue;
      }
      for (let j = 0; j < piles; j++) if (j !== i && c.g.canDrop(c, b, i, n, j)) out.push({ t: 'mv', f: i, n, to: j });
    }
  }
  if (c.g.canStock(c, b)) out.push({ t: 'stock' });
  return out;
}

/** Куда положить карты по нажатию: сначала в дом (для одной карты), потом на непустую стопку, потом на пустую. */
export function bestTarget(c: Ctx, b: Board, i: number, n: number): number | null {
  if (!c.g.canPick(c, b, i, n)) return null;
  const cand: { j: number; w: number }[] = [];
  for (let j = 0; j < b.p.length; j++) {
    if (j === i || !c.g.canDrop(c, b, i, n, j)) continue;
    const k = c.kinds[j];
    const w = k === 'found' ? 0 : k === 'slot' ? 1 : (k === 'tab' || k === 'waste') && b.p[j].length ? 2 : k === 'tab' ? 3 : 4;
    cand.push({ j, w });
  }
  cand.sort((a, b2) => a.w - b2.w || a.j - b2.j);
  return cand[0]?.j ?? null;
}

/** Солитёр: в дом уходят карты, которые точно больше не нужны (обе масти другого цвета уже выше на шаг). */
function autoSafe(c: Ctx, b: Board) {
  const found = c.kinds.map((k, i) => (k === 'found' ? i : -1)).filter((i) => i >= 0);
  const level = (s: string) => {
    for (const f of found) {
      const t = card(c, top(b, f));
      if (t && t.s === s) return val(t);
    }
    return 0;
  };
  for (let guard = 0; guard < 60; guard++) {
    let moved = false;
    for (let i = 0; i < b.p.length && !moved; i++) {
      const k = c.kinds[i];
      if (k !== 'tab' && k !== 'cell') continue;
      const t = card(c, top(b, i));
      if (!t) continue;
      const v = val(t);
      const opp = red(t) ? ['S', 'C'] : ['H', 'D'];
      if (v > 2 && !opp.every((s) => level(s) >= v - 1)) continue;
      for (const f of found) {
        if (c.g.canDrop(c, b, i, 1, f)) {
          b.p[f].push(b.p[i].pop()!);
          moved = true;
          break;
        }
      }
    }
    if (!moved) break;
  }
}

/** Собрать всё в дом (когда все карты открыты): ходы по одному, пока получается. */
export function autoFinish(c: Ctx, b0: Board): Board | null {
  if (!c.g.autoOk?.(c, b0)) return null;
  let b = b0;
  for (let guard = 0; guard < 400 && !b.end; guard++) {
    let next: Board | null = null;
    for (let i = 0; i < b.p.length && !next; i++) {
      if (!b.p[i].length || c.kinds[i] === 'found') continue;
      for (let j = 0; j < b.p.length && !next; j++) if (c.kinds[j] === 'found' && c.g.canPick(c, b, i, 1) && c.g.canDrop(c, b, i, 1, j)) next = play(c, b, { t: 'mv', f: i, n: 1, to: j }, false);
    }
    if (!next && c.g.canStock(c, b)) next = play(c, b, { t: 'stock' }, false);
    if (!next) break;
    next.hist = b0.hist;
    b = next;
  }
  return b === b0 ? null : b;
}

// ---------------------------------------------------------------- оценка позиции

/** Насколько позиция хороша: убранные карты, открытые карты, пустые стопки, порядок в столбцах. */
const ENV = (globalThis as any).process?.env ?? {};
const W_EMPTY = Number(ENV.SOL_WE ?? 40);
const W_CELL = Number(ENV.SOL_WC ?? 60);

export function heur(c: Ctx, b: Board): number {
  let h = c.g.progress(c, b) * 100;
  // дом от туза: следующая нужная карта масти, закопанная под другими, — плохо
  let need: Record<string, number> | null = null;
  if (c.g.aceFound) {
    need = { S: 1, H: 1, C: 1, D: 1 };
    const tops: Record<string, number[]> = { S: [], H: [], C: [], D: [] };
    for (let i = 0; i < b.p.length; i++) {
      if (c.kinds[i] !== 'found') continue;
      const t = card(c, top(b, i));
      if (t) tops[t.s].push(val(t));
    }
    const per = c.kinds.filter((k) => k === 'found').length / 4;
    for (const s of ['S', 'H', 'C', 'D']) need[s] = tops[s].length < per ? 1 : Math.min(...tops[s]) + 1;
  }
  for (let i = 0; i < b.p.length; i++) {
    const k = c.kinds[i];
    const p = b.p[i];
    if (k === 'tab') {
      if (!p.length) h += W_EMPTY;
      let low = 99;
      for (let n = 0; n < p.length; n++) {
        const id = p[n];
        if (need) {
          const x = c.deck[id];
          if (x && val(x) <= need[x.s] + 1) h -= (p.length - 1 - n) * (val(x) === need[x.s] ? 10 : 5);
        }
        if (!b.up[id]) {
          // закрытая карта глубже — хуже
          h -= 25 + 2 * n;
          continue;
        }
        const x = c.deck[id];
        if (n > 0) {
          const y = c.deck[p[n - 1]];
          if (x && y && b.up[p[n - 1]] && val(y) === val(x) + 1) h += x.s === y.s ? 6 : 3;
          // карта не на своём месте и придавила младшую — её придётся перекладывать
          else if (x && low < val(x)) h -= 6;
        }
        if (x) low = Math.min(low, val(x));
      }
    } else if (k === 'cell') h -= p.length * W_CELL;
    else if (k === 'slot') h -= p.length * 6;
    else if (k === 'stock' || k === 'waste') h -= p.length * 2;
  }
  return h;
}

/** Хэш позиции для решателя и бота. */
export function hashOf(b: Board, kinds?: Kind[]) {
  // в доме важна только верхняя карта и сколько их там: порядок, в котором туда легли, будущего не меняет
  return b.p.map((x, i) => (kinds?.[i] === 'found' ? x.length + ':' + (x[x.length - 1] ?? '') : x.join(','))).join('|') + '#' + b.pass;
}
