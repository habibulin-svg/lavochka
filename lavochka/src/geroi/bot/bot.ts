/* Боевой ИИ (DESIGN.md §10): перебор действий по копии боя с оценкой позиции. Копия считается со средним уроном и без случайностей (expect):
 * настоящих бросков бот не знает. Лёгкий — один ход вперёд с большим шумом, Средний — один ход точно, Сложный — лучшие варианты разыгрывает на несколько действий вперёд за обе стороны. */
import { Rng } from '../../gops/sim/rng';
import {
  type Action, type BattleState, type Unit, act, aidError, attackCells, canShoot, canTarget, cloneBattle, currentUnit, reachOf, sideValue, spellError, speedOf, unitValue,
} from '../sim/battle';
import { CREATURES } from '../sim/creatures';
import { CELLS, hexDist } from '../sim/hex';
import { SPELLS } from '../sim/spells';

export type BotLevel = 'easy' | 'medium' | 'hard';

/** Куда идти отрядом, который сейчас никого не достаёт: ближе к цели, не больше четырёх вариантов. */
function moveCandidates(s: BattleState, u: Unit, foes: Unit[]): Action[] {
  const r = reachOf(s, u);
  const scored: { cell: number; d: number }[] = [];
  for (let cell = 0; cell < CELLS; cell++) {
    if (r.dist[cell] <= 0) continue;
    let d = 99;
    for (const f of foes) d = Math.min(d, hexDist(cell, f.cell));
    scored.push({ cell, d });
  }
  scored.sort((a, b) => a.d - b.d || a.cell - b.cell);
  return scored.slice(0, 4).map((x) => ({ t: 'move', to: x.cell }));
}

/** Действия, из которых выбирает бот. */
export function candidates(s: BattleState, spells = true): Action[] {
  const u = currentUnit(s);
  if (!u) return [];
  const out: Action[] = [];
  const c = CREATURES[u.cre];
  const foes = s.units.filter((x) => x.side !== u.side && canTarget(x));
  const friends = s.units.filter((x) => x.side === u.side && x.count > 0);
  if (canShoot(s, u)) for (const f of foes) out.push({ t: 'shoot', target: f.id });
  const r = reachOf(s, u);
  for (const f of foes) {
    const cells = attackCells(s, u, f, r);
    if (!cells.length) continue;
    // с места, издалека (разгон) и ближайшая к своим — остальные почти не отличаются
    const near = cells.reduce((a, b) => (r.dist[b] < r.dist[a] ? b : a));
    const far = cells.reduce((a, b) => (r.dist[b] > r.dist[a] ? b : a));
    out.push({ t: 'attack', target: f.id, from: near });
    if (far !== near) out.push({ t: 'attack', target: f.id, from: far });
  }
  if (u.aid > 0) for (const t of s.units) if (t.count > 0 && !aidError(s, u, t.id)) out.push({ t: 'aid', target: t.id });
  if (!out.some((a) => a.t === 'attack' || a.t === 'shoot')) out.push(...moveCandidates(s, u, foes));
  // стрелка, которого держат, стоит хотя бы отвести
  else if (c.shots > 0 && !canShoot(s, u)) out.push(...moveCandidates(s, u, []).slice(0, 2));
  out.push({ t: 'defend' });
  if (!u.waited) out.push({ t: 'wait' });
  if (spells) {
    const h = s.sides[u.side];
    if (!h.cast) {
      const topFoes = [...foes].sort((a, b) => unitValue(b) - unitValue(a)).slice(0, 3);
      const topOwn = [...friends].sort((a, b) => unitValue(b) - unitValue(a)).slice(0, 3);
      for (const id of h.spells) {
        const sp = SPELLS[id];
        const targets = sp.kind === 'heal' || sp.kind === 'buff' ? topOwn : topFoes;
        for (const t of targets) if (!spellError(s, u.side, id, t.cell)) out.push({ t: 'cast', spell: id, cell: t.cell });
      }
    }
  }
  return out;
}

