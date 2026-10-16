/* Крокодил — что показывают и как это понимают. Слова — словарь «Шляпы» (hat/words: 15 тыс. существительных трёх уровней,
 * толкования из базы кроссвордных вопросов), пословицы и фильмы — phrases.ts, эмодзи с русскими подписями — emoji.json
 * (Unicode CLDR, tools/crocodile/build.mjs).
 *
 * Жестов бот не видит и не показывает. Вместо пантомимы у него карточки — то, что изобразил бы мим, от общего к точному:
 * «слогов столько-то» (пальцами по руке), эмодзи-картинка, толкования, синоним; у пословицы и фильма — «слов столько-то»
 * и слова по одному. Угадывает бот честно, только по показанным карточкам: перебирает слова и фразы, которые к ним подходят.
 * Без DOM. */
import { byHint, hintsFor, norm, poolFor, WORDS, type HintKind } from '../hat/words';
import RAW from './emoji.json';
import { FILMS, PROVERBS } from './phrases';

export { norm };

/** Что показывают: слово из словаря, пословица, фильм, своё (написал загадывающий). */
export type Kind = 'w' | 'p' | 'f' | 'o';
export interface Item {
  k: Kind;
  i: number;
  /** Своё слово — текст. */
  text?: string;
}

export type Card =
  /** «Слогов: n» — пальцами по руке. */
  | { k: 'syl'; n: number }
  /** Эмодзи-картинки (у бота — то, что он изобразил бы; в «эмодзи-крокодиле» — выбранные показывающим). */
  | { k: 'emo'; es: string[] }
  /** «Что это» — толкование (как показал бы мим: летает, гудит, на нём летают). */
  | { k: 'clue'; kind: HintKind; text: string }
  /** Фраза: «слов: n». */
  | { k: 'words'; n: number }
  /** Фраза: показал слово № pos (с единицы). */
  | { k: 'word'; pos: number; w: string };

export const KIND_NAME: Record<Kind, string> = { w: 'слово', p: 'пословица', f: 'фильм', o: 'слово' };

const phraseList = (k: Kind) => (k === 'p' ? PROVERBS : FILMS);
/** Как можно назвать: первым — как пишется. */
export function aliases(it: Item): string[] {
  if (it.k === 'w') return [WORDS[it.i]?.w ?? '?'];
  if (it.k === 'o') return [it.text ?? '?'];
  return (phraseList(it.k)[it.i] ?? '?').split('|');
}
export const itemText = (it: Item) => aliases(it)[0];
export const itemKey = (it: Item) => (it.k === 'o' ? `o:${norm(it.text ?? '')}` : `${it.k}:${it.i}`);
/** Сложность 1–3 (у фраз — средняя). */
export const itemLevel = (it: Item) => (it.k === 'w' ? (WORDS[it.i]?.d ?? 2) : 2);

