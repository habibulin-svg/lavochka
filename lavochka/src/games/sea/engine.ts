/* Морские игры В. М. Голицына — «Пираты» и «Захват колоний»: общий движок.
 *
 * Ход игрока: крутит вертушку (ветер на все его корабли) → каждый корабль может раз пройти по прямой одним из восьми румбов
 * (сколько клеток — от угла к ветру: фордевинд и бакштаг 3, галфвинд 2, бейдевинд 1, против ветра нельзя) и раз выстрелить
 * (до или после хода); можно бить залпом несколькими кораблями по одному щелчку вертушки. Штиль — стоят (пираты — на вёслах
 * на клетку), ураган — всех не в порту сносит на клетку по ветру.
 *
 * «Пираты»: три испанских галиона из Вера-Круца везут золото на одном (его выбирают тайно) в Кадикс, шесть пиратских
 * бригантин с шести баз его ищут. Потопленный золотой галион не тонет — его ведут пираты, а испанцам хватает одного попадания,
 * чтобы отбить. «Захват колоний»: у каждого 2–3 корабля, порты сбивают выстрелами и занимают, побеждает набравший 29 очков. */
import type { Rng } from '../../core/types';
import { MAPS, cheb, charAt, inside, isHome, isWater, portAt, type MapId, type PortDef, type SeaMap } from './maps';
import { spin, type Spin } from './spinner';
import { POINTS, POINT_STEP, sailSteps, type Point } from './wind';

export type Side = 'es' | 'pi' | 'col';
export type Cls = 'galleon' | 'brig';

export interface Ship {
  id: number;
  name: string;
  /** Флажок-кружок с названием (лист «Корабли» из журнала): номер картинки. */
  disc: number;
  cls: Cls;
  /** Кто сейчас ведёт корабль. */
  owner: number;
  /** За чью сторону он сейчас (золотой галион переходит из рук в руки). */
  side: Side;
  x: number;
  y: number;
  hits: number;
  /** Боеприпасы для укрепления портов («Захват колоний»). */
  ammo: number;
  /** Золото — видят только испанцы, пока галион не потоплен. */
  gold?: boolean;
  sunk?: boolean;
  /** Выброшен ураганом на берег («Захват колоний»): погибнет, если следующий ураган застанет его там. */
  ashore?: boolean;
  /** Ничейный золотой галион, разбитый о скалы: забирает тот, кто первым подойдёт вплотную. */
  derelict?: boolean;
  /** Сколько своих ходов ещё чинится в порту. */
  fix?: number;
  moved?: boolean;
  shot?: boolean;
}

export interface PortState {
  owner: number | null;
  /** Попадания в порт. */
  dmg: number;
  /** Сложенные в порт боеприпасы — укрепление: сбивать дольше. */
  ammo: number;
  /** Сбит и никем не занят — займёт первый, кто войдёт. */
  down: boolean;
  fired?: boolean;
}

export interface Opts {
  game: MapId;
  /** «Пираты»: ураган выбросил на скалы — гибель сразу (журнал «Пионер») или повторная вертушка (поправка игроков). */
  shore: 'wreck' | 'respin';
  /** «Пираты»: на вёслах только в штиль или ещё и на клетку против ветра. */
  oars: 'calm' | 'against';
  /** «Захват колоний»: очки до победы. */
  target: number;
  /** «Захват колоний»: кораблей у каждого (0 — как в правилах: втроём и меньше по 3, вчетвером и впятером по 2). */
  ships: number;
  /** «Захват колоний»: погибший корабль возвращается в квадратик старта. */
  revive: boolean;
  /** Предел кругов (0 — без предела). */
  limit: number;
}

export interface Result {
  winners: number[];
  text: string;
}

export interface State {
  game: MapId;
  o: Opts;
  /** Порядок ходов. */
  seats: number[];
  side: Record<number, Side>;
  turn: number;
  phase: 'gold' | 'spin' | 'act';
  wind: Spin | null;
  round: number;
  ships: Ship[];
  ports: PortState[];
  /** Нейтральные порты, по которым в этот ход промахнулись: в конце хода они отвечают. */
  answer: number[];
  goldKnown: boolean;
  result: Result | null;
}

