/* Сканворд — генератор без DOM. Поле сплошное, как в газете: каждая клетка — буква, вопрос или часть картинки.
 * Вопрос стоит в клетке перед словом (→, ↓) или уголком: над словом, которое идёт вправо, или слева от слова, которое идёт вниз;
 * в клетке-вопросе их до двух. Картинки (1–3 блока 3×3 или 4×3) — тоже не буквы, но вопросов не несут: слово за картинкой
 * начинается с клетки-вопроса. Слово к каждой картинке («Фото 1») ставится в слот заранее, остальное заполняется вокруг.
 * Шаблон: строки режутся на слова 3–maxLen букв, длинные столбцы тоже; каждому слову подбирается клетка-вопрос, нет — первая буква в вопрос.
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
  slots: Slot[];
}

/** Куски линий из букв (длина ≥ 2): dir 0 — строки, 1 — столбцы. */
function runsOf(clue: boolean[], w: number, h: number): { dir: 0 | 1; cells: number[] }[] {
  const out: { dir: 0 | 1; cells: number[] }[] = [];
  for (const dir of [0, 1] as const) {
    const lines = dir === 0 ? h : w;
    const len = dir === 0 ? w : h;
    for (let l = 0; l < lines; l++) {
      let cur: number[] = [];
      for (let p = 0; p <= len; p++) {
        const i = p < len ? (dir === 0 ? l * w + p : p * w + l) : -1;
        if (i >= 0 && !clue[i]) cur.push(i);
        else {
          if (cur.length >= 2) out.push({ dir, cells: cur });
          cur = [];
        }
      }
    }
  }
  return out;
}

/**
 * Клетки-вопросы для слов. Слову подходит клетка перед ним по линии (→ или ↓), над его первой буквой, если слово идёт вправо
 * (уголок ↳), или слева от первой буквы, если слово идёт вниз. В клетке — не больше двух вопросов. Слова с меньшим выбором — первыми.
 * Возвращает слоты или слово, которому места не нашлось.
 */
function assign(rng: Rng, clue: boolean[], pic: number[], w: number, h: number): { slots: Slot[] } | { bad: number[] } {
  const runs = runsOf(clue, w, h).filter((r) => r.cells.length >= 3);
  const isQ = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && clue[y * w + x] && pic[y * w + x] < 0;
  const cand = runs.map((r) => {
    const s = r.cells[0];
    const x = s % w;
    const y = Math.floor(s / w);
    const c: number[] = [];
    if (r.dir === 0) {
      if (isQ(x - 1, y)) c.push(s - 1);
      if (isQ(x, y - 1)) c.push(s - w);
    } else {
      if (isQ(x, y - 1)) c.push(s - w);
      if (isQ(x - 1, y)) c.push(s - 1);
    }
    return c;
  });
  const load = new Map<number, number>();
  // случайные ключи — заранее: сортировка со случайным сравнением зависит от движка (а сид должен давать одно и то же везде)
  const key = runs.map(() => rng.next());
  const order = runs.map((_, k) => k).sort((a, b) => cand[a].length - cand[b].length || key[a] - key[b]);
  const at: number[] = new Array(runs.length).fill(-1);
  for (const k of order) {
    // своя линия — охотнее (так привычнее), потом уголок
    const q = cand[k].find((c) => (load.get(c) ?? 0) < 2);
    if (q == null) return { bad: runs[k].cells };
    load.set(q, (load.get(q) ?? 0) + 1);
    at[k] = q;
  }
  // пустые клетки-вопросы: переносим вопросы по цепочке — из клетки с двумя вопросами в пустую
  const by = new Map<number, number[]>();
  cand.forEach((cs, k) => cs.forEach((c) => (by.get(c) ?? by.set(c, []).get(c)!).push(k)));
  for (let d = 0; d < w * h; d++) {
    if (!clue[d] || pic[d] >= 0 || load.get(d) || !by.has(d)) continue;
    const parent = new Map<number, { to: number; slot: number }>([[d, { to: -1, slot: -1 }]]);
    const queue = [d];
    let end: { cell: number; slot: number } | null = null;
    for (let qi = 0; qi < queue.length && !end; qi++) {
      const c = queue[qi];
      for (const k of by.get(c) ?? []) {
        const q = at[k];
        if (q === c) continue;
        if ((load.get(q) ?? 0) >= 2) {
          end = { cell: c, slot: k };
          break;
        }
        if (!parent.has(q)) {
          parent.set(q, { to: c, slot: k });
          queue.push(q);
        }
      }
    }
    if (!end) continue;
    const move = (k: number, to: number) => {
      load.set(at[k], load.get(at[k])! - 1);
      load.set(to, (load.get(to) ?? 0) + 1);
      at[k] = to;
    };
    move(end.slot, end.cell);
    for (let c = end.cell; c !== d; ) {
      const p = parent.get(c)!;
      move(p.slot, p.to);
      c = p.to;
    }
  }
  return { slots: runs.map((r, k) => ({ cx: at[k] % w, cy: Math.floor(at[k] / w), dir: r.dir, cells: r.cells })) };
}

