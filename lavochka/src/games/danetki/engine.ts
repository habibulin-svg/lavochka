/* Данетки — движок. Ведущий читает странную историю, игроки по кругу задают вопросы «да/нет», ведущий отвечает «да», «нет» или «неважно».
 * По правилам: после каждого круга — подсказка (их три), после четвёртого круга время вышло; разгадавший получает 4/5/6 очков (лёгкая/средняя/трудная)
 * минус очко за каждую прочитанную подсказку; ведущий — по очереди. Без правил: спрашивают сколько угодно, подсказки — когда ведущий решит, без очков.
 * Ведущий-бот отвечает по сценарию: игроки выбирают готовые вопросы, разгадку — из четырёх вариантов. Живой ведущий — свободные вопросы и разгадка своими словами. Без DOM. */
import type { Options, Rng } from '../../core/types';
import { DANETKI, danetka, type Ans } from './data';

export type Phase = 'play' | 'reveal' | 'over';

export interface Entry {
  seat: number;
  text: string;
  /** Номер готового вопроса сценария. */
  q?: number;
  a?: Ans;
  /** Догадка: номер варианта (в порядке показа) или своими словами. */
  guess?: boolean;
  opt?: number;
  right?: boolean;
  /** Подсказка ведущего (номер). */
  hint?: number;
}

export interface Result {
  id: number;
  solver: number | null;
  gain: number;
  host: number | null;
}

export interface State {
  seats: number[];
  humans: number[];
  rules: boolean;
  /** Ведущий — бот вне стола (null) или по очереди из игроков. */
  hostSeats: boolean;
  level: string;
  kids: boolean;
  total: number;
  n: number;
  host: number | null;
  id: number;
  /** Порядок вариантов разгадки на экране: optOrder[i] — номер в сценарии (0 — верный). */
  optOrder: number[];
  players: number[];
  turn: number;
  circle: number;
  circles: number;
  asked: number[];
  hints: number;
  log: Entry[];
  /** Ждёт ответа ведущего: номер записи в log. */
  pending: number | null;
  /** Варианты, которые уже назвали неверно. */
  wrongOpts: number[];
  phase: Phase;
  scores: Record<number, number>;
  ready: number[];
  last: Result | null;
  history: Result[];
  used: number[];
}

export type Action =
  | { type: 'ask'; q?: number; text?: string }
  | { type: 'answer'; a: Ans }
  | { type: 'guess'; opt?: number; text?: string }
  | { type: 'judge'; right: boolean }
  | { type: 'hint' }
  | { type: 'giveup' }
  | { type: 'next' };

export type Event =
  | { type: 'start'; n: number; id: number; host: number | null }
  | { type: 'entry'; entry: Entry }
  | { type: 'answer'; seat: number; a: Ans }
  | { type: 'judge'; seat: number; right: boolean }
  | { type: 'hint'; n: number; text: string }
  | { type: 'end'; result: Result; answer: string }
  | { type: 'over'; scores: Record<number, number> };

