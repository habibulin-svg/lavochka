/* Бридж — правила (без DOM). Четверо, пары: 0 и 2 (Юг–Север, «мы») против 1 и 3 (Запад–Восток, «они»). 52 карты по 13.
 *
 * Торговля: заявка «уровень + деноминация» (♣ < ♦ < ♥ < ♠ < БК), каждая следующая старше; пас; контра на заявку противника,
 * реконтра на контру. Три паса после заявки — контракт; четыре паса сразу — сдача без игры. Разыгрывающий — тот из пары,
 * кто первым назвал деноминацию контракта; его партнёр — болван: после первого хода его карты открыты, ими ходит разыгрывающий.
 * Розыгрыш: в масть обязательно, взятку берёт старший козырь или старшая карта масти захода. Первым ходит сосед слева
 * от разыгрывающего.
 *
 * Счёт: за взятки сверх шести — ♣♦ 20, ♥♠ 30, БК 40 за первую и 30 за остальные; контра ×2, реконтра ×4.
 *   Роббер: очки за взятки контракта — «под черту», 100 под чертой — гейм; кто взял два гейма — роббер (+700, или +500 при 2:1);
 *   остальное (сверхвзятки, штрафы, премии за шлем и за сыгранную контру) — «над чертой». Взявший гейм — в зоне.
 *   Гонор (только роббер): четыре из пяти старших козырей (Т К Д В 10) в одной руке — 100, все пять — 150, в бескозырке четыре туза — 150;
 *   пишется над чертой той стороне, у кого эта рука (хоть у защиты, хоть у болвана).
 *   Чикаго: 4 сдачи — первая без зоны, вторая и третья в зоне сдающий, четвёртая обе; гейм +300/+500, частичка +50.
 *   Спортивный: та же сдача играется «за другим столом» ботами; разница переводится в IMP.
 *   Мини-бридж: без торговли — открывают очки силы, пара с большим числом очков играет, разыгрывающий (с большими очками в паре)
 *   сам выбирает козырь и «гейм или частичку»; счёт как в Чикаго, без зоны.
 * Недобор: без контры 50 / в зоне 100 за взятку; с контрой вне зоны 100, 200, 200, далее по 300, в зоне 200, далее по 300;
 * реконтра — вдвое. Шлем малый 500/750, большой 1000/1500. Сыгранная контра +50, реконтра +100.
 */
import type { Options, Rng } from '../../core/types';
import { sameCard, type Card, type Suit } from '../../cards/deck';
import { shuffle } from '../../core/rng';

export type Strain = 'C' | 'D' | 'H' | 'S' | 'N';
export const STRAINS: Strain[] = ['C', 'D', 'H', 'S', 'N'];
export type Format = 'rubber' | 'chicago' | 'duplicate' | 'mini';

export interface Cfg {
  format: Format;
  /** Спортивный и мини: сколько сдач. Чикаго: сколько кругов по 4. */
  boards: number;
}

export function cfgFrom(o: Options): Cfg {
  const format: Format = o.format === 'chicago' || o.format === 'duplicate' || o.format === 'mini' ? o.format : 'rubber';
  const b = Number(o.boards);
  return { format, boards: [4, 8, 12, 16].includes(b) ? b : format === 'duplicate' ? 8 : 4 };
}

export type Call = { type: 'bid'; level: number; strain: Strain } | { type: 'pass' } | { type: 'double' } | { type: 'redouble' };
export interface CallRec {
  seat: number;
  call: Call;
  /** Пояснение (для журнала): что заявка значит. */
  note?: string;
}

export interface Contract {
  level: number;
  strain: Strain;
  /** 0 — без контры, 1 — контра, 2 — реконтра. */
  dbl: number;
  declarer: number;
}

export interface BoardResult {
  board: number;
  contract: Contract | null;
  tricks: number;
  /** Очки паре 0 (Юг–Север), отрицательные — паре 1. */
  score: number;
  /** Спортивный: результат другого стола и IMP паре 0. */
  other?: { contract: Contract | null; tricks: number; score: number };
  imp?: number;
  vul: [boolean, boolean];
}

export interface State {
  cfg: Cfg;
  seats: number[];
  hands: Card[][];
  /** Сдача целиком — для другого стола и итогового показа. */
  deal: Card[][];
  dealer: number;
  board: number;
  phase: 'auction' | 'mini' | 'play' | 'over';
  turn: number;
  calls: CallRec[];
  contract: Contract | null;
  dummy: number;
  /** Болван открыт (после первого хода). */
  dummyUp: boolean;
  trick: { seat: number; card: Card }[];
  tricks: [number, number];
  /** Кто не дал масть (для ботов): seat → масти, которых нет. */
  voids: Suit[][];
  played: Card[];
  results: BoardResult[];
  /** Роббер: очки под чертой текущего гейма, геймы, итого над и под. */
  below: [number, number];
  games: [number, number];
  above: [number, number];
  total: [number, number];
  rubbers: number;
  /** Мини-бридж: очки силы рук (открыты всем). */
  hcp: number[];
}

