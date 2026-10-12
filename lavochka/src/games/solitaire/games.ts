/* «Пасьянсы» — правила каждого пасьянса поверх общего ядра (engine.ts). Без DOM.
 * Порядок стопок у каждого свой и описан в kinds(): номер стопки — её место в массиве. */
import type { Card } from '../../cards/deck';
import { card, flipTop, fullDeck, isRun, lead, newBoard, red, top, upRun, val, type Board, type Ctx, type GameId, type Kind, type SolGame } from './engine';

const rep = <T>(n: number, x: T): T[] => new Array(n).fill(x);
const idx = (c: Ctx, k: Kind) => c.kinds.map((x, i) => (x === k ? i : -1)).filter((i) => i >= 0);
const first = (c: Ctx, k: Kind) => c.kinds.indexOf(k);
const count = (c: Ctx, b: Board, k: Kind) => idx(c, k).reduce((s, i) => s + b.p[i].length, 0);

/** Дом от туза вверх по масти. */
function aceUp(c: Ctx, b: Board, i: number, j: number) {
  const x = card(c, top(b, i))!;
  const t = card(c, top(b, j));
  return t ? t.s === x.s && val(x) === val(t) + 1 : val(x) === 1;
}

/** Можно ли положить на открытую верхнюю карту t карту x по убыванию. */
function onto(c: Ctx, b: Board, j: number, x: Card | null, how: 'alt' | 'suit' | 'any') {
  const id = top(b, j);
  const t = card(c, id);
  if (!t || !x || !b.up[id!]) return false;
  if (val(t) !== val(x) + 1) return false;
  if (how === 'alt') return red(t) !== red(x);
  if (how === 'suit') return t.s === x.s;
  return true;
}

/** Открыть верхние карты столбцов; сколько открылось. */
function flipTabs(c: Ctx, b: Board) {
  let n = 0;
  for (const i of idx(c, 'tab')) {
    const t = top(b, i);
    if (t != null && !b.up[t]) {
      b.up[t] = 1;
      n++;
    }
  }
  return n;
}

/** Колода → сброс (n карт), а пустая — перевернуть сброс обратно, если проходы ещё есть. */
function drawTo(c: Ctx, b: Board, n: number, stock: number, waste: number, passes: number) {
  if (b.p[stock].length) {
    for (let k = 0; k < n && b.p[stock].length; k++) {
      const id = b.p[stock].pop()!;
      b.up[id] = 1;
      b.p[waste].push(id);
    }
    return true;
  }
  if (!b.p[waste].length || (passes && b.pass >= passes - 1)) return false;
  const w = b.p[waste].reverse();
  for (const id of w) b.up[id] = 0;
  b.p[stock] = w;
  b.p[waste] = [];
  // без ограничения проходов номер прохода не важен (и не должен плодить «новые» позиции)
  if (passes) b.pass++;
  return true;
}

const canRedeal = (b: Board, stock: number, waste: number, passes: number) => b.p[stock].length > 0 || (b.p[waste].length > 0 && (!passes || b.pass < passes - 1));

// ---------------------------------------------------------------- Косынка

