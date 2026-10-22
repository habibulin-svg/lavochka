/* Китайский покер (Open-Face Chinese, OFC) — движок без ставок и без DOM. Вид внутри «Покера»: режимы 'ofc' и 'ofcp'.
 *
 * У каждого три ряда открытыми картами: верх — 3 карты, середина — 5, низ — 5. Ряды должны усиливаться сверху вниз
 * (низ ≥ середины ≥ верха, равенство можно), иначе рука «мёртвая» — фол. Верх — только старшая карта, пара или сет.
 *   классический OFC ('ofc', 2–4 игрока): сначала 5 карт, потом по одной — 8 раз;
 *   «Ананас» ('ofcp', 2–3 игрока): сначала 5, потом 4 раза по 3 — две в ряды, третья в сброс рубашкой (4 × 17 = 68 > 52,
 *     поэтому вчетвером не играют).
 * Раскладывают по очереди, начиная слева от баттона, видя уже выложенное соперниками.
 * Счёт с каждым соперником: по очку за каждый выигранный ряд (ничья в ряду — 0), +3 за «скуп» (все три ряда), плюс разница
 * роялти. Фол — проигрыш всех рядов (6 очков) и роялти соперника, свои роялти сгорают; фол у обоих — 0.
 * Роялти: низ — стрит 2, флеш 4, фулл-хаус 6, каре 10, стрит-флеш 15, роял 25; середина — сет 2, стрит 4, флеш 8, фулл 12,
 *   каре 20, стрит-флеш 30, роял 50; верх — пара 66 = 1 … AA = 9, сет 222 = 10 … AAA = 22.
 * Фантазия: пара дам и старше вверху без фола — следующая раздача все карты сразу и рубашкой (соперники видят ряды только
 *   на подсчёте): в классике 13, в «Ананасе» 14 (одну в сброс); в прогрессивной QQ — 14, KK — 15, AA — 16, сет — 17.
 *   Остаётся в фантазии (с 14 картами, в классике — с 13), если повторил сет вверху, фулл-хаус и старше в середине или каре
 *   и старше внизу. Расхождения источников решены так: равенство рядов можно (Википедия), верх по Википедии (сет — 10…22). */
import type { Options, Rng } from '../../../core/types';
import { sameCard, type Card } from '../../../cards/deck';
import { allCards, high, highCat, pack } from '../hands';

export type OfcMode = 'ofc' | 'ofcp';
export type Fant = 'off' | 'on' | 'prog';
export const isOfc = (m: unknown): m is OfcMode => m === 'ofc' || m === 'ofcp';

export interface OCfg {
  mode: OfcMode;
  fant: Fant;
  /** Раздач в партии. */
  deals: number;
}

export function ocfgFrom(o: Options): OCfg {
  const mode: OfcMode = o.mode === 'ofc' ? 'ofc' : 'ofcp';
  const fant: Fant = o.fant === 'off' || o.fant === 'prog' ? o.fant : 'on';
  return { mode, fant: mode === 'ofc' && fant === 'prog' ? 'on' : fant, deals: [4, 6, 8, 12].includes(Number(o.deals)) ? Number(o.deals) : 6 };
}

export const ofcMax = (m: OfcMode) => (m === 'ofc' ? 4 : 3);
export const OFC_NAME: Record<OfcMode, string> = { ofc: 'Китайский покер', ofcp: 'Китайский покер «Ананас»' };

/** Ряды: 0 — верх, 1 — середина, 2 — низ. */
export const SIZE = [3, 5, 5];
export const ROW_NAME = ['верх', 'середина', 'низ'];
/** Куда положить карту из руки: ряд или сброс. */
export type Slot = 0 | 1 | 2 | 'x';

export const N = 9;

export interface Score {
  /** Ряды всех на подсчёте (открыты всем). */
  rows: Record<number, Card[][]>;
  foul: Record<number, boolean>;
  /** Роялти по рядам (у фола — нули). */
  roy: Record<number, number[]>;
  /** Названия рядов. */
  names: Record<number, string[]>;
  /** Итог раздачи по очкам. */
  net: Record<number, number>;
  /** Кто сколько карт получит в фантазии на следующей раздаче. */
  next: Record<number, number>;
}

