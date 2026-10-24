/* «Поездом по СССР» — движок (без DOM). Правила — по листку фанатского набора «Ticket to Ride СССР» (2011):
 * карты вагонов (8 цветов по 12, 14 локомотивов, 2 контролёра), 5 открытых карт, пути между соседними городами, паромы и тоннели,
 * станции, карты маршрутов, бонусы. Чего в листке нет — как в «Европе» (конец игры, очки станций), решения — в docs/STATE.md. */
import { shuffle } from '../../core/rng';
import type { Rng } from '../../core/types';
import { CITIES, ROUTES } from './board';
import { BONUS, CARD_KINDS, COLORS, CTRL, LOCO, LONG_N, ROUTE_POINTS, STATION_POINTS, STATIONS, TICKETS, WAGONS, type BonusId } from './data';

export interface Cfg {
  /** Станции (по 3 у игрока). */
  stations: boolean;
  /** Карты контролёров в колоде. */
  ctrl: boolean;
  /** Бонусы за маршруты, паромы и тоннели (за самый длинный путь — всегда). */
  bonuses: boolean;
  /** Длинные маршруты в общей стопке после раздачи (иначе — в коробку). */
  longPile: boolean;
}

export const cfgFrom = (o: Record<string, unknown>): Cfg => ({
  stations: o.stations !== false,
  ctrl: o.ctrl !== false,
  bonuses: o.bonuses !== false,
  longPile: o.longPile !== false,
});

export type Phase = 'start' | 'act' | 'second' | 'tickets' | 'tunnel' | 'over';

export interface Tunnel {
  route: number;
  /** Цвет оплаты (0–7) или −1 — одними локомотивами. */
  color: number;
  colorN: number;
  locos: number;
  reveal: number[];
  extra: number;
}

export interface Row {
  routes: number;
  plus: number;
  minus: number;
  done: number;
  stations: number;
  bonus: BonusId[];
  bonusPts: number;
  total: number;
  longest: number;
}

export interface State {
  cfg: Cfg;
  n: number;
  deck: number[];
  deckN: number;
  discard: number[];
  discardN: number;
  /** Открытые карты (−1 — пусто). */
  open: number[];
  /** Рука: число карт каждого вида (null — чужая, видно только handN). */
  hand: (number[] | null)[];
  handN: number[];
  tickets: (number[] | null)[];
  ticketsN: number[];
  tdeck: number[];
  tdeckN: number;
  /** Маршруты на выбор (в начале — у всех, потом — у взявшего); null — нет или чужие. */
  offer: (number[] | null)[];
  offerN: number[];
  owner: (number | null)[];
  wagons: number[];
  stations: number[];
  /** Станция в городе: чья. */
  station: (number | null)[];
  score: number[];
  turn: number;
  phase: Phase;
  tunnel: Tunnel | null;
  /** Сколько ходов осталось до конца (последний круг); null — ещё не начался. */
  finalLeft: number | null;
  /** Последний построенный путь / станция (подсветка). */
  last: { route?: number; city?: number } | null;
  result: { rows: Row[]; winners: number[] } | null;
}

export type Action =
  | { type: 'keep'; keep: number[] }
  | { type: 'draw'; slot: number }
  | { type: 'tickets' }
  | { type: 'claim'; route: number; color: number; locos: number }
  | { type: 'tunnel'; pay: boolean }
  | { type: 'station'; city: number; color: number; locos: number }
  | { type: 'ctrl'; route: number; mode: 'build' | 'remove' }
  | { type: 'pass' };

export type Event =
  | { type: 'draw'; seat: number; slot: number; card: number }
  | { type: 'refill'; slot: number; card: number }
  | { type: 'flush'; why: 'loco' | 'ctrl'; open: number[] }
  | { type: 'shuffle'; n: number }
  | { type: 'claim'; seat: number; route: number; cards: number[]; pts: number; ctrl?: boolean }
  | { type: 'reveal'; seat: number; route: number; cards: number[]; extra: number }
  | { type: 'tunnelEnd'; seat: number; route: number; ok: boolean; extra: number[] }
  | { type: 'remove'; seat: number; route: number; owner: number; pts: number }
  | { type: 'station'; seat: number; city: number; cards: number[] }
  | { type: 'take'; seat: number; n: number; offer: number[] | null }
  | { type: 'keep'; seat: number; n: number; back: number; keep: number[] | null }
  | { type: 'final'; seat: number }
  | { type: 'pass'; seat: number }
  | { type: 'end'; rows: Row[]; winners: number[] };

