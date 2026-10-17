/* «Астронавты» — движок. Кубик, ход по точкам звёздной карты от Земли через 190 точек и обратно на Землю.
 * Очки с карточек и маршрута не двигают сразу, а прибавляются или снимаются в следующем ходе (примечание к правилам);
 * на старте каждый теряет 2 очка (перегрузки при взлёте). Первый вариант — карточки на красных точках, второй —
 * назвать планету, созвездие и звёзды (викторина) и точки маршрута в красных кружках. Без DOM. */
import type { Options, Rng } from '../../core/types';
import { CARDS, HOME, cardAt, cardOf, stopAt } from './data';

export interface Quiz {
  seat: number;
  /** Номер карточки (точки). */
  n: number;
  /** Что спрашивают: название объекта, потом — звёзды, по которым находят Полярную. */
  step: 'name' | 'stars';
  options: string[];
}

export interface State {
  seats: number[];
  pos: number[];
  /** Очки к следующему ходу (прибавляются к броску и обнуляются). */
  bonus: number[];
  /** Сколько ходов пропустить. */
  skip: number[];
  turn: number;
  /** move — кубик брошен, игрок сам переставляет корабль на подсвеченную точку (как в кинь-двинь). */
  phase: 'roll' | 'move' | 'quiz';
  /** Куда встанет корабль после броска (фаза move). */
  target: number | null;
  quiz: Quiz | null;
  /** Последний бросок. */
  die: number | null;
  winner: number | null;
  /** Второй вариант: викторина на красных точках вместо карточек. */
  quizMode: boolean;
  /** Точки маршрута второго варианта (в красных кружках). */
  route: boolean;
  /** На Землю — только точным броском. */
  exact: boolean;
  /** Ходы — для показа Земли на первом броске. */
  moves: number;
}

export type Action = { type: 'roll' } | { type: 'move' } | { type: 'answer'; pick: string };

export type Event =
  | { type: 'roll'; seat: number; die: number; bonus: number; steps: number; first?: boolean }
  | { type: 'move'; seat: number; path: number[] }
  /** Бросок с поправкой меньше единицы — корабль стоит. */
  | { type: 'stay'; seat: number; why: 'weak' | 'over' }
  | { type: 'card'; seat: number; n: number; pts: number; skip: boolean }
  | { type: 'stop'; seat: number; n: number; pts: number; skip: boolean; text: string }
  | { type: 'quiz'; seat: number; n: number }
  | { type: 'answer'; seat: number; n: number; step: 'name' | 'stars'; pick: string; ok: boolean; pts: number; done: boolean; right: string }
  | { type: 'skip'; seat: number }
  | { type: 'win'; seat: number };

const clone = (s: State): State => ({
  ...s,
  seats: s.seats.slice(),
  pos: s.pos.slice(),
  bonus: s.bonus.slice(),
  skip: s.skip.slice(),
  quiz: s.quiz ? { ...s.quiz, options: s.quiz.options.slice() } : null,
});

export function newState(seats: number[], o: Options = {}): State {
  const n = Math.max(...seats) + 1;
  return {
    seats: seats.slice(),
    pos: Array(n).fill(0),
    bonus: Array(n).fill(-2),
    skip: Array(n).fill(0),
    turn: seats[0],
    phase: 'roll',
    target: null,
    quiz: null,
    die: null,
    winner: null,
    quizMode: o.variant === 'quiz',
    route: !!o.route,
    exact: !!o.exact,
    moves: 0,
  };
}

/** Передать ход: следующий по кругу, а кто пропускает — отмечает пропуск и ждёт. */
function pass(s: State, seat: number, ev: Event[]) {
  s.phase = 'roll';
  s.target = null;
  s.quiz = null;
  let i = s.seats.indexOf(seat);
  for (let guard = 0; guard < 64; guard++) {
    i = (i + 1) % s.seats.length;
    const next = s.seats[i];
    if (s.skip[next] > 0) {
      s.skip[next]--;
      ev.push({ type: 'skip', seat: next });
      continue;
    }
    s.turn = next;
    return;
  }
  s.turn = s.seats[(s.seats.indexOf(seat) + 1) % s.seats.length];
}

