/* Шахматный кружок — данные статикой из public/kruzhok (грузятся один раз, по требованию):
 * задачи (выборка из базы Lichess, CC0) и дебюты (справочник Lichess chess-openings, CC0). */

export interface Puzzle {
  id: string;
  /** Позиция до хода соперника. */
  fen: string;
  /** Ходы UCI: первый — соперника, дальше по очереди игрок и соперник. */
  moves: string[];
  rating: number;
  themes: string[];
}

export interface Opening {
  eco: string;
  /** Название по-английски (как в справочнике Lichess). */
  name: string;
  /** Название по-русски. */
  ru: string;
  uci: string[];
  fen: string;
}

const base = `${import.meta.env.BASE_URL}kruzhok/`;
let puzzles: Promise<Puzzle[]> | null = null;
let openings: Promise<Opening[]> | null = null;

export function loadPuzzles(): Promise<Puzzle[]> {
  puzzles ??= fetch(base + 'puzzles.json')
    .then((r) => r.json())
    .then((j: { p: [string, string, string, number, string][] }) => j.p.map(([id, fen, mv, rating, th]) => ({ id, fen, moves: mv.split(' '), rating, themes: th.split(' ') })))
    .catch((e) => {
      puzzles = null;
      throw e;
    });
  return puzzles;
}

/** Для журнала: сколько задач в каждой теме и темы каждой задачи — без самой базы задач. */
export async function loadThemeIndex(): Promise<{ total: Map<string, number>; of: Map<string, string[]> }> {
  const j = (await (await fetch(base + 'themes-index.json')).json()) as ThemeIndex;
  const total = new Map(THEMES.map((t, i) => [t.id, j.n[i] ?? 0]));
  const of = new Map(
    j.p.split(';').map((x) => {
      const [id, ix] = x.split(':');
      return [id, ix ? ix.split(',').map((i) => THEMES[+i]?.id ?? '') : []];
    }),
  );
  return { total, of };
}

/** Статья о дебюте (src/games/kruzhok/debuts.json): идея, планы, совет — для семейств с большим спросом. */
export interface Debut {
  family: string;
  /** Главная линия, UCI через пробел. */
  line: string;
  text: string[];
  tip?: string;
}

const debutFile = import.meta.glob<Debut[]>('./debuts.json', { import: 'default' });

export function loadDebuts(): Promise<Debut[]> {
  const f = debutFile['./debuts.json'];
  return f ? f().catch(() => []) : Promise.resolve([]);
}

export function loadOpenings(): Promise<Opening[]> {
  openings ??= fetch(base + 'openings.json')
    .then((r) => r.json())
    .then((j: { o: [string, string, string, string, string][] }) => j.o.map(([eco, name, uci, fen, ru]) => ({ eco, name, ru: ru || name, uci: uci.split(' '), fen })))
    .catch((e) => {
      openings = null;
      throw e;
    });
  return openings;
}

export { THEMES, THEME_LESSON, themeName } from './themes';
import { THEMES, type ThemeIndex } from './themes';

/** Классическая партия: ходы, оценки Stockfish после каждого полухода (за белых, мат — ±10000), пометки,
 * остановки «А как сходил бы ты?» и тексты (собирает tools/kruzhok/games.ts). */
export interface ClassicStop {
  /** Номер полухода (0 — первый ход белых), который надо найти. */
  ply: number;
  /** Ходы UCI, которые засчитываются. */
  good: string[];
  /** На сколько сантипешек сыгранный ход сильнее следующего по силе. */
  gap: number;
}

export interface ClassicGame {
  id: string;
  white: string;
  black: string;
  title: string;
  place: string;
  year: number;
  event: string;
  result: string;
  eco: string;
  uci: string[];
  ev: number[];
  marks: Record<string, string>;
  stops: ClassicStop[];
  /** Лучшая линия движка (русской записью) в позициях остановок и ошибок, по номеру полухода. */
  best: Record<string, string>;
  intro: string;
  /** Комментарий к полуходу (по номеру). */
  notes: Record<string, string>;
  outro: string;
  /** Дебют партии по справочнику (самая длинная совпавшая линия). */
  opening?: { ru: string; family: string };
}

