/* «Заколдованная страна» — таблицы правил из инструкции и книги ведущего (сверено по страницам оригинала).
 * Всё без DOM: этим пользуются движок, боты, сервер и тесты. */

export type Stat = 'str' | 'dex' | 'wis' | 'con' | 'brv';
export const STATS: Stat[] = ['str', 'dex', 'wis', 'con', 'brv'];
export const STAT_NAME: Record<Stat, string> = { str: 'Сила', dex: 'Ловкость', wis: 'Мудрость', con: 'Сложение', brv: 'Храбрость' };
export const STAT_SHORT: Record<Stat, string> = { str: 'Сил', dex: 'Лов', wis: 'Мдр', con: 'Слж', brv: 'Хрб' };

/** Поправка качества: 3 → −3, 4–5 → −2, 6–8 → −1, 9–12 → 0, 13–15 → +1, 16–17 → +2, 18 → +3 (мудрость 18 → +4). */
export function statMod(v: number, stat: Stat = 'str'): number {
  if (stat === 'brv') return 0;
  if (v <= 3) return -3;
  if (v <= 5) return -2;
  if (v <= 8) return -1;
  if (v <= 12) return 0;
  if (v <= 15) return 1;
  if (v <= 17) return 2;
  return stat === 'wis' ? 4 : 3;
}

/** Сколько нужно выбросить основным броском (d3 → 0/6/12, + d6), чтобы попасть в цель с этим КД. null — только заклинанием. */
export function needToHit(kd: number): number | null {
  if (kd <= -3) return null;
  return Math.min(18, 17 - kd);
}

export type ClassId = 'voin' | 'elf' | 'mag' | 'kron' | 'gnom';
export const CLASS_IDS: ClassId[] = ['voin', 'elf', 'mag', 'kron', 'gnom'];

export interface ClassDef {
  id: ClassId;
  name: string;
  /** Главные качества: не ниже 9. */
  main: Stat[];
  /** Очки риска на 0-м уровне — бросок d6 по списку. */
  hp: number[];
  /** ИО, нужные для уровней 1…12. */
  xp: number[];
  /** Уровень заклинаний, который получают на уровнях 1…12 (0 — нет). */
  spells: number[];
  /** Заклинание на 0-м уровне (эльф — 1-го уровня). */
  spell0?: number;
  /** Кубики прибавки ко всем качествам при оформлении (маг: 0-0-0-1-2-3 на d6; крон: 0-0-1 на d3). */
  statBonus?: number[];
  /** Попадание: противнику КД + n (воин +1, маг +2). */
  hitBonus: number;
  /** Маг: попав, ещё −1 ОР. */
  dmgBonus: number;
  /** Гном: в него труднее попасть (КД − n). */
  acBonus: number;
  /** БУ легче на n (маг — на 2). */
  saveBonus: number;
  /** Что можно носить. */
  armor: (id: string) => boolean;
  shield: boolean;
  weapon: (id: string) => boolean;
  /** Доспех дороже (гном +5). */
  armorExtra: number;
  /** Отгон: маг — каменных и оборотней, крон — животных. */
  turn?: 'stone' | 'animals';
  /** Стойкость (эльф): яд пауков-крабов, паралич, гулы. */
  resist?: string[];
  text: string;
}

const TWO_HANDED = new Set(['sword2', 'halberd']);
const DAGGERS = new Set(['dagger_gold', 'dagger_silver', 'dagger']);

