/* Покер — турниры с ботами (без DOM): Sit&Go (хедз-ап, 6, 9 игроков, «Удвоение») и многостоловые MTT на 18/45/90/180.
 * Турнир — слой поверх движка: раздачу играет engine.ts на «своём» столе (где сидит человек), а между раздачами турнир
 * поднимает уровни, считает вылеты и места, ребаи / ре-энтри / аддон, баунти (PKO), позднюю регистрацию, пересадки.
 *
 * Время. Уровни — в минутах, как в покер-румах, но часы турнира идут раздачами: раздача за столом на n игроков
 * «стоит» 15 + 5n секунд (хедз-ап ~25 с, 6-max ~45 с, 9-max ~60 с — обычный темп онлайн-стола). Так часы сами стоят,
 * пока человек думает или отошёл (против ботов — с паузой), партия воспроизводима и одинаково идёт в браузере и на сервере.
 *
 * Остальные столы MTT играются «вслепую» быстрыми ботами (simHand): блайнды и анте, кража, разыгранный банк, пуш короткого
 * стека с коллом, редкий «кулер» — с переходом фишек из рук в руки, без карт. На раздачу своего стола — по раздаче
 * на каждом другом, поэтому на пузыре все столы и так идут «рука за руку»: вылетевшие за одну раздачу делят места по стеку
 * на её начало. Это микросекунды на стол, так что Web Worker не нужен — всё синхронно, внутри apply. Столы балансируются
 * (разница не больше одного игрока, лишний стол расформировывается); стол человека не ломается — к нему пересаживают. */
import type { Options, Rng, SeatSpec } from '../../core/types';
import { deal, maxPlayers, newState, type AnteKind, type Cfg, type Event, type State } from './engine';

export type TourFmt = 'hu' | 'sng6' | 'sng9' | 'don' | 'mtt18' | 'mtt45' | 'mtt90' | 'mtt180';
export type TourSpeed = 'normal' | 'turbo' | 'hyper';
export type TourKind = 'freeze' | 'rebuy' | 'reentry' | 'pko';

export interface TPlayer {
  id: number;
  name: string;
  chips: number;
  /** 0 — в игре, иначе занятое место. */
  out: number;
  /** Сел за стол (поздняя регистрация — позже). */
  joined: boolean;
  /** Поздняя регистрация: на каком круге садится. */
  joinAt: number;
  human: boolean;
  /** Входов (с ре-энтри), ребаев, взят ли аддон. */
  entries: number;
  rebuys: number;
  addon: boolean;
  /** PKO: награда за голову сейчас и сколько уже получено наличными. */
  bounty: number;
  won: number;
  /** Приз за место (в конце). */
  prize: number;
}

export interface TTable {
  /** Свой стол (номер 0): ids[место] — игрок, −1 — пусто. Остальные — просто список игроков. */
  ids: number[];
  btn: number;
}

export interface TourState {
  id: number;
  fmt: TourFmt;
  speed: TourSpeed;
  kind: TourKind;
  late: boolean;
  buyin: number;
  /** Виртуальный банкролл: бай-ины списываются с очков игрока (poker/bankroll.ts). */
  bank: boolean;
  mtt: boolean;
  /** «Удвоение»: половина поля получает по два бай-ина. */
  don: boolean;
  start: number;
  addonChips: number;
  seatMax: number;
  field: number;
  players: TPlayer[];
  tables: TTable[];
  /** Номер уровня (с 0) и сыгранные секунды. */
  level: number;
  t: number;
  levelSec: number;
  round: number;
  pool: number;
  paid: number;
  prizes: number[];
  /** Сколько фишек выдано всего (старт, ребаи, аддоны) — сумма фишек в игре всегда равна этому. */
  chipsIn: number;
  /** Решения людей по очереди. */
  queue: { id: number; what: 'rebuy' | 'reentry' | 'addon' }[];
  /** Ребай по желанию (стек не больше стартового) — до следующей раздачи. */
  pending: number[];
  said: string[];
  /** Выбывшие, пока идёт поздняя регистрация: места им — при её закрытии (по порядку вылета). */
  early: number[];
  breakAt: number;
  done: boolean;
}

// ---------------------------------------------------------------- структуры

export const FMTS: Record<TourFmt, { label: string; n: number; mtt: boolean; don?: boolean }> = {
  hu: { label: 'Хедз-ап', n: 2, mtt: false },
  sng6: { label: '6 игроков', n: 6, mtt: false },
  sng9: { label: '9 игроков', n: 9, mtt: false },
  don: { label: '«Удвоение»', n: 6, mtt: false, don: true },
  mtt18: { label: '18 игроков', n: 18, mtt: true },
  mtt45: { label: '45 игроков', n: 45, mtt: true },
  mtt90: { label: '90 игроков', n: 90, mtt: true },
  mtt180: { label: '180 игроков', n: 180, mtt: true },
};
export const SPEEDS: Record<TourSpeed, { label: string; min: number }> = {
  normal: { label: 'Обычный', min: 10 },
  turbo: { label: 'Турбо', min: 5 },
  hyper: { label: 'Гипер', min: 3 },
};
export const KINDS: Record<TourKind, string> = { freeze: 'Фриз-аут', rebuy: 'Ребай + аддон', reentry: 'Ре-энтри', pko: 'Прогрессивный нокаут (PKO)' };

