/* «Менеджер» / «Космос 2000» — движок без DOM. Одна партия на выбранном поле; правила полей различаются там, где различаются
 * правила игр: в «Менеджере» два кубика, дубли, биржа, филиалы/предприятия, залог и долги; в «Космосе» один кубик, планеты без построек,
 * банк с жетонами «Б», казино, страховка, пираты с «золотом Амазонок», ссуда банкроту.
 *
 * Ход: фаза 'roll' — игрок до броска делает операции (строит, закладывает, предлагает сделку) и бросает. После хода клетка
 * разбирается (resolve): может открыть фазу решения (купить, торги, долг, страховка, казино), по её окончании ход заканчивается (finish). */
import type { Rng } from '../../core/types';
import {
  BIG_CARDS,
  boardOf,
  CASINO,
  CASINO_STAR,
  IMP_REDEEM,
  IMP_START,
  IMP_SUB_PAY,
  IMP_SWAP_FEE,
  INSURE,
  POINT,
  PRICE0,
  PRICE_MAX,
  RATE,
  ROULETTE,
  SHARES_BUY_CAP,
  SHARES_TOTAL,
  STOCK_CARDS,
  TAX_RATE,
  type Board,
  type Card,
  type MapId,
} from './boards';

export type Phase =
  | 'roll'
  | 'resolve'
  | 'buy'
  | 'auction'
  | 'debt'
  | 'offer'
  | 'insure'
  | 'casino'
  | 'casino2'
  | 'bankBuy'
  | 'exchange'
  // «Бизнесмен»: биржа акций, клетка с выбором (банк, отель, таможня, маклер, рулетка, перекрёсток), рулетка, выбор цвета акций
  | 'stocks'
  | 'hub'
  | 'roulette'
  | 'pick'
  // «Империя»: выход из подпространства на планету сектора
  | 'sub'
  | 'over';

/** «Бизнесмен»: выбор цвета акций — подарок, покупка по карточке, повышение курса. */
export interface Pick {
  n: number;
  mode: 'gift' | 'buy' | 'raise';
  /** После выбора — на биржу (3-я клетка автомагистрали). */
  stocks?: boolean;
}

export interface Auction {
  cell: number;
  bid: number;
  leader: number | null;
  /** Кто ещё торгуется — по кругу. */
  order: number[];
  at: number;
}

export interface Offer {
  from: number;
  to: number;
  /** Участки, которые отдаёт from / получает от to. */
  give: number[];
  get: number[];
  /** Деньги: + платит from, − платит to. */
  cash: number;
  /** Карточки «выход из биржи»: + отдаёт from, − отдаёт to. */
  cards: number;
  back: Phase;
}

export interface Debt {
  amount: number;
  to: number | null;
  /** После уплаты: закончить ход или пойти на выпавшее (третий бросок на бирже). */
  then: 'finish' | 'move';
}

export interface State {
  map: MapId;
  seats: number[];
  cash: number[];
  /** «Бизнес»: доллары. */
  usd: number[];
  /** «Бизнес»: льготы до конца круга (биты, см. Fx 'perk'). */
  perk: number[];
  /** «Бизнес»: фишка прошла «Страховое общество» — после хода можно застраховаться. */
  insPass: boolean;
  /** «Бизнес»: премия 15 000 за круг (домашнее правило). */
  premium: boolean;
  pos: number[];
  out: boolean[];
  /** Владелец клетки: место; -1 — банк (жетон «Б» в «Космосе»); null — ничья. */
  owner: (number | null)[];
  /** 0–3 филиала, 4 — предприятие. */
  houses: number[];
  mort: boolean[];
  turn: number;
  phase: Phase;
  dice: number[] | null;
  doubles: number;
  /** Ещё ход тому же игроку (дубль, «пояс астероидов»). */
  again: boolean;
  /** Биржа: 0 — свободен, k — сидит, k-я попытка выйти. */
  jail: number[];
  /** Карточки «Вы освобождены от посещения биржи» на руках: колода*100 + номер. */
  freeCards: number[][];
  /** Колоды: номера карточек сверху вниз. В view — пустые, есть только deckLen. */
  decks: number[][];
  deckLen?: number[];
  /** Последняя вытянутая карточка. */
  card: { deck: number; id: number; seat: number } | null;
  skip: boolean[];
  /** Страховка: 0 — нет, 1 — наполовину, 2 — полностью («Бизнес»: 1 — застрахован от одного убытка по «Шансу»). */
  ins: number[];
  freeCasino: boolean;
  freeIns: boolean;
  /** «Золото Амазонок» — деньги, отнятые пиратами. */
  pot: number;
  loan: number[];
  loanLaps: number[];
  loanUsed: boolean[];
  auction: Auction | null;
  offer: Offer | null;
  debt: Debt | null;
  offers: number;
  /** Филиалы и предприятия в банке. */
  stock: [number, number];
  round: number;
  limit: number;
  startPass: boolean;
  loanOn: boolean;
  // «Бизнесмен»
  /** Курс акций четырёх цветов, пункты 1–25. */
  price: number[];
  /** Акции игроков: [место][цвет]. */
  shares: number[][];
  /** Карточки биржи на руках (номера в STOCK_CARDS); в view чужие — -1. */
  hand: number[][];
  /** Колоды карточек биржи: большие и малые; в view пустые. */
  sbig: number[];
  ssmall: number[];
  /** Сектор рулетки (-1 — ещё не вошёл) и сколько бросков осталось (-1 — сколько угодно). */
  rl: number;
  rlLeft: number;
  /** После биржи или рулетки — вернуться к выбору на клетке (отель, банк). */
  back: boolean;
  /** Что уже сделано на клетке с выбором: 1 — биржа, 2 — рулетка. */
  used: number;
  pick: Pick | null;
  /** Куплено акций за это посещение биржи и сыграна ли карточка. */
  bought: number[];
  played: boolean;
  /** Пропуск ходов (клиника «Стоп»). */
  wait: number[];
  /** Цена последнего приобретения — для налога с оборота. */
  lastBuy: number[];
  /** Дубль 3:3 — в конце хода на биржу. */
  bonus: boolean;
  // «Империя»
  /** Следующий ход: по малому кругу (остановился на «Леме») или по подпространству (на нуль переходе). */
  route: string[];
  /** Остановился в антимире — следующий ход вспять. */
  rev: boolean[];
  /** «Ускорение»: сколько ходов ещё вдвое. */
  accel: number[];
  /** «Инерциоид»: до конца круга бросают кубики дважды. */
  inertia: boolean[];
  /** «Неразменный пятак»: сколько штрафов ещё простить. */
  pyatak: number[];
  /** Сколько раз попадал на «Обмен разумов». */
  swaps: number[];
  /** Уже выходил на внешний круг (первый выход с космодрома — не круг). */
  lapped: boolean[];
  /** Длина последнего хода (для «Коллапса»). */
  lastMove: number;
  /** «Зона»: сколько карточек ещё снять. */
  zoneLeft: number;
  result: { winners: number[]; text: string } | null;
}

export type Action =
  | { type: 'roll' }
  | { type: 'buy' }
  | { type: 'pass' }
  | { type: 'bid'; amount: number }
  | { type: 'fold' }
  | { type: 'build'; cell: number }
  | { type: 'sell'; cell: number }
  | { type: 'mortgage'; cell: number }
  | { type: 'redeem'; cell: number }
  | { type: 'sellBank'; cell: number }
  | { type: 'payJail' }
  | { type: 'useCard' }
  | { type: 'offer'; to: number; give: number[]; get: number[]; cash: number; cards: number }
  | { type: 'accept' }
  | { type: 'reject' }
  | { type: 'insure'; level: number }
  | { type: 'spin' }
  | { type: 'exchange'; usd: number }
  | { type: 'bankrupt' }
  // «Бизнесмен»
  | { type: 'hub'; opt: string }
  | { type: 'shares'; c: number; n: number }
  | { type: 'play'; card: number; opt: number }
  | { type: 'roulette'; entry?: number }
  | { type: 'pick'; c: number }
  | { type: 'exit'; cell: number };

type Who = number | null | 'pot';

export type Event =
  | { type: 'roll'; seat: number; dice: number[] }
  | { type: 'move'; seat: number; path: number[] }
  | { type: 'jump'; seat: number; to: number }
  | { type: 'pay'; from: Who; to: Who; amount: number; why: string; usd?: boolean }
  | { type: 'buy'; seat: number; cell: number; price: number }
  | { type: 'decline'; seat: number; cell: number }
  | { type: 'bid'; seat: number; amount: number }
  | { type: 'fold'; seat: number }
  | { type: 'won'; seat: number | null; cell: number; price: number }
  | { type: 'build'; seat: number; cell: number; level: number }
  | { type: 'unbuild'; seat: number; cell: number; level: number }
  | { type: 'mortgage'; seat: number; cell: number; on: boolean }
  | { type: 'sellBank'; seat: number; cell: number; price: number }
  | { type: 'card'; seat: number; deck: number; id: number }
  | { type: 'jail'; seat: number }
  | { type: 'free'; seat: number; how: 'double' | 'pay' | 'card' | 'forced' }
  | { type: 'stay'; seat: number }
  | { type: 'offer'; offer: Offer }
  | { type: 'deal'; from: number; to: number; ok: boolean }
  | { type: 'debt'; seat: number; amount: number }
  | { type: 'bankrupt'; seat: number }
  | { type: 'loan'; seat: number }
  | { type: 'repay'; seat: number }
  | { type: 'insure'; seat: number; level: number; free?: boolean }
  | { type: 'casino'; seat: number; die: number; sector: number; amount: number; star: boolean }
  | { type: 'skip'; seat: number }
  | { type: 'again'; seat: number }
  | { type: 'visit'; seat: number; cell: number }
  | { type: 'saved'; seat: number }
  | { type: 'audit'; seat: number; die: number }
  | { type: 'lost'; seat: number }
  | { type: 'perk'; seat: number; bit: number }
  | { type: 'exchange'; seat: number; usd: number }
  // «Бизнесмен»
  | { type: 'shares'; seat: number; c: number; n: number; price: number; why?: string }
  | { type: 'market'; seat: number | null; card: number | null; from: number[]; to: number[] }
  | { type: 'roulette'; seat: number; dice: number[]; sector: number; amount: number }
  | { type: 'hub'; seat: number; opt: string; cost: number }
  | { type: 'wait'; seat: number; n: number }
  // «Империя»
  | { type: 'tower'; seat: number; dice: number[]; k: number }
  | { type: 'exit'; seat: number; cell: number }
  | { type: 'swap'; a: number; b: number }
  | { type: 'chrono'; cells: number[] }
  | { type: 'steal'; seat: number; from: number; cell: number }
  | { type: 'annihilate'; seat: number; from: number; cell: number }
  | { type: 'flag'; seat: number; what: 'inner' | 'sub' | 'rev' | 'accel' | 'inertia' | 'pyatak' }
  | { type: 'end'; winners: number[]; text: string };

/** Партия, затянувшаяся на столько кругов, заканчивается подсчётом капитала. */
export const HARD_LIMIT = 150;
export const MAX_OFFERS = 3;

export const B = (s: State): Board => boardOf(s.map);
/** Постройки, залог и долги — в «Менеджере» и «Бизнесе»; «Космос» — планеты без построек. */
export const estate = (s: State) => s.map !== 'kosmos';
export const isBiz = (s: State) => s.map === 'biznes';
export const isBm = (s: State) => s.map === 'biznesmen';
export const isImp = (s: State) => s.map === 'imperiya';
export const N = (s: State) => B(s).cells.length;

export const fmt = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
export const money = (s: State | Board, n: number) => {
  const b = 'cells' in s ? s : B(s);
  return `${fmt(n)} ${b.cur}`;
};

