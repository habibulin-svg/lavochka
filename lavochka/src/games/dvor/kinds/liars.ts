/* Задачи на правду и враньё. Без DOM.
 * «Окно» — кто разбил стекло: каждый что-то говорит, известно, сколько сказали правду; найти виновника.
 * «Казаки-разбойники» — казаки всегда говорят правду, разбойники всегда врут; кто есть кто. Перебор всех вариантов. */
import type { Rng } from '../../../core/types';
import { shuffle } from '../../../core/rng';

// ---------------------------------------------------------------- окно

type OSay = { t: 'is' | 'not'; y: number } | { t: 'or'; y: number; z: number } | { t: 'me' | 'notme' };

export interface OknoData {
  names: string[];
  says: string[];
  raw: OSay[];
  /** Сколько сказали правду. */
  truth: number;
}

function oTrue(s: OSay, speaker: number, c: number): boolean {
  switch (s.t) {
    case 'is':
      return c === s.y;
    case 'not':
      return c !== s.y;
    case 'or':
      return c === s.y || c === s.z;
    case 'me':
      return c === speaker;
    case 'notme':
      return c !== speaker;
  }
}

const oTruths = (raw: OSay[], c: number) => raw.reduce((t, s, i) => t + (oTrue(s, i, c) ? 1 : 0), 0);

export function solveOkno(d: OknoData): number {
  return d.names.findIndex((_, c) => oTruths(d.raw, c) === d.truth);
}

function oText(s: OSay, names: string[]): string {
  switch (s.t) {
    case 'is':
      return `Это ${names[s.y]}!`;
    case 'not':
      return `Это не ${names[s.y]}.`;
    case 'or':
      return `Это или ${names[s.y]}, или ${names[s.z]}.`;
    case 'me':
      return 'Ну я это, я…';
    case 'notme':
      return 'Это не я!';
  }
}

/** Уровень: 0 — трое, 1 — четверо, 2 — пятеро. */
export function genOkno(level: number, names0: string[], rng: Rng): { data: OknoData; sol: number } {
  const n = 3 + Math.min(2, level);
  for (let attempt = 0; attempt < 500; attempt++) {
    const names = shuffle(names0, rng).slice(0, n);
    const c = rng.int(n);
    const raw: OSay[] = names.map((_, i) => {
      const others = [...Array(n).keys()].filter((j) => j !== i);
      const y = others[rng.int(others.length)];
      const r = rng.next();
      if (r < 0.25) return { t: 'notme' };
      if (r < 0.3) return { t: 'me' };
      if (r < 0.55) return { t: 'is', y };
      if (r < 0.8) return { t: 'not', y };
      const z = others.filter((j) => j !== y)[rng.int(others.length - 1)];
      return { t: 'or', y: Math.min(y, z), z: Math.max(y, z) };
    });
    const truth = oTruths(raw, c);
    if (names.filter((_, k) => oTruths(raw, k) === truth).length !== 1) continue;
    // совсем очевидное (все сказали правду или «я это» от виновника при truth=n) не берём
    if (truth === n || (truth === 0 && level > 0)) continue;
    return { data: { names, says: raw.map((s) => oText(s, names)), raw, truth }, sol: c };
  }
  throw new Error('окно: не сложилось');
}

// ---------------------------------------------------------------- казаки-разбойники

type KSay =
  | { t: 'liar' | 'honest'; y: number }
  | { t: 'same' | 'diff'; y: number }
  | { t: 'count'; k: number }
  | { t: 'both'; y: number; z: number };

export interface KazakiData {
  names: string[];
  says: string[];
  raw: KSay[];
}

/** mask: бит i = 1 — разбойник (врёт). */
function kTrue(s: KSay, i: number, mask: number, n: number): boolean {
  const L = (j: number) => ((mask >> j) & 1) === 1;
  switch (s.t) {
    case 'liar':
      return L(s.y);
    case 'honest':
      return !L(s.y);
    case 'same':
      return L(s.y) === L(i);
    case 'diff':
      return L(s.y) !== L(i);
    case 'count': {
      let c = 0;
      for (let j = 0; j < n; j++) if (L(j)) c++;
      return c === s.k;
    }
    case 'both':
      return L(s.y) && L(s.z);
  }
}