/** Большой блайнд по уровням (малый — половина). Sit&Go — от 20 при стеке 1500, MTT — от 100 при стеке 10 000. */
const SNG_BB = [20, 30, 50, 100, 150, 200, 300, 400, 600, 800, 1000, 1200, 1600, 2000, 3000, 4000, 6000, 8000, 10000, 12000, 16000, 20000];
const MTT_BB = [100, 150, 200, 250, 300, 400, 500, 600, 800, 1000, 1200, 1600, 2000, 2400, 3000, 4000, 5000, 6000, 8000, 10000, 12000, 16000, 20000, 25000, 30000, 40000, 50000, 60000, 80000, 100000];
/** С какого уровня анте: Sit&Go — с каждого (десятая часть ББ), MTT — анте большого блайнда. */
const SNG_ANTE = 4;
const MTT_ANTE = 3;
/** Ребаи и поздняя регистрация (ре-энтри) — первые столько уровней; в конце — перерыв с аддоном. */
export const REBUY_LEVELS = 6;
export const LATE_LEVELS = 6;
/** Доля призовых мест в MTT. */
const ITM = 0.15;

export const bigAt = (mtt: boolean, level: number) => {
  const list = mtt ? MTT_BB : SNG_BB;
  return level < list.length ? list[level] : list[list.length - 1] * 2 ** (level - list.length + 1);
};
export const anteAt = (mtt: boolean, level: number): AnteKind => (level >= (mtt ? MTT_ANTE : SNG_ANTE) ? (mtt ? 'bb' : 'all') : 'none');
/** Сколько анте за раздачу со всего стола (для M). */
export const anteTotal = (mtt: boolean, level: number, n: number) => {
  const k = anteAt(mtt, level);
  const big = bigAt(mtt, level);
  return k === 'bb' ? big : k === 'all' ? Math.max(1, Math.round(big / 10)) * n : 0;
};
export const startStack = (mtt: boolean, speed: TourSpeed) => (mtt ? 10000 : speed === 'hyper' ? 500 : 1500);
/** Секунд турнирного времени на раздачу за столом на n игроков. */
export const secPerHand = (n: number) => 15 + 5 * n;

/** Сколько мест платят. */
export function paidOf(fmt: TourFmt, n: number, entries: number): number {
  if (FMTS[fmt].don) return Math.max(1, Math.floor(n / 2));
  if (!FMTS[fmt].mtt) return n <= 2 ? 1 : n <= 6 ? 2 : 3;
  return Math.max(1, Math.min(n - 1, Math.ceil(entries * ITM)));
}

/** Доли призовых по местам (сумма 1). Sit&Go: 100 / 65-35 / 50-30-20; «Удвоение» — поровну; MTT — степенной закон
 * (первому ~18–50%, последнему призовому — полтора-два бай-ина), как в обычных таблицах выплат. */
export function payout(fmt: TourFmt, paid: number): number[] {
  if (FMTS[fmt].don) return Array(paid).fill(1 / paid);
  if (!FMTS[fmt].mtt) return paid === 1 ? [1] : paid === 2 ? [0.65, 0.35] : [0.5, 0.3, 0.2];
  const w = Array.from({ length: paid }, (_, i) => 1 / (i + 1) ** 0.9);
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((x) => x / sum);
}

function prizesFor(T: Pick<TourState, 'fmt' | 'pool' | 'paid'>): number[] {
  const pct = payout(T.fmt, T.paid);
  const out = pct.map((p) => Math.floor(T.pool * p));
  if (FMTS[T.fmt].don) return out;
  out[0] += T.pool - out.reduce((a, b) => a + b, 0);
  return out;
}

// ---------------------------------------------------------------- имена соперников MTT

const NAMES = [
  'Шурик', 'Толян', 'Петька', 'Ромка', 'Гоша', 'Стас', 'Валера', 'Юрка', 'Лёха', 'Витёк', 'Санёк', 'Борька', 'Тёма', 'Генка', 'Кирюха',
  'Игорёк', 'Славик', 'Пашка', 'Натаха', 'Ирка', 'Маринка', 'Олька', 'Катька', 'Юлька', 'Дашка', 'Анька', 'Верка', 'Галка', 'Люська', 'Зинка',
  'Петрович', 'Палыч', 'Кузьмич', 'Фёдорыч', 'Рыжий', 'Малой', 'Профессор', 'Штопор', 'Батон', 'Шпала', 'Чижик', 'Хмурый', 'Боцман', 'Студент',
  'Тихоня', 'Сеня', 'Макар', 'Груша', 'Кнопка', 'Ёжик',
];

// ---------------------------------------------------------------- настройка

export const isTour = (o: Options) => typeof o.tour === 'string' && o.tour in FMTS;

const pick = <T extends string>(v: unknown, list: Record<T, unknown>, d: T): T => (typeof v === 'string' && v in list ? (v as T) : d);

