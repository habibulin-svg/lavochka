/* Кто я? — движок. У каждого на лбу персонаж: все видят чужих, свой — нет. Загадывает сосед справа (или случайно).
 * В свой ход игрок спрашивает про себя «да/нет», остальные отвечают, решает большинство: «да» — спрашивает дальше, иначе ход переходит.
 * В свой ход можно назвать себя: угадал — выбыл победителем (места по порядку), нет — ход переходит.
 * Готовые вопросы боты понимают по данным; свои вопросы и свои персонажи — только если за столом одни люди. Без DOM. */
import type { Options, Rng } from '../../core/types';
import { CHAR, norm, poolOf, QUESTIONS, type Ans } from './chars';

export type Phase = 'pick' | 'ask' | 'answer' | 'over';

/** Персонаж места: из списка (id) или придуманный (только имя). */
export interface Who {
  id?: string;
  name: string;
}

export interface Ask {
  seat: number;
  /** Номер готового вопроса; нет — свой вопрос text. */
  q?: number;
  text: string;
  result?: Ans;
  /** Догадка «я — …»: что назвал и угадал ли. */
  guess?: string;
  right?: boolean;
}

export interface State {
  seats: number[];
  humans: number[];
  pool: string;
  /** Свои вопросы и персонажи (за столом нет ботов). */
  free: boolean;
  /** До первого угадавшего или до последнего. */
  goal: 'first' | 'all';
  phase: Phase;
  chars: Record<number, Who>;
  /** Кто кому загадывает: загадывающий → кому. */
  pickFor: Record<number, number>;
  turn: number;
  answers: Record<number, Ans>;
  log: Ask[];
  /** Угадавшие по порядку. */
  done: number[];
}

export type Action =
  | { type: 'pick'; id?: string; name?: string }
  | { type: 'ask'; q?: number; text?: string }
  | { type: 'answer'; ans: Ans }
  | { type: 'guess'; id?: string; name?: string };

export type Event =
  | { type: 'pick'; by: number; to: number; who: Who | null }
  | { type: 'start'; turn: number }
  | { type: 'ask'; seat: number; text: string; q?: number }
  | { type: 'answer'; seat: number; ans: Ans }
  | { type: 'result'; seat: number; result: Ans; next: number }
  | { type: 'guess'; seat: number; guess: string; right: boolean; who: Who | null; next: number | null }
  | { type: 'over'; done: number[] };

