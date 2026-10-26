/* «В космос» (А. Гурштейн, И. Снегур) — движок. Правила — брошюра «Правила игры» с. 1–9 (происшествия 1–19);
 * разбор и решения — docs/analysis/materials-vkosmos.md. Разметка поля — map.ts, вопросы и словарь — quiz.ts. Без DOM.
 *
 * Три планеты движутся против часовой стрелки по большим кружкам своих орбит: после каждого круга ходов — на кружок.
 * Космолёт улетает с Земли, ответив на вопрос «Книги для отъезжающих», и летит по жёлтым дорожкам и орбитам: бросок
 * кубика — столько кружков (бак топлива за ход; ускорение +1 кружок — второй бак). Сменить направление можно только
 * на оранжевом кружке, остановившись на нём. Поравнялся с планетой — посадка. Нужно побывать на Венере и на Марсе
 * (в любом порядке) и вернуться на Землю. Кончилось топливо — вызвать автоматическую станцию. */
import type { Options, Rng } from '../../core/types';
import { NODES, ORBITS, PATHS } from './map';
import { CATEGORIES, LETTERS, PLANETS, TECH, WORDS } from './quiz';

export type Planet = 'venus' | 'earth' | 'mars';
export const PLANETS_ORDER: Planet[] = ['venus', 'earth', 'mars'];
export const PLANET_NAME: Record<Planet, string> = { venus: 'Венера', earth: 'Земля', mars: 'Марс' };

/** Большие кружки орбит по порядку (против часовой). */
export const BIG: Record<Planet, number[]> = {
  venus: ORBITS.venus.filter((i) => NODES[i].big),
  earth: ORBITS.earth.filter((i) => NODES[i].big),
  mars: ORBITS.mars.filter((i) => NODES[i].big),
};
export const START = NODES.findIndex((n) => n.start);
/** Кружок Марса с происшествием 17 — там нельзя ни сесть, ни взлететь. */
const NEW_YEAR = NODES.findIndex((n) => n.kind === 'mars' && n.big && n.incident === 17);

/** Рёбра: узел → [сосед, цепочка]. Цепочки: 'venus' | 'earth' | 'mars' | 'p0'… */
export const LINKS: [number, string][][] = NODES.map(() => []);
function chain(nodes: number[], closed: boolean, id: string) {
  for (let i = 0; i + 1 < nodes.length; i++) {
    LINKS[nodes[i]].push([nodes[i + 1], id]);
    LINKS[nodes[i + 1]].push([nodes[i], id]);
  }
  if (closed) {
    LINKS[nodes[nodes.length - 1]].push([nodes[0], id]);
    LINKS[nodes[0]].push([nodes[nodes.length - 1], id]);
  }
}
for (const pl of PLANETS_ORDER) chain(ORBITS[pl], true, pl);
PATHS.forEach((p, i) => chain(p.nodes, p.closed, `p${i}`));

/** Цвета космолётов. */
export const COLORS = ['#e8402a', '#f2c21a', '#2ab0e8', '#e86ad0', '#7ad040', '#f08a2a'];

export const FUEL = 7;
export const AC_LOAD = 7;
export const MAX_ROUNDS = 150;

export type Book = 'depart' | 'planets' | 'tech';
export interface Question {
  book: Book;
  /** depart: номер категории и буква; planets/tech: номер вопроса. */
  n: number;
  letter: string;
  options: string[];
}

export interface Ship {
  seat: number;
  node: number;
  /** Откуда пришёл (направление); −1 — свободно (на планете, на оранжевом кружке после остановки). */
  from: number;
  /** Цепочка, по которой шёл последний шаг (на оранжевом кружке нельзя свернуть с неё на ходу). */
  via: string;
  /** На какой планете стоит (едет вместе с ней), null — в космосе. */
  on: Planet | null;
  fuel: number;
  visited: Planet[];
  skip: number;
  /** Особые состояния от происшествий. */
  half: boolean;
  free: boolean;
  double: boolean;
  boost: boolean;
  /** Ремонт после метеорита (п. 6): сначала вопрос «Технического вопросника». */
  repair: boolean;
  /** Не ответил на «Книгу планет» — дальше «Книга для отъезжающих». */
  failed: boolean;
  /** Сколько кружков осталось до автоматической станции (−1 — не вызвана). */
  ac: number;
  extra: number;
}

export interface Cfg {
  /** Посадка: «поравняться» на пути (лишние очки пропадают) — по правилам; точная — только последним шагом. */
  exact: boolean;
}
export const cfgFrom = (o: Options): Cfg => ({ exact: o.landing === 'exact' });

