/* Герой «Заколдованной страны»: лист персонажа, снаряжение, расчёт КД, попадания, БУ, вместимость, уровни. */
import { ARMORS, CLASSES, GEAR, MAGIC, POCKETS, SHIELD, SPELL, STATS, WEAPONS, needToHit, statMod, type ClassId, type Stat } from './book';

export interface Item {
  /** id из book.ts, 'magic:<n>' (волшебная вещь 26–43), 'bottle' (бутылочка 1–25) или своё ('loot:sekira'). */
  id: string;
  /** Сколько штук (стрелы, дротики, бутылочки одного номера). */
  n: number;
  /** Номер бутылочки по списку книги. */
  bottle?: number;
  /** Содержимое бутылочки известно. */
  known?: boolean;
  /** Своё имя (трофей). */
  name?: string;
  /** Свой урон (секира гурвина, меч глазгора). */
  dmg?: number[];
  /** Цена в лавке (для продажи — половина). */
  price?: number;
}

export interface SpellSlot {
  id: string;
  /** Сколько применений осталось (null — без счёта). */
  left: number | null;
}

/** Что герою ещё нужно сделать между делом: бросить ОР нового уровня, выбрать заклинание. */
export type Pending = { kind: 'hp' } | { kind: 'spell'; level: number };

export type CreateStep = 'stats' | 'class' | 'bonus' | 'hp' | 'money' | 'shop' | 'spell' | 'name' | 'done';

export interface Hero {
  seat: number;
  name: string;
  cls: ClassId | null;
  level: number;
  xp: number;
  /** Качества при оформлении (лист: «базовое значение»). */
  base: Record<Stat, number>;
  /** Качества сейчас (бутылочки, увечья меняют их навсегда). */
  stats: Record<Stat, number>;
  hpMax: number;
  hp: number;
  gold: number;
  items: Item[];
  /** Надето и в руках: id вещей из items. */
  eq: { armor?: string; shield?: string; helm?: string; melee?: string; launcher?: string };
  spells: SpellSlot[];
  pending: Pending[];
  dead?: boolean;
  /** Окаменел (живая вода, раскаменение — оживляют). */
  stone?: boolean;
  /** Невидимость на следующий бой (бутылочка «уменьшитель класса доспехов»). */
  nextInvis?: boolean;
  /** Оберег от первого попадания. */
  wardFirst?: boolean;
  /** Порча: в первой схватке противник раз попадает точно. */
  stunNext?: boolean;
  /** Портрет: класс + вариант. */
  portrait: string;
  /** Записи в листе: кого победил и сколько ИО. */
  kills: { name: string; value: number }[];
  /** Оформление героя (до начала похода). */
  create: { step: CreateStep; stats?: { dice: number[]; v: number }[]; bonus?: number[]; hpRoll?: number; money?: { dice: number[]; v: number }; rerolls: number };
}

export const blankStats = (): Record<Stat, number> => ({ str: 0, dex: 0, wis: 0, con: 0, brv: 0 });

export function newHero(seat: number, name: string): Hero {
  return {
    seat, name, cls: null, level: 0, xp: 0, base: blankStats(), stats: blankStats(), hpMax: 0, hp: 0, gold: 0,
    items: [], eq: {}, spells: [], pending: [], portrait: '', kills: [], create: { step: 'stats', rerolls: 0 },
  };
}

export const alive = (h: Hero) => !h.dead && !h.stone && h.create.step === 'done';

/** Классы, которые позволяют качества (главные не ниже 9). */
export function eligible(stats: Record<Stat, number>): ClassId[] {
  return (Object.keys(CLASSES) as ClassId[]).filter((c) => CLASSES[c].main.every((s) => stats[s] >= 9));
}

// ---------- вещи

export const WEAPON = Object.fromEntries(WEAPONS.map((w) => [w.id, w]));
export const ARMOR = Object.fromEntries(ARMORS.map((a) => [a.id, a]));
export const GEARS = Object.fromEntries(GEAR.map((g) => [g.id, g]));

export function itemName(it: Item): string {
  if (it.name) return it.name;
  if (it.id === 'bottle') return it.known && it.bottle ? `Бутылочка (${it.bottle}): ${MAGIC[it.bottle].name}` : 'Бутылочка';
  if (it.id.startsWith('magic:')) return MAGIC[Number(it.id.slice(6))]?.name ?? it.id;
  if (it.id === 'shield') return SHIELD.name;
  return WEAPON[it.id]?.name ?? ARMOR[it.id]?.name ?? GEARS[it.id]?.name ?? it.id;
}

export function hasItem(h: Hero, id: string): boolean {
  return h.items.some((it) => it.id === id && it.n > 0);
}

export function addItem(h: Hero, it: Item): void {
  const same = h.items.find((x) => x.id === it.id && x.bottle === it.bottle && x.known === it.known && x.name === it.name && !x.dmg && !it.dmg);
  if (same) same.n += it.n;
  else h.items.push({ ...it });
}