const klondike: SolGame = {
  id: 'klondike',
  build: () => 'alt',
  aceFound: true,
  title: 'Косынка',
  cards: () => fullDeck(1),
  kinds: () => ['stock', 'waste', ...rep<Kind>(4, 'found'), ...rep<Kind>(7, 'tab')],
  deal(c) {
    const b = newBoard(c, 13);
    let k = 0;
    for (let r = 0; r < 7; r++) for (let col = r; col < 7; col++) b.p[6 + col].push(k++);
    for (let col = 0; col < 7; col++) flipTop(b, 6 + col);
    for (let id = 51; id >= k; id--) b.p[0].push(id);
    b.score = c.cfg.vegas ? -52 : 0;
    return b;
  },
  canPick(c, b, i, n) {
    const k = c.kinds[i];
    if (k === 'waste' || k === 'found') return n === 1 && b.p[i].length > 0;
    return k === 'tab' && n <= upRun(b, i) && isRun(c, b, i, n, 'alt');
  },
  canDrop(c, b, i, n, j) {
    const k = c.kinds[j];
    if (k === 'found') return n === 1 && c.kinds[i] !== 'found' && aceUp(c, b, i, j);
    if (k !== 'tab') return false;
    const x = lead(c, b, i, n);
    return b.p[j].length ? onto(c, b, j, x, 'alt') : !!x && val(x) === 13;
  },
  scoreMove(c, b, i, n, j) {
    const f = c.kinds[i];
    const t = c.kinds[j];
    if (c.cfg.vegas) return t === 'found' ? 5 : f === 'found' ? -5 : 0;
    if (t === 'found') return 10;
    if (f === 'found') return -15;
    if (f === 'waste') return 5;
    return 0;
  },
  stock(c, b) {
    const recycle = !b.p[0].length;
    if (!drawTo(c, b, c.cfg.draw, 0, 1, c.cfg.passes)) return false;
    if (recycle && !c.cfg.vegas && c.cfg.draw === 1) b.score = Math.max(0, b.score - 100);
    return true;
  },
  canStock: (c, b) => canRedeal(b, 0, 1, c.cfg.passes),
  after(c, b) {
    const n = flipTabs(c, b);
    if (!c.cfg.vegas) b.score += 5 * n;
  },
  won: (c, b) => count(c, b, 'found') === 52,
  progress: (c, b) => count(c, b, 'found'),
  total: () => 52,
  autoOk: (c, b) => !b.p[0].length && !b.p[1].length && idx(c, 'tab').every((i) => b.p[i].every((id) => b.up[id])),
};

// ---------------------------------------------------------------- Паук

const spider: SolGame = {
  id: 'spider',
  build: () => 'any',
  title: 'Паук',
  cards(cfg) {
    const suits: Card['s'][] = cfg.suits === 1 ? ['S'] : cfg.suits === 2 ? ['S', 'H'] : ['S', 'H', 'C', 'D'];
    const out: Card[] = [];
    for (let k = 0; k < 8 / suits.length; k++) for (const s of suits) for (let r = 2; r <= 14; r++) out.push({ s, r });
    return out;
  },
  kinds: () => ['stock', ...rep<Kind>(8, 'found'), ...rep<Kind>(10, 'tab')],
  deal(c) {
    const b = newBoard(c, 19);
    let k = 0;
    for (let r = 0; r < 6; r++) for (let col = 0; col < 10; col++) if (r < (col < 4 ? 6 : 5)) b.p[9 + col].push(k++);
    for (let col = 0; col < 10; col++) flipTop(b, 9 + col);
    for (let id = 103; id >= k; id--) b.p[0].push(id);
    b.score = 500;
    return b;
  },
  canPick: (c, b, i, n) => c.kinds[i] === 'tab' && n <= upRun(b, i) && isRun(c, b, i, n, 'suit'),
  canDrop(c, b, i, n, j) {
    if (c.kinds[j] !== 'tab') return false;
    return b.p[j].length ? onto(c, b, j, lead(c, b, i, n), 'any') : true;
  },
  scoreMove: () => -1,
  stock(c, b) {
    const tabs = idx(c, 'tab');
    if (!b.p[0].length || tabs.some((i) => !b.p[i].length)) return false;
    for (const i of tabs) {
      const id = b.p[0].pop()!;
      b.up[id] = 1;
      b.p[i].push(id);
    }
    return true;
  },
  canStock: (c, b) => b.p[0].length > 0 && idx(c, 'tab').every((i) => b.p[i].length > 0),
  after(c, b) {
    for (const i of idx(c, 'tab')) {
      const p = b.p[i];
      if (p.length >= 13 && upRun(b, i) >= 13 && isRun(c, b, i, 13, 'suit') && val(card(c, p[p.length - 13])!) === 13) {
        const f = idx(c, 'found').find((x) => !b.p[x].length);
        if (f != null) {
          b.p[f] = p.splice(p.length - 13, 13);
          b.score += 100;
        }
      }
    }
    flipTabs(c, b);
  },
  won: (c, b) => count(c, b, 'found') === 104,
  progress: (c, b) => count(c, b, 'found'),
  total: () => 104,
};

// ---------------------------------------------------------------- Солитёр (FreeCell)

/** Сколько карт можно перенести разом: (свободные ячейки + 1) · 2^(пустые столбцы, кроме того, куда кладём). */
function capacity(c: Ctx, b: Board, i: number, j: number) {
  const cells = idx(c, 'cell').filter((x) => !b.p[x].length).length;
  const empty = idx(c, 'tab').filter((x) => x !== j && x !== i && !b.p[x].length).length;
  return (cells + 1) * 2 ** empty;
}