export const CLASSES: Record<ClassId, ClassDef> = {
  voin: {
    id: 'voin', name: 'Воин', main: ['str'], hp: [7, 8],
    xp: [2000, 4000, 5500, 7000, 9000, 11000, 12000, 13500, 15000, 17000, 20000, 25000],
    spells: [0, 0, 1, 0, 0, 2, 0, 3, 0, 4, 0, 5],
    hitBonus: 1, dmgBonus: 0, acBonus: 0, saveBonus: 0, armorExtra: 0,
    armor: () => true, shield: true, weapon: () => true,
    text: 'Доспех, щит и оружие — любые. В противника легче попасть на 1 очко (+1 КД у цели).',
  },
  elf: {
    id: 'elf', name: 'Эльф', main: ['str', 'brv'], hp: [4, 5, 6, 7, 8, 9],
    xp: [2000, 4000, 6000, 8000, 9000, 10000, 12000, 13500, 15000, 18000, 21000, 26000],
    spells: [2, 3, 4, 5, 6, 7, 8, 9, 9, 10, 11, 12], spell0: 1,
    hitBonus: 0, dmgBonus: 0, acBonus: 0, saveBonus: 0, armorExtra: 0,
    armor: (id) => id !== 'laty', shield: true, weapon: (id) => !TWO_HANDED.has(id),
    resist: ['paukkrab', 'paralysis', 'gul'],
    text: 'Доспех, щит и оружие — любые, кроме лат и двуручных. На 0-м уровне — заклинание 1-го уровня. Противодействие яду пауков-крабов, параличу, гулам.',
  },
  mag: {
    id: 'mag', name: 'Маг', main: ['wis'], hp: [5, 6, 7, 8, 9, 10],
    xp: [500, 1000, 1500, 2000, 3000, 4000, 5000, 6500, 8000, 10000, 12000, 15000],
    spells: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], statBonus: [0, 0, 0, 1, 2, 3],
    hitBonus: 2, dmgBonus: 1, acBonus: 0, saveBonus: 2, armorExtra: 0,
    armor: (id) => id === 'kozha' || id === 'none', shield: false, weapon: (id) => DAGGERS.has(id),
    turn: 'stone',
    text: 'Доспех — кожаный, щит нельзя, оружие — все кинжалы. КД противника +2, при попадании дополнительно −1 ОР. Качества +0-0-0-1-2-3. БУ кидать на 2 легче. Отгон каменного и оборотней.',
  },
  kron: {
    id: 'kron', name: 'Крон', main: ['wis', 'dex'], hp: [5, 6, 7],
    xp: [1000, 2000, 3000, 4000, 5500, 7000, 8500, 10000, 12000, 14000, 16000, 19000],
    spells: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], statBonus: [0, 0, 1],
    hitBonus: 0, dmgBonus: 0, acBonus: 0, saveBonus: 0, armorExtra: 0,
    armor: (id) => id !== 'laty', shield: true,
    weapon: (id) => id === 'sword1' || id === 'bow_short' || id === 'arrow_short' || id === 'stone',
    turn: 'animals',
    text: 'Доспех и щит — кроме лат. Оружие — короткий меч и короткий лук. Отгон животных. Качества +0-0-1.',
  },
  gnom: {
    id: 'gnom', name: 'Гном', main: ['dex', 'con'], hp: [6, 7, 8],
    xp: [1400, 2300, 4000, 7000, 10000, 12000, 13000, 14800, 16700, 18500, 20000, 23000],
    spells: [1, 0, 2, 0, 3, 0, 4, 5, 0, 6, 0, 7],
    hitBonus: 0, dmgBonus: 0, acBonus: 1, saveBonus: 0, armorExtra: 5,
    armor: (id) => id !== 'laty', shield: true,
    weapon: (id) => !TWO_HANDED.has(id) && id !== 'sword_long' && id !== 'bow_long' && id !== 'arrow_long',
    text: 'Доспех — любой, кроме лат (+5 к цене из-за маленького роста). Оружие и щит — кроме двуручных, длинного меча и большого лука. В гнома труднее попасть на 1 очко (КД на 1 ниже).',
  },
};

/** Значения урона «a–b»: список, из которого бросок выбирает значение. */
export function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let v = a; v <= b; v++) out.push(v);
  return out;
}

