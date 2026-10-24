/* Ханафуда — правила (без DOM): японский коикои вдвоём и корейский го-стоп (вдвоём — матго, втроём).
 *
 * Общий ход: карту с руки кладут на стол; если на столе есть карта того же месяца — сыгранная её «накрывает»
 * (две такие — игрок выбирает, какую; три — забирает все четыре). Потом игрок сам открывает верхнюю карту колоды,
 * и она разыгрывается так же. Взятое лежит перед игроком открыто, по видам.
 *
 * Коикои: по 8 на руку и 8 на стол. Собрал новую комбинацию (яку) — «коикои» (играть дальше, рискуя) или «стоп»
 * (забрать очки кона). Кончились руки, а никто не остановился, — кон без очков, сдающий (оя) остаётся.
 * Очки ×2 за 7 и больше; ×2, если соперник до этого сказал «коикои». На раздаче: четыре одного месяца на руке (тэси)
 * или четыре пары (куттуки) — сразу 6 очков; четыре одного месяца на столе — пересдача.
 *
 * Го-стоп: вдвоём по 10 и 8 на стол, втроём по 7 и 6. Сыгранная и открытая карта решаются вместе:
 * открылась того же месяца, что сыгранная, — на пустое место: «чок» (забрал обе); на одну карту: «ппок» (все три
 * остаются на столе, «застряли»); на две: «ттадак» (забрал все четыре). Забрал застрявший ппок, чок, ттадак, смёл стол
 * («ссыль») — каждый соперник отдаёт по одной пустой (пи). Набрал 7 очков вдвоём (3 втроём) и больше, чем при прошлом
 * «го», — «го» (дальше: +1, +2, с третьего — удвоение) или «стоп». Три одного месяца на руке — можно «трясти» (×2);
 * если четвёртая на столе — «бомба»: выкладываешь все три, забираешь четыре, ×2, и два хода потом только открываешь колоду.
 * Штрафы проигравшему: пи-бак, кван-бак, мён-бак, го-бак — ×2. Никто не взял очков — «нагари», следующий кон ×2. */
import type { Options, Rng } from '../../core/types';
import { shuffle } from '../../core/rng';
import { DECK, info, monthOf } from './cards';
import { goTally, koiYaku, piValue, total, type YakuLine } from './yaku';

export type Mode = 'koikoi' | 'gostop';

export interface Cfg {
  mode: Mode;
  /** Сколько конов (месяцев). */
  months: number;
  /** Коикои: 7 и больше — ×2. */
  double7: boolean;
  /** Коикои: соперник сказал «коикои», а очки взял ты — ×2. */
  koiDouble: boolean;
  /** Коикои: ханами и цукими. */
  viewing: boolean;
  /** Коикои: чашка сакэ — ещё и пустая. */
  sakeKasu: boolean;
  /** Коикои: тэси и куттуки на раздаче. */
  handYaku: boolean;
  /** Го-стоп: нагари удваивает следующий кон. */
  nagari: boolean;
}

export function cfgFrom(o: Options): Cfg {
  const mode: Mode = o.mode === 'gostop' ? 'gostop' : 'koikoi';
  return {
    mode,
    months: [1, 3, 6, 10, 12].includes(Number(o.months)) ? Number(o.months) : mode === 'koikoi' ? 12 : 10,
    double7: o.double7 !== false,
    koiDouble: o.koiDouble !== false,
    viewing: o.viewing !== false,
    sakeKasu: o.sakeKasu !== false,
    handYaku: o.handYaku !== false,
    nagari: o.nagari !== false,
  };
}

export const handSize = (cfg: Cfg, n: number) => (cfg.mode === 'koikoi' ? 8 : n === 3 ? 7 : 10);
export const tableSize = (cfg: Cfg, n: number) => (cfg.mode === 'koikoi' ? 8 : n === 3 ? 6 : 8);
/** Сколько очков нужно, чтобы сказать «го»/«стоп». */
export const goMin = (n: number) => (n === 3 ? 3 : 7);

export type Phase = 'play' | 'draw' | 'pick' | 'call';

