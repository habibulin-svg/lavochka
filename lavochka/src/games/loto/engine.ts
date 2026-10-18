/* Лото: русское (бочонки 1–90, карточки 3×9) и географическое «Вокруг света» (большие карты с картинками,
 * ведущий читает карточку — у кого картинка, тот узнаёт её и закрывает). Без DOM. */
import type { Options, Rng, SeatSpec } from '../../core/types';
import { edition } from './world-data';

export type Mode = 'russian' | 'world';
/** Как закрываем числа: turn — после каждого бочонка каждый отвечает сам (закрыл или «Нет у меня»), игра ждёт;
 * race — как за столом: закрывай когда успеешь, мешок не ждёт; auto — фишки кладутся сами. */
export type MarkMode = 'turn' | 'race' | 'auto';
export type Goal = 'row' | 'card' | 'stages';

export interface Cfg {
  mode: Mode;
  /** Карточек у каждого (русское). */
  cards: number;
  goal: Goal;
  mark: MarkMode;
  /** «Вокруг света»: подсказка, что ответ — на твоей карте. */
  hint: boolean;
  /** «Вокруг света»: издание (1972 или 1980). */
  edition: string;
}

export function cfgFrom(o: Options): Cfg {
  return {
    mode: o.mode === 'world' ? 'world' : 'russian',
    cards: Math.min(3, Math.max(1, Number(o.cards ?? 2) || 2)),
    goal: o.goal === 'row' || o.goal === 'card' ? o.goal : 'stages',
    mark: o.mark === 'race' || o.mark === 'auto' ? o.mark : o.auto === true ? 'auto' : 'turn',
    hint: o.hint === true,
    edition: edition(o.edition).id,
  };
}

/** Карточка русского лото: 3 ряда × 9 столбцов, 0 — пустая клетка. */
export interface Card {
  rows: number[][];
  /** Цвет картона. */
  tint: number;
  marked: number[];
}

/** Призы по порядку: ряд, два ряда, вся карточка. */
export const STAGES = ['ряд', 'два ряда', 'вся карточка'];

export interface Prize {
  stage: number;
  seat: number;
  card: number;
}

export interface State {
  cfg: Cfg;
  seats: number[];
  /** Уровни ботов (у людей — нет): бот иногда зевает. */
  bots: Record<number, number>;
  /** Режим turn: кто из людей ещё не ответил на последний бочонок (мешок ждёт). */
  pending: number[];
  /** Чья очередь тянуть бочонок / читать карточку (индекс в seats). */
  turn: number;
  over: boolean;
  // ---- русское
  cards: Record<number, Card[]>;
  /** Бочонки в мешке — только на хосте (view его не отдаёт). */
  bag: number[];
  called: number[];
  /** Какой вариант присказки выпал к последнему бочонку. */
  callKey: number;
  /** Какой приз сейчас разыгрывается (индекс в STAGES). */
  stage: number;
  /** На каком бочонке приз уже взяли — кто закроет на нём же, делит приз. */
  stageAt: number | null;
  prizes: Prize[];
  // ---- «Вокруг света»
  /** Большие карты у игроков (номера листов 0…15). */
  sheets: Record<number, number[]>;
  /** Колода маленьких карточек (номера 1…128) — только на хосте. */
  deck: number[];
  /** Карточка, которую сейчас читают. */
  current: number | null;
  /** Сколько раз эту карточку уже не узнали (второй раз — уходит из игры). */
  misses: Record<number, number>;
  /** Ответы по текущей карточке: номер картинки или 0 — «не у меня». */
  answers: Record<number, number>;
  /** Закрытые картинки. */
  covered: number[];
  /** Карточки, ушедшие из игры неузнанными. */
  lost: number[];
}

export type Action =
  | { type: 'draw' }
  | { type: 'mark'; card: number; n: number }
  | { type: 'pass' }
  | { type: 'answer'; pic: number };

export type Event =
  | { type: 'draw'; seat: number; n: number; k: number; left: number }
  | { type: 'mark'; seat: number; card: number; n: number }
  | { type: 'pass'; seat: number; n: number; missed: boolean }
  | { type: 'prize'; seat: number; card: number; stage: number; shared: boolean }
  | { type: 'read'; seat: number; card: number; again: boolean; left: number }
  | { type: 'answer'; seat: number; pic: number }
  | { type: 'take'; seat: number; card: number; text: string }
  | { type: 'wrong'; seat: number; card: number; pic: number; text: string }
  | { type: 'unknown'; card: number; lost: boolean; text: string }
  | { type: 'end'; winners: number[] };

// ---------------------------------------------------------------- карточки русского лото

