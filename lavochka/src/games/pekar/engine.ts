/* Пекарь — правила партии в реальном времени (без DOM: их гоняют сервер, боты и тесты). Дворовая игра: в меловом кружке
 * стоит консервная банка, у неё — водящий, «пекарь». Остальные по очереди кидают в банку палки с черты своего звания
 * (рядовой — дальняя черта; чем выше звание, тем ближе к банке). Палка лежит, где упала: пока не подобрал, бросать нечем.
 * Каждый сам ведёт своего пацана: бежит за палкой, подбирает её касанием и возвращается за свою черту — за чертой
 * не осалить. Пекарь сам бежит к сбитой банке, подбирает и несёт её в кружок; пока банка не стоит, салить нельзя.
 * Стоит банка — пекарь (он не заходит ближе полполя к чертам) догоняет тех, кто в поле, и салит палкой («Салить!» рядом или просто коснувшись). Осаленный —
 * новый пекарь (в «Дворовом коротком» ещё и на звание ниже). Сбил банку — звание выше; сбил маршалом (или набрал N банок
 * без званий) — победа. Пекаря на первый кон выбирают пинком палки: ближе всех — пекарь, остальные бросают по дальности.
 *
 * Шаг симуляции — TICK_MS, физика медленнее жизни во столько, сколько выбрано «Скоростью игры». Ввод места: куда бежать
 * (оси игры), счётчики разовых действий (бросок, пинок, «действие», рывок) — новое значение счётчика = нажатие. */
import { applySpeed, cleanSpeed } from '../../core/realtime';
import { BODY, dash as dashStart, drive, dsSpeed, dtScale, separate, slowmo } from '../../core/dvorsport/sim';
import type { Options, Rng } from '../../core/types';
import {
  canFlight,
  canHome,
  cfgFrom,
  CIRCLE,
  clamp,
  dist2,
  GRAB,
  kickBody,
  lineY,
  pekarSpot,
  r3,
  REACH,
  stickFlight,
  throwFrom,
  VP,
  VP_CAN,
  VR,
  waitSpot,
  yawTo,
  type Cfg,
  type Style,
} from './field';
import { sample as sampleAt, type Body } from '../../core/dvorsport/body';

export * from './field';

export const TICK_MS = 1000 / 60;
/** Рывок: во сколько раз быстрее, сколько длится и перезарядка, с. */
export const DASH = { k: BODY.dashK, t: BODY.dashT, cd: BODY.dashCd };
/** Салит и сам, коснувшись (м), — без кнопки. */
export const TOUCH = 2 * BODY.r + 0.1;
/** Ловля палки пекарем: на каком расстоянии от палки (м) и до какой высоты она в руках. */
export const CATCH_R = 1.1;
export const CATCH_Z = 2.0;
/** Сколько секунд после «Лови!» рука наготове. */
export const CATCH_WIN = 0.4;
/** Сколько ждать бросающего, с: потом ход переходит дальше (чтобы один не держал всех). */
export const TURN_WAIT = 25;
/** Ближе какой отметки пекарю нельзя (половина пути от черты рядового до банки). */
export const pekarMinY = (c: Cfg) => r3(c.dist * 0.5);
/** Поле, по которому можно бегать (x, y). */
export const BOUND = { x: 12, y0: -6, y1: 10 };

export type StickAt = 'hand' | 'ground' | 'fly' | 'pekar';

export interface Man {
  x: number;
  y: number;
  vx: number;
  vy: number;
  dash: number;
  cd: number;
  rank: number;
  knocks: number;
}

export interface StickS {
  at: StickAt;
  x: number;
  y: number;
  a: number;
  /** В полёте: палка, когда брошена, стиль, целились ли в стоящую банку, сбила ли уже. */
  b0?: Body;
  t0?: number;
  style?: Style;
  aim?: boolean;
  hit?: boolean;
}

export interface CanS {
  mode: 'up' | 'fly' | 'down' | 'held';
  x: number;
  y: number;
  a: number;
  /** Отлёт: откуда, куда, когда. */
  fx: number;
  fy: number;
  t0: number;
}

