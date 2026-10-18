/* Общее для движка: контекст хода (состояние + кубики + события), рассказ, отряд, условия, награды и потери. */
import type { Rng } from '../../core/types';
import { CLASSES, MAGIC, STAT_NAME, type Stat } from './book';
import { fmtHp, mainRoll, qty } from './dice';
import { addItem, alive, capacity, hasItem, itemName, levelUps, learn, removeItem, slotOf, type Hero } from './hero';
import type { Cond, Give, Take, Who } from './script';
import { GM, type Entry, type State } from './state';

/** Событие для экрана (анимации, звуки). Сам рассказ — в state.story. */
export type Ev =
  | { k: 'roll'; seat: number; label: string; dice: { die: 'd3' | 'd6'; face: number }[]; v: number; need?: number | number[]; ok?: boolean }
  | { k: 'move'; path: number[] }
  | { k: 'room'; site: string; room: string }
  | { k: 'hit'; from: string; to: string; dmg: number; kill?: boolean }
  | { k: 'miss'; from: string; to: string }
  | { k: 'sfx'; id: string }
  | { k: 'say'; text: string };

export interface Ctx {
  s: State;
  rng: Rng;
  ev: Ev[];
}

const STORY_MAX = 400;

export function story(c: Ctx, e: Entry): void {
  c.s.story.push({ ...e, day: c.s.world.day });
  if (c.s.story.length > STORY_MAX) c.s.story.splice(0, c.s.story.length - STORY_MAX);
  c.s.seq++;
}
export const say = (c: Ctx, text: string, img?: string) => story(c, { k: 'say', text, ...(img ? { img } : {}) });
export const sys = (c: Ctx, text: string) => story(c, { k: 'sys', text });
export const gmNote = (c: Ctx, text: string) => story(c, { k: 'gm', text, gmOnly: true });

export function hero(c: Ctx, seat: number): Hero | undefined {
  return c.s.heroes.find((h) => h.seat === seat);
}
export function living(s: State): Hero[] {
  return s.heroes.filter(alive);
}
export function leader(s: State): Hero | undefined {
  const l = s.heroes.find((h) => h.seat === s.party.leader && alive(h));
  return l ?? living(s)[0];
}

/** Основной бросок с событием для экрана. */
export function rollMain(c: Ctx, seat: number, label: string, need?: number): { v: number; ok: boolean } {
  const r = mainRoll(c.rng);
  const ok = need == null ? true : r.v >= need;
  c.ev.push({ k: 'roll', seat, label, dice: [{ die: 'd3', face: r.d3 }, { die: 'd6', face: r.d6 }], v: r.v, need, ok });
  return { v: r.v, ok };
}
export function rollD(c: Ctx, seat: number, label: string, die: 'd3' | 'd6', need?: number | number[]): { v: number; ok: boolean } {
  const f = c.rng.int(die === 'd3' ? 3 : 6) + 1;
  const ok = need == null ? true : Array.isArray(need) ? need.includes(f) : f >= need;
  c.ev.push({ k: 'roll', seat, label, dice: [{ die, face: f }], v: f, need, ...(need == null ? {} : { ok }) });
  return { v: f, ok };
}

/** Подстановки в тексте сцены. */
export function fill(c: Ctx, text: string, subj?: number): string {
  const h = subj != null ? hero(c, subj) : undefined;
  return text
    .replace(/\{name\}/g, h?.name ?? leader(c.s)?.name ?? 'путник')
    .replace(/\{leader\}/g, leader(c.s)?.name ?? '')
    .replace(/\{n\}/g, String(c.s.scene?.lastN ?? ''));
}

/** Кто это: список героев по записи Who. */
export function resolveWho(c: Ctx, who: Who | undefined, subj: number | undefined, dflt: Who = 'party'): Hero[] {
  const w = who ?? (subj != null ? 'subject' : dflt);
  const live = living(c.s);
  if (!live.length) return [];
  switch (w) {
    case 'party':
    case 'each':
      return live;
    case 'subject': {
      const h = subj != null ? hero(c, subj) : undefined;
      return h && alive(h) ? [h] : [leader(c.s)!];
    }
    case 'leader':
    case 'chosen':
      return [leader(c.s)!];
    case 'random':
      return [live[c.rng.int(live.length)]];
    default: {
      const [kind, st] = w.split(':') as ['best' | 'worst', Stat];
      const sorted = [...live].sort((a, b) => (kind === 'best' ? b.stats[st] - a.stats[st] : a.stats[st] - b.stats[st]));
      return [sorted[0]];
    }
  }
}

