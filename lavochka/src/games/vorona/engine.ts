/* «Белая ворона» — движок без DOM. Ходят по календарю месяца одним кубиком; в День Белой Вороны (31-е) — зарплата, проценты
 * по вкладу или займу и все счета «Почты». Банк у игрока один: bank > 0 — вклад, bank < 0 — заём (вклад и заём сразу не бывают).
 * Денег всегда хватает: недостающее берётся из вклада или в долг у банка, банкротства нет. Побеждает тот, у кого после
 * последнего месяца больше денег (наличные плюс вклад минус заём).
 *
 * Клетка разбирается для «актёра» (обычно ходящий; при линьке — по очереди все, кто сдвинулся назад). Решения: купить
 * бизнес, рискнуть «5 или 6», купить страховку или охотничий билет, что продать клиенту, банк в День Белой Вороны. */
import type { Rng } from '../../core/types';
import { BIZ, CELLS, DEPOSIT_RATE, ELECTION, LOAN_FREE, LOAN_RATE, MAIL, PAYDAY, SALARY, STAKE, type Variant } from './data';

export type Phase = 'roll' | 'resolve' | 'mail' | 'biz' | 'client' | 'payday' | 'over';

export interface State {
  variant: Variant;
  seats: number[];
  months: number;
  cash: number[];
  bank: number[];
  pos: number[];
  /** Сколько месяцев игрок уже закрыл. */
  month: number[];
  /** Отыграл все месяцы — ждёт остальных. */
  done: boolean[];
  /** Неоплаченные счета (номера карточек «Почты»). */
  bills: number[][];
  bonds: number[][];
  vet: boolean[];
  hunt: boolean[];
  /** Купленные бизнесы (номера в BIZ[variant]). */
  biz: number[][];
  /** Колоды сверху вниз; в view пустые, есть длины. */
  mail: number[];
  bizDeck: number[];
  mailLen?: number;
  bizLen?: number;
  /** Деньги выборов царя зверей. */
  pot: number;
  turn: number;
  /** Чья клетка сейчас разбирается и кто решает. */
  actor: number;
  phase: Phase;
  /** Карточка на столе: почта или бизнес. */
  card: { kind: 'mail' | 'biz'; id: number } | null;
  /** «Бизнес — дубль»: сколько карточек ещё взять. */
  bizLeft: number;
  /** Линька: кто ещё сдвигается назад и разбирает клетку. */
  queue: number[];
  dice: number | null;
  result: { winners: number[]; text: string; scores: Record<number, number> } | null;
}

export type Action =
  | { type: 'roll' }
  | { type: 'buy' }
  | { type: 'pass' }
  | { type: 'sell'; i: number }
  /** Банк: n > 0 — внести (погасить заём, затем вклад), n < 0 — снять (вклад, затем заём). Вне Дня Белой Вороны — только взять в долг. */
  | { type: 'bank'; n: number }
  | { type: 'done' };

type Who = number | null | 'pot';

export type Event =
  | { type: 'roll'; seat: number; d: number }
  | { type: 'move'; seat: number; path: number[]; back?: boolean }
  | { type: 'pay'; from: Who; to: Who; amount: number; why: string }
  | { type: 'loan'; seat: number; amount: number; auto?: boolean }
  | { type: 'bank'; seat: number; n: number; bank: number }
  | { type: 'mail'; seat: number; id: number; res: 'bill' | 'covered' | 'take' | 'bond' | 'junk' | 'offer' }
  | { type: 'insure'; seat: number; id: number; buy: boolean }
  | { type: 'risk'; seat: number; d: number; win: boolean }
  | { type: 'biz'; seat: number; id: number; buy: boolean | null }
  | { type: 'sell'; seat: number; id: number; price: number; fee: number; to: number | null; rolls: { seat: number; d: number }[][] }
  | { type: 'auction'; rolls: { seat: number; d: number }[][]; winner: number; pot: number }
  | { type: 'election'; seat: number; pot: number }
  | { type: 'bonds'; seat: number; amount: number }
  | { type: 'payday'; seat: number; interest: number; bills: number; month: number }
  | { type: 'done'; seat: number }
  | { type: 'end'; winners: number[]; text: string };