const freecell: SolGame = {
  id: 'freecell',
  build: (cfg) => (cfg.baker ? 'suit' : 'alt'),
  aceFound: true,
  title: 'Солитёр',
  cards: () => fullDeck(1),
  kinds: (cfg) => [...rep<Kind>(cfg.cells, 'cell'), ...rep<Kind>(4, 'found'), ...rep<Kind>(8, 'tab')],
  deal(c) {
    const b = newBoard(c, c.kinds.length);
    const t0 = first(c, 'tab');
    for (let id = 0; id < 52; id++) {
      b.p[t0 + (id % 8)].push(id);
      b.up[id] = 1;
    }
    return b;
  },
  canPick(c, b, i, n) {
    const k = c.kinds[i];
    if (k === 'cell') return n === 1 && b.p[i].length > 0;
    return k === 'tab' && isRun(c, b, i, n, c.cfg.baker ? 'suit' : 'alt');
  },
  canDrop(c, b, i, n, j) {
    const k = c.kinds[j];
    if (k === 'cell') return n === 1 && !b.p[j].length;
    if (k === 'found') return n === 1 && aceUp(c, b, i, j);
    if (k !== 'tab') return false;
    if (n > capacity(c, b, i, j)) return false;
    return b.p[j].length ? onto(c, b, j, lead(c, b, i, n), c.cfg.baker ? 'suit' : 'alt') : true;
  },
  stock: () => false,
  canStock: () => false,
  won: (c, b) => count(c, b, 'found') === 52,
  progress: (c, b) => count(c, b, 'found'),
  total: () => 52,
  autoOk: () => true,
  autoSafe: true,
};

// ---------------------------------------------------------------- Пирамида

/** Номер клетки пирамиды в ряду r, место k. */
const pyrSlot = (r: number, k: number) => (r * (r + 1)) / 2 + k;

function pyrOpen(c: Ctx, b: Board, i: number) {
  const s = i - first(c, 'slot');
  let r = 0;
  while (pyrSlot(r + 1, 0) <= s) r++;
  if (r === 6) return true;
  const k = s - pyrSlot(r, 0);
  const s0 = first(c, 'slot');
  return !b.p[s0 + pyrSlot(r + 1, k)].length && !b.p[s0 + pyrSlot(r + 1, k + 1)].length;
}

/** Карта, которую можно взять в пирамиде: открытая клетка, верх сброса, верх колоды (он лежит лицом). */
function pyrFree(c: Ctx, b: Board, i: number) {
  if (!b.p[i].length) return false;
  const k = c.kinds[i];
  if (k === 'slot') return pyrOpen(c, b, i);
  return k === 'waste' || (k === 'stock' && b.up[top(b, i)!] === 1);
}

const pyramid: SolGame = {
  id: 'pyramid',
  title: 'Пирамида',
  cards: () => fullDeck(1),
  kinds: () => ['stock', 'waste', 'found', ...rep<Kind>(28, 'slot')],
  deal(c) {
    const b = newBoard(c, 31);
    for (let id = 0; id < 28; id++) {
      b.p[3 + id].push(id);
      b.up[id] = 1;
    }
    for (let id = 51; id >= 28; id--) b.p[0].push(id);
    flipTop(b, 0);
    return b;
  },
  canPick: (c, b, i, n) => n === 1 && pyrFree(c, b, i),
  canDrop(c, b, i, n, j) {
    if (n !== 1) return false;
    const x = card(c, top(b, i));
    if (!x) return false;
    if (c.kinds[j] === 'found') return val(x) === 13;
    if (!pyrFree(c, b, j)) return false;
    const y = card(c, top(b, j));
    return !!y && val(x) + val(y) === 13;
  },
  move(c, b, i, n, j) {
    const f = first(c, 'found');
    b.p[f].push(b.p[i].pop()!);
    if (j !== f) b.p[f].push(b.p[j].pop()!);
  },
  stock(c, b) {
    if (b.p[0].length) {
      const id = b.p[0].pop()!;
      b.up[id] = 1;
      b.p[1].push(id);
      return true;
    }
    return drawTo(c, b, 1, 0, 1, c.cfg.passes);
  },
  canStock: (c, b) => canRedeal(b, 0, 1, c.cfg.passes),
  after(c, b) {
    flipTop(b, 0);
  },
  won: (c, b) => count(c, b, 'slot') === 0,
  progress: (c, b) => 28 - count(c, b, 'slot'),
  total: () => 28,
};

