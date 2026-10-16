/* Крокодил — движок. Показывающий без слов и звуков показывает слово (пословицу, фильм) жестами, остальные угадывают.
 * Угадал — очко угадавшему (и, по настройке, показывающему); по классике угадавший показывает следующим, можно и по кругу.
 * Командами — показывают своей команде, слово загадывают соперники. Слово — случайно из словаря или его загадывает
 * предыдущий показывающий (выбор из трёх или своё). Время на слово — 1/2/3 минуты или без времени; пропуск — по настройке.
 *
 * Как узнаётся «угадал»: догадку пишут в поле (верное написание засчитывается само, другая форма — с подтверждения показывающего)
 * или говорят вслух — тогда показывающий отмечает угадавшего кнопкой. Боты жестов не видят и не показывают: у них карточки
 * (words.ts) — что показал бы мим, от общего к точному; человек, показывая ботам, выбирает карточки из набора.
 * «Эмодзи-крокодил» — показывают все одними эмодзи из набора, тут бот играет на равных.
 *
 * Время. Если играет человек, часы идут по-настоящему: «время вышло» присылает его экран. Если показывает бот и угадывают
 * одни боты, время условное: каждое их действие говорит, сколько оно «заняло» (dt). Без DOM. */
import type { Options, Rng } from '../../core/types';
import {
  deckFor, isEmoji, itemKey, itemText, judge, poolOf,
  type Card, type Item, type Kind, type Theme,
} from './words';

export type Phase = 'pick' | 'ready' | 'show' | 'reveal' | 'over';
/** Чем кончилось слово: угадали, показывающий сдался, время вышло. */
export type Res = 'got' | 'giveup' | 'timeup';
export type Style = 'gesture' | 'emoji';
export type Nod = 'yes' | 'no' | 'close';

export interface Try {
  id: number;
  seat: number;
  text: string;
  res: 'right' | 'near' | 'no';
  nod?: Nod;
}
export interface Last {
  w: string;
  kind: Kind;
  by: number | null;
  res: Res;
  shower: number;
  skipped: string[];
}
export interface TurnLog {
  t: number;
  shower: number;
  by: number | null;
  w: string;
}

export interface State {
  gid: number;
  seats: number[];
  humans: number[];
  teams: number[][] | null;
  style: Style;
  theme: Theme;
  level: string;
  source: 'dict' | 'pick';
  /** Время на слово, мс; 0 — без времени. */
  time: number;
  skip: 'free' | 'one' | 'off';
  score: 'both' | 'guesser';
  order: 'guesser' | 'circle';
  nod: boolean;
  /** Всего ходов в партии. */
  turns: number;
  phase: Phase;
  t: number;
  shower: number;
  picker: number | null;
  offers: Item[] | null;
  item: Item | null;
  /** Номер показанного слова с начала игры. */
  seq: number;
  cards: Card[];
  /** Какие карточки колоды уже показаны (номера). */
  dealt: number[];
  tries: Try[];
  tryId: number;
  skips: number;
  skipped: string[];
  virt: boolean;
  used: number;
  need: 'card' | 'guess';
  /** Боты-угадывающие, уже ответившие на последнюю карточку. */
  answered: number[];
  pts: Record<number, number>;
  shown: Record<number, number>;
  last: Last | null;
  log: TurnLog[];
  usedItems: string[];
}

export type Action =
  | { type: 'offer'; k: number }
  | { type: 'own'; text: string }
  | { type: 'start' }
  | { type: 'card'; n?: number; dt?: number }
  | { type: 'emo'; list: string[] }
  | { type: 'guess'; text: string; dt?: number }
  | { type: 'pass'; dt?: number }
  | { type: 'accept'; id: number }
  | { type: 'got'; by: number }
  | { type: 'nod'; id: number; val: Nod }
  | { type: 'skip'; dt?: number }
  | { type: 'giveup' }
  | { type: 'stall' }
  | { type: 'timeup' }
  | { type: 'next' };

