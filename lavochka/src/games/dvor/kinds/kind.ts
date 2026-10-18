/* Тип задачи «А у нас во дворе»: генератор, проверка, подсказки, решатель для бота. Без DOM.
 * Условие (data) уходит игроку; решение (sol) остаётся на сервере. Бот решает сам — по data. */
import type { Rng } from '../../../core/types';

export interface Hint {
  text: string;
  /** Что открыть на поле (своё у каждого типа: клетка хидато, доска хаси, строка таблицы). */
  reveal?: unknown;
}

export interface GenCtx {
  /** Имена ребят для условия. */
  names: string[];
  /** Повод — этап олимпиады (дворовая игра), к которому подбирается оформление. */
  stage: string;
}

export interface Kind<D = any, S = any, A = any> {
  id: string;
  /** Короткое имя типа: «Классики». */
  title: string;
  /** Как решать — одна-две фразы над полем. */
  how: string;
  /** Норматив, секунды, по уровням 0–2. */
  par: [number, number, number];
  /** Очки за верное решение по уровням. */
  pts: [number, number, number];
  gen(level: number, rng: Rng, ctx: GenCtx): { data: D; sol: S };
  check(data: D, sol: S, ans: A): boolean;
  /** k-я подсказка (с нуля); null — подсказок больше нет. */
  hint(data: D, sol: S, k: number, rng: Rng): Hint | null;
  /** Решение по одному условию — так решает бот. */
  solve(data: D): A;
}

export const LEVELS = ['лёгкая', 'средняя', 'трудная'];
