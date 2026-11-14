/* «Коммерсы 2.0»: правила второго сезона поверх общего движка — клуб (акт I), крах (акт II), «Цифра» (акт III):
 * аудитория и монетизация IT-дел, хайп секторов, стартапы, биткоин, возраст и здоровье, болезнь 2021-го, «Тындекс» и концовки.
 * Движок зовёт эти функции только при opts.season === 2 — первый сезон их не видит. */
import type { Rng } from '../../core/types';
import { applyLegacy } from './legacy';
import { SKILL_MAX, type CardT, type Fx, type Stat } from './data';
import {
  BORN, BTC_BIG, BTC_FROM, BTC_SMALL, CLUB_NAME, CLUB_RANGE, CLUB_START, COVID_UP, CRASH_FROM, ENDINGS2, ISLAND_NEED, IT_FROM, SECTOR_NAME, STAGES, STAGE_MUL,
  STARTUPS, START_2017, STORY, SURVIVE, TYNDEX, TYNDEX_FROM, TYNDEX_NEED, TYNDEX_TO, btcPrice, clubPower, clubValue, hype, type ClubStat, type Ending2, type Sector,
} from './s2data';
import {
  Z, addStat, assetIncome, assetValue, fall, hoursFree, marketWorth, money, round, setOut, tier, unitOf,
  type Ask, type AskChoice, type Asset, type Event, type Player, type State,
} from './engine';

export interface Club2 extends Record<ClubStat, number> {
  pts: number;
  played: number;
  place: number;
  trophies: string[];
}
export interface Venture {
  uid: number;
  name: string;
  stage: number;
  invested: number;
  /** Пацаны со двора: почти всегда сгорает, изредка — ×50. */
  pacany?: boolean;
}
export interface Btc {
  amount: number;
  where: 'exchange' | 'flash';
  value: number;
}

/** Удар болезни 2021-го до поправок (возраст, стресс, инфаркты, запас) — §10.1: выжил ~50/75/90 %. */
const ILL_BASE = 31;
/** Пресет «с 2017-го»: Колян уже поднялся — капитал под короткую гонку за «Тындексом». */
const START_2017_CASH = 3e8;
/** «Сделка»: доля в стартапе — от капитала, биткоины — не больше этой суммы за раз. Вторые дороги к богатству (§10.1: ни одна > 50 %). */
const VENTURE_SHARE = 0.04;
const BTC_DEAL_MAX = 2e7;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const isS2 = (s: { opts: { season?: number } }) => s.opts.season === 2;
export const ageOf = (s: State) => Z(s).yearOf(s.m) - BORN;

// ---------------------------------------------------------------- начало
/** Старт второго сезона: 2004 — канонический Колян-хозяин клуба; 2009 — миллион; 2017 — уже поднялся. */
export function initS2(s: State) {
  for (const p of s.players) {
    p.skills.cifra ??= 0;
    p.skills.chuyka ??= 0;
    p.job = null;
    p.zapas = 0;
    p.ventures = [];
    p.cash = 1e6;
    if (s.m < IT_FROM) {
      p.cash = 3e7;
      Object.assign(p.stats, { name: 60, avt: 60, svyazi: 60, blizkie: 60, health: 75, stress: 25, sovest: 55, heat: 15 });
      Object.assign(p.skills, { english: 3, bazar: 2, trade: 2, schet: 2, sila: 1 });
      p.club2 = { ...CLUB_START, pts: 0, played: 0, place: 10, trophies: [] };
      p.crash = 0;
      for (const id of ['h-ugol', 'h-magaziny', 'h-tc']) {
        const d = Z(s).deal(id)!;
        p.assets.push({ uid: s.uid++, id, name: d.name, kind: d.kind, value: d.price, income: d.income, hours: d.hours, manager: d.kind === 'biz', mul: 1 });
      }
      // наследие первого сезона (§9): акт клуба одиночный — Колян того, кто купил клуб
      if (s.opts.legacy && s.players.length === 1) applyLegacy(p, s.opts.legacy);
    } else if (s.m >= START_2017) {
      p.cash = START_2017_CASH;
      addStat(p, 'name', 10);
      addStat(p, 'svyazi', 10);
      p.skills.cifra = Math.min(SKILL_MAX, p.skills.cifra + 2);
      p.skills.chuyka = Math.min(SKILL_MAX, p.skills.chuyka + 1);
      const d = Z(s).deal('dc')!;
      p.assets.push({ uid: s.uid++, id: d.id, name: d.name, kind: d.kind, value: d.price, income: d.income, hours: d.hours, manager: true, mul: 1 });
    }
  }
}