// ---------------------------------------------------------------- Три вершины

/** Кто накрывает клетку: ряды 3 + 6 + 9 + 10. */
export const PEAK_COVER: number[][] = (() => {
  const out: number[][] = [];
  for (let p = 0; p < 3; p++) out[p] = [3 + 2 * p, 4 + 2 * p];
  for (let j = 0; j < 6; j++) {
    const p = Math.floor(j / 2);
    out[3 + j] = [9 + j + p, 10 + j + p];
  }
  for (let j = 0; j < 9; j++) out[9 + j] = [18 + j, 19 + j];
  for (let j = 0; j < 10; j++) out[18 + j] = [];
  return out;
})();

/** ±1 по достоинству (с переходом король–туз, если wrap). */
function nextTo(a: Card, b: Card, wrap: boolean) {
  const d = Math.abs(val(a) - val(b));
  return d === 1 || (wrap && d === 12);
}

const tripeaks: SolGame = {
  id: 'tripeaks',
  title: 'Три вершины',
  cards: () => fullDeck(1),
  kinds: () => ['stock', 'found', ...rep<Kind>(28, 'slot')],
  deal(c) {
    const b = newBoard(c, 30);
    for (let id = 0; id < 28; id++) b.p[2 + id].push(id);
    for (let s = 18; s < 28; s++) b.up[s] = 1;
    b.p[1].push(28);
    b.up[28] = 1;
    for (let id = 51; id >= 29; id--) b.p[0].push(id);
    b.x = { streak: 0 };
    return b;
  },
  canPick: (c, b, i, n) => n === 1 && c.kinds[i] === 'slot' && b.p[i].length > 0 && b.up[top(b, i)!] === 1,
  canDrop(c, b, i, n, j) {
    if (c.kinds[j] !== 'found') return false;
    const x = card(c, top(b, i));
    const t = card(c, top(b, j));
    return !!x && !!t && nextTo(x, t, c.cfg.wrap);
  },
  scoreMove: (c, b) => (b.x?.streak ?? 0) + 1,
  move(c, b, i) {
    b.p[1].push(b.p[i].pop()!);
    b.x = { streak: (b.x?.streak ?? 0) + 1 };
  },
  stock(c, b) {
    if (!b.p[0].length) return false;
    const id = b.p[0].pop()!;
    b.up[id] = 1;
    b.p[1].push(id);
    b.x = { streak: 0 };
    return true;
  },
  canStock: (c, b) => b.p[0].length > 0,
  after(c, b) {
    for (let s = 0; s < 28; s++) if (b.p[2 + s].length && PEAK_COVER[s].every((x) => !b.p[2 + x].length)) b.up[b.p[2 + s][0]] = 1;
  },
  won: (c, b) => count(c, b, 'slot') === 0,
  progress: (c, b) => 28 - count(c, b, 'slot'),
  total: () => 28,
};

// ---------------------------------------------------------------- Гольф

const golf: SolGame = {
  id: 'golf',
  title: 'Гольф',
  cards: () => fullDeck(1),
  kinds: () => ['stock', 'found', ...rep<Kind>(7, 'tab')],
  deal(c) {
    const b = newBoard(c, 9);
    let k = 0;
    for (let r = 0; r < 5; r++) for (let col = 0; col < 7; col++) b.p[2 + col].push(k++);
    for (let id = 0; id < 36; id++) b.up[id] = 1;
    b.p[1].push(k++);
    for (let id = 51; id >= k; id--) b.p[0].push(id);
    return b;
  },
  canPick: (c, b, i, n) => n === 1 && c.kinds[i] === 'tab' && b.p[i].length > 0,
  canDrop(c, b, i, n, j) {
    if (c.kinds[j] !== 'found') return false;
    const x = card(c, top(b, i));
    const t = card(c, top(b, j));
    if (!x || !t) return false;
    // по строгим правилам на короля ничего не кладут
    if (!c.cfg.wrap && val(t) === 13) return false;
    return nextTo(x, t, c.cfg.wrap);
  },
  stock(c, b) {
    if (!b.p[0].length) return false;
    const id = b.p[0].pop()!;
    b.up[id] = 1;
    b.p[1].push(id);
    return true;
  },
  canStock: (c, b) => b.p[0].length > 0,
  won: (c, b) => count(c, b, 'tab') === 0,
  progress: (c, b) => 35 - count(c, b, 'tab'),
  total: () => 35,
};

