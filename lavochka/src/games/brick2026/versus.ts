/* Brick Game 2026 по сети — «каждый сам за себя» до шестнадцати (и дуэль). Без DOM.
 * Каждый играет у себя без задержек и шлёт установки фигур; комната повторяет их на своих копиях полей (проверяя, что фигура та,
 * влезает и лежит), считает атаки и выбывания. Атака: 2 ряда — 1 мусорный, 3 — 2, четыре — 4, серия закрытий подряд добавляет,
 * бейджи за выбитых усиливают. Свой снятый ряд сначала гасит мусор, что летит к тебе; остальное — цели. Мусор входит снизу
 * через пару секунд, при закрытии фигуры без снятых рядов. Скорость общая и растёт со временем и с выбыванием. */
import type { Rng } from '../../core/types';
import { bestPlace, reachable } from './ai';
import { applyPlace, gravityOf, H, HIDDEN, newTet, W, type Garbage, type Place, type Tet } from './tetris';

export const TICK_MS = 100;
const DT = TICK_MS / 1000;
/** Через сколько секунд мусор может войти. */
export const LAND = 2.5;
export const BADGE_MAX = 4;

export type BrMode = 'duel' | 'battle';

export interface BrIn {
  pl: Place[];
  target: number;
}

export interface BrSeat {
  seat: number;
  t: Tet;
  out: boolean;
  place: number;
  badges: number;
  ko: number;
  pick: number;
  auto: number;
  autoAt: number;
  lastBy: number;
  lastAt: number;
  sent: number;
  lines: number;
}

export interface BrState {
  mode: BrMode;
  t: number;
  seats: BrSeat[];
  over: boolean;
  winners: number[];
  names: Record<number, string>;
}

export type BrEvent =
  | { k: 'clear'; seat: number; n: number }
  | { k: 'attack'; from: number; to: number; n: number }
  | { k: 'cancel'; seat: number; n: number }
  | { k: 'land'; seat: number; n: number }
  | { k: 'out'; seat: number; by: number; place: number }
  | { k: 'end'; winners: number[] };

export interface BrBoardView {
  seat: number;
  /** Видимые 20 рядов: по знаку на клетку ('0' пусто, '1'…'7' фигуры, '8' мусор). */
  g: string;
  out: boolean;
  place: number;
  badges: number;
  ko: number;
  inc: number;
  target: number;
  lines: number;
  seq: number;
  /** Своё поле целиком — только себе. */
  full?: Tet;
}

export interface BrView {
  mode: BrMode;
  t: number;
  level: number;
  over: boolean;
  winners: number[];
  left: number;
  boards: BrBoardView[];
}

export function newBattle(seats: number[], mode: BrMode, rng: Rng): BrState {
  const seed = 1 + rng.int(2_000_000_000);
  return {
    mode,
    t: 0,
    over: false,
    winners: [],
    names: {},
    seats: seats.map((seat) => ({
      seat,
      t: newTet(seed, levelAt(0, seats.length, seats.length)),
      out: false,
      place: 0,
      badges: 0,
      ko: 0,
      pick: -1,
      auto: -1,
      autoAt: 0,
      lastBy: -1,
      lastAt: -99,
      sent: 0,
      lines: 0,
    })),
  };
}

const alive = (s: BrState) => s.seats.filter((x) => !x.out);
const seatOf = (s: BrState, seat: number) => s.seats.find((x) => x.seat === seat);

/** Общая скорость: уровень растёт раз в 20 секунд и с каждым выбывшим. */
export function levelAt(t: number, total: number, left: number): number {
  const gone = total > 2 ? Math.round(((total - left) / total) * 6) : 0;
  return Math.min(19, 3 + Math.floor(t / 20) + gone);
}
export const levelOf = (s: BrState) => levelAt(s.t, s.seats.length, alive(s).length);

