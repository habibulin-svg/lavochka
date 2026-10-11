/* «За рулём» (Томский приборный завод) — движок без DOM. На корпусе крутится диск с трассой: извилистая дорога, по краям —
 * трава с цветами, сверху — Y-образная эстакада на опорах (машинки проезжают под ней), знаки, заборчики, «зебры».
 * В игрушке машинка стоит на магните у края, а диск бежит под ней; руль двигает её только поперёк — к центру и к краю.
 * Здесь машинок 1–4 на одном диске: каждая едет по диску со своей скоростью (рычаг Н–1–2–3), у каждого игрока диск
 * поворачивается так, что его машинка стоит на месте, как в оригинале. Победа — первым проехать N кругов («гонка»)
 * или больше метров за время («на дальность»: три аварии — сход). Координаты диска — доли радиуса, угол a растёт по ходу машинок. */
import type { Rng } from '../../core/types';

export const TAU = Math.PI * 2;
export const TICK_MS = 1000 / 60;
const DT = TICK_MS / 1000;

export type TrackId = 'wide' | 'narrow';
export type Goal = 'race' | 'distance';
export type Why = 'pillar' | 'sign' | 'fence';

/** Препятствие-кружок на диске (опора эстакады, знак, кусок заборчика). */
export interface Obstacle {
  a: number;
  r: number;
  size: number;
  kind: Why;
}

export interface Sign {
  a: number;
  r: number;
  kind: 'warn' | 'fifty' | 'stop' | 'main' | 'walk';
}

export interface Fence {
  a: number;
  r: number;
  /** Полудлина по углу. */
  span: number;
}

export interface Track {
  id: TrackId;
  /** Полуширина дороги. */
  w: number;
  /** Радиус середины дороги. */
  rc(a: number): number;
  /** Углы рукавов эстакады. */
  arms: number[];
  pillars: Obstacle[];
  signs: Sign[];
  fences: Fence[];
  /** «Зебры» — только рисунок на дороге. */
  zebras: number[];
  /** Линия старта. */
  start: number;
  /** Все неподвижные препятствия (для столкновений). */
  solid: Obstacle[];
}

/** Скорость диска под машинкой по передаче, рад/с (Н, 1, 2, 3). */
export const GEARS = [0, 0.3, 0.5, 0.75];
/** Руль: сколько радиуса в секунду машинка проезжает поперёк. */
export const STEER = 0.5;
export const R_MIN = 0.2;
export const R_MAX = 0.94;
/** Машинка: длина и ширина (доли радиуса); для препятствий — два кружка вдоль корпуса. */
export const CAR_L = 0.19;
export const CAR_W = 0.09;
const CAR_C = 0.05;
const CAR_CR = 0.042;
/** По траве — медленнее (в игрушке съехать не страшно, но в гонке невыгодно); аварии — только от ударов. */
const GRASS_K = 0.4;
const ACC = 0.55;
const DEC = 1.6;
/** Авария: столько секунд машинка стоит и мигает, потом её ставят на дорогу чуть дальше. */
export const STUN = 1.6;
/** Метров в радиусе диска (одометр). */
export const METERS = 120;
export const COUNTDOWN = 3;
/** Гонка: после первого финиша остальным даётся столько секунд. */
const AFTER_FIN = 25;
/** Гонка без конца не идёт: через 15 минут — по пройденному. */
const RACE_CAP = 900;
/** На дальность: аварий до схода. */
export const MAX_CRASHES = 3;

export const norm = (x: number) => ((x % TAU) + TAU) % TAU;
/** Разница углов в (−π, π]. */
export const dAng = (x: number) => {
  const d = norm(x);
  return d > Math.PI ? d - TAU : d;
};
const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));

const cache = new Map<TrackId, Track>();

export function track(id: TrackId): Track {
  let t = cache.get(id);
  if (!t) cache.set(id, (t = makeTrack(id)));
  return t;
}

