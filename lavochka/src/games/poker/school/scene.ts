/* Школа покера — стол урока из описания Scene: настоящая раздача движка (блайнды, анте, порядок хода) с заданными
 * картами и колодой, затем ходы `pre` до нужного места. Без DOM — его же гоняют тест и tools/poker/school-check.ts. */
import type { Card, Suit } from '../../../cards/deck';
import { SeededRng } from '../../../core/rng';
import { apply, cfgFrom, deal, GAMES, newState, type Action, type State } from '../engine';
import { allCards } from '../hands';
import type { ActSpec, Scene } from './types';

const RANK: Record<string, number> = { A: 14, K: 13, Q: 12, J: 11, T: 10 };
const SUITS = new Set(['S', 'H', 'D', 'C']);

/** Карта из записи «AH», «10H», «TH». */
export function card(t: string): Card {
  const s = t.slice(-1).toUpperCase();
  const rs = t.slice(0, -1).toUpperCase();
  const r = RANK[rs] ?? Number(rs);
  if (!SUITS.has(s) || !(r >= 2 && r <= 14)) throw new Error(`нет такой карты: «${t}»`);
  return { s: s as Suit, r };
}
export const cards = (t: string | undefined): Card[] => (t ?? '').split(/[\s,]+/).filter(Boolean).map(card);
const key = (c: Card) => c.s + c.r;

export const toAction = (a: ActSpec): Action => (a[1] === 'raise' ? { type: 'raise', to: a[2] } : { type: a[1] });

/** Открытые карты стада по умолчанию — как раздаёт движок: 2 закрытые, открытые, последняя закрытая. */
function studUp(game: State['game'], n: number): number[] {
  if (GAMES[game].cards === 7) return Array.from({ length: n }, (_, i) => i).filter((i) => i >= 2 && i < 6);
  return Array.from({ length: n }, (_, i) => i).filter((i) => i >= 1);
}

export interface Built {
  s: State;
  hero: number;
  /** Сколько ходов `pre` сыграно (все — если ошибки нет). */
  error?: string;
}

/** Собрать стол. Ошибка (карта дважды, ход не подошёл) — в `error`, стол — до неё. */
export function buildScene(sc: Scene): Built {
  const n = Math.max(2, Math.min(9, sc.n ?? 6));
  const seats = Array.from({ length: n }, (_, i) => i);
  const hero = sc.hero ?? 0;
  const cfg = { ...cfgFrom({ mode: sc.mode ?? 'holdem', hilo: !!sc.hilo, ...(sc.struct ? { struct: sc.struct } : {}) }), every: 0, hands: 0, ante: sc.ante ?? 'none' };
  const s0 = newState(cfg, seats);
  const [small, big] = sc.blinds ?? [10, 20];
  s0.small = small;
  s0.big = big;
  s0.chips = s0.chips.map((_, p) => (p < n ? (Array.isArray(sc.stack) ? (sc.stack[p] ?? 1000) : (sc.stack ?? 1000)) : 0));
  // deal() передвигает баттон на следующего — ставим на место перед нужным
  const btn = sc.button ?? n - 1;
  s0.button = (btn + n - 1) % n;
  const rng = new SeededRng(11);
  const s = deal(s0, rng).state;
  const g = GAMES[s.game];
  let error: string | undefined;
  // свои карты и доска; остальное — из колоды по порядку
  const given: Record<number, Card[]> = {};
  const used = new Set<string>();
  const take = (cs: Card[], what: string) => {
    for (const c of cs) {
      if (used.has(key(c))) error ??= `карта ${c.r}${c.s} дважды (${what})`;
      used.add(key(c));
    }
  };
  for (const [p, t] of Object.entries(sc.hands ?? {})) {
    const cs = cards(t);
    given[Number(p)] = cs;
    take(cs, `место ${p}`);
  }
  const board = cards(sc.board);
  take(board, 'доска');
  const pool = allCards(g.short).filter((c) => !used.has(key(c)));
  const next = () => pool.shift()!;
  for (const p of s.inHand) {
    const cs = given[p] ?? s.hole[p].map(() => next());
    s.hole[p] = cs;
    if (g.family === 'stud') {
      const up = new Set(sc.up?.[p] ?? studUp(s.game, cs.length));
      s.up[p] = cs.map((_, i) => up.has(i));
    } else s.up[p] = cs.map(() => false);
    if (s.rec) {
      s.rec.hole[p] = cs.slice();
      if (s.rec.up) s.rec.up[p] = s.up[p].slice();
    }
  }
  // колода флоповых видов: сжечь, флоп, сжечь, тёрн, сжечь, ривер
  if (g.family === 'flop') {
    const b = board.slice(s.board.length);
    const deck: Card[] = [];
    if (b.length) deck.push(next(), ...b.splice(0, 3));
    if (b.length) deck.push(next(), b.shift()!);
    if (b.length) deck.push(next(), b.shift()!);
    s.deck = [...deck, ...pool];
  } else s.deck = pool;
  s.muck = [];
  if (sc.show != null) {
    s.board = board.slice(0, sc.show);
    s.street = sc.show >= 5 ? 3 : sc.show === 4 ? 2 : sc.show >= 3 ? 1 : 0;
    return { s, hero, error };
  }
  let cur = s;
  for (const [i, a] of (sc.pre ?? []).entries()) {
    if (error) break;
    const r = apply(cur, a[0], toAction(a), rng);
    if (!r) {
      error = `ход ${i + 1} (${a.join(' ')}) не подошёл: ходит место ${cur.turn}`;
      break;
    }
    cur = r.state;
  }
  // «все спасовали до героя»
  for (let k = 0; sc.foldTo && !error && !cur.over && cur.turn !== hero && k < 9; k++) {
    const r = apply(cur, cur.turn, { type: 'fold' }, rng);
    if (!r) break;
    cur = r.state;
  }
  return { s: cur, hero, error };
}

