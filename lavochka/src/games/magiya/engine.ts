/**
 * «Магия» — движок: состояние партии, ход по клеткам поля, знаки, выборы игрока и боты. Без DOM.
 *
 * Ход: бросок кубика → фишка идёт ровно на столько клеток вперёд (на развилках — куда выберет игрок) →
 * срабатывает знак клетки, где она остановилась. Знаки по пути не действуют.
 */
import type { Rng } from '../../core/types';
import {
  APEX, BSQ_START, BSQ_WEB, CELLS, HEROES, LINES, POWERS, SPIRITS, START, WEBS, heroOf, mazeNext, powerOf, spiritOf,
  type Cell, type HeroId, type LineId, type Power, type Sign, type Spirit,
} from './data';

export interface Hero {
  hero: HeroId;
  cell: number;
  /** откуда пришла фишка на последнем шаге (в лабиринте назад не ходят) */
  prev: number;
  /** красные талисманы-треугольники */
  tri: number;
  prot: Spirit[];
  power: Power[];
  /** талисман-портрет ещё не использован */
  portrait: boolean;
  /** сколько ходов пропустить */
  skip: number;
  /** место среди посвящённых (1 — первый Маг) */
  mag: number | null;
}

export interface Opts {
  /** сколько талисманов защиты нужно для посвящения (8 — от всех духов, по правилам) */
  need: number;
  /** сколько талисманов власти нужно (4 — все, по правилам) */
  needPower: number;
  /** стрелки (зелёные, голубая): свернуть только с остановки на стрелке (по правилам) или и проходом */
  arrows: 'stop' | 'pass';
  /** вершина пирамиды: только точным броском (по правилам) или останавливает того, кто собрал всё */
  apex: 'exact' | 'stop';
  /** конец партии: первый Маг или пока не посвятятся все (кроме последнего) */
  goal: 'first' | 'all';
  /** треугольников на старте */
  start: number;
  /** предел кругов (0 — без предела): по нему побеждает собравший больше талисманов */
  rounds: number;
}

export type Phase = 'roll' | 'move' | 'tunnel' | 'line' | 'take' | 'lose';

export interface State {
  seats: number[];
  names: Record<number, string>;
  heroes: Record<number, Hero>;
  turn: number;
  phase: Phase;
  die: number | null;
  /** выбор на туннеле: обязательно ли уходить (выход из «чёрного квадрата») */
  mustTunnel: boolean;
  /** голубая линия, по которой выбирают клетку */
  line: LineId | null;
  /** после этого хода — ещё бросок (свой портрет) */
  extra: boolean;
  opts: Opts;
  /** сделано ходов (для предела кругов) */
  turns: number;
  /** порядок посвящения */
  mags: number[];
  over: { winners: number[]; text: string } | null;
}

export type Action =
  | { type: 'roll' }
  | { type: 'go'; to: number }
  | { type: 'tunnel'; to: number | null }
  | { type: 'line'; to: number | null }
  | { type: 'take'; spirit: Spirit }
  | { type: 'lose'; spirit: Spirit | null };

export type Event =
  | { type: 'roll'; seat: number; die: number }
  | { type: 'step'; seat: number; cell: number }
  | { type: 'jump'; seat: number; cell: number; how: 'tunnel' | 'line' | 'bsq' }
  | { type: 'tri'; seat: number; delta: number; total: number }
  | { type: 'prot'; seat: number; spirit: Spirit; gain: boolean }
  | { type: 'power'; seat: number; power: Power }
  | { type: 'portrait'; seat: number; text: string }
  | { type: 'skip'; seat: number; n: number }
  | { type: 'skipped'; seat: number; left: number }
  | { type: 'extra'; seat: number }
  | { type: 'say'; seat: number; text: string; good?: boolean; bad?: boolean }
  | { type: 'mag'; seat: number; place: number }
  | { type: 'over'; winners: number[]; text: string }
  | { type: 'turn'; seat: number };

