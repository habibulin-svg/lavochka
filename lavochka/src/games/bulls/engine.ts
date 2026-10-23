/* Быки и коровы и советская «Логика» — правила (без DOM).
 *
 * Код — ряд из len знаков: цифр 0–9 («быки и коровы») или цветных фишек (kinds цветов; в «Логике» 8, в варианте II
 * девятый «цвет» — пустая ячейка). Повторы знаков — по настройке. Ответ на попытку: «быки» (чёрные штырьки) — знак верный
 * и на своём месте, «коровы» (белые) — знак есть в коде, но стоит не там. Код угадан, когда быков столько же, сколько знаков.
 *
 * Режимы:
 *   duel   — у каждого свой код, угадывают по очереди чужой; кто угадал первым — выиграл. Если первым угадал тот, кто
 *            начинал, второй делает ту же по счёту попытку: угадал — ничья;
 *   rounds — как в «Логике»: в каждом коне один загадывает («вызывающий на состязание»), другой разгадывает и получает
 *            по очку за каждый ряд (не разгадал за rows рядов — rows + 1 очко); роли меняются. У кого к концу меньше — выиграл.
 * Один игрок — загадывает компьютер (код случайный), игрок разгадывает.
 */
import type { Options, Rng } from '../../core/types';

export type Mode = 'duel' | 'rounds';
export type Look = 'wood' | 'logika' | 'grey';

export interface Cfg {
  mode: Mode;
  len: number;
  /** Сколько разных знаков: 10 цифр или число цветов (включая «пусто»). */
  kinds: number;
  digits: boolean;
  /** Последний «цвет» — пустая ячейка (вариант II «Логики»). */
  blank: boolean;
  repeats: boolean;
  /** Рядов на разгадку (0 — без ограничения). */
  rows: number;
  /** Конов в режиме rounds (чётное: роли меняются поровну). */
  rounds: number;
  look: Look;
}

export function cfgFrom(o: Options): Cfg {
  const digits = o.symbols !== 'colors';
  const len = Math.max(3, Math.min(digits ? 6 : 5, Number(o.len) || 4));
  const colors = Math.max(4, Math.min(8, Number(o.colors) || 8));
  const blank = !digits && o.blank === true;
  const look: Look = digits ? 'wood' : o.look === 'grey' ? 'grey' : 'logika';
  return {
    mode: o.mode === 'rounds' ? 'rounds' : 'duel',
    len,
    kinds: digits ? 10 : colors + (blank ? 1 : 0),
    digits,
    blank,
    repeats: digits ? o.repeats === true : o.repeats !== false,
    rows: Math.max(0, Math.min(16, Number(o.rows ?? 0) || 0)),
    rounds: Math.max(2, Math.min(8, Number(o.rounds) || 2)),
    look,
  };
}

export interface Try {
  code: number[];
  bulls: number;
  cows: number;
}

export interface State {
  cfg: Cfg;
  /** Мест: 1 (против компьютера) или 2. */
  n: number;
  phase: 'secret' | 'guess' | 'over';
  /** Код, загаданный местом (в одиночной игре — компьютером, под индексом 1). null — ещё не загадан или скрыт. */
  secrets: (number[] | null)[];
  /** Попытки места в текущем коне. */
  tries: Try[][];
  /** Прошлые коны (rounds): кто разгадывал, что было загадано, попытки. */
  past: { decoder: number; secret: number[]; tries: Try[]; solved: boolean }[];
  round: number;
  /** Чей ход в дуэли. */
  turn: number;
  scores: number[];
  /** Дуэль: на какой попытке место угадало (0 — ещё нет). */
  solvedAt: number[];
  /** Коды открыты всем (конец партии или кона). */
  open: boolean;
  winners: number[];
}

export type Action = { type: 'secret'; code: number[] } | { type: 'guess'; code: number[] };
export type Event =
  | { type: 'secret'; seat: number }
  | { type: 'guess'; seat: number; code: number[]; bulls: number; cows: number }
  | { type: 'round'; decoder: number; secret: number[]; solved: boolean; points: number }
  | { type: 'end'; winners: number[]; secrets: (number[] | null)[] };

/** Предел попыток, если ряды не ограничены (чтобы партия всегда кончалась). */
export const HARD_CAP = 30;
const limit = (c: Cfg) => c.rows || HARD_CAP;

/** Кто разгадывает в текущем коне (rounds/одиночная). */
export const decoderOf = (s: State) => (s.n === 1 ? 0 : s.round % 2);
export const coderOf = (s: State) => (s.n === 1 ? 1 : 1 - decoderOf(s));

export function randomCode(c: Cfg, rng: Rng): number[] {
  const out: number[] = [];
  while (out.length < c.len) {
    const k = rng.int(c.kinds);
    if (!c.repeats && out.includes(k)) continue;
    out.push(k);
  }
  return out;
}

export function validCode(c: Cfg, code: unknown): code is number[] {
  if (!Array.isArray(code) || code.length !== c.len) return false;
  if (!code.every((k) => Number.isInteger(k) && k >= 0 && k < c.kinds)) return false;
  return c.repeats || new Set(code).size === code.length;
}