export const fmt = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export const cells = (s: State) => CELLS[s.variant];
export const bizList = (s: State) => BIZ[s.variant];
export const score = (s: State, seat: number) => s.cash[seat] + s.bank[seat];
export const active = (s: State) => s.seats.filter((p) => !s.done[p]);
/** Сколько стоят счета игрока. */
export const billsSum = (s: State, seat: number) => s.bills[seat].reduce((n, id) => n + MAIL[id].n, 0);

function shuffle(a: number[], rng: Rng) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function newState(variant: Variant, seats: number[], months: number, rng: Rng): State {
  const six = <T>(f: (i: number) => T) => Array.from({ length: 6 }, (_, i) => f(i));
  return {
    variant,
    seats,
    months: Math.max(1, months),
    cash: six((i) => (seats.includes(i) ? SALARY : 0)),
    bank: six(() => 0),
    pos: six(() => 0),
    month: six(() => 0),
    done: six((i) => !seats.includes(i)),
    bills: six(() => []),
    bonds: six(() => []),
    vet: six(() => false),
    hunt: six(() => false),
    biz: six(() => []),
    mail: shuffle(MAIL.map((_, i) => i), rng),
    bizDeck: shuffle(BIZ[variant].map((_, i) => i), rng),
    pot: 0,
    turn: seats[0],
    actor: seats[0],
    phase: 'roll',
    card: null,
    bizLeft: 0,
    queue: [],
    dice: null,
    result: null,
  };
}

export function clone(s: State): State {
  return {
    ...s,
    seats: s.seats.slice(),
    cash: s.cash.slice(),
    bank: s.bank.slice(),
    pos: s.pos.slice(),
    month: s.month.slice(),
    done: s.done.slice(),
    bills: s.bills.map((x) => x.slice()),
    bonds: s.bonds.map((x) => x.slice()),
    vet: s.vet.slice(),
    hunt: s.hunt.slice(),
    biz: s.biz.map((x) => x.slice()),
    mail: s.mail.slice(),
    bizDeck: s.bizDeck.slice(),
    card: s.card ? { ...s.card } : null,
    queue: s.queue.slice(),
    result: s.result ? { ...s.result, winners: s.result.winners.slice(), scores: { ...s.result.scores } } : null,
  };
}

type Ctx = { s: State; ev: Event[]; rng: Rng };

const die = (x: Ctx) => x.rng.int(6) + 1;

function give(x: Ctx, to: number, amount: number, why: string) {
  if (amount <= 0) return;
  x.s.cash[to] += amount;
  x.ev.push({ type: 'pay', from: null, to, amount, why });
}

/** Заплатить: наличными, а не хватает — из вклада или в долг у банка. */
function pay(x: Ctx, seat: number, amount: number, to: Who, why: string) {
  const { s } = x;
  if (amount <= 0) return;
  const short = Math.max(0, amount - s.cash[seat]);
  if (short > 0) {
    s.cash[seat] += short;
    s.bank[seat] -= short;
    x.ev.push({ type: 'loan', seat, amount: short, auto: true });
  }
  s.cash[seat] -= amount;
  if (typeof to === 'number') s.cash[to] += amount;
  else if (to === 'pot') s.pot += amount;
  x.ev.push({ type: 'pay', from: seat, to, amount, why });
}

/** Бросают по очереди, при равенстве — переигрывают равные. Возвращает победителя и все круги бросков. */
function rollOff(x: Ctx, players: number[]): { winner: number; rolls: { seat: number; d: number }[][] } {
  const rolls: { seat: number; d: number }[][] = [];
  let who = players;
  for (let k = 0; k < 20; k++) {
    const r = who.map((seat) => ({ seat, d: die(x) }));
    rolls.push(r);
    const best = Math.max(...r.map((q) => q.d));
    who = r.filter((q) => q.d === best).map((q) => q.seat);
    if (who.length === 1) break;
  }
  return { winner: who[0], rolls };
}

// ---------------- клетки ----------------