export const dollars = (n: number) => `${fmt(n)} $`;
export const alive = (s: State) => s.seats.filter((x) => !s.out[x]);

export function clone(s: State): State {
  return {
    ...s,
    seats: s.seats.slice(),
    cash: s.cash.slice(),
    usd: s.usd.slice(),
    perk: s.perk.slice(),
    pos: s.pos.slice(),
    out: s.out.slice(),
    owner: s.owner.slice(),
    houses: s.houses.slice(),
    mort: s.mort.slice(),
    jail: s.jail.slice(),
    freeCards: s.freeCards.map((c) => c.slice()),
    decks: s.decks.map((d) => d.slice()),
    skip: s.skip.slice(),
    ins: s.ins.slice(),
    loan: s.loan.slice(),
    loanLaps: s.loanLaps.slice(),
    loanUsed: s.loanUsed.slice(),
    stock: [s.stock[0], s.stock[1]],
    auction: s.auction ? { ...s.auction, order: s.auction.order.slice() } : null,
    offer: s.offer ? { ...s.offer, give: s.offer.give.slice(), get: s.offer.get.slice() } : null,
    debt: s.debt ? { ...s.debt } : null,
    card: s.card ? { ...s.card } : null,
    dice: s.dice ? s.dice.slice() : null,
    price: s.price.slice(),
    shares: s.shares.map((x) => x.slice()),
    hand: s.hand.map((x) => x.slice()),
    sbig: s.sbig.slice(),
    ssmall: s.ssmall.slice(),
    pick: s.pick ? { ...s.pick } : null,
    bought: s.bought.slice(),
    wait: s.wait.slice(),
    lastBuy: s.lastBuy.slice(),
    route: s.route.slice(),
    rev: s.rev.slice(),
    accel: s.accel.slice(),
    inertia: s.inertia.slice(),
    pyatak: s.pyatak.slice(),
    swaps: s.swaps.slice(),
    lapped: s.lapped.slice(),
  };
}

function shuffle(a: number[], rng: Rng) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function newState(map: MapId, seats: number[], o: { limit?: number; startPass?: boolean; loan?: boolean; premium?: boolean }, rng: Rng): State {
  const b = boardOf(map);
  const n = b.cells.length;
  const start = b.money(seats.length);
  const bm = map === 'biznesmen';
  // «Бизнесмен»: по три большие и четыре малые карточки биржи втайне, по акции каждого цвета
  const sbig = bm ? shuffle(Array.from({ length: BIG_CARDS }, (_, i) => i), rng) : [];
  const ssmall = bm ? shuffle(Array.from({ length: STOCK_CARDS.length - BIG_CARDS }, (_, i) => BIG_CARDS + i), rng) : [];
  const hand = Array.from({ length: 6 }, (_, i) => (bm && seats.includes(i) ? [...sbig.splice(0, 3), ...ssmall.splice(0, 4)] : []));
  return {
    map,
    seats,
    cash: Array.from({ length: 6 }, (_, i) => (seats.includes(i) ? start : 0)),
    usd: Array(6).fill(0),
    perk: Array(6).fill(0),
    insPass: false,
    premium: !!o.premium,
    pos: Array(6).fill(map === 'imperiya' ? IMP_START : 0),
    out: Array(6).fill(false),
    owner: Array(n).fill(null),
    houses: Array(n).fill(0),
    mort: Array(n).fill(false),
    turn: seats[0],
    phase: 'roll',
    dice: null,
    doubles: 0,
    again: false,
    jail: Array(6).fill(0),
    freeCards: Array.from({ length: 6 }, () => []),
    decks: b.decks.map((d) => shuffle(d.cards.map((_, i) => i), rng)),
    card: null,
    skip: Array(6).fill(false),
    ins: Array(6).fill(0),
    freeCasino: false,
    freeIns: false,
    pot: 0,
    loan: Array(6).fill(0),
    loanLaps: Array(6).fill(0),
    loanUsed: Array(6).fill(false),
    auction: null,
    offer: null,
    debt: null,
    offers: 0,
    stock: map === 'biznes' ? [18, 12] : bm ? [20, 12] : map === 'imperiya' ? [40, 0] : [26, 12],
    round: 1,
    limit: o.limit ?? 0,
    startPass: !!o.startPass,
    loanOn: o.loan ?? true,
    price: Array(4).fill(PRICE0),
    shares: Array.from({ length: 6 }, (_, i) => Array(4).fill(bm && seats.includes(i) ? 1 : 0)),
    hand,
    sbig,
    ssmall,
    rl: -1,
    rlLeft: 0,
    back: false,
    used: 0,
    pick: null,
    bought: Array(4).fill(0),
    played: false,
    wait: Array(6).fill(0),
    lastBuy: Array(6).fill(0),
    bonus: false,
    route: Array(6).fill(''),
    rev: Array(6).fill(false),
    accel: Array(6).fill(0),
    inertia: Array(6).fill(false),
    pyatak: Array(6).fill(0),
    swaps: Array(6).fill(0),
    lapped: Array(6).fill(false),
    lastMove: 0,
    zoneLeft: 0,
    result: null,
  };
}

// ---------------- участки ----------------

export const isProp = (s: State, c: number) => B(s).cells[c]?.kind === 'prop';
export const groupCells = (s: State, g: number) => B(s).cells.flatMap((c, i) => (c.kind === 'prop' && c.group === g ? [i] : []));
export const owned = (s: State, seat: number) => s.owner.flatMap((o, i) => (o === seat ? [i] : []));

/** Вся группа у одного хозяина и ничего не заложено. */
export function fullGroup(s: State, c: number): boolean {
  const cell = B(s).cells[c];
  if (!estate(s) || cell.group == null) return false;
  const own = s.owner[c];
  return own != null && own >= 0 && groupCells(s, cell.group).every((i) => s.owner[i] === own && !s.mort[i]);
}

export function rent(s: State, c: number): number {
  const cell = B(s).cells[c];
  if (!cell.rents || s.mort[c]) return 0;
  if (s.map === 'kosmos') return cell.rents[0];
  const h = s.houses[c];
  if (isBiz(s)) return h === 0 ? cell.rents[fullGroup(s, c) ? 1 : 0] : cell.rents[h + 1];
  // «Бизнесмен»: участок (вдвое — если вся группа), филиал, предприятие; фирма — одна плата
  if (isBm(s)) return cell.group == null ? cell.rents[0] : h === 0 ? cell.rents[0] * (fullGroup(s, c) ? 2 : 1) : cell.rents[h === 4 ? 2 : 1];
  // «Империя»: базы — по их числу у хозяина; башня — кубики × 5 или × 10 (здесь — в среднем); планета — фрахт и плата по ракетам
  if (isImp(s)) {
    if (cell.util) {
      const k = sameUtil(s, c);
      return cell.util === 'base' ? cell.rents[k - 1] : cell.rents[k - 1] * 7;
    }
    return cell.rents[h];
  }
  return h === 0 && fullGroup(s, c) ? cell.rents[0] * 2 : cell.rents[h];
}

/** «Империя»: сколько баз (башен) у хозяина этой клетки. */
export const sameUtil = (s: State, c: number) => {
  const b = B(s);
  return b.cells.filter((x, i) => x.util === b.cells[c].util && s.owner[i] === s.owner[c]).length;
};
const groupHouses = (s: State, c: number) => groupCells(s, B(s).cells[c].group!).map((i) => s.houses[i]);
const groupBuilt = (s: State, c: number) => B(s).cells[c].group != null && groupHouses(s, c).some((h) => h > 0);

export function canBuild(s: State, seat: number, c: number): boolean {
  const cell = B(s).cells[c];
  if (!estate(s) || s.owner[c] !== seat || !fullGroup(s, c)) return false;
  const h = s.houses[c];
  // «Бизнес»: строят неравномерно; после трёх филиалов — валютное предприятие за доллары; льгота «запрещено строить»
  if (isBiz(s)) {
    if (s.perk[seat] & 4 || h >= 4) return false;
    if (h < 3) return s.stock[0] >= 1 && s.cash[seat] >= cell.build!;
    return s.stock[1] >= 1 && s.usd[seat] >= cell.buildUsd!;
  }
  // «Бизнесмен»: на участке сначала филиал, потом предприятие; предприятие — когда на остальных участках группы есть филиалы
  if (isBm(s)) {
    if (s.cash[seat] < cell.build!) return false;
    if (h === 0) return s.stock[0] >= 1;
    if (h === 1) return s.stock[1] >= 1 && groupCells(s, cell.group!).every((i) => i === c || s.houses[i] >= 1);
    return false;
  }
  if (h >= 4 || h !== Math.min(...groupHouses(s, c))) return false;
  // «Империя»: до четырёх ракет на планете, равномерно по системе
  if (isImp(s)) return s.stock[0] >= 1 && s.cash[seat] >= cell.build!;
  if (h < 3 ? s.stock[0] < 1 : s.stock[1] < 1) return false;
  return s.cash[seat] >= cell.build!;
}

export function canSell(s: State, seat: number, c: number): boolean {
  if (isBiz(s)) return s.owner[c] === seat && s.houses[c] > 0;
  // «Бизнесмен»: филиал нельзя снять, пока в группе стоит предприятие
  if (isBm(s)) return s.owner[c] === seat && s.houses[c] > 0 && (s.houses[c] === 4 || !groupHouses(s, c).includes(4));
  return (s.map === 'manager' || isImp(s)) && s.owner[c] === seat && s.houses[c] > 0 && s.houses[c] === Math.max(...groupHouses(s, c));
}

export const canMortgage = (s: State, seat: number, c: number) =>
  estate(s) && s.owner[c] === seat && !s.mort[c] && (isBiz(s) || isImp(s) ? s.houses[c] === 0 : !groupBuilt(s, c));
/** Выкуп: половина цены («Империя» — 60 %). */
export const redeemCost = (s: State, c: number) => (isImp(s) ? Math.round((B(s).cells[c].price! * IMP_REDEEM) / 10) * 10 : B(s).cells[c].price! / 2);
export const canRedeem = (s: State, seat: number, c: number) => s.owner[c] === seat && s.mort[c] && s.cash[seat] >= redeemCost(s, c);
/** Участок можно продать или обменять: без построек в группе и не заложен. */
export const tradeable = (s: State, seat: number, c: number) =>
  s.owner[c] === seat && !s.mort[c] && !(isBiz(s) ? s.houses[c] > 0 : s.map !== 'kosmos' && groupBuilt(s, c));

/** Сколько стоит постройка на участке (рубли; валютное предприятие «Бизнеса» — по курсу биржи). */
export function buildValue(s: State, c: number): number {
  const cell = B(s).cells[c];
  const h = s.houses[c];
  if (isBiz(s)) return h === 4 ? cell.buildUsd! * RATE : h * cell.build!;
  if (isBm(s)) return h === 4 ? 2 * cell.build! : h * (cell.build ?? 0);
  return h * (cell.build ?? 0);
}

/** Сколько игрок может собрать, продав постройки и заложив всё («Менеджер») или продав планеты банку («Космос»). */
/** «Бизнесмен»: акции игрока по курсу. */
export const sharesValue = (s: State, seat: number) => s.shares[seat].reduce((n, k, c) => n + k * s.price[c] * POINT, 0);

export function worth(s: State, seat: number): number {
  const b = B(s);
  let w = s.cash[seat] + s.usd[seat] * RATE + sharesValue(s, seat);
  for (const c of owned(s, seat)) {
    const cell = b.cells[c];
    if (s.map === 'kosmos') w += cell.price!;
    else {
      w += buildValue(s, c) / 2;
      if (!s.mort[c]) w += cell.price! / 2;
    }
  }
  return w;
}

