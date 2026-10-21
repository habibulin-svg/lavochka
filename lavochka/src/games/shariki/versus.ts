/* «Шарики» по сети — логика без DOM. Комната ведёт поля всех: цепочки бесконечные, катятся всё быстрее (темп растёт со временем
 * и с выбыванием). Тройка из четырёх и больше или комбо — сопернику в цепочку встают серые шары (их убирает только тройка рядом)
 * и цепочка на миг ускоряется. Падлянка ждёт несколько секунд в очереди: свой удачный ход сначала гасит её, остаток уходит сопернику.
 * Шар в люке — выбыл. Цель, бейджи, дуэль и битва — как в «Яйцах динозавров». */
import type { Rng } from '../../core/types';
import { D, FH, FW, GRAY, levelSpec, Zuma, type LevelSpec } from './logic';

export const TICK_MS = 50;
const DT = TICK_MS / 1000;
const LAND = 4;
export const BADGE_MAX = 4;

export type VsMode = 'duel' | 'battle';

export interface VsIn {
  aim: number;
  shot: number;
  shotAim: number;
  swap: number;
  target: number;
}

interface Incoming {
  n: number;
  at: number;
  from: number;
}

export interface VsSeat {
  seat: number;
  z: Zuma;
  out: boolean;
  place: number;
  badges: number;
  ko: number;
  queue: Incoming[];
  pick: number;
  auto: number;
  autoAt: number;
  lastBy: number;
  lastAt: number;
  shotSeen: number;
  swapSeen: number;
  /** Сколько ещё секунд цепочка ускорена падлянкой. */
  boost: number;
}

export interface VsState {
  mode: VsMode;
  spec: LevelSpec;
  t: number;
  seats: VsSeat[];
  over: boolean;
  winners: number[];
  names: Record<number, string>;
}

export type VsEvent =
  | { k: 'shot'; seat: number }
  | { k: 'pop'; seat: number; pts: [number, number][]; color: number; combo: number; points: number }
  | { k: 'attack'; from: number; to: number; n: number }
  | { k: 'cancel'; seat: number; n: number }
  | { k: 'land'; seat: number; n: number }
  | { k: 'out'; seat: number; by: number; place: number }
  | { k: 'end'; winners: number[] };

/** Поле в снимке: цепочка кусками [начало, цвета строкой ('g' — серый)], выстрелы, заряды. */
export interface VsBoardView {
  seat: number;
  ch: [number, string][];
  /** Скорость заднего куска (точек в секунду) — экран доводит цепочку между снимками. */
  v: number;
  shots: [number, number, number, number, number][];
  cur: number;
  next: number;
  aim: number;
  score: number;
  danger: number;
  out: boolean;
  place: number;
  badges: number;
  ko: number;
  inc: number;
  incAt: number;
  target: number;
  shotSeen: number;
  swapSeen: number;
}

export interface VsView {
  mode: VsMode;
  spec: LevelSpec;
  t: number;
  over: boolean;
  winners: number[];
  boards: VsBoardView[];
}

/** Дорожка партии: одна на всех, форма — случайная. */
function vsSpec(colors: number, shape: number): LevelSpec {
  const base = levelSpec(30 + shape);
  return { ...base, colors, total: 1e9, speed: 15, turns: 1.9, shape };
}

export function newVersus(seats: number[], mode: VsMode, colors: number, rng: Rng): VsState {
  const spec = vsSpec(colors, rng.int(3));
  const seed = 1 + rng.int(2_000_000_000);
  return {
    mode,
    spec,
    t: 0,
    over: false,
    winners: [],
    names: {},
    seats: seats.map((seat) => ({
      seat,
      z: new Zuma(1, seed, spec),
      out: false,
      place: 0,
      badges: 0,
      ko: 0,
      queue: [],
      pick: -1,
      auto: -1,
      autoAt: 0,
      lastBy: -1,
      lastAt: -99,
      shotSeen: 0,
      swapSeen: 0,
      boost: 0,
    })),
  };
}

const alive = (s: VsState) => s.seats.filter((x) => !x.out);
const seatOf = (s: VsState, seat: number) => s.seats.find((x) => x.seat === seat);

export function tempo(s: VsState): number {
  const n = s.seats.length;
  const left = alive(s).length;
  return 1 + s.t / 100 + (s.mode === 'battle' && n > 2 ? 0.8 * (1 - left / n) : 0);
}

export function attackMult(s: VsState, me: VsSeat): number {
  return (1 + 0.25 * Math.min(BADGE_MAX, me.badges)) * (1 + (tempo(s) - 1) * 0.3);
}

/** Серых шаров за лопанье: сверх тройки и за каждое звено комбо. */
export function attackBalls(n: number, combo: number): number {
  return Math.max(0, n - 3) + 2 * Math.max(0, combo - 1);
}

