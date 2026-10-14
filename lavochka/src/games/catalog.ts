/* Каталог сборника: все игры, включая ещё не сделанные (карточка «скоро»). */
import type { GameModule } from '../core/view';
import type { ArcadeModule } from '../core/arcade';
import { loadDict } from '../words/dict';
import { loadClues } from '../words/clues';

/** Словесные игры: модуль готов, когда загружен словарь (движку он нужен синхронно). */
const withDict = <T>(m: Promise<T>) => Promise.all([m, loadDict()]).then(([x]) => x);
const withClues = <T>(m: Promise<T>) => Promise.all([m, loadClues()]).then(([x]) => x);

export type Category = 'board' | 'cards' | 'company' | 'paper' | 'tabletop' | 'sport' | 'electronics' | 'arcade';

export const CATEGORIES: { id: Category; title: string }[] = [
  { id: 'board', title: 'Доска и кости' },
  { id: 'cards', title: 'Карты' },
  { id: 'company', title: 'Компанией' },
  { id: 'paper', title: 'На бумаге' },
  { id: 'tabletop', title: 'Настолки' },
  { id: 'sport', title: 'Настольный спорт' },
  { id: 'electronics', title: 'Электроника' },
  { id: 'arcade', title: 'Аркады' },
];

export interface CatalogEntry {
  id: string;
  title: string;
  sub: string;
  cat: Category;
  players: string;
  /** Волна разработки, в которой игра появится. */
  wave: number;
  /** Значок на карточке: короткий символ или эмблема. */
  icon: string;
  /** Цвет карточки. */
  tint: string;
  /** Варианты игры — строкой внизу карточки; выбираются на экране игры. */
  variants?: string[];
  /** Превью на карточке: файл в public/thumbs (снимается через ?thumb=<id>). */
  thumb?: string;
  /** Аркада (реальное время, один игрок): свой экран, без пошагового стола и сервера партий. */
  arcade?: boolean;
  /** Отложена до последней волны: код живёт, а в лаунчере карточки нет (открывается только по прямой ссылке). */
  shelved?: boolean;
  load?: () => Promise<{ default: GameModule | ArcadeModule }>;
  /** Карточка-группа: открывает в лаунчере свой список карточек (id из каталога). */
  members?: string[];
  /** Игра входит в группу: отдельной карточки во дворе нет, она внутри карточки группы. */
  group?: string;
  /** Ярлык на другую игру с заранее выбранными вариантами (например, поле кинь-двинь). */
  of?: string;
  opts?: Record<string, unknown>;
}

