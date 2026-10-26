/* Окей и руммикуб — фишки и комбинации (без DOM). Фишка: цвет 0…3 (красный, жёлтый, синий, чёрный), номер 1…13, копия 0/1;
 * n = 0 — джокер (в руммикубе) или ложный окей (в окее он стоит за саму фишку-окей). */

export interface Tile {
  c: number;
  n: number;
  k: number;
}

export const COLORS = ['красный', 'жёлтый', 'синий', 'чёрный'];
export const tileId = (t: Tile) => `${t.c}.${t.n}.${t.k}`;
export const sameTile = (a: Tile, b: Tile) => a.c === b.c && a.n === b.n && a.k === b.k;

export function fullSet(): Tile[] {
  const out: Tile[] = [];
  for (let k = 0; k < 2; k++) for (let c = 0; c < 4; c++) for (let n = 1; n <= 13; n++) out.push({ c, n, k });
  out.push({ c: 0, n: 0, k: 0 }, { c: 3, n: 0, k: 1 });
  return out;
}

/** Как играет фишка: wild — джокер (любая), иначе — цвет и номер. */
export interface Face {
  wild: boolean;
  c: number;
  n: number;
}

export interface MeldRules {
  /** Ряд 12-13-1 разрешён (окей). */
  wrap13: boolean;
}

/** Проверка комбинации: группа (3–4 одного номера разных цветов) или ряд (3+ подряд одного цвета). */
export function validGroup(fs: Face[], rules: MeldRules): 'set' | 'run' | null {
  if (fs.length < 3) return null;
  const nat = fs.filter((f) => !f.wild);
  if (!nat.length) return fs.length <= 13 ? 'run' : null;
  // группа
  if (fs.length <= 4 && nat.every((f) => f.n === nat[0].n) && new Set(nat.map((f) => f.c)).size === nat.length) return 'set';
  // ряд: одного цвета, номера различны, укладываются в окно длины fs.length
  if (!nat.every((f) => f.c === nat[0].c)) return null;
  const ns = nat.map((f) => f.n);
  if (new Set(ns).size !== ns.length) return null;
  const L = fs.length;
  // есть ли начало окна длины L (в пределах 1…top), куда попадают все номера
  const fits = (vals: number[], top: number) => {
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    return Math.max(1, hi - L + 1) <= Math.min(lo, top - L + 1);
  };
  if (fits(ns, 13)) return 'run';
  // 12-13-1: единица как 14 (но не 13-1-2)
  if (rules.wrap13 && ns.includes(1) && fits(ns.map((n) => (n === 1 ? 14 : n)), 14)) return 'run';
  return null;
}

/** Ряд: номера по порядку (для раскладки по порядку на столе); джокеры — на пропуски и края. */
export function orderGroup(ts: Tile[], face: (t: Tile) => Face, rules: MeldRules): Tile[] {
  const fs = ts.map(face);
  const kind = validGroup(fs, rules);
  if (kind !== 'run') return ts.slice().sort((a, b) => face(a).c - face(b).c);
  const nat = ts.filter((t) => !face(t).wild);
  const wild = ts.filter((t) => face(t).wild);
  // 12-13-1: единица как 14, если без этого ряд не складывается
  const plainOk = (() => {
    const ns = nat.map((t) => face(t).n);
    return Math.max(1, Math.max(...ns) - ts.length + 1) <= Math.min(Math.min(...ns), 13 - ts.length + 1);
  })();
  const hi13 = !plainOk && rules.wrap13;
  const top = hi13 ? 14 : 13;
  const num = (t: Tile) => (hi13 && face(t).n === 1 ? 14 : face(t).n);
  const ns = nat.map(num);
  const L = ts.length;
  // начало ряда: лишние джокеры — в конец (если упёрлись в верх — в начало)
  const start = Math.min(Math.min(...ns), top - L + 1);
  const byN = new Map(nat.map((t) => [num(t), t]));
  const out: Tile[] = [];
  let w = 0;
  for (let n = start; out.length < L; n++) out.push(byN.get(n) ?? wild[w++]);
  return out;
}

/** Очки фишки (для первой выкладки руммикуба и штрафа): номер; джокер — по месту в комбинации или 30 на руке. */
export function groupValue(ts: Tile[], face: (t: Tile) => Face, rules: MeldRules): number {
  const ordered = orderGroup(ts, face, rules);
  const fs = ordered.map(face);
  const kind = validGroup(fs, rules);
  if (kind === 'set') {
    const n = fs.find((f) => !f.wild)!.n;
    return n * ts.length;
  }
  const nat = fs.findIndex((f) => !f.wild);
  if (nat < 0) return 0;
  const base = fs[nat].n - nat;
  let sum = 0;
  for (let i = 0; i < fs.length; i++) sum += Math.min(13, base + i);
  return sum;
}