/** Сыграть ход показа; null — не подошёл. */
export function playAct(s: State, a: ActSpec, rng = new SeededRng(13)): State | null {
  return apply(s, a[0], toAction(a), rng)?.state ?? null;
}

// ---------------------------------------------------------------- позиции

/** Названия позиций за столом на n: от первого после большого блайнда до большого блайнда. */
export function positionNames(n: number): string[] {
  if (n === 2) return ['BTN', 'BB'];
  const early: Record<number, string[]> = {
    0: [],
    1: ['UTG'],
    2: ['UTG', 'CO'],
    3: ['UTG', 'HJ', 'CO'],
    4: ['UTG', 'MP', 'HJ', 'CO'],
    5: ['UTG', 'UTG+1', 'MP', 'HJ', 'CO'],
    6: ['UTG', 'UTG+1', 'UTG+2', 'MP', 'HJ', 'CO'],
  };
  return [...early[n - 3], 'BTN', 'SB', 'BB'];
}

/** Позиция места: по баттону и местам раздачи. */
export function positionOf(s: Pick<State, 'button' | 'inHand'>, seat: number): string {
  const ring = s.inHand.slice().sort((a, b) => a - b);
  const n = ring.length;
  const names = positionNames(n);
  const bi = ring.indexOf(s.button);
  // по кругу от баттона: BTN, SB, BB, затем ранние
  const k = (ring.indexOf(seat) - bi + n) % n;
  if (n === 2) return k === 0 ? 'BTN' : 'BB';
  if (k === 0) return 'BTN';
  if (k === 1) return 'SB';
  if (k === 2) return 'BB';
  return names[k - 3];
}

/** Порядок хода до флопа: от первого после большого блайнда до большого блайнда. */
export function preflopOrder(s: Pick<State, 'button' | 'inHand'>): number[] {
  const ring = s.inHand.slice().sort((a, b) => a - b);
  const n = ring.length;
  const bi = ring.indexOf(s.button);
  const bb = n === 2 ? (bi + 1) % n : (bi + 2) % n;
  return Array.from({ length: n }, (_, i) => ring[(bb + 1 + i) % n]);
}