function drawMail(x: Ctx, seat: number) {
  const { s } = x;
  const id = s.mail.shift();
  if (id == null) return;
  const m = MAIL[id];
  s.card = { kind: 'mail', id };
  switch (m.kind) {
    case 'pay':
      if ((m.tag === 'vet' && s.vet[seat]) || (m.tag === 'hunt' && s.hunt[seat])) {
        x.ev.push({ type: 'mail', seat, id, res: 'covered' });
        s.mail.push(id);
      } else {
        x.ev.push({ type: 'mail', seat, id, res: 'bill' });
        s.bills[seat].push(id);
      }
      return;
    case 'take':
      x.ev.push({ type: 'mail', seat, id, res: 'take' });
      give(x, seat, m.n, 'Успех');
      s.mail.push(id);
      return;
    case 'bond':
      x.ev.push({ type: 'mail', seat, id, res: 'bond' });
      s.bonds[seat].push(id);
      return;
    case 'junk':
      x.ev.push({ type: 'mail', seat, id, res: 'junk' });
      s.mail.push(id);
      return;
    case 'vet':
    case 'hunt':
      if ((m.kind === 'vet' && s.vet[seat]) || (m.kind === 'hunt' && s.hunt[seat])) {
        // уже есть — карточка не нужна
        x.ev.push({ type: 'mail', seat, id, res: 'junk' });
        s.mail.push(id);
        return;
      }
      x.ev.push({ type: 'mail', seat, id, res: 'offer' });
      s.phase = 'mail';
      return;
    case 'risk':
      x.ev.push({ type: 'mail', seat, id, res: 'offer' });
      s.phase = 'mail';
      return;
  }
}

function drawBiz(x: Ctx, seat: number) {
  const { s } = x;
  const id = s.bizDeck.shift();
  if (id == null) {
    s.bizLeft = 0;
    return;
  }
  s.bizLeft = Math.max(0, s.bizLeft - 1);
  s.card = { kind: 'biz', id };
  x.ev.push({ type: 'biz', seat, id, buy: null });
  s.phase = 'biz';
}

/** Разобрать клетку, на которой стоит seat. molt — сдвинут линькой (линька второй раз не срабатывает). */
function resolve(x: Ctx, seat: number, molt = false) {
  const { s } = x;
  s.actor = seat;
  s.phase = 'resolve';
  const cell = cells(s)[s.pos[seat]];
  switch (cell.kind) {
    case 'mail':
      drawMail(x, seat);
      return;
    case 'take':
      give(x, seat, cell.n!, cell.name);
      return;
    case 'pay':
      pay(x, seat, cell.n!, null, cell.name);
      return;
    case 'biz':
      s.bizLeft = 1;
      drawBiz(x, seat);
      return;
    case 'biz2':
      s.bizLeft = 2;
      drawBiz(x, seat);
      return;
    case 'client':
      if (s.biz[seat].length) s.phase = 'client';
      return;
    case 'auction': {
      const players = s.seats.filter((p) => !s.done[p] || p === seat);
      for (const p of players) pay(x, p, STAKE, 'pot', 'ставка на аукционе');
      const bank = STAKE * players.length;
      s.pot -= bank;
      const { winner, rolls } = rollOff(x, players);
      s.cash[winner] += bank;
      x.ev.push({ type: 'auction', rolls, winner, pot: bank });
      return;
    }
    case 'election':
      pay(x, seat, ELECTION, 'pot', 'на выборы царя зверей');
      return;
    case 'molt':
      if (molt) return;
      // все, начиная с попавшего, — на квадрат назад и разбирают свою клетку; кто на старте — стоит, а попавший получает 325
      for (const p of order(s, seat)) {
        if (s.done[p]) continue;
        if (s.pos[p] === 0) {
          give(x, seat, SALARY, 'линька: игрок на старте');
          continue;
        }
        s.pos[p]--;
        x.ev.push({ type: 'move', seat: p, path: [s.pos[p]], back: true });
        s.queue.push(p);
      }
      return;
    case 'draw': {
      const sum = s.bonds[seat].reduce((n, id) => n + MAIL[id].n, 0);
      if (sum > 0) {
        x.ev.push({ type: 'bonds', seat, amount: sum });
        give(x, seat, sum, 'облигации лесного займа');
        s.mail.push(...s.bonds[seat]);
        s.bonds[seat] = [];
      }
      return;
    }
    case 'payday':
      payday(x, seat);
      return;
    case 'start':
    case 'off':
      return;
  }
}

