/* Викторина — движок без DOM: семь режимов в одной партии-описании (режим — настройка `mode`).
 *
 * Время — часы комнаты (core/clocksync.ts, GameDef.clock): комната дописывает в каждое действие `now` (когда пришло),
 * `at` (когда человек нажал — с поправкой на смещение часов и задержку связи) и `win` (окно ожидания нажатий).
 * Все сроки (время на ответ, на кнопку, показ ответа) — сроки в состоянии: wake(s) говорит комнате, когда разбудить партию,
 * а любое действие сначала «догоняет» время (advance). Бот времени не знает: шлёт реакцию `rt`, движок считает at = открытие + rt.
 *
 * «Кнопка»: кто первый — по `at`, а не по приходу, и только когда `now ≥ min(at) + win` (успели дойти нажатия медленных).
 * Нажатия «из будущего» (бот с реакцией 1,4 с прислал ход сразу) честно участвуют, но не видны, пока их время не наступило.
 * Нажатие до открытия кнопки — фальстарт: блок на FALSE_MS. */
import type { Options, Rng, SeatSpec } from '../../core/types';
import { bank, type MCRec, type PollRec, type WordRec } from './bank';
import { matchAnswer, normText } from './match';

export type Mode = 'trivia' | 'buzz' | 'ladder' | 'wheel' | 'poll' | 'board' | 'truth';
export const MODES: { id: Mode; name: string }[] = [
  { id: 'trivia', name: 'Тривиа' },
  { id: 'buzz', name: 'Кнопка' },
  { id: 'ladder', name: 'Лестница к миллиону' },
  { id: 'wheel', name: 'Барабан' },
  { id: 'poll', name: 'Сто опрошенных' },
  { id: 'board', name: 'Табло тем' },
  { id: 'truth', name: 'Верю — не верю' },
];
export const modeName = (m: Mode) => MODES.find((x) => x.id === m)?.name ?? m;

export const TOPICS: [string, string][] = [
  ['history', 'история'],
  ['geo', 'география'],
  ['lit', 'литература и сказки'],
  ['lang', 'русский язык'],
  ['cinema', 'кино'],
  ['cartoons', 'мультфильмы'],
  ['music', 'музыка'],
  ['sport', 'спорт'],
  ['science', 'наука'],
  ['nature', 'природа'],
  ['human', 'человек'],
  ['space', 'космос'],
  ['art', 'искусство'],
  ['tech', 'техника'],
  ['food', 'еда'],
  ['ussr', 'СССР и 90-е'],
  ['myth', 'мифы'],
  ['misc', 'разное'],
];
export const topicName = (t: string) => TOPICS.find((x) => x[0] === t)?.[1] ?? t;

// ---------------------------------------------------------------- сроки, мс
export const T = {
  /** Время на ответ в тривиа компанией, если не задано. */
  trivia: 20_000,
  /** Сколько кнопка открыта после прочтения вопроса. */
  buzz: 8_000,
  /** Время на ответ нажавшему. */
  answer: 7_000,
  /** Ввод ответа с клавиатуры — чуть дольше. */
  answerInput: 12_000,
  /** Показ правильного ответа. */
  reveal: 3_200,
  /** Блок за фальстарт. */
  falseStart: 800,
  /** Кнопка снова открыта после неверного ответа через… */
  reopen: 700,
  /** Ответ в «Ста опрошенных» и в одиночном табло. */
  say: 30_000,
  /** Финал барабана: слово целиком. */
  final: 40_000,
};
/** Сколько читать вопрос до открытия кнопки. */
export const readMs = (text: string) => Math.max(1800, Math.min(5500, 900 + text.length * 32));

// ---------------------------------------------------------------- лестница
export const LADDER_D = [1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5];
export const LADDER_SUM = [100, 200, 300, 500, 1000, 2000, 4000, 8000, 16000, 32000, 64000, 125000, 250000, 500000, 1000000];
/** Несгораемые суммы — после этих ступеней (номер с нуля). */
export const SAFE = [4, 9];
export const safeSum = (passed: number) => {
  let s = 0;
  for (const k of SAFE) if (passed > k) s = LADDER_SUM[k];
  return s;
};

// ---------------------------------------------------------------- барабан
export type Sector = number | 'x2' | 'Б' | 'П' | '+' | '0';
export const SECTORS: Sector[] = [350, 'x2', 500, 'Б', 250, 600, '0', 400, 'П', 300, 800, '+', 450, 1000, 200, 'Б', 700, 150];
export const ALPHABET = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ';
/** Частотность букв русского языка — от частых к редким. */
export const FREQ = 'ОЕАИНТСРВЛКМДПУЯЫЬГЗБЧЙХЖШЮЦЩЭФЪ';
export const WORD_BONUS = 100;

// ---------------------------------------------------------------- опрос
export const POLL_MULT = [1, 2, 3];
/** «Обратная игра»: самый редкий ответ дороже (по месту в табло, сверху вниз). */
export const REVERSE_PTS = [15, 30, 60, 120, 180, 240];

// ---------------------------------------------------------------- табло
export const BOARD_PRICES = [100, 200, 300, 400, 500];

// ================================================================ типы

export interface Q {
  id: string;
  /** Текст вопроса (для «верю — не верю» — утверждение). */
  text: string;
  /** Варианты (перемешаны); у ввода — тоже есть, для выбора. */
  opts: string[];
  ok: number;
  d: number;
  t: string;
  /** Ответ для ввода и синонимы (табло, кнопка с вводом). */
  ans?: string;
  alt?: string[];
}

export interface Press {
  seat: number;
  at: number;
}

export interface Buzz {
  /** Когда вопрос показан и когда откроется кнопка (часы комнаты). */
  shown: number;
  openAt: number;
  /** До какого времени можно нажать. */
  until: number;
  presses: Press[];
  /** Фальстарт: место заблокировано до… */
  block: Record<number, number>;
  /** Уже отвечали неверно на этот вопрос. */
  tried: number[];
  /** Сказали «не знаю». */
  passed: number[];
}

export interface Answer {
  i: number;
  at: number;
  /** Ввод с клавиатуры (кнопка). */
  text?: string;
}

/** Что показать после ответа или раскрытия (последний итог). */
export interface Last {
  kind: 'reveal' | 'buzzed' | 'right' | 'wrong' | 'none' | 'timeout' | 'early';
  seat?: number;
  /** Верный вариант и ответ текстом. */
  ok?: number;
  ans?: string;
  gains?: Record<number, number>;
  /** Кнопка: кто нажал, насколько раньше второго (мс), насколько позже пришло его сообщение, чем у второго. */
  lead?: number | null;
  late?: number | null;
  said?: string;
  pick?: number;
}

export interface Ladder {
  order: number[];
  /** Чья лестница сейчас (номер в order). */
  k: number;
  step: number;
  qs: Record<number, Q[]>;
  life: Record<number, { fifty: boolean; hall: boolean; call: boolean }>;
  hidden: number[];
  hall: number[] | null;
  call: { i: number; sure: number } | null;
  /** Лестница этого игрока кончилась (проиграл, забрал, миллион). */
  done: boolean;
  won: Record<number, number>;
}

export interface Wheel {
  round: number;
  rounds: number;
  /** Слова туров (последнее — финал, если он есть). */
  words: { w: string; h: string; d: number }[];
  open: boolean[];
  named: string[];
  turn: number;
  out: number[];
  sector: number | null;
  /** Сколько раз крутили — для анимации (каждый поворот свой). */
  spins: number;
  /** Сила последнего броска барабана 0…1 (только для анимации). */
  f: number;
  /** Счёт тура. */
  rs: Record<number, number>;
  final: boolean;
  finalist: number;
  /** Сколько букв назвал финалист. */
  fl: number;
  winner: number | null;
}

