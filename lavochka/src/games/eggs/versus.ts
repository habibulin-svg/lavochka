/* «Яйца динозавров» по сети — логика без DOM. Комната ведёт поля всех игроков: выстрел решается сразу (клиент рисует полёт сам),
 * лопнуло четыре и больше или случился обвал — сопернику сверху наезжают ряды яиц («падлянка»). Свой удачный выстрел сначала гасит
 * входящую очередь (как в Puyo), остаток уходит сопернику. Общий потолок: раз в несколько секунд всем сверху наезжает ряд, и чем дольше
 * партия и чем меньше осталось игроков, тем чаще и тем сильнее атаки. Яйцо за чертой — выбыл. Дуэль — вдвоём, «битва» — до десяти
 * (как Tetris 99): цель — кто атаковал тебя, иначе случайный или выбранный; за выбитого — бейдж, атаки сильнее. */
import type { Rng } from '../../core/types';
import { Bubbles, COLS, ROWS, type LevelSpec } from './logic';

export const TICK_MS = 50;
const DT = TICK_MS / 1000;
/** Пауза между выстрелами одного игрока, с. */
const COOL = 0.22;
/** Через сколько секунд падлянка наезжает на поле (пока можно погасить). */
const LAND = 4;
/** Сколько стартовых рядов. */
const START_ROWS = 4;
/** Бейджи: +25 % к атаке за каждого выбитого, не больше +100 %. */
export const BADGE_MAX = 4;

export type VsMode = 'duel' | 'battle';

export interface VsIn {
  /** Куда смотрит динозаврик (рад) — для показа зрителям. */
  aim: number;
  /** Счётчик выстрелов: вырос — выстрел под углом shotAim. */
  shot: number;
  shotAim: number;
  /** Счётчик обменов яиц. */
  swap: number;
  /** Цель атак: место или −1 — сама (кто атаковал, иначе случайный). */
  target: number;
}

interface Incoming {
  n: number;
  at: number;
  from: number;
}

export interface VsSeat {
  seat: number;
  b: Bubbles;
  out: boolean;
  /** Место в итоге (1 — победитель), 0 — ещё играет. */
  place: number;
  badges: number;
  ko: number;
  queue: Incoming[];
  /** Выбранная цель (−1 — сама) и та, что выбрана автоматом. */
  pick: number;
  auto: number;
  autoAt: number;
  /** Кто атаковал последним и когда. */
  lastBy: number;
  lastAt: number;
  aim: number;
  shotSeen: number;
  swapSeen: number;
  cool: number;
  sent: number;
}

export interface VsState {
  mode: VsMode;
  colors: number;
  t: number;
  pushAt: number;
  seats: VsSeat[];
  over: boolean;
  winners: number[];
  /** Имена игроков по местам — для строки итога. */
  names: Record<number, string>;
}

export type VsEvent =
  | { k: 'shot'; seat: number; id: number; color: number; path: [number, number][]; cell: [number, number] | null; popped: [number, number, number][]; fell: [number, number, number][] }
  | { k: 'attack'; from: number; to: number; n: number }
  | { k: 'cancel'; seat: number; n: number }
  | { k: 'land'; seat: number; n: number }
  | { k: 'push' }
  | { k: 'clear'; seat: number }
  | { k: 'out'; seat: number; by: number; place: number }
  | { k: 'end'; winners: number[] };

/** Поле одного игрока в снимке: сетка строкой ('.' — пусто, цифра — цвет), заряды, очередь падлянок. */
export interface VsBoardView {
  seat: number;
  g: string;
  shift: number;
  cur: number;
  next: number;
  score: number;
  out: boolean;
  place: number;
  badges: number;
  ko: number;
  /** Сколько рядов ждёт и когда первые наедут (секунды партии). */
  inc: number;
  incAt: number;
  target: number;
  aim: number;
  shotSeen: number;
  swapSeen: number;
}

export interface VsView {
  mode: VsMode;
  colors: number;
  t: number;
  pushAt: number;
  pushEvery: number;
  over: boolean;
  winners: number[];
  boards: VsBoardView[];
}

const spec = (colors: number): LevelSpec => ({ n: 1, colors, rows: START_ROWS, pattern: 0, dropEvery: 1e9 });