export type Event =
  | { type: 'turn'; t: number; shower: number; picker: number | null }
  | { type: 'picked'; picker: number; shower: number; own: boolean }
  | { type: 'start'; shower: number }
  | { type: 'draw'; seq: number; shower: number; kind: Kind; w: string | null }
  | { type: 'card'; seat: number; card: Card }
  | { type: 'guess'; seat: number; text: string; res: Try['res']; id: number }
  | { type: 'nod'; id: number; seat: number; val: Nod }
  | { type: 'skip'; shower: number; w: string }
  | { type: 'done'; res: Res; by: number | null; shower: number; w: string }
  | { type: 'over' };

export interface View {
  gid: number;
  seats: number[];
  humans: number[];
  teams: number[][] | null;
  style: Style;
  theme: Theme;
  source: State['source'];
  time: number;
  skip: State['skip'];
  score: State['score'];
  order: State['order'];
  nod: boolean;
  turns: number;
  phase: Phase;
  t: number;
  shower: number;
  picker: number | null;
  eligible: number[];
  /** Что показывают (слово, пословица, фильм) — видно всем. */
  kind: Kind | null;
  /** Слово — показывающему (и загадавшему). */
  word: string | null;
  /** Загадывающему: из чего выбрать; canOwn — можно написать своё. */
  offers: string[] | null;
  canOwn: boolean;
  /** Показывающему: карточки для ботов, used — уже показана. */
  deck: { card: Card; used: boolean }[] | null;
  cards: Card[];
  tries: Try[];
  seq: number;
  skips: number;
  skipped: string[];
  virt: boolean;
  used: number;
  need: State['need'];
  answered: number[];
  pts: Record<number, number>;
  shown: Record<number, number>;
  last: Last | null;
  log: TurnLog[];
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const isBot = (s: Pick<State, 'humans'>, x: number) => !s.humans.includes(x);

/** Две команды: через одного по кругу (сидят вперемешку). */
export const teamsOf = (seats: number[]): number[][] => [seats.filter((_, k) => k % 2 === 0), seats.filter((_, k) => k % 2 === 1)];

/** Кто угадывает: все, кроме показывающего и загадавшего; командами — своя команда. */
export function eligible(s: Pick<State, 'seats' | 'teams' | 'shower' | 'picker'>): number[] {
  if (s.teams) return (s.teams.find((t) => t.includes(s.shower)) ?? []).filter((x) => x !== s.shower);
  return s.seats.filter((x) => x !== s.shower && x !== s.picker);
}

/** Показывающий хода t: командами — по очереди команды, внутри команды по кругу; иначе по кругу. */
function showerOf(s: State, t: number): number {
  if (s.teams) {
    const team = s.teams[t % s.teams.length];
    return team[Math.floor(t / s.teams.length) % team.length];
  }
  return s.seats[t % s.seats.length];
}
/** Загадывающий: предыдущий показывающий (в начале — сосед справа); командами — соперник по очереди. */
function pickerOf(s: State, t: number, prev: number | null): number | null {
  if (s.source !== 'pick') return null;
  if (s.teams) {
    const other = s.teams[(t + 1) % s.teams.length];
    return other[Math.floor(t / s.teams.length) % other.length];
  }
  if (prev != null && prev !== s.shower) return prev;
  const i = s.seats.indexOf(s.shower);
  return s.seats[(i - 1 + s.seats.length) % s.seats.length];
}

export function setup(seats: number[], opts: Options, rng: Rng, humans: number[] = []): State {
  const n = seats.length;
  const style: Style = opts.style === 'emoji' ? 'emoji' : 'gesture';
  const teams = opts.mode === 'teams' && n >= 4 ? teamsOf(seats) : null;
  const theme = (['words', 'proverbs', 'films', 'mix'].includes(String(opts.theme)) ? opts.theme : 'words') as Theme;
  const rounds = Math.max(1, Math.min(10, Number(opts.rounds) || 2));
  const s: State = {
    gid: rng.int(1e9),
    seats: seats.slice(),
    humans: humans.filter((x) => seats.includes(x)),
    teams,
    style,
    theme: style === 'emoji' ? 'words' : theme,
    level: String(opts.level ?? 'mid'),
    // загадывать некому, если угадывающий один
    source: opts.source === 'pick' && (teams || n >= 3) ? 'pick' : 'dict',
    time: Math.max(0, Number(opts.time ?? 120)) * 1000,
    skip: opts.skip === 'one' ? 'one' : opts.skip === 'off' ? 'off' : 'free',
    score: opts.score === 'guesser' ? 'guesser' : 'both',
    order: teams ? 'circle' : opts.order === 'circle' ? 'circle' : 'guesser',
    nod: opts.nod !== false,
    turns: teams ? rounds * teams.length * Math.max(...teams.map((t) => t.length)) : rounds * n,
    phase: 'ready',
    t: 0,
    shower: seats[0],
    picker: null,
    offers: null,
    item: null,
    seq: 0,
    cards: [],
    dealt: [],
    tries: [],
    tryId: 0,
    skips: 0,
    skipped: [],
    virt: false,
    used: 0,
    need: 'card',
    answered: [],
    pts: Object.fromEntries(seats.map((x) => [x, 0])),
    shown: Object.fromEntries(seats.map((x) => [x, 0])),
    last: null,
    log: [],
    usedItems: [],
  };
  s.shower = showerOf(s, 0);
  beginTurn(s, null, rng, []);
  return s;
}

/** Своё слово можно, когда показывает человек и угадывают одни люди (ботам нечем его понять). */
const ownAllowed = (s: State) => !isBot(s, s.shower) && eligible(s).every((x) => !isBot(s, x));

/** Новый предмет из темы (не повторяясь); mix — половина слов, остальное фразы. */
function drawItem(s: State, rng: Rng, avoid: string[] = []): Item | null {
  const pool = poolOf(s.theme, s.level, s.style);
  const groups = [pool.w, pool.p, pool.f].map((g) => g.filter((it) => !s.usedItems.includes(itemKey(it)) && !avoid.includes(itemKey(it))));
  const weights = [2, 1, 1].map((w, k) => (groups[k].length ? w : 0));
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum) return null;
  let r = rng.next() * sum;
  let g = 0;
  while (r >= weights[g]) r -= weights[g++];
  return groups[g][rng.int(groups[g].length)];
}

