/* Герой на карте: опыт, навыки, артефакты, итоговые цифры (DESIGN.md §5.9). Иконки: skill-NN, art-NN, stat-NN. */
import { classOf, type HeroPick } from '../heroes';
import { CREATURES } from '../creatures';
import type { School } from '../spells';

export interface Slot {
  cre: string;
  count: number;
}
export type Army = (Slot | null)[];

/** Чужой отряд виден примерно (как в жанре): ступень числа и её середина. */
export const ARMY_BANDS: { upto: number; name: string; mid: number }[] = [
  { upto: 4, name: 'несколько', mid: 2 },
  { upto: 9, name: 'стайка', mid: 7 },
  { upto: 19, name: 'стая', mid: 15 },
  { upto: 49, name: 'толпа', mid: 35 },
  { upto: 99, name: 'орава', mid: 75 },
  { upto: 249, name: 'полчище', mid: 175 },
  { upto: 499, name: 'тьма', mid: 375 },
  { upto: 999, name: 'легион', mid: 750 },
  { upto: Infinity, name: 'несметно', mid: 1000 },
];

export function armyBand(n: number): { name: string; mid: number } {
  return ARMY_BANDS.find((b) => n <= b.upto)!;
}

/** Отряд глазами чужого: виды те же, числа — середины ступеней. */
export function armyGuess(a: Army): Army {
  return a.map((s) => (s ? { ...s, count: armyBand(s.count).mid } : null));
}
export const ARMY_SLOTS = 7;

export interface SkillDef {
  id: string;
  name: string;
  icon: number;
  /** Что даёт по ступеням. */
  levels: [number, number, number];
  text: (n: number) => string;
  /** Вес при выборе: у воинов и у магов. */
  weight: [number, number];
}

const S = (id: string, name: string, icon: number, levels: [number, number, number], text: (n: number) => string, might: number, magic: number): SkillDef => ({ id, name, icon, levels, text, weight: [might, magic] });
export const SKILLS: SkillDef[] = [
  S('logistics', 'Логистика', 1, [10, 20, 30], (n) => `+${n} % запаса хода`, 8, 5),
  S('pathfinding', 'Следопыт', 2, [25, 50, 75], (n) => `штраф местности меньше на ${n} %`, 6, 4),
  S('scouting', 'Разведка', 3, [1, 2, 3], (n) => `обзор +${n}`, 4, 4),
  S('wisdom', 'Мудрость', 4, [1, 2, 3], (n) => (n === 1 ? 'можно учить заклинания 3-го круга' : `заклинания 3-го круга, мана +${(n - 1) * 5}`), 3, 10),
  S('fire', 'Магия Огня', 5, [1, 2, 3], (n) => `+${n} к силе заклинаний Огня`, 2, 6),
  S('water', 'Магия Воды', 6, [1, 2, 3], (n) => `+${n} к силе заклинаний Воды`, 2, 6),
  S('earth', 'Магия Земли', 7, [1, 2, 3], (n) => `+${n} к силе заклинаний Земли`, 2, 6),
  S('air', 'Магия Воздуха', 8, [1, 2, 3], (n) => `+${n} к силе заклинаний Воздуха`, 2, 6),
  S('leadership', 'Лидерство', 9, [1, 2, 3], (n) => `+${n} к морали`, 8, 3),
  S('luck', 'Удача', 10, [1, 2, 3], (n) => `+${n} к удаче`, 5, 4),
  S('offense', 'Нападение', 11, [10, 20, 30], (n) => `+${n} % к урону в рукопашной`, 10, 2),
  S('armorer', 'Броня', 12, [5, 10, 15], (n) => `−${n} % получаемого урона`, 10, 2),
  S('archery', 'Стрельба', 13, [10, 25, 50], (n) => `+${n} % к урону стрелков`, 8, 2),
  S('tactics', 'Тактика', 14, [1, 2, 3], (n) => `в первом раунде отряды быстрее на ${n}`, 6, 2),
  S('firstaid', 'Лекарь', 15, [10, 20, 30], (n) => `после боя встают ${n} % павших`, 5, 4),
  S('estates', 'Хозяйство', 16, [125, 250, 500], (n) => `+${n} семок в день`, 4, 4),
  S('diplomacy', 'Дипломатия', 17, [10, 20, 30], (n) => `наём у нейтралов дешевле на ${n} %`, 3, 4),
  S('scholar', 'Грамотность', 18, [1, 2, 3], (n) => `при встрече герои делятся заклинаниями до ${n}-го круга`, 1, 6),
  S('learning', 'Обучаемость', 19, [5, 10, 15], (n) => `+${n} % опыта`, 5, 5),
  S('resistance', 'Сопротивление', 20, [10, 20, 30], (n) => `−${n} % урона от заклинаний`, 5, 3),
  S('mysticism', 'Мистика', 21, [2, 3, 4], (n) => `+${n} маны в день`, 2, 7),
  S('sorcery', 'Чародейство', 22, [10, 25, 50], (n) => `+${n} % к урону заклинаний`, 2, 8),
  S('navigation', 'Судовождение', 23, [50, 100, 150], (n) => `+${n} % хода на лодке`, 2, 2),
  S('eagle', 'Орлиный глаз', 24, [40, 50, 60], (n) => `${n} %: выучить заклинание врага из боя`, 1, 5),
];
export const SKILL = Object.fromEntries(SKILLS.map((s) => [s.id, s])) as Record<string, SkillDef>;
export const MAX_SKILLS = 8;