export interface OState {
  ofc: true;
  cfg: OCfg;
  seats: number[];
  hand: number;
  button: number;
  /** rows[p] = [верх, середина, низ]. У чужой фантазии в виде — рубашки (null). */
  rows: Card[][][];
  /** Сданные и ещё не разложенные карты. */
  held: Card[][];
  /** Свой сброс (рубашкой). */
  disc: Card[][];
  deck: Card[];
  /** 0 — первые пять (и фантазия), дальше — добор. */
  round: number;
  turn: number;
  /** Сколько карт у места в фантазии в этой раздаче (0 — обычная раздача). */
  fant: number[];
  pts: number[];
  last: Score | null;
  over: boolean;
}

export interface OView extends OState {
  /** Сколько карт на руке у каждого (свои видно, чужие — рубашки). */
  counts: number[];
  /** Сколько сбросил каждый. */
  discN: number[];
}

export type OAction = { type: 'place'; to: Slot[] };

export type OEvent =
  | { type: 'odeal'; hand: number; button: number; fant: number[]; held?: (Card[] | null)[] }
  /** Новые карты месту на добор (видит только оно). */
  | { type: 'ocards'; seat: number; count: number; cards?: Card[] }
  /** Выложил: карты по рядам (у фантазии — рубашкой для чужих), сброшено столько-то. */
  | { type: 'oplace'; seat: number; put: { card: Card | null; row: 0 | 1 | 2 }[]; discard: number; cards?: Card[]; hidden?: boolean }
  | { type: 'oscore'; hand: number; score: Score }
  | { type: 'oend'; winner: number; pts: number[] };

const empty = () => Array.from({ length: N }, () => [] as Card[]);
const rowsEmpty = () => Array.from({ length: N }, () => [[], [], []] as Card[][]);
const placed = (s: Pick<OState, 'rows'>, p: number) => s.rows[p].reduce((a, r) => a + r.length, 0);

// ---------------------------------------------------------------- оценка рядов