/** Сыгранное с руки, ждёт открытой карты. */
export interface Pend {
  /** Сыгранные карты (бомба — три). Пусто — ход без карты (после бомбы). */
  cards: number[];
  /** Сколько карт этого месяца было на столе до хода. */
  had: number;
  /** Что сыгранная накрыла (одна карта, три — все, пусто — легла на стол). */
  onto: number[];
  bomb?: boolean;
}

export interface Pick {
  /** Открытая карта, ей две пары на столе — выбрать. */
  card: number;
  options: number[];
}

export interface RoundLine {
  seat: number;
  what: string;
  pts: number;
}

export interface RoundResult {
  /** Кто взял кон (null — без очков). */
  winner: number | null;
  /** Комбинации победителя. */
  yaku: YakuLine[];
  /** Пояснения к счёту: удвоения, штрафы. */
  notes: string[];
  add: number[];
}

export interface State {
  cfg: Cfg;
  seats: number[];
  deck: number[];
  hands: number[][];
  table: number[];
  caps: number[][];
  phase: Phase;
  turn: number;
  /** Сдающий (в коикои — оя, ходит первым; в го-стопе — ходит первым). */
  oya: number;
  round: number;
  score: number[];
  pend: Pend | null;
  pick: Pick | null;
  /** Коикои: сколько раз сказал «коикои»; го-стоп: сколько «го». */
  calls: number[];
  /** Очки при последнем решении (новое яку / больше очков — снова решать). */
  base: number[];
  /** Го-стоп: тряски и бомбы. */
  shakes: number[];
  /** Го-стоп: ходы «только открыть колоду» после бомбы. */
  skips: number[];
  /** Го-стоп: застрявшие ппоки — месяц → чей. */
  stuck: Record<number, number>;
  ppeoks: number[];
  /** Го-стоп: множитель кона после нагари. */
  carry: number;
  last: RoundResult | null;
  over: boolean;
  winners: number[];
}

export interface View extends Omit<State, 'deck' | 'hands'> {
  hands: number[][];
  counts: number[];
  deckLeft: number;
}

export type Action =
  | { type: 'play'; card: number; onto?: number; shake?: boolean }
  | { type: 'bomb'; month: number }
  | { type: 'pass' }
  | { type: 'draw' }
  | { type: 'pick'; card: number }
  | { type: 'call'; go: boolean };

export type Why = 'jjok' | 'ttadak' | 'eat' | 'sseul' | 'bomb' | 'stuck';

export type Event =
  | { type: 'deal'; round: number; oya: number; hands?: number[][]; table: number[]; redeal?: boolean }
  | { type: 'play'; seat: number; cards: number[]; onto: number[]; shake?: boolean; bomb?: boolean; shown?: number[] }
  | { type: 'pass'; seat: number }
  | { type: 'flip'; seat: number; card: number }
  | { type: 'take'; seat: number; cards: number[]; why?: Why }
  | { type: 'stick'; seat: number; month: number; cards: number[] }
  | { type: 'steal'; from: number; to: number; card: number }
  | { type: 'yaku'; seat: number; lines: YakuLine[]; total: number; ask: boolean }
  | { type: 'call'; seat: number; go: boolean; n: number; mode: Mode }
  | { type: 'instant'; seat: number; what: string; cards: number[] }
  | { type: 'score'; result: RoundResult; score: number[] }
  | { type: 'end'; winners: number[]; score: number[] };

const nextIn = (list: number[], seat: number) => list[(list.indexOf(seat) + 1) % list.length];
const zero = (seats: number[]) => seats.reduce((a, x) => ((a[x] = 0), a), [] as number[]);
const lists = (seats: number[]) => seats.reduce((a, x) => ((a[x] = []), a), [] as number[][]);

export function newState(cfg: Cfg, seats: number[]): State {
  return {
    cfg,
    seats: seats.slice(),
    deck: [],
    hands: lists(seats),
    table: [],
    caps: lists(seats),
    phase: 'play',
    turn: seats[0],
    oya: seats[0],
    round: 0,
    score: zero(seats),
    pend: null,
    pick: null,
    calls: zero(seats),
    base: zero(seats),
    shakes: zero(seats),
    skips: zero(seats),
    stuck: {},
    ppeoks: zero(seats),
    carry: 1,
    last: null,
    over: false,
    winners: [],
  };
}