export type Target = { ship: number } | { port: number };

export type Action =
  | { type: 'gold'; ship: number }
  | { type: 'spin' }
  | { type: 'move'; ship: number; course: Point; steps: number }
  | { type: 'shoot'; ships: number[]; target: Target }
  | { type: 'portShot'; port: number; ship: number }
  | { type: 'repair'; ship: number }
  | { type: 'unload'; ship: number }
  | { type: 'load'; ship: number }
  | { type: 'end' };

export interface XY {
  x: number;
  y: number;
}

export type Event =
  | { t: 'gold'; seat: number }
  | { t: 'spin'; seat: number; spin: Spin }
  | { t: 'drift'; ship: number; from: XY; to?: XY; stay?: 'ship' | 'edge' | 'port'; shore?: boolean; wreck?: boolean; respin?: Spin; derelict?: boolean }
  | { t: 'refloat'; ship: number }
  | { t: 'move'; ship: number; path: XY[]; port?: number }
  | { t: 'shot'; seat: number; ships: number[]; target: Target; spin: Spin; holes: number; sunk?: boolean; captured?: boolean; recaptured?: boolean; down?: boolean }
  | { t: 'portFire'; port: number; ship: number; spin: Spin; sunk?: boolean }
  | { t: 'claim'; port: number; seat: number; from: number | null }
  | { t: 'salvage'; ship: number; seat: number }
  | { t: 'repair'; ship: number; turns: number }
  | { t: 'fixed'; ship: number }
  | { t: 'ammo'; ship: number; port: number; n: number }
  | { t: 'revive'; ship: number }
  | { t: 'turn'; seat: number; round: number }
  | { t: 'end'; result: Result };

export const SHIP_NAMES = ['Пегас', 'Цефея', 'Вега', 'Лев', 'Лира', 'Рак', 'Кит', 'Ворон', 'Гемма', 'Змея'];

export const DEFAULTS: Opts = { game: 'piraty', shore: 'respin', oars: 'against', target: 29, ships: 0, revive: false, limit: 150 };

export const mapOf = (s: { game: MapId }): SeaMap => MAPS[s.game];

/** С какого попадания корабль идёт ко дну: галион — с третьего, бригантина — со второго. */
export const sinkAt = (s: Ship) => (s.cls === 'galleon' ? 3 : 2);
/** Дальность стрельбы: галионы бьют на две клетки во все стороны, бригантины — на одну; в «Захвате колоний» все на две. */
export const range = (s: Ship) => (s.cls === 'galleon' ? 2 : 1);
/** Сколько попаданий сбивают порт: цена 6 и 5 — три, 3 — два, 1 — одно (половина цены с округлением вверх) плюс укрепление. */
export const portNeed = (p: PortDef) => Math.ceil((p.value ?? 2) / 2);
export const portStrength = (s: State, id: number) => portNeed(mapOf(s).ports[id]) + s.ports[id].ammo;

export const AMMO = 5;
const SIDE_NAME: Record<Side, string> = { es: 'испанцы', pi: 'пираты', col: '' };

/** Раскладка «Пиратов» по числу игроков: [кораблей у каждого испанца], [у каждого пирата]. */
export function piratyTeams(n: number): { es: number[]; pi: number[] } {
  const t: Record<number, { es: number[]; pi: number[] }> = {
    2: { es: [3], pi: [6] },
    3: { es: [3], pi: [3, 3] },
    4: { es: [3], pi: [2, 2, 2] },
    5: { es: [2, 1], pi: [2, 2, 2] },
    6: { es: [2, 1], pi: [2, 2, 1, 1] },
    7: { es: [1, 1, 1], pi: [2, 2, 1, 1] },
    8: { es: [1, 1, 1], pi: [2, 1, 1, 1, 1] },
    9: { es: [1, 1, 1], pi: [1, 1, 1, 1, 1, 1] },
  };
  return t[Math.max(2, Math.min(9, n))];
}

