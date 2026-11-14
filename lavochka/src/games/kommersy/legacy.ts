/* «Коммерсы 2.0»: наследие первого сезона (docs/kommersy/SEASON2.md §9). Кто купил клуб, тот и ведёт второй сезон:
 * Имя, Авторитет, Связи, Близкие→Семья, Совесть, навыки (Английский!), здоровье с поправкой на годы, падения, свои дела
 * (уходят на автопилот в акте клуба — масштабом трёх «дел дома») и год покупки клуба (раньше — больше Славы на старте).
 * Берётся из вида игрока в финале (что он сам видел: совесть — по намёку), хранится маленьким JSON в правилах партии
 * (options.legacy — значит, и в сохранении) и в localStorage (index.ts). Без DOM. */
import { SKILL_MAX, type Skill, type Stat } from './data';
import { S1 } from './season';
import type { Fall, Player, View } from './engine';

export interface Legacy {
  /** Имя героя (подпись «Мой Колян»). */
  n: string;
  /** Год покупки клуба. */
  y: number;
  /** Имя, Авторитет, Связи, Близкие, Совесть, Здоровье. */
  st: number[];
  /** Торговля, Счёт, Базар, Сила, Английский, Порядок. */
  sk: number[];
  /** Падения (виды). */
  f: Fall['kind'][];
  /** Свои дела к финалу (оценка, без бумаг), $. */
  biz: number;
}

const STATS: Stat[] = ['name', 'avt', 'svyazi', 'blizkie', 'sovest', 'health'];
const SKILLS: Skill[] = ['trade', 'schet', 'bazar', 'sila', 'english', 'poryadok'];
const FALLS: Fall['kind'][] = ['razor', 'jail', 'pokushenie', 'zapoi', 'infarkt'];
/** Совесть в виде — только намёк: середина его полосы. */
const SOVEST: Record<string, number> = { 'спит плохо': 15, неспокойно: 40, нормально: 62, 'спит спокойно': 87 };
/** Оценка трёх «дел дома» канонического Коляна (s2data: разрез, магазины, ТЦ). */
export const CANON_HOME = 7.5e7;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, Math.round(v)));

/** Наследие из финала первого сезона: только у купившего клуб и только из его собственного вида. */
export function legacyFromView(v: View, seat: number, name: string): Legacy | null {
  if (v.season !== 1 || v.phase !== 'over' || v.me !== seat) return null;
  const p = v.players.find((x) => x.seat === seat);
  if (!p?.club) return null;
  const sov = SOVEST[v.my?.sovestHint ?? ''] ?? 55;
  return {
    n: name.slice(0, 16),
    y: S1.yearOf(v.m),
    st: STATS.map((k) => (k === 'sovest' ? sov : clamp(p.stats[k] ?? 50, 0, 100))),
    sk: SKILLS.map((k) => clamp(p.skills[k] ?? 0, 0, SKILL_MAX)),
    f: p.falls.map((x) => x.kind).slice(0, 10),
    biz: Math.round(p.assets.filter((a) => a.kind !== 'paper').reduce((t, a) => t + Math.max(0, a.value), 0)),
  };
}

export const encodeLegacy = (l: Legacy) => JSON.stringify(l);

/** Разобрать и обезвредить (правила партии приходят строкой): всё в пределах, иначе null. */
export function parseLegacy(raw: unknown): Legacy | null {
  if (typeof raw !== 'string' || raw.length > 400) return null;
  try {
    const o = JSON.parse(raw) as Partial<Legacy>;
    if (!o || !Array.isArray(o.st) || o.st.length !== STATS.length || !Array.isArray(o.sk) || o.sk.length !== SKILLS.length) return null;
    const num = (x: unknown, a: number, b: number, d: number) => (typeof x === 'number' && Number.isFinite(x) ? clamp(x, a, b) : d);
    return {
      n: typeof o.n === 'string' ? o.n.slice(0, 16) : 'Колян',
      y: num(o.y, 1988, 2003, 2003),
      st: o.st.map((x) => num(x, 0, 100, 50)),
      sk: o.sk.map((x) => num(x, 0, SKILL_MAX, 0)),
      f: (Array.isArray(o.f) ? o.f : []).filter((x): x is Fall['kind'] => FALLS.includes(x as Fall['kind'])).slice(0, 10),
      biz: num(o.biz, 0, 5e9, CANON_HOME),
    };
  } catch {
    return null;
  }
}

/** Слава клуба на старте за ранний клуб: +5 за каждый год до 2003-го, не больше +25. */
export const legacySlava = (l: Legacy) => clamp((2003 - l.y) * 5, 0, 25);
/** Во сколько раз свои дела больше или меньше канонических (0,5–2). */
export const legacyScale = (l: Legacy) => Math.max(0.5, Math.min(2, l.biz / CANON_HOME));

/** Колян из первого сезона вместо канонического (акт клуба, одиночная; вызывает initS2 после канонической раздачи). */
export function applyLegacy(p: Player, l: Legacy) {
  STATS.forEach((k, i) => {
    // здоровье: годы идут — половина пути к канону 2004-го (75), но не ниже 35 и не выше 85
    p.stats[k] = k === 'health' ? clamp((l.st[i] + 75) / 2, 35, 85) : l.st[i];
  });
  SKILLS.forEach((k, i) => (p.skills[k] = l.sk[i]));
  p.falls = l.f.map((kind) => ({ m: 0, kind }));
  const k = legacyScale(l);
  for (const a of p.assets) {
    a.value = Math.round(a.value * k);
    a.income = Math.round(a.income * k);
  }
  if (p.club2) p.club2.slava += legacySlava(l);
}