export function cloneState(s: State): State {
  return {
    ...s,
    deck: s.deck.slice(),
    hands: s.hands.map((h) => (h ? h.slice() : h)),
    table: s.table.slice(),
    caps: s.caps.map((c) => (c ? c.slice() : c)),
    score: s.score.slice(),
    pend: s.pend ? { ...s.pend, cards: s.pend.cards.slice(), onto: s.pend.onto.slice() } : null,
    pick: s.pick ? { ...s.pick, options: s.pick.options.slice() } : null,
    calls: s.calls.slice(),
    base: s.base.slice(),
    shakes: s.shakes.slice(),
    skips: s.skips.slice(),
    stuck: { ...s.stuck },
    ppeoks: s.ppeoks.slice(),
  };
}

const ofMonth = (cards: number[], m: number) => cards.filter((c) => monthOf(c) === m);

/** Четыре одного месяца на руке. */
function fourOfMonth(hand: number[]): number | null {
  for (let m = 0; m < 12; m++) if (ofMonth(hand, m).length === 4) return m;
  return null;
}

function deal(s: State, rng: Rng, ev: Event[]) {
  const n = s.seats.length;
  for (let tries = 0; ; tries++) {
    const deck = shuffle(DECK(), rng);
    const table = deck.splice(0, tableSize(s.cfg, n));
    // четыре одного месяца на столе — пересдача
    if (tries < 50 && Array.from({ length: 12 }, (_, m) => ofMonth(table, m).length).some((k) => k === 4)) {
      ev.push({ type: 'deal', round: s.round, oya: s.oya, table, redeal: true });
      continue;
    }
    s.table = table;
    let p = s.oya;
    for (const x of s.seats) s.hands[x] = [];
    for (let k = 0; k < handSize(s.cfg, n) * n; k++) {
      s.hands[p].push(deck.shift()!);
      p = nextIn(s.seats, p);
    }
    s.deck = deck;
    break;
  }
  ev.push({ type: 'deal', round: s.round, oya: s.oya, hands: s.hands.map((h) => (h ? h.slice() : h)), table: s.table.slice() });
}

function startRound(s: State, rng: Rng, ev: Event[]) {
  s.round++;
  for (const x of s.seats) {
    s.caps[x] = [];
    s.calls[x] = 0;
    s.base[x] = 0;
    s.shakes[x] = 0;
    s.skips[x] = 0;
    s.ppeoks[x] = 0;
  }
  s.stuck = {};
  s.pend = null;
  s.pick = null;
  s.phase = 'play';
  s.turn = s.oya;
  deal(s, rng, ev);
  // мгновенная победа на раздаче
  for (const x of [s.oya, ...s.seats.filter((y) => y !== s.oya)]) {
    const four = fourOfMonth(s.hands[x]);
    if (s.cfg.mode === 'koikoi') {
      if (!s.cfg.handYaku) break;
      const pairs = Array.from({ length: 12 }, (_, m) => ofMonth(s.hands[x], m).length);
      const kuttsuki = pairs.every((k) => k % 2 === 0);
      if (four != null || kuttsuki) {
        const what = four != null ? 'тэси — четыре одного месяца на руке' : 'куттуки — четыре пары на руке';
        ev.push({ type: 'instant', seat: x, what, cards: s.hands[x].slice() });
        finishRound(s, rng, ev, x, [{ name: what, pts: 6 }], true);
        return;
      }
    } else if (four != null) {
      const what = 'чхонтхон — четыре одного месяца на руке';
      ev.push({ type: 'instant', seat: x, what, cards: s.hands[x].slice() });
      finishRound(s, rng, ev, x, [{ name: what, pts: 10 }], true);
      return;
    }
  }
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  const cfg = cfgFrom(opts);
  // коикои — только вдвоём (лобби иного не даст); втроём на той же колоде играют го-стоп
  if (seats.length === 3 && cfg.mode === 'koikoi') Object.assign(cfg, cfgFrom({ ...opts, mode: 'gostop' }));
  const s = newState(cfg, seats);
  s.oya = seats[rng.int(seats.length)];
  startRound(s, rng, []);
  return s;
}