function beginTurn(s: State, prev: number | null, rng: Rng, ev: Event[]) {
  s.picker = pickerOf(s, s.t, prev);
  s.item = null;
  s.offers = null;
  s.cards = [];
  s.dealt = [];
  s.tries = [];
  s.skips = 0;
  s.skipped = [];
  s.answered = [];
  s.used = 0;
  s.need = 'card';
  s.virt = isBot(s, s.shower) && eligible(s).every((x) => isBot(s, x));
  if (s.picker != null) {
    const offers: Item[] = [];
    for (let k = 0; k < 3; k++) {
      const it = drawItem(s, rng, offers.map(itemKey));
      if (it) offers.push(it);
    }
    s.offers = offers;
    s.phase = offers.length ? 'pick' : 'ready';
  } else s.phase = 'ready';
  ev.push({ type: 'turn', t: s.t, shower: s.shower, picker: s.phase === 'pick' ? s.picker : null });
}

function setWord(s: State, it: Item, ev: Event[]) {
  s.item = it;
  s.usedItems.push(itemKey(it));
  s.seq++;
  s.cards = [];
  s.dealt = [];
  s.tries = [];
  s.answered = [];
  s.need = 'card';
  ev.push({ type: 'draw', seq: s.seq, shower: s.shower, kind: it.k, w: itemText(it) });
}