/** Капитал для подсчёта в конце: деньги + цены участков (заложенные — половина) + постройки по цене, минус ссуда. */
export function capital(s: State, seat: number): number {
  const b = B(s);
  let w = s.cash[seat] + s.usd[seat] * RATE + sharesValue(s, seat) - s.loan[seat];
  for (const c of owned(s, seat)) {
    const cell = b.cells[c];
    w += s.mort[c] ? cell.price! / 2 : cell.price!;
    w += buildValue(s, c);
  }
  return w;
}

export const housesOf = (s: State, seat: number) => {
  let h = 0;
  let e = 0;
  for (const c of owned(s, seat)) {
    if (s.houses[c] === 4) e++;
    else h += s.houses[c];
  }
  return { h, e };
};

// ---------------- деньги ----------------

type Ctx = { s: State; ev: Event[]; rng: Rng; depth: number };

/** Доллары «Бизнеса»: между игроками и банком. */
function giveUsd(x: Ctx, from: number | null, to: number | null, amount: number, why: string) {
  if (amount <= 0) return;
  const { s } = x;
  if (from != null) s.usd[from] -= amount;
  if (to != null) s.usd[to] += amount;
  x.ev.push({ type: 'pay', from, to, amount, why, usd: true });
}

function give(x: Ctx, from: Who, to: Who, amount: number, why: string) {
  if (amount <= 0) return;
  const { s } = x;
  if (typeof from === 'number') s.cash[from] -= amount;
  else if (from === 'pot') s.pot -= amount;
  if (typeof to === 'number') s.cash[to] += amount;
  else if (to === 'pot') s.pot += amount;
  x.ev.push({ type: 'pay', from, to, amount, why });
}

/** Списать с игрока. 'ok' — заплатил; 'debt' — «Менеджер»: открыт долг, ждём; 'broke' — «Космос»: разорился (ссуда или выбыл). */
function charge(x: Ctx, seat: number, amount: number, to: number | null | 'pot', why: string, then: Debt['then'] = 'finish'): 'ok' | 'debt' | 'broke' {
  const { s } = x;
  if (amount <= 0) return 'ok';
  if (s.cash[seat] >= amount) {
    give(x, seat, to, amount, why);
    return 'ok';
  }
  if (estate(s)) {
    s.debt = { amount, to: typeof to === 'number' ? to : null, then };
    x.ev.push({ type: 'debt', seat, amount });
    if (worth(s, seat) < amount) {
      bankruptManager(x, seat);
      return 'broke';
    }
    s.phase = 'debt';
    return 'debt';
  }
  // «Космос»: в трудностях планеты продаются банку по цене, начиная с дешёвых
  const b = B(s);
  const mine = owned(s, seat).sort((a, c) => b.cells[a].price! - b.cells[c].price!);
  for (const c of mine) {
    if (s.cash[seat] >= amount) break;
    sellToBank(x, seat, c);
  }
  if (s.cash[seat] >= amount) {
    give(x, seat, to, amount, why);
    return 'ok';
  }
  give(x, seat, to, s.cash[seat], why);
  brokeKosmos(x, seat);
  return 'broke';
}

function sellToBank(x: Ctx, seat: number, c: number) {
  const { s } = x;
  const price = B(s).cells[c].price!;
  s.owner[c] = -1;
  s.cash[seat] += price;
  x.ev.push({ type: 'sellBank', seat, cell: c, price });
}

/** «Космос»: без денег и планет — банкрот. Ссуда 1000 (один раз, если включена) — на «Старт», вернуть 1200 за два круга. */
function brokeKosmos(x: Ctx, seat: number) {
  const { s } = x;
  if (s.loanOn && !s.loanUsed[seat] && alive(s).length > 1) {
    s.loanUsed[seat] = true;
    s.loan[seat] = 1200;
    s.loanLaps[seat] = 0;
    s.cash[seat] += 1000;
    s.pos[seat] = 0;
    s.ins[seat] = 0;
    s.skip[seat] = false;
    x.ev.push({ type: 'loan', seat });
    x.ev.push({ type: 'jump', seat, to: 0 });
    return;
  }
  eliminate(x, seat);
}

function eliminate(x: Ctx, seat: number) {
  const { s } = x;
  s.out[seat] = true;
  for (let c = 0; c < s.owner.length; c++) {
    if (s.owner[c] !== seat) continue;
    s.owner[c] = s.map === 'kosmos' ? -1 : null;
    if (s.houses[c] === 4 && !isImp(s)) {
      s.stock[1]++;
    } else s.stock[0] += s.houses[c];
    s.houses[c] = 0;
    s.mort[c] = false;
  }
  for (const code of s.freeCards[seat]) s.decks[Math.floor(code / 100)].push(code % 100);
  s.freeCards[seat] = [];
  // «Бизнесмен»: акции — банку, карточки биржи — под низ колод
  s.shares[seat] = [0, 0, 0, 0];
  for (const id of s.hand[seat]) (id < BIG_CARDS ? s.sbig : s.ssmall).push(id);
  s.hand[seat] = [];
  s.wait[seat] = 0;
  s.cash[seat] = 0;
  s.usd[seat] = 0;
  s.loan[seat] = 0;
  s.jail[seat] = 0;
  x.ev.push({ type: 'bankrupt', seat });
  checkWin(x);
}

/** «Менеджер», разорение: ценности уходят банку, банк выплачивает кредитору полную сумму долга. */
function bankruptManager(x: Ctx, seat: number) {
  const { s } = x;
  const d = s.debt;
  s.debt = null;
  // «Бизнес»: должнику-игроку отдают всё — постройки сданы банку за полцены, патенты (и заложенные), рубли и доллары
  if (isBiz(s) && d && d.to != null && !s.out[d.to]) {
    const to = d.to;
    for (const c of owned(s, seat)) {
      if (s.houses[c]) unbuildAll(x, seat, c);
      s.owner[c] = to;
    }
    if (s.cash[seat] > 0) give(x, seat, to, s.cash[seat], 'всё имущество — кредитору');
    if (s.usd[seat] > 0) giveUsd(x, seat, to, s.usd[seat], 'всё имущество — кредитору');
    eliminate(x, seat);
    return;
  }
  if (d && d.to != null && !s.out[d.to]) give(x, null, d.to, d.amount, 'банк гасит долг банкрота');
  if (s.cash[seat] > 0) give(x, seat, null, s.cash[seat], 'всё имущество — банку');
  eliminate(x, seat);
}

function checkWin(x: Ctx) {
  const { s } = x;
  const left = alive(s);
  if (left.length <= 1 && !s.result) {
    s.result = {
      winners: left,
      text: s.map === 'kosmos' ? 'остался в космосе последним с капиталом' : isImp(s) ? 'единственный не разорился — властелин Империи' : isBm(s) ? 'единственный не разорился — настоящий бизнесмен' : isBiz(s) ? 'единственный не обанкротился — самое развитое производство' : 'единственный не разорился — монополист',
    };
    s.phase = 'over';
    x.ev.push({ type: 'end', winners: left, text: s.result.text });
  }
}

function endByCapital(x: Ctx) {
  const { s } = x;
  const left = alive(s);
  const cap = left.map((p) => capital(s, p));
  const best = Math.max(...cap);
  const winners = left.filter((_, i) => cap[i] === best);
  s.result = { winners, text: `богаче всех после ${s.round - 1} кругов: капитал ${money(s, best)}` };
  s.phase = 'over';
  x.ev.push({ type: 'end', winners, text: s.result.text });
}

// ---------------- ход ----------------

function nextTurn(x: Ctx) {
  const { s } = x;
  s.again = false;
  s.doubles = 0;
  s.offers = 0;
  s.freeCasino = false;
  s.freeIns = false;
  s.insPass = false;
  if (s.result) return;
  let i = s.seats.indexOf(s.turn);
  for (let k = 0; k < s.seats.length * 2; k++) {
    const j = (i + 1) % s.seats.length;
    if (j <= i) {
      s.round++;
      const cap = s.limit > 0 ? Math.min(s.limit, HARD_LIMIT) : HARD_LIMIT;
      if (s.round > cap) {
        endByCapital(x);
        return;
      }
    }
    i = j;
    const p = s.seats[i];
    if (s.out[p]) continue;
    if (s.skip[p]) {
      s.skip[p] = false;
      x.ev.push({ type: 'skip', seat: p });
      continue;
    }
    if (s.wait[p] > 0) {
      s.wait[p]--;
      x.ev.push({ type: 'skip', seat: p });
      continue;
    }
    s.turn = p;
    s.phase = 'roll';
    return;
  }
  // все пропускают — ходит следующий живой
  s.turn = alive(s)[0];
  s.phase = 'roll';
}

/** Клетка разобрана — ход окончен (или ещё бросок). */
function finish(x: Ctx) {
  const { s } = x;
  if (s.result) {
    s.phase = 'over';
    return;
  }
  const seat = s.turn;
  // «Империя»: «Зона» — три карточки подряд, каждая выполняется до конца
  while (s.zoneLeft > 0 && !s.out[seat] && !s.result) {
    s.zoneLeft--;
    draw(x, seat, 2);
    if (s.phase !== 'resolve') return;
  }
  if (s.result) {
    s.phase = 'over';
    return;
  }
  // «Бизнесмен»: выпал дубль 3:3 — сыграть на бирже
  if (s.bonus) {
    s.bonus = false;
    if (!s.out[seat]) {
      openStocks(x, false);
      return;
    }
  }
  // «Бизнес»: прошёл «Страховое общество» — можно застраховаться
  if (s.insPass) {
    s.insPass = false;
    if (!s.out[seat] && !s.ins[seat] && s.cash[seat] >= INSURE) {
      s.phase = 'insure';
      return;
    }
  }
  if (!s.out[seat] && s.again && s.jail[seat] === 0) {
    s.again = false;
    s.phase = 'roll';
    x.ev.push({ type: 'again', seat });
    return;
  }
  nextTurn(x);
}

function passStart(x: Ctx, seat: number, landed: boolean) {
  const { s } = x;
  const b = B(s);
  if (isBiz(s)) {
    s.perk[seat] = 0; // льготы — до конца круга
    if (s.premium) give(x, null, seat, b.startPay, 'премия за круг');
  } else if (s.map === 'manager' || isBm(s) || landed || s.startPass) give(x, null, seat, b.startPay, landed ? 'остановка на «Старте»' : 'проход через «Старт»');
  if (s.loan[seat] > 0) {
    s.loanLaps[seat]++;
    if (s.cash[seat] >= s.loan[seat]) {
      give(x, seat, null, s.loan[seat], 'возврат ссуды');
      s.loan[seat] = 0;
      x.ev.push({ type: 'repay', seat });
    } else if (s.loanLaps[seat] >= 2) {
      const due = s.loan[seat];
      s.loan[seat] = 0;
      if (charge(x, seat, due, null, 'возврат ссуды') === 'ok') x.ev.push({ type: 'repay', seat });
      else if (!s.out[seat]) eliminate(x, seat);
    }
  }
}

/** Шаги фишки: n > 0 — вперёд, n < 0 — назад (назад «Старт» не платит). */
function step(x: Ctx, seat: number, n: number) {
  const { s } = x;
  if (isImp(s)) {
    stepImp(x, seat, n);
    return;
  }
  const len = N(s);
  const next = B(s).next;
  const path: number[] = [];
  let p = s.pos[seat];
  const dir = n > 0 ? 1 : -1;
  for (let i = 0; i < Math.abs(n); i++) {
    // «Бизнесмен»: несколько кругов и автомагистраль — по графу; на перекрёстке останавливаются
    const q = next && dir > 0 ? next[p] : (p + dir + len) % len;
    if (q === p) break;
    p = q;
    path.push(p);
  }
  s.pos[seat] = p;
  x.ev.push({ type: 'move', seat, path });
  if (dir > 0) {
    const crossed = path.indexOf(0);
    if (crossed >= 0) passStart(x, seat, crossed === path.length - 1);
    if (isBiz(s) && path.slice(0, -1).some((c) => B(s).cells[c].kind === 'insure') && !s.ins[seat]) s.insPass = true;
  }
  if (s.out[seat]) return;
  land(x, seat);
}

