/* Сканворд — генератор без DOM. Поле сплошное, как в газете: каждая клетка — буква, вопрос или часть картинки.
 * Вопрос стоит в клетке перед словом: «→» — слово идёт вправо из соседней справа, «↓» — вниз из соседней снизу;
 * в клетке-вопросе их до двух. Картинки (1–3 блока 3×3 или 4×3) — тоже не буквы, но вопросов не несут: слово за картинкой
 * начинается с клетки-вопроса. Слово к каждой картинке («Фото 1») ставится в слот заранее, остальное заполняется вокруг.
 * Шаблон: верхний ряд и левый столбец — вопросы, внутри — случайные клетки-вопросы, слова 3–maxLen букв.
 * Заполнение — перебором: слот с наименьшим числом вариантов первым, кандидаты — пересечением битовых масок букв. */
import type { Rng } from '../../core/types';

export interface Slot {
  /** Клетка-вопрос. */
  cx: number;
  cy: number;
  dir: 0 | 1;
  /** Клетки слова (индексы). */
  cells: number[];
}

export interface PicBlock {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Слот, куда вписывается ответ к картинке. */
  slot: number;
}

export interface ScanLayout {
  w: number;
  h: number;
  /** true — не буква (вопрос или картинка). */
  clue: boolean[];
  /** Номер картинки клетки (−1 — не картинка). */
  pic: number[];
  pics: PicBlock[];
  slots: (Slot & { word: string; ref: number })[];
}

export interface ScanEntry {
  word: string;
  ref: number;
  /** Чем меньше, тем охотнее берём (известность). */
  rank: number;
}

// ---------------------------------------------------------------- шаблон

interface Pattern {
  clue: boolean[];
  pic: number[];
  blocks: { x: number; y: number; w: number; h: number }[];
}

function makePattern(rng: Rng, w: number, h: number, maxLen: number, pics: number): Pattern | null {
  const clue = new Array(w * h).fill(false);
  const pic = new Array(w * h).fill(-1);
  for (let x = 0; x < w; x++) clue[x] = true;
  for (let y = 0; y < h; y++) clue[y * w] = true;
  // картинки: блоки внутри поля, не впритык друг к другу
  const blocks: Pattern['blocks'] = [];
  for (let b = 0, tries = 0; b < pics && tries < 60; tries++) {
    const bw = w >= 12 && rng.next() < 0.5 ? 4 : 3;
    const bh = h >= 14 && rng.next() < 0.5 ? 4 : 3;
    const x = 1 + rng.int(w - bw);
    const y = 1 + rng.int(h - bh);
    if (blocks.some((o) => x < o.x + o.w + 1 && o.x < x + bw + 1 && y < o.y + o.h + 1 && o.y < y + bh + 1)) continue;
    blocks.push({ x, y, w: bw, h: bh });
    for (let yy = y; yy < y + bh; yy++)
      for (let xx = x; xx < x + bw; xx++) {
        clue[yy * w + xx] = true;
        pic[yy * w + xx] = b;
      }
    b++;
  }
  if (blocks.length < pics) return null;
  // строки: режем на куски 3..maxLen; после картинки — клетка-вопрос
  for (let y = 1; y < h; y++) {
    let x = 1;
    while (x < w) {
      if (pic[y * w + x] >= 0) {
        x++;
        if (x < w && pic[y * w + x] < 0) {
          clue[y * w + x] = true;
          x++;
        }
        continue;
      }
      let end = x;
      while (end < w && pic[y * w + end] < 0) end++;
      const left = end - x;
      let len = 3 + rng.int(Math.max(1, maxLen - 2));
      if (left - len < 4) len = left;
      if (len > maxLen) len = Math.min(maxLen, left - 4);
      x += len;
      if (x < end) {
        clue[y * w + x] = true;
        x++;
      }
    }
  }
  // столбцы: длинные вертикали режем; под картинкой — клетка-вопрос
  for (let x = 1; x < w; x++)
    for (let y = 1; y < h - 1; y++) if (pic[y * w + x] >= 0 && pic[(y + 1) * w + x] < 0) clue[(y + 1) * w + x] = true;
  for (let pass = 0; pass < 4; pass++) {
    let changed = false;
    for (let x = 1; x < w; x++) {
      let y = 1;
      while (y < h) {
        if (clue[y * w + x]) {
          y++;
          continue;
        }
        let e = y;
        while (e < h && !clue[e * w + x]) e++;
        const len = e - y;
        if (len > maxLen) {
          const cut = y + 3 + rng.int(len - 6 > 0 ? Math.min(maxLen - 3, len - 6) + 1 : 1);
          if (cut < e - 3 && cut < h) {
            clue[cut * w + x] = true;
            changed = true;
          }
        }
        y = e;
      }
    }
    if (!changed) break;
  }
  return fix(clue, pic, w, h) ? { clue, pic, blocks } : null;
}

/**
 * Довести шаблон до правил: слов из двух букв нет (вторую букву — в вопрос); у каждого слова перед ним клетка-вопрос
 * (не картинка — иначе первую букву в вопрос); буква вне слов — в вопрос. Повторяем, пока всё не сойдётся.
 */
