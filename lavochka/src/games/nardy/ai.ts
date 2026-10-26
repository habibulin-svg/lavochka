/* Нарды — боты: перебор всех вариантов хода целиком и оценка позиции. */
import type { Rng } from '../../core/types';
import { absOf, BAR, boardKey, boardSize, checkersOf, diceCount, finals, homeStart, idxTable, isLong, isRoman, isShortGeo, legalSteps, own, pipCount, simStep, waiting, type Action, type State, type Step } from './engine';

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

/** Вероятность попасть ровно на расстояние d одной костью или суммой нескольких (для трёх костей, без удвоения дублей). */
let SHOTS3: number[] | null = null;
function shots3(): number[] {
  if (SHOTS3) return SHOTS3;
  const r = new Array(19).fill(0);
  for (let a = 1; a <= 6; a++)
    for (let b = 1; b <= 6; b++)
      for (let c = 1; c <= 6; c++) for (const d of new Set([a, b, c, a + b, a + c, b + c, a + b + c])) r[d]++;
  return (SHOTS3 = r.map((x) => x / 216));
}
const shotP = (s: State, d: number) => (diceCount(s.cfg) > 2 ? (shots3()[d] ?? 0) : (SHOTS[d] ?? 0) / 36);

/** Индексы пути игрока o для шашек игрока p (и -1 за каждую шашку, ждущую входа). */
function posIn(s: State, p: number, o: number): number[] {
  const t = idxTable(s.cfg)[o];
  const out: number[] = [];
  if (waiting(s, p)) out.push(-1);
  for (let i = 0; i < boardSize(s.cfg); i++) if (own(s, p, i)) out.push(t[absOf(s.cfg, p, i)]);
  return out;
}

/** Может ли ещё кто-то кого-то побить: какая-то шашка соперника позади моей на его пути (или наоборот). */
function contact(s: State, p: number): boolean {
  if (isLong(s.cfg)) return true;
  const o = 1 - p;
  const reach = (a: number, b: number) => {
    const back = Math.min(...posIn(s, a, a));
    return posIn(s, b, a).some((j) => j > back);
  };
  return reach(o, p) || reach(p, o);
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
  // короткие и римские
  const size = boardSize(s.cfg);
  const hs = homeStart(s.cfg);
  let run = 0;
  for (let i = 0; i < size; i++) {
    const n = own(s, p, i);
    if (n >= 2) {
      run++;
      if (i >= hs) v += w.home;
      if (i <= 5) v += 1; // якорь в доме соперника
    } else {
      if (run > 1) v += run * run * w.prime;
      run = 0;
    }
  }
  if (run > 1) v += run * run * w.prime;
  v -= s.bar[p] * w.bar;
  if (s.bar[o]) {
    // сколько входных пунктов соперника я закрыл
    let closed = 0;
    for (let j = 0; j < 6; j++) if (s.pts[absOf(s.cfg, o, j)] * (p === 0 ? 1 : -1) >= 2) closed++;
    v += s.bar[o] * closed * 1.5;
  }
  // одиночные шашки под боем
  if (contact(s, p)) {
    const foes = posIn(s, o, o);
    const t = idxTable(s.cfg)[o];
    const scale = 24 / size;
    for (let i = 0; i < size; i++) {
      if (own(s, p, i) !== 1) continue;
      const at = t[absOf(s.cfg, p, i)];
      let miss = 1;
      const ds = new Set<number>();
      for (const k of foes) if (at > k) ds.add(at - k);
      for (const d of ds) miss *= 1 - shotP(s, d);
      v -= (1 - miss) * (w.blot + i * 0.35 * scale);
    }
  }
  return v;
}

function idxOfAbs(s: State, o: number, j: number): number {
  // абсолютный пункт индекса j пути соперника
  if (o === 0) return (12 + j) % 24;
  return isShortGeo(s.cfg) ? (35 - j) % 24 : j;
}

export function evaluate(s: State, p: number, level: number): number {
  const w = WEIGHTS[Math.min(level, 2)];
  const o = 1 - p;
  const pips = pipCount(s, o) - pipCount(s, p);
  if (s.off[p] === checkersOf(s.cfg)) return 1000;
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
    if (level >= 2 && !isLong(s.cfg) && !isRoman(s.cfg) && scored.length > 1 && contact(s, p)) {
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