export const toAct = (s: State | View): number[] => (s.over ? [] : [s.turn]);

// ---------------------------------------------------------------- ходы

/** Можно ли «трясти» этой картой (три её месяца на руке, на столе — ни одной). */
export function canShake(s: State | View, seat: number, card: number): boolean {
  if (s.cfg.mode !== 'gostop') return false;
  const m = monthOf(card);
  return ofMonth(s.hands[seat], m).length === 3 && !ofMonth(s.table, m).length;
}

/** Месяцы для бомбы: три на руке и одна на столе. */
export function bombMonths(s: State | View, seat: number): number[] {
  if (s.cfg.mode !== 'gostop') return [];
  const out: number[] = [];
  for (let m = 0; m < 12; m++) if (ofMonth(s.hands[seat], m).length === 3 && ofMonth(s.table, m).length === 1) out.push(m);
  return out;
}

/** Все допустимые действия места. */
export function moves(s: State | View, seat: number): Action[] {
  if (s.over || s.turn !== seat) return [];
  switch (s.phase) {
    case 'play': {
      const out: Action[] = [];
      for (const c of s.hands[seat]) {
        const same = ofMonth(s.table, monthOf(c));
        const shake = canShake(s, seat, c);
        const add = (a: Action & { type: 'play' }) => {
          out.push(a);
          if (shake) out.push({ ...a, shake: true });
        };
        if (same.length === 2) for (const t of same) add({ type: 'play', card: c, onto: t });
        else add({ type: 'play', card: c });
      }
      for (const m of bombMonths(s, seat)) out.push({ type: 'bomb', month: m });
      if (s.skips[seat] > 0) out.push({ type: 'pass' });
      return out;
    }
    case 'draw':
      return [{ type: 'draw' }];
    case 'pick':
      return s.pick ? s.pick.options.map((c) => ({ type: 'pick', card: c })) : [];
    case 'call':
      return [
        { type: 'call', go: true },
        { type: 'call', go: false },
      ];
  }
}

/** Действие как строка — для сравнения с допустимыми (лишние поля из сети отбрасываются). */
function key(a: Action): string {
  switch (a.type) {
    case 'play':
      return `play:${a.card}:${a.onto ?? ''}:${a.shake ? 1 : 0}`;
    case 'bomb':
      return `bomb:${a.month}`;
    case 'pick':
      return `pick:${a.card}`;
    case 'call':
      return `call:${a.go ? 1 : 0}`;
    default:
      return a.type;
  }
}

function legal(s: State, seat: number, a: Action): boolean {
  if (!a || typeof a !== 'object' || typeof a.type !== 'string') return false;
  const want = key(a);
  return moves(s, seat).some((m) => key(m) === want);
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.over || seat !== s0.turn || !legal(s0, seat, a)) return null;
  const s = cloneState(s0);
  const ev: Event[] = [];
  switch (a.type) {
    case 'play':
      doPlay(s, seat, [a.card], a.onto, !!a.shake, false, ev);
      break;
    case 'bomb': {
      const cards = ofMonth(s.hands[seat], a.month);
      doPlay(s, seat, cards, undefined, false, true, ev);
      break;
    }
    case 'pass':
      s.skips[seat]--;
      s.pend = { cards: [], had: 0, onto: [] };
      s.phase = 'draw';
      ev.push({ type: 'pass', seat });
      break;
    case 'draw':
      doDraw(s, seat, rng, ev);
      break;
    case 'pick':
      doPick(s, seat, a.card, rng, ev);
      break;
    case 'call':
      doCall(s, seat, a.go, rng, ev);
      break;
  }
  return { state: s, events: ev };
}

