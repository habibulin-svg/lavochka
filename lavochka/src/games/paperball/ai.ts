/* Футбол на бумаге — боты. Лёгкий ходит наугад (но гол видит через раз), средний жадно тянет мяч к чужим воротам,
 * сложный перебирает свои ходы и лучший ответ соперника: не подставляется под гол, загоняет соперника без хода (штрафной) или в тупик. */
import type { Rng } from '../../core/types';
import { Board, boardOf, bounces, distTo, kicks, ruPaths, steps, type Action, type State } from './engine';

const pick = <T>(xs: T[], rng: Rng) => xs[rng.int(xs.length)];

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.phase !== 'play' || s.turn !== seat) return null;
  const b = boardOf(s);
  if (s.mode === 'ru') return s.penalty ? kick(b, s, seat, level, rng) : ru(b, s, seat, level, rng);
  return single(b, s, seat, level, rng);
}

/** Насколько узел хорош для seat: соперник далеко от своих ворот, мы близко к чужим. */
const value = (b: Board, n: number, seat: number) => distTo(b, n, 1 - seat) - distTo(b, n, seat);

// ---------------------------------------------------------------- русский

const WIN = 1000;

/** Итог хода path для seat: гол (±WIN) или null — игра идёт. */
function scored(b: Board, path: number[], seat: number): number | null {
  const side = b.goalSide(path[path.length - 1]);
  return side < 0 ? null : side === seat ? WIN : -WIN;
}

function draw(b: Board, from: number, path: number[]) {
  let a = from;
  for (const q of path) {
    b.add(a, q);
    a = q;
  }
}

function undraw(b: Board, from: number, path: number[]) {
  let a = from;
  for (const q of path) {
    b.remove(a, q);
    a = q;
  }
}

function ru(b: Board, s: State, seat: number, level: number, rng: Rng): Action | null {
  const paths = ruPaths(b, s.ball);
  if (!paths.length) return null;
  const goals = paths.filter((p) => scored(b, p, seat) === WIN);
  const safe = paths.filter((p) => scored(b, p, seat) !== -WIN);
  if (level === 0) {
    if (goals.length && rng.next() < 0.5) return { type: 'move', path: pick(goals, rng) };
    return { type: 'move', path: pick(safe.length ? safe : paths, rng) };
  }
  if (goals.length) return { type: 'move', path: pick(goals, rng) };
  const pool = safe.length ? safe : paths;
  let best = -Infinity;
  let bestPath = pool[0];
  for (const p of pool) {
    const end = p[p.length - 1];
    let v: number;
    if (level === 1) v = value(b, end, seat) + rng.next() * 0.9;
    else {
      draw(b, s.ball, p);
      v = reply(b, end, seat) + value(b, end, seat) * 0.15 + rng.next() * 0.3;
      undraw(b, s.ball, p);
    }
    if (v > best) {
      best = v;
      bestPath = p;
    }
  }
  return { type: 'move', path: bestPath };
}

/** Лучший ответ соперника из узла at (на поле уже наш ход) — оценка для seat. */
function reply(b: Board, at: number, seat: number): number {
  const opp = 1 - seat;
  const paths = ruPaths(b, at);
  if (!paths.length) {
    // соперник без хода — наш штрафной: оцениваем лучший удар
    let k = -Infinity;
    for (const { path } of kicks(b, at)) {
      const end = path[path.length - 1];
      const side = b.goalSide(end);
      k = Math.max(k, side === seat ? WIN / 2 : side === opp ? -WIN / 2 : value(b, end, seat) + 6);
    }
    return k === -Infinity ? 0 : k;
  }
  let worst = Infinity;
  for (const p of paths) {
    const g = scored(b, p, opp);
    if (g === WIN) return -WIN;
    const end = p[p.length - 1];
    const v = g === -WIN ? WIN : value(b, end, seat);
    if (v < worst) worst = v;
  }
  return worst;
}