/** Места по кругу, начиная с seat. */
function order(s: State, seat: number): number[] {
  const i = s.seats.indexOf(seat);
  return s.seats.map((_, k) => s.seats[(i + k) % s.seats.length]);
}

function payday(x: Ctx, seat: number) {
  const { s } = x;
  give(x, seat, SALARY, 'зарплата за месяц');
  let interest = 0;
  if (s.bank[seat] > 0) {
    interest = Math.floor(s.bank[seat] * DEPOSIT_RATE);
    give(x, seat, interest, '10 % по вкладу');
  } else if (-s.bank[seat] > LOAN_FREE) {
    interest = -Math.ceil(-s.bank[seat] * LOAN_RATE);
    pay(x, seat, -interest, null, '20 % по займу');
  }
  const bills = billsSum(s, seat);
  if (bills > 0) pay(x, seat, bills, null, 'счета «Почты»');
  s.mail.push(...s.bills[seat]);
  s.bills[seat] = [];
  // неиспользованные облигации — в колоду
  s.mail.push(...s.bonds[seat]);
  s.bonds[seat] = [];
  x.ev.push({ type: 'payday', seat, interest, bills, month: s.month[seat] + 1 });
  s.phase = 'payday';
}

/** Месяц закрыт: на старт; последний месяц — игрок ждёт остальных. */
function closeMonth(x: Ctx, seat: number) {
  const { s } = x;
  s.month[seat]++;
  s.pos[seat] = 0;
  x.ev.push({ type: 'move', seat, path: [0] });
  if (s.month[seat] >= s.months) {
    s.done[seat] = true;
    // бизнесы в конце игры отбрасываются
    s.bizDeck.push(...s.biz[seat]);
    s.biz[seat] = [];
    x.ev.push({ type: 'done', seat });
  }
}

/** Разбор закончен — следующий в очереди линьки или следующий ход. */
function cont(x: Ctx) {
  const { s } = x;
  while (s.phase === 'resolve') {
    if (s.bizLeft > 0) {
      drawBiz(x, s.actor);
      continue;
    }
    const p = s.queue.shift();
    if (p != null) {
      resolve(x, p, true);
      continue;
    }
    nextTurn(x);
  }
}

function nextTurn(x: Ctx) {
  const { s } = x;
  s.card = null;
  const left = active(s);
  if (!left.length) {
    end(x);
    return;
  }
  let i = s.seats.indexOf(s.turn);
  for (let k = 0; k < s.seats.length; k++) {
    i = (i + 1) % s.seats.length;
    if (!s.done[s.seats[i]]) break;
  }
  s.turn = s.actor = s.seats[i];
  s.phase = 'roll';
}

function end(x: Ctx) {
  const { s } = x;
  const scores: Record<number, number> = {};
  for (const p of s.seats) scores[p] = score(s, p);
  const best = Math.max(...s.seats.map((p) => scores[p]));
  const winners = s.seats.filter((p) => scores[p] === best);
  const text = best >= 0 ? `самый экономный: ${fmt(best)} монет после ${s.months} мес.` : `меньше всех должен банку: ${fmt(-best)} монет`;
  s.result = { winners, text, scores };
  s.phase = 'over';
  x.ev.push({ type: 'end', winners, text });
}

// ---------------- действия ----------------

export function toAct(s: State): number[] {
  if (s.result || s.phase === 'over') return [];
  return [s.actor];
}