function moveTo(x: Ctx, seat: number, to: number, back = false) {
  const len = B(x.s).outer ?? N(x.s);
  const from = x.s.pos[seat];
  const n = back ? -((from - to + len) % len) : (to - from + len) % len;
  if (n === 0) land(x, seat);
  else step(x, seat, n);
}

function goJail(x: Ctx, seat: number) {
  const { s } = x;
  s.pos[seat] = B(s).jail;
  s.jail[seat] = 1;
  s.again = false;
  s.doubles = 0;
  x.ev.push({ type: 'jump', seat, to: s.pos[seat] });
  x.ev.push({ type: 'jail', seat });
}

/** Штраф с учётом страховки «Космоса»: полная — не платит, половинная — платит половину. */
const insured = (s: State, seat: number, amount: number) => (s.ins[seat] === 2 ? 0 : s.ins[seat] === 1 ? Math.round(amount / 2) : amount);

function land(x: Ctx, seat: number) {
  const { s } = x;
  const b = B(s);
  const c = s.pos[seat];
  const cell = b.cells[c];
  s.phase = 'resolve';
  switch (cell.kind) {
    case 'prop': {
      const own = s.owner[c];
      // «Империя»: с «Лема» следующий ход — по малому кругу; башня — бросок кубиков
      if (cell.enter) {
        s.route[seat] = 'inner';
        x.ev.push({ type: 'flag', seat, what: 'inner' });
      }
      if (cell.util === 'tower' && own != null && own !== seat && !s.mort[c]) {
        const d = [x.rng.int(6) + 1, x.rng.int(6) + 1];
        const k = sameUtil(s, c) >= 2 ? 10 : 5;
        x.ev.push({ type: 'tower', seat, dice: d, k });
        charge(x, seat, (d[0] + d[1]) * k, own, `${cell.name}: (${d[0]} + ${d[1]}) × ${k}`);
        return;
      }
      // «Бизнесмен», супермаркет: платят все, хозяину — его доля
      if (cell.fee) {
        if (own === seat) x.ev.push({ type: 'visit', seat, cell: c });
        else if (own == null) {
          if (charge(x, seat, cell.fee, null, cell.name) === 'ok') s.phase = 'buy';
        } else if (s.mort[c]) charge(x, seat, cell.fee, null, cell.name);
        else if (charge(x, seat, cell.rents![0], own, `плата за наём: ${cell.name}`) === 'ok') charge(x, seat, cell.fee - cell.rents![0], null, cell.name);
        return;
      }
      if (own == null) s.phase = 'buy';
      else if (own === -1) {
        if (charge(x, seat, cell.rents![0], null, `посадка на ${cell.name}`) !== 'ok') return;
        if (s.cash[seat] >= cell.price! + 100) s.phase = 'bankBuy';
      } else if (own !== seat) {
        const r = rent(s, c);
        if (r > 0) charge(x, seat, r, own, `плата за наём: ${cell.name}`);
        else x.ev.push({ type: 'visit', seat, cell: c });
      }
      return;
    }
    case 'card':
      draw(x, seat, cell.deck!);
      return;
    case 'lottery':
      if (charge(x, seat, cell.amount!, null, 'лотерейный билет') === 'ok') draw(x, seat, cell.deck!);
      return;
    case 'exchange':
      s.phase = 'exchange';
      return;
    case 'tax':
      payTax(x, seat);
      return;
    case 'money':
      if (cell.amount! > 0) give(x, null, seat, cell.amount!, cell.name);
      else charge(x, seat, -cell.amount!, null, cell.name);
      if (cell.shares && s.phase === 'resolve') openPick(x, { n: cell.shares, mode: 'gift' });
      return;
    case 'stocks':
      openStocks(x, false);
      return;
    case 'gift':
      // 3-я клетка автомагистрали — ещё и биржа
      openPick(x, { n: cell.shares!, mode: 'gift', stocks: cell.name !== 'Подарок' });
      return;
    case 'broker':
    case 'bank':
    case 'hotel':
    case 'customs':
    case 'customsIn':
    case 'roulette':
    case 'cross':
      s.used = 0;
      s.back = false;
      s.phase = 'hub';
      return;
    case 'clinic':
      s.wait[seat] = 2;
      x.ev.push({ type: 'wait', seat, n: 2 });
      charge(x, seat, 30000, null, 'лечение в клинике «Стоп»');
      return;
    case 'halfcash':
      charge(x, seat, Math.floor(s.cash[seat] / 2 / 100) * 100, null, 'неудача на автомагистрали');
      return;
    case 'road':
      return;
    case 'collapse':
      // сразу ещё на вдвое больше клеток, чем только что прошёл
      if (s.lastMove > 0) step(x, seat, 2 * s.lastMove);
      return;
    case 'anabiosis':
      s.wait[seat] = 3;
      x.ev.push({ type: 'wait', seat, n: 3 });
      return;
    case 'zone':
      s.zoneLeft = 3;
      return;
    case 'chrono': {
      const cells = s.mort.flatMap((m, i) => (m ? [i] : []));
      for (const i of cells) {
        s.owner[i] = null;
        s.mort[i] = false;
      }
      x.ev.push({ type: 'chrono', cells });
      return;
    }
    case 'swap':
      charge(x, seat, IMP_SWAP_FEE, null, 'обмен разумов');
      if (s.out[seat]) return;
      s.swaps[seat]++;
      if (s.swaps[seat] >= 3) {
        s.swaps[seat] = 0;
        const nb = leftOf(s, seat);
        if (nb != null && s.phase === 'resolve') swapAll(x, seat, nb);
      }
      return;
    case 'nullpass':
      s.route[seat] = 'sub';
      x.ev.push({ type: 'flag', seat, what: 'sub' });
      return;
    case 'antimir':
      s.rev[seat] = true;
      x.ev.push({ type: 'flag', seat, what: 'rev' });
      return;
    case 'cosmodrome':
    case 'sector':
      return;
    case 'gojail':
      goJail(x, seat);
      return;
    case 'jail':
    case 'rest':
    case 'start':
      x.ev.push({ type: 'visit', seat, cell: c });
      return;
    case 'casino':
      if (!s.freeCasino && charge(x, seat, 50, null, 'место в казино') !== 'ok') return;
      s.freeCasino = false;
      s.phase = 'casino';
      return;
    case 'hole':
    case 'police':
      if (s.ins[seat] === 2) x.ev.push({ type: 'visit', seat, cell: c });
      else charge(x, seat, insured(s, seat, cell.kind === 'hole' ? 500 : 250), null, cell.kind === 'hole' ? 'чёрная дыра' : 'полиция');
      return;
    case 'pirates': {
      if (s.ins[seat] === 2) {
        x.ev.push({ type: 'visit', seat, cell: c });
        return;
      }
      const loss = insured(s, seat, s.cash[seat]);
      give(x, seat, 'pot', loss, 'пираты');
      if (s.cash[seat] <= 0 && owned(s, seat).length === 0) brokeKosmos(x, seat);
      return;
    }
    case 'insure':
      if (isBiz(s)) {
        // «Страховое общество»: остановился — обязан застраховаться (уже застрахован — ничего)
        s.insPass = false;
        if (s.ins[seat]) x.ev.push({ type: 'visit', seat, cell: c });
        else if (charge(x, seat, INSURE, null, 'страховка') !== 'broke') {
          s.ins[seat] = 1;
          x.ev.push({ type: 'insure', seat, level: 1 });
        }
        return;
      }
      s.ins[seat] = 0;
      if (s.freeIns) {
        s.freeIns = false;
        s.ins[seat] = 2;
        x.ev.push({ type: 'insure', seat, level: 2, free: true });
        return;
      }
      s.phase = 'insure';
      return;
  }
}

function draw(x: Ctx, seat: number, deck: number) {
  const { s } = x;
  if (x.depth++ > 6) return;
  const d = s.decks[deck];
  if (!d.length) return;
  const id = d.shift()!;
  const card: Card = B(s).decks[deck].cards[id];
  s.card = { deck, id, seat };
  x.ev.push({ type: 'card', seat, deck, id });
  if (card.fx.k === 'free') {
    s.freeCards[seat].push(deck * 100 + id);
    return;
  }
  if (B(s).decks[deck].shuffle) d.splice(x.rng.int(d.length + 1), 0, id);
  else d.push(id);
  applyFx(x, seat, card);
}

/** «Бизнес»: убыток по «Шансу» — страховка отменяет один. */
const LOSS = new Set(['audit', 'repair', 'disaster']);

