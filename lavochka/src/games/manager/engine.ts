/* «Менеджер» / «Космос 2000» — движок без DOM. Одна партия на выбранном поле; правила полей различаются там, где различаются
 * правила игр: в «Менеджере» два кубика, дубли, биржа, филиалы/предприятия, залог и долги; в «Космосе» один кубик, планеты без построек,
 * банк с жетонами «Б», казино, страховка, пираты с «золотом Амазонок», ссуда банкроту.
 *
 * Ход: фаза 'roll' — игрок до броска делает операции (строит, закладывает, предлагает сделку) и бросает. После хода клетка
 * разбирается (resolve): может открыть фазу решения (купить, торги, долг, страховка, казино), по её окончании ход заканчивается (finish). */
import type { Rng } from '../../core/types';
import { boardOf, CASINO, CASINO_STAR, type Board, type Card } from './boards';

export type Phase = 'roll' | 'resolve' | 'buy' | 'auction' | 'debt' | 'offer' | 'insure' | 'casino' | 'casino2' | 'bankBuy' | 'over';

export interface Auction {
  cell: number;
  bid: number;
  leader: number | null;
  /** Кто ещё торгуется — по кругу. */
  order: number[];
  at: number;
}

export interface Offer {
  from: number;
  to: number;
  /** Участки, которые отдаёт from / получает от to. */
  give: number[];
  get: number[];
  /** Деньги: + платит from, − платит to. */
  cash: number;
  /** Карточки «выход из биржи»: + отдаёт from, − отдаёт to. */
  cards: number;
  back: Phase;
}

export interface Debt {
  amount: number;
  to: number | null;
  /** После уплаты: закончить ход или пойти на выпавшее (третий бросок на бирже). */
  then: 'finish' | 'move';
}

export interface State {
  map: 'manager' | 'kosmos';
  seats: number[];
  cash: number[];
  pos: number[];
  out: boolean[];
  /** Владелец клетки: место; -1 — банк (жетон «Б» в «Космосе»); null — ничья. */
  owner: (number | null)[];
  /** 0–3 филиала, 4 — предприятие. */
  houses: number[];
  mort: boolean[];
  turn: number;
  phase: Phase;
  dice: number[] | null;
  doubles: number;
  /** Ещё ход тому же игроку (дубль, «пояс астероидов»). */
  again: boolean;
  /** Биржа: 0 — свободен, k — сидит, k-я попытка выйти. */
  jail: number[];
  /** Карточки «Вы освобождены от посещения биржи» на руках: колода*100 + номер. */
  freeCards: number[][];
  /** Колоды: номера карточек сверху вниз. В view — пустые, есть только deckLen. */
  decks: number[][];
  deckLen?: number[];
  /** Последняя вытянутая карточка. */
  card: { deck: number; id: number; seat: number } | null;
  skip: boolean[];
  /** Страховка: 0 — нет, 1 — наполовину, 2 — полностью. */
  ins: number[];
  freeCasino: boolean;
  freeIns: boolean;
  /** «Золото Амазонок» — деньги, отнятые пиратами. */
  pot: number;
  loan: number[];
  loanLaps: number[];
  loanUsed: boolean[];
  auction: Auction | null;
  offer: Offer | null;
  debt: Debt | null;
  offers: number;
  /** Филиалы и предприятия в банке. */
  stock: [number, number];
  round: number;
  limit: number;
  startPass: boolean;
  loanOn: boolean;
  result: { winners: number[]; text: string } | null;
}

export type Action =
  | { type: 'roll' }
  | { type: 'buy' }
  | { type: 'pass' }
  | { type: 'bid'; amount: number }
  | { type: 'fold' }
  | { type: 'build'; cell: number }
  | { type: 'sell'; cell: number }
  | { type: 'mortgage'; cell: number }
  | { type: 'redeem'; cell: number }
  | { type: 'sellBank'; cell: number }
  | { type: 'payJail' }
  | { type: 'useCard' }
  | { type: 'offer'; to: number; give: number[]; get: number[]; cash: number; cards: number }
  | { type: 'accept' }
  | { type: 'reject' }
  | { type: 'insure'; level: number }
  | { type: 'spin' }
  | { type: 'bankrupt' };

type Who = number | null | 'pot';

export type Event =
  | { type: 'roll'; seat: number; dice: number[] }
  | { type: 'move'; seat: number; path: number[] }
  | { type: 'jump'; seat: number; to: number }
  | { type: 'pay'; from: Who; to: Who; amount: number; why: string }
  | { type: 'buy'; seat: number; cell: number; price: number }
  | { type: 'decline'; seat: number; cell: number }
  | { type: 'bid'; seat: number; amount: number }
  | { type: 'fold'; seat: number }
  | { type: 'won'; seat: number | null; cell: number; price: number }
  | { type: 'build'; seat: number; cell: number; level: number }
  | { type: 'unbuild'; seat: number; cell: number; level: number }
  | { type: 'mortgage'; seat: number; cell: number; on: boolean }
  | { type: 'sellBank'; seat: number; cell: number; price: number }
  | { type: 'card'; seat: number; deck: number; id: number }
  | { type: 'jail'; seat: number }
  | { type: 'free'; seat: number; how: 'double' | 'pay' | 'card' | 'forced' }
  | { type: 'stay'; seat: number }
  | { type: 'offer'; offer: Offer }
  | { type: 'deal'; from: number; to: number; ok: boolean }
  | { type: 'debt'; seat: number; amount: number }
  | { type: 'bankrupt'; seat: number }
  | { type: 'loan'; seat: number }
  | { type: 'repay'; seat: number }
  | { type: 'insure'; seat: number; level: number; free?: boolean }
  | { type: 'casino'; seat: number; die: number; sector: number; amount: number; star: boolean }
  | { type: 'skip'; seat: number }
  | { type: 'again'; seat: number }
  | { type: 'visit'; seat: number; cell: number }
  | { type: 'end'; winners: number[]; text: string };