const clone = (s: State): State => JSON.parse(JSON.stringify(s));

/** Пути между теми же городами (двойные и тройной). */
export const TWINS: number[][] = ROUTES.map((r, i) =>
  ROUTES.map((q, j) => j).filter((j) => j !== i && ((ROUTES[j].a === r.a && ROUTES[j].b === r.b) || (ROUTES[j].a === r.b && ROUTES[j].b === r.a)))
);
/** Пути из города. */
export const ADJ: number[][] = CITIES.map((_, c) => ROUTES.map((_, i) => i).filter((i) => ROUTES[i].a === c || ROUTES[i].b === c));
export const routeColor = (i: number) => (ROUTES[i].color === 'gray' ? -1 : COLORS.indexOf(ROUTES[i].color as (typeof COLORS)[number]));
export const other = (i: number, c: number) => (ROUTES[i].a === c ? ROUTES[i].b : ROUTES[i].a);

export function newDeck(cfg: Cfg): number[] {
  const d: number[] = [];
  for (let c = 0; c < 8; c++) for (let k = 0; k < 12; k++) d.push(c);
  for (let k = 0; k < 14; k++) d.push(LOCO);
  if (cfg.ctrl) d.push(CTRL, CTRL);
  return d;
}

/** Взять верхнюю карту колоды; пусто — перетасовать сброс. */
function pop(s: State, rng: Rng, ev: Event[]): number | null {
  if (!s.deck.length && s.discard.length) {
    s.deck = shuffle(s.discard, rng);
    s.discard = [];
    ev.push({ type: 'shuffle', n: s.deck.length });
  }
  const c = s.deck.pop();
  s.deckN = s.deck.length;
  return c ?? null;
}

/** Дозаполнить открытые карты; три локомотива или контролёр в открытую — все пять в сброс. */
function refill(s: State, rng: Rng, ev: Event[]) {
  for (let tries = 0; tries < 6; tries++) {
    for (let i = 0; i < 5; i++) {
      if (s.open[i] >= 0) continue;
      const c = pop(s, rng, ev);
      if (c == null) break;
      s.open[i] = c;
      ev.push({ type: 'refill', slot: i, card: c });
    }
    const locos = s.open.filter((c) => c === LOCO).length;
    const ctrl = s.open.includes(CTRL);
    if (locos < 3 && !ctrl) return;
    // мало карт — не крутить сброс бесконечно
    if (s.deck.length + s.discard.length < 5) return;
    ev.push({ type: 'flush', why: ctrl ? 'ctrl' : 'loco', open: s.open.slice() });
    for (let i = 0; i < 5; i++) {
      if (s.open[i] >= 0) s.discard.push(s.open[i]);
      s.open[i] = -1;
    }
  }
}

