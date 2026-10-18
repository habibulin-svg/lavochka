/* Фантики: устный счёт цепочкой. У героя было сколько-то фантиков; дальше — выиграл, проиграл, поменялся,
 * отдал половину… Сколько стало? Все промежуточные числа — целые, от 1 до 200. Сказуемые — в настоящем времени
 * (без рода). Без DOM. */
import type { Rng } from '../../../core/types';

type Step = { op: '+' | '-' | '*' | '/'; v: number; text: string };

export interface ChainData {
  hero: string;
  start: number;
  steps: Step[];
  ask: string;
}

export const run = (d: ChainData, upto = d.steps.length) =>
  d.steps.slice(0, upto).reduce((x, s) => (s.op === '+' ? x + s.v : s.op === '-' ? x - s.v : s.op === '*' ? x * s.v : x / s.v), d.start);

export const solveChain = (d: ChainData) => run(d);

export function fant(n: number): string {
  const a = n % 10;
  const b = n % 100;
  const w = b >= 11 && b <= 14 ? 'фантиков' : a === 1 ? 'фантик' : a >= 2 && a <= 4 ? 'фантика' : 'фантиков';
  return `${n} ${w}`;
}

/** Родительный (у кого) и дательный (кому) падежи дворовых имён; для чужих имён — как есть. */
const CASES: Record<string, [string, string]> = {
  Вовка: ['Вовки', 'Вовке'],
  Ленка: ['Ленки', 'Ленке'],
  Серёга: ['Серёги', 'Серёге'],
  Танька: ['Таньки', 'Таньке'],
  Димка: ['Димки', 'Димке'],
  Оля: ['Оли', 'Оле'],
  Жека: ['Жеки', 'Жеке'],
  Светка: ['Светки', 'Светке'],
  Колян: ['Коляна', 'Коляну'],
  Маринка: ['Маринки', 'Маринке'],
};
export const gen = (n: string) => CASES[n]?.[0] ?? n;
export const dat = (n: string) => CASES[n]?.[1] ?? n;

const pick = <T>(xs: T[], rng: Rng) => xs[rng.int(xs.length)];

function stepOf(x: number, level: number, o: string, rng: Rng): Step | null {
  const r = rng.next();
  const top = level === 0 ? 9 : 18;
  if (r < 0.28) {
    const v = 2 + rng.int(top);
    return { op: '+', v, text: pick([`Выигрывает у ${gen(o)} ещё ${fant(v)}.`, `${o} отдаёт долг — ${fant(v)}.`, `Находит за гаражами пачку, а в ней ${fant(v)}.`], rng) };
  }
  if (r < 0.52) {
    if (x < 4) return null;
    const v = 2 + rng.int(Math.min(top, x - 3));
    return { op: '-', v, text: pick([`Проигрывает ${dat(o)} ${fant(v)}.`, `Меняет ${fant(v)} на жвачку «Турбо».`, `Отдаёт ${dat(o)} ${fant(v)} за вкладыш.`], rng) };
  }
  if (r < 0.7) {
    if (x % 2) return null;
    return { op: '/', v: 2, text: pick([`Половину отдаёт младшему брату.`, `Половину проигрывает ${dat(o)} одним шлепком.`, `Мама стирает куртку — половина фантиков из кармана размокает.`], rng) };
  }
  if (r < 0.82) {
    if (level === 0 || x % 3) return null;
    return { op: '/', v: 3, text: pick([`Треть отдаёт ${dat(o)} — старый должок.`, `Старшие пацаны забирают две трети, остаётся треть.`], rng) };
  }
  if (x > (level === 2 ? 60 : 40)) return null;
  const v = level === 2 && rng.next() < 0.4 ? 3 : 2;
  return { op: '*', v, text: v === 2 ? pick([`Играет «на все» с ${o === 'Колян' ? 'Коляном' : 'соседом'} — и выигрывает: фантиков становится вдвое больше.`, `Выменивает каждый фантик на два.`], rng) : `Выигрывает «втройне» — фантиков становится втрое больше.` };
}

/** Уровень: 0 — 4 шага, 1 — 6, 2 — 8 (с третями и «втройне»). */
export function genChain(level: number, names: string[], rng: Rng): { data: ChainData; sol: number } {
  const len = [4, 6, 8][level] ?? 6;
  for (let attempt = 0; attempt < 500; attempt++) {
    const hero = names[rng.int(names.length)];
    const others = names.filter((n) => n !== hero);
    const start = [6, 12, 18][level] + rng.int(level === 0 ? 20 : 30);
    const steps: Step[] = [];
    let x = start;
    let tries = 0;
    while (steps.length < len && tries++ < 300) {
      const s = stepOf(x, level, others[rng.int(others.length)], rng);
      if (!s) continue;
      const nx = s.op === '+' ? x + s.v : s.op === '-' ? x - s.v : s.op === '*' ? x * s.v : x / s.v;
      if (!Number.isInteger(nx) || nx < 1 || nx > 200) continue;
      // одно и то же «вдвое/половину» подряд — скучно
      const prev = steps[steps.length - 1];
      if (prev && (s.op === '*' || s.op === '/') && prev.op === s.op) continue;
      if (steps.some((q) => q.text === s.text)) continue;
      steps.push(s);
      x = nx;
    }
    if (steps.length < len) continue;
    // на средней — хоть одно «вдвое/половина», на трудной — два
    if (steps.filter((q) => q.op === '*' || q.op === '/').length < level) continue;
    return { data: { hero, start, steps, ask: `Сколько фантиков теперь у ${gen(hero)}?` }, sol: x };
  }
  throw new Error('фантики: не сложилось');
}
