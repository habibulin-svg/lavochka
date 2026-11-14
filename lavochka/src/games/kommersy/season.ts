/* «Коммерсы»: сезон — календарь, эпохи, уровни, герои, сделки, карточки и история. Движок, боты и вид берут данные
 * отсюда по номеру сезона в состоянии (opts.season), а не из констант. Первый сезон — таблицы data.ts как есть;
 * второй (2004–2021, docs/kommersy/SEASON2.md) — своими таблицами. */
import * as D from './data';
import type { CardT, Cell, DealT, HistT, Hero, Stat } from './data';
import * as T from './s2data';

export interface Season {
  id: 1 | 2;
  /** Месяц 0 — этот год и месяц (1–12). */
  startYear: number;
  startMonth: number;
  /** Последний месяц партии: календарь его прошёл — финал. */
  last: number;
  yearOf(m: number): number;
  monthOf(m: number): number;
  mm(year: number, month: number): number;
  dateText(m: number): string;
  inCrisis(m: number): boolean;
  /** Длина отрезка, начинающегося в месяце m. */
  segMonths(m: number): number;
  eraOf(m: number): string;
  eraName: Record<string, string>;
  cellWeights: Record<string, Partial<Record<Cell, number>>>;
  /** Ставка кредита и вклада в месяц по эпохе. */
  loanRate: Record<string, number>;
  deposit: Record<string, number>;
  tiers: string[];
  tierId: string[];
  tierAt: number[];
  scale: number[];
  tierOf(worth: number): number;
  heroes: Hero[];
  base: Record<Stat, number>;
  deals: DealT[];
  deal(id: string): DealT | undefined;
  cards: CardT[];
  history: HistT[];
  /** С этого месяца бандитская крыша — обуза, а наезд слабее. */
  banditWeak: number;
  /** Местность для вида (акт клуба во втором сезоне — Лондон, а не уровень). */
  placeName(m: number, t: number): string;
  /** Цель сезона — что покупают в конце. */
  goal: string;
  /** Финалы: id → название. */
  endings: Record<string, string>;
}

/** Календарь сезона с месяца 0 = (year, month) и помесячными кризисными окнами. */
export function calendar(year: number, month: number, crisis: [number, number][], base: (m: number) => number = () => 3) {
  const yearOf = (m: number) => year + Math.floor((m + month - 1) / 12);
  const monthOf = (m: number) => (m + month - 1) % 12;
  const mm = (y: number, mo: number) => (y - year) * 12 + mo - month;
  const dateText = (m: number) => `${D.MONTHS[monthOf(m)]} ${yearOf(m)}`;
  const inCrisis = (m: number) => crisis.some(([a, b]) => m >= a && m <= b);
  const segMonths = (m: number) => (inCrisis(m) ? 1 : Math.min(base(m), Math.max(1, crisis.reduce((d, [a]) => (a > m ? Math.min(d, a - m) : d), base(m)))));
  return { yearOf, monthOf, mm, dateText, inCrisis, segMonths };
}

const byId = (deals: DealT[]) => {
  const map = new Map(deals.map((d) => [d.id, d]));
  return (id: string) => map.get(id);
};
const tierOfAt = (at: number[]) => (worth: number) => at.reduce((t, x, i) => (worth >= x ? i : t), 0);

export const S1: Season = {
  id: 1,
  startYear: D.START_YEAR,
  startMonth: D.START_MONTH,
  last: D.LAST,
  ...calendar(D.START_YEAR, D.START_MONTH, D.CRISIS),
  eraOf: D.eraOf,
  eraName: D.ERA_NAME,
  cellWeights: D.CELL_WEIGHTS,
  loanRate: { soviet: 0.03, wild: 0.08, late: 0.05, new: 0.025 },
  deposit: { soviet: 0.003, wild: 0.01, late: 0.012, new: 0.006 },
  tiers: D.TIERS,
  tierId: D.TIER_ID,
  tierAt: D.TIER_AT,
  scale: D.SCALE,
  tierOf: D.tierOf,
  heroes: D.HEROES,
  base: D.BASE,
  deals: D.DEALS,
  deal: byId(D.DEALS),
  cards: D.CARDS,
  history: D.HISTORY,
  banditWeak: 147,
  placeName: (_m, t) => D.TIERS[t],
  goal: `«${D.CLUB}»`,
  endings: { ...D.ENDINGS, club: `«${D.CLUB}»` },
};

/** Второй сезон: январь 2004 → декабрь 2021 — клуб, крах, «Цифра» (docs/kommersy/SEASON2.md). */
export const S2: Season = {
  id: 2,
  startYear: T.S2_YEAR,
  startMonth: T.S2_MONTH,
  last: T.LAST2,
  ...calendar(T.S2_YEAR, T.S2_MONTH, T.CRISIS2, T.segBase2),
  eraOf: T.eraOf2,
  eraName: T.ERA_NAME2,
  cellWeights: T.CELL_WEIGHTS2,
  loanRate: { club: 0.006, crash: 0.02, it1: 0.012, it2: 0.01 },
  deposit: { club: 0.002, crash: 0, it1: 0.003, it2: 0.002 },
  tiers: T.TIERS2,
  tierId: T.TIER_ID2,
  tierAt: T.TIER_AT2,
  scale: T.SCALE2,
  tierOf: tierOfAt(T.TIER_AT2),
  heroes: T.HEROES2,
  base: T.BASE2,
  deals: T.DEALS2,
  deal: byId(T.DEALS2),
  cards: T.CARDS2,
  history: T.HISTORY2,
  banditWeak: 0,
  placeName: T.placeName2,
  goal: T.TYNDEX,
  endings: T.ENDINGS2,
};

export const SEASONS: Record<number, Season> = { 1: S1, 2: S2 };

/** Сезон по номеру (из opts.season или View.season); нет такого — первый. */
export const season = (n: number | undefined): Season => SEASONS[n ?? 1] ?? S1;

export { tierOfAt, byId };

/** Куплен ли второй сезон (право kommersy_s2) — только для показа: замок у выбора сезона, окно покупки.
 * Клиент подменяет проверку (index.ts); сервер проверяет право сам (GameDef.needRight → server/index.ts). */
export const s2Access = { check: (): boolean => false };
/** Сохранённое наследие первого сезона (localStorage, index.ts): есть — на старте второго сезона можно взять своего Коляна. */
export const legacyStore = { get: (): string | null => null };