export interface In {
  /** Куда бежать — оси игры (x вбок, y вглубь), длина ≤ 1. */
  mx: number;
  my: number;
  /** Бросок (n — счётчик нажатий): сила, отклонение от направления на банку, стиль. */
  th?: { n: number; pow: number; yaw: number; style: Style };
  /** Пинок на жеребьёвке. */
  k?: { n: number; pow: number };
  /** «Действие» (салить) и рывок — счётчики. */
  a?: number;
  d?: number;
  sp?: number;
}

export type Event =
  | { k: 'kick'; who: number; d: number; slip: boolean }
  | { k: 'draw'; pekar: number; order: number[] }
  | { k: 'throw'; who: number; style: Style }
  | { k: 'knock'; who: number; rank: number; knocks: number }
  | { k: 'land'; who: number; hit: boolean; x: number; y: number }
  | { k: 'pick'; who: number }
  | { k: 'can'; what: 'pick' | 'set' }
  | { k: 'tag'; who: number; by: number }
  | { k: 'catch'; who: number; by: number; x: number; y: number }
  | { k: 'pekar'; who: number; old: number; rank: number }
  | { k: 'skip'; who: number }
  | { k: 'end'; winners: number[] };

export interface State {
  cfg: Cfg;
  seats: number[];
  /** Часы партии (физика), с. */
  t: number;
  speed: number;
  spSeen?: number[];
  phase: 'kick' | 'play' | 'pause';
  /** Пауза до (часы партии) и что потом. */
  until: number;
  next: 'reset' | 'swap' | null;
  swapTo: number;
  men: Man[];
  sticks: StickS[];
  can: CanS;
  pekar: number;
  /** Порядок бросков (по дальности пинка) и кто бросал последним. */
  order: number[];
  last: number;
  /** Чей бросок сейчас и с каких пор. */
  turn: number;
  turnT: number;
  /** Чья палка летит (-1 — ничья). */
  fly: number;
  kicks: (number | null)[];
  /** Последние учтённые счётчики ввода по местам. */
  seen: { th: number; k: number; a: number; d: number }[];
  throws: number;
  over: boolean;
  winners: number[];
  /** Замедление (сбитая банка, осалили) — core/dvorsport/sim.ts. */
  slowUntil?: number;
  slowK?: number;
  /** До каких пор пекарь держит руку наготове (ловля палки). */
  catchT?: number;
  /** До каких пор пекарь не салит (только что сменился). */
  calm?: number;
  /** Только превью карточки. */
  shot?: boolean;
  /** Позиция показа правил (только на ней def.apply «перематывает» партию). */
  demo?: boolean;
}

export const idleInput = (): In => ({ mx: 0, my: 0 });

export function cleanInput(raw: unknown): In | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
  const out: In = { mx: clamp(num(r.mx), -1, 1), my: clamp(num(r.my), -1, 1) };
  const th = r.th as Record<string, unknown> | undefined;
  if (th && typeof th === 'object' && (th.style === 'flat' || th.style === 'lob')) out.th = { n: Math.round(num(th.n)), pow: clamp(num(th.pow), 0, 1), yaw: clamp(num(th.yaw), -0.6, 0.6), style: th.style };
  const k = r.k as Record<string, unknown> | undefined;
  if (k && typeof k === 'object') out.k = { n: Math.round(num(k.n)), pow: clamp(num(k.pow), 0, 1) };
  if (r.a != null) out.a = Math.round(num(r.a));
  if (r.d != null) out.d = Math.round(num(r.d));
  const sp = cleanSpeed(r.sp);
  if (sp != null) out.sp = sp;
  return out;
}