export type ArtSlot = 'head' | 'neck' | 'body' | 'cloak' | 'weapon' | 'shield' | 'ring' | 'boots' | 'misc';
export const ART_SLOTS: { id: string; slot: ArtSlot; name: string }[] = [
  { id: 'head', slot: 'head', name: 'Голова' }, { id: 'neck', slot: 'neck', name: 'Шея' }, { id: 'body', slot: 'body', name: 'Тело' }, { id: 'cloak', slot: 'cloak', name: 'Плащ' },
  { id: 'weapon', slot: 'weapon', name: 'Оружие' }, { id: 'shield', slot: 'shield', name: 'Щит' }, { id: 'ring1', slot: 'ring', name: 'Кольцо' }, { id: 'ring2', slot: 'ring', name: 'Кольцо' },
  { id: 'boots', slot: 'boots', name: 'Сапоги' }, { id: 'misc1', slot: 'misc', name: 'Мелочь' }, { id: 'misc2', slot: 'misc', name: 'Мелочь' },
];

export interface ArtBonus {
  atk?: number;
  def?: number;
  power?: number;
  know?: number;
  morale?: number;
  luck?: number;
  /** Запас хода, %. */
  mp?: number;
  vision?: number;
  semki?: number;
  mana?: number;
}
export interface ArtDef {
  id: string;
  name: string;
  slot: ArtSlot;
  /** 1 — мелочь, 2 — сокровище, 3 — реликвия: куда кладут генератор и сокровищницы. */
  rank: number;
  bonus: ArtBonus;
  /** Осколок кастета: в бою и на карте держится отдельно. */
  shard?: boolean;
}

