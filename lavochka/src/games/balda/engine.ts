/* Балда — движок без DOM.
 * Поле n×n, в средней строке — начальное слово. Ход: поставить одну букву в пустую клетку рядом с занятой и прочитать слово
 * цепочкой соседних клеток (по сторонам; по настройке — и по диагонали), каждая клетка — не больше раза, новая буква — в цепочке.
 * Слово — существительное из словаря, в партии ещё не было. Очко за каждую букву слова. Конец — поле заполнено,
 * или все подряд пропустили ход, или сдались все, кроме одного. Побеждает набравший больше очков. */
import type { Options, Rng } from '../../core/types';
import { clone } from '../../core/util';
import { ALPHABET, hasWord, norm, wordsOfLength } from '../../words/dict';

export interface Cfg {
  size: number;
  diag: boolean;
  /** Минимальная длина слова. */
  min: number;
}

export function cfgFrom(o: Options): Cfg {
  const size = [5, 6, 7].includes(Number(o.size)) ? Number(o.size) : 5;
  return { size, diag: o.diag === true, min: Number(o.min) === 3 ? 3 : 2 };
}

export interface Player {
  seat: number;
  score: number;
  words: string[];
  out: boolean;
}

export interface State {
  cfg: Cfg;
  grid: string[];
  start: string;
  players: Player[];
  cur: number;
  /** Все слова партии, включая начальное. */
  used: string[];
  /** Пропусков подряд. */
  passes: number;
  last: { cell: number; path: number[] } | null;
  over: boolean;
}

export type Action = { type: 'word'; cell: number; letter: string; path: number[] } | { type: 'pass' } | { type: 'resign' };

export type Event =
  | { type: 'word'; seat: number; cell: number; letter: string; path: number[]; word: string; points: number }
  | { type: 'pass'; seat: number }
  | { type: 'resign'; seat: number }
  | { type: 'end'; reason: 'full' | 'passes' | 'resign' };

/** Начальные слова — обиходные, чтобы не начинать с «абвера». Остальное берётся из словаря, если списка не хватит. */
const STARTS: Record<number, string[]> = {
  5: 'балда книга ручка школа птица рыбак город лампа ветер лодка кошка мышка дождь сосна берег поезд олень доска спорт парта зебра бочка ложка вилка чашка марка пирог сахар масло рынок замок кубик мячик сумка шапка слово буква топор совок пенал лимон арбуз банан груша слива океан озеро гроза туман огонь вагон батон гараж мелок ранец'.split(' '),
  6: 'собака камень радуга дерево корова машина ракета звезда гитара костер поляна лопата молоко пряник сказка улитка дворик скамья карман кружка фонарь огурец яблоко газета окошко балкон подвал чердак картон бумага ластик'.split(' '),
  7: 'лавочка мальчик девочка тетрадь морковь капуста пароход учебник крыльцо бабушка дедушка самолет телефон вратарь пирожок автобус трамвай ромашка колокол котенок сверчок рогатка'.split(' '),
};

export function startWords(n: number): string[] {
  const own = STARTS[n].filter(hasWord);
  return own.length ? own : wordsOfLength(n);
}

export function newGame(seats: number[], cfg: Cfg, rng: Rng, start?: string): State {
  const n = cfg.size;
  const pool = startWords(n);
  const word = start ?? pool[rng.int(pool.length)];
  const grid = Array<string>(n * n).fill('');
  const row = Math.floor(n / 2);
  for (let i = 0; i < n; i++) grid[row * n + i] = word[i];
  return {
    cfg: { ...cfg },
    grid,
    start: word,
    players: seats.map((seat) => ({ seat, score: 0, words: [], out: false })),
    cur: 0,
    used: [word],
    passes: 0,
    last: null,
    over: false,
  };
}

export function neighbors(cfg: Cfg, c: number): number[] {
  const n = cfg.size;
  const r = Math.floor(c / n);
  const f = c % n;
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++)
    for (let df = -1; df <= 1; df++) {
      if (!dr && !df) continue;
      if (dr && df && !cfg.diag) continue;
      const rr = r + dr;
      const ff = f + df;
      if (rr >= 0 && rr < n && ff >= 0 && ff < n) out.push(rr * n + ff);
    }
  return out;
}