export function targetOf(s: VsState, me: VsSeat, rng?: Rng): number {
  const ok = (seat: number) => seat !== me.seat && !!seatOf(s, seat) && !seatOf(s, seat)!.out;
  if (ok(me.pick)) return me.pick;
  if (ok(me.lastBy) && s.t - me.lastAt < 20) return me.lastBy;
  if (!ok(me.auto) || (rng && s.t >= me.autoAt)) {
    const list = alive(s).filter((x) => x.seat !== me.seat);
    if (!list.length) return -1;
    me.auto = list[rng ? rng.int(list.length) : 0].seat;
    me.autoAt = s.t + 10;
  }
  return me.auto;
}

export function cleanInput(raw: unknown): VsIn | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const aim = Math.max(-Math.PI, Math.min(Math.PI, num(r.aim, -Math.PI / 2)));
  return {
    aim,
    shot: Math.max(0, Math.floor(num(r.shot, 0))),
    shotAim: Math.max(-Math.PI, Math.min(Math.PI, num(r.shotAim, aim))),
    swap: Math.max(0, Math.floor(num(r.swap, 0))),
    target: Math.max(-1, Math.min(31, Math.floor(num(r.target, -1)))),
  };
}

export const idleInput = (): VsIn => ({ aim: -Math.PI / 2, shot: -1, shotAim: -Math.PI / 2, swap: -1, target: -1 });

export function step(s: VsState, inputs: (VsIn | null)[], rng: Rng): VsEvent[] {
  const ev: VsEvent[] = [];
  if (s.over) return ev;
  s.t += DT;
  const speed = 1 + (tempo(s) - 1) * 0.9;
  for (const me of s.seats) {
    if (me.out) continue;
    const z = Zuma.revive(me.z);
    const inp = inputs[me.seat];
    if (inp) {
      z.aim = inp.aim;
      me.pick = inp.target;
      if (inp.swap >= 0) {
        if (inp.swap > me.swapSeen) z.swap();
        me.swapSeen = inp.swap;
      }
      if (inp.shot >= 0 && inp.shot > me.shotSeen && z.shots.length < 2) {
        me.shotSeen = inp.shot;
        z.aim = inp.shotAim;
        z.shoot();
        ev.push({ k: 'shot', seat: me.seat });
      } else if (inp.shot >= 0 && inp.shot < me.shotSeen) me.shotSeen = inp.shot;
      z.aim = inp.aim;
    }
    me.boost = Math.max(0, me.boost - DT);
    z.speedMul = speed * (me.boost > 0 ? 2.2 : 1);
    z.update(TICK_MS);
    z.sounds.length = 0;
    let pts = 0;
    for (const p of z.pops) {
      pts += attackBalls(p.n, p.combo);
      ev.push({ k: 'pop', seat: me.seat, pts: p.pts.map(([x, y]) => [Math.round(x), Math.round(y)] as [number, number]), color: p.color, combo: p.combo, points: p.points });
    }
    z.pops.length = 0;
    if (pts) attack(s, me, pts, rng, ev);
  }
  // падлянки, чьё время пришло
  for (const me of s.seats) {
    if (me.out) continue;
    let n = 0;
    me.queue = me.queue.filter((q) => (q.at <= s.t ? ((n += q.n), false) : true));
    if (n) {
      me.z.addGray(n);
      me.boost = Math.min(3, me.boost + 0.4 * n);
      ev.push({ k: 'land', seat: me.seat, n });
    }
  }
  const lost = s.seats.filter((x) => !x.out && x.z.lost);
  const place = alive(s).length - lost.length + 1;
  for (const me of lost) eliminate(s, me, place, ev);
  const left = alive(s);
  if (left.length <= 1) {
    s.over = true;
    if (left.length === 1) {
      left[0].place = 1;
      s.winners = [left[0].seat];
    } else {
      const best = Math.min(...s.seats.map((x) => x.place));
      s.winners = s.seats.filter((x) => x.place === best).map((x) => x.seat);
    }
    ev.push({ k: 'end', winners: s.winners });
  }
  return ev;
}

function attack(s: VsState, me: VsSeat, pts: number, rng: Rng, ev: VsEvent[]) {
  let a = Math.round(pts * attackMult(s, me));
  let cancelled = 0;
  while (a > 0 && me.queue.length) {
    const q = me.queue[0];
    const k = Math.min(a, q.n);
    q.n -= k;
    a -= k;
    cancelled += k;
    if (!q.n) me.queue.shift();
  }
  if (cancelled) ev.push({ k: 'cancel', seat: me.seat, n: cancelled });
  if (a <= 0) return;
  const to = targetOf(s, me, rng);
  const foe = seatOf(s, to);
  if (!foe) return;
  foe.queue.push({ n: a, at: s.t + LAND, from: me.seat });
  foe.lastBy = me.seat;
  foe.lastAt = s.t;
  ev.push({ k: 'attack', from: me.seat, to, n: a });
}

