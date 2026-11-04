/* Данные карты приключений: ресурсы, местности, объекты. Объект — запись с правилами, а не код (DESIGN.md §3). */
import type { Faction } from '../creatures';

export const RES = ['semki', 'wood', 'stone', 'amber', 'salt', 'stariron', 'resin'] as const;
export type ResId = (typeof RES)[number];
export type Purse = Partial<Record<ResId, number>>;
export const RES_NAME: Record<ResId, string> = { semki: 'Семки', wood: 'Лес', stone: 'Камень', amber: 'Янтарь', salt: 'Соль', stariron: 'Звёздное железо', resin: 'Живица' };
/** Цена ресурса в семках на рынке. */
export const RES_VALUE: Record<ResId, number> = { semki: 1, wood: 250, stone: 250, amber: 500, salt: 500, stariron: 500, resin: 500 };
/** Шахта: сколько даёт в день. */
export const MINE_INCOME: Record<ResId, number> = { semki: 1000, wood: 2, stone: 2, amber: 1, salt: 1, stariron: 1, resin: 1 };
/** Редкие ресурсы фракции (DESIGN.md §5). */
export const FACTION_RES: Record<Exclude<Faction, 'neutral'>, [ResId, ResId]> = {
  zatulye: ['wood', 'salt'], zatonye: ['resin', 'salt'], kuznya: ['stone', 'stariron'], akademiya: ['amber', 'stariron'],
};

export type TerrainId = 'meadow' | 'swamp' | 'ash' | 'pine' | 'rough' | 'sand' | 'water' | 'underground';
export interface TerrainDef {
  id: TerrainId;
  name: string;
  /** Очков хода за прямой шаг без дороги. */
  cost: number;
  /** Фон боя. */
  field: string;
  /** Цвет на мини-карте. */
  color: number;
  /** Звук копыт. */
  step: string;
}
/** Порядок важен: номер местности лежит в клетке и в текстуре шейдера. */
export const TERRAINS: TerrainDef[] = [
  { id: 'meadow', name: 'Луг', cost: 100, field: 'meadow', color: 0x6f9a3c, step: 'horse-grass' },
  { id: 'swamp', name: 'Болото', cost: 175, field: 'swamp', color: 0x4a6048, step: 'horse-swamp' },
  { id: 'ash', name: 'Пепелище', cost: 125, field: 'ash', color: 0x54504e, step: 'horse-ash' },
  { id: 'pine', name: 'Бор', cost: 125, field: 'pine', color: 0x6c5a3a, step: 'horse-grass' },
  { id: 'rough', name: 'Предгорья', cost: 125, field: 'meadow', color: 0x8a8060, step: 'horse-road' },
  { id: 'sand', name: 'Песок', cost: 150, field: 'ford', color: 0xc9b070, step: 'horse-road' },
  { id: 'water', name: 'Вода', cost: 100, field: 'ford', color: 0x2f6a94, step: 'boat-row' },
  { id: 'underground', name: 'Подземелье', cost: 100, field: 'crater', color: 0x3a3430, step: 'horse-road' },
];
export const TERRAIN_INDEX = Object.fromEntries(TERRAINS.map((t, i) => [t.id, i])) as Record<TerrainId, number>;
export const WATER = TERRAIN_INDEX.water;
/** Родная местность: на ней фракция не теряет хода. */
export const NATIVE: Record<Exclude<Faction, 'neutral'>, TerrainId> = { zatulye: 'meadow', zatonye: 'swamp', kuznya: 'ash', akademiya: 'pine' };

/** Дороги: 0 — нет; цена шага. */
export const ROAD_COST = [0, 75, 50, 50];
export const ROAD_ART = ['', 'road-dirt', 'road-stone', 'road-plank'];

