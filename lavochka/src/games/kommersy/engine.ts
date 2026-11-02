/* «Коммерсы»: движок без DOM. Дорога из отрезков (квартал, в кризис — месяц), клетки с карточками, баланс (деньги и часы),
 * параметры Коляна, силы среды, исторические даты, падения («Падал, но поднимался») и покупка клуба. */
import type { Rng } from '../../core/types';
import {
  CARDS, CELL_WEIGHTS, CLUB_NEED, CLUB_PRICE, DEALS, HEROES, HISTORY, LAST, SEG_CELLS, SKILL_MAX, STAT_RANGE, BASE,
  dealById, eraOf, inCrisis, nicheMul, segMonths, tierOf,
  type CardT, type Cell, type Choice, type DealT, type Ending, type Fx, type Kind, type Krysha, type Skill, type Stat,
} from './data';

export interface Asset {
  uid: number;
  id: string;
  name: string;
  kind: Kind;
  value: number;
  income: number;
  hours: number;
  manager: boolean;
  mul: number;
}
export interface Loan {
  left: number;
  rate: number;
  pay: number;
}
export interface Fall {
  m: number;
  kind: 'razor' | 'jail' | 'pokushenie' | 'zapoi';
}
export interface Player {
  seat: number;
  hero: string;
  cash: number;
  assets: Asset[];
  loans: Loan[];
  job: { name: string; salary: number; hours: number } | null;
  stats: Record<Stat, number>;
  skills: Record<Skill, number>;
  krysha: Krysha;
  enemies: number;
  /** Месяцы вне дороги и почему. */
  out: number;
  outKind: 'jail' | 'hosp' | 'away' | null;
  prep: string[];
  hoursBonus: number;
  upkeep: number;
  study: number;
  dreams: string[];
  insurance: boolean;
  advisor: boolean;
  incomeBoost: number;
  /** Перегрузка часами в прошлом отрезке: доход своих дел без управляющих падает. */
  over: boolean;
  falls: Fall[];
  club: boolean;
  pos: number;
  ending: Ending | null;
  /** «Бухгалтерия»: сколько раз разноска сошлась. */
  books?: number;
  /** Отрезок (его месяц), в котором уже ходил против соперника: раз за отрезок. */
  rivalM?: number;
}
export type Rival = 'demping' | 'peremanit' | 'naezd' | 'donos';
export const RIVAL_NAME: Record<Rival, string> = { demping: 'Сбить цены', peremanit: 'Переманить управляющего', naezd: 'Наехать через крышу', donos: 'Донести' };
export const RIVAL_DARK: Record<Rival, boolean> = { demping: false, peremanit: false, naezd: true, donos: true };

export interface AskChoice {
  label: string;
  ok: boolean;
  why?: string;
  dark?: boolean;
  /** Для ботов и подсказок: что даёт выбор. */
  fx?: Fx;
  risk?: Choice['risk'];
  buy?: 'deal' | 'pass' | 'club' | 'auction';
  /** Номер предложения в ask.deals. */
  di?: number;
}
/** Предложение на клетке «Сделка»: как вести (сам / управляющий) и сколько взять в кредит — уже посчитано. */
export interface Offer {
  id: string;
  name: string;
  text: string;
  price: number;
  income: number;
  hours: number;
  kind: Kind;
  risk: number;
  mgr: boolean;
  loan: number;
  /** Торги: наценка, которую покупатель права платит продавцу. */
  fee?: number;
}
export interface Ask {
  seat: number;
  cell: Cell;
  title: string;
  text: string;
  card?: string;
  deals?: Offer[];
  choices: AskChoice[];
  /** Торги: кто выставил право и кто ещё не ответил. */
  auction?: { seller: number; rest: number[] };
}
/** Строка «Бухгалтерии»: статья и сумма в месяц (доход +, расход −). */
export interface BookLine {
  label: string;
  sum: number;
}
export interface Books {
  seat: number;
  len: number;
  lines: BookLine[];
  ans: number | null;
}

export interface Opts {
  diff: number;
  start: number;
  chance: number;
  buh: boolean;
}

export interface State {
  opts: Opts;
  players: Player[];
  /** Начало текущего отрезка и его длина в месяцах. */
  m: number;
  len: number;
  cells: Cell[];
  turn: number;
  first: number;
  phase: 'roll' | 'move' | 'choose' | 'buh' | 'over';
  roll: number | null;
  target: number | null;
  ask: Ask | null;
  crisisMul: number;
  crisisUntil: number;
  fired: string[];
  uid: number;
  /** «Бухгалтерия»: разноска за отрезок, пока все не сдали. */
  books?: Books[] | null;
}

export type Action =
  | { type: 'roll' }
  | { type: 'move' }
  | { type: 'choose'; i: number }
  | { type: 'sell'; uid: number }
  | { type: 'manager'; uid: number; on: boolean }
  | { type: 'repay' }
  | { type: 'quit' }
  | { type: 'krysha'; to: Krysha }
  | { type: 'buh'; sum: number }
  | { type: 'rival'; kind: Rival; target: number };

export type Event =
  | { t: 'roll'; seat: number; d: number }
  | { t: 'move'; seat: number; cell: Cell }
  | { t: 'pick'; seat: number; title: string; label: string; dark?: boolean }
  | { t: 'risk'; seat: number; text: string }
  | { t: 'buy'; seat: number; name: string; sum: number }
  | { t: 'sell'; seat: number; name: string; sum: number }
  | { t: 'period'; m: number; len: number }
  | { t: 'hist'; id: string; title: string; text: string }
  | { t: 'fall'; seat: number; kind: Fall['kind'] }
  | { t: 'out'; seat: number; kind: 'jail' | 'hosp' | 'away'; months: number }
  | { t: 'club'; seat: number }
  | { t: 'auction'; seat: number; name: string; fee: number }
  | { t: 'resold'; seat: number; from: number; name: string; fee: number }
  | { t: 'unsold'; name: string }
  | { t: 'buh'; seat: number; ok: boolean; sum: number; ans: number }
  | { t: 'rival'; seat: number; target: number; kind: Rival; ok: boolean }
  | { t: 'over' };

// ---------------------------------------------------------------- помощники
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
export const round = (v: number) => (Math.abs(v) >= 1000 ? Math.round(v / 10) * 10 : Math.round(v));

export function money(v: number): string {
  const a = Math.abs(v);
  const s = a >= 1e6 ? `${(a / 1e6).toFixed(a >= 1e8 ? 0 : 1).replace('.', ',')} млн` : a >= 1e4 ? `${Math.round(a / 1000)} тыс.` : `${Math.round(a)}`;
  return `${v < 0 ? '−' : ''}$${s}`;
}

