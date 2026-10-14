/* Виселица — движок без DOM.
 * Режимы: обычная (все отгадывают одно слово, общая виселица), командная (две команды, у каждой своё слово и своя виселица,
 * кто первым отгадал — тот выиграл кон), обратная (человечек уже висит, угаданные буквы стирают виселицу по частям),
 * аукцион (перед каждой буквой — тайные ставки очками; кто дал больше, тот и называет букву).
 * Слово загадывает компьютер (из базы вопросов кроссвордов, с подсказкой) или игроки по очереди (проверка по словарю). */
import type { Options, Rng } from '../../core/types';
import { allClues } from '../../words/clues';
import { ALPHABET, hasWord, norm } from '../../words/dict';

export type Mode = 'classic' | 'team' | 'reverse' | 'auction';

/** Части рисунка по порядку: сначала виселица, потом человечек. При 6 ошибках виселица нарисована заранее. */
export const PARTS = ['основание', 'столб', 'перекладина', 'верёвка', 'голова', 'туловище', 'левая рука', 'правая рука', 'левая нога', 'правая нога'];

/** Слово в игре: у обычной, обратной и аукциона — одно, у командной — по одному на команду. */
export interface Puzzle {
  word: string;
  hint: string;
  /** Названные буквы (и верные, и нет) — по порядку. */
  letters: string[];
  misses: number;
  /** Неверно названные слова. */
  wrongWords: string[];
  solved: boolean;
  hanged: boolean;
}

export interface State {
  mode: Mode;
  seats: number[];
  /** Сколько ошибок до конца: 6 или 10. */
  limit: number;
  showHint: boolean;
  diff: number;
  rounds: number;
  round: number;
  /** Загадывает игрок (по кругу) или компьютер (−1). */
  byPlayers: boolean;
  setter: number;
  /** Команды (командная): места по командам. */
  teams: number[][];
  puzzles: Puzzle[];
  /** Чей ход (место) и чья очередь в каждой команде. */
  turn: number;
  /** Командная: какая команда ходит. */
  team: number;
  teamIdx: number[];
  /** Очередь отгадчиков (обычная, обратная, аукцион): индекс в guessers. */
  gIdx: number;
  scores: Record<number, number>;
  /** Аукцион: тайные ставки этого хода и с кого начинается круг. */
  bids: Record<number, number>;
  lead: number;
  /** Фаза: загадать слово, отгадывать, ставки, кон окончен, партия окончена. */
  phase: 'set' | 'guess' | 'bid' | 'between' | 'over';
  /** Итог кона: кто выиграл (места). */
  roundWinners: number[];
  /** Использованные слова — чтобы не повторялись. */
  used: string[];
}

export type Action =
  | { type: 'set'; word: string }
  | { type: 'letter'; l: string }
  | { type: 'word'; word: string }
  | { type: 'bid'; n: number }
  | { type: 'next' };

export type Event =
  | { type: 'set'; seat: number; len: number }
  | { type: 'letter'; seat: number; l: string; hit: number; p: number }
  | { type: 'word'; seat: number; word: string; ok: boolean; p: number }
  | { type: 'bids'; bids: Record<number, number>; winner: number; paid: number }
  | { type: 'round'; round: number; words: string[]; winners: number[]; hanged: boolean[] }
  | { type: 'newround'; round: number; setter: number }
  | { type: 'end'; winners: number[]; scores: Record<number, number> };

/** Очки: за каждую открытую букву, бонус за слово целиком, ведущему за повешенного, банк аукциона. */
export const PTS = { letter: 1, wordBonus: 3, hanged: 5, auctionBank: 50, auctionLetter: 10, auctionWord: 20 };

const MIN_LEN = 4;
const MAX_LEN = 12;

/** Подходящие слова для загадки: обиходные слова из базы вопросов, сложность ≤ diff. */
export function pool(diff: number): { word: string; hint: string }[] {
  const out: { word: string; hint: string }[] = [];
  for (const c of allClues()) {
    if (c.kind !== 'слово' || c.diff > diff) continue;
    if (c.word.length < MIN_LEN || c.word.length > MAX_LEN || !/^[а-я]+$/.test(c.word)) continue;
    out.push({ word: c.word, hint: c.short });
  }
  return out;
}

