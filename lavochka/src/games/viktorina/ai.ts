/* Викторина — боты трёх уровней. Бот видит только свой view; в нём — `know` (что бот «знает»), а решает он по силе:
 * вероятность верного ответа от трудности вопроса и уровня, время реакции на кнопку, в опросе — с весом по числу ответивших,
 * на барабане — частотные буквы и слово целиком, когда открыто достаточно. Без DOM. */
import type { Rng } from '../../core/types';
import { ALPHABET, FREQ, type Action, type View } from './engine';

/** Вероятность знать ответ: лёгкий 0.75→0.25, средний 0.9→0.45, сложный 0.97→0.7 по трудности 1…5. */
export function pKnow(d: number, level: number): number {
  const [a, b] = [
    [0.75, 0.25],
    [0.9, 0.45],
    [0.97, 0.7],
  ][Math.max(0, Math.min(2, level))];
  const t = (Math.max(1, Math.min(5, d)) - 1) / 4;
  return a + (b - a) * t;
}

/** Реакция на кнопку, мс: лёгкий 1.6–3 с, средний 1–2 с, сложный 0.6–1.3 с. */
export function reaction(level: number, rng: Rng): number {
  const [lo, hi] = [
    [1600, 3000],
    [1000, 2000],
    [600, 1300],
  ][Math.max(0, Math.min(2, level))];
  return Math.round(lo + (hi - lo) * rng.next());
}

/** Время на ответ в тривиа (думает над вариантами), мс. */
function thinkMs(level: number, d: number, rng: Rng): number {
  const base = [3500, 2500, 1600][Math.max(0, Math.min(2, level))];
  return Math.round(base + d * 500 + rng.next() * 3000);
}

const pickOther = (n: number, ok: number | undefined, hidden: number[], rng: Rng) => {
  const c = Array.from({ length: n }, (_, i) => i).filter((i) => i !== ok && !hidden.includes(i));
  return c.length ? c[rng.int(c.length)] : (ok ?? 0);
};

/** Ответ на вопрос с вариантами: знает — верный, нет — наугад из остальных (или вообще наугад, если знания нет). */
function guess(v: View, level: number, rng: Rng, hidden: number[] = []): number {
  const n = v.q?.opts?.length ?? 4;
  const ok = v.know?.ok;
  if (ok == null) {
    const c = Array.from({ length: n }, (_, i) => i).filter((i) => !hidden.includes(i));
    return c[rng.int(c.length)];
  }
  return rng.next() < pKnow(v.q?.d ?? 3, level) ? ok : pickOther(n, ok, hidden, rng);
}

const FILLER = ['не знаю', 'хлеб', 'деньги', 'кошка', 'работа', 'машина', 'дача', 'телевизор', 'вода', 'мама'];

export function choose(v: View, seat: number, level: number, rng: Rng): Action | null {
  switch (v.phase) {
    case 'q': {
      if (v.mode === 'ladder') return ladder(v, level, rng);
      return { type: 'answer', i: guess(v, level, rng), rt: thinkMs(level, v.q?.d ?? 3, rng) };
    }
    case 'buzz': {
      // жмёт, если думает, что знает (с небольшим азартом)
      const d = v.q?.d ?? 3;
      const p = Math.min(1, pKnow(d, level) + 0.12);
      if (v.know?.ok == null && v.know?.ans == null) return rng.next() < 0.4 ? { type: 'buzz', rt: reaction(level, rng) } : { type: 'pass' };
      return rng.next() < p ? { type: 'buzz', rt: reaction(level, rng) } : { type: 'pass' };
    }
    case 'answer': {
      const d = v.q?.d ?? 3;
      const p = Math.min(1, pKnow(d, level) / Math.min(1, pKnow(d, level) + 0.12));
      const right = rng.next() < p;
      if (v.o.input && (v.mode === 'buzz' || v.mode === 'board')) {
        const ans = v.know?.ans;
        return { type: 'say', text: right && ans ? ans : FILLER[rng.int(FILLER.length)] };
      }
      const n = v.q?.opts?.length ?? 4;
      const ok = v.know?.ok;
      return { type: 'pick', i: right && ok != null ? ok : pickOther(n, ok, [], rng) };
    }
    case 'spin':
    case 'letter':
    case 'plus':
    case 'final':
    case 'fword':
      return wheel(v, level, rng);
    case 'say': {
      const pl = v.pl!;
      const rows = v.know?.rows;
      const hit = [0.55, 0.7, 0.85][level] ?? 0.7;
      if (!rows || rng.next() > hit) return { type: 'say', text: FILLER[rng.int(FILLER.length)] };
      const free = rows.map((r, i) => ({ r, i })).filter((x) => !pl.rows[x.i]);
      if (!free.length) return { type: 'say', text: FILLER[rng.int(FILLER.length)] };
      // сложный чаще называет верхние (или нижние — в обратной игре)
      const pow = [0.6, 1, 1.8][level] ?? 1;
      const w = free.map((x) => Math.pow(pl.reverse ? 101 - x.r[1] : x.r[1], pow));
      let t = rng.next() * w.reduce((a, b) => a + b, 0);
      for (let k = 0; k < free.length; k++) {
        t -= w[k];
        if (t <= 0) return { type: 'say', text: free[k].r[0] };
      }
      return { type: 'say', text: free[free.length - 1].r[0] };
    }
    case 'pick': {
      const bd = v.bd!;
      const cells: [number, number][] = [];
      bd.themes.forEach((_, th) => {
        for (let k = 0; k < 5; k++) if (!bd.used[th * 5 + k]) cells.push([th, k]);
      });
      if (!cells.length) return null;
      // слабый — что попало, сильный — по порядку сверху вниз, начиная с дешёвых
      const c = level >= 2 ? cells.sort((a, b) => a[1] - b[1])[0] : cells[rng.int(cells.length)];
      return { type: 'cell', th: c[0], k: c[1] };
    }
  }
  return null;
}

