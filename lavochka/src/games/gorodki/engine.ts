/* Городки — правила партии (без DOM). Каждый игрок выбивает свои фигуры по порядку в своём городе; подход — две биты,
 * потом ход следующему. Фигуру начинают с кона; выбит хоть один городок — остальные с полукона («Письмо» — только с кона).
 * Выбит — городок целиком покинул город и пригород (вернувшийся тоже выбит). Бита, коснувшаяся штрафной линии или земли
 * перед ней, — потерянный бросок: городки на место. Городок, оставшийся в пригороде ближе 20 см к штрафной линии, ставят
 * на отметку 20 см (если из фигуры ещё ничего не выбито — на 40 см). Марка «Письма» выбита, только если ни она, ни бита не
 * задели другие городки. Побеждает тот, кто выбил все фигуры меньшим числом бит; поровну — больше выбитых городков. */
import type { Options } from '../../core/types';
import { figure, FIGURES, FIVE, TEN } from './figures';
import { BR, inCity, launch, rod, RR, simulate, type Rod, type Throw } from './physics';

export interface Lite {
  x: number;
  y: number;
  a: number;
  st?: 1;
  mark?: 1;
}

export interface PState {
  /** Номер текущей фигуры в списке партии. */
  fig: number;
  rods: Lite[];
  /** Бит брошено. */
  throws: number;
  /** Городков выбито всего и из текущей фигуры. */
  knocked: number;
  figKnocked: number;
  /** Следующий бросок — с кона. */
  kon: boolean;
  /** Все фигуры выбиты. */
  done: boolean;
  /** Выбыл из борьбы: бит уже не меньше, чем у лучшего, или вышел предел. */
  out?: boolean;
}

export interface Cfg {
  figs: string[];
  kon: number;
  polukon: number;
  /** Предел бит на игрока (страховка от бесконечной партии). */
  max: number;
}

export interface State {
  cfg: Cfg;
  seats: number[];
  /** Номер в seats того, кто бросает. */
  cur: number;
  /** Какая бита подхода: 0 — первая, 1 — вторая. */
  bat: 0 | 1;
  p: PState[];
  over: boolean;
  winners: number[];
  /** Только превью карточки: кадр с битой в полёте. */
  shot?: boolean;
}

export type Action = { type: 'throw' } & Throw;

export type Event =
  | {
      k: 'throw';
      seat: number;
      t: Throw;
      line: number;
      fig: string;
      before: Lite[];
      after: Lite[];
      lost: boolean;
      out: number[];
      markBack: boolean;
      /** Городки, переставленные из пригорода на отметку. */
      moved: number[];
    }
  | { k: 'figure'; seat: number; fig: string; next: string | null; throws: number }
  | { k: 'finish'; seat: number; throws: number }
  | { k: 'turn'; seat: number }
  | { k: 'end'; winners: number[] };

export const FIG_SETS: Record<string, string[]> = {
  all: FIGURES.map((f) => f.id),
  ten: TEN,
  five: FIVE,
};

export function cfgFrom(o: Options): Cfg {
  const figs = FIG_SETS[String(o.figs ?? 'all')] ?? FIG_SETS.all;
  const kon = Number(o.kon ?? 13) || 13;
  return { figs, kon, polukon: kon / 2, max: figs.length * 14 };
}

export const toLite = (r: Rod, mark?: boolean): Lite => {
  const l: Lite = { x: round(r.x), y: round(r.y), a: round(r.a) };
  if (r.stand) l.st = 1;
  if (mark) l.mark = 1;
  return l;
};
export const fromLite = (l: Lite): Rod => rod(l.x, l.y, l.a, !!l.st);
const round = (v: number) => Math.round(v * 1e5) / 1e5;

export function layout(id: string): Lite[] {
  return figure(id).pieces.map((p) => {
    const l: Lite = { x: round(p.x), y: round(p.y), a: round(p.a) };
    if (p.stand) l.st = 1;
    if (p.mark) l.mark = 1;
    return l;
  });
}

export function newState(cfg: Cfg, seats: number[]): State {
  return {
    cfg,
    seats,
    cur: 0,
    bat: 0,
    p: seats.map(() => ({ fig: 0, rods: layout(cfg.figs[0]), throws: 0, knocked: 0, figKnocked: 0, kon: true, done: false })),
    over: false,
    winners: [],
  };
}

export const setup = (opts: Options, seats: number[]) => newState(cfgFrom(opts), seats);
export const toAct = (s: State): number[] => (s.over ? [] : [s.seats[s.cur]]);
export const lineOf = (s: State, i = s.cur) => -(s.p[i].kon ? s.cfg.kon : s.cfg.polukon);

/** Проверка действия: числа в своих пределах. */
export function cleanThrow(a: unknown): Throw | null {
  if (!a || typeof a !== 'object') return null;
  const o = a as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : null);
  const x = num(o.x, -1.5, 1.5);
  const ang = num(o.ang, -0.4, 0.4);
  const pow = num(o.pow, 0, 1);
  const spin = num(o.spin, -1, 1);
  if (x == null || ang == null || pow == null || spin == null) return null;
  return { x, ang, pow, spin, end: !!o.end };
}

