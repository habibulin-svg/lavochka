/* Карты против человечества — движок. Карточный Царь по кругу открывает чёрную карту с вопросом или пропусками,
 * остальные тайно кладут белые (сколько просит карта), Царь видит ответы вперемешку и без имён и выбирает лучший — очко.
 * Добор до десяти. Домашние правила: азартные игры, Рандо Кардриссиан, перезапуск вселенной, «с запасом», счастливый конец,
 * «Бог умер» (без Царя — голосуют все). Пустые карты — свой ответ (когда за столом нет ботов). Без DOM. */
import type { Options, Rng } from '../../core/types';
import CARDS from './cards.json';

export const WHITE: string[] = CARDS.white;
export const BLACK: { t: string; pick: number; draw?: number }[] = CARDS.black;
/** Номера пустых карт — с этого и дальше. */
export const BLANK0 = 10000;
/** Место Рандо Кардриссиана в ответах и очках. */
export const RANDO = -1;
export const HAND = 10;
export const HAIKU = BLACK.findIndex((b) => b.t.startsWith('Сделайте хайку'));
export const GOALS = [5, 7, 10];
const BLANKS = 30;

export const isBlank = (id: number) => id >= BLANK0;

export type Phase = 'play' | 'judge' | 'reveal' | 'over';

/** Ответ: одна или несколько белых карт по порядку. texts — что вписано в пустые карты (по номеру в cards). */
export interface Sub {
  seat: number;
  cards: number[];
  texts?: Record<number, string>;
  /** Сыгран на залог очка (азартные игры). */
  bet?: boolean;
}

export interface House {
  gamble: boolean;
  rando: boolean;
  reboot: boolean;
  heat: boolean;
  happy: boolean;
  godless: boolean;
}

export interface RoundRec {
  round: number;
  czar: number | null;
  black: number;
  subs: Sub[];
  /** Номера выигравших ответов в subs (при голосовании бывает ничья). */
  win: number[];
  votes?: Record<number, number>;
  gain: Record<number, number>;
  final?: boolean;
}

export interface State {
  seats: number[];
  humans: number[];
  goal: number;
  house: House;
  round: number;
  czar: number | null;
  /** Чей был Царь в прошлом раунде — от него круг идёт дальше. */
  rot: number;
  black: number;
  deck: number[];
  discard: number[];
  bdeck: number[];
  bdiscard: number[];
  hands: Record<number, number[]>;
  scores: Record<number, number>;
  rando: number;
  trophies: Record<number, number[]>;
  subs: Sub[];
  votes: Record<number, number>;
  phase: Phase;
  ready: number[];
  history: RoundRec[];
  /** Последний раунд — хайку (счастливый конец). */
  final: boolean;
}

export type Action =
  | { type: 'play'; cards: number[]; texts?: Record<number, string>; bet?: number[]; betTexts?: Record<number, string> }
  | { type: 'reboot'; cards: number[] }
  | { type: 'pick'; index: number }
  | { type: 'vote'; index: number }
  | { type: 'next' };

export type Event =
  | { type: 'round'; round: number; czar: number | null; black: number; final: boolean; extra: number }
  | { type: 'played'; seat: number; bet: boolean }
  | { type: 'reboot'; seat: number; n: number }
  | { type: 'judge'; n: number }
  | { type: 'voted'; seat: number }
  | { type: 'win'; rec: RoundRec }
  | { type: 'over'; scores: Record<number, number>; rando: number | null };

/** Ответ, как его видит экран: автор — только свой (или всем, когда раунд открыт). */
export interface SubView {
  by?: number;
  cards: number[];
  texts?: Record<number, string>;
  bet?: boolean;
}

