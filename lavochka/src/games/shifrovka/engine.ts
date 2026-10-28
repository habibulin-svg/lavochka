/* Шифровка — движок. Поле 5×5 слов; у каждой из двух команд свой капитан, он один видит ключ — какие слова чьи.
 * Капитан даёт подсказку: одно слово и число; команда открывает слова по одному (не больше числа + 1). Своё — можно дальше,
 * нейтральное или чужое — ход переходит, ловушка — команда проиграла. Кто первым открыл все свои слова — победил.
 * «Одной командой» (2–8): чужие слова открывает «соперник» — по одному после каждого хода команды; открыл все — поражение.
 * Словарь свой (tools/shifrovka): частотные слова и немного топонимов. Без DOM. */
import type { Options, Rng } from '../../core/types';
import DATA from './words.json';

/** Цвет слова: команды 0 и 1, нейтральное, ловушка. */
export type Kind = 0 | 1 | 'n' | 'x';
export type Phase = 'clue' | 'guess' | 'over';

export const WORDS: string[] = DATA.words;
export const TOPO: string[] = DATA.topo;

export interface Clue {
  team: number;
  by: number;
  word: string;
  /** Число; 0 — «ноль» (ни одно своё не подходит), -1 — «сколько угодно». */
  n: number;
  /** Что открыли по этой подсказке (номера клеток). */
  picks: number[];
}

export interface State {
  seats: number[];
  humans: number[];
  coop: boolean;
  teams: number[][];
  captains: number[];
  words: string[];
  key: Kind[];
  /** Кто открыл клетку (null — закрыта); -1 — «соперник» в игре одной командой. */
  opened: (number | null)[];
  phase: Phase;
  turn: number;
  /** Сколько ещё можно открыть по текущей подсказке. */
  left: number;
  clues: Clue[];
  /** Пометки отгадчиков: клетка → кто пометил. */
  marks: Record<number, number[]>;
  /** Ходов команды (одной командой). */
  rounds: number;
  winner: number | null;
  reason: string;
}

export type Action = { type: 'clue'; word: string; n: number } | { type: 'guess'; index: number } | { type: 'stop' } | { type: 'mark'; index: number };

export type Event =
  | { type: 'turn'; team: number; captain: number; coop?: boolean }
  | { type: 'clue'; team: number; by: number; word: string; n: number }
  | { type: 'guess'; seat: number; index: number; word: string; kind: Kind }
  | { type: 'stop'; seat: number }
  | { type: 'rival'; index: number; word: string }
  | { type: 'mark'; seat: number; index: number }
  | { type: 'over'; winner: number | null; reason: string };

export interface View {
  seats: number[];
  humans: number[];
  coop: boolean;
  teams: number[][];
  captains: number[];
  words: string[];
  /** Ключ: целиком — капитанам (и в конце), иначе только открытые. */
  key: (Kind | null)[];
  /** Видит ли этот экран весь ключ. */
  fullKey: boolean;
  opened: (number | null)[];
  phase: Phase;
  turn: number;
  left: number;
  clues: Clue[];
  marks: Record<number, number[]>;
  rounds: number;
  /** Сколько закрытых слов осталось у команд (0, 1). */
  remain: number[];
  winner: number | null;
  reason: string;
}

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

function shuffle<T>(a: T[], rng: Rng): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Для сравнений: строчные, ё → е. */
export const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е');

/** Команды: через одного по местам; одной командой — все вместе. Капитан — первый в команде. */
export const teamsFor = (seats: number[], coop: boolean): number[][] => (coop ? [seats.slice()] : [seats.filter((_, i) => i % 2 === 0), seats.filter((_, i) => i % 2 === 1)]);

export const teamOf = (s: Pick<State, 'teams'>, seat: number) => s.teams.findIndex((t) => t.includes(seat));

