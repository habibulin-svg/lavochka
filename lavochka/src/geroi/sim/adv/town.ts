/* Город: дерево построек, прирост, рынок, механики замка 4 фракций (DESIGN.md §5). Цены и зависимости — данные. Картинка постройки — bld-<фракция>-<art>. */
import { CREATURES, type CreatureDef, type Faction, factionCreatures, hasAb } from '../creatures';
import { FACTION_RES, RES_VALUE, type Purse, type ResId } from './data';
import type { Army } from './hero';

export type TownFaction = Exclude<Faction, 'neutral'>;

export interface BuildingDef {
  id: string;
  name: string;
  /** Имя картинки. */
  art: string;
  cost: Purse;
  req: string[];
  text: string;
  /** Только у этой фракции. */
  only?: TownFaction;
  /** Другой слой на панораме не нужен: улучшение поверх базовой постройки. */
  over?: string;
}

const NAME_DWELL: Record<TownFaction, string[]> = {
  zatulye: ['Изба ополчения', 'Стрельбище', 'Двор ватаги', 'Ладейный сарай', 'Изба знахарок', 'Конюшни степняков', 'Загон тура'],
  zatonye: ['Камышовые шалаши', 'Лягушачий пруд', 'Туманная лощина', 'Круг ив', 'Омут водяниц', 'Логово тролля', 'Логово змея'],
  kuznya: ['Мастерская', 'Медный улей', 'Клепальный ряд', 'Паровая псарня', 'Литейная', 'Сборочный ангар', 'Стапель колосса'],
  akademiya: ['Общежитие', 'Совиная башня', 'Хрустальный грот', 'Оленья поляна', 'Священная роща', 'Драконий насест', 'Кратер звезды'],
  plotina: ['Караулка на гребне', 'Гарпунная', 'Гнёзда на утёсе', 'Морской грот', 'Башня ведьм', 'Бычий загон', 'Затопленный бассейн'],
  ostrog: ['Казарма', 'Лыжная заимка', 'Волчий двор', 'Медвежья яма', 'Шаманский чум', 'Мамонтовый хлев', 'Ледяная пещера'],
  bazar: ['Воровской угол', 'Перечная лавка', 'Ковровая мастерская', 'Зеркальный зал', 'Караванный двор', 'Башня лампы', 'Песчаная яма'],
  kurgany: ['Призрачная кошара', 'Круг идолов', 'Конский круг', 'Курган витязей', 'Изба вещуньи', 'Орлиная скала', 'Царский курган'],
};

const SEMKI = [500, 1000, 1500, 3000, 5000, 10000, 20000];
const BASIC = [5, 5, 10, 10, 10, 15, 20];
const RARE = [0, 2, 3, 5, 8, 10, 15];
const REQ: string[][] = [['fort1'], ['dwell1'], ['dwell1'], ['dwell2', 'smithy'], ['dwell3', 'guild1'], ['dwell4', 'hall2'], ['dwell5', 'dwell6', 'fort2']];

/** Прирост фракции на карте, % по ступеням. В «Арене» фракции ровные (там бюджет в семках), а на карте — прирост штуками,
 * и одни и те же существа в мелких боях с нейтралами и осадах дают разное: Затонье брало 43 %, Академия 59 % (BALANCE.md, 2026-11-06). */
const FACTION_GROWTH: Partial<Record<TownFaction, number[]>> = {
  zatonye: [125, 125, 125, 125, 125, 125, 125],
  akademiya: [70, 85, 85, 85, 85, 85, 85],
  kuznya: [105, 105, 105, 105, 105, 105, 105],
};

/** Прирост ступени без крепости: столько жилище даёт в неделю. */
export function baseGrowth(f: TownFaction, c: CreatureDef): number {
  const k = FACTION_GROWTH[f]?.[c.tier - 1] ?? 100;
  return Math.max(1, Math.round((c.weekly * k) / 100));
}