/** Мусорных рядов за снятые: 2 → 1, 3 → 2, 4 → 4, плюс серия. */
export function attackOf(n: number, combo: number): number {
  const base = [0, 0, 1, 2, 4][n] ?? 4;
  const chain = [0, 0, 1, 1, 2, 2, 3, 3, 4][Math.min(8, combo)] ?? 4;
  return n ? base + chain : 0;
}

export function targetOf(s: BrState, me: BrSeat, rng?: Rng): number {
  const ok = (seat: number) => seat !== me.seat && !!seatOf(s, seat) && !seatOf(s, seat)!.out;
  if (ok(me.pick)) return me.pick;
  if (ok(me.lastBy) && s.t - me.lastAt < 15) return me.lastBy;
  if (!rng) return ok(me.auto) ? me.auto : -1;
  if (!ok(me.auto) || s.t >= me.autoAt) {
    const list = alive(s).filter((x) => x.seat !== me.seat);
    if (!list.length) return -1;
    me.auto = list[rng.int(list.length)].seat;
    me.autoAt = s.t + 8;
  }
  return me.auto;
}

export function cleanInput(raw: unknown): BrIn | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : NaN);
  const pl: Place[] = [];
  if (Array.isArray(r.pl))
    for (const m of r.pl.slice(-8)) {
      if (!Array.isArray(m) || m.length !== 5) continue;
      const v = m.map(int) as Place;
      if (v.some((x) => !Number.isFinite(x)) || v[0] < 1 || v[1] < 1 || v[1] > 7 || v[2] < 0 || v[2] > 3 || v[3] < -2 || v[3] > W + 1 || v[4] < 0 || v[4] >= H) continue;
      pl.push(v);
    }
  const t = int(r.target);
  return { pl, target: Number.isFinite(t) ? Math.max(-1, Math.min(31, t)) : -1 };
}

export const idleInput = (): BrIn => ({ pl: [], target: -1 });

/** Вершина поля занята (мусор поднял стакан за край) — выбыл. */
const toppedOut = (t: Tet) => t.over || t.grid.slice(0, HIDDEN * W).some(Boolean);