function kOk(raw: KSay[], mask: number): boolean {
  const n = raw.length;
  return raw.every((s, i) => kTrue(s, i, mask, n) === !((mask >> i) & 1));
}

export function solveKazaki(d: KazakiData): boolean[] {
  const n = d.names.length;
  for (let m = 0; m < 1 << n; m++) if (kOk(d.raw, m)) return d.names.map((_, i) => ((m >> i) & 1) === 1);
  return d.names.map(() => false);
}

function kText(s: KSay, names: string[]): string {
  const num = ['ни одного', 'один', 'двое', 'трое', 'четверо', 'пятеро', 'шестеро'];
  switch (s.t) {
    case 'liar':
      return `${names[s.y]} — разбойник.`;
    case 'honest':
      return `${names[s.y]} — казак.`;
    case 'same':
      return `Мы с ${names[s.y]} из одной шайки.`;
    case 'diff':
      return `Мы с ${names[s.y]} из разных шаек.`;
    case 'count':
      return s.k === 0 ? 'Среди нас нет ни одного разбойника.' : `Среди нас ровно ${num[s.k]} ${s.k === 1 ? 'разбойник' : 'разбойников'}.`;
    case 'both':
      return `${names[s.y]} и ${names[s.z]} — оба разбойники.`;
  }
}

/** Творительный для «мы с …»: дворовые имена на -а/-я → -ой/-ей, на согласную → -ом. */
export function withName(n: string): string {
  if (/[ая]$/.test(n)) return n.replace(/а$/, 'ой').replace(/я$/, 'ей').replace(/([жшчщц])ой$/, '$1ей');
  if (/й$/.test(n)) return n.replace(/й$/, 'ем');
  if (/ь$/.test(n)) return n.replace(/ь$/, 'ем');
  return n + 'ом';
}

/** Уровень: 0 — трое, 1 — четверо, 2 — пятеро. */
export function genKazaki(level: number, names0: string[], rng: Rng): { data: KazakiData; sol: boolean[] } {
  const n = 3 + Math.min(2, level);
  for (let attempt = 0; attempt < 2000; attempt++) {
    const names = shuffle(names0, rng).slice(0, n);
    const mask = rng.int(1 << n);
    const raw: KSay[] = [];
    for (let i = 0; i < n; i++) {
      const lies = ((mask >> i) & 1) === 1;
      // подбираем высказывание нужной истинности
      for (let t = 0; t < 30; t++) {
        const others = [...Array(n).keys()].filter((j) => j !== i);
        const y = others[rng.int(others.length)];
        const r = rng.next();
        let s: KSay;
        if (r < 0.3) s = { t: 'liar', y };
        else if (r < 0.5) s = { t: 'honest', y };
        else if (r < 0.65) s = { t: 'same', y };
        else if (r < 0.8) s = { t: 'diff', y };
        else if (r < 0.9) s = { t: 'count', k: rng.int(n) };
        else {
          const z = others.filter((j) => j !== y)[rng.int(others.length - 1)];
          s = { t: 'both', y: Math.min(y, z), z: Math.max(y, z) };
        }
        if (kTrue(s, i, mask, n) !== lies) {
          raw.push(s);
          break;
        }
      }
      if (raw.length !== i + 1) break;
    }
    if (raw.length !== n) continue;
    let sols = 0;
    for (let m = 0; m < 1 << n; m++) if (kOk(raw, m)) sols++;
    if (sols !== 1) continue;
    const names1 = names;
    const says = raw.map((s) => kText(s, names1).replace(/^Мы с (\S+?) /, (_, nm) => `Мы с ${withName(nm)} `));
    return { data: { names, says, raw }, sol: names.map((_, i) => ((mask >> i) & 1) === 1) };
  }
  throw new Error('казаки: не сложилось');
}