export interface View {
  seats: number[];
  humans: number[];
  rules: boolean;
  hostSeats: boolean;
  level: number;
  n: number;
  total: number;
  host: number | null;
  id: number;
  title: string;
  story: string;
  players: number[];
  turn: number;
  circle: number;
  circles: number;
  asked: number[];
  hints: string[];
  totalHints: number;
  log: Entry[];
  pending: number | null;
  /** Готовые вопросы (текст) — для игры с ботом-ведущим и для ботов. */
  questions: string[];
  /** Варианты разгадки в порядке показа. */
  options: string[];
  wrongOpts: number[];
  phase: Phase;
  scores: Record<number, number>;
  ready: number[];
  last: Result | null;
  history: Result[];
  /** Только ведущему (и всем после раскрытия): разгадка, ответы сценария, верный вариант. */
  secret?: { answer: string; short: string; answers: Ans[]; correct: number; hints: string[] };
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

export function pool(level: string, kids: boolean) {
  return DANETKI.filter((d) => (level === 'any' || String(d.level) === level) && (!kids || d.kids));
}

export function setup(seats: number[], opts: Options, rng: Rng, humans: number[] = []): State {
  const hostSeats = opts.host === 'players' && seats.length >= 2;
  const total = opts.count === 'hosts' ? (hostSeats ? seats.length : 5) : Math.max(1, Number(opts.count ?? 5) | 0);
  const s: State = {
    seats: seats.slice(),
    humans: humans.filter((x) => seats.includes(x)),
    rules: opts.mode !== 'free',
    hostSeats,
    level: String(opts.level ?? 'any'),
    kids: opts.kids === true,
    total,
    n: 0,
    host: null,
    id: 0,
    optOrder: [],
    players: [],
    turn: seats[0],
    circle: 1,
    circles: 4,
    asked: [],
    hints: 0,
    log: [],
    pending: null,
    wrongOpts: [],
    phase: 'play',
    scores: Object.fromEntries(seats.map((x) => [x, 0])),
    ready: [],
    last: null,
    history: [],
    used: [],
  };
  start(s, rng);
  return s;
}

function start(s: State, rng: Rng): Event {
  s.n++;
  let list = pool(s.level, s.kids);
  if (!list.length) list = DANETKI;
  let fresh = list.filter((d) => !s.used.includes(d.id));
  if (!fresh.length) fresh = list;
  const d = fresh[rng.int(fresh.length)];
  s.id = d.id;
  s.used.push(d.id);
  s.host = s.hostSeats ? s.seats[(s.n - 1) % s.seats.length] : null;
  // спрашивают по кругу, начиная слева от ведущего
  const i0 = s.host == null ? 0 : s.seats.indexOf(s.host) + 1;
  s.players = s.seats.map((_, k) => s.seats[(i0 + k) % s.seats.length]).filter((x) => x !== s.host);
  s.turn = s.players[0];
  s.circle = 1;
  // по правилам — четыре вопроса на игрока; вдвоём-втроём кругов больше, чтобы всего было не меньше 12 вопросов
  s.circles = Math.max(4, Math.ceil(12 / s.players.length));
  s.asked = [];
  s.hints = 0;
  s.log = [];
  s.pending = null;
  s.wrongOpts = [];
  const order = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) {
    const j = rng.int(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  s.optOrder = order;
  s.phase = 'play';
  s.ready = [];
  s.last = null;
  return { type: 'start', n: s.n, id: s.id, host: s.host };
}

/** Живой ведущий (человек) — тогда свободные вопросы и разгадка своими словами. */
export const liveHost = (s: Pick<State, 'host' | 'humans'>) => s.host != null && s.humans.includes(s.host);

export function toAct(s: State): number[] {
  if (s.phase === 'over') return [];
  if (s.phase === 'reveal') {
    const wait = s.humans.filter((x) => !s.ready.includes(x));
    return s.humans.length ? wait : s.ready.includes(s.seats[0]) ? [] : [s.seats[0]];
  }
  if (s.pending != null) return [s.host!];
  // без правил живой ведущий может в любой момент дать подсказку или открыть ответ
  if (!s.rules && liveHost(s)) return [s.turn, s.host!];
  return [s.turn];
}

/** Подсказка после круга: k-я — после круга round(k·C/4). */
function hintDue(s: State): number {
  let k = 0;
  for (let i = 1; i <= 3; i++) if (s.circle > Math.round((i * s.circles) / 4)) k = i;
  return k;
}

function showHint(s: State, ev: Event[]) {
  const d = danetka(s.id)!;
  if (s.hints >= d.hints.length) return;
  s.hints++;
  s.log.push({ seat: s.host ?? -1, text: d.hints[s.hints - 1], hint: s.hints });
  ev.push({ type: 'hint', n: s.hints, text: d.hints[s.hints - 1] });
}

function finish(s: State, solver: number | null, ev: Event[]) {
  const d = danetka(s.id)!;
  const gain = solver != null && s.rules ? Math.max(1, 3 + d.level - s.hints) : 0;
  if (solver != null) s.scores[solver] = (s.scores[solver] ?? 0) + gain;
  const result: Result = { id: s.id, solver, gain, host: s.host };
  s.last = result;
  s.history.push(result);
  s.phase = 'reveal';
  s.pending = null;
  s.ready = [];
  ev.push({ type: 'end', result, answer: d.answer });
}

/** Ход игрока сделан: следующий по кругу; закончился круг — подсказка; кончились круги — время вышло. */
function advance(s: State, ev: Event[]) {
  if (!s.asked.includes(s.turn)) s.asked.push(s.turn);
  const i = s.players.indexOf(s.turn);
  s.turn = s.players[(i + 1) % s.players.length];
  if (s.asked.length < s.players.length) return;
  s.asked = [];
  s.circle++;
  if (!s.rules) return;
  if (s.circle > s.circles) return finish(s, null, ev);
  while (s.hints < hintDue(s)) showHint(s, ev);
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (!a || typeof a !== 'object' || !s0.seats.includes(seat) || !toAct(s0).includes(seat)) return null;
  const s = clone(s0);
  const ev: Event[] = [];
  const d = danetka(s.id)!;
  const live = liveHost(s);
  const isHost = seat === s.host;
  switch (a.type) {
    case 'ask': {
      if (s.phase !== 'play' || s.pending != null || seat !== s.turn) return null;
      const q = a.q != null && Number.isInteger(a.q) && a.q >= 0 && a.q < d.questions.length ? a.q : undefined;
      if (q == null && !live) return null;
      const entry: Entry = { seat, text: q != null ? d.questions[q].q : String(a.text ?? '').trim().slice(0, 200), ...(q != null ? { q } : {}) };
      s.log.push(entry);
      if (s.host == null) {
        // бот-ведущий отвечает сразу
        entry.a = d.questions[q!].a;
        ev.push({ type: 'entry', entry });
        advance(s, ev);
      } else {
        s.pending = s.log.length - 1;
        ev.push({ type: 'entry', entry });
      }
      break;
    }
    case 'answer': {
      if (!isHost || s.pending == null || !['y', 'n', 'i'].includes(a.a)) return null;
      const e = s.log[s.pending];
      if (e.guess) return null;
      e.a = a.a;
      s.pending = null;
      ev.push({ type: 'answer', seat, a: a.a });
      advance(s, ev);
      break;
    }
    case 'guess': {
      if (s.phase !== 'play' || s.pending != null || seat !== s.turn) return null;
      const opt = a.opt != null && Number.isInteger(a.opt) && a.opt >= 0 && a.opt < 4 ? a.opt : undefined;
      const text = opt != null ? d.options[s.optOrder[opt]] : String(a.text ?? '').trim().slice(0, 300);
      if (opt == null && (!live || !text)) return null;
      if (opt != null && s.wrongOpts.includes(opt)) return null;
      const entry: Entry = { seat, text, guess: true, ...(opt != null ? { opt } : {}) };
      s.log.push(entry);
      if (s.host == null || (opt != null && !live)) {
        // бот (ведущий вне стола или бот за столом) проверяет вариант сам
        entry.right = s.optOrder[opt!] === 0;
        ev.push({ type: 'entry', entry });
        if (entry.right) finish(s, seat, ev);
        else {
          s.wrongOpts.push(opt!);
          advance(s, ev);
        }
      } else {
        s.pending = s.log.length - 1;
        ev.push({ type: 'entry', entry });
      }
      break;
    }
    case 'judge': {
      if (!isHost || s.pending == null) return null;
      const e = s.log[s.pending];
      if (!e.guess) return null;
      e.right = !!a.right;
      s.pending = null;
      ev.push({ type: 'judge', seat, right: e.right });
      if (e.right) finish(s, e.seat, ev);
      else {
        if (e.opt != null) s.wrongOpts.push(e.opt);
        advance(s, ev);
      }
      break;
    }
    case 'hint': {
      // без правил: живой ведущий — когда решит; с ботом-ведущим — по просьбе игрока в свой ход
      if (s.phase !== 'play' || s.rules || s.pending != null) return null;
      if (!(isHost && live) && !(seat === s.turn && !live)) return null;
      if (s.hints >= d.hints.length) return null;
      showHint(s, ev);
      break;
    }
    case 'giveup': {
      if (s.phase !== 'play' || s.rules || s.pending != null) return null;
      if (!(seat === s.turn || (isHost && live))) return null;
      finish(s, null, ev);
      break;
    }
    case 'next': {
      if (s.phase !== 'reveal') return null;
      s.ready.push(seat);
      if (toAct(s).length) break;
      const best = Math.max(...Object.values(s.scores));
      if (s.n >= s.total || (s.rules && best >= 10)) {
        s.phase = 'over';
        ev.push({ type: 'over', scores: { ...s.scores } });
      } else ev.push(start(s, rng));
      break;
    }
    default:
      return null;
  }
  return { state: s, events: ev };
}

export function makeView(s: State, seats: number[] | 'all'): View {
  const d = danetka(s.id)!;
  const open = s.phase !== 'play' || seats === 'all' || (s.host != null && seats.includes(s.host));
  return {
    seats: s.seats,
    humans: s.humans,
    rules: s.rules,
    hostSeats: s.hostSeats,
    level: d.level,
    n: s.n,
    total: s.total,
    host: s.host,
    id: s.id,
    title: d.title,
    story: d.story,
    players: s.players,
    turn: s.turn,
    circle: s.circle,
    circles: s.circles,
    asked: s.asked,
    hints: d.hints.slice(0, s.hints),
    totalHints: d.hints.length,
    log: s.log,
    pending: s.pending,
    questions: d.questions.map((q) => q.q),
    options: s.optOrder.map((i) => d.options[i]),
    wrongOpts: s.wrongOpts,
    phase: s.phase,
    scores: s.scores,
    ready: s.ready,
    last: s.last,
    history: s.history,
    ...(open ? { secret: { answer: d.answer, short: d.short, answers: d.questions.map((q) => q.a), correct: s.optOrder.indexOf(0), hints: d.hints } } : {}),
  };
}