/** Партия, затянувшаяся на столько кругов, заканчивается подсчётом капитала. */
export const HARD_LIMIT = 150;
export const MAX_OFFERS = 3;

export const B = (s: State): Board => boardOf(s.map);
export const N = (s: State) => B(s).cells.length;

export const fmt = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export const money = (s: State | Board, n: number) => {
  const b = 'cells' in s ? s : B(s);
  return `${fmt(n)} ${b.cur}`;
};

export const alive = (s: State) => s.seats.filter((x) => !s.out[x]);

export function clone(s: State): State {
  return {
    ...s,
    seats: s.seats.slice(),
    cash: s.cash.slice(),
    pos: s.pos.slice(),
    out: s.out.slice(),
    owner: s.owner.slice(),
    houses: s.houses.slice(),
    mort: s.mort.slice(),
    jail: s.jail.slice(),
    freeCards: s.freeCards.map((c) => c.slice()),
    decks: s.decks.map((d) => d.slice()),
    skip: s.skip.slice(),
    ins: s.ins.slice(),
    loan: s.loan.slice(),
    loanLaps: s.loanLaps.slice(),
    loanUsed: s.loanUsed.slice(),
    stock: [s.stock[0], s.stock[1]],
    auction: s.auction ? { ...s.auction, order: s.auction.order.slice() } : null,
    offer: s.offer ? { ...s.offer, give: s.offer.give.slice(), get: s.offer.get.slice() } : null,
    debt: s.debt ? { ...s.debt } : null,
    card: s.card ? { ...s.card } : null,
    dice: s.dice ? s.dice.slice() : null,
  };
}

function shuffle(a: number[], rng: Rng) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function newState(map: 'manager' | 'kosmos', seats: number[], o: { limit?: number; startPass?: boolean; loan?: boolean }, rng: Rng): State {
  const b = boardOf(map);
  const n = b.cells.length;
  const start = b.money(seats.length);
  return {
    map,
    seats,
    cash: Array.from({ length: 6 }, (_, i) => (seats.includes(i) ? start : 0)),
    pos: Array(6).fill(0),
    out: Array(6).fill(false),
    owner: Array(n).fill(null),
    houses: Array(n).fill(0),
    mort: Array(n).fill(false),
    turn: seats[0],
    phase: 'roll',
    dice: null,
    doubles: 0,
    again: false,
    jail: Array(6).fill(0),
    freeCards: Array.from({ length: 6 }, () => []),
    decks: b.decks.map((d) => shuffle(d.cards.map((_, i) => i), rng)),
    card: null,
    skip: Array(6).fill(false),
    ins: Array(6).fill(0),
    freeCasino: false,
    freeIns: false,
    pot: 0,
    loan: Array(6).fill(0),
    loanLaps: Array(6).fill(0),
    loanUsed: Array(6).fill(false),
    auction: null,
    offer: null,
    debt: null,
    offers: 0,
    stock: [26, 12],
    round: 1,
    limit: o.limit ?? 0,
    startPass: !!o.startPass,
    loanOn: o.loan ?? true,
    result: null,
  };
}

// ---------------- участки ----------------

export const isProp = (s: State, c: number) => B(s).cells[c]?.kind === 'prop';
export const groupCells = (s: State, g: number) => B(s).cells.flatMap((c, i) => (c.kind === 'prop' && c.group === g ? [i] : []));
export const owned = (s: State, seat: number) => s.owner.flatMap((o, i) => (o === seat ? [i] : []));

/** Вся группа у одного хозяина и ничего не заложено. */
export function fullGroup(s: State, c: number): boolean {
  const cell = B(s).cells[c];
  if (s.map !== 'manager' || cell.group == null) return false;
  const own = s.owner[c];
  return own != null && own >= 0 && groupCells(s, cell.group).every((i) => s.owner[i] === own && !s.mort[i]);
}

export function rent(s: State, c: number): number {
  const cell = B(s).cells[c];
  if (!cell.rents || s.mort[c]) return 0;
  if (s.map === 'kosmos') return cell.rents[0];
  const h = s.houses[c];
  return h === 0 && fullGroup(s, c) ? cell.rents[0] * 2 : cell.rents[h];
}