export type Action = Call | { type: 'play'; card: Card } | { type: 'mini'; level: number; strain: Strain };

export type Event =
  | { type: 'deal'; board: number; dealer: number; vul: [boolean, boolean]; hands?: Card[][] }
  | { type: 'call'; seat: number; call: Call; note?: string }
  | { type: 'contract'; contract: Contract | null }
  | { type: 'play'; seat: number; card: Card }
  | { type: 'trick'; seat: number; cards: Card[] }
  | { type: 'result'; result: BoardResult }
  | { type: 'rubber'; winner: number; bonus: number }
  | { type: 'honours'; side: number; pts: number }
  | { type: 'end'; total: [number, number] };

export const partner = (p: number) => (p + 2) % 4;
export const side = (p: number) => p % 2;
export const next = (p: number) => (p + 1) % 4;
export const hcpOf = (h: Card[]) => h.reduce((a, c) => a + (c.r > 10 ? c.r - 10 : 0), 0);
export const strainRank = (s: Strain) => STRAINS.indexOf(s);
export const bidRank = (level: number, strain: Strain) => (level - 1) * 5 + strainRank(strain);

/** Зона пар в этой сдаче. */
export function vulnerable(s: State): [boolean, boolean] {
  if (s.cfg.format === 'rubber') return [s.games[0] > 0, s.games[1] > 0];
  if (s.cfg.format === 'mini') return [false, false];
  if (s.cfg.format === 'chicago') {
    const k = s.board % 4;
    if (k === 0) return [false, false];
    if (k === 3) return [true, true];
    const d = side(s.dealer);
    return [d === 0, d === 1];
  }
  // спортивный: стандартная раскладка зоны по номеру сдачи (16 сдач)
  const t: [boolean, boolean][] = [[false, false], [true, false], [false, true], [true, true]];
  const n = s.board % 16;
  return t[(n + Math.floor(n / 4)) % 4];
}

export function newState(cfg: Cfg): State {
  return {
    cfg,
    seats: [0, 1, 2, 3],
    hands: [[], [], [], []],
    deal: [[], [], [], []],
    dealer: 0,
    board: -1,
    phase: 'auction',
    turn: 0,
    calls: [],
    contract: null,
    dummy: -1,
    dummyUp: false,
    trick: [],
    tricks: [0, 0],
    voids: [[], [], [], []],
    played: [],
    results: [],
    below: [0, 0],
    games: [0, 0],
    above: [0, 0],
    total: [0, 0],
    rubbers: 0,
    hcp: [0, 0, 0, 0],
  };
}

function dealNew(s: State, rng: Rng, ev: Event[]) {
  s.board++;
  s.dealer = s.board % 4;
  const deck: Card[] = [];
  for (const su of ['S', 'H', 'D', 'C'] as Suit[]) for (let r = 2; r <= 14; r++) deck.push({ s: su, r });
  const sh = shuffle(deck, rng);
  s.hands = [0, 1, 2, 3].map((p) => sh.slice(p * 13, p * 13 + 13));
  s.deal = s.hands.map((h) => h.slice());
  startBoard(s, ev);
}

/** Начать сдачу с уже розданными руками. */
export function startBoard(s: State, ev: Event[]) {
  s.calls = [];
  s.contract = null;
  s.dummy = -1;
  s.dummyUp = false;
  s.trick = [];
  s.tricks = [0, 0];
  s.voids = [[], [], [], []];
  s.played = [];
  s.hcp = s.hands.map(hcpOf);
  s.turn = s.dealer;
  ev.push({ type: 'deal', board: s.board, dealer: s.dealer, vul: vulnerable(s), hands: s.hands.map((h) => h.slice()) });
  if (s.cfg.format === 'mini') {
    // мини-бридж: играет пара с большими очками, разыгрывающий — сильнейший в ней
    const ns = s.hcp[0] + s.hcp[2];
    const ew = s.hcp[1] + s.hcp[3];
    const t = ns > ew ? 0 : ew > ns ? 1 : side(s.dealer);
    const a = t;
    const b = t + 2;
    s.dummy = s.hcp[a] >= s.hcp[b] ? b : a;
    // болван выкладывает карты до выбора контракта
    s.dummyUp = true;
    s.phase = 'mini';
    s.turn = partner(s.dummy);
  } else s.phase = 'auction';
}

