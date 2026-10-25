/* «Мо-но-пол» — правила (кооператив «МИЛАГ», 1991). Без DOM. Разбор и решения без пользователя — docs/analysis/monopol.md.
 *
 * 2–6 игроков, у каждого 500 банкнот, все на «Папиной сберкнижке». Ход — бросок одного кубика и столько клеток по часовой
 * стрелке; на развилке у «Зала игровых автоматов» чётный бросок ведёт на малый круг, нечётный — на большой. Фирму можно
 * купить; попавший на чужую платит хозяину дробь от «настоящей цены» (цена + вложенные хозяином банкноты). Вкладывать и
 * перекладывать банкноты по своим фирмам — только перед своим ходом. Сберкнижки дают кредит до 2× капитала; рулетка,
 * лотерея «Спринт», подвал «Чёрного кота», «Белка в колесе», «Тараканьи бега», баня, «Рижский рынок» — по правилам. */
import type { Options, Rng } from '../../core/types';
import {
  BAKERY,
  BARBER,
  BATH_N,
  CELLAR,
  CELLAR_FINE,
  CELLAR_H,
  CELLAR_IN,
  CELLAR_OUT,
  CELLAR_ROLLS,
  CELLAR_W,
  cellAt,
  FIRMS,
  HOTTABYCH,
  LOCS,
  LOTTERY,
  lotText,
  next,
  PLUS,
  RACE_TRACK,
  SM,
  WHEEL,
  ZAL,
  type Lot,
} from './board';

export interface Cfg {
  /** Сколько кругов играть (0 — до разорения). */
  rounds: number;
}
export const cfgFrom = (o: Options): Cfg => {
  const r = Number(o.rounds);
  return { rounds: [0, 15, 25, 40].includes(r) ? r : 25 };
};

export const START = 500;
export const LOAN_STEP = 100;
const SAFETY_ROUNDS = 120;

export type Where = 'board' | 'cellar' | 'wheel' | 'race' | 'bath';
export type Phase = 'turn' | 'buy' | 'bank' | 'roulette' | 'pick' | 'free' | 'market' | 'cellar' | 'cellarGo' | 'wheel' | 'race';

export interface State {
  cfg: Cfg;
  n: number;
  turn: number;
  /** Место на кругах (big 0…29, small 100…104). */
  loc: number[];
  where: Where[];
  /** Подвал — r * 7 + c, колесо — сектор, бега — клетка (−1 — у старта), баня — тазик (0 — ещё на Бане). */
  sub: number[];
  cash: number[];
  /** Долг Папиной и Маминой сберкнижкам. */
  debt: [number, number][];
  /** Хозяин фирмы по месту (−1 — свободна) и вложенные банкноты. */
  owner: Record<number, number>;
  inv: Record<number, number>;
  alive: boolean[];
  /** Пропустить ходов. */
  skip: number[];
  /** Касса игровых автоматов. */
  pot: number;
  phase: Phase;
  /** Бросок этого хода (последний). */
  die: number | null;
  /** Стоял на Зале игровых автоматов в начале хода. */
  zal: boolean[];
  /** На сберкнижке: долг этой книжке уже урегулирован в этот визит. */
  settled: boolean;
  /** Подвал: бросков сделано; бега: набранная сумма. */
  rolls: number;
  sum: number;
  round: number;
  first: number;
  over: boolean;
  winner: number | null;
  ply: number;
}

export type Action =
  | { type: 'roll' }
  | { type: 'invest'; loc: number; amount: number }
  | { type: 'shift'; from: number; to: number; amount: number }
  | { type: 'buy'; loc: number }
  | { type: 'pass' }
  | { type: 'repay' }
  | { type: 'interest' }
  | { type: 'loan'; amount: number }
  | { type: 'bet'; amount: number; num: number }
  | { type: 'pick'; loc: number }
  | { type: 'go'; cell: number };

