/* «Космические войны» — движок (без DOM). Правила — по листку советского «Риска» (освоение галактики):
 * раздача карточек территорий, звездолёты, освоение (3 кубика против 2), одно перемещение, новые звездолёты за целые планеты
 * и за обмен карточек; тайные цели (3–4 игрока), вдвоём — с «союзником», усложнённый вариант — освоить всю галактику с нарастающим обменом.
 * Ход игрока: подкрепления → освоение → перемещение (в листке этапы идут кругом по всем игрокам; у нас — весь «тур» за один ход игрока). */
import { shuffle } from '../../core/rng';
import type { Rng } from '../../core/types';
import { ADJ, CARDS_N, GOALS, JOKER_A, PLANETS, PLANET_TERRS, TERRS, TRADE_FIXED, cardMethod, growing } from './data';

export type Mode = 'goals' | 'duel' | 'galaxy';
export interface Cfg {
  mode: Mode;
  /** Обмен карточек: по листку (4/6/8/10/12) или нарастающий. */
  growing: boolean;
  /** Предел туров (после — побеждает, у кого больше территорий). */
  limit: number;
}
export const cfgFrom = (o: Record<string, unknown>): Cfg => {
  const mode = (o.mode === 'duel' || o.mode === 'galaxy' ? o.mode : 'goals') as Mode;
  return { mode, growing: o.trade === 'growing' || (o.trade == null && mode === 'galaxy'), limit: Number(o.limit) || 60 };
};

/** Звездолётов в начале на игрока. */
export const START_SHIPS: Record<number, number> = { 2: 40, 3: 35, 4: 30 };
export const ALLY_SHIPS = 28;

export type Phase = 'setup' | 'reinforce' | 'attack' | 'move' | 'over';

export interface State {
  cfg: Cfg;
  n: number;
  /** Союзник вдвоём — «игрок» с номером n (не место за столом). */
  ally: boolean;
  owner: number[];
  ships: number[];
  hand: (number[] | null)[];
  handN: number[];
  deck: number[];
  deckN: number;
  discard: number[];
  goal: (number | null)[];
  out: boolean[];
  turn: number;
  phase: Phase;
  /** Сколько звездолётов ещё поставить (свои). */
  pending: number;
  /** Сколько поставить союзнику (вдвоём: половина подкреплений соперника — ставит этот игрок). */
  allyPending: number;
  /** Сколько получит союзник от подкреплений этого хода (поставит следующий игрок). */
  allyNext: number;
  /** Сколько обменов уже было (нарастающий обмен). */
  trades: number;
  /** Освоил ли игрок территорию в этот ход (для журнала). */
  conquered: number;
  round: number;
  last: { from?: number; to?: number; dice?: [number[], number[]] } | null;
  result: { winners: number[]; text: string } | null;
}

export type Action =
  | { type: 'place'; t: number; n: number }
  | { type: 'trade'; cards: number[] }
  | { type: 'go' }
  | { type: 'attack'; from: number; to: number; dice: number; all?: boolean }
  | { type: 'endAttack' }
  | { type: 'move'; from: number; to: number; n: number }
  | { type: 'end' };

export type Event =
  | { type: 'deal'; owner: number[] }
  | { type: 'place'; seat: number; t: number; n: number; ally?: boolean }
  | { type: 'income'; seat: number; n: number; planets: number[]; ally: number }
  | { type: 'trade'; seat: number; cards: number[]; n: number }
  | { type: 'roll'; seat: number; from: number; to: number; a: number[]; d: number[]; lostA: number; lostD: number }
  | { type: 'conquer'; seat: number; from: number; to: number; moved: number; card: boolean }
  | { type: 'out'; seat: number; by: number; cards: number }
  | { type: 'move'; seat: number; from: number; to: number; n: number }
  | { type: 'turn'; seat: number }
  | { type: 'end'; winners: number[]; text: string };

const clone = (s: State): State => JSON.parse(JSON.stringify(s));
export const ALLY = (s: State) => s.n;