export function evalCond(c: Ctx, cond: Cond, subj?: number): boolean {
  const live = living(c.s);
  const subject = (subj != null ? hero(c, subj) : undefined) ?? leader(c.s);
  const pick = (w: string | undefined, f: (h: Hero) => boolean) => {
    if (w === 'any') return live.some(f);
    if (w === 'all') return live.length > 0 && live.every(f);
    if (w === 'leader') return !!leader(c.s) && f(leader(c.s)!);
    return !!subject && f(subject);
  };
  if ('flag' in cond) {
    const v = c.s.world.flags[cond.flag];
    return cond.is === undefined ? !!v : v === cond.is;
  }
  if ('not' in cond) return !evalCond(c, cond.not, subj);
  if ('all' in cond) return cond.all.every((x) => evalCond(c, x, subj));
  if ('any' in cond) return cond.any.some((x) => evalCond(c, x, subj));
  if ('stat' in cond) return pick(cond.who, (h) => (cond.gte == null || h.stats[cond.stat] >= cond.gte) && (cond.lt == null || h.stats[cond.stat] < cond.lt));
  if ('cls' in cond) return pick(cond.who, (h) => h.cls === cond.cls);
  if ('item' in cond) return pick(cond.who, (h) => hasItem(h, cond.item));
  if ('gold' in cond) return cond.who === 'party' ? live.reduce((a, h) => a + h.gold, 0) >= cond.gold : !!subject && subject.gold >= cond.gold;
  if ('level' in cond) return pick(cond.who, (h) => h.level >= cond.level);
  if ('dead' in cond) return c.s.heroes.some((h) => h.cls && (h.dead || h.stone));
  if ('rule' in cond) return c.s.opts[cond.rule] === cond.is;
  if ('hp' in cond) return pick(cond.who, (h) => (cond.hp.lt == null || h.hp < cond.hp.lt) && (cond.hp.gte == null || h.hp >= cond.hp.gte));
  if ('spell' in cond) return pick(cond.who, (h) => h.spells.some((x) => x.id === cond.spell && (x.left == null || x.left > 0)));
  if ('visited' in cond) return c.s.world.visited.includes(cond.visited);
  if ('night' in cond) return c.s.world.night;
  if ('party' in cond) return live.length >= cond.party;
  if ('gm' in cond) return c.rng.int(100) < (cond.chance ?? 50);
  if ('chance' in cond) return c.rng.int(100) < cond.chance;
  return false;
}

/** Дать герою монеты с учётом вместимости. Возвращает, сколько взял. */
export function addGold(c: Ctx, h: Hero, n: number): number {
  const room = Math.max(0, capacity(h) - h.gold);
  const got = Math.min(room, Math.floor(n));
  h.gold += got;
  return got;
}

/** Деньги отряду: поровну, остаток — вожаку; что не влезло — переходит к тем, у кого есть место, остальное пропадает. */
export function giveGoldParty(c: Ctx, heroes: Hero[], n: number): void {
  if (!heroes.length || n <= 0) return;
  let left = n;
  const share = Math.floor(n / heroes.length);
  for (const h of heroes) left -= addGold(c, h, share);
  for (const h of heroes) if (left > 0) left -= addGold(c, h, left);
  if (left > 0) sys(c, `Не во что сложить ${left} мон. — нужны мешки, мул или повозка.`);
}

export function hurt(c: Ctx, h: Hero, n: number, why?: string): void {
  if (!alive(h) || n <= 0) return;
  h.hp = Math.round((h.hp - n) * 2) / 2;
  sys(c, `${h.name}: −${fmtHp(n)} ОР${why ? ` (${why})` : ''} — осталось ${fmtHp(Math.max(0, h.hp))}.`);
  if (h.hp <= 0) die(c, h);
}

