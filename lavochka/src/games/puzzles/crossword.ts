/* Кроссворд — генератор раскладки без DOM. «Наш» газетный кроссворд: слова пересекаются, между словами пусто,
 * соседние буквы не слипаются в несуществующие слова. Раскладка жадная: первое длинное слово в середину, дальше —
 * слова через уже стоящие буквы, лучшие по числу пересечений и близости к центру. Слова — из базы с вопросами. */
import type { Rng } from '../../core/types';

export interface Entry {
  word: string;
  /** Любая полезная нагрузка (вопрос). */
  ref: number;
}

export interface Placed {
  x: number;
  y: number;
  /** 0 — по горизонтали, 1 — по вертикали. */
  dir: 0 | 1;
  word: string;
  ref: number;
  num: number;
}

export interface Layout {
  w: number;
  h: number;
  words: Placed[];
}

interface Grid {
  w: number;
  h: number;
  ch: string[];
  /** Биты: 1 — занята горизонтальным словом, 2 — вертикальным. */
  use: number[];
  /** Сканворд: клетки-вопросы (буквы туда нельзя). null — обычный кроссворд. */
  clue: boolean[] | null;
}

const at = (g: Grid, x: number, y: number) => (x < 0 || y < 0 || x >= g.w || y >= g.h ? '' : g.ch[y * g.w + x]);

/** Сколько пересечений даст слово в этом месте; -1 — нельзя. */
function fit(g: Grid, word: string, x: number, y: number, dir: 0 | 1): number {
  const dx = dir === 0 ? 1 : 0;
  const dy = 1 - dx;
  const n = word.length;
  const ex = x + dx * (n - 1);
  const ey = y + dy * (n - 1);
  if (x < 0 || y < 0 || ex >= g.w || ey >= g.h) return -1;
  if (at(g, x - dx, y - dy) || at(g, ex + dx, ey + dy)) return -1;
  // сканворд: перед словом — клетка с вопросом, она должна быть в поле
  if (g.clue && (x - dx < 0 || y - dy < 0)) return -1;
  let cross = 0;
  for (let k = 0; k < n; k++) {
    const cx = x + dx * k;
    const cy = y + dy * k;
    const i = cy * g.w + cx;
    const c = g.ch[i];
    if (g.clue?.[i]) return -1;
    if (c) {
      if (c !== word[k] || g.use[i] & (dir === 0 ? 1 : 2)) return -1;
      cross++;
    } else {
      // по бокам новой буквы — пусто, иначе слипнется
      if (at(g, cx + dy, cy + dx) || at(g, cx - dy, cy - dx)) return -1;
    }
  }
  return cross;
}

function put(g: Grid, word: string, x: number, y: number, dir: 0 | 1) {
  const dx = dir === 0 ? 1 : 0;
  const dy = 1 - dx;
  if (g.clue) g.clue[(y - dy) * g.w + x - dx] = true;
  for (let k = 0; k < word.length; k++) {
    const i = (y + dy * k) * g.w + x + dx * k;
    g.ch[i] = word[k];
    g.use[i] |= dir === 0 ? 1 : 2;
  }
}

export interface GenOpts {
  w: number;
  h: number;
  /** Сколько слов хотим (примерно). */
  target: number;
  /** Сканворд: вопрос в клетке перед словом. */
  scan?: boolean;
}

/**
 * pool — слова-кандидаты (уже отобранные по уровню), в случайном порядке не обязательно.
 * Возвращает раскладку, обрезанную по занятой области и с номерами.
 */