const groupHouses = (s: State, c: number) => groupCells(s, B(s).cells[c].group!).map((i) => s.houses[i]);
const groupBuilt = (s: State, c: number) => B(s).cells[c].group != null && groupHouses(s, c).some((h) => h > 0);

export function canBuild(s: State, seat: number, c: number): boolean {
  const cell = B(s).cells[c];
  if (s.map !== 'manager' || s.owner[c] !== seat || !fullGroup(s, c)) return false;
  const h = s.houses[c];
  if (h >= 4 || h !== Math.min(...groupHouses(s, c))) return false;
  if (h < 3 ? s.stock[0] < 1 : s.stock[1] < 1) return false;
  return s.cash[seat] >= cell.build!;
}

export function canSell(s: State, seat: number, c: number): boolean {
  return s.map === 'manager' && s.owner[c] === seat && s.houses[c] > 0 && s.houses[c] === Math.max(...groupHouses(s, c));
}

export const canMortgage = (s: State, seat: number, c: number) => s.map === 'manager' && s.owner[c] === seat && !s.mort[c] && !groupBuilt(s, c);
export const redeemCost = (s: State, c: number) => B(s).cells[c].price! / 2;
export const canRedeem = (s: State, seat: number, c: number) => s.owner[c] === seat && s.mort[c] && s.cash[seat] >= redeemCost(s, c);
/** Участок можно продать или обменять: без построек в группе и не заложен. */
export const tradeable = (s: State, seat: number, c: number) => s.owner[c] === seat && !s.mort[c] && !(s.map === 'manager' && groupBuilt(s, c));

/** Сколько игрок может собрать, продав постройки и заложив всё («Менеджер») или продав планеты банку («Космос»). */
export function worth(s: State, seat: number): number {
  const b = B(s);
  let w = s.cash[seat];
  for (const c of owned(s, seat)) {
    const cell = b.cells[c];
    if (s.map === 'kosmos') w += cell.price!;
    else {
      w += s.houses[c] * (cell.build! / 2);
      if (!s.mort[c]) w += cell.price! / 2;
    }
  }
  return w;
}

/** Капитал для подсчёта в конце: деньги + цены участков (заложенные — половина) + постройки по цене, минус ссуда. */
export function capital(s: State, seat: number): number {
  const b = B(s);
  let w = s.cash[seat] - s.loan[seat];
  for (const c of owned(s, seat)) {
    const cell = b.cells[c];
    w += s.mort[c] ? cell.price! / 2 : cell.price!;
    w += s.houses[c] * (cell.build ?? 0);
  }
  return w;
}

export const housesOf = (s: State, seat: number) => {
  let h = 0;
  let e = 0;
  for (const c of owned(s, seat)) {
    if (s.houses[c] === 4) e++;
    else h += s.houses[c];
  }
  return { h, e };
};

// ---------------- деньги ----------------

type Ctx = { s: State; ev: Event[]; rng: Rng; depth: number };

function give(x: Ctx, from: Who, to: Who, amount: number, why: string) {
  if (amount <= 0) return;
  const { s } = x;
  if (typeof from === 'number') s.cash[from] -= amount;
  else if (from === 'pot') s.pot -= amount;
  if (typeof to === 'number') s.cash[to] += amount;
  else if (to === 'pot') s.pot += amount;
  x.ev.push({ type: 'pay', from, to, amount, why });
}

/** Списать с игрока. 'ok' — заплатил; 'debt' — «Менеджер»: открыт долг, ждём; 'broke' — «Космос»: разорился (ссуда или выбыл). */
function charge(x: Ctx, seat: number, amount: number, to: number | null | 'pot', why: string, then: Debt['then'] = 'finish'): 'ok' | 'debt' | 'broke' {
  const { s } = x;
  if (amount <= 0) return 'ok';
  if (s.cash[seat] >= amount) {
    give(x, seat, to, amount, why);
    return 'ok';
  }
  if (s.map === 'manager') {
    s.debt = { amount, to: typeof to === 'number' ? to : null, then };
    x.ev.push({ type: 'debt', seat, amount });
    if (worth(s, seat) < amount) {
      bankruptManager(x, seat);
      return 'broke';
    }
    s.phase = 'debt';
    return 'debt';
  }
  // «Космос»: в трудностях планеты продаются банку по цене, начиная с дешёвых
  const b = B(s);
  const mine = owned(s, seat).sort((a, c) => b.cells[a].price! - b.cells[c].price!);
  for (const c of mine) {
    if (s.cash[seat] >= amount) break;
    sellToBank(x, seat, c);
  }
  if (s.cash[seat] >= amount) {
    give(x, seat, to, amount, why);
    return 'ok';
  }
  give(x, seat, to, s.cash[seat], why);
  brokeKosmos(x, seat);
  return 'broke';
}

function sellToBank(x: Ctx, seat: number, c: number) {
  const { s } = x;
  const price = B(s).cells[c].price!;
  s.owner[c] = -1;
  s.cash[seat] += price;
  x.ev.push({ type: 'sellBank', seat, cell: c, price });
}