/** Диапазон столбца: 1–9, 10–19, …, 80–90. */
function colRange(c: number): [number, number] {
  return c === 0 ? [1, 9] : c === 8 ? [80, 90] : [c * 10, c * 10 + 9];
}

/** Запасная раскладка рядов (если случай не дал годной — например, подкрученный rng в показе). */
const FALLBACK = [
  [0, 2, 4, 6, 8],
  [1, 3, 5, 7, 8],
  [0, 1, 4, 5, 6],
];

export function makeCard(rng: Rng, tint: number): Card {
  for (let attempt = 0; ; attempt++) {
    // в каждом ряду ровно 5 чисел, в каждом столбце хотя бы одно
    const grid = attempt > 50 ? FALLBACK : [0, 1, 2].map(() => {
      const cols = [0, 1, 2, 3, 4, 5, 6, 7, 8];
      for (let i = cols.length - 1; i > 0; i--) {
        const j = rng.int(i + 1);
        [cols[i], cols[j]] = [cols[j], cols[i]];
      }
      return cols.slice(0, 5);
    });
    const used = new Set(grid.flat());
    if (used.size < 9) continue;
    const rows = [0, 1, 2].map(() => Array(9).fill(0) as number[]);
    for (let c = 0; c < 9; c++) {
      const rs = [0, 1, 2].filter((r) => grid[r].includes(c));
      const [lo, hi] = colRange(c);
      const pool: number[] = [];
      for (let n = lo; n <= hi; n++) pool.push(n);
      const pick: number[] = [];
      while (pick.length < rs.length) pick.push(pool.splice(rng.int(pool.length), 1)[0]);
      pick.sort((a, b) => a - b);
      rs.forEach((r, i) => (rows[r][c] = pick[i]));
    }
    return { rows, tint, marked: [] };
  }
}

export const cardNums = (c: Card) => c.rows.flat().filter((n) => n > 0);

/** Сколько рядов закрыто (числа отмечены и действительно вышли). */
export function fullRows(c: Card, called: Set<number>): number {
  const m = new Set(c.marked.filter((n) => called.has(n)));
  return c.rows.filter((r) => r.every((n) => n === 0 || m.has(n))).length;
}

/** Сколько рядов нужно для приза stage. */
const need = (stage: number) => stage + 1;

/** Последний разыгрываемый приз при этих правилах. */
function lastStage(cfg: Cfg) {
  return cfg.goal === 'row' ? 0 : 2;
}
function firstStage(cfg: Cfg) {
  return cfg.goal === 'card' ? 2 : 0;
}

// ---------------------------------------------------------------- партия

export function setup(seats: SeatSpec[], opts: Options, rng: Rng): State {
  const cfg = cfgFrom(opts);
  const order = seats.map((s) => s.seat).sort((a, b) => a - b);
  const bots: Record<number, number> = {};
  for (const s of seats) if (s.kind === 'bot') bots[s.seat] = s.level;
  const s: State = {
    cfg,
    seats: order,
    bots,
    pending: [],
    turn: 0,
    over: false,
    cards: {},
    bag: [],
    called: [],
    callKey: 0,
    stage: firstStage(cfg),
    stageAt: null,
    prizes: [],
    sheets: {},
    deck: [],
    current: null,
    misses: {},
    answers: {},
    covered: [],
    lost: [],
  };
  if (cfg.mode === 'russian') {
    let tint = rng.int(5);
    for (const p of order) s.cards[p] = Array.from({ length: cfg.cards }, () => makeCard(rng, tint++ % 5));
    for (let n = 1; n <= 90; n++) s.bag.push(n);
  } else {
    // 16 больших карт — поровну, лишние остаются в коробке
    const ed = edition(cfg.edition);
    const ids = shuffle(
      Array.from({ length: ed.sheets.length }, (_, i) => i),
      rng
    );
    const per = Math.floor(ids.length / order.length);
    order.forEach((p, i) => (s.sheets[p] = ids.slice(i * per, (i + 1) * per).sort((a, b) => a - b)));
    s.deck = shuffle(
      order.flatMap((p) => s.sheets[p].flatMap((id) => ed.sheets[id])),
      rng
    );
    readNext(s, []);
  }
  return s;
}

function shuffle<T>(a: T[], rng: Rng): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function toAct(s: State): number[] {
  if (s.over) return [];
  if (s.cfg.mode === 'russian') return s.pending.length ? s.pending.slice() : [s.seats[s.turn]];
  if (s.current == null) return [];
  return s.seats.filter((p) => !(p in s.answers));
}