export const debt = (p: Player) => p.loans.reduce((s, l) => s + l.left, 0);
export const worth = (p: Player) => p.cash + p.assets.reduce((s, a) => s + a.value, 0) - debt(p);
export const tier = (p: Player) => tierOf(worth(p));
/** Единица трат карточек: траты растут вместе с доходом («начинаешь шиковать»). */
const unitOf = (s: State, p: Player) => Math.max(30, 0.7 * income(s, p));
const rateOf = (m: number) => ({ soviet: 0.03, wild: 0.08, late: 0.05, new: 0.025 })[eraOf(m)];

export function hoursAvail(p: Player) {
  const family = p.dreams.includes('svadba') ? 15 : 0;
  return 220 + p.hoursBonus + p.skills.poryadok * 8 - family;
}
export function hoursUsed(p: Player) {
  return (p.job?.hours ?? 0) + p.study + p.assets.reduce((s, a) => s + (a.manager ? Math.ceil(a.hours * 0.15) : a.hours), 0);
}
export const hoursFree = (p: Player) => hoursAvail(p) - hoursUsed(p);

/** Доход дела в месяц m сейчас. */
export function assetIncome(s: State, p: Player, a: Asset, m = s.m) {
  if (a.kind === 'paper') return 0;
  const d = dealById(a.id);
  let v = a.income * a.mul * p.incomeBoost * (d ? nicheMul(d, m) : 1);
  if (m < s.crisisUntil) v *= Math.max(0.1, 1 - (1 - s.crisisMul) * Math.min(1, (d?.crisis ?? 0.5) * 2));
  if (!a.manager && p.over) v *= 0.8;
  if (p.out > 0 && !a.manager) v *= 0.3;
  if (a.manager) v *= 0.88;
  return v;
}
/** Цена дела при продаже: от дохода (полтора года выручки), но не меньше 60 % и не больше 250 % вложенного. */
export function assetValue(s: State, p: Player, a: Asset) {
  if (a.kind !== 'biz') return a.value;
  return clamp(18 * assetIncome(s, p, a), 0.6 * a.value, 2.5 * a.value);
}
export const marketWorth = (s: State, p: Player) => p.cash + p.assets.reduce((t, a) => t + assetValue(s, p, a), 0) - debt(p);
export const income = (s: State, p: Player) => (p.job?.salary ?? 0) + p.assets.reduce((t, a) => t + assetIncome(s, p, a), 0);
export function expenses(s: State, p: Player) {
  const biz = p.assets.reduce((t, a) => t + assetIncome(s, p, a), 0);
  const basket = 25 + 0.12 * (biz + (p.job?.salary ?? 0));
  const dan = biz * ({ none: 0, bandit: 0.2, police: 0.25, own: 0.1 } as Record<Krysha, number>)[p.krysha];
  const loans = p.loans.reduce((t, l) => t + l.pay, 0);
  return basket + dan + loans + p.upkeep;
}

/** Сменить крышу самому: менты — при связях, своя охрана — с уровня «Центр»; братву не выбирают — она приходит сама. */
export const kryshaOk = (s: State, p: Player, to: Krysha) => to === 'none' || (to === 'police' && p.stats.svyazi >= 30) || (to === 'own' && tier(p) >= 3);
export const kryshaCost = (s: State, p: Player, to: Krysha) => (to === 'police' ? 1 : to === 'own' ? 3 : 0) * unitOf(s, p);

/** Условия покупки клуба: что выполнено. */
export function clubCheck(s: State, p: Player) {
  const n = CLUB_NEED[clamp(s.opts.diff, 0, 2)];
  return [
    { id: 'cash', label: `Деньги ${money(CLUB_PRICE)}`, ok: p.cash >= CLUB_PRICE },
    { id: 'name', label: `Имя ≥ ${n.name}`, ok: p.stats.name >= n.name },
    { id: 'svyazi', label: `Связи в Москве ≥ ${n.svyazi}`, ok: p.stats.svyazi >= n.svyazi },
    { id: 'heat', label: 'Чистый хвост', ok: p.stats.heat <= n.heat && p.outKind !== 'jail' },
    { id: 'english', label: `Английский ${n.english} или советник`, ok: p.skills.english >= n.english || p.advisor },
    { id: 'hours', label: `Свободные часы ≥ ${n.hours}`, ok: hoursFree(p) >= n.hours },
  ];
}
export const clubReady = (s: State, p: Player) => clubCheck(s, p).every((c) => c.ok);

// ---------------------------------------------------------------- начало партии
export function newState(seats: number[], opts: Partial<Opts> = {}, heroes: string[] = [], rng?: Rng): State {
  const o: Opts = { diff: opts.diff ?? 1, start: opts.start ?? 0, chance: opts.chance ?? 0, buh: opts.buh ?? false };
  const players = seats.map((seat, i): Player => {
    const h = HEROES.find((x) => x.id === heroes[i]) ?? HEROES[i % HEROES.length];
    const stats = { ...BASE } as Record<Stat, number>;
    for (const [k, v] of Object.entries(h.stats)) stats[k as Stat] = v!;
    const skills: Record<Skill, number> = { trade: 0, schet: 0, bazar: 0, sila: 0, english: 0, poryadok: 0 };
    for (const [k, v] of Object.entries(h.skills)) skills[k as Skill] = v!;
    const c = o.chance;
    // «Второй шанс»: опыт прошлой попытки — навыки, деньги, память о датах
    if (c > 0) {
      skills.schet = Math.min(SKILL_MAX, skills.schet + c);
      skills.bazar = Math.min(SKILL_MAX, skills.bazar + Math.ceil(c / 2));
      stats.svyazi += 5 * c;
    }
    const startCash = o.start >= 120 ? h.cash * 400 : o.start >= 40 ? h.cash * 10 : h.cash;
    return {
      seat, hero: h.id, cash: startCash * (1 + c), assets: [], loans: [],
      job: o.start >= 40 ? null : { name: 'грузчик на овощебазе', salary: 55, hours: 120 },
      stats, skills, krysha: 'none', enemies: 0, out: 0, outKind: null,
      prep: c > 0 ? HISTORY.filter((x) => x.loss).slice(0, c * 2).map((x) => x.id) : [],
      hoursBonus: 0, upkeep: 0, study: 0, dreams: [], insurance: false, advisor: false, incomeBoost: 1, over: false, falls: [], club: false, pos: 0, ending: null,
    };
  });
  const s: State = {
    opts: o, players, m: o.start, len: segMonths(o.start), cells: [], turn: 0, first: 0, phase: 'roll', roll: null, target: null, ask: null,
    crisisMul: 1, crisisUntil: 0, fired: HISTORY.filter((x) => x.m < o.start).map((x) => x.id), uid: 1,
  };
  s.cells = makeCells(s.m, rng);
  return s;
}