/** Порядок — как у иконок art-01…art-60 (studio/jobs/geroi/make_jobs.py). */
const ART: [string, ArtSlot, number, ArtBonus][] = [
  ['Железный шлем', 'head', 1, { def: 1 }], ['Степная шапка', 'head', 1, { morale: 1 }], ['Венец из камыша', 'head', 2, { know: 2 }], ['Звёздный обруч', 'head', 3, { power: 3, know: 1 }], ['Медные очки', 'head', 2, { vision: 3, power: 1 }], ['Рогатый шлем', 'head', 3, { atk: 2, def: 2 }],
  ['Янтарный оберег', 'neck', 1, { luck: 1 }], ['Ожерелье из клыков', 'neck', 1, { atk: 1 }], ['Звезда на цепочке', 'neck', 2, { power: 2 }], ['Шестерня на шнурке', 'neck', 2, { def: 2 }], ['Речной жемчуг', 'neck', 3, { know: 3, mana: 10 }],
  ['Стёганая куртка', 'body', 1, { def: 1 }], ['Кольчуга', 'body', 2, { def: 2 }], ['Бронзовая чешуя', 'body', 3, { def: 4 }], ['Звёздная мантия', 'body', 3, { power: 2, know: 2 }], ['Кузнечный фартук', 'body', 2, { def: 2, atk: 1 }], ['Камышовый доспех', 'body', 1, { def: 1, mp: 5 }],
  ['Меховой плащ', 'cloak', 1, { def: 1 }], ['Плащ тумана', 'cloak', 2, { vision: 2, def: 1 }], ['Плащ из перьев', 'cloak', 2, { mp: 15 }], ['Плащ угольков', 'cloak', 2, { atk: 2 }], ['Мантия ночного неба', 'cloak', 3, { power: 2, mana: 20 }],
  ['Рогатина', 'weapon', 1, { atk: 1 }], ['Боевой топор', 'weapon', 2, { atk: 2 }], ['Кузнечный молот', 'weapon', 3, { atk: 3, def: 1 }], ['Костяной нож', 'weapon', 1, { atk: 1, luck: 1 }], ['Хрустальный посох', 'weapon', 3, { power: 4 }], ['Духовая трубка старца', 'weapon', 2, { atk: 1, know: 1 }], ['Пламенный меч', 'weapon', 3, { atk: 5 }], ['Дубовая палица', 'weapon', 1, { atk: 2 }],
  ['Круглый щит', 'shield', 1, { def: 1 }], ['Бронзовый щит', 'shield', 2, { def: 2 }], ['Панцирь черепахи', 'shield', 3, { def: 4 }], ['Хрустальный щит', 'shield', 3, { def: 2, power: 2 }],
  ['Янтарное кольцо', 'ring', 1, { luck: 1 }], ['Железное кольцо', 'ring', 1, { def: 1 }], ['Лунное кольцо', 'ring', 2, { know: 2 }], ['Медная спираль', 'ring', 2, { atk: 1, def: 1 }], ['Кольцо с зелёным камнем', 'ring', 2, { mana: 10 }], ['Рубиновый перстень', 'ring', 3, { atk: 2, power: 2 }],
  ['Кожаные сапоги', 'boots', 1, { mp: 5 }], ['Крылатые сапоги', 'boots', 3, { mp: 25 }], ['Болотоходы', 'boots', 2, { mp: 10 }], ['Железные сапоги', 'boots', 1, { def: 1 }], ['Валенки', 'boots', 2, { mp: 15 }],
  ['Рог перевозчика', 'misc', 2, { morale: 1 }], ['Светящиеся семечки', 'misc', 2, { semki: 500 }], ['Подзорная труба', 'misc', 2, { vision: 4 }], ['Песочные часы', 'misc', 3, { mp: 20 }], ['Компас', 'misc', 1, { mp: 5 }], ['Звёздный фонарь', 'misc', 2, { vision: 2, power: 1 }], ['Старая карта', 'misc', 1, { vision: 1 }],
  ['Золотой подсолнух', 'misc', 3, { semki: 1000 }], ['Карманное зеркальце', 'misc', 1, { luck: 1 }], ['Связка ключей', 'misc', 1, { know: 1 }], ['Глиняная фляга', 'misc', 1, { mana: 10 }], ['Деревянный идол', 'misc', 2, { morale: 1, luck: 1 }], ['Перо и чернильница', 'misc', 2, { know: 2 }],
  ['Осколок кастета', 'misc', 3, { atk: 2, def: 2, power: 2, know: 2 }], ['Собранный кастет', 'misc', 3, { atk: 6, def: 6, power: 6, know: 6 }],
];
export const ARTIFACTS: Record<string, ArtDef> = {};
ART.forEach(([name, slot, rank, bonus], i) => {
  const id = `art-${String(i + 1).padStart(2, '0')}`;
  ARTIFACTS[id] = { id, name, slot, rank, bonus, shard: i >= 58 };
});
export const SHARD = 'art-59';
export const artList = (rank: number): string[] => Object.values(ARTIFACTS).filter((a) => a.rank === rank && !a.shard).map((a) => a.id);

export interface AdvHero {
  id: number;
  pick: HeroPick;
  owner: number;
  cell: number;
  level: number;
  xp: number;
  atk: number;
  def: number;
  power: number;
  know: number;
  mana: number;
  mp: number;
  army: Army;
  spells: string[];
  skills: { id: string; lv: number }[];
  /** Слот → артефакт. */
  arts: Record<string, string>;
  bag: string[];
  /** Куда уже ходил: камни учения, курганы. */
  visited: number[];
  /** Фонтан удачи: на следующий бой. */
  luckNext: number;
  /** Конюшни: прибавка до конца недели. */
  stabled: boolean;
  boat: boolean;
  /** Несведённые повышения: номер круга и варианты навыков. */
  ups: { stat: 'atk' | 'def' | 'power' | 'know'; options: string[] }[];
  /** Колодец: день, когда пил. */
  wellDay: number;
  /** Куда шёл вчера: путь держим в клиенте, здесь — направление для показа. */
  dir: number;
}