/** Турнир: места seats — свой стол (человек и боты); у MTT остальные игроки — за другими столами. */
export function tourSetup(seats: SeatSpec[], opts: Options, cfg0: Cfg, rng: Rng): State {
  const fmt = pick<TourFmt>(opts.tour, FMTS, 'sng6');
  const speed = pick<TourSpeed>(opts.speed, SPEEDS, 'turbo');
  const F = FMTS[fmt];
  // в Sit&Go и «Удвоении» — только фриз-аут или PKO; ребай, ре-энтри и поздняя регистрация — в MTT
  let kind = pick<TourKind>(opts.tkind, KINDS, 'freeze');
  if (!F.mtt && kind !== 'pko') kind = 'freeze';
  if (F.don) kind = 'freeze';
  const mtt = F.mtt;
  const seatMax = Math.min(seats.length, maxPlayers(cfg0.mode), 9);
  const order = seats.map((x) => x.seat).sort((a, b) => a - b).slice(0, seatMax);
  const field = mtt ? F.n : order.length;
  const start = startStack(mtt, speed);
  const buyin = Math.max(1, Math.round(Number(opts.buyin) || 100));
  const bounty0 = kind === 'pko' ? Math.floor(buyin / 2) : 0;
  const late = mtt && (!!opts.late || kind === 'reentry');
  const players: TPlayer[] = [];
  const used = new Map<string, number>();
  const nameFor = (i: number) => {
    const base = NAMES[(i * 7 + rng.int(NAMES.length)) % NAMES.length];
    const k = (used.get(base) ?? 0) + 1;
    used.set(base, k);
    return k === 1 ? base : `${base}-${k}`;
  };
  // свой стол: ids = номера мест (у ботов имя без «(бот)»)
  for (let i = 0; i < field; i++) {
    const sp = i < order.length ? seats.find((x) => x.seat === order[i])! : null;
    const name = sp ? sp.name.replace(/\s*\(бот\)$/, '') || `Игрок ${i + 1}` : nameFor(i);
    if (sp) used.set(name, 1);
    players.push({ id: i, name, chips: start, out: 0, joined: true, joinAt: 0, human: !!sp && sp.kind !== 'bot', entries: 1, rebuys: 0, addon: false, bounty: bounty0, won: 0, prize: 0 });
  }
  const levelSec = SPEEDS[speed].min * 60;
  // поздняя регистрация: треть поля (кроме своего стола) садится в первые уровни
  if (late)
    for (const p of players.slice(order.length)) {
      if (rng.next() < 0.3) {
        p.joined = false;
        p.chips = 0;
        p.joinAt = 1 + rng.int(Math.max(2, Math.floor((LATE_LEVELS * levelSec) / secPerHand(seatMax)) - 1));
      }
    }
  const tables: TTable[] = [{ ids: Array.from({ length: seatMax }, (_, k) => (k < order.length ? k : -1)), btn: 0 }];
  if (mtt) {
    const rest = players.filter((p) => p.joined && p.id >= order.length).map((p) => p.id);
    for (let i = rest.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [rest[i], rest[j]] = [rest[j], rest[i]];
    }
    const nT = Math.ceil(rest.length / seatMax);
    for (let t = 0; t < nT; t++) tables.push({ ids: [], btn: rng.int(seatMax) });
    rest.forEach((id, i) => tables[1 + (i % nT)].ids.push(id));
  }
  const joined = players.filter((p) => p.joined).length;
  const T: TourState = {
    id: 1 + rng.int(2 ** 30),
    fmt,
    speed,
    kind,
    late,
    buyin,
    bank: !!opts.bank,
    mtt,
    don: !!F.don,
    start,
    addonChips: Math.round(start * 1.5),
    seatMax,
    field,
    players,
    tables,
    level: 0,
    t: 0,
    levelSec,
    round: 0,
    pool: 0,
    paid: 0,
    prizes: [],
    chipsIn: start * joined,
    queue: [],
    pending: [],
    said: [],
    early: [],
    breakAt: 55 * 60,
    done: false,
  };
  T.pool = joined * (buyin - bounty0);
  T.paid = paidOf(fmt, field, late ? field : joined);
  T.prizes = prizesFor(T);
  const cfg: Cfg = { ...cfg0, every: 0, hands: 0, ante: 'none', stack: start, blind: bigAt(mtt, 0) };
  const s = newState(cfg, order);
  s.seats = Array.from({ length: seatMax }, (_, k) => k);
  s.chips = Array(9).fill(0);
  s.button = seatMax - 1;
  s.tour = T;
  return run(s, [], rng).state;
}

// ---------------------------------------------------------------- между раздачами

const seated = (T: TourState) => T.players.filter((p) => p.joined && !p.out);
const countAt = (tb: TTable) => tb.ids.filter((x) => x >= 0).length;
const say = (ev: Event[], text: string, kind: TourEvKind = 'info') => ev.push({ type: 'tour', kind, text });
export type TourEvKind = 'info' | 'level' | 'out' | 'move' | 'big' | 'end';