export function newGame(o: Options, seats: number[], speed = dsSpeed(o)): State {
  const c = cfgFrom(o, seats.length);
  const n = c.n;
  const s: State = {
    cfg: c,
    seats: seats.slice(0, n),
    t: 0,
    speed,
    phase: 'kick',
    until: 0,
    next: null,
    swapTo: -1,
    men: Array.from({ length: n }, (_, i) => {
      const [x, y] = waitSpot(c, i, 0);
      return { x, y, vx: 0, vy: 0, dash: 0, cd: 0, rank: 0, knocks: 0 };
    }),
    sticks: Array.from({ length: n }, () => ({ at: 'hand' as StickAt, x: 0, y: 0, a: 0 })),
    can: { mode: 'up', x: 0, y: c.dist, a: 0, fx: 0, fy: c.dist, t0: 0 },
    pekar: -1,
    order: [],
    last: -1,
    turn: -1,
    turnT: 0,
    fly: -1,
    kicks: Array.from({ length: n }, () => null),
    seen: Array.from({ length: n }, () => ({ th: 0, k: 0, a: 0, d: 0 })),
    throws: 0,
    over: false,
    winners: [],
  };
  return s;
}

/** Кто пинает на жеребьёвке (-1 — все пнули). */
export const kicker = (s: State) => (s.phase === 'kick' && s.fly < 0 ? s.kicks.findIndex((k) => k == null) : -1);
/** Черта игрока. */
export const lineOf = (s: State, i: number) => lineY(s.cfg, s.men[i].rank);
/** В поле — за своей чертой (там его можно осалить). */
export const inField = (s: State, i: number) => i !== s.pekar && s.men[i].y > lineOf(s, i) + 0.05;
/** Может бросать: палка в руке, стоит за своей чертой. */
export const canThrowNow = (s: State, i: number) => i !== s.pekar && s.sticks[i].at === 'hand' && !inField(s, i);

/** Чей бросок: по порядку после бросавшего последним — первый, у кого палка в руке и он за чертой. Банка должна стоять. */
export function whoThrows(s: State): number {
  if (s.phase !== 'play' || s.can.mode !== 'up' || s.fly >= 0 || s.over) return -1;
  const ord = s.order.filter((i) => i !== s.pekar);
  if (!ord.length) return -1;
  const start = Math.max(0, ord.indexOf(s.last) + 1);
  for (let k = 0; k < ord.length; k++) {
    const i = ord[(start + k) % ord.length];
    if (canThrowNow(s, i)) return i;
  }
  return -1;
}


/** Ловить можно палку, что летит мимо банки, — стоя за банкой (не между банкой и игроками). Где палка сейчас (оси игры),
 * если её можно поймать; null — нельзя. */
export function catchable(s: State, t = s.t): { x: number; y: number; z: number } | null {
  const c = s.cfg;
  if (!c.catch || s.phase !== 'play' || s.fly < 0 || s.pekar < 0 || s.can.mode !== 'up') return null;
  const st = s.sticks[s.fly];
  if (!st.b0 || !st.aim) return null;
  const f = stickFlight(st.b0, st.style!, canHome(c));
  if (f.hit) return null;
  const fr = sampleAt(f.frames, t - st.t0!);
  return fr[3] < CATCH_Z ? { x: fr[1], y: fr[2], z: fr[3] } : null;
}
/** Пекарь стоит за банкой. */
export const behindCan = (s: State) => s.pekar >= 0 && s.men[s.pekar].y >= s.cfg.dist - 0.2;

/** Победа: сбил банку маршалом (или набрал банок без званий); страховка — по званию. */
function checkEnd(s: State, ev: Event[]): boolean {
  const c = s.cfg;
  const top = c.ranks.length;
  const won = s.men.map((m, i) => ((top > 1 ? m.rank >= top : m.knocks >= c.target) ? i : -1)).filter((i) => i >= 0);
  if (!won.length && s.throws < c.maxThrows) return false;
  s.over = true;
  if (won.length) s.winners = won.map((i) => s.seats[i]);
  else {
    const sc = (m: Man) => m.rank * 100 + m.knocks;
    const best = Math.max(...s.men.map(sc));
    s.winners = s.men.map((m, i) => (sc(m) === best ? s.seats[i] : -1)).filter((x) => x >= 0);
  }
  ev.push({ k: 'end', winners: s.winners });
  return true;
}

