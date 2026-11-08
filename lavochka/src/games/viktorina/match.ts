/* Сверка ответа, введённого с клавиатуры («Сто опрошенных», «Табло тем», «Кнопка» с вводом):
 * нормализация (строчные, ё→е, без знаков), синонимы, основа слова без окончания, перестановка слов,
 * опечатки — расстояние Левенштейна до 1–2 по длине, фамилия без имени. Без DOM. */

export const normText = (s: string) =>
  s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[^0-9a-zа-я]+/g, ' ')
    .trim();

/** Служебные слова, которые не меняют ответа: «в шахматы» = «шахматы», «на дачу» = «дача». */
const STOP = new Set(['в', 'во', 'на', 'с', 'со', 'и', 'к', 'по', 'за', 'из', 'у', 'о', 'об', 'от', 'до', 'для', 'это', 'а', 'же', 'ну', 'то', 'р', 'г']);

const ENDINGS = [
  'иями', 'ями', 'ами', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими', 'иях', 'ах', 'ях', 'ой', 'ей', 'ий', 'ый', 'ая', 'яя', 'ое', 'ее', 'ые', 'ие', 'ую', 'юю',
  'ов', 'ев', 'ам', 'ям', 'ом', 'ем', 'ию', 'ия', 'ие', 'ть', 'а', 'я', 'ы', 'и', 'е', 'о', 'у', 'ю', 'ь', 'й',
];

/** Основа слова: без окончания, не короче трёх букв. */
export function stem(w: string): string {
  if (/^\d+$/.test(w) || w.length <= 3) return w;
  for (const e of ENDINGS) if (w.endsWith(e) && w.length - e.length >= 3) return w.slice(0, -e.length);
  return w;
}

export function lev(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  const m = a.length;
  const n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= n; j++) {
      const c = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      cur.push(c);
      if (c < best) best = c;
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[n];
}

/** Сколько опечаток прощаем при такой длине. */
const slack = (len: number) => (len <= 3 ? 0 : len <= 6 ? 1 : 2);

const words = (s: string) => normText(s).split(' ').filter((w) => w && !STOP.has(w));

/** Совпадает ли ответ игрока g с одним вариантом c. */
export function same(g: string, c: string): boolean {
  const a = normText(g);
  const b = normText(c);
  if (!a || !b) return false;
  if (a === b) return true;
  const wa = words(g);
  const wb = words(c);
  if (!wa.length || !wb.length) return false;
  // числа и римские цифры должны совпасть точно: «Пётр II» — не «Пётр I», «1709» — не «1710»
  const nums = (ws: string[]) => ws.filter((w) => /^\d+$/.test(w) || /^[ivxlcdm]+$/.test(w)).sort().join(' ');
  if (nums(wa) !== nums(wb)) return false;
  const ja = wa.join('');
  const jb = wb.join('');
  if (ja === jb) return true;
  // опечатки во всей фразе
  if (lev(ja, jb, 2) <= slack(Math.min(ja.length, jb.length))) return true;
  const sa = wa.map(stem);
  const sb = wb.map(stem);
  // то же по основам, в любом порядке слов
  if ([...sa].sort().join(' ') === [...sb].sort().join(' ')) return true;
  // каждое слово ответа нашлось среди слов игрока (с опечаткой) — «река Волга» = «Волга», «Михаил Кутузов» = «Кутузов»
  const near = (x: string, ys: string[]) => ys.some((y) => x === y || lev(x, y, 2) <= slack(Math.min(x.length, y.length)));
  if (sb.every((x) => near(x, sa)) && sa.length <= sb.length + 1) return true;
  // игрок назвал только фамилию (последнее слово ответа из нескольких)
  if (sb.length >= 2 && sa.length === 1) {
    const last = sb[sb.length - 1];
    if (last.length >= 4 && near(sa[0], [last])) return true;
  }
  return false;
}

/** Какой из ответов (текст + синонимы) назвал игрок; -1 — ни один. Точное совпадение важнее похожего. */
export function matchAnswer(g: string, cands: { main: string; alt?: string[] }[], skip?: (i: number) => boolean): number {
  const n = normText(g);
  if (!n) return -1;
  for (let i = 0; i < cands.length; i++) {
    if (skip?.(i)) continue;
    if ([cands[i].main, ...(cands[i].alt || [])].some((c) => normText(c) === n)) return i;
  }
  for (let i = 0; i < cands.length; i++) {
    if (skip?.(i)) continue;
    if ([cands[i].main, ...(cands[i].alt || [])].some((c) => same(g, c))) return i;
  }
  return -1;
}