function makeTrack(id: TrackId): Track {
  const narrow = id === 'narrow';
  const w = narrow ? 0.112 : 0.15;
  const rc = narrow
    ? (a: number) => 0.58 + 0.18 * Math.sin(3 * a + 0.4) + 0.05 * Math.sin(5 * a + 2)
    : (a: number) => 0.58 + 0.17 * Math.sin(3 * a + 0.4) + 0.03 * Math.sin(7 * a + 1.3);
  /** Расстояние от точки (a, r) до середины дороги (по диску, не только поперёк). */
  const gap = (a: number, r: number) => {
    let best = Infinity;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    for (let d = -0.8; d <= 0.8; d += 0.01) {
      const q = rc(a + d);
      best = Math.min(best, Math.hypot(Math.cos(a + d) * q - x, Math.sin(a + d) * q - z));
    }
    return best;
  };
  /** Ближайший к дороге радиус по эту сторону (side ±1), где до середины дороги не меньше need; null — не помещается. */
  const clearR = (a: number, side: number, need: number) => {
    for (let r = rc(a) + side * need; r > 0.2 && r < 0.95; r += side * 0.005) if (gap(a, r) >= need) return r;
    return null;
  };
  // рукава эстакады — там, где дорога идёт поперёк (между изгибами); опоры — на траве по обе стороны дороги
  const arms = [0, 1, 2].map((k) => norm((Math.PI - 0.4) / 3 + (k * TAU) / 3));
  const pillars: Obstacle[] = [];
  for (const b of arms)
    for (const side of [-1, 1]) {
      const r = clearR(b, side, w + 0.1);
      if (r != null) pillars.push({ a: b, r, size: 0.04, kind: 'pillar' });
    }
  // заборчики — с внешней стороны изгибов (у края диска)
  const fences: Fence[] = [];
  for (let k = 0; k < 3; k++) {
    const top = norm((Math.PI / 2 - 0.4) / 3 + (k * TAU) / 3);
    const r = clearR(top, 1, w + 0.075);
    if (r != null && r < 0.93) fences.push({ a: top, r, span: 0.2 });
  }
  const signs: Sign[] = [];
  const kinds: Sign['kind'][] = ['warn', 'fifty', 'stop', 'main', 'walk', 'warn'];
  for (let k = 0; k < 6; k++) {
    const a = norm(0.2 + (k * TAU) / 6 + 0.33);
    const r = clearR(a, k % 2 === 0 ? 1 : -1, w + 0.08) ?? clearR(a, k % 2 === 0 ? -1 : 1, w + 0.08);
    if (r != null) signs.push({ a, r, kind: kinds[k] });
  }
  const zebras = [0, 1, 2].map((k) => norm(arms[k] + 1.15));
  const start = norm(arms[0] + 0.55);
  const solid: Obstacle[] = [...pillars];
  for (const s of signs) solid.push({ a: s.a, r: s.r, size: 0.02, kind: 'sign' });
  for (const f of fences)
    for (let x = -f.span; x <= f.span + 1e-9; x += f.span / 5) solid.push({ a: f.a + x, r: f.r, size: 0.016, kind: 'fence' });
  return { id, w, rc, arms, pillars, signs, fences, zebras, start, solid };
}

export function onRoad(t: Track, a: number, r: number): boolean {
  return Math.abs(r - t.rc(a)) <= t.w;
}

export interface Car {
  seat: number;
  a: number;
  r: number;
  /** Скорость по диску, рад/с. */
  w: number;
  g: number;
  /** Руль: −1…1, плюс — вправо, к центру диска. */
  steer: number;
  stun: number;
  grass: number;
  crashes: number;
  meters: number;
  laps: number;
  /** Время финиша, −1 — ещё едет. */
  fin: number;
  out: boolean;
  bump: number;
}

export interface ZrState {
  goal: Goal;
  track: TrackId;
  laps: number;
  /** На дальность: секунд на партию (0 — до трёх аварий). */
  limit: number;
  /** Время партии, с; до старта отрицательное (отсчёт 3-2-1). */
  t: number;
  cars: Car[];
  firstFin: number;
  over: boolean;
}

export interface ZrIn {
  /** Руль −1…1. */
  s: number;
  /** Передача 0…3; −1 — не трогаю. */
  g: number;
}

export type ZrEvent =
  | { k: 'count'; n: number }
  | { k: 'go' }
  | { k: 'grass'; seat: number }
  | { k: 'crash'; seat: number; why: Why }
  | { k: 'bump'; seat: number; other: number }
  | { k: 'lap'; seat: number; lap: number }
  | { k: 'finish'; seat: number; place: number; time: number }
  | { k: 'out'; seat: number }
  | { k: 'end' };

/** Расстановка на старте: два ряда по две машинки поперёк дороги. */
export function gridSpot(t: Track, i: number): [number, number] {
  const a = t.start - 0.04 - Math.floor(i / 2) * 0.3;
  const side = i % 2 === 0 ? -0.5 : 0.5;
  return [a, t.rc(a) + side * t.w * 0.9];
}