export interface State {
  cfg: Cfg;
  ships: Ship[];
  planets: Record<Planet, number>;
  turn: number;
  phase: 'question' | 'roll' | 'move' | 'over';
  /** Зачем вопрос: взлёт, ремонт, вызов АС, помощь (п. 8), ремонт (п. 16). */
  why: 'takeoff' | 'repair' | 'ac' | 'help' | 'fix' | null;
  question: Question | null;
  /** Последний бросок и маршруты для перестановки. */
  roll: number;
  routes: Route[];
  round: number;
  winner: number | null;
  last: number[];
  /** Угол стрелки вертушки (для вида). */
  spin: number;
}

export interface Route {
  path: number[];
  /** Ускорение (+1, второй бак). */
  boost: boolean;
  land: Planet | null;
}

export type Action = { type: 'answer'; i: number } | { type: 'roll' } | { type: 'wait' } | { type: 'move'; i: number };

export type Event =
  | { type: 'spin'; seat: number; q: Question }
  | { type: 'answer'; seat: number; ok: boolean; right: string; why: State['why'] }
  | { type: 'roll'; seat: number; value: number }
  | { type: 'move'; seat: number; path: number[]; land: Planet | null; incident: number }
  | { type: 'wait'; seat: number }
  | { type: 'ac'; seat: number; left: number; arrived: boolean }
  | { type: 'skip'; seat: number }
  | { type: 'planets'; carried: number[] }
  | { type: 'land'; seat: number; planet: Planet; passive: boolean }
  | { type: 'end'; winner: number | null };

/** Верный ответ на вопрос (сервер не хранит отдельно: его знает содержание вопроса). */
export function isRight(q: Question, i: number): boolean {
  const opt = q.options[i];
  if (opt == null) return false;
  if (q.book === 'depart') return WORDS[q.n].includes(opt) && opt[0].toUpperCase() === q.letter;
  return (q.book === 'planets' ? PLANETS : TECH)[q.n].right === opt;
}
export const rightOf = (q: Question) => q.options.findIndex((_, i) => isRight(q, i));

function shuffle<T>(a: T[], rng: Rng): T[] {
  const b = [...a];
  for (let i = b.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [b[i], b[j]] = [b[j], b[i]];
  }
  return b;
}

/** Вертушка: цифра 1–10 и буква (одна из 18); на букву, где в категории нет слов, — крутят ещё раз. */
export function makeQuestion(book: Book, rng: Rng): Question {
  const n = rng.int(10);
  if (book !== 'depart') {
    const q = (book === 'planets' ? PLANETS : TECH)[n];
    return { book, n, letter: '', options: shuffle([q.right, ...q.wrong], rng) };
  }
  for (;;) {
    const letter = LETTERS[rng.int(LETTERS.length)];
    const ok = WORDS[n].filter((w) => w[0].toUpperCase() === letter);
    if (!ok.length) continue;
    const right = ok[rng.int(ok.length)];
    const others = shuffle(
      WORDS.flatMap((ws, k) => (k === n ? [] : ws.filter((w) => w[0].toUpperCase() === letter && !WORDS[n].includes(w)))),
      rng
    );
    // не хватает слов на ту же букву — слова этой категории на другие буквы (тоже неверно: буква не та)
    const fill = shuffle(WORDS[n].filter((w) => w[0].toUpperCase() !== letter), rng);
    const wrong = [...new Set([...others, ...fill])].slice(0, 3);
    return { book, n, letter, options: shuffle([right, ...wrong], rng) };
  }
}
export const questionText = (q: Question) => (q.book === 'depart' ? `${CATEGORIES[q.n]} — на букву «${q.letter}»` : (q.book === 'planets' ? PLANETS : TECH)[q.n].q);

export function newState(cfg: Cfg, n: number, rng: Rng): State {
  const planets = {
    venus: BIG.venus.findIndex((i) => NODES[i].num === 1 + rng.int(6)),
    earth: BIG.earth.indexOf(START),
    mars: BIG.mars.findIndex((i) => NODES[i].num === 1 + rng.int(6)),
  };
  const ships: Ship[] = Array.from({ length: n }, (_, seat) => ({
    seat,
    node: START,
    from: -1,
    via: '',
    on: 'earth',
    fuel: FUEL,
    visited: [],
    skip: 0,
    half: false,
    free: false,
    double: false,
    boost: false,
    repair: false,
    failed: false,
    ac: -1,
    extra: 0,
  }));
  const s: State = { cfg, ships, planets, turn: 0, phase: 'question', why: 'takeoff', question: null, roll: 0, routes: [], round: 0, winner: null, last: [], spin: 0 };
  begin(s, rng, []);
  return s;
}

