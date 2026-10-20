/* Протокол комнаты. Одинаков для локальной игры, P2P (PeerJS) и сервера (WebSocket). */
import type { GameResult, Options, SeatKind } from './types';

export const PROTOCOL_VERSION = 3;

export interface SeatStatus {
  seat: number;
  kind: SeatKind;
  name: string;
  level: number;
  /** Место занято живым игроком (для «Сеть» — кто-то подключился). */
  filled: boolean;
  /** Игрок на связи. Если нет — за него ходит бот. */
  online: boolean;
  /** Аватар игрока (значок или адрес фото). */
  avatar?: string | null;
  /** Выбранный персонаж (холдем 3D). */
  look?: string | null;
}

/** Кто я за столом: имя, аватар, персонаж. */
export interface Me {
  name: string;
  avatar?: string | null;
  look?: string | null;
}

/** Хозяин в лобби: пересадить, отдать место боту или сети, выгнать, рассадить случайно, сменить варианты и число мест. */
export type HostOp =
  | { op: 'swap'; a: number; b: number }
  | { op: 'kind'; seat: number; kind: SeatKind; level?: number }
  | { op: 'kick'; seat: number }
  | { op: 'shuffle' }
  | { op: 'setup'; options: Options; count: number };

/** Участник голосового чата (голос и видео идут напрямую между браузерами, комната только пересылает сигналы). */
export interface VoiceMember {
  id: string;
  name: string;
  seat: number | null;
  video: boolean;
}

export type ClientMsg =
  | { t: 'hello'; clientId: string; name: string; avatar?: string | null; look?: string | null; ownerKey?: string; v: number }
  /** Сменить имя, аватар, персонажа (в лобби). */
  | ({ t: 'me' } & Me)
  /** Гость пересаживается на свободное место (в лобби). */
  | { t: 'sit'; seat: number }
  | ({ t: 'host' } & HostOp)
  | { t: 'act'; seat: number; action: unknown }
  /** Игра реального времени: текущее управление места (шлётся, пока меняется). */
  | { t: 'input'; seat: number; input: unknown }
  | { t: 'chat'; text: string }
  /** Доиграл анимацию до seq; fast — «пропустить»: боты ходят без пауз. */
  | { t: 'idle'; seq: number; fast?: boolean }
  /** Подождите ms (не дольше 30 с), боты не ходят: стол ещё грузится; 0 — готово. */
  | { t: 'hold'; ms: number }
  | { t: 'start'; fillBots: boolean }
  | { t: 'restart' }
  | { t: 'pong' }
  | { t: 'bye' }
  /** Клиент не дождался ответа на свой ход — прислать стол заново. */
  | { t: 'sync' }
  | { t: 'voice'; on: boolean; video?: boolean }
  | { t: 'rtc'; to: string; data: unknown };

export type RoomMsg =
  | { t: 'welcome'; code: string; game: string; options: Options; mySeats: number[]; owner: boolean }
  /** Лобби: места, варианты (хозяин мог сменить) и свои места этого экрана. */
  | { t: 'lobby'; seats: SeatStatus[]; options: Options; mySeats: number[] }
  | {
      t: 'start';
      seats: SeatStatus[];
      mySeats: number[];
      view: unknown;
      toAct: number[];
      seq: number;
      result: GameResult | null;
      /** Тот же стол заново (после «sync»), не новая партия. */
      resync?: boolean;
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
  /** Игра реального времени: снимок поля и события с прошлого снимка. */
  | { t: 'rt'; view: unknown; events: unknown[] }
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
  /** Можно ли включать камеру (право video проверил сервер); не задано — не проверяем (локально, P2P). */
  video?: boolean;
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