/** Верх (до трёх карт): сет, пара или старшая — в одной шкале с пятёрками (pack из hands), чтобы сравнивать с серединой. */
export function topValue(cards: Card[]): number {
  const rs = cards.map((c) => c.r).sort((a, b) => b - a);
  const cnt = new Map<number, number>();
  for (const r of rs) cnt.set(r, (cnt.get(r) ?? 0) + 1);
  const g = [...cnt.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  if (g[0]?.[1] === 3) return pack(3, [g[0][0]]);
  if (g[0]?.[1] === 2) return pack(1, [g[0][0], g[1]?.[0] ?? 0]);
  return pack(0, rs);
}

export const rowValue = (cards: Card[], row: number) => (row === 0 ? topValue(cards) : high(cards));

/** Ранг пары или сета вверху (0 — нет). */
function topMade(cards: Card[]): { kind: 0 | 2 | 3; r: number } {
  const v = topValue(cards);
  const c = highCat(v);
  const r = Math.floor(v / 15 ** 4) % 15;
  return c === 3 ? { kind: 3, r } : c === 1 ? { kind: 2, r } : { kind: 0, r: 0 };
}

const kick1 = (v: number) => Math.floor(v / 15 ** 4) % 15;
const BOT_ROY = [0, 0, 0, 0, 2, 4, 6, 10, 15];
const MID_ROY = [0, 0, 0, 2, 4, 8, 12, 20, 30];

/** Роялти ряда (полного). */
export function royalty(cards: Card[], row: number): number {
  if (row === 0) {
    const t = topMade(cards);
    return t.kind === 3 ? 10 + t.r - 2 : t.kind === 2 && t.r >= 6 ? t.r - 5 : 0;
  }
  const v = high(cards);
  const c = highCat(v);
  if (c === 8 && kick1(v) === 14) return row === 2 ? 25 : 50;
  return (row === 2 ? BOT_ROY : MID_ROY)[c];
}

/** Фол: ряды не усиливаются сверху вниз (для полной раскладки). */
export function isFoul(rows: Card[][]): boolean {
  const t = topValue(rows[0]);
  const m = high(rows[1]);
  const b = high(rows[2]);
  return m < t || b < m;
}

/** Название ряда: «пара дам», «флеш», «старшая туз». */
export function rowName(cards: Card[], row: number): string {
  if (!cards.length) return '';
  const v = rowValue(cards, row);
  const c = highCat(v);
  const RN: Record<number, string> = { 14: 'тузов', 13: 'королей', 12: 'дам', 11: 'валетов', 10: 'десяток', 9: 'девяток', 8: 'восьмёрок', 7: 'семёрок', 6: 'шестёрок', 5: 'пятёрок', 4: 'четвёрок', 3: 'троек', 2: 'двоек' };
  if (c === 0) return 'старшая ' + (({ 14: 'туз', 13: 'король', 12: 'дама', 11: 'валет' } as Record<number, string>)[kick1(v)] ?? String(kick1(v)));
  if (c === 1) return `пара ${RN[kick1(v)]}`;
  if (c === 3) return `сет ${RN[kick1(v)]}`;
  if (c === 8 && kick1(v) === 14) return 'роял-флеш';
  return ['', '', 'две пары', '', 'стрит', 'флеш', 'фулл-хаус', 'каре', 'стрит-флеш'][c];
}

/** Подсказка раскладке: 'foul' — фол уже неизбежен (нижний ряд полон и слабее верхнего), 'risk' — верхний ряд сильнее нижнего,
 * а в нижнем осталось одно-два места. */
export function foulRisk(rows: Card[][]): 'foul' | 'risk' | null {
  let risk: 'foul' | 'risk' | null = null;
  for (const [a, b] of [[0, 1], [1, 2]] as const) {
    if (!rows[a].length || !rows[b].length) continue;
    const va = rowValue(rows[a], a);
    const vb = rowValue(rows[b], b);
    if (va <= vb) continue;
    // нижний ряд полон — уже не догонит
    if (rows[b].length === SIZE[b]) return 'foul';
    if (SIZE[b] - rows[b].length <= 2) risk = 'risk';
  }
  return risk;
}

/** Сколько карт в фантазии заработала полная раскладка (0 — нет). inFant — места уже в фантазии (условия «остаться»). */
export function fantasyFor(rows: Card[][], cfg: OCfg, inFant: boolean): number {
  if (cfg.fant === 'off' || isFoul(rows)) return 0;
  const t = topMade(rows[0]);
  const base = cfg.mode === 'ofc' ? 13 : 14;
  if (inFant) {
    const stay = t.kind === 3 || highCat(high(rows[1])) >= 6 || highCat(high(rows[2])) >= 7;
    return stay ? base : 0;
  }
  if (t.kind === 3) return cfg.fant === 'prog' ? 17 : base;
  if (t.kind === 2 && t.r >= 12) return cfg.fant === 'prog' ? 14 + (t.r - 12) : base;
  return 0;
}

/** Подсчёт раздачи. */
export function scoreHand(s: Pick<OState, 'seats' | 'rows' | 'cfg' | 'fant'>): Score {
  const sc: Score = { rows: {}, foul: {}, roy: {}, names: {}, net: {}, next: {} };
  for (const p of s.seats) {
    const rows = s.rows[p];
    const foul = isFoul(rows);
    sc.rows[p] = rows.map((r) => r.slice());
    sc.foul[p] = foul;
    sc.roy[p] = foul ? [0, 0, 0] : rows.map((r, i) => royalty(r, i));
    sc.names[p] = rows.map((r, i) => rowName(r, i));
    sc.net[p] = 0;
    sc.next[p] = fantasyFor(rows, s.cfg, s.fant[p] > 0);
  }
  const vals = Object.fromEntries(s.seats.map((p) => [p, s.rows[p].map((r, i) => rowValue(r, i))]));
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);
  for (let i = 0; i < s.seats.length; i++)
    for (let j = i + 1; j < s.seats.length; j++) {
      const a = s.seats[i];
      const b = s.seats[j];
      let d = 0;
      if (sc.foul[a] && sc.foul[b]) d = 0;
      else if (sc.foul[a]) d = -(6 + sum(sc.roy[b]));
      else if (sc.foul[b]) d = 6 + sum(sc.roy[a]);
      else {
        let w = 0;
        let l = 0;
        for (let r = 0; r < 3; r++) {
          if (vals[a][r] > vals[b][r]) w++;
          else if (vals[a][r] < vals[b][r]) l++;
        }
        d = w - l + (w === 3 ? 3 : l === 3 ? -3 : 0) + sum(sc.roy[a]) - sum(sc.roy[b]);
      }
      sc.net[a] += d;
      sc.net[b] -= d;
    }
  return sc;
}