function shuffle<T>(a: T[], rng: Rng): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Варианты ответа: правильный и три других того же рода (планеты к планете, созвездия к созвездию). */
export function quizOptions(n: number, step: 'name' | 'stars', rng: Rng): string[] {
  const c = cardOf(n);
  const pool =
    step === 'name'
      ? CARDS.filter((x) => x.n !== n && x.n !== 0 && !!x.planet === !!c.planet).map((x) => x.name)
      : CARDS.filter((x) => x.n !== n && x.stars).map((x) => x.stars!);
  const others = shuffle([...new Set(pool)], rng).slice(0, 3);
  return shuffle([step === 'name' ? c.name : c.stars!, ...others], rng);
}

/** Правильный ответ на вопрос викторины. */
export const rightAnswer = (q: Pick<Quiz, 'n' | 'step'>) => (q.step === 'name' ? cardOf(q.n).name : cardOf(q.n).stars!);

/** Что случилось на точке, куда встал корабль. Возвращает true, если ход ждёт ответа (викторина). */
function land(s: State, seat: number, ev: Event[], rng: Rng): boolean {
  const p = s.pos[seat];
  const c = cardAt(p);
  if (c) {
    if (s.quizMode) {
      s.phase = 'quiz';
      s.quiz = { seat, n: c.n, step: 'name', options: quizOptions(c.n, 'name', rng) };
      ev.push({ type: 'quiz', seat, n: c.n });
      return true;
    }
    s.bonus[seat] += c.pts;
    if (c.skip) s.skip[seat]++;
    ev.push({ type: 'card', seat, n: c.n, pts: c.pts, skip: !!c.skip });
    return false;
  }
  const r = s.route ? stopAt(p) : null;
  if (r) {
    s.bonus[seat] += r.pts;
    if (r.skip) s.skip[seat]++;
    ev.push({ type: 'stop', seat, n: r.n, pts: r.pts, skip: !!r.skip, text: r.text });
  }
  return false;
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.winner != null || seat !== s0.turn) return null;
  const s = clone(s0);
  const ev: Event[] = [];

  if (a.type === 'roll') {
    if (s.phase !== 'roll') return null;
    const die = rng.int(6) + 1;
    const bonus = s.bonus[seat];
    const steps = die + bonus;
    s.die = die;
    s.bonus[seat] = 0;
    ev.push({ type: 'roll', seat, die, bonus, steps, ...(s.moves === 0 ? { first: true } : {}) });
    s.moves++;
    if (steps <= 0) {
      ev.push({ type: 'stay', seat, why: 'weak' });
      pass(s, seat, ev);
      return { state: s, events: ev };
    }
    const from = s.pos[seat];
    if (s.exact && from + steps > HOME) {
      ev.push({ type: 'stay', seat, why: 'over' });
      pass(s, seat, ev);
      return { state: s, events: ev };
    }
    // корабль игрок переставляет сам — действием move
    s.phase = 'move';
    s.target = Math.min(HOME, from + steps);
    return { state: s, events: ev };
  }

  if (a.type === 'move') {
    if (s.phase !== 'move' || s.target == null) return null;
    const from = s.pos[seat];
    const to = s.target;
    const path: number[] = [];
    for (let i = from + 1; i <= to; i++) path.push(i);
    s.pos[seat] = to;
    s.target = null;
    s.phase = 'roll';
    ev.push({ type: 'move', seat, path });
    if (to >= HOME) {
      s.winner = seat;
      ev.push({ type: 'win', seat });
      return { state: s, events: ev };
    }
    if (land(s, seat, ev, rng)) return { state: s, events: ev };
    pass(s, seat, ev);
    return { state: s, events: ev };
  }

  if (a.type === 'answer') {
    const q = s.quiz;
    if (s.phase !== 'quiz' || !q || q.seat !== seat || !q.options.includes(a.pick)) return null;
    const c = cardOf(q.n);
    const right = rightAnswer(q);
    const ok = a.pick === right;
    // очки второго варианта: планета — 1, созвездие — 2, созвездие и звёзды — 5; ошибка — минус 2;
    // в созвездии с ориентирами названо только созвездие — минус 1
    let pts: number;
    let done = true;
    if (q.step === 'name') {
      if (!ok) pts = -2;
      else if (c.planet) pts = 1;
      else if (c.stars) {
        pts = 0;
        done = false;
      } else pts = 2;
    } else pts = ok ? 5 : -1;
    ev.push({ type: 'answer', seat, n: q.n, step: q.step, pick: a.pick, ok, pts, done, right });
    if (!done) {
      s.quiz = { seat, n: q.n, step: 'stars', options: quizOptions(q.n, 'stars', rng) };
      return { state: s, events: ev };
    }
    s.bonus[seat] += pts;
    pass(s, seat, ev);
    return { state: s, events: ev };
  }
  return null;
}