export function newState(n: number, cfg: Cfg, rng: Rng): State {
  // вдвоём — всегда с союзником; «союзник» при 3–4 игроках не бывает — тогда тайные цели
  const duel = n === 2;
  const s: State = {
    cfg: { ...cfg, mode: duel ? 'duel' : cfg.mode === 'duel' ? 'goals' : cfg.mode },
    n,
    ally: duel,
    owner: TERRS.map(() => -1),
    ships: TERRS.map(() => 0),
    hand: [],
    handN: [],
    deck: [],
    deckN: 0,
    discard: [],
    goal: [],
    out: [],
    turn: 0,
    phase: 'setup',
    pending: 0,
    allyPending: 0,
    allyNext: 0,
    trades: 0,
    conquered: 0,
    round: 1,
    last: null,
    result: null,
  };
  const goals = shuffle(GOALS.map((_, i) => i), rng);
  for (let p = 0; p < n; p++) {
    s.hand.push([]);
    s.handN.push(0);
    s.goal.push(s.cfg.mode === 'goals' ? goals[p] : null);
    s.out.push(false);
  }
  if (duel) {
    // вдвоём: джокеры убраны, по 14 карточек; оставшиеся 14 территорий — союзнику по 2 звездолёта
    const cards = shuffle(TERRS.map((_, i) => i), rng);
    cards.forEach((c, k) => {
      const who = k < 14 ? 0 : k < 28 ? 1 : n;
      s.owner[c] = who;
      s.ships[c] = who === n ? 2 : 1;
    });
    s.deck = shuffle(TERRS.map((_, i) => i), rng);
  } else {
    // раздача всех карточек вместе с джокерами по кругу; джокер территории не даёт
    const cards = shuffle(Array.from({ length: CARDS_N }, (_, i) => i), rng);
    cards.forEach((c, k) => {
      if (c >= JOKER_A) return;
      s.owner[c] = k % n;
      s.ships[c] = 1;
    });
    s.deck = shuffle(Array.from({ length: CARDS_N }, (_, i) => i), rng);
  }
  s.deckN = s.deck.length;
  s.turn = 0;
  s.pending = START_SHIPS[n] - count(s, 0);
  return s;
}

export const count = (s: State, p: number) => s.owner.filter((o) => o === p).length;
export const planetsOf = (s: State, p: number) => PLANETS.map((_, k) => k).filter((k) => PLANET_TERRS[k].every((t) => s.owner[t] === p));

export function toAct(s: State): number[] {
  return s.phase === 'over' ? [] : [s.turn];
}

/** Цена обмена набора (0 — не набор). */
export function setKind(cards: number[]): 'same' | 'mixed' | 'joker' | null {
  if (cards.length !== 3 || new Set(cards).size !== 3) return null;
  const m = cards.map(cardMethod);
  const j = m.filter((x) => x < 0).length;
  const real = m.filter((x) => x >= 0);
  if (j === 0) {
    if (real[0] === real[1] && real[1] === real[2]) return 'same';
    if (new Set(real).size === 3) return 'mixed';
    return null;
  }
  if (j === 1 && real[0] === real[1]) return 'joker';
  return null;
}

export function tradeValue(s: State, cards: number[]): number {
  const k = setKind(cards);
  if (!k) return 0;
  if (s.cfg.growing) return growing(s.trades);
  if (k === 'same') return TRADE_FIXED.same[cardMethod(cards.find((c) => c < JOKER_A)!)];
  return k === 'mixed' ? TRADE_FIXED.mixed : TRADE_FIXED.joker;
}

/** Все наборы в руке (лучшие — первыми). */
export function sets(s: State, p: number): number[][] {
  const h = s.hand[p] ?? [];
  const out: number[][] = [];
  for (let a = 0; a < h.length; a++) for (let b = a + 1; b < h.length; b++) for (let c = b + 1; c < h.length; c++) if (setKind([h[a], h[b], h[c]])) out.push([h[a], h[b], h[c]]);
  out.sort((x, y) => tradeValue(s, y) - tradeValue(s, x));
  return out;
}

