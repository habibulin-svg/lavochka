/* Герои «Арены»: 8 фракций × 2 класса × 4 героя (DESIGN.md §5.9). Цифры и книга — у класса, у героя — портрет и имя. */
import type { Faction } from './creatures';

export interface HeroClass {
  id: string;
  name: string;
  faction: Faction;
  atk: number;
  def: number;
  power: number;
  know: number;
  spells: string[];
}

export const CLASSES: HeroClass[] = [
  { id: 'zatulye-sotnik', name: 'Сотник', faction: 'zatulye', atk: 5, def: 5, power: 2, know: 2, spells: ['stone-skin', 'haste', 'lightning'] },
  { id: 'zatulye-znakhar', name: 'Знахарь', faction: 'zatulye', atk: 2, def: 3, power: 5, know: 5, spells: ['stone-skin', 'heal-light', 'lightning', 'slow', 'haste'] },
  { id: 'zatonye-bolotnik', name: 'Болотник', faction: 'zatonye', atk: 5, def: 6, power: 2, know: 2, spells: ['ice-bolt', 'weakness', 'heal-light'] },
  { id: 'zatonye-vorozheya', name: 'Ворожея', faction: 'zatonye', atk: 2, def: 3, power: 5, know: 5, spells: ['ice-bolt', 'weakness', 'slow', 'sorrow', 'heal-light'] },
  { id: 'kuznya-master', name: 'Мастер', faction: 'kuznya', atk: 5, def: 7, power: 1, know: 2, spells: ['fire-arrow', 'bloodlust', 'stone-skin'] },
  { id: 'kuznya-ognelit', name: 'Огнелит', faction: 'kuznya', atk: 3, def: 3, power: 5, know: 4, spells: ['fire-arrow', 'fireball', 'bloodlust', 'flash'] },
  { id: 'akademiya-strazh', name: 'Страж', faction: 'akademiya', atk: 6, def: 5, power: 3, know: 3, spells: ['lightning', 'haste', 'precision', 'stone-skin'] },
  { id: 'akademiya-zvezdochet', name: 'Звездочёт', faction: 'akademiya', atk: 1, def: 2, power: 5, know: 5, spells: ['lightning', 'fireball', 'ice-bolt', 'meteors', 'haste', 'slow', 'heal-light', 'gust'] },
  // вторая четвёрка (платная часть)
  { id: 'plotina-smotritel', name: 'Смотритель', faction: 'plotina', atk: 5, def: 5, power: 2, know: 2, spells: ['ice-bolt', 'haste', 'gust'] },
  { id: 'plotina-bureveshchun', name: 'Буревещун', faction: 'plotina', atk: 2, def: 2, power: 5, know: 5, spells: ['lightning', 'ice-bolt', 'gust', 'haste', 'weakness'] },
  { id: 'ostrog-voevoda', name: 'Воевода', faction: 'ostrog', atk: 6, def: 5, power: 1, know: 2, spells: ['stone-skin', 'blessing', 'slow'] },
  { id: 'ostrog-shaman', name: 'Шаман', faction: 'ostrog', atk: 3, def: 3, power: 4, know: 4, spells: ['stone-skin', 'slow', 'meteors', 'heal-light'] },
  { id: 'bazar-kupets', name: 'Купец', faction: 'bazar', atk: 4, def: 4, power: 3, know: 3, spells: ['haste', 'bloodlust', 'precision'] },
  { id: 'bazar-menyala', name: 'Меняла', faction: 'bazar', atk: 2, def: 2, power: 5, know: 5, spells: ['fire-arrow', 'flash', 'haste', 'lightning', 'gust'] },
  { id: 'kurgany-khan', name: 'Хан', faction: 'kurgany', atk: 5, def: 6, power: 2, know: 2, spells: ['sorrow', 'stone-skin', 'ice-bolt'] },
  { id: 'kurgany-veshchun', name: 'Вещун', faction: 'kurgany', atk: 2, def: 3, power: 5, know: 5, spells: ['sorrow', 'weakness', 'slow', 'ice-bolt', 'heal-light'] },
];

/** Имена по порядку портретов hero-<класс>-<1..4>. */
const NAMES: Record<string, string[]> = {
  'zatulye-sotnik': ['Ратибор', 'Всеслава', 'Добрыня', 'Любава'],
  'zatulye-znakhar': ['Ведагор', 'Милава', 'Любим', 'Заряна'],
  'zatonye-bolotnik': ['Тинник', 'Осока', 'Сазан', 'Тина'],
  'zatonye-vorozheya': ['Мара', 'Купава', 'Омут', 'Ряска'],
  'kuznya-master': ['Горн', 'Клепа', 'Угар', 'Окалина'],
  'kuznya-ognelit': ['Жар', 'Искра', 'Плавень', 'Зола'],
  'akademiya-strazh': ['Орион', 'Вега', 'Альтаир', 'Лира'],
  'akademiya-zvezdochet': ['Астрей', 'Сириус', 'Птолемей', 'Селена'],
  'plotina-smotritel': ['Шквал', 'Волна', 'Бакен', 'Гавань'],
  'plotina-bureveshchun': ['Гром', 'Чайка', 'Норд', 'Буря'],
  'ostrog-voevoda': ['Ермак', 'Василиса', 'Тимофей', 'Ярина'],
  'ostrog-shaman': ['Кам', 'Айна', 'Урхан', 'Сайна'],
  'bazar-kupets': ['Сафар', 'Зарина', 'Хаким', 'Лейла'],
  'bazar-menyala': ['Динар', 'Ширин', 'Абакус', 'Нура'],
  'kurgany-khan': ['Бату', 'Алтын', 'Курган', 'Умай'],
  'kurgany-veshchun': ['Тенгри', 'Полынь', 'Морок', 'Вереска'],
};

export interface HeroPick {
  cls: string;
  /** 1..4 — портрет и имя; у пацанов кампании — 0. */
  n: number;
  /** Пацан из кампании (DESIGN.md §2): своё имя и портрет `lad-<id>`, цифры — от класса. */
  lad?: string;
}

/** Пацаны и Старшой — герои кампаний. */
export const LADS: Record<string, string> = {
  seryoga: 'Серёга «Тула»',
  lenka: 'Ленка «Кнопка»',
  dimon: 'Димон «Сом»',
  vityok: 'Витёк «Шлак»',
  maks: 'Макс «Штиль»',
  andryukha: 'Андрюха «Прапор»',
  zheka: 'Жека «Барыга»',
  tyoma: 'Тёма «Тихий»',
  starshoy: 'Старшой',
};

export const heroName = (p: HeroPick): string => (p.lad ? LADS[p.lad] : NAMES[p.cls][p.n - 1]);
export const heroPortrait = (p: HeroPick): string => (p.lad ? `lad-${p.lad}` : `hero-${p.cls}-${p.n}`);
/** Подпись стороны боя: без героя — «Нейтралы» или гарнизон. */
export const sideName = (x: { pick: HeroPick | null; label?: string }): string => (x.pick ? heroName(x.pick) : x.label ?? 'Нейтралы');
export const classOf = (id: string): HeroClass => CLASSES.find((c) => c.id === id)!;
export const factionClasses = (f: Faction): HeroClass[] => CLASSES.filter((c) => c.faction === f);
