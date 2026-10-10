/* Протокол комнаты. Одинаков для локальной игры, P2P (PeerJS) и сервера (WebSocket). */
import type { GameResult, Options, SeatKind } from './types';

export const PROTOCOL_VERSION = 1;

export interface SeatStatus {
  seat: number;
  kind: SeatKind;
  name: string;
  level: number;
  /** Место занято живым игроком (для «Сеть» — кто-то подключился). */
  filled: boolean;
  /** Игрок на связи. Если нет — за него ходит бот. */
  online: boolean;
}

/** Участник голосового чата (голос и видео идут напрямую между браузерами, комната только пересылает сигналы). */
export interface VoiceMember {
  id: string;
  name: string;
  seat: number | null;
  video: boolean;
}

export type ClientMsg =
  | { t: 'hello'; clientId: string; name: string; ownerKey?: string; v: number }
  | { t: 'act'; seat: number; action: unknown }
  | { t: 'chat'; text: string }
  | { t: 'idle'; seq: number }
  | { t: 'start'; fillBots: boolean }
  | { t: 'restart' }
  | { t: 'pong' }
  | { t: 'bye' }
  | { t: 'voice'; on: boolean; video?: boolean }
  | { t: 'rtc'; to: string; data: unknown };

export type RoomMsg =
  | { t: 'welcome'; code: string; game: string; options: Options; mySeats: number[]; owner: boolean }
  | { t: 'lobby'; seats: SeatStatus[] }
  | {
      t: 'start';
      seats: SeatStatus[];
      mySeats: number[];
      view: unknown;
      toAct: number[];
      seq: number;
      result: GameResult | null;
    }
  | {
      t: 'step';
      seq: number;
      actor: number | null;
      events: unknown[];
      view: unknown;
      toAct: number[];
      result: GameResult | null;
    }
  | { t: 'seats'; seats: SeatStatus[] }
  | { t: 'info'; text: string }
  | { t: 'chat'; name: string; seat: number | null; text: string }
  | { t: 'error'; text: string }
  | { t: 'closed'; reason?: string }
  | { t: 'ping' }
  | { t: 'voice'; members: VoiceMember[] }
  | { t: 'rtc'; from: string; data: unknown };

/** Двусторонний канал сообщений. Обработчики назначает тот, кто канал использует. */
export interface Link {
  send(msg: unknown): void;
  close(): void;
  onMessage: ((msg: any) => void) | null;
  onClose: (() => void) | null;
  /** Локальный канал (тот же браузер) — не нуждается в проверке связи. */
  local?: boolean;
}

/** Пара связанных каналов в памяти: для локальной игры и для хоста P2P (его собственный экран). */
export function localPair(): [Link, Link] {
  const mk = (): Link => ({ send() {}, close() {}, onMessage: null, onClose: null, local: true });
  const a = mk();
  const b = mk();
  let closed = false;
  const wire = (from: Link, to: Link) => {
    from.send = (msg) => {
      if (closed) return;
      // копия — как при передаче по сети: стороны не делят объекты
      const copy = structuredClone(msg);
      queueMicrotask(() => !closed && to.onMessage?.(copy));
    };
    from.close = () => {
      if (closed) return;
      closed = true;
      queueMicrotask(() => {
        a.onClose?.();
        b.onClose?.();
      });
    };
  };
  wire(a, b);
  wire(b, a);
  return [a, b];
}
