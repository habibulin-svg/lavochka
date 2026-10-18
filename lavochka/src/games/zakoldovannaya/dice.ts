/* Кубики «Заколдованной страны»: трёхгранный (1 → 0, 2 → 6, 3 → 12) и шестигранный. */
import type { Rng } from '../../core/types';
import type { Qty } from './script';

export interface MainRoll {
  /** Грань трёхгранного (1…3) и шестигранного (1…6). */
  d3: number;
  d6: number;
  /** Очки: (d3 − 1) × 6 + d6 = 1…18. */
  v: number;
}

export const d6 = (rng: Rng) => rng.int(6) + 1;
export const d3 = (rng: Rng) => rng.int(3) + 1;

export function mainRoll(rng: Rng): MainRoll {
  const a = d3(rng);
  const b = d6(rng);
  return { d3: a, d6: b, v: (a - 1) * 6 + b };
}

/** 4d6, худший отбрасывается («два раза по два кубика») — качества и деньги. */
export function fourDropLow(rng: Rng): { dice: number[]; v: number } {
  const dice = [d6(rng), d6(rng), d6(rng), d6(rng)];
  const sorted = [...dice].sort((x, y) => x - y);
  return { dice, v: sorted[1] + sorted[2] + sorted[3] };
}

/** Значение из списка («4-9», «0,5-1-1,5-2», «7-8»): 6 значений — d6 прямо; 18 — основной бросок; 3 — d3; иначе кубик
 * d6 делится на равные доли (7-8: 1–3 → 7, 4–6 → 8), а если значений больше 6 — равновероятно. */
export function pick(list: number[], rng: Rng): { v: number; die: string; face: number } {
  const n = list.length;
  if (!n) return { v: 0, die: '', face: 0 };
  if (n === 6) {
    const f = d6(rng);
    return { v: list[f - 1], die: 'd6', face: f };
  }
  if (n === 18) {
    const m = mainRoll(rng);
    return { v: list[m.v - 1], die: '3d', face: m.v };
  }
  if (n === 3) {
    const f = d3(rng);
    return { v: list[f - 1], die: 'd3', face: f };
  }
  if (n < 6) {
    const f = d6(rng);
    return { v: list[Math.min(n - 1, Math.floor(((f - 1) * n) / 6))], die: 'd6', face: f };
  }
  const i = rng.int(n);
  return { v: list[i], die: `d${n}`, face: i + 1 };
}

/** Количество: число или запись кубика ('1d6', '2d6', '1d3', '3d' — основной бросок, '2d6+3'). */
export function qty(q: Qty | undefined, rng: Rng): number {
  if (q == null) return 0;
  if (typeof q === 'number') return q;
  const s = q.trim();
  if (s.startsWith('-') || s.startsWith('−')) return -qty(s.slice(1), rng);
  if (s === '3d') return mainRoll(rng).v;
  const m = /^(\d*)d(\d+)\s*([+-]\s*\d+)?$/.exec(s);
  if (m) {
    const k = Number(m[1] || 1);
    const f = Number(m[2]);
    let v = 0;
    for (let i = 0; i < k; i++) v += rng.int(f) + 1;
    return v + (m[3] ? Number(m[3].replace(/\s/g, '')) : 0);
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** ОР с половинками: 0,5 и т. п. — храним точно, показываем «7½». */
export function fmtHp(v: number): string {
  const r = Math.round(v * 2) / 2;
  const whole = Math.trunc(r);
  const half = Math.abs(r - whole) > 0.01;
  if (!half) return String(whole);
  if (whole === 0) return r < 0 ? '−½' : '½';
  return `${whole < 0 ? '−' + Math.abs(whole) : whole}½`;
}