export const setup = (o: Options, n: number, rng: Rng) => newState(cfgFrom(o), n, rng);
export const planetAt = (s: State, pl: Planet) => BIG[pl][s.planets[pl]];

export function toAct(s: State): number[] {
  return s.phase === 'over' ? [] : [s.turn];
}

/** Что нужно кораблю: куда лететь (ещё не был), или домой. */
export function targets(sh: Ship): Planet[] {
  const left = (['venus', 'mars'] as Planet[]).filter((p) => !sh.visited.includes(p));
  return left.length ? left : ['earth'];
}

function canLand(s: State, sh: Ship, pl: Planet, node: number): boolean {
  if (!targets(sh).includes(pl)) return false;
  if (pl === 'mars' && node === NEW_YEAR) return false;
  return planetAt(s, pl) === node;
}

/** Маршруты на k кружков (и k+1 с ускорением): без возврата назад, без повторов; на оранжевом кружке на ходу — не свернуть;
 * поравнялся с нужной планетой — посадка, дальше не летит. */
export function routesFor(s: State, sh: Ship, k: number): Route[] {
  const out: Route[] = [];
  const seen = new Set<string>();
  const walk = (node: number, from: number, via: string, path: number[], left: number, boost: boolean) => {
    if (left === 0) {
      const key = `${node}:${from}:${boost}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ path, boost, land: null });
      }
      return;
    }
    for (const [nb, ch] of LINKS[node]) {
      if (nb === from || path.includes(nb) || nb === sh.node) continue;
      if (path.length && NODES[node].kind === 'junction' && ch !== via) continue;
      const p = [...path, nb];
      const land = PLANETS_ORDER.find((pl) => canLand(s, sh, pl, nb));
      if (land && (!s.cfg.exact || left === 1)) {
        const key = `L${nb}`;
        if (!seen.has(key)) {
          seen.add(key);
          out.push({ path: p, boost, land });
        }
        continue;
      }
      walk(nb, node, ch, p, left - 1, boost);
    }
  };
  // старт: с планеты или с остановки на оранжевом кружке — в любую сторону
  walk(sh.node, sh.from, sh.from < 0 ? '' : sh.via, [], k, false);
  // ускорение: +1 кружок, если хватает топлива и конец обычного хода не на кружке с цифрой
  if (sh.fuel >= 2 && !sh.free) {
    const base = out.filter((r) => !r.land && !NODES[r.path[r.path.length - 1]].incident);
    for (const r of base) {
      const end = r.path[r.path.length - 1];
      const prev = r.path.length > 1 ? r.path[r.path.length - 2] : sh.node;
      for (const [nb, ch] of LINKS[end]) {
        if (nb === prev || r.path.includes(nb) || nb === sh.node || NODES[nb].incident) continue;
        if (NODES[end].kind === 'junction' && ch !== chainOf(prev, end)) continue;
        const land = PLANETS_ORDER.find((pl) => canLand(s, sh, pl, nb)) ?? null;
        const key = `B${nb}:${end}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ path: [...r.path, nb], boost: true, land });
      }
    }
  }
  return out;
}
function chainOf(a: number, b: number): string {
  return LINKS[a].find(([n]) => n === b)?.[1] ?? '';
}

function clone(s: State): State {
  return { ...s, ships: s.ships.map((x) => ({ ...x, visited: [...x.visited] })), planets: { ...s.planets }, routes: [...s.routes], last: [...s.last] };
}

/** Начало хода текущего игрока: пропуски, вопросы, вызов АС. */
function begin(s: State, rng: Rng, events: Event[]) {
  for (let guard = 0; guard < s.ships.length * 4; guard++) {
    const sh = s.ships[s.turn];
    if (sh.skip > 0) {
      sh.skip--;
      events.push({ type: 'skip', seat: s.turn });
      next(s, rng, events);
      if (s.phase === 'over') return;
      continue;
    }
    break;
  }
  const sh = s.ships[s.turn];
  s.question = null;
  s.why = null;
  s.routes = [];
  if (sh.on) {
    s.why = 'takeoff';
    ask(s, sh.on === 'earth' || sh.failed ? 'depart' : 'planets', rng, events);
    return;
  }
  if (sh.repair) {
    s.why = 'repair';
    ask(s, 'tech', rng, events);
    return;
  }
  if (sh.fuel <= 0 && sh.ac < 0) {
    s.why = 'ac';
    ask(s, 'tech', rng, events);
    return;
  }
  s.phase = 'roll';
}