/** «Космос»: без денег и планет — банкрот. Ссуда 1000 (один раз, если включена) — на «Старт», вернуть 1200 за два круга. */
function brokeKosmos(x: Ctx, seat: number) {
  const { s } = x;
  if (s.loanOn && !s.loanUsed[seat] && alive(s).length > 1) {
    s.loanUsed[seat] = true;
    s.loan[seat] = 1200;
    s.loanLaps[seat] = 0;
    s.cash[seat] += 1000;
    s.pos[seat] = 0;
    s.ins[seat] = 0;
    s.skip[seat] = false;
    x.ev.push({ type: 'loan', seat });
    x.ev.push({ type: 'jump', seat, to: 0 });
    return;
  }
  eliminate(x, seat);
}

function eliminate(x: Ctx, seat: number) {
  const { s } = x;
  s.out[seat] = true;
  for (let c = 0; c < s.owner.length; c++) {
    if (s.owner[c] !== seat) continue;
    s.owner[c] = s.map === 'kosmos' ? -1 : null;
    if (s.houses[c] === 4) {
      s.stock[1]++;
    } else s.stock[0] += s.houses[c];
    s.houses[c] = 0;
    s.mort[c] = false;
  }
  for (const code of s.freeCards[seat]) s.decks[Math.floor(code / 100)].push(code % 100);
  s.freeCards[seat] = [];
  s.cash[seat] = 0;
  s.loan[seat] = 0;
  s.jail[seat] = 0;
  x.ev.push({ type: 'bankrupt', seat });
  checkWin(x);
}

/** «Менеджер», разорение: ценности уходят банку, банк выплачивает кредитору полную сумму долга. */
function bankruptManager(x: Ctx, seat: number) {
  const { s } = x;
  const d = s.debt;
  s.debt = null;
  if (d && d.to != null && !s.out[d.to]) give(x, null, d.to, d.amount, 'банк гасит долг банкрота');
  if (s.cash[seat] > 0) give(x, seat, null, s.cash[seat], 'всё имущество — банку');
  eliminate(x, seat);
}

function checkWin(x: Ctx) {
  const { s } = x;
  const left = alive(s);
  if (left.length <= 1 && !s.result) {
    s.result = { winners: left, text: s.map === 'kosmos' ? 'остался в космосе последним с капиталом' : 'единственный не разорился — монополист' };
    s.phase = 'over';
    x.ev.push({ type: 'end', winners: left, text: s.result.text });
  }
}

function endByCapital(x: Ctx) {
  const { s } = x;
  const left = alive(s);
  const cap = left.map((p) => capital(s, p));
  const best = Math.max(...cap);
  const winners = left.filter((_, i) => cap[i] === best);
  s.result = { winners, text: `богаче всех после ${s.round - 1} кругов: капитал ${money(s, best)}` };
  s.phase = 'over';
  x.ev.push({ type: 'end', winners, text: s.result.text });
}

// ---------------- ход ----------------

function nextTurn(x: Ctx) {
  const { s } = x;
  s.again = false;
  s.doubles = 0;
  s.offers = 0;
  s.freeCasino = false;
  s.freeIns = false;
  if (s.result) return;
  let i = s.seats.indexOf(s.turn);
  for (let k = 0; k < s.seats.length * 2; k++) {
    const j = (i + 1) % s.seats.length;
    if (j <= i) {
      s.round++;
      const cap = s.limit > 0 ? Math.min(s.limit, HARD_LIMIT) : HARD_LIMIT;
      if (s.round > cap) {
        endByCapital(x);
        return;
      }
    }
    i = j;
    const p = s.seats[i];
    if (s.out[p]) continue;
    if (s.skip[p]) {
      s.skip[p] = false;
      x.ev.push({ type: 'skip', seat: p });
      continue;
    }
    s.turn = p;
    s.phase = 'roll';
    return;
  }
  // все пропускают — ходит следующий живой
  s.turn = alive(s)[0];
  s.phase = 'roll';
}

/** Клетка разобрана — ход окончен (или ещё бросок). */
function finish(x: Ctx) {
  const { s } = x;
  if (s.result) {
    s.phase = 'over';
    return;
  }
  const seat = s.turn;
  if (!s.out[seat] && s.again && s.jail[seat] === 0) {
    s.again = false;
    s.phase = 'roll';
    x.ev.push({ type: 'again', seat });
    return;
  }
  nextTurn(x);
}

function passStart(x: Ctx, seat: number, landed: boolean) {
  const { s } = x;
  const b = B(s);
  if (s.map === 'manager' || landed || s.startPass) give(x, null, seat, b.startPay, landed ? 'остановка на «Старте»' : 'проход через «Старт»');
  if (s.loan[seat] > 0) {
    s.loanLaps[seat]++;
    if (s.cash[seat] >= s.loan[seat]) {
      give(x, seat, null, s.loan[seat], 'возврат ссуды');
      s.loan[seat] = 0;
      x.ev.push({ type: 'repay', seat });
    } else if (s.loanLaps[seat] >= 2) {
      const due = s.loan[seat];
      s.loan[seat] = 0;
      if (charge(x, seat, due, null, 'возврат ссуды') === 'ok') x.ev.push({ type: 'repay', seat });
      else if (!s.out[seat]) eliminate(x, seat);
    }
  }
}

