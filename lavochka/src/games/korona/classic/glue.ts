/**
 * «Корона Эмбера», «Классика 1994» — стыковка с играми сборника (без DOM): настройка, что видит игрок, бот, журнал.
 * Методы def.ts вызывают эти функции, когда состояние партии — классическое (`'shelf' in state`).
 */
import type { GameResult, Rng, SeatSpec } from '../../../core/types';
import { esc } from '../../../core/util';
import { botAction } from './ai';
import { advOf, apply, newState, result, thingName, type Action, type Event } from './engine';
import { HIDDEN_CARDS } from './special-cards2';
import type { CHero, CState } from './state';

export type { CState } from './state';
export type CAction = Action;
/** События классики несут метку `c` — по ней журнал и вид отличают их от событий упрощённой игры (формы пересекаются). */
export type CEvent = Event & { c: 1 };
/** Что видит игрок: без порядка колоды, без чужих карт колдовства в руке и без служебных данных чужих вопросов. */
export type ClassicView = Omit<CState, 'deck'> & { deckLeft: number };

export const isCEvent = (e: unknown): e is CEvent => !!e && typeof e === 'object' && 'c' in e;

export function classicSetup(seats: SeatSpec[], rng: Rng): CState {
  return newState(
    seats.map((s) => ({ seat: s.seat, kind: s.kind === 'bot' ? ('bot' as const) : ('human' as const), name: s.name, level: s.level })),
    rng,
  );
}

export const classicToAct = (s: CState): number[] => (s.winner != null ? [] : [s.prompt ? s.prompt.seat : s.turn]);

export function classicApply(s: CState, seat: number, a: CAction, rng: Rng) {
  const r = apply(s, seat, a, rng);
  return r ? { state: r.state, events: r.events.map((e): CEvent => ({ ...e, c: 1 })) } : null;
}

/** Неизвестная чужая карта в руке: вид показывает рубашку. */
export const HIDDEN_THING = 'h';

const hideHand = (h: CHero): CHero => ({
  ...h,
  things: h.things.map((t) => {
    const a = advOf(t);
    return a != null && HIDDEN_CARDS.has(a) ? { id: HIDDEN_THING } : t;
  }),
});

export function classicView(s: CState, seats: number[] | 'all'): ClassicView {
  const mine = (o: number) => seats === 'all' || seats.includes(o);
  const { deck, ...rest } = s;
  const heroes: CState['heroes'] = {};
  for (const o of s.seats) heroes[o] = mine(o) ? s.heroes[o] : hideHand(s.heroes[o]);
  const prompt = s.prompt && !mine(s.prompt.seat) ? { ...s.prompt, data: undefined } : s.prompt;
  return { ...rest, heroes, prompt, log: s.log.slice(-24), deckLeft: deck.length };
}

export function classicRedact(e: unknown, seats: number[] | 'all'): never | CEvent | null {
  const ev = e as CEvent;
  if (!isCEvent(ev) || ev.type !== 'thing' || seats === 'all' || seats.includes(ev.seat)) return e as CEvent;
  const a = advOf({ id: ev.id });
  return a != null && HIDDEN_CARDS.has(a) ? { ...ev, id: HIDDEN_THING } : ev;
}

export function classicResult(s: CState): GameResult | null {
  const r = result(s);
  return r ? { winners: [r.winner], text: r.text, scores: Object.fromEntries(s.seats.map((seat, i) => [seat, r.scores[i]])) } : null;
}

export const classicBot = (v: ClassicView, seat: number, level: number, rng: Rng): CAction | null => botAction({ ...v, deck: [] } as CState, seat, level, rng);

/** Строка журнала для события классики; `undefined` — это не событие классики. */
export function classicDescribe(e: unknown, name: (seat: number) => string): string | null | undefined {
  if (!isCEvent(e)) return undefined;
  switch (e.type) {
    case 'roll':
      return `${name(e.seat)} бросает кубик${e.why ? ` (${esc(e.why)})` : ''}: ${e.dice && e.dice.length > 1 ? `${e.dice.join('+')}=${e.die}` : e.die}`;
    case 'card':
      return `${name(e.seat)}: <b>${esc(e.title)}</b>`;
    case 'pts':
      return e.delta ? `${name(e.seat)}: ${e.p} ${e.delta > 0 ? '+' : '−'}${Math.abs(e.delta)}` : null;
    case 'say':
      return esc(e.text);
    case 'thing':
      return e.id === HIDDEN_THING
        ? `${name(e.seat)} ${e.gain ? 'берёт' : 'теряет'} карту колдовства`
        : `${name(e.seat)} ${e.gain ? 'получает' : 'теряет'} <b>${esc(thingName({ id: e.id }))}</b>`;
    case 'zone':
      return esc(e.text);
    case 'over':
      return `${name(e.winner)} коронован — Владыка Королевства Эмбер!`;
    default:
      return null;
  }
}
