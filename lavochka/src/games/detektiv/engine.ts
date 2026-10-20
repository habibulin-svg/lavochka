/* «Детективы» — движок. Дела из сборников задач (инспектор Варнике, Анискин, Людовик…): условие и четыре версии
 * лежат в public/detektiv (их показывает вид), а какая версия верная, наводки и разгадка — здесь, в ключе (`data/key.ts`),
 * и игрок получает их, только когда взял наводку или закрыл дело. Режимы: «Сыщик» — каждый в своём темпе, звание по
 * очкам; «Следственная бригада» — одно дело на всех, очки общие; «Кто быстрее» — одно дело на всех, очки тому, кто
 * первым назовёт верную версию, ошибся — выбыл из этого дела. Дела, которые кто-то за столом уже читал (списки присылают
 * браузеры — действие seen), заменяем на нечитанные; «уже читал» (swap) — заменить текущее. Без DOM. */
import { addSeen, freshest, type Avoid } from '../../core/fresh';
import type { Options, Rng } from '../../core/types';
import { shuffle } from '../../core/rng';
import KEY from './data/key';

/** Запись ключа: книга, сложность, верная версия (индекс в перемешанных options), наводки, разгадка. */
export interface Key {
  id: number;
  book: string;
  lv: 1 | 2 | 3;
  pic: boolean;
  ok: number;
  hints: [string, string];
  short: string;
  answer: string;
}

export const KEYS: Key[] = KEY;
const byId = new Map(KEYS.map((k) => [k.id, k]));
export const keyOf = (id: number) => byId.get(id)!;

export const BOOKS: { id: string; title: string; who: string }[] = [
  { id: 'varnike', title: 'Инспектор Варнике', who: 'инспектор Варнике' },
  { id: 'ludovik', title: 'Людовик', who: 'сыщик Людовик (дело в картинках)' },
  { id: 'aniskin', title: 'Анискин', who: 'сыщик Анискин' },
  { id: 'werner', title: 'Инспектор Вернер', who: 'инспектор Вернер' },
  { id: 'seitim', title: 'Майор Сейтимбетов', who: 'следователь Сейтимбетов' },
  { id: 'meridit', title: 'Инспектор Меридит', who: 'инспектор Меридит' },
  { id: 'quick', title: 'Квик', who: 'сыщик Квик' },
  { id: 'borg', title: 'Инспектор Борг', who: 'инспектор Борг' },
  { id: 'holmes', title: 'Шерлок Холмс и другие', who: 'сыщики-любители' },
  { id: 'zagadki', title: 'Загадки', who: 'короткие детективные загадки' },
];
export const bookOf = (id: string) => BOOKS.find((b) => b.id === id) ?? BOOKS[0];

/** Очки за дело по сложности; наводка −1, неверная версия −2; норматив (сек) — +1. */
export const PTS = { 1: 3, 2: 4, 3: 5 } as const;
export const PAR = { 1: 120, 2: 240, 3: 420 } as const;

export type Mode = 'solo' | 'team' | 'race';
export type Answer = 'choice' | 'free';

export interface Cfg {
  mode: Mode;
  answer: Answer;
  count: number;
  /** 0 — любые, 1–3 — только этой сложности, -1 — растёт к концу. */
  lvl: number;
  /** '' — все книги. */
  book: string;
}

export interface Mark {
  ok: boolean;
  pts: number;
  sec: number;
  hints: number;
  wrong: number;
  par: boolean;
  /** Свободный ответ: как оценил себя игрок (2 — угадал, 1 — частично, 0 — нет). */
  self?: number;
}

/** Дело на столе у игрока (в «Сыщике») или у всех (бригада, «кто быстрее»). */
export interface Board {
  i: number;
  t0: number;
  /** solve — думаем; check — свободный ответ записан, разгадка открыта, ждём самооценку; done — закрыто. */
  phase: 'solve' | 'check' | 'done';
  hints: number;
  /** Отброшенные (неверно выбранные) версии. */
  wrongs: number[];
  /** Свободный ответ (что написал игрок). */
  text?: string;
  score: number;
  marks: Mark[];
  /** «Кто быстрее»: выбывшие из текущего дела, кто его закрыл и кто уже нажал «дальше». */
  out?: number[];
  by?: number;
  ready?: number[];
  thinks?: number;
}