export interface Poll {
  round: number;
  rounds: number;
  qs: PollRec[];
  open: boolean[];
  teams: number[][];
  team: number;
  /** Кто следующий в каждой команде (номер в команде). */
  next: number[];
  strikes: number;
  bank: number;
  steal: boolean;
  /** Команда, начавшая раунд. */
  starter: number;
  reverse: boolean;
}

export interface BoardCell {
  q: string;
  ans: string;
  alt: string[];
  opts: string[];
  ok: number;
}
export interface Board {
  round: number;
  rounds: number;
  themes: { name: string; t: string; cells: BoardCell[] }[][];
  used: boolean[][];
  chooser: number;
  cell: [number, number] | null;
}

export type Phase = 'q' | 'buzz' | 'answer' | 'reveal' | 'spin' | 'letter' | 'plus' | 'final' | 'fword' | 'say' | 'pick' | 'over';

export interface State {
  mode: Mode;
  o: {
    count: number;
    time: number;
    input: boolean;
    short: boolean;
    reverse: boolean;
    themes: number;
    rounds: number;
    topic: string;
    diff: string;
  };
  seats: number[];
  /** Уровень бота по месту; -1 — человек. */
  bots: Record<number, number>;
  scores: Record<number, number>;
  now: number;
  win: number;
  phase: Phase;
  /** Вопросы партии (тривиа, верю — не верю, кнопка). */
  qs: Q[];
  qi: number;
  /** Текущий вопрос (у табло, лестницы — свой). */
  q: Q | null;
  openAt: number;
  deadline: number;
  answers: Record<number, Answer>;
  bz: Buzz | null;
  answerer: number;
  revealUntil: number;
  last: Last | null;
  ld: Ladder | null;
  wh: Wheel | null;
  pl: Poll | null;
  bd: Board | null;
  /** Номера вопросов банка, уже бывших в партии. */
  used: string[];
}

export type Action =
  | { type: 'wake'; now?: number; win?: number }
  | { type: 'answer'; i: number; at?: number; rt?: number; now?: number; win?: number }
  | { type: 'buzz'; at?: number; rt?: number; now?: number; win?: number }
  | { type: 'pass'; now?: number; win?: number }
  | { type: 'pick'; i: number; now?: number; win?: number }
  | { type: 'say'; text: string; now?: number; win?: number }
  | { type: 'life'; k: 'fifty' | 'hall' | 'call'; now?: number; win?: number }
  | { type: 'take'; now?: number; win?: number }
  | { type: 'spin'; f?: number; now?: number; win?: number }
  | { type: 'letter'; l: string; now?: number; win?: number }
  | { type: 'word'; w: string; now?: number; win?: number }
  | { type: 'plus'; pos: number; now?: number; win?: number }
  | { type: 'cell'; th: number; k: number; now?: number; win?: number }
  | { type: 'next'; now?: number; win?: number };

export type Event =
  | { k: 'q'; n: number; total: number; text: string }
  | { k: 'answered'; seat: number }
  | { k: 'reveal'; ans: string; gains: Record<number, number> }
  | { k: 'early'; seat: number }
  | { k: 'pressed'; seat: number }
  | { k: 'buzzed'; seat: number; lead: number | null; late: number | null }
  | { k: 'nobody' }
  | { k: 'right'; seat: number; said: string; gain: number }
  | { k: 'wrong'; seat: number; said: string; gain: number }
  | { k: 'timeout'; seat: number; gain: number }
  | { k: 'life'; seat: number; life: 'fifty' | 'hall' | 'call' }
  | { k: 'take'; seat: number; sum: number }
  | { k: 'climb'; seat: number; step: number; sum: number }
  | { k: 'fall'; seat: number; sum: number; ans: string }
  | { k: 'ladder'; seat: number }
  | { k: 'spin'; seat: number; sector: number; spins: number; f: number }
  | { k: 'bankrupt'; seat: number }
  | { k: 'zero'; seat: number }
  | { k: 'letter'; seat: number; l: string; n: number; gain: number }
  | { k: 'word'; seat: number; w: string; ok: boolean; gain: number }
  | { k: 'opened'; seat: number; l: string; n: number }
  | { k: 'turn'; seat: number }
  | { k: 'wround'; round: number; winner: number | null; word: string; final: boolean }
  | { k: 'finalist'; seat: number }
  | { k: 'say'; seat: number; text: string; hit: number; pts: number }
  | { k: 'strike'; n: number }
  | { k: 'steal'; team: number }
  | { k: 'pround'; team: number | null; bank: number }
  | { k: 'cell'; seat: number; theme: string; price: number }
  | { k: 'end' };

export interface Res {
  state: State;
  events: Event[];
}

// ================================================================ вспомогательное

const clone = <X>(x: X): X => JSON.parse(JSON.stringify(x));

function shuffle<X>(a: X[], rng: Rng): X[] {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
}

const isBot = (s: State, seat: number) => (s.bots[seat] ?? -1) >= 0;

/** Кто сколько раз… порядок мест по кругу после seat. */
function nextSeat(s: State, seat: number, skip: (x: number) => boolean): number | null {
  const i = s.seats.indexOf(seat);
  for (let k = 1; k <= s.seats.length; k++) {
    const x = s.seats[(i + k) % s.seats.length];
    if (!skip(x)) return x;
  }
  return null;
}

const DIFF: Record<string, number[]> = { easy: [1, 2], mid: [2, 3, 4], hard: [4, 5], rise: [1, 2, 3, 4, 5], any: [1, 2, 3, 4, 5] };

/** Вопросы с выбором из банка: тема, сложность, без уже бывших. Мало — правила смягчаются. */
function pickMC(rng: Rng, n: number, topic: string, ds: number[], used: Set<string>, exactD?: number[]): MCRec[] {
  const all = bank().mc;
  const ok = (r: MCRec, strictTopic: boolean, strictD: boolean) =>
    !used.has(r.id) && (!strictTopic || topic === 'all' || r.t === topic) && (!strictD || ds.includes(r.d));
  let pool = all.filter((r) => ok(r, true, true));
  if (pool.length < n) pool = all.filter((r) => ok(r, true, false));
  if (pool.length < n) pool = all.filter((r) => ok(r, false, false));
  if (exactD) {
    // лестница: на каждую ступень — своя трудность
    const out: MCRec[] = [];
    for (const d of exactD) {
      const c = pool.filter((r) => r.d === d && !out.includes(r));
      const any = c.length ? c : pool.filter((r) => !out.includes(r));
      const r = any[rng.int(any.length)];
      out.push(r);
    }
    out.forEach((r) => used.add(r.id));
    return out;
  }
  const out = shuffle(pool, rng).slice(0, n);
  out.forEach((r) => used.add(r.id));
  return out;
}

function mcQ(r: MCRec, rng: Rng): Q {
  const order = shuffle([0, 1, 2, 3], rng);
  return { id: r.id, text: r.q, opts: order.map((i) => r.a[i]), ok: order.indexOf(0), d: r.d, t: r.t, ans: r.a[0] };
}