// ---------------------------------------------------------------- Сорок воров

const thievesShape = () => ({ decks: 2, cols: 10, rows: 4 });

const thieves: SolGame = {
  id: 'thieves',
  build: () => 'suit',
  aceFound: true,
  title: 'Сорок воров',
  cards: () => fullDeck(thievesShape().decks),
  kinds: () => {
    const t = thievesShape();
    return ['stock', 'waste', ...rep<Kind>(4 * t.decks, 'found'), ...rep<Kind>(t.cols, 'tab')];
  },
  deal(c) {
    const t = thievesShape();
    const b = newBoard(c, c.kinds.length);
    const t0 = first(c, 'tab');
    let k = 0;
    for (let r = 0; r < t.rows; r++)
      for (let col = 0; col < t.cols; col++) {
        b.p[t0 + col].push(k);
        b.up[k++] = 1;
      }
    for (let id = c.deck.length - 1; id >= k; id--) b.p[0].push(id);
    return b;
  },
  canPick: (c, b, i, n) => n === 1 && (c.kinds[i] === 'waste' || c.kinds[i] === 'tab') && b.p[i].length > 0,
  canDrop(c, b, i, n, j) {
    const k = c.kinds[j];
    if (k === 'found') return aceUp(c, b, i, j);
    if (k !== 'tab') return false;
    return b.p[j].length ? onto(c, b, j, card(c, top(b, i)), 'suit') : true;
  },
  stock: (c, b) => drawTo(c, b, 1, 0, 1, 1),
  canStock: (c, b) => b.p[0].length > 0,
  won: (c, b) => count(c, b, 'found') === c.deck.length,
  progress: (c, b) => count(c, b, 'found'),
  total: (c) => c.deck.length,
  autoOk: (c, b) => !b.p[0].length && !b.p[1].length,
};

// ---------------------------------------------------------------- Скорпион

const scorpion: SolGame = {
  id: 'scorpion',
  build: () => 'suit',
  title: 'Скорпион',
  cards: () => fullDeck(1),
  kinds: () => ['stock', ...rep<Kind>(4, 'found'), ...rep<Kind>(7, 'tab')],
  deal(c) {
    const b = newBoard(c, 12);
    let k = 0;
    for (let r = 0; r < 7; r++)
      for (let col = 0; col < 7; col++) {
        b.p[5 + col].push(k);
        if (!(col < 4 && r < 3)) b.up[k] = 1;
        k++;
      }
    for (let id = 51; id >= k; id--) b.p[0].push(id);
    return b;
  },
  // берётся любая открытая карта вместе со всем, что на ней лежит
  canPick: (c, b, i, n) => c.kinds[i] === 'tab' && n <= upRun(b, i),
  canDrop(c, b, i, n, j) {
    if (c.kinds[j] !== 'tab') return false;
    const x = lead(c, b, i, n);
    return b.p[j].length ? onto(c, b, j, x, 'suit') : !!x && val(x) === 13;
  },
  stock(c, b) {
    if (!b.p[0].length) return false;
    for (let col = 0; col < 3 && b.p[0].length; col++) {
      const id = b.p[0].pop()!;
      b.up[id] = 1;
      b.p[5 + col].push(id);
    }
    return true;
  },
  canStock: (c, b) => b.p[0].length > 0,
  after(c, b) {
    flipTabs(c, b);
    for (const i of idx(c, 'tab')) {
      const p = b.p[i];
      if (p.length >= 13 && upRun(b, i) >= 13 && isRun(c, b, i, 13, 'suit') && val(card(c, p[p.length - 13])!) === 13) {
        const f = idx(c, 'found').find((x) => !b.p[x].length);
        if (f != null) b.p[f] = p.splice(p.length - 13, 13);
      }
    }
    flipTabs(c, b);
  },
  won: (c, b) => count(c, b, 'found') === 52,
  progress: (c, b) => count(c, b, 'found'),
  total: () => 52,
};