export function newState(n: number, cfg: Cfg, rng: Rng): State {
  const long = shuffle(TICKETS.map((_, i) => i).filter((i) => i < LONG_N), rng);
  const short = shuffle(TICKETS.map((_, i) => i).filter((i) => i >= LONG_N), rng);
  const s: State = {
    cfg,
    n,
    deck: shuffle(newDeck(cfg), rng),
    deckN: 0,
    discard: [],
    discardN: 0,
    open: [-1, -1, -1, -1, -1],
    hand: [],
    handN: [],
    tickets: [],
    ticketsN: [],
    tdeck: [],
    tdeckN: 0,
    offer: [],
    offerN: [],
    owner: ROUTES.map(() => null),
    wagons: [],
    stations: [],
    station: CITIES.map(() => null),
    score: [],
    turn: 0,
    phase: 'start',
    tunnel: null,
    finalLeft: null,
    last: null,
    result: null,
  };
  // контролёров не раздаём: в руку они попадают только втёмную
  const ctrl = s.deck.filter((c) => c === CTRL).length;
  s.deck = s.deck.filter((c) => c !== CTRL);
  for (let p = 0; p < n; p++) {
    const h = new Array(CARD_KINDS).fill(0);
    for (let k = 0; k < 4; k++) h[s.deck.pop()!]++;
    s.hand.push(h);
    s.handN.push(4);
    s.tickets.push([]);
    s.ticketsN.push(0);
    const offer = [long.pop()!, long.pop()!, short.pop()!, short.pop()!];
    s.offer.push(offer);
    s.offerN.push(4);
    s.wagons.push(WAGONS);
    s.stations.push(cfg.stations ? STATIONS : 0);
    s.score.push(0);
  }
  for (let k = 0; k < ctrl; k++) s.deck.splice(rng.int(s.deck.length + 1), 0, CTRL);
  s.tdeck = shuffle(cfg.longPile ? [...long, ...short] : short, rng);
  s.tdeckN = s.tdeck.length;
  const ev: Event[] = [];
  refill(s, rng, ev);
  syncCounts(s);
  return s;
}

export function toAct(s: State): number[] {
  if (s.phase === 'over') return [];
  if (s.phase === 'start') return s.offer.map((o, i) => (o && o.length ? i : -1)).filter((i) => i >= 0);
  return [s.turn];
}

const handOf = (s: State, seat: number) => s.hand[seat] as number[];
const cardsCount = (h: number[]) => h.reduce((a, b) => a + b, 0);

/** Может ли игрок занять путь (свободен, нет двойного у себя, вдвоём — двойной закрыт, хватает вагончиков). */
export function routeOpen(s: State, seat: number, r: number): boolean {
  if (s.owner[r] != null) return false;
  if (s.wagons[seat] < ROUTES[r].len) return false;
  for (const t of TWINS[r]) {
    if (s.owner[t] === seat) return false;
    if (s.n <= 2 && s.owner[t] != null) return false;
  }
  return true;
}

/** Способы оплатить путь: цвет (−1 — только локомотивами) и сколько локомотивов; меньше локомотивов — раньше. */
export function payOptions(s: State, seat: number, r: number): { color: number; locos: number }[] {
  const h = handOf(s, seat);
  if (!h) return [];
  const R = ROUTES[r];
  const rc = routeColor(r);
  const out: { color: number; locos: number }[] = [];
  const colors = rc >= 0 ? [rc] : [0, 1, 2, 3, 4, 5, 6, 7];
  for (const c of colors) {
    for (let l = R.ferry; l < R.len; l++) {
      if (h[LOCO] >= l && h[c] >= R.len - l) {
        out.push({ color: c, locos: l });
        break;
      }
    }
  }
  if (h[LOCO] >= R.len) out.push({ color: -1, locos: R.len });
  return out;
}

export function canPay(s: State, seat: number, r: number, color: number, locos: number): boolean {
  const h = handOf(s, seat);
  const R = ROUTES[r];
  if (!h || locos < R.ferry || locos > R.len || locos < 0) return false;
  if (color === -1) return locos === R.len && h[LOCO] >= locos;
  const rc = routeColor(r);
  if (rc >= 0 && color !== rc) return false;
  if (color < 0 || color > 7) return false;
  return h[LOCO] >= locos && h[color] >= R.len - locos && R.len - locos > 0;
}

/** Цвета, которыми можно строить станцию (−1 в списке — любой цвет). */
export function stationColors(s: State, seat: number, city: number): number[] {
  const first = s.stations[seat] === STATIONS;
  if (!first) return [0, 1, 2, 3, 4, 5, 6, 7];
  const set = new Set<number>();
  for (const r of ADJ[city]) {
    const c = routeColor(r);
    if (c < 0) return [0, 1, 2, 3, 4, 5, 6, 7];
    set.add(c);
  }
  return [...set];
}

export const stationCost = (s: State, seat: number) => STATIONS - s.stations[seat] + 1;

