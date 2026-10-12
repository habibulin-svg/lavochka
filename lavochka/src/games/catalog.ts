/* Каталог сборника: все игры, включая ещё не сделанные (карточка «скоро»). */
import type { GameModule } from '../core/view';
import type { ArcadeModule } from '../core/arcade';
import { loadDict } from '../words/dict';

/** Словесные игры: модуль готов, когда загружен словарь (движку он нужен синхронно). */
const withDict = <T>(m: Promise<T>) => Promise.all([m, loadDict()]).then(([x]) => x);

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
  // — компанией —
  { id: 'mafia', title: 'Мафия', sub: 'город засыпает…', cat: 'company', players: '6–16', wave: 4, icon: '🎭', tint: '#2a1a2e', thumb: 'mafia.webp', load: () => import('./mafia'), variants: ['классическая', 'с доктором и путаной', 'спортивная'] },
  // — на бумаге —
  { id: 'seabattle', title: 'Морской бой', sub: 'в клеточку, ручкой', cat: 'paper', players: '2', wave: 2, icon: '⚓', tint: '#2b5c9e', thumb: 'seabattle.webp', load: () => import('./seabattle'), variants: ['классика', 'сальво', 'западный флот'] },
  { id: 'dots', title: 'Точки', sub: 'окружи соседа', cat: 'paper', players: '2–4', wave: 2, icon: '⁘', tint: '#3a4f8a', thumb: 'dots.webp', load: () => import('./dots'), variants: ['на листочке', 'быстрая', 'спортивная'] },
  { id: 'balda', title: 'Балда', sub: 'слова на поле 5×5', cat: 'paper', players: '2–4', wave: 2, icon: 'Б', tint: '#4a3a8a', thumb: 'balda.webp', load: () => withDict(import('./balda')), variants: ['5×5', '6×6 и 7×7', 'с диагоналями'] },
  // — настолки —
  { id: 'erudit', title: 'Эрудит', sub: 'та самая коробка', cat: 'tabletop', players: '2–4', wave: 2, icon: 'Э', tint: '#7a5a12', thumb: 'erudit.webp', load: () => withDict(import('./erudit')), variants: ['эрудит', 'скрэббл', 'до 200 очков'] },
  { id: 'hodilki', title: 'Кинь-двинь', sub: 'ходилки на советских полях', cat: 'tabletop', players: '2–10', wave: 7, icon: '🎲', tint: '#1d6a7a', thumb: 'hodilki.webp', load: () => import('./hodilki'), variants: ['Кругосветное путешествие', 'Большое космическое путешествие', 'Путешествие'] },
  { id: 'manager', title: 'Менеджер', sub: 'Гостиный Двор, ДЛТ и прочие', cat: 'tabletop', players: '2–6', wave: 7, icon: '₽', tint: '#7a2a1d' },
  { id: 'kosmos2000', title: 'Космос 2000', sub: '«Менеджер» на орбите', cat: 'tabletop', players: '2–6', wave: 7, icon: '🛰', tint: '#5a1d7a' },
  { id: 'nep', title: 'НЭП', sub: 'капитализм по-советски', cat: 'tabletop', players: '2–6', wave: 7, icon: '💼', tint: '#3a3a3a' },
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

/** Карточки лаунчера — без отложенных. */
export const SHOWN = CATALOG.filter((g) => !g.shelved);

export const byId = (id: string) => CATALOG.find((g) => g.id === id);