export function toAct(s: State): number[] {
  switch (s.phase) {
    case 'pick':
      return s.picker != null ? [s.picker] : [];
    case 'ready':
      return [s.shower];
    case 'show': {
      const el = eligible(s);
      if (s.virt) {
        if (s.need === 'card') return [s.shower];
        const next = el.find((x) => !s.answered.includes(x));
        return next != null ? [next] : [s.shower];
      }
      const out = [s.shower, ...el].filter((x) => !isBot(s, x));
      // боты по очереди: сначала угадывающие (по разу на карточку), потом показывающий
      if (s.cards.length) out.push(...el.filter((x) => isBot(s, x) && !s.answered.includes(x)));
      if (isBot(s, s.shower)) out.push(s.shower);
      return out;
    }
    case 'reveal': {
      const hs = s.seats.filter((x) => !isBot(s, x));
      // бот показывал — сам переходит дальше (люди могут раньше)
      return isBot(s, s.shower) || !hs.length ? [...hs, s.shower] : hs;
    }
    default:
      return [];
  }
}

function finish(s: State, res: Res, by: number | null, ev: Event[]) {
  const it = s.item!;
  const w = itemText(it);
  s.last = { w, kind: it.k, by, res, shower: s.shower, skipped: s.skipped.slice() };
  s.log.push({ t: s.t, shower: s.shower, by, w });
  s.phase = 'reveal';
  s.need = 'card';
  ev.push({ type: 'done', res, by, shower: s.shower, w });
}

function score(s: State, by: number, ev: Event[]) {
  s.pts[by] = (s.pts[by] ?? 0) + 1;
  s.shown[s.shower] = (s.shown[s.shower] ?? 0) + 1;
  finish(s, 'got', by, ev);
}

/** Условное время (показывает бот ботам): действие заняло dt; не уложились — время вышло. */
function spend(s: State, dt: unknown, share: number, ev: Event[]): boolean {
  if (!s.virt || !s.time) return true;
  const d = Math.max(200, Math.min(30000, Number(dt) || 1000)) * share;
  if (s.used + d > s.time) {
    s.used = s.time;
    finish(s, 'timeup', null, ev);
    return false;
  }
  s.used += d;
  return true;
}

/** Все боты-угадывающие ответили на карточку — показывающий показывает дальше. */
function allAnswered(s: State) {
  if (eligible(s).every((x) => !isBot(s, x) || s.answered.includes(x))) s.need = 'card';
}