/** Оценка позиции за сторону: разница сил, плюс мелочи, чтобы бот шёл в бой, а стрелки берегли патроны. */
export function evaluate(s: BattleState, side: number): number {
  if (s.over) return s.winner === side ? 1e6 : s.winner === -1 ? 0 : -1e6;
  const mine = sideValue(s, side);
  const theirs = sideValue(s, 1 - side);
  let v = (mine - theirs) * 10;
  for (const u of s.units) {
    if (u.count === 0) continue;
    const c = CREATURES[u.cre];
    const sign = u.side === side ? 1 : -1;
    const val = unitValue(u);
    // эффекты: что лежит на отряде, столько примерно и стоит
    for (const e of u.effects) {
      if (e.k === 'stun') v -= sign * val * 3;
      else if (e.k === 'atk' || e.k === 'def') v += sign * val * e.v * 0.25;
      else if (e.k === 'speed') v += sign * val * e.v * 0.15;
      else if (e.k === 'poison') v -= sign * e.v * 1.5;
    }
    if (u.defending) v += sign * val * 0.1;
    if (c.shots > 0) v += sign * val * (u.shots > 0 ? 1 : 0);
    // сближение: каждому рукопашному лучше быть ближе к цели
    if (u.side === side && c.shots === 0) {
      let d = 99;
      for (const f of s.units) if (f.side !== side && f.count > 0) d = Math.min(d, hexDist(u.cell, f.cell));
      v -= val * 0.2 * Math.trunc((d + speedOf(s, u) - 1) / Math.max(1, speedOf(s, u)));
    }
  }
  return v;
}

function afterAction(s: BattleState, a: Action): BattleState {
  const copy = cloneBattle(s);
  copy.expect = true;
  // чужую ловушку «Подлянки» бот не видит: иначе он обходил бы её, как будто знает
  const side = currentUnit(s)!.side;
  if (copy.trap && copy.trap.owner !== side) copy.trap = undefined;
  act(copy, a);
  return copy;
}

/** Лучшее по оценке действие на один ход вперёд (ядро Среднего и розыгрыша Сложного). */
function greedy(s: BattleState, spells: boolean): Action {
  const side = currentUnit(s)!.side;
  let best: Action = { t: 'defend' };
  let bestScore = -Infinity;
  for (const a of candidates(s, spells)) {
    const score = evaluate(afterAction(s, a), side) - (a.t === 'wait' ? 1 : 0) - (a.t === 'cast' ? SPELLS[a.spell].mana * 0.5 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
  }
  return best;
}

/** Розыгрыш на несколько действий вперёд обеими сторонами. */
function rollout(s: BattleState, side: number): number {
  const copy = cloneBattle(s);
  copy.expect = true;
  for (let i = 0; i < ROLLOUT && !copy.over; i++) act(copy, greedy(copy, false));
  return evaluate(copy, side);
}

/** Сложный: столько лучших вариантов разыгрывает на ROLLOUT действий вперёд. */
const HARD_WIDTH = 6;
const ROLLOUT = 7;

export function botAction(s: BattleState, level: BotLevel): Action {
  const u = currentUnit(s)!;
  const side = u.side;
  if (level === 'medium') return greedy(s, true);
  const noise = new Rng((s.rng ^ 0x5bd1e995) >>> 0);
  const list = candidates(s, level !== 'easy' || noise.below(4) === 0);
  const spread = (sideValue(s, side) + sideValue(s, 1 - side)) * 5;
  const scored = list.map((a) => {
    const after = afterAction(s, a);
    let score = evaluate(after, side) - (a.t === 'wait' ? 1 : 0) - (a.t === 'cast' ? SPELLS[a.spell].mana * 0.5 : 0);
    if (level === 'easy') score += noise.f() * spread;
    return { a, score, after };
  });
  scored.sort((x, y) => y.score - x.score);
  if (level === 'easy') return scored[0].a;
  let best = scored[0];
  let bestScore = -Infinity;
  for (const x of scored.slice(0, HARD_WIDTH)) {
    const score = rollout(x.after, side) - (x.a.t === 'cast' ? SPELLS[x.a.spell].mana * 0.5 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = x;
    }
  }
  return best.a;
}

/** Сыграть бой ботов до конца (прогоны баланса и тесты). */
export function playOut(s: BattleState, levels: [BotLevel, BotLevel]): void {
  for (let i = 0; i < 20000 && !s.over; i++) act(s, botAction(s, levels[currentUnit(s)!.side]));
  if (!s.over) throw new Error('Бой ботов не кончился');
}