export type Event =
  | { type: 'roll'; seat: number; die: number }
  | { type: 'move'; seat: number; path: number[] }
  | { type: 'jump'; seat: number; to: number; where: Where; sub: number }
  | { type: 'money'; seat: number; delta: number; why: string; to?: number }
  | { type: 'buy'; seat: number; loc: number; price: number; from?: number }
  | { type: 'rent'; seat: number; owner: number; loc: number; amount: number }
  | { type: 'loan'; seat: number; bank: 0 | 1; amount: number }
  | { type: 'lottery'; seat: number; a: number; b: number; text: string }
  | { type: 'bet'; seat: number; amount: number; num: number; die: number; win: boolean }
  | { type: 'pot'; seat: number; amount: number }
  | { type: 'skip'; seat: number }
  | { type: 'broke'; seat: number }
  | { type: 'invest'; seat: number; loc: number; amount: number; from?: number }
  | { type: 'end'; winner: number | null; worth: number[] };

const firmPrice = (loc: number) => cellAt(loc).price ?? 0;
const den = (loc: number) => cellAt(loc).den ?? 1;
/** Настоящая цена фирмы. */
export const realPrice = (s: State, loc: number) => firmPrice(loc) + (s.inv[loc] ?? 0);
/** Плата попавшему на чужую фирму. */
export const rentOf = (s: State, loc: number) => Math.floor(realPrice(s, loc) / den(loc));
export const firmsOf = (s: State, seat: number) => FIRMS.filter((l) => s.owner[l] === seat);
export const debtOf = (s: State, seat: number) => s.debt[seat][0] + s.debt[seat][1];
/** Капитал: наличные, вклады и цены фирм. */
export const capital = (s: State, seat: number) => s.cash[seat] + firmsOf(s, seat).reduce((x, l) => x + realPrice(s, l), 0);
/** Состояние для итога: капитал минус долги. */
export const worth = (s: State, seat: number) => capital(s, seat) - debtOf(s, seat);
/** Сколько ещё можно взять в кредит. */
export const loanLimit = (s: State, seat: number) => Math.max(0, Math.floor((2 * capital(s, seat) - debtOf(s, seat)) / LOAN_STEP) * LOAN_STEP);
/** Сберкнижка места: 0 — Папина, 1 — Мамина. */
export const bankOf = (loc: number): 0 | 1 => (cellAt(loc).kind === 'mama' ? 1 : 0);

export function newState(cfg: Cfg, n: number, first = 0): State {
  const owner: Record<number, number> = {};
  const inv: Record<number, number> = {};
  for (const l of FIRMS) {
    owner[l] = -1;
    inv[l] = 0;
  }
  return {
    cfg,
    n,
    turn: first,
    loc: Array(n).fill(0),
    where: Array(n).fill('board'),
    sub: Array(n).fill(0),
    cash: Array(n).fill(START),
    debt: Array.from({ length: n }, () => [0, 0] as [number, number]),
    owner,
    inv,
    alive: Array(n).fill(true),
    skip: Array(n).fill(0),
    pot: 0,
    phase: 'turn',
    die: null,
    zal: Array(n).fill(false),
    settled: false,
    rolls: 0,
    sum: 0,
    round: 1,
    first,
    over: false,
    winner: null,
    ply: 0,
  };
}

export const setup = (seats: number[], o: Options) => newState(cfgFrom(o), Math.max(2, seats.length));
export const toAct = (s: State) => (s.over ? [] : [s.turn]);

// ---------------------------------------------------------------- подвал

const key = (r: number, c: number) => r * CELLAR_W + c;
const isCat = (r: number, c: number) => CELLAR[r][c] === null;

/** Кратчайшие расстояния по подвалу от клетки (не через кота). */
function cellarDist(from: number): number[] {
  const d = Array(CELLAR_W * CELLAR_H).fill(-1);
  d[from] = 0;
  const q = [from];
  while (q.length) {
    const p = q.shift()!;
    const r = Math.floor(p / CELLAR_W);
    const c = p % CELLAR_W;
    for (const [dr, dc] of [
      [0, 1],
      [1, 0],
      [0, -1],
      [-1, 0],
    ]) {
      const rr = r + dr;
      const cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= CELLAR_H || cc >= CELLAR_W || isCat(rr, cc)) continue;
      const k = key(rr, cc);
      if (d[k] < 0) {
        d[k] = d[p] + 1;
        q.push(k);
      }
    }
  }
  return d;
}