export function setup(_seats: number[], opts: Options, rng: Rng): State {
  const s = newState(cfgFrom(opts));
  dealNew(s, rng, []);
  return s;
}

/** Кто ходит картой сейчас (болван — разыгрывающий за него). */
export const controller = (s: State, p: number) => (s.phase === 'play' && p === s.dummy ? s.contract!.declarer : p);
export const toAct = (s: State): number[] => (s.phase === 'over' ? [] : [controller(s, s.turn)]);

// ---------------------------------------------------------------- торговля

/** Последняя заявка (не пас/контра). */
export function lastBid(calls: CallRec[]): (CallRec & { call: { type: 'bid'; level: number; strain: Strain } }) | null {
  for (let i = calls.length - 1; i >= 0; i--) if (calls[i].call.type === 'bid') return calls[i] as never;
  return null;
}

/** Текущая контра: 0/1/2 после последней заявки. */
export function dblState(calls: CallRec[]): number {
  let d = 0;
  for (let i = calls.length - 1; i >= 0; i--) {
    const c = calls[i].call;
    if (c.type === 'bid') break;
    if (c.type === 'double') d = Math.max(d, 1);
    if (c.type === 'redouble') d = 2;
  }
  return d;
}

export function legalCall(s: State, seat: number, c: Call): boolean {
  if (s.phase !== 'auction' || seat !== s.turn || !c) return false;
  const lb = lastBid(s.calls);
  const d = dblState(s.calls);
  switch (c.type) {
    case 'pass':
      return true;
    case 'bid':
      return Number.isInteger(c.level) && c.level >= 1 && c.level <= 7 && STRAINS.includes(c.strain) && (!lb || bidRank(c.level, c.strain) > bidRank(lb.call.level, lb.call.strain));
    case 'double':
      return !!lb && side(lb.seat) !== side(seat) && d === 0;
    case 'redouble':
      return !!lb && side(lb.seat) === side(seat) && d === 1;
  }
  return false;
}

function endAuction(s: State, ev: Event[], rng: Rng) {
  const lb = lastBid(s.calls);
  if (!lb) {
    ev.push({ type: 'contract', contract: null });
    finishBoard(s, ev, rng);
    return;
  }
  const t = side(lb.seat);
  const decl = s.calls.find((x) => x.call.type === 'bid' && side(x.seat) === t && x.call.strain === lb.call.strain)!.seat;
  s.contract = { level: lb.call.level, strain: lb.call.strain, dbl: dblState(s.calls), declarer: decl };
  s.dummy = partner(decl);
  ev.push({ type: 'contract', contract: { ...s.contract } });
  s.phase = 'play';
  s.turn = next(decl);
}

// ---------------------------------------------------------------- розыгрыш

export const trumpOf = (s: State): Suit | null => (s.contract && s.contract.strain !== 'N' ? (s.contract.strain as Suit) : null);

export function legal(s: State, p: number): Card[] {
  const hand = s.hands[p];
  if (!s.trick.length) return hand;
  const f = hand.filter((c) => c.s === s.trick[0].card.s);
  return f.length ? f : hand;
}

export function trickWinner(trick: { seat: number; card: Card }[], trump: Suit | null): number {
  let best = trick[0];
  for (const t of trick.slice(1)) {
    const c = t.card;
    const b = best.card;
    if (c.s === b.s ? c.r > b.r : trump != null && c.s === trump && b.s !== trump) best = t;
  }
  return best.seat;
}

// ---------------------------------------------------------------- счёт

const trickValue = (strain: Strain) => (strain === 'C' || strain === 'D' ? 20 : 30);

/** Очки разыгрывающей стороне (отрицательные — штраф) по правилам дупликата/Чикаго, плюс разбиение для роббера. */
export function scoreContract(ct: Contract, tricks: number, vul: boolean, opts: { rubber?: boolean } = {}): { total: number; below: number; above: number } {
  const need = ct.level + 6;
  const mult = ct.dbl === 2 ? 4 : ct.dbl === 1 ? 2 : 1;
  if (tricks >= need) {
    let below = (ct.strain === 'N' ? 40 + (ct.level - 1) * 30 : ct.level * trickValue(ct.strain)) * mult;
    const over = tricks - need;
    let above = ct.dbl === 0 ? over * (ct.strain === 'N' ? 30 : trickValue(ct.strain)) : over * (vul ? 200 : 100) * (ct.dbl === 2 ? 2 : 1);
    if (ct.dbl === 1) above += 50;
    if (ct.dbl === 2) above += 100;
    if (ct.level === 6) above += vul ? 750 : 500;
    if (ct.level === 7) above += vul ? 1500 : 1000;
    if (opts.rubber) return { total: below + above, below, above };
    above += below >= 100 ? (vul ? 500 : 300) : 50;
    below = Math.max(0, below);
    return { total: below + above, below, above };
  }
  const down = need - tricks;
  let pen = 0;
  if (ct.dbl === 0) pen = down * (vul ? 100 : 50);
  else {
    for (let i = 1; i <= down; i++) pen += vul ? (i === 1 ? 200 : 300) : i === 1 ? 100 : i <= 3 ? 200 : 300;
    if (ct.dbl === 2) pen *= 2;
  }
  return { total: -pen, below: 0, above: -pen };
}