export function newState(seatList: number[], o: Partial<Opts>, rng: Rng): State {
  const opts: Opts = { ...DEFAULTS, ...o };
  const m = MAPS[opts.game];
  const s: State = {
    game: opts.game,
    o: opts,
    seats: [],
    side: {},
    turn: 0,
    phase: 'spin',
    wind: null,
    round: 1,
    ships: [],
    ports: m.ports.map(() => ({ owner: null, dmg: 0, ammo: 0, down: false })),
    answer: [],
    goldKnown: false,
    result: null,
  };
  if (opts.game === 'piraty') {
    const team = piratyTeams(seatList.length);
    const es = seatList.slice(0, team.es.length);
    const pi = seatList.slice(team.es.length);
    // испанцы и пираты ходят через одного, начинают испанцы
    for (let i = 0; i < Math.max(es.length, pi.length); i++) {
      if (es[i] !== undefined) s.seats.push(es[i]);
      if (pi[i] !== undefined) s.seats.push(pi[i]);
    }
    const vera = m.ports.find((p) => p.name === 'Вера-Круц')!;
    let g = 0;
    es.forEach((seat, k) => {
      s.side[seat] = 'es';
      for (let i = 0; i < team.es[k]; i++, g++)
        s.ships.push({ id: s.ships.length, name: SHIP_NAMES[g], disc: g, cls: 'galleon', owner: seat, side: 'es', x: vera.x, y: vera.y, hits: 0, ammo: 0 });
    });
    const bases = m.ports.filter((p) => p.kind === 'pi');
    let b = 0;
    pi.forEach((seat, k) => {
      s.side[seat] = 'pi';
      for (let i = 0; i < team.pi[k]; i++, b++)
        s.ships.push({ id: s.ships.length, name: SHIP_NAMES[3 + b], disc: 3 + b, cls: 'brig', owner: seat, side: 'pi', x: bases[b].x, y: bases[b].y, hits: 0, ammo: 0 });
    });
    s.phase = 'gold';
  } else {
    const per = opts.ships || (seatList.length <= 3 ? 3 : 2);
    // жребий: кто ходит первым
    const first = rng.int(seatList.length);
    s.seats = [...seatList.slice(first), ...seatList.slice(0, first)];
    let k = 0;
    for (const seat of seatList) {
      s.side[seat] = 'col';
      for (let i = 0; i < per; i++, k++) {
        const h = m.home[k % m.home.length];
        s.ships.push({ id: s.ships.length, name: SHIP_NAMES[k % SHIP_NAMES.length], disc: k % SHIP_NAMES.length, cls: 'galleon', owner: seat, side: 'col', x: h % m.w, y: Math.floor(h / m.w), hits: 0, ammo: AMMO });
      }
    }
  }
  return s;
}

export const seatNow = (s: State) => s.seats[s.turn];
export const live = (s: State) => s.ships.filter((x) => !x.sunk);
export const shipsOf = (s: State, seat: number) => s.ships.filter((x) => !x.sunk && !x.derelict && x.owner === seat);
export const shipAt = (s: State, x: number, y: number, except = -1) => s.ships.find((t) => !t.sunk && t.id !== except && t.x === x && t.y === y) ?? null;
export const colonies = (s: State, seat: number) => s.ports.filter((p) => p.owner === seat).length;
export const points = (s: State, seat: number) => mapOf(s).ports.reduce((a, p, i) => a + (s.ports[i].owner === seat ? (p.value ?? 0) : 0), 0);

/** Стоит ли корабль в порту или в квадратике старта: там его не бьют и сам он не стреляет. */
export function harbored(s: State, sh: XY): boolean {
  const m = mapOf(s);
  return !!portAt(m, sh.x, sh.y) || isHome(m, sh.x, sh.y);
}

/** Может ли корабль войти в порт: испанцы — в свои, пираты — на базы; колонии — свои и сбитые. */
export function canEnter(s: State, sh: Ship, p: PortDef): boolean {
  if (s.game === 'piraty') return p.kind === sh.side;
  const ps = s.ports[p.id];
  return ps.owner === sh.owner || ps.down;
}

