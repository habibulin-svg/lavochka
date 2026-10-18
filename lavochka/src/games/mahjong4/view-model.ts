/* Что видит игрок за столом маджонга (без DOM): своя рука, чужие — только число костей; сбросы, сеты, цветы, дора — всем.
 * Свои возможности хода (сброс, цумо, конг, риичи) и заявки на чужой сброс считаются здесь же — по ним рисуются кнопки и ходят боты. */
import { kindOf, suitOf } from '../mahjong/tiles';
import { counts, waits } from './hand';
import type { Meld } from './score';
import { canDiscard, canTsumo, riichiDiscards, rulesOf, seatWind, turnKans, wallLeft, type Cfg, type Disc, type HandResult, type Opts, type Phase, type State, type WinRec } from './engine';

export interface PView {
  /** Рука — только своя (или открытая после выигрыша/темпай при ничьей). */
  hand: number[] | null;
  count: number;
  melds: Meld[];
  discards: Disc[];
  flowers: number[];
  riichi: 0 | 1 | 2;
  missing: number;
  won: boolean;
  wind: number;
}

export interface TurnOpts {
  tsumo: boolean;
  kans: number[];
  riichi: number[];
  /** Какие кости сбросить можно. */
  ok: number[];
}

export interface View {
  cfg: Cfg;
  scores: number[];
  round: number;
  dealer: number;
  honba: number;
  sticks: number;
  wall: number;
  dora: number[];
  p: PView[];
  phase: Phase;
  turn: number;
  /** Взятая кость — только своему. */
  drawn: number;
  last: { seat: number; id: number } | null;
  /** Заявки для своих мест (ещё не ответили). */
  claims: Record<number, Opts>;
  /** Свой ход: что можно. */
  turnOpts: Record<number, TurnOpts>;
  /** Кто уже ответил на заявку / посмотрел итог. */
  waiting: number[];
  wins: WinRec[];
  result: HandResult | null;
  acks: boolean[];
  /** Ограбление конга — заявка на кость, добавляемую к пону. */
  rob: boolean;
}

export function makeView(s: State, seats: number[] | 'all'): View {
  const mine = (x: number) => seats === 'all' || seats.includes(x);
  const reveal = (x: number) => s.p[x].won || s.phase === 'over' || (s.phase === 'end' && !!s.result?.shown?.[x]);
  const p: PView[] = s.p.map((q, x) => ({
    hand: mine(x) || reveal(x) ? q.hand.slice() : null,
    count: q.hand.length,
    melds: q.melds,
    discards: q.discards,
    flowers: q.flowers,
    riichi: q.riichi,
    missing: q.missing,
    won: q.won,
    wind: seatWind(s, x),
  }));
  const claims: Record<number, Opts> = {};
  const turnOpts: Record<number, TurnOpts> = {};
  for (let x = 0; x < 4; x++) {
    if (!mine(x)) continue;
    if (s.phase === 'claim' && s.pending[x] && !s.answers[x]) claims[x] = s.pending[x];
    if (s.phase === 'turn' && s.turn === x) {
      turnOpts[x] = {
        tsumo: canTsumo(s, x),
        kans: turnKans(s, x),
        riichi: riichiDiscards(s, x),
        ok: s.p[x].hand.filter((id) => canDiscard(s, x, id)),
      };
    }
  }
  return {
    cfg: s.cfg,
    scores: s.scores.slice(),
    round: s.round,
    dealer: s.dealer,
    honba: s.honba,
    sticks: s.sticks,
    wall: wallLeft(s),
    dora: s.dora.slice(),
    p,
    phase: s.phase,
    turn: s.turn,
    drawn: s.phase === 'turn' && mine(s.turn) ? s.drawn : -1,
    last: s.last,
    claims,
    turnOpts,
    waiting: s.phase === 'claim' ? Object.keys(s.pending).map(Number).filter((x) => !s.answers[x]) : s.phase === 'end' ? [0, 1, 2, 3].filter((x) => !s.acks[x]) : [],
    wins: s.wins,
    result: s.result,
    acks: s.acks.slice(),
    rob: !!s.rob,
  };
}

/** Ожидания руки из 13 (или 16) костей: виды. */
export function handWaits(v: View, seat: number, hand: number[]): number[] {
  const q = v.p[seat];
  const w = waits(counts(hand.map(kindOf)), q.melds.length, rulesOf(v.cfg));
  if (v.cfg.sichuan && hand.some((id) => suitOf(kindOf(id)) === q.missing)) return [];
  return w;
}

/** Сколько костей вида видно этому игроку (своя рука, сбросы, сеты, указатели доры). */
export function visibleCounts(v: View, seat: number): number[] {
  const c = new Array(34).fill(0);
  const add = (id: number) => {
    const k = kindOf(id);
    if (k < 34) c[k]++;
  };
  for (const id of v.p[seat].hand ?? []) add(id);
  for (const q of v.p) {
    for (const d of q.discards) if (!d.taken) add(d.id);
    for (const m of q.melds) for (const id of m.ids) add(id);
  }
  for (const id of v.dora) add(id);
  return c;
}