/**
 * Довести шаблон до правил: слов из двух букв нет; буквы вне слов — в вопрос; каждому слову — клетка-вопрос
 * (не нашлось — первая буква слова становится вопросом). Повторяем, пока всё не сойдётся.
 */
function settle(rng: Rng, clue: boolean[], pic: number[], w: number, h: number, maxLen = 8): Slot[] | null {
  for (let pass = 0; pass < 40; pass++) {
    let bad = false;
    for (const r of runsOf(clue, w, h))
      if (r.cells.length > maxLen) {
        clue[r.cells[3 + rng.int(r.cells.length - 6)]] = true;
        bad = true;
      }
    for (const r of runsOf(clue, w, h))
      if (r.cells.length === 2) {
        clue[r.cells[rng.int(2)]] = true;
        bad = true;
      }
    for (let i = 0; i < w * h; i++) {
      if (clue[i]) continue;
      const x = i % w;
      const y = Math.floor(i / w);
      const hl = (x > 0 && !clue[i - 1]) || (x + 1 < w && !clue[i + 1]);
      const vl = (y > 0 && !clue[i - w]) || (y + 1 < h && !clue[i + w]);
      if (!hl && !vl) {
        clue[i] = true;
        bad = true;
      }
    }
    if (bad) continue;
    const a = assign(rng, clue, pic, w, h);
    if ('slots' in a) return a.slots;
    clue[a.bad[0]] = true;
  }
  return null;
}

/** Клетки-вопросы, в которых не оказалось ни одного вопроса. */
function deadOf(clue: boolean[], pic: number[], slots: Slot[], w: number): number[] {
  const has = new Set(slots.map((s) => s.cy * w + s.cx));
  return clue.map((c, i) => (c && pic[i] < 0 && !has.has(i) ? i : -1)).filter((i) => i >= 0);
}