/** «Верю — не верю»: вопрос и вариант — половина верных, половина ложных. */
function truthQ(r: MCRec, rng: Rng): Q {
  const real = rng.next() < 0.5;
  const shown = real ? r.a[0] : r.a[1 + rng.int(3)];
  const text = `${r.q.replace(/[?？]\s*$/, '')} — ${shown}.`;
  return { id: r.id, text, opts: ['Верю', 'Не верю'], ok: real ? 0 : 1, d: r.d, t: r.t, ans: real ? `Верно: ${r.a[0]}` : `Неверно: правильно — ${r.a[0]}` };
}

function timeOf(a: Action): number | undefined {
  const n = (a as { now?: unknown }).now;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
}

/** Момент нажатия/ответа по часам комнаты: бот — открытие + реакция, человек — at от комнаты (не позже now). */
function pressAt(s: State, seat: number, a: { at?: number; rt?: number }, base: number): number {
  if (isBot(s, seat) && typeof a.rt === 'number' && Number.isFinite(a.rt)) return Math.round(base + Math.max(150, Math.min(60_000, a.rt)));
  if (typeof a.at === 'number' && Number.isFinite(a.at)) return Math.min(s.now, Math.round(a.at));
  return s.now;
}

// ================================================================ настройка

export function resolveOpts(o: Options): State['o'] & { mode: Mode } {
  const mode = (MODES.some((m) => m.id === o.mode) ? o.mode : 'trivia') as Mode;
  return {
    mode,
    count: Number(o.count) || 10,
    time: Number(o.time) || 0,
    input: o.answer === 'input',
    short: o.wrounds === 'short',
    reverse: !!o.reverse,
    themes: Number(o.themes) || 5,
    rounds: Number(o.brounds) || 1,
    topic: String(o.topic || 'all'),
    diff: String(o.diff || 'rise'),
  };
}

export function setup(seats: SeatSpec[], opts: Options, rng: Rng): State {
  const { mode, ...o } = resolveOpts(opts);
  const ss = seats.map((x) => x.seat);
  const bots: Record<number, number> = {};
  seats.forEach((x) => (bots[x.seat] = x.kind === 'bot' ? x.level : -1));
  const s: State = {
    mode,
    o,
    seats: ss,
    bots,
    scores: Object.fromEntries(ss.map((x) => [x, 0])),
    now: 0,
    win: 300,
    phase: 'q',
    qs: [],
    qi: -1,
    q: null,
    openAt: 0,
    deadline: 0,
    answers: {},
    bz: null,
    answerer: -1,
    revealUntil: 0,
    last: null,
    ld: null,
    wh: null,
    pl: null,
    bd: null,
    used: [],
  };
  const used = new Set<string>();
  const ds = DIFF[o.diff] ?? DIFF.rise;
  if (mode === 'trivia' || mode === 'truth' || mode === 'buzz') {
    let recs = pickMC(rng, o.count, o.topic, ds, used);
    if (o.diff === 'rise') recs = recs.sort((a, b) => a.d - b.d);
    s.qs = recs.map((r) => (mode === 'truth' ? truthQ(r, rng) : mcQ(r, rng)));
  } else if (mode === 'ladder') {
    const qs: Record<number, Q[]> = {};
    const life: Ladder['life'] = {};
    const won: Record<number, number> = {};
    for (const x of ss) {
      qs[x] = pickMC(rng, 15, 'all', ds, used, LADDER_D).map((r) => mcQ(r, rng));
      life[x] = { fifty: true, hall: true, call: true };
      won[x] = 0;
    }
    s.ld = { order: ss.slice(), k: 0, step: 0, qs, life, hidden: [], hall: null, call: null, done: false, won };
  } else if (mode === 'wheel') {
    const rounds = o.short ? 1 : 3;
    const words = pickWords(rng, rounds + (o.short ? 0 : 1), used);
    s.wh = {
      round: 0,
      rounds,
      words,
      open: [],
      named: [],
      turn: ss[0],
      out: [],
      sector: null,
      spins: 0,
      f: 0.5,
      rs: Object.fromEntries(ss.map((x) => [x, 0])),
      final: false,
      finalist: -1,
      fl: 0,
      winner: null,
    };
  } else if (mode === 'poll') {
    const rounds = 3 + (o.reverse ? 1 : 0);
    const pool = shuffle(
      bank().poll.filter((r) => !used.has(r.id)),
      rng
    ).slice(0, rounds);
    pool.forEach((r) => used.add(r.id));
    const teams = ss.length >= 2 ? [ss.filter((_, i) => i % 2 === 0), ss.filter((_, i) => i % 2 === 1)] : [ss.slice()];
    s.pl = { round: 0, rounds, qs: pool, open: [], teams, team: 0, next: teams.map(() => 0), strikes: 0, bank: 0, steal: false, starter: 0, reverse: false };
  } else if (mode === 'board') {
    const per = Math.max(3, Math.min(6, o.themes));
    const rounds = Math.max(1, Math.min(2, o.rounds));
    const all = shuffle(bank().board, rng);
    const themes: Board['themes'] = [];
    for (let r = 0; r < rounds; r++) {
      const pick = all.slice(r * per, r * per + per);
      pick.forEach((x) => used.add(x.id));
      themes.push(
        pick.map((th) => ({
          name: th.theme,
          t: th.t,
          cells: th.qs.map((c, k) => {
            // варианты для выбора — из других ответов той же темы
            const others = th.qs.filter((_, j) => j !== k).map((x) => x.a);
            const wrong = shuffle(
              others.filter((x) => normText(x) !== normText(c.a)),
              rng
            ).slice(0, 3);
            const opts = shuffle([c.a, ...wrong], rng);
            return { q: c.q, ans: c.a, alt: c.alt, opts, ok: opts.indexOf(c.a) };
          }),
        }))
      );
    }
    s.bd = { round: 0, rounds, themes, used: themes.map((r) => r.flatMap(() => [false, false, false, false, false])), chooser: ss[0], cell: null };
  }
  s.used = [...used];
  start(s, []);
  return s;
}

function pickWords(rng: Rng, n: number, used: Set<string>): Wheel['words'] {
  const pool = shuffle(
    bank().word.filter((w: WordRec) => !used.has(w.id) && w.w.length >= 5 && w.w.length <= 11),
    rng
  ).slice(0, n);
  pool.forEach((w) => used.add(w.id));
  // финал (последнее) — слово подлиннее
  return pool.map((w) => ({ w: w.w, h: w.h, d: w.d }));
}

/** Первый ход партии: время ещё не известно (now = 0) — сроки ставятся от первого действия/будильника. */
function start(s: State, ev: Event[]) {
  switch (s.mode) {
    case 'trivia':
    case 'truth':
    case 'buzz':
      nextQuestion(s, ev);
      return;
    case 'ladder':
      ladderQ(s, ev);
      return;
    case 'wheel':
      wheelRound(s, ev);
      return;
    case 'poll':
      pollRound(s, ev);
      return;
    case 'board':
      s.phase = 'pick';
      return;
  }
}

// ================================================================ сроки

/** Когда партии нужно «проснуться» (часы комнаты). null — ждём только ходов. */
export function due(s: State): number | null {
  switch (s.phase) {
    case 'q':
      if (s.mode === 'ladder') return s.deadline || null;
      if (allAnswered(s)) return Math.max(s.now, ...Object.values(s.answers).map((a) => a.at));
      return s.deadline || null;
    case 'buzz': {
      const b = s.bz!;
      if (b.presses.length) {
        const first = Math.min(...b.presses.map((p) => p.at));
        // все, кто мог, уже нажали или отказались — ждать окно незачем
        return eligible(s).length ? first + s.win : first;
      }
      if (!eligible(s).length) return s.now;
      return b.until;
    }
    case 'answer':
    case 'say':
    case 'fword':
      return s.deadline || null;
    case 'reveal':
      return s.revealUntil;
    default:
      return null;
  }
}

