/* Шляпа — движок. Слова тянут из шляпы; объясняющий за отведённое время объясняет партнёру как можно больше слов.
 * Угадано — очко объясняющему и угадавшему; ошибка (однокоренное, перевод, жест) — слово сгорает или возвращается; пропуск — по правилам.
 * Время вышло — недообъяснённое слово возвращается в шляпу (или «последнее слово»). Пары — каждый с каждым по кругу или постоянные команды.
 * Три круга: те же слова — словами, жестами, одним словом.
 *
 * Время. Если в паре есть человек, часы идут по-настоящему: «время вышло» присылает его экран (и бот пары — по своим часам, с запасом).
 * Если пара — два бота, время условное: каждое их действие говорит, сколько оно «заняло» (dt), и движок сам кончает ход.
 * Боты объясняют подсказками из словаря (вопросы кроссворда: подробно, коротко, одним словом), угадывают по ним. Свои слова — только без ботов.
 * Без DOM. */
import type { Options, Rng } from '../../core/types';
import { hintsFor, norm, poolFor, WORDS, type HintKind } from './words';

export type Phase = 'write' | 'ready' | 'explain' | 'last' | 'review' | 'over';
/** Чем кончилось слово: угадано, ошибка, пропуск, вернулось (время вышло). */
export type Res = 'got' | 'miss' | 'skip' | 'back';

/** Бумажка в шляпе: слово и номер в словаре (у своих слов номера нет). */
export interface Slip {
  w: string;
  i?: number;
}
export interface Hint {
  kind: HintKind;
  text: string;
}
export interface Try {
  seat: number;
  text: string;
  right: boolean;
}
/** Слово хода и чем кончилось (w пусто — не показывать: слово вернулось в шляпу). */
export interface Done {
  w: string;
  res: Res;
  last?: boolean;
}
export interface TurnLog {
  round: number;
  exp: number;
  gue: number;
  got: number;
}

export const LAST_MS = 3000;
/** Сколько ждать последнее слово, если угадывает человек по подсказкам бота (печатать дольше, чем крикнуть). */
export const LAST_TYPE_MS = 8000;

export interface State {
  gid: number;
  seats: number[];
  humans: number[];
  time: number;
  last: boolean;
  miss: 'burn' | 'return';
  skip: 'free' | 'penalty' | 'off';
  pairs: 'circle' | 'teams';
  rounds: number;
  own: boolean;
  per: number;
  phase: Phase;
  round: number;
  /** Номер хода с начала игры. */
  t: number;
  exp: number;
  gue: number;
  slips: Slip[];
  hat: number[];
  burned: number[];
  cur: number | null;
  /** Сколько слов вытянуто с начала игры (номер текущей бумажки для всех). */
  seq: number;
  hints: Hint[];
  tries: Try[];
  options: string[] | null;
  /** Пропущенные в этот ход (второй раз в этот ход не тянутся). */
  skipped: number[];
  turn: (Done & { slip: number })[];
  /** Пара — два бота: условное время. */
  virt: boolean;
  used: number;
  need: 'hint' | 'guess';
  expl: Record<number, number>;
  gues: Record<number, number>;
  written: Record<number, string[]>;
  log: TurnLog[];
  /** Угаданные бумажки (их видели все) — в следующих кругах слова уже знакомые. */
  seen: number[];
}

export type Action =
  | { type: 'words'; list: string[] }
  | { type: 'start' }
  | { type: 'got' }
  | { type: 'miss' }
  | { type: 'skip'; dt?: number }
  | { type: 'hint'; dt?: number }
  | { type: 'guess'; text: string; dt?: number }
  | { type: 'pass'; dt?: number }
  | { type: 'stall' }
  | { type: 'timeup' }
  | { type: 'nope' }
  | { type: 'next' };