/** «Как за столом»: закрыть — вне очереди, в любой момент. */
export function free(s: State, _seat: number, a: Action): boolean {
  return a.type === 'mark' && s.cfg.mode === 'russian' && s.cfg.mark === 'race' && !s.over;
}

/** Последний вышедший бочонок. */
export const lastCalled = (s: Pick<State, 'called'>) => s.called[s.called.length - 1];

/** Карточки места, где есть число n и оно ещё не закрыто. */
export const openWith = (s: Pick<State, 'cards'>, seat: number, n: number) =>
  (s.cards[seat] ?? []).map((c, i) => (cardNums(c).includes(n) && !c.marked.includes(n) ? i : -1)).filter((i) => i >= 0);

const clone = (s: State): State => JSON.parse(JSON.stringify(s));

/** Чья картинка (у кого на карте). */
export function ownerOf(s: Pick<State, 'seats' | 'sheets' | 'cfg'>, pic: number): number | null {
  for (const p of s.seats) if (picsOf(s, p).includes(pic)) return p;
  return null;
}

/** Шанс бота: заметить вышедшее число / узнать картинку. */
const BOT_EYE = [0.75, 0.93, 1];

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.over) return null;
  const s = clone(s0);
  const ev: Event[] = [];
  if (s.cfg.mode === 'russian') {
    if (a.type === 'draw') {
      if (s.seats[s.turn] !== seat || !s.bag.length || s.pending.length) return null;
      // приз, взятый на прошлом бочонке, закрыт — разыгрываем следующий
      if (s.stageAt != null) {
        s.stage++;
        s.stageAt = null;
      }
      const n = s.bag.splice(rng.int(s.bag.length), 1)[0];
      s.called.push(n);
      s.callKey = rng.int(12);
      ev.push({ type: 'draw', seat, n, k: s.callKey, left: s.bag.length });
      s.turn = (s.turn + 1) % s.seats.length;
      // боты (и все — при «фишки сами») закрывают вышедшие числа
      const called = new Set(s.called);
      for (const p of s.seats) {
        const bot = p in s.bots;
        if (!bot && s.cfg.mark !== 'auto') continue;
        const eye = bot ? BOT_EYE[s.bots[p]] ?? 1 : 1;
        s.cards[p].forEach((c, ci) => {
          for (const x of cardNums(c)) {
            if (!called.has(x) || c.marked.includes(x)) continue;
            if (eye < 1 && rng.next() > eye) continue;
            c.marked.push(x);
            ev.push({ type: 'mark', seat: p, card: ci, n: x });
          }
        });
      }
      claim(s, ev);
      // «Отвечают все»: мешок ждёт каждого человека
      if (!s.over && s.cfg.mark === 'turn') s.pending = s.seats.filter((p) => !(p in s.bots));
      if (!s.over && !s.bag.length && !s.pending.length) finish(s, ev);
      return { state: s, events: ev };
    }
    if (a.type === 'mark') {
      const c = s.cards[seat]?.[a.card];
      if (!c || !cardNums(c).includes(a.n) || c.marked.includes(a.n) || !s.called.includes(a.n)) return null;
      // по очереди — только последний бочонок и только пока ждут твоего ответа
      if (s.cfg.mark === 'turn' && (!s.pending.includes(seat) || a.n !== lastCalled(s))) return null;
      c.marked.push(a.n);
      ev.push({ type: 'mark', seat, card: a.card, n: a.n });
      claim(s, ev);
      if (s.cfg.mark === 'turn' && !openWith(s, seat, a.n).length) answered(s, seat, ev);
      return { state: s, events: ev };
    }
    if (a.type === 'pass') {
      if (s.cfg.mark !== 'turn' || !s.pending.includes(seat)) return null;
      const n = lastCalled(s);
      ev.push({ type: 'pass', seat, n, missed: openWith(s, seat, n).length > 0 });
      answered(s, seat, ev);
      return { state: s, events: ev };
    }
    return null;
  }
  // ---- «Вокруг света»
  if (a.type !== 'answer' || s.current == null || seat in s.answers || !s.seats.includes(seat)) return null;
  if (a.pic !== 0 && !picsOf(s, seat).includes(a.pic)) return null;
  if (a.pic !== 0 && s.covered.includes(a.pic)) return null;
  s.answers[seat] = a.pic;
  ev.push({ type: 'answer', seat, pic: a.pic });
  if (s.seats.some((p) => !(p in s.answers))) return { state: s, events: ev };
  // все ответили — разбираем
  const card = s.current;
  const ed = edition(s.cfg.edition);
  const owner = ownerOf(s, card);
  for (const p of s.seats) {
    const pic = s.answers[p];
    if (pic && pic !== card) ev.push({ type: 'wrong', seat: p, card, pic, text: ed.a[pic] ?? String(pic) });
  }
  if (owner != null && s.answers[owner] === card) {
    s.covered.push(card);
    ev.push({ type: 'take', seat: owner, card, text: ed.a[card] ?? String(card) });
  } else {
    const m = (s.misses[card] ?? 0) + 1;
    s.misses[card] = m;
    const lost = m >= 2;
    if (lost) s.lost.push(card);
    else s.deck.push(card);
    ev.push({ type: 'unknown', card, lost, text: ed.a[card] ?? String(card) });
  }
  const done = s.seats.filter((p) => picsOf(s, p).every((x) => s.covered.includes(x)));
  if (done.length) {
    s.over = true;
    s.current = null;
    ev.push({ type: 'end', winners: done });
    return { state: s, events: ev };
  }
  s.turn = (s.turn + 1) % s.seats.length;
  readNext(s, ev);
  return { state: s, events: ev };
}