const IMP = [20, 50, 90, 130, 170, 220, 270, 320, 370, 430, 500, 600, 750, 900, 1100, 1300, 1500, 1750, 2000, 2250, 2500, 3000, 3500, 4000];
export const imps = (diff: number) => Math.sign(diff) * IMP.filter((x) => Math.abs(diff) >= x).length;

/** Очки паре 0 за сдачу (Чикаго/дупликат/мини). */
export function boardScore(ct: Contract | null, tricks: number, vul: [boolean, boolean]): number {
  if (!ct) return 0;
  const t = side(ct.declarer);
  const r = scoreContract(ct, tricks, vul[t]).total;
  return t === 0 ? r : -r;
}

/** Другой стол (спортивный): сыграть ту же сдачу ботами. Подставляется из ai.ts (движок не зависит от ботов). */
export let otherTable: ((s: State) => { contract: Contract | null; tricks: number }) | null = null;
export function setOtherTable(f: typeof otherTable) {
  otherTable = f;
}

/** Гонор по сданным рукам: [сторона, очки] или null. */
export function honours(deal: Card[][], strain: Strain): [number, number] | null {
  for (let p = 0; p < 4; p++) {
    const h = deal[p] ?? [];
    if (strain === 'N') {
      if (h.filter((c) => c.r === 14).length === 4) return [side(p), 150];
      continue;
    }
    const n = h.filter((c) => c.s === strain && c.r >= 10).length;
    if (n === 5) return [side(p), 150];
    if (n === 4) return [side(p), 100];
  }
  return null;
}

function finishBoard(s: State, ev: Event[], rng: Rng) {
  const vul = vulnerable(s);
  const ct = s.contract;
  const tricks = ct ? s.tricks[side(ct.declarer)] : 0;
  const res: BoardResult = { board: s.board, contract: ct ? { ...ct } : null, tricks, score: 0, vul };
  if (s.cfg.format === 'rubber') {
    if (ct) {
      const t = side(ct.declarer);
      const r = scoreContract(ct, tricks, vul[t], { rubber: true });
      if (r.below > 0) {
        s.below[t] += r.below;
        if (s.below[t] >= 100) {
          s.games[t]++;
          s.below = [0, 0];
        }
      }
      // штраф пишется противникам
      if (r.total < 0) s.above[1 - t] += -r.total;
      else s.above[t] += r.above;
      s.total[t] += Math.max(0, r.below) + Math.max(0, r.above);
      if (r.total < 0) s.total[1 - t] += -r.total;
      res.score = t === 0 ? r.total : -r.total;
      const hon = honours(s.deal, ct.strain);
      if (hon) {
        s.above[hon[0]] += hon[1];
        s.total[hon[0]] += hon[1];
        ev.push({ type: 'honours', side: hon[0], pts: hon[1] });
      }
    }
    s.results.push(res);
    ev.push({ type: 'result', result: res });
    const w: number = s.games[0] >= 2 ? 0 : s.games[1] >= 2 ? 1 : -1;
    if (w === 0 || w === 1) {
      const bonus = s.games[1 - w] ? 500 : 700;
      s.above[w] += bonus;
      s.total[w] += bonus;
      s.rubbers++;
      ev.push({ type: 'rubber', winner: w, bonus });
      s.phase = 'over';
      ev.push({ type: 'end', total: [...s.total] as [number, number] });
      return;
    }
  } else {
    res.score = boardScore(ct, tricks, vul);
    if (s.cfg.format === 'duplicate' && otherTable) {
      const o = otherTable(s);
      const os = boardScore(o.contract, o.tricks, vul);
      res.other = { contract: o.contract, tricks: o.tricks, score: os };
      res.imp = imps(res.score - os);
      if (res.imp > 0) s.total[0] += res.imp;
      else s.total[1] += -res.imp;
    } else {
      if (res.score > 0) s.total[0] += res.score;
      else s.total[1] += -res.score;
    }
    s.results.push(res);
    ev.push({ type: 'result', result: res });
    if (s.board + 1 >= s.cfg.boards) {
      s.phase = 'over';
      ev.push({ type: 'end', total: [...s.total] as [number, number] });
      return;
    }
  }
  dealNew(s, rng, ev);
}