export type Event =
  | { type: 'written'; seat: number }
  | { type: 'hatReady'; total: number }
  | { type: 'pair'; exp: number; gue: number; round: number }
  | { type: 'start'; exp: number; gue: number }
  | { type: 'draw'; seq: number; exp: number; w: string | null }
  | { type: 'hint'; seat: number; hint: Hint }
  | { type: 'guess'; seat: number; text: string; right: boolean }
  | { type: 'got'; exp: number; gue: number; w: string; last?: boolean }
  | { type: 'miss'; exp: number; w: string | null; burn: boolean }
  | { type: 'skip'; exp: number; w: string | null; penalty: boolean }
  | { type: 'timeup'; last: boolean }
  | { type: 'back'; exp: number; w: string | null }
  | { type: 'turnEnd'; exp: number; gue: number; got: number; empty: boolean }
  | { type: 'round'; round: number }
  | { type: 'over' };

export interface View {
  gid: number;
  seats: number[];
  humans: number[];
  time: number;
  last: boolean;
  miss: State['miss'];
  skip: State['skip'];
  pairs: State['pairs'];
  rounds: number;
  own: boolean;
  per: number;
  phase: Phase;
  round: number;
  t: number;
  exp: number;
  gue: number;
  teams: number[][] | null;
  hatLeft: number;
  total: number;
  /** Слово — только объясняющему (и «всем» в показе). */
  word: string | null;
  wi: number | null;
  seq: number;
  hints: Hint[];
  hintsLeft: number;
  tries: Try[];
  options: string[] | null;
  virt: boolean;
  used: number;
  need: State['need'];
  turn: Done[];
  expl: Record<number, number>;
  gues: Record<number, number>;
  /** Кто уже положил свои слова; myWords — свои (только своим местам). */
  written: number[];
  myWords: Record<number, string[]>;
  log: TurnLog[];
  /** Угаданные слова (номера в словаре) — знакомы всем. */
  seenI: number[];
  seenW: string[];
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

export const teamsOf = (seats: number[]): number[][] => {
  const m = seats.length / 2;
  return Array.from({ length: m }, (_, j) => [seats[j], seats[j + m]]);
};

/** Пара хода t: каждый с каждым — сдвиг растёт после каждого полного круга; команды — по очереди, внутри команды роли меняются. */
export function pairOf(s: Pick<State, 'seats' | 'pairs'>, t: number): [number, number] {
  const n = s.seats.length;
  if (s.pairs === 'teams' && n >= 4 && n % 2 === 0) {
    const teams = teamsOf(s.seats);
    const team = teams[t % teams.length];
    const k = Math.floor(t / teams.length) % 2;
    return [team[k], team[1 - k]];
  }
  const i = t % n;
  const shift = n <= 2 ? 1 : 1 + (Math.floor(t / n) % (n - 1));
  return [s.seats[i], s.seats[(i + shift) % n]];
}

const isBot = (s: State, x: number) => !s.humans.includes(x);

export function setup(seats: number[], opts: Options, rng: Rng, humans: number[] = []): State {
  const hs = humans.filter((x) => seats.includes(x));
  const n = seats.length;
  const pairs = opts.pairs === 'teams' && n >= 4 && n % 2 === 0 ? 'teams' : 'circle';
  const per = Math.max(1, Math.min(20, Number(opts.per) || 8));
  const s: State = {
    gid: rng.int(1e9),
    seats: seats.slice(),
    humans: hs,
    time: Math.max(5, Number(opts.time) || 30) * 1000,
    last: opts.last !== false,
    miss: opts.miss === 'return' ? 'return' : 'burn',
    skip: opts.skip === 'penalty' ? 'penalty' : opts.skip === 'off' ? 'off' : 'free',
    pairs,
    rounds: Number(opts.rounds) === 3 ? 3 : 1,
    // свои слова — только если за столом одни люди (ботам нечем их объяснить)
    own: opts.source === 'own' && hs.length === n,
    per,
    phase: 'ready',
    round: 0,
    t: 0,
    exp: seats[0],
    gue: seats[0],
    slips: [],
    hat: [],
    burned: [],
    cur: null,
    seq: 0,
    hints: [],
    tries: [],
    options: null,
    skipped: [],
    turn: [],
    virt: false,
    used: 0,
    need: 'hint',
    expl: Object.fromEntries(seats.map((x) => [x, 0])),
    gues: Object.fromEntries(seats.map((x) => [x, 0])),
    written: {},
    log: [],
    seen: [],
  };
  if (s.own) s.phase = 'write';
  else {
    const pool = poolFor(String(opts.level ?? 'mid')).slice();
    for (let k = 0; k < per * n && pool.length; k++) {
      const i = pool.splice(rng.int(pool.length), 1)[0];
      s.slips.push({ w: WORDS[i].w, i });
    }
    s.hat = s.slips.map((_, k) => k);
  }
  setPair(s);
  return s;
}

function setPair(s: State) {
  [s.exp, s.gue] = pairOf(s, s.t);
  s.virt = isBot(s, s.exp) && isBot(s, s.gue);
}

/** Кто в паре — люди. */
const pairHumans = (s: State) => [s.exp, s.gue].filter((x, k, a) => s.humans.includes(x) && a.indexOf(x) === k);

export function toAct(s: State): number[] {
  switch (s.phase) {
    case 'write':
      return s.humans.filter((x) => !(x in s.written));
    case 'ready': {
      const h = pairHumans(s);
      return h.length ? [h[0]] : [s.exp];
    }
    case 'explain':
      if (s.virt) return [s.need === 'hint' ? s.exp : s.gue];
      return [s.exp, s.gue].filter((x, k, a) => a.indexOf(x) === k);
    case 'last':
      if (s.virt) return [s.gue];
      if (!isBot(s, s.exp) && !isBot(s, s.gue)) return [s.exp];
      return [s.exp, s.gue];
    case 'review': {
      const h = pairHumans(s);
      return h.length ? h : [s.exp];
    }
    default:
      return [];
  }
}

/** Человек, угадывающий по подсказкам бота, получает варианты: верное слово и похожие (те же «одним словом» или того же уровня). */
function makeOptions(s: State, rng: Rng): string[] | null {
  if (!isBot(s, s.exp) || isBot(s, s.gue) || s.cur == null) return null;
  const slip = s.slips[s.cur];
  const out = [slip.w];
  const have = new Set([norm(slip.w)]);
  const push = (w: string) => {
    if (out.length < 6 && !have.has(norm(w))) {
      have.add(norm(w));
      out.push(w);
    }
  };
  if (s.round > 0) {
    const others = s.slips.filter((x, k) => k !== s.cur && !s.burned.includes(k));
    while (others.length && out.length < 6) push(others.splice(rng.int(others.length), 1)[0].w);
  }
  const e = slip.i != null ? WORDS[slip.i] : null;
  if (e) {
    const same = WORDS.filter((x) => x.one === e.one && x.n !== e.n);
    while (same.length && out.length < 4) push(same.splice(rng.int(same.length), 1)[0].w);
    const lv = poolFor(e.d === 1 ? 'easy' : e.d === 2 ? 'mid' : 'hard');
    for (let k = 0; k < 40 && out.length < 6; k++) push(WORDS[lv[rng.int(lv.length)]].w);
  }
  // перемешать
  for (let k = out.length - 1; k > 0; k--) {
    const j = rng.int(k + 1);
    [out[k], out[j]] = [out[j], out[k]];
  }
  return out;
}

/** Вытянуть следующую бумажку; шляпа пуста (или остались одни пропущенные в этот ход) — ход окончен. */
function draw(s: State, rng: Rng, ev: Event[]): boolean {
  const can = s.hat.filter((k) => !s.skipped.includes(k));
  s.hints = [];
  s.tries = [];
  s.options = null;
  s.need = 'hint';
  if (!can.length) {
    s.cur = null;
    return false;
  }
  const k = can[rng.int(can.length)];
  s.hat.splice(s.hat.indexOf(k), 1);
  s.cur = k;
  s.seq++;
  s.options = makeOptions(s, rng);
  ev.push({ type: 'draw', seq: s.seq, exp: s.exp, w: s.slips[k].w });
  return true;
}

function endTurn(s: State, ev: Event[]) {
  if (s.cur != null) {
    s.hat.push(s.cur);
    s.turn.push({ slip: s.cur, w: s.slips[s.cur].w, res: 'back' });
    ev.push({ type: 'back', exp: s.exp, w: s.slips[s.cur].w });
    s.cur = null;
  }
  const got = s.turn.filter((d) => d.res === 'got').length;
  s.log.push({ round: s.round, exp: s.exp, gue: s.gue, got });
  const empty = s.hat.length === 0;
  ev.push({ type: 'turnEnd', exp: s.exp, gue: s.gue, got, empty });
  s.hints = [];
  s.tries = [];
  s.options = null;
  if (empty && s.round >= s.rounds - 1) {
    s.phase = 'over';
    ev.push({ type: 'over' });
  } else s.phase = 'review';
}

function score(s: State, ev: Event[], rng: Rng, last = false) {
  const k = s.cur!;
  s.expl[s.exp] = (s.expl[s.exp] ?? 0) + 1;
  s.gues[s.gue] = (s.gues[s.gue] ?? 0) + 1;
  s.turn.push({ slip: k, w: s.slips[k].w, res: 'got', ...(last ? { last: true } : {}) });
  if (!s.seen.includes(k)) s.seen.push(k);
  ev.push({ type: 'got', exp: s.exp, gue: s.gue, w: s.slips[k].w, ...(last ? { last: true } : {}) });
  s.cur = null;
  if (last || !draw(s, rng, ev)) endTurn(s, ev);
}

function timeup(s: State, ev: Event[]) {
  const lastWord = s.last && s.cur != null;
  ev.push({ type: 'timeup', last: lastWord });
  if (lastWord) {
    s.phase = 'last';
    s.need = 'guess';
  } else endTurn(s, ev);
}

/** Условное время пары ботов: действие заняло dt; не уложились — время вышло раньше. */
function spend(s: State, dt: unknown, ev: Event[]): boolean {
  if (!s.virt) return true;
  const d = Math.max(200, Math.min(20000, Number(dt) || 1000));
  if (s.used + d > s.time) {
    s.used = s.time;
    timeup(s, ev);
    return false;
  }
  s.used += d;
  return true;
}

const cleanWord = (w: unknown) =>
  String(w ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 30);

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (!a || typeof a !== 'object') return null;
  const s = clone(s0);
  const ev: Event[] = [];
  const inPair = seat === s.exp || seat === s.gue;
  switch (a.type) {
    case 'words': {
      if (s.phase !== 'write' || !s.humans.includes(seat) || seat in s.written || !Array.isArray(a.list)) return null;
      const have = new Set(Object.values(s.written).flat().map(norm));
      const list: string[] = [];
      for (const raw of a.list.slice(0, s.per)) {
        const w = cleanWord(raw);
        if (!/[а-яёa-z]/i.test(w) || have.has(norm(w))) continue;
        have.add(norm(w));
        list.push(w);
      }
      if (!list.length) return null;
      s.written[seat] = list;
      ev.push({ type: 'written', seat });
      if (s.humans.every((x) => x in s.written)) {
        for (const x of s.seats) for (const w of s.written[x] ?? []) s.slips.push({ w });
        s.hat = s.slips.map((_, k) => k);
        s.phase = 'ready';
        ev.push({ type: 'hatReady', total: s.slips.length });
        ev.push({ type: 'pair', exp: s.exp, gue: s.gue, round: s.round });
      }
      break;
    }
    case 'start': {
      if (s.phase !== 'ready' || !toAct(s).includes(seat)) return null;
      s.phase = 'explain';
      s.turn = [];
      s.skipped = [];
      s.used = 0;
      ev.push({ type: 'start', exp: s.exp, gue: s.gue });
      if (!draw(s, rng, ev)) endTurn(s, ev);
      break;
    }
    case 'got': {
      // голосом: объясняющий отмечает, что партнёр угадал (только пара людей)
      if (seat !== s.exp || isBot(s, s.exp) || isBot(s, s.gue) || s.cur == null) return null;
      if (s.phase === 'explain') score(s, ev, rng);
      else if (s.phase === 'last') score(s, ev, rng, true);
      else return null;
      break;
    }
    case 'miss': {
      if (s.phase !== 'explain' || seat !== s.exp || s.cur == null || isBot(s, s.exp) || isBot(s, s.gue)) return null;
      const k = s.cur;
      const burn = s.miss === 'burn';
      if (burn) s.burned.push(k);
      else {
        s.hat.push(k);
        s.skipped.push(k);
      }
      s.turn.push({ slip: k, w: s.slips[k].w, res: 'miss' });
      ev.push({ type: 'miss', exp: s.exp, w: s.slips[k].w, burn });
      s.cur = null;
      if (!draw(s, rng, ev)) endTurn(s, ev);
      break;
    }
    case 'skip': {
      if (s.phase !== 'explain' || seat !== s.exp || s.cur == null || s.skip === 'off') return null;
      if (s.virt && s.need !== 'hint') return null;
      if (!spend(s, a.dt, ev)) break;
      const k = s.cur;
      const penalty = s.skip === 'penalty';
      if (penalty) {
        s.expl[s.exp]--;
        s.gues[s.gue]--;
      }
      s.hat.push(k);
      s.skipped.push(k);
      s.turn.push({ slip: k, w: s.slips[k].w, res: 'skip' });
      ev.push({ type: 'skip', exp: s.exp, w: s.slips[k].w, penalty });
      s.cur = null;
      if (!draw(s, rng, ev)) endTurn(s, ev);
      break;
    }
    case 'hint': {
      // подсказку из словаря даёт бот-объясняющий или человек, объясняющий боту (голос бот не слышит)
      if (s.phase !== 'explain' || seat !== s.exp || s.cur == null) return null;
      if (!isBot(s, s.exp) && !isBot(s, s.gue)) return null;
      if (s.virt && s.need !== 'hint') return null;
      const slip = s.slips[s.cur];
      const all = slip.i != null ? hintsFor(slip.i, s.round) : [];
      if (s.hints.length >= all.length) return null;
      if (!spend(s, a.dt, ev)) break;
      const hint = all[s.hints.length];
      s.hints.push(hint);
      s.need = 'guess';
      ev.push({ type: 'hint', seat, hint });
      break;
    }
    case 'guess': {
      if ((s.phase !== 'explain' && s.phase !== 'last') || seat !== s.gue || seat === s.exp || s.cur == null) return null;
      if (s.virt && s.need !== 'guess') return null;
      // угадывают голосом, если пара — люди; печатать можно всегда
      const text = cleanWord(a.text);
      if (!text) return null;
      if (s.phase === 'explain' && !spend(s, a.dt, ev)) break;
      const right = norm(text) === norm(s.slips[s.cur].w);
      s.tries.push({ seat, text, right });
      ev.push({ type: 'guess', seat, text, right });
      if (right) score(s, ev, rng, s.phase === 'last');
      else if (s.phase === 'last') endTurn(s, ev);
      else s.need = 'hint';
      break;
    }
    case 'pass': {
      if (s.phase === 'last' && seat === s.gue && s.virt) {
        endTurn(s, ev);
        break;
      }
      if (s.phase !== 'explain' || !s.virt || seat !== s.gue || s.need !== 'guess') return null;
      if (!spend(s, a.dt, ev)) break;
      s.need = 'hint';
      break;
    }
    case 'stall': {
      if (s.phase !== 'explain' || !s.virt || seat !== s.exp || s.need !== 'hint') return null;
      s.used = s.time;
      timeup(s, ev);
      break;
    }
    case 'timeup': {
      if (s.phase !== 'explain' || s.virt || !inPair) return null;
      timeup(s, ev);
      break;
    }
    case 'nope': {
      if (s.phase !== 'last' || !inPair) return null;
      endTurn(s, ev);
      break;
    }
    case 'next': {
      if (s.phase !== 'review' || !toAct(s).includes(seat)) return null;
      if (s.hat.length === 0) {
        s.round++;
        s.hat = s.slips.map((_, k) => k).filter((k) => !s.burned.includes(k));
        ev.push({ type: 'round', round: s.round });
      }
      s.t++;
      s.turn = [];
      setPair(s);
      s.phase = 'ready';
      ev.push({ type: 'pair', exp: s.exp, gue: s.gue, round: s.round });
      break;
    }
    default:
      return null;
  }
  return { state: s, events: ev };
}