export function stationOptions(s: State, seat: number, city: number): { color: number; locos: number }[] {
  const h = handOf(s, seat);
  if (!h || !s.cfg.stations || s.stations[seat] <= 0 || s.station[city] != null) return [];
  const k = stationCost(s, seat);
  const out: { color: number; locos: number }[] = [];
  for (const c of stationColors(s, seat, city)) {
    for (let l = 0; l < k; l++)
      if (h[LOCO] >= l && h[c] >= k - l) {
        out.push({ color: c, locos: l });
        break;
      }
  }
  if (h[LOCO] >= k) out.push({ color: -1, locos: k });
  return out;
}

export const canDrawDeck = (s: State) => s.deck.length + s.discard.length + s.deckN + s.discardN > 0;
export function canDrawOpen(s: State, slot: number) {
  const c = s.open[slot];
  if (c == null || c < 0) return false;
  return !(s.phase === 'second' && c === LOCO);
}
export const canDrawAny = (s: State) => canDrawDeck(s) || [0, 1, 2, 3, 4].some((i) => canDrawOpen(s, i));

/** Есть ли у игрока хоть какой-то ход (иначе — пас). */
export function anyMove(s: State, seat: number): boolean {
  if (canDrawAny(s)) return true;
  if (s.tdeck.length || s.tdeckN) return true;
  for (let r = 0; r < ROUTES.length; r++) if (routeOpen(s, seat, r) && payOptions(s, seat, r).length) return true;
  if (s.cfg.stations && s.stations[seat] > 0) for (let c = 0; c < CITIES.length; c++) if (stationOptions(s, seat, c).length) return true;
  if ((handOf(s, seat)?.[CTRL] ?? 0) > 0) return true;
  return false;
}

function take(h: number[], color: number, locos: number, n: number): number[] {
  const cards: number[] = [];
  for (let k = 0; k < locos; k++) {
    h[LOCO]--;
    cards.push(LOCO);
  }
  for (let k = 0; k < n - locos; k++) {
    h[color]--;
    cards.push(color);
  }
  return cards;
}

function endTurn(s: State, ev: Event[]) {
  s.phase = 'act';
  s.tunnel = null;
  if (s.finalLeft == null) {
    if (s.wagons[s.turn] <= 2) {
      s.finalLeft = s.n;
      ev.push({ type: 'final', seat: s.turn });
    }
  } else {
    s.finalLeft--;
    if (s.finalLeft <= 0) {
      finish(s, ev);
      return;
    }
  }
  s.turn = (s.turn + 1) % s.n;
}