/** Куда можно пойти в подвале на d шагов (туда-обратно можно): клетки и −1 — выход. */
export function cellarTargets(s: State, seat: number, d: number): number[] {
  const dist = cellarDist(s.sub[seat]);
  const out: number[] = [];
  dist.forEach((x, k) => {
    if (x >= 0 && x <= d && (d - x) % 2 === 0) out.push(k);
  });
  const toOut = dist[key(CELLAR_OUT[0], CELLAR_OUT[1])];
  if (toOut >= 0 && toOut + 1 <= d) out.push(-1);
  return out;
}
export const cellarValue = (k: number) => CELLAR[Math.floor(k / CELLAR_W)][k % CELLAR_W] ?? 0;

// ---------------------------------------------------------------- действия

export function legal(s: State): Action[] {
  if (s.over) return [];
  const seat = s.turn;
  const cash = s.cash[seat];
  const out: Action[] = [];
  switch (s.phase) {
    case 'turn': {
      out.push({ type: 'roll' });
      if (s.where[seat] !== 'board' && s.where[seat] !== 'bath') return out;
      const mine = firmsOf(s, seat);
      for (const l of mine) {
        for (const a of [100, 500]) if (cash >= a) out.push({ type: 'invest', loc: l, amount: a });
        if (s.inv[l] >= 100) for (const t of mine) if (t !== l) out.push({ type: 'shift', from: l, to: t, amount: 100 });
      }
      return out;
    }
    case 'buy': {
      const l = s.loc[seat];
      if (cash >= firmPrice(l)) out.push({ type: 'buy', loc: l });
      out.push({ type: 'pass' });
      return out;
    }
    case 'bank': {
      const b = bankOf(s.loc[seat]);
      const d = s.debt[seat][b];
      if (d > 0 && !s.settled) {
        out.push({ type: 'interest' });
        if (cash >= d) out.push({ type: 'repay' });
        return out;
      }
      const lim = loanLimit(s, seat);
      for (let a = LOAN_STEP; a <= lim; a += a < 1000 ? LOAN_STEP : 500) out.push({ type: 'loan', amount: a });
      out.push({ type: 'pass' });
      return out;
    }
    case 'roulette': {
      out.push({ type: 'pass' });
      for (const a of [50, 100, 200, 500, 1000]) if (a <= cash) for (let num = 1; num <= 6; num++) out.push({ type: 'bet', amount: a, num });
      return out;
    }
    case 'pick':
      return LOCS.map((loc) => ({ type: 'pick', loc }) as Action);
    case 'free':
      for (const l of FIRMS) if (s.owner[l] < 0 && cash >= firmPrice(l)) out.push({ type: 'buy', loc: l });
      out.push({ type: 'pass' });
      return out;
    case 'market':
      for (const l of FIRMS) if (s.owner[l] !== seat && cash >= marketCost(s, l)) out.push({ type: 'buy', loc: l });
      out.push({ type: 'pass' });
      return out;
    case 'cellarGo':
      return cellarTargets(s, seat, s.die ?? 1).map((cell) => ({ type: 'go', cell }) as Action);
    case 'cellar':
    case 'wheel':
    case 'race':
      return [{ type: 'roll' }];
  }
}

/** Цена на «Рижском рынке»: свободная — цена, чужая — хозяину цена с вкладами и в фонд дробь. */
export function marketCost(s: State, l: number): number {
  if (s.owner[l] < 0) return firmPrice(l);
  return realPrice(s, l) + rentOf(s, l);
}

/** Одно и то же действие (по полям — порядок ключей в пришедшем по сети объекте может быть другим). */
function same(a: Action, b: Action): boolean {
  if (a.type !== b.type) return false;
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  return Object.keys(x).every((k) => x[k] === y[k]) && Object.keys(y).length === Object.keys(x).length;
}

export function apply(s: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s.over || seat !== s.turn || !a || typeof a !== 'object') return null;
  // ставка в рулетке — любой суммой наличных
  if (s.phase === 'roulette' && a.type === 'bet') {
    if (!Number.isInteger(a.amount) || a.amount <= 0 || a.amount > s.cash[seat] || !Number.isInteger(a.num) || a.num < 1 || a.num > 6) return null;
    return step(s, a, rng);
  }
  if (s.phase === 'bank' && a.type === 'loan') {
    if (!Number.isInteger(a.amount) || a.amount <= 0 || a.amount % LOAN_STEP || a.amount > loanLimit(s, seat) || !(s.debt[seat][bankOf(s.loc[seat])] === 0 || s.settled)) return null;
    return step(s, a, rng);
  }
  if (!legal(s).some((m) => same(m, a))) return null;
  return step(s, a, rng);
}

