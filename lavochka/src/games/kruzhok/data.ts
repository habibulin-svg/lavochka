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
  name: string;
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

export function loadOpenings(): Promise<Opening[]> {
  openings ??= fetch(base + 'openings.json')
    .then((r) => r.json())
    .then((j: { o: [string, string, string, string][] }) => j.o.map(([eco, name, uci, fen]) => ({ eco, name, uci: uci.split(' '), fen })))
    .catch((e) => {
      openings = null;
      throw e;
    });
  return openings;
}

/** Темы задач по-русски, в порядке от простого к сложному; группа — для фильтра в решалке. */
export const THEMES: { id: string; name: string; group: 'Мат' | 'Тактика' | 'Эндшпиль' | 'Стадия' }[] = [
  { id: 'mateIn1', name: 'Мат в 1 ход', group: 'Мат' },
  { id: 'mateIn2', name: 'Мат в 2 хода', group: 'Мат' },
  { id: 'mateIn3', name: 'Мат в 3 хода', group: 'Мат' },
  { id: 'mateIn4', name: 'Мат в 4 хода', group: 'Мат' },
  { id: 'mateIn5', name: 'Мат в 5 и больше', group: 'Мат' },
  { id: 'backRankMate', name: 'Мат на последней горизонтали', group: 'Мат' },
  { id: 'smotheredMate', name: 'Спёртый мат', group: 'Мат' },
  { id: 'anastasiaMate', name: 'Мат Анастасии', group: 'Мат' },
  { id: 'arabianMate', name: 'Арабский мат', group: 'Мат' },
  { id: 'bodenMate', name: 'Мат Бодена', group: 'Мат' },
  { id: 'doubleBishopMate', name: 'Мат двумя слонами', group: 'Мат' },
  { id: 'dovetailMate', name: 'Мат «ласточкин хвост»', group: 'Мат' },
  { id: 'hookMate', name: 'Мат «крюк»', group: 'Мат' },
  { id: 'killBoxMate', name: 'Мат «коробочка»', group: 'Мат' },
  { id: 'vukovicMate', name: 'Мат Вуковича', group: 'Мат' },
  { id: 'hangingPiece', name: 'Незащищённая фигура', group: 'Тактика' },
  { id: 'fork', name: 'Вилка', group: 'Тактика' },
  { id: 'pin', name: 'Связка', group: 'Тактика' },
  { id: 'skewer', name: 'Линейный удар', group: 'Тактика' },
  { id: 'discoveredAttack', name: 'Вскрытое нападение', group: 'Тактика' },
  { id: 'doubleCheck', name: 'Двойной шах', group: 'Тактика' },
  { id: 'trappedPiece', name: 'Ловля фигуры', group: 'Тактика' },
  { id: 'capturingDefender', name: 'Уничтожение защитника', group: 'Тактика' },
  { id: 'deflection', name: 'Отвлечение', group: 'Тактика' },
  { id: 'attraction', name: 'Завлечение', group: 'Тактика' },
  { id: 'sacrifice', name: 'Жертва', group: 'Тактика' },
  { id: 'xRayAttack', name: 'Рентген', group: 'Тактика' },
  { id: 'clearance', name: 'Освобождение поля или линии', group: 'Тактика' },
  { id: 'interference', name: 'Перекрытие', group: 'Тактика' },
  { id: 'intermezzo', name: 'Промежуточный ход', group: 'Тактика' },
  { id: 'exposedKing', name: 'Открытый король', group: 'Тактика' },
  { id: 'kingsideAttack', name: 'Атака на короткую рокировку', group: 'Тактика' },
  { id: 'queensideAttack', name: 'Атака на длинную рокировку', group: 'Тактика' },
  { id: 'quietMove', name: 'Тихий ход', group: 'Тактика' },
  { id: 'defensiveMove', name: 'Защита', group: 'Тактика' },
  { id: 'zugzwang', name: 'Цугцванг', group: 'Тактика' },
  { id: 'promotion', name: 'Превращение пешки', group: 'Эндшпиль' },
  { id: 'underPromotion', name: 'Слабое превращение', group: 'Эндшпиль' },
  { id: 'advancedPawn', name: 'Проходная пешка', group: 'Эндшпиль' },
  { id: 'pawnEndgame', name: 'Пешечный эндшпиль', group: 'Эндшпиль' },
  { id: 'rookEndgame', name: 'Ладейный эндшпиль', group: 'Эндшпиль' },
  { id: 'bishopEndgame', name: 'Слоновый эндшпиль', group: 'Эндшпиль' },
  { id: 'knightEndgame', name: 'Коневой эндшпиль', group: 'Эндшпиль' },
  { id: 'queenEndgame', name: 'Ферзевый эндшпиль', group: 'Эндшпиль' },
  { id: 'queenRookEndgame', name: 'Ферзь и ладья', group: 'Эндшпиль' },
  { id: 'enPassant', name: 'Взятие на проходе', group: 'Стадия' },
  { id: 'castling', name: 'Рокировка', group: 'Стадия' },
  { id: 'opening', name: 'Дебют', group: 'Стадия' },
  { id: 'middlegame', name: 'Миттельшпиль', group: 'Стадия' },
  { id: 'endgame', name: 'Эндшпиль', group: 'Стадия' },
];

export const themeName = (id: string) => THEMES.find((t) => t.id === id)?.name ?? null;

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