/** Разложить фишки на комбинации целиком (поиск с возвратом, с пределом). null — нельзя. */
export function partition(ts: Tile[], face: (t: Tile) => Face, rules: MeldRules, limit = 60000): Tile[][] | null {
  if (!ts.length) return [];
  const fs = new Map(ts.map((t) => [t, face(t)]));
  const wild = ts.filter((t) => fs.get(t)!.wild);
  const nat = ts.filter((t) => !fs.get(t)!.wild).sort((a, b) => fs.get(a)!.n - fs.get(b)!.n || fs.get(a)!.c - fs.get(b)!.c);
  let nodes = 0;
  const rec = (rest: Tile[], wl: Tile[], acc: Tile[][]): Tile[][] | null => {
    if (++nodes > limit) return null;
    if (!rest.length) {
      if (!wl.length) return acc;
      // лишние джокеры — дописать к любой комбинации, где они уместны
      for (let i = 0; i < acc.length; i++) {
        const g = [...acc[i], wl[0]];
        if (validGroup(g.map((t) => fs.get(t)!), rules)) {
          const next = acc.slice();
          next[i] = g;
          const r = rec(rest, wl.slice(1), next);
          if (r) return r;
        }
      }
      return wl.length >= 3 ? [...acc, wl] : null;
    }
    const first = rest[0];
    const f = fs.get(first)!;
    const others = rest.slice(1);
    const cands: Tile[][] = [];
    // группы с первой фишкой
    const sameN = others.filter((t) => fs.get(t)!.n === f.n && fs.get(t)!.c !== f.c);
    const uniqC = (arr: Tile[]) => arr.filter((t, i) => arr.findIndex((u) => fs.get(u)!.c === fs.get(t)!.c) === i);
    const sn = uniqC(sameN);
    for (let m = 0; m < 1 << sn.length; m++) {
      const pick = sn.filter((_, i) => m & (1 << i));
      for (let j = 0; j <= Math.min(wl.length, 2); j++) {
        const g = [first, ...pick, ...wl.slice(0, j)];
        if (g.length >= 3 && g.length <= 4 && validGroup(g.map((t) => fs.get(t)!), rules) === 'set') cands.push(g);
      }
    }
    // ряды с первой фишкой как самой младшей
    const tryRun = (startN: number, seq: Tile[], used: number) => {
      for (let n = startN; n <= (rules.wrap13 ? 14 : 13); n++) {
        const want = n === 14 ? 1 : n;
        const t = others.find((x) => fs.get(x)!.c === f.c && fs.get(x)!.n === want && !seq.includes(x));
        if (t) seq = [...seq, t];
        else if (used < wl.length) seq = [...seq, wl[used++]];
        else break;
        if (seq.length >= 3 && validGroup(seq.map((x) => fs.get(x)!), rules) === 'run') cands.push(seq.slice());
      }
    };
    tryRun(f.n + 1, [first], 0);
    // джокер перед первой
    if (wl.length) tryRun(f.n + 1, [wl[0], first], 1);
    // самые длинные — первыми
    cands.sort((a, b) => b.length - a.length);
    for (const g of cands) {
      const left = rest.filter((t) => !g.includes(t));
      const wl2 = wl.filter((t) => !g.includes(t));
      const r = rec(left, wl2, [...acc, g]);
      if (r) return r;
    }
    return null;
  };
  return rec(nat, wild, []);
}

/** Семь пар (окей): 14 фишек — семь пар одинаковых (джокер — пара к любой). */
export function sevenPairs(ts: Tile[], face: (t: Tile) => Face): boolean {
  if (ts.length !== 14) return false;
  const wild = ts.filter((t) => face(t).wild).length;
  const counts = new Map<string, number>();
  for (const t of ts) {
    const f = face(t);
    if (f.wild) continue;
    const k = `${f.c}.${f.n}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  let single = 0;
  for (const v of counts.values()) single += v % 2;
  return single <= wild && (wild - single) % 2 === 0;
}

/** Разбить фишки на пары одинаковых (джокер — пара к любой); null — не разбиваются. «Окей 101»: открытие пятью парами. */
export function pairsOf(ts: Tile[], face: (t: Tile) => Face): Tile[][] | null {
  if (ts.length % 2) return null;
  const wild = ts.filter((t) => face(t).wild);
  const by = new Map<string, Tile[]>();
  for (const t of ts) {
    const f = face(t);
    if (f.wild) continue;
    const k = `${f.c}.${f.n}`;
    by.set(k, [...(by.get(k) ?? []), t]);
  }
  const out: Tile[][] = [];
  const w = wild.slice();
  for (const list of by.values()) {
    for (let i = 0; i + 1 < list.length; i += 2) out.push([list[i], list[i + 1]]);
    if (list.length % 2) {
      const j = w.pop();
      if (!j) return null;
      out.push([list[list.length - 1], j]);
    }
  }
  for (let i = 0; i + 1 < w.length; i += 2) out.push([w[i], w[i + 1]]);
  return out;
}