export const CATALOG: CatalogEntry[] = [
  // — доска и кости —
  { id: 'shishbesh', title: 'Шиш-беш', sub: 'на кресте, с прыжками по углам', cat: 'board', players: '2–4', wave: 0, icon: '✚', tint: '#b3322a', thumb: 'shishbesh.webp', load: () => import('./shishbesh'), variants: ['классический', 'длинное поле', 'домики через один', 'старт на дубль', 'быстрый заряд'] },
  { id: 'nardy', title: 'Нарды', sub: 'с костями, марсом и коксом', cat: 'board', players: '2', wave: 1, icon: '⚂', tint: '#8a4f24', thumb: 'nardy.webp', load: () => import('./nardy'), variants: ['длинные', 'короткие', 'гюльбара', 'матч с кубом'] },
  { id: 'chess', title: 'Шахматы', sub: 'на резной доске', cat: 'board', players: '2', wave: 1, icon: '♞', tint: '#3d2b1f', thumb: 'chess.webp', load: () => import('./chess'), variants: ['классические', 'фишер 960', 'блиц с часами'] },
  { id: 'checkers', title: 'Шашки', sub: 'дамка ходит далеко', cat: 'board', players: '2', wave: 2, icon: '⛀', tint: '#6b1f1a', thumb: 'checkers.webp', load: () => import('./checkers'), variants: ['русские', 'международные', 'поддавки', 'с фуком', 'бразильские', 'столбовые', 'ласка', 'уголки', 'блиц с часами'] },
  { id: 'domino', title: 'Домино «Козёл»', sub: 'забить рыбу!', cat: 'board', players: '2–4', wave: 2, icon: '🁫', tint: '#2f4a3a', thumb: 'domino.webp', load: () => import('./domino'), variants: ['козёл', 'морской козёл', 'осёл', 'на двоих и троих'] },
  // — карты —
  { id: 'durak', title: 'Дурак', sub: 'козыри, отбой и погоны', cat: 'cards', players: '2–6', wave: 1, icon: '♠', tint: '#1f3d6b', thumb: 'durak.webp', load: () => import('./durak'), variants: ['классический', 'подкидной', 'переводной', 'длинный', 'японский', 'король-говно', '2 на 2', 'польский', 'потайной'] },
  { id: 'thousand', title: 'Тысяча', sub: 'марьяжи и прикуп', cat: 'cards', players: '3–4', wave: 3, icon: '♥', tint: '#7a1c15', thumb: 'thousand.webp', load: () => import('./thousand'), variants: ['классическая', 'простая', 'золотой кон', '1001', 'тёмная и роспись', 'на троих и четверых'] },
  { id: '101', title: '101', sub: 'дворовый уно на обычных картах', cat: 'cards', players: '2–6', wave: 3, icon: '♣', tint: '#2f5d3a', thumb: '101.webp', load: () => import('./sto'), variants: ['классическая', 'с разворотом', 'до 101 и до 121', '36 или 52 карты'] },
  { id: 'bura', title: 'Бура', sub: 'три карты и 31 очко', cat: 'cards', players: '2–4', wave: 3, icon: '♦', tint: '#8a3a12', thumb: 'bura.webp', load: () => import('./bura'), variants: ['с «москвой»', 'вслепую', 'на 2–4'] },
  { id: 'preferans', title: 'Преферанс', sub: 'пуля, гора и вист', cat: 'cards', players: '3–4', wave: 3, icon: '♤', tint: '#24304f', thumb: 'preferans.webp', load: () => import('./preferans'), variants: ['сочи', 'ленинград', 'ростов', 'классика с брандерами', 'скачки', 'кодекс', 'полвиста', 'сталинград'] },
  { id: 'holdem', title: 'Техасский холдем', sub: 'ставки и блеф', cat: 'cards', players: '2–9', wave: 3, icon: '🂡', tint: '#14532d', thumb: 'holdem.webp', load: () => import('./holdem'), variants: ['турнир', 'турбо', '3D-комната с людьми', 'обычный стол'] },
  { id: 'drunkard', title: 'Пьяница', sub: 'открывай карту — шестёрка бьёт туза', cat: 'cards', players: '2–6', wave: 8, icon: '🂠', tint: '#2f5a3a', thumb: 'drunkard.webp', load: () => import('./drunkard'), variants: ['дворовая', 'открытый спор', '52 карты', 'без шестёрки', 'быстрая'] },
  { id: 'bluff', title: 'Верю — не верю', sub: 'клади рубашкой и ври убедительно', cat: 'cards', players: '2–6', wave: 8, icon: '🤥', tint: '#263f6a', thumb: 'bluff.webp', load: () => import('./bluff'), variants: ['верю и докладываю', 'одна карта', 'без подкладывания', '52 карты'] },
  { id: 'sunduchok', title: 'Сундучок', sub: '«дай тузов!» — собери четвёрки', cat: 'cards', players: '2–6', wave: 8, icon: '🧰', tint: '#6e4524', thumb: 'sunduchok.webp', load: () => import('./sunduchok'), variants: ['дай тузов', 'с мастью', 'ход к спрошенному', '52 карты'] },
  { id: 'akulina', title: 'Акулина', sub: 'тяни у соседа и не останься с дамой пик', cat: 'cards', players: '2–6', wave: 8, icon: '👸', tint: '#5e2524', thumb: 'akulina.webp', load: () => import('./akulina'), variants: ['акулина', 'зассыха', 'пары по цвету', 'пиковый валет'] },
  { id: 'solitaire', title: 'Пасьянсы', sub: 'косынка, паук, солитёр и ещё шесть', cat: 'cards', players: '1–4', wave: 11, icon: '🂮', tint: '#1f5a34', thumb: 'solitaire.webp', load: () => import('./solitaire'), variants: ['косынка', 'паук', 'солитёр', 'пирамида', 'три вершины', 'гольф', 'сорок воров', 'скорпион', 'колодец'] },
  // — компанией —
  { id: 'geo', title: 'География', sub: 'флаги, гербы, столицы и карта мира', cat: 'company', players: '1–6', wave: 16, icon: '🌍', tint: '#2a6a8a', thumb: 'geo.webp', load: () => import('./geo'), variants: ['где на карте', 'флаги', 'гербы', 'контуры', 'столицы', 'регионы РФ и штаты США', 'чей регион', 'справочник'] },
  { id: 'mafia', title: 'Мафия', sub: 'город засыпает…', cat: 'company', players: '6–16', wave: 4, icon: '🎭', tint: '#2a1a2e', thumb: 'mafia.webp', load: () => import('./mafia'), variants: ['классическая', 'с доктором и путаной', 'спортивная'] },
  // — на бумаге —
  { id: 'seabattle', title: 'Морской бой', sub: 'в клеточку, ручкой', cat: 'paper', players: '2', wave: 2, icon: '⚓', tint: '#2b5c9e', thumb: 'seabattle.webp', load: () => import('./seabattle'), variants: ['классика', 'сальво', 'западный флот'] },
  { id: 'dots', title: 'Точки', sub: 'окружи соседа', cat: 'paper', players: '2–4', wave: 2, icon: '⁘', tint: '#3a4f8a', thumb: 'dots.webp', load: () => import('./dots'), variants: ['на листочке', 'быстрая', 'спортивная'] },
  { id: 'ttt', title: 'Крестики-нолики', sub: 'три в ряд — и ультимативные на девяти полях', cat: 'paper', players: '2', wave: 8, icon: '✕', tint: '#1f3a8f', thumb: 'ttt.webp', load: () => import('./ttt'), variants: ['классические 3×3', 'ультимативные', 'серия партий'] },
  { id: 'hangman', title: 'Виселица', sub: 'угадай слово, пока не дорисовали человечка', cat: 'paper', players: '1–6', wave: 8, icon: '☖', tint: '#2a3a6a', thumb: 'hangman.webp', load: () => Promise.all([import('./hangman'), loadDict(), loadClues()]).then(([m]) => m), variants: ['обычная', 'командная', 'обратная', 'аукцион'] },
  { id: 'puzzles', title: 'Головоломки', sub: 'кроссворды, сканворды, судоку — одному или всем двором', cat: 'paper', players: '1–6', wave: 16, icon: '✎', tint: '#5a4a2a', thumb: 'puzzles.webp', load: () => withClues(import('./puzzles')), variants: ['кроссворд', 'сканворд', 'судоку', 'пикросс'] },
  { id: 'balda', title: 'Балда', sub: 'слова на поле 5×5', cat: 'paper', players: '2–4', wave: 2, icon: 'Б', tint: '#4a3a8a', thumb: 'balda.webp', load: () => withDict(import('./balda')), variants: ['5×5', '6×6 и 7×7', 'с диагоналями'] },
  // — настолки —
  { id: 'erudit', title: 'Эрудит', sub: 'та самая коробка', cat: 'tabletop', players: '2–4', wave: 2, icon: 'Э', tint: '#7a5a12', thumb: 'erudit.webp', load: () => withDict(import('./erudit')), variants: ['эрудит', 'скрэббл', 'до 200 очков'] },
  { id: 'hodilki', title: 'Кинь-двинь', sub: 'ходилки на советских полях', cat: 'tabletop', group: 'adventures', players: '2–10', wave: 7, icon: '🎲', tint: '#1d6a7a', thumb: 'hodilki.webp', load: () => import('./hodilki'), variants: ['Кругосветное путешествие', 'Затерянный мир', 'Шайба — хоккей с голами', 'Лукоморье — 4 части', 'и ещё 8 полей'] },
  { id: 'manager', title: 'Менеджер', sub: 'Гостиный двор, ДЛТ и планеты', cat: 'tabletop', group: 'kupi', players: '2–6', wave: 7, icon: '₽', tint: '#7a2a1d', thumb: 'manager.webp', load: () => import('./manager'), variants: ['Одесса 1990', 'Менеджер', 'Космос 2000', 'Бизнес', 'Бизнесмен', 'Империя', 'на 20 или 40 кругов'] },
  { id: 'vorona', title: 'Белая ворона', sub: 'зарплата, счета и бизнес по календарю', cat: 'tabletop', group: 'kupi', players: '2–6', wave: 7, icon: '🐦', tint: '#1d3a8a', thumb: 'vorona.webp', load: () => import('./vorona'), variants: ['синее издание', 'зелёное издание', 'от 1 до 6 месяцев'] },
  { id: 'western', title: 'Вестерн', sub: 'акции, биржи, криминал и колонии — игра-комикс', cat: 'tabletop', group: 'kupi', players: '2–4', wave: 7, icon: '🤠', tint: '#8a3a12', thumb: 'western.webp', load: () => import('./western'), variants: ['полные правила', 'для начинающих', '3, 5 или 8 кругов'] },
  { id: 'star', title: 'Звезда Африки', sub: 'поиски алмаза по карте: суша, море и авиалинии', cat: 'tabletop', group: 'adventures', players: '2–4', wave: 7, icon: '💎', tint: '#8a6a12', thumb: 'star.webp', load: () => import('./star'), variants: ['полные правила', 'без разбойников'] },
  { id: 'djio', title: 'Чудовище Джио-Джанги', sub: 'экспедиция за деньгами: снаряжение, съёмка, охота', cat: 'tabletop', group: 'adventures', players: '2–5', wave: 7, icon: '🐊', tint: '#3f6b2a', thumb: 'djio.webp', load: () => import('./djio'), variants: ['Экспедиция по правилам', 'Быстрые сборы'] },
  { id: 'korona', title: 'Корона Эмбера', sub: 'приключения и корона: четыре мира, лабиринт и поединок принцев', cat: 'tabletop', group: 'adventures', players: '2–4', wave: 7, icon: '👑', tint: '#6b4fa0', thumb: 'korona.webp', load: () => import('./korona'), variants: ['полный путь к короне', 'короткая партия'] },
  { id: 'beglye', title: 'Беглые', sub: 'побег из монастыря к устью Дона: кубик со знаками', cat: 'tabletop', group: 'adventures', players: '2–6', wave: 7, icon: '⛓', tint: '#5a4632', thumb: 'beglye.webp', load: () => import('./beglye'), variants: ['По правилам'], shelved: true }, // недоделка: убрана с витрины до починки
  // группы: одна карточка во дворе, внутри — свой список
  { id: 'adventures', title: 'Приключения', sub: 'кинь-двинь, клады, побеги и короны', cat: 'tabletop', players: '2–10', wave: 7, icon: '🗺', tint: '#1d6a7a', thumb: 'hodilki.webp', members: ['hodilki', 'shel', 'star', 'korona', 'djio', 'beglye'], variants: ['Кинь-двинь', 'Шёл солдат', 'Звезда Африки', 'Корона Эмбера', 'Джио-Джанги'] },
  { id: 'kupi', title: 'Купи-продай', sub: 'деньги, биржа и бизнес по-советски', cat: 'tabletop', players: '2–6', wave: 7, icon: '₽', tint: '#7a2a1d', thumb: 'manager.webp', members: ['manager', 'vorona', 'western', 'akcii'], variants: ['Менеджер', 'Белая ворона', 'Вестерн', 'Акционеры'] },
  { id: 'shel', title: 'Шёл солдат со службы', sub: 'сказочная ходилка: ярмарки чудес, котомка и Конь-огонь', cat: 'tabletop', players: '2–10', wave: 7, icon: '🎖', tint: '#6a4a1d', thumb: 'shel.webp', group: 'adventures', of: 'hodilki', opts: { map: 'shel' } },
  { id: 'akcii', title: 'Акционеры', sub: 'акции, дивиденды и большой бизнес', cat: 'tabletop', players: '2–6', wave: 8, icon: '📈', tint: '#2a5a3a', group: 'kupi' },
  // — настольный спорт —
  { id: 'billiards', title: 'Бильярд', sub: 'кий, мел и лузы', cat: 'sport', players: '1–2', wave: 6, icon: '🎱', tint: '#14532d', thumb: 'billiards.webp', load: () => import('./billiards'), variants: ['восьмёрка', 'американка', 'московская', 'невская', 'классика 71', 'снукер'] },
  { id: 'hockey', title: 'Настольный хоккей', sub: 'жестяные хоккеисты на штангах', cat: 'sport', players: '2', wave: 6, icon: '🏒', tint: '#1f4f7a', thumb: 'hockey.webp', load: () => import('./hockey'), variants: ['с ботом', 'вдвоём за экраном', 'по сети', 'до 5 шайб или 3 минуты', 'матч 10 минут'] },
  { id: 'football', title: 'Настольный футбол', sub: 'футболисты на пружинках', cat: 'sport', players: '2', wave: 6, icon: '⚽', tint: '#2f6a2a', thumb: 'football.webp', load: () => import('./football'), variants: ['с ботом', 'вдвоём за экраном', 'по сети', 'до 5 голов или 5 минут', 'матч 10 минут'] },
  { id: 'basketball', title: 'Настольный баскетбол', sub: 'кто первым нажал — тот бросает', cat: 'sport', players: '2', wave: 6, icon: '🏀', tint: '#a0521a', thumb: 'basketball.webp', load: () => import('./basketball'), variants: ['с ботом', 'вдвоём за экраном', 'по сети', 'до 21 очка или 3 минуты', 'матч 5 минут'] },
  { id: 'zarulem', title: 'За рулём', sub: 'дорога крутится, руль в руках', cat: 'sport', players: '1–4', wave: 5, icon: '🚗', tint: '#1f8fa2', thumb: 'zarulem.webp', load: () => import('./zarulem'), variants: ['гонка на круги', 'на дальность', 'как в игрушке', 'с ботами', 'по сети'] },
  // — электроника —
  { id: 'elektronika', title: 'Электроника ИМ', sub: 'настоящие советские ЖК-игры', cat: 'electronics', players: '1', wave: 5, icon: '🥚', tint: '#b8a000', thumb: 'elektronika.webp', arcade: true, load: () => import('./elektronika'), variants: ['Ну, погоди!', 'Тайны океана', 'Весёлый повар', 'Космический мост', 'Хоккей', 'Автослалом', 'Кот-рыболов', 'и ещё 7'] },
  { id: 'brick', title: 'Brick Game', sub: 'E-23 «96 in 1», настоящая прошивка', cat: 'electronics', players: '1', wave: 5, icon: '▦', tint: '#5d6b4f', thumb: 'brick.webp', arcade: true, load: () => import('./brick'), variants: ['тетрис', 'чудные фигуры', 'мяч и ракетка', 'сбей стену', 'ряды сверху'] },
  // — аркады —
  { id: 'treasures', title: 'Клад', sub: 'три в ряд, 100 уровней', cat: 'arcade', players: '1', wave: 6, icon: '💎', tint: '#1a6a5a', arcade: true, shelved: true, load: () => import('./treasures'), variants: ['сто уровней', 'откопать клад', 'лопата, динамит, самородок'] },
  { id: 'shariki', title: 'Шарики', sub: 'цепочка катится к яме, 100 уровней', cat: 'arcade', players: '1', wave: 6, icon: '🐸', tint: '#4a7a10', arcade: true, shelved: true, load: () => import('./shariki'), variants: ['сто уровней', 'комбо', 'спираль, петля'] },
  { id: 'eggs', title: 'Яйца динозавров', sub: 'лопни три одинаковых, 100 уровней', cat: 'arcade', players: '1', wave: 6, icon: '🦕', tint: '#7a5a10', arcade: true, shelved: true, load: () => import('./eggs'), variants: ['сто уровней', 'потолок опускается', 'отскоки от стенок'] },
  { id: 'gops', title: 'ГОПС', sub: 'гопники в кепках, 10 районов', cat: 'arcade', players: '1–4', wave: 6, icon: '🧢', tint: '#2a2a2a', arcade: true, shelved: true, load: () => import('./gops'), variants: ['десять районов', 'стенка на стенку', 'вдвоём за одной клавиатурой'] },
];

/** Карточки лаунчера — без отложенных и без тех, что живут внутри групп. */
export const SHOWN = CATALOG.filter((g) => !g.shelved && !g.group);

/** Карточки внутри группы — в порядке, заданном группой. */
export const membersOf = (g: CatalogEntry) => (g.members ?? []).map((id) => byId(id)).filter((x): x is CatalogEntry => !!x && !x.shelved);

export const byId = (id: string) => CATALOG.find((g) => g.id === id);