export type ObjEffect =
  | { t: 'pile'; res: ResId; min: number; max: number }
  | { t: 'chest' }
  | { t: 'campfire' }
  | { t: 'artifact' }
  | { t: 'mine'; res: ResId }
  | { t: 'mill'; res: ResId; n: number }
  | { t: 'watchtower' }
  | { t: 'shrine'; level: number }
  | { t: 'stat'; stat: 'atk' | 'def' | 'power' | 'know' }
  | { t: 'xp'; n: number }
  | { t: 'well' }
  | { t: 'fountain' }
  | { t: 'stables' }
  | { t: 'tavern' }
  | { t: 'tradepost' }
  | { t: 'shipyard' }
  | { t: 'boat' }
  | { t: 'prison' }
  | { t: 'obelisk' }
  | { t: 'portal' }
  | { t: 'seer' }
  | { t: 'key' }
  | { t: 'gate' }
  | { t: 'sign' }
  | { t: 'garrison' }
  | { t: 'treasury' }
  | { t: 'dwelling'; cre: string }
  | { t: 'stack' };

export interface ObjDef {
  id: string;
  name: string;
  /** Файл в public/geroi/a/map (без расширения). */
  art: string;
  /** Занятые клетки: w×h, вход — нижний ряд, посередине. */
  w: number;
  h: number;
  /** Ширина спрайта в клетках. */
  size: number;
  effect: ObjEffect;
  /** Подсказка. */
  text: string;
}

const O = (id: string, name: string, w: number, h: number, size: number, effect: ObjEffect, text: string, art = `obj-${id}`): ObjDef => ({ id, name, art, w, h, size, effect, text });
const PILES: [ResId, string, number, number][] = [['semki', 'Мешок семок', 500, 1000], ['wood', 'Брёвна', 5, 10], ['stone', 'Камень', 5, 10], ['amber', 'Янтарь', 3, 6], ['salt', 'Соль', 3, 6], ['stariron', 'Звёздное железо', 3, 6], ['resin', 'Живица', 3, 6]];
const MINES: [ResId, string, string][] = [['semki', 'semki', 'Семечковое поле'], ['wood', 'wood', 'Лесопилка'], ['stone', 'stone', 'Каменоломня'], ['amber', 'amber', 'Янтарная копь'], ['salt', 'salt', 'Солеварня'], ['stariron', 'stariron', 'Метеоритная шахта'], ['resin', 'resin', 'Подсочный стан']];
const DWELLS: [string, string, string][] = [['wolf', 'neutral-wolf', 'Волчье логово'], ['boar', 'neutral-boar', 'Кабанья чаща'], ['bandit', 'neutral-bandit', 'Разбойничий стан'], ['leshak', 'neutral-leshak', 'Замшелая роща'], ['kikimora', 'neutral-kikimora', 'Кикиморина изба'], ['salamander', 'neutral-salamander', 'Лавовая яма'], ['bear', 'neutral-bear', 'Медвежья берлога'], ['sirin', 'neutral-sirin', 'Гнездо сирина'], ['stonegiant', 'neutral-stonegiant', 'Круг валунов'], ['poloz', 'neutral-poloz', 'Логово полоза']];