export interface State {
  cfg: Cfg;
  seats: number[];
  list: number[];
  /** solo — доска на место; team/race — одна доска под ключом -1. */
  boards: Record<number, Board>;
  /** Очки по местам (в бригаде у всех одинаковые). */
  scores: Record<number, number>;
  turn: number;
  /** Виденные кем-то за столом: номер дела → минута (core/fresh.ts). */
  avoid?: Avoid;
  /** Кто уже прислал свой список (повторно — после переподключения — дела не меняем). */
  told?: number[];
}

export type Action =
  | { t: 'pick'; k: number }
  | { t: 'free'; text: string }
  | { t: 'self'; v: number }
  | { t: 'hint' }
  | { t: 'skip' }
  | { t: 'next' }
  | { t: 'think' }
  /** Браузер игрока: какие дела он уже читал — [[номер, минута], …] (вне очереди). */
  | { t: 'seen'; ids: [number, number][] }
  /** «Уже читал это дело» — заменить текущее. */
  | { t: 'swap' };

export type Event =
  | { type: 'open'; seat: number; i: number }
  | { type: 'hint'; seat: number; i: number; k: number }
  | { type: 'wrong'; seat: number; i: number; k: number }
  | { type: 'free'; seat: number; i: number; text: string }
  | { type: 'solved'; seat: number; i: number; mark: Mark }
  | { type: 'skip'; seat: number; i: number }
  | { type: 'finish'; seat: number; score: number }
  /** Дело i заменили: seat — кто сказал «уже читал», null — по спискам прочитанного. */
  | { type: 'swap'; seat: number | null; i: number; n?: number };

/** Что видно о деле: номер (текст вид берёт из public), сложность, книга; наводки — сколько взято; ключ — когда закрыто. */
export interface CaseView {
  id: number;
  book: string;
  lv: number;
  pic: boolean;
  hints: string[];
  /** Открыто после закрытия дела (или после свободного ответа). */
  sol?: { ok: number; short: string; answer: string };
}

export interface BoardView extends Omit<Board, 'text'> {
  cur?: CaseView;
  text?: string;
}

export interface View {
  cfg: Cfg;
  seats: number[];
  total: number;
  max: number;
  shared: boolean;
  boards: Record<number, BoardView>;
  scores: Record<number, number>;
}

export const SHARED = -1;

export function cfgOf(o: Options): Cfg {
  const mode: Mode = o.mode === 'team' || o.mode === 'race' ? o.mode : 'solo';
  const answer: Answer = o.answer === 'free' ? 'free' : 'choice';
  const count = Math.max(1, Math.min(30, Number(o.count ?? 5) || 5));
  const lvl = Number(o.lvl ?? -1);
  const book = BOOKS.some((b) => b.id === o.book) ? String(o.book) : '';
  // «кто быстрее» — только с выбором версии: свободный ответ не с чем сравнить
  return { mode, answer: mode === 'race' ? 'choice' : answer, count, lvl: [0, 1, 2, 3].includes(lvl) ? lvl : -1, book };
}

/** Подбор дел: из книги (или всех), по сложности; «растёт» — сначала лёгкие. Дела в картинках — только с выбором версии? нет: картинки показываются. */
export function makeList(c: Cfg, rng: Rng): number[] {
  const pool = KEYS.filter((k) => !c.book || k.book === c.book);
  const want = (lv: number) => {
    const p = pool.filter((k) => k.lv === lv);
    return p.length ? p : pool;
  };
  if (c.lvl > 0) return shuffle(want(c.lvl), rng).slice(0, c.count).map((k) => k.id);
  if (c.lvl === 0) return shuffle(pool, rng).slice(0, c.count).map((k) => k.id);
  const out: number[] = [];
  for (let i = 0; i < c.count; i++) {
    const lv = Math.min(3, 1 + Math.floor((i * 3) / c.count));
    const cand = shuffle(want(lv), rng).find((k) => !out.includes(k.id)) ?? shuffle(pool, rng).find((k) => !out.includes(k.id));
    if (cand) out.push(cand.id);
  }
  return out;
}

const fresh = (now: number): Board => ({ i: 0, t0: now, phase: 'solve', hints: 0, wrongs: [], score: 0, marks: [] });