/** Отрезок дороги: шесть клеток по долям эпохи и «Новый квартал». Без rng (показ) — ровный порядок. */
export function makeCells(m: number, rng?: Rng): Cell[] {
  const w = CELL_WEIGHTS[eraOf(m)];
  const bag: Cell[] = [];
  for (const [c, n] of Object.entries(w)) for (let i = 0; i < n!; i++) bag.push(c as Cell);
  const out: Cell[] = [];
  const fixed: Cell[] = ['deal', 'routine', 'news', 'deal', 'rest', 'study', 'deal', 'event', 'news', 'naezd'];
  for (let i = 0; i < SEG_CELLS; i++) {
    let c = rng ? bag[rng.int(bag.length)] : fixed[i];
    if (rng && i > 0 && c === out[i - 1] && c !== 'deal') c = bag[rng.int(bag.length)];
    out.push(c);
  }
  out.push('period');
  return out;
}

// ---------------------------------------------------------------- последствия
function addStat(p: Player, k: Stat, v: number) {
  const [a, b] = STAT_RANGE[k];
  // связи насыщаются: с 50 прибавка тает, у сотни — ноль (иначе к середине партии у всех 100)
  if (k === 'svyazi' && v > 0) v *= Math.min(1, (100 - p.stats.svyazi) / 50);
  p.stats[k] = clamp(Math.round(p.stats[k] + v), a, b);
}

function pickAsset(p: Player, rng: Rng, pred: (a: Asset) => boolean = (a) => a.kind !== 'paper') {
  const list = p.assets.filter(pred);
  return list.length ? list[rng.int(list.length)] : null;
}

function growTarget(s: State, p: Player) {
  return p.assets.find((a) => {
    const d = dealById(a.id);
    const n = d?.next ? dealById(d.next) : undefined;
    return !!n && s.m >= n.from && p.cash >= (n.price - a.value) * 0.8;
  });
}

function setOut(s: State, p: Player, kind: 'jail' | 'hosp' | 'away', months: number, ev: Event[]) {
  if (months <= 0) return;
  p.out = Math.max(p.out, months);
  p.outKind = kind;
  p.pos = SEG_CELLS + 1;
  ev.push({ t: 'out', seat: p.seat, kind, months });
}

export function applyFx(s: State, p: Player, fx: Fx, rng: Rng, ev: Event[]) {
  const sc = unitOf(s, p);
  if (fx.cash) p.cash += fx.cash;
  if (fx.cashT) p.cash += fx.cashT * sc;
  if (fx.cashPct && p.cash > 0) p.cash += p.cash * fx.cashPct;
  for (const [k, v] of Object.entries(fx.stats ?? {})) addStat(p, k as Stat, v!);
  for (const [k, v] of Object.entries(fx.skills ?? {})) p.skills[k as Skill] = clamp(p.skills[k as Skill] + v!, 0, SKILL_MAX);
  if (fx.krysha) p.krysha = fx.krysha;
  if (fx.enemy) p.enemies += fx.enemy;
  if (fx.prep && !p.prep.includes(fx.prep)) p.prep.push(fx.prep);
  if (fx.hoursBonus) p.hoursBonus += fx.hoursBonus;
  if (fx.upkeepT) p.upkeep += fx.upkeepT * sc;
  if (fx.studyHours) p.study += fx.studyHours;
  if (fx.dream && !p.dreams.includes(fx.dream)) p.dreams.push(fx.dream);
  if (fx.insurance) p.insurance = true;
  if (fx.advisor) p.advisor = true;
  if (fx.incomeBoost) p.incomeBoost = Math.min(2, p.incomeBoost * fx.incomeBoost);
  if (fx.asset) {
    const m1 = (a: Asset) => assetIncome(s, p, a);
    if (fx.asset === 'good') {
      const a = pickAsset(p, rng);
      if (a) p.cash += m1(a) * 2;
    } else if (fx.asset === 'bad') {
      const a = pickAsset(p, rng);
      if (a) p.cash -= m1(a) * (1.5 - p.skills.trade * 0.15);
    } else if (fx.asset === 'grow') {
      const a = growTarget(s, p);
      const n = a && dealById(dealById(a.id)!.next!);
      if (a && n) {
        p.cash -= (n.price - a.value) * 0.8;
        Object.assign(a, { id: n.id, name: n.name, kind: n.kind, value: n.price, income: n.income, hours: n.hours });
        ev.push({ t: 'buy', seat: p.seat, name: n.name, sum: n.price });
      }
    } else if (fx.asset === 'sell') {
      const a = [...p.assets].sort((x, y) => y.value - x.value)[0];
      if (a) {
        const sum = a.value * (1.4 + 0.1 * p.skills.bazar);
        p.cash += sum;
        p.assets = p.assets.filter((x) => x !== a);
        ev.push({ t: 'sell', seat: p.seat, name: a.name, sum });
      }
    } else if (fx.asset === 'fire') {
      const a = pickAsset(p, rng, (x) => x.kind !== 'paper');
      if (a && !p.insurance) {
        a.value *= 0.4;
        a.mul *= 0.6;
        addStat(p, 'mood', -8);
      }
    }
  }
  if (fx.jail) {
    setOut(s, p, 'jail', fx.jail, ev);
    fall(s, p, 'jail', ev);
  }
  if (fx.hosp) {
    setOut(s, p, 'hosp', fx.hosp, ev);
    if (fx.hosp >= 2) fall(s, p, 'pokushenie', ev);
  }
  if (fx.away) setOut(s, p, 'away', fx.away, ev);
}

function fall(s: State, p: Player, kind: Fall['kind'], ev: Event[]) {
  p.falls.push({ m: s.m, kind });
  ev.push({ t: 'fall', seat: p.seat, kind });
}

// ---------------------------------------------------------------- клетки → вопрос игроку
function availableDeals(s: State, p: Player) {
  const t = tier(p);
  return DEALS.filter((d) => s.m >= d.from && s.m <= d.peak + 24 && (!d.dies || s.m < d.dies) && d.tier >= t - 1 && d.tier <= t + 1);
}