export function syncCounts(s: State) {
  s.deckN = s.deck.length;
  s.discardN = s.discard.length;
  s.tdeckN = s.tdeck.length;
  for (let p = 0; p < s.n; p++) {
    const h = s.hand[p];
    if (h) s.handN[p] = cardsCount(h);
    const t = s.tickets[p];
    if (t) s.ticketsN[p] = t.length;
    const o = s.offer[p];
    s.offerN[p] = o ? o.length : 0;
  }
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: S; events: Event[] } | null {
  if (s0.phase === 'over') return null;
  const s = clone(s0);
  const ev: Event[] = [];
  const h = handOf(s, seat);
  if (s.phase === 'start') {
    if (a.type !== 'keep') return null;
    const offer = s.offer[seat];
    if (!offer || !offer.length) return null;
    const keep = [...new Set(a.keep)];
    if (keep.some((t) => !offer.includes(t))) return null;
    if (!keep.some((t) => TICKETS[t].long) || !keep.some((t) => !TICKETS[t].long)) return null;
    s.tickets[seat] = keep;
    s.offer[seat] = null;
    ev.push({ type: 'keep', seat, n: keep.length, back: offer.length - keep.length, keep });
    if (s.offer.every((o) => !o)) {
      s.phase = 'act';
      s.turn = 0;
    }
    syncCounts(s);
    return { state: s, events: ev };
  }
  if (seat !== s.turn) return null;
  switch (a.type) {
    case 'keep': {
      if (s.phase !== 'tickets') return null;
      const offer = s.offer[seat]!;
      const keep = [...new Set(a.keep)];
      if (!keep.length || keep.some((t) => !offer.includes(t))) return null;
      s.tickets[seat]!.push(...keep);
      s.offer[seat] = null;
      // возвращённые маршруты уходят из игры
      ev.push({ type: 'keep', seat, n: keep.length, back: offer.length - keep.length, keep });
      endTurn(s, ev);
      break;
    }
    case 'tickets': {
      if (s.phase !== 'act' || !s.tdeck.length) return null;
      const offer = s.tdeck.splice(Math.max(0, s.tdeck.length - 3)).reverse();
      s.offer[seat] = offer;
      s.phase = 'tickets';
      ev.push({ type: 'take', seat, n: offer.length, offer });
      break;
    }
    case 'draw': {
      if (s.phase !== 'act' && s.phase !== 'second') return null;
      let card: number | null;
      if (a.slot === -1) {
        card = pop(s, rng, ev);
        if (card == null) return null;
      } else {
        if (a.slot < 0 || a.slot > 4 || !canDrawOpen(s, a.slot)) return null;
        card = s.open[a.slot];
        s.open[a.slot] = -1;
      }
      h[card]++;
      ev.push({ type: 'draw', seat, slot: a.slot, card });
      const one = a.slot >= 0 && card === LOCO;
      if (a.slot >= 0) refill(s, rng, ev);
      if (s.phase === 'act' && !one) {
        s.phase = 'second';
        syncCounts(s);
        if (!canDrawAny(s)) endTurn(s, ev);
      } else endTurn(s, ev);
      break;
    }
    case 'claim': {
      if (s.phase !== 'act') return null;
      const r = a.route;
      if (!(r >= 0 && r < ROUTES.length) || !routeOpen(s, seat, r) || !canPay(s, seat, r, a.color, a.locos)) return null;
      const R = ROUTES[r];
      const cards = take(h, a.color < 0 ? LOCO : a.color, a.locos, R.len);
      if (R.tunnel) {
        const reveal: number[] = [];
        for (let k = 0; k < 3; k++) {
          const c = pop(s, rng, ev);
          if (c != null) reveal.push(c);
        }
        const extra = reveal.filter((c) => c === LOCO || (a.color >= 0 && c === a.color)).length;
        ev.push({ type: 'reveal', seat, route: r, cards: reveal, extra });
        s.tunnel = { route: r, color: a.color, colorN: R.len - a.locos, locos: a.locos, reveal, extra };
        if (extra === 0) {
          build(s, seat, r, cards, ev);
          s.discard.push(...reveal);
          s.tunnel = null;
          endTurn(s, ev);
        } else s.phase = 'tunnel';
      } else {
        build(s, seat, r, cards, ev);
        endTurn(s, ev);
      }
      break;
    }
    case 'tunnel': {
      if (s.phase !== 'tunnel' || !s.tunnel) return null;
      const t = s.tunnel;
      const paid: number[] = [];
      for (let k = 0; k < t.colorN; k++) paid.push(t.color);
      for (let k = 0; k < t.locos; k++) paid.push(LOCO);
      if (a.pay) {
        if (!tunnelPayable(s, seat)) return null;
        const extra: number[] = [];
        for (let k = 0; k < t.extra; k++) {
          if (t.color >= 0 && h[t.color] > 0) {
            h[t.color]--;
            extra.push(t.color);
          } else {
            h[LOCO]--;
            extra.push(LOCO);
          }
        }
        ev.push({ type: 'tunnelEnd', seat, route: t.route, ok: true, extra });
        build(s, seat, t.route, [...paid, ...extra], ev);
      } else {
        // карты — назад в руку
        for (const c of paid) h[c]++;
        ev.push({ type: 'tunnelEnd', seat, route: t.route, ok: false, extra: [] });
      }
      s.discard.push(...t.reveal);
      s.tunnel = null;
      endTurn(s, ev);
      break;
    }
    case 'station': {
      if (s.phase !== 'act') return null;
      if (!stationOptions(s, seat, a.city).length) return null;
      const k = stationCost(s, seat);
      if (a.color < 0) {
        if (a.locos !== k || h[LOCO] < k) return null;
      } else if (!stationColors(s, seat, a.city).includes(a.color) || a.locos < 0 || a.locos >= k || h[LOCO] < a.locos || h[a.color] < k - a.locos) return null;
      const cards = take(h, a.color < 0 ? LOCO : a.color, a.locos, stationCost(s, seat));
      s.discard.push(...cards);
      s.stations[seat]--;
      s.station[a.city] = seat;
      s.last = { city: a.city };
      ev.push({ type: 'station', seat, city: a.city, cards });
      endTurn(s, ev);
      break;
    }
    case 'ctrl': {
      if (s.phase !== 'act' || h[CTRL] <= 0) return null;
      const r = a.route;
      if (!(r >= 0 && r < ROUTES.length) || ROUTES[r].len > 4) return null;
      if (a.mode === 'remove') {
        const o = s.owner[r];
        if (o == null || o === seat) return null;
        s.owner[r] = null;
        s.wagons[o] += ROUTES[r].len;
        s.score[o] -= ROUTE_POINTS[ROUTES[r].len];
        h[CTRL]--;
        s.discard.push(CTRL);
        s.last = { route: r };
        ev.push({ type: 'remove', seat, route: r, owner: o, pts: ROUTE_POINTS[ROUTES[r].len] });
      } else {
        if (!routeOpen(s, seat, r)) return null;
        h[CTRL]--;
        build(s, seat, r, [CTRL], ev, true);
      }
      endTurn(s, ev);
      break;
    }
    case 'pass': {
      if (s.phase !== 'act' || anyMove(s, seat)) return null;
      ev.push({ type: 'pass', seat });
      endTurn(s, ev);
      break;
    }
    default:
      return null;
  }
  syncCounts(s);
  return { state: s, events: ev };
}
type S = State;