/** Все по местам: после жеребьёвки (пекарь — к банке) и после осаливания (новый пекарь — к банке, старый — за черту). */
function regroup(s: State, only: number[] | null) {
  const c = s.cfg;
  s.men.forEach((m, i) => {
    if (only && !only.includes(i)) return;
    const [x, y] = i === s.pekar ? pekarSpot(c) : waitSpot(c, i, m.rank);
    m.x = x;
    m.y = y;
    m.vx = m.vy = 0;
  });
}

function move(s: State, i: number, inp: In | null | undefined, dt: number) {
  const m = s.men[i];
  const seen = s.seen[i];
  if (inp?.d != null && seen && inp.d > seen.d) {
    seen.d = inp.d;
    dashStart(m);
  }
  const pk = i === s.pekar;
  const v = pk ? (s.can.mode === 'held' ? VP_CAN : VP) : VR;
  drive(m, { mx: inp?.mx ?? 0, my: inp?.my ?? 0 }, v, dt);
  m.x = clamp(m.x, -BOUND.x, BOUND.x);
  // пекарь не заходит ближе к чертам, чем полполя: караулить у черты нельзя
  m.y = clamp(m.y, pk ? pekarMinY(s.cfg) : BOUND.y0, s.cfg.dist + BOUND.y1);
}

