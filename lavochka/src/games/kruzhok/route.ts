/* Шахматный кружок — личный маршрут от Михалыча (docs/analysis/chess-kruzhok.md, этап 7). Здесь — без DOM:
 * профиль ученика (слабые темы задач, частые ошибки в своих партиях, где встал учебник) и кандидаты из базы
 * кружка с id — уроки, подборки задач по теме, этюды, партии мастеров, свои ошибочные позиции. Михалыч получает
 * профиль и кандидатов и выбирает из них шаги маршрута (сервер — server/mihalych.ts, route): выдумать материал
 * он не может — сервер оставляет только id из списка. */
import type { MistakeKind, MyGame } from './mygames';
import { THEME_LESSON, themeName } from './themes';

export interface RouteItem {
  /** lesson:<id> · drill:<тема> · etude:<id> · game:<id> · mine:<время партии>:<полуход> */
  id: string;
  title: string;
  /** Почему предлагается — факт для Михалыча. */
  why: string;
}

export interface RouteStep {
  id: string;
  /** Что сказал Михалыч про этот шаг. */
  say: string;
}

export interface Route {
  at: number;
  intro: string;
  steps: RouteStep[];
  /** Кандидаты, из которых он выбирал (названия шагов — отсюда). */
  items: RouteItem[];
  /** Пройденные шаги. */
  done: string[];
}

export interface RouteInput {
  rating: number;
  /** id задачи → 1 с первого раза, 0 с ошибкой. */
  solved: Record<string, 0 | 1>;
  /** id задачи → темы. */
  themesOf: Map<string, string[]>;
  lessons: { id: string; title: string; part: string; n: number }[];
  lessonsDone: Record<string, 1>;
  games: MyGame[];
  etudes: { id: string; title: string; author: string; level: number }[];
  etudesDone: Record<string, 0 | 1>;
  classics: { id: string; title: string; white: string; black: string; year: number }[];
  classicsSeen: Record<string, unknown>;
}

export const KIND_RU: Record<MistakeKind, string> = {
  hang: 'зевок фигуры (соперник сразу забирает)',
  tactic: 'упущенный тактический удар',
  mate: 'упущенный мат или проглядел мат себе',
  endgame: 'неточность в эндшпиле',
  opening: 'ошибка в дебюте',
  other: 'позиционная ошибка в середине партии',
};

/** Тема задач и урок, которые лечат тип ошибки в партиях. */
const KIND_THEME: Record<MistakeKind, string | null> = { hang: 'hangingPiece', tactic: 'fork', mate: 'mateIn2', endgame: 'endgame', opening: 'opening', other: null };

export interface Profile {
  /** Темы: попыток, с ошибкой; только где решено хотя бы 4. */
  themes: { id: string; name: string; n: number; bad: number }[];
  /** Слабые — доля ошибок заметно выше средней. */
  weak: string[];
  errRate: number;
  mistakes: Partial<Record<MistakeKind, number>>;
  reviewed: number;
  myMoves: number;
  results: { win: number; draw: number; loss: number };
  nextLesson: { id: string; title: string; n: number } | null;
  lessonsDone: number;
}

export function buildProfile(x: RouteInput): Profile {
  const per = new Map<string, { n: number; bad: number }>();
  let all = 0;
  let bad = 0;
  for (const [id, v] of Object.entries(x.solved)) {
    all++;
    if (!v) bad++;
    for (const t of x.themesOf.get(id) ?? []) {
      const r = per.get(t) ?? { n: 0, bad: 0 };
      r.n++;
      if (!v) r.bad++;
      per.set(t, r);
    }
  }
  const errRate = all ? bad / all : 0;
  const themes = [...per.entries()]
    .filter(([id, r]) => r.n >= 4 && themeName(id))
    .map(([id, r]) => ({ id, name: themeName(id)!, ...r }))
    .sort((a, b) => b.bad / b.n - a.bad / a.n);
  const weak = themes.filter((t) => t.bad / t.n >= errRate + 0.12 && t.bad >= 2).map((t) => t.id);
  const mistakes: Profile['mistakes'] = {};
  let reviewed = 0;
  let myMoves = 0;
  const results = { win: 0, draw: 0, loss: 0 };
  for (const g of x.games) {
    results[g.result === 1 ? 'win' : g.result === 0 ? 'loss' : 'draw']++;
    if (!g.review) continue;
    reviewed++;
    myMoves += g.review.mine;
    for (const m of g.review.mistakes) mistakes[m.kind] = (mistakes[m.kind] ?? 0) + 1;
  }
  const next = [...x.lessons].sort((a, b) => a.n - b.n).find((l) => !x.lessonsDone[l.id]) ?? null;
  return { themes, weak, errRate, mistakes, reviewed, myMoves, results, nextLesson: next && { id: next.id, title: next.title, n: next.n }, lessonsDone: Object.keys(x.lessonsDone).length };
}