function applyFx(x: Ctx, seat: number, card: Card) {
  const { s } = x;
  const b = B(s);
  const fx = card.fx;
  // «Империя»: неразменный пятак прощает штраф
  if (isImp(s) && s.pyatak[seat] > 0 && fx.k === 'cash' && fx.n < 0) {
    s.pyatak[seat]--;
    x.ev.push({ type: 'saved', seat });
    return;
  }
  if (isBiz(s) && s.ins[seat] && (LOSS.has(fx.k) || (fx.k === 'cash' && fx.n < 0))) {
    s.ins[seat] = 0;
    x.ev.push({ type: 'saved', seat });
    return;
  }
  switch (fx.k) {
    case 'cash':
      if (fx.n > 0) give(x, null, seat, fx.n, 'карточка');
      else charge(x, seat, -fx.n, null, 'карточка');
      return;
    case 'goto':
      if (fx.free) s.freeCasino = true;
      moveTo(x, seat, fx.to, fx.back);
      return;
    case 'step':
      step(x, seat, fx.n);
      return;
    case 'jail':
      goJail(x, seat);
      return;
    case 'repair': {
      const { h, e } = housesOf(s, seat);
      charge(x, seat, h * fx.h + e * fx.e, null, 'ремонт и налоги');
      return;
    }
    case 'draw':
      draw(x, seat, fx.deck);
      return;
    case 'nearest': {
      const len = b.cells.length;
      let to = s.pos[seat];
      for (let i = 1; i <= len; i++) {
        const c = (s.pos[seat] + i) % len;
        const cell = b.cells[c];
        if (cell.kind === fx.kind && (fx.deck == null || cell.deck === fx.deck)) {
          to = c;
          break;
        }
      }
      if (fx.bonus) give(x, null, seat, fx.bonus, 'доставка груза');
      if (fx.insure) s.freeIns = true;
      moveTo(x, seat, to);
      return;
    }
    case 'pot': {
      const n = Math.min(s.pot, fx.n ?? s.pot);
      if (n > 0) give(x, 'pot', seat, n, 'золото Амазонок');
      return;
    }
    case 'birthday':
      for (const p of alive(s)) if (p !== seat) charge(x, p, fx.n, seat, 'на день рождения');
      return;
    case 'skip':
      s.skip[seat] = true;
      return;
    case 'again':
      s.again = true;
      return;
    case 'police':
      charge(x, seat, insured(s, seat, fx.n), null, 'нелады с полицией');
      return;
    case 'usd':
      giveUsd(x, null, seat, fx.n, 'карточка');
      return;
    case 'perk':
      s.perk[seat] |= fx.bit;
      x.ev.push({ type: 'perk', seat, bit: fx.bit });
      return;
    case 'audit': {
      const die = x.rng.int(6) + 1;
      x.ev.push({ type: 'audit', seat, die });
      if (die % 2) charge(x, seat, fx.n, null, 'штраф налоговой проверки');
      return;
    }
    case 'income': {
      const { h, e } = housesOf(s, seat);
      give(x, null, seat, h * fx.h + e * fx.e, 'прибыль филиалов и предприятий');
      return;
    }
    case 'disaster': {
      const c = owned(s, seat)
        .filter((i) => s.houses[i] > 0 && s.houses[i] < 4)
        .sort((p, q) => b.cells[p].build! - b.cells[q].build!)[0];
      if (c == null) return;
      s.houses[c]--;
      s.stock[0]++;
      x.ev.push({ type: 'unbuild', seat, cell: c, level: s.houses[c] });
      return;
    }
    case 'freeBuild':
      freeBuild(x, seat, fx.n);
      return;
    case 'freePatent':
    case 'advance': {
      const c = nextFree(s, s.pos[seat]);
      if (c < 0) {
        if (fx.k === 'advance') give(x, null, seat, fx.n, 'карточка');
        return;
      }
      s.owner[c] = seat;
      x.ev.push({ type: 'buy', seat, cell: c, price: 0 });
      if (fx.k === 'advance') moveTo(x, seat, c);
      return;
    }
    case 'stocks':
      openStocks(x, false);
      return;
    case 'banker': {
      const n = fx.ns[x.rng.int(fx.ns.length)];
      if (n > 0) give(x, null, seat, n, 'сумму определил банкир');
      else charge(x, seat, -n, null, 'сумму определил банкир');
      return;
    }
    case 'turnover':
      charge(x, seat, Math.round(s.lastBuy[seat] / 2 / 100) * 100, null, 'налог с оборота');
      return;
    case 'buyShares':
      openPick(x, { n: fx.n, mode: 'buy' });
      return;
    case 'raise':
      if (s.shares[seat].some((k) => k > 0)) openPick(x, { n: fx.n, mode: 'raise' });
      return;
    case 'wait':
      s.wait[seat] = fx.n;
      x.ev.push({ type: 'wait', seat, n: fx.n });
      return;
    case 'nearestBase': {
      let to = s.pos[seat];
      for (let i = 1; i <= 38; i++) {
        const c = (s.pos[seat] + i) % 38;
        if (b.cells[c].util === 'base') {
          to = c;
          break;
        }
      }
      moveTo(x, seat, to);
      return;
    }
    case 'cosmodrome':
      relocate(x, seat, IMP_START);
      return;
    case 'anabiosis':
      relocate(x, seat, 9);
      s.wait[seat] = 3;
      x.ev.push({ type: 'wait', seat, n: 3 });
      return;
    case 'accel':
      s.accel[seat] = 2;
      x.ev.push({ type: 'flag', seat, what: 'accel' });
      return;
    case 'inertia':
      s.inertia[seat] = true;
      x.ev.push({ type: 'flag', seat, what: 'inertia' });
      return;
    case 'pyatak':
      s.pyatak[seat] += 2;
      x.ev.push({ type: 'flag', seat, what: 'pyatak' });
      return;
    case 'steal': {
      // «любую карточку соседа слева» — самую дорогую из тех, что можно передать
      const nb = leftOf(s, seat);
      if (nb == null) return;
      const c = owned(s, nb)
        .filter((i) => tradeable(s, nb, i))
        .sort((p, q) => b.cells[q].price! - b.cells[p].price!)[0];
      if (c == null) return;
      s.owner[c] = seat;
      x.ev.push({ type: 'steal', seat, from: nb, cell: c });
      return;
    }
    case 'annihilate': {
      const nb = leftOf(s, seat);
      if (nb == null) return;
      const c = owned(s, nb)
        .filter((i) => s.houses[i] > 0)
        .sort((p, q) => s.houses[q] - s.houses[p] || b.cells[q].price! - b.cells[p].price!)[0];
      if (c == null) return;
      s.houses[c]--;
      s.stock[0]++;
      x.ev.push({ type: 'annihilate', seat, from: nb, cell: c });
      return;
    }
    case 'none':
      return;
  }
}

/** «Империя»: сосед слева — следующий по ходу живой игрок. */
function leftOf(s: State, seat: number): number | null {
  const i = s.seats.indexOf(seat);
  for (let k = 1; k < s.seats.length; k++) {
    const p = s.seats[(i + k) % s.seats.length];
    if (!s.out[p]) return p;
  }
  return null;
}

/** «Обмен разумов»: полный обмен деньгами и имуществом с соседом. */
function swapAll(x: Ctx, a: number, b: number) {
  const { s } = x;
  [s.cash[a], s.cash[b]] = [s.cash[b], s.cash[a]];
  for (let i = 0; i < s.owner.length; i++) {
    if (s.owner[i] === a) s.owner[i] = b;
    else if (s.owner[i] === b) s.owner[i] = a;
  }
  x.ev.push({ type: 'swap', a, b });
}

/** «Империя»: ход по графу. Внешний круг по часовой; с «Лема» — в малый круг (нуль переход → обмен разумов → антимир →
 * космодром), с космодрома — на «Гомера»; после антимира малый круг — вспять. Вход на «Гомера» — полный круг, 200. */
function stepImp(x: Ctx, seat: number, n: number) {
  const { s } = x;
  const path: number[] = [];
  let p = s.pos[seat];
  let laps = 0;
  if (n < 0) {
    for (let i = 0; i < -n; i++) {
      if (p < 38) p = (p + 37) % 38;
      path.push(p);
    }
  } else {
    const route = s.route[seat];
    const rev = s.rev[seat];
    s.route[seat] = '';
    s.rev[seat] = false;
    for (let i = 0; i < n; i++) {
      let q: number;
      if (route === 'inner' && p === 37 && i === 0) q = 39;
      else if (rev && p >= 38) q = p === 41 ? 40 : p === 40 ? 39 : p === 39 ? 38 : 0;
      else q = p < 38 ? (p + 1) % 38 : p === 38 ? 0 : p === 41 ? 38 : p + 1;
      if (q === 0 && (p === 37 || p === 38)) laps++;
      p = q;
      path.push(p);
    }
  }
  s.pos[seat] = p;
  x.ev.push({ type: 'move', seat, path });
  for (let k = 0; k < laps; k++) {
    if (s.lapped[seat]) {
      give(x, null, seat, B(s).startPay, 'полный круг');
      s.inertia[seat] = false;
    }
    s.lapped[seat] = true;
  }
  if (s.out[seat]) return;
  land(x, seat);
}

/** «Империя»: по секторам подпространства по часовой, 20 за каждый; в конце — выход на планету сектора. */
function subMove(x: Ctx, seat: number, n: number) {
  const { s } = x;
  s.route[seat] = '';
  const path = Array.from({ length: n }, (_, k) => 42 + (k % 4));
  s.pos[seat] = path[path.length - 1];
  x.ev.push({ type: 'move', seat, path });
  give(x, null, seat, IMP_SUB_PAY * n, 'подпространство');
  s.phase = 'sub';
}

/** Первый ничей участок по ходу от клетки from (не считая её); -1 — нет. */
function nextFree(s: State, from: number): number {
  const len = N(s);
  for (let i = 1; i < len; i++) {
    const c = (from + i) % len;
    if (isProp(s, c) && s.owner[c] == null) return c;
  }
  return -1;
}

/** «Бизнес»: выигрыш филиалов (n) или предприятия (n = 4) — на свою монополию, самые дорогие участки; монополии нет — пропадает. */
function freeBuild(x: Ctx, seat: number, n: number) {
  const { s } = x;
  const b = B(s);
  const mono = owned(s, seat)
    .filter((c) => fullGroup(s, c))
    .sort((p, q) => b.cells[q].price! - b.cells[p].price!);
  if (n === 4) {
    const c = [...mono].sort((p, q) => s.houses[q] - s.houses[p]).find((i) => s.houses[i] < 4);
    if (c == null || s.stock[1] < 1) {
      x.ev.push({ type: 'lost', seat });
      return;
    }
    placeEnterprise(x, seat, c);
    return;
  }
  let got = 0;
  for (let k = 0; k < n; k++) {
    const c = mono.find((i) => s.houses[i] < 3);
    if (c == null || s.stock[0] < 1) break;
    s.houses[c]++;
    s.stock[0]--;
    got++;
    x.ev.push({ type: 'build', seat, cell: c, level: s.houses[c] });
  }
  if (!got) x.ev.push({ type: 'lost', seat });
}

/** «Бизнес»: валютное предприятие на участок; его филиалы переходят на другие участки монополии, лишние — банку за полцены. */
function placeEnterprise(x: Ctx, seat: number, c: number) {
  const { s } = x;
  const cell = B(s).cells[c];
  let free = s.houses[c];
  s.houses[c] = 4;
  s.stock[1]--;
  for (const i of groupCells(s, cell.group!)) {
    while (free > 0 && i !== c && s.houses[i] < 3) {
      s.houses[i]++;
      free--;
      x.ev.push({ type: 'build', seat, cell: i, level: s.houses[i] });
    }
  }
  if (free > 0) {
    s.stock[0] += free;
    give(x, null, seat, (free * cell.build!) / 2, 'филиалы проданы банку');
  }
  x.ev.push({ type: 'build', seat, cell: c, level: 4 });
}

/** Сдать банку все постройки участка за полцены (филиалы — за рубли, предприятие — за доллары). */
function unbuildAll(x: Ctx, seat: number, c: number) {
  const { s } = x;
  const cell = B(s).cells[c];
  const h = s.houses[c];
  if (h === 4) {
    s.stock[1]++;
    giveUsd(x, null, seat, cell.buildUsd! / 2, 'предприятие продано банку');
  } else {
    s.stock[0] += h;
    give(x, null, seat, (h * cell.build!) / 2, 'филиал продан банку');
  }
  s.houses[c] = 0;
  x.ev.push({ type: 'unbuild', seat, cell: c, level: 0 });
}

/** «Бизнес»: налог — 10 % недвижимости (незаложенные патенты и филиалы — в рублях, предприятия — в долларах; не хватает долларов — рублями по курсу). */
export function taxOf(s: State, seat: number): { rub: number; usd: number } {
  const b = B(s);
  let rub = 0;
  let usd = 0;
  for (const c of owned(s, seat)) {
    const cell = b.cells[c];
    if (!s.mort[c]) rub += cell.price!;
    if (s.houses[c] === 4) usd += cell.buildUsd!;
    else rub += s.houses[c] * cell.build!;
  }
  const k = s.perk[seat] & 1 ? 0 : s.perk[seat] & 2 ? TAX_RATE / 2 : TAX_RATE;
  const r = (n: number) => Math.round((n * k) / 100) * 100;
  return { rub: r(rub), usd: r(usd) };
}

function payTax(x: Ctx, seat: number) {
  const { s } = x;
  const t = taxOf(s, seat);
  if (s.perk[seat] & 1) x.ev.push({ type: 'perk', seat, bit: 1 });
  const fromUsd = Math.min(t.usd, s.usd[seat]);
  giveUsd(x, seat, null, fromUsd, 'налог');
  charge(x, seat, t.rub + (t.usd - fromUsd) * RATE, null, 'налог');
}

/** Разобрать клетку и, если решать нечего, закончить ход. */
function settle(x: Ctx) {
  if (x.s.phase === 'resolve' || (x.s.out[x.s.turn] && x.s.phase !== 'over')) finish(x);
}

function startAuction(x: Ctx, cell: number) {
  const { s } = x;
  const i = s.seats.indexOf(s.turn);
  const order: number[] = [];
  for (let k = 1; k <= s.seats.length; k++) {
    const p = s.seats[(i + k) % s.seats.length];
    if (s.out[p]) continue;
    if (p === s.turn && s.map === 'kosmos') continue;
    order.push(p);
  }
  if (!order.length) {
    endAuction(x, cell, null, 0);
    return;
  }
  s.auction = { cell, bid: 0, leader: null, order, at: 0 };
  s.phase = 'auction';
}