/** Быки и коровы попытки g против кода s. */
export function score(s: number[], g: number[], kinds: number): [number, number] {
  let bulls = 0;
  const cs = new Array(kinds).fill(0);
  const cg = new Array(kinds).fill(0);
  for (let i = 0; i < s.length; i++) {
    if (s[i] === g[i]) bulls++;
    else {
      cs[s[i]]++;
      cg[g[i]]++;
    }
  }
  let cows = 0;
  for (let k = 0; k < kinds; k++) cows += Math.min(cs[k], cg[k]);
  return [bulls, cows];
}

export function newState(cfg: Cfg, n: number, rng: Rng): State {
  const s: State = {
    cfg,
    n,
    phase: 'secret',
    secrets: [null, null],
    tries: [[], []],
    past: [],
    round: 0,
    turn: 0,
    scores: [0, 0],
    solvedAt: [0, 0],
    open: false,
    winners: [],
  };
  if (n === 1) {
    s.secrets[1] = randomCode(cfg, rng);
    s.phase = 'guess';
  }
  return s;
}

export function setup(seats: number[], opts: Options, rng: Rng): State {
  return newState(cfgFrom(opts), seats.length === 1 ? 1 : 2, rng);
}

export function toAct(s: State): number[] {
  if (s.phase === 'over') return [];
  if (s.phase === 'secret') {
    if (s.cfg.mode === 'duel') return [0, 1].filter((x) => !s.secrets[x]);
    return s.secrets[coderOf(s)] ? [] : [coderOf(s)];
  }
  if (s.n === 2 && s.cfg.mode === 'duel') return [s.turn];
  return [decoderOf(s)];
}

/** Чей код разгадывает место seat. */
const targetOf = (s: State, seat: number) => (s.n === 1 ? 1 : s.cfg.mode === 'duel' ? 1 - seat : coderOf(s));

function finish(s: State, events: Event[]) {
  s.phase = 'over';
  s.open = true;
  if (s.n === 1) s.winners = s.past[s.past.length - 1]?.solved ? [0] : [];
  else if (s.cfg.mode === 'rounds') {
    const [a, b] = s.scores;
    s.winners = a === b ? [] : a < b ? [0] : [1];
  }
  events.push({ type: 'end', winners: s.winners, secrets: s.secrets.slice() });
}

/** Кон окончен (rounds/одиночная): начислить очки, открыть код, начать следующий. */
function endRound(s: State, solved: boolean, events: Event[]) {
  const d = decoderOf(s);
  const c = coderOf(s);
  const points = solved ? s.tries[d].length : limit(s.cfg) + 1;
  s.scores[d] += points;
  const secret = s.secrets[c]!;
  s.past.push({ decoder: d, secret, tries: s.tries[d], solved });
  events.push({ type: 'round', decoder: d, secret, solved, points });
  if (s.n === 1 || s.round + 1 >= s.cfg.rounds) return finish(s, events);
  s.round++;
  s.tries = [[], []];
  s.secrets = [null, null];
  s.phase = 'secret';
}

export function apply(s0: State, seat: number, a: Action): { state: State; events: Event[] } | null {
  if (!a || !toAct(s0).includes(seat) || !validCode(s0.cfg, (a as { code?: unknown }).code)) return null;
  const s: State = { ...s0, secrets: s0.secrets.slice(), tries: s0.tries.map((t) => t.slice()), scores: s0.scores.slice(), solvedAt: s0.solvedAt.slice(), past: s0.past.slice() };
  const events: Event[] = [];
  if (a.type === 'secret') {
    if (s.phase !== 'secret') return null;
    s.secrets[seat] = a.code.slice();
    events.push({ type: 'secret', seat });
    if (toAct(s).length === 0) {
      s.phase = 'guess';
      s.turn = 0;
    }
    return { state: s, events };
  }
  if (a.type !== 'guess' || s.phase !== 'guess') return null;
  const target = s.secrets[targetOf(s, seat)]!;
  const [bulls, cows] = score(target, a.code, s.cfg.kinds);
  s.tries[seat].push({ code: a.code.slice(), bulls, cows });
  events.push({ type: 'guess', seat, code: a.code.slice(), bulls, cows });
  const hit = bulls === s.cfg.len;
  const used = s.tries[seat].length;

  if (s.n === 2 && s.cfg.mode === 'duel') {
    if (hit) s.solvedAt[seat] = used;
    const other = 1 - seat;
    const otherUsed = s.tries[other].length;
    // начинал seat 0: если он угадал, у seat 1 есть ещё попытка с тем же номером
    if (s.solvedAt[0] && s.solvedAt[1]) s.winners = [];
    else if (s.solvedAt[seat] && (seat === 1 || otherUsed >= used)) s.winners = [seat];
    else if (seat === 1 && s.solvedAt[0]) s.winners = [0];
    else if (!s.solvedAt[0] || seat === 0) {
      const capped = used >= limit(s.cfg) && otherUsed >= limit(s.cfg);
      if (!capped) {
        s.turn = other;
        return { state: s, events };
      }
      s.winners = [];
    }
    s.phase = 'over';
    s.open = true;
    events.push({ type: 'end', winners: s.winners, secrets: s.secrets.slice() });
    return { state: s, events };
  }
  if (hit) endRound(s, true, events);
  else if (used >= limit(s.cfg)) endRound(s, false, events);
  return { state: s, events };
}

/** Что видят места: чужие коды скрыты, пока их не открыли. */
export function makeView(s: State, seats: number[] | 'all'): State {
  if (seats === 'all' || s.open) return s;
  return { ...s, secrets: s.secrets.map((c, i) => (seats.includes(i) ? c : c ? [] : null)) };
}