/** Можно ли начинать освоение: всё поставлено и на руке меньше пяти карточек (иначе обмен обязателен). */
export const mustTrade = (s: State, p: number) => (s.hand[p]?.length ?? s.handN[p]) >= 5 && sets(s, p).length > 0;
export const canGo = (s: State, p: number) => s.pending === 0 && s.allyPending === 0 && !mustTrade(s, p);

/** Может ли игрок seat вести освоение с from на to (свои или союзнические звездолёты). */
export function canAttack(s: State, seat: number, from: number, to: number): boolean {
  if (!ADJ[from].includes(to)) return false;
  const o = s.owner[from];
  if (s.ships[from] < 2) return false;
  if (o === seat) return s.owner[to] !== seat;
  if (s.ally && o === ALLY(s)) return s.owner[to] !== seat && s.owner[to] !== ALLY(s);
  return false;
}

export function canMove(s: State, seat: number, from: number, to: number): boolean {
  return s.owner[from] === seat && s.owner[to] === seat && ADJ[from].includes(to) && s.ships[from] >= 2;
}

/** Цель достигнута? */
export function goalDone(s: State, p: number): boolean {
  if (s.cfg.mode === 'galaxy') return s.owner.every((o) => o === p);
  if (s.cfg.mode === 'duel') {
    const opp = 1 - p;
    return !s.owner.some((o) => o === opp);
  }
  const g = s.goal[p];
  if (g == null) return false;
  const G = GOALS[g];
  const mine = planetsOf(s, p);
  if (!G.planets.every((k) => mine.includes(k))) return false;
  if (G.plusPlanet && !mine.some((k) => !G.planets.includes(k))) return false;
  const terr = TERRS.map((_, i) => i).filter((i) => s.owner[i] === p);
  if (G.plusTerrs != null) {
    const base = G.planets.reduce((a, k) => a + PLANET_TERRS[k].length, 0);
    if (terr.length < base + G.plusTerrs) return false;
  }
  if (G.terrs != null) {
    const ok = G.two ? terr.filter((t) => s.ships[t] >= 2).length : terr.length;
    if (ok < G.terrs) return false;
  }
  return true;
}

function draw(s: State, rng: Rng): number | null {
  if (!s.deck.length && s.discard.length) {
    s.deck = shuffle(s.discard, rng);
    s.discard = [];
  }
  const c = s.deck.pop();
  s.deckN = s.deck.length;
  return c ?? null;
}

/** Начало хода: подкрепления за целые планеты; вдвоём — союзнику половина. */
function startTurn(s: State, ev: Event[]) {
  s.phase = 'reinforce';
  s.conquered = 0;
  s.last = null;
  const p = s.turn;
  const planets = planetsOf(s, p);
  const n = planets.reduce((a, k) => a + PLANETS[k].bonus, 0);
  s.pending = n;
  ev.push({ type: 'turn', seat: p });
  let ally = 0;
  if (s.ally && n > 0 && s.owner.some((o) => o === ALLY(s))) ally = Math.floor(n / 2);
  ev.push({ type: 'income', seat: p, n, planets, ally });
  // союзнику ставит соперник — в свой ход
  s.allyNext = ally;
  maybeSkip(s);
}

/** Нечего ставить и нечего менять — сразу к освоению. */
function maybeSkip(s: State) {
  const p = s.turn;
  if (s.phase === 'reinforce' && s.pending === 0 && s.allyPending === 0 && !sets(s, p).length) s.phase = 'attack';
}

function nextTurn(s: State, ev: Event[]) {
  // отложенные подкрепления союзника переходят к следующему игроку
  const allyGift = s.allyNext;
  s.allyNext = 0;
  let p = s.turn;
  for (let k = 0; k < s.n; k++) {
    p = (p + 1) % s.n;
    if (p === 0) s.round++;
    if (!s.out[p]) break;
  }
  s.turn = p;
  if (s.round > s.cfg.limit) return finishByCount(s, ev);
  s.allyPending = s.ally && s.owner.some((o) => o === ALLY(s)) ? allyGift : 0;
  startTurn(s, ev);
}