/** Дерево построек фракции: общая часть + жилища + две свои постройки. */
function tree(f: TownFaction): BuildingDef[] {
  const [r1, r2] = FACTION_RES[f];
  // Дерево и камень — обычные ресурсы (шахта даёт 2 в день, цена вдвое ниже): у Затулья и Кузни их в «редкой» цене вдвое больше,
  // иначе их жилища обходились вдвое дешевле, чем у Затонья и Академии (2026-11-06)
  const k1 = r1 === 'wood' || r1 === 'stone' ? 2 : 1;
  const rare = (n: number): Purse => (r1 === r2 ? { [r1]: n * 2 } : { [r1]: n * k1, [r2]: n });
  const add = (a: Purse, b: Purse): Purse => {
    const out: Purse = { ...a };
    for (const [k, v] of Object.entries(b) as [ResId, number][]) out[k] = (out[k] ?? 0) + v;
    return out;
  };
  const list: BuildingDef[] = [
    { id: 'hall1', name: 'Староста', art: 'hall', cost: {}, req: [], text: '+500 семок в день' },
    { id: 'hall2', name: 'Вече', art: 'hall', over: 'hall1', cost: { semki: 2500 }, req: ['hall1', 'tavern'], text: '+1000 семок в день' },
    { id: 'hall3', name: 'Большое вече', art: 'hall', over: 'hall2', cost: { semki: 5000, wood: 5, stone: 5 }, req: ['hall2', 'market', 'guild1', 'dwell3'], text: '+2000 семок в день' },
    { id: 'hall4', name: 'Палаты края', art: 'hall', over: 'hall3', cost: add({ semki: 10000 }, rare(5)), req: ['hall3', 'fort3'], text: '+4000 семок в день' },
    { id: 'fort1', name: 'Частокол', art: 'fort', cost: { semki: 5000, wood: 5, stone: 5 }, req: [], text: 'Стены в осаде и найм первых отрядов' },
    { id: 'fort2', name: 'Крепость', art: 'fort', over: 'fort1', cost: { semki: 2500, stone: 5 }, req: ['fort1'], text: 'Прирост +50 %, башня в осаде' },
    { id: 'fort3', name: 'Твердыня', art: 'fort', over: 'fort2', cost: { semki: 5000, wood: 10, stone: 10 }, req: ['fort2', 'dwell4'], text: 'Прирост ×2, две башни в осаде' },
    { id: 'tavern', name: 'Трактир', art: 'tavern', cost: { semki: 500, wood: 5 }, req: [], text: 'Нанять героя, +1 к морали защитников' },
    { id: 'market', name: 'Рынок', art: 'market', cost: { semki: 500, wood: 5 }, req: [], text: 'Обмен ресурсов' },
    { id: 'guild1', name: 'Гильдия магов', art: 'guild', cost: { semki: 2000, wood: 5, stone: 5 }, req: [], text: 'Заклинания 1-го круга' },
    { id: 'guild2', name: 'Гильдия, 2-й круг', art: 'guild', over: 'guild1', cost: add({ semki: 1000 }, rare(4)), req: ['guild1'], text: 'Заклинания 2-го круга' },
    { id: 'guild3', name: 'Гильдия, 3-й круг', art: 'guild', over: 'guild2', cost: add({ semki: 1000 }, rare(6)), req: ['guild2'], text: 'Заклинания 3-го круга' },
    { id: 'smithy', name: 'Кузница', art: 'smithy', cost: { semki: 1000, wood: 5 }, req: ['fort1'], text: '+2 к защите гарнизона в осаде' },
    { id: 'storehouse', name: 'Склад', art: 'storehouse', cost: { semki: 5000, stone: 5 }, req: ['market'], text: `Каждый день: ${r2 === 'stone' ? 'камень' : '+1 редкого ресурса'}` },
    { id: 'shipyard', name: 'Верфь', art: 'shipyard', cost: { semki: 2000, wood: 20 }, req: [], text: 'Лодки, если город у воды' },
  ];
  factionCreatures(f).filter((c) => !c.up).sort((a, b) => a.tier - b.tier).forEach((c) => {
    const t = c.tier - 1;
    list.push({
      id: `dwell${c.tier}`, name: NAME_DWELL[f][t], art: `dwell${c.tier}`, cost: add({ semki: SEMKI[t], wood: BASIC[t] >> 1, stone: BASIC[t] >> 1 }, rare(RARE[t])),
      req: REQ[t], text: `Наём: ${c.name}, ${baseGrowth(f, c)} в неделю`,
    });
    const up = factionCreatures(f).find((x) => x.tier === c.tier && x.up)!;
    list.push({
      id: `up${c.tier}`, name: `${NAME_DWELL[f][t]} ★`, art: `dwell${c.tier}`, over: `dwell${c.tier}`, cost: add({ semki: Math.trunc((SEMKI[t] * 3) / 2), wood: BASIC[t] >> 1, stone: BASIC[t] >> 1 }, rare(RARE[t])),
      req: t > 2 ? [`dwell${c.tier}`, 'smithy'] : [`dwell${c.tier}`], text: `Улучшение: ${up.name}`,
    });
  });
  switch (f) {
    case 'zatulye':
      list.push({ id: 'skhod', name: 'Сход', art: 'skhod', cost: { semki: 1500, wood: 5 }, req: ['hall2'], text: 'Раз в неделю сход выбирает указ из трёх', only: f });
      break;
    case 'zatonye':
      list.push(
        { id: 'fogwell', name: 'Туманный колодец', art: 'fogwell', cost: { semki: 2000, resin: 3 }, req: ['fort1'], text: 'Чужие герои рядом видят на 2 клетки меньше, свои отряды рядом не видны', only: f },
        { id: 'gat', name: 'Гать', art: 'gat', cost: { semki: 1500, wood: 10 }, req: ['hall2'], text: 'Свои герои идут по болоту, как по дороге', only: f },
      );
      break;
    case 'kuznya':
      list.push(
        { id: 'furnace', name: 'Домна', art: 'furnace', cost: { semki: 2500, stone: 10, stariron: 3 }, req: ['dwell2'], text: 'Плавка вдвое мощнее', only: f },
        { id: 'scrapyard', name: 'Ремонтный двор', art: 'scrapyard', cost: { semki: 2000, stone: 5 }, req: ['dwell2'], text: 'Разбитые механизмы чинятся здесь за полцены', only: f },
      );
      break;
    case 'akademiya':
      list.push(
        { id: 'lab', name: 'Лаборатория', art: 'lab', cost: { semki: 2000, amber: 3 }, req: ['guild1'], text: 'Опыты: ветка заклинаний школы за янтарь и время', only: f },
        { id: 'observatory', name: 'Обсерватория', art: 'observatory', cost: { semki: 3000, amber: 5 }, req: ['guild1'], text: 'Видно округу вокруг всех своих объектов', only: f },
      );
      break;
    case 'plotina':
      list.push(
        { id: 'dam', name: 'Плотина', art: 'dam', cost: { semki: 2000, stone: 10 }, req: ['fort1'], text: 'Копит напор каждый день (до 6); сброс — семки, ход героям в городе или вторая стройка за день', only: f },
        { id: 'turbine', name: 'Турбина', art: 'turbine', cost: { semki: 2500, salt: 3 }, req: ['dam'], text: 'Напор копится вдвое быстрее', only: f },
      );
      break;
    case 'ostrog':
      list.push(
        { id: 'drill', name: 'Плац', art: 'drill', cost: { semki: 1500, wood: 5 }, req: ['fort1'], text: 'Отряды в гарнизоне каждую неделю получают опыт', only: f },
        { id: 'banya', name: 'Баня', art: 'banya', cost: { semki: 2000, wood: 10 }, req: ['drill'], text: 'Герой, начавший день в городе, получает +300 к ходу', only: f },
      );
      break;
    case 'bazar':
      list.push(
        { id: 'caravanserai', name: 'Караван-сарай', art: 'caravanserai', cost: { semki: 2000, wood: 5 }, req: ['market'], text: 'Наём чужих существ, чьи жилища вы видели, с наценкой', only: f },
        { id: 'bank', name: 'Меняльная контора', art: 'bank', cost: { semki: 1500, stone: 5 }, req: ['market'], text: 'Кредит: 5000 семок сейчас, по 1500 в неделю 4 недели', only: f },
      );
      break;
    case 'kurgany':
      list.push(
        { id: 'memory', name: 'Круг памяти', art: 'memory', cost: { semki: 1500, amber: 2 }, req: ['fort1'], text: 'Память павших: призыв духов-предков на 7 дней', only: f },
        { id: 'bindstone', name: 'Камень привязки', art: 'bindstone', cost: { semki: 3000, amber: 5 }, req: ['memory'], text: 'Привязать призванных духов навсегда за янтарь', only: f },
      );
      break;
  }
  return list;
}