export function newGame(seats: number[], goal: Goal, trackId: TrackId, laps: number, minutes: number): ZrState {
  const t = track(trackId);
  return {
    goal,
    track: trackId,
    laps,
    limit: goal === 'distance' ? Math.max(0, minutes) * 60 : 0,
    t: -COUNTDOWN,
    cars: seats.map((seat, i) => {
      const [a, r] = gridSpot(t, i);
      return { seat, a, r, w: 0, g: 1, steer: 0, stun: 0, grass: 0, crashes: 0, meters: 0, laps: 0, fin: -1, out: false, bump: 0 };
    }),
    firstFin: -1,
    over: false,
  };
}

export const idleInput = (): ZrIn => ({ s: 0, g: -1 });

export function cleanInput(raw: unknown): ZrIn | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const s = typeof o.s === 'number' && Number.isFinite(o.s) ? clamp(o.s, -1, 1) : 0;
  const g = typeof o.g === 'number' && Number.isInteger(o.g) && o.g >= -1 && o.g <= 3 ? o.g : -1;
  return { s, g };
}

/** Пройдено по кругу от линии старта, рад. */
export const progress = (st: ZrState, c: Car) => c.a - track(st.track).start;

/** Машинка в игре: не сошла, не финишировала. */
export const racing = (c: Car) => !c.out && c.fin < 0;
/** Призрак: стоит после аварии, сошла или финишировала — с другими не сталкивается. */
const ghost = (c: Car) => c.stun > 0 || !racing(c);

/** Центры двух кружков корпуса (декартовы, доли радиуса). */
function carCircles(c: { a: number; r: number }): [number, number][] {
  const x = Math.cos(c.a) * c.r;
  const z = Math.sin(c.a) * c.r;
  const tx = -Math.sin(c.a);
  const tz = Math.cos(c.a);
  return [
    [x + tx * CAR_C, z + tz * CAR_C],
    [x - tx * CAR_C, z - tz * CAR_C],
  ];
}

/** Обо что машинка в (a, r) ударилась, или null. */
export function hitAt(t: Track, a: number, r: number, extra = 0): Obstacle | null {
  const circ = carCircles({ a, r });
  const test = (o: Obstacle) => {
    if (Math.abs(dAng(o.a - a)) > 0.5) return false;
    const ox = Math.cos(o.a) * o.r;
    const oz = Math.sin(o.a) * o.r;
    const lim = (o.size + CAR_CR + extra) ** 2;
    return circ.some(([x, z]) => (x - ox) ** 2 + (z - oz) ** 2 < lim);
  };
  for (const o of t.solid) if (test(o)) return o;
  return null;
}

/** Таблица мест: гонка — кто раньше финишировал, потом кто дальше уехал; на дальность — по метрам. */
export function standings(st: ZrState): Car[] {
  const cs = [...st.cars];
  if (st.goal === 'distance') return cs.sort((x, y) => y.meters - x.meters || x.crashes - y.crashes);
  return cs.sort((x, y) => {
    if (x.fin >= 0 || y.fin >= 0) return (x.fin < 0 ? 1e9 : x.fin) - (y.fin < 0 ? 1e9 : y.fin);
    if (x.out !== y.out) return x.out ? 1 : -1;
    return progress(st, y) - progress(st, x);
  });
}