export const cellAt = (id: number): Cell => CELLS[id];

export function qualified(h: Hero, o: Opts): boolean {
  return h.prot.length >= o.need && h.power.length >= o.needPower;
}

const clone = (s: State): State => JSON.parse(JSON.stringify(s));

export function newState(seats: { seat: number; name: string }[], opts: Opts): State {
  const heroes: Record<number, Hero> = {};
  for (const s of seats) {
    heroes[s.seat] = {
      hero: HEROES[s.seat % HEROES.length].id, cell: START, prev: -1, tri: opts.start, prot: [], power: [],
      portrait: true, skip: 0, mag: null,
    };
  }
  return {
    seats: seats.map((s) => s.seat), names: Object.fromEntries(seats.map((s) => [s.seat, s.name])), heroes,
    turn: seats[0].seat, phase: 'roll', die: null, mustTunnel: false, line: null, extra: false, opts, turns: 0, mags: [], over: null,
  };
}

// ---------- ходы ----------

/** Куда можно шагнуть с клетки: first — первый шаг хода (ответвления со стрелок), prev — откуда пришли. */
export function stepsFrom(c: number, prev: number, first: boolean, pass = false): number[] {
  const cell = CELLS[c];
  let out: number[];
  if (cell.region === 'maze') {
    const all = mazeNext(c);
    out = all.filter((n) => n !== prev);
    // слепой коридор: развернуться можно, только если других ходов нет (с первого шага хода)
    if (!out.length && first && CELLS[prev]?.region === 'maze') out = [prev];
  } else out = [...cell.next];
  if ((first || pass) && cell.branch != null) out.push(cell.branch);
  return out;
}

/**
 * Все концы хода на die клеток: конец → путь (без начальной клетки). Клетки в одном ходе не повторяются;
 * если дальше идти некуда (тупик лабиринта), ход кончается раньше. Посвящённого (в настройке «останавливает»)
 * вершина пирамиды останавливает.
 */
export function routes(s: State, seat: number, die: number): Map<number, number[]> {
  const h = s.heroes[seat];
  const out = new Map<number, number[]>();
  const stopAtApex = s.opts.apex === 'stop' && qualified(h, s.opts);
  const pass = s.opts.arrows === 'pass';
  const walk = (c: number, prev: number, left: number, path: number[], seen: Set<number>) => {
    if (left === 0 || (stopAtApex && c === APEX && path.length)) {
      if (!out.has(c)) out.set(c, [...path]);
      return;
    }
    const nx = stepsFrom(c, prev, path.length === 0, pass).filter((n) => !seen.has(n));
    if (!nx.length) {
      if (path.length && !out.has(c)) out.set(c, [...path]);
      return;
    }
    for (const n of nx) {
      seen.add(n);
      path.push(n);
      walk(n, c, left - 1, path, seen);
      path.pop();
      seen.delete(n);
    }
  };
  walk(h.cell, h.prev, die, [], new Set([h.cell]));
  return out;
}

const inBsq = (h: Hero) => CELLS[h.cell].region === 'bsq';

/**
 * Куда можно пойти на die: конец → путь. В «чёрном квадрате» — один путь по кольцу против часовой,
 * иначе — routes(). Фишку игрок всегда ставит сам (фаза move), даже если путь один — как в кинь-двинь.
 */
export function moves(s: State, seat: number, die: number): Map<number, number[]> {
  const h = s.heroes[seat];
  if (!inBsq(h)) return routes(s, seat, die);
  const path: number[] = [];
  let c = h.cell;
  for (let k = 0; k < die; k++) {
    c = CELLS[c].next[0];
    path.push(c);
  }
  return new Map([[c, path]]);
}

// ---------- знаки ----------