/** Картинки на картах игрока. */
export function picsOf(s: Pick<State, 'sheets' | 'cfg'>, p: number): number[] {
  const ed = edition(s.cfg.edition);
  return (s.sheets[p] ?? []).flatMap((id) => ed.sheets[id] ?? []);
}

function readNext(s: State, ev: Event[]) {
  s.answers = {};
  if (!s.deck.length) {
    s.current = null;
    // колода кончилась — выигрывает, кто закрыл больше
    const best = Math.max(...s.seats.map((p) => picsOf(s, p).filter((x) => s.covered.includes(x)).length));
    const w = s.seats.filter((p) => picsOf(s, p).filter((x) => s.covered.includes(x)).length === best);
    s.over = true;
    ev.push({ type: 'end', winners: w });
    return;
  }
  s.current = s.deck.shift()!;
  ev.push({ type: 'read', seat: s.seats[s.turn], card: s.current, again: (s.misses[s.current] ?? 0) > 0, left: s.deck.length });
}

/** Проверить призы после новых фишек. */
function claim(s: State, ev: Event[]) {
  const called = new Set(s.called);
  const at = s.called.length;
  for (;;) {
    if (s.stageAt != null && s.stageAt !== at) return;
    const takers: Prize[] = [];
    for (const p of s.seats)
      s.cards[p].forEach((c, ci) => {
        if (fullRows(c, called) >= need(s.stage) && !s.prizes.some((x) => x.stage === s.stage && x.seat === p)) takers.push({ stage: s.stage, seat: p, card: ci });
      });
    if (!takers.length) return;
    const shared = s.stageAt != null || new Set(takers.map((t) => t.seat)).size > 1;
    for (const t of takers) {
      if (s.prizes.some((x) => x.stage === t.stage && x.seat === t.seat)) continue;
      s.prizes.push(t);
      ev.push({ type: 'prize', seat: t.seat, card: t.card, stage: t.stage, shared });
    }
    s.stageAt = at;
    if (s.stage >= lastStage(s.cfg)) return finish(s, ev);
    // на одном бочонке можно взять сразу и следующий приз (ряд и два ряда разом)
    const next = s.stage + 1;
    const more = s.seats.some((p) => s.cards[p].some((c) => fullRows(c, called) >= need(next)));
    if (!more) return;
    s.stage = next;
    s.stageAt = null;
  }
}

/** Место ответило на бочонок; все ответили, а мешок пуст — конец. */
function answered(s: State, seat: number, ev: Event[]) {
  s.pending = s.pending.filter((p) => p !== seat);
  if (s.over) s.pending = [];
  else if (!s.pending.length && !s.bag.length) finish(s, ev);
}

function finish(s: State, ev: Event[]) {
  s.over = true;
  s.pending = [];
  const last = Math.max(...s.prizes.map((x) => x.stage), -1);
  const w = [...new Set(s.prizes.filter((x) => x.stage === last).map((x) => x.seat))];
  ev.push({ type: 'end', winners: w });
}

/** Сколько призов у игрока (для счёта). */
export function score(s: State, p: number): number {
  if (s.cfg.mode === 'world') return picsOf(s, p).filter((x) => s.covered.includes(x)).length;
  return s.prizes.filter((x) => x.seat === p).reduce((a, x) => a + x.stage + 1, 0);
}

export type View = Omit<State, 'bag' | 'deck'> & { bagLeft: number; deckLeft: number; me: number[] };

export function makeView(s: State, seats: number[] | 'all'): View {
  const { bag, deck, ...rest } = s;
  return { ...JSON.parse(JSON.stringify(rest)), bagLeft: bag.length, deckLeft: deck.length, me: seats === 'all' ? [] : seats };
}