export function die(c: Ctx, h: Hero, how = 'погиб'): void {
  if (h.dead) return;
  h.hp = Math.min(h.hp, 0);
  h.dead = true;
  story(c, { k: 'sys', text: `☠ ${h.name} ${how}.` });
  c.ev.push({ k: 'sfx', id: 'death' });
  if (c.s.party.leader === h.seat) {
    const next = living(c.s)[0];
    if (next) c.s.party.leader = next.seat;
  }
}

export function heal(h: Hero, n: number | 'full'): number {
  if (!alive(h)) return 0;
  const before = h.hp;
  h.hp = n === 'full' ? Math.max(h.hp, h.hpMax) : Math.min(h.hpMax, h.hp + n);
  return h.hp - before;
}

/** Опыт: ИО и подъём на уровень. */
export function addXp(c: Ctx, h: Hero, n: number): void {
  if (n <= 0 || !h.cls) return;
  h.xp += Math.round(n);
  for (const lv of levelUps(h)) {
    story(c, { k: 'sys', text: `★ ${h.name} поднимается на ${lv}-й уровень! Бросок жизненного кубика${h.pending.some((p) => p.kind === 'spell') ? ' и новое заклинание' : ''}.` });
    c.ev.push({ k: 'sfx', id: 'level' });
  }
}

/** Применить { give }. */
export function applyGive(c: Ctx, g: Give, heroes: Hero[], split: boolean): void {
  if (g.revive != null) {
    for (const h of c.s.heroes) {
      if (!(h.dead || h.stone) || !h.cls) continue;
      h.dead = false;
      h.stone = false;
      h.hp = g.revive === 'full' ? h.hpMax : Math.max(1, g.revive === undefined ? Math.ceil(h.hpMax / 2) : Math.min(h.hpMax, qty(g.revive, c.rng)));
      story(c, { k: 'sys', text: `✦ ${h.name} снова жив (${fmtHp(h.hp)} ОР).` });
    }
  }
  if (g.gold != null) {
    const n = qty(g.gold, c.rng);
    if (split) giveGoldParty(c, heroes, n);
    else for (const h of heroes) {
      const got = addGold(c, h, n);
      if (got < n) sys(c, `${h.name} унёс только ${got} мон. из ${n} — больше некуда класть.`);
    }
    if (n > 0) sys(c, split && heroes.length > 1 ? `Отряду — ${n} мон.` : `${heroes.map((h) => h.name).join(', ')}: +${n} мон.`);
  }
  for (const h of heroes) {
    if (g.xp != null) {
      const n = g.xp === 'level' ? Math.max(0, (h.cls ? CLASSES[h.cls].xp[h.level] ?? h.xp : h.xp) - h.xp) : qty(g.xp, c.rng);
      if (n) sys(c, `${h.name}: +${n} ИО.`);
      addXp(c, h, n);
    }
    if (g.doubleGold) {
      const got = addGold(c, h, h.gold);
      sys(c, `${h.name}: деньги удвоились (+${got} мон.).`);
    }
    if (g.hpSet != null) {
      h.hp = Math.min(h.hpMax, g.hpSet);
      sys(c, `${h.name}: ОР — ${fmtHp(h.hp)}.`);
      if (h.hp <= 0) die(c, h);
    }
    if (g.heal) {
      const d = heal(h, 'full');
      sys(c, `${h.name}: раны затянулись (+${fmtHp(d)} ОР).`);
    }
    if (g.hp != null) {
      const n = qty(g.hp, c.rng);
      if (n > 0) {
        h.hp = Math.min(h.hpMax, h.hp + n);
        sys(c, `${h.name}: +${fmtHp(n)} ОР (${fmtHp(h.hp)}).`);
      } else if (n < 0) hurt(c, h, -n);
    }
    if (g.hpMax != null) {
      const n = qty(g.hpMax, c.rng);
      h.hpMax += n;
      h.hp += n;
      sys(c, `${h.name}: ${n >= 0 ? '+' : ''}${n} к очкам риска (${fmtHp(h.hp)} из ${fmtHp(h.hpMax)}).`);
      if (h.hp <= 0) die(c, h);
    }
    if (g.stat) {
      const [st, q] = g.stat;
      const n = qty(q, c.rng);
      h.stats[st] = Math.max(1, h.stats[st] + n);
      sys(c, `${h.name}: ${STAT_NAME[st].toLowerCase()} ${n >= 0 ? '+' : ''}${n} (${h.stats[st]}).`);
    }
    if (g.item) {
      addItem(h, { id: g.item, n: g.count ?? 1 });
      sys(c, `${h.name} получает: ${itemName({ id: g.item, n: 1 })}${g.count && g.count > 1 ? ` ×${g.count}` : ''}.`);
      const slot = slotOf(g.item);
      if (slot && !h.eq[slot] && h.cls) h.eq[slot] = g.item;
    }
    if (g.bottles) {
      for (const b of g.bottles) addItem(h, { id: 'bottle', n: 1, bottle: b });
      sys(c, `${h.name} берёт бутылочк${g.bottles.length > 1 ? 'и' : 'у'}: ${g.bottles.length} шт.`);
    }
    if (g.spell) {
      learn(h, g.spell);
      sys(c, `${h.name} узнаёт заклинание.`);
    }
    if (g.level) {
      for (let i = 0; i < g.level && h.cls && h.level < 12; i++) {
        h.xp = Math.max(h.xp, CLASSES[h.cls].xp[h.level]);
        addXp(c, h, 0);
        levelUps(h);
      }
    }
  }
}