function gainTri(s: State, seat: number, n: number, ev: Event[]) {
  const h = s.heroes[seat];
  h.tri += n;
  ev.push({ type: 'tri', seat, delta: n, total: h.tri });
}
function payTri(s: State, seat: number, n: number, ev: Event[]) {
  const h = s.heroes[seat];
  h.tri -= n;
  ev.push({ type: 'tri', seat, delta: -n, total: h.tri });
}

/** В «чёрный квадрат» — если талисман-портрет не спасёт. */
function toBsq(s: State, seat: number, why: string, ev: Event[]): boolean {
  const h = s.heroes[seat];
  if (h.portrait) {
    h.portrait = false;
    ev.push({ type: 'portrait', seat, text: `${why} — талисман-портрет уберёг от «чёрного квадрата»` });
    return false;
  }
  h.cell = BSQ_START;
  h.prev = -1;
  ev.push({ type: 'say', seat, text: `${why} — в «чёрный квадрат»`, bad: true });
  ev.push({ type: 'jump', seat, cell: BSQ_START, how: 'bsq' });
  return true;
}

/** Сработать знаку клетки, где остановилась фишка. Может перевести партию в фазу выбора. */
function resolve(s: State, seat: number, ev: Event[]) {
  const h = s.heroes[seat];
  const sign: Sign = CELLS[h.cell].sign;
  const o = s.opts;
  switch (sign.k) {
    case 'gain':
      gainTri(s, seat, sign.n, ev);
      break;
    case 'lossAll':
      if (h.tri > 0) {
        ev.push({ type: 'say', seat, text: 'Перечёркнутый треугольник: все талисманы-треугольники — в банк', bad: true });
        payTri(s, seat, h.tri, ev);
      }
      break;
    case 'env':
      if (h.tri >= sign.n) payTri(s, seat, sign.n, ev);
      else {
        h.skip += sign.n;
        ev.push({ type: 'skip', seat, n: sign.n });
      }
      break;
    case 'black':
      if (h.tri >= sign.n) payTri(s, seat, sign.n, ev);
      else toBsq(s, seat, `Не хватает ${sign.n} треугольников`, ev);
      break;
    case 'domain': {
      const sp = spiritOf(sign.spirit);
      if (h.prot.includes(sign.spirit)) {
        if (h.power.length >= o.needPower) {
          ev.push({ type: 'say', seat, text: `Власть над духом: ${sp.name} отдаёт ${sign.n}`, good: true });
          gainTri(s, seat, sign.n, ev);
        } else ev.push({ type: 'say', seat, text: `Талисман защиты от ${sp.of} — ${sp.name} не страшен` });
      } else if (h.tri >= sign.n) {
        ev.push({ type: 'say', seat, text: `Владения духа: ${sp.name}` });
        payTri(s, seat, sign.n, ev);
      } else toBsq(s, seat, `${sp.name}: нечем откупиться`, ev);
      break;
    }
    case 'talisman':
      if (h.prot.length < SPIRITS.length) s.phase = 'take';
      break;
    case 'skull':
      if (!h.prot.length) toBsq(s, seat, 'Череп, а талисманов защиты нет', ev);
      else s.phase = 'lose';
      break;
    case 'web':
      s.phase = 'tunnel';
      s.mustTunnel = false;
      break;
    case 'bsqWeb':
      s.phase = 'tunnel';
      s.mustTunnel = true;
      break;
    case 'line':
      s.phase = 'line';
      s.line = sign.line;
      break;
    case 'hero':
      if (sign.hero === h.hero) {
        s.extra = true;
        ev.push({ type: 'extra', seat });
      }
      break;
    case 'power':
      if (!h.power.includes(sign.power)) {
        h.power.push(sign.power);
        ev.push({ type: 'power', seat, power: sign.power });
      }
      break;
    case 'apex':
      if (qualified(h, o) && h.mag == null) {
        s.mags.push(seat);
        h.mag = s.mags.length;
        ev.push({ type: 'mag', seat, place: h.mag });
      } else ev.push({ type: 'say', seat, text: 'Вершина пирамиды: собраны не все талисманы — путь продолжается' });
      break;
    default:
      break;
  }
}