function clone(s: State): State {
  return {
    ...s,
    loc: s.loc.slice(),
    where: s.where.slice(),
    sub: s.sub.slice(),
    cash: s.cash.slice(),
    debt: s.debt.map((d) => [d[0], d[1]] as [number, number]),
    owner: { ...s.owner },
    inv: { ...s.inv },
    alive: s.alive.slice(),
    skip: s.skip.slice(),
    zal: s.zal.slice(),
  };
}

export function step(s0: State, a: Action, rng: Rng): { state: State; events: Event[] } {
  const s = clone(s0);
  const seat = s.turn;
  const ev: Event[] = [];
  s.ply++;
  const done = () => endTurn(s, ev);
  switch (a.type) {
    case 'invest': {
      s.cash[seat] -= a.amount;
      s.inv[a.loc] += a.amount;
      ev.push({ type: 'invest', seat, loc: a.loc, amount: a.amount });
      return { state: s, events: ev };
    }
    case 'shift': {
      s.inv[a.from] -= a.amount;
      s.inv[a.to] += a.amount;
      ev.push({ type: 'invest', seat, loc: a.to, amount: a.amount, from: a.from });
      return { state: s, events: ev };
    }
    case 'roll': {
      const d = 1 + rng.int(6);
      s.die = d;
      ev.push({ type: 'roll', seat, die: d });
      if (s.phase === 'turn') {
        if (s.where[seat] === 'bath') {
          s.sub[seat] += d;
          if (s.sub[seat] > BATH_N) {
            s.where[seat] = 'board';
            s.sub[seat] = 0;
            ev.push({ type: 'jump', seat, to: s.loc[seat], where: 'board', sub: 0 });
          } else ev.push({ type: 'jump', seat, to: s.loc[seat], where: 'bath', sub: s.sub[seat] });
          done();
          return { state: s, events: ev };
        }
        const fromZal = s.zal[seat];
        moveBy(s, seat, d, ev);
        if (fromZal && d === 6 && s.pot > 0) {
          // с Зала — шестёрка: касса игровых автоматов твоя
          ev.push({ type: 'pot', seat, amount: s.pot });
          s.cash[seat] += s.pot;
          s.pot = 0;
        }
        land(s, seat, ev, rng);
        return { state: s, events: ev };
      }
      if (s.phase === 'cellar') {
        s.rolls++;
        s.phase = 'cellarGo';
        return { state: s, events: ev };
      }
      if (s.phase === 'wheel') {
        s.sub[seat] = (s.sub[seat] + d) % WHEEL.length;
        s.rolls++;
        const v = WHEEL[s.sub[seat]];
        ev.push({ type: 'jump', seat, to: s.loc[seat], where: 'wheel', sub: s.sub[seat] });
        if (v === null || s.rolls >= 30) {
          s.where[seat] = 'board';
          s.loc[seat] = HOTTABYCH;
          ev.push({ type: 'jump', seat, to: HOTTABYCH, where: 'board', sub: 0 });
          done();
        } else money(s, seat, v, 'белка в колесе', ev);
        return { state: s, events: ev };
      }
      if (s.phase === 'race') {
        const k = s.sub[seat] + d;
        const last = RACE_TRACK.length - 1;
        if (k > last) return raceOut(s, seat, ev);
        s.sub[seat] = k;
        ev.push({ type: 'jump', seat, to: s.loc[seat], where: 'race', sub: k });
        const v = RACE_TRACK[k];
        if (v === 'half') s.sum = Math.trunc(s.sum / 2);
        else if (v === 'double') {
          s.sum *= 2;
          return raceOut(s, seat, ev);
        } else s.sum += v;
        return { state: s, events: ev };
      }
      return { state: s, events: ev };
    }
    case 'go': {
      if (a.cell < 0) return cellarOut(s, seat, ev, false);
      s.sub[seat] = a.cell;
      ev.push({ type: 'jump', seat, to: s.loc[seat], where: 'cellar', sub: a.cell });
      const v = cellarValue(a.cell);
      if (v) money(s, seat, v, 'подвал', ev);
      if (!s.alive[seat]) {
        done();
        return { state: s, events: ev };
      }
      if (s.rolls >= CELLAR_ROLLS) return cellarOut(s, seat, ev, true);
      s.phase = 'cellar';
      return { state: s, events: ev };
    }
    case 'buy': {
      const l = a.loc;
      if (s.phase === 'market' && s.owner[l] >= 0) {
        const own = s.owner[l];
        const back = realPrice(s, l);
        const fee = rentOf(s, l);
        s.cash[seat] -= back + fee;
        s.cash[own] += back;
        ev.push({ type: 'buy', seat, loc: l, price: back + fee, from: own });
      } else {
        s.cash[seat] -= firmPrice(l);
        ev.push({ type: 'buy', seat, loc: l, price: firmPrice(l) });
      }
      s.owner[l] = seat;
      s.inv[l] = 0;
      if (s.phase === 'market' && legal(s).length > 1) return { state: s, events: ev };
      done();
      return { state: s, events: ev };
    }
    case 'pass':
      done();
      return { state: s, events: ev };
    case 'interest': {
      const b = bankOf(s.loc[seat]);
      const pct = Math.max(1, Math.floor(s.debt[seat][b] / (cellAt(s.loc[seat]).den ?? 10)));
      pay(s, seat, pct, -1, b === 0 ? 'процент Папиной сберкнижке' : 'процент Маминой сберкнижке', ev);
      s.settled = true;
      if (!s.alive[seat]) done();
      return { state: s, events: ev };
    }
    case 'repay': {
      const b = bankOf(s.loc[seat]);
      const d = s.debt[seat][b];
      s.cash[seat] -= d;
      s.debt[seat][b] = 0;
      s.settled = true;
      ev.push({ type: 'money', seat, delta: -d, why: b === 0 ? 'долг Папиной сберкнижке' : 'долг Маминой сберкнижке' });
      return { state: s, events: ev };
    }
    case 'loan': {
      const b = bankOf(s.loc[seat]);
      s.debt[seat][b] += a.amount;
      s.cash[seat] += a.amount;
      ev.push({ type: 'loan', seat, bank: b, amount: a.amount });
      done();
      return { state: s, events: ev };
    }
    case 'bet': {
      const d = 1 + rng.int(6);
      const win = d === a.num;
      s.die = d;
      ev.push({ type: 'bet', seat, amount: a.amount, num: a.num, die: d, win });
      if (win) money(s, seat, 5 * a.amount, 'рулетка', ev);
      else money(s, seat, -a.amount, 'рулетка', ev);
      done();
      return { state: s, events: ev };
    }
    case 'pick': {
      s.loc[seat] = a.loc;
      ev.push({ type: 'jump', seat, to: a.loc, where: 'board', sub: 0 });
      land(s, seat, ev, rng, 0, true);
      return { state: s, events: ev };
    }
  }
}