function finishByCount(s: State, ev: Event[]) {
  const c = Array.from({ length: s.n }, (_, p) => (s.out[p] ? -1 : count(s, p)));
  const m = Math.max(...c);
  const w = c.map((x, p) => (x === m ? p : -1)).filter((p) => p >= 0);
  end(s, ev, w, `прошло ${s.cfg.limit} туров — больше всех территорий (${m})`);
}

function end(s: State, ev: Event[], winners: number[], text: string) {
  s.phase = 'over';
  s.result = { winners, text };
  ev.push({ type: 'end', winners, text });
}

function checkWin(s: State, ev: Event[]): boolean {
  const p = s.turn;
  if (goalDone(s, p)) {
    const text =
      s.cfg.mode === 'galaxy' ? 'освоил всю галактику' : s.cfg.mode === 'duel' ? 'освоил все территории соперника' : `выполнил цель: ${GOALS[s.goal[p]!].text.toLowerCase()}`;
    end(s, ev, [p], text);
    return true;
  }
  const alive = Array.from({ length: s.n }, (_, k) => k).filter((k) => !s.out[k]);
  if (alive.length === 1) {
    end(s, ev, alive, 'остался один');
    return true;
  }
  return false;
}

export function syncCounts(s: State) {
  s.deckN = s.deck.length;
  for (let p = 0; p < s.n; p++) {
    const h = s.hand[p];
    if (h) s.handN[p] = h.length;
  }
}

/** Один бросок: кубики, потери, взятие. Возвращает, взята ли территория. */
function roll(s: State, seat: number, from: number, to: number, dice: number, rng: Rng, ev: Event[]): boolean {
  const a = Array.from({ length: dice }, () => rng.int(6) + 1).sort((x, y) => y - x);
  const dn = Math.min(2, s.ships[to]);
  const d = Array.from({ length: dn }, () => rng.int(6) + 1).sort((x, y) => y - x);
  let lostA = 0;
  let lostD = 0;
  for (let k = 0; k < Math.min(a.length, d.length); k++) {
    if (a[k] > d[k]) lostD++;
    else lostA++;
  }
  s.ships[from] -= lostA;
  s.ships[to] -= lostD;
  s.last = { from, to, dice: [a, d] };
  ev.push({ type: 'roll', seat, from, to, a, d, lostA, lostD });
  if (s.ships[to] > 0) return false;
  // взята: входят звездолёты последнего броска (уцелевшие)
  const victim = s.owner[to];
  const attacker = s.owner[from];
  const moved = Math.max(1, Math.min(dice - lostA, s.ships[from] - 1));
  s.owner[to] = attacker;
  s.ships[to] = moved;
  s.ships[from] -= moved;
  let card = false;
  if (attacker === seat) {
    const c = draw(s, rng);
    if (c != null) {
      s.hand[seat]!.push(c);
      card = true;
    }
  }
  s.conquered++;
  ev.push({ type: 'conquer', seat, from, to, moved, card });
  if (victim >= 0 && victim < s.n && !s.owner.includes(victim)) {
    s.out[victim] = true;
    const got = s.hand[victim]!.splice(0);
    // карточки выбывшего — тому, кто уничтожил его последний звездолёт (союзник карточек не берёт)
    if (attacker === seat) s.hand[seat]!.push(...got);
    else s.discard.push(...got);
    ev.push({ type: 'out', seat: victim, by: seat, cards: got.length });
  }
  return true;
}

