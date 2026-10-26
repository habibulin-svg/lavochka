/* «Полёт» — движок. Правила — стр. 8–11 брошюры (docs/analysis/materials-polet.md), маршрут — map.ts. Без DOM.
 *
 * Ход: крутят стрелку пульта; внутреннее кольцо «Ход» даёт 1–4 точки, игрок сам переставляет самолёт (до цветной точки с
 * заданием самолёт не долетает дальше — останавливается на ней). На цветной точке сразу одна попытка: курс (красные),
 * высота (голубые), скорость (фиолетовые) — стрелка должна встать в нужном секторе; жёлтые — вопрос; аэропорты 1 и 19 —
 * «Взлёт разрешён», 23 — «Посадка разрешена». Выполнил — сразу ещё ход, нет — пробует в следующий раз. Белые точки
 * срабатывают при остановке: 2 — на старт, 3 — пропуск хода, 7/14/16 — обходы, 10 — +4 точки, 21 — зона ожидания,
 * 26 — второй круг. Побеждает первый, кто долетит до 27. */
import type { Options, Rng } from '../../core/types';
import { LEGS, PTS } from './map';

/** Секторы пульта (угол стрелки по часовой от верха): четверти СВ, ЮВ, ЮЗ, СЗ. */
export type Quarter = 0 | 1 | 2 | 3;
export const ALT = ['400 м', '5100 м', '10 000 м', '11 000 м'];
export const SPEED = ['260 км/ч', '620 км/ч', '780 км/ч', '850 км/ч'];
export const COURSE = ['43°', '97°', '274°', '315°'];
/** Ход: СВ — 2, ЮВ — 4, ЮЗ — 3, СЗ — 1. */
export const MOVE = [2, 4, 3, 1];
/** «Взлёт разрешён» — колпачок сверху, «Посадка разрешена» — снизу (±55° от вертикали, как на пульте). */
export const CAP = 55;

export type TaskKind = 'course' | 'alt' | 'speed';
export const TASKS: Record<number, [TaskKind, Quarter]> = {
  4: ['course', 1],
  9: ['course', 2],
  13: ['course', 0],
  17: ['course', 3],
  5: ['alt', 2],
  15: ['alt', 3],
  22: ['alt', 1],
  24: ['alt', 0],
  8: ['speed', 2],
  11: ['speed', 3],
  18: ['speed', 1],
  25: ['speed', 0],
};
export const QUESTIONS = new Set([6, 12, 20]);
/** Где самолёт обязан остановиться, даже если очков больше. */
export const STOPS = new Set([...Object.keys(TASKS).map(Number), 6, 12, 20, 19, 23, 27]);

/** Пиктограммы на поле: аварийно-спасательные средства. */
export const LAND = ['медицинская аптечка', 'огнетушитель', 'аварийный топор', 'аварийный канат', 'надувной аварийный трап'];
export const WATER = ['детский спасательный жилет', 'спасательный жилет', 'детская спасательная люлька', 'спасательный плот'];
export const SIGNALS = ['«Застегните ремни»', '«Не курить»', '«Можно отстегнуть ремни»', '«Займите места у иллюминаторов»'];

export type Need = 'takeoff' | 'landing' | 'task' | 'question' | null;

export interface Plane {
  seat: number;
  leg: string;
  i: number;
  need: Need;
  skip: number;
  /** Обходы, по которым уже летали (второй раз на той же белой точке не срабатывают). */
  used: string[];
}

export interface Question {
  set: 'land' | 'water' | 'signal';
  /** Какая пиктограмма (для land/water). */
  pic: number;
  options: string[];
  /** Верный вариант; в view — −1 (ответ знают только боты — по своим «знаниям», см. rightAnswer). */
  answer: number;
}

/** Верный ответ по содержанию вопроса. */
export function rightAnswer(q: Question): number {
  const right = q.set === 'signal' ? SIGNALS[0] : (q.set === 'land' ? LAND : WATER)[q.pic];
  return q.options.indexOf(right);
}

export function makeView(s: State, seats: number[] | 'all'): State {
  if (seats === 'all' || !s.question) return s;
  return { ...s, question: { ...s.question, answer: -1 } };
}

export interface State {
  planes: Plane[];
  turn: number;
  phase: 'spin' | 'move' | 'question' | 'over';
  /** Последний угол стрелки. */
  angle: number;
  /** Куда переставить самолёт (фаза move): путь по точкам. */
  path: number[];
  question: Question | null;
  winner: number | null;
  turns: number;
  last: number[];
}

export type Action = { type: 'spin' } | { type: 'move' } | { type: 'answer'; i: number };