/** Шагнуть по времени: всё, чей срок вышел. */
function advance(s: State, ev: Event[]) {
  for (let guard = 0; guard < 50; guard++) {
    const t = due(s);
    if (t == null || s.now < t || s.phase === 'over') return;
    onDue(s, ev);
  }
}

function onDue(s: State, ev: Event[]) {
  switch (s.phase) {
    case 'q':
      if (s.mode === 'ladder') return ladderAnswer(s, s.ld!.order[s.ld!.k], -1, ev);
      return revealTrivia(s, ev);
    case 'buzz':
      return closeBuzz(s, ev);
    case 'answer':
    case 'say':
      return timeout(s, ev);
    case 'fword':
      return finalWord(s, '', ev);
    case 'reveal':
      return afterReveal(s, ev);
  }
}

/** Отметить «сейчас» по действию; если время ещё не шло (первое действие) — открыть сроки от него. */
function tickTo(s: State, a: Action) {
  const n = timeOf(a);
  const w = (a as { win?: unknown }).win;
  if (typeof w === 'number' && Number.isFinite(w)) s.win = Math.max(0, Math.min(2000, w));
  if (n == null) return;
  if (!s.now) {
    // часы появились впервые: сроки, посчитанные от нуля, сдвигаем на «сейчас»
    s.now = n;
    rebase(s, n);
  } else s.now = Math.max(s.now, n);
}

function rebase(s: State, t0: number) {
  // deadline 0 — «без срока», остальное — отметки от нуля
  if (s.deadline) s.deadline += t0;
  s.openAt += t0;
  s.revealUntil += t0;
  if (s.bz) {
    s.bz.shown += t0;
    s.bz.openAt += t0;
    s.bz.until += t0;
  }
}

// ================================================================ тривиа, верю — не верю, кнопка

function nextQuestion(s: State, ev: Event[]) {
  s.qi++;
  s.answers = {};
  s.last = null;
  s.answerer = -1;
  if (s.qi >= s.qs.length) return finish(s, ev);
  s.q = s.qs[s.qi];
  ev.push({ k: 'q', n: s.qi + 1, total: s.qs.length, text: s.q.text });
  if (s.mode === 'buzz') return openBuzz(s, s.now, true);
  s.phase = 'q';
  s.openAt = s.now;
  const solo = s.seats.length === 1;
  const lim = s.o.time || (solo ? 0 : T.trivia);
  s.deadline = lim ? s.now + lim : 0;
}

const allAnswered = (s: State) => s.seats.every((x) => s.answers[x]);

/** Очки за верный ответ на скорость: 100 + до 100 за быстроту (+50 первому верному — компанией). */
export function speedPts(dt: number, lim: number): number {
  return 100 + Math.round(100 * Math.max(0, 1 - dt / (lim || T.trivia)));
}

function revealTrivia(s: State, ev: Event[]) {
  const q = s.q!;
  const lim = s.o.time || T.trivia;
  const right = s.seats.filter((x) => s.answers[x]?.i === q.ok);
  const gains: Record<number, number> = {};
  for (const x of right) gains[x] = speedPts(s.answers[x].at - s.openAt, lim);
  if (s.seats.length > 1 && right.length) {
    const first = right.reduce((a, b) => (s.answers[b].at < s.answers[a].at ? b : a));
    gains[first] += 50;
  }
  for (const [x, g] of Object.entries(gains)) s.scores[Number(x)] += g;
  s.last = { kind: 'reveal', ok: q.ok, ans: q.opts[q.ok], gains };
  ev.push({ k: 'reveal', ans: q.opts[q.ok], gains });
  toReveal(s);
}

function toReveal(s: State, ms = T.reveal) {
  s.phase = 'reveal';
  s.revealUntil = s.now + ms;
}

function afterReveal(s: State, ev: Event[]) {
  switch (s.mode) {
    case 'trivia':
    case 'truth':
    case 'buzz':
      return nextQuestion(s, ev);
    case 'ladder':
      return ladderNext(s, ev);
    case 'wheel':
      return wheelAfter(s, ev);
    case 'poll':
      return pollAfter(s, ev);
    case 'board':
      return boardAfter(s, ev);
  }
}

function finish(s: State, ev: Event[]) {
  s.phase = 'over';
  s.q = null;
  ev.push({ k: 'end' });
}

// ---------------------------------------------------------------- кнопка (общая для «Кнопки» и «Табло тем»)

function openBuzz(s: State, t: number, fresh: boolean) {
  const read = fresh ? readMs(s.q!.text) : T.reopen;
  const prev = s.bz;
  s.bz = {
    shown: t,
    openAt: t + read,
    until: t + read + T.buzz,
    presses: [],
    block: {},
    tried: fresh ? [] : (prev?.tried ?? []),
    passed: fresh ? [] : (prev?.passed ?? []),
  };
  s.phase = 'buzz';
  s.answerer = -1;
}

/** Кто ещё может нажать. */
export function eligible(s: State): number[] {
  const b = s.bz;
  if (!b) return [];
  return s.seats.filter((x) => !b.tried.includes(x) && !b.passed.includes(x) && !b.presses.some((p) => p.seat === x));
}

function closeBuzz(s: State, ev: Event[]) {
  const b = s.bz!;
  if (!b.presses.length) {
    ev.push({ k: 'nobody' });
    return revealNoOne(s, ev);
  }
  const sorted = b.presses.slice().sort((x, y) => x.at - y.at || x.seat - y.seat);
  const w = sorted[0];
  const lead = sorted.length > 1 ? sorted[1].at - w.at : null;
  s.answerer = w.seat;
  s.phase = 'answer';
  s.deadline = s.now + (s.o.input ? T.answerInput : T.answer);
  s.last = { kind: 'buzzed', seat: w.seat, lead };
  ev.push({ k: 'buzzed', seat: w.seat, lead, late: null });
}

function cellPrice(s: State): number {
  const bd = s.bd!;
  return BOARD_PRICES[bd.cell![1]] * (bd.round + 1);
}
const buzzValue = (s: State) => (s.mode === 'board' ? cellPrice(s) : 100 * (s.q?.d ?? 1));

function revealNoOne(s: State, ev: Event[]) {
  const q = s.q!;
  const ans = q.ans ?? q.opts[q.ok];
  s.last = { kind: 'none', ok: q.ok, ans };
  ev.push({ k: 'reveal', ans, gains: {} });
  toReveal(s);
}

/** Ответ нажавшего (кнопка, табло) или игрока лестницы. said — что выбрал/ввёл. */
function judge(s: State, seat: number, right: boolean, said: string, ev: Event[], pick?: number, late = false) {
  const q = s.q!;
  const val = buzzValue(s);
  if (right) {
    s.scores[seat] += val;
    s.last = { kind: 'right', seat, ok: q.ok, ans: q.ans ?? q.opts[q.ok], gains: { [seat]: val }, said, pick, lead: s.last?.lead ?? null };
    ev.push({ k: 'right', seat, said, gain: val });
    if (s.bd) s.bd.chooser = seat;
    toReveal(s);
    return;
  }
  s.scores[seat] -= val;
  ev.push(late ? { k: 'timeout', seat, gain: -val } : { k: 'wrong', seat, said, gain: -val });
  s.last = { kind: 'wrong', seat, said, pick, gains: { [seat]: -val } };
  if (!s.bz) return revealNoOne(s, ev);
  s.bz.tried.push(seat);
  openBuzz(s, s.now, false);
  if (!eligible(s).length) {
    s.last = { kind: 'none', ok: q.ok, ans: q.ans ?? q.opts[q.ok], said, gains: { [seat]: -val } };
    ev.push({ k: 'reveal', ans: q.ans ?? q.opts[q.ok], gains: {} });
    toReveal(s);
  }
}