/** Клетка «Сделка»: до трёх предложений — чаще то, что по карману (с кредитом), иногда — на вырост. */
function dealAsk(s: State, p: Player, rng: Rng): Ask | null {
  const list = availableDeals(s, p);
  if (!list.length) return null;
  const t = tier(p);
  const purse = Math.max(0, p.cash) + loanLimit(p);
  const fit = list.filter((d) => d.price <= purse * 1.2);
  const deals: Offer[] = [];
  for (let k = 0; k < 3; k++) {
    const pool = (fit.length && rng.next() < 0.8 ? fit : list).filter((d) => !deals.some((x) => x.id === d.id));
    if (!pool.length) break;
    const bag: DealT[] = [];
    for (const d of pool) for (let i = 0; i < (d.tier === t ? 3 : d.tier > t ? 2 : 1); i++) bag.push(d);
    const d = bag[rng.int(bag.length)];
    const price = round(d.price * (0.85 + rng.int(31) / 100));
    const inc = round(d.income * nicheMul(d, s.m) * (0.85 + rng.int(36) / 100));
    deals.push({ id: d.id, name: d.name, text: d.text, price, income: inc, hours: d.hours, kind: d.kind, risk: d.risk, mgr: false, loan: 0 });
  }
  const choices = deals.map((o, di) => offerChoice(s, p, o, di));
  // сетевая партия: не тянешь сделку — выставь право на неё другим с наценкой (торги)
  if (s.players.some((q) => q !== p && q.out === 0))
    deals.forEach((o, di) => {
      if (!choices[di].ok) choices.push({ label: `На торги: «${o.name}» (+${money(round(o.price * 0.1))})`, ok: true, buy: 'auction', di });
    });
  choices.push({ label: 'Мимо', ok: true, buy: 'pass' });
  return { seat: p.seat, cell: 'deal', title: deals.length > 1 ? 'Сделки' : deals[0].name, text: deals.length > 1 ? 'Что подвернулось:' : deals[0].text, deals, choices };
}

/** Можно ли взять предложение и как: сам, если часы позволяют и остаётся запас, иначе — управляющий; не хватает денег — кредит. */
function offerChoice(s: State, p: Player, o: Offer, di: number, fee = 0): AskChoice {
  const d = dealById(o.id)!;
  const bad = needFail(s, p, d);
  const free = hoursFree(p);
  const mgrH = Math.ceil(o.hours * 0.15);
  o.mgr = o.kind === 'biz' && (o.hours > free || free - o.hours < 40);
  const h = o.mgr ? mgrH : o.hours;
  o.loan = Math.max(0, o.price + fee - Math.max(0, p.cash));
  const why = bad ?? (h > free ? 'не хватает часов' : o.loan > 0 && (p.stats.name < 15 || o.loan > loanLimit(p)) ? 'не хватает денег' : undefined);
  const how = [o.mgr ? 'с управляющим' : '', o.loan > 0 ? `в кредит ${money(o.loan)}` : ''].filter(Boolean).join(', ');
  return { label: `${o.name}${how ? ` — ${how}` : ''}`, ok: !why, why, buy: 'deal', di };
}

function needFail(s: State, p: Player, d: DealT): string | null {
  const n = d.need;
  if (!n) return null;
  if (n.svyazi && p.stats.svyazi < n.svyazi) return `нужны связи ${n.svyazi}`;
  if (n.krysha && p.krysha === 'none') return 'нужна крыша';
  if (n.avt && p.stats.avt < n.avt) return `нужен авторитет ${n.avt}`;
  for (const [k, v] of Object.entries(n.skill ?? {})) if (p.skills[k as Skill] < v!) return `нужен навык «${k}» ${v}`;
  return null;
}

export const loanLimit = (p: Player) => Math.max(0, Math.max(500, worth(p) * 0.6) * (p.stats.name / 50) - debt(p));

function cardOk(s: State, p: Player, c: CardT) {
  const t = tier(p);
  return (c.from == null || s.m >= c.from) && (c.to == null || s.m <= c.to) && (c.minTier == null || t >= c.minTier) && (c.maxTier == null || t <= c.maxTier) && !(c.choices.length === 1 && c.choices[0].fx.dream && p.dreams.includes(c.choices[0].fx.dream));
}

function choiceWhy(s: State, p: Player, ch: Choice): string | undefined {
  const n = ch.need;
  if (ch.fx.dream && p.dreams.includes(ch.fx.dream)) return 'уже есть';
  const cost = (ch.fx.cash ?? 0) < 0 ? -ch.fx.cash! : 0;
  if (cost && p.cash < cost) return 'не хватает денег';
  if (!n) return undefined;
  if (n.cashT && p.cash < n.cashT * unitOf(s, p)) return 'не хватает денег';
  if (n.krysha && p.krysha === 'none') return 'нет крыши';
  if (n.noKrysha && p.krysha !== 'none') return 'есть крыша';
  if (n.asset && !p.assets.some((a) => a.kind !== 'paper')) return 'нет дела';
  if (n.growable && !growTarget(s, p)) return 'нечего расширять';
  for (const [k, v] of Object.entries(n.skill ?? {})) if (p.skills[k as Skill] < v!) return 'не хватает навыка';
  for (const [k, v] of Object.entries(n.stat ?? {})) if (p.stats[k as Stat] < v!) return 'не хватает';
  return undefined;
}

function cardAsk(s: State, p: Player, cell: Cell, rng: Rng): Ask {
  const list = CARDS.filter((c) => c.cell === cell && cardOk(s, p, c));
  const bag: CardT[] = [];
  for (const c of list) {
    // собрался в Лондон (с «Центра») — английский и советник попадаются вдвое чаще
    const london = tier(p) >= 3 && c.choices.some((x) => x.fx.skills?.english || x.fx.advisor);
    const w = c.id === 'k-pokushenie' ? Math.min(4, p.enemies) : c.choices.some((x) => x.need?.asset || x.need?.growable) && !p.assets.length ? 0 : london ? 4 : 2;
    for (let i = 0; i < w; i++) bag.push(c);
  }
  const card = bag.length ? bag[rng.int(bag.length)] : null;
  if (!card) return { seat: p.seat, cell, title: 'Тихо', text: 'Ничего не случилось.', choices: [{ label: 'Дальше', ok: true }] };
  const choices: AskChoice[] = card.choices.map((ch) => {
    const why = choiceWhy(s, p, ch);
    return { label: ch.label, ok: !why, why, dark: ch.dark, fx: ch.fx, risk: ch.risk };
  });
  if (!choices.some((c) => c.ok)) choices.push({ label: 'Дальше', ok: true });
  if (cell === 'rest' && clubReady(s, p)) choices.unshift({ label: 'Купить «Лондон Юнайтед»', ok: true, buy: 'club' });
  return { seat: p.seat, cell, title: card.title, text: card.text, card: card.id, choices };
}

// ---------------------------------------------------------------- ход
export function toAct(s: State): number[] {
  if (s.phase === 'over') return [];
  if (s.phase === 'choose' && s.ask) return [s.ask.seat];
  if (s.phase === 'buh') return (s.books ?? []).filter((b) => b.ans == null).map((b) => b.seat);
  return [s.players[s.turn].seat];
}