/** Загадать слово компьютером (или ботом-ведущим). length — нужная длина (командная: одинаковые у команд). */
export function drawWord(s: State, rng: Rng, length?: number): { word: string; hint: string } {
  let list = pool(s.diff).filter((x) => !s.used.includes(x.word) && (!length || x.word.length === length));
  if (!list.length) list = pool(3).filter((x) => !length || x.word.length === length);
  if (!list.length) return { word: 'виселица', hint: 'То, во что играем' };
  return list[rng.int(list.length)];
}

export const newPuzzle = (word: string, hint: string): Puzzle => ({ word, hint, letters: [], misses: 0, wrongWords: [], solved: false, hanged: false });

/** Можно ли загадать это слово (ведущий-человек): существительное из словаря, 4–12 букв. */
export function validWord(w: string): string | null {
  const x = norm(w.trim());
  if (!/^[а-я]+$/.test(x)) return 'Только русские буквы, одним словом.';
  if (x.length < MIN_LEN || x.length > MAX_LEN) return `Длина — от ${MIN_LEN} до ${MAX_LEN} букв.`;
  if (!hasWord(x)) return 'Такого существительного нет в словаре.';
  return null;
}

/** Кто отгадывает в этом коне (все, кроме ведущего-игрока). */
export const guessers = (s: State) => s.seats.filter((x) => !(s.byPlayers && x === s.setter));

export const revealed = (p: Puzzle) => [...p.word].every((c) => p.letters.includes(c));
/** Сколько букв слова ещё скрыто. */
export const hidden = (p: Puzzle) => [...p.word].filter((c) => !p.letters.includes(c)).length;

function startRound(s: State, rng: Rng) {
  s.bids = {};
  s.roundWinners = [];
  if (s.mode === 'team') {
    const w = drawWord(s, rng);
    const w2 = drawWord({ ...s, used: [...s.used, w.word] }, rng, w.word.length);
    s.puzzles = [newPuzzle(w.word, w.hint), newPuzzle(w2.word, w2.hint)];
    s.used.push(w.word, w2.word);
    s.team = (s.round - 1) % 2;
    s.turn = s.teams[s.team][s.teamIdx[s.team] % s.teams[s.team].length];
    s.phase = 'guess';
    return;
  }
  const g = guessers(s);
  s.gIdx = (s.round - 1) % g.length;
  s.lead = s.gIdx;
  if (s.byPlayers) {
    s.puzzles = [newPuzzle('', '')];
    s.turn = s.setter;
    s.phase = 'set';
    return;
  }
  const w = drawWord(s, rng);
  s.used.push(w.word);
  s.puzzles = [newPuzzle(w.word, w.hint)];
  s.turn = g[s.gIdx];
  s.phase = s.mode === 'auction' ? 'bid' : 'guess';
}

export function setup(seatList: number[], opts: Options, rng: Rng): State {
  const mode = (['classic', 'team', 'reverse', 'auction'].includes(String(opts.mode)) ? opts.mode : 'classic') as Mode;
  const seats = seatList.slice().sort((a, b) => a - b);
  // ведущий-игрок — только в обычной и обратной, и нужен хотя бы один отгадчик
  const byPlayers = (mode === 'classic' || mode === 'reverse') && opts.setter === 'players' && seats.length >= 2;
  const rounds = byPlayers ? seats.length * Math.max(1, Number(opts.laps) || 1) : Math.max(1, Number(opts.rounds) || 3);
  const s: State = {
    mode,
    seats,
    limit: Number(opts.limit) === 6 ? 6 : 10,
    showHint: opts.hint !== false,
    diff: Math.min(3, Math.max(1, Number(opts.diff) || 1)),
    rounds,
    round: 1,
    byPlayers,
    setter: byPlayers ? seats[0] : -1,
    teams: mode === 'team' ? [seats.filter((_, i) => i % 2 === 0), seats.filter((_, i) => i % 2 === 1)] : [],
    puzzles: [],
    turn: seats[0],
    team: 0,
    teamIdx: [0, 0],
    gIdx: 0,
    scores: Object.fromEntries(seats.map((x) => [x, mode === 'auction' ? PTS.auctionBank : 0])),
    bids: {},
    lead: 0,
    phase: 'guess',
    roundWinners: [],
    used: [],
  };
  startRound(s, rng);
  return s;
}