function timeout(s: State, ev: Event[]) {
  if (s.mode === 'poll') return pollSay(s, s.pl!.teams[s.pl!.team][s.pl!.next[s.pl!.team] % s.pl!.teams[s.pl!.team].length], '', ev);
  judge(s, s.answerer, false, '', ev, undefined, true);
}

/** Сверка ответа нажавшего: выбор варианта или ввод. */
function rightAnswer(q: Q, a: { i?: number; text?: string }): boolean {
  if (typeof a.text === 'string') {
    const main = q.ans ?? q.opts[q.ok];
    return matchAnswer(a.text, [{ main, alt: q.alt ?? [] }]) === 0;
  }
  return a.i === q.ok;
}

// ================================================================ лестница

function ladderQ(s: State, ev: Event[]) {
  const ld = s.ld!;
  const seat = ld.order[ld.k];
  s.q = ld.qs[seat][ld.step];
  ld.hidden = [];
  ld.hall = null;
  ld.call = null;
  s.phase = 'q';
  s.openAt = s.now;
  s.deadline = s.o.time ? s.now + s.o.time : 0;
  s.last = null;
  ev.push({ k: 'q', n: ld.step + 1, total: 15, text: s.q.text });
}

function ladderAnswer(s: State, seat: number, i: number, ev: Event[]) {
  const ld = s.ld!;
  const q = s.q!;
  if (i === q.ok) {
    ld.step++;
    ld.won[seat] = LADDER_SUM[ld.step - 1];
    s.scores[seat] = ld.won[seat];
    s.last = { kind: 'right', seat, ok: q.ok, ans: q.opts[q.ok], pick: i };
    ev.push({ k: 'climb', seat, step: ld.step, sum: ld.won[seat] });
    if (ld.step >= 15) ld.done = true;
  } else {
    const sum = safeSum(ld.step);
    ld.won[seat] = sum;
    s.scores[seat] = sum;
    ld.done = true;
    s.last = { kind: i < 0 ? 'timeout' : 'wrong', seat, ok: q.ok, ans: q.opts[q.ok], pick: i };
    ev.push({ k: 'fall', seat, sum, ans: q.opts[q.ok] });
  }
  toReveal(s);
}

function ladderNext(s: State, ev: Event[]) {
  const ld = s.ld!;
  if (!ld.done) return ladderQ(s, ev);
  ld.k++;
  ld.step = 0;
  ld.done = false;
  if (ld.k >= ld.order.length) return finish(s, ev);
  ev.push({ k: 'ladder', seat: ld.order[ld.k] });
  ladderQ(s, ev);
}

/** Точность «помощи зала» и «звонка другу» по трудности. */
const HALL_ACC = [0.88, 0.76, 0.6, 0.45, 0.33];
const CALL_ACC = [0.95, 0.85, 0.7, 0.55, 0.4];

function lifeline(s: State, seat: number, k: 'fifty' | 'hall' | 'call', rng: Rng, ev: Event[]) {
  const ld = s.ld!;
  const q = s.q!;
  ld.life[seat][k] = false;
  const vis = [0, 1, 2, 3].filter((x) => !ld.hidden.includes(x));
  if (k === 'fifty') {
    const wrong = shuffle(
      vis.filter((x) => x !== q.ok),
      rng
    );
    ld.hidden = [...ld.hidden, ...wrong.slice(0, Math.max(0, vis.length - 2))];
    if (ld.hall) ld.hall = null;
  } else if (k === 'hall') {
    const acc = HALL_ACC[q.d - 1] ?? 0.5;
    const w = [0, 0, 0, 0];
    const v = vis.length;
    for (const x of vis) w[x] = (x === q.ok ? acc * 100 : ((1 - acc) * 100) / Math.max(1, v - 1)) * (0.6 + rng.next() * 0.8);
    const sum = w.reduce((a, b) => a + b, 0) || 1;
    const pct = w.map((x) => Math.round((x / sum) * 100));
    // ровно 100
    const top = pct.indexOf(Math.max(...pct));
    pct[top] += 100 - pct.reduce((a, b) => a + b, 0);
    ld.hall = pct;
  } else {
    const right = rng.next() < (CALL_ACC[q.d - 1] ?? 0.6);
    const others = vis.filter((x) => x !== q.ok);
    const i = right || !others.length ? q.ok : others[rng.int(others.length)];
    const sure = right ? 60 + rng.int(36) : 30 + rng.int(35);
    ld.call = { i, sure };
  }
  ev.push({ k: 'life', seat, life: k });
}

// ================================================================ барабан

function wheelRound(s: State, ev: Event[]) {
  const wh = s.wh!;
  const final = wh.round >= wh.rounds;
  const word = wh.words[Math.min(wh.round, wh.words.length - 1)];
  wh.open = [...word.w].map(() => false);
  wh.named = [];
  wh.out = [];
  wh.sector = null;
  wh.winner = null;
  wh.final = final;
  wh.fl = 0;
  s.last = null;
  if (final) {
    // в финал — у кого больше очков
    const best = Math.max(...s.seats.map((x) => s.scores[x]));
    wh.finalist = s.seats.find((x) => s.scores[x] === best)!;
    wh.turn = wh.finalist;
    s.phase = 'final';
    ev.push({ k: 'finalist', seat: wh.finalist });
    return;
  }
  wh.rs = Object.fromEntries(s.seats.map((x) => [x, 0]));
  wh.turn = s.seats[wh.round % s.seats.length];
  s.phase = 'spin';
  ev.push({ k: 'turn', seat: wh.turn });
}

const curWord = (wh: Wheel) => wh.words[Math.min(wh.round, wh.words.length - 1)].w;

function wheelPass(s: State, ev: Event[]) {
  const wh = s.wh!;
  const nx = nextSeat(s, wh.turn, (x) => wh.out.includes(x));
  if (nx == null) return wheelEnd(s, null, ev);
  wh.turn = nx;
  wh.sector = null;
  s.phase = 'spin';
  ev.push({ k: 'turn', seat: nx });
}

function openLetter(wh: Wheel, l: string): number {
  const w = curWord(wh);
  let n = 0;
  for (let i = 0; i < w.length; i++)
    if (w[i] === l && !wh.open[i]) {
      wh.open[i] = true;
      n++;
    }
  return n;
}

function wheelEnd(s: State, winner: number | null, ev: Event[]) {
  const wh = s.wh!;
  wh.open = wh.open.map(() => true);
  wh.winner = winner;
  if (!wh.final) for (const x of s.seats) s.scores[x] += wh.rs[x] ?? 0;
  ev.push({ k: 'wround', round: wh.round + 1, winner, word: curWord(wh), final: wh.final });
  toReveal(s, T.reveal + 800);
}

function wheelAfter(s: State, ev: Event[]) {
  const wh = s.wh!;
  if (wh.final) return finish(s, ev);
  wh.round++;
  if (wh.round >= wh.rounds && wh.words.length <= wh.rounds) return finish(s, ev);
  wheelRound(s, ev);
}