function doPlay(s: State, seat: number, cards: number[], onto: number | undefined, shake: boolean, bomb: boolean, ev: Event[]) {
  const m = monthOf(cards[0]);
  const on = ofMonth(s.table, m);
  s.hands[seat] = s.hands[seat].filter((c) => !cards.includes(c));
  let target: number[] = [];
  if (on.length === 1 || on.length === 3) target = on;
  else if (on.length === 2) target = [onto ?? on[0]];
  let shown: number[] | undefined;
  if (shake) {
    s.shakes[seat]++;
    shown = [...cards, ...ofMonth(s.hands[seat], m)];
  }
  if (bomb) {
    s.shakes[seat]++;
    s.skips[seat] += 2;
  }
  s.pend = { cards, had: on.length, onto: target, bomb };
  s.phase = 'draw';
  ev.push({ type: 'play', seat, cards, onto: target, shake: shake || undefined, bomb: bomb || undefined, shown });
}

/** Каждый соперник отдаёт одну пустую (самую дешёвую). */
function steal(s: State, seat: number, ev: Event[], times = 1) {
  if (s.cfg.mode !== 'gostop') return;
  for (const x of s.seats) {
    if (x === seat) continue;
    for (let k = 0; k < times; k++) {
      const pis = s.caps[x].filter((c) => piValue(c) > 0).sort((a, b) => piValue(a) - piValue(b));
      if (!pis.length) break;
      const c = pis[0];
      s.caps[x] = s.caps[x].filter((y) => y !== c);
      s.caps[seat].push(c);
      ev.push({ type: 'steal', from: x, to: seat, card: c });
    }
  }
}

function take(s: State, seat: number, cards: number[], ev: Event[], why?: Why) {
  s.table = s.table.filter((c) => !cards.includes(c));
  s.caps[seat].push(...cards);
  ev.push({ type: 'take', seat, cards, why });
}

/** Сыгранная накрыла три (застрявший ппок или три со сдачи) — забирает все. */
function eatThree(s: State, seat: number, month: number, cards: number[], ev: Event[]) {
  const owner = s.stuck[month];
  take(s, seat, cards, ev, owner != null ? 'eat' : undefined);
  if (owner != null) {
    delete s.stuck[month];
    steal(s, seat, ev, owner === seat ? 2 : 1);
  }
}

function doDraw(s: State, seat: number, rng: Rng, ev: Event[]) {
  const p = s.pend!;
  const f = s.deck.shift()!;
  ev.push({ type: 'flip', seat, card: f });
  const mp = p.cards.length ? monthOf(p.cards[0]) : -1;
  const mf = monthOf(f);
  s.pend = null;
  // сыгранное — на стол (накрытое — рядом с целью)
  s.table.push(...p.cards);
  if (p.bomb) {
    take(s, seat, [...p.cards, ...p.onto], ev, 'bomb');
    steal(s, seat, ev);
  } else if (p.cards.length && mf === mp) {
    if (p.had === 0) {
      // открытая накрыла только что сыгранную
      s.table.push(f);
      take(s, seat, [p.cards[0], f], ev, s.cfg.mode === 'gostop' ? 'jjok' : undefined);
      steal(s, seat, ev);
      return afterTurn(s, seat, rng, ev);
    }
    if (p.had === 2) {
      s.table.push(f);
      take(s, seat, [...ofMonth(s.table, mp)], ev, s.cfg.mode === 'gostop' ? 'ttadak' : undefined);
      steal(s, seat, ev);
      return afterTurn(s, seat, rng, ev);
    }
    if (p.had === 1) {
      if (s.cfg.mode === 'gostop') {
        // ппок: все три остаются на столе
        s.table.push(f);
        s.stuck[mp] = seat;
        s.ppeoks[seat]++;
        ev.push({ type: 'stick', seat, month: mp, cards: ofMonth(s.table, mp) });
        if (s.ppeoks[seat] >= 3) {
          ev.push({ type: 'instant', seat, what: 'три ппока', cards: [] });
          return finishRound(s, rng, ev, seat, [{ name: 'три ппока', pts: 7 }], true);
        }
        return afterTurn(s, seat, rng, ev);
      }
      // коикои: сыгранная взяла свою пару, открытая ложится на стол
      take(s, seat, [p.cards[0], ...p.onto], ev);
      s.table.push(f);
      return afterTurn(s, seat, rng, ev);
    }
  } else if (p.cards.length && p.onto.length) {
    if (p.onto.length === 3) eatThree(s, seat, mp, [p.cards[0], ...p.onto], ev);
    else take(s, seat, [p.cards[0], ...p.onto], ev);
  }
  // открытая карта
  const on = ofMonth(s.table, mf);
  s.table.push(f);
  if (on.length === 1) take(s, seat, [f, on[0]], ev);
  else if (on.length === 3) eatThree(s, seat, mf, [f, ...on], ev);
  else if (on.length === 2) {
    s.pick = { card: f, options: on };
    s.phase = 'pick';
    return;
  }
  afterTurn(s, seat, rng, ev);
}