function ladder(v: View, level: number, rng: Rng): Action {
  const ld = v.ld!;
  const d = v.q?.d ?? 3;
  const ok = v.know?.ok;
  const knows = ok != null && rng.next() < pKnow(d, level);
  if (knows) return { type: 'answer', i: ok! };
  if (ld.call) return { type: 'answer', i: ld.call.i };
  if (ld.hall) {
    const best = ld.hall.indexOf(Math.max(...ld.hall));
    if (ld.hall[best] >= 45 || level === 0) return { type: 'answer', i: best };
  }
  if (ld.life.fifty && ld.hidden.length === 0) return { type: 'life', k: 'fifty' };
  if (ld.life.hall && !ld.hall) return { type: 'life', k: 'hall' };
  if (ld.life.call && !ld.call) return { type: 'life', k: 'call' };
  // подсказок нет: забрать деньги, если терять много (средний и сложный)
  const won = ld.won[ld.seat] ?? 0;
  if (level >= 1 && ld.step >= 5 && won >= 8000 && rng.next() < 0.7) return { type: 'take' };
  const vis = [0, 1, 2, 3].filter((i) => !ld.hidden.includes(i));
  return { type: 'answer', i: vis[rng.int(vis.length)] };
}

function wheel(v: View, level: number, rng: Rng): Action {
  const wh = v.wh!;
  const word = v.know?.word;
  const open = wh.mask.filter(Boolean).length / Math.max(1, wh.mask.length);
  const thr = [0.8, 0.7, 0.6][level] ?? 0.7;
  const named = new Set(wh.named);
  const letterPick = (): string => {
    // сильнее бот — чаще «чувствует» букву слова
    const feel = [0.12, 0.3, 0.5][level] ?? 0.3;
    if (word && rng.next() < feel) {
      const c = [...word].filter((l, i) => !wh.mask[i] && !named.has(l));
      if (c.length) return c[rng.int(c.length)];
    }
    const freq = [...FREQ].filter((l) => !named.has(l) && l !== 'Ъ');
    if (freq.length) return level === 0 ? freq[Math.min(freq.length - 1, rng.int(8))] : freq[0];
    return [...ALPHABET].find((l) => !named.has(l)) ?? 'А';
  };
  switch (v.phase) {
    case 'spin':
      if (word && open >= thr) return { type: 'word', w: word };
      return { type: 'spin', f: 0.35 + rng.next() * 0.6 };
    case 'letter':
      if (word && open >= thr) return { type: 'word', w: word };
      return { type: 'letter', l: letterPick() };
    case 'plus': {
      const c = wh.mask.map((x, i) => (x ? -1 : i)).filter((i) => i >= 0);
      return { type: 'plus', pos: c[rng.int(c.length)] };
    }
    case 'final':
      return { type: 'letter', l: letterPick() };
    case 'fword': {
      const p = [0.35, 0.55, 0.75][level] ?? 0.5;
      return { type: 'word', w: word && rng.next() < p ? word : 'КОЛОБОК' };
    }
  }
  return { type: 'spin', f: 0.5 };
}