export const OBJECTS: Record<string, ObjDef> = {};
const put = (d: ObjDef): void => {
  OBJECTS[d.id] = d;
};
for (const [res, name, a, b] of PILES) put(O(`res-${res}`, name, 1, 1, 1.1, { t: 'pile', res, min: a, max: b }, 'Подобрать', `res-${res}`));
for (const [res, art, name] of MINES) put(O(`mine-${art}`, name, 3, 2, 2.9, { t: 'mine', res }, `Захватить: ${MINE_INCOME[res]} в день`));
for (const [id, cre, name] of DWELLS) put(O(`dwell-${id}`, name, 3, 2, 2.7, { t: 'dwelling', cre }, 'Жилище: найм каждую неделю'));
for (const v of [
  O('chest', 'Сундук', 1, 1, 1.2, { t: 'chest' }, 'Семки или опыт на выбор'),
  O('campfire', 'Костёр', 1, 1, 1.3, { t: 'campfire' }, 'Брошенный лагерь: семки и ресурс'),
  O('artifact', 'Постамент', 1, 1, 1.3, { t: 'artifact' }, 'Артефакт'),
  O('windmill', 'Ветряная мельница', 2, 2, 2.2, { t: 'mill', res: 'wood', n: 4 }, 'Раз в неделю: лес'),
  O('watermill', 'Водяная мельница', 2, 2, 2.2, { t: 'mill', res: 'semki', n: 1000 }, 'Раз в неделю: семки'),
  O('watchtower', 'Дозорная вышка', 2, 2, 1.8, { t: 'watchtower' }, 'Открывает округу'),
  O('shrine1', 'Малое святилище', 2, 1, 1.8, { t: 'shrine', level: 1 }, 'Учит заклинанию 1-го круга'),
  O('shrine2', 'Святилище', 2, 1, 2, { t: 'shrine', level: 2 }, 'Учит заклинанию 2-го круга'),
  O('shrine3', 'Большое святилище', 3, 2, 2.4, { t: 'shrine', level: 3 }, 'Учит заклинанию 3-го круга, нужна Мудрость'),
  O('learnstone', 'Камень учения', 1, 1, 1.5, { t: 'xp', n: 1000 }, '+1000 опыта, один раз каждому герою'),
  O('wisewell', 'Колодец', 2, 1, 1.7, { t: 'well' }, 'Полная мана, раз в день'),
  O('luckfountain', 'Фонтан удачи', 2, 1, 1.7, { t: 'fountain' }, '+1 удача в следующем бою'),
  O('gloryhill', 'Курган славы', 2, 2, 2.2, { t: 'stat', stat: 'atk' }, '+1 к атаке, один раз каждому герою'),
  O('stables', 'Конюшни', 3, 2, 2.6, { t: 'stables' }, 'Запас хода до конца недели'),
  O('tavern', 'Придорожный трактир', 3, 2, 2.6, { t: 'tavern' }, 'Нанять героя'),
  O('tradepost', 'Торговый пост', 3, 2, 2.6, { t: 'tradepost' }, 'Рынок'),
  O('shipyard', 'Верфь', 3, 2, 2.6, { t: 'shipyard' }, 'Купить лодку'),
  O('boat', 'Лодка', 1, 1, 1.5, { t: 'boat' }, 'Сесть в лодку'),
  O('prison', 'Клетка', 2, 1, 1.8, { t: 'prison' }, 'В клетке сидит герой'),
  O('obelisk', 'Обелиск', 1, 1, 1.5, { t: 'obelisk' }, 'Открывает кусок карты к осколку'),
  O('portal1', 'Красная арка', 2, 1, 1.9, { t: 'portal' }, 'Портал'),
  O('portal2', 'Синее кольцо', 2, 1, 1.9, { t: 'portal' }, 'Портал'),
  O('whirlpool', 'Водоворот', 1, 1, 1.4, { t: 'portal' }, 'Портал на воде'),
  O('seerhut', 'Хижина провидца', 2, 2, 2.2, { t: 'seer' }, 'У провидца есть просьба'),
  O('keytent', 'Шатёр ключника', 2, 1, 1.9, { t: 'key' }, 'Выдаёт ключ'),
  O('guardtent', 'Застава', 2, 1, 1.9, { t: 'gate' }, 'Пропускает с ключом'),
  O('signpost', 'Указатель', 1, 1, 1.1, { t: 'sign' }, 'Прочитать'),
  O('garrison', 'Застава-гарнизон', 2, 1, 2, { t: 'garrison' }, 'Флаг и отряды стоят здесь'),
  O('treasury-meadow', 'Руины башни', 3, 2, 2.7, { t: 'treasury' }, 'Сокровищница под охраной'),
  O('treasury-swamp', 'Затонувшая баржа', 3, 2, 2.7, { t: 'treasury' }, 'Сокровищница под охраной'),
  O('treasury-ash', 'Старая плавильня', 3, 2, 2.7, { t: 'treasury' }, 'Сокровищница под охраной'),
  O('treasury-pine', 'Звёздный кратер', 3, 2, 2.7, { t: 'treasury' }, 'Сокровищница под охраной'),
]) put(v);
OBJECTS.stack = { id: 'stack', name: 'Отряд', art: '', w: 1, h: 1, size: 1, effect: { t: 'stack' }, text: 'Нейтральный отряд: не пропустит мимо' };

/** Значок замка на карте занимает 5×3, вход — ворота посередине снизу. */
export const TOWN_W = 5;
export const TOWN_H = 3;
export const TOWN_SIZE = 5.4;

export const MOUNTAINS = 4;
/** Занятые клетки горы: 4×3. */
export const MOUNT_W = 4;
export const MOUNT_H = 3;
