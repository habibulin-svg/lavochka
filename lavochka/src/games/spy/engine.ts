/* Шпион — движок. Всем, кроме шпиона, раздают одно слово темы (локацию, фильм, книгу…), шпион его не знает.
 * Игроки по цепочке задают друг другу вопросы: кого спросили — тот отвечает и спрашивает следующего (не того, кто спросил его).
 * Любой раз за раунд может обвинить — нужно единогласие остальных; шпион в любой момент может назвать слово.
 * Время вышло — все разом показывают на подозреваемого. Счёт — по раундам. Без DOM. */
import type { Options, Rng } from '../../core/types';
import { pool, THEME, THEMES, word as findWord } from './themes';

export type Phase = 'deal' | 'ask' | 'answer' | 'vote' | 'final' | 'reveal' | 'over';

/** Вопрос и ответ. facet — номер признакового вопроса темы, val — номер варианта ответа. */
export interface QA {
  from: number;
  to: number;
  facet?: number;
  text: string;
  val?: number;
  dodge?: boolean;
  answer?: string;
}

/** Чем кончился раунд: шпиона поймали, шпион ошибся / угадал, обвинили мирного, время вышло. */
export type Outcome = 'caught' | 'wrongGuess' | 'guessed' | 'innocent' | 'timeout';

export interface RoundEnd {
  round: number;
  outcome: Outcome;
  spy: number;
  theme: string;
  word: string;
  accuser?: number;
  accused?: number;
  guess?: string;
  /** Кто на кого показал в конце времени. */
  points?: Record<number, number>;
  gain: Record<number, number>;
}

export type Card = { spy: true } | { spy: false; word: string; role?: string };

export interface State {
  seats: number[];
  humans: number[];
  themes: string[];
  subs: Record<string, string>;
  rounds: number;
  /** Время раунда, мс; 0 — без ограничения. */
  limit: number;
  round: number;
  scores: Record<number, number>;
  theme: string;
  word: string;
  spy: number;
  roles: Record<number, string>;
  used: string[];
  phase: Phase;
  /** Кто уже посмотрел карточку / нажал «дальше». */
  ready: number[];
  asker: number;
  target: number | null;
  /** Кто спросил текущего — его спрашивать в ответ нельзя. */
  prev: number | null;
  qa: QA[];
  /** Кто уже обвинял в этом раунде. */
  accused: number[];
  vote: { by: number; suspect: number; yes: number[]; resume: 'ask' | 'answer' } | null;
  points: Record<number, number>;
  /** Часы раунда: spent — уже прошло (мс), start — когда пошли (время хоста), null — стоят. */
  clock: { spent: number; start: number | null };
  end: RoundEnd | null;
  history: RoundEnd[];
}

export type Action =
  | { type: 'ready'; at?: number }
  | { type: 'ask'; target: number; facet?: number; text?: string }
  | { type: 'answer'; val?: number; dodge?: boolean; text?: string }
  | { type: 'accuse'; target: number; at?: number }
  | { type: 'vote'; yes: boolean; at?: number }
  | { type: 'guess'; word: string; at?: number }
  | { type: 'timeup' }
  | { type: 'point'; target: number }
  | { type: 'next' };

export type Event =
  | { type: 'round'; round: number; theme: string; asker: number }
  | { type: 'go'; asker: number }
  | { type: 'ask'; from: number; to: number; facet?: number; text: string }
  | { type: 'answer'; seat: number; val?: number; dodge?: boolean; text: string }
  | { type: 'accuse'; by: number; suspect: number }
  | { type: 'vote'; seat: number; yes: boolean }
  | { type: 'acquit'; suspect: number }
  | { type: 'timeup' }
  | { type: 'point'; seat: number }
  | { type: 'guess'; seat: number; word: string }
  | { type: 'end'; end: RoundEnd }
  | { type: 'over'; scores: Record<number, number> };

export interface View {
  seats: number[];
  humans: number[];
  phase: Phase;
  round: number;
  rounds: number;
  scores: Record<number, number>;
  theme: string;
  sub: string;
  limit: number;
  asker: number;
  target: number | null;
  prev: number | null;
  qa: QA[];
  accused: number[];
  vote: State['vote'];
  /** Кто уже показал (на кого — откроется в конце раунда). */
  pointed: number[];
  clock: State['clock'];
  ready: number[];
  end: RoundEnd | null;
  history: RoundEnd[];
  /** Карточки мест, за которые смотрит экран. */
  cards: Record<number, Card>;
}