export function tunnelPayable(s: State, seat: number): boolean {
  const t = s.tunnel;
  const h = handOf(s, seat);
  if (!t || !h) return false;
  return t.color >= 0 ? h[t.color] + h[LOCO] >= t.extra : h[LOCO] >= t.extra;
}

function build(s: State, seat: number, r: number, cards: number[], ev: Event[], ctrl = false) {
  const R = ROUTES[r];
  s.owner[r] = seat;
  s.wagons[seat] -= R.len;
  const pts = ROUTE_POINTS[R.len];
  s.score[seat] += pts;
  s.discard.push(...cards);
  s.last = { route: r };
  ev.push({ type: 'claim', seat, route: r, cards, pts, ...(ctrl ? { ctrl: true } : {}) });
}

// ---------- подсчёт ----------

/** Связаны ли города a и b путями из набора (номера путей). */
export function connected(routes: Iterable<number>, a: number, b: number): boolean {
  const adj = new Map<number, number[]>();
  for (const r of routes) {
    const R = ROUTES[r];
    adj.set(R.a, [...(adj.get(R.a) ?? []), R.b]);
    adj.set(R.b, [...(adj.get(R.b) ?? []), R.a]);
  }
  const seen = new Set([a]);
  const st = [a];
  while (st.length) {
    const c = st.pop()!;
    if (c === b) return true;
    for (const d of adj.get(c) ?? [])
      if (!seen.has(d)) {
        seen.add(d);
        st.push(d);
      }
  }
  return false;
}

/** Самый длинный непрерывный путь игрока (в вагончиках; пути не повторяются, города — можно). */
export function longestPath(s: State, seat: number): number {
  const mine = ROUTES.map((_, i) => i).filter((i) => s.owner[i] === seat);
  if (!mine.length) return 0;
  const used = new Set<number>();
  let best = 0;
  const go = (c: number, len: number) => {
    if (len > best) best = len;
    for (const r of mine) {
      if (used.has(r)) continue;
      const R = ROUTES[r];
      if (R.a !== c && R.b !== c) continue;
      used.add(r);
      go(R.a === c ? R.b : R.a, len + R.len);
      used.delete(r);
    }
  };
  const cities = new Set(mine.flatMap((r) => [ROUTES[r].a, ROUTES[r].b]));
  for (const c of cities) go(c, 0);
  return best;
}

