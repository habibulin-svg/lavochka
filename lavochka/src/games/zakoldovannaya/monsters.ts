/* Бестиарий: 100 карточек опасностей (data/monsters.json — перенесено с карточек оригинала и сверено по картинкам). */
import type { Rng } from '../../core/types';
import raw from './data/monsters.json';
import { d6, qty } from './dice';
import type { Foe } from './script';
import type { FoeInst } from './state';

export interface Special {
  kind: string;
  on?: number;
  save?: number;
  chance?: number;
  kinds?: string[];
  bonus?: number;
  count?: number;
  stat?: string;
  amount?: number;
  weapons?: string[];
  text?: string;
  [k: string]: unknown;
}

export interface MonsterDef {
  card: number;
  id: string;
  name: string;
  group?: string;
  kd: number | null;
  kdRange?: [number, number];
  hd: { dice?: number; fixed?: [number, number]; per?: string } | null;
  morale: number | 'am' | null;
  attacks: { name: string | null; dmg: number[]; effect?: string }[];
  specials: Special[];
  value: number | [number, number] | null;
  flee: number[] | 'never' | null;
  text: string;
  notes?: string;
}

export const MONSTERS: MonsterDef[] = raw as MonsterDef[];
export const MONSTER: Record<string, MonsterDef> = Object.fromEntries(MONSTERS.map((m) => [m.id, m]));

export function special(m: MonsterDef | undefined, kind: string): Special | undefined {
  return m?.specials.find((s) => s.kind === kind);
}

/** Очки риска опасности: ведущий бросает жизненные кубики (или берёт фиксированное). */
export function rollHp(m: MonsterDef, rng: Rng, extraHd = 0): number {
  let hp = 0;
  if (m.hd?.dice != null) for (let i = 0; i < m.hd.dice + extraHd; i++) hp += d6(rng);
  else if (m.hd?.fixed) {
    const [a, b] = m.hd.fixed;
    hp = a + rng.int(b - a + 1);
    for (let i = 0; i < extraHd; i++) hp += d6(rng);
  } else hp = 1 + extraHd * 3;
  return Math.max(1, hp);
}

/** Выставить противников по записи сцены. */
export function spawn(foes: Foe[], rng: Rng, uid0: number): FoeInst[] {
  const out: FoeInst[] = [];
  let uid = uid0;
  for (const f of foes) {
    const m = MONSTER[f.m];
    if (!m) continue;
    const n = Math.max(1, qty(f.n ?? 1, rng));
    for (let i = 0; i < n; i++) {
      const hp = f.hp != null ? Math.max(1, qty(f.hp, rng)) : rollHp(m, rng, f.extraHd ?? 0);
      let kd = f.kd ?? m.kd ?? 8;
      if (f.kd == null && m.kdRange) kd = m.kdRange[0] + rng.int(m.kdRange[1] - m.kdRange[0] + 1);
      let value = f.value ?? (Array.isArray(m.value) ? m.value[0] + rng.int(m.value[1] - m.value[0] + 1) : m.value ?? 0);
      if (f.valueMul) value *= f.valueMul;
      const base = f.name ?? m.name;
      out.push({
        uid: uid++,
        m: m.id,
        name: n > 1 ? `${base} ${i + 1}` : base,
        hp, hpMax: hp, kd,
        attacks: f.dmg ? [{ name: null, dmg: f.dmg }] : m.attacks,
        morale: f.morale ?? m.morale,
        value,
        flee: m.flee,
        group: `${f.m}:${base}`,
        gold: i === 0 ? qty(f.gold ?? 0, rng) : 0,
        fleeAt: f.fleeAt,
        ...(f.asleep ? { asleep: true } : {}),
      });
    }
  }
  return out;
}