export function apply(s0: State, seat: number, a: Action, rng: Rng): { state: State; events: Event[] } | null {
  if (s0.phase === 'over' || seat !== s0.turn) return null;
  const s = clone(s0);
  const ev: Event[] = [];
  switch (a.type) {
    case 'place': {
      const n = Math.floor(a.n);
      if (!(n >= 1) || !(a.t >= 0 && a.t < TERRS.length)) return null;
      if (s.phase === 'setup' || s.phase === 'reinforce') {
        // сначала — союзнику (вдвоём), потом свои
        if (s.allyPending > 0) {
          if (s.owner[a.t] !== ALLY(s) || n > s.allyPending) return null;
          s.ships[a.t] += n;
          s.allyPending -= n;
          ev.push({ type: 'place', seat, t: a.t, n, ally: true });
        } else {
          if (s.owner[a.t] !== seat || n > s.pending) return null;
          s.ships[a.t] += n;
          s.pending -= n;
          ev.push({ type: 'place', seat, t: a.t, n });
        }
      } else return null;
      if (s.phase === 'setup' && s.pending === 0) {
        // расстановка по кругу: следующий игрок
        if (seat === s.n - 1) {
          s.turn = 0;
          s.round = 1;
          startTurn(s, ev);
        } else {
          s.turn = seat + 1;
          s.pending = START_SHIPS[s.n] - count(s, s.turn);
        }
      } else if (s.phase === 'reinforce') maybeSkip(s);
      break;
    }
    case 'trade': {
      if (s.phase !== 'reinforce') return null;
      const h = s.hand[seat]!;
      if (!a.cards.every((c) => h.includes(c))) return null;
      const v = tradeValue(s, a.cards);
      if (!v) return null;
      s.hand[seat] = h.filter((c) => !a.cards.includes(c));
      s.discard.push(...a.cards);
      s.trades++;
      s.pending += v;
      ev.push({ type: 'trade', seat, cards: a.cards, n: v });
      break;
    }
    case 'go': {
      if (s.phase !== 'reinforce' || !canGo(s, seat)) return null;
      s.phase = 'attack';
      break;
    }
    case 'attack': {
      if (s.phase !== 'attack' || !canAttack(s, seat, a.from, a.to)) return null;
      const dice = Math.floor(a.dice);
      if (!(dice >= 1 && dice <= 3 && dice <= s.ships[a.from] - 1)) return null;
      for (let k = 0; k < 200; k++) {
        const d = Math.min(dice, s.ships[a.from] - 1);
        const taken = roll(s, seat, a.from, a.to, d, rng, ev);
        if (taken) {
          checkWin(s, ev);
          break;
        }
        if (!a.all || s.ships[a.from] < 2) break;
      }
      break;
    }
    case 'endAttack': {
      if (s.phase !== 'attack') return null;
      s.phase = 'move';
      if (!movesExist(s, seat)) {
        nextTurn(s, ev);
      }
      break;
    }
    case 'move': {
      if (s.phase !== 'move' && s.phase !== 'attack') return null;
      const n = Math.floor(a.n);
      if (!canMove(s, seat, a.from, a.to) || !(n >= 1 && n <= s.ships[a.from] - 1)) return null;
      s.ships[a.from] -= n;
      s.ships[a.to] += n;
      s.last = { from: a.from, to: a.to };
      ev.push({ type: 'move', seat, from: a.from, to: a.to, n });
      if (!checkWin(s, ev)) nextTurn(s, ev);
      break;
    }
    case 'end': {
      if (s.phase !== 'move' && s.phase !== 'attack') return null;
      if (!checkWin(s, ev)) nextTurn(s, ev);
      break;
    }
    default:
      return null;
  }
  syncCounts(s);
  return { state: s, events: ev };
}

function movesExist(s: State, seat: number): boolean {
  for (let t = 0; t < TERRS.length; t++) if (s.owner[t] === seat && s.ships[t] >= 2 && ADJ[t].some((u) => s.owner[u] === seat)) return true;
  return false;
}

// ---------- что видит игрок ----------

export function view(s: State, seats: number[] | 'all'): State {
  if (seats === 'all' || s.phase === 'over') return s;
  const v = clone(s);
  v.deck = [];
  v.discard = [];
  for (let p = 0; p < s.n; p++) {
    if (seats.includes(p)) continue;
    v.hand[p] = null;
    v.goal[p] = null;
  }
  return v;
}