/** Шаг симуляции: s меняется на месте. */
export function step(s: State, inputs: (In | null | undefined)[], rng: Rng): Event[] {
  const ev: Event[] = [];
  if (s.over) return ev;
  const c = s.cfg;
  const n = c.n;
  const inp = (i: number) => inputs[s.seats[i]];
  for (let i = 0; i < n; i++) applySpeed(s, s.seats[i], inp(i)?.sp);
  const dt = (TICK_MS / 1000) * s.speed * dtScale(s);
  s.t += dt;

  if (s.phase === 'pause') {
    if (s.t < s.until) return ev;
    if (s.next === 'reset') regroup(s, null);
    else if (s.next === 'swap') {
      const old = s.pekar;
      const who = s.swapTo;
      s.sticks[old].at = 'hand';
      s.pekar = who;
      s.sticks[who].at = 'pekar';
      if (c.demote && s.men[who].rank > 0) s.men[who].rank--;
      regroup(s, [old, who]);
      ev.push({ k: 'pekar', who, old, rank: s.men[who].rank });
      // новому пекарю — секунда дойти до банки: кто рядом, успеет отбежать
      s.calm = s.t + 0.9;
      s.swapTo = -1;
    }
    separate(s.men, BODY.r);
    s.next = null;
    s.phase = 'play';
    s.turnT = s.t;
    for (let i = 0; i < n; i++) {
      // нажатое во время паузы не копим
      const q = inp(i);
      if (q?.th) s.seen[i].th = Math.max(s.seen[i].th, q.th.n);
      if (q?.a != null) s.seen[i].a = Math.max(s.seen[i].a, q.a);
    }
    return ev;
  }

  // палка в полёте: сбила банку? легла?
  if (s.fly >= 0) {
    const i = s.fly;
    const st = s.sticks[i];
    const f = stickFlight(st.b0!, st.style!, st.aim ? canHome(c) : null);
    const tt = s.t - st.t0!;
    if (f.hit && !st.hit && tt >= f.hit.t) {
      st.hit = true;
      const cf = canFlight(f.hit, canHome(c));
      s.can = { mode: 'fly', x: cf.to[0], y: cf.to[1], a: cf.a, fx: canHome(c)[0], fy: canHome(c)[1], t0: s.t };
      const m = s.men[i];
      m.knocks++;
      if (c.ranks.length > 1) m.rank++;
      ev.push({ k: 'knock', who: i, rank: m.rank, knocks: m.knocks });
      slowmo(s, 1.0, 0.3);
      if (checkEnd(s, ev)) return ev;
    }
    // пекарь ловит палку, что летит мимо: нажал «Лови!», палка рядом и невысоко, он за банкой
    const p0 = s.pekar;
    const qp = p0 >= 0 ? inp(p0) : null;
    if (p0 >= 0 && qp?.a != null && qp.a > s.seen[p0].a) {
      s.seen[p0].a = qp.a;
      // «Лови!» держит руку наготове CATCH_WIN с: палка влетит в руки — поймана
      s.catchT = s.t + CATCH_WIN * s.speed;
    }
    if (p0 >= 0 && s.t <= (s.catchT ?? -1)) {
      const cp = catchable(s);
      const pm = s.men[p0];
      if (cp && behindCan(s) && dist2([pm.x, pm.y], [cp.x, cp.y]) < CATCH_R) {
        st.at = 'hand';
        st.b0 = undefined;
        s.fly = -1;
        ev.push({ k: 'catch', who: i, by: p0, x: cp.x, y: cp.y });
        slowmo(s, 0.8, 0.3);
        s.phase = 'pause';
        s.until = s.t + 1.1;
        s.next = 'swap';
        s.swapTo = i;
        s.catchT = -1;
        return ev;
      }
    }
    if (tt >= f.t) {
      [st.x, st.y, st.a] = f.rest;
      st.at = 'ground';
      st.b0 = undefined;
      s.fly = -1;
      s.turnT = s.t;
      ev.push({ k: 'land', who: i, hit: !!st.hit, x: st.x, y: st.y });
      if (s.phase === 'kick') {
        s.kicks[i] = st.y;
        if (s.kicks.every((k) => k != null)) {
          // ближе всех — пекарь; остальные бросают по дальности пинка
          const idx = s.kicks.map((_, k) => k).sort((a, b) => s.kicks[b]! - s.kicks[a]! || a - b);
          s.pekar = idx[idx.length - 1];
          s.order = idx;
          s.last = -1;
          for (const sk of s.sticks) sk.at = 'hand';
          s.sticks[s.pekar].at = 'pekar';
          ev.push({ k: 'draw', pekar: s.pekar, order: idx.filter((k) => k !== s.pekar) });
          s.phase = 'pause';
          s.until = s.t + 1.2;
          s.next = 'reset';
          return ev;
        }
      }
    }
  }
  if (s.can.mode === 'fly' && s.t - s.can.t0 >= 0.6) s.can.mode = 'down';

  if (s.phase === 'kick') {
    const k = kicker(s);
    // чей пинок — тот на середине черты, остальные на своих местах (никто ни в ком не стоит)
    if (k >= 0)
      s.men.forEach((m, j) => {
        [m.x, m.y] = j === k ? [-0.25, -0.35] : waitSpot(c, j, 0);
      });
    const q = k >= 0 ? inp(k) : null;
    if (k >= 0 && q?.k && q.k.n > s.seen[k].k) {
      s.seen[k].k = q.k.n;
      const pow = q.k.pow;
      // что есть силы — палка может сорваться с носка
      const slip = pow > 0.82 && rng.int(1000) < Math.round((pow - 0.82) * 3000);
      const b0 = kickBody(slip ? pow * 0.35 : pow, k, slip);
      // пинает с середины черты, а кто пинал до него — назад на своё место
      s.men.forEach((m, j) => {
        [m.x, m.y] = j === k ? [-0.25, -0.35] : waitSpot(c, j, 0);
      });
      s.sticks[k] = { at: 'fly', x: b0.x, y: b0.y, a: 0, b0, t0: s.t, style: 'lob', aim: false };
      s.fly = k;
      const f = stickFlight(b0, 'lob', null);
      ev.push({ k: 'kick', who: k, d: f.rest[1], slip });
    }
    return ev;
  }

  // бег; потом развести тех, кто налез друг на друга (пекарь с банкой в руках — не двигаем)
  for (let i = 0; i < n; i++) move(s, i, inp(i), dt);
  separate(s.men, BODY.r);

  // подобрать свою палку — касанием
  for (let i = 0; i < n; i++) {
    const st = s.sticks[i];
    if (i === s.pekar || st.at !== 'ground') continue;
    if (dist2([s.men[i].x, s.men[i].y], [st.x, st.y]) < GRAB) {
      st.at = 'hand';
      ev.push({ k: 'pick', who: i });
    }
  }

  // пекарь: банку подобрать касанием, поставить — донеся до кружка; салить — когда банка стоит
  const p = s.pekar;
  if (p >= 0) {
    const pm = s.men[p];
    const home = canHome(c);
    if (s.can.mode === 'down' && dist2([pm.x, pm.y], [s.can.x, s.can.y]) < GRAB) {
      s.can.mode = 'held';
      ev.push({ k: 'can', what: 'pick' });
    } else if (s.can.mode === 'held') {
      s.can.x = pm.x;
      s.can.y = pm.y;
      if (dist2([pm.x, pm.y], home) < CIRCLE) {
        s.can = { mode: 'up', x: home[0], y: home[1], a: 0, fx: home[0], fy: home[1], t0: s.t };
        s.turnT = s.t;
        ev.push({ k: 'can', what: 'set' });
      }
    }
    const q = inp(p);
    const pressed = q?.a != null && q.a > s.seen[p].a;
    if (q?.a != null) s.seen[p].a = Math.max(s.seen[p].a, q.a);
    if (s.can.mode === 'up' && s.t >= (s.calm ?? 0)) {
      let best = -1;
      let bd = Infinity;
      for (let i = 0; i < n; i++) {
        if (!inField(s, i)) continue;
        const d = dist2([pm.x, pm.y], [s.men[i].x, s.men[i].y]);
        if (d < bd) (bd = d), (best = i);
      }
      if (best >= 0 && (bd < TOUCH || (pressed && bd < REACH))) {
        ev.push({ k: 'tag', who: best, by: p });
        slowmo(s, 0.8, 0.3);
        s.phase = 'pause';
        s.until = s.t + 1.1;
        s.next = 'swap';
        s.swapTo = best;
        return ev;
      }
    }
  }

  // бросок: чей ход — тот и бросает с места, где стоит за своей чертой
  const w = whoThrows(s);
  if (w !== s.turn) {
    s.turn = w;
    s.turnT = s.t;
  }
  if (w >= 0) {
    const q = inp(w);
    if (q?.th && q.th.n > s.seen[w].th) {
      s.seen[w].th = q.th.n;
      const m = s.men[w];
      const b0 = throwFrom(c, m.x, m.y, q.th.pow, yawTo(c, m.x, m.y) + q.th.yaw, q.th.style);
      s.sticks[w] = { at: 'fly', x: b0.x, y: b0.y, a: 0, b0, t0: s.t, style: q.th.style, aim: true, hit: false };
      s.fly = w;
      s.last = w;
      s.throws++;
      ev.push({ k: 'throw', who: w, style: q.th.style });
      if (checkEnd(s, ev)) return ev;
    } else if (s.t - s.turnT > TURN_WAIT * s.speed) {
      // заснул — ход дальше
      s.last = w;
      s.turnT = s.t;
      ev.push({ k: 'skip', who: w });
    }
  }
  // бросок прошлого шага «съеден» ходом — учесть, чтобы не выстрелил потом
  for (let i = 0; i < n; i++) {
    const q = inp(i);
    if (i !== w && q?.th) s.seen[i].th = Math.max(s.seen[i].th, q.th.n);
    if (i !== p && q?.a != null) s.seen[i].a = Math.max(s.seen[i].a, q.a);
  }
  return ev;
}

/** Снимок для рассылки: всё открыто, кэш полётов не нужен. */
export const snapshot = (s: State): State => JSON.parse(JSON.stringify(s));

/** Бирка игрока: звание или счёт. */
export const rankName = (c: Cfg, m: Man) => (c.ranks.length > 1 ? c.ranks[Math.min(m.rank, c.ranks.length - 1)] : `сбил ${m.knocks}`);

export { r3 };