/** Шаги фишки: n > 0 — вперёд, n < 0 — назад (назад «Старт» не платит). */
function step(x: Ctx, seat: number, n: number) {
  const { s } = x;
  const len = N(s);
  const path: number[] = [];
  let p = s.pos[seat];
  const dir = n > 0 ? 1 : -1;
  for (let i = 0; i < Math.abs(n); i++) {
    p = (p + dir + len) % len;
    path.push(p);
  }
  s.pos[seat] = p;
  x.ev.push({ type: 'move', seat, path });
  if (dir > 0) {
    const crossed = path.indexOf(0);
    if (crossed >= 0) passStart(x, seat, crossed === path.length - 1);
  }
  if (s.out[seat]) return;
  land(x, seat);
}

function moveTo(x: Ctx, seat: number, to: number, back = false) {
  const len = N(x.s);
  const from = x.s.pos[seat];
  const n = back ? -((from - to + len) % len) : (to - from + len) % len;
  if (n === 0) land(x, seat);
  else step(x, seat, n);
}

function goJail(x: Ctx, seat: number) {
  const { s } = x;
  s.pos[seat] = B(s).jail;
  s.jail[seat] = 1;
  s.again = false;
  s.doubles = 0;
  x.ev.push({ type: 'jump', seat, to: s.pos[seat] });
  x.ev.push({ type: 'jail', seat });
}

/** Штраф с учётом страховки «Космоса»: полная — не платит, половинная — платит половину. */
const insured = (s: State, seat: number, amount: number) => (s.ins[seat] === 2 ? 0 : s.ins[seat] === 1 ? Math.round(amount / 2) : amount);

function land(x: Ctx, seat: number) {
  const { s } = x;
  const b = B(s);
  const c = s.pos[seat];
  const cell = b.cells[c];
  s.phase = 'resolve';
  switch (cell.kind) {
    case 'prop': {
      const own = s.owner[c];
      if (own == null) s.phase = 'buy';
      else if (own === -1) {
        if (charge(x, seat, cell.rents![0], null, `посадка на ${cell.name}`) !== 'ok') return;
        if (s.cash[seat] >= cell.price! + 100) s.phase = 'bankBuy';
      } else if (own !== seat) {
        const r = rent(s, c);
        if (r > 0) charge(x, seat, r, own, `плата за наём: ${cell.name}`);
        else x.ev.push({ type: 'visit', seat, cell: c });
      }
      return;
    }
    case 'card':
      draw(x, seat, cell.deck!);
      return;
    case 'money':
      if (cell.amount! > 0) give(x, null, seat, cell.amount!, cell.name);
      else charge(x, seat, -cell.amount!, null, cell.name);
      return;
    case 'gojail':
      goJail(x, seat);
      return;
    case 'jail':
    case 'rest':
    case 'start':
      x.ev.push({ type: 'visit', seat, cell: c });
      return;
    case 'casino':
      if (!s.freeCasino && charge(x, seat, 50, null, 'место в казино') !== 'ok') return;
      s.freeCasino = false;
      s.phase = 'casino';
      return;
    case 'hole':
    case 'police':
      if (s.ins[seat] === 2) x.ev.push({ type: 'visit', seat, cell: c });
      else charge(x, seat, insured(s, seat, cell.kind === 'hole' ? 500 : 250), null, cell.kind === 'hole' ? 'чёрная дыра' : 'полиция');
      return;
    case 'pirates': {
      if (s.ins[seat] === 2) {
        x.ev.push({ type: 'visit', seat, cell: c });
        return;
      }
      const loss = insured(s, seat, s.cash[seat]);
      give(x, seat, 'pot', loss, 'пираты');
      if (s.cash[seat] <= 0 && owned(s, seat).length === 0) brokeKosmos(x, seat);
      return;
    }
    case 'insure':
      s.ins[seat] = 0;
      if (s.freeIns) {
        s.freeIns = false;
        s.ins[seat] = 2;
        x.ev.push({ type: 'insure', seat, level: 2, free: true });
        return;
      }
      s.phase = 'insure';
      return;
  }
}

function draw(x: Ctx, seat: number, deck: number) {
  const { s } = x;
  if (x.depth++ > 6) return;
  const d = s.decks[deck];
  if (!d.length) return;
  const id = d.shift()!;
  const card: Card = B(s).decks[deck].cards[id];
  s.card = { deck, id, seat };
  x.ev.push({ type: 'card', seat, deck, id });
  if (card.fx.k === 'free') {
    s.freeCards[seat].push(deck * 100 + id);
    return;
  }
  d.push(id);
  applyFx(x, seat, card);
}