function cloneTour(T: TourState): TourState {
  return {
    ...T,
    players: T.players.map((p) => ({ ...p })),
    tables: T.tables.map((tb) => ({ ids: tb.ids.slice(), btn: tb.btn })),
    queue: T.queue.slice(),
    pending: T.pending.slice(),
    said: T.said.slice(),
    early: T.early.slice(),
  };
}

function addMoney(T: TourState) {
  T.pool += T.buyin - (T.kind === 'pko' ? Math.floor(T.buyin / 2) : 0);
}

/** Идёт поздняя регистрация (или ре-энтри). */
const lateOpen = (T: TourState) => T.late && T.level < LATE_LEVELS;

/** Места выбывших во время поздней регистрации: ниже всех оставшихся, раньше вылетел — ниже место. */
function settleEarly(T: TourState) {
  const alive = seated(T).length;
  T.early.forEach((id, i) => (T.players[id].out = alive + T.early.length - i));
  T.early = [];
}

const canRebuy = (T: TourState) => T.kind === 'rebuy' && T.level < REBUY_LEVELS;
const canReenter = (T: TourState) => T.kind === 'reentry' && T.level < LATE_LEVELS;

function rebuy(T: TourState, p: TPlayer, ev: Event[], what: 'rebuy' | 'reentry') {
  p.chips += T.start;
  T.chipsIn += T.start;
  if (what === 'rebuy') p.rebuys++;
  else p.entries++;
  addMoney(T);
  if (p.human || T.tables[0].ids.includes(p.id)) say(ev, `${p.name} — ${what === 'rebuy' ? 'ребай' : 'ре-энтри'}: снова ${T.start} фишек.`);
}

function takeAddon(T: TourState, p: TPlayer, ev: Event[]) {
  p.chips += T.addonChips;
  T.chipsIn += T.addonChips;
  p.addon = true;
  addMoney(T);
  if (p.human) say(ev, `${p.name} берёт аддон: +${T.addonChips} фишек.`);
}

function findTable(T: TourState, id: number) {
  return T.tables.findIndex((tb) => tb.ids.includes(id));
}

function removeFrom(T: TourState, id: number) {
  const i = findTable(T, id);
  if (i < 0) return;
  const tb = T.tables[i];
  if (i === 0) tb.ids[tb.ids.indexOf(id)] = -1;
  else tb.ids.splice(tb.ids.indexOf(id), 1);
}

function addTo(T: TourState, i: number, id: number) {
  const tb = T.tables[i];
  if (i === 0) tb.ids[tb.ids.indexOf(-1)] = id;
  else tb.ids.push(id);
}

/** Вылеты одной раздачи (всех столов): ребай/ре-энтри или место. Места — по стеку на начало раздачи (меньше — ниже). */
function resolveBusts(T: TourState, busted: { id: number; by: number }[], before: Map<number, number>, ev: Event[], rng: Rng) {
  const out: { id: number; by: number }[] = [];
  for (const b of busted) {
    const p = T.players[b.id];
    const what = canRebuy(T) ? 'rebuy' : canReenter(T) ? 'reentry' : null;
    if (what) {
      if (p.human) {
        T.queue.push({ id: p.id, what });
        continue;
      }
      if (rng.next() < (what === 'rebuy' ? 0.7 : 0.55)) {
        rebuy(T, p, ev, what);
        continue;
      }
    }
    out.push(b);
  }
  if (!out.length) return;
  out.sort((a, b) => (before.get(a.id) ?? 0) - (before.get(b.id) ?? 0) || b.id - a.id);
  const alive = seated(T).length;
  out.forEach((b, i) => place(T, T.players[b.id], alive - i, b.by, ev));
}

/** Игрок занял место: убрать со стола, баунти — тому, кто выбил. */
function place(T: TourState, p: TPlayer, at: number, by: number, ev: Event[]) {
  p.chips = 0;
  const mine = T.tables[0].ids.includes(p.id);
  removeFrom(T, p.id);
  if (lateOpen(T)) {
    // поле ещё растёт — место будет известно, когда закроется регистрация
    p.out = -1;
    T.early.push(p.id);
    if (mine || p.human) say(ev, `${p.name} выбывает.`, p.human ? 'big' : 'out');
    return;
  }
  p.out = at;
  let tail = '';
  if (T.kind === 'pko' && by >= 0 && by !== p.id && p.bounty) {
    const k = T.players[by];
    const cash = Math.floor(p.bounty / 2);
    k.won += cash;
    k.bounty += p.bounty - cash;
    tail = ` Баунти: ${k.name} получает ${cash} и прибавляет ${p.bounty - cash} к своей голове.`;
    p.bounty = 0;
  }
  const paid = at <= T.paid;
  // в MTT о вылетах с чужих столов — только призовые места
  if (mine || paid || p.human || T.tables.length === 1) say(ev, `${p.name} — ${at}-е место${paid ? `, приз ${T.don ? T.prizes[0] : (T.prizes[at - 1] ?? 0)}` : ''}.${tail}`, p.human ? 'big' : 'out');
}