export function toAct(s: State): number[] {
  switch (s.phase) {
    case 'over':
      return [];
    case 'between':
      return [s.byPlayers ? nextSetter(s) : s.seats[0]];
    case 'bid':
      return guessers(s).filter((x) => s.bids[x] == null);
    default:
      return [s.turn];
  }
}

const nextSetter = (s: State) => s.seats[s.round % s.seats.length];

const clone = (s: State): State => JSON.parse(JSON.stringify(s));

/** Какая головоломка у этого места (командная — своей команды). */
export const puzzleOf = (s: State, seat: number) => (s.mode === 'team' ? s.puzzles[s.teams[0].includes(seat) ? 0 : 1] : s.puzzles[0]);

/** Передать ход следующему отгадчику (после промаха). */
function passTurn(s: State) {
  if (s.mode === 'team') {
    s.teamIdx[s.team] += 1;
    s.team = 1 - s.team;
    s.turn = s.teams[s.team][s.teamIdx[s.team] % s.teams[s.team].length];
    return;
  }
  const g = guessers(s);
  if (s.mode === 'auction') {
    s.lead = (s.lead + 1) % g.length;
    s.bids = {};
    s.phase = 'bid';
    return;
  }
  s.gIdx = (s.gIdx + 1) % g.length;
  s.turn = g[s.gIdx];
}

/** Конец кона, если он наступил. */
function maybeEnd(s: State, ev: Event[]) {
  const ps = s.puzzles;
  let over = false;
  if (s.mode === 'team') {
    if (ps[0].solved || ps[1].solved) {
      const t = ps[0].solved ? 0 : 1;
      s.roundWinners = s.teams[t].slice();
      over = true;
    } else if (ps[0].hanged || ps[1].hanged) {
      const t = ps[0].hanged ? 1 : 0;
      s.roundWinners = s.teams[t].slice();
      over = true;
    }
    if (over) for (const x of s.roundWinners) s.scores[x] += 1;
  } else {
    const p = ps[0];
    if (p.solved) {
      over = true;
      s.roundWinners = [s.turn];
    } else if (p.hanged) {
      over = true;
      if (s.byPlayers) {
        s.scores[s.setter] += PTS.hanged;
        s.roundWinners = [s.setter];
      }
    }
  }
  if (!over) return;
  ev.push({ type: 'round', round: s.round, words: ps.map((p) => p.word), winners: s.roundWinners.slice(), hanged: ps.map((p) => p.hanged) });
  if (s.round >= s.rounds) {
    s.phase = 'over';
    const best = Math.max(...s.seats.map((x) => s.scores[x]));
    ev.push({ type: 'end', winners: s.seats.filter((x) => s.scores[x] === best), scores: { ...s.scores } });
  } else s.phase = 'between';
}

/** Выгоднее назвать букву: сколько открылось. */
function letter(s: State, seat: number, l: string, ev: Event[]): boolean {
  const p = puzzleOf(s, seat);
  if (p.letters.includes(l)) return false;
  p.letters.push(l);
  const hit = [...p.word].filter((c) => c === l).length;
  let pts = 0;
  if (hit) {
    pts = s.mode === 'auction' ? PTS.auctionLetter * hit : s.mode === 'team' ? 0 : PTS.letter * hit;
    s.scores[seat] += pts;
    if (revealed(p)) p.solved = true;
  } else {
    p.misses += 1;
    if (p.misses >= s.limit) p.hanged = true;
  }
  ev.push({ type: 'letter', seat, l, hit, p: pts });
  if (!hit && !p.hanged) passTurn(s);
  else if (hit && s.mode === 'auction' && !p.solved) passTurn(s); // в аукционе каждая буква — новый торг
  return true;
}