// ---------------------------------------------------------------- ход

function clone(s0: State): State {
  return {
    ...s0,
    hands: s0.hands.map((h) => h.slice()),
    calls: s0.calls.slice(),
    trick: s0.trick.slice(),
    tricks: [...s0.tricks] as [number, number],
    voids: s0.voids.map((v) => v.slice()),
    played: s0.played.slice(),
    results: s0.results.slice(),
    below: [...s0.below] as [number, number],
    games: [...s0.games] as [number, number],
    above: [...s0.above] as [number, number],
    total: [...s0.total] as [number, number],
  };
}

export function apply(s0: State, seat: number, a: Action & { note?: string }, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.phase === 'over' || !a || typeof a !== 'object' || seat !== toAct(s0)[0]) return null;
  const s = clone(s0);
  const ev: Event[] = [];
  if (s.phase === 'auction') {
    const c = a as Call;
    if (!legalCall(s, seat, c)) return null;
    const call: Call = c.type === 'bid' ? { type: 'bid', level: c.level, strain: c.strain } : { type: c.type };
    const note = typeof a.note === 'string' ? a.note.slice(0, 80) : undefined;
    s.calls.push({ seat, call, note });
    ev.push({ type: 'call', seat, call, note });
    const n = s.calls.length;
    const passes = (k: number) => n >= k && s.calls.slice(-k).every((x) => x.call.type === 'pass');
    if ((n === 4 && passes(4)) || (lastBid(s.calls) && passes(3))) endAuction(s, ev, rng);
    else s.turn = next(seat);
    return { state: s, events: ev };
  }
  if (s.phase === 'mini') {
    if (a.type !== 'mini' || !STRAINS.includes(a.strain) || ![1, 2, 3, 4, 5].includes(a.level)) return null;
    // «частичка» — 1, «гейм» — 3БК / 4♥♠ / 5♣♦
    const game = a.strain === 'N' ? 3 : a.strain === 'H' || a.strain === 'S' ? 4 : 5;
    const level = a.level === 1 ? 1 : game;
    s.contract = { level, strain: a.strain, dbl: 0, declarer: seat };
    ev.push({ type: 'contract', contract: { ...s.contract } });
    s.phase = 'play';
    s.turn = next(seat);
    return { state: s, events: ev };
  }
  // розыгрыш: ходит карта места s.turn
  if (a.type !== 'play' || !a.card) return null;
  const p = s.turn;
  if (!legal(s, p).some((c) => sameCard(c, a.card))) return null;
  const card = { s: a.card.s, r: a.card.r };
  if (s.trick.length && card.s !== s.trick[0].card.s && !s.voids[p].includes(s.trick[0].card.s)) s.voids[p].push(s.trick[0].card.s);
  s.hands[p] = s.hands[p].filter((c) => !sameCard(c, card));
  s.trick.push({ seat: p, card });
  s.played.push(card);
  s.dummyUp = true;
  ev.push({ type: 'play', seat: p, card });
  if (s.trick.length < 4) {
    s.turn = next(p);
    return { state: s, events: ev };
  }
  const w = trickWinner(s.trick, trumpOf(s));
  s.tricks[side(w)]++;
  ev.push({ type: 'trick', seat: w, cards: s.trick.map((t) => t.card) });
  s.trick = [];
  s.turn = w;
  if (!s.hands[w].length) finishBoard(s, ev, rng);
  return { state: s, events: ev };
}

export interface View extends State {
  counts: number[];
}

/** Видно: своя рука; болван — когда открыт (разыгрывающему — свой болван всегда после торговли тоже только после первого хода). */
export function makeView(s: State, seats: number[] | 'all'): View {
  const see = (p: number) => seats === 'all' || seats.includes(p) || (s.dummyUp && p === s.dummy) || s.phase === 'over';
  const v = s as Partial<View>;
  return {
    ...s,
    hands: s.hands.map((h, p) => (see(p) ? h.slice() : [])),
    deal: s.phase === 'over' ? s.deal.map((h) => h.slice()) : [[], [], [], []],
    counts: s.hands.map((h, p) => v.counts?.[p] ?? h.length),
  };
}

export const countOf = (s: State, p: number) => ((s as Partial<View>).counts ? (s as View).counts[p] : s.hands[p].length);