export interface ArmorDef {
  id: string;
  name: string;
  price: number;
  kd: number;
}
export const ARMORS: ArmorDef[] = [
  { id: 'laty', name: 'Латы', price: 150, kd: 2 },
  { id: 'pancir', name: 'Панцирь', price: 80, kd: 3 },
  { id: 'kolch_silver', name: 'Серебряная кольчуга', price: 50, kd: 4 },
  { id: 'kolch_iron', name: 'Железная кольчуга', price: 40, kd: 5 },
  { id: 'kozha_silver', name: 'Кожано-серебряный', price: 30, kd: 6 },
  { id: 'kozha', name: 'Кожаный', price: 20, kd: 7 },
  { id: 'none', name: 'Никакого', price: 0, kd: 8 },
];
export const SHIELD = { id: 'shield', name: 'Щит', price: 15, kd: 1 };

export type WeaponKind = 'melee' | 'missile' | 'launcher' | 'ammo';
export interface WeaponDef {
  id: string;
  name: string;
  group: 'Мечи' | 'Кинжалы' | 'Прочее' | 'Метательное';
  price: number;
  /** Урон. У лука/арбалета/пращи урон — у стрел (ammo), у самого — пусто. */
  dmg: number[];
  kind: WeaponKind;
  twoHanded?: boolean;
  /** Стрелы к чему (ammo) / чем стреляет (launcher). */
  ammoFor?: string;
  /** Продаётся поштучно (стрелы, ядра, дротики). */
  each?: boolean;
  /** Катапульта: поражает от 1 до 6 опасностей. */
  multi?: boolean;
}
export const WEAPONS: WeaponDef[] = [
  { id: 'sword2', name: 'Двуручный меч', group: 'Мечи', price: 35, dmg: range(4, 9), kind: 'melee', twoHanded: true },
  { id: 'sword_long', name: 'Длинный меч', group: 'Мечи', price: 20, dmg: range(2, 7), kind: 'melee' },
  { id: 'sword1', name: 'Короткий меч', group: 'Мечи', price: 15, dmg: range(1, 6), kind: 'melee' },
  { id: 'dagger_gold', name: 'Золотой кинжал', group: 'Кинжалы', price: 30, dmg: range(1, 5), kind: 'melee' },
  { id: 'dagger_silver', name: 'Серебряный кинжал', group: 'Кинжалы', price: 60, dmg: range(1, 6), kind: 'melee' },
  { id: 'dagger', name: 'Простой кинжал', group: 'Кинжалы', price: 3, dmg: range(1, 3), kind: 'melee' },
  { id: 'halberd', name: 'Алебарда (двуручная)', group: 'Прочее', price: 25, dmg: range(3, 8), kind: 'melee', twoHanded: true },
  { id: 'spear', name: 'Копьё', group: 'Прочее', price: 7, dmg: range(2, 4), kind: 'melee' },
  { id: 'hammer', name: 'Боевой молот', group: 'Прочее', price: 6, dmg: range(1, 3), kind: 'melee' },
  { id: 'axe', name: 'Боевой топор', group: 'Прочее', price: 30, dmg: range(1, 9), kind: 'melee' },
  { id: 'stone', name: 'Камень', group: 'Прочее', price: 0, dmg: [0, 1], kind: 'melee' },
  { id: 'bow_long', name: 'Большой лук', group: 'Метательное', price: 40, dmg: [], kind: 'launcher', ammoFor: 'arrow_long' },
  { id: 'arrow_long', name: 'Стрела большого лука', group: 'Метательное', price: 1, dmg: range(2, 7), kind: 'ammo', ammoFor: 'bow_long', each: true },
  { id: 'bow_short', name: 'Короткий лук', group: 'Метательное', price: 25, dmg: [], kind: 'launcher', ammoFor: 'arrow_short' },
  { id: 'arrow_short', name: 'Стрела короткого лука', group: 'Метательное', price: 1, dmg: range(1, 6), kind: 'ammo', ammoFor: 'bow_short', each: true },
  { id: 'crossbow', name: 'Арбалет', group: 'Метательное', price: 20, dmg: [], kind: 'launcher', ammoFor: 'bolt' },
  { id: 'bolt', name: 'Арбалетная стрела', group: 'Метательное', price: 1, dmg: range(2, 4), kind: 'ammo', ammoFor: 'crossbow', each: true },
  { id: 'sling', name: 'Праща', group: 'Метательное', price: 15, dmg: [], kind: 'launcher', ammoFor: 'sling_stone' },
  { id: 'sling_stone', name: 'Камень для пращи', group: 'Метательное', price: 0, dmg: range(1, 3), kind: 'ammo', ammoFor: 'sling', each: true },
  { id: 'sling_ball', name: 'Ядро для пращи', group: 'Метательное', price: 1, dmg: range(1, 5), kind: 'ammo', ammoFor: 'sling', each: true },
  { id: 'dart', name: 'Дротик', group: 'Метательное', price: 1, dmg: range(1, 3), kind: 'missile', each: true },
  { id: 'throw_axe', name: 'Метательный топор', group: 'Метательное', price: 5, dmg: range(2, 4), kind: 'missile', each: true },
  { id: 'catapult', name: 'Катапульта', group: 'Метательное', price: 250, dmg: [], kind: 'launcher', ammoFor: 'catapult_ball' },
  { id: 'catapult_ball', name: 'Ядро для катапульты', group: 'Метательное', price: 20, dmg: range(1, 18), kind: 'ammo', ammoFor: 'catapult', each: true, multi: true },
];