function doPick(s: State, seat: number, card: number, rng: Rng, ev: Event[]) {
  const f = s.pick!.card;
  s.pick = null;
  take(s, seat, [f, card], ev);
  afterTurn(s, seat, rng, ev);
}

/** Очки места сейчас (яку коикои или очки го-стопа). */
export function pointsOf(s: State | View, seat: number): { lines: YakuLine[]; total: number } {
  if (s.cfg.mode === 'koikoi') {
    const lines = koiYaku(s.caps[seat], s.cfg);
    return { lines, total: total(lines) };
  }
  const t = goTally(s.caps[seat]);
  return { lines: t.lines, total: t.total };
}

const handLeft = (s: State, x: number) => s.hands[x].length + s.skips[x];

function afterTurn(s: State, seat: number, rng: Rng, ev: Event[]) {
  // смёл стол — ссыль (кроме последнего хода кона)
  const last = s.seats.every((x) => !handLeft(s, x));
  if (s.cfg.mode === 'gostop' && !s.table.length && !last) {
    ev.push({ type: 'take', seat, cards: [], why: 'sseul' });
    steal(s, seat, ev);
  }
  const pts = pointsOf(s, seat);
  const can = s.cfg.mode === 'koikoi' ? pts.total > s.base[seat] : pts.total >= goMin(s.seats.length) && pts.total > s.base[seat];
  if (can) {
    const ask = handLeft(s, seat) > 0;
    ev.push({ type: 'yaku', seat, lines: pts.lines, total: pts.total, ask });
    if (ask) {
      s.phase = 'call';
      return;
    }
    return win(s, seat, rng, ev);
  }
  nextTurn(s, rng, ev);
}

function nextTurn(s: State, rng: Rng, ev: Event[]) {
  s.phase = 'play';
  if (s.seats.every((x) => !handLeft(s, x))) return finishRound(s, rng, ev, null, [], false);
  let p = nextIn(s.seats, s.turn);
  for (let k = 0; k < s.seats.length && !handLeft(s, p); k++) p = nextIn(s.seats, p);
  s.turn = p;
}

function doCall(s: State, seat: number, go: boolean, rng: Rng, ev: Event[]) {
  if (!go) {
    ev.push({ type: 'call', seat, go: false, n: s.calls[seat], mode: s.cfg.mode });
    return win(s, seat, rng, ev);
  }
  s.calls[seat]++;
  s.base[seat] = pointsOf(s, seat).total;
  ev.push({ type: 'call', seat, go: true, n: s.calls[seat], mode: s.cfg.mode });
  nextTurn(s, rng, ev);
}

/** Сказал «стоп» (или собрал на последней карте). */
function win(s: State, seat: number, rng: Rng, ev: Event[]) {
  const pts = pointsOf(s, seat);
  finishRound(s, rng, ev, seat, pts.lines, false);
}

/** Сколько платит проигравший в го-стопе и почему. */
export function goPayment(s: State | View, winner: number, loser: number): { pts: number; notes: string[] } {
  const t = goTally(s.caps[winner]);
  const notes: string[] = [];
  const go = s.calls[winner];
  let pts = t.total + Math.min(go, 2);
  if (go) notes.push(`${go} го: +${Math.min(go, 2)}${go >= 3 ? `, ×${2 ** (go - 2)}` : ''}`);
  if (go >= 3) pts *= 2 ** (go - 2);
  if (s.shakes[winner]) {
    pts *= 2 ** s.shakes[winner];
    notes.push(`тряска/бомба ×${2 ** s.shakes[winner]}`);
  }
  const lt = goTally(s.caps[loser]);
  const lpi = lt.pi;
  if (t.byPi && lpi > 0 && lpi < (s.seats.length === 3 ? 6 : 8)) {
    pts *= 2;
    notes.push('пи-бак ×2');
  }
  if (t.byLights && lt.lights === 0) {
    pts *= 2;
    notes.push('кван-бак ×2');
  }
  if (t.animals >= 7) {
    pts *= 2;
    notes.push('мён-бак ×2');
  }
  if (s.calls[loser] > 0) {
    pts *= 2;
    notes.push('го-бак ×2');
  }
  if (s.carry > 1) {
    pts *= s.carry;
    notes.push(`после нагари ×${s.carry}`);
  }
  return { pts, notes };
}