const P = (s: State, seat: number) => s.players.find((p) => p.seat === seat)!;

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.phase === 'over') return null;
  const s = clone(s0);
  const ev: Event[] = [];
  const p = P(s, seat);
  if (!p) return null;
  const mine = s.players[s.turn].seat === seat;

  if (a.type === 'sell' || a.type === 'manager' || a.type === 'repay' || a.type === 'quit' || a.type === 'krysha' || a.type === 'rival') {
    if (!mine || s.phase !== 'roll') return null;
    if (a.type === 'rival') {
      const q = s.players.find((x) => x.seat === a.target);
      if (!q || rivalWhy(s, p, q, a.kind) !== null) return null;
      rival(s, p, q, a.kind, rng, ev);
    } else if (a.type === 'sell') {
      const x = p.assets.find((q) => q.uid === a.uid);
      if (!x) return null;
      const sum = x.kind === 'paper' ? x.value : assetValue(s, p, x) * (x.kind === 'estate' ? 0.9 : 0.85 + 0.03 * p.skills.bazar);
      p.cash += sum;
      p.assets = p.assets.filter((q) => q !== x);
      ev.push({ t: 'sell', seat, name: x.name, sum });
    } else if (a.type === 'manager') {
      const x = p.assets.find((q) => q.uid === a.uid);
      if (!x || x.kind !== 'biz' || x.manager === a.on) return null;
      if (!a.on && hoursFree(p) < x.hours - Math.ceil(x.hours * 0.15)) return null;
      x.manager = a.on;
    } else if (a.type === 'krysha') {
      if (a.to === p.krysha || !kryshaOk(s, p, a.to)) return null;
      if (p.krysha === 'bandit') {
        p.enemies++;
        addStat(p, 'avt', -5);
      }
      p.cash -= kryshaCost(s, p, a.to);
      p.krysha = a.to;
    } else if (a.type === 'quit') {
      if (!p.job) return null;
      p.job = null;
    } else {
      if (!p.loans.length) return null;
      for (const l of p.loans) {
        const pay = Math.min(l.left, Math.max(0, p.cash));
        l.left -= pay;
        p.cash -= pay;
      }
      p.loans = p.loans.filter((l) => l.left > 1);
    }
    return { state: s, events: ev };
  }

  if (a.type === 'buh') {
    const b = s.phase === 'buh' ? s.books?.find((x) => x.seat === seat && x.ans == null) : undefined;
    if (!b || !Number.isFinite(a.sum)) return null;
    b.ans = Math.round(a.sum);
    if (s.books!.every((x) => x.ans != null)) {
      for (const x of s.books!) audit(s, P(s, x.seat), x, ev);
      s.books = null;
      periods(s, ev, rng, true);
    }
    return { state: s, events: ev };
  }

  if (a.type === 'roll') {
    if (!mine || s.phase !== 'roll') return null;
    const d = 1 + rng.int(6);
    s.roll = d;
    s.target = Math.min(p.pos + d, SEG_CELLS + 1);
    s.phase = 'move';
    ev.push({ t: 'roll', seat, d });
    return { state: s, events: ev };
  }

  if (a.type === 'move') {
    if (!mine || s.phase !== 'move' || s.target == null) return null;
    p.pos = s.target;
    s.roll = s.target = null;
    const cell = s.cells[p.pos - 1];
    ev.push({ t: 'move', seat, cell });
    if (cell === 'period') {
      // всё для клуба готово — купить можно и в конце квартала, не дожидаясь «Выходного»
      if (clubReady(s, p)) {
        s.ask = { seat: p.seat, cell, title: 'Лондон ждёт', text: 'Всё готово: деньги, имя, связи, язык. Лондонские юристы ждут звонка.', choices: [{ label: 'Купить «Лондон Юнайтед»', ok: true, buy: 'club' }, { label: 'Ещё не время', ok: true }] };
        s.phase = 'choose';
        return { state: s, events: ev };
      }
      next(s, ev, rng);
      return { state: s, events: ev };
    }
    if (cell === 'rest' && p.skills.bazar) addStat(p, 'svyazi', p.skills.bazar);
    s.ask = (cell === 'deal' && dealAsk(s, p, rng)) || cardAsk(s, p, cell === 'deal' ? 'news' : cell, rng);
    s.phase = 'choose';
    return { state: s, events: ev };
  }

  if (a.type === 'choose') {
    const ask = s.ask;
    if (s.phase !== 'choose' || !ask || ask.seat !== seat) return null;
    const ch = ask.choices[a.i];
    if (!ch || !ch.ok) return null;
    ev.push({ t: 'pick', seat, title: ask.title, label: ch.label, dark: ch.dark });
    if (ch.buy === 'club') {
      p.cash -= CLUB_PRICE;
      p.club = true;
      p.ending = 'club';
      ev.push({ t: 'club', seat });
      s.ask = null;
      finish(s, ev);
      return { state: s, events: ev };
    }
    if (ch.buy === 'auction' && ask.deals && ch.di != null) {
      const o = ask.deals[ch.di];
      const fee = round(o.price * 0.1);
      ev.push({ t: 'auction', seat, name: o.name, fee });
      const n = s.players.length;
      const at = s.players.indexOf(p);
      const rest = Array.from({ length: n - 1 }, (_, k) => s.players[(at + 1 + k) % n]).filter((q) => q.out === 0).map((q) => q.seat);
      s.ask = null;
      if (bid(s, { ...o, fee }, seat, rest, ev)) return { state: s, events: ev };
      next(s, ev, rng);
      return { state: s, events: ev };
    }
    if (ask.auction) {
      const o = ask.deals![0];
      s.ask = null;
      if (ch.buy === 'deal') {
        const seller = P(s, ask.auction.seller);
        p.cash -= o.fee!;
        seller.cash += o.fee!;
        buy(s, p, o, ev);
        ev.push({ t: 'resold', seat, from: seller.seat, name: o.name, fee: o.fee! });
      } else if (bid(s, o, ask.auction.seller, ask.auction.rest, ev)) return { state: s, events: ev };
      next(s, ev, rng);
      return { state: s, events: ev };
    }
    if (ch.buy === 'deal' && ask.deals && ch.di != null) buy(s, p, ask.deals[ch.di], ev);
    if (ch.fx) {
      applyFx(s, p, ch.fx, rng, ev);
      if (ch.risk) {
        const sk = ch.risk.skill ? p.skills[ch.risk.skill] : 0;
        if (rng.next() < Math.max(0.05, ch.risk.p - 0.08 * sk)) {
          applyFx(s, p, ch.risk.fx, rng, ev);
          ev.push({ t: 'risk', seat, text: ch.risk.text });
        }
      }
    }
    s.ask = null;
    next(s, ev, rng);
    return { state: s, events: ev };
  }
  return null;
}

// ---------------------------------------------------------------- соперники (сеть)
// общая ниша, где у соперника цены ещё не на дне
const shared = (p: Player, q: Player) => p.assets.find((a) => a.kind === 'biz' && q.assets.some((b) => b.id === a.id && b.mul > 0.65));
export const rivalCost = (s: State, p: Player, k: Rival) => round(({ demping: 1, peremanit: 3, naezd: 1, donos: 0.5 } as const)[k] * unitOf(s, p));

