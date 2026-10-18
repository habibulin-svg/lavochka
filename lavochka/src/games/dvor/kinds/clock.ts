/* Шифр по часам: разбойники пишут записку циферблатами — каждый циферблат одна буква. Номер буквы в алфавите
 * считается по часам и минутам. Лёгкая и средняя — правило сказано; трудная — дан пример расшифровки, правило найти
 * самому (из нескольких возможных подходит одно). Без DOM. */
import type { Rng } from '../../../core/types';
import { shuffle } from '../../../core/rng';

/** Алфавит без Ё: А — 1, Я — 32. */
export const ABC = 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ';

export interface Rule {
  id: string;
  /** Как сказано в задаче. */
  text: string;
  /** часы 1–12, k = минуты / 5 (0–11) → номер буквы. */
  f: (h: number, k: number) => number;
}

export const RULES: Rule[] = [
  { id: 'h+k', text: 'номер буквы = часы + число «пятиминуток» (минуты : 5)', f: (h, k) => h + k },
  { id: '2h+k', text: 'номер буквы = часы × 2 + число «пятиминуток»', f: (h, k) => 2 * h + k },
  { id: 'h+2k', text: 'номер буквы = часы + число «пятиминуток» × 2', f: (h, k) => h + 2 * k },
  { id: '3h-k', text: 'номер буквы = часы × 3 − число «пятиминуток»', f: (h, k) => 3 * h - k },
  { id: 'hk', text: 'номер буквы = часы × число «пятиминуток»', f: (h, k) => h * k },
];

export interface ClockData {
  /** Правило сказано (уровни 0–1) или нет (уровень 2 — тогда есть пример). */
  rule?: string;
  example?: { word: string; times: [number, number][] };
  /** Циферблаты записки: [часы, минуты]. Пробел между словами — null. */
  times: ([number, number] | null)[];
}

/** Записки разбойников. */
const MESSAGES = [
  'ШТАБ НА ЧЕРДАКЕ', 'ЖДЁМ У ГАРАЖЕЙ', 'КЛАД ПОД ЛАВКОЙ', 'ПАРОЛЬ ЁЖИК', 'ВСЕ В ПОДВАЛ', 'БЕГИ К БЕСЕДКЕ', 'ИДИ ЗА СТРЕЛКОЙ',
  'ШТАБ У ГОЛУБЯТНИ', 'СБОР В ШЕСТЬ', 'КАЗАКИ ИДУТ', 'ПРЯЧЬСЯ В СИРЕНИ', 'ВЕЧЕРОМ НА ЛАВОЧКЕ', 'МЯЧ НА КРЫШЕ', 'БАБКА СМОТРИТ',
];
const EXAMPLES = ['МЕЛ', 'ДВОР', 'ЛАВКА', 'КЛАД', 'ШТАБ', 'ГАРАЖ', 'САРАЙ', 'ПАРОЛЬ'];

const norm = (s: string) => s.toUpperCase().replace(/Ё/g, 'Е').replace(/[^А-Я ]/g, '').replace(/\s+/g, ' ').trim();

/** Все [часы, минуты], дающие букву по правилу. */
function waysFor(r: Rule, n: number): [number, number][] {
  const out: [number, number][] = [];
  for (let h = 1; h <= 12; h++) for (let k = 0; k < 12; k++) if (r.f(h, k) === n) out.push([h, k * 5]);
  return out;
}

const decodeWith = (r: Rule, times: ([number, number] | null)[]) =>
  times.map((t) => (t ? ABC[r.f(t[0], t[1] / 5) - 1] ?? '?' : ' ')).join('');

function encode(r: Rule, text: string, rng: Rng): ([number, number] | null)[] | null {
  const out: ([number, number] | null)[] = [];
  for (const ch of norm(text)) {
    if (ch === ' ') {
      out.push(null);
      continue;
    }
    const ways = waysFor(r, ABC.indexOf(ch) + 1);
    if (!ways.length) return null;
    out.push(ways[rng.int(ways.length)]);
  }
  return out;
}

/** Правило шифра: сказано или узнаётся по примеру. */
export const ruleOf = (d: ClockData): Rule =>
  (d.rule ? RULES.find((x) => x.text === d.rule) : RULES.find((x) => d.example && decodeWith(x, d.example.times) === d.example.word)) ?? RULES[0];

export const solveClock = (d: ClockData): string => decodeWith(ruleOf(d), d.times);

export const checkClock = (sol: string, a: unknown) => typeof a === 'string' && norm(a).replace(/ /g, '') === norm(sol).replace(/ /g, '');

/** Уровень: 0 — «часы + пятиминутки», одно-два слова; 1 — правило посложнее; 2 — правило по примеру. */
export function genClock(level: number, rng: Rng): { data: ClockData; sol: string } {
  for (let attempt = 0; attempt < 300; attempt++) {
    const rule = level === 0 ? RULES[0] : RULES[1 + rng.int(RULES.length - 1)];
    const msgs = MESSAGES.filter((m) => (level === 0 ? m.split(' ').length <= 3 && m.length <= 14 : true));
    const msg = norm(msgs[rng.int(msgs.length)]);
    const times = encode(rule, msg, rng);
    if (!times) continue;
    if (level < 2) return { data: { rule: rule.text, times }, sol: msg };
    // трудная: пример, по которому правило узнаётся однозначно
    for (const ex of shuffle(EXAMPLES, rng)) {
      const et = encode(rule, ex, rng);
      if (!et) continue;
      if (RULES.filter((r) => decodeWith(r, et) === ex).length !== 1) continue;
      return { data: { example: { word: ex, times: et as [number, number][] }, times }, sol: msg };
    }
  }
  throw new Error('шифр по часам: не сложилось');
}