const clean = (w: unknown, max = 60) =>
  String(w ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (!a || typeof a !== 'object') return null;
  const s = clone(s0);
  const ev: Event[] = [];
  const showing = s.phase === 'show' && s.item != null;
  switch (a.type) {
    case 'offer': {
      if (s.phase !== 'pick' || seat !== s.picker || !s.offers) return null;
      const it = s.offers[Number(a.k)];
      if (!it) return null;
      s.item = it;
      s.offers = null;
      s.phase = 'ready';
      ev.push({ type: 'picked', picker: seat, shower: s.shower, own: false });
      break;
    }
    case 'own': {
      if (s.phase !== 'pick' || seat !== s.picker || isBot(s, seat) || !ownAllowed(s)) return null;
      const text = clean(a.text, 50);
      if (!/[а-яёa-z]/i.test(text)) return null;
      s.item = { k: 'o', i: -1, text };
      s.offers = null;
      s.phase = 'ready';
      ev.push({ type: 'picked', picker: seat, shower: s.shower, own: true });
      break;
    }
    case 'start': {
      if (s.phase !== 'ready' || seat !== s.shower) return null;
      s.phase = 'show';
      s.used = 0;
      ev.push({ type: 'start', shower: s.shower });
      const it = s.item ?? drawItem(s, rng);
      if (!it) {
        s.phase = 'over';
        ev.push({ type: 'over' });
        break;
      }
      setWord(s, it, ev);
      break;
    }
    case 'card': {
      if (!showing || seat !== s.shower) return null;
      if (s.virt && s.need !== 'card') return null;
      // карточки нужны, если угадывает бот, — человеку хватает жестов (но и ему можно показать)
      const deck = deckFor(s.item!, s.style);
      const n = a.n == null ? deck.findIndex((_, k) => !s.dealt.includes(k)) : Number(a.n);
      if (!deck[n] || s.dealt.includes(n)) return null;
      if (!spend(s, a.dt, 1, ev)) break;
      s.dealt.push(n);
      s.cards.push(deck[n]);
      s.answered = [];
      s.need = 'guess';
      ev.push({ type: 'card', seat, card: deck[n] });
      break;
    }
    case 'emo': {
      if (!showing || seat !== s.shower || s.style !== 'emoji' || isBot(s, seat) || !Array.isArray(a.list)) return null;
      const es = a.list.slice(0, 8).map(String).filter(isEmoji);
      if (!es.length) return null;
      const card: Card = { k: 'emo', es };
      s.cards.push(card);
      s.answered = [];
      s.need = 'guess';
      ev.push({ type: 'card', seat, card });
      break;
    }
    case 'guess': {
      if (!showing || seat === s.shower || !eligible(s).includes(seat)) return null;
      if (s.virt && (s.need !== 'guess' || toAct(s)[0] !== seat)) return null;
      const text = clean(a.text);
      if (!text) return null;
      const el = eligible(s).length;
      if (!spend(s, a.dt, 1 / Math.max(1, el), ev)) break;
      const res = judge(text, s.item!);
      const id = ++s.tryId;
      s.tries.push({ id, seat, text, res });
      if (s.tries.length > 40) s.tries.shift();
      ev.push({ type: 'guess', seat, text, res, id });
      if (isBot(s, seat) && !s.answered.includes(seat)) s.answered.push(seat);
      // другую форму слова бот-показывающий засчитывает сам, человек — подтверждает
      if (res === 'right' || (res === 'near' && isBot(s, s.shower))) score(s, seat, ev);
      else allAnswered(s);
      break;
    }
    case 'pass': {
      if (!showing || !isBot(s, seat) || !eligible(s).includes(seat) || s.answered.includes(seat)) return null;
      if (s.virt && (s.need !== 'guess' || toAct(s)[0] !== seat)) return null;
      if (!spend(s, a.dt, 1 / Math.max(1, eligible(s).length), ev)) break;
      s.answered.push(seat);
      allAnswered(s);
      break;
    }
    case 'accept': {
      if (!showing || seat !== s.shower || isBot(s, seat)) return null;
      const tr = s.tries.find((x) => x.id === Number(a.id));
      if (!tr || !eligible(s).includes(tr.seat)) return null;
      score(s, tr.seat, ev);
      break;
    }
    case 'got': {
      // угадали вслух: показывающий отмечает кто (за ботов — только письменно)
      if (!showing || seat !== s.shower || isBot(s, seat)) return null;
      const by = Number(a.by);
      if (!eligible(s).includes(by) || isBot(s, by)) return null;
      score(s, by, ev);
      break;
    }
    case 'nod': {
      if (!showing || !s.nod || seat !== s.shower || !['yes', 'no', 'close'].includes(a.val)) return null;
      const tr = s.tries.find((x) => x.id === Number(a.id));
      if (!tr || tr.res === 'right' || tr.nod) return null;
      tr.nod = a.val;
      ev.push({ type: 'nod', id: tr.id, seat, val: a.val });
      break;
    }
    case 'skip': {
      if (!showing || seat !== s.shower || s.skip === 'off' || (s.skip === 'one' && s.skips >= 1)) return null;
      if (s.virt && s.need !== 'card') return null;
      if (!spend(s, a.dt, 1, ev)) break;
      const w = itemText(s.item!);
      s.skips++;
      s.skipped.push(w);
      ev.push({ type: 'skip', shower: seat, w });
      const it = drawItem(s, rng);
      if (!it) finish(s, 'giveup', null, ev);
      else setWord(s, it, ev);
      break;
    }
    case 'giveup': {
      if (!showing || seat !== s.shower) return null;
      finish(s, 'giveup', null, ev);
      break;
    }
    case 'stall': {
      if (!showing || !s.virt || seat !== s.shower || s.need !== 'card') return null;
      if (s.time) s.used = s.time;
      finish(s, s.time ? 'timeup' : 'giveup', null, ev);
      break;
    }
    case 'timeup': {
      // присылает экран человека (местные часы); бот-показывающий — по своим часам с запасом
      if (!showing || s.virt || !s.time || !s.seats.includes(seat)) return null;
      if (isBot(s, seat) && seat !== s.shower) return null;
      finish(s, 'timeup', null, ev);
      break;
    }
    case 'next': {
      if (s.phase !== 'reveal' || !toAct(s).includes(seat)) return null;
      const prev = s.shower;
      const by = s.last?.by ?? null;
      s.t++;
      if (s.t >= s.turns) {
        s.phase = 'over';
        ev.push({ type: 'over' });
        break;
      }
      if (!s.teams && s.order === 'guesser') {
        if (by != null) s.shower = by;
        else s.shower = s.seats[(s.seats.indexOf(prev) + 1) % s.seats.length];
      } else s.shower = showerOf(s, s.t);
      beginTurn(s, prev, rng, ev);
      break;
    }
    default:
      return null;
  }
  return { state: s, events: ev };
}

