/* Действия героя вне боя: оформление (качества, класс, ОР, деньги, покупки, имя), лавка, снаряжение, бутылочки,
 * передача вещей, заклинания вне боя, новый уровень. */
import { ARMORS, CLASSES, GEAR, MAGIC, SHIELD, SPELL, SPELLS, STATS, WEAPONS, statMod, type ClassId } from './book';
import { addXp, giveGoldParty, hero, say, sys, type Ctx } from './ctx';
import { d3, d6, fourDropLow, pick } from './dice';
import { addItem, allowed, alive, capacity, eligible, isTwoHanded, itemName, learn, removeItem, slotOf, type Hero } from './hero';
import { drinkEffect } from './interp';

// ---------- цены

export interface Ware {
  id: string;
  name: string;
  price: number;
  group: string;
  each?: boolean;
}

/** Товары лавки: kind — trurl (всё оружие и вещи; животные не продаются), weapons, animals, bottles, custom. */
export function wares(kind: string, markup = 1, stock?: { id: string; price: number }[]): Ware[] {
  const out: Ware[] = [];
  const m = (p: number) => Math.ceil(p * markup);
  if (kind === 'custom' && stock) {
    for (const s of stock) out.push({ id: s.id, name: itemName({ id: s.id, n: 1 }), price: m(s.price), group: 'Товар' });
    return out;
  }
  if (kind === 'bottles') {
    for (const s of stock ?? []) out.push({ id: s.id, name: itemName({ id: s.id, n: 1 }), price: m(s.price), group: 'Бутылочки' });
    return out;
  }
  if (kind === 'trurl' || kind === 'weapons' || kind === 'start') {
    for (const a of ARMORS) if (a.id !== 'none') out.push({ id: a.id, name: a.name, price: m(a.price), group: 'Доспехи' });
    out.push({ id: 'shield', name: SHIELD.name, price: m(SHIELD.price), group: 'Доспехи' });
    for (const w of WEAPONS) if (w.price > 0 || w.kind === 'ammo') out.push({ id: w.id, name: w.name, price: m(w.price), group: w.group, each: w.each });
  }
  if (kind === 'trurl' || kind === 'start') for (const g of GEAR) if (g.group !== 'Животные' || kind === 'start') out.push({ id: g.id, name: g.name, price: m(g.price), group: g.group });
  if (kind === 'animals') for (const g of GEAR) if (g.group === 'Животные') out.push({ id: g.id, name: g.name, price: m(g.price), group: g.group });
  return out;
}

/** Цена для героя (гному доспех +5). */
export function priceFor(h: Hero, w: Ware): number {
  return w.price + (h.cls === 'gnom' && (ARMORS.some((a) => a.id === w.id) || w.id === 'shield') && w.id !== 'shield' ? CLASSES.gnom.armorExtra : 0);
}

/** Продажа — за половину цены. */
export function sellPrice(id: string): number {
  const base =
    WEAPONS.find((w) => w.id === id)?.price ?? ARMORS.find((a) => a.id === id)?.price ?? GEAR.find((g) => g.id === id)?.price ?? (id === 'shield' ? SHIELD.price : 0);
  if (id.startsWith('magic:')) return 100;
  return Math.floor(base / 2);
}

export function buy(c: Ctx, h: Hero, list: Ware[], id: string, n = 1): boolean {
  const w = list.find((x) => x.id === id);
  if (!w || n < 1 || n > 100) return false;
  const price = priceFor(h, w) * n;
  if (h.gold < price) return false;
  const slot = slotOf(id);
  if (slot && h.cls && !allowed(h.cls, id)) return false;
  const gear = GEAR.find((g) => g.id === id);
  h.gold -= price;
  addItem(h, { id, n });
  if (gear?.animal && h.cls) {
    // животное — со своими очками риска (на листе)
  }
  // надеть сразу, если слот пуст и нет конфликта
  if (slot && h.cls && !h.eq[slot]) equip(h, id);
  sys(c, `${h.name} покупает: ${w.name}${n > 1 ? ` ×${n}` : ''} (−${price} мон.).`);
  return true;
}

export function sell(c: Ctx, h: Hero, id: string, bottle?: number): boolean {
  const it = h.items.find((x) => x.id === id && (bottle == null || x.bottle === bottle));
  if (!it) return false;
  const p = it.id === 'bottle' ? 5 : sellPrice(id);
  removeItem(h, id, 1, bottle);
  h.gold += p;
  sys(c, `${h.name} продаёт ${itemName(it).toLowerCase()} за ${p} мон.`);
  return true;
}

// ---------- снаряжение