function endAuction(x: Ctx, cell: number, seat: number | null, price: number) {
  const { s } = x;
  s.auction = null;
  if (seat == null && isImp(s)) {
    // «Империя»: никто не купил — отказавшийся платит в фонд половину цены
    x.ev.push({ type: 'won', seat, cell, price });
    s.phase = 'resolve';
    const fine = Math.round(B(s).cells[cell].price! / 2 / 10) * 10;
    if (charge(x, s.turn, fine, null, 'штраф за отказ от покупки') !== 'debt') finish(x);
    return;
  }
  if (seat != null) {
    give(x, seat, null, price, 'торги');
    s.owner[cell] = seat;
  } else if (s.map === 'kosmos') s.owner[cell] = -1;
  x.ev.push({ type: 'won', seat, cell, price });
  s.phase = 'resolve';
  finish(x);
}

function auctionStep(x: Ctx) {
  const a = x.s.auction!;
  if (!a.order.length) return endAuction(x, a.cell, null, 0);
  if (a.order.length === 1 && a.leader === a.order[0]) return endAuction(x, a.cell, a.leader, a.bid);
  a.at %= a.order.length;
  if (a.order[a.at] === a.leader && a.order.length > 1) a.at = (a.at + 1) % a.order.length;
}

/** Долг погашен — продолжить ход. */
function debtPaid(x: Ctx) {
  const { s } = x;
  const d = s.debt!;
  const seat = s.turn;
  s.debt = null;
  give(x, seat, d.to, d.amount, 'уплата долга');
  s.phase = 'resolve';
  if (d.then === 'move' && s.dice) step(x, seat, s.dice[0] + s.dice[1]);
  settle(x);
}

// ---------------- «Бизнесмен»: биржа, клетки с выбором, рулетка ----------------

/** Сколько акций цвета c ещё в банке. */
export const bankShares = (s: State, c: number) => SHARES_TOTAL - s.seats.reduce((n, p) => n + s.shares[p][c], 0);
export const sharePrice = (s: State, c: number) => s.price[c] * POINT;
/** Фирм за рубежом у игрока — за каждую пошлина на таможне. */
export const abroadOwned = (s: State, seat: number) => owned(s, seat).filter((c) => B(s).cells[c].abroad).length;
export const ABROAD_FEE = 5000;
export const BANK_FEE = 25000;

function openStocks(x: Ctx, back: boolean) {
  const { s } = x;
  s.phase = 'stocks';
  s.back = back;
  s.bought = [0, 0, 0, 0];
  s.played = false;
}

function openPick(x: Ctx, pick: Pick) {
  x.s.pick = pick;
  x.s.phase = 'pick';
}

/** Курс после карточки: варианты (новые курсы) для карточки id при курсе price. */
export function marketOpts(price: number[], id: number): number[][] {
  const card = STOCK_CARDS[id];
  const up = (p: number, n: number) => Math.min(PRICE_MAX, p + n);
  const down = (p: number, n: number) => Math.max(1, p - n);
  const c = card.c;
  if (card.big) {
    if (card.k === 'x2') return [price.map((p, i) => (i === c ? up(p, p) : p))];
    if (card.k === 'half') return [price.map((p, i) => (i === c ? Math.max(1, Math.floor(p / 2)) : p))];
    // «10»: свой цвет +10, остальным −1, −2, −3 — как распределит игрок
    const others = [0, 1, 2, 3].filter((i) => i !== c);
    const perms = [
      [1, 2, 3],
      [1, 3, 2],
      [2, 1, 3],
      [2, 3, 1],
      [3, 1, 2],
      [3, 2, 1],
    ];
    return perms.map((pm) => price.map((p, i) => (i === c ? up(p, 10) : down(p, pm[others.indexOf(i)]))));
  }
  if (card.up) return [price.map((p, i) => (i === c ? up(p, card.a) : down(p, card.b)))];
  return [price.map((p, i) => (i === c ? down(p, card.b) : p))];
}

/** Деньги игрока p за смену курса from → to; кто менял курс (mover), на понижении получает компенсацию, а не платит. */
export function marketGain(s: State, p: number, mover: number | null, from: number[], to: number[]): number {
  let d = 0;
  for (let c = 0; c < 4; c++) {
    const dc = (to[c] - from[c]) * POINT * s.shares[p][c];
    d += p === mover ? Math.abs(dc) : dc;
  }
  return d;
}

/** Курс сменился: каждый получает (вносит) разницу × число своих акций. */
function market(x: Ctx, seat: number | null, card: number | null, to: number[]) {
  const { s } = x;
  const from = s.price.slice();
  x.ev.push({ type: 'market', seat, card, from, to: to.slice() });
  for (const p of alive(s)) {
    const d = marketGain(s, p, seat, from, to);
    if (d > 0) give(x, null, p, d, p === seat ? 'компенсация за курс акций' : 'разница курса акций');
    // штраф биржи — только наличными; нечем — банк прощает остаток
    else if (d < 0) give(x, p, null, Math.min(s.cash[p], -d), 'разница курса акций');
  }
  s.price = to.slice();
}

/** Продать банку k акций цвета c по курсу. */
function sellShares(x: Ctx, seat: number, c: number, k: number, why?: string) {
  const { s } = x;
  if (k <= 0) return;
  s.shares[seat][c] -= k;
  x.ev.push({ type: 'shares', seat, c, n: -k, price: s.price[c], why });
  give(x, null, seat, k * sharePrice(s, c), 'продажа акций');
}

function buyShares(x: Ctx, seat: number, c: number, k: number, why?: string) {
  const { s } = x;
  if (k <= 0) return;
  s.shares[seat][c] += k;
  x.ev.push({ type: 'shares', seat, c, n: k, price: s.price[c], why });
  give(x, seat, null, k * sharePrice(s, c), 'покупка акций');
}

/** Самые дешёвые акции игрока: n штук — [цвет, сколько]. */
function cheapest(s: State, seat: number, n: number): [number, number][] {
  const out: [number, number][] = [];
  for (const c of [0, 1, 2, 3].sort((a, b) => s.price[a] - s.price[b])) {
    const k = Math.min(n, s.shares[seat][c]);
    if (k > 0) out.push([c, k]);
    n -= k;
  }
  return out;
}

/** Обратная дорога через банк: четыре акции, по одной каждого цвета, пока они есть в банке. */
function homeBuy(s: State): [number, number][] {
  const want = [0, 0, 0, 0];
  let n = 4;
  for (let round = 0; round < 4 && n > 0; round++) {
    for (const c of [0, 1, 2, 3].sort((a, b) => s.price[a] - s.price[b])) {
      if (n > 0 && bankShares(s, c) > want[c]) {
        want[c]++;
        n--;
      }
    }
  }
  return want.map((k, c): [number, number] => [c, k]).filter(([, k]) => k > 0);
}
export const homeCost = (s: State) => homeBuy(s).reduce((n, [c, k]) => n + k * sharePrice(s, c), 0) + BANK_FEE;

export interface HubOpt {
  id: string;
  label: string;
  ok: boolean;
}

/** Что можно сделать на клетке с выбором. */
export function hubOpts(s: State): HubOpt[] {
  const seat = s.turn;
  const c = s.pos[seat];
  const cell = B(s).cells[c];
  const cash = s.cash[seat];
  const out: HubOpt[] = [];
  const total = s.shares[seat].reduce((a, b) => a + b, 0);
  switch (cell.kind) {
    case 'broker':
      if (!(s.used & 1)) out.push({ id: 'broker', label: 'Маклер: 1 000 — и на биржу', ok: cash >= 1000 });
      break;
    case 'bank':
      if (!(s.used & 1)) out.push({ id: 'stocks', label: 'Сыграть на бирже', ok: true });
      if (c < 40) out.push({ id: 'abroad', label: `За рубеж: 4 акции банку и ${fmt(BANK_FEE)}`, ok: total >= 4 && cash >= BANK_FEE });
      else {
        out.push({ id: 'home', label: `Домой: купить 4 акции и ${fmt(BANK_FEE)} (всего ${fmt(homeCost(s))})`, ok: cash >= homeCost(s) && homeBuy(s).length > 0 });
        out.push({ id: 'road', label: 'Домой по автомагистрали', ok: true });
      }
      break;
    case 'hotel':
      if (!(s.used & 2)) out.push({ id: 'roulette', label: 'Рулетка — три броска', ok: true });
      if (!(s.used & 1)) out.push({ id: 'stocks', label: 'Сыграть на бирже', ok: true });
      break;
    case 'customs':
      out.push({ id: 'abroad2', label: `Выехать за рубеж: ${fmt(10000)} и половина акций банку`, ok: cash >= 10000 });
      break;
    case 'customsIn': {
      const fee = ABROAD_FEE * abroadOwned(s, seat);
      out.push({ id: 'home2', label: `Вернуться домой: ${fee ? fmt(fee) + ' пошлины' : 'без пошлины'}`, ok: cash >= fee });
      break;
    }
    case 'roulette':
      if (!(s.used & 2)) out.push({ id: 'roulette', label: 'Сыграть в рулетку', ok: true });
      break;
    case 'cross':
      out.push({ id: 'exit', label: `На большой круг: пошлина ${fmt(ABROAD_FEE)}`, ok: cash >= ABROAD_FEE });
      out.push({ id: 'back', label: 'Обратно на малый круг', ok: true });
      return out;
  }
  out.push({ id: 'pass', label: 'Дальше', ok: true });
  return out;
}

/** Переезд без хода: на другой круг или с автомагистрали. */
function relocate(x: Ctx, seat: number, to: number) {
  x.s.pos[seat] = to;
  x.s.route[seat] = '';
  x.s.rev[seat] = false;
  x.ev.push({ type: 'jump', seat, to });
}

function hubAct(x: Ctx, seat: number, id: string): boolean {
  const { s } = x;
  const opt = hubOpts(s).find((o) => o.id === id);
  if (!opt || !opt.ok) return false;
  const ev = (cost: number) => x.ev.push({ type: 'hub', seat, opt: id, cost });
  s.phase = 'resolve';
  switch (id) {
    case 'pass':
      break;
    case 'stocks':
      s.used |= 1;
      openStocks(x, true);
      return true;
    case 'broker':
      s.used |= 1;
      ev(1000);
      give(x, seat, null, 1000, 'услуга маклера');
      openStocks(x, false);
      return true;
    case 'roulette':
      s.used |= 2;
      s.rl = -1;
      s.rlLeft = B(s).cells[s.pos[seat]].kind === 'hotel' ? 3 : -1;
      s.back = s.rlLeft > 0;
      s.phase = 'roulette';
      ev(0);
      return true;
    case 'abroad':
      ev(BANK_FEE);
      for (const [c, k] of cheapest(s, seat, 4)) sellShares(x, seat, c, k, 'переход границы');
      relocate(x, seat, 52);
      charge(x, seat, BANK_FEE, null, 'переход границы через банк');
      break;
    case 'home':
      ev(BANK_FEE);
      for (const [c, k] of homeBuy(s)) buyShares(x, seat, c, k, 'переход границы');
      relocate(x, seat, 25);
      charge(x, seat, BANK_FEE, null, 'переход границы через банк');
      break;
    case 'road':
      ev(0);
      relocate(x, seat, 56);
      break;
    case 'abroad2':
      ev(10000);
      for (let c = 0; c < 4; c++) sellShares(x, seat, c, Math.floor(s.shares[seat][c] / 2), 'таможня');
      relocate(x, seat, 41);
      charge(x, seat, 10000, null, 'таможня');
      break;
    case 'home2': {
      const fee = ABROAD_FEE * abroadOwned(s, seat);
      ev(fee);
      relocate(x, seat, 31);
      charge(x, seat, fee, null, 'пошлина на таможне');
      break;
    }
    case 'exit':
      ev(ABROAD_FEE);
      relocate(x, seat, 36);
      charge(x, seat, ABROAD_FEE, null, 'пошлина на перекрёстке');
      break;
    case 'back':
      ev(0);
      relocate(x, seat, 45);
      break;
  }
  settle(x);
  return true;
}