export function newState(c: Cfg, seats: number[], rng: Rng, now = Date.now()): State {
  const list = makeList(c, rng);
  const boards: Record<number, Board> = {};
  if (c.mode === 'solo') for (const s of seats) boards[s] = fresh(now);
  else boards[SHARED] = { ...fresh(now), out: [], ready: [] };
  const scores: Record<number, number> = {};
  for (const s of seats) scores[s] = 0;
  return { cfg: c, seats, list, boards, scores, turn: 0 };
}

/** Дело номер j в списке можно заменить, пока ни у кого оно не закрыто (разгадку не видели). */
export const canSwap = (s: { boards: Record<number, Pick<Board, 'i' | 'phase'>> }, j: number) =>
  Object.values(s.boards).every((b) => b.i !== j || b.phase === 'solve');

/** Заменить дело j на нечитанное той же трудности (из той же книги); false — заменить нечем. */
function replace(s: State, j: number, rng: Rng, now: number): boolean {
  if (!canSwap(s, j)) return false;
  const lv = keyOf(s.list[j]).lv;
  const pool = KEYS.filter((k) => (!s.cfg.book || k.book === s.cfg.book) && !s.list.includes(k.id));
  const same = pool.filter((k) => k.lv === lv);
  const k = freshest(same.length ? same : pool, (x) => x.id, s.avoid ?? {}, rng);
  if (!k) return false;
  s.list = s.list.map((x, n) => (n === j ? k.id : x));
  const boards = { ...s.boards };
  for (const [x, b] of Object.entries(boards))
    if (b.i === j) boards[Number(x)] = { ...b, t0: now, hints: 0, wrongs: [], text: undefined, thinks: 0, out: b.out ? [] : undefined, by: undefined };
  s.boards = boards;
  return true;
}

/** Прочитанное за столом и «уже читал». */
function seenSwap(s0: State, seat: number, a: Extract<Action, { t: 'seen' } | { t: 'swap' }>, rng: Rng, now: number): { state: State; events: Event[] } | null {
  const s: State = { ...s0, avoid: { ...(s0.avoid ?? {}) }, told: [...(s0.told ?? [])] };
  const ev: Event[] = [];
  if (a.t === 'seen') {
    const got = new Set(addSeen(s.avoid!, a.ids));
    if (s.told!.includes(seat)) return { state: s, events: ev };
    s.told!.push(seat);
    // впереди и на столе (ещё не закрытые) — меняем прочитанные на свежие
    const from = Math.min(...Object.values(s.boards).map((b) => b.i));
    const done: number[] = [];
    for (let j = Math.max(0, from); j < s.list.length; j++) if (got.has(s.list[j]) && replace(s, j, rng, now)) done.push(j);
    if (done.length) ev.push({ type: 'swap', seat: null, i: done[0], n: done.length });
    return { state: s, events: ev };
  }
  const b = s.boards[boardKey(s, seat)];
  if (!b || b.i >= s.list.length || b.phase !== 'solve' || (b.out ?? []).includes(seat)) return null;
  s.avoid![s.list[b.i]] = Math.max(s.avoid![s.list[b.i]] ?? 0, 1);
  if (!replace(s, b.i, rng, now)) return null;
  ev.push({ type: 'swap', seat, i: b.i });
  return { state: s, events: ev };
}

/** Вне очереди: прислать прочитанное и «уже читал». */
export const free = (s: State, seat: number, a: Action) => s.seats.includes(seat) && !!a && (a.t === 'seen' || a.t === 'swap');

const boardKey = (s: State, seat: number) => (s.cfg.mode === 'solo' ? seat : SHARED);

/** Кто может ходить: в «Сыщике» — все, кто не дочитал; в бригаде и гонке — все, пока дела не кончились
 * (в гонке выбывшие ждут; после закрытия дела — те, кто ещё не нажал «дальше»). */
export function toAct(s: State): number[] {
  let live: number[];
  if (s.cfg.mode === 'solo') live = s.seats.filter((x) => s.boards[x].i < s.list.length);
  else {
    const b = s.boards[SHARED];
    if (b.i >= s.list.length) return [];
    if (b.phase === 'done' && s.cfg.mode === 'race') live = s.seats.filter((x) => !(b.ready ?? []).includes(x));
    else if (s.cfg.mode === 'race') live = s.seats.filter((x) => !(b.out ?? []).includes(x));
    else live = s.seats;
    if (!live.length) live = s.seats;
  }
  if (!live.length) return [];
  const k = s.turn % live.length;
  return [...live.slice(k), ...live.slice(0, k)];
}