// ---------------------------------------------------------------- деньги
/** Сверх наличных и дел: клуб, доли в стартапах, биткоины. */
export function extraWorth(p: Player) {
  let v = 0;
  if (p.club2) v += clubValue(p.club2);
  for (const x of p.ventures ?? []) v += x.invested * (STAGE_MUL[x.stage] ?? 1);
  if (p.btc) v += p.btc.value;
  return v;
}
/** Единица трат карточки: от уровня, а у богатого — от дохода. */
export const unitS2 = (s: State, p: Player, inc: number) => Math.max(Z(s).scale[tier(s, p)], 0.5 * Math.max(0, inc));
/** IT-дело: до монетизации ест деньги, после — доход от аудитории. */
export const itIncome = (a: Asset, v: number) => (a.monet ? (v * (a.aud ?? 0)) / 100 : -0.15 * a.income);
/** Оценка IT-дела — от аудитории и моды сектора. */
export const itValue = (s: State, a: Asset) => a.value * (0.3 + (a.aud ?? 0) / 50) * hype(a.sector as Sector, s.m);

// ---------------------------------------------------------------- «Тындекс»
export function tyndexCheck(s: State, p: Player) {
  const n = TYNDEX_NEED[clamp(s.opts.diff, 0, 2)];
  const taken = s.players.some((q) => q.club && q !== p);
  return [
    { id: 'cash', label: `Деньги ${money(n.price)}`, ok: p.cash >= n.price },
    { id: 'name', label: `Имя ≥ ${n.name}`, ok: p.stats.name >= n.name },
    { id: 'svyazi', label: `Связи ≥ ${n.svyazi} или советник по GR`, ok: p.stats.svyazi >= n.svyazi || !!p.fixer },
    { id: 'cifra', label: `Цифра ${n.cifra} или технический директор`, ok: (p.skills.cifra ?? 0) >= n.cifra || !!p.cto },
    { id: 'heat', label: 'Чистый хвост', ok: p.stats.heat <= n.heat && p.outKind !== 'jail' },
    { id: 'hours', label: `Свободные часы ≥ ${n.hours}`, ok: hoursFree(p) >= n.hours },
    { id: 'date', label: 'С 2018-го по ноябрь 2021-го', ok: s.m >= TYNDEX_FROM && s.m <= TYNDEX_TO },
    { id: 'free', label: `${TYNDEX} ещё никто не купил`, ok: !taken && !p.club },
  ];
}
export const tyndexPrice = (diff: number) => TYNDEX_NEED[clamp(diff, 0, 2)].price;

// ---------------------------------------------------------------- последствия выбора
export function applyFxS2(s: State, p: Player, fx: Fx, rng: Rng, ev: Event[], unit: number) {
  if (fx.club && p.club2) {
    for (const [k, v] of Object.entries(fx.club) as [ClubStat, number][]) {
      const [a, b] = CLUB_RANGE[k];
      p.club2[k] = clamp(Math.round(p.club2[k] + v), a, b);
    }
  }
  if (fx.zapas) p.zapas = clamp((p.zapas ?? 0) + fx.zapas, 0, 30);
  if (fx.loan) {
    const sum = fx.loan * unit;
    const rate = Z(s).loanRate[Z(s).eraOf(s.m)];
    p.loans.push({ left: sum, rate, pay: sum * (rate + 1 / 24) });
    p.cash += sum;
  }
  if (fx.cto) p.cto = true;
  if (fx.crash) p.crash = (p.crash ?? 0) + fx.crash;
  if (fx.venture) for (let i = 0; i < fx.venture; i++) addVenture(s, p, rng, ev, round(Math.max(unit * 2, marketWorth(s, p) * 0.01)), fx.venture === 1 && i === 0 && !!fx.stats?.avt);
  if (fx.btc) buyBtc(s, p, Math.min(BTC_SMALL, Math.max(0, p.cash)), ev);
  if (fx.btcLose && p.btc && p.btc.where === 'flash') {
    p.btc.amount = 0;
    p.btc.value = 0;
  }
}