/** Вернуться с биржи или рулетки: к выбору на клетке или закончить ход. */
function leave(x: Ctx) {
  const { s } = x;
  s.rl = -1;
  s.rlLeft = 0;
  if (s.back && !s.out[s.turn]) {
    s.back = false;
    s.phase = 'hub';
    return;
  }
  s.back = false;
  s.phase = 'resolve';
  finish(x);
}

function stocksAct(x: Ctx, seat: number, a: Action): boolean {
  const { s } = x;
  if (a.type === 'pass') {
    leave(x);
    return true;
  }
  if (a.type === 'shares') {
    const c = a.c;
    const n = Math.round(Number(a.n));
    if (!Number.isInteger(c) || c < 0 || c > 3 || !n) return false;
    if (n > 0) {
      if (s.shares[seat][c] + n > SHARES_BUY_CAP || n > bankShares(s, c) || s.cash[seat] < n * sharePrice(s, c)) return false;
      buyShares(x, seat, c, n);
      s.bought[c] += n;
    } else {
      if (s.shares[seat][c] < -n) return false;
      sellShares(x, seat, c, -n);
    }
    return true;
  }
  if (a.type === 'play') {
    const i = a.card;
    if (s.played || !Number.isInteger(i) || i < 0 || i >= s.hand[seat].length) return false;
    const id = s.hand[seat][i];
    const opts = marketOpts(s.price, id);
    if (!Number.isInteger(a.opt) || a.opt < 0 || a.opt >= opts.length) return false;
    // сыгранная карточка — под низ своей колоды, взамен — верхняя оттуда же
    const deck = id < BIG_CARDS ? s.sbig : s.ssmall;
    deck.push(id);
    s.hand[seat][i] = deck.shift()!;
    s.played = true;
    market(x, seat, id, opts[a.opt]);
    return true;
  }
  return false;
}

function rouletteAct(x: Ctx, seat: number, a: Action): boolean {
  const { s } = x;
  if (a.type === 'pass') {
    if (s.rl < 0 || !ROULETTE[s.rl].out) return false;
    leave(x);
    return true;
  }
  if (a.type !== 'roulette') return false;
  let at = s.rl;
  if (at < 0) {
    const e = a.entry;
    if (typeof e !== 'number' || !Number.isInteger(e) || !ROULETTE[e]?.in) return false;
    at = e;
  }
  const d1 = x.rng.int(6) + 1;
  const d2 = x.rng.int(6) + 1;
  s.dice = [d1, d2];
  at = (at + d1 + d2) % ROULETTE.length;
  s.rl = at;
  if (s.rlLeft > 0) s.rlLeft--;
  const sec = ROULETTE[at];
  x.ev.push({ type: 'roulette', seat, dice: [d1, d2], sector: at, amount: sec.v });
  if (sec.bank) {
    give(x, null, seat, sec.v, 'рулетка: «В банк»');
    leave(x);
    return true;
  }
  let r: ReturnType<typeof charge> = 'ok';
  if (sec.v > 0) give(x, null, seat, sec.v, 'выигрыш в рулетку');
  else r = charge(x, seat, -sec.v, null, 'проигрыш в рулетку');
  if (r !== 'ok') {
    // долг или разорение — из рулетки выходят
    s.rl = -1;
    s.rlLeft = 0;
    s.back = false;
    if (r === 'broke') settle(x);
    return true;
  }
  if (s.rlLeft === 0) leave(x);
  return true;
}

function pickAct(x: Ctx, seat: number, a: Action): boolean {
  const { s } = x;
  const pk = s.pick!;
  if (a.type !== 'pick' || !Number.isInteger(a.c) || a.c < 0 || a.c > 3) return false;
  const c = a.c;
  if (pk.mode === 'raise') {
    if (!s.shares[seat][c]) return false;
    market(x, null, null, s.price.map((p, i) => (i === c ? Math.min(PRICE_MAX, p + pk.n) : p)));
  } else {
    let k = Math.min(pk.n, bankShares(s, c));
    if (pk.mode === 'buy') k = Math.min(k, Math.floor(s.cash[seat] / sharePrice(s, c)));
    if (pk.mode === 'gift') {
      if (k > 0) {
        s.shares[seat][c] += k;
        x.ev.push({ type: 'shares', seat, c, n: k, price: 0, why: 'выигрыш' });
      }
    } else buyShares(x, seat, c, k, 'по карточке');
  }
  s.pick = null;
  if (pk.stocks) openStocks(x, false);
  else {
    s.phase = 'resolve';
    settle(x);
  }
  return true;
}

// ---------------- проверка и применение действия ----------------

export function toAct(s: State): number[] {
  if (s.result || s.phase === 'over') return [];
  if (s.phase === 'auction' && s.auction) return [s.auction.order[s.auction.at]];
  if (s.phase === 'offer' && s.offer) return [s.offer.to];
  return [s.turn];
}