export function step(s: BrState, inputs: (BrIn | null)[], rng: Rng): BrEvent[] {
  const ev: BrEvent[] = [];
  if (s.over) return ev;
  s.t += DT;
  const lost: BrSeat[] = [];
  for (const me of s.seats) {
    if (me.out) continue;
    const inp = inputs[me.seat];
    if (!inp) continue;
    me.pick = inp.target;
    for (const pl of inp.pl) {
      if (pl[0] !== me.t.seq) continue;
      const before = me.t.garbage.reduce((a, g) => a + g.n, 0);
      const r = applyPlace(me.t, pl, s.t);
      if (!r) continue;
      const n = r.rows.length;
      if (n) {
        me.lines += n;
        ev.push({ k: 'clear', seat: me.seat, n });
        const a = Math.round(attackOf(n, me.t.combo) * (1 + 0.25 * Math.min(BADGE_MAX, me.badges)));
        if (a) attack(s, me, a, rng, ev);
      }
      if (r.garbage) ev.push({ k: 'land', seat: me.seat, n: r.garbage });
      void before;
      if (toppedOut(me.t)) {
        lost.push(me);
        break;
      }
    }
  }
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

function attack(s: BrState, me: BrSeat, n: number, rng: Rng, ev: BrEvent[]) {
  // сначала гасим своё входящее
  let a = n;
  let cancelled = 0;
  while (a > 0 && me.t.garbage.length) {
    const g = me.t.garbage[0];
    const k = Math.min(a, g.n);
    g.n -= k;
    a -= k;
    cancelled += k;
    if (!g.n) me.t.garbage.shift();
  }
  if (cancelled) ev.push({ k: 'cancel', seat: me.seat, n: cancelled });
  if (a <= 0) return;
  const to = targetOf(s, me, rng);
  const foe = seatOf(s, to);
  if (!foe) return;
  const g: Garbage = { n: a, hole: rng.int(W), at: s.t + LAND, from: me.seat };
  foe.t.garbage.push(g);
  foe.lastBy = me.seat;
  foe.lastAt = s.t;
  me.sent += a;
  ev.push({ k: 'attack', from: me.seat, to, n: a });
}

function eliminate(s: BrState, me: BrSeat, place: number, ev: BrEvent[]) {
  if (me.out) return;
  me.out = true;
  me.place = place;
  me.t.garbage = [];
  const by = me.lastBy >= 0 && s.t - me.lastAt < 15 ? me.lastBy : -1;
  const killer = by >= 0 ? seatOf(s, by) : undefined;
  if (killer && !killer.out) {
    // бейджи убитого переходят к тому, кто добил (как в известных «королевских битвах»), плюс один свой
    killer.badges += 1 + me.badges;
    killer.ko++;
  }
  ev.push({ k: 'out', seat: me.seat, by: killer && !killer.out ? by : -1, place });
}

export function gridString(t: Tet): string {
  let s = '';
  for (let i = HIDDEN * W; i < H * W; i++) s += String(t.grid[i]);
  return s;
}

const memo = new WeakMap<BrState, { t: number; over: boolean; v: BrView }>();

function common(s: BrState): BrView {
  const m = memo.get(s);
  if (m && m.t === s.t && m.over === s.over) return m.v;
  const v: BrView = {
    mode: s.mode,
    t: Math.round(s.t * 100) / 100,
    level: levelOf(s),
    over: s.over,
    winners: s.winners,
    left: alive(s).length,
    boards: s.seats.map((me) => ({
      seat: me.seat,
      g: gridString(me.t),
      out: me.out,
      place: me.place,
      badges: me.badges,
      ko: me.ko,
      inc: me.t.garbage.reduce((a, g) => a + g.n, 0),
      target: me.out ? -1 : targetOf(s, me),
      lines: me.lines,
      seq: me.t.seq,
    })),
  };
  memo.set(s, { t: s.t, over: s.over, v });
  return v;
}

export function snapshot(s: BrState, seats: number[] | 'all'): BrView {
  const v = common(s);
  if (seats === 'all') return { ...v, boards: v.boards.map((b, i) => (i ? b : { ...b, full: s.seats[0].t })) };
  if (!seats.length) return v;
  return { ...v, boards: v.boards.map((b) => (seats.includes(b.seat) ? { ...b, full: seatOf(s, b.seat)!.t } : b)) };
}

export const cloneTet = (t: Tet): Tet => JSON.parse(JSON.stringify(t)) as Tet;

/** Бот: думает над фигурой (тем дольше, чем слабее и медленнее общая скорость), ставит лучшую установку. */
export function botInput(v: BrView, seat: number, level: number, mem: Record<string, any>, rng: Rng): BrIn {
  const me = v.boards.find((x) => x.seat === seat);
  mem.list ??= [];
  const out = (): BrIn => ({ pl: mem.list, target: -1 });
  if (!me || me.out || v.over || !me.full) return out();
  const t = me.full;
  // эта фигура уже отправлена — ждём, пока комната её примет (не приняла за 2 с — думаем заново)
  if (mem.seq === t.seq && v.t < (mem.sentAt ?? 0) + 2) return out();
  mem.at ??= v.t + 0.5;
  if (v.t < mem.at) return out();
  const copy = cloneTet(t);
  // при такой скорости фигура падает за fall секунд; думает дольше — ставит наспех
  const think = ([1.5, 0.95, 0.6][level] ?? 1) * (0.7 + rng.next() * 0.6);
  const fall = (17 * gravityOf(v.level)) / 60;
  const panic = think > fall ? Math.min(1, (think - fall) / fall) : 0;
  const pl = bestPlace(copy, level, () => rng.next(), panic);
  if (!pl || !reachable(copy, pl)) {
    mem.at = v.t + 0.3;
    return out();
  }
  mem.seq = t.seq;
  mem.sentAt = v.t;
  mem.list = [...mem.list.slice(-5), pl];
  mem.at = v.t + Math.min(think, fall);
  return out();
}