function fix(clue: boolean[], pic: number[], w: number, h: number): boolean {
  for (let pass = 0; pass < 20; pass++) {
    let bad = false;
    for (const dir of [0, 1] as const) {
      const lines = dir === 0 ? h : w;
      const len = dir === 0 ? w : h;
      for (let l = 0; l < lines; l++) {
        const idx = (k: number) => (dir === 0 ? l * w + k : k * w + l);
        let p = 0;
        while (p < len) {
          if (clue[idx(p)]) {
            p++;
            continue;
          }
          let e = p;
          while (e < len && !clue[idx(e)]) e++;
          const run = e - p;
          if (run >= 2 && (p === 0 || pic[idx(p - 1)] >= 0)) {
            // перед словом нет места для вопроса
            clue[idx(p)] = true;
            bad = true;
          } else if (run === 2) {
            clue[idx(p + 1)] = true;
            bad = true;
          }
          p = e;
        }
      }
    }
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (clue[i]) continue;
        const hl = (x > 0 && !clue[i - 1]) || (x + 1 < w && !clue[i + 1]);
        const vl = (y > 0 && !clue[i - w]) || (y + 1 < h && !clue[i + w]);
        if (!hl && !vl) {
          clue[i] = true;
          bad = true;
        }
      }
    if (!bad) return true;
  }
  return false;
}

export function slotsOf(clue: boolean[], pic: number[], w: number, h: number): Slot[] {
  const slots: Slot[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (!clue[i] || pic[i] >= 0) continue;
      if (x + 1 < w && !clue[i + 1]) {
        const cells: number[] = [];
        for (let k = x + 1; k < w && !clue[y * w + k]; k++) cells.push(y * w + k);
        if (cells.length >= 2) slots.push({ cx: x, cy: y, dir: 0, cells });
      }
      if (y + 1 < h && !clue[i + w]) {
        const cells: number[] = [];
        for (let k = y + 1; k < h && !clue[k * w + x]; k++) cells.push(k * w + x);
        if (cells.length >= 2) slots.push({ cx: x, cy: y, dir: 1, cells });
      }
    }
  return slots;
}

// ---------------------------------------------------------------- словарь с масками

class Index {
  byLen = new Map<number, { words: ScanEntry[]; masks: Map<string, Uint32Array>; all: Uint32Array }>();
  constructor(pool: ScanEntry[]) {
    const groups = new Map<number, ScanEntry[]>();
    for (const e of pool) {
      let g = groups.get(e.word.length);
      if (!g) groups.set(e.word.length, (g = []));
      g.push(e);
    }
    for (const [len, words] of groups) {
      const n = Math.ceil(words.length / 32);
      const masks = new Map<string, Uint32Array>();
      words.forEach((e, wi) => {
        for (let p = 0; p < len; p++) {
          const key = p + e.word[p];
          let m = masks.get(key);
          if (!m) masks.set(key, (m = new Uint32Array(n)));
          m[wi >> 5] |= 1 << (wi & 31);
        }
      });
      const all = new Uint32Array(n);
      for (let wi = 0; wi < words.length; wi++) all[wi >> 5] |= 1 << (wi & 31);
      this.byLen.set(len, { words, masks, all });
    }
  }
  /** Битовая маска подходящих слов для шаблона (буква или '' на позиции). null — длины нет. */
  match(pattern: string[]): { set: Uint32Array; words: ScanEntry[] } | null {
    const g = this.byLen.get(pattern.length);
    if (!g) return null;
    const set = g.all.slice();
    for (let p = 0; p < pattern.length; p++) {
      const c = pattern[p];
      if (!c) continue;
      const m = g.masks.get(p + c);
      if (!m) {
        set.fill(0);
        break;
      }
      for (let k = 0; k < set.length; k++) set[k] &= m[k];
    }
    return { set, words: g.words };
  }
}

const popcount = (a: Uint32Array) => {
  let c = 0;
  for (let k = 0; k < a.length; k++) {
    let v = a[k];
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    c += (((v + (v >>> 4)) & 0xf0f0f0f) * 0x1010101) >>> 24;
  }
  return c;
};

// ---------------------------------------------------------------- заполнение

export interface ScanOpts {
  w: number;
  h: number;
  maxLen?: number;
  /** Сколько картинок (0–3) и слова, к которым картинки есть. */
  pics?: number;
  picPool?: ScanEntry[];
  /** Сколько шаблонов пробовать (результат зависит только от сида — не от скорости машины). */
  patterns?: number;
  /** Шагов перебора на шаблон. */
  nodes?: number;
}