const OPS = new Set(['build', 'sell', 'mortgage', 'redeem', 'sellBank', 'offer']);

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (!a || typeof a !== 'object' || s0.result || s0.out[seat]) return null;
  if (!toAct(s0).includes(seat)) return null;
  const s = clone(s0);
  const x: Ctx = { s, ev: [], rng, depth: 0 };
  const b = B(s);
  const cell = (c: unknown) => (typeof c === 'number' && Number.isInteger(c) && c >= 0 && c < b.cells.length ? c : -1);
  const ok = () => ({ state: s, events: x.ev });

  // «Бизнес»: валютная биржа — купить (usd > 0) или продать доллары по курсу; при долге — только продать
  if (a.type === 'exchange') {
    const n = Math.round(Number(a.usd));
    if (!isBiz(s) || seat !== s.turn || !n || n % 50) return null;
    if (s.phase !== 'exchange' && !(s.phase === 'debt' && n < 0)) return null;
    if (n > 0 ? s.cash[seat] < n * RATE : s.usd[seat] < -n) return null;
    if (n > 0) {
      give(x, seat, null, n * RATE, 'покупка долларов');
      giveUsd(x, null, seat, n, 'покупка долларов');
    } else {
      giveUsd(x, seat, null, -n, 'продажа долларов');
      give(x, null, seat, -n * RATE, 'продажа долларов');
    }
    x.ev.push({ type: 'exchange', seat, usd: n });
    if (s.phase === 'debt' && s.debt && s.cash[seat] >= s.debt.amount) debtPaid(x);
    return ok();
  }

  // «Бизнесмен»: при долге акции можно продать банку
  if (a.type === 'shares' && s.phase === 'debt') {
    const c = a.c;
    const n = Math.round(Number(a.n));
    if (!isBm(s) || seat !== s.turn || !Number.isInteger(c) || c < 0 || c > 3 || n >= 0 || s.shares[seat][c] < -n) return null;
    sellShares(x, seat, c, -n);
    if (s.debt && s.cash[seat] >= s.debt.amount) debtPaid(x);
    return ok();
  }

  // операции с имуществом: свой ход до броска, при покупке и при долге
  if (OPS.has(a.type)) {
    const can = s.phase === 'roll' || s.phase === 'buy' || (s.phase === 'debt' && (a.type === 'sell' || a.type === 'mortgage'));
    if (!can || seat !== s.turn) return null;
    switch (a.type) {
      case 'build': {
        const c = cell(a.cell);
        if (c < 0 || s.phase === 'debt' || !canBuild(s, seat, c)) return null;
        const cost = b.cells[c].build!;
        if (isImp(s)) {
          s.stock[0]--;
          s.houses[c]++;
          give(x, seat, null, cost, 'ракета');
          x.ev.push({ type: 'build', seat, cell: c, level: s.houses[c] });
          return ok();
        }
        if (isBm(s)) {
          if (s.houses[c] === 1) {
            s.stock[1]--;
            s.stock[0]++;
            s.houses[c] = 4;
          } else {
            s.stock[0]--;
            s.houses[c] = 1;
          }
          give(x, seat, null, cost, s.houses[c] === 4 ? 'предприятие' : 'филиал');
          x.ev.push({ type: 'build', seat, cell: c, level: s.houses[c] });
          return ok();
        }
        if (isBiz(s)) {
          if (s.houses[c] === 3) {
            giveUsd(x, seat, null, b.cells[c].buildUsd!, 'предприятие');
            placeEnterprise(x, seat, c);
          } else {
            s.stock[0]--;
            s.houses[c]++;
            give(x, seat, null, cost, 'филиал');
            x.ev.push({ type: 'build', seat, cell: c, level: s.houses[c] });
          }
          return ok();
        }
        if (s.houses[c] === 3) {
          s.stock[1]--;
          s.stock[0] += 3;
        } else s.stock[0]--;
        s.houses[c]++;
        give(x, seat, null, cost, s.houses[c] === 4 ? 'предприятие' : 'филиал');
        x.ev.push({ type: 'build', seat, cell: c, level: s.houses[c] });
        return ok();
      }
      case 'sell': {
        const c = cell(a.cell);
        if (c < 0 || !canSell(s, seat, c)) return null;
        const half = b.cells[c].build! / 2;
        if (isImp(s)) {
          s.houses[c]--;
          s.stock[0]++;
          give(x, null, seat, half, 'ракета продана банку');
        } else if (isBm(s)) {
          if (s.houses[c] === 4) {
            s.stock[1]++;
            if (s.stock[0] >= 1) {
              s.stock[0]--;
              s.houses[c] = 1;
              give(x, null, seat, half, 'предприятие продано банку');
            } else {
              s.houses[c] = 0;
              give(x, null, seat, half * 2, 'предприятие продано банку');
            }
          } else {
            s.houses[c] = 0;
            s.stock[0]++;
            give(x, null, seat, half, 'филиал продан банку');
          }
        } else if (isBiz(s)) {
          if (s.houses[c] === 4) {
            s.houses[c] = 0;
            s.stock[1]++;
            giveUsd(x, null, seat, b.cells[c].buildUsd! / 2, 'предприятие продано банку');
          } else {
            s.houses[c]--;
            s.stock[0]++;
            give(x, null, seat, half, 'филиал продан банку');
          }
        } else if (s.houses[c] === 4) {
          const k = Math.min(3, s.stock[0]);
          s.stock[1]++;
          s.stock[0] -= k;
          s.houses[c] = k;
          give(x, null, seat, half * (1 + 3 - k), 'предприятие продано банку');
        } else {
          s.houses[c]--;
          s.stock[0]++;
          give(x, null, seat, half, 'филиал продан банку');
        }
        x.ev.push({ type: 'unbuild', seat, cell: c, level: s.houses[c] });
        break;
      }
      case 'mortgage': {
        const c = cell(a.cell);
        if (c < 0 || !canMortgage(s, seat, c)) return null;
        s.mort[c] = true;
        give(x, null, seat, b.cells[c].price! / 2, 'залог');
        x.ev.push({ type: 'mortgage', seat, cell: c, on: true });
        break;
      }
      case 'redeem': {
        const c = cell(a.cell);
        if (c < 0 || s.phase === 'debt' || !canRedeem(s, seat, c)) return null;
        s.mort[c] = false;
        give(x, seat, null, redeemCost(s, c), 'выкуп из залога');
        x.ev.push({ type: 'mortgage', seat, cell: c, on: false });
        return ok();
      }
      case 'sellBank': {
        const c = cell(a.cell);
        if (c < 0 || s.map !== 'kosmos' || s.owner[c] !== seat || s.phase === 'debt') return null;
        sellToBank(x, seat, c);
        return ok();
      }
      case 'offer': {
        if (s.phase !== 'roll' || s.offers >= MAX_OFFERS) return null;
        const o = validOffer(s, seat, a);
        if (!o) return null;
        s.offers++;
        s.offer = { ...o, back: s.phase };
        s.phase = 'offer';
        x.ev.push({ type: 'offer', offer: s.offer });
        return ok();
      }
    }
    // продажа/залог при долге: хватило — платим и идём дальше
    if (s.phase === 'debt' && s.debt && s.cash[seat] >= s.debt.amount) debtPaid(x);
    return ok();
  }

  switch (s.phase) {
    case 'roll': {
      if (a.type === 'payJail') {
        if (s.map !== 'manager' || !s.jail[seat] || s.cash[seat] < 500) return null;
        give(x, seat, null, 500, 'выход с биржи');
        s.jail[seat] = 0;
        x.ev.push({ type: 'free', seat, how: 'pay' });
        return ok();
      }
      if (a.type === 'useCard') {
        if (!s.jail[seat] || !s.freeCards[seat].length) return null;
        const code = s.freeCards[seat].shift()!;
        s.decks[Math.floor(code / 100)].push(code % 100);
        s.jail[seat] = 0;
        x.ev.push({ type: 'free', seat, how: 'card' });
        return ok();
      }
      if (a.type !== 'roll') return null;
      s.card = null;
      s.phase = 'resolve';
      if (isImp(s)) {
        // «Империя»: дубль — ещё ход; инерциоид — ещё пара кубиков; ускорение — вдвое
        const d1 = rng.int(6) + 1;
        const d2 = rng.int(6) + 1;
        s.dice = [d1, d2];
        x.ev.push({ type: 'roll', seat, dice: [d1, d2] });
        s.again = d1 === d2;
        let n = d1 + d2;
        if (s.inertia[seat]) {
          const d3 = rng.int(6) + 1;
          const d4 = rng.int(6) + 1;
          x.ev.push({ type: 'roll', seat, dice: [d3, d4] });
          if (d3 === d4) s.again = true;
          n += d3 + d4;
        }
        if (s.accel[seat] > 0) {
          n *= 2;
          s.accel[seat]--;
        }
        s.lastMove = n;
        if (s.route[seat] === 'sub') subMove(x, seat, n);
        else step(x, seat, n);
        settle(x);
        return ok();
      }
      if (isBm(s)) {
        // «Бизнесмен»: два кубика, дубль 3:3 — ещё и биржа в конце хода
        const d1 = rng.int(6) + 1;
        const d2 = rng.int(6) + 1;
        s.dice = [d1, d2];
        s.bonus = d1 === 3 && d2 === 3;
        x.ev.push({ type: 'roll', seat, dice: [d1, d2] });
        step(x, seat, d1 + d2);
        settle(x);
        return ok();
      }
      if (isBiz(s)) {
        // «Бизнес»: два кубика, дублей и биржи-тюрьмы нет
        const d1 = rng.int(6) + 1;
        const d2 = rng.int(6) + 1;
        s.dice = [d1, d2];
        x.ev.push({ type: 'roll', seat, dice: [d1, d2] });
        step(x, seat, d1 + d2);
        settle(x);
        return ok();
      }
      if (s.map === 'kosmos') {
        const d = rng.int(6) + 1;
        s.dice = [d];
        x.ev.push({ type: 'roll', seat, dice: [d] });
        step(x, seat, d);
        settle(x);
        return ok();
      }
      const d1 = rng.int(6) + 1;
      const d2 = rng.int(6) + 1;
      s.dice = [d1, d2];
      x.ev.push({ type: 'roll', seat, dice: [d1, d2] });
      const dbl = d1 === d2;
      if (s.jail[seat]) {
        if (dbl) {
          s.jail[seat] = 0;
          x.ev.push({ type: 'free', seat, how: 'double' });
          step(x, seat, d1 + d2);
          settle(x);
          return ok();
        }
        s.jail[seat]++;
        if (s.jail[seat] <= 3) {
          x.ev.push({ type: 'stay', seat });
          finish(x);
          return ok();
        }
        s.jail[seat] = 0;
        x.ev.push({ type: 'free', seat, how: 'forced' });
        s.phase = 'resolve';
        const r = charge(x, seat, 500, null, 'выход с биржи', 'move');
        if (r === 'ok') step(x, seat, d1 + d2);
        if (r !== 'debt') settle(x);
        return ok();
      }
      if (dbl) {
        s.doubles++;
        if (s.doubles >= 3) {
          goJail(x, seat);
          finish(x);
          return ok();
        }
        s.again = true;
      } else s.again = false;
      step(x, seat, d1 + d2);
      settle(x);
      return ok();
    }
    case 'buy': {
      const c = s.pos[seat];
      const price = b.cells[c].price!;
      if (a.type === 'buy') {
        if (s.cash[seat] < price) return null;
        give(x, seat, null, price, 'покупка');
        s.owner[c] = seat;
        s.lastBuy[seat] = price;
        x.ev.push({ type: 'buy', seat, cell: c, price });
        s.phase = 'resolve';
        finish(x);
        return ok();
      }
      if (a.type !== 'pass') return null;
      x.ev.push({ type: 'decline', seat, cell: c });
      // «Бизнесмен»: торгов нет — участок остаётся ничьим
      if (isBm(s)) {
        s.phase = 'resolve';
        finish(x);
        return ok();
      }
      startAuction(x, c);
      return ok();
    }
    case 'auction': {
      const au = s.auction!;
      if (a.type === 'bid') {
        const n = Math.round(Number(a.amount));
        const min = au.bid ? au.bid + b.step : b.step;
        if (!Number.isFinite(n) || n < min || n > s.cash[seat] || n % b.step) return null;
        // «Империя»: отказавшийся вступает в торги, только когда цена выше номинала
        if (isImp(s) && seat === s.turn && n <= b.cells[au.cell].price!) return null;
        au.bid = n;
        au.leader = seat;
        au.at = (au.at + 1) % au.order.length;
        x.ev.push({ type: 'bid', seat, amount: n });
      } else if (a.type === 'fold') {
        au.order.splice(au.at, 1);
        x.ev.push({ type: 'fold', seat });
      } else return null;
      auctionStep(x);
      return ok();
    }
    case 'offer': {
      const o = s.offer!;
      if (a.type !== 'accept' && a.type !== 'reject') return null;
      s.offer = null;
      s.phase = o.back;
      if (a.type === 'accept') {
        if (!validOffer(s, o.from, o)) {
          x.ev.push({ type: 'deal', from: o.from, to: o.to, ok: false });
          return ok();
        }
        for (const c of o.give) s.owner[c] = o.to;
        for (const c of o.get) s.owner[c] = o.from;
        if (o.cash > 0) give(x, o.from, o.to, o.cash, 'сделка');
        if (o.cash < 0) give(x, o.to, o.from, -o.cash, 'сделка');
        for (let k = 0; k < Math.abs(o.cards); k++) {
          const [p, q] = o.cards > 0 ? [o.from, o.to] : [o.to, o.from];
          s.freeCards[q].push(s.freeCards[p].shift()!);
        }
      }
      x.ev.push({ type: 'deal', from: o.from, to: o.to, ok: a.type === 'accept' });
      return ok();
    }
    case 'debt': {
      if (a.type !== 'bankrupt') return null;
      bankruptManager(x, seat);
      if (!s.result) nextTurn(x);
      return ok();
    }
    case 'insure': {
      const lv = a.type === 'insure' ? a.level : -1;
      if (lv !== 0 && lv !== 1 && lv !== 2) return null;
      if (isBiz(s) && lv === 2) return null;
      const cost = isBiz(s) ? [0, INSURE][lv] : [0, 100, 250][lv];
      if (s.cash[seat] < cost) return null;
      give(x, seat, null, cost, 'страховка');
      s.ins[seat] = lv;
      x.ev.push({ type: 'insure', seat, level: lv });
      s.phase = 'resolve';
      finish(x);
      return ok();
    }
    case 'casino':
    case 'casino2': {
      if (s.phase === 'casino2' && a.type === 'pass') {
        s.phase = 'resolve';
        finish(x);
        return ok();
      }
      if (a.type !== 'spin') return null;
      const die = rng.int(6) + 1;
      const sector = s.phase === 'casino' ? die : die + 6;
      const amount = CASINO[sector - 1];
      const star = s.phase === 'casino' && CASINO_STAR[die - 1];
      x.ev.push({ type: 'casino', seat, die, sector, amount, star });
      s.phase = 'resolve';
      let r: ReturnType<typeof charge> = 'ok';
      if (amount > 0) give(x, null, seat, amount, 'выигрыш в казино');
      else r = charge(x, seat, -amount, null, 'проигрыш в казино');
      if (s.phase === 'resolve' && r === 'ok' && star) s.phase = 'casino2';
      settle(x);
      return ok();
    }
    case 'exchange': {
      if (a.type !== 'pass') return null;
      s.phase = 'resolve';
      finish(x);
      return ok();
    }
    case 'sub': {
      // выход из подпространства на одну из планет сектора
      const exits = b.cells[s.pos[seat]].exits ?? [];
      if (a.type !== 'exit' || !exits.includes(a.cell)) return null;
      relocate(x, seat, a.cell);
      x.ev.push({ type: 'exit', seat, cell: a.cell });
      land(x, seat);
      settle(x);
      return ok();
    }
    case 'stocks':
      return stocksAct(x, seat, a) ? ok() : null;
    case 'hub':
      return a.type === 'hub' && hubAct(x, seat, a.opt) ? ok() : null;
    case 'roulette':
      return rouletteAct(x, seat, a) ? ok() : null;
    case 'pick':
      return pickAct(x, seat, a) ? ok() : null;
    case 'bankBuy': {
      const c = s.pos[seat];
      s.phase = 'resolve';
      if (a.type === 'buy') {
        const price = b.cells[c].price! + 100;
        if (s.cash[seat] < price) return null;
        give(x, seat, null, price, 'выкуп планеты у банка');
        s.owner[c] = seat;
        x.ev.push({ type: 'buy', seat, cell: c, price });
      } else if (a.type !== 'pass') return null;
      finish(x);
      return ok();
    }
  }
  return null;
}

function validOffer(s: State, from: number, a: { to: number; give: number[]; get: number[]; cash: number; cards: number }): Omit<Offer, 'back'> | null {
  const to = a.to;
  if (typeof to !== 'number' || to === from || !s.seats.includes(to) || s.out[to]) return null;
  if (!Array.isArray(a.give) || !Array.isArray(a.get)) return null;
  const giveC = [...new Set(a.give.map(Number))];
  const getC = [...new Set(a.get.map(Number))];
  if (!giveC.every((c) => tradeable(s, from, c)) || !getC.every((c) => tradeable(s, to, c))) return null;
  const cash = Math.round(Number(a.cash) || 0);
  const cards = Math.round(Number(a.cards) || 0);
  if (cash > s.cash[from] || -cash > s.cash[to]) return null;
  if (cards > s.freeCards[from].length || -cards > s.freeCards[to].length) return null;
  if (!giveC.length && !getC.length) return null;
  if (!giveC.length && cash <= 0 && cards <= 0) return null;
  if (!getC.length && cash >= 0 && cards >= 0) return null;
  return { from, to, give: giveC, get: getC, cash, cards };
}

/** Что видит игрок: всё, кроме порядка карточек в колодах и чужих карточек биржи. */
export function view(s: State, seats: number[] = []): State {
  return { ...s, decks: [], deckLen: s.decks.map((d) => d.length), sbig: [], ssmall: [], hand: s.hand.map((h, i) => (seats.includes(i) ? h.slice() : h.map(() => -1))) };
}