/** Надеть/взять в руки. Щит и двуручное — вместе нельзя. */
export function equip(h: Hero, id: string): boolean {
  if (!h.cls || !h.items.some((x) => x.id === id)) return false;
  const slot = slotOf(id);
  if (!slot || !allowed(h.cls, id)) return false;
  if (slot === 'shield' && isTwoHanded(h.eq.melee)) return false;
  if (slot === 'melee' && isTwoHanded(id) && h.eq.shield) delete h.eq.shield;
  h.eq[slot] = id;
  return true;
}
export function unequip(h: Hero, slot: keyof Hero['eq']): boolean {
  if (!h.eq[slot]) return false;
  delete h.eq[slot];
  return true;
}

// ---------- оформление

export function crRoll(c: Ctx, h: Hero): boolean {
  if (h.create.step !== 'stats' && !(h.create.step === 'class' && !eligible(h.stats).length)) return false;
  if (h.create.step === 'class') h.create.rerolls++;
  const rolls = STATS.map(() => fourDropLow(c.rng));
  h.create.stats = rolls;
  STATS.forEach((s, i) => {
    h.base[s] = rolls[i].v;
    h.stats[s] = rolls[i].v;
  });
  h.create.step = 'class';
  sys(c, `${h.name} бросает качества: ${STATS.map((s, i) => `${s === 'str' ? 'сила' : s === 'dex' ? 'ловкость' : s === 'wis' ? 'мудрость' : s === 'con' ? 'сложение' : 'храбрость'} ${rolls[i].v}`).join(', ')}.`);
  if (!eligible(h.stats).length) sys(c, 'Ни один персонаж не подходит (главные качества ниже 9) — можно перебросить.');
  return true;
}

export function crClass(c: Ctx, h: Hero, cls: ClassId): boolean {
  if (h.create.step !== 'class' || !eligible(h.stats).includes(cls)) return false;
  h.cls = cls;
  h.portrait = cls;
  h.create.step = CLASSES[cls].statBonus ? 'bonus' : 'hp';
  sys(c, `${h.name} — ${CLASSES[cls].name.toLowerCase()}.`);
  return true;
}

/** Маг и крон: прибавка к каждому качеству (маг d6 → 0-0-0-1-2-3, крон d3 → 0-0-1). */
export function crBonus(c: Ctx, h: Hero): boolean {
  if (h.create.step !== 'bonus' || !h.cls) return false;
  const table = CLASSES[h.cls].statBonus!;
  const got: number[] = [];
  for (const s of STATS) {
    const f = table.length === 6 ? d6(c.rng) : d3(c.rng);
    const add = table[f - 1];
    got.push(f);
    h.stats[s] += add;
    h.base[s] = h.stats[s];
  }
  h.create.bonus = got;
  h.create.step = 'hp';
  sys(c, `${h.name}: прибавка к качествам — ${STATS.map((s, i) => `+${table[got[i] - 1]}`).join(' ')}.`);
  return true;
}

export function crHp(c: Ctx, h: Hero): boolean {
  if (h.create.step !== 'hp' || !h.cls) return false;
  const p = pick(CLASSES[h.cls].hp, c.rng);
  const mod = statMod(h.stats.con, 'con');
  h.create.hpRoll = p.face;
  h.hpMax = Math.max(1, p.v + mod);
  h.hp = h.hpMax;
  h.create.step = 'money';
  sys(c, `${h.name}: очки риска — ${p.v}${mod ? ` ${mod > 0 ? '+' : '−'} ${Math.abs(mod)} (сложение)` : ''} = ${h.hpMax}.`);
  return true;
}

export function crMoney(c: Ctx, h: Hero): boolean {
  if (h.create.step !== 'money') return false;
  const r = fourDropLow(c.rng);
  h.create.money = r;
  h.gold = r.v * 10;
  h.create.step = 'shop';
  sys(c, `${h.name}: деньги — ${h.gold} монет.`);
  return true;
}

export function crShopDone(c: Ctx, h: Hero): boolean {
  if (h.create.step !== 'shop') return false;
  h.create.step = h.cls && CLASSES[h.cls].spell0 ? 'spell' : 'name';
  return true;
}

export function crSpell(c: Ctx, h: Hero, id: string): boolean {
  const sp = SPELL[id];
  if (h.create.step !== 'spell' || !sp || !h.cls || sp.level !== CLASSES[h.cls].spell0) return false;
  learn(h, id);
  h.create.step = 'name';
  sys(c, `${h.name} знает заклинание «${sp.name}».`);
  return true;
}

export function crName(c: Ctx, h: Hero, name: string, portrait?: string): boolean {
  if (h.create.step !== 'name') return false;
  const n = name.trim().slice(0, 24);
  if (n) h.name = n;
  if (portrait) h.portrait = portrait.slice(0, 24);
  h.create.step = 'done';
  sys(c, `${h.name} готов к походу.`);
  return true;
}

// ---------- вне боя