function kick(b: Board, s: State, seat: number, level: number, rng: Rng): Action | null {
  const ks = kicks(b, s.ball);
  if (!ks.length) return null;
  if (level === 0) return { type: 'kick', dir: pick(ks, rng).dir };
  let best = -Infinity;
  let dir = ks[0].dir;
  for (const { dir: d, path } of ks) {
    const end = path[path.length - 1];
    const side = b.goalSide(end);
    let v = side === seat ? WIN : side === 1 - seat ? -WIN : value(b, end, seat);
    if (level === 2 && side < 0) {
      draw(b, s.ball, path);
      v = reply(b, end, seat) + value(b, end, seat) * 0.15;
      undraw(b, s.ball, path);
    }
    v += rng.next() * 0.3;
    if (v > best) {
      best = v;
      dir = d;
    }
  }
  return { type: 'kick', dir };
}

// ---------------------------------------------------------------- отскоки и хоккей

interface Line {
  /** Узлы хода после мяча (с отскоками). */
  path: number[];
  /** Чем кончился ход: 'goal' — мы забили, 'own' — себе, 'dead' — сами в тупике, 'pass' — ход сопернику. */
  end: 'goal' | 'own' | 'dead' | 'pass';
  at: number;
}

/** Все продолжения хода seat из a (с отскоками), не больше limit. Поле правится и возвращается. */
function turns(b: Board, a: number, seat: number, limit: number): Line[] {
  const out: Line[] = [];
  const path: number[] = [];
  const walk = (at: number) => {
    const qs = steps(b, at);
    if (!qs.length) {
      out.push({ path: path.slice(), end: 'dead', at });
      return;
    }
    for (const q of qs) {
      if (out.length >= limit) return;
      path.push(q);
      const side = b.goalSide(q);
      if (side >= 0) out.push({ path: path.slice(), end: side === seat ? 'goal' : 'own', at: q });
      else {
        const again = bounces(b, q);
        b.add(at, q);
        if (again) walk(q);
        else out.push({ path: path.slice(), end: 'pass', at: q });
        b.remove(at, q);
      }
      path.pop();
    }
  };
  walk(a);
  return out;
}

function single(b: Board, s: State, seat: number, level: number, rng: Rng): Action | null {
  const qs = steps(b, s.ball);
  if (!qs.length) return null;
  if (level === 0) {
    const goal = qs.filter((q) => b.goalSide(q) === seat);
    if (goal.length && rng.next() < 0.6) return { type: 'move', path: [goal[0]] };
    const ok = qs.filter((q) => b.goalSide(q) !== 1 - seat);
    return { type: 'move', path: [pick(ok.length ? ok : qs, rng)] };
  }
  const lines = turns(b, s.ball, seat, level === 1 ? 600 : 1500);
  const rank = (l: Line) => (l.end === 'goal' ? WIN : l.end === 'own' || l.end === 'dead' ? -WIN : value(b, l.at, seat));
  if (level === 1) {
    let best = -Infinity;
    let first = qs[0];
    for (const l of lines) {
      const v = rank(l) + rng.next() * 0.9;
      if (v > best) {
        best = v;
        first = l.path[0];
      }
    }
    return { type: 'move', path: [first] };
  }
  // сложный: лучшие по первому взгляду ходы проверяем ответом соперника
  const scoredLines = lines.map((l) => ({ l, v: rank(l) + rng.next() * 0.2 })).sort((x, y) => y.v - x.v);
  const win = scoredLines.find((x) => x.l.end === 'goal');
  if (win) return { type: 'move', path: [win.l.path[0]] };
  let best = -Infinity;
  let first = scoredLines[0]?.l.path[0] ?? qs[0];
  for (const { l, v } of scoredLines.slice(0, 40)) {
    if (l.end !== 'pass') {
      if (v > best) {
        best = v;
        first = l.path[0];
      }
      continue;
    }
    draw(b, s.ball, l.path);
    const opp = turns(b, l.at, 1 - seat, 800);
    let worst = Infinity;
    for (const o of opp) {
      const w = o.end === 'goal' ? -WIN : o.end === 'own' || o.end === 'dead' ? WIN : value(b, o.at, seat);
      if (w < worst) worst = w;
      if (worst === -WIN) break;
    }
    undraw(b, s.ball, l.path);
    const total = (opp.length ? worst : WIN) + rng.next() * 0.2;
    if (total > best) {
      best = total;
      first = l.path[0];
    }
  }
  return { type: 'move', path: [first] };
}