export type Event =
  | { type: 'spin'; seat: number; angle: number; why: Need | 'move'; ok: boolean; value: number }
  | { type: 'move'; seat: number; path: number[]; effect: string }
  | { type: 'answer'; seat: number; ok: boolean; right: string }
  | { type: 'skip'; seat: number }
  | { type: 'end'; winner: number };

export const MAX_TURNS = 400;

export const pointOf = (pl: Plane) => LEGS[pl.leg].pts[pl.i];
export const numOf = (pl: Plane) => PTS[pointOf(pl)].n;

export const quarterOf = (a: number): Quarter => Math.floor((((a % 360) + 360) % 360) / 90) as Quarter;
export const inTakeoff = (a: number) => a < CAP || a > 360 - CAP;
export const inLanding = (a: number) => a > 180 - CAP && a < 180 + CAP;

export function newState(n: number): State {
  return {
    planes: Array.from({ length: n }, (_, seat) => ({ seat, leg: 'main', i: 0, need: 'takeoff', skip: 0, used: [] })),
    turn: 0,
    phase: 'spin',
    angle: 0,
    path: [],
    question: null,
    winner: null,
    turns: 0,
    last: [],
  };
}

export const setup = (_o: Options, n: number) => newState(n);

export function toAct(s: State): number[] {
  return s.phase === 'over' ? [] : [s.turn];
}

export function legal(s: State, seat: number): Action[] {
  if (s.phase === 'over' || seat !== s.turn) return [];
  if (s.phase === 'spin') return [{ type: 'spin' }];
  if (s.phase === 'move') return [{ type: 'move' }];
  return s.question!.options.map((_, i) => ({ type: 'answer', i }) as Action);
}

/** Угол стрелки, не на разграничительной линии (иначе крутят ещё раз). */
function spinAngle(rng: Rng): number {
  for (;;) {
    const a = rng.int(3600) / 10;
    const near = (b: number) => Math.abs(((a - b + 540) % 360) - 180) < 2;
    if (![0, 90, 180, 270, CAP, 360 - CAP, 180 - CAP, 180 + CAP].some(near)) return a;
  }
}

/** Путь на k точек вперёд от самолёта: с переходом на следующий участок, с остановкой на точке с заданием. */
export function walk(pl: Plane, k: number): { path: number[]; leg: string; i: number } {
  let leg = pl.leg;
  let i = pl.i;
  const path: number[] = [];
  for (let step = 0; step < k; step++) {
    const L = LEGS[leg];
    if (i + 1 < L.pts.length) i++;
    else if (L.next) {
      leg = L.next[0];
      i = L.next[1] + 1;
    } else break;
    const p = LEGS[leg].pts[i];
    path.push(p);
    if (STOPS.has(PTS[p].n)) break;
  }
  return { path, leg, i };
}

function clone(s: State): State {
  return { ...s, planes: s.planes.map((p) => ({ ...p, used: [...p.used] })), path: [...s.path], last: [...s.last] };
}

function nextTurn(s: State, events: Event[]) {
  s.question = null;
  s.path = [];
  for (let k = 0; k < s.planes.length * 3; k++) {
    s.turn = (s.turn + 1) % s.planes.length;
    if (s.turn === 0) s.turns++;
    const pl = s.planes[s.turn];
    if (pl.skip > 0) {
      pl.skip--;
      events.push({ type: 'skip', seat: s.turn });
      continue;
    }
    break;
  }
  s.phase = 'spin';
  if (s.turns >= MAX_TURNS) {
    // предел: побеждает тот, кто дальше по маршруту (по номеру последней цветной точки)
    let best = 0;
    s.planes.forEach((p, k) => {
      if (numOf(p) > numOf(s.planes[best])) best = k;
    });
    s.phase = 'over';
    s.winner = best;
    events.push({ type: 'end', winner: best });
  }
}

function makeQuestion(n: number, rng: Rng): Question {
  const shuffle = <T>(a: T[]) => {
    const b = [...a];
    for (let i = b.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [b[i], b[j]] = [b[j], b[i]];
    }
    return b;
  };
  if (n === 20) {
    const options = shuffle(SIGNALS);
    return { set: 'signal', pic: 0, options, answer: options.indexOf(SIGNALS[0]) };
  }
  const list = n === 6 ? LAND : WATER;
  const pic = rng.int(list.length);
  const wrong = shuffle(list.filter((_, k) => k !== pic)).slice(0, 3);
  const options = shuffle([list[pic], ...wrong]);
  return { set: n === 6 ? 'land' : 'water', pic, options, answer: options.indexOf(list[pic]) };
}