export function newVersus(seats: number[], mode: VsMode, colors: number, rng: Rng): VsState {
  const seed = 1 + rng.int(2_000_000_000);
  const s: VsState = {
    mode,
    colors,
    t: 0,
    pushAt: 0,
    over: false,
    winners: [],
    names: {},
    seats: seats.map((seat) => ({
      seat,
      // у всех одна и та же кладка и одни заряды — честный старт
      b: new Bubbles(1, seed, spec(colors)),
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
      aim: -Math.PI / 2,
      shotSeen: 0,
      swapSeen: 0,
      cool: 0,
      sent: 0,
    })),
  };
  s.pushAt = pushEvery(s);
  return s;
}

const alive = (s: VsState) => s.seats.filter((x) => !x.out);

/** Темп: растёт со временем и когда игроков осталось мало. */
export function tempo(s: VsState): number {
  const n = s.seats.length;
  const left = alive(s).length;
  return 1 + s.t / 120 + (s.mode === 'battle' && n > 2 ? 0.8 * (1 - left / n) : 0);
}

/** Через сколько секунд всем наезжает ряд. */
export function pushEvery(s: VsState): number {
  return Math.max(4, Math.min(20, 20 / tempo(s)));
}

/** Множитель атаки: бейджи и темп. */
export function attackMult(s: VsState, me: VsSeat): number {
  return (1 + 0.25 * Math.min(BADGE_MAX, me.badges)) * (1 + (tempo(s) - 1) * 0.3);
}

/** Сколько рядов стоит выстрел: лопнуло больше трёх и упавшие. */
export function attackRows(popped: number, fell: number, cleared: boolean): number {
  const pts = Math.max(0, popped - 3) + fell + (cleared ? 6 : 0);
  return pts > 0 ? Math.min(3, 1 + Math.floor((pts - 1) / 4)) : 0;
}

const seatOf = (s: VsState, seat: number) => s.seats.find((x) => x.seat === seat);

/** Кого бьём: выбранного, иначе того, кто бил нас недавно, иначе случайного (меняется раз в 10 с). */
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

/** Выбыл; place — место (выбывшие в один шаг делят место). */
function eliminate(s: VsState, me: VsSeat, place: number, ev: VsEvent[]) {
  if (me.out) return;
  me.out = true;
  me.place = place;
  me.queue = [];
  // выбил тот, кто бил последним (не раньше 15 с назад)
  const by = me.lastBy >= 0 && s.t - me.lastAt < 15 ? me.lastBy : -1;
  const killer = by >= 0 ? seatOf(s, by) : undefined;
  if (killer && !killer.out) {
    killer.badges++;
    killer.ko++;
  }
  ev.push({ k: 'out', seat: me.seat, by: killer && !killer.out ? by : -1, place: me.place });
}

export function cleanInput(raw: unknown): VsIn | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const aim = Math.max(-Math.PI, Math.min(0, num(r.aim, -Math.PI / 2)));
  const shotAim = Math.max(-Math.PI, Math.min(0, num(r.shotAim, aim)));
  return {
    aim,
    shot: Math.max(0, Math.floor(num(r.shot, 0))),
    shotAim,
    swap: Math.max(0, Math.floor(num(r.swap, 0))),
    target: Math.max(-1, Math.min(31, Math.floor(num(r.target, -1)))),
  };
}

export const idleInput = (): VsIn => ({ aim: -Math.PI / 2, shot: -1, shotAim: -Math.PI / 2, swap: -1, target: -1 });