/** Выход из бегов: сумма — из фонда или в фонд, фишка — на Пекарню. */
function raceOut(s: State, seat: number, ev: Event[]) {
  if (s.sum) money(s, seat, s.sum, 'тараканьи бега', ev);
  s.sum = 0;
  if (s.alive[seat]) {
    s.where[seat] = 'board';
    s.loc[seat] = BAKERY;
    ev.push({ type: 'jump', seat, to: BAKERY, where: 'board', sub: 0 });
  }
  endTurn(s, ev);
  return { state: s, events: ev };
}

function cellarOut(s: State, seat: number, ev: Event[], fine: boolean) {
  if (fine) pay(s, seat, CELLAR_FINE, -1, 'не успел выйти из подвала', ev);
  if (s.alive[seat]) {
    s.where[seat] = 'board';
    s.loc[seat] = SM + BARBER;
    ev.push({ type: 'jump', seat, to: SM + BARBER, where: 'board', sub: 0 });
  }
  endTurn(s, ev);
  return { state: s, events: ev };
}

/** Деньги из фонда (delta > 0) или в фонд (delta < 0, с распродажей при нехватке). */
function money(s: State, seat: number, delta: number, why: string, ev: Event[]) {
  if (delta >= 0) {
    s.cash[seat] += delta;
    ev.push({ type: 'money', seat, delta, why });
  } else pay(s, seat, -delta, -1, why, ev);
}