export function addVenture(s: State, p: Player, rng: Rng, ev: Event[], sum: number, pacany = false) {
  if (sum <= 0 || p.cash < sum) return;
  const name = STARTUPS[rng.int(STARTUPS.length)];
  p.cash -= sum;
  (p.ventures ??= []).push({ uid: s.uid++, name, stage: 0, invested: sum, ...(pacany ? { pacany } : {}) });
  ev.push({ t: 'venture', seat: p.seat, name, stage: 0, ok: true, sum });
}

export function buyBtc(s: State, p: Player, sum: number, ev: Event[]) {
  if (sum <= 0) return;
  const price = btcPrice(s.m);
  p.btc ??= { amount: 0, where: 'exchange', value: 0 };
  p.btc.amount += sum / price;
  p.btc.value = p.btc.amount * price;
  p.cash -= sum;
  ev.push({ t: 'btc', seat: p.seat, buy: true, sum: round(sum), price });
}
/** Обналичить: крупную сумму без связей и чистого хвоста — с потерей (посредники). */
export function sellBtc(s: State, p: Player, ev: Event[]) {
  if (!p.btc || p.btc.amount <= 0) return false;
  const price = btcPrice(s.m);
  let sum = p.btc.amount * price;
  if (sum > 5e6 && (p.stats.svyazi < 40 || p.stats.heat > 30)) sum *= 0.85;
  // очень крупную сумму без больших связей обналичивают посредники — дорого
  if (sum > 5e7 && p.stats.svyazi < 60) sum *= 0.7;
  p.cash += sum;
  p.btc = { amount: 0, where: p.btc.where, value: 0 };
  ev.push({ t: 'btc', seat: p.seat, buy: false, sum: round(sum), price });
  return true;
}

// ---------------------------------------------------------------- клетки
/** Матч (акт I): тактика перед игрой, потом бросок против силы соперника. */
const OPP: { from: number[]; title: string; power: number; prize: number }[] = [
  { from: [8, 9, 10, 11], title: 'Лига чемпионов: группа', power: 58, prize: 2e6 },
  { from: [1], title: 'Лига чемпионов: 1/8 финала', power: 64, prize: 4e6 },
  { from: [2, 3], title: 'Лига чемпионов: 1/4 финала', power: 68, prize: 5e6 },
  { from: [4], title: 'Лига чемпионов: полуфинал', power: 72, prize: 7e6 },
  { from: [0, 5, 6, 7], title: 'Дерби с «Северным Лондоном»', power: 60, prize: 1e6 },
];
const TACTIC = [
  { label: 'Атака', mod: 4, hint: 'шанс выше, но можно пропустить на контратаке' },
  { label: 'Держать счёт', mod: 1, hint: 'осторожно и надёжно' },
  { label: 'Автобус в штрафной', mod: -3, hint: 'фанаты не любят, зато дух цел' },
  { label: 'Договориться с судьёй', mod: 12, hint: 'шанс намного выше; совесть и органы, риск скандала' },
];
const oppOf = (s: State) => OPP.find((o) => o.from.includes(Z(s).monthOf(s.m))) ?? OPP[4];
export function matchAsk(s: State, p: Player): Ask | null {
  const c = p.club2;
  if (!c) return null;
  const o = oppOf(s);
  const pw = Math.round(clubPower(c));
  const choices: AskChoice[] = TACTIC.map((t, i) => ({ label: t.label, ok: true, tac: i, dark: i === 3, hint: [t.hint, `сила ${pw} против ${o.power}`] }));
  return { seat: p.seat, cell: 'match', title: o.title, text: `«${CLUB_NAME}» выходит на поле. Сила состава — ${pw}, у соперника — ${o.power}.`, choices };
}
export function playMatch(s: State, p: Player, tac: number, rng: Rng, ev: Event[]) {
  const c = p.club2!;
  const o = oppOf(s);
  const t = TACTIC[tac] ?? TACTIC[1];
  const x = (clubPower(c) + t.mod - o.power) / 8;
  const win = rng.next() < 1 / (1 + Math.exp(-x));
  const a = 1 + rng.int(3);
  const score = win ? `${a}:${rng.int(a)}` : `${rng.int(2)}:${1 + rng.int(2)}`;
  const big = o.power >= 64;
  if (win) {
    c.slava += big ? 5 : 3;
    c.fans = clamp(c.fans + 2, 0, 100);
    c.duh = clamp(c.duh + 4, -50, 50);
    p.cash += o.prize;
  } else {
    c.duh = clamp(c.duh - 4, -50, 50);
    c.fans = clamp(c.fans - 1, 0, 100);
  }
  if (tac === 2) c.fans = clamp(c.fans - 2, 0, 100);
  if (tac === 3) {
    addStat(p, 'sovest', -8);
    addStat(p, 'heat', 6);
    if (rng.next() < 0.2) {
      c.slava = Math.max(0, c.slava - 10);
      addStat(p, 'name', -8);
      ev.push({ t: 'risk', seat: p.seat, text: 'Газеты раскопали договорной матч.' });
    }
  }
  ev.push({ t: 'match', seat: p.seat, title: o.title, score, win });
}