// ---------------------------------------------------------------- Колодец (The Well, по PySol)
// Стопки: 0 — колода, 1–5 — сбросы, 6–9 — дома (от короля вниз, по кругу, по 26 карт), 10–13 — столбцы у резервов,
// 14 — пятый столбец (начинается с туза), 15–18 — резервы по 10 открытых карт.

const W_WASTE = 1;
const W_FOUND = 6;
const W_TAB = 10;
const W_LEFT = 14;
const W_RES = 15;

function wellDeal(b: Board) {
  const n = 5 - b.pass;
  for (let k = 0; k < n && b.p[0].length; k++) {
    const id = b.p[0].pop()!;
    b.up[id] = 1;
    b.p[W_WASTE + k].push(id);
  }
}

const well: SolGame = {
  id: 'well',
  title: 'Колодец',
  cards: () => fullDeck(2),
  kinds: () => ['stock', ...rep<Kind>(5, 'waste'), ...rep<Kind>(4, 'found'), ...rep<Kind>(5, 'tab'), ...rep<Kind>(4, 'cell')],
  deal(c) {
    const b = newBoard(c, 19);
    let k = 0;
    for (let r = 0; r < 10; r++)
      for (let q = 0; q < 4; q++) {
        b.p[W_RES + q].push(k);
        b.up[k++] = 1;
      }
    for (let q = 0; q < 4; q++) {
      b.p[W_TAB + q].push(k);
      b.up[k++] = 1;
    }
    for (let id = 103; id >= k; id--) b.p[0].push(id);
    wellDeal(b);
    return b;
  },
  canPick: (c, b, i, n) => n === 1 && b.p[i].length > 0 && (c.kinds[i] === 'waste' || c.kinds[i] === 'tab' || c.kinds[i] === 'cell'),
  canDrop(c, b, i, n, j) {
    const x = card(c, top(b, i));
    if (!x || n !== 1) return false;
    const k = c.kinds[j];
    const t = card(c, top(b, j));
    if (k === 'found') {
      // у каждой масти один дом на обе колоды
      if (!t) return val(x) === 13 && ![6, 7, 8, 9].some((f) => card(c, b.p[f][0])?.s === x.s);
      if (b.p[j].length >= 26 || t.s !== x.s) return false;
      return val(x) === (val(t) === 1 ? 13 : val(t) - 1);
    }
    if (k !== 'tab') return false;
    if (!t) {
      if (j === W_LEFT) return val(x) === 1;
      return !b.p[W_RES + (j - W_TAB)].length;
    }
    return t.s === x.s && val(x) === (val(t) === 13 ? 1 : val(t) + 1);
  },
  stock(c, b) {
    if (b.p[0].length) {
      wellDeal(b);
      return true;
    }
    if (b.pass >= 4 || ![1, 2, 3, 4, 5].some((w) => b.p[w].length)) return false;
    const all: number[] = [];
    for (let w = 5; w >= 1; w--) all.push(...b.p[w].reverse());
    for (const id of all) b.up[id] = 0;
    for (let w = 1; w <= 5; w++) b.p[w] = [];
    b.p[0] = all;
    b.pass++;
    wellDeal(b);
    return true;
  },
  canStock: (c, b) => b.p[0].length > 0 || (b.pass < 4 && [1, 2, 3, 4, 5].some((w) => b.p[w].length > 0)),
  after(c, b) {
    for (let q = 0; q < 4; q++) if (!b.p[W_TAB + q].length && b.p[W_RES + q].length) b.p[W_TAB + q].push(b.p[W_RES + q].pop()!);
  },
  won: (c, b) => count(c, b, 'found') === 104,
  progress: (c, b) => count(c, b, 'found'),
  total: () => 104,
  autoOk: (c, b) => !b.p[0].length,
};

export const GAMES: Record<GameId, SolGame> = { klondike, spider, freecell, pyramid, tripeaks, golf, thieves, scorpion, well };
export const GAME_IDS = Object.keys(GAMES) as GameId[];
export { W_FOUND, W_LEFT, W_RES, W_TAB, W_WASTE, pyrSlot, pyrOpen };