/** Заплатить: to ≥ 0 — игроку, −1 — в фонд, −2 — в кассу игровых автоматов. Не хватает — вклады, потом фирмы за полцены; иначе банкрот. */
export function pay(s: State, seat: number, amount: number, to: number, why: string, ev: Event[]) {
  if (s.cash[seat] < amount) raise(s, seat, amount, ev);
  const paid = Math.min(amount, s.cash[seat]);
  s.cash[seat] -= paid;
  if (to >= 0) s.cash[to] += paid;
  else if (to === -2) s.pot += paid;
  ev.push({ type: 'money', seat, delta: -paid, why, to });
  if (paid < amount) bankrupt(s, seat, ev);
}

function raise(s: State, seat: number, need: number, ev: Event[]) {
  const mine = firmsOf(s, seat);
  for (const l of mine) {
    if (s.cash[seat] >= need) return;
    if (s.inv[l] > 0) {
      s.cash[seat] += s.inv[l];
      ev.push({ type: 'invest', seat, loc: l, amount: -s.inv[l] });
      s.inv[l] = 0;
    }
  }
  for (const l of mine.sort((x, y) => firmPrice(x) - firmPrice(y))) {
    if (s.cash[seat] >= need) return;
    const half = Math.floor(firmPrice(l) / 2);
    s.cash[seat] += half;
    s.owner[l] = -1;
    ev.push({ type: 'money', seat, delta: half, why: `фирма «${cellAt(l).name}» продана в фонд за полцены` });
  }
}

function bankrupt(s: State, seat: number, ev: Event[]) {
  s.alive[seat] = false;
  for (const l of firmsOf(s, seat)) {
    s.owner[l] = -1;
    s.inv[l] = 0;
  }
  s.cash[seat] = 0;
  s.debt[seat] = [0, 0];
  ev.push({ type: 'broke', seat });
}

/** Ход фишки на d клеток: премия +500 за проход и попадание. */
function moveBy(s: State, seat: number, d: number, ev: Event[]) {
  const even = d % 2 === 0;
  let loc = s.loc[seat];
  const path = [loc];
  for (let i = 0; i < d; i++) {
    loc = next(loc, even);
    path.push(loc);
    if (PLUS.includes(loc)) {
      s.cash[seat] += 500;
      ev.push({ type: 'money', seat, delta: 500, why: '+500' });
    }
  }
  s.loc[seat] = loc;
  ev.push({ type: 'move', seat, path });
}

/** Что делать на клетке. */
/** jumped — попал не ходом (лотерея, выбор клетки): тогда «+500» платится здесь, при ходе — в moveBy. */
function land(s: State, seat: number, ev: Event[], rng: Rng, depth = 0, jumped = false) {
  const loc = s.loc[seat];
  const c = cellAt(loc);
  const done = () => endTurn(s, ev);
  switch (c.kind) {
    case 'firm': {
      const own = s.owner[loc];
      if (own < 0) {
        if (s.cash[seat] >= firmPrice(loc)) s.phase = 'buy';
        else done();
      } else if (own !== seat && s.alive[own]) {
        const r = rentOf(s, loc);
        ev.push({ type: 'rent', seat, owner: own, loc, amount: r });
        pay(s, seat, r, own, `«${c.name}»`, ev);
        done();
      } else done();
      return;
    }
    case 'papa':
    case 'mama':
      s.phase = 'bank';
      s.settled = false;
      if (!legal(s).some((a) => a.type !== 'pass')) done();
      return;
    case 'roulette':
      if (s.cash[seat] >= 50) s.phase = 'roulette';
      else done();
      return;
    case 'zal':
      pay(s, seat, 200, -2, 'зал игровых автоматов', ev);
      done();
      return;
    case 'lottery': {
      const a = 1 + rng.int(6);
      const b = 1 + rng.int(6);
      const lot = LOTTERY[a - 1][b - 1];
      ev.push({ type: 'lottery', seat, a, b, text: lotText(lot) });
      lottery(s, seat, lot, ev, rng, depth);
      return;
    }
    case 'cat':
      s.where[seat] = 'cellar';
      s.sub[seat] = key(CELLAR_IN[0], CELLAR_IN[1]);
      s.rolls = 0;
      s.phase = 'cellar';
      ev.push({ type: 'jump', seat, to: loc, where: 'cellar', sub: s.sub[seat] });
      return;
    case 'wheel':
      s.where[seat] = 'wheel';
      s.sub[seat] = 0;
      s.rolls = 0;
      s.phase = 'wheel';
      ev.push({ type: 'jump', seat, to: loc, where: 'wheel', sub: 0 });
      return;
    case 'race':
      s.where[seat] = 'race';
      s.sub[seat] = -1;
      s.sum = 0;
      s.phase = 'race';
      ev.push({ type: 'jump', seat, to: loc, where: 'race', sub: -1 });
      return;
    case 'bath':
      s.where[seat] = 'bath';
      s.sub[seat] = 0;
      done();
      return;
    case 'market':
      s.phase = 'market';
      if (legal(s).length <= 1) done();
      return;
    case 'plus':
      if (jumped) money(s, seat, 500, '+500', ev);
      done();
      return;
    default:
      // касса игровых автоматов
      done();
  }
}

