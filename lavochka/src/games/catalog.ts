/* Каталог сборника: все игры, включая ещё не сделанные (карточка «скоро»). */
import type { GameModule } from '../core/view';

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
  load?: () => Promise<{ default: GameModule }>;
}

export const CATALOG: CatalogEntry[] = [
  // — доска и кости —
  { id: 'shishbesh', title: 'Шиш-беш', sub: 'на кресте, с прыжками по углам', cat: 'board', players: '2–4', wave: 0, icon: '✚', tint: '#b3322a', thumb: 'shishbesh.webp', load: () => import('./shishbesh'), variants: ['классический', 'длинное поле', 'домики через один', 'старт на дубль'] },
  { id: 'nardy', title: 'Нарды', sub: 'с костями, марсом и коксом', cat: 'board', players: '2', wave: 1, icon: '⚂', tint: '#8a4f24', thumb: 'nardy.webp', load: () => import('./nardy'), variants: ['длинные', 'короткие', 'гюльбара', 'матч с кубом'] },
  { id: 'chess', title: 'Шахматы', sub: 'на резной доске', cat: 'board', players: '2', wave: 1, icon: '♞', tint: '#3d2b1f', thumb: 'chess.webp', load: () => import('./chess'), variants: ['классические', 'фишер 960', 'блиц с часами'] },
  { id: 'checkers', title: 'Шашки', sub: 'дамка ходит далеко', cat: 'board', players: '2', wave: 2, icon: '⛀', tint: '#6b1f1a', thumb: 'checkers.webp', load: () => import('./checkers'), variants: ['русские', 'международные', 'поддавки', 'с фуком', 'бразильские', 'столбовые', 'ласка', 'уголки'] },
  { id: 'domino', title: 'Домино «Козёл»', sub: 'забить рыбу!', cat: 'board', players: '2–4', wave: 2, icon: '🁫', tint: '#2f4a3a', thumb: 'domino.webp', load: () => import('./domino'), variants: ['козёл', 'морской козёл', 'осёл', 'на двоих и троих'] },
  // — карты —
  { id: 'durak', title: 'Дурак', sub: 'козыри, отбой и погоны', cat: 'cards', players: '2–6', wave: 1, icon: '♠', tint: '#1f3d6b', thumb: 'durak.webp', load: () => import('./durak'), variants: ['классический', 'подкидной', 'переводной', 'длинный', 'японский', 'король-говно', '2 на 2', 'польский', 'потайной'] },
  { id: 'thousand', title: 'Тысяча', sub: 'марьяжи и прикуп', cat: 'cards', players: '3–4', wave: 3, icon: '♥', tint: '#7a1c15', thumb: 'thousand.webp', load: () => import('./thousand'), variants: ['классическая', 'простая', 'с самосвалом', 'на троих и четверых'] },
  { id: '101', title: '101', sub: 'дворовый уно на обычных картах', cat: 'cards', players: '2–6', wave: 3, icon: '♣', tint: '#2f5d3a', thumb: '101.webp', load: () => import('./sto'), variants: ['классическая', 'с разворотом', 'до 101 и до 121', '36 или 52 карты'] },
  { id: 'bura', title: 'Бура', sub: 'три карты и 31 очко', cat: 'cards', players: '2–4', wave: 3, icon: '♦', tint: '#8a3a12', thumb: 'bura.webp', load: () => import('./bura'), variants: ['с «москвой»', 'вслепую', 'на 2–4'] },
  { id: 'preferans', title: 'Преферанс', sub: 'пуля, гора и вист', cat: 'cards', players: '3–4', wave: 3, icon: '♤', tint: '#24304f', thumb: 'preferans.webp', load: () => import('./preferans'), variants: ['сочи', 'ленинград', 'мизер и распасы'] },
  { id: 'holdem', title: 'Техасский холдем', sub: 'ставки и блеф', cat: 'cards', players: '2–9', wave: 3, icon: '🂡', tint: '#14532d', thumb: 'holdem.webp', load: () => import('./holdem'), variants: ['турнир', 'турбо', '3D-стол и вид сверху'] },
  // — компанией —
  { id: 'mafia', title: 'Мафия', sub: 'город засыпает…', cat: 'company', players: '6–16', wave: 4, icon: '🎭', tint: '#2a1a2e', thumb: 'mafia.webp', load: () => import('./mafia'), variants: ['классическая', 'с доктором и путаной', 'спортивная'] },
  // — на бумаге —
  { id: 'seabattle', title: 'Морской бой', sub: 'в клеточку, ручкой', cat: 'paper', players: '2', wave: 2, icon: '⚓', tint: '#2b5c9e', thumb: 'seabattle.webp', load: () => import('./seabattle'), variants: ['классика', 'сальво', 'западный флот'] },
  { id: 'dots', title: 'Точки', sub: 'окружи соседа', cat: 'paper', players: '2–4', wave: 2, icon: '⁘', tint: '#3a4f8a', thumb: 'dots.webp', load: () => import('./dots'), variants: ['на листочке', 'быстрая', 'спортивная'] },
  { id: 'balda', title: 'Балда', sub: 'слова на поле 5×5', cat: 'paper', players: '2–4', wave: 2, icon: 'Б', tint: '#4a3a8a' },
  // — настолки —
  { id: 'erudit', title: 'Эрудит', sub: 'та самая коробка', cat: 'tabletop', players: '2–4', wave: 2, icon: 'Э', tint: '#7a5a12' },
  { id: 'krugosvet', title: 'Кругосветное путешествие', sub: 'из Москвы и обратно', cat: 'tabletop', players: '2–8', wave: 7, icon: '🌍', tint: '#1d6a7a' },
  { id: 'puteshestvie', title: 'Путешествие', sub: 'журнальная игра-ходилка', cat: 'tabletop', players: '2–8', wave: 7, icon: '🧭', tint: '#4f7a1d' },
  { id: 'kosmos', title: 'Большое космическое путешествие', sub: 'догони комету', cat: 'tabletop', players: '2–10', wave: 7, icon: '☄', tint: '#20307a' },
  { id: 'manager', title: 'Менеджер', sub: 'Гостиный Двор, ДЛТ и прочие', cat: 'tabletop', players: '2–6', wave: 7, icon: '₽', tint: '#7a2a1d' },
  { id: 'kosmos2000', title: 'Космос 2000', sub: '«Менеджер» на орбите', cat: 'tabletop', players: '2–6', wave: 7, icon: '🛰', tint: '#5a1d7a' },
  { id: 'nep', title: 'НЭП', sub: 'капитализм по-советски', cat: 'tabletop', players: '2–6', wave: 7, icon: '💼', tint: '#3a3a3a' },
  // — настольный спорт —
  { id: 'billiards', title: 'Бильярд', sub: 'кий, мел и лузы', cat: 'sport', players: '1–2', wave: 6, icon: '🎱', tint: '#14532d', variants: ['пул', 'русский', 'снукер'] },
  { id: 'hockey', title: 'Настольный хоккей', sub: 'на штырьках', cat: 'sport', players: '1–2', wave: 6, icon: '🏒', tint: '#1f4f7a' },
  { id: 'football', title: 'Настольный футбол', sub: 'жми рычаги', cat: 'sport', players: '1–2', wave: 6, icon: '⚽', tint: '#2f6a2a' },
  { id: 'basketball', title: 'Настольный баскетбол', sub: 'щелчок — и в кольцо', cat: 'sport', players: '1–2', wave: 6, icon: '🏀', tint: '#a0521a' },
  { id: 'zarulem', title: 'За рулём', sub: 'дорога крутится, руль в руках', cat: 'sport', players: '1', wave: 5, icon: '🚗', tint: '#8a1a1a' },
  // — электроника —
  { id: 'nupogodi', title: 'Ну, погоди!', sub: 'ИМ-02: волк ловит яйца', cat: 'electronics', players: '1', wave: 5, icon: '🥚', tint: '#b8a000' },
  { id: 'tainy', title: 'Тайны океана', sub: 'ИМ-03: водолазы и сокровища', cat: 'electronics', players: '1', wave: 5, icon: '🐙', tint: '#0f6a8a' },
  { id: 'povar', title: 'Весёлый повар', sub: 'ИМ: жонглируй сковородкой', cat: 'electronics', players: '1', wave: 5, icon: '🍳', tint: '#c25a10' },
  { id: 'razvedchiki', title: 'Разведчики космоса', sub: 'ИМ: межпланетный десант', cat: 'electronics', players: '1', wave: 5, icon: '🚀', tint: '#3a2a8a' },
  { id: 'avtoslalom', title: 'Автослалом', sub: 'ИМ: между флажками', cat: 'electronics', players: '1', wave: 5, icon: '🏁', tint: '#1a7a3a' },
  { id: 'brickgame', title: 'Brick Game', sub: '9999 игр в одном', cat: 'electronics', players: '1–2', wave: 5, icon: '▦', tint: '#5d6b4f', variants: ['тетрис', 'танки', 'гонки', 'змейка', 'арканоид'] },
  // — аркады —
  { id: 'treasures', title: 'Клад', sub: 'три в ряд, 100 уровней', cat: 'arcade', players: '1–2', wave: 6, icon: '💎', tint: '#1a6a5a' },
  { id: 'shariki', title: 'Шарики', sub: 'цепочка катится к яме, 100 уровней', cat: 'arcade', players: '1–2', wave: 6, icon: '🐸', tint: '#4a7a10' },
  { id: 'eggs', title: 'Яйца динозавров', sub: 'лопни три одинаковых, 100 уровней', cat: 'arcade', players: '1–2', wave: 6, icon: '🦕', tint: '#7a5a10' },
  { id: 'gops', title: 'ГОПС', sub: 'гопники в кепках, 10 районов', cat: 'arcade', players: '1–4', wave: 6, icon: '🧢', tint: '#2a2a2a' },
];

export const byId = (id: string) => CATALOG.find((g) => g.id === id);
