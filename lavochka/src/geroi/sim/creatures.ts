/* Существа: одна таблица-описание и одна функция, строящая из неё характеристики и цену (docs/geroi/DESIGN.md §6.1–6.2).
 * Руками задаётся только роль: ступень, форма «здоровье к урону», скорость, способности. Здоровье, урон и цена выводятся из модели силы:
 * сила = √(здоровье × урон) × поправки; цена ∝ силе. Правишь коэффициент — пересчитывается всё. */
export type Faction = 'zatulye' | 'zatonye' | 'kuznya' | 'akademiya' | 'neutral';
export type Ability =
  | 'fly' | 'big' | 'machine'
  | 'noRetal'    // по нему не отвечают
  | 'manyRetal'  // отвечает на каждый удар
  | 'strike2'    // бьёт дважды
  | 'antiBig'    // +50 % по большим
  | 'charge'     // +5 % урона за пройденный гекс
  | 'sweep'      // удар задевает всех врагов рядом с целью
  | 'aoe'        // выстрел задевает врагов рядом с целью
  | 'noMeleePen' // стрелок без штрафа в ближнем бою
  | 'noRangePen' // без штрафа за дальность
  | 'poison'     // отравляет ударом
  | 'blind'      // 25 % — цель пропускает ход
  | 'root'       // цель не может сойти с места
  | 'swallow'    // 25 % — небольшой отряд выбывает на раунд
  | 'mist'       // после удара уходит в туман: до своего хода его нельзя атаковать
  | 'pass'       // идёт сквозь препятствия и топь
  | 'heal'       // лечит своих вместо хода
  | 'repair'     // чинит механизмы вместо хода
  | 'curseCast'  // замедляет врага вместо хода
  | 'spellRes';  // половина урона от заклинаний

/** Во что обходится способность в силе (множитель к итоговой силе). */
const ABILITY_COST: Record<Ability, number> = {
  fly: 1.12, big: 1.0, machine: 1.03, noRetal: 1.15, manyRetal: 1.1, strike2: 1.0, antiBig: 1.05, charge: 1.18, sweep: 1.15, aoe: 1.35,
  noMeleePen: 1.08, noRangePen: 1.06, poison: 1.15, blind: 1.12, root: 1.1, swallow: 1.14, mist: 1.12, pass: 1.03,
  heal: 1.3, repair: 1.1, curseCast: 1.2, spellRes: 1.03,
};
const RANGED_COST = 1.5;
const WALL_COST = 1.12;
/** Базовая сила ступени = √(здоровье × урон) у средней формы; улучшение — ×1,3. */
const TIER_POWER = [4.8, 8, 13.5, 23, 40, 72, 140];
const UP_POWER = 1.3;
/** Атака и защита, «положенные» ступени: их отклонение входит в силу. */
const TIER_STAT = [2, 4, 6, 8, 11, 14, 18];
const TIER_SPEED = [4, 5, 5, 5, 6, 7, 7];
const WEEKLY = [14, 9, 7, 4, 3, 2, 1];
/** Семок за единицу силы; старшие ступени с надбавкой: та же сила в одном отряде живучее. */
const COST_K = 13;
const COST_TIER = 0.035;

export interface CreatureSfx {
  move: string;
  hit: string;
  death: string;
  shot?: string;
  voice?: string;
}

export interface CreatureDef {
  id: string;
  name: string;
  faction: Faction;
  tier: number;
  up: boolean;
  hp: number;
  dmin: number;
  dmax: number;
  atk: number;
  def: number;
  speed: number;
  /** Выстрелов (0 — не стрелок). */
  shots: number;
  abilities: Ability[];
  /** Сила одного существа по модели. */
  power: number;
  cost: number;
  weekly: number;
  sfx: CreatureSfx;
}

interface Spec {
  id: string;
  name: string;
  tier: number;
  up?: boolean;
  /** Здоровье к урону: 4 — обычно, больше — крепкий, меньше — хрупкий и больно бьёт. */
  shape?: number;
  /** Сдвиг атаки и защиты от положенных ступени. */
  a?: number;
  d?: number;
  /** Сдвиг скорости. */
  v?: number;
  shots?: number;
  ab?: Ability[];
  /** Звуки: шаг, удар, гибель, [выстрел], [голос]. */
  sfx: [string, string, string, (string | null)?, string?];
}

