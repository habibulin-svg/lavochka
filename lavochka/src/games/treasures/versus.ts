/* «Клад» по сети — логика без DOM. У каждого своё поле 8×8, ходят все сразу, кто как успеет. Каскад или спецфишка (лопата,
 * динамит, самородок) — сопернику кирпичи: не двигаются и не складываются, через три его хода каменеют насовсем, если рядом не собрать
 * ряд. Падлянка ждёт несколько секунд в очереди: свой удачный ход сначала гасит её, остаток уходит сопернику. Раз в несколько секунд
 * кирпич достаётся всем (чем дольше партия, тем чаще). Выбывает тот, у кого не осталось ни одного хода, а в битве ещё и каждые 45 секунд —
 * последний по очкам. Цель, бейджи, дуэль и битва — как в «Яйцах динозавров». */
import type { Rng } from '../../core/types';
import { Board, levelSpec, N, type Cell, type LevelSpec, type Step } from './logic';

export const TICK_MS = 100;
const DT = TICK_MS / 1000;
const LAND = 5;
/** Через сколько своих ходов кирпич каменеет. */
export const BRICK_T = 3;
/** Битва: раз в столько секунд выбывает последний по очкам. */
export const CUT_EVERY = 45;
export const BADGE_MAX = 4;

export type VsMode = 'duel' | 'battle';
/** Ход: номер (растёт) и обмен клеток. */
export type VsMove = [number, number, number, number, number];

export interface VsIn {
  /** Последние ходы (комната берёт те, что новее уже сделанных). */
  mv: VsMove[];
  target: number;
}

interface Incoming {
  n: number;
  at: number;
  from: number;
}

export interface VsSeat {
  seat: number;
  b: Board;
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
  mvSeen: number;
  moves: number;
  /** Поле менялось — проверить, остались ли ходы. */
  dirty?: boolean;
}

export interface VsState {
  mode: VsMode;
  spec: LevelSpec;
  t: number;
  pushAt: number;
  cutAt: number;
  seats: VsSeat[];
  over: boolean;
  winners: number[];
  names: Record<number, string>;
}

export type VsEvent =
  | { k: 'combo'; seat: number; chain: number; made: number }
  | { k: 'attack'; from: number; to: number; n: number }
  | { k: 'cancel'; seat: number; n: number }
  | { k: 'land'; seat: number; cells: [number, number][] }
  | { k: 'stone'; seat: number; cells: [number, number][] }
  | { k: 'push' }
  | { k: 'out'; seat: number; by: number; place: number; why: 'stuck' | 'cut' }
  | { k: 'end'; winners: number[] };

/** Поле в снимке: по клетке два знака — фишка ('0'…'6', 'b' кирпич, '.' пусто) и отметка ('-', спецфишка r/c/x/n, у кирпича — счётчик, '#' камень). */
export interface VsBoardView {
  seat: number;
  g: string;
  score: number;
  moves: number;
  out: boolean;
  place: number;
  badges: number;
  ko: number;
  inc: number;
  incAt: number;
  target: number;
  mvSeen: number;
  /** Своё поле целиком (только себе): из него экран продолжает игру без ожидания комнаты. */
  full?: Board;
}

export interface VsView {
  mode: VsMode;
  t: number;
  pushAt: number;
  cutAt: number;
  over: boolean;
  winners: number[];
  boards: VsBoardView[];
}

const vsSpec = (kinds: number): LevelSpec => ({ ...levelSpec(1), kinds, moves: 1e9, goal: 'score', target: 1e12, dirt: 0, stones: 0 });

export function newVersus(seats: number[], mode: VsMode, kinds: number, rng: Rng): VsState {
  const spec = vsSpec(kinds);
  const seed = 1 + rng.int(2_000_000_000);
  const s: VsState = {
    mode,
    spec,
    t: 0,
    pushAt: 0,
    cutAt: CUT_EVERY,
    over: false,
    winners: [],
    names: {},
    seats: seats.map((seat) => ({
      seat,
      b: new Board(spec, seed),
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
      mvSeen: 0,
      moves: 0,
    })),
  };
  s.pushAt = pushEvery(s);
  return s;
}

const alive = (s: VsState) => s.seats.filter((x) => !x.out);
const seatOf = (s: VsState, seat: number) => s.seats.find((x) => x.seat === seat);

export function tempo(s: VsState): number {
  const n = s.seats.length;
  const left = alive(s).length;
  return 1 + s.t / 100 + (s.mode === 'battle' && n > 2 ? 0.8 * (1 - left / n) : 0);
}

export const pushEvery = (s: VsState) => Math.max(5, Math.min(24, 24 / tempo(s)));