function eliminate(s: VsState, me: VsSeat, place: number, ev: VsEvent[]) {
  if (me.out) return;
  me.out = true;
  me.place = place;
  me.queue = [];
  const by = me.lastBy >= 0 && s.t - me.lastAt < 15 ? me.lastBy : -1;
  const killer = by >= 0 ? seatOf(s, by) : undefined;
  if (killer && !killer.out) {
    killer.badges++;
    killer.ko++;
  }
  ev.push({ k: 'out', seat: me.seat, by: killer && !killer.out ? by : -1, place });
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** Цепочка кусками: подряд идущие вплотную шары — один кусок. */
export function chainOf(z: Zuma): [number, string][] {
  const out: [number, string][] = [];
  for (let i = 0; i < z.balls.length; i++) {
    const b = z.balls[i];
    const ch = b.color === GRAY ? 'g' : String(b.color);
    const last = out[out.length - 1];
    if (last && Math.abs(b.s - (z.balls[i - 1].s + D)) < 0.6) last[1] += ch;
    else out.push([r1(b.s), ch]);
  }
  return out;
}

const snapMemo = new WeakMap<VsState, { t: number; over: boolean; v: VsView }>();

export function snapshot(s: VsState): VsView {
  const m = snapMemo.get(s);
  if (m && m.t === s.t && m.over === s.over) return m.v;
  const sp = 1 + (tempo(s) - 1) * 0.9;
  const v: VsView = {
    mode: s.mode,
    spec: s.spec,
    t: Math.round(s.t * 100) / 100,
    over: s.over,
    winners: s.winners,
    boards: s.seats.map((me) => {
      const z = Zuma.revive(me.z);
      return {
        seat: me.seat,
        ch: chainOf(z),
        v: me.out ? 0 : r1(s.spec.speed * sp * (me.boost > 0 ? 2.2 : 1) * (z.danger() > 0.85 ? 0.6 : 1)),
        shots: z.shots.map((x) => [Math.round(x.x), Math.round(x.y), Math.round(x.vx), Math.round(x.vy), x.color] as [number, number, number, number, number]),
        cur: z.cur,
        next: z.next,
        aim: Math.round(z.aim * 1000) / 1000,
        score: z.score,
        danger: Math.round(z.danger() * 1000) / 1000,
        out: me.out,
        place: me.place,
        badges: me.badges,
        ko: me.ko,
        inc: me.queue.reduce((a, q) => a + q.n, 0),
        incAt: me.queue.length ? Math.round(Math.min(...me.queue.map((q) => q.at)) * 100) / 100 : 0,
        target: me.out ? -1 : targetOf(s, me),
        shotSeen: me.shotSeen,
        swapSeen: me.swapSeen,
      };
    }),
  };
  snapMemo.set(s, { t: s.t, over: s.over, v });
  return v;
}

/** Поле из снимка — для бота (шары по кускам цепочки). */
export function zumaOf(v: VsBoardView, spec: LevelSpec): Zuma {
  const balls: { color: number; s: number; id: number }[] = [];
  let id = 1;
  for (const [s0, cols] of v.ch) for (let i = 0; i < cols.length; i++) balls.push({ color: cols[i] === 'g' ? GRAY : Number(cols[i]), s: s0 + i * D, id: id++ });
  return Zuma.revive({ spec, balls, shots: [], spawned: 0, score: v.score, combo: 0, won: false, lost: false, cur: v.cur, next: v.next, aim: v.aim, rush: 0, nextId: id, seed: 7, sounds: [], pops: [], speedMul: 1 });
}

/** Бот: думает (слабый — дольше и неточнее), стреляет в шар своего цвета (лучше — где рядом такой же), иначе меняет шары. */
export function botInput(v: VsView, seat: number, level: number, mem: Record<string, any>, rng: Rng): VsIn {
  const me = v.boards.find((x) => x.seat === seat);
  mem.shot ??= 0;
  mem.swap ??= 0;
  mem.aim ??= -Math.PI / 2;
  const out = (): VsIn => ({ aim: mem.aim, shot: mem.shot, shotAim: mem.shotAim ?? mem.aim, swap: mem.swap, target: -1 });
  if (!me || me.out || v.over) return out();
  if (me.shotSeen < mem.shot || me.swapSeen < mem.swap) return out();
  mem.at ??= v.t + 1.5 + rng.next();
  if (v.t < mem.at) return out();
  const z = zumaOf(me, v.spec);
  const think = [1.5, 1.0, 0.7][level] ?? 1;
  // сильный ищет, где сразу лопнет: своим шаром, а нет — поменяв
  let a = level >= 1 ? z.bestAim(1) : null;
  if (a == null && level >= 2 && me.next !== me.cur) {
    z.swap();
    if (z.bestAim(1) != null) {
      mem.swap++;
      mem.at = v.t + 0.2;
      return out();
    }
    z.swap();
  }
  a ??= z.bestAim();
  if (a == null) {
    // своего цвета не достать — поменять шары (если следующий другой)
    if (me.next !== me.cur) {
      z.swap();
      if (z.bestAim() != null) mem.swap++;
    }
    mem.at = v.t + think * 0.5;
    return out();
  }
  const noise = [0.06, 0.025, 0.008][level] ?? 0.025;
  mem.aim = a + (rng.next() - 0.5) * 2 * noise;
  mem.shotAim = mem.aim;
  mem.shot++;
  mem.at = v.t + (think * (0.75 + rng.next() * 0.5)) / Math.min(1.6, 1 + v.t / 300);
  return out();
}

export { FW, FH };