function applyFx(x: Ctx, seat: number, card: Card) {
  const { s } = x;
  const b = B(s);
  const fx = card.fx;
  switch (fx.k) {
    case 'cash':
      if (fx.n > 0) give(x, null, seat, fx.n, 'карточка');
      else charge(x, seat, -fx.n, null, 'карточка');
      return;
    case 'goto':
      if (fx.free) s.freeCasino = true;
      moveTo(x, seat, fx.to, fx.back);
      return;
    case 'step':
      step(x, seat, fx.n);
      return;
    case 'jail':
      goJail(x, seat);
      return;
    case 'repair': {
      const { h, e } = housesOf(s, seat);
      charge(x, seat, h * fx.h + e * fx.e, null, 'ремонт и налоги');
      return;
    }
    case 'draw':
      draw(x, seat, fx.deck);
      return;
    case 'nearest': {
      const len = b.cells.length;
      let to = s.pos[seat];
      for (let i = 1; i <= len; i++) {
        const c = (s.pos[seat] + i) % len;
        const cell = b.cells[c];
        if (cell.kind === fx.kind && (fx.deck == null || cell.deck === fx.deck)) {
          to = c;
          break;
        }
      }
      if (fx.bonus) give(x, null, seat, fx.bonus, 'доставка груза');
      if (fx.insure) s.freeIns = true;
      moveTo(x, seat, to);
      return;
    }
    case 'pot': {
      const n = Math.min(s.pot, fx.n ?? s.pot);
      if (n > 0) give(x, 'pot', seat, n, 'золото Амазонок');
      return;
    }
    case 'birthday':
      for (const p of alive(s)) if (p !== seat) charge(x, p, fx.n, seat, 'на день рождения');
      return;
    case 'skip':
      s.skip[seat] = true;
      return;
    case 'again':
      s.again = true;
      return;
    case 'police':
      charge(x, seat, insured(s, seat, fx.n), null, 'нелады с полицией');
      return;
  }
}

/** Разобрать клетку и, если решать нечего, закончить ход. */
function settle(x: Ctx) {
  if (x.s.phase === 'resolve' || (x.s.out[x.s.turn] && x.s.phase !== 'over')) finish(x);
}

function startAuction(x: Ctx, cell: number) {
  const { s } = x;
  const i = s.seats.indexOf(s.turn);
  const order: number[] = [];
  for (let k = 1; k <= s.seats.length; k++) {
    const p = s.seats[(i + k) % s.seats.length];
    if (s.out[p]) continue;
    if (p === s.turn && s.map === 'kosmos') continue;
    order.push(p);
  }
  if (!order.length) {
    endAuction(x, cell, null, 0);
    return;
  }
  s.auction = { cell, bid: 0, leader: null, order, at: 0 };
  s.phase = 'auction';
}

function endAuction(x: Ctx, cell: number, seat: number | null, price: number) {
  const { s } = x;
  s.auction = null;
  if (seat != null) {
    give(x, seat, null, price, 'торги');
    s.owner[cell] = seat;
  } else if (s.map === 'kosmos') s.owner[cell] = -1;
  x.ev.push({ type: 'won', seat, cell, price });
  s.phase = 'resolve';
  finish(x);
}

function auctionStep(x: Ctx) {
  const a = x.s.auction!;
  if (!a.order.length) return endAuction(x, a.cell, null, 0);
  if (a.order.length === 1 && a.leader === a.order[0]) return endAuction(x, a.cell, a.leader, a.bid);
  a.at %= a.order.length;
  if (a.order[a.at] === a.leader && a.order.length > 1) a.at = (a.at + 1) % a.order.length;
}

/** Долг погашен — продолжить ход. */
function debtPaid(x: Ctx) {
  const { s } = x;
  const d = s.debt!;
  const seat = s.turn;
  s.debt = null;
  give(x, seat, d.to, d.amount, 'уплата долга');
  s.phase = 'resolve';
  if (d.then === 'move' && s.dice) step(x, seat, s.dice[0] + s.dice[1]);
  settle(x);
}

// ---------------- проверка и применение действия ----------------

export function toAct(s: State): number[] {
  if (s.result || s.phase === 'over') return [];
  if (s.phase === 'auction' && s.auction) return [s.auction.order[s.auction.at]];
  if (s.phase === 'offer' && s.offer) return [s.offer.to];
  return [s.turn];
}