// ---------------------------------------------------------------- ход партии

export function newOState(cfg: OCfg, seats: number[]): OState {
  return {
    ofc: true,
    cfg,
    seats: seats.slice(),
    hand: 0,
    button: seats[seats.length - 1],
    rows: rowsEmpty(),
    held: empty(),
    disc: empty(),
    deck: [],
    round: 0,
    turn: seats[0],
    fant: Array(N).fill(0),
    pts: Array(N).fill(0),
    last: null,
    over: false,
  };
}

/** Места по порядку хода: слева от баттона, баттон — последним. */
export const order = (s: Pick<OState, 'seats' | 'button'>) => {
  const all = s.seats.slice().sort((a, b) => a - b);
  const i = all.indexOf(s.button);
  return all.map((_, k) => all[(i + 1 + k) % all.length]);
};

/** Сколько карт сдают на добор: «Ананас» — три, классика — одну. */
const per = (s: Pick<OState, 'cfg'>) => (s.cfg.mode === 'ofcp' ? 3 : 1);

/** Новая раздача: баттон дальше, фантазия — все карты сразу, остальным — по пять. */
export function deal(s0: OState, rng: Rng, nextFant: number[]): { state: OState; events: OEvent[] } {
  const s: OState = { ...s0, rows: rowsEmpty(), held: empty(), disc: empty(), round: 0, fant: nextFant.slice() };
  s.hand = s0.hand + 1;
  if (s0.hand > 0) s.button = order(s0)[0];
  const deck = allCards();
  for (let i = deck.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  s.deck = deck;
  for (const p of order(s)) s.held[p] = s.deck.splice(0, s.fant[p] || 5);
  s.turn = order(s)[0];
  return { state: s, events: [{ type: 'odeal', hand: s.hand, button: s.button, fant: s.fant.slice(), held: s.held.map((h) => h.slice()) }] };
}

export function setupOfc(seats: number[], opts: Options, rng: Rng): OState {
  return deal(newOState(ocfgFrom(opts), seats), rng, Array(N).fill(0)).state;
}

export const toActOfc = (s: OState): number[] => (s.over ? [] : [s.turn]);

/** Сколько карт из руки надо сбросить при этой раскладке. */
export function needDiscard(s: Pick<OState, 'held' | 'cfg' | 'fant' | 'round'>, p: number): number {
  if (s.fant[p]) return Math.max(0, s.held[p].length - 13);
  return s.round > 0 && s.cfg.mode === 'ofcp' ? 1 : 0;
}

export function applyOfc(s0: OState, seat: number, a: OAction, rng: Rng): { state: OState; events: OEvent[] } | null {
  if (s0.over || seat !== s0.turn || a?.type !== 'place' || !Array.isArray(a.to)) return null;
  const held = s0.held[seat];
  if (!held.length || a.to.length !== held.length) return null;
  const k = needDiscard(s0, seat);
  if (a.to.filter((x) => x === 'x').length !== k) return null;
  const rows = s0.rows[seat].map((r) => r.slice());
  const put: { card: Card; row: 0 | 1 | 2 }[] = [];
  const dis: Card[] = [];
  for (let i = 0; i < held.length; i++) {
    const t = a.to[i];
    if (t === 'x') dis.push(held[i]);
    else if (t === 0 || t === 1 || t === 2) {
      if (rows[t].length >= SIZE[t]) return null;
      rows[t].push(held[i]);
      put.push({ card: held[i], row: t });
    } else return null;
  }
  const s: OState = { ...s0, rows: s0.rows.slice(), held: s0.held.slice(), disc: s0.disc.slice() };
  s.rows[seat] = rows;
  s.held[seat] = [];
  s.disc[seat] = [...s0.disc[seat], ...dis];
  const ev: OEvent[] = [{ type: 'oplace', seat, put, discard: dis.length, cards: dis, ...(s0.fant[seat] ? { hidden: true } : {}) }];
  return advance(s, ev, rng);
}

function advance(s: OState, ev: OEvent[], rng: Rng): { state: OState; events: OEvent[] } {
  const ord = order(s);
  const next = ord.slice(ord.indexOf(s.turn) + 1).find((p) => s.held[p].length);
  if (next != null) {
    s.turn = next;
    return { state: s, events: ev };
  }
  // круг разложен: всем по 13 — подсчёт, иначе добор тем, кто не в фантазии
  if (s.seats.every((p) => placed(s, p) === 13)) {
    const score = scoreHand(s);
    s.pts = s.pts.slice();
    for (const p of s.seats) s.pts[p] += score.net[p];
    s.last = score;
    ev.push({ type: 'oscore', hand: s.hand, score });
    if (s.hand >= s.cfg.deals) {
      s.over = true;
      const top = Math.max(...s.seats.map((p) => s.pts[p]));
      ev.push({ type: 'oend', winner: s.seats.find((p) => s.pts[p] === top)!, pts: s.pts.slice() });
      return { state: s, events: ev };
    }
    const nf = Array(N).fill(0);
    for (const p of s.seats) nf[p] = score.next[p];
    const d = deal(s, rng, nf);
    return { state: d.state, events: [...ev, ...d.events] };
  }
  s.round++;
  for (const p of ord)
    if (placed(s, p) < 13) {
      s.held[p] = s.deck.splice(0, per(s));
      ev.push({ type: 'ocards', seat: p, count: s.held[p].length, cards: s.held[p].slice() });
    }
  s.turn = ord.find((p) => s.held[p].length)!;
  return { state: s, events: ev };
}

/** Видно: свои карты на руке и сброс; ряды — у всех, кроме чужой фантазии (до подсчёта — рубашки). */
export function makeOView(s: OState, seats: number[] | 'all'): OView {
  const see = (p: number) => seats === 'all' || seats.includes(p);
  return {
    ...s,
    rows: s.rows.map((rs, p) => (see(p) || !s.fant[p] || s.over ? rs.map((r) => r.slice()) : rs.map((r) => r.map(() => null as unknown as Card)))),
    held: s.held.map((h, p) => (see(p) ? h.slice() : h.map(() => null as unknown as Card))),
    disc: s.disc.map((d, p) => (see(p) ? d.slice() : [])),
    deck: [],
    counts: s.held.map((h) => h.length),
    discN: s.disc.map((d) => d.length),
  };
}

export function redactOfc(ev: OEvent, seats: number[] | 'all'): OEvent {
  if (seats === 'all') return ev;
  const see = (p: number) => seats.includes(p);
  if (ev.type === 'odeal') return { ...ev, held: ev.held?.map((h, p) => (see(p) ? h : null)) };
  if (ev.type === 'ocards' && !see(ev.seat)) return { ...ev, cards: undefined };
  if (ev.type === 'oplace' && !see(ev.seat)) return { ...ev, cards: undefined, put: ev.hidden ? ev.put.map((x) => ({ ...x, card: null })) : ev.put };
  return ev;
}

export function resultOfc(s: OState) {
  if (!s.over) return null;
  const top = Math.max(...s.seats.map((p) => s.pts[p]));
  const scores: Record<number, number> = {};
  for (const p of s.seats) scores[p] = s.pts[p];
  return { winners: s.seats.filter((p) => s.pts[p] === top), text: `${top > 0 ? '+' : ''}${top} очк.`, scores };
}

/** Карты, которых место не видит: колода минус свои ряды, рука, сброс и открытые чужие ряды. */
export function unseen(v: OView, seat: number): Card[] {
  const known = [...v.rows.flat(2), ...v.held[seat], ...v.disc[seat]].filter(Boolean);
  return allCards().filter((c) => !known.some((k) => sameCard(k, c)));
}