/** Где можно чиниться. */
export function canRepairAt(s: State, sh: Ship): boolean {
  const p = portAt(mapOf(s), sh.x, sh.y);
  if (!p || sh.hits === 0) return false;
  if (s.game === 'piraty') return p.kind === sh.side;
  return s.ports[p.id].owner === sh.owner;
}

export const busy = (sh: Ship) => (sh.fix ?? 0) > 0;

/** Сколько клеток разрешает ветер этим курсом. */
export function allowed(s: State, sh: Ship, course: Point): number {
  const w = s.wind;
  if (!w || w.weather === 'storm') return 0;
  const oars = s.game === 'piraty' && sh.cls === 'brig';
  if (w.weather === 'calm') return oars ? 1 : 0;
  const sail = sailSteps(w.from, course);
  if (sail > 0) return sail;
  return oars && s.o.oars === 'against' ? 1 : 0;
}

const opposite = (a: Point, b: Point) => Math.abs(POINTS.indexOf(a) - POINTS.indexOf(b)) === 4;

export interface Reach {
  course: Point;
  steps: number;
  to: XY;
  path: XY[];
}

/**
 * Куда корабль может дойти: по прямой одним румбом. Через корабли и чужие порты не пройти; в своём порту путь кончается.
 * Течение: попав на клетку со стрелкой, корабль сносит на клетку к её острию (если она свободна) и он идёт дальше тем же курсом;
 * против течения — только если ветер даёт этим курсом хотя бы две клетки.
 */
export function reach(s: State, sh: Ship): Reach[] {
  const m = mapOf(s);
  const out: Reach[] = [];
  if (sh.sunk || sh.derelict || sh.ashore || busy(sh) || sh.moved) return out;
  for (const course of POINTS) {
    const max = allowed(s, sh, course);
    if (!max) continue;
    const [dx, dy] = POINT_STEP[course];
    let x = sh.x;
    let y = sh.y;
    const path: XY[] = [];
    for (let k = 1; k <= max; k++) {
      const nx = x + dx;
      const ny = y + dy;
      if (!inside(m, nx, ny) || !isWater(m, nx, ny)) break;
      const port = portAt(m, nx, ny);
      if (port && !canEnter(s, sh, port)) break;
      const free = !shipAt(s, nx, ny, sh.id) || !!port || isHome(m, nx, ny);
      if (!free) break;
      x = nx;
      y = ny;
      path.push({ x, y });
      if (port) {
        out.push({ course, steps: k, to: { x, y }, path: [...path] });
        break;
      }
      const c = m.cur.get(y * m.w + x);
      if (c) {
        if (opposite(c, course)) {
          if (max < 2) break;
        } else {
          const tx = x + POINT_STEP[c][0];
          const ty = y + POINT_STEP[c][1];
          if (inside(m, tx, ty) && charAt(m, tx, ty) === '.' && !shipAt(s, tx, ty, sh.id) && !portAt(m, tx, ty)) {
            x = tx;
            y = ty;
            path.push({ x, y });
          }
        }
      }
      if (!shipAt(s, x, y, sh.id) || isHome(m, x, y)) out.push({ course, steps: k, to: { x, y }, path: [...path] });
    }
  }
  // в одну клетку — самым коротким путём
  const seen = new Set<string>();
  return out.filter((r) => {
    const k = r.to.x + ',' + r.to.y;
    if (seen.has(k) || (r.to.x === sh.x && r.to.y === sh.y)) return false;
    seen.add(k);
    return true;
  });
}

export function canAttackSeat(s: State, seat: number, victim: number | null): boolean {
  if (s.game === 'piraty') return true;
  // нападать на чужих может только тот, у кого есть хотя бы одна колония
  return victim === null || colonies(s, seat) > 0;
}

