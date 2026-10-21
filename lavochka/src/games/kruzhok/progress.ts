/* Шахматный кружок — журнал ученика на этом устройстве: рейтинг в задачах, решённые задачи, серия, дни занятий.
 * (Для вошедших позже — копия в базе.) */
import { store } from '../../core/settings';
import { START, update, type Rating } from './rating';

export interface Progress {
  rating: Rating;
  /** id задачи → 1 решена с первого раза, 0 — с ошибкой или подсказкой. */
  solved: Record<string, 0 | 1>;
  /** Решено подряд без ошибок (текущая серия и лучшая). */
  streak: number;
  best: number;
  /** История рейтинга: [время, рейтинг], последние 300 задач. */
  history: [number, number][];
  /** Дни занятий: 'ГГГГ-ММ-ДД' → сколько задач. */
  days: Record<string, number>;
}

const KEY = 'kruzhok.progress';
const fresh = (): Progress => ({ rating: { ...START }, solved: {}, streak: 0, best: 0, history: [], days: {} });

export function loadProgress(): Progress {
  return { ...fresh(), ...store.get<Partial<Progress>>(KEY, {}) };
}

const save = (p: Progress) => store.set(KEY, p);
const today = (now: number) => new Date(now).toLocaleDateString('sv-SE', { timeZone: 'Europe/Moscow' });

/** Записать задачу; рейтинг меняется только за первую попытку. Возвращает новый журнал и изменение рейтинга. */
export function recordPuzzle(p: Progress, id: string, puzzleRating: number, win: boolean, now = Date.now()) {
  const first = !(id in p.solved);
  const before = p.rating.r;
  const n: Progress = { ...p, solved: { ...p.solved, [id]: win ? 1 : 0 }, days: { ...p.days } };
  if (first) {
    n.rating = update(p.rating, puzzleRating, win, now);
    n.history = [...p.history, [now, n.rating.r] as [number, number]].slice(-300);
  }
  n.streak = win ? p.streak + 1 : 0;
  n.best = Math.max(p.best, n.streak);
  const d = today(now);
  n.days[d] = (n.days[d] ?? 0) + 1;
  save(n);
  return { progress: n, delta: n.rating.r - before, first };
}

/** Сколько дней подряд (по сегодня или вчера) были занятия. */
export function dayStreak(p: Progress, now = Date.now()): number {
  let n = 0;
  let t = now;
  if (!p.days[today(t)]) t -= 86400_000;
  while (p.days[today(t)]) {
    n++;
    t -= 86400_000;
  }
  return n;
}

export function resetProgress() {
  save(fresh());
}
