/* Нарды — боты: перебор всех вариантов хода целиком и оценка позиции. */
import type { Rng } from '../../core/types';
import { BAR, boardKey, finals, isLong, legalSteps, own, pipCount, simStep, type Action, type State, type Step } from './engine';

/** Сколько из 36 бросков попадают на расстояние d (короткие нарды, прямые и комбинированные удары). */
const SHOTS = [0, 11, 12, 14, 15, 15, 17, 6, 6, 5, 3, 2, 3, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 1];

interface W {
  prime: number;
  flex: number;
  stack: number;
  blot: number;
  home: number;
  bar: number;
}
const WEIGHTS: W[] = [
  { prime: 0.2, flex: 0.1, stack: 0.1, blot: 4, home: 1, bar: 6 },
  { prime: 0.7, flex: 0.35, stack: 0.4, blot: 11, home: 2.5, bar: 9 },
  { prime: 0.9, flex: 0.45, stack: 0.5, blot: 14, home: 3, bar: 11 },
];

/** Позиция шашки соперника в индексах пути игрока p (короткие: навстречу). */
const mirror = (j: number) => 23 - j;

function contact(s: State, p: number): boolean {
  if (isLong(s.cfg)) return true;
  const o = 1 - p;
  let myBack = 24;
  if (s.bar[p]) myBack = -1;
  else for (let i = 0; i < 24; i++) if (own(s, p, i)) { myBack = i; break; }
  let foeBack = -1;
  if (s.bar[o]) foeBack = 24;
  else for (let j = 0; j < 24; j++) if (own(s, o, j)) { foeBack = mirror(j); break; }
  return myBack < foeBack;
}

/** Оценка одной стороны (без пипов). */
function side(s: State, p: number, w: W): number {
  const o = 1 - p;
  const long = isLong(s.cfg);
  let v = s.off[p] * 1.5;
  if (long) {
    // блоки впереди задней шашки соперника — чем длиннее, тем ценнее
    let foeRear = 24;
    for (let j = 0; j < 24; j++) if (own(s, o, j)) { foeRear = j; break; }
    let run = 0;
    for (let j = 0; j < 24; j++) {
      const a = idxOfAbs(s, o, j);
      const mine = s.pts[a] * (p === 0 ? 1 : -1) > 0;
      if (mine && j > foeRear) run++;
      else {
        if (run > 1) v += run * run * w.prime;
        run = 0;
      }
    }
    if (run > 1) v += run * run * w.prime;
    let pts = 0;
    for (let i = 0; i < 24; i++) {
      const n = own(s, p, i);
      if (!n) continue;
      pts++;
      if (i > 0 && n > 3) v -= (n - 3) * w.stack;
    }
    v += pts * w.flex;
    return v;
  }
  // короткие
  let run = 0;
  for (let i = 0; i < 24; i++) {
    const n = own(s, p, i);
    if (n >= 2) {
      run++;
      if (i >= 18) v += w.home;
      if (i <= 5) v += 1; // якорь в доме соперника
    } else {
      if (run > 1) v += run * run * w.prime;
      run = 0;
    }
  }
  if (run > 1) v += run * run * w.prime;
  v -= s.bar[p] * w.bar;
  if (s.bar[o]) {
    let closed = 0;
    for (let i = 18; i < 24; i++) if (own(s, p, i) >= 2) closed++;
    v += s.bar[o] * closed * 1.5;
  }
  // одиночные шашки под боем
  if (contact(s, p)) {
    const foes: number[] = [];
    if (s.bar[o]) foes.push(24);
    for (let j = 0; j < 24; j++) if (own(s, o, j)) foes.push(mirror(j));
    for (let i = 0; i < 24; i++) {
      if (own(s, p, i) !== 1) continue;
      let miss = 1;
      const ds = new Set<number>();
      for (const k of foes) if (k > i && k - i <= 24) ds.add(k - i);
      for (const d of ds) miss *= 1 - SHOTS[d] / 36;
      v -= (1 - miss) * (w.blot + i * 0.35);
    }
  }
  return v;
}

function idxOfAbs(s: State, o: number, j: number): number {
  // абсолютный пункт индекса j пути соперника
  if (o === 0) return (12 + j) % 24;
  return s.cfg.mode === 'short' ? (35 - j) % 24 : j;
}