function wheelLetter(s: State, seat: number, l: string, ev: Event[]): boolean {
  const wh = s.wh!;
  if (!ALPHABET.includes(l) || l.length !== 1 || wh.named.includes(l)) return false;
  wh.named.push(l);
  const n = openLetter(wh, l);
  const sec = wh.sector != null ? SECTORS[wh.sector] : 0;
  let gain = 0;
  if (n) {
    if (sec === 'x2') gain = (wh.rs[seat] || 100 * n) * (wh.rs[seat] ? 1 : 2);
    else if (typeof sec === 'number') gain = sec * n;
    wh.rs[seat] += gain;
  }
  ev.push({ k: 'letter', seat, l, n, gain });
  if (n && wh.open.every(Boolean)) {
    wheelEnd(s, seat, ev);
    return true;
  }
  if (n) {
    s.phase = 'spin';
    wh.sector = null;
  } else wheelPass(s, ev);
  return true;
}

function wheelWord(s: State, seat: number, w: string, ev: Event[]) {
  const wh = s.wh!;
  const word = curWord(wh);
  const ok = normText(w).replace(/ /g, '').toUpperCase() === word;
  if (ok) {
    const gain = wh.open.filter((x) => !x).length * WORD_BONUS;
    wh.rs[seat] += gain;
    ev.push({ k: 'word', seat, w: word, ok, gain });
    wheelEnd(s, seat, ev);
    return;
  }
  ev.push({ k: 'word', seat, w: w.toUpperCase().slice(0, 20), ok, gain: 0 });
  wh.out.push(seat);
  if (s.seats.every((x) => wh.out.includes(x))) return wheelEnd(s, null, ev);
  wheelPass(s, ev);
}

function finalWord(s: State, w: string, ev: Event[]) {
  const wh = s.wh!;
  const seat = wh.finalist;
  const ok = !!w && normText(w).replace(/ /g, '').toUpperCase() === curWord(wh);
  const gain = ok ? Math.max(1000, s.scores[seat]) : 0;
  s.scores[seat] += gain;
  ev.push({ k: 'word', seat, w: ok ? curWord(wh) : (w || '—').toUpperCase().slice(0, 20), ok, gain });
  wheelEnd(s, ok ? seat : null, ev);
}

// ================================================================ сто опрошенных

function pollRound(s: State, ev: Event[]) {
  const pl = s.pl!;
  if (pl.round >= pl.rounds || pl.round >= pl.qs.length) return finish(s, ev);
  pl.open = [false, false, false, false, false, false];
  pl.strikes = 0;
  pl.bank = 0;
  pl.steal = false;
  pl.starter = pl.round % pl.teams.length;
  pl.team = pl.starter;
  pl.reverse = s.o.reverse && pl.round === pl.rounds - 1;
  s.last = null;
  s.phase = 'say';
  s.deadline = s.now ? s.now + T.say : T.say;
  ev.push({ k: 'q', n: pl.round + 1, total: pl.rounds, text: pl.qs[pl.round].q });
}

export const pollSpeaker = (pl: Poll) => pl.teams[pl.team][pl.next[pl.team] % pl.teams[pl.team].length];

export function pollPts(pl: Poll, i: number): number {
  const r = pl.qs[pl.round].r[i];
  return pl.reverse ? REVERSE_PTS[i] : r[1] * (POLL_MULT[pl.round] ?? 3);
}

function pollSay(s: State, seat: number, text: string, ev: Event[]) {
  const pl = s.pl!;
  const q = pl.qs[pl.round];
  const hit = text ? matchAnswer(text, q.r.map(([m, , alt]) => ({ main: m, alt })), (i) => pl.open[i]) : -1;
  const pts = hit >= 0 ? pollPts(pl, hit) : 0;
  ev.push({ k: 'say', seat, text: text.slice(0, 40), hit, pts });
  s.last = { kind: hit >= 0 ? 'right' : 'wrong', seat, said: text.slice(0, 40), pick: hit };
  pl.next[pl.team]++;
  if (pl.steal) {
    // отыгрыш: угадали — банк у отыгравших, нет — у первой команды
    let team = pl.team;
    if (hit >= 0) {
      pl.open[hit] = true;
      pl.bank += pts;
    } else team = 1 - pl.team;
    return pollEnd(s, team, ev);
  }
  if (hit >= 0) {
    pl.open[hit] = true;
    pl.bank += pts;
    if (pl.open.every(Boolean)) return pollEnd(s, pl.team, ev);
  } else {
    pl.strikes++;
    ev.push({ k: 'strike', n: pl.strikes });
    if (pl.strikes >= 3) {
      if (pl.teams.length < 2) return pollEnd(s, pl.team, ev);
      pl.steal = true;
      pl.team = 1 - pl.team;
      ev.push({ k: 'steal', team: pl.team });
    }
  }
  s.deadline = s.now + T.say;
}

function pollEnd(s: State, team: number | null, ev: Event[]) {
  const pl = s.pl!;
  if (team != null) for (const x of pl.teams[team]) s.scores[x] += pl.bank;
  ev.push({ k: 'pround', team, bank: pl.bank });
  pl.open = pl.open.map(() => true);
  s.last = { ...(s.last ?? { kind: 'reveal' }), gains: team != null ? Object.fromEntries(pl.teams[team].map((x) => [x, pl.bank])) : {} };
  toReveal(s, T.reveal + 1500);
}

function pollAfter(s: State, ev: Event[]) {
  s.pl!.round++;
  pollRound(s, ev);
}

// ================================================================ табло тем

function boardAfter(s: State, ev: Event[]) {
  const bd = s.bd!;
  bd.cell = null;
  s.q = null;
  s.bz = null;
  s.answerer = -1;
  if (bd.used[bd.round].every(Boolean)) {
    bd.round++;
    if (bd.round >= bd.rounds) return finish(s, ev);
    // второй раунд начинает отстающий
    const low = Math.min(...s.seats.map((x) => s.scores[x]));
    bd.chooser = s.seats.find((x) => s.scores[x] === low)!;
  }
  s.phase = 'pick';
  s.last = null;
}

function boardCell(s: State, seat: number, th: number, k: number, ev: Event[]): boolean {
  const bd = s.bd!;
  const row = bd.themes[bd.round];
  if (!row[th] || k < 0 || k > 4 || bd.used[bd.round][th * 5 + k]) return false;
  bd.used[bd.round][th * 5 + k] = true;
  bd.cell = [th, k];
  const c = row[th].cells[k];
  s.q = { id: `${th}:${k}`, text: c.q, opts: c.opts, ok: c.ok, d: k + 1, t: row[th].t, ans: c.ans, alt: c.alt };
  ev.push({ k: 'cell', seat, theme: row[th].name, price: cellPrice(s) });
  if (s.seats.length === 1) {
    s.bz = null;
    s.answerer = seat;
    s.phase = 'answer';
    s.deadline = s.now + T.say;
  } else openBuzz(s, s.now, true);
  return true;
}

// ================================================================ ходы

export function toAct(s: State): number[] {
  switch (s.phase) {
    case 'q':
      if (s.mode === 'ladder') return [s.ld!.order[s.ld!.k]];
      return s.seats.filter((x) => !s.answers[x]);
    case 'buzz':
      return eligible(s);
    case 'answer':
      return [s.answerer];
    case 'spin':
    case 'letter':
    case 'plus':
      return [s.wh!.turn];
    case 'final':
    case 'fword':
      return [s.wh!.finalist];
    case 'say':
      return [pollSpeaker(s.pl!)];
    case 'pick':
      return [s.bd!.chooser];
    default:
      return [];
  }
}

