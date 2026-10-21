/* Шахматный кружок — «Путь»: сквозной сценарий обучения (docs/analysis/kruzhok-put.md). Без DOM.
 * Узлы по частям учебника: урок → задачи на закрепление (если у урока есть темы) → в конце части партия мастера
 * и зачёт. Звёзды кружка — видимая награда за всё, что ученик делает в кружке; грамота — за сданный зачёт. */
import { store } from '../../core/settings';
import type { LessonInfo } from './data';
import { touch } from './cloud';

/** Записать часть журнала кружка (и отметить для копии в базе). */
const putJournal = (key: string, v: unknown) => {
  store.set(key, v);
  touch();
};

export type NodeKind = 'lesson' | 'drill' | 'game' | 'exam';

export interface PathNode {
  id: string;
  kind: NodeKind;
  part: string;
  title: string;
  /** Урок (для lesson и drill). */
  lesson?: LessonInfo;
  /** Партия мастера (для game). */
  game?: string;
  /** Темы задач и потолок рейтинга (drill и exam), сколько задач решить. */
  themes?: string[];
  max?: number;
  count?: number;
}

/** Партия мастера в конце части: по теме части. */
const PART_GAME: Record<string, { id: string; title: string }> = {
  Правила: { id: 'morphy-opera-1858', title: 'Партия в опере' },
  'Первые маты': { id: 'reti-tartakower-1910', title: 'Рети — Тартаковер' },
  Тактика: { id: 'lasker-bauer-1889', title: 'Ласкер — Бауэр' },
  Эндшпиль: { id: 'capablanca-tartakower-1924', title: 'Капабланка — Тартаковер' },
  Дебют: { id: 'anderssen-dufresne-1852', title: 'Вечнозелёная партия' },
  Стратегия: { id: 'botvinnik-capablanca-1938', title: 'Ботвинник — Капабланка' },
};

export const DRILL_COUNT = 5;
export const EXAM_COUNT = 10;

/** Узлы пути по оглавлению учебника. */
export function buildPath(lessons: LessonInfo[]): PathNode[] {
  const out: PathNode[] = [];
  const parts = [...new Set(lessons.map((l) => l.part))];
  for (const part of parts) {
    const ls = lessons.filter((l) => l.part === part).sort((a, b) => a.n - b.n);
    const themes = new Set<string>();
    let max = 0;
    for (const l of ls) {
      out.push({ id: `l:${l.id}`, kind: 'lesson', part, title: `${l.n}. ${l.title}`, lesson: l });
      if (l.drill?.themes.length) {
        out.push({ id: `d:${l.id}`, kind: 'drill', part, title: `Задачи: ${l.title.toLowerCase()}`, lesson: l, themes: l.drill.themes, max: l.drill.max, count: DRILL_COUNT });
        l.drill.themes.forEach((t) => themes.add(t));
        max = Math.max(max, l.drill.max ?? 1500);
      }
    }
    const g = PART_GAME[part];
    if (g) out.push({ id: `g:${g.id}`, kind: 'game', part, title: `Партия мастера: ${g.title}`, game: g.id });
    if (themes.size) out.push({ id: `z:${part}`, kind: 'exam', part, title: `Зачёт: ${part.toLowerCase()}`, themes: [...themes], max, count: EXAM_COUNT });
  }
  return out;
}

// ---------------------------------------------------------------- прогресс и звёзды

interface PathProgress {
  /** Пройденные узлы: id → звёзды за узел. */
  done: Record<string, number>;
  /** Звёзды кружка всего. */
  stars: number;
  /** Грамоты: часть → дата. */
  diplomas: Record<string, string>;
}

const KEY = 'kruzhok.path';
const fresh = (): PathProgress => ({ done: {}, stars: 0, diplomas: {} });
export const loadPath = (): PathProgress => ({ ...fresh(), ...store.get<Partial<PathProgress>>(KEY, {}) });
export const resetPath = () => putJournal(KEY, fresh());

type Listener = (n: number, why: string) => void;
const listeners = new Set<Listener>();
/** Подписка на звёзды (всплывающее «+N» на экране). */
export function onStars(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Дать звёзды (за ход, задачу, урок…). */
export function addStars(n: number, why: string) {
  if (n <= 0) return;
  const p = loadPath();
  p.stars += n;
  putJournal(KEY, p);
  listeners.forEach((f) => f(n, why));
}

/** Отметить узел пути пройденным (один раз) и дать за него звёзды. */
export function completeNode(id: string, stars: number, why: string) {
  const p = loadPath();
  if (id in p.done) return false;
  p.done[id] = stars;
  if (id.startsWith('z:')) p.diplomas[id.slice(2)] = new Date().toLocaleDateString('ru-RU');
  putJournal(KEY, p);
  addStars(stars, why);
  return true;
}

/** Успехи, сделанные до «Пути» (урок пройден в учебнике, все вопросы партии отвечены), — отметить на пути без звёзд. */
export function syncPath(nodes: PathNode[], lessonsDone: Record<string, 1>, answers: Record<string, Record<string, 0 | 1>>, stops: Record<string, number>) {
  const p = loadPath();
  let changed = false;
  for (const n of nodes) {
    if (n.id in p.done) continue;
    const ok = (n.kind === 'lesson' && lessonsDone[n.lesson!.id]) || (n.kind === 'game' && stops[n.game!] && Object.keys(answers[n.game!] ?? {}).length >= stops[n.game!]);
    if (ok) {
      p.done[n.id] = 0;
      changed = true;
    }
  }
  if (changed) putJournal(KEY, p);
}

/** Первый не пройденный узел — «Дальше». */
export const nextNode = (nodes: PathNode[], done: Record<string, number>) => nodes.find((n) => !(n.id in done)) ?? null;

/** Доля пройденного в части. */
export function partShare(nodes: PathNode[], done: Record<string, number>, part: string) {
  const ns = nodes.filter((n) => n.part === part);
  return { done: ns.filter((n) => n.id in done).length, total: ns.length };
}