/** Можно ли сейчас операцию с банком на n. */
export function bankOk(s: State, seat: number, n: number): boolean {
  if (!Number.isInteger(n) || !n || n % 50) return false;
  if (s.phase === 'payday' && seat === s.actor) return n > 0 ? s.cash[seat] >= n : true;
  // вне Дня Белой Вороны — только взять или увеличить заём
  return n < 0 && s.bank[seat] <= 0 && ['roll', 'mail', 'biz', 'client'].includes(s.phase) && seat === s.actor;
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (!a || typeof a !== 'object' || s0.result || !toAct(s0).includes(seat)) return null;
  const s = clone(s0);
  const x: Ctx = { s, ev: [], rng };
  const ok = () => ({ state: s, events: x.ev });

  if (a.type === 'bank') {
    const n = Math.round(Number(a.n));
    if (!bankOk(s, seat, n)) return null;
    s.cash[seat] -= n;
    s.bank[seat] += n;
    x.ev.push({ type: 'bank', seat, n, bank: s.bank[seat] });
    return ok();
  }

  switch (s.phase) {
    case 'roll': {
      if (a.type !== 'roll') return null;
      const d = die(x);
      s.dice = d;
      s.card = null;
      x.ev.push({ type: 'roll', seat, d });
      // выборы царя зверей: первый, кто выбросит 6, забирает деньги
      if (d === 6 && s.pot > 0) {
        x.ev.push({ type: 'election', seat, pot: s.pot });
        s.cash[seat] += s.pot;
        s.pot = 0;
      }
      const from = s.pos[seat];
      const to = Math.min(PAYDAY, from + d);
      const path: number[] = [];
      for (let p = from + 1; p <= to; p++) path.push(p);
      s.pos[seat] = to;
      x.ev.push({ type: 'move', seat, path });
      resolve(x, seat);
      cont(x);
      return ok();
    }
    case 'mail': {
      const id = s.card!.id;
      const m = MAIL[id];
      if (a.type !== 'buy' && a.type !== 'pass') return null;
      const buy = a.type === 'buy';
      s.phase = 'resolve';
      if (m.kind === 'risk') {
        if (buy) {
          const d = die(x);
          const win = d >= 5;
          x.ev.push({ type: 'risk', seat, d, win });
          if (win) give(x, seat, 1000 - STAKE, '«5 или 6» — выигрыш 1000');
          else pay(x, seat, STAKE, null, '«5 или 6» — ставка');
        }
        s.mail.push(id);
      } else {
        x.ev.push({ type: 'insure', seat, id, buy });
        if (buy) {
          pay(x, seat, m.n, null, m.who);
          if (m.kind === 'vet') s.vet[seat] = true;
          else s.hunt[seat] = true;
          // уже пришедшие счета этой службы тоже погашены
          const covered = s.bills[seat].filter((b) => MAIL[b].tag === m.kind);
          s.bills[seat] = s.bills[seat].filter((b) => MAIL[b].tag !== m.kind);
          s.mail.push(...covered);
        } else s.mail.push(id);
      }
      cont(x);
      return ok();
    }
    case 'biz': {
      const id = s.card!.id;
      if (a.type === 'buy') {
        pay(x, seat, bizList(s)[id].cost, null, 'покупка бизнеса');
        s.biz[seat].push(id);
        x.ev.push({ type: 'biz', seat, id, buy: true });
      } else if (a.type === 'pass') {
        s.bizDeck.push(id);
        x.ev.push({ type: 'biz', seat, id, buy: false });
      } else return null;
      s.phase = 'resolve';
      cont(x);
      return ok();
    }
    case 'client': {
      if (a.type !== 'sell' || !Number.isInteger(a.i) || a.i < 0 || a.i >= s.biz[seat].length) return null;
      const id = s.biz[seat].splice(a.i, 1)[0];
      const b = bizList(s)[id];
      s.cash[seat] += b.price;
      s.bizDeck.push(id);
      const others = s.seats.filter((p) => p !== seat);
      let to: number | null = null;
      let rolls: { seat: number; d: number }[][] = [];
      if (others.length) {
        const r = rollOff(x, others);
        to = r.winner;
        rolls = r.rolls;
        s.cash[to] += b.fee;
      }
      x.ev.push({ type: 'sell', seat, id, price: b.price, fee: b.fee, to, rolls });
      s.phase = 'resolve';
      cont(x);
      return ok();
    }
    case 'payday': {
      if (a.type !== 'done') return null;
      closeMonth(x, seat);
      s.phase = 'resolve';
      cont(x);
      return ok();
    }
  }
  return null;
}

/** Что видит игрок: всё, кроме порядка колод. */
export function view(s: State): State {
  return { ...s, mail: [], bizDeck: [], mailLen: s.mail.length, bizLen: s.bizDeck.length };
}