/** Шаг: выстрелы и обмены по вводу, атаки, наезды рядов, выбывание. Меняет состояние на месте. */
export function step(s: VsState, inputs: (VsIn | null)[], rng: Rng): VsEvent[] {
  const ev: VsEvent[] = [];
  if (s.over) return ev;
  s.t += DT;
  for (const me of s.seats) Bubbles.revive(me.b);
  for (const me of s.seats) {
    if (me.out) continue;
    const inp = inputs[me.seat];
    me.cool = Math.max(0, me.cool - DT);
    if (!inp) continue;
    me.aim = inp.aim;
    if (inp.target !== me.pick) me.pick = inp.target;
    // счётчики с нуля — игрок вернулся с другой вкладки: принимаем его отсчёт
    if (inp.swap >= 0) {
      if (inp.swap > me.swapSeen) [me.b.cur, me.b.next] = [me.b.next, me.b.cur];
      me.swapSeen = inp.swap;
    }
    if (inp.shot >= 0 && inp.shot > me.shotSeen && me.cool <= 0) {
      me.shotSeen = inp.shot;
      shoot(s, me, inp.shotAim, rng, ev);
    } else if (inp.shot >= 0 && inp.shot < me.shotSeen) me.shotSeen = inp.shot;
  }
  // падлянки, чьё время пришло
  for (const me of s.seats) {
    if (me.out) continue;
    let n = 0;
    me.queue = me.queue.filter((q) => (q.at <= s.t ? ((n += q.n), false) : true));
    if (n) {
      for (let i = 0; i < n && !me.b.lost; i++) me.b.pushRow(s.colors, 3 + rng.int(2));
      ev.push({ k: 'land', seat: me.seat, n });
    }
  }
  // общий потолок
  if (s.t >= s.pushAt) {
    for (const me of s.seats) if (!me.out) me.b.pushRow(s.colors, 0);
    ev.push({ k: 'push' });
    s.pushAt = s.t + pushEvery(s);
  }
  const lost = s.seats.filter((x) => !x.out && x.b.lost);
  const place = alive(s).length - lost.length + 1;
  for (const me of lost) eliminate(s, me, place, ev);
  const left = alive(s);
  if (left.length <= 1) {
    s.over = true;
    if (left.length === 1) {
      left[0].place = 1;
      s.winners = [left[0].seat];
    } else {
      // выбыли разом — побеждают выбывшие последними
      const best = Math.min(...s.seats.map((x) => x.place));
      s.winners = s.seats.filter((x) => x.place === best).map((x) => x.seat);
    }
    ev.push({ k: 'end', winners: s.winners });
  }
  return ev;
}

function shoot(s: VsState, me: VsSeat, angle: number, rng: Rng, ev: VsEvent[]) {
  const b = me.b;
  const color = b.cur;
  const res = b.shoot(angle);
  if (!res) return;
  me.cool = COOL;
  ev.push({ k: 'shot', seat: me.seat, id: me.shotSeen, color, path: res.path.map(([x, y]) => [round(x), round(y)] as [number, number]), cell: res.cell, popped: res.popped, fell: res.fell });
  const cleared = b.won;
  if (cleared) {
    // поле чистое — новая кладка и большая атака
    b.won = false;
    for (let i = 0; i < 4; i++) b.pushRow(s.colors, i ? 1 : 0);
    ev.push({ k: 'clear', seat: me.seat });
  }
  const rows = attackRows(res.popped.length, res.fell.length, cleared);
  if (!rows) return;
  let a = Math.round(rows * attackMult(s, me));
  // сначала гасим свою очередь
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
  me.sent += a;
  ev.push({ k: 'attack', from: me.seat, to, n: a });
}

const round = (v: number) => Math.round(v * 100) / 100;

export const gridString = (b: Bubbles) => b.grid.map((row) => row.map((v) => (v == null ? '.' : String(v))).join('')).join('');

export function parseGrid(g: string): (number | null)[][] {
  const out: (number | null)[][] = [];
  for (let r = 0; r < ROWS; r++) {
    const row: (number | null)[] = [];
    for (let c = 0; c < COLS; c++) {
      const ch = g[r * COLS + c];
      row.push(ch == null || ch === '.' ? null : Number(ch));
    }
    out.push(row);
  }
  return out;
}

/** Снимок одинаков для всех мест — за шаг строим один раз (комната и боты просят его на каждое место). */
const snapMemo = new WeakMap<VsState, { t: number; over: boolean; v: VsView }>();

export function snapshot(s: VsState): VsView {
  const m = snapMemo.get(s);
  if (m && m.t === s.t && m.over === s.over) return m.v;
  const v = buildSnapshot(s);
  snapMemo.set(s, { t: s.t, over: s.over, v });
  return v;
}