export interface View {
  seats: number[];
  humans: number[];
  goal: number;
  house: House;
  phase: Phase;
  round: number;
  czar: number | null;
  black: number;
  final: boolean;
  scores: Record<number, number>;
  rando: number | null;
  trophies: Record<number, number[]>;
  /** Руки мест, за которые смотрит экран. */
  hands: Record<number, number[]>;
  /** Кто уже положил карты (и кто проголосовал — в «Бог умер»). */
  played: number[];
  voted: number[];
  /** Свои положенные карты во время розыгрыша. */
  mine: Record<number, Sub[]>;
  /** Ответы: на суде — вперемешку и без имён, после — с именами. */
  subs: SubView[];
  win: number[];
  history: RoundRec[];
  deck: number;
  blanks: boolean;
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

function shuffle<T>(a: T[], rng: Rng): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function houseOf(o: Options): House {
  return {
    gamble: o.gamble !== false,
    rando: o.rando === true,
    reboot: o.reboot === true,
    heat: o.heat === true,
    happy: o.happy === true,
    godless: o.godless === true,
  };
}

/** humans — места людей; blanks — подмешать пустые карты (только когда ботов нет). */
export function setup(seats: number[], opts: Options, rng: Rng, humans: number[] = [], blanks = false): State {
  const house = houseOf(opts);
  const deck = shuffle([...WHITE.keys(), ...(blanks ? Array.from({ length: BLANKS }, (_, k) => BLANK0 + k) : [])], rng);
  const bdeck = shuffle(
    [...BLACK.keys()].filter((b) => !(house.happy && b === HAIKU)),
    rng,
  );
  const s: State = {
    seats: seats.slice(),
    humans: humans.filter((x) => seats.includes(x)),
    goal: Math.max(1, Number(opts.goal ?? 7) | 0),
    house,
    round: 0,
    czar: null,
    rot: seats[rng.int(seats.length)],
    black: 0,
    deck,
    discard: [],
    bdeck,
    bdiscard: [],
    hands: Object.fromEntries(seats.map((x) => [x, [] as number[]])),
    scores: Object.fromEntries(seats.map((x) => [x, 0])),
    rando: 0,
    trophies: Object.fromEntries(seats.map((x) => [x, [] as number[]])),
    subs: [],
    votes: {},
    phase: 'play',
    ready: [],
    history: [],
    final: false,
  };
  // первый Царь — «кто последним какал»: жребий; startRound сдвинет круг, поэтому отступаем на одно место
  s.rot = s.seats[(s.seats.indexOf(s.rot) - 1 + s.seats.length) % s.seats.length];
  startRound(s, rng);
  return s;
}

function drawWhite(s: State, rng: Rng, skipBlanks = false): number | null {
  for (let guard = 0; guard < 2; guard++) {
    const i = skipBlanks ? s.deck.findIndex((c) => !isBlank(c)) : s.deck.length ? 0 : -1;
    if (i >= 0) return s.deck.splice(i, 1)[0];
    if (!s.discard.length) return null;
    s.deck.push(...shuffle(s.discard.splice(0), rng));
  }
  return null;
}

function refill(s: State, seat: number, rng: Rng, upto = HAND) {
  const hand = s.hands[seat];
  while (hand.length < upto) {
    const c = drawWhite(s, rng);
    if (c == null) break;
    hand.push(c);
  }
}

/** Кто кладёт карты в этом раунде. */
export const players = (s: Pick<State, 'seats' | 'czar'>) => s.seats.filter((x) => x !== s.czar);

function startRound(s: State, rng: Rng, final = false): Event {
  s.round++;
  s.final = final;
  s.rot = s.seats[(s.seats.indexOf(s.rot) + 1) % s.seats.length];
  s.czar = s.house.godless ? null : s.rot;
  if (final) s.black = HAIKU;
  else {
    if (!s.bdeck.length) s.bdeck = shuffle(s.bdiscard.splice(0), rng);
    s.black = s.bdeck.shift()!;
  }
  s.subs = [];
  s.votes = {};
  s.ready = [];
  s.phase = 'play';
  for (const x of s.seats) refill(s, x, rng);
  // «Возьми 2» на картах «Сыграй 3»; «с запасом» — ещё карту на «Сыграй 2»
  const b = BLACK[s.black];
  const extra = (b.draw ?? 0) + (s.house.heat && b.pick === 2 ? 1 : 0);
  if (extra) for (const x of players(s)) refill(s, x, rng, s.hands[x].length + extra);
  return { type: 'round', round: s.round, czar: s.czar, black: s.black, final, extra };
}

export const pickOf = (s: Pick<State, 'black'>) => BLACK[s.black].pick;

export function toAct(s: State): number[] {
  switch (s.phase) {
    case 'play':
      return players(s).filter((x) => !s.subs.some((u) => u.seat === x));
    case 'judge':
      return s.house.godless ? s.seats.filter((x) => !(x in s.votes)) : [s.czar!];
    case 'reveal': {
      const wait = s.humans.filter((x) => !s.ready.includes(x));
      return s.humans.length ? wait : s.ready.includes(s.seats[0]) ? [] : [s.seats[0]];
    }
    default:
      return [];
  }
}

/** Проверить набор карт из руки: столько, сколько просит чёрная, без повторов. */
function takeCards(hand: number[], cards: unknown, n: number): number[] | null {
  if (!Array.isArray(cards) || cards.length !== n) return null;
  const out: number[] = [];
  for (const c of cards) {
    if (!Number.isInteger(c) || !hand.includes(c) || out.includes(c)) return null;
    out.push(c);
  }
  return out;
}

function blankTexts(cards: number[], texts: unknown): Record<number, string> | null | undefined {
  const blanks = cards.filter(isBlank);
  if (!blanks.length) return undefined;
  const t = (texts && typeof texts === 'object' ? texts : {}) as Record<string, unknown>;
  const out: Record<number, string> = {};
  for (const c of blanks) {
    const v = String(t[c] ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 90);
    if (!v) return null;
    out[c] = v;
  }
  return out;
}

function closePlay(s: State, rng: Rng, ev: Event[]) {
  if (s.house.rando) {
    const cards: number[] = [];
    for (let k = 0; k < pickOf(s); k++) {
      const c = drawWhite(s, rng, true);
      if (c != null) cards.push(c);
    }
    if (cards.length === pickOf(s)) s.subs.push({ seat: RANDO, cards });
  }
  shuffle(s.subs, rng);
  s.phase = 'judge';
  ev.push({ type: 'judge', n: s.subs.length });
}

function settle(s: State, win: number[], ev: Event[]) {
  const gain: Record<number, number> = {};
  const add = (x: number, d: number) => (gain[x] = (gain[x] ?? 0) + d);
  const winners = [...new Set(win.map((i) => s.subs[i].seat))];
  for (const x of winners) add(x, 1);
  // азартные игры: кто ставил очко и не выиграл — отдаёт его победителю (при ничьей — первому)
  if (s.house.gamble) {
    const betters = [...new Set(s.subs.filter((u) => u.bet).map((u) => u.seat))];
    for (const x of betters) {
      if (winners.includes(x)) continue;
      add(x, -1);
      add(winners[0], 1);
    }
  }
  for (const [k, d] of Object.entries(gain)) {
    const x = +k;
    if (x === RANDO) s.rando += d;
    else s.scores[x] = Math.max(0, (s.scores[x] ?? 0) + d);
  }
  for (const x of winners) if (x !== RANDO) s.trophies[x].push(s.black);
  const rec: RoundRec = { round: s.round, czar: s.czar, black: s.black, subs: clone(s.subs), win, gain, ...(s.house.godless ? { votes: { ...s.votes } } : {}), ...(s.final ? { final: true } : {}) };
  s.history.push(rec);
  s.phase = 'reveal';
  s.ready = [];
  ev.push({ type: 'win', rec });
}

const top = (s: State) => Math.max(...s.seats.map((x) => s.scores[x] ?? 0), s.house.rando ? s.rando : 0);

function nextRound(s: State, rng: Rng, ev: Event[]) {
  for (const u of s.subs) s.discard.push(...u.cards);
  s.bdiscard.push(s.black);
  const done = s.final || top(s) >= s.goal;
  if (done && !(s.house.happy && !s.final && HAIKU >= 0)) {
    s.phase = 'over';
    s.subs = [];
    ev.push({ type: 'over', scores: { ...s.scores }, rando: s.house.rando ? s.rando : null });
    return;
  }
  ev.push(startRound(s, rng, done));
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (!a || typeof a !== 'object' || !s0.seats.includes(seat)) return null;
  const s = clone(s0);
  const ev: Event[] = [];
  switch (a.type) {
    case 'play': {
      if (s.phase !== 'play' || !players(s).includes(seat) || s.subs.some((u) => u.seat === seat)) return null;
      const hand = s.hands[seat];
      const n = pickOf(s);
      const cards = takeCards(hand, a.cards, n);
      if (!cards) return null;
      const texts = blankTexts(cards, a.texts);
      if (texts === null) return null;
      let bet: number[] | null = null;
      let betTexts: Record<number, string> | undefined;
      if (a.bet != null) {
        if (!s.house.gamble || (s.scores[seat] ?? 0) < 1) return null;
        bet = takeCards(
          hand.filter((c) => !cards.includes(c)),
          a.bet,
          n,
        );
        if (!bet) return null;
        const bt = blankTexts(bet, a.betTexts);
        if (bt === null) return null;
        betTexts = bt;
      }
      s.hands[seat] = hand.filter((c) => !cards.includes(c) && !bet?.includes(c));
      s.subs.push({ seat, cards, ...(texts ? { texts } : {}) });
      if (bet) s.subs.push({ seat, cards: bet, bet: true, ...(betTexts ? { texts: betTexts } : {}) });
      if (bet) s.subs[s.subs.length - 2].bet = true;
      ev.push({ type: 'played', seat, bet: !!bet });
      if (!toAct(s).length) closePlay(s, rng, ev);
      break;
    }
    case 'reboot': {
      if (s.phase !== 'play' || !s.house.reboot || !toAct(s).includes(seat) || (s.scores[seat] ?? 0) < 1) return null;
      const hand = s.hands[seat];
      if (!Array.isArray(a.cards) || !a.cards.length) return null;
      const out = [...new Set(a.cards)];
      if (!out.every((c) => Number.isInteger(c) && hand.includes(c))) return null;
      s.scores[seat]--;
      s.trophies[seat].pop();
      s.hands[seat] = hand.filter((c) => !out.includes(c));
      s.discard.push(...out);
      refill(s, seat, rng, Math.max(HAND, hand.length));
      ev.push({ type: 'reboot', seat, n: out.length });
      break;
    }
    case 'pick': {
      if (s.phase !== 'judge' || s.house.godless || seat !== s.czar) return null;
      if (!Number.isInteger(a.index) || a.index < 0 || a.index >= s.subs.length) return null;
      settle(s, [a.index], ev);
      break;
    }
    case 'vote': {
      if (s.phase !== 'judge' || !s.house.godless || seat in s.votes) return null;
      if (!Number.isInteger(a.index) || a.index < 0 || a.index >= s.subs.length) return null;
      // за свой ответ нельзя (если есть за кого ещё)
      if (s.subs[a.index].seat === seat && s.subs.some((u) => u.seat !== seat)) return null;
      s.votes[seat] = a.index;
      ev.push({ type: 'voted', seat });
      if (!toAct(s).length) {
        const count = s.subs.map((_, i) => Object.values(s.votes).filter((v) => v === i).length);
        const best = Math.max(...count);
        settle(
          s,
          count.flatMap((c, i) => (c === best ? [i] : [])),
          ev,
        );
      }
      break;
    }
    case 'next': {
      if (s.phase !== 'reveal' || !toAct(s).includes(seat)) return null;
      s.ready.push(seat);
      if (toAct(s).length) break;
      nextRound(s, rng, ev);
      break;
    }
    default:
      return null;
  }
  return { state: s, events: ev };
}

export function makeView(s: State, seats: number[] | 'all'): View {
  const sees = (x: number) => seats === 'all' || seats.includes(x);
  const hands: Record<number, number[]> = {};
  const mine: Record<number, Sub[]> = {};
  for (const x of s.seats) {
    if (!sees(x)) continue;
    hands[x] = s.hands[x];
    if (s.phase === 'play') mine[x] = s.subs.filter((u) => u.seat === x);
  }
  const open = s.phase === 'reveal' || s.phase === 'over';
  const subs: SubView[] =
    s.phase === 'play'
      ? []
      : s.subs.map((u) => ({
          ...(open || (u.seat !== RANDO && seats !== 'all' && sees(u.seat)) ? { by: u.seat } : {}),
          cards: u.cards,
          ...(u.texts ? { texts: u.texts } : {}),
          ...(open && u.bet ? { bet: true } : {}),
        }));
  const last = s.history[s.history.length - 1];
  return {
    seats: s.seats,
    humans: s.humans,
    goal: s.goal,
    house: s.house,
    phase: s.phase,
    round: s.round,
    czar: s.czar,
    black: s.black,
    final: s.final,
    scores: s.scores,
    rando: s.house.rando ? s.rando : null,
    trophies: s.trophies,
    hands,
    played: [...new Set(s.subs.map((u) => u.seat).filter((x) => x !== RANDO))],
    voted: Object.keys(s.votes).map(Number),
    mine,
    subs,
    win: s.phase === 'reveal' && last ? last.win : [],
    history: s.history,
    deck: s.deck.length,
    blanks: s.deck.some(isBlank) || s.discard.some(isBlank) || s.seats.some((x) => s.hands[x].some(isBlank)),
  };
}

/** Текст белой карты (пустая — что в неё вписали). */
export function whiteText(id: number, texts?: Record<number, string>): string {
  if (isBlank(id)) return texts?.[id] ?? '';
  return WHITE[id] ?? '';
}

/** Чёрная карта с ответами: пропуски заполнены, на вопрос — ответ после. Части: [текст, вставка, текст…]. */
export function fillParts(black: number, answers: string[]): { t: string; a?: boolean }[] {
  const b = BLACK[black];
  const clean = (x: string) => x.replace(/[.!]+$/, '');
  const parts = b.t.split('_');
  const out: { t: string; a?: boolean }[] = [];
  if (parts.length === 1) {
    out.push({ t: b.t + ' ' });
    answers.forEach((a, i) => out.push({ t: (i ? ' ' : '') + a, a: true }));
    return out;
  }
  parts.forEach((p, i) => {
    if (p) out.push({ t: p });
    if (i < parts.length - 1) out.push({ t: clean(answers[i] ?? '…'), a: true });
  });
  // ответов больше, чем пропусков (хайку) — дописать в конце
  for (let i = parts.length - 1; i < answers.length; i++) out.push({ t: ' ' + answers[i], a: true });
  return out;
}

export const blackText = (b: number) => BLACK[b]?.t ?? '';