export const ROUND_CHOICES = [3, 5, 7, 10];

export function themesOf(opts: Options): string[] {
  const on = THEMES.filter((t) => opts[`th_${t.id}`] === true).map((t) => t.id);
  return on.length ? on : ['locations'];
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

export function setup(seats: number[], opts: Options, rng: Rng, humans: number[] = []): State {
  const themes = themesOf(opts);
  const subs: Record<string, string> = {};
  for (const t of themes) subs[t] = String(opts[`sub_${t}`] ?? 'all');
  const s: State = {
    seats: seats.slice(),
    humans: humans.filter((x) => seats.includes(x)),
    themes,
    subs,
    rounds: Math.max(1, Number(opts.rounds ?? 5) | 0),
    limit: Math.max(0, Number(opts.time ?? 10)) * 60000,
    round: 0,
    scores: Object.fromEntries(seats.map((x) => [x, 0])),
    theme: themes[0],
    word: '',
    spy: seats[0],
    roles: {},
    used: [],
    phase: 'deal',
    ready: [],
    asker: seats[0],
    target: null,
    prev: null,
    qa: [],
    accused: [],
    vote: null,
    points: {},
    clock: { spent: 0, start: null },
    end: null,
    history: [],
  };
  startRound(s, rng);
  return s;
}

function shuffle<T>(a: T[], rng: Rng): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Новый раунд: тема (не та же подряд, если их несколько), слово (без повторов), шпион, роли. */
function startRound(s: State, rng: Rng): Event {
  s.round++;
  const prevTheme = s.round > 1 ? s.theme : null;
  const choices = s.themes.length > 1 ? s.themes.filter((t) => t !== prevTheme) : s.themes;
  s.theme = choices[rng.int(choices.length)];
  const words = pool(s.theme, s.subs[s.theme]);
  let fresh = words.filter((w) => !s.used.includes(`${s.theme}/${w.id}`));
  if (!fresh.length) {
    s.used = s.used.filter((u) => !u.startsWith(s.theme + '/'));
    fresh = words;
  }
  const w = fresh[rng.int(fresh.length)];
  s.word = w.id;
  s.used.push(`${s.theme}/${w.id}`);
  s.spy = s.seats[rng.int(s.seats.length)];
  s.roles = {};
  if (w.roles?.length) {
    const roles = shuffle(w.roles.slice(), rng);
    s.seats.filter((x) => x !== s.spy).forEach((x, i) => (s.roles[x] = roles[i % roles.length]));
  }
  s.phase = 'deal';
  s.ready = [];
  s.asker = s.seats[(s.round - 1) % s.seats.length];
  s.target = null;
  s.prev = null;
  s.qa = [];
  s.accused = [];
  s.vote = null;
  s.points = {};
  s.clock = { spent: 0, start: null };
  s.end = null;
  return { type: 'round', round: s.round, theme: s.theme, asker: s.asker };
}

const talking = (s: State) => s.phase === 'ask' || s.phase === 'answer';

export function toAct(s: State): number[] {
  switch (s.phase) {
    case 'deal':
      return s.seats.filter((x) => !s.ready.includes(x));
    case 'ask':
    case 'answer': {
      // ходит один, но обвинить или назвать слово (шпион) люди могут в любой момент
      const cur = s.phase === 'ask' ? s.asker : s.target!;
      return [cur, ...s.humans.filter((x) => x !== cur)];
    }
    case 'vote':
      return s.seats.filter((x) => x !== s.vote!.suspect && !s.vote!.yes.includes(x));
    case 'final':
      return s.seats.filter((x) => !(x in s.points));
    case 'reveal': {
      const wait = s.humans.filter((x) => !s.ready.includes(x));
      return s.humans.length ? wait : s.ready.includes(s.seats[0]) ? [] : [s.seats[0]];
    }
    default:
      return [];
  }
}

function pause(s: State, at: number | undefined) {
  if (s.clock.start != null) s.clock.spent += Math.max(0, (at ?? s.clock.start) - s.clock.start);
  s.clock.start = null;
}

function finish(s: State, outcome: Outcome, extra: Partial<RoundEnd> = {}): Event {
  const gain: Record<number, number> = {};
  const civ = s.seats.filter((x) => x !== s.spy);
  if (outcome === 'caught' || outcome === 'wrongGuess') {
    for (const x of civ) gain[x] = 1;
    // кто первым обвинил шпиона — ещё очко
    if (outcome === 'caught' && extra.accuser != null && extra.accuser !== s.spy) gain[extra.accuser] = 2;
  } else gain[s.spy] = outcome === 'timeout' ? 2 : 4;
  for (const [x, g] of Object.entries(gain)) s.scores[+x] = (s.scores[+x] ?? 0) + g;
  pause(s, undefined);
  const end: RoundEnd = { round: s.round, outcome, spy: s.spy, theme: s.theme, word: s.word, ...extra, gain };
  s.end = end;
  s.history.push(end);
  s.phase = 'reveal';
  s.ready = [];
  s.vote = null;
  return { type: 'end', end };
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (!a || typeof a !== 'object' || !s0.seats.includes(seat)) return null;
  const s = clone(s0);
  const ev: Event[] = [];
  const at = typeof (a as { at?: unknown }).at === 'number' ? (a as { at: number }).at : undefined;
  switch (a.type) {
    case 'ready': {
      if (s.phase !== 'deal' || s.ready.includes(seat)) return null;
      s.ready.push(seat);
      if (s.ready.length === s.seats.length) {
        s.phase = 'ask';
        s.ready = [];
        s.clock.start = at ?? 0;
        ev.push({ type: 'go', asker: s.asker });
      }
      break;
    }
    case 'ask': {
      if (s.phase !== 'ask' || seat !== s.asker) return null;
      const t = a.target;
      if (!s.seats.includes(t) || t === seat || (t === s.prev && s.seats.length > 2)) return null;
      const th = THEME[s.theme];
      const facet = a.facet != null && Number.isInteger(a.facet) && a.facet >= 0 && a.facet < th.facets.length ? a.facet : undefined;
      const text = facet != null ? th.facets[facet].q : String(a.text ?? '').trim().slice(0, 200);
      s.qa.push({ from: seat, to: t, facet, text });
      s.target = t;
      s.phase = 'answer';
      ev.push({ type: 'ask', from: seat, to: t, facet, text });
      break;
    }
    case 'answer': {
      if (s.phase !== 'answer' || seat !== s.target) return null;
      const q = s.qa[s.qa.length - 1];
      const opts = q.facet != null ? THEME[s.theme].facets[q.facet].a : null;
      if (opts && !a.dodge && !(Number.isInteger(a.val) && a.val! >= 0 && a.val! < opts.length) && !String(a.text ?? '').trim()) return null;
      if (opts && a.val != null && !a.dodge && Number.isInteger(a.val) && a.val >= 0 && a.val < opts.length) q.val = a.val;
      else if (a.dodge) q.dodge = true;
      const text = String(a.text ?? '').trim().slice(0, 200);
      q.answer = text || (q.val != null ? opts![q.val] : q.dodge ? 'не скажу' : '');
      ev.push({ type: 'answer', seat, val: q.val, dodge: q.dodge, text: q.answer });
      s.prev = s.asker;
      s.asker = seat;
      s.target = null;
      s.phase = 'ask';
      break;
    }
    case 'accuse': {
      if (!talking(s) || s.accused.includes(seat)) return null;
      if (!s.seats.includes(a.target) || a.target === seat) return null;
      pause(s, at);
      s.accused.push(seat);
      s.vote = { by: seat, suspect: a.target, yes: [seat], resume: s.phase as 'ask' | 'answer' };
      s.phase = 'vote';
      ev.push({ type: 'accuse', by: seat, suspect: a.target });
      // вдвоём против одного: обвинитель — единственный голосующий
      if (s.vote.yes.length === s.seats.length - 1) ev.push(finish(s, a.target === s.spy ? 'caught' : 'innocent', { accuser: seat, accused: a.target }));
      break;
    }
    case 'vote': {
      const v = s.vote;
      if (s.phase !== 'vote' || !v || seat === v.suspect || v.yes.includes(seat)) return null;
      ev.push({ type: 'vote', seat, yes: !!a.yes });
      if (!a.yes) {
        // одного «против» хватает — обвинение снято, часы идут дальше
        s.phase = v.resume;
        s.vote = null;
        s.clock.start = at ?? 0;
        ev.push({ type: 'acquit', suspect: v.suspect });
        break;
      }
      v.yes.push(seat);
      if (v.yes.length === s.seats.length - 1) ev.push(finish(s, v.suspect === s.spy ? 'caught' : 'innocent', { accuser: v.by, accused: v.suspect }));
      break;
    }
    case 'guess': {
      if (seat !== s.spy || !(talking(s) || (s.phase === 'final' && !(seat in s.points)))) return null;
      const w = findWord(s.theme, String(a.word));
      if (!w || !pool(s.theme, s.subs[s.theme]).includes(w)) return null;
      pause(s, at);
      ev.push({ type: 'guess', seat, word: w.id });
      ev.push(finish(s, w.id === s.word ? 'guessed' : 'wrongGuess', { guess: w.id }));
      break;
    }
    case 'timeup': {
      if (!talking(s) || !s.limit) return null;
      pause(s, undefined);
      s.clock.spent = s.limit;
      s.phase = 'final';
      s.points = {};
      ev.push({ type: 'timeup' });
      break;
    }
    case 'point': {
      if (s.phase !== 'final' || seat in s.points || !s.seats.includes(a.target) || a.target === seat) return null;
      s.points[seat] = a.target;
      ev.push({ type: 'point', seat });
      if (Object.keys(s.points).length === s.seats.length) {
        const points = { ...s.points };
        // единогласно: все, кроме него самого, показали на одного
        const x = s.seats.find((c) => s.seats.every((p) => p === c || points[p] === c));
        ev.push(finish(s, x == null ? 'timeout' : x === s.spy ? 'caught' : 'innocent', { points, ...(x != null ? { accused: x } : {}) }));
      }
      break;
    }
    case 'next': {
      if (s.phase !== 'reveal' || !toAct(s).includes(seat)) return null;
      s.ready.push(seat);
      if (toAct(s).length) break;
      if (s.round >= s.rounds) {
        s.phase = 'over';
        ev.push({ type: 'over', scores: { ...s.scores } });
      } else ev.push(startRound(s, rng));
      break;
    }
    default:
      return null;
  }
  return { state: s, events: ev };
}

export function makeView(s: State, seats: number[] | 'all'): View {
  const cards: Record<number, Card> = {};
  for (const x of s.seats) {
    if (seats !== 'all' && !seats.includes(x)) continue;
    cards[x] = x === s.spy ? { spy: true } : { spy: false, word: s.word, ...(s.roles[x] ? { role: s.roles[x] } : {}) };
  }
  return {
    seats: s.seats,
    humans: s.humans,
    phase: s.phase,
    round: s.round,
    rounds: s.rounds,
    scores: s.scores,
    theme: s.theme,
    sub: s.subs[s.theme] ?? 'all',
    limit: s.limit,
    asker: s.asker,
    target: s.target,
    prev: s.prev,
    qa: s.qa,
    accused: s.accused,
    vote: s.vote,
    pointed: Object.keys(s.points).map(Number),
    clock: s.clock,
    ready: s.ready,
    end: s.end,
    history: s.history,
    cards,
  };
}

/** Сколько осталось времени раунда (мс) по часам этого устройства; null — без ограничения. */
export function remaining(v: Pick<View, 'limit' | 'clock'>, now: number): number | null {
  if (!v.limit) return null;
  const run = v.clock.start != null ? Math.max(0, now - v.clock.start) : 0;
  return Math.max(0, v.limit - v.clock.spent - run);
}

export const OUTCOME_TEXT: Record<Outcome, string> = {
  caught: 'Шпиона поймали',
  wrongGuess: 'Шпион ошибся',
  guessed: 'Шпион угадал',
  innocent: 'Обвинили невиновного',
  timeout: 'Время вышло — шпион не пойман',
};