export interface GearDef {
  id: string;
  name: string;
  price: number;
  /** Вместимость для монет. */
  cap?: number;
  /** Животное: очки риска (бросок d6 по списку) и КД. */
  animal?: { hp: number[]; kd: number };
  text?: string;
  group: 'Вещи' | 'Животные' | 'Волшебные вещи';
}
export const GEAR: GearDef[] = [
  { id: 'sack', name: 'Мешок', price: 1, cap: 200, group: 'Вещи' },
  { id: 'sack_big', name: 'Большой мешок', price: 2, cap: 400, group: 'Вещи' },
  { id: 'wine', name: 'Вино (3 л)', price: 3, group: 'Вещи', text: 'С рогом птицы рог, франкенштейна или челюсти лечит.' },
  { id: 'cart', name: 'Повозка', price: 100, cap: 6000, group: 'Вещи', text: 'Нужна лошадь или мул.' },
  { id: 'advisor', name: '«Советчик»', price: 1000, group: 'Вещи', text: 'Отвечает на все вопросы играющих (возможность обмана — 16%).' },
  { id: 'identify', name: 'Распознание напитков', price: 200, group: 'Вещи', text: 'Ведущий говорит, что за напиток вам предлагают (возможность обмана — 16%).' },
  { id: 'stake', name: 'Кол', price: 2, group: 'Вещи', text: 'Уничтожение вампиров.' },
  { id: 'keys', name: 'Набор ключей для открывания сундуков', price: 5, group: 'Вещи' },
  { id: 'mule', name: 'Мул', price: 25, cap: 1500, animal: { hp: [5, 6, 7], kd: 8 }, group: 'Животные' },
  { id: 'horse', name: 'Лошадь', price: 50, cap: 1700, animal: { hp: [4, 5, 6, 7, 8, 9], kd: 8 }, group: 'Животные' },
  { id: 'warhorse', name: 'Боевой конь', price: 200, cap: 1700, animal: { hp: [4, 5, 6, 7, 8, 9], kd: 5 }, group: 'Животные' },
  { id: 'holy_water', name: 'Святая вода', price: 25, group: 'Волшебные вещи', text: 'Отгоняет оборотней.' },
  { id: 'aconite', name: 'Священный аконит', price: 50, group: 'Волшебные вещи', text: 'Отгоняет мертвецов.' },
];
/** Монеты без мешков. */
export const POCKETS = 100;