/** Будильник (место -1) и «Дальше» на показе ответа у одного человека — вне очереди. */
export function free(s: State, seat: number, a: Action): boolean {
  if (!a || typeof a !== 'object') return false;
  if (seat === -1 && a.type === 'wake') return true;
  if (a.type === 'next' && s.phase === 'reveal' && s.seats.includes(seat) && s.seats.filter((x) => !isBot(s, x)).length === 1 && !isBot(s, seat)) return true;
  return false;
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): Res | null {
  if (!a || typeof a !== 'object' || s0.phase === 'over') return null;
  const s = clone(s0);
  const ev: Event[] = [];
  tickTo(s, a);
  advance(s, ev);
  if (a.type === 'wake') {
    if (seat !== -1) return null;
    return { state: s, events: ev };
  }
  if (a.type === 'next') {
    if (s.phase !== 'reveal') return ev.length ? { state: s, events: ev } : null;
    s.revealUntil = s.now;
    advance(s, ev);
    return { state: s, events: ev };
  }
  if (s.phase === 'over' || !toAct(s).includes(seat)) return ev.length ? { state: s, events: ev } : null;
  if (!act(s, seat, a, rng, ev)) return ev.length ? { state: s, events: ev } : null;
  advance(s, ev);
  return { state: s, events: ev };
}

function act(s: State, seat: number, a: Action, rng: Rng, ev: Event[]): boolean {
  switch (s.phase) {
    case 'q': {
      if (s.mode === 'ladder') {
        const ld = s.ld!;
        if (a.type === 'answer' || a.type === 'pick') {
          if (!Number.isInteger(a.i) || a.i < 0 || a.i > 3 || ld.hidden.includes(a.i)) return false;
          ladderAnswer(s, seat, a.i, ev);
          return true;
        }
        if (a.type === 'life') {
          if (!['fifty', 'hall', 'call'].includes(a.k) || !ld.life[seat][a.k]) return false;
          lifeline(s, seat, a.k, rng, ev);
          return true;
        }
        if (a.type === 'take') {
          if (ld.step === 0) return false;
          ld.done = true;
          ev.push({ k: 'take', seat, sum: ld.won[seat] });
          s.last = { kind: 'reveal', seat, ok: s.q!.ok, ans: s.q!.opts[s.q!.ok] };
          toReveal(s);
          return true;
        }
        return false;
      }
      if (a.type !== 'answer') return false;
      if (!Number.isInteger(a.i) || a.i < 0 || a.i >= s.q!.opts.length) return false;
      const at = Math.max(s.openAt, pressAt(s, seat, a, s.openAt));
      s.answers[seat] = { i: a.i, at };
      ev.push({ k: 'answered', seat });
      return true;
    }
    case 'buzz': {
      const b = s.bz!;
      if (a.type === 'pass') {
        b.passed.push(seat);
        return true;
      }
      if (a.type !== 'buzz') return false;
      const at = pressAt(s, seat, a, b.openAt);
      if (at < b.openAt || at < (b.block[seat] ?? 0)) {
        // фальстарт (или нажал, пока заблокирован): блок от момента нажатия
        b.block[seat] = Math.max(b.block[seat] ?? 0, Math.max(at, s.now) + T.falseStart);
        ev.push({ k: 'early', seat });
        return true;
      }
      b.presses.push({ seat, at });
      ev.push({ k: 'pressed', seat });
      return true;
    }
    case 'answer': {
      const q = s.q!;
      if (a.type === 'pick') {
        if (s.o.input && s.mode === 'buzz') return false;
        if (s.mode === 'board' && s.o.input) return false;
        if (!Number.isInteger(a.i) || a.i < 0 || a.i >= q.opts.length) return false;
        judge(s, seat, a.i === q.ok, q.opts[a.i], ev, a.i);
        return true;
      }
      if (a.type === 'say') {
        if (typeof a.text !== 'string') return false;
        const text = a.text.slice(0, 60);
        judge(s, seat, rightAnswer(q, { text }), text, ev);
        return true;
      }
      if (a.type === 'pass') {
        judge(s, seat, false, '', ev);
        return true;
      }
      return false;
    }
    case 'spin': {
      const wh = s.wh!;
      if (a.type === 'word') {
        if (typeof a.w !== 'string' || !a.w.trim()) return false;
        wheelWord(s, seat, a.w, ev);
        return true;
      }
      if (a.type !== 'spin') return false;
      const f = typeof a.f === 'number' && Number.isFinite(a.f) ? Math.max(0, Math.min(1, a.f)) : 0.5;
      const sec = rng.int(SECTORS.length);
      wh.sector = sec;
      wh.spins++;
      wh.f = f;
      ev.push({ k: 'spin', seat, sector: sec, spins: wh.spins, f });
      const x = SECTORS[sec];
      if (x === 'Б') {
        wh.rs[seat] = 0;
        ev.push({ k: 'bankrupt', seat });
        wheelPass(s, ev);
      } else if (x === '0') {
        ev.push({ k: 'zero', seat });
        wheelPass(s, ev);
      } else if (x === 'П') {
        // приз: ведущий открывает случайную закрытую букву
        const w = curWord(wh);
        const closed = [...w].filter((_, i) => !wh.open[i]);
        const l = closed[rng.int(closed.length)];
        if (!wh.named.includes(l)) wh.named.push(l);
        const n = openLetter(wh, l);
        wh.rs[seat] += 100 * n;
        ev.push({ k: 'opened', seat, l, n });
        if (wh.open.every(Boolean)) wheelEnd(s, seat, ev);
        else wh.sector = null;
      } else if (x === '+') s.phase = 'plus';
      else s.phase = 'letter';
      return true;
    }
    case 'letter': {
      if (a.type === 'word') {
        if (typeof a.w !== 'string' || !a.w.trim()) return false;
        wheelWord(s, seat, a.w, ev);
        return true;
      }
      if (a.type !== 'letter' || typeof a.l !== 'string') return false;
      return wheelLetter(s, seat, a.l.toUpperCase().replace('Ё', 'Е'), ev);
    }
    case 'plus': {
      const wh = s.wh!;
      if (a.type !== 'plus' || !Number.isInteger(a.pos) || a.pos < 0 || a.pos >= wh.open.length || wh.open[a.pos]) return false;
      const l = curWord(wh)[a.pos];
      if (!wh.named.includes(l)) wh.named.push(l);
      const n = openLetter(wh, l);
      ev.push({ k: 'opened', seat, l, n });
      wh.sector = null;
      if (wh.open.every(Boolean)) wheelEnd(s, seat, ev);
      else s.phase = 'spin';
      return true;
    }
    case 'final': {
      const wh = s.wh!;
      if (a.type === 'word') {
        finalWord(s, a.w, ev);
        return true;
      }
      if (a.type !== 'letter' || typeof a.l !== 'string') return false;
      const l = a.l.toUpperCase().replace('Ё', 'Е');
      if (!ALPHABET.includes(l) || l.length !== 1 || wh.named.includes(l)) return false;
      wh.named.push(l);
      const n = openLetter(wh, l);
      ev.push({ k: 'letter', seat, l, n, gain: 0 });
      wh.fl++;
      if (wh.open.every(Boolean)) {
        finalWord(s, curWord(wh), ev);
        return true;
      }
      if (wh.fl >= 3) {
        s.phase = 'fword';
        s.deadline = s.now + T.final;
      }
      return true;
    }
    case 'fword':
      if (a.type !== 'word' || typeof a.w !== 'string') return false;
      finalWord(s, a.w, ev);
      return true;
    case 'say':
      if (a.type !== 'say' || typeof a.text !== 'string') return false;
      pollSay(s, seat, a.text, ev);
      return true;
    case 'pick':
      if (a.type !== 'cell') return false;
      return boardCell(s, seat, a.th, a.k, ev);
  }
  return false;
}