/** Слова фразы — для показа по одному (без знаков препинания, как пишутся). */
export const tokensOf = (s: string) =>
  s
    .replace(/[«»"“”„!?.,:;…()]/g, ' ')
    .replace(/\s[—–-]\s/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

const VOWELS = /[аеёиоуыэюя]/g;
export const syllables = (w: string) => (w.toLowerCase().match(VOWELS) ?? []).length;

// ---------------------------------------------------------------- эмодзи

export interface Emo {
  e: string;
  name: string;
  kw: string[];
}
export const EMOJI: Emo[] = (RAW as string[]).map((line) => {
  const [e, name, ...kw] = line.split('|');
  return { e, name, kw };
});
const EMO_SET = new Set(EMOJI.map((x) => x.e));
export const isEmoji = (e: string) => EMO_SET.has(e);

let wordEmo: Map<number, { gen: string[]; direct: string[] }> | null = null;
let emoWords: Map<string, number[]> | null = null;
function emoIndex() {
  if (wordEmo && emoWords) return { wordEmo, emoWords };
  const pos = new Map(WORDS.map((e, i) => [e.n, i]));
  const we = new Map<number, { gen: string[]; direct: string[] }>();
  const ew = new Map<string, number[]>();
  for (const x of EMOJI) {
    const list: number[] = [];
    const add = (k: string, direct: boolean) => {
      const i = pos.get(k);
      if (i == null || list.includes(i)) return;
      list.push(i);
      const r = we.get(i) ?? { gen: [], direct: [] };
      (direct ? r.direct : r.gen).push(x.e);
      we.set(i, r);
    };
    add(x.name, true);
    for (const k of x.kw) add(k, false);
    ew.set(x.e, list);
  }
  wordEmo = we;
  emoWords = ew;
  return { wordEmo, emoWords };
}
/** Эмодзи к слову: общие (слово среди ключевых) и прямые (так эмодзи и называется). */
export const emojiFor = (i: number) => emoIndex().wordEmo.get(i) ?? { gen: [], direct: [] };
/** Какие слова словаря можно узнать по эмодзи. */
export const wordsByEmoji = (e: string) => emoIndex().emoWords.get(e) ?? [];
/** Есть ли у слова хотя бы две эмодзи-картинки (для «эмодзи-крокодила»). */
const emojiFriendly = (i: number) => {
  const r = emojiFor(i);
  return r.gen.length + r.direct.length >= 2;
};

/** Поиск эмодзи для набора: по названию и ключевым словам. */
export function searchEmoji(q: string, limit = 120): Emo[] {
  const n = norm(q);
  if (!n) return EMOJI.slice(0, limit);
  const out: Emo[] = [];
  for (const x of EMOJI) if (x.name.startsWith(n)) out.push(x);
  for (const x of EMOJI) if (!out.includes(x) && (x.name.includes(n) || x.kw.some((k) => k.startsWith(n)))) out.push(x);
  return out.slice(0, limit);
}

// ---------------------------------------------------------------- колода бота

/** Карточки, которыми показывают слово (от общего к точному). style: emoji — только картинки. */
export function deckFor(it: Item, style: 'gesture' | 'emoji'): Card[] {
  if (it.k === 'o') return [];
  if (it.k === 'p' || it.k === 'f') {
    const toks = tokensOf(itemText(it));
    const order = toks.map((w, k) => ({ w, pos: k + 1 })).sort((a, b) => b.w.length - a.w.length);
    return [{ k: 'words', n: toks.length }, ...order.map((x) => ({ k: 'word' as const, pos: x.pos, w: x.w }))];
  }
  const e = WORDS[it.i];
  const em = emojiFor(it.i);
  if (style === 'emoji') {
    const out: Card[] = em.gen.slice(0, 4).map((x) => ({ k: 'emo', es: [x] }));
    if (em.direct.length) out.push({ k: 'emo', es: em.direct.slice(0, 2) });
    return out;
  }
  const out: Card[] = [{ k: 'syl', n: syllables(e.w) }];
  if (em.gen.length) out.push({ k: 'emo', es: em.gen.slice(0, 3) });
  const c = hintsFor(it.i, 0);
  const short = c.find((x) => x.kind === 'short');
  const long = c.find((x) => x.kind === 'long');
  if (short) out.push({ k: 'clue', kind: 'short', text: short.text });
  if (long) out.push({ k: 'clue', kind: 'long', text: long.text });
  if (em.direct.length) out.push({ k: 'emo', es: em.direct.slice(0, 2) });
  const one = hintsFor(it.i, 2)[0];
  if (one && !out.some((x) => x.k === 'clue' && norm(x.text) === norm(one.text))) out.push({ k: 'clue', kind: 'one', text: one.text });
  return out;
}

// ---------------------------------------------------------------- угадывание

/** Что подходит к показанному: слова/фразы с наибольшим числом совпавших карточек (без бесспорных фильтров — пусто). */
export function candidates(kind: Kind, cards: Card[]): Item[] {
  if (kind === 'o') return [];
  if (kind === 'p' || kind === 'f') {
    const list = phraseList(kind);
    const nw = cards.find((c) => c.k === 'words') as { n: number } | undefined;
    const ws = cards.filter((c): c is Extract<Card, { k: 'word' }> => c.k === 'word');
    if (!nw && !ws.length) return [];
    const out: Item[] = [];
    list.forEach((s, i) => {
      const toks = tokensOf(s.split('|')[0]).map(norm);
      if (nw && toks.length !== nw.n) return;
      if (ws.every((c) => toks[c.pos - 1] === norm(c.w))) out.push({ k: kind, i });
    });
    return out;
  }
  const score = new Map<number, number>();
  const bump = (list: number[], by: number) => {
    for (const i of new Set(list)) score.set(i, (score.get(i) ?? 0) + by);
  };
  for (const c of cards) {
    if (c.k === 'emo') bump(c.es.flatMap((e) => wordsByEmoji(e)), 1);
    else if (c.k === 'clue') bump(byHint(c.kind, c.text), 2);
  }
  const syl = cards.find((c) => c.k === 'syl') as { n: number } | undefined;
  let best = 0;
  const ok: number[] = [];
  for (const [i, sc] of score) {
    if (syl && syllables(WORDS[i].w) !== syl.n) continue;
    if (sc > best) {
      best = sc;
      ok.length = 0;
    }
    if (sc === best) ok.push(i);
  }
  return ok.map((i) => ({ k: 'w', i }));
}

// ---------------------------------------------------------------- сверка догадки

const ENDINGS = [
  'ями', 'ами', 'ого', 'его', 'ому', 'ему', 'ыми', 'ими', 'ией', 'иям', 'иях', 'ов', 'ев', 'ей', 'ой', 'ий', 'ый', 'ая', 'яя', 'ое', 'ее',
  'ые', 'ых', 'их', 'ую', 'юю', 'ым', 'им', 'ам', 'ям', 'ах', 'ях', 'ом', 'ем', 'ью', 'ия', 'ие', 'ья', 'ье', 'ки', 'а', 'я', 'ы', 'и', 'у', 'ю', 'е', 'о', 'ь', 'й',
];
/** Основа слова: без окончания (кошка, кошки, кошкой → кошк). */
export function stem(w: string): string {
  const n = norm(w).replace(/ /g, '');
  for (const e of ENDINGS) if (n.endsWith(e) && n.length - e.length >= 3) return n.slice(0, -e.length);
  return n;
}
function lev(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 3;
  const d = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0];
    d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}
const flat = (s: string) => norm(s).replace(/ /g, '');

/** Догадка: верно (как пишется, без учёта регистра, «ё», знаков), почти (другая форма, опечатка, фраза почти целиком) — решает показывающий, или нет. */
export function judge(guess: string, it: Item): 'right' | 'near' | 'no' {
  const g = flat(guess);
  if (!g) return 'no';
  const al = aliases(it);
  if (al.some((a) => flat(a) === g)) return 'right';
  for (const a of al) {
    const at = tokensOf(a).map(stem);
    const gt = tokensOf(guess).map(stem);
    if (at.length === 1 && gt.length === 1) {
      if (at[0] === gt[0] || (flat(a).length >= 5 && lev(flat(a), g) <= 1)) return 'near';
      continue;
    }
    const hit = at.filter((x) => gt.includes(x)).length;
    if (at.length > 1 && hit / at.length >= 0.7 && gt.length <= at.length + 2) return 'near';
  }
  return 'no';
}

// ---------------------------------------------------------------- что загадывать

export type Theme = 'words' | 'proverbs' | 'films' | 'mix';
export const THEMES: [Theme, string][] = [
  ['words', 'слова'],
  ['proverbs', 'пословицы и поговорки'],
  ['films', 'фильмы и мультфильмы'],
  ['mix', 'всё вперемешку'],
];

/** Все предметы темы (уровень — только для слов; «эмодзи» — только слова с картинками). */
export function poolOf(theme: Theme, level: string, style: 'gesture' | 'emoji'): { w: Item[]; p: Item[]; f: Item[] } {
  const w: Item[] = [];
  const p: Item[] = [];
  const f: Item[] = [];
  if (theme === 'words' || theme === 'mix' || style === 'emoji')
    for (const i of poolFor(level)) if (style !== 'emoji' || emojiFriendly(i)) w.push({ k: 'w', i });
  if (style !== 'emoji') {
    if (theme === 'proverbs' || theme === 'mix') PROVERBS.forEach((_, i) => p.push({ k: 'p', i }));
    if (theme === 'films' || theme === 'mix') FILMS.forEach((_, i) => f.push({ k: 'f', i }));
  }
  return { w, p, f };
}

/** Карточка словами (журнал, подписи). */
export function cardText(c: Card): string {
  switch (c.k) {
    case 'syl':
      return `слогов: ${c.n}`;
    case 'emo':
      return c.es.join(' ');
    case 'clue':
      return `«${c.text}»`;
    case 'words':
      return `слов: ${c.n}`;
    case 'word':
      return `слово ${c.pos}: «${c.w}»`;
  }
}