/** Раздача «вслепую» на чужом столе: быстрые боты двигают фишки без карт. Возвращает вылетевших. */
export function simHand(T: TourState, tb: TTable, rng: Rng): { id: number; by: number }[] {
  const P = T.players;
  const ids = tb.ids.filter((id) => id >= 0 && P[id].chips > 0);
  if (ids.length < 2) return [];
  tb.btn = (tb.btn + 1) % ids.length;
  const order = [...ids.slice(tb.btn + 1), ...ids.slice(0, tb.btn + 1)];
  const big = bigAt(T.mtt, T.level);
  const put = new Map<number, number>(ids.map((id) => [id, 0]));
  let pot = 0;
  const pay = (id: number, amt: number) => {
    const a = Math.min(amt, P[id].chips);
    P[id].chips -= a;
    put.set(id, put.get(id)! + a);
    pot += a;
    return a;
  };
  const sb = ids.length === 2 ? order[order.length - 1] : order[0];
  const bb = ids.length === 2 ? order[0] : order[1];
  pay(sb, big / 2);
  pay(bb, big);
  const ak = anteAt(T.mtt, T.level);
  if (ak === 'bb') pay(bb, big);
  else if (ak === 'all') for (const id of ids) pay(id, Math.max(1, Math.round(big / 10)));
  const u = new Map(ids.map((id) => [id, rng.next()]));
  const stackBB = (id: number) => (P[id].chips + put.get(id)!) / big;
  const duel = (a: number, b: number, amt: number) => {
    // оба докладывают до amt (сколько хватит), дальше — вскрытие: лучшая «рука» чаще выигрывает
    for (const id of [a, b]) pay(id, Math.max(0, amt - put.get(id)!));
    const pa = Math.max(0.15, Math.min(0.85, 0.5 + 0.6 * (u.get(a)! - u.get(b)!)));
    return rng.next() < pa ? a : b;
  };
  const acting = [...order.slice(2), ...order.slice(0, 2)];
  let win: number;
  const shover = acting.find((id) => {
    const s = stackBB(id);
    return s <= 13 && u.get(id)! > (s <= 4 ? 0.35 : s <= 8 ? 0.55 : 0.72);
  });
  const r = rng.next();
  if (shover != null) {
    const all = P[shover].chips + put.get(shover)!;
    const caller = acting.filter((id) => id !== shover).find((id) => u.get(id)! > (stackBB(shover) <= 5 ? 0.6 : 0.78));
    win = caller != null ? duel(shover, caller, Math.min(all, P[caller].chips + put.get(caller)!)) : (pay(shover, all), shover);
  } else if (r < 0.035) {
    // кулер: два сильных — большой банк, бывает и ва-банк
    const [a, b] = acting.slice().sort((x, y) => u.get(y)! - u.get(x)!);
    const cap = Math.min(P[a].chips + put.get(a)!, P[b].chips + put.get(b)!);
    const f = 0.35 + rng.next() * 0.75;
    win = duel(a, b, f >= 0.9 ? cap : Math.round(cap * f));
  } else if (r < 0.45) {
    const a = acting[rng.int(acting.length)];
    let b = acting[rng.int(acting.length)];
    if (b === a) b = acting[(acting.indexOf(a) + 1) % acting.length];
    const cap = Math.min(P[a].chips + put.get(a)!, P[b].chips + put.get(b)!);
    win = duel(a, b, Math.min(cap, big * (2 + rng.int(10))));
  } else win = acting[rng.int(acting.length)];
  P[win].chips += pot;
  return ids.filter((id) => P[id].chips === 0).map((id) => ({ id, by: win }));
}

/** Свой стол: фишки движка → игрокам; кто вылетел и кто выбил (забравший больше всех в раздаче). */
function bookHero(s: State, T: TourState, before: Map<number, number>) {
  const tb = T.tables[0];
  if (s.rec) for (const x of s.rec.seats) if (tb.ids[x.seat] >= 0) before.set(tb.ids[x.seat], x.stack);
  tb.ids.forEach((id, k) => id >= 0 && (T.players[id].chips = s.chips[k]));
  const top = s.rec?.winners.slice().sort((a, b) => b.amount - a.amount)[0];
  const by = top ? tb.ids[top.seat] : -1;
  return tb.ids.filter((id) => id >= 0 && T.players[id].chips === 0).map((id) => ({ id, by }));
}

/** Круг: раздача сыграна на своём столе (или своё — тоже «вслепую», если человек уже вылетел) и на каждом другом. */
function round(s: State, T: TourState, ev: Event[], rng: Rng, heroBlind: boolean) {
  const before = new Map<number, number>();
  const busted: { id: number; by: number }[] = [];
  const n0 = s.rec?.seats.length ?? countAt(T.tables[0]);
  T.tables.forEach((tb, i) => {
    if (i === 0 && !heroBlind) return;
    for (const id of tb.ids) if (id >= 0) before.set(id, T.players[id].chips);
  });
  if (!heroBlind) busted.push(...bookHero(s, T, before));
  T.tables.forEach((tb, i) => {
    if (i === 0 && !heroBlind) return;
    busted.push(...simHand(T, tb, rng));
  });
  resolveBusts(T, busted, before, ev, rng);
  T.round++;
  clock(T, ev, rng, heroBlind ? countAt(T.tables[0]) || T.seatMax : n0);
  arrivals(T, ev);
  balance(T, ev, rng);
  stages(T, ev);
}

