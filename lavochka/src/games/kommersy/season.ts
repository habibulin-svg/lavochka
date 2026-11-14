/* «Коммерсы»: сезон — календарь, эпохи, уровни, герои, сделки, карточки и история. Движок, боты и вид берут данные
 * отсюда по номеру сезона в состоянии (opts.season), а не из констант. Первый сезон — таблицы data.ts как есть;
 * второй (2004–2021, docs/kommersy/SEASON2.md) — своими таблицами. */
import * as D from './data';
import type { CardT, Cell, DealT, HistT, Hero, Stat } from './data';

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
}

/** Календарь сезона с месяца 0 = (year, month) и помесячными кризисными окнами. */
export function calendar(year: number, month: number, crisis: [number, number][]) {
  const yearOf = (m: number) => year + Math.floor((m + month - 1) / 12);
  const monthOf = (m: number) => (m + month - 1) % 12;
  const mm = (y: number, mo: number) => (y - year) * 12 + mo - month;
  const dateText = (m: number) => `${D.MONTHS[monthOf(m)]} ${yearOf(m)}`;
  const inCrisis = (m: number) => crisis.some(([a, b]) => m >= a && m <= b);
  const segMonths = (m: number) => (inCrisis(m) ? 1 : Math.min(3, Math.max(1, crisis.reduce((d, [a]) => (a > m ? Math.min(d, a - m) : d), 3))));
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
};

export const SEASONS: Record<number, Season> = { 1: S1 };

/** Сезон по номеру (из opts.season или View.season); нет такого — первый. */
export const season = (n: number | undefined): Season => SEASONS[n ?? 1] ?? S1;

export { tierOfAt, byId };