// ================================================================ что видят игроки

export interface View {
  mode: Mode;
  o: State['o'];
  seats: number[];
  /** Сколько за столом людей (не ботов): «Дальше» на показе ответа — только когда человек один. */
  humans: number;
  scores: Record<number, number>;
  now: number;
  phase: Phase;
  n: number;
  total: number;
  q: { text: string; opts: string[] | null; d: number; t: string } | null;
  openAt: number;
  deadline: number;
  /** Кто уже ответил (тривиа) — без выбора до показа. */
  answered: Record<number, { at: number; i?: number }>;
  bz: { shown: number; openAt: number; until: number; presses: Press[]; block: Record<number, number>; tried: number[]; passed: number[] } | null;
  answerer: number;
  revealUntil: number;
  last: Last | null;
  ld: {
    seat: number;
    order: number[];
    step: number;
    life: { fifty: boolean; hall: boolean; call: boolean };
    hidden: number[];
    hall: number[] | null;
    call: { i: number; sure: number } | null;
    won: Record<number, number>;
    k: number;
  } | null;
  wh: {
    round: number;
    rounds: number;
    final: boolean;
    mask: string[];
    hint: string;
    named: string[];
    turn: number;
    out: number[];
    sector: number | null;
    spins: number;
    f: number;
    rs: Record<number, number>;
    finalist: number;
    fl: number;
    winner: number | null;
  } | null;
  pl: {
    round: number;
    rounds: number;
    q: string;
    rows: ({ text: string; n: number; pts: number } | null)[];
    teams: number[][];
    team: number;
    speaker: number;
    strikes: number;
    bank: number;
    steal: boolean;
    reverse: boolean;
    mult: number;
  } | null;
  bd: {
    round: number;
    rounds: number;
    themes: string[];
    used: boolean[];
    chooser: number;
    cell: [number, number] | null;
    price: number;
  } | null;
  /** Только боту: что он «знает» (верный вариант, ответы опроса, слово барабана). Решает по силе уровня. */
  know?: { ok?: number; ans?: string; rows?: [string, number][]; word?: string };
}

export function view(s: State, seats: number[] | 'all'): View {
  const reveal = s.phase === 'reveal' || s.phase === 'over';
  const q = s.q;
  const showOpts = !!q && !(s.mode === 'buzz' && (s.phase === 'buzz' || (s.phase === 'answer' && s.o.input))) && !(s.mode === 'board' && (s.o.input || s.phase === 'buzz'));
  const answered: View['answered'] = {};
  for (const [k, x] of Object.entries(s.answers)) if (reveal || x.at <= s.now) answered[Number(k)] = reveal ? { at: x.at, i: x.i } : { at: x.at };
  const ld = s.ld;
  const wh = s.wh;
  const pl = s.pl;
  const bd = s.bd;
  const v: View = {
    mode: s.mode,
    o: s.o,
    seats: s.seats,
    humans: s.seats.filter((x) => !isBot(s, x)).length,
    scores: s.scores,
    now: s.now,
    phase: s.phase,
    n: s.mode === 'ladder' ? (ld?.step ?? 0) + 1 : s.qi + 1,
    total: s.mode === 'ladder' ? 15 : s.qs.length,
    q: q ? { text: q.text, opts: showOpts ? q.opts : null, d: q.d, t: q.t } : null,
    openAt: s.openAt,
    deadline: s.deadline,
    answered,
    bz: s.bz
      ? {
          shown: s.bz.shown,
          openAt: s.bz.openAt,
          until: s.bz.until,
          presses: s.bz.presses.filter((p) => p.at <= s.now || s.phase !== 'buzz'),
          block: s.bz.block,
          tried: s.bz.tried,
          passed: s.bz.passed,
        }
      : null,
    answerer: s.answerer,
    revealUntil: s.revealUntil,
    last: s.last,
    ld: ld
      ? {
          seat: ld.order[Math.min(ld.k, ld.order.length - 1)],
          order: ld.order,
          step: ld.step,
          life: ld.life[ld.order[Math.min(ld.k, ld.order.length - 1)]],
          hidden: ld.hidden,
          hall: ld.hall,
          call: ld.call,
          won: ld.won,
          k: ld.k,
        }
      : null,
    wh: wh
      ? {
          round: wh.round,
          rounds: wh.rounds,
          final: wh.final,
          mask: [...curWord(wh)].map((c, i) => (wh.open[i] ? c : '')),
          hint: wh.words[Math.min(wh.round, wh.words.length - 1)].h,
          named: wh.named,
          turn: wh.turn,
          out: wh.out,
          sector: wh.sector,
          spins: wh.spins,
          f: wh.f,
          rs: wh.rs,
          finalist: wh.finalist,
          fl: wh.fl,
          winner: wh.winner,
        }
      : null,
    pl:
      pl && pl.round < pl.qs.length
        ? {
            round: pl.round,
            rounds: pl.rounds,
            q: pl.qs[pl.round].q,
            rows: pl.qs[pl.round].r.map((r, i) => (pl.open[i] ? { text: r[0], n: r[1], pts: pollPts(pl, i) } : null)),
            teams: pl.teams,
            team: pl.team,
            speaker: pollSpeaker(pl),
            strikes: pl.strikes,
            bank: pl.bank,
            steal: pl.steal,
            reverse: pl.reverse,
            mult: POLL_MULT[pl.round] ?? 3,
          }
        : null,
    bd: bd
      ? {
          round: Math.min(bd.round, bd.rounds - 1),
          rounds: bd.rounds,
          themes: bd.themes[Math.min(bd.round, bd.rounds - 1)].map((t) => t.name),
          used: bd.used[Math.min(bd.round, bd.rounds - 1)],
          chooser: bd.chooser,
          cell: bd.cell,
          price: bd.cell ? BOARD_PRICES[bd.cell[1]] * (bd.round + 1) : 0,
        }
      : null,
  };
  // знание бота — только в его собственном виде (комната считает его на своей стороне, клиентам не шлёт)
  if (seats !== 'all' && seats.length === 1 && isBot(s, seats[0])) {
    const k: NonNullable<View['know']> = {};
    if (q) {
      k.ok = q.ok;
      k.ans = q.ans ?? q.opts[q.ok];
    }
    if (pl && pl.round < pl.qs.length) k.rows = pl.qs[pl.round].r.map((r) => [r[0], r[1]]);
    if (wh) k.word = curWord(wh);
    v.know = k;
  }
  return v;
}

/** Выбор ответа скрыт до показа: событие «ответил» без варианта. Остальные события открытые. */
export function redact(ev: Event): Event | null {
  return ev;
}

export function result(s: State) {
  if (s.phase !== 'over') return null;
  const best = Math.max(...s.seats.map((x) => s.scores[x]));
  const winners = s.seats.filter((x) => s.scores[x] === best);
  const text = s.mode === 'ladder' ? `выигрыш ${best.toLocaleString('ru-RU')} ₽` : `очков: ${best}`;
  return { winners, text, scores: { ...s.scores } };
}

/** Показ правил и превью: начать партию заново с подложенными вопросами (без банка). */
export function restart(s: State) {
  s.qi = -1;
  start(s, []);
}
