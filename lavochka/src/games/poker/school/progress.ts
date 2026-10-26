/* Школа покера — прогресс ученика: звёзды за задачи урока (лучшая попытка), сыграна ли игра-закрепление, разряд по сумме
 * звёзд. Хранится на устройстве (localStorage `poker.school`), у вошедших — в профиле вместе со статистикой покера
 * (poker/cloud.ts). */
import { store } from '../../../core/settings';

export interface LessonMark {
  /** Лучший результат: 3 — без ошибок, 2 — до двух ошибок, 1 — пройдено. */
  stars: number;
  /** Задачи, решённые с первого раза в лучшей попытке. */
  first: number;
  /** Сыграна игра-закрепление. */
  played?: boolean;
  at: number;
}

export interface SchoolProgress {
  v: 1;
  at: number;
  lessons: Record<string, LessonMark>;
}

export const SCHOOL_KEY = 'poker.school';
const fresh = (): SchoolProgress => ({ v: 1, at: 0, lessons: {} });
const hooks: (() => void)[] = [];
/** Подписка на изменения (poker/cloud.ts — отправить в профиль). */
export const onSchool = (f: () => void) => hooks.push(f);

export function loadSchool(): SchoolProgress {
  const p = store.get<Partial<SchoolProgress> | null>(SCHOOL_KEY, null);
  return { ...fresh(), ...(p ?? {}), lessons: { ...(p?.lessons ?? {}) } };
}

function save(p: SchoolProgress, now: number) {
  p.at = now;
  store.set(SCHOOL_KEY, p);
  for (const f of hooks) f();
}

/** Звёзды за прохождение задач: ошибок 0 — 3, до двух — 2, больше — 1. */
export const starsFor = (mistakes: number) => (mistakes === 0 ? 3 : mistakes <= 2 ? 2 : 1);

/** Записать прохождение задач урока; оставляет лучший результат. */
export function recordLesson(id: string, tasks: number, mistakes: number, now = Date.now()): SchoolProgress {
  const p = loadSchool();
  const was = p.lessons[id];
  const stars = starsFor(mistakes);
  p.lessons[id] = { stars: Math.max(stars, was?.stars ?? 0), first: Math.max(tasks - mistakes, was?.first ?? 0), ...(was?.played ? { played: true } : {}), at: now };
  save(p, now);
  return p;
}

const PENDING = 'poker.school.pending';

/** Игра-закрепление начата: засчитается, когда партия будет доиграна (finishPending). */
export function startPending(id: string) {
  store.set(PENDING, id);
}

/** Партия покера доиграна: если это было закрепление урока — засчитать. */
export function finishPending() {
  const id = store.get<string>(PENDING, '');
  if (!id) return;
  store.set(PENDING, '');
  recordGame(id);
}

/** Игра-закрепление сыграна. */
export function recordGame(id: string, now = Date.now()): SchoolProgress {
  const p = loadSchool();
  const was = p.lessons[id];
  p.lessons[id] = { stars: was?.stars ?? 0, first: was?.first ?? 0, played: true, at: now };
  save(p, now);
  return p;
}

/** Профиль новее — взять целиком. */
export function replaceSchool(p: Partial<SchoolProgress>) {
  store.set(SCHOOL_KEY, { ...fresh(), ...p });
}

export function resetSchool() {
  save(fresh(), Date.now());
}

/** Разряды по сумме звёзд (12 уроков × 3 = 36). */
export const RANKS: [number, string][] = [
  [0, 'Новичок'],
  [4, 'Любитель'],
  [10, '3-й разряд'],
  [16, '2-й разряд'],
  [22, '1-й разряд'],
  [28, 'Кандидат в мастера'],
  [34, 'Мастер лавочки'],
];

export function rankOf(p: SchoolProgress): { stars: number; name: string; next: [number, string] | null } {
  const stars = Object.values(p.lessons).reduce((a, m) => a + (m.stars ?? 0), 0);
  let i = 0;
  while (i + 1 < RANKS.length && stars >= RANKS[i + 1][0]) i++;
  return { stars, name: RANKS[i][1], next: RANKS[i + 1] ?? null };
}