export function generate(rng: Rng, pool: ScanEntry[], o: ScanOpts): ScanLayout | null {
  const { w, h } = o;
  const maxLen = o.maxLen ?? 8;
  const index = new Index(pool.filter((e) => e.word.length >= 3 && e.word.length <= Math.max(w, h)));
  const picPool = o.picPool ?? [];
  const nPics = picPool.length ? (o.pics ?? 0) : 0;
  for (let attempt = 0; attempt < (o.patterns ?? 40); attempt++) {
    // если с картинками не выходит — под конец пробуем с меньшим числом
    const want = attempt < 30 ? nPics : Math.max(0, nPics - 1);
    const pat = makePattern(rng, w, h, maxLen, want);
    if (!pat) continue;
    const slots = slotsOf(pat.clue, pat.pic, w, h);
    if (slots.some((s) => s.cells.length < 3 || !index.byLen.has(s.cells.length))) continue;
    // ответы к картинкам — в случайные слоты подходящей длины
    const pre = new Map<number, ScanEntry>();
    const picSlot: number[] = [];
    const usedPic = new Set<string>();
    for (let b = 0; b < pat.blocks.length; b++) {
      const free = slots.map((s, k) => k).filter((k) => !pre.has(k) && picPool.some((e) => e.word.length === slots[k].cells.length && !usedPic.has(e.word)));
      if (!free.length) break;
      const k = free[rng.int(free.length)];
      const opts = picPool.filter((e) => e.word.length === slots[k].cells.length && !usedPic.has(e.word));
      const e = opts[rng.int(opts.length)];
      pre.set(k, e);
      usedPic.add(e.word);
      picSlot.push(k);
    }
    if (picSlot.length < pat.blocks.length) continue;
    const res = fill(rng, index, slots, w * h, o.nodes ?? 4000, pre);
    if (res)
      return {
        w,
        h,
        clue: pat.clue,
        pic: pat.pic,
        pics: pat.blocks.map((b, k) => ({ ...b, slot: picSlot[k] })),
        slots: slots.map((s, k) => ({ ...s, word: res[k].word, ref: res[k].ref })),
      };
  }
  return null;
}

function fill(rng: Rng, index: Index, slots: Slot[], n: number, budget: number, pre: Map<number, ScanEntry>): ScanEntry[] | null {
  const ch: string[] = new Array(n).fill('');
  const chosen: (ScanEntry | null)[] = new Array(slots.length).fill(null);
  const used = new Set<string>();
  // заранее поставленные слова (к картинкам); пересекаться им нельзя по разным буквам
  for (const [k, e] of pre) {
    for (let p = 0; p < e.word.length; p++) {
      const c = slots[k].cells[p];
      if (ch[c] && ch[c] !== e.word[p]) return null;
      ch[c] = e.word[p];
    }
    chosen[k] = e;
    used.add(e.word);
  }
  // какие слоты проходят через клетку
  const through: number[][] = Array.from({ length: n }, () => []);
  slots.forEach((s, k) => s.cells.forEach((c) => through[c].push(k)));
  let nodes = 0;

  const rec = (left: number): boolean => {
    if (left === 0) return true;
    if (++nodes > budget) return false;
    // слот с наименьшим числом вариантов
    let best = -1;
    let bestM: { set: Uint32Array; words: ScanEntry[] } | null = null;
    let bestN = Infinity;
    for (let k = 0; k < slots.length; k++) {
      if (chosen[k]) continue;
      const m = index.match(slots[k].cells.map((c) => ch[c]));
      const cnt = m ? popcount(m.set) : 0;
      if (cnt === 0) return false;
      if (cnt < bestN) {
        bestN = cnt;
        best = k;
        bestM = m;
        if (cnt === 1) break;
      }
    }
    const s = slots[best];
    const { set, words } = bestM!;
    // кандидаты: случайная выборка, известные — вперёд
    const cand: number[] = [];
    for (let k = 0; k < set.length; k++) {
      let v = set[k];
      while (v) {
        const b = 31 - Math.clz32(v & -v);
        cand.push(k * 32 + b);
        v &= v - 1;
      }
    }
    const pick: ScanEntry[] = [];
    const tries = Math.min(cand.length, 24);
    for (let t = 0; t < tries; t++) {
      const j = t + rng.int(cand.length - t);
      [cand[t], cand[j]] = [cand[j], cand[t]];
      pick.push(words[cand[t]]);
    }
    pick.sort((a, b) => a.rank - b.rank + (rng.next() - 0.5) * 2);
    for (const e of pick) {
      if (used.has(e.word)) continue;
      const before = s.cells.map((c) => ch[c]);
      s.cells.forEach((c, p) => (ch[c] = e.word[p]));
      chosen[best] = e;
      used.add(e.word);
      // проверка пересекающихся слотов
      let ok = true;
      for (const c of s.cells)
        for (const k of through[c])
          if (!chosen[k]) {
            const m = index.match(slots[k].cells.map((x) => ch[x]));
            if (!m || !popcount(m.set)) {
              ok = false;
              break;
            }
          }
      if (ok && rec(left - 1)) return true;
      used.delete(e.word);
      chosen[best] = null;
      s.cells.forEach((c, p) => (ch[c] = before[p]));
      if (nodes > budget) return false;
    }
    return false;
  };
  return rec(slots.length - pre.size) ? (chosen as ScanEntry[]) : null;
}