/** Корень без Math.sqrt: только + и ÷, одинаково во всех браузерах (sim/, DESIGN.md §10). */
export function rootOf(x: number): number {
  let r = x > 1 ? x / 2 : 1;
  for (let i = 0; i < 24; i++) r = (r + x / r) / 2;
  return r;
}

const SPECS: Record<Faction, Spec[]> = {
  zatulye: [
    { id: 'zatulye-militia', name: 'Ополченцы', tier: 1, d: 1, sfx: ['move-foot', 'hit-spear', 'death-human', null, 'voice-war'] },
    { id: 'zatulye-spearman', name: 'Рогатинщики', tier: 1, up: true, d: 2, ab: ['antiBig'], sfx: ['move-foot', 'hit-spear', 'death-human', null, 'voice-war'] },
    { id: 'zatulye-slinger', name: 'Пращники', tier: 2, shape: 3.5, shots: 16, sfx: ['move-foot', 'hit-blunt', 'death-human', 'shot-sling', 'voice-war'] },
    { id: 'zatulye-strelets', name: 'Стрельцы', tier: 2, up: true, shape: 3.5, shots: 20, ab: ['noMeleePen'], sfx: ['move-foot', 'hit-blunt', 'death-human', 'shot-crossbow', 'voice-war'] },
    { id: 'zatulye-vataga', name: 'Ватага', tier: 3, shape: 4.5, ab: ['antiBig'], sfx: ['move-foot', 'hit-spear', 'death-human', null, 'voice-war'] },
    { id: 'zatulye-brodnik', name: 'Бродники', tier: 3, up: true, shape: 4.5, a: 1, ab: ['antiBig', 'manyRetal'], sfx: ['move-foot', 'hit-spear', 'death-human', null, 'voice-war'] },
    { id: 'zatulye-boatman', name: 'Ладейщики', tier: 4, a: 1, ab: ['pass'], sfx: ['move-foot', 'hit-blade', 'death-human', null, 'voice-war'] },
    { id: 'zatulye-ushkuynik', name: 'Ушкуйники', tier: 4, up: true, shape: 5, a: 2, ab: ['pass', 'strike2'], sfx: ['move-foot', 'hit-blade', 'death-human', null, 'voice-war'] },
    { id: 'zatulye-herbalist', name: 'Знахарки', tier: 5, shape: 5, a: -2, ab: ['heal'], sfx: ['move-foot', 'hit-magic', 'death-human'] },
    { id: 'zatulye-wisewoman', name: 'Ведуньи', tier: 5, up: true, shape: 5, a: -2, ab: ['heal', 'noRetal'], sfx: ['move-foot', 'hit-magic', 'death-human'] },
    { id: 'zatulye-rider', name: 'Степные всадники', tier: 6, v: 2, ab: ['big', 'charge'], sfx: ['move-hoof', 'hit-spear', 'death-creature', null, 'voice-horse'] },
    { id: 'zatulye-vityaz', name: 'Витязи', tier: 6, up: true, v: 2, a: 1, d: 2, ab: ['big', 'charge'], sfx: ['move-hoof', 'hit-spear', 'death-creature', null, 'voice-horse'] },
    { id: 'zatulye-tur', name: 'Тур-исполин', tier: 7, shape: 4.5, ab: ['big', 'charge'], sfx: ['move-heavy', 'hit-blunt', 'death-creature', null, 'voice-bull'] },
    { id: 'zatulye-thundertur', name: 'Громовой тур', tier: 7, up: true, shape: 4.5, a: 2, ab: ['big', 'charge', 'sweep'], sfx: ['move-heavy', 'hit-blunt', 'death-creature', null, 'voice-bull'] },
  ],
  zatonye: [
    { id: 'zatonye-reedling', name: 'Камышники', tier: 1, shape: 3, sfx: ['move-foot', 'hit-spear', 'death-creature'] },
    { id: 'zatonye-sedgeling', name: 'Осочники', tier: 1, up: true, shape: 3.5, d: 1, v: 1, sfx: ['move-foot', 'hit-blade', 'death-creature'] },
    { id: 'zatonye-frog', name: 'Лягушатники-плевуны', tier: 2, shape: 3.5, shots: 12, ab: ['poison'], sfx: ['move-hop', 'hit-claw', 'death-creature', 'shot-blowpipe', 'voice-frog'] },
    { id: 'zatonye-toad', name: 'Жабьи стрелки', tier: 2, up: true, shape: 3.5, shots: 16, ab: ['poison', 'noRangePen'], sfx: ['move-hop', 'hit-claw', 'death-creature', 'shot-blowpipe', 'voice-frog'] },
    { id: 'zatonye-wisp', name: 'Болотные огни', tier: 3, shape: 2.6, v: 2, d: -1, ab: ['fly', 'blind'], sfx: ['move-float', 'hit-magic', 'death-spirit'] },
    { id: 'zatonye-wanderwisp', name: 'Блуждающие огни', tier: 3, up: true, shape: 2.6, v: 3, d: -1, ab: ['fly', 'blind', 'noRetal'], sfx: ['move-float', 'hit-magic', 'death-spirit'] },
    { id: 'zatonye-willow', name: 'Ивовые плакальщицы', tier: 4, shape: 7, v: -2, d: 3, ab: ['root'], sfx: ['move-heavy', 'hit-wood', 'death-creature', null, 'voice-tree'] },
    { id: 'zatonye-oldwillow', name: 'Старые ивы', tier: 4, up: true, shape: 7, v: -2, d: 4, ab: ['root', 'manyRetal'], sfx: ['move-heavy', 'hit-wood', 'death-creature', null, 'voice-tree'] },
    { id: 'zatonye-vodyanitsa', name: 'Водяницы', tier: 5, shape: 3.5, shots: 10, a: -1, ab: ['curseCast'], sfx: ['move-float', 'hit-magic', 'death-spirit', 'hit-magic', 'voice-water'] },
    { id: 'zatonye-omutnitsa', name: 'Омутницы', tier: 5, up: true, shape: 3.5, shots: 14, a: -1, ab: ['curseCast', 'noMeleePen'], sfx: ['move-float', 'hit-magic', 'death-spirit', 'hit-magic', 'voice-water'] },
    { id: 'zatonye-catfish', name: 'Сом-исполин', tier: 6, shape: 6, v: -2, ab: ['big', 'swallow'], sfx: ['move-heavy', 'hit-claw', 'death-creature', null, 'voice-fish'] },
    { id: 'zatonye-kingcatfish', name: 'Царь-сом', tier: 6, up: true, shape: 6, v: -2, a: 1, d: 2, ab: ['big', 'swallow', 'manyRetal'], sfx: ['move-heavy', 'hit-claw', 'death-creature', null, 'voice-fish'] },
    { id: 'zatonye-mistserpent', name: 'Туманный змей', tier: 7, shape: 3.5, ab: ['big', 'mist'], sfx: ['move-float', 'hit-claw', 'death-creature', null, 'voice-serpent'] },
    { id: 'zatonye-phantomserpent', name: 'Змей-морока', tier: 7, up: true, shape: 3.5, a: 2, ab: ['big', 'mist', 'pass', 'sweep'], sfx: ['move-float', 'hit-claw', 'death-creature', null, 'voice-serpent'] },
  ],
  kuznya: [
    { id: 'kuznya-apprentice', name: 'Подмастерья', tier: 1, shape: 4.5, v: -1, d: 2, sfx: ['move-foot', 'hit-blunt', 'death-human', null, 'voice-war'] },
    { id: 'kuznya-smith', name: 'Кузнецы', tier: 1, up: true, shape: 4.5, v: -1, d: 3, a: 1, sfx: ['move-foot', 'hit-blunt', 'death-human', null, 'voice-war'] },
    { id: 'kuznya-wasp', name: 'Медные осы', tier: 2, shape: 3, v: 3, ab: ['fly', 'machine'], sfx: ['move-fly', 'hit-metal', 'death-machine', null, 'voice-wasp'] },
    { id: 'kuznya-stingwasp', name: 'Жалящие осы', tier: 2, up: true, shape: 3, v: 4, ab: ['fly', 'machine', 'noRetal'], sfx: ['move-fly', 'hit-metal', 'death-machine', null, 'voice-wasp'] },
    { id: 'kuznya-riveter', name: 'Клепальщики', tier: 3, shape: 4, v: -1, d: 1, shots: 14, sfx: ['move-foot', 'hit-metal', 'death-human', 'shot-crossbow', 'voice-war'] },
    { id: 'kuznya-repeater', name: 'Самострельщики', tier: 3, up: true, shape: 4, v: -1, d: 2, shots: 18, ab: ['strike2'], sfx: ['move-foot', 'hit-metal', 'death-human', 'shot-bolt-steam', 'voice-war'] },
    { id: 'kuznya-steamhound', name: 'Паровые псы', tier: 4, shape: 4, v: 2, ab: ['machine'], sfx: ['move-mech', 'hit-claw', 'death-machine', null, 'voice-hound'] },
    { id: 'kuznya-forgehound', name: 'Гончие горна', tier: 4, up: true, shape: 4, v: 3, a: 1, ab: ['machine', 'charge'], sfx: ['move-mech', 'hit-claw', 'death-machine', null, 'voice-hound'] },
    { id: 'kuznya-founder', name: 'Литейщицы', tier: 5, shape: 3.5, v: -1, shots: 8, ab: ['repair'], sfx: ['move-foot', 'hit-magic', 'death-human', 'hit-magic'] },
    { id: 'kuznya-firemistress', name: 'Мастерицы плавки', tier: 5, up: true, shape: 3.5, v: -1, a: 1, shots: 12, ab: ['repair', 'noMeleePen'], sfx: ['move-foot', 'hit-magic', 'death-human', 'hit-magic'] },
    { id: 'kuznya-walkcannon', name: 'Шагающая пушка', tier: 6, shape: 4.5, v: -3, shots: 8, ab: ['big', 'machine'], sfx: ['move-mech', 'hit-metal', 'death-machine', 'shot-cannon'] },
    { id: 'kuznya-walkmortar', name: 'Мортира-ходок', tier: 6, up: true, shape: 4.5, v: -3, shots: 10, ab: ['big', 'machine', 'aoe'], sfx: ['move-mech', 'hit-metal', 'death-machine', 'shot-mortar'] },
    { id: 'kuznya-colossus', name: 'Медный колосс', tier: 7, shape: 6.5, v: -2, d: 3, ab: ['big', 'machine'], sfx: ['move-heavy', 'hit-metal', 'death-machine', null, 'voice-colossus'] },
    { id: 'kuznya-forgecolossus', name: 'Колосс горна', tier: 7, up: true, shape: 6.5, v: -2, d: 4, a: 2, ab: ['big', 'machine', 'sweep'], sfx: ['move-heavy', 'hit-metal', 'death-machine', null, 'voice-colossus'] },
  ],
  akademiya: [
    { id: 'akademiya-student', name: 'Ученики-фонарщики', tier: 1, shape: 2.5, d: -1, shots: 8, sfx: ['move-foot', 'hit-magic', 'death-human', 'hit-magic'] },
    { id: 'akademiya-adept', name: 'Адепты', tier: 1, up: true, shape: 2.5, d: -1, shots: 12, ab: ['noRangePen'], sfx: ['move-foot', 'hit-magic', 'death-human', 'hit-magic'] },
    { id: 'akademiya-owl', name: 'Совы-письмоносцы', tier: 2, shape: 2.8, v: 3, d: -1, ab: ['fly'], sfx: ['move-fly', 'hit-claw', 'death-creature', null, 'voice-owl'] },
    { id: 'akademiya-seerowl', name: 'Вещие совы', tier: 2, up: true, shape: 2.8, v: 4, d: -1, a: 1, ab: ['fly', 'blind'], sfx: ['move-fly', 'hit-claw', 'death-creature', null, 'voice-owl'] },
    { id: 'akademiya-crystal', name: 'Хрустальные стражи', tier: 3, shape: 6, v: -1, d: 2, ab: ['spellRes'], sfx: ['move-heavy', 'hit-crystal', 'death-machine', null, 'voice-crystal'] },
    { id: 'akademiya-prism', name: 'Призменные стражи', tier: 3, up: true, shape: 6, v: -1, d: 3, ab: ['spellRes', 'manyRetal'], sfx: ['move-heavy', 'hit-crystal', 'death-machine', null, 'voice-crystal'] },
    { id: 'akademiya-stag', name: 'Звёздные олени', tier: 4, shape: 3, v: 1, shots: 12, sfx: ['move-hoof', 'hit-magic', 'death-creature', 'hit-magic', 'voice-horse'] },
    { id: 'akademiya-moonstag', name: 'Лунные олени', tier: 4, up: true, shape: 3, v: 2, shots: 16, ab: ['noMeleePen'], sfx: ['move-hoof', 'hit-magic', 'death-creature', 'hit-magic', 'voice-horse'] },
    { id: 'akademiya-pineguard', name: 'Сосновые хранители', tier: 5, shape: 6, v: -1, d: 2, ab: ['big', 'heal'], sfx: ['move-heavy', 'hit-wood', 'death-creature', null, 'voice-tree'] },
    { id: 'akademiya-borguard', name: 'Бор-хранители', tier: 5, up: true, shape: 6, v: -1, d: 3, ab: ['big', 'heal', 'manyRetal'], sfx: ['move-heavy', 'hit-wood', 'death-creature', null, 'voice-tree'] },
    { id: 'akademiya-skywhale', name: 'Небесный кит', tier: 6, shape: 6, v: -1, ab: ['big', 'fly'], sfx: ['move-float', 'hit-blunt', 'death-creature', null, 'voice-whale'] },
    { id: 'akademiya-starwhale', name: 'Звёздный кит', tier: 6, up: true, shape: 6, a: 1, d: 2, v: -1, ab: ['big', 'fly', 'spellRes'], sfx: ['move-float', 'hit-blunt', 'death-creature', null, 'voice-whale'] },
    { id: 'akademiya-fallenstar', name: 'Упавшая звезда', tier: 7, shape: 3, v: 1, ab: ['fly', 'sweep'], sfx: ['move-float', 'hit-magic', 'death-spirit', null, 'voice-star'] },
    { id: 'akademiya-wanderstar', name: 'Звезда-странница', tier: 7, up: true, shape: 3, v: 2, a: 2, ab: ['fly', 'sweep', 'noRetal'], sfx: ['move-float', 'hit-magic', 'death-spirit', null, 'voice-star'] },
  ],
  neutral: [
    { id: 'neutral-wolf', name: 'Волки', tier: 2, shape: 3.5, v: 2, sfx: ['move-hoof', 'hit-claw', 'death-creature', null, 'voice-wolf'] },
    { id: 'neutral-bandit', name: 'Разбойники', tier: 2, shape: 3.5, sfx: ['move-foot', 'hit-blade', 'death-human', null, 'voice-war'] },
    { id: 'neutral-boar', name: 'Вепри', tier: 3, shape: 5, v: 1, ab: ['charge'], sfx: ['move-hoof', 'hit-claw', 'death-creature', null, 'voice-boar'] },
    { id: 'neutral-leshak', name: 'Лешаки', tier: 3, shape: 6, v: -1, ab: ['root'], sfx: ['move-heavy', 'hit-wood', 'death-creature', null, 'voice-tree'] },
    { id: 'neutral-kikimora', name: 'Кикиморы', tier: 4, shape: 3, shots: 10, ab: ['poison'], sfx: ['move-hop', 'hit-claw', 'death-creature', 'shot-blowpipe', 'voice-frog'] },
    { id: 'neutral-salamander', name: 'Саламандры', tier: 4, v: 1, ab: ['sweep'], sfx: ['move-float', 'hit-magic', 'death-creature', null, 'voice-salamander'] },
    { id: 'neutral-bear', name: 'Медведи', tier: 5, shape: 6, sfx: ['move-heavy', 'hit-claw', 'death-creature', null, 'voice-bear'] },
    { id: 'neutral-sirin', name: 'Сирины', tier: 5, shape: 3, v: 2, ab: ['fly', 'blind'], sfx: ['move-fly', 'hit-claw', 'death-creature', null, 'voice-bird'] },
    { id: 'neutral-stonegiant', name: 'Каменные великаны', tier: 6, shape: 7, v: -2, d: 3, ab: ['big'], sfx: ['move-heavy', 'hit-blunt', 'death-machine', null, 'voice-stone'] },
    { id: 'neutral-poloz', name: 'Великий полоз', tier: 7, shape: 4, ab: ['big', 'poison'], sfx: ['move-float', 'hit-claw', 'death-creature', null, 'voice-serpent'] },
  ],
};