/** Можно ли пойти против соперника — раз за отрезок, со своими условиями; null — можно. */
export function rivalWhy(s: State, p: Player, q: Player, k: Rival): string | null {
  if (p === q) return 'это вы';
  if (p.rivalM === s.m) return 'уже было в этом отрезке';
  if (p.cash < rivalCost(s, p, k)) return 'не хватает денег';
  if (k === 'demping' && !shared(p, q)) return 'нет общей ниши';
  if (k === 'peremanit' && !q.assets.some((a) => a.manager)) return 'нет управляющих';
  if (k === 'naezd' && p.krysha !== 'bandit') return 'нужна братва';
  return null;
}

/** Ход против соперника: демпинг бьёт по общей нише обоих, переманивание — по его часам, наезд и донос — тёмные, с последствиями для себя. */
function rival(s: State, p: Player, q: Player, k: Rival, rng: Rng, ev: Event[]) {
  p.rivalM = s.m;
  p.cash -= rivalCost(s, p, k);
  let ok = true;
  if (k === 'demping') {
    const mine = shared(p, q)!;
    for (const b of q.assets) if (b.id === mine.id) b.mul *= 0.8 + 0.03 * q.skills.trade;
    mine.mul *= 0.95;
    addStat(p, 'stress', 3);
  } else if (k === 'peremanit') {
    const b = [...q.assets].filter((a) => a.manager).sort((x, y) => y.income - x.income)[0];
    b.manager = false;
    addStat(q, 'stress', 6);
    p.incomeBoost = Math.min(2, p.incomeBoost * 1.03);
  } else if (k === 'naezd') {
    // без крыши соперник почти беззащитен; братва слабеет к двухтысячному
    ok = rng.next() < (q.krysha === 'none' ? 0.8 : 0.35) * (s.m > 147 ? 0.6 : 1) + 0.04 * p.skills.sila;
    p.enemies++;
    if (ok) {
      const big = [...q.assets].filter((a) => a.kind === 'biz').sort((x, y) => y.income - x.income)[0];
      q.cash -= 2 * (big ? assetIncome(s, q, big) : unitOf(s, q));
      addStat(q, 'stress', 8);
      addStat(q, 'mood', -5);
      addStat(p, 'avt', 4);
      addStat(p, 'heat', 6);
    } else {
      addStat(p, 'avt', -3);
      addStat(p, 'heat', 4);
    }
    addStat(p, 'sovest', -8);
  } else {
    addStat(q, 'heat', 15 + (q.assets.some((a) => dealById(a.id)?.heat) ? 10 : 0));
    addStat(p, 'sovest', -10);
    addStat(p, 'name', -3);
    // стукача вычисляют
    if (rng.next() < 0.3) {
      ok = false;
      addStat(p, 'name', -8);
      addStat(p, 'avt', -6);
      p.enemies++;
    }
  }
  ev.push({ t: 'rival', seat: p.seat, target: q.seat, kind: k, ok });
}

/** Торги: право на сделку предлагается по кругу тому, кто может её взять (с наценкой). Никто — сделка уходит. */
function bid(s: State, o: Offer, seller: number, rest: number[], ev: Event[]): boolean {
  const queue = [...rest];
  while (queue.length) {
    const q = P(s, queue.shift()!);
    const offer: Offer = { ...o, mgr: false, loan: 0 };
    const ch = offerChoice(s, q, offer, 0, o.fee!);
    if (!ch.ok) continue;
    const how = ch.label.split(' — ')[1];
    ch.label = `Купить право за ${money(o.fee!)}${how ? ` — ${how}` : ''}`;
    s.ask = {
      seat: q.seat, cell: 'deal', title: 'Торги', text: `Право на «${o.name}» выставлено с наценкой ${money(o.fee!)} — она уходит продавцу.`,
      deals: [offer], choices: [ch, { label: 'Мимо', ok: true, buy: 'pass' }], auction: { seller, rest: queue },
    };
    s.phase = 'choose';
    return true;
  }
  ev.push({ t: 'unsold', name: o.name });
  return false;
}

/** «Бухгалтерия»: статьи за месяц — зарплата, доход каждого дела, жизнь, доля крыши, кредиты, содержание. */
export function bookLines(s: State, p: Player): BookLine[] {
  const L: BookLine[] = [];
  if (p.job) L.push({ label: `Зарплата: ${p.job.name}`, sum: p.job.salary });
  for (const a of p.assets) if (a.kind !== 'paper') L.push({ label: a.name, sum: round(assetIncome(s, p, a)) });
  const biz = p.assets.reduce((t, a) => t + assetIncome(s, p, a), 0);
  L.push({ label: 'Жизнь: еда, одежда, квартира', sum: -round(25 + 0.12 * (biz + (p.job?.salary ?? 0))) });
  const dan = round(biz * ({ none: 0, bandit: 0.2, police: 0.25, own: 0.1 } as Record<Krysha, number>)[p.krysha]);
  if (dan) L.push({ label: p.krysha === 'own' ? 'Охрана' : 'Крыше', sum: -dan });
  const loans = round(p.loans.reduce((t, l) => t + l.pay, 0));
  if (loans) L.push({ label: 'Кредиты', sum: -loans });
  if (p.upkeep) L.push({ label: 'Содержание: машина, дача, привычки', sum: -round(p.upkeep) });
  return L;
}
export const bookSum = (b: { len: number; lines: BookLine[] }) => b.len * b.lines.reduce((t, l) => t + l.sum, 0);

/** Проверка разноски: сошлось (±5 %) — порядок в бумагах, органы спокойнее, с опытом растёт «Счёт»; не сошлось — налоговая заметила. */
function audit(s: State, p: Player, b: Books, ev: Event[]) {
  const sum = bookSum(b);
  const ok = Math.abs(b.ans! - sum) <= Math.max(20, Math.abs(sum) * 0.05);
  if (ok) {
    addStat(p, 'heat', -2);
    p.books = (p.books ?? 0) + 1;
    if (p.books % 4 === 0) p.skills.schet = clamp(p.skills.schet + 1, 0, SKILL_MAX);
  } else {
    addStat(p, 'heat', 4);
    addStat(p, 'stress', 3);
  }
  ev.push({ t: 'buh', seat: p.seat, ok, sum, ans: b.ans! });
}

function buy(s: State, p: Player, o: Offer, ev: Event[]) {
  if (o.loan > 0) {
    const rate = rateOf(s.m);
    p.loans.push({ left: o.loan, rate, pay: o.loan * (rate + 1 / 12) });
    p.cash += o.loan;
  }
  p.cash -= o.price;
  p.assets.push({ uid: s.uid++, id: o.id, name: o.name, kind: o.kind, value: o.price, income: o.income, hours: o.hours, manager: o.mgr, mul: 1 });
  ev.push({ t: 'buy', seat: p.seat, name: o.name, sum: o.price });
}