/** По кому этот корабль может выстрелить. */
export function targetsOf(s: State, sh: Ship): Target[] {
  if (sh.sunk || sh.derelict || sh.ashore || busy(sh) || sh.shot || harbored(s, sh)) return [];
  const out: Target[] = [];
  const r = range(sh);
  for (const t of s.ships) {
    if (t.sunk || t.derelict || t.owner === sh.owner || harbored(s, t) || cheb(t, sh) > r) continue;
    if (s.game === 'piraty' && t.side === sh.side) continue;
    if (!canAttackSeat(s, sh.owner, t.owner)) continue;
    out.push({ ship: t.id });
  }
  if (s.game === 'kolonii') {
    mapOf(s).ports.forEach((p, i) => {
      const ps = s.ports[i];
      if (ps.down || ps.owner === sh.owner || cheb(p, sh) > r) return;
      if (!canAttackSeat(s, sh.owner, ps.owner)) return;
      out.push({ port: i });
    });
  }
  return out;
}

const sameTarget = (a: Target, b: Target) => ('ship' in a && 'ship' in b && a.ship === b.ship) || ('port' in a && 'port' in b && a.port === b.port);

export function toAct(s: State): number[] {
  if (s.result) return [];
  if (s.phase === 'gold') return [s.seats.find((x) => s.side[x] === 'es')!];
  return [seatNow(s)];
}

function clone(s: State): State {
  return {
    ...s,
    seats: [...s.seats],
    side: { ...s.side },
    ships: s.ships.map((x) => ({ ...x })),
    ports: s.ports.map((p) => ({ ...p })),
    answer: [...s.answer],
  };
}

function finish(s: State, ev: Event[], winners: number[], text: string) {
  s.result = { winners, text };
  s.goldKnown = true;
  ev.push({ t: 'end', result: s.result });
}

const sideSeats = (s: State, side: Side) => s.seats.filter((x) => s.side[x] === side);

/** Проверка побед: золото в Кадиксе или на пиратской базе; очки колоний. */
function checkWin(s: State, ev: Event[]) {
  if (s.result) return;
  const m = mapOf(s);
  if (s.game === 'piraty') {
    const g = s.ships.find((x) => x.gold);
    if (!g || g.derelict) return;
    const p = portAt(m, g.x, g.y);
    if (p?.name === 'Кадикс' && g.side === 'es') finish(s, ev, sideSeats(s, 'es'), 'Галион с золотом «' + g.name + '» пришёл в Кадикс — победили испанцы!');
    else if (p?.kind === 'pi' && g.side === 'pi') finish(s, ev, sideSeats(s, 'pi'), 'Пираты увели золотой галион «' + g.name + '» на базу ' + p.name + ' — победили пираты!');
    return;
  }
  for (const seat of s.seats)
    if (points(s, seat) >= s.o.target) {
      finish(s, ev, [seat], `Набрано ${points(s, seat)} очков — колонии захвачены!`);
      return;
    }
}

/** Пробоины кораблю; «Пираты»: золотой галион не тонет, а переходит к пиратам. */
function damage(s: State, t: Ship, holes: number, bySeat: number): { sunk?: boolean; captured?: boolean; recaptured?: boolean } {
  if (holes <= 0) return {};
  if (t.gold && s.game === 'piraty') {
    const shooter = s.side[bySeat];
    if (t.side === 'pi' && shooter === 'es') {
      // испанцам хватает одного меткого попадания: отбили и заделали пробоину
      t.side = 'es';
      t.owner = bySeat;
      t.moved = true;
      t.shot = true;
      t.fix = 0;
      return { recaptured: true };
    }
    t.hits += holes;
    if (t.hits >= sinkAt(t)) {
      // пираты спешно заделывают одну пробоину и ведут галион как свой
      t.hits = sinkAt(t) - 1;
      t.side = 'pi';
      t.owner = bySeat;
      t.moved = true;
      t.shot = true;
      t.fix = 0;
      s.goldKnown = true;
      return { captured: true };
    }
    return {};
  }
  t.hits += holes;
  if (t.hits >= sinkAt(t)) {
    t.sunk = true;
    t.fix = 0;
    return { sunk: true };
  }
  return {};
}