function ask(s: State, book: Book, rng: Rng, events: Event[]) {
  s.question = makeQuestion(book, rng);
  s.spin = rng.int(360);
  s.phase = 'question';
  events.push({ type: 'spin', seat: s.turn, q: s.question });
}

/** Следующий игрок; после круга — планеты сдвигаются на кружок. */
function next(s: State, rng: Rng, events: Event[]) {
  const sh = s.ships[s.turn];
  if (sh.extra > 0) {
    sh.extra--;
    s.phase = 'roll';
    return;
  }
  s.turn = (s.turn + 1) % s.ships.length;
  if (s.turn === 0) {
    s.round++;
    movePlanets(s, events);
    if (s.round >= MAX_ROUNDS) {
      // предел: кто больше планет посетил
      let best = 0;
      s.ships.forEach((x, i) => {
        if (x.visited.length > s.ships[best].visited.length) best = i;
      });
      s.phase = 'over';
      s.winner = best;
      events.push({ type: 'end', winner: best });
    }
  }
}

function movePlanets(s: State, events: Event[]) {
  const carried: number[] = [];
  for (const pl of PLANETS_ORDER) {
    s.planets[pl] = (s.planets[pl] + 1) % BIG[pl].length;
    const node = planetAt(s, pl);
    for (const sh of s.ships) {
      if (sh.on === pl) {
        sh.node = node;
        carried.push(sh.seat);
      } else if (!sh.on && sh.node === node && sh.fuel >= 1 && canLand(s, sh, pl, node)) {
        // планета прошла через космолёт — посадка (нужен хотя бы бак)
        land(s, sh, pl, events, true);
      }
    }
  }
  events.push({ type: 'planets', carried });
}

function land(s: State, sh: Ship, pl: Planet, events: Event[], passive: boolean) {
  sh.on = pl;
  sh.node = planetAt(s, pl);
  sh.from = -1;
  sh.boost = false;
  if (!sh.visited.includes(pl) && pl !== 'earth') sh.visited.push(pl);
  events.push({ type: 'land', seat: sh.seat, planet: pl, passive });
  if (pl === 'earth' && sh.visited.length === 2) {
    s.phase = 'over';
    s.winner = sh.seat;
    events.push({ type: 'end', winner: sh.seat });
  }
}

function incident(s: State, sh: Ship, n: number, rng: Rng, events: Event[]): boolean {
  switch (n) {
    case 1:
      sh.extra++;
      sh.free = true;
      break;
    case 2:
    case 19:
      sh.fuel++;
      break;
    case 3:
    case 14:
    case 18:
      sh.skip++;
      break;
    case 4:
      sh.half = true;
      break;
    case 5:
      sh.free = true;
      break;
    case 6:
      sh.repair = true;
      break;
    case 7:
      sh.extra++;
      sh.fuel = Math.max(0, sh.fuel - 1);
      break;
    case 8:
    case 16:
      s.why = n === 8 ? 'help' : 'fix';
      ask(s, 'tech', rng, events);
      return true;
    case 9:
      sh.skip++;
      sh.fuel++;
      break;
    case 10: {
      // ещё 4 кружка вперёд — игрок сам переставляет
      const r = routesFor(s, { ...sh, fuel: 0 }, 4);
      if (r.length) {
        s.routes = r;
        s.roll = 4;
        s.phase = 'move';
        return true;
      }
      break;
    }
    case 11:
      if (sh.visited.includes('mars') && !sh.visited.includes('venus')) sh.boost = true;
      break;
    case 12:
      sh.fuel = Math.max(0, sh.fuel - 1);
      break;
    case 13:
      sh.double = true;
      break;
    case 15:
      sh.skip++;
      sh.boost = true;
      break;
  }
  return false;
}