export interface View {
  seats: number[];
  humans: number[];
  pool: string;
  free: boolean;
  goal: State['goal'];
  phase: Phase;
  /** Чужие персонажи (свой — только когда угадан или игра окончена). */
  chars: Record<number, Who>;
  /** Кому из своих мест надо загадать (и уже загадано ли). */
  pickFor: Record<number, number>;
  picked: number[];
  turn: number;
  answers: Record<number, Ans>;
  log: Ask[];
  done: number[];
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

export function setup(seats: number[], opts: Options, rng: Rng, humans: number[] = []): State {
  const hs = humans.filter((x) => seats.includes(x));
  const s: State = {
    seats: seats.slice(),
    humans: hs,
    pool: String(opts.pool ?? 'all'),
    free: hs.length === seats.length,
    goal: opts.goal === 'first' ? 'first' : 'all',
    phase: 'pick',
    chars: {},
    pickFor: {},
    turn: seats[0],
    answers: {},
    log: [],
    done: [],
  };
  // сосед справа загадывает левому: место i — для i+1
  seats.forEach((x, i) => (s.pickFor[x] = seats[(i + 1) % seats.length]));
  if (opts.pick === 'random') {
    const pool = poolOf(s.pool).slice();
    for (const x of seats) {
      const c = pool.splice(rng.int(pool.length), 1)[0];
      s.chars[x] = { id: c.id, name: c.name };
    }
    s.phase = 'ask';
  }
  return s;
}

const left = (s: State) => s.seats.filter((x) => !s.done.includes(x));
const nextTurn = (s: State, from: number) => {
  const order = s.seats;
  for (let k = 1; k <= order.length; k++) {
    const x = order[(order.indexOf(from) + k) % order.length];
    if (!s.done.includes(x)) return x;
  }
  return from;
};

export function toAct(s: State): number[] {
  switch (s.phase) {
    case 'pick':
      return s.seats.filter((x) => !(s.pickFor[x] in s.chars));
    case 'ask':
      return [s.turn];
    case 'answer':
      return s.seats.filter((x) => x !== s.turn && !(x in s.answers));
    default:
      return [];
  }
}

/** Ответ места на готовый вопрос по данным (боты и проверка). */
export function truth(s: Pick<State, 'chars'>, seat: number, q: number): Ans {
  const id = s.chars[seat]?.id;
  return id && CHAR[id] ? QUESTIONS[q].test(CHAR[id]) : '?';
}

function isRight(who: Who, a: { id?: string; name?: string }): boolean {
  if (a.id && who.id) return a.id === who.id;
  const g = norm(a.id ? CHAR[a.id]?.name ?? '' : a.name ?? '');
  return !!g && g === norm(who.name);
}

export function apply(s0: State, seat: number, a: Action, _rng: Rng): { state: State; events: Event[] } | null {
  if (!a || typeof a !== 'object' || !s0.seats.includes(seat) || !toAct(s0).includes(seat)) return null;
  const s = clone(s0);
  const ev: Event[] = [];
  switch (a.type) {
    case 'pick': {
      if (s.phase !== 'pick') return null;
      const to = s.pickFor[seat];
      let who: Who;
      if (a.id) {
        const c = CHAR[a.id];
        if (!c || !poolOf(s.pool).includes(c)) return null;
        who = { id: c.id, name: c.name };
      } else {
        const name = String(a.name ?? '').trim().slice(0, 60);
        if (!s.free || !name) return null;
        who = { name };
      }
      // два одинаковых персонажа за столом — путаница; но своего загадывающий не видит — с ним совпасть можно
      if (Object.entries(s.chars).some(([x, w]) => +x !== seat && ((w.id && w.id === who.id) || norm(w.name) === norm(who.name)))) return null;
      s.chars[to] = who;
      ev.push({ type: 'pick', by: seat, to, who });
      if (Object.keys(s.chars).length === s.seats.length) {
        s.phase = 'ask';
        ev.push({ type: 'start', turn: s.turn });
      }
      break;
    }
    case 'ask': {
      if (s.phase !== 'ask') return null;
      const q = a.q != null && Number.isInteger(a.q) && a.q >= 0 && a.q < QUESTIONS.length ? a.q : undefined;
      const text = q != null ? QUESTIONS[q].q : String(a.text ?? '').trim().slice(0, 200);
      if (q == null && !s.free) return null;
      s.log.push({ seat, q, text });
      s.answers = {};
      s.phase = 'answer';
      ev.push({ type: 'ask', seat, text, q });
      break;
    }
    case 'answer': {
      if (s.phase !== 'answer' || !['y', 'n', '?'].includes(a.ans)) return null;
      s.answers[seat] = a.ans;
      ev.push({ type: 'answer', seat, ans: a.ans });
      if (toAct(s).length) break;
      const vals = Object.values(s.answers);
      const y = vals.filter((x) => x === 'y').length;
      const n = vals.filter((x) => x === 'n').length;
      const result: Ans = y > n ? 'y' : n > y ? 'n' : '?';
      s.log[s.log.length - 1].result = result;
      // «да» — спрашивает дальше, иначе ход переходит
      if (result !== 'y') s.turn = nextTurn(s, s.turn);
      s.phase = 'ask';
      ev.push({ type: 'result', seat: s.log[s.log.length - 1].seat, result, next: s.turn });
      break;
    }
    case 'guess': {
      if (s.phase !== 'ask') return null;
      if (!a.id && !String(a.name ?? '').trim()) return null;
      if (a.id && !CHAR[a.id]) return null;
      if (!a.id && !s.free) return null;
      const who = s.chars[seat];
      const right = isRight(who, a);
      const guess = a.id ? CHAR[a.id].name : String(a.name).trim().slice(0, 60);
      s.log.push({ seat, text: `Я — ${guess}?`, guess, right });
      if (right) s.done.push(seat);
      const over = right && (s.goal === 'first' || left(s).length <= 1);
      if (!over) s.turn = nextTurn(s, seat);
      ev.push({ type: 'guess', seat, guess, right, who: right ? who : null, next: over ? null : s.turn });
      if (over) {
        s.phase = 'over';
        ev.push({ type: 'over', done: s.done.slice() });
      }
      break;
    }
    default:
      return null;
  }
  return { state: s, events: ev };
}

export function makeView(s: State, seats: number[] | 'all'): View {
  const chars: Record<number, Who> = {};
  for (const x of s.seats) {
    if (!(x in s.chars)) continue;
    if (seats === 'all' || !seats.includes(x) || s.done.includes(x) || s.phase === 'over') chars[x] = s.chars[x];
  }
  const pickFor: Record<number, number> = {};
  for (const x of s.seats) if (seats === 'all' || seats.includes(x)) pickFor[x] = s.pickFor[x];
  return {
    seats: s.seats,
    humans: s.humans,
    pool: s.pool,
    free: s.free,
    goal: s.goal,
    phase: s.phase,
    chars,
    pickFor,
    picked: s.seats.filter((x) => x in s.chars),
    turn: s.turn,
    answers: s.answers,
    log: s.log,
    done: s.done,
  };
}

/** Своего персонажа не видно и в событиях. */
export function redact(ev: Event, seats: number[] | 'all'): Event {
  if (seats === 'all') return ev;
  if (ev.type === 'pick' && seats.includes(ev.to)) return { ...ev, who: null };
  return ev;
}