/** Хайп (акт III): мода на сектор — зайти, выйти или переждать. Тренд виден только по прошлому. */
export function hypeAsk(s: State, p: Player, rng: Rng): Ask {
  const live = (Object.keys(SECTOR_NAME) as Sector[]).filter((x) => Z(s).deals.some((d) => d.sector === x && d.from <= s.m && !d.home));
  const bag: Sector[] = [];
  for (const x of live) for (let i = 0; i < 1 + Math.round(Math.abs(hype(x, s.m) - hype(x, s.m - 3)) * 10); i++) bag.push(x);
  const sec = bag[rng.int(bag.length)];
  const h = hype(sec, s.m);
  const was = hype(sec, s.m - 3);
  const trend = h > was + 0.02 ? 'мода растёт' : h < was - 0.02 ? 'мода спадает' : 'мода держится';
  const sum = round(Math.max(unitOf(s, p) * 5, p.cash * 0.25));
  const mine = p.assets.filter((a) => a.sector === sec);
  const out = mine.reduce((t, a) => t + assetValue(s, p, a), 0);
  const choices: AskChoice[] = [
    { label: `Зайти: ${money(sum)} в фонд «${SECTOR_NAME[sec]}»`, ok: p.cash >= sum, why: p.cash >= sum ? undefined : 'не хватает денег', buy: 'hype', sector: sec, sum, hint: [`цена ×${h}, ${trend}`] },
    { label: `Выйти из «${SECTOR_NAME[sec]}»${out ? ` — ${money(out)}` : ''}`, ok: mine.length > 0, why: mine.length ? undefined : 'нечего продавать', buy: 'hypeOut', sector: sec, sum: round(out) },
    { label: 'Переждать', ok: true },
  ];
  return { seat: p.seat, cell: 'hype', title: `Хайп: ${SECTOR_NAME[sec]}`, text: `Все вкладываются в ${SECTOR_NAME[sec]}: цена ×${h} — ${trend}.`, choices };
}
export function hypeIn(s: State, p: Player, sec: Sector, sum: number, ev: Event[]) {
  if (p.cash < sum) return;
  p.cash -= sum;
  const name = `Фонд «${SECTOR_NAME[sec]}»`;
  p.assets.push({ uid: s.uid++, id: `fund-${sec}`, name, kind: 'paper', value: sum, income: 0, hours: 0, manager: false, mul: 1, sector: sec, h0: hype(sec, s.m), basis: sum });
  ev.push({ t: 'buy', seat: p.seat, name, sum });
}
export function hypeOut(s: State, p: Player, sec: Sector, ev: Event[]) {
  for (const a of p.assets.filter((x) => x.sector === sec)) {
    const sum = assetValue(s, p, a);
    p.cash += sum;
    ev.push({ t: 'sell', seat: p.seat, name: a.name, sum });
  }
  p.assets = p.assets.filter((x) => x.sector !== sec);
}