export function legal(s: State, seat: number): Action[] {
  if (s.phase === 'over' || seat !== s.turn) return [];
  if (s.phase === 'question') return s.question!.options.map((_, i) => ({ type: 'answer', i }) as Action);
  if (s.phase === 'roll') {
    const sh = s.ships[seat];
    return sh.fuel > 0 || sh.ac >= 0 ? [{ type: 'roll' }, ...(sh.ac < 0 ? [{ type: 'wait' } as Action] : [])] : [{ type: 'wait' }];
  }
  return s.routes.map((_, i) => ({ type: 'move', i }) as Action);
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (!a || typeof a !== 'object' || !legal(s0, seat).some((x) => x.type === a.type && ('i' in x ? x.i === (a as { i: number }).i : true))) return null;
  const s = clone(s0);
  const sh = s.ships[seat];
  const events: Event[] = [];
  const fin = () => {
    if (s.phase !== 'over') {
      next(s, rng, events);
      if ((s.phase as State['phase']) !== 'over') begin(s, rng, events);
    }
    return { state: s, events };
  };
  if (a.type === 'answer') {
    const q = s.question!;
    const ok = isRight(q, a.i);
    const why = s.why;
    events.push({ type: 'answer', seat, ok, right: q.options[rightOf(q)], why });
    s.question = null;
    if (why === 'takeoff') {
      if (!ok) {
        if (sh.on !== 'earth') sh.failed = true;
        return fin();
      }
      if (sh.on === 'mars' && sh.node === NEW_YEAR) return fin();
      if (sh.on !== 'earth') sh.fuel = Math.max(sh.fuel, FUEL);
      sh.failed = false;
      sh.on = null;
      sh.from = -1;
      s.phase = 'roll';
      return { state: s, events };
    }
    if (why === 'repair') {
      if (!ok) return fin();
      sh.repair = false;
      return fin();
    }
    if (why === 'ac') {
      if (!ok) return fin();
      // ближайшая планета — расстояние по кружкам
      sh.ac = acDistance(s, sh);
      return fin();
    }
    if (why === 'help' && ok) sh.fuel++;
    if (why === 'fix' && !ok) sh.skip++;
    return fin();
  }
  if (a.type === 'wait') {
    events.push({ type: 'wait', seat });
    return fin();
  }
  if (a.type === 'roll') {
    const v = 1 + rng.int(6);
    events.push({ type: 'roll', seat, value: v });
    if (sh.ac >= 0) {
      sh.ac -= v + 2;
      const arrived = sh.ac <= 0;
      if (arrived) {
        sh.ac = -1;
        sh.fuel = AC_LOAD;
      }
      events.push({ type: 'ac', seat, left: Math.max(0, sh.ac), arrived });
      return fin();
    }
    let k = v;
    if (sh.half) k = Math.max(1, Math.floor(v / 2));
    if (sh.double) k = v * 2;
    if (sh.boost) k = v + 1;
    sh.half = false;
    sh.double = false;
    s.roll = k;
    s.routes = routesFor(s, sh, k);
    if (!s.routes.length) return fin();
    s.phase = 'move';
    return { state: s, events };
  }
  // ход
  const r = s.routes[(a as { i: number }).i];
  const end = r.path[r.path.length - 1];
  const cost = sh.free ? 0 : r.boost ? 2 : 1;
  sh.free = false;
  sh.fuel = Math.max(0, sh.fuel - cost);
  s.last = [sh.node, end];
  sh.from = r.path.length > 1 ? r.path[r.path.length - 2] : sh.node;
  sh.via = chainOf(sh.from, end);
  sh.node = end;
  s.routes = [];
  // остановился на оранжевом кружке — можно сменить направление
  if (NODES[end].kind === 'junction') sh.from = -1;
  const inc = !r.land ? (NODES[end].incident ?? 0) : 0;
  events.push({ type: 'move', seat, path: r.path, land: r.land, incident: inc });
  if (r.land) {
    land(s, sh, r.land, events, false);
    if (s.phase === 'over') return { state: s, events };
    return fin();
  }
  if (inc && incident(s, sh, inc, rng, events)) return { state: s, events };
  return fin();
}

/** Сколько кружков до космолёта от ближайшей планеты (поиск в ширину). */
function acDistance(s: State, sh: Ship): number {
  const dist = new Map<number, number>([[sh.node, 0]]);
  const q = [sh.node];
  const planets = new Set(PLANETS_ORDER.map((p) => planetAt(s, p)));
  while (q.length) {
    const x = q.shift()!;
    if (planets.has(x)) return dist.get(x)!;
    for (const [nb] of LINKS[x])
      if (!dist.has(nb)) {
        dist.set(nb, dist.get(x)! + 1);
        q.push(nb);
      }
  }
  return 20;
}

/** Расстояние в кружках между узлами (для ботов и показа). */
export function distances(from: number): number[] {
  const d = Array(NODES.length).fill(999);
  d[from] = 0;
  const q = [from];
  while (q.length) {
    const x = q.shift()!;
    for (const [nb] of LINKS[x])
      if (d[nb] > d[x] + 1) {
        d[nb] = d[x] + 1;
        q.push(nb);
      }
  }
  return d;
}