export function makeView(s: State, seats: number[] | 'all'): View {
  const all = seats === 'all';
  const me = (x: number | null) => x != null && (all || seats.includes(x));
  const isShower = me(s.shower);
  // слово видит показывающий, пока показывает; загадавший — своё (пока его не сменили пропуском)
  const pickerKnows = me(s.picker) && s.skips === 0 && (s.phase === 'ready' || s.phase === 'show');
  const word = s.item && ((s.phase === 'show' && isShower) || pickerKnows) ? itemText(s.item) : null;
  return {
    gid: s.gid,
    seats: s.seats,
    humans: s.humans,
    teams: s.teams,
    style: s.style,
    theme: s.theme,
    source: s.source,
    time: s.time,
    skip: s.skip,
    score: s.score,
    order: s.order,
    nod: s.nod,
    turns: s.turns,
    phase: s.phase,
    t: s.t,
    shower: s.shower,
    picker: s.picker,
    eligible: eligible(s),
    kind: s.phase === 'show' && s.item ? s.item.k : null,
    word,
    offers: s.phase === 'pick' && me(s.picker) && s.offers ? s.offers.map(itemText) : null,
    canOwn: s.phase === 'pick' && me(s.picker) && ownAllowed(s),
    deck: s.phase === 'show' && isShower && s.item ? deckFor(s.item, s.style).map((card, k) => ({ card, used: s.dealt.includes(k) })) : null,
    cards: s.cards,
    tries: s.tries,
    seq: s.seq,
    skips: s.skips,
    skipped: s.skipped,
    virt: s.virt,
    used: s.used,
    need: s.need,
    answered: s.answered,
    pts: s.pts,
    shown: s.shown,
    last: s.phase === 'reveal' || s.phase === 'over' ? s.last : null,
    log: s.log,
  };
}

/** Слово видит показывающий (и загадавший). */
export function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all') return ev;
  if (ev.type === 'draw') return seats.includes(ev.shower) ? ev : { ...ev, w: null };
  return ev;
}

/** Очки игрока: угадал (+ показал, если по настройке очко и показывающему). */
export const total = (v: Pick<View, 'pts' | 'shown' | 'score'>, x: number) => (v.pts[x] ?? 0) + (v.score === 'both' ? (v.shown[x] ?? 0) : 0);
/** Очки команды — угаданные ею слова. */
export const teamScore = (v: Pick<View, 'shown'>, team: number[]) => team.reduce((a, x) => a + (v.shown[x] ?? 0), 0);