/** Клетки, куда можно поставить букву: пустые рядом с занятой. */
export function openCells(s: State): number[] {
  const out: number[] = [];
  for (let c = 0; c < s.grid.length; c++) if (!s.grid[c] && neighbors(s.cfg, c).some((x) => s.grid[x])) out.push(c);
  return out;
}

export type Verdict = { ok: true; word: string } | { ok: false; why: string };

/** Проверка хода с объяснением — для подсказки игроку. */
export function check(s: State, a: { cell: number; letter: string; path: number[] }): Verdict {
  const letter = norm(a.letter ?? '');
  if (letter.length !== 1 || !ALPHABET.includes(letter)) return { ok: false, why: 'Нужна одна русская буква.' };
  if (!openCells(s).includes(a.cell)) return { ok: false, why: 'Букву ставят в пустую клетку рядом с буквами.' };
  const path = a.path;
  if (!Array.isArray(path) || path.length < s.cfg.min) return { ok: false, why: `Слово — не короче ${s.cfg.min} букв.` };
  if (new Set(path).size !== path.length) return { ok: false, why: 'Клетку нельзя брать дважды.' };
  if (!path.includes(a.cell)) return { ok: false, why: 'Новая буква должна войти в слово.' };
  const g = s.grid.slice();
  g[a.cell] = letter;
  for (let i = 0; i < path.length; i++) {
    if (!(path[i] >= 0 && path[i] < g.length) || !g[path[i]]) return { ok: false, why: 'Слово читают только по буквам.' };
    if (i && !neighbors(s.cfg, path[i - 1]).includes(path[i])) return { ok: false, why: s.cfg.diag ? 'Буквы слова должны быть соседними.' : 'Буквы слова — соседние по сторонам, не по диагонали.' };
  }
  const word = path.map((c) => g[c]).join('');
  if (s.used.includes(word)) return { ok: false, why: `«${word}» уже было.` };
  if (!hasWord(word)) return { ok: false, why: `«${word}» нет в словаре.` };
  return { ok: true, word };
}

export const toAct = (s: State) => (s.over ? [] : [s.players[s.cur].seat]);

function nextPlayer(s: State) {
  for (let k = 1; k <= s.players.length; k++) {
    const i = (s.cur + k) % s.players.length;
    if (!s.players[i].out) {
      s.cur = i;
      return;
    }
  }
}

const alive = (s: State) => s.players.filter((p) => !p.out);

export function apply(s0: State, seat: number, a: Action): { state: State; events: Event[] } | null {
  if (s0.over || s0.players[s0.cur].seat !== seat || !a) return null;
  const s = clone(s0);
  const pl = s.players[s.cur];
  const events: Event[] = [];
  if (a.type === 'word') {
    const v = check(s, a);
    if (!v.ok) return null;
    s.grid[a.cell] = norm(a.letter);
    s.used.push(v.word);
    pl.words.push(v.word);
    pl.score += v.word.length;
    s.passes = 0;
    s.last = { cell: a.cell, path: a.path.slice() };
    events.push({ type: 'word', seat, cell: a.cell, letter: norm(a.letter), path: a.path.slice(), word: v.word, points: v.word.length });
    if (s.grid.every((x) => x)) {
      s.over = true;
      events.push({ type: 'end', reason: 'full' });
    } else nextPlayer(s);
  } else if (a.type === 'pass') {
    s.passes++;
    events.push({ type: 'pass', seat });
    if (s.passes >= alive(s).length) {
      s.over = true;
      events.push({ type: 'end', reason: 'passes' });
    } else nextPlayer(s);
  } else if (a.type === 'resign') {
    pl.out = true;
    events.push({ type: 'resign', seat });
    if (alive(s).length <= 1) {
      s.over = true;
      events.push({ type: 'end', reason: 'resign' });
    } else {
      s.passes = 0;
      nextPlayer(s);
    }
  } else return null;
  return { state: s, events };
}

/** Победители: лучшие по очкам среди не сдавшихся. */
export function winners(s: State): number[] {
  const live = alive(s);
  const best = Math.max(...live.map((p) => p.score));
  return live.filter((p) => p.score === best).map((p) => p.seat);
}