export function attackMult(s: VsState, me: VsSeat): number {
  return (1 + 0.25 * Math.min(BADGE_MAX, me.badges)) * (1 + (tempo(s) - 1) * 0.3);
}

const WEIGHT: Record<string, number> = { row: 1, col: 1, bomb: 2, nugget: 3 };

/** Кирпичей за ход: каждое звено каскада сверх первого и каждая новая спецфишка. */
export function attackOf(steps: Step[]): { pts: number; chain: number; made: number } {
  let made = 0;
  for (const st of steps) for (const m of st.made) made += WEIGHT[m.special] ?? 0;
  const chain = steps.length;
  return { pts: Math.max(0, chain - 1) + made, chain, made };
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
  const int = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.floor(v) : NaN);
  const mv: VsMove[] = [];
  if (Array.isArray(r.mv))
    for (const m of r.mv.slice(-4)) {
      if (!Array.isArray(m) || m.length !== 5) continue;
      const v = m.map(int) as VsMove;
      if (v.some((x) => !Number.isFinite(x)) || v[0] < 0 || v.slice(1).some((x) => x < 0 || x >= N)) continue;
      mv.push(v);
    }
  const t = int(r.target);
  return { mv, target: Number.isFinite(t) ? Math.max(-1, Math.min(31, t)) : -1 };
}

export const idleInput = (): VsIn => ({ mv: [], target: -1 });

/** Выбыл ли игрок без ходов. */
const stuck = (b: Board) => !b.hasMove();

