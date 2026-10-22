/* Темы задач кружка (без DOM и без загрузки данных — нужны и в tools/kruzhok). */

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

/** Урок учебника по теме задачи (id урока) — ссылка «Урок по теме» после задачи. */
export const THEME_LESSON: Record<string, string> = {
  mateIn1: 'mat', mateIn2: 'mat', backRankMate: 'mat-na-poslednej', smotheredMate: 'spertyj-mat', hangingPiece: 'nezashchishchennye',
  fork: 'vilka', pin: 'svyazka', skewer: 'linejnyj-udar', discoveredAttack: 'vskrytoe-napadenie', doubleCheck: 'vskrytoe-napadenie',
  capturingDefender: 'unichtozhenie-zashchitnika', deflection: 'otvlechenie', attraction: 'zavlechenie', sacrifice: 'zhertva',
  interference: 'perekrytie', intermezzo: 'promezhutochnyj-hod', zugzwang: 'cugcvang', promotion: 'prevrashchenie',
  underPromotion: 'prevrashchenie', advancedPawn: 'prohodnaya', pawnEndgame: 'korol-i-peshka', rookEndgame: 'pozitsiya-filidora',
  enPassant: 'vzyatie-na-prohode', castling: 'rokirovka', opening: 'pravila-debyuta', exposedKing: 'zhertva', kingsideAttack: 'zhertva',
};

export const themeName = (id: string) => THEMES.find((t) => t.id === id)?.name ?? null;

/** Указатель для журнала: темы — номерами в THEMES, задачи — строкой «id:0,5;id:3». */
export interface ThemeIndex {
  /** Сколько задач в каждой теме (по порядку THEMES). */
  n: number[];
  p: string;
}

export function themeIndex(list: [string, string[]][]): ThemeIndex {
  const n = THEMES.map(() => 0);
  const p = list
    .map(([id, th]) => {
      const ix = THEMES.map((t, i) => (th.includes(t.id) ? i : -1)).filter((i) => i >= 0);
      for (const i of ix) n[i]++;
      return `${id}:${ix.join(',')}`;
    })
    .join(';');
  return { n, p };
}