/** Заклинание: уровень, число применений, БУ опасности против него, что делает (для движка — kind). */
export interface SpellDef {
  id: string;
  level: number;
  name: string;
  /** Сколько раз (null — без счёта, «Золото» — один раз). */
  uses: number | null;
  /** Бросок удачи опасности против заклинания (для действующих на противника). */
  save?: number;
  /** Действует на противника: сначала нужно попасть. */
  target?: boolean;
  kind: string;
  text: string;
}
export const SPELLS: SpellDef[] = [
  { id: 'svet', level: 1, name: 'Свет', uses: 5, kind: 'light', text: 'Вспыхивает свет.' },
  { id: 'tma', level: 1, name: 'Тьма', uses: 5, kind: 'escape', text: 'Становится темно: вы убегаете.' },
  { id: 'golos', level: 1, name: 'Голос', uses: 5, kind: 'escape33', text: 'Преследователи гонятся за голосом. При 33% не действует.' },
  { id: 'strah0', level: 1, name: 'Борьба со страхом', uses: 5, save: 12, target: true, kind: 'repel', text: 'Опасность возвращается обратно.' },
  { id: 'iniciativa', level: 1, name: 'Инициатива', uses: 10, kind: 'initiative', text: 'Игрок бьёт первым.' },
  { id: 'otpiranie', level: 2, name: 'Отпирание дверей и сундуков', uses: null, kind: 'unlock', text: 'Открывает запертые и потайные двери, сундуки.' },
  { id: 'skorost', level: 2, name: 'Заклинание скорости', uses: 5, kind: 'escape', text: 'Легко убегаете.' },
  { id: 'vs_paralysis', level: 2, name: 'Заклинание против паралича', uses: 5, kind: 'ward:paralysis', text: 'Спасает от паралича.' },
  { id: 'vs_poison', level: 2, name: 'Заклинание против яда', uses: 5, kind: 'ward:poison', text: 'Спасает от яда.' },
  { id: 'vs_acid', level: 3, name: 'Заклинание против кислоты и газа', uses: 5, kind: 'ward:acid', text: 'Против духа дракона, блэмбии, дарка.' },
  { id: 'lovkost1', level: 3, name: 'Ловкость-1', uses: 2, kind: 'buff:dex:2', text: 'На 1 бой ловкость +2.' },
  { id: 'raspoznanie', level: 3, name: 'Распознание напитков', uses: null, kind: 'identify', text: 'Узнать, что в бутылке.' },
  { id: 'panaceya', level: 4, name: 'Панацея', uses: 1, kind: 'heal:full', text: 'Восстановление первоначальных ОР. Можно не себе.' },
  { id: 'sila', level: 4, name: 'Сила', uses: 2, kind: 'buff:str:2', text: 'Сила +2 (на 1 бой).' },
  { id: 'vs_stone', level: 4, name: 'Заклинание против окаменения', uses: 5, kind: 'ward:petrify', text: 'Спасает от окаменения.' },
  { id: 'zoloto1', level: 4, name: 'Золото-1', uses: 1, kind: 'gold:500', text: '500 камней превращаются в монеты.' },
  { id: 'nevidimost', level: 5, name: 'Заклинание невидимости', uses: 3, kind: 'invis', text: 'На 1 бой. Повышает КД: было 8 7 6 5 4 3 2 1 0 −1 −2 — стало 3 2 2 1 1 0 0 0 −1 −2 −3.' },
  { id: 'fantom1', level: 5, name: 'Фантом-1', uses: 1, kind: 'phantom:1', text: 'Появляется ваша копия — фантом, с тем же оружием и такими же качествами. ИО за ликвидацию фантомом опасности (50% очков) идут вам.' },
  { id: 'slabost', level: 5, name: 'Слабость', uses: null, save: 12, target: true, kind: 'weaken', text: 'КД противника на 2 увеличивается (на 1 бой).' },
  { id: 'stena', level: 5, name: 'Невидимая стена', uses: 3, kind: 'escape', text: 'Спокойное бегство.' },
  { id: 'strah1', level: 5, name: 'Страх-1', uses: 1, save: 12, kind: 'fear:10', text: 'Исчезает 10 опасностей.' },
  { id: 'shield_fly', level: 5, name: 'Летающий щит', uses: null, kind: 'cap:10000', text: 'За обладателем этого заклинания летает щит — вместимость 10 000 монет.' },
  { id: 'pautina', level: 6, name: 'Паутина', uses: null, save: 13, target: true, kind: 'web', text: 'От 1 до 5 опасностей затягиваются паутиной и теряют половину очков риска. Даётся 50% игровых очков.' },
  { id: 'vs_fire', level: 6, name: 'Заклинание против огня', uses: 5, kind: 'ward:fire', text: 'Против духа дракона, фоербартов.' },
  { id: 'lovkost2', level: 6, name: 'Ловкость-2', uses: 2, kind: 'buff:dex:3', text: 'На 1 бой ловкость +3.' },
  { id: 'fantom2', level: 6, name: 'Фантом-2', uses: 1, kind: 'phantom:2', text: 'Два «фантома-1».' },
  { id: 'zoloto2', level: 6, name: 'Золото-2', uses: 1, kind: 'gold:1000', text: '1000 монет.' },
  { id: 'strah2', level: 6, name: 'Страх-2', uses: 1, save: 13, kind: 'fear:20', text: 'Исчезает 20 опасностей.' },
  { id: 'vosstanovlenie', level: 7, name: 'Восстановление', uses: 2, kind: 'heal:full', text: 'Восстанавливает жизненные очки. Можно не себе.' },
  { id: 'sverhnevid', level: 7, name: 'Сверхневидимость', uses: 5, kind: 'invis2', text: 'Невидимость на 1 бой.' },
  { id: 'zoloto3', level: 7, name: 'Золото-3', uses: 1, kind: 'gold:2000', text: '2000 монет.' },
  { id: 'moshch', level: 7, name: 'Мощь', uses: 3, kind: 'buff:str:5', text: 'Сила +5 на 1 бой.' },
  { id: 'lovkost3', level: 8, name: 'Ловкость-3', uses: 3, kind: 'buff:dex:3', text: 'На 1 бой ловкость +3.' },
  { id: 'fantom3', level: 8, name: 'Фантом-3', uses: 1, kind: 'phantom:3', text: 'Три фантома.' },
  { id: 'molniya', level: 8, name: 'Молния', uses: 3, save: 14, target: true, kind: 'kill:1:3', text: 'Молния испепеляет 1 опасность, даётся 1/3 игровых очков.' },
  { id: 'posoh', level: 8, name: 'Посох мудрости', uses: null, kind: 'scout', text: 'Распознаёт опасность в следующей комнате или впереди.' },
  { id: 'osleplenie', level: 9, name: 'Ослепление', uses: 3, save: 14, kind: 'blind', text: 'Противники (до 10) становятся слепыми. Ваш КД улучшается на 3. Даётся 2/3 игровых очков.' },
  { id: 'formula8', level: 9, name: 'Жизненная формула', uses: 1, kind: 'heal:8', text: '+8 ОР. Можно не себе.' },
  { id: 'zoloto4', level: 10, name: 'Золото-4', uses: 1, kind: 'gold:5000', text: '5000 монет.' },
  { id: 'luch', level: 10, name: 'Луч смерти', uses: 2, save: 15, target: true, kind: 'kill:5:5', text: 'Опасность поражается лучом (до 5 опасностей). Даётся 1/5 игровых очков.' },
  { id: 'formula15', level: 10, name: 'Формула жизни', uses: 1, kind: 'heal:15', text: '+15 ОР. Можно не себе.' },
  { id: 'raskamenenie', level: 11, name: 'Заклинание для раскаменения', uses: 1, kind: 'unpetrify', text: 'Можно не себе.' },
  { id: 'zoloto5', level: 11, name: 'Золото-5', uses: 1, kind: 'gold:10000', text: '10 000 монет.' },
  { id: 'abs_luch', level: 11, name: 'Абсолютный луч', uses: 3, save: 15, target: true, kind: 'kill:5:5', text: 'До 5 опасностей. Даётся 1/5 игровых очков.' },
  { id: 'fireball', level: 11, name: 'Огненный шар', uses: 3, save: 16, kind: 'fireball', text: 'Поражается от 1 до 18 опасностей. Игровые очки не даются.' },
  { id: 'voskreshenie', level: 12, name: 'Воскрешение из мёртвых', uses: 1, kind: 'raise', text: 'Не себе.' },
];
export const SPELL: Record<string, SpellDef> = Object.fromEntries(SPELLS.map((s) => [s.id, s]));