/** Убрать n штук; если вещь была надета — снять. */
export function removeItem(h: Hero, id: string, n = 1, bottle?: number): boolean {
  const i = h.items.findIndex((x) => x.id === id && (bottle == null || x.bottle === bottle));
  if (i < 0) return false;
  const it = h.items[i];
  it.n -= n;
  if (it.n <= 0) {
    h.items.splice(i, 1);
    for (const k of Object.keys(h.eq) as (keyof Hero['eq'])[]) if (h.eq[k] === id && !hasItem(h, id)) delete h.eq[k];
  }
  return true;
}

/** Волшебная вещь: разобрать запись эффекта. */
function magicFx(id: string): string[] | null {
  if (!id.startsWith('magic:')) return null;
  return MAGIC[Number(id.slice(6))]?.fx.split(':') ?? null;
}

/** Чем является вещь для снаряжения. */
export function slotOf(id: string): keyof Hero['eq'] | null {
  const fx = magicFx(id);
  if (fx) {
    if (fx[0] === 'weapon') return WEAPON[fx[1]]?.kind === 'launcher' ? 'launcher' : 'melee';
    if (fx[0] === 'armor') return 'armor';
    if (fx[0] === 'shield') return 'shield';
    if (fx[0] === 'helm') return 'helm';
    return null;
  }
  if (id === 'shield') return 'shield';
  if (ARMOR[id]) return 'armor';
  const w = WEAPON[id];
  if (w) return w.kind === 'melee' ? 'melee' : w.kind === 'launcher' ? 'launcher' : null;
  if (id.startsWith('loot:')) return 'melee';
  return null;
}

/** Базовый id (для проверки, разрешено ли классу): волшебный длинный меч — sword_long. */
export function baseId(id: string): string {
  const fx = magicFx(id);
  if (fx && (fx[0] === 'weapon' || fx[0] === 'armor')) return fx[1];
  if (fx && fx[0] === 'shield') return 'shield';
  return id;
}

/** Можно ли классу носить вещь. */
export function allowed(cls: ClassId, id: string): boolean {
  const c = CLASSES[cls];
  const b = baseId(id);
  const slot = slotOf(id);
  if (slot === 'armor') return c.armor(b);
  if (slot === 'shield') return c.shield;
  if (slot === 'melee' || slot === 'launcher') return id.startsWith('loot:') ? cls !== 'mag' : c.weapon(b);
  const w = WEAPON[b];
  if (w && (w.kind === 'missile' || w.kind === 'ammo')) return c.weapon(b) || (w.kind === 'ammo' && c.weapon(w.ammoFor!));
  return true;
}

export function isTwoHanded(id: string | undefined): boolean {
  if (!id) return false;
  return !!WEAPON[baseId(id)]?.twoHanded;
}

// ---------- расчёты

export interface Buffs {
  str?: number;
  dex?: number;
  /** Невидимость: КД по таблице. */
  invis?: boolean;
  /** КД лучше на n (ослепление противников). */
  kd?: number;
}

export function stat(h: Hero, s: Stat, b?: Buffs): number {
  return h.stats[s] + (s === 'str' ? b?.str ?? 0 : 0) + (s === 'dex' ? b?.dex ?? 0 : 0);
}

/** КД героя (чем ниже, тем труднее попасть). */
export function heroKd(h: Hero, b?: Buffs): number {
  let kd = 8;
  const a = h.eq.armor;
  if (a) {
    const fx = magicFx(a);
    if (fx) {
      const baseKd = ARMOR[fx[1]]?.kd ?? 8;
      kd = fx[2].startsWith('=') ? Number(fx[2].slice(1)) : baseKd + Number(fx[2]);
    } else kd = ARMOR[a]?.kd ?? 8;
  }
  if (h.eq.shield) kd -= h.eq.shield === 'shield' ? 1 : 2;
  if (h.eq.helm) kd -= 1;
  kd -= statMod(stat(h, 'dex', b), 'dex');
  if (h.cls) kd -= CLASSES[h.cls].acBonus;
  if (b?.kd) kd -= b.kd;
  return kd;
}

export interface Attack {
  /** id вещи (или 'fist' — без оружия). */
  id: string;
  name: string;
  dmg: number[];
  /** Противнику КД +n. */
  hit: number;
  /** Дополнительный урон. */
  extra: number;
  /** Сколько стрел летит. */
  shots: number;
  missile: boolean;
  /** Чем стреляем (id стрел), если это лук/арбалет/праща. */
  ammo?: string;
  multi?: boolean;
}

/** Удар оружием ближнего боя, которое в руках. */
export function meleeAttack(h: Hero): Attack {
  const id = h.eq.melee;
  if (!id) return { id: 'fist', name: 'Кулаки', dmg: [0, 0.5, 0.5, 1], hit: 0, extra: 0, shots: 1, missile: false };
  const it = h.items.find((x) => x.id === id);
  if (it?.dmg) return { id, name: itemName(it), dmg: it.dmg, hit: 0, extra: 0, shots: 1, missile: false };
  const fx = magicFx(id);
  if (fx) {
    const w = WEAPON[fx[1]];
    return { id, name: MAGIC[Number(id.slice(6))].name, dmg: w.dmg, hit: Number(fx[2]), extra: Number(fx[3]), shots: 1, missile: false };
  }
  const w = WEAPON[id];
  return { id, name: w?.name ?? id, dmg: w?.dmg ?? [1], hit: 0, extra: 0, shots: 1, missile: false };
}