export function setup(seats: number[], opts: Options, rng: Rng, humans: number[] = []): State {
  // меньше четырёх на две команды не хватит — играем одной командой
  const coop = opts.mode === 'coop' || seats.length < 4;
  const traps = opts.traps === 3 || opts.traps === '3' ? 3 : 1;
  const topo = opts.topo !== false;
  const teams = teamsFor(seats, coop);
  // слова: из топонимов — не больше трёх
  const pool = shuffle(WORDS.slice(), rng).slice(0, 25);
  if (topo) {
    const t = shuffle(TOPO.slice(), rng).slice(0, 1 + rng.int(3));
    pool.splice(0, t.length, ...t);
  }
  const words = shuffle(pool, rng);
  const first = coop ? 0 : rng.int(2);
  const key: Kind[] = [...Array(9).fill(first), ...Array(8).fill(coop ? 1 : 1 - first), ...Array(8 - traps).fill('n'), ...Array(traps).fill('x')];
  shuffle(key, rng);
  return {
    seats: seats.slice(),
    humans: humans.filter((x) => seats.includes(x)),
    coop,
    teams,
    captains: teams.map((t) => t[0]),
    words,
    key,
    opened: Array(25).fill(null),
    phase: 'clue',
    turn: first,
    left: 0,
    clues: [],
    marks: {},
    rounds: 1,
    winner: null,
    reason: '',
  };
}

/** Отгадчики команды t. */
export const guessers = (s: Pick<State, 'teams' | 'captains'>, t: number) => s.teams[t].filter((x) => x !== s.captains[t]);

export function toAct(s: State): number[] {
  if (s.phase === 'clue') return [s.captains[s.turn]];
  if (s.phase === 'guess') {
    const g = guessers(s, s.turn);
    const hum = g.filter((x) => s.humans.includes(x));
    // люди решают сами; без людей — один бот за команду
    return hum.length ? hum : g.slice(0, 1);
  }
  return [];
}

/** Можно ли дать такую подсказку: одно слово, не слово с поля и не однокоренное с ним (грубо — по общему началу). */
export function clueProblem(word: string, board: string[], opened: (number | null)[]): string | null {
  const w = norm(word);
  if (!/^[а-я]+(-[а-я]+)?$/.test(w)) return 'Подсказка — одно русское слово.';
  if (w.length < 2 || w.length > 24) return 'Подсказка — одно слово от 2 до 24 букв.';
  for (let i = 0; i < board.length; i++) {
    if (opened[i] != null) continue;
    const b = norm(board[i]);
    if (w === b) return 'Это слово лежит на поле.';
    let k = 0;
    while (k < w.length && k < b.length && w[k] === b[k]) k++;
    if ((k >= 3 && (k === w.length || k === b.length)) || k >= Math.max(4, Math.min(w.length, b.length) - 1)) return `Слишком похоже на «${board[i]}» с поля.`;
  }
  return null;
}

/** Закрытых слов вида k. */
const closed = (s: Pick<State, 'key' | 'opened'>, k: Kind) => s.key.filter((x, i) => x === k && s.opened[i] == null).length;

function win(s: State, winner: number | null, reason: string, ev: Event[]) {
  s.winner = winner;
  s.reason = reason;
  s.phase = 'over';
  ev.push({ type: 'over', winner, reason });
}

