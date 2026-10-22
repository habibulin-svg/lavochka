/* Холдем на общем движке покера: переходник. Стол холдема и 3D-комната рисуют свой привычный вид (улицы словами, блайнд,
 * чужие карты — пусто) и свои события, а партию ведёт poker/engine.ts. Здесь — перевод View и событий движка в этот вид. */
import type { Card } from '../../cards/deck';
import { GAMES, minRaiseTo as pkMinRaise, richest, toCall as pkToCall, type Event as PEvent, type View as PView } from '../poker/engine';

export type Street = 'preflop' | 'flop' | 'turn' | 'river';
const STREETS: Street[] = ['preflop', 'flop', 'turn', 'river'];

export interface View {
  seats: number[];
  chips: number[];
  hand: number;
  button: number;
  /** Большой блайнд сейчас. */
  big: number;
  /** Подпись вида, если это не обычный холдем («Short Deck»). */
  title: string;
  /** Свои и вскрытые карты; чужие закрытые — пусто. */
  hole: Card[][];
  board: Card[];
  street: Street;
  bet: number[];
  total: number[];
  folded: boolean[];
  allin: boolean[];
  inHand: number[];
  current: number;
  turn: number;
  phase: 'play' | 'over';
  winner: number | null;
  /** Вид движка — для расчёта рейза. */
  src: PView;
}

export type Event =
  | { type: 'deal'; hand: number; button: number; big: number; seats: number[] }
  | { type: 'blind'; seat: number; amount: number }
  | { type: 'act'; seat: number; action: 'fold' | 'check' | 'call' | 'raise' | 'allin'; amount: number; to: number }
  | { type: 'street'; street: Street; cards: Card[] }
  | { type: 'show'; seat: number; cards: Card[]; hand: string }
  | { type: 'win'; seat: number; amount: number; hand: string; uncontested: boolean }
  | { type: 'bust'; seat: number }
  | { type: 'blinds'; big: number }
  | { type: 'end'; winner: number };

export function toView(v: PView): View {
  return {
    seats: v.seats,
    chips: v.chips,
    hand: v.hand,
    button: v.button,
    big: v.big,
    title: v.game === 'holdem' ? '' : GAMES[v.game].name,
    hole: v.hole.map((h) => (h.some((c) => c) ? h.slice() : [])),
    board: v.board,
    street: STREETS[Math.min(3, v.street)],
    bet: v.bet,
    total: v.total,
    folded: v.folded,
    allin: v.allin,
    inHand: v.inHand,
    current: v.current,
    turn: v.turn,
    phase: v.over ? 'over' : 'play',
    winner: v.over ? richest(v) : null,
    src: v,
  };
}

export function toEvents(evs: PEvent[]): Event[] {
  const out: Event[] = [];
  for (const e of evs) {
    switch (e.type) {
      case 'blinds':
        out.push({ type: 'blinds', big: e.big });
        break;
      case 'deal':
        out.push({ type: 'deal', hand: e.hand, button: e.button, big: e.big, seats: e.seats });
        break;
      case 'post':
        out.push({ type: 'blind', seat: e.seat, amount: e.amount });
        break;
      case 'act': {
        const t = e.action.type;
        const action = e.allin && t !== 'fold' && t !== 'check' ? 'allin' : t === 'fold' || t === 'check' || t === 'call' || t === 'raise' ? t : 'allin';
        out.push({ type: 'act', seat: e.seat, action, amount: e.amount, to: e.to });
        break;
      }
      case 'street':
        out.push({ type: 'street', street: STREETS[Math.min(3, e.street)], cards: e.board ?? [] });
        break;
      case 'show':
      case 'win':
      case 'bust':
      case 'end':
        out.push(e);
        break;
    }
  }
  return out;
}

/** Есть ли у игрока карты (по признаку участия в раздаче). */
export const holding = (v: View, seat: number) => v.inHand.includes(seat) && !v.folded[seat];
export const toCall = (v: View, seat: number) => pkToCall(v, seat);
/** Наименьший рейз «до» по правилам движка (безлимит, пот-лимит или лимит). */
export const minRaiseTo = (v: View, seat: number) => pkMinRaise(v.src, seat);