export function step(st: ZrState, inputs: (ZrIn | null | undefined)[], _rng?: Rng): ZrEvent[] {
  const ev: ZrEvent[] = [];
  if (st.over) return ev;
  const tr = track(st.track);
  const prev = st.t;
  st.t += DT;
  if (prev <= -COUNTDOWN + 1e-9) ev.push({ k: 'count', n: COUNTDOWN });
  if (st.t < 0 && Math.floor(prev) !== Math.floor(st.t)) ev.push({ k: 'count', n: -Math.floor(st.t) });
  if (prev < 0 && st.t >= 0) ev.push({ k: 'go' });

  for (const c of st.cars) {
    const inp = inputs[c.seat];
    if (inp && inp.g >= 0 && inp.g <= 3) c.g = inp.g;
    c.steer = inp ? clamp(inp.s, -1, 1) : 0;
    if (st.t < 0 || c.out) continue;
    if (c.bump > 0) c.bump -= DT;
    if (c.fin >= 0) {
      // доехал — катится по инерции и встаёт
      c.w = Math.max(0, c.w - DEC * 0.4 * DT);
      c.a += c.w * DT;
      continue;
    }
    if (c.stun > 0) {
      c.w = 0;
      c.stun -= DT;
      if (c.stun <= 0) respawn(tr, c);
      continue;
    }
    c.r = clamp(c.r - c.steer * STEER * DT, R_MIN, R_MAX);
    const road = onRoad(tr, c.a, c.r);
    const target = GEARS[c.g] * (road ? 1 : GRASS_K);
    c.w += clamp(target - c.w, -DEC * DT, ACC * DT);
    c.a += c.w * DT;
    if (road) {
      c.meters += c.w * DT * c.r * METERS;
      c.grass = 0;
    } else if (c.w > 0.02) {
      if (c.grass === 0) ev.push({ k: 'grass', seat: c.seat });
      c.grass += DT;
    }
    const hit = hitAt(tr, c.a, c.r);
    if (hit) {
      crash(st, c, hit.kind, ev);
      continue;
    }
    const lap = Math.floor(progress(st, c) / TAU);
    if (lap > c.laps) {
      c.laps = lap;
      ev.push({ k: 'lap', seat: c.seat, lap });
      if (st.goal === 'race' && lap >= st.laps) {
        c.fin = st.t;
        if (st.firstFin < 0) st.firstFin = st.t;
        ev.push({ k: 'finish', seat: c.seat, place: st.cars.filter((x) => x.fin >= 0).length, time: st.t });
      }
    }
  }
  if (st.t >= 0) collide(st, ev);
  if (finished(st)) {
    st.over = true;
    ev.push({ k: 'end' });
  }
  return ev;
}

function finished(st: ZrState): boolean {
  if (st.t < 0) return false;
  if (st.cars.every((c) => !racing(c))) return true;
  if (st.goal === 'race') return (st.firstFin >= 0 && st.t - st.firstFin > AFTER_FIN) || st.t > RACE_CAP;
  return st.limit > 0 && st.t >= st.limit;
}

function crash(st: ZrState, c: Car, why: Why, ev: ZrEvent[]) {
  c.crashes++;
  c.stun = STUN;
  c.w = 0;
  c.grass = 0;
  ev.push({ k: 'crash', seat: c.seat, why });
  if (st.goal === 'distance' && c.crashes >= MAX_CRASHES) {
    c.out = true;
    ev.push({ k: 'out', seat: c.seat });
  }
}

/** После аварии машинку ставят на середину дороги чуть дальше — туда, где ничего не стоит. */
function respawn(tr: Track, c: Car) {
  c.stun = 0;
  c.a += 0.05;
  c.r = tr.rc(c.a);
  for (let i = 0; i < 40 && hitAt(tr, c.a, c.r, 0.03); i++) {
    c.a += 0.03;
    c.r = tr.rc(c.a);
  }
}

/** Машинки толкаются: бок о бок — расходятся поперёк, догнал сзади — упёрся и сбросил скорость. */
function collide(st: ZrState, ev: ZrEvent[]) {
  const cs = st.cars;
  for (let i = 0; i < cs.length; i++)
    for (let j = i + 1; j < cs.length; j++) {
      const p = cs[i];
      const q = cs[j];
      if (ghost(p) || ghost(q)) continue;
      const da = dAng(q.a - p.a);
      const ds = da * (p.r + q.r) * 0.5;
      const dr = q.r - p.r;
      const pt = CAR_L - Math.abs(ds);
      const pr = CAR_W - Math.abs(dr);
      if (pt <= 0 || pr <= 0) continue;
      if (pr < pt * 0.6) {
        const sgn = dr >= 0 ? 1 : -1;
        p.r = clamp(p.r - (sgn * pr) / 2, R_MIN, R_MAX);
        q.r = clamp(q.r + (sgn * pr) / 2, R_MIN, R_MAX);
      } else {
        const [back, front] = da >= 0 ? [p, q] : [q, p];
        back.a -= pt / Math.max(0.2, back.r);
        back.w = Math.min(back.w, front.w * 0.85);
        if (back.bump <= 0) {
          back.bump = 0.4;
          ev.push({ k: 'bump', seat: back.seat, other: front.seat });
        }
      }
    }
}

/** Снимок для рассылки: числа покороче. */
export function snapshot(st: ZrState): ZrState {
  const k = (x: number) => Math.round(x * 1e4) / 1e4;
  return {
    ...st,
    t: k(st.t),
    cars: st.cars.map((c) => ({ ...c, a: k(c.a), r: k(c.r), w: k(c.w), stun: k(c.stun), grass: k(c.grass), meters: Math.round(c.meters * 10) / 10, bump: 0 })),
  };
}