export const toAct = (s: State) => (s.winner != null ? [] : [s.turn]);

/** Видят все одно и то же: ответа в состоянии нет (его знают только данные карточек). */
export const view = (s: State) => s;

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);
const ochko = (n: number) => {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  return a > 10 && a < 20 ? 'очков' : b === 1 ? 'очко' : b >= 2 && b <= 4 ? 'очка' : 'очков';
};
export const ptsText = (n: number) => `${signed(n)} ${ochko(n)}`;

export function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'roll':
      return ev.bonus
        ? `${name(ev.seat)}: на кубике ${ev.die}, ${ev.bonus > 0 ? 'прибавка' : 'снимается'} ${Math.abs(ev.bonus)} — ${ev.steps > 0 ? `ход на ${ev.steps}` : 'с места не сдвинуться'}.`
        : `${name(ev.seat)}: на кубике ${ev.die}.`;
    case 'move':
      return null;
    case 'stay':
      return ev.why === 'over'
        ? `${name(ev.seat)}: до Земли нужно точное число — корабль ждёт.`
        : `${name(ev.seat)} остаётся на месте.`;
    case 'card': {
      const c = cardOf(ev.n);
      return `${name(ev.seat)}: карточка ${ev.n}. ${c.planet ? 'Планета' : 'Созвездие'} ${c.name} — ${ev.skip ? 'пропускает ход' : `${ptsText(ev.pts)} в следующем ходе`}.`;
    }
    case 'stop':
      return `${name(ev.seat)}, точка ${ev.n}: ${ev.text}. ${ev.skip ? 'Пропускает ход' : `${ptsText(ev.pts)} в следующем ходе`}.`;
    case 'quiz':
      return `${name(ev.seat)} на красной точке ${ev.n}: что это за ${cardOf(ev.n).planet ? 'планета' : 'созвездие'}?`;
    case 'answer':
      if (ev.step === 'name')
        return ev.ok
          ? `${name(ev.seat)}: «${ev.pick}» — верно!${ev.done ? ` ${ptsText(ev.pts)}.` : ' А по каким звёздам отсюда находят Полярную?'}`
          : `${name(ev.seat)}: «${ev.pick}» — неверно, это ${ev.right}. ${ptsText(ev.pts)}.`;
      return ev.ok
        ? `${name(ev.seat)}: «${ev.pick}» — верно! Созвездие и звёзды: ${ptsText(ev.pts)}.`
        : `${name(ev.seat)}: звёзды не те (верно — ${ev.right}); названо только созвездие: ${ptsText(ev.pts)}.`;
    case 'skip':
      return `${name(ev.seat)} пропускает ход.`;
    case 'win':
      return `🏆 ${name(ev.seat)} облетел звёздное небо и вернулся на Землю!`;
    default:
      return null;
  }
}