function makePattern(rng: Rng, w: number, h: number, maxLen: number, pics: number): Pattern | null {
  const clue = new Array(w * h).fill(false);
  const pic = new Array(w * h).fill(-1);
  clue[0] = true;
  // картинки: вплотную к краю или не ближе 4 клеток от края и друг от друга — в узком коридоре (1–3 клетки)
  // не помещается «вопрос + слово из трёх букв», и голубые клетки там остаются без вопросов
  const blocks: Pattern['blocks'] = [];
  const spots = (len: number, b: number) => {
    const out = [0, len - b];
    for (let p = 4; p + b <= len - 4; p++) out.push(p);
    return out;
  };
  const gapOk = (a0: number, a1: number, b0: number, b1: number) => a1 <= b0 - 4 || b1 <= a0 - 4;
  for (let b = 0, tries = 0; b < pics && tries < 300; tries++) {
    const bw = w >= 12 && rng.next() < 0.5 ? 4 : 3;
    const bh = h >= 14 && rng.next() < 0.5 ? 4 : 3;
    const xs = spots(w, bw);
    const ys = spots(h, bh);
    const x = xs[rng.int(xs.length)];
    const y = ys[rng.int(ys.length)];
    // левый верхний угол — клетка-вопрос
    if (x === 0 && y === 0) continue;
    if (blocks.some((o) => !gapOk(x, x + bw, o.x, o.x + o.w) && !gapOk(y, y + bh, o.y, o.y + o.h))) continue;
    blocks.push({ x, y, w: bw, h: bh });
    for (let yy = y; yy < y + bh; yy++)
      for (let xx = x; xx < x + bw; xx++) {
        clue[yy * w + xx] = true;
        pic[yy * w + xx] = b;
      }
    b++;
  }
  if (blocks.length < pics) return null;
  // строки: куски 3..maxLen через клетку-вопрос; в начале куска вопрос ставим не всегда — бывает уголок сверху
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      if (clue[y * w + x]) {
        x++;
        continue;
      }
      let end = x;
      while (end < w && !clue[y * w + end]) end++;
      if (x === 0 || rng.next() < 0.6) {
        clue[y * w + x] = true;
        x++;
      }
      while (x < end) {
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
      x = end;
    }
  }
  // столбцы: длинные вертикали режем
  for (let x = 0; x < w; x++) {
    let y = 0;
    while (y < h) {
      if (clue[y * w + x]) {
        y++;
        continue;
      }
      let e = y;
      while (e < h && !clue[e * w + x]) e++;
      if (e - y > maxLen) {
        const cut = y + 3 + rng.int(Math.max(1, Math.min(maxLen - 3, e - y - 6) + 1));
        if (cut < e - 2) clue[cut * w + x] = true;
        continue;
      }
      y = e;
    }
  }
  let slots = settle(rng, clue, pic, w, h, maxLen);
  if (!slots) return null;
  // улучшение: переключаем случайную клетку (вопрос ↔ буква); берём, если шаблон сходится, а пустых вопросов и вопросов вообще не больше
  const score = (c: boolean[], sl: Slot[]) => deadOf(c, pic, sl, w).length * 20 + c.filter((v, i) => v && pic[i] < 0).length;
  let best = score(clue, slots);
  for (let it = 0; it < w * h * 6; it++) {
    const j = 1 + rng.int(w * h - 1);
    if (pic[j] >= 0) continue;
    const c = clue.slice();
    c[j] = !c[j];
    const s2 = settle(rng, c, pic, w, h, maxLen);
    if (!s2) continue;
    const sc = score(c, s2);
    if (sc <= best) {
      for (let k = 0; k < c.length; k++) clue[k] = c[k];
      slots = s2;
      best = sc;
    }
  }
  // оставшиеся пустые вопросы — пробуем сделать буквой (или соседа буквой); не вышло — шаблон не годится
  for (let round = 0; round < 3; round++) {
    const dead = deadOf(clue, pic, slots, w);
    if (!dead.length) break;
    for (const d of dead) {
      const x = d % w;
      for (const j of [d, d + 1, d + w, d - 1, d - w]) {
        if (j <= 0 || j >= w * h || pic[j] >= 0 || (Math.abs((j % w) - x) > 1)) continue;
        const c = clue.slice();
        c[j] = !c[j];
        const s2 = settle(rng, c, pic, w, h, maxLen);
        if (!s2 || deadOf(c, pic, s2, w).length >= deadOf(clue, pic, slots, w).length) continue;
        for (let k = 0; k < c.length; k++) clue[k] = c[k];
        slots = s2;
        break;
      }
    }
  }
  return { clue, pic, blocks, slots };
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
    // голубая клетка без вопроса — брак
    if (deadOf(pat.clue, pat.pic, pat.slots, w).length) continue;
    const slots = pat.slots;
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
    const pk = new Map(pick.map((e) => [e, e.rank + (rng.next() - 0.5) * 2]));
    pick.sort((a, b) => pk.get(a)! - pk.get(b)!);
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