/** Кон окончен. instant — победа на раздаче или тремя ппоками: очки как есть, без удвоений. */
function finishRound(s: State, rng: Rng, ev: Event[], winner: number | null, yaku: YakuLine[], instant: boolean) {
  const add = zero(s.seats);
  const notes: string[] = [];
  if (winner != null) {
    if (s.cfg.mode === 'koikoi') {
      let pts = total(yaku);
      if (!instant && s.cfg.double7 && pts >= 7) {
        pts *= 2;
        notes.push('7 и больше — ×2');
      }
      const other = s.seats.find((x) => x !== winner)!;
      if (!instant && s.cfg.koiDouble && s.calls[other] > 0) {
        pts *= 2;
        notes.push('соперник сказал «коикои» — ×2');
      }
      add[winner] = pts;
    } else {
      for (const x of s.seats) {
        if (x === winner) continue;
        const pay = instant ? { pts: total(yaku) * s.carry, notes: [] as string[] } : goPayment(s, winner, x);
        add[x] -= pay.pts;
        add[winner] += pay.pts;
        if (pay.notes.length) notes.push(`${s.seats.length === 3 ? `место ${x + 1}: ` : ''}${pay.notes.join(', ')}`);
      }
      // го-бак втроём: сказавший «го» платит и за второго проигравшего
      if (s.seats.length === 3 && !instant) {
        const goer = s.seats.find((x) => x !== winner && s.calls[x] > 0);
        if (goer != null) {
          const other = s.seats.find((x) => x !== winner && x !== goer)!;
          add[goer] += add[other];
          add[other] = 0;
        }
      }
      s.carry = 1;
    }
    s.oya = winner;
  } else if (s.cfg.mode === 'gostop' && s.cfg.nagari) {
    s.carry *= 2;
    notes.push(`нагари — следующий кон ×${s.carry}`);
  }
  for (const x of s.seats) s.score[x] += add[x];
  s.last = { winner, yaku, notes, add };
  s.phase = 'play';
  s.pend = null;
  s.pick = null;
  ev.push({ type: 'score', result: s.last, score: s.score.slice() });
  if (s.round >= s.cfg.months) {
    const best = Math.max(...s.seats.map((x) => s.score[x]));
    s.over = true;
    s.winners = s.seats.filter((x) => s.score[x] === best);
    ev.push({ type: 'end', winners: s.winners, score: s.score.slice() });
    return;
  }
  startRound(s, rng, ev);
}

// ---------------------------------------------------------------- вид

export function makeView(s: State, seats: number[] | 'all'): View {
  const see = (x: number) => seats === 'all' || seats.includes(x);
  const { deck, ...rest } = s;
  return {
    ...rest,
    hands: s.hands.map((h, i) => (h ? (see(i) ? h.slice() : []) : h)),
    caps: s.caps.map((c) => (c ? c.slice() : c)),
    table: s.table.slice(),
    counts: s.hands.map((h) => (h ? h.length : 0)),
    deckLeft: deck.length,
  };
}

/** Невидимые месту карты: колода и чужие руки. */
export function unseen(v: View, seat: number): number[] {
  const known = new Set<number>([...v.hands[seat], ...v.table, ...v.caps.flat(), ...(v.pend?.cards ?? []), ...(v.pick ? [v.pick.card] : [])]);
  return DECK().filter((c) => !known.has(c));
}

export const kindOf = (id: number) => info(id).kind;