export const TOWN_FACTIONS: TownFaction[] = ['zatulye', 'zatonye', 'kuznya', 'akademiya', 'plotina', 'ostrog', 'bazar', 'kurgany'];
export const BUILDINGS = Object.fromEntries(TOWN_FACTIONS.map((f) => [f, Object.fromEntries(tree(f).map((b) => [b.id, b]))])) as Record<TownFaction, Record<string, BuildingDef>>;

export interface Town {
  id: number;
  name: string;
  faction: TownFaction;
  owner: number;
  /** Вход: ворота. */
  cell: number;
  built: string[];
  /** Построено ли сегодня: один раз в день. */
  builtToday: boolean;
  /** Сколько нанять по ступеням (ступень − 1). */
  avail: number[];
  garrison: Army;
  /** Метка сценария кампании. */
  tag?: string;
  /** Заклинания гильдии по кругам. */
  guild: string[][];
  /** Сход: три указа недели; пусто — уже выбран. */
  decrees: string[];
  /** Сход: прибавка прироста следующей недели, ступень − 1 → число. */
  bonus: number[];
  /** Сход: скидка на следующую постройку, %. */
  discount: number;
  /** Плавка: сколько семок силы можно отлить сейчас. */
  forge: number;
  /** Опыты: что изучается. */
  research: { school: string; left: number } | null;
  /** Сколько заклинаний ветки уже изучено. */
  studied: Record<string, number>;
  /** Герои в трактире. */
  tavern: { cls: string; n: number }[];
}