/** Применить { take }. */
export function applyTake(c: Ctx, t: Take, heroes: Hero[]): void {
  if (t.pool && t.gold != null && t.gold !== 'all' && t.gold !== 'half') {
    // общий платёж: сначала вожак, потом остальные
    let need = qty(t.gold, c.rng);
    const order = [leader(c.s)!, ...living(c.s).filter((h) => h !== leader(c.s))].filter(Boolean);
    let paid = 0;
    for (const h of order) {
      const k = Math.min(h.gold, need);
      h.gold -= k;
      need -= k;
      paid += k;
    }
    if (paid) sys(c, `Отряд платит ${paid} мон.`);
    t = { ...t, gold: undefined };
  }
  for (const h of heroes) {
    if (t.gold != null) {
      const n = t.gold === 'all' ? h.gold : t.gold === 'half' ? Math.ceil(h.gold / 2) : Math.min(h.gold, qty(t.gold, c.rng));
      h.gold -= n;
      if (n) sys(c, `${h.name}: −${n} мон.`);
    }
    if (t.item) {
      const lost: string[] = [];
      const drop = (pred: (id: string) => boolean) => {
        for (const it of [...h.items]) if (pred(it.id)) {
          lost.push(itemName(it));
          removeItem(h, it.id, it.n, it.bottle);
        }
      };
      if (t.item === 'best-weapon') {
        const id = h.eq.melee ?? h.eq.launcher;
        if (id) drop((x) => x === id);
      } else if (t.item === 'weapons') drop((x) => slotOf(x) === 'melee' || slotOf(x) === 'launcher' || /arrow|bolt|dart|axe|sling/.test(x));
      else if (t.item === 'armor') drop((x) => slotOf(x) === 'armor' || slotOf(x) === 'shield' || slotOf(x) === 'helm');
      else if (t.item === 'iron') drop((x) => /sword|dagger$|axe|hammer|spear|halberd|kolch_iron|laty|pancir|shield|helm/.test(x) && !x.startsWith('magic'));
      else if (t.item === 'all') drop(() => true);
      else drop((x) => x === t.item);
      if (lost.length) sys(c, `${h.name} лишается: ${lost.join(', ')}.`);
    }
  }
}

/** Описание бутылочки или волшебной вещи по номеру книги. */
export function magicName(n: number): string {
  return MAGIC[n]?.name ?? `№${n}`;
}

/** Ведущий-бот или человек — для подписей. */
export const isGm = (seat: number) => seat === GM;