export const scoreOf = (lv: number, hints: number, wrong: number, par: boolean) =>
  Math.max(1, PTS[lv as 1 | 2 | 3] - hints - 2 * wrong) + (par ? 1 : 0);

export function maxScore(s: { list: number[] }): number {
  return s.list.reduce((t, id) => t + PTS[keyOf(id).lv] + 1, 0);
}

function close(s: State, b: Board, seat: number, ok: boolean, now: number, self?: number): { b: Board; mark: Mark } {
  const k = keyOf(s.list[b.i]);
  const sec = Math.max(0, Math.round((now - b.t0) / 1000));
  const wrong = b.wrongs.length;
  const par = ok && sec <= PAR[k.lv];
  let pts = ok ? scoreOf(k.lv, b.hints, wrong, par) : 0;
  if (self === 1) pts = Math.max(1, Math.floor(pts / 2));
  const mark: Mark = { ok, pts, sec, hints: b.hints, wrong, par, ...(self != null ? { self } : {}) };
  return { b: { ...b, phase: 'done', score: b.score + pts, marks: [...b.marks, mark], by: seat, ready: [] }, mark };
}

export function apply(s0: State, seat: number, a: Action, rng: Rng, now = Date.now()): { state: State; events: Event[] } | null {
  if (!a || typeof a !== 'object' || !s0.seats.includes(seat)) return null;
  if (a.t === 'seen' || a.t === 'swap') return seenSwap(s0, seat, a, rng, now);
  const key = boardKey(s0, seat);
  const b0 = s0.boards[key];
  if (!b0 || b0.i >= s0.list.length) return null;
  const k = keyOf(s0.list[b0.i]);
  const race = s0.cfg.mode === 'race';
  const ev: Event[] = [];
  let b: Board = b0;
  const scores = { ...s0.scores };
  const credit = (pts: number) => {
    if (s0.cfg.mode === 'team') for (const x of s0.seats) scores[x] += pts;
    else scores[seat] += pts;
  };
  const outNow = (b0.out ?? []).includes(seat);
  switch (a.t) {
    case 'think':
      b = { ...b0, thinks: (b0.thinks ?? 0) + 1 };
      break;
    case 'hint': {
      if (b0.phase !== 'solve' || b0.hints >= 2 || outNow) return null;
      b = { ...b0, hints: b0.hints + 1 };
      ev.push({ type: 'hint', seat, i: b0.i, k: b0.hints });
      break;
    }
    case 'pick': {
      if (b0.phase !== 'solve' || outNow || s0.cfg.answer !== 'choice') return null;
      const n = Number(a.k);
      if (!Number.isInteger(n) || n < 0 || n > 3 || b0.wrongs.includes(n)) return null;
      if (n !== k.ok) {
        ev.push({ type: 'wrong', seat, i: b0.i, k: n });
        if (race) {
          const out = [...(b0.out ?? []), seat];
          b = { ...b0, out };
          // все выбыли — дело закрыто без победителя
          if (s0.seats.every((x) => out.includes(x))) {
            const r = close(s0, b, seat, false, now);
            b = r.b;
            ev.push({ type: 'skip', seat, i: b0.i });
          }
        } else {
          b = { ...b0, wrongs: [...b0.wrongs, n] };
          // осталась одна версия — она и верная: дело закрыто, но без очков
          if (b.wrongs.length >= 3) {
            const r = close(s0, b, seat, false, now);
            b = r.b;
            ev.push({ type: 'skip', seat, i: b0.i });
          }
        }
        break;
      }
      const r = close(s0, b0, seat, true, now);
      b = r.b;
      credit(r.mark.pts);
      ev.push({ type: 'solved', seat, i: b0.i, mark: r.mark });
      break;
    }
    case 'free': {
      if (b0.phase !== 'solve' || s0.cfg.answer !== 'free') return null;
      const text = String(a.text ?? '').slice(0, 2000).trim();
      if (!text) return null;
      b = { ...b0, phase: 'check', text, by: seat };
      ev.push({ type: 'free', seat, i: b0.i, text });
      break;
    }
    case 'self': {
      if (b0.phase !== 'check') return null;
      const v = Number(a.v);
      if (![0, 1, 2].includes(v)) return null;
      const r = close(s0, b0, seat, v > 0, now, v);
      b = r.b;
      credit(r.mark.pts);
      ev.push(v > 0 ? { type: 'solved', seat, i: b0.i, mark: r.mark } : { type: 'skip', seat, i: b0.i });
      break;
    }
    case 'skip': {
      if (b0.phase === 'done') return null;
      if (race && b0.phase === 'solve') {
        // в гонке «сдаться» = выбыть из дела
        if (outNow) return null;
        const out = [...(b0.out ?? []), seat];
        b = { ...b0, out };
        if (s0.seats.every((x) => out.includes(x))) b = close(s0, b, seat, false, now).b;
        ev.push({ type: 'skip', seat, i: b0.i });
        break;
      }
      b = close(s0, b0, seat, false, now).b;
      ev.push({ type: 'skip', seat, i: b0.i });
      break;
    }
    case 'next': {
      if (b0.phase !== 'done') return null;
      if (race) {
        const ready = [...new Set([...(b0.ready ?? []), seat])];
        if (!s0.seats.every((x) => ready.includes(x))) {
          b = { ...b0, ready };
          break;
        }
      }
      const i = b0.i + 1;
      b = { ...b0, i, t0: now, phase: 'solve', hints: 0, wrongs: [], text: undefined, thinks: 0, out: race ? [] : b0.out, ready: [], by: undefined };
      if (i < s0.list.length) ev.push({ type: 'open', seat, i });
      else ev.push({ type: 'finish', seat, score: s0.cfg.mode === 'solo' ? b0.score : Math.max(...s0.seats.map((x) => scores[x])) });
      break;
    }
    default:
      return null;
  }
  if (s0.cfg.mode === 'solo') scores[seat] = b.score;
  return { state: { ...s0, boards: { ...s0.boards, [key]: b }, scores, turn: s0.turn + 1 }, events: ev };
}

