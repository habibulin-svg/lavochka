/* Банк вопросов викторины: src/games/viktorina/bank/*.json (собирает studio/jobs/viktorina/build_bank.py из сырых файлов авторов).
 * Грузится отдельным куском (динамический import): в браузере — свой чанк, не в основном бандле; на сервере и в тестах — с диска.
 * После loadBank() доступ синхронный — движок без await (как словарь балды). У каждой записи стабильный id. */

export interface MCRec {
  id: string;
  q: string;
  /** Четыре варианта, первый — верный. */
  a: string[];
  d: number;
  t: string;
}
export interface WordRec {
  id: string;
  w: string;
  h: string;
  d: number;
  t: string;
}
export interface PollRec {
  id: string;
  q: string;
  /** Шесть ответов по убыванию: текст, сколько из 100, синонимы. */
  r: [string, number, string[]][];
  t: string;
}
export interface BoardRec {
  id: string;
  theme: string;
  t: string;
  qs: { q: string; a: string; alt: string[] }[];
}
export interface Bank {
  mc: MCRec[];
  word: WordRec[];
  poll: PollRec[];
  board: BoardRec[];
}

let B: Bank | null = null;
let loading: Promise<void> | null = null;

export function loadBank(): Promise<void> {
  loading ??= Promise.all([import('./bank/mc.json'), import('./bank/word.json'), import('./bank/poll.json'), import('./bank/board.json')])
    .then(([mc, word, poll, board]) => {
      B = { mc: mc.default as MCRec[], word: word.default as WordRec[], poll: poll.default as PollRec[], board: board.default as BoardRec[] };
    })
    .catch((e) => {
      loading = null;
      throw e;
    });
  return loading;
}

export function bank(): Bank {
  if (!B) throw new Error('Банк викторины не загружен (loadBank)');
  return B;
}

export const bankReady = () => B != null;

/** Для тестов: свой банк. */
export function setBank(b: Bank) {
  B = b;
  loading = Promise.resolve();
}