function lottery(s: State, seat: number, l: Lot, ev: Event[], rng: Rng, depth: number) {
  const done = () => endTurn(s, ev);
  switch (l.k) {
    case 'cash':
      money(s, seat, l.v, 'лотерея', ev);
      return done();
    case 'kassa':
      pay(s, seat, l.v, -2, 'лотерея — в кассу игровых автоматов', ev);
      return done();
    case 'fund':
      pay(s, seat, l.v, -1, 'лотерея — в фонд', ev);
      return done();
    case 'skip':
      s.skip[seat]++;
      return done();
    case 'each':
      for (let o = 0; o < s.n; o++) if (o !== seat && s.alive[o]) pay(s, o, l.v, seat, 'лотерея', ev);
      return done();
    case 'go':
      s.loc[seat] = l.to;
      ev.push({ type: 'jump', seat, to: l.to, where: 'board', sub: 0 });
      return land(s, seat, ev, rng, depth + 1, true);
    case 'any':
      s.phase = 'pick';
      return;
    case 'free':
      if (FIRMS.some((f) => s.owner[f] < 0)) {
        s.phase = 'free';
        if (legal(s).length <= 1) done();
      } else {
        s.phase = 'market';
        if (legal(s).length <= 1) done();
      }
      return;
    case 'again':
      if (depth > 5) return done();
      return land(s, seat, ev, rng, depth + 1);
  }
}


/** Конец хода: следующий живой игрок; пропуски; конец круга и партии. */
function endTurn(s: State, ev: Event[]) {
  s.phase = 'turn';
  s.settled = false;
  const seat = s.turn;
  s.zal[seat] = s.where[seat] === 'board' && s.loc[seat] === ZAL;
  const alive = s.alive.filter(Boolean).length;
  if (alive <= 1) return finish(s, ev);
  let t = seat;
  for (let guard = 0; guard < 4 * s.n; guard++) {
    t = (t + 1) % s.n;
    if (t === s.first) {
      s.round++;
      if ((s.cfg.rounds && s.round > s.cfg.rounds) || s.round > SAFETY_ROUNDS) return finish(s, ev);
    }
    if (!s.alive[t]) continue;
    if (s.skip[t] > 0) {
      s.skip[t]--;
      ev.push({ type: 'skip', seat: t });
      continue;
    }
    break;
  }
  s.turn = t;
}

function finish(s: State, ev: Event[]) {
  s.over = true;
  const w = Array.from({ length: s.n }, (_, i) => (s.alive[i] ? worth(s, i) : -Infinity));
  const best = Math.max(...w);
  const top = w.flatMap((x, i) => (x === best ? [i] : []));
  s.winner = top.length === 1 ? top[0] : null;
  ev.push({ type: 'end', winner: s.winner, worth: w.map((x) => (x === -Infinity ? 0 : x)) });
}