function finish(s: State, ev: Event[], text: string, winners: number[]) {
  s.over = { winners, text };
  ev.push({ type: 'over', winners, text });
}

/** Очки для предела кругов: посвящение, талисманы, треугольники. */
export function score(h: Hero): number {
  return (h.mag != null ? 1000 - h.mag : 0) + h.prot.length * 10 + h.power.length * 12 + Math.min(h.tri, 99) / 100;
}

/** Конец хода: ещё бросок, следующий игрок, пропуски, конец партии. */
function endTurn(s: State, ev: Event[]) {
  s.phase = 'roll';
  s.die = null;
  s.line = null;
  s.mustTunnel = false;
  const o = s.opts;
  const active = s.seats.filter((x) => s.heroes[x].mag == null);
  if (s.mags.length && (o.goal === 'first' || active.length <= 1)) {
    const first = s.mags[0];
    finish(s, ev, o.goal === 'first' ? `${s.names[first]} — посвящён в Магию!` : `Посвящены все: первым — ${s.names[first]}`, [first]);
    return;
  }
  if (s.extra && s.heroes[s.turn].mag == null) {
    s.extra = false;
    ev.push({ type: 'turn', seat: s.turn });
    return;
  }
  s.extra = false;
  let i = s.seats.indexOf(s.turn);
  for (let guard = 0; guard < s.seats.length * 40; guard++) {
    i = (i + 1) % s.seats.length;
    if (i === 0) s.turns++;
    const seat = s.seats[i];
    const h = s.heroes[seat];
    if (o.rounds && s.turns >= o.rounds) {
      const best = [...s.seats].sort((a, b) => score(s.heroes[b]) - score(s.heroes[a]));
      finish(s, ev, `Прошло ${o.rounds} кругов: дальше всех продвинулся ${s.names[best[0]]}`, [best[0]]);
      return;
    }
    if (h.mag != null) continue;
    if (h.skip > 0) {
      h.skip--;
      ev.push({ type: 'skipped', seat, left: h.skip });
      continue;
    }
    s.turn = seat;
    ev.push({ type: 'turn', seat });
    return;
  }
}