export function step(s: VsState, inputs: (VsIn | null)[], rng: Rng): VsEvent[] {
  const ev: VsEvent[] = [];
  if (s.over) return ev;
  s.t += DT;
  for (const me of s.seats) Board.revive(me.b);
  for (const me of s.seats) {
    if (me.out) continue;
    const inp = inputs[me.seat];
    if (!inp) continue;
    me.pick = inp.target;
    // вернулся с другой вкладки (номера ходов с нуля) — принимаем его отсчёт
    if (inp.mv.length && Math.max(...inp.mv.map((m) => m[0])) < me.mvSeen) me.mvSeen = 0;
    for (const [id, ax, ay, bx, by] of inp.mv) {
      if (id <= me.mvSeen) continue;
      me.mvSeen = id;
      const steps = me.b.swap(ax, ay, bx, by);
      if (!steps) continue;
      me.moves++;
      me.dirty = true;
      const a = attackOf(steps);
      if (a.chain > 1 || a.made) ev.push({ k: 'combo', seat: me.seat, chain: a.chain, made: a.made });
      if (a.pts) attack(s, me, a.pts, rng, ev);
      const st = me.b.ageBricks();
      if (st.length) ev.push({ k: 'stone', seat: me.seat, cells: st });
    }
  }
  // падлянки, чьё время пришло
  for (const me of s.seats) {
    if (me.out) continue;
    let n = 0;
    me.queue = me.queue.filter((q) => (q.at <= s.t ? ((n += q.n), false) : true));
    if (n) {
      ev.push({ k: 'land', seat: me.seat, cells: me.b.addBricks(Math.min(n, 16), BRICK_T) });
      me.dirty = true;
    }
  }
  // общий кирпич
  if (s.t >= s.pushAt) {
    for (const me of s.seats)
      if (!me.out) {
        me.b.addBricks(1, BRICK_T);
        me.dirty = true;
      }
    ev.push({ k: 'push' });
    s.pushAt = s.t + pushEvery(s);
  }
  const lost = s.seats.filter((x) => !x.out && x.dirty && stuck(x.b));
  for (const x of s.seats) x.dirty = false;
  const place = alive(s).length - lost.length + 1;
  for (const me of lost) eliminate(s, me, place, 'stuck', ev);
  // битва: отсев последнего по очкам
  if (s.mode === 'battle' && s.t >= s.cutAt) {
    s.cutAt = s.t + CUT_EVERY;
    const left = alive(s);
    if (left.length > 1) {
      const low = Math.min(...left.map((x) => x.b.score));
      const worst = left.filter((x) => x.b.score === low);
      eliminate(s, worst[rng.int(worst.length)], left.length, 'cut', ev);
    }
  }
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

function eliminate(s: VsState, me: VsSeat, place: number, why: 'stuck' | 'cut', ev: VsEvent[]) {
  if (me.out) return;
  me.out = true;
  me.place = place;
  me.queue = [];
  const by = why === 'stuck' && me.lastBy >= 0 && s.t - me.lastAt < 15 ? me.lastBy : -1;
  const killer = by >= 0 ? seatOf(s, by) : undefined;
  if (killer && !killer.out) {
    killer.badges++;
    killer.ko++;
  }
  ev.push({ k: 'out', seat: me.seat, by: killer && !killer.out ? by : -1, place, why });
}

const SP: Record<string, string> = { none: '-', row: 'r', col: 'c', bomb: 'x', nugget: 'n' };

/** Клетка двумя знаками (см. VsBoardView.g). */
function cellCode(c: Cell): string {
  if (c.stone) return '.#';
  const t = c.tile;
  if (!t) return '..';
  if (t.special === 'brick') return 'b' + Math.max(0, Math.min(9, t.t ?? 0));
  return String(t.kind) + (SP[t.special] ?? '-');
}

export const boardString = (b: Board) => b.cells.map((row) => row.map(cellCode).join('')).join('');

const snapMemo = new WeakMap<VsState, { t: number; over: boolean; v: VsView }>();

function common(s: VsState): VsView {
  const m = snapMemo.get(s);
  if (m && m.t === s.t && m.over === s.over) return m.v;
  const v: VsView = {
    mode: s.mode,
    t: Math.round(s.t * 100) / 100,
    pushAt: Math.round(s.pushAt * 100) / 100,
    cutAt: Math.round(s.cutAt * 100) / 100,
    over: s.over,
    winners: s.winners,
    boards: s.seats.map((me) => ({
      seat: me.seat,
      g: boardString(Board.revive(me.b)),
      score: me.b.score,
      moves: me.moves,
      out: me.out,
      place: me.place,
      badges: me.badges,
      ko: me.ko,
      inc: me.queue.reduce((a, q) => a + q.n, 0),
      incAt: me.queue.length ? Math.round(Math.min(...me.queue.map((q) => q.at)) * 100) / 100 : 0,
      target: me.out ? -1 : targetOf(s, me),
      mvSeen: me.mvSeen,
    })),
  };
  snapMemo.set(s, { t: s.t, over: s.over, v });
  return v;
}

/** Снимок для мест seats: у своего поля — ещё и полное поле (живое, не копия: по сети оно уходит строкой JSON,
 * а бот и экран сами копируют его, прежде чем что-то пробовать). */
export function snapshot(s: VsState, seats: number[] | 'all'): VsView {
  const v = common(s);
  // зритель (превью, показ) смотрит поле первого игрока целиком
  if (seats === 'all') return { ...v, boards: v.boards.map((b, i) => (i ? b : { ...b, full: s.seats[0].b })) };
  if (!seats.length) return v;
  return { ...v, boards: v.boards.map((b) => (seats.includes(b.seat) ? { ...b, full: seatOf(s, b.seat)!.b } : b)) };
}

/** Копия поля (для бота и экрана). */
export const cloneBoard = (b: Board): Board => Board.revive(JSON.parse(JSON.stringify(b)));

/** Бот: перебирает обмены на копии поля, считает очки и падлянку (сильный — с запасом на спецфишки), думает тем дольше, чем слабее. */
export function botInput(v: VsView, seat: number, level: number, mem: Record<string, any>, rng: Rng): VsIn {
  const me = v.boards.find((x) => x.seat === seat);
  mem.mv ??= 0;
  mem.list ??= [];
  const out = (): VsIn => ({ mv: mem.list, target: -1 });
  if (!me || me.out || v.over || !me.full) return out();
  if (me.mvSeen < mem.mv) {
    // комната начала с нуля (бот сел вместо человека) — догоняем её отсчёт
    if (me.mvSeen === 0 && mem.mv > 3) mem.mv = 0;
    else return out();
  }
  if (me.mvSeen > mem.mv) mem.mv = me.mvSeen;
  mem.at ??= v.t + 1 + rng.next();
  if (v.t < mem.at) return out();
  const b = Board.revive(me.full);
  let best: [number, number, number, number] | null = null;
  let bv = -Infinity;
  if (level === 0) best = b.hint();
  else
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++)
        for (const [dx, dy] of [
          [1, 0],
          [0, 1],
        ]) {
          if (x + dx >= N || y + dy >= N || !b.canSwap(x, y, x + dx, y + dy)) continue;
          const c = cloneBoard(b);
          const before = c.score;
          const steps = c.swap(x, y, x + dx, y + dy);
          if (!steps) continue;
          const a = attackOf(steps);
          const val = (c.score - before) / 10 + a.pts * (level >= 2 ? 12 : 4) + rng.next() * 2;
          if (val > bv) {
            bv = val;
            best = [x, y, x + dx, y + dy];
          }
        }
  if (!best) return out();
  mem.mv++;
  mem.list = [[mem.mv, ...best]];
  const think = [2.4, 1.6, 1.1][level] ?? 1.6;
  mem.at = v.t + (think * (0.75 + rng.next() * 0.5)) / Math.min(1.6, 1 + v.t / 300);
  return out();
}
