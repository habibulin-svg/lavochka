/* Данетки — база (data.json собирает tools/danetki/build.mjs): история, разгадка, сценарий ведущего — готовые вопросы с ответами,
 * подсказки по нарастающей и четыре варианта разгадки (первый — верный). Без DOM. */
import RAW from './data.json';

export type Ans = 'y' | 'n' | 'i';

export interface Danetka {
  id: number;
  title: string;
  /** 1 — лёгкая, 2 — средняя, 3 — трудная. */
  level: number;
  kids: boolean;
  story: string;
  answer: string;
  short: string;
  hints: string[];
  /** Готовые вопросы: ответ ведущего и (у «да») что этим выяснили. */
  questions: { q: string; a: Ans; f?: string }[];
  options: string[];
}

export const DANETKI = RAW as unknown as Danetka[];
const BY_ID = new Map(DANETKI.map((d) => [d.id, d]));
export const danetka = (id: number) => BY_ID.get(id);