/** «Сделка» акта III: к делам — доля в стартапе и (с 2013-го) биткоины. */
export function dealExtras(s: State, p: Player, rng: Rng, choices: AskChoice[]) {
  if (s.m < IT_FROM) return;
  const many = (p.ventures?.length ?? 0) >= 6;
  const at = choices.findIndex((c) => c.buy === 'pass');
  const add: AskChoice[] = [];
  if (rng.next() < 0.35 && !many) {
    const sum = round(Math.max(unitOf(s, p) * 2, marketWorth(s, p) * VENTURE_SHARE));
    add.push({ label: `Доля в стартапе — ${money(sum)}`, ok: p.cash >= sum, why: p.cash >= sum ? undefined : 'не хватает денег', buy: 'venture', sum, hint: ['большинство умирает, один из десяти — ×30'] });
  }
  if (s.m >= BTC_BIG && rng.next() < 0.4) {
    const sum = round(Math.min(BTC_DEAL_MAX, unitOf(s, p) * 10));
    add.push({ label: `Биткоины на ${money(sum)} (по $${btcPrice(s.m)})`, ok: p.cash >= sum, why: p.cash >= sum ? undefined : 'не хватает денег', buy: 'btc', sum });
  }
  choices.splice(at < 0 ? choices.length : at, 0, ...add);
}

/** Карточка без условий ниже: клуб нужен для клубных, флешка с биткоинами — для «Флешки». */
export const cardOkS2 = (p: Player, c: CardT) => (!c.need?.club || !!p.club2) && (!c.need?.btc || (!!p.btc && p.btc.amount > 0 && p.btc.where === 'flash'));

// ---------------------------------------------------------------- месяц и конец отрезка
export function monthS2(s: State, p: Player, m: number) {
  for (const a of p.assets) {
    if (a.aud != null && a.aud < 100) a.aud = Math.round(Math.min(100, a.aud + (a.monet ? 1.5 : 5) * Math.min(1.5, hype(a.sector as Sector, m)) + 0.5 * (p.skills.cifra ?? 0)) * 10) / 10;
    if (a.h0 && a.basis) a.value = (a.basis * hype(a.sector as Sector, m)) / a.h0;
  }
  if (p.btc) p.btc.value = p.btc.amount * btcPrice(m);
}