function buildSnapshot(s: VsState): VsView {
  return {
    mode: s.mode,
    colors: s.colors,
    t: round(s.t),
    pushAt: round(s.pushAt),
    pushEvery: round(pushEvery(s)),
    over: s.over,
    winners: s.winners,
    boards: s.seats.map((me) => ({
      seat: me.seat,
      g: gridString(me.b),
      shift: me.b.shift,
      cur: me.b.cur,
      next: me.b.next,
      score: me.b.score,
      out: me.out,
      place: me.place,
      badges: me.badges,
      ko: me.ko,
      inc: me.queue.reduce((a, q) => a + q.n, 0),
      incAt: me.queue.length ? round(Math.min(...me.queue.map((q) => q.at))) : 0,
      target: me.out ? -1 : targetOf(s, me),
      aim: round(me.aim),
      shotSeen: me.shotSeen,
      swapSeen: me.swapSeen,
    })),
  };
}

/** Поле из снимка — для бота, подсказки и предсказания своего выстрела на экране. */
export function boardOf(v: VsBoardView, colors: number): Bubbles {
  return Bubbles.revive({
    spec: spec(colors),
    grid: parseGrid(v.g),
    shift: v.shift,
    drops: 0,
    shots: 0,
    score: v.score,
    cur: v.cur,
    next: v.next,
    won: false,
    lost: false,
    seed: 12345 + v.score,
  });
}

/** Ценность выстрела цветом под углом: сколько лопнет и упадёт, минус то, как низко прилипнет. */
export function shotValue(b: Bubbles, angle: number, color: number): number {
  const { cell } = b.trace(angle, 0.15);
  if (!cell) return -99;
  const t = Bubbles.revive({ ...b, grid: b.grid.map((row) => row.slice()) });
  const r = t.place(cell, color);
  const low = r.popped.length ? 0 : cell[0];
  let near = 0;
  if (!r.popped.length) for (const [nr, nc] of t.neighbors(cell[0], cell[1])) if (t.grid[nr][nc] === color) near++;
  return r.popped.length * 2 + r.fell.length * 3 + near * 1.2 - low * 0.45 + (t.checkLost() ? -50 : 0);
}

/** Ввод бота: думает (чем слабее — тем дольше и неточнее), стреляет в лучшее место, сильный меняет яйца, если так выгоднее. */
export function botInput(v: VsView, seat: number, level: number, mem: Record<string, any>, rng: Rng): VsIn {
  const me = v.boards.find((x) => x.seat === seat);
  mem.shot ??= 0;
  mem.swap ??= 0;
  mem.aim ??= -Math.PI / 2;
  const out = (): VsIn => ({ aim: mem.aim, shot: mem.shot, shotAim: mem.shotAim ?? mem.aim, swap: mem.swap, target: -1 });
  if (!me || me.out || v.over) return out();
  // ждём, пока комната примет прошлый выстрел и обмен
  if (me.shotSeen < mem.shot || me.swapSeen < mem.swap) return out();
  mem.at ??= v.t + 1 + rng.next();
  if (v.t < mem.at) return out();
  const b = boardOf(me, v.colors);
  const samples = [20, 30, 40][level] ?? 30;
  const plan = (color: number) => {
    let best = -Math.PI / 2;
    let bv = -Infinity;
    for (let i = 0; i <= samples; i++) {
      const a = -Math.PI + 0.12 + (i / samples) * (Math.PI - 0.24);
      const val = shotValue(b, a, color);
      if (val > bv) {
        bv = val;
        best = a;
      }
    }
    return { a: best, v: bv };
  };
  const p = plan(b.cur);
  if (level >= 2 && me.next !== me.cur && p.v < 4) {
    const q = plan(b.next);
    if (q.v > p.v + 1) {
      mem.swap++;
      mem.at = v.t + 0.15;
      return out();
    }
  }
  const noise = [0.03, 0.012, 0][level] ?? 0.012;
  mem.aim = Math.max(-Math.PI + 0.12, Math.min(-0.12, p.a + (rng.next() - 0.5) * 2 * noise));
  mem.shotAim = mem.aim;
  mem.shot++;
  const think = [1.8, 1.3, 1.0][level] ?? 1.3;
  mem.at = v.t + think * (0.75 + rng.next() * 0.5) / Math.min(1.6, 1 + v.t / 300);
  return out();
}
