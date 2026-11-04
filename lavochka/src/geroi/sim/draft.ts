/* Драфт «Арены» (DESIGN.md §2): сперва герой из трёх, потом 7 раз отряд из трёх. Предложения у каждого свои и зависят только от сида,
 * соперник видит сделанный выбор после каждого круга: можно подстраиваться. Цена отряда в любой карточке примерно одна: выбор — про роль, а не про «кто дороже». */
import { Rng } from '../../gops/sim/rng';
import type { ArmySlot } from './army';
import { CREATURES, type CreatureDef, type Faction, factionCreatures } from './creatures';
import { CLASSES, type HeroPick, classOf } from './heroes';

export const ARMY_ROUNDS = 7;
/** Доля карточек с нейтралами. */
const NEUTRAL_IN_100 = 12;

export type DraftCard = { hero: HeroPick } | ArmySlot;
export const isHeroCard = (c: DraftCard): c is { hero: HeroPick } => 'hero' in c;

export interface DraftSide {
  hero: HeroPick | null;
  army: ArmySlot[];
  offer: DraftCard[];
  /** Выбор этого круга; −1 — ещё думает. */
  pick: number;
}

export interface DraftState {
  budget: number;
  /** 0 — герой, 1..ARMY_ROUNDS — отряд. */
  round: number;
  rng: number;
  sides: [DraftSide, DraftSide];
  done: boolean;
}

function heroOffer(r: Rng): DraftCard[] {
  const classes = [...CLASSES];
  const out: DraftCard[] = [];
  while (out.length < 3) {
    const [cls] = classes.splice(r.below(classes.length), 1);
    // три разных края: иначе выбирать не из чего
    if (out.some((c) => isHeroCard(c) && classOf(c.hero.cls).faction === cls.faction)) continue;
    out.push({ hero: { cls: cls.id, n: r.int(1, 4) } });
  }
  return out;
}

function countFor(c: CreatureDef, value: number): number {
  return Math.max(1, Math.round(value / c.cost));
}

function armyOffer(r: Rng, f: Faction, side: DraftSide, budget: number): DraftCard[] {
  const value = budget / ARMY_ROUNDS;
  const taken = side.army.map((a) => a.cre);
  const pool = factionCreatures(f).filter((c) => c.cost <= value * 1.25 && !taken.includes(c.id));
  const neutrals = factionCreatures('neutral').filter((c) => c.cost <= value * 1.25 && !taken.includes(c.id));
  const out: DraftCard[] = [];
  const tiers = new Set<number>();
  for (let tries = 0; tries < 60 && out.length < 3; tries++) {
    const list = r.below(100) < NEUTRAL_IN_100 && neutrals.length ? neutrals : pool;
    if (!list.length) break;
    const c = list[r.below(list.length)];
    // в одном предложении — разные ступени
    if (tiers.has(c.tier)) continue;
    tiers.add(c.tier);
    out.push({ cre: c.id, count: countFor(c, value) });
  }
  return out;
}

export function newDraft(seed: number, budget: number): DraftState {
  const r = new Rng(seed);
  const side = (): DraftSide => ({ hero: null, army: [], offer: heroOffer(r), pick: -1 });
  return { budget, round: 0, rng: r.s, sides: [side(), side()], done: false };
}

/** Выбрать карточку; false — такой нет или уже выбрал. */
export function draftPick(d: DraftState, seat: number, i: number): boolean {
  const s = d.sides[seat];
  if (d.done || s.pick >= 0 || !Number.isInteger(i) || i < 0 || i >= s.offer.length) return false;
  s.pick = i;
  return true;
}

/** Круг окончен: кто не выбрал — берёт первую карточку; применить выбор и раздать следующий круг. */
export function draftAdvance(d: DraftState): void {
  const r = new Rng(d.rng);
  for (const s of d.sides) {
    const card = s.offer[Math.max(0, s.pick)];
    if (card) {
      if (isHeroCard(card)) s.hero = card.hero;
      else s.army.push(card);
    }
    s.pick = -1;
  }
  d.round++;
  if (d.round > ARMY_ROUNDS) {
    d.done = true;
    for (const s of d.sides) s.offer = [];
  } else for (const s of d.sides) s.offer = armyOffer(r, classOf(s.hero!.cls).faction, s, d.budget);
  d.rng = r.s;
}

/** Сколько семок набрано по-настоящему (округление не должно уводить далеко от бюджета). */
export const armySpent = (army: ArmySlot[]): number => army.reduce((sum, a) => sum + CREATURES[a.cre].cost * a.count, 0);