function clock(T: TourState, ev: Event[], rng: Rng, n: number) {
  T.t += secPerHand(Math.max(2, n));
  const lv = Math.floor(T.t / T.levelSec);
  while (T.level < lv) {
    T.level++;
    const big = bigAt(T.mtt, T.level);
    const ak = anteAt(T.mtt, T.level);
    const ante = ak === 'bb' ? `, анте большого блайнда ${big}` : ak === 'all' ? `, анте ${Math.max(1, Math.round(big / 10))}` : '';
    say(ev, `Уровень ${T.level + 1}: блайнды ${big / 2}/${big}${ante}.`, 'level');
    if (T.kind === 'rebuy' && T.level === REBUY_LEVELS) {
      say(ev, `Ребаи закрыты. Перерыв — аддон: ${T.addonChips} фишек за бай-ин.`, 'big');
      for (const p of seated(T)) {
        if (p.human) T.queue.push({ id: p.id, what: 'addon' });
        else if (rng.next() < 0.8) takeAddon(T, p, ev);
      }
    }
    if (T.late && T.level === LATE_LEVELS) {
      for (const p of T.players) if (!p.joined) p.joinAt = T.round;
      arrivals(T, ev);
      settleEarly(T);
      const entries = T.players.reduce((a, p) => a + (p.joined ? p.entries : 0), 0);
      T.paid = paidOf(T.fmt, T.field, entries);
      say(ev, `Регистрация закрыта: ${entries} ${entries % 10 === 1 && entries % 100 !== 11 ? 'вход' : 'входов'}, платят ${T.paid} мест.`, 'big');
    }
  }
  if (T.t >= T.breakAt) {
    T.breakAt += 3600;
    say(ev, 'Перерыв 5 минут — как в румах, раз в час.');
  }
  T.prizes = prizesFor(T);
}

/** Поздняя регистрация: кто дождался своего круга — садится за самый свободный стол. */
function arrivals(T: TourState, ev: Event[]) {
  for (const p of T.players) {
    if (p.joined || p.joinAt > T.round) continue;
    p.joined = true;
    p.chips = T.start;
    T.chipsIn += T.start;
    addMoney(T);
    let i = smallest(T);
    if (i < 0) {
      T.tables.push({ ids: [], btn: 0 });
      i = T.tables.length - 1;
    }
    addTo(T, i, p.id);
    if (i === 0) say(ev, `${p.name} садится за ваш стол (поздняя регистрация).`, 'move');
  }
}

/** Стол с наименьшим числом игроков, где есть место (−1 — все полны). */
function smallest(T: TourState, skip = -1): number {
  let best = -1;
  T.tables.forEach((tb, i) => {
    if (i === skip || countAt(tb) >= T.seatMax) return;
    if (best < 0 || countAt(tb) < countAt(T.tables[best])) best = i;
  });
  return best;
}

function move(T: TourState, id: number, to: number, ev: Event[]) {
  const from = findTable(T, id);
  removeFrom(T, id);
  addTo(T, to, id);
  const p = T.players[id];
  if (to === 0) say(ev, `${p.name} пересаживается за ваш стол.`, 'move');
  else if (from === 0) say(ev, `${p.name} пересажен за другой стол.`, 'move');
}

/** Балансировка: лишние столы расформировать, разница между столами — не больше одного игрока. */
function balance(T: TourState, ev: Event[], rng: Rng) {
  if (T.tables.length < 2) return;
  const total = seated(T).filter((p) => findTable(T, p.id) >= 0).length;
  const need = Math.max(1, Math.ceil(total / T.seatMax));
  while (T.tables.length > need) {
    // ломаем самый пустой чужой стол
    let k = 1;
    for (let i = 2; i < T.tables.length; i++) if (countAt(T.tables[i]) <= countAt(T.tables[k])) k = i;
    const ids = T.tables[k].ids.slice();
    T.tables[k].ids = [];
    for (const id of ids) {
      const to = smallest(T, k);
      addTo(T, to, id);
      if (to === 0) say(ev, `${T.players[id].name} пересаживается за ваш стол.`, 'move');
    }
    T.tables.splice(k, 1);
    if (T.tables.length === 1 && T.mtt) say(ev, `Финальный стол! Осталось ${countAt(T.tables[0])}.`, 'big');
  }
  for (let guard = 0; guard < 50; guard++) {
    let hi = 0;
    let lo = 0;
    T.tables.forEach((tb, i) => {
      if (countAt(tb) > countAt(T.tables[hi])) hi = i;
      if (countAt(tb) < countAt(T.tables[lo])) lo = i;
    });
    if (countAt(T.tables[hi]) - countAt(T.tables[lo]) < 2) break;
    const from = T.tables[hi].ids.filter((id) => id >= 0 && !T.players[id].human);
    if (!from.length) break;
    move(T, from[rng.int(from.length)], lo, ev);
  }
}