export function drink(c: Ctx, h: Hero, bottle: number): boolean {
  const it = h.items.find((x) => x.id === 'bottle' && x.bottle === bottle);
  if (!it || !alive(h)) return false;
  removeItem(h, 'bottle', 1, bottle);
  drinkEffect(c, h, bottle);
  for (const x of h.items) if (x.id === 'bottle' && x.bottle === bottle) x.known = true;
  return true;
}

/** Передать товарищу деньги или вещь. */
export function giveTo(c: Ctx, from: Hero, to: Hero, gold?: number, id?: string, bottle?: number): boolean {
  if (!alive(to) || from === to) return false;
  if (gold) {
    const n = Math.min(from.gold, Math.floor(gold), capacity(to) - to.gold);
    if (n <= 0) return false;
    from.gold -= n;
    to.gold += n;
    sys(c, `${from.name} передаёт ${to.name} ${n} мон.`);
    return true;
  }
  if (id) {
    const it = from.items.find((x) => x.id === id && (bottle == null || x.bottle === bottle));
    if (!it) return false;
    removeItem(from, id, 1, bottle);
    addItem(to, { ...it, n: 1 });
    sys(c, `${from.name} передаёт ${to.name}: ${itemName(it)}.`);
    return true;
  }
  return false;
}

/** Бросок жизненного кубика за новый уровень. */
export function levelHp(c: Ctx, h: Hero): boolean {
  const i = h.pending.findIndex((p) => p.kind === 'hp');
  if (i < 0) return false;
  h.pending.splice(i, 1);
  const v = d6(c.rng);
  c.ev.push({ k: 'roll', seat: h.seat, label: `${h.name}: жизненный кубик`, dice: [{ die: 'd6', face: v }], v });
  h.hpMax += v;
  h.hp += v;
  sys(c, `${h.name}: +${v} к очкам риска (${h.hpMax}).`);
  return true;
}

export function levelSpell(c: Ctx, h: Hero, id: string): boolean {
  const i = h.pending.findIndex((p) => p.kind === 'spell');
  const sp = SPELL[id];
  if (i < 0 || !sp) return false;
  const p = h.pending[i] as { kind: 'spell'; level: number };
  if (sp.level !== p.level) return false;
  h.pending.splice(i, 1);
  learn(h, id);
  sys(c, `${h.name} получает заклинание ${p.level}-го уровня: «${sp.name}».`);
  return true;
}

export function spellsOfLevel(level: number) {
  return SPELLS.filter((s) => s.level === level);
}

/** Заклинание вне боя: лечение, золото, распознание, воскрешение, раскаменение, посох мудрости. */
export function castOutside(c: Ctx, h: Hero, id: string, target?: number, bottle?: number): boolean {
  const slot = h.spells.find((s) => s.id === id && (s.left == null || s.left > 0));
  const sp = SPELL[id];
  if (!slot || !sp || !alive(h)) return false;
  const [kind, a] = sp.kind.split(':');
  const use = () => {
    if (slot.left != null) slot.left--;
  };
  const t = target != null ? hero(c, target) : h;
  switch (kind) {
    case 'heal': {
      if (!t || !alive(t)) return false;
      use();
      const before = t.hp;
      if (a === 'full') t.hp = Math.max(t.hp, t.hpMax);
      else {
        t.hp += Number(a);
        t.hpMax = Math.max(t.hpMax, t.hp);
      }
      sys(c, `${h.name} читает «${sp.name}»: ${t.name} +${t.hp - before} ОР.`);
      return true;
    }
    case 'gold': {
      use();
      sys(c, `${h.name} читает «${sp.name}» — камни звенят монетами.`);
      giveGoldParty(c, [h], Number(a));
      return true;
    }
    case 'identify': {
      const it = h.items.find((x) => x.id === 'bottle' && x.bottle === bottle && !x.known);
      if (!it || !it.bottle) return false;
      use();
      for (const x of h.items) if (x.id === 'bottle' && x.bottle === it.bottle) x.known = true;
      sys(c, `${h.name} распознаёт напиток: ${MAGIC[it.bottle].name}.`);
      return true;
    }
    case 'raise':
    case 'unpetrify': {
      if (!t || t === h) return false;
      if (kind === 'raise' ? !t.dead : !t.stone) return false;
      use();
      t.dead = false;
      t.stone = false;
      t.hp = Math.max(1, Math.ceil(t.hpMax / 2));
      say(c, `${h.name} читает «${sp.name}» — ${t.name} снова с отрядом!`);
      return true;
    }
    default:
      return false;
  }
}

/** Обмен денег на игровые очки в лавке (1:1, не больше 1000 за раз). */
export function exchange(c: Ctx, h: Hero, n: number): boolean {
  const k = Math.min(1000, Math.floor(n), h.gold);
  if (k <= 0) return false;
  h.gold -= k;
  sys(c, `${h.name} меняет ${k} мон. на игровые очки.`);
  addXp(c, h, k);
  return true;
}

export { addItem, itemName };