function word(s: State, seat: number, w: string, ev: Event[]): boolean {
  const p = puzzleOf(s, seat);
  const x = norm(w.trim());
  if (!/^[а-я]+$/.test(x) || x.length !== p.word.length || p.wrongWords.includes(x)) return false;
  if (x === p.word) {
    const pts = s.mode === 'team' ? 0 : s.mode === 'auction' ? PTS.auctionLetter * hidden(p) + PTS.auctionWord : PTS.letter * hidden(p) + PTS.wordBonus;
    for (const c of p.word) if (!p.letters.includes(c)) p.letters.push(c);
    p.solved = true;
    s.scores[seat] += pts;
    ev.push({ type: 'word', seat, word: x, ok: true, p: pts });
  } else {
    p.wrongWords.push(x);
    p.misses += 1;
    if (p.misses >= s.limit) p.hanged = true;
    ev.push({ type: 'word', seat, word: x, ok: false, p: 0 });
    if (!p.hanged) passTurn(s);
  }
  return true;
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (!toAct(s0).includes(seat)) return null;
  const s = clone(s0);
  const ev: Event[] = [];
  switch (a.type) {
    case 'set': {
      if (s.phase !== 'set' || validWord(a.word)) return null;
      const w = norm(a.word.trim());
      s.puzzles = [newPuzzle(w, '')];
      s.used.push(w);
      ev.push({ type: 'set', seat, len: w.length });
      const g = guessers(s);
      s.turn = g[s.gIdx];
      s.phase = 'guess';
      break;
    }
    case 'letter':
      if (s.phase !== 'guess' || !ALPHABET.includes(a.l) || a.l.length !== 1 || !letter(s, seat, a.l, ev)) return null;
      maybeEnd(s, ev);
      break;
    case 'word':
      if (s.phase !== 'guess' || typeof a.word !== 'string' || !word(s, seat, a.word, ev)) return null;
      maybeEnd(s, ev);
      break;
    case 'bid': {
      if (s.phase !== 'bid') return null;
      const n = Math.floor(Number(a.n));
      if (!(n >= 0) || n > s.scores[seat]) return null;
      s.bids[seat] = n;
      const g = guessers(s);
      if (g.every((x) => s.bids[x] != null)) {
        // больше всех; при равенстве — тот, кто ближе по кругу к начинающему
        let winner = g[s.lead];
        for (let i = 0; i < g.length; i++) {
          const x = g[(s.lead + i) % g.length];
          if (s.bids[x] > s.bids[winner]) winner = x;
        }
        const paid = s.bids[winner];
        s.scores[winner] -= paid;
        ev.push({ type: 'bids', bids: { ...s.bids }, winner, paid });
        s.bids = {};
        s.turn = winner;
        s.phase = 'guess';
      }
      break;
    }
    case 'next': {
      if (s.phase !== 'between') return null;
      s.round += 1;
      if (s.byPlayers) s.setter = nextSetter(s0);
      startRound(s, rng);
      ev.push({ type: 'newround', round: s.round, setter: s.byPlayers ? s.setter : -1 });
      break;
    }
    default:
      return null;
  }
  return { state: s, events: ev };
}

/** Что видит место: загаданное слово скрыто (кроме ведущего и конца кона); чужие ставки скрыты. */
export function view(s: State, seats: number[] | 'all'): State {
  const v = clone(s);
  const all = seats === 'all';
  const showWords = all || s.phase === 'between' || s.phase === 'over';
  // ведущему слово видно, но не на общем экране с отгадчиками (хот-сит)
  const g = guessers(s);
  const mine = !all && s.byPlayers && seats.includes(s.setter) && !seats.some((x) => g.includes(x));
  v.puzzles = v.puzzles.map((p) => {
    if (showWords || mine || p.solved || p.hanged) return p;
    return { ...p, word: [...p.word].map((c) => (p.letters.includes(c) ? c : '_')).join(''), hint: s.showHint ? p.hint : '' };
  });
  if (!all) v.bids = Object.fromEntries(Object.entries(s.bids).map(([k, n]) => [k, seats.includes(Number(k)) ? n : -1]));
  v.used = [];
  return v;
}

export function redact(ev: Event, _seats: number[] | 'all'): Event | null {
  return ev;
}