export type ClassicInfo = Pick<ClassicGame, 'id' | 'white' | 'black' | 'title' | 'place' | 'year' | 'result' | 'eco'> & { plies: number; stops: number };

let classics: Promise<ClassicInfo[]> | null = null;

export function loadClassics(): Promise<ClassicInfo[]> {
  classics ??= fetch(base + 'games.json')
    .then((r) => r.json())
    .then((j: { g: ClassicInfo[] }) => j.g)
    .catch((e) => {
      classics = null;
      throw e;
    });
  return classics;
}

export const loadClassic = (id: string): Promise<ClassicGame> => fetch(`${base}games/${id}.json`).then((r) => r.json());

/** Урок учебника (формат — docs/analysis/kruzhok-uchebnik.md; проверка — tools/kruzhok/lessons-check.ts). */
export interface LessonStep {
  text: string;
  fen?: string;
  /** «e2e4» или «e2e4:good|bad|hint|info». */
  arrows?: string[];
  /** «e4» или «e4:good|bad|hint|info». */
  marks?: string[];
  /** Ходы UCI, которые доска показывает после текста. */
  play?: string[];
  /** Ученик делает ход сам. */
  try?: { good: string[]; say?: string; hint?: string; reply?: string };
  /** «Собери звёздочки»: белые ходят подряд, чёрные стоят; собрать звёзды на полях и съесть все чёрные фигуры. */
  stars?: { at: string[]; say?: string; hint?: string };
  /** «Доиграй против движка»: queen — провести пешку в ферзи (и не отдать), mate — поставить мат,
   *  draw — продержаться moves ходов (по умолчанию 12) или добиться ничьей. Ученик играет за сторону, чей ход в fen. */
  fight?: { goal: 'queen' | 'mate' | 'draw'; moves?: number; say?: string; hint?: string };
}

export interface Lesson {
  id: string;
  n: number;
  part: string;
  title: string;
  goal: string;
  steps: LessonStep[];
  summary: string;
  drill?: { themes: string[]; max?: number };
}

export type LessonInfo = Pick<Lesson, 'id' | 'n' | 'part' | 'title' | 'goal' | 'drill'> & { file: string };

const lessonFiles = import.meta.glob<Lesson>('./lessons/[0-9]*.json', { import: 'default' });

/** Оглавление учебника — по файлам уроков (номер и id — из имени «06-kon.json»). */
export async function loadLessonIndex(): Promise<LessonInfo[]> {
  const idx = (await import('./lessons/index.json')).default as Omit<LessonInfo, 'file'>[];
  return idx.map((l) => ({ ...l, file: `./lessons/${String(l.n).padStart(2, '0')}-${l.id}.json` }));
}

export function loadLesson(file: string): Promise<Lesson> {
  const f = lessonFiles[file];
  return f ? f() : Promise.reject(new Error('нет урока ' + file));
}

/** Этюд: классическая композиция (подборка и проверка Stockfish — tools/kruzhok/etudes.ts). */
export interface Etude {
  id: string;
  author: string;
  year: number;
  /** Откуда позиция (ссылка). */
  source: string;
  fen: string;
  /** win — выигрывает сторона, чей ход; draw — делает ничью; mate — мат в mateIn ходов. */
  goal: 'win' | 'draw' | 'mate';
  mateIn?: number;
  title: string;
  /** Идея и история — показывается после решения. */
  idea: string;
  hint: string;
  level: 1 | 2 | 3;
  /** Главный вариант (UCI): ходы решающей стороны и защита автора. */
  line: string[];
}

let etudes: Promise<Etude[]> | null = null;

export function loadEtudes(): Promise<Etude[]> {
  etudes ??= fetch(base + 'etudes.json')
    .then((r) => r.json())
    .then((j: { e: Etude[] }) => j.e)
    .catch((e) => {
      etudes = null;
      throw e;
    });
  return etudes;
}