/** Чем можно выстрелить/метнуть сейчас (лук со стрелами, дротики, метательные топоры, камни). */
export function missileAttacks(h: Hero): Attack[] {
  const out: Attack[] = [];
  const l = h.eq.launcher;
  if (l) {
    const fx = magicFx(l);
    const w = WEAPON[fx ? fx[1] : l];
    if (w) {
      for (const it of h.items) {
        const a = WEAPON[it.id];
        if (!a || a.kind !== 'ammo' || a.ammoFor !== w.id || it.n <= 0) continue;
        out.push({
          id: l, ammo: it.id, name: `${fx ? MAGIC[Number(l.slice(6))].name : w.name} (${a.name.toLowerCase()}, ${it.n})`,
          dmg: a.dmg, hit: fx ? Number(fx[2]) : 0, extra: fx ? Number(fx[3]) : 0, shots: fx ? Number(fx[4] || 1) : 1, missile: true, multi: a.multi,
        });
      }
      // у волшебного арбалета «стрелы к нему есть всегда»
      if (fx && fx[1] === 'crossbow' && !out.length) out.push({ id: l, ammo: undefined, name: MAGIC[34].name, dmg: WEAPON.bolt.dmg, hit: 2, extra: 1, shots: 2, missile: true });
    }
  }
  for (const it of h.items) {
    const w = WEAPON[it.id];
    if (w && w.kind === 'missile' && it.n > 0) out.push({ id: it.id, ammo: it.id, name: `${w.name} (${it.n})`, dmg: w.dmg, hit: 0, extra: 0, shots: 1, missile: true });
  }
  return out;
}

/** Сколько нужно выбросить герою, чтобы попасть этим оружием в цель с КД kd. null — только заклинанием. */
export function heroNeed(h: Hero, atk: Attack, kd: number, b?: Buffs): number | null {
  const bonus = (h.cls ? CLASSES[h.cls].hitBonus : 0) + atk.hit;
  const n = needToHit(kd + bonus);
  if (n == null) return null;
  const mod = atk.missile ? statMod(stat(h, 'dex', b), 'dex') : statMod(stat(h, 'str', b), 'str');
  return Math.max(1, n - mod);
}

/** Сколько нужно выбросить на БУ (число из книги — с учётом мудрости и класса). */
export function saveNeed(h: Hero, need: number): number {
  return Math.max(1, need - statMod(h.stats.wis, 'wis') - (h.cls ? CLASSES[h.cls].saveBonus : 0));
}

/** Сколько монет может унести герой (карманы, мешки, животные, повозка, летающий щит). */
export function capacity(h: Hero): number {
  let cap = POCKETS;
  for (const it of h.items) {
    const g = GEARS[it.id];
    if (g?.cap && g.id !== 'cart') cap += g.cap * it.n;
  }
  // повозка без лошади или мула не поедет
  if (hasItem(h, 'cart') && (hasItem(h, 'horse') || hasItem(h, 'mule') || hasItem(h, 'warhorse'))) cap += 6000;
  if (h.spells.some((s) => s.id === 'shield_fly')) cap += 10000;
  return cap;
}

/** Обереги героя: от чего спасают вещи (амулет, крест, пояс) — без бросков и без счёта. */
export function wards(h: Hero): Set<string> {
  const out = new Set<string>();
  for (const it of h.items) {
    const fx = magicFx(it.id);
    if (fx && fx[0] === 'ward') for (const k of fx[1].split(',')) out.add(k);
  }
  return out;
}

// ---------- уровни

/** ИО до следующего уровня (null — двенадцатый, выше нет). */
export function nextXp(h: Hero): number | null {
  if (!h.cls || h.level >= 12) return null;
  return CLASSES[h.cls].xp[h.level];
}

/** Поднять уровни по набранным ИО: в очередь — бросок жизненного кубика и выбор заклинания. Возвращает новые уровни. */
export function levelUps(h: Hero): number[] {
  const out: number[] = [];
  while (h.cls && h.level < 12 && h.xp >= CLASSES[h.cls].xp[h.level]) {
    h.level++;
    out.push(h.level);
    h.pending.push({ kind: 'hp' });
    const sl = CLASSES[h.cls].spells[h.level - 1];
    if (sl > 0) h.pending.push({ kind: 'spell', level: sl });
  }
  return out;
}

export function learn(h: Hero, id: string): void {
  const s = SPELL[id];
  if (!s) return;
  const have = h.spells.find((x) => x.id === id);
  if (have) {
    if (have.left != null && s.uses != null) have.left += s.uses;
  } else h.spells.push({ id, left: s.uses });
}

/** Модификаторы для листа персонажа: АТ (сила), КД (ловкость), БУ (мудрость), ОР (сложение). */
export function sheetMods(h: Hero): Record<Stat, number> {
  const out = {} as Record<Stat, number>;
  for (const s of STATS) out[s] = statMod(h.stats[s], s);
  return out;
}