/** Пузырь, призовая зона. */
function stages(T: TourState, ev: Event[]) {
  const alive = seated(T).length;
  const once = (key: string, text: string) => {
    if (T.said.includes(key)) return;
    T.said.push(key);
    say(ev, text, 'big');
  };
  if (lateOpen(T) || alive <= 1) return;
  if (T.don) {
    if (alive === T.paid + 1) once('bubble', `Пузырь: осталось ${alive}, платят ${T.paid}. Ещё один вылет — и все оставшиеся удваивают бай-ин.`);
    return;
  }
  if (alive === T.paid + 1) once('bubble', T.mtt && T.tables.length > 1 ? `Пузырь! Осталось ${alive}, платят ${T.paid}. Играем рука за руку: все столы сдают одновременно.` : `Пузырь! Осталось ${alive}, платят ${T.paid}.`);
  if (alive <= T.paid) once('itm', `Пузырь лопнул — все оставшиеся в призах (мин. приз ${T.prizes[T.paid - 1] ?? 0}).`);
}

/** Призовые для ICM ботов (Cfg.prizes): Sit&Go и финальный стол — точные, на пузыре MTT — приближение «выжить важнее». */
function icmPrizes(T: TourState): number[] | undefined {
  const alive = seated(T).length;
  if (alive > 1 && T.don) return Array(Math.min(alive - 1, T.paid)).fill(T.prizes[0]);
  if (!T.mtt || T.tables.length === 1) {
    // места выше уже занятых: призы для оставшихся
    return T.prizes.slice(0, Math.min(alive, T.prizes.length));
  }
  if (alive > T.paid && alive <= T.paid + 2 * T.tables.length) {
    const n = countAt(T.tables[0]);
    const k = Math.max(1, Math.min(n - 1, Math.round((n * T.paid) / alive)));
    return Array(k).fill(T.prizes[T.paid - 1] ?? 1);
  }
  return undefined;
}

function finish(s: State, T: TourState, ev: Event[]) {
  settleEarly(T);
  const alive = seated(T).sort((a, b) => b.chips - a.chips || a.id - b.id);
  alive.forEach((p, i) => (p.out = i + 1));
  T.prizes = prizesFor(T);
  for (const p of T.players) p.prize = p.out && p.out <= T.paid ? (T.don ? T.prizes[0] : (T.prizes[p.out - 1] ?? 0)) : 0;
  const w = alive[0];
  if (T.kind === 'pko' && w) {
    w.won += w.bounty;
    w.bounty = 0;
  }
  T.done = true;
  T.queue = [];
  s.over = true;
  s.phase = 'over';
  s.decide = null;
  s.between = false;
  const tb = T.tables[0];
  tb.ids.forEach((id, k) => (s.chips[k] = id >= 0 ? T.players[id].chips : 0));
  if (T.don) say(ev, `«Удвоение» окончено: ${alive.map((p) => p.name).join(', ')} удваивают бай-ин (${T.prizes[0]}).`, 'end');
  else say(ev, `🏆 Турнир окончен: побеждает ${w?.name ?? '—'}${T.prizes[0] ? ` — приз ${T.prizes[0]}` : ''}.`, 'end');
  for (const p of T.players.filter((x) => x.human)) say(ev, `${p.name}: ${p.out}-е место из ${entriesOf(T)}${p.prize || p.won ? ` — ${p.prize + p.won} очков` : ''}.`, 'end');
}

export const entriesOf = (T: TourState) => T.players.reduce((a, p) => a + (p.joined ? p.entries : 0), 0);

function over(T: TourState) {
  const alive = seated(T).length + T.queue.length;
  if (T.late && T.level < LATE_LEVELS && T.players.some((p) => !p.joined)) return false;
  return T.don ? alive <= T.paid : alive <= 1;
}

/** Между раздачами: учёт сыгранной, решения людей, следующая раздача (если та сразу кончилась — ещё круг). */
function run(s: State, ev: Event[], rng: Rng): { state: State; events: Event[] } {
  const T = s.tour!;
  for (let guard = 0; guard < 100000; guard++) {
    if (s.between) {
      s.between = false;
      round(s, T, ev, rng, false);
    }
    if (!T.queue.length && over(T)) {
      finish(s, T, ev);
      return { state: s, events: ev };
    }
    if (T.queue.length) {
      const q = T.queue[0];
      const seat = T.tables[0].ids.indexOf(q.id);
      s.decide = { seat, what: q.what };
      s.turn = -1;
      return { state: s, events: ev };
    }
    s.decide = null;
    const humans = T.players.filter((p) => p.human);
    if (humans.length && humans.every((p) => p.out)) {
      // люди вылетели — досчитываем турнир «вслепую»
      say(ev, 'Досчитываем турнир до конца…');
      for (let g = 0; g < 100000 && !over(T); g++) round(s, T, ev, rng, true);
      finish(s, T, ev);
      return { state: s, events: ev };
    }
    // ребаи по желанию — перед раздачей
    for (const id of T.pending) {
      const p = T.players[id];
      if (!p.out && canRebuy(T)) rebuy(T, p, ev, 'rebuy');
    }
    T.pending = [];
    const tb = T.tables[0];
    s.chips = Array(9).fill(0);
    tb.ids.forEach((id, k) => (s.chips[k] = id >= 0 ? T.players[id].chips : 0));
    if (s.chips.filter((c) => c > 0).length < 2) {
      // за своим столом некому играть — круг идёт только на других (бывает между вылетом и пересадкой)
      round(s, T, ev, rng, true);
      continue;
    }
    const big = bigAt(T.mtt, T.level);
    s.big = big;
    s.small = big / 2;
    s.cfg = { ...s.cfg, ante: anteAt(T.mtt, T.level), prizes: icmPrizes(T) };
    if (!s.cfg.prizes) delete s.cfg.prizes;
    const d = deal(s, rng);
    s = d.state;
    s.tour = T;
    ev.push(...d.events);
    if (!s.between) return { state: s, events: ev };
  }
  finish(s, T, ev);
  return { state: s, events: ev };
}