const OPS = new Set(['build', 'sell', 'mortgage', 'redeem', 'sellBank', 'offer']);

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (!a || typeof a !== 'object' || s0.result || s0.out[seat]) return null;
  if (!toAct(s0).includes(seat)) return null;
  const s = clone(s0);
  const x: Ctx = { s, ev: [], rng, depth: 0 };
  const b = B(s);
  const cell = (c: unknown) => (typeof c === 'number' && Number.isInteger(c) && c >= 0 && c < b.cells.length ? c : -1);
  const ok = () => ({ state: s, events: x.ev });

  // операции с имуществом: свой ход до броска, при покупке и при долге
  if (OPS.has(a.type)) {
    const can = s.phase === 'roll' || s.phase === 'buy' || (s.phase === 'debt' && (a.type === 'sell' || a.type === 'mortgage'));
    if (!can || seat !== s.turn) return null;
    switch (a.type) {
      case 'build': {
        const c = cell(a.cell);
        if (c < 0 || s.phase === 'debt' || !canBuild(s, seat, c)) return null;
        const cost = b.cells[c].build!;
        if (s.houses[c] === 3) {
          s.stock[1]--;
          s.stock[0] += 3;
        } else s.stock[0]--;
        s.houses[c]++;
        give(x, seat, null, cost, s.houses[c] === 4 ? 'предприятие' : 'филиал');
        x.ev.push({ type: 'build', seat, cell: c, level: s.houses[c] });
        return ok();
      }
      case 'sell': {
        const c = cell(a.cell);
        if (c < 0 || !canSell(s, seat, c)) return null;
        const half = b.cells[c].build! / 2;
        if (s.houses[c] === 4) {
          const k = Math.min(3, s.stock[0]);
          s.stock[1]++;
          s.stock[0] -= k;
          s.houses[c] = k;
          give(x, null, seat, half * (1 + 3 - k), 'предприятие продано банку');
        } else {
          s.houses[c]--;
          s.stock[0]++;
          give(x, null, seat, half, 'филиал продан банку');
        }
        x.ev.push({ type: 'unbuild', seat, cell: c, level: s.houses[c] });
        break;
      }
      case 'mortgage': {
        const c = cell(a.cell);
        if (c < 0 || !canMortgage(s, seat, c)) return null;
        s.mort[c] = true;
        give(x, null, seat, b.cells[c].price! / 2, 'залог');
        x.ev.push({ type: 'mortgage', seat, cell: c, on: true });
        break;
      }
      case 'redeem': {
        const c = cell(a.cell);
        if (c < 0 || s.phase === 'debt' || !canRedeem(s, seat, c)) return null;
        s.mort[c] = false;
        give(x, seat, null, redeemCost(s, c), 'выкуп из залога');
        x.ev.push({ type: 'mortgage', seat, cell: c, on: false });
        return ok();
      }
      case 'sellBank': {
        const c = cell(a.cell);
        if (c < 0 || s.map !== 'kosmos' || s.owner[c] !== seat || s.phase === 'debt') return null;
        sellToBank(x, seat, c);
        return ok();
      }
      case 'offer': {
        if (s.phase !== 'roll' || s.offers >= MAX_OFFERS) return null;
        const o = validOffer(s, seat, a);
        if (!o) return null;
        s.offers++;
        s.offer = { ...o, back: s.phase };
        s.phase = 'offer';
        x.ev.push({ type: 'offer', offer: s.offer });
        return ok();
      }
    }
    // продажа/залог при долге: хватило — платим и идём дальше
    if (s.phase === 'debt' && s.debt && s.cash[seat] >= s.debt.amount) debtPaid(x);
    return ok();
  }

  switch (s.phase) {
    case 'roll': {
      if (a.type === 'payJail') {
        if (s.map !== 'manager' || !s.jail[seat] || s.cash[seat] < 500) return null;
        give(x, seat, null, 500, 'выход с биржи');
        s.jail[seat] = 0;
        x.ev.push({ type: 'free', seat, how: 'pay' });
        return ok();
      }
      if (a.type === 'useCard') {
        if (!s.jail[seat] || !s.freeCards[seat].length) return null;
        const code = s.freeCards[seat].shift()!;
        s.decks[Math.floor(code / 100)].push(code % 100);
        s.jail[seat] = 0;
        x.ev.push({ type: 'free', seat, how: 'card' });
        return ok();
      }
      if (a.type !== 'roll') return null;
      s.card = null;
      s.phase = 'resolve';
      if (s.map === 'kosmos') {
        const d = rng.int(6) + 1;
        s.dice = [d];
        x.ev.push({ type: 'roll', seat, dice: [d] });
        step(x, seat, d);
        settle(x);
        return ok();
      }
      const d1 = rng.int(6) + 1;
      const d2 = rng.int(6) + 1;
      s.dice = [d1, d2];
      x.ev.push({ type: 'roll', seat, dice: [d1, d2] });
      const dbl = d1 === d2;
      if (s.jail[seat]) {
        if (dbl) {
          s.jail[seat] = 0;
          x.ev.push({ type: 'free', seat, how: 'double' });
          step(x, seat, d1 + d2);
          settle(x);
          return ok();
        }
        s.jail[seat]++;
        if (s.jail[seat] <= 3) {
          x.ev.push({ type: 'stay', seat });
          finish(x);
          return ok();
        }
        s.jail[seat] = 0;
        x.ev.push({ type: 'free', seat, how: 'forced' });
        s.phase = 'resolve';
        const r = charge(x, seat, 500, null, 'выход с биржи', 'move');
        if (r === 'ok') step(x, seat, d1 + d2);
        if (r !== 'debt') settle(x);
        return ok();
      }
      if (dbl) {
        s.doubles++;
        if (s.doubles >= 3) {
          goJail(x, seat);
          finish(x);
          return ok();
        }
        s.again = true;
      } else s.again = false;
      step(x, seat, d1 + d2);
      settle(x);
      return ok();
    }
    case 'buy': {
      const c = s.pos[seat];
      const price = b.cells[c].price!;
      if (a.type === 'buy') {
        if (s.cash[seat] < price) return null;
        give(x, seat, null, price, 'покупка');
        s.owner[c] = seat;
        x.ev.push({ type: 'buy', seat, cell: c, price });
        s.phase = 'resolve';
        finish(x);
        return ok();
      }
      if (a.type !== 'pass') return null;
      x.ev.push({ type: 'decline', seat, cell: c });
      startAuction(x, c);
      return ok();
    }
    case 'auction': {
      const au = s.auction!;
      if (a.type === 'bid') {
        const n = Math.round(Number(a.amount));
        const min = au.bid ? au.bid + b.step : b.step;
        if (!Number.isFinite(n) || n < min || n > s.cash[seat] || n % b.step) return null;
        au.bid = n;
        au.leader = seat;
        au.at = (au.at + 1) % au.order.length;
        x.ev.push({ type: 'bid', seat, amount: n });
      } else if (a.type === 'fold') {
        au.order.splice(au.at, 1);
        x.ev.push({ type: 'fold', seat });
      } else return null;
      auctionStep(x);
      return ok();
    }
    case 'offer': {
      const o = s.offer!;
      if (a.type !== 'accept' && a.type !== 'reject') return null;
      s.offer = null;
      s.phase = o.back;
      if (a.type === 'accept') {
        if (!validOffer(s, o.from, o)) {
          x.ev.push({ type: 'deal', from: o.from, to: o.to, ok: false });
          return ok();
        }
        for (const c of o.give) s.owner[c] = o.to;
        for (const c of o.get) s.owner[c] = o.from;
        if (o.cash > 0) give(x, o.from, o.to, o.cash, 'сделка');
        if (o.cash < 0) give(x, o.to, o.from, -o.cash, 'сделка');
        for (let k = 0; k < Math.abs(o.cards); k++) {
          const [p, q] = o.cards > 0 ? [o.from, o.to] : [o.to, o.from];
          s.freeCards[q].push(s.freeCards[p].shift()!);
        }
      }
      x.ev.push({ type: 'deal', from: o.from, to: o.to, ok: a.type === 'accept' });
      return ok();
    }
    case 'debt': {
      if (a.type !== 'bankrupt') return null;
      bankruptManager(x, seat);
      if (!s.result) nextTurn(x);
      return ok();
    }
    case 'insure': {
      const lv = a.type === 'insure' ? a.level : -1;
      if (lv !== 0 && lv !== 1 && lv !== 2) return null;
      const cost = [0, 100, 250][lv];
      if (s.cash[seat] < cost) return null;
      give(x, seat, null, cost, 'страховка');
      s.ins[seat] = lv;
      x.ev.push({ type: 'insure', seat, level: lv });
      s.phase = 'resolve';
      finish(x);
      return ok();
    }
    case 'casino':
    case 'casino2': {
      if (s.phase === 'casino2' && a.type === 'pass') {
        s.phase = 'resolve';
        finish(x);
        return ok();
      }
      if (a.type !== 'spin') return null;
      const die = rng.int(6) + 1;
      const sector = s.phase === 'casino' ? die : die + 6;
      const amount = CASINO[sector - 1];
      const star = s.phase === 'casino' && CASINO_STAR[die - 1];
      x.ev.push({ type: 'casino', seat, die, sector, amount, star });
      s.phase = 'resolve';
      let r: ReturnType<typeof charge> = 'ok';
      if (amount > 0) give(x, null, seat, amount, 'выигрыш в казино');
      else r = charge(x, seat, -amount, null, 'проигрыш в казино');
      if (s.phase === 'resolve' && r === 'ok' && star) s.phase = 'casino2';
      settle(x);
      return ok();
    }
    case 'bankBuy': {
      const c = s.pos[seat];
      s.phase = 'resolve';
      if (a.type === 'buy') {
        const price = b.cells[c].price! + 100;
        if (s.cash[seat] < price) return null;
        give(x, seat, null, price, 'выкуп планеты у банка');
        s.owner[c] = seat;
        x.ev.push({ type: 'buy', seat, cell: c, price });
      } else if (a.type !== 'pass') return null;
      finish(x);
      return ok();
    }
  }
  return null;
}