/** Поправка силы за всё, кроме здоровья и урона. */
function modifier(f: Faction, s: Spec, speed: number): number {
  let m = (1 + (speed - 5) * 0.035) * (1 + (s.a ?? 0) * 0.025) * (1 + (s.d ?? 0) * 0.025);
  if (s.shots) m *= RANGED_COST;
  // «Стенка» Затулья стоит силы у той пехоты, что в ней стоит
  if (f === 'zatulye' && !s.shots && !s.ab?.some((a) => a === 'fly' || a === 'big')) m *= WALL_COST;
  for (const ab of s.ab ?? []) m *= ABILITY_COST[ab];
  return m;
}

function build(f: Faction, s: Spec): CreatureDef {
  const t = s.tier - 1;
  const speed = TIER_SPEED[t] + (s.v ?? 0);
  const m = modifier(f, s, speed);
  const target = TIER_POWER[t] * (s.up ? UP_POWER : 1);
  const rs = rootOf(s.shape ?? 4);
  const hp = Math.max(1, Math.round((target / m) * rs * 1.6));
  const dmg = Math.max(1, ((target / m) / rs) * 1.6);
  const double = s.ab?.includes('strike2');
  const strike = double ? dmg / 2 : dmg;
  const dmin = Math.max(1, Math.floor(strike * 0.8));
  const dmax = Math.max(dmin, Math.ceil(strike * 1.2));
  // цена — по настоящим округлённым числам: равные семки всегда равная сила
  const avg = ((dmin + dmax) / 2) * (double ? 2 : 1);
  const power = (rootOf(hp * avg) / 1.6) * m;
  const cost = Math.round((power * COST_K * (1 + COST_TIER * t)) / 5) * 5;
  const [move, hit, death, shot, voice] = s.sfx;
  return {
    id: s.id, name: s.name, faction: f, tier: s.tier, up: !!s.up, hp, dmin, dmax,
    atk: TIER_STAT[t] + (s.a ?? 0), def: TIER_STAT[t] + (s.d ?? 0), speed, shots: s.shots ?? 0,
    abilities: s.ab ?? [], power, cost, weekly: WEEKLY[t], sfx: { move, hit, death, shot: shot ?? undefined, voice },
  };
}