/** Следующий ход: кто ещё не дошёл до конца отрезка; дошли все — «Новый квартал». */
function next(s: State, ev: Event[], rng: Rng) {
  s.phase = 'roll';
  const n = s.players.length;
  for (let k = 1; k <= n; k++) {
    const i = (s.turn + k) % n;
    if (s.players[i].pos <= SEG_CELLS) {
      s.turn = i;
      return;
    }
  }
  periods(s, ev, rng);
}

/** Конец отрезка: «Бухгалтерия» (если включена), «Новый квартал» — и так, пока кто-нибудь не выйдет на дорогу. */
function periods(s: State, ev: Event[], rng: Rng, booked = false) {
  const n = s.players.length;
  for (let guard = 0; guard < 400; guard++) {
    if (s.opts.buh && !booked) {
      s.phase = 'buh';
      s.books = s.players.map((p) => ({ seat: p.seat, len: s.len, lines: bookLines(s, p), ans: null }));
      return;
    }
    booked = false;
    s.phase = 'roll';
    period(s, ev, rng);
    if ((s.phase as State['phase']) === 'over') return;
    s.first = (s.first + 1) % n;
    for (let k = 0; k < n; k++) {
      const i = (s.first + k) % n;
      if (s.players[i].pos <= SEG_CELLS) {
        s.turn = i;
        return;
      }
    }
  }
}

// ---------------------------------------------------------------- «Новый квартал»
function period(s: State, ev: Event[], rng: Rng) {
  const from = s.m;
  for (let k = 0; k < s.len; k++) {
    const m = from + k;
    for (const p of s.players) month(s, p, m);
  }
  s.m = from + s.len;
  ev.push({ t: 'period', m: s.m, len: s.len });
  for (const h of HISTORY) if (h.m > from && h.m <= s.m && !s.fired.includes(h.id)) history(s, h, ev);
  for (const p of s.players) afterPeriod(s, p, ev, rng);
  if (s.m > LAST) {
    finish(s, ev);
    return;
  }
  s.len = segMonths(s.m);
  s.cells = makeCells(s.m, rng);
  for (const p of s.players) p.pos = p.out > 0 ? SEG_CELLS + 1 : 0;
}

function month(s: State, p: Player, m: number) {
  const inc = (p.job?.salary ?? 0) + p.assets.reduce((t, a) => t + assetIncome(s, p, a, m), 0);
  p.cash += inc - expenses(s, p);
  // вклад до востребования: свободные деньги в банке работают (до дефолта)
  if (p.cash > 0) p.cash *= 1 + ({ soviet: 0.003, wild: 0.01, late: 0.012, new: 0.006 } as const)[eraOf(m)];
  for (const l of p.loans) l.left = l.left * (1 + l.rate) - l.pay;
  p.loans = p.loans.filter((l) => l.left > 1);
  for (const a of p.assets) {
    const d = dealById(a.id);
    if (a.kind === 'paper' && d?.grow) a.value *= 1 + d.grow;
    if (d?.heat) addStat(p, 'heat', d.heat / 3);
  }
  if (p.out > 0) {
    p.out--;
    if (p.out === 0) p.outKind = null;
  }
}

function history(s: State, h: (typeof HISTORY)[number], ev: Event[]) {
  s.fired.push(h.id);
  ev.push({ t: 'hist', id: h.id, title: h.title, text: h.text });
  if (h.crisis) {
    s.crisisMul = h.crisis.mul;
    s.crisisUntil = s.m + h.crisis.months;
  }
  for (const p of s.players) {
    const ready = p.prep.includes(h.id);
    if (h.loss && !ready && p.cash > 0) p.cash *= 1 - h.loss;
    if (h.fx) applyFx(s, p, h.fx, { next: () => 0.5, int: () => 0, getState: () => 0 }, ev);
    if (h.bandit && p.krysha === 'bandit') applyFx(s, p, h.bandit, { next: () => 0.5, int: () => 0, getState: () => 0 }, ev);
    if (h.id === 'vybory') addStat(p, 'svyazi', ready ? 15 : -5);
    // смена власти: старые покровители сняты — треть связей (ГКЧП, обкомы) или пятая часть (новая власть) сгорает
    if (h.id === 'gkchp' || h.id === 'ravno') p.stats.svyazi = Math.round(p.stats.svyazi * (h.id === 'gkchp' ? 0.65 : 0.8));
    if (h.id === 'default') for (const a of p.assets) if (a.id === 'bank') a.mul *= ready ? 0.6 : 0.25;
  }
  // обвалы бумаг: МММ и ГКО сгорают, ваучеры обращаются в деньги
  for (const p of s.players) {
    for (const a of p.assets) {
      const d = dealById(a.id);
      if (d?.dies && d.dies <= s.m) {
        if (d.id === 'vauchery') p.cash += a.value;
        a.value = 0;
      }
    }
    p.assets = p.assets.filter((a) => !(a.kind === 'paper' && a.value === 0));
  }
}