/** Пройти путь и сработать знаку конечной клетки. */
function moveAlong(s: State, seat: number, path: number[], ev: Event[]) {
  const h = s.heroes[seat];
  for (const c of path) {
    h.prev = h.cell;
    h.cell = c;
    ev.push({ type: 'step', seat, cell: c });
  }
  s.phase = 'roll';
  resolve(s, seat, ev);
  if (s.phase === 'roll') endTurn(s, ev);
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: S; events: Event[] } | null {
  if (s0.over || seat !== s0.turn) return null;
  const s = clone(s0);
  const h = s.heroes[seat];
  const ev: Event[] = [];
  switch (a.type) {
    case 'roll': {
      if (s.phase !== 'roll') return null;
      const die = rng.int(6) + 1;
      s.die = die;
      ev.push({ type: 'roll', seat, die });
      if (moves(s, seat, die).size === 0) {
        endTurn(s, ev);
        break;
      }
      // фишку игрок переставляет сам — действием go
      s.phase = 'move';
      break;
    }
    case 'go': {
      if (s.phase !== 'move' || s.die == null) return null;
      const path = moves(s, seat, s.die).get(a.to);
      if (!path) return null;
      if (inBsq(h)) {
        // по кольцу против часовой; встал на туннель — выход
        for (const c of path) {
          h.prev = h.cell;
          h.cell = c;
          ev.push({ type: 'step', seat, cell: c });
        }
        if (h.cell === BSQ_WEB) {
          s.phase = 'tunnel';
          s.mustTunnel = true;
        } else {
          s.phase = 'roll';
          endTurn(s, ev);
        }
        break;
      }
      moveAlong(s, seat, path, ev);
      break;
    }
    case 'tunnel': {
      if (s.phase !== 'tunnel') return null;
      if (a.to == null) {
        if (s.mustTunnel) return null;
      } else {
        if (!WEBS.includes(a.to) || a.to === h.cell) return null;
        h.prev = -1;
        h.cell = a.to;
        ev.push({ type: 'jump', seat, cell: a.to, how: 'tunnel' });
      }
      endTurn(s, ev);
      break;
    }
    case 'line': {
      if (s.phase !== 'line' || !s.line) return null;
      if (a.to == null) {
        endTurn(s, ev);
        break;
      }
      if (!LINES[s.line].includes(a.to)) return null;
      h.prev = -1;
      h.cell = a.to;
      ev.push({ type: 'jump', seat, cell: a.to, how: 'line' });
      s.phase = 'roll';
      s.line = null;
      resolve(s, seat, ev);
      if (s.phase === 'roll') endTurn(s, ev);
      break;
    }
    case 'take': {
      if (s.phase !== 'take' || h.prot.includes(a.spirit) || !SPIRITS.some((x) => x.id === a.spirit)) return null;
      h.prot.push(a.spirit);
      ev.push({ type: 'prot', seat, spirit: a.spirit, gain: true });
      endTurn(s, ev);
      break;
    }
    case 'lose': {
      if (s.phase !== 'lose') return null;
      if (a.spirit == null) {
        if (!h.portrait) return null;
        h.portrait = false;
        ev.push({ type: 'portrait', seat, text: 'Череп: талисман-портрет уберёг талисман защиты' });
      } else {
        if (!h.prot.includes(a.spirit)) return null;
        h.prot = h.prot.filter((x) => x !== a.spirit);
        ev.push({ type: 'prot', seat, spirit: a.spirit, gain: false });
      }
      endTurn(s, ev);
      break;
    }
    default:
      return null;
  }
  return { state: s, events: ev };
}
type S = State;

// ---------- описание для журнала ----------

export function describe(e: Event, name: (seat: number) => string): string | null {
  switch (e.type) {
    case 'roll':
      return `${name(e.seat)} бросает кубик: ${e.die}`;
    case 'tri':
      return e.delta > 0 ? `${name(e.seat)} получает ${e.delta} △ (всего ${e.total})` : `${name(e.seat)} отдаёт ${-e.delta} △ (осталось ${e.total})`;
    case 'prot':
      return e.gain ? `${name(e.seat)} получает талисман защиты от ${spiritOf(e.spirit).of}` : `${name(e.seat)} теряет талисман защиты от ${spiritOf(e.spirit).of}`;
    case 'power':
      return `${name(e.seat)} получает талисман власти «${powerOf(e.power).name}»`;
    case 'portrait':
      return `${name(e.seat)}: ${e.text}`;
    case 'skip':
      return `${name(e.seat)}: нечем отдать — пропуск ${e.n} ${e.n === 1 ? 'хода' : 'ходов'}`;
    case 'skipped':
      return `${name(e.seat)} пропускает ход`;
    case 'extra':
      return `${name(e.seat)} встал на свой портрет — ещё бросок`;
    case 'say':
      return `${name(e.seat)}: ${e.text}`;
    case 'jump':
      return e.how === 'tunnel' ? `${name(e.seat)} уходит пространственным туннелем` : e.how === 'line' ? `${name(e.seat)} переходит по голубой линии` : null;
    case 'mag':
      return `<b>${name(e.seat)} посвящён в Магию</b>${e.place > 1 ? ` (${e.place}-м)` : ''}`;
    case 'over':
      return e.text;
    default:
      return null;
  }
}

// ---------- расстояния для ботов ----------