export const CREATURES: Record<string, CreatureDef> = {};
for (const f of Object.keys(SPECS) as Faction[]) for (const s of SPECS[f]) CREATURES[s.id] = build(f, s);

export const FACTIONS: { id: Faction; name: string; field: string; mechanic: string }[] = [
  { id: 'zatulye', name: 'Затулье', field: 'meadow', mechanic: 'Стенка: сосед-пехотинец отвечает на удар вместе с целью, вполсилы' },
  { id: 'zatonye', name: 'Затонье', field: 'swamp', mechanic: 'Трясина: чужие вязнут в топи; проклятие усиливается, пока цель стоит' },
  { id: 'kuznya', name: 'Пепельная кузня', field: 'ash', mechanic: 'Броня: механизмам нипочём мораль и яд, а чинит их только литейщица' },
  { id: 'akademiya', name: 'Звёздная академия', field: 'pine', mechanic: 'Созвездия: школа магии каждого раунда сильнее, небо видно на 2 раунда вперёд' },
];

export const factionCreatures = (f: Faction): CreatureDef[] => Object.values(CREATURES).filter((c) => c.faction === f);
export const hasAb = (c: CreatureDef, a: Ability): boolean => c.abilities.includes(a);

/** Подписи способностей для окна существа. */
export const ABILITY_TEXT: Record<Ability, string> = {
  fly: 'летает', big: 'занимает два гекса', machine: 'механизм: без морали, яд не берёт, магия не лечит',
  noRetal: 'по нему не отвечают', manyRetal: 'отвечает на каждый удар', strike2: 'бьёт дважды', antiBig: '+50 % по большим',
  charge: 'разгон: +5 % урона за гекс', sweep: 'задевает всех врагов рядом с целью', aoe: 'выстрел задевает врагов рядом с целью',
  noMeleePen: 'без штрафа в ближнем бою', noRangePen: 'без штрафа за дальность', poison: 'отравляет', blind: '25 %: цель пропускает ход',
  root: 'цель не сойдёт с места', swallow: '25 %: небольшой отряд выбывает на раунд', mist: 'после удара уходит в туман',
  pass: 'идёт сквозь препятствия и топь', heal: 'лечит своих', repair: 'чинит механизмы', curseCast: 'замедляет врага', spellRes: 'половина урона от заклинаний',
};