/** Ничейный золотой галион забирает тот, кто подошёл вплотную. */
function salvage(s: State, sh: Ship, ev: Event[]) {
  for (const d of s.ships) {
    if (!d.derelict || cheb(d, sh) > 1) continue;
    d.derelict = false;
    d.owner = sh.owner;
    d.side = s.side[sh.owner];
    d.hits = sinkAt(d) - 1;
    d.moved = true;
    d.shot = true;
    ev.push({ t: 'salvage', ship: d.id, seat: sh.owner });
  }
}

function enterPort(s: State, sh: Ship, ev: Event[]) {
  const m = mapOf(s);
  const p = portAt(m, sh.x, sh.y);
  if (!p || s.game !== 'kolonii') return;
  const ps = s.ports[p.id];
  if (ps.owner === sh.owner) return;
  if (ps.down) {
    ev.push({ t: 'claim', port: p.id, seat: sh.owner, from: ps.owner });
    ps.owner = sh.owner;
    ps.down = false;
    ps.dmg = 0;
    ps.ammo = 0;
  }
}

/** Ураган: корабль сносит на клетку туда, куда дует ветер. */
function drift(s: State, sh: Ship, w: Spin, rng: Rng, ev: Event[]) {
  const m = mapOf(s);
  const to = POINTS[(POINTS.indexOf(w.from) + 4) % 8];
  const [dx, dy] = POINT_STEP[to];
  const from = { x: sh.x, y: sh.y };
  const nx = sh.x + dx;
  const ny = sh.y + dy;
  if (!inside(m, nx, ny)) return ev.push({ t: 'drift', ship: sh.id, from, stay: 'edge' });
  const port = portAt(m, nx, ny);
  const other = shipAt(s, nx, ny, sh.id);
  if (other && !port && !isHome(m, nx, ny)) return ev.push({ t: 'drift', ship: sh.id, from, stay: 'ship' });
  if (port && !canEnter(s, sh, port)) return ev.push({ t: 'drift', ship: sh.id, from, stay: 'port' });
  if (isWater(m, nx, ny)) {
    sh.x = nx;
    sh.y = ny;
    ev.push({ t: 'drift', ship: sh.id, from, to: { x: nx, y: ny } });
    enterPort(s, sh, ev);
    salvage(s, sh, ev);
    return;
  }
  // на берег
  if (s.game === 'kolonii') {
    sh.ashore = true;
    return ev.push({ t: 'drift', ship: sh.id, from, shore: true });
  }
  let wreck = true;
  let respin: Spin | undefined;
  if (s.o.shore === 'respin') {
    // поправка игроков: ещё раз крутим вертушку — если ветер снова гонит на берег, кораблекрушение
    respin = spin(rng);
    const t2 = POINTS[(POINTS.indexOf(respin.from) + 4) % 8];
    const [ex, ey] = POINT_STEP[t2];
    wreck = !isWater(m, sh.x + ex, sh.y + ey);
  }
  if (!wreck) return ev.push({ t: 'drift', ship: sh.id, from, shore: true, respin });
  if (sh.gold) {
    // золото не уходит на дно: галион ничейный, его заберёт тот, кто первым подойдёт вплотную
    sh.derelict = true;
    sh.hits = sinkAt(sh);
    s.goldKnown = true;
    return ev.push({ t: 'drift', ship: sh.id, from, shore: true, wreck: true, respin, derelict: true });
  }
  sh.sunk = true;
  ev.push({ t: 'drift', ship: sh.id, from, shore: true, wreck: true, respin });
}