export function afterS2(s: State, p: Player, ev: Event[], rng: Rng) {
  const from = s.m - s.len;
  const k = s.len / 3;
  // ---- клуб: итоги тура
  const c = p.club2;
  if (c) {
    let games = 0;
    let fin = 0;
    for (let m = from; m < s.m; m++) {
      const mo = Z(s).monthOf(m);
      if (mo !== 5 && mo !== 6) games++;
      if (mo === 4) fin = Z(s).yearOf(m);
    }
    if (games) {
      const ppg = clamp(1 + (clubPower(c) - 50) / 20, 0.4, 2.7) * (0.85 + rng.next() * 0.3);
      c.pts += ppg * 4 * games;
      c.played += 4 * games;
      c.place = clamp(Math.round(20 - (c.pts / c.played - 0.7) * 11), 1, 20);
      c.duh = clamp(c.duh + (c.place <= 4 ? 3 : c.place >= 12 ? -3 : 0), -50, 50);
      c.fans = clamp(c.fans + (c.place <= 4 ? 2 : c.place >= 12 ? -2 : 0), 0, 100);
      c.sostav = clamp(c.sostav - 1, 0, 100);
    }
    if (fin) {
      // сюжет: чемпионство 2005/06 гарантировано (трофей и Славу даёт история)
      if (fin === 2006) c.place = 1;
      const won: string[] = [];
      const pw = clubPower(c);
      if (c.place === 1 && fin !== 2006) {
        won.push(`Чемпион Англии ${fin - 1}/${String(fin).slice(2)}`);
        c.slava += 20;
      }
      if (rng.next() < clamp((pw - 55) / 60, 0.03, 0.4)) {
        won.push(`Кубок Англии ${fin}`);
        c.slava += 8;
      }
      if (rng.next() < clamp((pw - 50) / 60, 0.05, 0.45)) {
        won.push(`Кубок лиги ${fin}`);
        c.slava += 5;
      }
      c.trophies.push(...won);
      ev.push({ t: 'tour', seat: p.seat, place: c.place, final: true, trophies: won });
      c.pts = 0;
      c.played = 0;
    } else if (games) ev.push({ t: 'tour', seat: p.seat, place: c.place });
  }
  // ---- дела дома без хозяина: управляющие воруют, рынок уходит
  for (const a of p.assets) if (Z(s).deal(a.id)?.home && !(a.guard! > s.m)) a.mul *= 1 - (0.03 + rng.next() * 0.03) * k;
  // ---- стартапы: бросок развития по стадии
  for (const x of [...(p.ventures ?? [])]) {
    const r = rng.next();
    const die = [0.15, 0.12, 0.09, 0.06][x.stage] * k * (x.pacany ? 1.6 : 1);
    const adv = (0.27 + 0.02 * (p.skills.cifra ?? 0) + 0.03 * (p.skills.chuyka ?? 0)) * k;
    if (r < die) {
      p.ventures = p.ventures!.filter((v) => v !== x);
      ev.push({ t: 'venture', seat: p.seat, name: x.name, stage: x.stage, ok: false });
    } else if (r < die + adv) {
      x.stage++;
      if (x.stage >= 4) {
        const r2 = rng.next();
        const mul = x.pacany ? (r2 < 0.3 ? 50 : 3) : r2 < 0.12 + 0.01 * (p.skills.chuyka ?? 0) ? 25 + rng.next() * 40 : r2 < 0.4 ? 3 + rng.next() * 3 : 1 + rng.next() * 0.6;
        const sum = round(x.invested * mul);
        p.cash += sum;
        p.ventures = p.ventures!.filter((v) => v !== x);
        ev.push({ t: 'venture', seat: p.seat, name: x.name, stage: 4, ok: true, sum });
      } else {
        // следующий раунд: довложиться — или доля размывается
        const need = round(x.invested * 0.5);
        if (p.cash >= need * 3) {
          p.cash -= need;
          x.invested += need;
        } else x.invested *= 0.6;
        ev.push({ t: 'venture', seat: p.seat, name: x.name, stage: x.stage, ok: true });
      }
    }
  }
  // ---- возраст: здоровье само убывает, после 50 — быстрее
  if (Math.floor(s.m / 12) > Math.floor(from / 12)) {
    const age = ageOf(s);
    addStat(p, 'health', -((age < 45 ? 2 : age < 50 ? 3 : 4) + (p.stats.stress > 50 ? 1 : 0)));
  }
  // ---- здоровье на нуле до 2021-го — тяжёлая больница, но не смерть
  if (p.stats.health <= 0 && p.out === 0) {
    setOut(s, p, 'hosp', 2, ev);
    p.stats.health = 12;
    fall(s, p, 'infarkt', ev);
  }
}

