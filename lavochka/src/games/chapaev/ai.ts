/* Чапаев и карром — боты: перебирают удары и прогоняют каждый через ту же физику, что и игра (с домами, лунками, льдом,
 * песком и текущим ветром — всё это в shoot), поэтому учатся всем вариантам сразу.
 *   Лёгкий — бьёт ближайшей шашкой в одну из ближних чужих, силу берёт «на глаз», рука дрожит сильно;
 *   Средний — выбирает лучший удар из нескольких целей и двух сил, рука дрожит немного;
 *   Сложный — перебирает все свои шашки и цели, поправки прицела, три силы и веер направлений (рикошеты от домов),
 *     а лучшие удары проверяет ещё и с дрожью руки (сильный щелчок уходит в сторону) — выбирает надёжный, а не «если повезёт».
 * Оценка: выбитые чужие — плюс, свои — минус, короли — во много раз дороже, ударная осталась на доске — плюс
 * (в карроме — забитые свои, королева, без штрафа). */
import type { Rng } from '../../core/types';
import { CH_FIELD, CH_MAX, CH_POW, CH_R, CR, shoot, spread, type Action, type State } from './engine';

const JITTER = [0.05, 0.02, 0.005];
type Shot = Extract<Action, { type: 'shot' }>;

function evalChapaev(s: State, a: Shot): number {
  const r = shoot(s, a);
  if (!r) return -999;
  const me = s.turn;
  let v = 0;
  for (const d of r.discs) {
    if (!d.gone) continue;
    const p = s.pieces.find((q) => q.id === d.id)!;
    const w = p.k ? 60 : p.t ? 1.3 : 1;
    v += p.o === me ? -12 * w : 10 * w;
  }
  const striker = r.discs.find((d) => d.id === a.id)!;
  if (!striker.gone) {
    v += 2;
    // не оставлять ударную у самого края
    const edge = Math.min(striker.x, striker.y, 8 - striker.x, 8 - striker.y);
    if (edge < 0.6) v -= 1.5;
  }
  if (s.cfg.king) {
    // свой король у края или рядом с чужими — под ударом
    const k = r.discs.find((d) => !d.gone && s.pieces.find((q) => q.id === d.id)?.k && s.pieces.find((q) => q.id === d.id)!.o === me);
    if (k) {
      const edge = Math.min(k.x, k.y, 8 - k.x, 8 - k.y);
      if (edge < 0.7) v -= 1;
    }
  }
  return v;
}

/** Сила, чтобы шашка дошла до цели на расстоянии dist и ударила со скоростью u. */
function powerFor(dist: number, u: number): number {
  const f = CH_FIELD.friction;
  const v0 = Math.sqrt(u * u + 2 * f * Math.max(0, dist - 2 * CH_R));
  return Math.max(0.12, Math.min(1, v0 / CH_MAX));
}

function chapaev(s: State, level: number, rng: Rng): Action {
  const me = s.turn;
  const mine = s.pieces.filter((p) => p.o === me);
  const theirs = s.pieces.filter((p) => p.o !== me);
  const cands: Shot[] = [];
  const d2 = (a: { x: number; y: number }, b: { x: number; y: number }) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
  const offs = level === 2 ? [-0.04, 0, 0.04] : [0];
  const speeds = level === 2 ? [2.6, 3.8, 5.2] : level === 1 ? [3, 4.6] : [3.6 + rng.next() * 2];
  // лёгкий — одна-две своих шашки, ближайших к чужим
  const shooters =
    level === 0
      ? mine
          .slice()
          .sort((a, b) => Math.min(...theirs.map((t) => d2(a, t))) - Math.min(...theirs.map((t) => d2(b, t))))
          .slice(0, 2)
      : mine;
  for (const m of shooters) {
    let targets = theirs
      .slice()
      .sort((a, b) => d2(a, m) - d2(b, m))
      .slice(0, level === 2 ? 8 : level === 1 ? 3 : 2);
    const king = theirs.find((t) => t.k);
    if (king && !targets.includes(king)) targets = [...targets, king];
    for (const t of targets) {
      const base = Math.atan2(t.y - m.y, t.x - m.x);
      const dist = Math.sqrt(d2(t, m));
      const k = t.t ? 1.5 : 1;
      for (const o of offs) for (const u of speeds) cands.push({ type: 'shot', id: m.id, angle: base + o, power: powerFor(dist, u * k) });
    }
    // сложный: веер направлений — рикошеты от домов, снос ветром
    if (level === 2 && (s.cfg.houses || s.cfg.wind || s.cfg.terrain))
      for (let k = 0; k < 16; k++) for (const p of [0.55, 0.8, 1]) cands.push({ type: 'shot', id: m.id, angle: (Math.PI / 8) * k + 0.1, power: p });
  }
  let best = cands[rng.int(cands.length)];
  if (level > 0) {
    const scored = cands.map((c) => ({ c, v: evalChapaev(s, c) + rng.next() * 0.01 }));
    scored.sort((a, b) => b.v - a.v);
    best = scored[0].c;
    if (level === 2) {
      // лучшие — ещё и с дрожью руки: сильный щелчок уходит в сторону, надёжнее тот, что бьёт при любом разбросе
      let bv = -Infinity;
      for (const { c, v } of scored.slice(0, 8)) {
        const sp = spread(c.power) * 0.5;
        const pw = CH_POW * c.power * 0.5;
        const vs = [v];
        for (const [da, dp] of [
          [-sp, 0],
          [sp, 0],
          [0, -pw],
          [0, pw],
        ])
          vs.push(evalChapaev(s, { ...c, angle: c.angle + da, power: Math.min(1, c.power * (1 + dp)) }));
        const avg = vs.reduce((x, y) => x + y, 0) / vs.length;
        if (avg > bv) (bv = avg), (best = c);
      }
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