/** Конец хода: нейтральные порты отвечают, ход переходит к следующему, у кого есть корабли. */
function endTurn(s: State, rng: Rng, ev: Event[]) {
  const m = mapOf(s);
  const seat = seatNow(s);
  for (const pid of s.answer) {
    const p = m.ports[pid];
    const ps = s.ports[pid];
    if (ps.down || ps.owner !== null) continue;
    // батареи порта бьют по каждому кораблю обидчика в пределах двух клеток
    for (const sh of shipsOf(s, seat)) {
      if (harbored(s, sh) || cheb(sh, p) > 2) continue;
      const sp = spin(rng);
      const r = damage(s, sh, sp.main ? 1 : 0, -1);
      ev.push({ t: 'portFire', port: pid, ship: sh.id, spin: sp, sunk: r.sunk });
    }
  }
  s.answer = [];
  s.wind = null;
  s.phase = 'spin';
  for (let k = 0; k < s.seats.length; k++) {
    s.turn++;
    if (s.turn >= s.seats.length) {
      s.turn = 0;
      s.round++;
      if (s.o.limit && s.round > s.o.limit) return timeUp(s, ev);
    }
    const next = seatNow(s);
    if (shipsOf(s, next).length || (s.game === 'kolonii' && s.o.revive && s.ships.some((x) => x.sunk && x.owner === next))) {
      ev.push({ t: 'turn', seat: next, round: s.round });
      return;
    }
  }
  timeUp(s, ev);
}