const hideW = (s: State, d: Done & { slip: number }, mine: boolean): Done => {
  // вернувшееся в шляпу слово видит только объясняющий — его ещё будут тянуть
  const back = s.hat.includes(d.slip) || s.cur === d.slip;
  return { w: back && !mine ? '' : d.w, res: d.res, ...(d.last ? { last: true } : {}) };
};

export function makeView(s: State, seats: number[] | 'all'): View {
  const all = seats === 'all';
  const isExp = all || seats.includes(s.exp);
  const showWord = isExp && (s.phase === 'explain' || s.phase === 'last') && s.cur != null;
  const slip = s.cur != null ? s.slips[s.cur] : null;
  const myWords: Record<number, string[]> = {};
  for (const x of s.seats) if ((all || seats.includes(x)) && s.written[x]) myWords[x] = s.written[x];
  return {
    gid: s.gid,
    seats: s.seats,
    humans: s.humans,
    time: s.time,
    last: s.last,
    miss: s.miss,
    skip: s.skip,
    pairs: s.pairs,
    rounds: s.rounds,
    own: s.own,
    per: s.per,
    phase: s.phase,
    round: s.round,
    t: s.t,
    exp: s.exp,
    gue: s.gue,
    teams: s.pairs === 'teams' ? teamsOf(s.seats) : null,
    hatLeft: s.hat.length,
    total: s.slips.length - s.burned.length,
    word: showWord ? slip!.w : null,
    wi: showWord && slip!.i != null ? slip!.i : null,
    seq: s.seq,
    hints: s.hints,
    hintsLeft: slip?.i != null && (s.phase === 'explain' || s.phase === 'last') ? hintsFor(slip.i, s.round).length - s.hints.length : 0,
    tries: s.tries,
    options: s.options,
    virt: s.virt,
    used: s.used,
    need: s.need,
    turn: s.turn.map((d) => hideW(s, d, isExp)),
    expl: s.expl,
    gues: s.gues,
    written: s.seats.filter((x) => x in s.written),
    myWords,
    log: s.log,
    seenI: s.seen.map((k) => s.slips[k].i).filter((i): i is number => i != null),
    seenW: s.seen.map((k) => s.slips[k].w),
  };
}

/** Слово на бумажке видит только объясняющий; пропущенное или вернувшееся — тоже только он. */
export function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all') return ev;
  switch (ev.type) {
    case 'draw':
    case 'skip':
    case 'back':
      return seats.includes(ev.exp) ? ev : { ...ev, w: null };
    case 'miss':
      return ev.burn || seats.includes(ev.exp) ? ev : { ...ev, w: null };
  }
  return ev;
}

/** Счёт игрока: объяснил + угадал. */
export const total = (v: Pick<View, 'expl' | 'gues'>, x: number) => (v.expl[x] ?? 0) + (v.gues[x] ?? 0);

/** Счёт команды — угаданные ею слова. */
export const teamScore = (v: Pick<View, 'gues'>, team: number[]) => team.reduce((a, x) => a + (v.gues[x] ?? 0), 0);