export function evaluate(s: State, p: number, level: number): number {
  const w = WEIGHTS[Math.min(level, 2)];
  const o = 1 - p;
  const pips = pipCount(s, o) - pipCount(s, p);
  if (s.off[p] === 15) return 1000;
  if (!contact(s, p)) return pips * 1.2 + (s.off[p] - s.off[o]) * 2;
  return pips + side(s, p, w) - side(s, o, w);
}

// План хода: ключ позиции → оставшиеся шаги. Бот ходит по одному шагу, а думает сразу над всем ходом.
const plans = new Map<string, Step[]>();
const planKey = (s: State) => s.cur + '#' + boardKey(s);

function remember(s: State, steps: Step[]) {
  if (plans.size > 400) plans.clear();
  let t = s;
  for (let i = 0; i < steps.length; i++) {
    plans.set(planKey(t), steps.slice(i));
    t = simStep(t, steps[i]);
  }
}

function lookahead(after: State, p: number): number {
  // средняя оценка после лучшего ответа соперника на каждый из 21 бросков
  const o = 1 - p;
  let sum = 0;
  let tot = 0;
  for (let a = 1; a <= 6; a++)
    for (let b = a; b <= 6; b++) {
      const wgt = a === b ? 1 : 2;
      const t = { ...after, cur: o, phase: 'move' as const, left: a === b ? [a, a, a, a] : [a, b], dice: [a, b] as [number, number], headMoves: 0, stealing: false, queue: [], steal: [] };
      const fins = finals(t as State, 600);
      let worst = Infinity;
      for (const f of fins) worst = Math.min(worst, evaluate(f.state, p, 1));
      if (!fins.length) worst = evaluate(after, p, 1);
      sum += worst * wgt;
      tot += wgt;
    }
  return sum / tot;
}

function planMove(s: State, level: number, rng: Rng): Step | null {
  const legal = legalSteps(s);
  if (!legal.length) return null;
  const cached = plans.get(planKey(s));
  if (cached && legal.some((x) => x.from === cached[0].from && x.die === cached[0].die)) return cached[0];
  const p = s.cur;
  const fins = finals(s);
  let pick: { state: State; steps: Step[] } | null = null;
  if (!fins.length) return legal[rng.int(legal.length)];
  if (level <= 0 && rng.next() < 0.5) pick = fins[rng.int(fins.length)];
  else {
    const noise = level <= 0 ? 6 : level === 1 ? 1.2 : 0.2;
    const scored = fins.map((f) => ({ f, v: evaluate(f.state, p, level) + rng.next() * noise })).sort((a, b) => b.v - a.v);
    pick = scored[0].f;
    // сложный: для коротких нард с контактом — проверка ответа соперника по лучшим кандидатам
    if (level >= 2 && !isLong(s.cfg) && scored.length > 1 && contact(s, p)) {
      let best = -Infinity;
      for (const c of scored.slice(0, 3)) {
        const v = lookahead(c.f.state, p);
        if (v > best) {
          best = v;
          pick = c.f;
        }
      }
    }
  }
  const first = pick!.steps[0];
  if (!first || !legal.some((x) => x.from === first.from && x.die === first.die)) return legal[0];
  remember(s, pick!.steps);
  return first;
}

/** Оценка шансов на победу (0..1) для решений с кубом. */
function winChance(s: State, p: number): number {
  const e = evaluate(s, p, 1);
  return 1 / (1 + Math.exp(-e / 14));
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.phase === 'over') return null;
  if (s.phase === 'opening') return { type: 'opening' };
  if (s.phase === 'cube') {
    if (level <= 0) return { type: 'take' };
    return winChance(s, seat) >= 0.24 ? { type: 'take' } : { type: 'drop' };
  }
  if (s.phase === 'roll') {
    const c = s.cfg;
    if (level >= 1 && c.cube && !s.crawford && s.cube.value < 64 && (s.cube.owner === -1 || s.cube.owner === seat)) {
      const pw = winChance(s, seat);
      // не удваиваем, если и так добираем матч
      const enough = s.score[seat] + s.cube.value >= c.target;
      if (!enough && pw > 0.7 && pw < 0.88) return { type: 'double' };
    }
    return { type: 'roll' };
  }
  const st = planMove(s, level, rng);
  return st && { type: 'move', from: st.from, die: st.die };
}

export { BAR };