function timeUp(s: State, ev: Event[]) {
  if (s.game === 'kolonii') {
    const best = Math.max(...s.seats.map((x) => points(s, x)));
    const w = s.seats.filter((x) => points(s, x) === best);
    finish(s, ev, best > 0 ? w : [], best > 0 ? `Время вышло: больше всех очков — ${best}.` : 'Время вышло, колоний ни у кого нет.');
  } else finish(s, ev, [], 'Время вышло: золото так и не доплыло — ничья.');
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: S; events: Event[] } | null {
  if (s0.result || !toAct(s0).includes(seat)) return null;
  const s = clone(s0);
  const m = mapOf(s);
  const ev: Event[] = [];
  const mine = (id: number) => {
    const sh = s.ships[id];
    return sh && !sh.sunk && !sh.derelict && sh.owner === seat ? sh : null;
  };

  if (s.phase === 'gold') {
    if (a.type !== 'gold') return null;
    const g = s.ships[a.ship];
    if (!g || g.side !== 'es') return null;
    g.gold = true;
    s.phase = 'spin';
    ev.push({ t: 'gold', seat });
    ev.push({ t: 'turn', seat: seatNow(s), round: s.round });
    return { state: s, events: ev };
  }

  if (s.phase === 'spin') {
    if (a.type !== 'spin') return null;
    const w = spin(rng);
    s.wind = w;
    s.phase = 'act';
    ev.push({ t: 'spin', seat, spin: w });
    s.ports.forEach((p) => p.owner === seat && (p.fired = false));
    // погибшие возвращаются в квадратик старта (если так договорились)
    if (s.game === 'kolonii' && s.o.revive)
      for (const sh of s.ships)
        if (sh.sunk && sh.owner === seat) {
          const h = m.home[sh.id % m.home.length];
          Object.assign(sh, { sunk: false, hits: 0, ammo: AMMO, x: h % m.w, y: Math.floor(h / m.w), ashore: false, fix: 0 });
          ev.push({ t: 'revive', ship: sh.id });
        }
    for (const sh of shipsOf(s, seat)) {
      sh.moved = false;
      sh.shot = false;
      if (busy(sh)) {
        sh.fix! -= 1;
        if (sh.fix === 0) {
          sh.hits = 0;
          ev.push({ t: 'fixed', ship: sh.id });
        } else {
          sh.moved = true;
          sh.shot = true;
        }
      }
      if (sh.ashore) {
        if (w.weather === 'storm') {
          sh.sunk = true;
          sh.ashore = false;
          ev.push({ t: 'drift', ship: sh.id, from: { x: sh.x, y: sh.y }, shore: true, wreck: true });
        } else {
          sh.ashore = false;
          ev.push({ t: 'refloat', ship: sh.id });
        }
        sh.moved = true;
      } else if (w.weather === 'storm' && !harbored(s, sh)) drift(s, sh, w, rng, ev);
    }
    checkWin(s, ev);
    return { state: s, events: ev };
  }

  // phase === 'act'
  switch (a.type) {
    case 'move': {
      const sh = mine(a.ship);
      if (!sh) return null;
      const r = reach(s, sh).find((x) => x.course === a.course && x.steps === a.steps);
      if (!r) return null;
      sh.x = r.to.x;
      sh.y = r.to.y;
      sh.moved = true;
      const p = portAt(m, sh.x, sh.y);
      ev.push({ t: 'move', ship: sh.id, path: r.path, port: p?.id });
      enterPort(s, sh, ev);
      salvage(s, sh, ev);
      checkWin(s, ev);
      return { state: s, events: ev };
    }
    case 'shoot': {
      const ids = [...new Set(a.ships)];
      if (!ids.length) return null;
      const shooters = ids.map(mine);
      if (shooters.some((x) => !x || !targetsOf(s, x).some((t) => sameTarget(t, a.target)))) return null;
      const sp = spin(rng);
      const holes = sp.main ? ids.length : 0;
      for (const x of shooters) x!.shot = true;
      const e: Extract<Event, { t: 'shot' }> = { t: 'shot', seat, ships: ids, target: a.target, spin: sp, holes };
      if ('ship' in a.target) Object.assign(e, damage(s, s.ships[a.target.ship], holes, seat));
      else {
        const pid = a.target.port;
        const ps = s.ports[pid];
        if (holes) {
          ps.dmg += holes;
          if (ps.dmg >= portStrength(s, pid)) {
            ps.down = true;
            ps.owner = null;
            ps.ammo = 0;
            e.down = true;
          }
        } else if (ps.owner === null && !s.answer.includes(pid)) s.answer.push(pid);
      }
      ev.push(e);
      return { state: s, events: ev };
    }
    case 'portShot': {
      const p = m.ports[a.port];
      const ps = s.ports[a.port];
      const t = s.ships[a.ship];
      if (!p || s.game !== 'kolonii' || ps.owner !== seat || ps.down || ps.fired) return null;
      if (!t || t.sunk || t.owner === seat || harbored(s, t) || cheb(t, p) > 2) return null;
      ps.fired = true;
      const sp = spin(rng);
      const r = damage(s, t, sp.main ? 1 : 0, seat);
      ev.push({ t: 'portFire', port: a.port, ship: t.id, spin: sp, sunk: r.sunk });
      return { state: s, events: ev };
    }
    case 'repair': {
      const sh = mine(a.ship);
      if (!sh || busy(sh) || !canRepairAt(s, sh)) return null;
      // «Пираты»: по ходу за каждую пробоину; «Захват колоний»: пропуск одного хода
      const turns = s.game === 'piraty' ? sh.hits : 1;
      sh.fix = turns;
      sh.moved = true;
      sh.shot = true;
      ev.push({ t: 'repair', ship: sh.id, turns });
      return { state: s, events: ev };
    }
    case 'unload':
    case 'load': {
      const sh = mine(a.ship);
      const p = sh && portAt(m, sh.x, sh.y);
      if (!sh || !p || s.game !== 'kolonii' || s.ports[p.id].owner !== seat) return null;
      const ps = s.ports[p.id];
      const n = a.type === 'unload' ? sh.ammo : -Math.min(AMMO - sh.ammo, ps.ammo);
      if (!n) return null;
      sh.ammo -= n;
      ps.ammo += n;
      ev.push({ t: 'ammo', ship: sh.id, port: p.id, n });
      return { state: s, events: ev };
    }
    case 'end':
      endTurn(s, rng, ev);
      checkWin(s, ev);
      return { state: s, events: ev };
  }
  return null;
}

type S = State;

/** Что видит игрок: пиратам не видно, на каком галионе золото, пока его не потопили. */
export function view(s: State, seats: number[] | 'all'): State {
  if (s.game !== 'piraty' || s.goldKnown || seats === 'all' || seats.some((x) => s.side[x] === 'es')) return s;
  return { ...s, ships: s.ships.map((x) => (x.gold ? { ...x, gold: undefined } : x)) };
}

export const sideName = (s: State, seat: number) => SIDE_NAME[s.side[seat]];

export function shipLabel(sh: Ship) {
  return sh.cls === 'galleon' && sh.side !== 'col' ? `галион «${sh.name}»` : sh.cls === 'brig' ? `бригантина «${sh.name}»` : `«${sh.name}»`;
}