function afterPeriod(s: State, p: Player, ev: Event[], rng: Rng) {
  // часы: перегрузка бьёт по здоровью, настроению и доходу своих дел
  p.over = hoursUsed(p) > hoursAvail(p);
  if (p.over) {
    addStat(p, 'stress', 10);
    addStat(p, 'health', -4);
    addStat(p, 'mood', -4);
  }
  p.study = 0;
  // кто на виду — обрастает связями
  const t = tier(p);
  if (t >= 3 && s.m % 6 < s.len) addStat(p, 'svyazi', t >= 5 ? 2 : 1);
  // связи забываются: раз в квартал уходит часть — чем их больше, тем быстрее; их надо поддерживать (баня, охота, Москва)
  if (p.stats.svyazi > 30 && s.m % 3 < s.len) addStat(p, 'svyazi', -(1 + Math.floor((p.stats.svyazi - 30) / 30)));
  // дрейф: стресс спадает, настроение к нулю, совесть давит
  addStat(p, 'stress', -5 + (p.stats.sovest < 30 ? 6 : 0));
  addStat(p, 'mood', p.stats.mood > 0 ? -2 : 2);
  if (p.stats.stress > 70) addStat(p, 'health', -3);
  if (p.stats.heat > 0) addStat(p, 'heat', p.krysha === 'police' || p.krysha === 'own' ? -5 : -3);
  // после двухтысячного бандитская крыша — обуза
  if (p.krysha === 'bandit' && s.m > 147) addStat(p, 'heat', 3);
  // запой: настроение на дне — квартал вылетает
  if (p.stats.mood <= -30 && p.out === 0) {
    setOut(s, p, 'hosp', 1, ev);
    addStat(p, 'health', -8);
    p.stats.mood = -10;
    fall(s, p, 'zapoi', ev);
  }
  // посадка: внимание органов на пределе
  if (p.stats.heat >= 90 && p.outKind !== 'jail' && rng.next() < (p.stats.heat - 75) / 40) {
    const months = Math.max(3, Math.round(24 - p.stats.svyazi / 5 - p.skills.bazar * 2));
    setOut(s, p, 'jail', months, ev);
    fall(s, p, 'jail', ev);
    p.stats.heat = 40;
    addStat(p, 'avt', 10);
    addStat(p, 'blizkie', -15);
    addStat(p, 'health', -10);
  }
  // долги: кредит сам, распродажа, разорение
  if (p.cash < 0) {
    const lim = loanLimit(p);
    if (p.stats.name >= 10 && lim >= -p.cash) {
      const need = -p.cash;
      const rate = rateOf(s.m);
      p.loans.push({ left: need, rate, pay: need * (rate + 1 / 12) });
      p.cash = 0;
    } else {
      const order = [...p.assets].sort((a, b) => ({ paper: 0, estate: 1, biz: 2 })[a.kind] - ({ paper: 0, estate: 1, biz: 2 })[b.kind]);
      for (const a of order) {
        if (p.cash >= 0) break;
        p.cash += a.value * (a.kind === 'paper' ? 1 : a.kind === 'estate' ? 0.75 : 0.5);
        p.assets = p.assets.filter((x) => x !== a);
        ev.push({ t: 'sell', seat: p.seat, name: a.name, sum: a.value });
      }
      if (p.cash < 0) {
        // Разорение. «Падал, но поднимался»: долги прощены, свои дают на подняться
        p.assets = [];
        p.loans = [];
        p.upkeep = 0;
        p.cash = p.stats.blizkie >= 40 ? 300 : 80;
        if (!p.job) p.job = { name: 'на подхвате у старого знакомого', salary: 120, hours: 100 };
        addStat(p, 'name', -8);
        addStat(p, 'mood', -15);
        fall(s, p, 'razor', ev);
      }
    }
  }
  p.cash = round(p.cash);
}

// ---------------------------------------------------------------- финал
export function endingOf(s: State, p: Player): Ending {
  if (p.club) return 'club';
  const w = marketWorth(s, p);
  if (w >= 3e7) return p.stats.sovest < 25 || p.stats.blizkie < 25 ? 'soulless' : 'rich';
  if (p.stats.sovest >= 60 && p.stats.name >= 40 && w < 3e6) return 'honest';
  return 'king';
}

function finish(s: State, ev: Event[]) {
  s.phase = 'over';
  s.ask = null;
  for (const p of s.players) p.ending = endingOf(s, p);
  ev.push({ t: 'over' });
}

// ---------------------------------------------------------------- что видит игрок
export interface PlayerView {
  seat: number;
  hero: string;
  cash: number;
  worth: number;
  tier: number;
  pos: number;
  out: number;
  outKind: Player['outKind'];
  krysha: Krysha;
  stats: Partial<Record<Stat, number>>;
  skills: Record<Skill, number>;
  assets: Asset[];
  debt: number;
  falls: Fall[];
  dreams: string[];
  club: boolean;
  ending: Ending | null;
  enemies: number;
}
export interface MyView {
  loans: Loan[];
  income: number;
  expenses: number;
  hours: { avail: number; used: number };
  club: { id: string; label: string; ok: boolean }[];
  /** Намёки на скрытое: внимание органов и совесть. */
  heatHint: string;
  sovestHint: string;
  prep: string[];
  advisor: boolean;
  insurance: boolean;
  upkeep: number;
  over: boolean;
  job: Player['job'];
  loanLimit: number;
  /** Что можно сделать против каждого соперника (и почему нельзя). */
  rivals: { seat: number; acts: { kind: Rival; why: string | null; cost: number }[] }[];
}
export interface View {
  me: number | null;
  m: number;
  len: number;
  cells: Cell[];
  turn: number;
  phase: State['phase'];
  roll: number | null;
  target: number | null;
  ask: Ask | null;
  players: PlayerView[];
  my: MyView | null;
  crisis: boolean;
  diff: number;
  buh: boolean;
  fired: string[];
  /** «Бухгалтерия» своих мест (чужие статьи не видны) и кто ещё не сдал. */
  books: Books[];
  booksWait: number[];
}

const hint = (v: number, words: string[]) => words[Math.min(words.length - 1, Math.floor(v / (101 / words.length)))];

export function view(s: State, seats: number[] | 'all'): View {
  const me = seats === 'all' ? null : (seats.find((x) => s.players.some((p) => p.seat === x)) ?? null);
  const players = s.players.map((p): PlayerView => {
    const stats: Partial<Record<Stat, number>> = { ...p.stats };
    if (seats !== 'all') {
      delete stats.heat;
      delete stats.sovest;
    }
    return {
      seat: p.seat, hero: p.hero, cash: round(p.cash), worth: round(marketWorth(s, p)), tier: tier(p), pos: p.pos, out: p.out, outKind: p.outKind, krysha: p.krysha,
      stats, skills: { ...p.skills }, assets: clone(p.assets), debt: round(debt(p)), falls: clone(p.falls), dreams: [...p.dreams], club: p.club, ending: p.ending, enemies: p.enemies,
    };
  });
  const mp = me == null ? null : P(s, me);
  const my: MyView | null = mp
    ? {
        loans: clone(mp.loans), income: round(income(s, mp)), expenses: round(expenses(s, mp)), hours: { avail: hoursAvail(mp), used: hoursUsed(mp) },
        club: clubCheck(s, mp), heatHint: hint(mp.stats.heat, ['тихо', 'присматриваются', 'под колпаком', 'вот-вот возьмут']),
        sovestHint: hint(mp.stats.sovest, ['спит плохо', 'неспокойно', 'нормально', 'спит спокойно']), prep: [...mp.prep], advisor: mp.advisor, insurance: mp.insurance,
        upkeep: round(mp.upkeep), over: mp.over, job: mp.job, loanLimit: round(loanLimit(mp)),
        rivals: s.players
          .filter((q) => q !== mp)
          .map((q) => ({ seat: q.seat, acts: (Object.keys(RIVAL_NAME) as Rival[]).map((kind) => ({ kind, why: rivalWhy(s, mp, q, kind), cost: rivalCost(s, mp, kind) })) })),
      }
    : null;
  return {
    me, m: s.m, len: s.len, cells: [...s.cells], turn: s.players[s.turn].seat, phase: s.phase, roll: s.roll, target: s.target, ask: clone(s.ask), players, my,
    crisis: inCrisis(s.m) || s.m < s.crisisUntil, diff: s.opts.diff, buh: s.opts.buh, fired: [...s.fired],
    books: clone((s.books ?? []).filter((b) => seats === 'all' || seats.includes(b.seat))),
    booksWait: (s.books ?? []).filter((b) => b.ans == null).map((b) => b.seat),
  };
}