/** Что делает точка, на которой самолёт остановился. Возвращает подпись для журнала. */
function arrive(s: State, pl: Plane, rng: Rng): string {
  const n = numOf(pl);
  const branch = (leg: string) => {
    if (pl.used.includes(leg)) return false;
    pl.used.push(leg);
    pl.leg = leg;
    pl.i = 0;
    return true;
  };
  if (n === 27) return 'landed';
  if (TASKS[n]) {
    pl.need = 'task';
    return 'task';
  }
  if (QUESTIONS.has(n)) {
    pl.need = 'question';
    s.question = makeQuestion(n, rng);
    return 'question';
  }
  if (n === 23) {
    pl.need = 'landing';
    return 'landing';
  }
  if (n === 19) {
    pl.need = 'takeoff';
    pl.leg = 'back';
    pl.i = 0;
    return 'spare';
  }
  if (pl.leg !== 'main') return '';
  if (n === 2) {
    pl.leg = 'main';
    pl.i = 0;
    pl.need = 'takeoff';
    return 'delay';
  }
  if (n === 3) {
    pl.skip++;
    return 'belts';
  }
  if (n === 7 && branch('storm')) return 'storm';
  if (n === 14 && branch('ice')) return 'ice';
  if (n === 16 && branch('spare')) return 'closed';
  if (n === 21 && branch('hold')) return 'hold';
  if (n === 26 && branch('circle')) return 'circle';
  if (n === 10) return 'wind';
  return '';
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (!a || typeof a !== 'object' || s0.phase === 'over' || seat !== s0.turn) return null;
  const s = clone(s0);
  const pl = s.planes[seat];
  const events: Event[] = [];
  if (s.phase === 'spin' && a.type === 'spin') {
    const angle = spinAngle(rng);
    s.angle = angle;
    if (pl.need === 'takeoff' || pl.need === 'landing' || pl.need === 'task') {
      let ok: boolean;
      if (pl.need === 'takeoff') ok = inTakeoff(angle);
      else if (pl.need === 'landing') ok = inLanding(angle);
      else ok = quarterOf(angle) === TASKS[numOf(pl)][1];
      events.push({ type: 'spin', seat, angle, why: pl.need, ok, value: quarterOf(angle) });
      if (ok) pl.need = null; // сразу ещё ход
      else nextTurn(s, events);
      return { state: s, events };
    }
    // ход: колпачки «Взлёт» и «Посадка» — крутят ещё раз
    if (inTakeoff(angle) || inLanding(angle)) {
      events.push({ type: 'spin', seat, angle, why: 'move', ok: false, value: 0 });
      return { state: s, events };
    }
    const k = MOVE[quarterOf(angle)];
    events.push({ type: 'spin', seat, angle, why: 'move', ok: true, value: k });
    const w = walk(pl, k);
    if (!w.path.length) {
      nextTurn(s, events);
      return { state: s, events };
    }
    s.path = w.path;
    s.phase = 'move';
    return { state: s, events };
  }
  if (s.phase === 'move' && a.type === 'move') {
    const from = pointOf(pl);
    const w = walk(pl, s.path.length);
    pl.leg = w.leg;
    pl.i = w.i;
    s.last = [from, pointOf(pl)];
    const path = s.path;
    s.path = [];
    const effect = arrive(s, pl, rng);
    if (effect === 'wind') {
      // попутный ветер: ещё 4 точки — самолёт переставляет игрок
      events.push({ type: 'move', seat, path, effect });
      const w2 = walk(pl, 4);
      if (w2.path.length) {
        s.path = w2.path;
        s.phase = 'move';
      } else nextTurn(s, events);
      return { state: s, events };
    }
    events.push({ type: 'move', seat, path, effect });
    if (effect === 'landed') {
      s.phase = 'over';
      s.winner = seat;
      events.push({ type: 'end', winner: seat });
      return { state: s, events };
    }
    if (effect === 'question') {
      s.phase = 'question';
      return { state: s, events };
    }
    // на точке с заданием — сразу попытка (та же очередь)
    if (effect === 'task' || effect === 'landing') {
      s.phase = 'spin';
      return { state: s, events };
    }
    nextTurn(s, events);
    return { state: s, events };
  }
  if (s.phase === 'question' && a.type === 'answer') {
    const q = s.question!;
    if (!Number.isInteger(a.i) || a.i < 0 || a.i >= q.options.length) return null;
    const ok = a.i === q.answer;
    events.push({ type: 'answer', seat, ok, right: q.options[q.answer] });
    pl.need = null;
    s.question = null;
    if (ok) s.phase = 'spin';
    else {
      pl.skip++;
      nextTurn(s, events);
    }
    return { state: s, events };
  }
  return null;
}