/** Прогнать бросок по городу игрока: что выбито, что вернуть, что переставить. Без изменения состояния. */
export function resolve(s: State, i: number, t: Throw, frames = false) {
  const ps = s.p[i];
  const line = lineOf(s, i);
  const before = ps.rods;
  const sim = simulate(launch(t, line), before.map(fromLite), frames);
  // бита коснулась штрафной линии или земли перед ней — бросок потерян
  const lost = sim.firstTouch === 'ground' && !!sim.land && sim.land.y <= -1 + BR;
  const out: number[] = [];
  let markBack = false;
  const moved: number[] = [];
  let after: Lite[] = before;
  if (!lost) {
    const rods = sim.rods;
    for (let k = 0; k < rods.length; k++) if (sim.left[k]) out.push(k);
    // марка выбита «чисто»: ни она, ни бита не задели другие городки
    const mk = before.findIndex((l) => l.mark);
    if (mk >= 0 && out.includes(mk)) {
      const dirty = sim.contacts.some(([a, b]) => (a === mk || b === mk ? (a === -1 ? false : true) : a === -1 && b !== mk));
      if (dirty) {
        markBack = true;
        out.splice(out.indexOf(mk), 1);
        rods[mk] = fromLite(before[mk]);
      }
    }
    const knockedNow = ps.figKnocked + out.length;
    after = [];
    for (let k = 0; k < rods.length; k++) {
      if (out.includes(k)) continue;
      const r = rods[k];
      // в пригороде у штрафной линии — на отметку, поперёк
      if (!inCity(r) && r.y < 0) {
        const near = r.stand ? r.y - RR : r.y - Math.abs(Math.sin(r.a)) * (r.h - r.r) - r.r;
        if (near < -0.8) {
          const y = knockedNow > 0 ? -0.8 : -0.6;
          const half = 1 - y; // полуширина пригорода на этой глубине
          const x = Math.max(-half + 0.12, Math.min(half - 0.12, r.x));
          const nr = rod(x, y + RR, 0, false);
          moved.push(after.length);
          after.push(toLite(nr, !!before[k].mark));
          continue;
        }
      }
      after.push(toLite(r, !!before[k].mark));
    }
  }
  return { sim, line, before, after, lost, out, markBack, moved };
}

export function apply(s0: State, seat: number, a: Action): { state: State; events: Event[] } | null {
  if (s0.over || seat !== s0.seats[s0.cur] || !a || a.type !== 'throw') return null;
  const t = cleanThrow(a);
  if (!t) return null;
  const s: State = structuredClone(s0);
  const i = s.cur;
  const ps = s.p[i];
  const figId = s.cfg.figs[ps.fig];
  const r = resolve(s, i, t);
  const events: Event[] = [
    { k: 'throw', seat, t, line: r.line, fig: figId, before: r.before, after: r.after, lost: r.lost, out: r.out, markBack: r.markBack, moved: r.moved },
  ];
  ps.throws++;
  ps.rods = r.after;
  ps.figKnocked += r.out.length;
  ps.knocked += r.out.length;
  if (!ps.rods.length) {
    ps.fig++;
    const next = s.cfg.figs[ps.fig] ?? null;
    events.push({ k: 'figure', seat, fig: figId, next, throws: ps.throws });
    if (next) {
      ps.rods = layout(next);
      ps.figKnocked = 0;
      ps.kon = true;
    } else {
      ps.done = true;
      events.push({ k: 'finish', seat, throws: ps.throws });
    }
  } else ps.kon = !!figure(figId).konOnly || ps.figKnocked === 0;
  if (!ps.done && ps.throws >= s.cfg.max) ps.out = true;
  contention(s);
  // следующая бита: вторая того же игрока, иначе — следующий, кто ещё бросает
  const live = (k: number) => !s.p[k].done && !s.p[k].out;
  if (!s.p.some((_, k) => live(k))) {
    s.over = true;
    s.winners = winners(s);
    events.push({ k: 'end', winners: s.winners });
    return { state: s, events };
  }
  if (s.bat === 0 && live(i)) s.bat = 1;
  else {
    s.bat = 0;
    let k = i;
    do k = (k + 1) % s.p.length;
    while (!live(k));
    if (k !== i || s.p.length > 1) events.push({ k: 'turn', seat: s.seats[k] });
    s.cur = k;
  }
  return { state: s, events };
}

/** Кто уже не может выиграть: бит не меньше, чем у лучшего закончившего, а фигуры ещё не все. */
function contention(s: State) {
  const best = Math.min(...s.p.filter((p) => p.done).map((p) => p.throws));
  if (!Number.isFinite(best)) return;
  for (const p of s.p) if (!p.done && p.throws >= best) p.out = true;
}

function winners(s: State): number[] {
  const score = (p: PState) => [p.done ? 0 : 1, p.done ? p.throws : -p.fig, -p.knocked];
  let best: number[] | null = null;
  let w: number[] = [];
  s.p.forEach((p, k) => {
    const sc = score(p);
    const cmp = best ? sc.findIndex((v, j) => v !== best![j]) : -1;
    if (!best || (cmp >= 0 && sc[cmp] < best[cmp])) {
      best = sc;
      w = [s.seats[k]];
    } else if (cmp < 0) w.push(s.seats[k]);
  });
  return w;
}

export const figName = (id: string) => figure(id).name;