// ---------------------------------------------------------------- история
export function historyS2(s: State, id: string, ev: Event[]) {
  const card = STORY[id];
  for (const p of s.players) {
    const c = p.club2;
    if (card && (card.startsWith('ill') || p.crash != null)) (p.story ??= []).push(card);
    const it = p.assets.filter((a) => a.aud != null);
    if ((id === 'champ2006' || id === 'cl2008') && c) {
      const pw = clubPower(c);
      const how = id === 'champ2006' ? (pw >= 70 ? 'уверенно' : pw >= 58 ? 'в последнюю минуту' : 'чудом') : pw >= 70 ? 'уверенно' : pw >= 58 ? 'в дополнительное время' : 'по пенальти';
      const add = (id === 'champ2006' ? [25, 18, 12] : [30, 22, 15])[pw >= 70 ? 0 : pw >= 58 ? 1 : 2];
      c.slava += add;
      c.fans = clamp(c.fans + 8, 0, 100);
      c.duh = clamp(c.duh + 8, -50, 50);
      c.trophies.push(id === 'champ2006' ? 'Чемпион Англии 2005/06' : 'Лига чемпионов 2007/08');
      addStat(p, 'mood', 15);
      ev.push({ t: 'match', seat: p.seat, title: id === 'champ2006' ? 'Чемпионство' : 'Финал Лиги чемпионов', score: how, win: true });
    }
    if (id === 'tolmachevo' && p.crash != null) settleCrash(s, p, ev);
    if (id === 'kipr' && p.prep.includes('kipr') && p.cash > 0) p.cash *= 0.525;
    if (id === 'gox' && p.btc?.where === 'exchange') p.btc = { amount: 0, where: 'exchange', value: 0 };
    if (id === 'pizza' && p.btc?.amount) p.skills.chuyka = Math.min(SKILL_MAX, (p.skills.chuyka ?? 0) + 1);
    if (id === 'brexit') for (const a of p.assets) if (a.id === 'london-dom') a.value *= 0.85;
    if (id === 'dannye') for (const a of it) a.mul *= 0.95;
    if (id === 'it-nalog') for (const a of it) a.mul *= 1.05;
    if (id === 'covid' || id === 'izolyaciya') for (const a of p.assets) if (COVID_UP.includes(a.sector as Sector) && a.kind === 'biz') a.mul *= 1.12;
    if (id === 'messenger') {
      const a = [...it].sort((x, y) => y.income - x.income)[0];
      if (a) p.cash -= Math.max(0, assetIncome(s, p, a));
    }
    if (id === 'mundial' && p.trophies?.length) {
      addStat(p, 'name', 3);
      addStat(p, 'mood', 5);
    }
    if (id === 'bolezn') {
      // удар по здоровью = база − 2 × запас + возраст + стресс + падения: подготовка решает
      const infarkt = p.falls.filter((f) => f.kind === 'infarkt').length;
      const hit = Math.max(5, Math.round(ILL_BASE + Math.max(0, ageOf(s) - 50) * 2 + p.stats.stress * 0.25 + infarkt * 4 - 2 * (p.zapas ?? 0)));
      p.ill = hit;
      addStat(p, 'health', -hit);
    }
  }
}

/** Январь 2009-го: от империи остаётся $0,8–1,2 млн — по выборам краха и тому, как держал дела дома. */
function settleCrash(s: State, p: Player, ev: Event[]) {
  const home = p.assets.filter((a) => Z(s).deal(a.id)?.home);
  const biz = home.length ? home.reduce((t, a) => t + a.mul, 0) / home.length : 0.7;
  const cash = round(1e6 * clamp(1 + (p.crash ?? 0) + (biz - 0.8) * 0.5, 0.8, 1.2));
  const c = p.club2;
  if (c) {
    p.trophies = [...c.trophies];
    addStat(p, 'name', Math.min(10, Math.round(c.slava / 15)));
    addStat(p, 'avt', Math.min(10, Math.round(c.slava / 15)));
  }
  delete p.club2;
  delete p.crash;
  p.cash = cash;
  p.assets = [];
  p.loans = [];
  p.upkeep = 0;
  p.hoursBonus = 0;
  p.dreams = [];
  p.story = [];
  p.incomeBoost = 1;
  p.over = false;
  ev.push({ t: 'fx', seat: p.seat, title: 'Итог краха', label: 'Толмачёво', lines: [`осталось ${money(cash)}`] });
}

/** Сюжетная карточка в очереди — приходит вместо клетки. */
export const storyCard = (s: State, p: Player) => (p.story?.length ? Z(s).cards.find((c) => c.id === p.story![0]) : undefined);

// ---------------------------------------------------------------- финал
export const survived = (s: State, p: Player) => p.stats.health >= SURVIVE[clamp(s.opts.diff, 0, 2)];
export function endingS2(s: State, p: Player): Ending2 {
  if (!survived(s, p)) return 'dead';
  const w = marketWorth(s, p);
  const n = ISLAND_NEED[clamp(s.opts.diff, 0, 2)];
  if (p.club) return p.stats.blizkie >= n.blizkie && p.stats.avt >= n.avt && w >= n.worth ? 'island' : 'tyndex';
  if (w >= 1e8) return p.stats.blizkie < 25 ? 'lonely' : 'pension';
  return 'zatulinka';
}
export const ENDING_NAME2 = ENDINGS2;
export const stageName = (i: number) => STAGES[i] ?? '';
export const S2_STATS: Stat[] = ['health', 'mood', 'stress', 'name', 'avt', 'svyazi', 'blizkie'];
export { CRASH_FROM, BTC_FROM, IT_FROM };