// ---------------------------------------------------------------- ходы

export type TourAction = { type: 'tour'; what: 'yes' | 'no' | 'rebuy' };
export const isTourAction = (a: unknown): a is TourAction => !!a && typeof a === 'object' && (a as TourAction).type === 'tour';

/** Ребай по желанию: в период ребаев, стек не больше стартового. */
export function canVoluntaryRebuy(s: State, seat: number): boolean {
  const T = s.tour;
  if (!T || T.done || !canRebuy(T)) return false;
  const id = T.tables[0].ids[seat];
  if (id == null || id < 0) return false;
  const p = T.players[id];
  return p.human && !p.out && !T.pending.includes(id) && s.chips[seat] + (s.total[seat] ?? 0) <= T.start;
}

/** Ход в турнире: решение (ребай / ре-энтри / аддон), ребай по желанию или обычный ход движка. */
export function tourApply(s0: State, seat: number, a: TourAction, rng: Rng): { state: State; events: Event[] } | null {
  const T0 = s0.tour;
  if (!T0 || T0.done || !isTourAction(a)) return null;
  const s: State = { ...s0, chips: s0.chips.slice(), tour: cloneTour(T0) };
  const T = s.tour!;
  const ev: Event[] = [];
  if (a.what === 'rebuy') {
    if (s0.decide || !canVoluntaryRebuy(s0, seat)) return null;
    T.pending.push(T.tables[0].ids[seat]);
    say(ev, `${T.players[T.tables[0].ids[seat]].name} берёт ребай — фишки придут к следующей раздаче.`);
    return { state: s, events: ev };
  }
  const d = s0.decide;
  if (!d || d.seat !== seat || (a.what !== 'yes' && a.what !== 'no')) return null;
  const q = T.queue.shift()!;
  const p = T.players[q.id];
  if (q.what === 'addon') {
    if (a.what === 'yes') takeAddon(T, p, ev);
  } else if (a.what === 'yes') rebuy(T, p, ev, q.what);
  else place(T, p, seated(T).length, -1, ev);
  T.prizes = prizesFor(T);
  return run(s, ev, rng);
}

/** Есть ли у s сыгранная раздача, которую надо передать турниру. */
export function afterApply(r: { state: State; events: Event[] }, rng: Rng) {
  if (!r.state.tour || !r.state.between) return r;
  const s: State = { ...r.state, tour: cloneTour(r.state.tour) };
  return run(s, r.events, rng);
}

/** Итог турнира для стола: победа — если человек первый (в «Удвоении» — в призах). */
export function tourResult(s: State): { winners: number[]; text: string; scores: Record<number, number> } {
  const T = s.tour!;
  const ids = T.tables[0].ids;
  const w = T.players.find((p) => p.out === 1);
  const humans = T.players.filter((p) => p.human);
  const good = (p: TPlayer) => (T.don ? p.prize > 0 : p.out === 1);
  const winners = (humans.length ? humans.filter(good) : w ? [w] : []).map((p) => ids.indexOf(p.id)).filter((k) => k >= 0);
  const me = humans[0];
  const n = entriesOf(T);
  // по сети людей несколько: места всех, у кого лучше — выше
  const text =
    humans.length > 1
      ? `победитель — ${w?.name ?? '—'} (из ${n}); ${humans
          .slice()
          .sort((a, b) => a.out - b.out)
          .map((p) => `${p.name} — ${p.out}-е${p.prize + p.won ? ` (${p.prize + p.won} очков)` : ''}`)
          .join(', ')}`
      : me
        ? `${me.out}-е место из ${n}${me.prize + me.won ? ` — ${me.prize + me.won} очков` : ''}${T.don || me.out === 1 ? '' : `; победитель — ${w?.name ?? '—'}`}`
        : `победитель — ${w?.name ?? '—'} (из ${n})`;
  const scores: Record<number, number> = {};
  ids.forEach((id, k) => id >= 0 && (scores[k] = T.players[id].out));
  return { winners, text, scores };
}