export const skillLevel = (h: AdvHero, id: string): number => h.skills.find((s) => s.id === id)?.lv ?? 0;
export const skillValue = (h: AdvHero, id: string): number => {
  const lv = skillLevel(h, id);
  return lv ? SKILL[id].levels[lv - 1] : 0;
};

/** Опыт на уровень: таблица жанра, дальше геометрически. */
export function xpForLevel(level: number): number {
  const base = [0, 0, 1000, 2000, 3200, 4600, 6200, 8000, 10000, 12200, 14700, 17500, 20600, 24320];
  if (level < base.length) return base[level];
  let need = base[base.length - 1];
  let gain = 3720;
  for (let l = base.length; l <= level; l++) {
    gain = Math.trunc((gain * 12) / 10);
    need += gain;
  }
  return need;
}

export const isMight = (h: AdvHero): boolean => {
  const c = classOf(h.pick.cls);
  return c.atk + c.def >= c.power + c.know;
};

function bonusSum(h: AdvHero, k: keyof ArtBonus): number {
  let sum = 0;
  for (const id of Object.values(h.arts)) sum += ARTIFACTS[id]?.bonus[k] ?? 0;
  return sum;
}

export const heroAtk = (h: AdvHero): number => h.atk + bonusSum(h, 'atk');
export const heroDef = (h: AdvHero): number => h.def + bonusSum(h, 'def');
export const heroPower = (h: AdvHero): number => h.power + bonusSum(h, 'power');
export const heroKnow = (h: AdvHero): number => h.know + bonusSum(h, 'know');
export const heroMaxMana = (h: AdvHero): number => heroKnow(h) * 10 + bonusSum(h, 'mana') + (skillLevel(h, 'wisdom') > 1 ? (skillLevel(h, 'wisdom') - 1) * 5 : 0);
/** Мораль и удача — те же начальные, что в «Арене», плюс навыки и вещи. */
export function heroMorale(h: AdvHero): number {
  const c = classOf(h.pick.cls);
  return (c.atk >= 5 ? 2 : 1) + skillValue(h, 'leadership') + bonusSum(h, 'morale');
}
export function heroLuck(h: AdvHero): number {
  const c = classOf(h.pick.cls);
  return (c.power >= 5 ? 2 : 1) + skillValue(h, 'luck') + bonusSum(h, 'luck') + h.luckNext;
}
export const heroVision = (h: AdvHero): number => 5 + skillValue(h, 'scouting') + bonusSum(h, 'vision');
export const heroSemki = (h: AdvHero): number => skillValue(h, 'estates') + bonusSum(h, 'semki');

/** Запас хода зависит от самого медленного отряда (DESIGN.md §3). */
export function heroMaxMp(h: AdvHero): number {
  if (h.boat) return Math.trunc((1500 * (100 + skillValue(h, 'navigation'))) / 100);
  const slow = h.army.reduce((m, s) => (s ? Math.min(m, CREATURES[s.cre].speed) : m), 99);
  const speed = slow === 99 ? 4 : slow;
  const base = 1300 + Math.max(0, Math.min(6, speed - 3)) * 100;
  return Math.trunc((base * (100 + skillValue(h, 'logistics') + bonusSum(h, 'mp'))) / 100) + (h.stabled ? 400 : 0);
}

export const armyEmpty = (a: Army): boolean => a.every((s) => !s);
export const armySize = (a: Army): number => a.reduce((n, s) => n + (s ? 1 : 0), 0);
/** Сила армии по модели: для оценки охраны и подсказок. */
export const armyPower = (a: Army): number => a.reduce((sum, s) => (s ? sum + CREATURES[s.cre].power * s.count : sum), 0);

/** Куда положить отряд: тот же вид или пустой слот; −1 — некуда. */
export function slotFor(a: Army, cre: string): number {
  const same = a.findIndex((s) => s?.cre === cre);
  return same >= 0 ? same : a.indexOf(null);
}

export function addToArmy(a: Army, cre: string, count: number): boolean {
  const i = slotFor(a, cre);
  if (i < 0) return false;
  const s = a[i];
  if (s) s.count += count;
  else a[i] = { cre, count };
  return true;
}

export const schoolSkill = (s: School): string => s;