/** Профиль словами — для Михалыча и для показа ученику без подписки. */
export function profileText(p: Profile, rating: number): string {
  const out: string[] = [`Рейтинг в задачах: ${rating}. Ошибок в задачах в среднем: ${Math.round(p.errRate * 100)}%.`];
  if (p.themes.length) out.push('Темы задач (решено / с ошибкой): ' + p.themes.slice(0, 8).map((t) => `${t.name} ${t.n}/${t.bad}`).join('; ') + '.');
  if (p.weak.length) out.push('Слабые темы: ' + p.weak.map((t) => themeName(t)).join(', ') + '.');
  const games = p.results.win + p.results.draw + p.results.loss;
  if (games) out.push(`Партии с компьютером: ${games} (побед ${p.results.win}, ничьих ${p.results.draw}, поражений ${p.results.loss}).`);
  const ms = Object.entries(p.mistakes).sort((a, b) => b[1] - a[1]) as [MistakeKind, number][];
  if (p.reviewed && ms.length) out.push(`Ошибки в своих партиях (разобрано ${p.reviewed}, ходов ${p.myMoves}): ` + ms.map(([k, n]) => `${KIND_RU[k]} — ${n}`).join('; ') + '.');
  else if (p.reviewed) out.push(`В разобранных партиях (${p.reviewed}) крупных ошибок движок не нашёл.`);
  out.push(p.nextLesson ? `Учебник: пройдено уроков ${p.lessonsDone}, следующий — №${p.nextLesson.n} «${p.nextLesson.title}».` : `Учебник пройден весь.`);
  return out.join('\n');
}

/** Кандидаты в маршрут: что есть в базе под слабые места ученика (не больше 24). */
export function routeItems(x: RouteInput, p: Profile): RouteItem[] {
  const items: RouteItem[] = [];
  const has = new Set<string>();
  const add = (it: RouteItem) => {
    if (has.has(it.id) || items.length >= 24) return;
    has.add(it.id);
    items.push(it);
  };
  const lessonBy = new Map(x.lessons.map((l) => [l.id, l]));
  const lessonFor = (theme: string, why: string) => {
    const l = lessonBy.get(THEME_LESSON[theme] ?? '');
    if (l) add({ id: `lesson:${l.id}`, title: `Урок ${l.n}. ${l.title}`, why: `${why}${x.lessonsDone[l.id] ? ' (урок уже пройден — повторить)' : ''}` });
  };
  // слабые темы задач
  for (const t of p.weak.slice(0, 4)) {
    const r = p.themes.find((q) => q.id === t)!;
    lessonFor(t, `тема «${r.name}»: ${r.bad} ошибок из ${r.n} задач`);
    add({ id: `drill:${t}`, title: `Задачи: ${r.name}`, why: `тема «${r.name}»: ${r.bad} ошибок из ${r.n}` });
  }
  // частые ошибки в своих партиях
  const kinds = (Object.entries(p.mistakes) as [MistakeKind, number][]).sort((a, b) => b[1] - a[1]);
  for (const [k, n] of kinds.slice(0, 3)) {
    const t = KIND_THEME[k];
    if (t) {
      lessonFor(t, `в своих партиях: ${KIND_RU[k]} — ${n} раз`);
      if (themeName(t)) add({ id: `drill:${t}`, title: `Задачи: ${themeName(t)}`, why: `в своих партиях: ${KIND_RU[k]} — ${n} раз` });
    }
    if (k === 'endgame') for (const l of x.lessons.filter((q) => q.part === 'Эндшпиль' && !x.lessonsDone[q.id]).slice(0, 2)) add({ id: `lesson:${l.id}`, title: `Урок ${l.n}. ${l.title}`, why: `неточности в эндшпиле — ${n} раз` });
    if (k === 'opening') for (const l of x.lessons.filter((q) => q.part === 'Дебют' && !x.lessonsDone[q.id]).slice(0, 2)) add({ id: `lesson:${l.id}`, title: `Урок ${l.n}. ${l.title}`, why: `ошибки в дебюте — ${n} раз` });
  }
  // свои ошибочные позиции — посмотреть с движком (самые дорогие из последних партий)
  const mine = x.games
    .flatMap((g) => (g.review?.mistakes ?? []).map((m) => ({ g, m })))
    .sort((a, b) => b.m.loss - a.m.loss)
    .slice(0, 3);
  for (const { g, m } of mine) add({ id: `mine:${g.at}:${m.ply}`, title: `Своя партия от ${new Date(g.at).toLocaleDateString('ru-RU')}, ${Math.floor(m.ply / 2) + 1}-й ход`, why: `${KIND_RU[m.kind]}, потеря ≈ ${(m.loss / 100).toFixed(1)} пешки` });
  // следующий урок по порядку
  if (p.nextLesson) add({ id: `lesson:${p.nextLesson.id}`, title: `Урок ${p.nextLesson.n}. ${p.nextLesson.title}`, why: 'следующий непройденный урок учебника' });
  // этюды и партии мастеров по уровню
  const lv = x.rating < 1200 ? 1 : x.rating < 1700 ? 2 : 3;
  for (const e of x.etudes.filter((q) => !(q.id in x.etudesDone) && q.level <= lv).slice(0, 2)) add({ id: `etude:${e.id}`, title: `Этюд: ${e.title} (${e.author})`, why: 'этюд по силам — тренирует счёт вариантов и точность в эндшпиле' });
  for (const c of x.classics.filter((q) => !(q.id in x.classicsSeen)).slice(0, 2)) add({ id: `game:${c.id}`, title: `Партия: ${c.title} (${c.white} — ${c.black}, ${c.year})`, why: 'партия мастера с вопросами «А как сходил бы ты?» — учит видеть идеи' });
  return items;
}