/** Бутылочки 1–25 и волшебные вещи 26–43 — по списку книги ведущего. */
export interface MagicDef {
  n: number;
  name: string;
  /** Эффект для движка. */
  fx: string;
  text: string;
}
export const BOTTLES: MagicDef[] = [
  { n: 1, name: 'Уменьшитель класса доспехов', fx: 'invis', text: 'На 1 битву (как «Заклинание невидимости»).' },
  { n: 2, name: 'Яд', fx: 'hp:-1', text: '−1 ОР.' },
  { n: 3, name: 'Яд', fx: 'hp:-2', text: '−2 ОР.' },
  { n: 4, name: 'Яд', fx: 'hp:-3', text: '−3 ОР.' },
  { n: 5, name: 'Жизненный бальзам', fx: 'hp:1', text: '+1 ОР.' },
  { n: 6, name: 'Жизненный бальзам', fx: 'hp:2', text: '+2 ОР.' },
  { n: 7, name: 'Жизненный бальзам', fx: 'hp:3', text: '+3 ОР.' },
  { n: 8, name: 'Лечение ран', fx: 'heal:full', text: 'Восстанавливает первоначальные ОР.' },
  { n: 9, name: 'Яд', fx: 'death', text: 'Смерть.' },
  { n: 10, name: 'Смеситель', fx: 'mix', text: '+1,5 — 2,5 — 3,5 ОР (кидается трёхгранный кубик).' },
  { n: 11, name: 'Напиток слабости', fx: 'stat:str:-3', text: 'Сила −3.' },
  { n: 12, name: 'Напиток слабости', fx: 'stat:str:-2', text: 'Сила −2.' },
  { n: 13, name: 'Напиток ловкости', fx: 'stat:dex:3', text: 'Ловкость +3.' },
  { n: 14, name: 'Напиток ловкости', fx: 'stat:dex:2', text: 'Ловкость +2.' },
  { n: 15, name: 'Напиток баргула', fx: 'stat:dex:-2', text: 'Ловкость −2.' },
  { n: 16, name: 'Напиток баргула', fx: 'stat:dex:-3', text: 'Ловкость −3.' },
  { n: 17, name: 'Напиток силы', fx: 'stat:str:3', text: 'Сила +3.' },
  { n: 18, name: 'Напиток силы', fx: 'stat:str:2', text: 'Сила +2.' },
  { n: 19, name: 'Бальзам Чёрного мага', fx: 'stat:wis:-3', text: 'Мудрость −3.' },
  { n: 20, name: 'Бальзам Белого мага', fx: 'stat:wis:3', text: 'Мудрость +3.' },
  { n: 21, name: 'Напиток смелых', fx: 'stat:brv:5', text: 'Храбрость +5.' },
  { n: 22, name: 'Белая вода', fx: 'stat:con:3', text: 'Сложение +3.' },
  { n: 23, name: 'Коварная вода', fx: 'stat:brv:-4', text: 'Храбрость −4.' },
  { n: 24, name: 'Чёрная вода', fx: 'stat:con:-2', text: 'Сложение −2.' },
  { n: 25, name: 'Волшебный бальзам', fx: 'xp:level', text: 'Даёт игровые очки до следующего уровня.' },
];