/** Маршруты игрока с лучшим выбором путей для его станций: сколько выполнено, плюс и минус. */
export function ticketScore(s: State, seat: number, tickets: number[]): { plus: number; minus: number; done: number[]; borrow: number[] } {
  const mine = ROUTES.map((_, i) => i).filter((i) => s.owner[i] === seat);
  const st = CITIES.map((_, c) => c).filter((c) => s.station[c] === seat);
  const choices = st.map((c) => [-1, ...ADJ[c].filter((r) => s.owner[r] != null && s.owner[r] !== seat)]);
  let best = { plus: 0, minus: 0, done: [] as number[], borrow: [] as number[] };
  let bestV = -Infinity;
  const pick: number[] = [];
  const evalNow = () => {
    const set = [...mine, ...pick.filter((r) => r >= 0)];
    let plus = 0;
    let minus = 0;
    const done: number[] = [];
    for (const t of tickets) {
      if (connected(set, TICKETS[t].a, TICKETS[t].b)) {
        plus += TICKETS[t].pts;
        done.push(t);
      } else minus += TICKETS[t].pts;
    }
    if (plus - minus > bestV) {
      bestV = plus - minus;
      best = { plus, minus, done, borrow: pick.filter((r) => r >= 0) };
    }
  };
  const go = (k: number) => {
    if (k === choices.length) return evalNow();
    for (const r of choices[k]) {
      pick.push(r);
      go(k + 1);
      pick.pop();
    }
  };
  go(0);
  return best;
}

function finish(s: State, ev: Event[]) {
  const rows: Row[] = [];
  for (let p = 0; p < s.n; p++) {
    const t = ticketScore(s, p, s.tickets[p] ?? []);
    rows.push({
      routes: s.score[p],
      plus: t.plus,
      minus: t.minus,
      done: t.done.length,
      stations: s.stations[p] * STATION_POINTS,
      bonus: [],
      bonusPts: 0,
      total: 0,
      longest: longestPath(s, p),
    });
  }
  const award = (id: BonusId, val: (p: number) => number) => {
    const vals = rows.map((_, p) => val(p));
    const m = Math.max(...vals);
    if (m <= 0) return;
    vals.forEach((v, p) => {
      if (v === m) {
        rows[p].bonus.push(id);
        rows[p].bonusPts += BONUS[id].pts;
      }
    });
  };
  award('path', (p) => rows[p].longest);
  if (s.cfg.bonuses) {
    award('rail', (p) => rows[p].done);
    award('ferry', (p) => ROUTES.filter((R, i) => s.owner[i] === p && R.ferry > 0).length);
    award('tunnel', (p) => ROUTES.filter((R, i) => s.owner[i] === p && R.tunnel).length);
  }
  for (const r of rows) r.total = r.routes + r.plus - r.minus + r.stations + r.bonusPts;
  const top = Math.max(...rows.map((r) => r.total));
  let win = rows.map((r, p) => (r.total === top ? p : -1)).filter((p) => p >= 0);
  // равенство: больше выполненных маршрутов, затем — самый длинный путь
  if (win.length > 1) {
    const d = Math.max(...win.map((p) => rows[p].done));
    win = win.filter((p) => rows[p].done === d);
  }
  if (win.length > 1) {
    const l = Math.max(...win.map((p) => rows[p].longest));
    win = win.filter((p) => rows[p].longest === l);
  }
  s.phase = 'over';
  s.result = { rows, winners: win };
  ev.push({ type: 'end', rows, winners: win });
}

// ---------- что видит игрок ----------

export function view(s: State, seats: number[] | 'all'): State {
  if (seats === 'all') return s;
  const v = clone(s);
  v.deck = [];
  v.tdeck = [];
  v.discard = [];
  if (s.phase === 'over') return v;
  for (let p = 0; p < s.n; p++) {
    if (seats.includes(p)) continue;
    v.hand[p] = null;
    v.tickets[p] = null;
    v.offer[p] = null;
  }
  return v;
}

export function redact(e: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all') return e;
  if (e.type === 'draw' && e.slot === -1 && !seats.includes(e.seat)) return { ...e, card: -1 };
  if (e.type === 'take' && !seats.includes(e.seat)) return { ...e, offer: null };
  if (e.type === 'keep' && !seats.includes(e.seat)) return { ...e, keep: null };
  return e;
}