function endTurn(s: State, rng: Rng, ev: Event[]) {
  s.marks = {};
  if (s.coop) {
    // соперник открывает одно своё слово
    const rest = s.key.map((k, i) => (k === 1 && s.opened[i] == null ? i : -1)).filter((i) => i >= 0);
    if (rest.length) {
      const i = rest[rng.int(rest.length)];
      s.opened[i] = -1;
      ev.push({ type: 'rival', index: i, word: s.words[i] });
    }
    if (!closed(s, 1)) return win(s, null, 'соперник открыл все свои слова первым', ev);
    s.rounds++;
  } else s.turn = 1 - s.turn;
  s.phase = 'clue';
  ev.push({ type: 'turn', team: s.turn, captain: s.captains[s.turn], ...(s.coop ? { coop: true } : {}) });
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (!a || typeof a !== 'object' || s0.phase === 'over' || !toAct(s0).includes(seat)) return null;
  const s = clone(s0);
  const ev: Event[] = [];
  switch (a.type) {
    case 'clue': {
      if (s.phase !== 'clue' || typeof a.word !== 'string' || !Number.isInteger(a.n) || a.n < -1 || a.n > 9) return null;
      if (clueProblem(a.word, s.words, s.opened)) return null;
      const word = a.word.trim().toLowerCase();
      s.clues.push({ team: s.turn, by: seat, word, n: a.n, picks: [] });
      s.left = a.n > 0 ? a.n + 1 : 25;
      s.phase = 'guess';
      ev.push({ type: 'clue', team: s.turn, by: seat, word, n: a.n });
      break;
    }
    case 'guess': {
      const i = a.index;
      if (s.phase !== 'guess' || !Number.isInteger(i) || i < 0 || i >= 25 || s.opened[i] != null) return null;
      s.opened[i] = seat;
      const k = s.key[i];
      const c = s.clues[s.clues.length - 1];
      c.picks.push(i);
      delete s.marks[i];
      ev.push({ type: 'guess', seat, index: i, word: s.words[i], kind: k });
      if (k === 'x') {
        win(s, s.coop ? null : 1 - s.turn, s.coop ? 'открыта ловушка' : `команда ${s.turn ? 'синих' : 'красных'} открыла ловушку`, ev);
        break;
      }
      if (k === 0 || k === 1) {
        if (!closed(s, k)) {
          if (s.coop) win(s, k === 0 ? 0 : null, k === 0 ? 'все свои слова найдены' : 'открыты все слова соперника', ev);
          else win(s, k, k === s.turn ? 'открыты все свои слова' : 'соперники открыли за них последнее слово', ev);
          break;
        }
      }
      if (k !== s.turn) {
        endTurn(s, rng, ev);
        break;
      }
      s.left--;
      if (s.left <= 0) endTurn(s, rng, ev);
      break;
    }
    case 'stop': {
      if (s.phase !== 'guess' || !s.clues[s.clues.length - 1]?.picks.length) return null;
      ev.push({ type: 'stop', seat });
      endTurn(s, rng, ev);
      break;
    }
    case 'mark': {
      const i = a.index;
      if (s.phase !== 'guess' || !Number.isInteger(i) || i < 0 || i >= 25 || s.opened[i] != null) return null;
      const m = s.marks[i] ?? [];
      s.marks[i] = m.includes(seat) ? m.filter((x) => x !== seat) : [...m, seat];
      if (!s.marks[i].length) delete s.marks[i];
      ev.push({ type: 'mark', seat, index: i });
      break;
    }
    default:
      return null;
  }
  return { state: s, events: ev };
}

export function makeView(s: State, seats: number[] | 'all'): View {
  const over = s.phase === 'over';
  const full = seats === 'all' || over || s.captains.some((c) => seats.includes(c));
  return {
    seats: s.seats,
    humans: s.humans,
    coop: s.coop,
    teams: s.teams,
    captains: s.captains,
    words: s.words,
    key: s.key.map((k, i) => (full || s.opened[i] != null ? k : null)),
    fullKey: full,
    opened: s.opened.slice(),
    phase: s.phase,
    turn: s.turn,
    left: s.left,
    clues: clone(s.clues),
    marks: clone(s.marks),
    rounds: s.rounds,
    remain: [closed(s, 0), closed(s, 1)],
    winner: s.winner,
    reason: s.reason,
  };
}

export const TEAM_NAME = ['красные', 'синие'];
export const TEAM_OF = ['красных', 'синих'];
export const nText = (n: number) => (n < 0 ? '∞' : String(n));