export const MAGIC_ITEMS: MagicDef[] = [
  { n: 26, name: 'Волшебное кольцо', fx: 'escape', text: 'Заклинание лёгкости: вы взлетаете в воздух и удаляетесь от опасности.' },
  { n: 27, name: 'Волшебный пояс', fx: 'ward:acid,fire', text: 'Заклинание против кислоты, газа и огня.' },
  { n: 28, name: 'Волшебные сапоги', fx: 'escape', text: 'Заклинание быстроты (быстрое убегание).' },
  { n: 29, name: 'Волшебный крест', fx: 'ward:paralysis', text: 'Заклинание против паралича.' },
  { n: 30, name: 'Волшебный амулет', fx: 'ward:poison', text: 'Заклинание против яда.' },
  { n: 31, name: 'Волшебный короткий меч', fx: 'weapon:sword1:2:2', text: 'КД противника +2, дополнительное отнимание +2 ОР у опасности.' },
  { n: 32, name: 'Волшебный длинный меч', fx: 'weapon:sword_long:1:3', text: 'КД противника +1, дополнительное отнимание +3 ОР у опасности.' },
  { n: 33, name: 'Волшебный двуручный меч', fx: 'weapon:sword2:1:4', text: 'КД противника +1, дополнительное отнимание +4 ОР у опасности.' },
  { n: 34, name: 'Волшебный арбалет', fx: 'weapon:crossbow:2:1:2', text: 'КД противника +2, дополнительное отнимание +1 ОР. Стрела раздваивается — в цель летят сразу 2 стрелы.' },
  { n: 35, name: 'Волшебный короткий лук', fx: 'weapon:bow_short:1:2:2', text: 'КД +1, дополнительное отнимание +2 ОР. Стрела раздваивается.' },
  { n: 36, name: 'Волшебный большой лук', fx: 'weapon:bow_long:3:0:3', text: 'КД противника +3. Стрела растраивается.' },
  { n: 37, name: 'Волшебный щит', fx: 'shield:2', text: 'Улучшает КД на 2 (был КД 3, стал КД 1).' },
  { n: 38, name: 'Волшебный кожаный доспех', fx: 'armor:kozha:-2', text: 'Улучшает ваш КД на 2.' },
  { n: 39, name: 'Волшебный кожано-серебряный доспех', fx: 'armor:kozha_silver:-3', text: 'Улучшает ваш КД на 3.' },
  { n: 40, name: 'Волшебная железная кольчуга', fx: 'armor:kolch_iron:-3', text: 'Улучшает ваш КД на 3.' },
  { n: 41, name: 'Волшебная серебряная кольчуга', fx: 'armor:kolch_silver:=2', text: 'Ваш КД становится = 2.' },
  { n: 42, name: 'Волшебный панцирь', fx: 'armor:pancir:=1', text: 'Ваш КД становится = 1.' },
  { n: 43, name: 'Волшебный шлем', fx: 'helm:1', text: 'КД улучшается на 1.' },
];
export const MAGIC: Record<number, MagicDef> = Object.fromEntries([...BOTTLES, ...MAGIC_ITEMS].map((m) => [m.n, m]));

/** Невидимость: таблица «было — стало» КД. */
export function invisKd(kd: number): number {
  const was = [8, 7, 6, 5, 4, 3, 2, 1, 0, -1, -2];
  const now = [3, 2, 2, 1, 1, 0, 0, 0, -1, -2, -3];
  if (kd >= 8) return 3;
  const i = was.indexOf(kd);
  return i >= 0 ? now[i] : kd - 1;
}

/** Агрессивность (d6) — как ведут себя встречные. */
export const AGGRESSION = [
  '',
  'не нападает, не обращает внимания, спит',
  'обращает внимание, не нападает',
  'разговаривает, грубит, нападает',
  'говорит резко и грубо, может напасть',
  'грубит, при малейшем поводе нападает',
  'нападает',
];