export const has = (t: Town, b: string): boolean => t.built.includes(b);
export const buildingDef = (t: Town, b: string): BuildingDef | undefined => BUILDINGS[t.faction][b];
export const hallIncome = (t: Town): number => (has(t, 'hall4') ? 4000 : has(t, 'hall3') ? 2000 : has(t, 'hall2') ? 1000 : 500);
export const fortLevel = (t: Town): number => (has(t, 'fort3') ? 3 : has(t, 'fort2') ? 2 : has(t, 'fort1') ? 1 : 0);
export const guildLevel = (t: Town): number => (has(t, 'guild3') ? 3 : has(t, 'guild2') ? 2 : has(t, 'guild1') ? 1 : 0);

/** Цена постройки с учётом скидки схода. */
export function buildCost(t: Town, b: string): Purse {
  const d = buildingDef(t, b);
  if (!d) return {};
  if (!t.discount) return d.cost;
  const out: Purse = {};
  for (const [k, v] of Object.entries(d.cost) as [ResId, number][]) out[k] = Math.trunc((v * (100 - t.discount)) / 100);
  return out;
}

export function buildError(t: Town, b: string): string | null {
  const d = buildingDef(t, b);
  if (!d) return 'Нет такой постройки';
  if (has(t, b)) return 'Уже построено';
  if (t.builtToday) return 'Сегодня уже строили';
  const miss = d.req.filter((x) => !has(t, x));
  if (miss.length) return `Сначала: ${miss.map((x) => buildingDef(t, x)?.name ?? x).join(', ')}`;
  return null;
}

/** Плавка Кузни: механизмы не растут понедельно, их отливают (DESIGN.md §5.3). */
export const isCast = (c: CreatureDef): boolean => c.faction === 'kuznya' && hasAb(c, 'machine');
export const forgePerDay = (t: Town): number => (has(t, 'furnace') ? 3000 : 1500);
/** Сколько плавка держит в запасе: три дня. */
export const forgeCap = (t: Town): number => forgePerDay(t) * 3;

/** Цена существа: у отливаемых часть — камень и звёздное железо. */
export function creaturePrice(c: CreatureDef, count: number): Purse {
  if (isCast(c)) {
    return { semki: Math.trunc((c.cost * count * 8) / 10), stone: Math.max(1, Math.trunc((c.cost * count) / 800)), stariron: Math.trunc((c.cost * count) / 1600) };
  }
  return { semki: c.cost * count };
}

/** Какую форму можно нанять на этой ступени: улучшенную — если улучшено. */
export function townCreature(t: Town, tier: number, up: boolean): CreatureDef {
  return factionCreatures(t.faction).find((c) => c.tier === tier && c.up === up)!;
}
export const canUpgrade = (t: Town, cre: string): CreatureDef | null => {
  const c = CREATURES[cre];
  if (!c || c.faction !== t.faction || c.up || !has(t, `up${c.tier}`)) return null;
  return townCreature(t, c.tier, true);
};

/** Недельный прирост ступени: крепость даёт +50 %, твердыня — вдвое. */
export function weeklyGrowth(t: Town, tier: number): number {
  const c = factionCreatures(t.faction).find((x) => x.tier === tier)!;
  const k = FACTION_GROWTH[t.faction]?.[tier - 1] ?? 100;
  const f = fortLevel(t);
  const g = c.weekly + (f === 3 ? c.weekly : f === 2 ? c.weekly >> 1 : 0);
  return Math.max(1, Math.round((g * k) / 100)) + t.bonus[tier - 1];
}

/** Рынок: за amount ресурса give — сколько get. Комиссия ×2 (DESIGN.md §5.7 — у Базара позже лучше). */
export function marketRate(give: ResId, get: ResId, amount: number): number {
  return Math.trunc((amount * RES_VALUE[give]) / (RES_VALUE[get] * 2));
}

/** Сход: указы (DESIGN.md §5.1). */
export const DECREES: Record<string, { name: string; text: string }> = {
  growth: { name: 'Подмога', text: 'Младшие ступени: прирост следующей недели вдвое' },
  semki: { name: 'Сбор', text: '+2000 семок сейчас' },
  xp: { name: 'Наука', text: '+500 опыта герою в замке' },
  discount: { name: 'Толока', text: 'Следующая постройка на 25 % дешевле' },
  militia: { name: 'Ополчение', text: 'Бесплатный отряд первой ступени в гарнизон' },
};

/** Опыты Академии: ветка школы из трёх заклинаний (DESIGN.md §5.4). */
export const BRANCHES: Record<string, string[]> = {
  fire: ['fire-arrow', 'bloodlust', 'fireball'],
  water: ['ice-bolt', 'heal-light', 'blessing'],
  earth: ['stone-skin', 'slow', 'meteors'],
  air: ['lightning', 'haste', 'town-portal'],
};
export const RESEARCH_DAYS = 3;
export const RESEARCH_AMBER = 3;