export function generate(rng: Rng, pool: Entry[], o: GenOpts): Layout {
  const maxLen = Math.max(o.w, o.h);
  const words = pool.filter((e) => e.word.length >= 3 && e.word.length <= maxLen);
  // индекс: буква → слова с ней
  const byLetter = new Map<string, number[]>();
  words.forEach((e, idx) => {
    for (const c of new Set(e.word)) {
      let l = byLetter.get(c);
      if (!l) byLetter.set(c, (l = []));
      l.push(idx);
    }
  });
  let best: { g: Grid; placed: Omit<Placed, 'num'>[] } | null = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const g: Grid = { w: o.w, h: o.h, ch: new Array(o.w * o.h).fill(''), use: new Array(o.w * o.h).fill(0), clue: o.scan ? new Array(o.w * o.h).fill(false) : null };
    const used = new Set<string>();
    const placed: Omit<Placed, 'num'>[] = [];
    // первое слово — длинное, по горизонтали через середину
    const longs = words.filter((e) => e.word.length >= Math.min(o.w - 2, 9) && e.word.length <= o.w);
    const first = (longs.length ? longs : words)[rng.int((longs.length ? longs : words).length)];
    const fx = Math.max(o.scan ? 1 : 0, Math.floor((o.w - first.word.length) / 2));
    const fy = Math.floor(o.h / 2);
    put(g, first.word, fx, fy, 0);
    used.add(first.word);
    placed.push({ x: fx, y: fy, dir: 0, word: first.word, ref: first.ref });
    let fails = 0;
    while (placed.length < o.target && fails < 60) {
      // клетки с буквой, через которые ещё можно провести слово поперёк
      const open: { x: number; y: number; dir: 0 | 1 }[] = [];
      for (let y = 0; y < g.h; y++)
        for (let x = 0; x < g.w; x++) {
          const i = y * g.w + x;
          if (!g.ch[i]) continue;
          if (!(g.use[i] & 1)) open.push({ x, y, dir: 0 });
          if (!(g.use[i] & 2)) open.push({ x, y, dir: 1 });
        }
      if (!open.length) break;
      let pick: { e: Entry; x: number; y: number; dir: 0 | 1; score: number } | null = null;
      // несколько случайных опорных клеток, по каждой — случайная выборка слов
      for (let t = 0; t < 24; t++) {
        const c = open[rng.int(open.length)];
        const letter = g.ch[c.y * g.w + c.x];
        const cand = byLetter.get(letter);
        if (!cand) continue;
        for (let s = 0; s < 40; s++) {
          const e = words[cand[rng.int(cand.length)]];
          if (used.has(e.word)) continue;
          for (let k = 0; k < e.word.length; k++) {
            if (e.word[k] !== letter) continue;
            const x = c.dir === 0 ? c.x - k : c.x;
            const y = c.dir === 1 ? c.y - k : c.y;
            const cross = fit(g, e.word, x, y, c.dir);
            if (cross < 1) continue;
            const mx = x + (c.dir === 0 ? e.word.length / 2 : 0) - g.w / 2;
            const my = y + (c.dir === 1 ? e.word.length / 2 : 0) - g.h / 2;
            const score = cross * 6 + e.word.length * 0.6 - Math.hypot(mx / g.w, my / g.h) * 4 + rng.next();
            if (!pick || score > pick.score) pick = { e, x, y, dir: c.dir, score };
          }
        }
      }
      if (!pick) {
        fails++;
        continue;
      }
      fails = 0;
      put(g, pick.e.word, pick.x, pick.y, pick.dir);
      used.add(pick.e.word);
      placed.push({ x: pick.x, y: pick.y, dir: pick.dir, word: pick.e.word, ref: pick.e.ref });
    }
    if (!best || placed.length > best.placed.length) best = { g, placed };
    if (placed.length >= o.target) break;
  }
  return finish(best!.g, best!.placed, !!o.scan);
}

/** Обрезать по занятому и пронумеровать начала слов построчно. */
function finish(g: Grid, placed: Omit<Placed, 'num'>[], scan: boolean): Layout {
  let x0 = g.w;
  let y0 = g.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < g.h; y++)
    for (let x = 0; x < g.w; x++)
      if (g.ch[y * g.w + x] || g.clue?.[y * g.w + x]) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
  const w = x1 - x0 + 1;
  const h = y1 - y0 + 1;
  const moved = placed.map((p) => ({ ...p, x: p.x - x0, y: p.y - y0 }));
  const starts = [...new Set(moved.map((p) => p.y * w + p.x))].sort((a, b) => a - b);
  const words = moved
    .map((p) => ({ ...p, num: starts.indexOf(p.y * w + p.x) + 1 }))
    .sort((a, b) => a.dir - b.dir || a.num - b.num);
  return { w, h, words };
}

/** Клетки слова. */
export function cellsOf(p: Pick<Placed, 'x' | 'y' | 'dir'>, len: number, w: number): number[] {
  return Array.from({ length: len }, (_, k) => (p.dir === 0 ? p.y * w + p.x + k : (p.y + k) * w + p.x));
}