/** Соседи «вперёд» для оценки расстояний: обычные шаги, ответвления, туннели (как один шаг). */
function succ(c: number): number[] {
  const cell = CELLS[c];
  const out = cell.region === 'maze' ? mazeNext(c) : [...cell.next];
  if (cell.branch != null) out.push(cell.branch);
  if (cell.sign.k === 'web' || cell.sign.k === 'bsqWeb') for (const w of WEBS) if (w !== c) out.push(w);
  if (cell.sign.k === 'line') out.push(...LINES[cell.sign.line]);
  return out;
}
const PRED: number[][] = CELLS.map(() => []);
CELLS.forEach((c) => succ(c.id).forEach((n) => PRED[n].push(c.id)));

const distCache = new Map<string, number[]>();
/** Расстояние (в шагах) от каждой клетки до ближайшей из целей. */
export function distTo(goals: number[]): number[] {
  const key = [...goals].sort((a, b) => a - b).join(',');
  const hit = distCache.get(key);
  if (hit) return hit;
  const d = CELLS.map(() => 999);
  const q: number[] = [];
  for (const g of goals) {
    d[g] = 0;
    q.push(g);
  }
  for (let i = 0; i < q.length; i++) {
    const c = q[i];
    for (const p of PRED[c]) {
      if (d[p] > d[c] + 1) {
        d[p] = d[c] + 1;
        q.push(p);
      }
    }
  }
  if (distCache.size > 200) distCache.clear();
  distCache.set(key, d);
  return d;
}

const T_CELLS = CELLS.filter((c) => c.sign.k === 'talisman').map((c) => c.id);
const powerCells = (p: Power) => CELLS.filter((c) => c.sign.k === 'power' && c.sign.power === p).map((c) => c.id);
const domainCells = (sp: Spirit) => CELLS.filter((c) => c.sign.k === 'domain' && c.sign.spirit === sp).map((c) => c.id);

/** Куда стремиться: вершина, если всё собрано; иначе недостающие талисманы власти и клетки «Т». */
export function goalsOf(h: Hero, o: Opts): number[] {
  if (qualified(h, o)) return [APEX];
  const g: number[] = [];
  if (h.power.length < o.needPower) for (const p of POWERS) if (!h.power.includes(p.id)) g.push(...powerCells(p.id));
  if (h.prot.length < o.need) g.push(...T_CELLS);
  return g.length ? g : [APEX];
}

/** Чего стоит остановиться на клетке (без учёта дороги дальше). */
export function cellValue(s: State, seat: number, c: number): number {
  const h = s.heroes[seat];
  const o = s.opts;
  const sign = CELLS[c].sign;
  const bsq = h.portrait ? -6 : -30;
  switch (sign.k) {
    case 'gain':
      return sign.n * 1.2;
    case 'lossAll':
      return -h.tri;
    case 'env':
      return h.tri >= sign.n ? -sign.n : -4 * sign.n;
    case 'black':
      return h.tri >= sign.n ? -sign.n : bsq;
    case 'domain':
      if (h.prot.includes(sign.spirit)) return h.power.length >= o.needPower ? sign.n : 0;
      return h.tri >= sign.n ? -sign.n : bsq;
    case 'talisman':
      return h.prot.length < o.need ? 14 : h.prot.length < SPIRITS.length ? 4 : 0;
    case 'skull':
      return h.prot.length ? (h.portrait ? -4 : -12) : bsq;
    case 'web':
      return 2;
    case 'line':
      return 2;
    case 'hero':
      return sign.hero === h.hero ? 6 : 0;
    case 'power':
      return h.power.includes(sign.power) ? 0 : 25;
    case 'apex':
      return qualified(h, o) ? 1000 : 0;
    case 'blue':
      return qualified(h, o) ? 8 : 0;
    case 'green': {
      const b = CELLS[c].branch;
      if (b != null && CELLS[b].region === 'pocket') {
        const pw = CELLS.find((x) => x.sign.k === 'power' && distTo([x.id])[b] < 6)?.sign as { power: Power } | undefined;
        if (pw && !h.power.includes(pw.power)) return 10;
      }
      return 0;
    }
    default:
      return 0;
  }
}

