/* Чапаев и карром — боты: перебирают удары и прогоняют каждый через ту же физику, что и игра.
 *   Лёгкий — целится в случайную чужую шашку, рука дрожит сильно;
 *   Средний — выбирает лучший удар из части вариантов, рука дрожит немного;
 *   Сложный — перебирает все свои шашки, цели, поправки прицела и силу, рука почти не дрожит.
 * Оценка: выбитые чужие — плюс, свои — минус, ударная осталась на доске — плюс (в карроме — забитые свои, королева, без штрафа). */
import type { Rng } from '../../core/types';
import { CR, shoot, type Action, type State } from './engine';

const JITTER = [0.12, 0.035, 0.01];

function evalChapaev(s: State, a: Extract<Action, { type: 'shot' }>): number {
  const r = shoot(s, a);
  if (!r) return -999;
  const me = s.turn;
  let v = 0;
  for (const d of r.discs) {
    if (!d.gone) continue;
    const p = s.pieces.find((q) => q.id === d.id)!;
    v += p.o === me ? -12 : 10;
  }
  const striker = r.discs.find((d) => d.id === a.id)!;
  if (!striker.gone) {
    v += 2;
    // не оставлять ударную у самого края
    const edge = Math.min(striker.x, striker.y, 8 - striker.x, 8 - striker.y);
    if (edge < 0.6) v -= 1.5;
  }
  return v;
}

function chapaev(s: State, level: number, rng: Rng): Action {
  const me = s.turn;
  const mine = s.pieces.filter((p) => p.o === me);
  const theirs = s.pieces.filter((p) => p.o !== me);
  const cands: Extract<Action, { type: 'shot' }>[] = [];
  const offs = level === 2 ? [-0.05, 0, 0.05] : [0];
  const powers = level === 2 ? [0.45, 0.7, 0.95] : [0.6, 0.9];
  for (const m of mine) {
    // средний — только две ближайшие цели
    const targets = theirs
      .slice()
      .sort((a, b) => (a.x - m.x) ** 2 + (a.y - m.y) ** 2 - ((b.x - m.x) ** 2 + (b.y - m.y) ** 2))
      .slice(0, level === 2 ? 8 : 2);
    for (const t of targets) {
      const base = Math.atan2(t.y - m.y, t.x - m.x);
      for (const o of offs) for (const p of powers) cands.push({ type: 'shot', id: m.id, angle: base + o, power: p });
    }
  }
  let best = cands[rng.int(cands.length)];
  if (level > 0) {
    let bv = -Infinity;
    for (const c of cands) {
      const v = evalChapaev(s, c) + rng.next() * 0.01;
      if (v > bv) (bv = v), (best = c);
    }
  }
  return { ...best, angle: best.angle + (rng.next() - 0.5) * 2 * JITTER[level] };
}

function evalCarrom(s: State, a: Extract<Action, { type: 'strike' }>): number {
  const r = shoot(s, a);
  if (!r) return -999;
  const me = s.turn;
  let v = 0;
  for (const d of r.discs) {
    if (!d.gone) continue;
    if (d.id === 99) {
      v -= 12;
      continue;
    }
    const p = s.pieces.find((q) => q.id === d.id)!;
    v += p.o === me ? 10 : p.o === 2 ? 6 : -6;
  }
  if (r.first < 0) v -= 1;
  return v;
}

function carrom(s: State, level: number, rng: Rng): Action {
  const me = s.turn;
  const by = me === 0 ? CR.base : CR.size - CR.base;
  const toBoard = (x: number) => (me === 0 ? x : CR.size - x);
  const targets = s.pieces.filter((p) => p.o === me || p.o === 2);
  const pockets = [
    [0.27, 0.27],
    [CR.size - 0.27, 0.27],
    [0.27, CR.size - 0.27],
    [CR.size - 0.27, CR.size - 0.27],
  ];
  const xs = level === 2 ? [1.8, 2.5, 3.2, 4, 4.8, 5.5, 6.2] : level === 1 ? [2.2, 4, 5.8] : [4];
  const cands: Extract<Action, { type: 'strike' }>[] = [];
  for (const x of xs) {
    const sx = toBoard(x);
    for (const t of targets)
      for (const [px, py] of pockets) {
        const dx = px - t.x;
        const dy = py - t.y;
        const L = Math.sqrt(dx * dx + dy * dy) || 1;
        // точка, куда должен прийти биток, чтобы толкнуть фишку в лузу
        const gx = t.x - (dx / L) * (CR.coin + CR.striker);
        const gy = t.y - (dy / L) * (CR.coin + CR.striker);
        const ang = Math.atan2(gy - by, gx - sx);
        // удар должен идти от битка к фишке, а фишка — от битка к лузе (тупой угол — не резать назад)
        const cut = Math.cos(ang - Math.atan2(dy, dx));
        if (cut < 0.2) continue;
        for (const p of level === 2 ? [0.45, 0.7] : [0.6]) cands.push({ type: 'strike', x, angle: ang, power: p });
      }
  }
  if (!cands.length) {
    // прямо в кучу
    const x = 4;
    cands.push({ type: 'strike', x, angle: Math.atan2(CR.size / 2 - by, CR.size / 2 - toBoard(x)), power: 0.7 });
  }
  let best = cands[rng.int(cands.length)];
  if (level > 0) {
    let bv = -Infinity;
    const pool = level === 1 ? cands.filter((_, i) => i % 2 === 0 || cands.length < 30) : cands;
    for (const c of pool) {
      const v = evalCarrom(s, c) + rng.next() * 0.01;
      if (v > bv) (bv = v), (best = c);
    }
  }
  // биток на фишке нельзя — сдвинуть
  for (let k = 0; k < 20 && !shoot(s, best); k++) best = { ...best, x: Math.min(CR.baseTo, Math.max(CR.baseFrom, best.x + (k % 2 ? 1 : -1) * 0.15 * (k + 1))) };
  return { ...best, angle: best.angle + (rng.next() - 0.5) * 2 * JITTER[level] * 0.6 };
}

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.over || s.turn !== seat) return null;
  return s.cfg.mode === 'carrom' ? carrom(s, level, rng) : chapaev(s, level, rng);
}