function validOffer(s: State, from: number, a: { to: number; give: number[]; get: number[]; cash: number; cards: number }): Omit<Offer, 'back'> | null {
  const to = a.to;
  if (typeof to !== 'number' || to === from || !s.seats.includes(to) || s.out[to]) return null;
  if (!Array.isArray(a.give) || !Array.isArray(a.get)) return null;
  const giveC = [...new Set(a.give.map(Number))];
  const getC = [...new Set(a.get.map(Number))];
  if (!giveC.every((c) => tradeable(s, from, c)) || !getC.every((c) => tradeable(s, to, c))) return null;
  const cash = Math.round(Number(a.cash) || 0);
  const cards = Math.round(Number(a.cards) || 0);
  if (cash > s.cash[from] || -cash > s.cash[to]) return null;
  if (cards > s.freeCards[from].length || -cards > s.freeCards[to].length) return null;
  if (!giveC.length && !getC.length) return null;
  if (!giveC.length && cash <= 0 && cards <= 0) return null;
  if (!getC.length && cash >= 0 && cards >= 0) return null;
  return { from, to, give: giveC, get: getC, cash, cards };
}

/** Что видит игрок: всё, кроме порядка карточек в колодах. */
export function view(s: State): State {
  return { ...s, decks: [], deckLen: s.decks.map((d) => d.length) };
}