function caseView(id: number, hints: number, open: boolean): CaseView {
  const k = keyOf(id);
  return { id, book: k.book, lv: k.lv, pic: k.pic, hints: k.hints.slice(0, hints), ...(open ? { sol: { ok: k.ok, short: k.short, answer: k.answer } } : {}) };
}

export function view(s: State, seats: number[] | 'all'): View {
  const boards: Record<number, BoardView> = {};
  for (const [x, b] of Object.entries(s.boards)) {
    const n = Number(x);
    const own = n === SHARED || seats === 'all' || seats.includes(n);
    const bv: BoardView = { ...b };
    if (own && b.i < s.list.length) bv.cur = caseView(s.list[b.i], b.hints, b.phase !== 'solve');
    else delete bv.text;
    boards[n] = bv;
  }
  return { cfg: s.cfg, seats: s.seats, total: s.list.length, max: maxScore(s), shared: s.cfg.mode !== 'solo', boards, scores: s.scores };
}

export function redact(ev: Event, seats: number[] | 'all'): Event | null {
  return ev;
}

/** Звание по доле от возможного. */
export function rank(score: number, max: number): { title: string; icon: string } {
  const f = max ? score / max : 0;
  if (f >= 0.9) return { title: 'Комиссар', icon: '🎖' };
  if (f >= 0.75) return { title: 'Старший инспектор', icon: '⭐' };
  if (f >= 0.6) return { title: 'Инспектор', icon: '🔎' };
  if (f >= 0.45) return { title: 'Сыщик', icon: '🕵' };
  if (f >= 0.3) return { title: 'Младший сыщик', icon: '📓' };
  return { title: 'Стажёр', icon: '📎' };
}

export function result(s: State) {
  if (toAct(s).length) return null;
  const max = maxScore(s);
  const scores = { ...s.scores };
  const best = Math.max(...s.seats.map((x) => scores[x]));
  const winners = s.cfg.mode === 'team' ? [...s.seats] : s.seats.filter((x) => scores[x] === best);
  const r = rank(best, max);
  const text =
    s.cfg.mode === 'team'
      ? `${r.icon} Бригада — «${r.title}»: ${best} очков из ${max}`
      : s.seats.length === 1
        ? `${r.icon} Звание «${r.title}»: ${best} очков из ${max}`
        : `${r.icon} «${r.title}» — ${best} очков из ${max}`;
  return { winners, text, scores };
}
