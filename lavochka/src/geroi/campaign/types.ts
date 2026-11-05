/* Кампании (docs/geroi/CAMPAIGNS.md): сценарий = набросок карты + задания и события + ролики. Без DOM: тесты собирают каждый сценарий. */
import type { AdvHero } from '../sim/adv/hero';
import { type Sketch, type ScenarioSpec, attachScenario, buildSketch } from '../sim/adv/sketch';
import { type World, allied } from '../sim/adv/world';

export type Difficulty = 'easy' | 'normal' | 'hard';
export const DIFFICULTIES: Record<Difficulty, { name: string; res: number; guard: number }> = {
  easy: { name: 'Лёгкая', res: 1.5, guard: 0.7 },
  normal: { name: 'Обычная', res: 1, guard: 1 },
  hard: { name: 'Трудная', res: 0.6, guard: 1.3 },
};

const BOTS = ['easy', 'medium', 'hard'] as const;
/** Сложность сдвигает задуманный уровень бота на ступень: лёгкий Димон на трудной — средний. */
function shiftBot(b: 'easy' | 'medium' | 'hard', diff: Difficulty): 'easy' | 'medium' | 'hard' {
  const k = BOTS.indexOf(b) + (diff === 'easy' ? -1 : diff === 'hard' ? 1 : 0);
  return BOTS[Math.max(0, Math.min(2, k))];
}

export interface ScenarioDef {
  id: string;
  title: string;
  /** Брифинг: что происходит и что сделать. */
  brief: string;
  /** Ролики перед сценарием (окно + строка). */
  before: string[];
  sketch: () => Sketch;
  spec: ScenarioSpec;
  /** Главный герой приходит из прошлого сценария: уровень, навыки, заклинания, вещи. */
  carry?: boolean;
}

export interface CampaignDef {
  id: string;
  title: string;
  hero: string;
  text: string;
  /** Портрет на карточке. */
  lad: string;
  scenarios: ScenarioDef[];
  /** Ролики после последнего сценария. */
  finale: string[];
}

/** Что переносится между сценариями. */
export type Carry = Pick<AdvHero, 'level' | 'xp' | 'atk' | 'def' | 'power' | 'know' | 'skills' | 'spells' | 'arts' | 'bag'>;

export function takeCarry(h: AdvHero): Carry {
  return { level: h.level, xp: h.xp, atk: h.atk, def: h.def, power: h.power, know: h.know, skills: h.skills.map((s) => ({ ...s })), spells: [...h.spells], arts: { ...h.arts }, bag: [...h.bag] };
}

/** Мир сценария: карта, сложность, герой из прошлого сценария. */
export function buildScenario(def: ScenarioDef, diff: Difficulty, carry: Carry | null): World {
  const w = buildSketch(def.sketch());
  const d = DIFFICULTIES[diff];
  const human = 0;
  attachScenario(w, def.id, human, def.spec);
  for (const p of w.players) {
    if (p.id === human) for (const k of Object.keys(p.res) as (keyof typeof p.res)[]) p.res[k] = Math.round(p.res[k] * d.res);
    else if (p.bot) p.bot = shiftBot(p.bot, diff);
  }
  // нейтралы и чужие гарнизоны — по сложности
  const scale = (a: AdvHero['army'] | undefined): void => {
    for (const s of a ?? []) if (s) s.count = Math.max(1, Math.round(s.count * d.guard));
  };
  for (const o of w.objects) if (o.owner !== human) scale(o.army);
  for (const h of w.heroes) if (!allied(w, h.owner, human)) scale(h.army);
  w.scn!.guard = d.guard;
  const main = w.heroes.find((h) => h.tag === 'main');
  if (main && carry && def.carry) {
    Object.assign(main, { ...carry, skills: carry.skills.map((s) => ({ ...s })), spells: [...new Set([...main.spells, ...carry.spells])], arts: { ...carry.arts }, bag: [...carry.bag] });
  }
  return w;
}