/** Оценка клетки с учётом расстояния до цели. */
function placeValue(s: State, seat: number, c: number, w: number): number {
  const h = s.heroes[seat];
  const d = distTo(goalsOf(h, s.opts))[c];
  return cellValue(s, seat, c) - w * Math.min(d, 200);
}

const pick = <T>(rng: Rng, list: T[]): T => list[rng.int(list.length)];

/** Ход бота. Бот видит то же, что человек (тайн в игре нет). */
export function botAction(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.over || s.turn !== seat) return null;
  const h = s.heroes[seat];
  const careless = level === 0 && rng.next() < 0.5;
  const w = level >= 2 ? 0.45 : 0.3;
  switch (s.phase) {
    case 'roll':
      return { type: 'roll' };
    case 'move': {
      const ends = [...moves(s, seat, s.die!).keys()];
      if (!ends.length) return null;
      if (careless) return { type: 'go', to: pick(rng, ends) };
      let best = ends[0];
      let bv = -Infinity;
      for (const e of ends) {
        let v = placeValue(s, seat, e, w);
        if (level >= 2) v += lookahead(s, seat, e) * 0.35;
        if (v > bv) {
          bv = v;
          best = e;
        }
      }
      return { type: 'go', to: best };
    }
    case 'tunnel': {
      const opts: (number | null)[] = WEBS.filter((x) => x !== h.cell);
      if (!s.mustTunnel) opts.push(null);
      if (careless) return { type: 'tunnel', to: pick(rng, opts) };
      const d = distTo(goalsOf(h, s.opts));
      let best = opts[0];
      for (const o of opts) if (d[o ?? h.cell] < d[best ?? h.cell]) best = o;
      return { type: 'tunnel', to: best };
    }
    case 'line': {
      const opts: (number | null)[] = [null, ...LINES[s.line!]];
      if (careless) return { type: 'line', to: pick(rng, opts) };
      let best: number | null = null;
      let bv = placeValue(s, seat, h.cell, w) - cellValue(s, seat, h.cell);
      for (const o of LINES[s.line!]) {
        const v = placeValue(s, seat, o, w);
        if (v > bv) {
          bv = v;
          best = o;
        }
      }
      return { type: 'line', to: best };
    }
    case 'take': {
      const miss = SPIRITS.map((x) => x.id).filter((x) => !h.prot.includes(x));
      if (careless) return { type: 'take', spirit: pick(rng, miss) };
      // защититься от того, чьи владения ближе по пути
      let best = miss[0];
      let bd = Infinity;
      for (const sp of miss) {
        const d = distTo(domainCells(sp))[h.cell];
        if (d < bd) {
          bd = d;
          best = sp;
        }
      }
      return { type: 'take', spirit: best };
    }
    case 'lose': {
      if (h.portrait && level >= 1 && h.prot.length >= s.opts.need) return { type: 'lose', spirit: null };
      if (careless) return { type: 'lose', spirit: pick(rng, h.prot) };
      let worst = h.prot[0];
      let wd = -1;
      for (const sp of h.prot) {
        const d = distTo(domainCells(sp))[h.cell];
        if (d > wd) {
          wd = d;
          worst = sp;
        }
      }
      return { type: 'lose', spirit: worst };
    }
  }
  return null;
}

/** Средняя польза следующего броска с клетки (для сложного бота). */
function lookahead(s: State, seat: number, c: number): number {
  const h = s.heroes[seat];
  const save = { cell: h.cell, prev: h.prev };
  h.cell = c;
  let sum = 0;
  for (let d = 1; d <= 6; d++) {
    let best = -Infinity;
    for (const e of routes(s, seat, d).keys()) best = Math.max(best, cellValue(s, seat, e));
    sum += best === -Infinity ? 0 : best;
  }
  h.cell = save.cell;
  h.prev = save.prev;
  return sum / 6;
}

export { heroOf, CELLS, LINES, WEBS };
