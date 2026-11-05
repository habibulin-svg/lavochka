/* Сеть «Героев» (DESIGN.md §10): сервер авторитетный — держит бой, проверяет ходы и шлёт события со снимком. Клиент ничего не считает сам,
 * рассинхрона быть не может. Чужие карточки драфта до выбора не уходят. */
import type { VoiceMember } from '../../core/protocol';
import type { ArmySlot } from '../sim/army';
import type { Action, BattleEvent, BattleState } from '../sim/battle';
import { CELLS } from '../sim/hex';
import type { DraftCard } from '../sim/draft';
import type { HeroPick } from '../sim/heroes';
import { SPELLS } from '../sim/spells';

export const BUDGETS = [10000, 20000];
export const DEFAULT_BUDGET = 20000;

export type NetClientMsg =
  | { t: 'create'; game: 'geroi'; name: string; token: string; budget: number }
  | { t: 'join'; game: 'geroi'; code: string; name: string; token: string }
  /** Подбор соперника: первый ждёт, второй садится с ним. */
  | { t: 'queue'; game: 'geroi'; name: string; token: string }
  | { t: 'budget'; budget: number }
  | { t: 'start' }
  | { t: 'pick'; i: number }
  | { t: 'act'; a: Action }
  | { t: 'resign' }
  | { t: 'chat'; text: string }
  | { t: 'voice'; on: boolean; video?: boolean }
  | { t: 'rtc'; to: string; data: unknown }
  | { t: 'ping' };

export interface NetPeer {
  id: number;
  name: string;
  seat: number | null;
  /** Сейчас на связи. */
  on: boolean;
}

export interface DraftView {
  round: number;
  rounds: number;
  budget: number;
  /** Свои карточки этого круга (зрителю — пусто). */
  offer: DraftCard[];
  picked: number;
  /** Сделанный выбор обеих сторон. */
  sides: [{ hero: HeroPick | null; army: ArmySlot[]; thinking: boolean }, { hero: HeroPick | null; army: ArmySlot[]; thinking: boolean }];
  /** Сколько мс осталось на круг. */
  ms: number;
}

export interface ClockView {
  bank: [number, number];
  /** Часы ходящего пойдут через столько мс: пока показываем удар. */
  waitMs: number;
}

export interface ResultView {
  winner: number;
  why: 'battle' | 'resign' | 'gone';
  /** Рейтинговая партия: что стало по местам. */
  rating?: [{ r: number; delta: number } | null, { r: number; delta: number } | null];
}

export type NetServerMsg =
  | { t: 'created'; code: string }
  | { t: 'joined'; code: string }
  | { t: 'queued' }
  | { t: 'error'; text: string }
  | { t: 'lobby'; budget: number; peers: NetPeer[]; you: number; host: boolean; rated: boolean }
  | { t: 'draft'; d: DraftView; seat: number | null; peers: NetPeer[] }
  | { t: 'start'; state: BattleState; seat: number | null; names: [string, string]; clock: ClockView; result?: ResultView; you: number }
  | { t: 'step'; events: BattleEvent[]; state: BattleState; clock: ClockView }
  | { t: 'nope'; why: string }
  | { t: 'result'; result: ResultView }
  | { t: 'peer'; name: string; on: boolean }
  | { t: 'chat'; name: string; text: string }
  | { t: 'voice'; members: VoiceMember[] }
  | { t: 'rtc'; from: string; data: unknown }
  | { t: 'pong' };

/** Что бою (Game) нужно от сетевого клиента: Арена и сетевая карта шлют бой одними сообщениями. Голосу — id, on, voice, rtc. */
export interface BattleNet {
  onStep: (m: Extract<NetServerMsg, { t: 'step' }>) => void;
  onNope: (why: string) => void;
  onResult: (m: Extract<NetServerMsg, { t: 'result' }>) => void;
  onPeer: (name: string, on: boolean) => void;
  onChat: (name: string, text: string) => void;
  act(a: Action): void;
  resign(): void;
  chat(text: string): void;
  readonly id: string;
  voice(on: boolean, video?: boolean): void;
  rtc(to: string, data: unknown): void;
}

const isCell = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0 && (x as number) < CELLS;
const isUnit = (x: unknown): x is number => Number.isInteger(x) && (x as number) >= 0 && (x as number) < 16;

/** Ход из сети: только известные поля и разумные значения; иначе null. */
export function cleanAction(raw: unknown): Action | null {
  const a = raw as Record<string, unknown> | null;
  switch (a?.t) {
    case 'move':
      return isCell(a.to) ? { t: 'move', to: a.to } : null;
    case 'attack':
      return isUnit(a.target) && isCell(a.from) ? { t: 'attack', target: a.target, from: a.from } : null;
    case 'shoot':
      return isUnit(a.target) ? { t: 'shoot', target: a.target } : null;
    case 'aid':
      return isUnit(a.target) ? { t: 'aid', target: a.target } : null;
    case 'cast':
      return typeof a.spell === 'string' && Object.hasOwn(SPELLS, a.spell) && isCell(a.cell) ? { t: 'cast', spell: a.spell, cell: a.cell } : null;
    case 'wait':
      return { t: 'wait' };
    case 'defend':
      return { t: 'defend' };
    case 'flee':
      return { t: 'flee' };
    default:
      return null;
  }
}
