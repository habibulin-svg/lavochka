/* Игра через свой сервер (WebSocket). Сервер держит комнату и сам ведёт партию. */
import { settings } from '../settings';
import type { Link } from '../protocol';
import type { Options, SeatSpec } from '../types';

export const SERVER_CODE_LEN = 6;

export function serverBase(): string {
  const u = settings.serverUrl.trim().replace(/\/+$/, '');
  if (u) return u;
  return location.origin;
}

function wsUrl(): string {
  return serverBase().replace(/^http/, 'ws') + '/ws';
}

function open(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(wsUrl());
    } catch {
      return reject(new Error('Неверный адрес сервера.'));
    }
    const timer = setTimeout(() => {
      ws.close();
      reject(new Error('Сервер не отвечает. Бесплатный сервер может «просыпаться» до минуты — попробуйте ещё раз.'));
    }, 60000);
    ws.onopen = () => {
      clearTimeout(timer);
      resolve(ws);
    };
    ws.onerror = () => {
      clearTimeout(timer);
      reject(new Error('Нет связи с сервером.'));
    };
  });
}

/** Первое сообщение — служебное (create/join), ответ на него — тоже служебный; дальше канал работает как Link. */
function handshake(ws: WebSocket, first: unknown): Promise<{ link: Link; reply: any }> {
  return new Promise((resolve, reject) => {
    const link: Link = {
      send: (m) => ws.readyState === WebSocket.OPEN && ws.send(JSON.stringify(m)),
      close: () => ws.close(),
      onMessage: null,
      onClose: null,
    };
    let ready = false;
    ws.onmessage = (e) => {
      let msg: any;
      try {
        msg = JSON.parse(String(e.data));
      } catch {
        return;
      }
      if (!ready) {
        ready = true;
        if (msg.t === 'error') {
          ws.close();
          return reject(new Error(msg.text));
        }
        return resolve({ link, reply: msg });
      }
      link.onMessage?.(msg);
    };
    ws.onclose = () => {
      if (!ready) reject(new Error('Сервер закрыл соединение.'));
      link.onClose?.();
    };
    ws.send(JSON.stringify(first));
  });
}

export async function wsCreate(game: string, options: Options, seats: SeatSpec[]) {
  const ws = await open();
  const { link, reply } = await handshake(ws, { t: 'create', game, options, seats });
  return { link, code: reply.code as string, ownerKey: reply.ownerKey as string };
}

export async function wsJoin(code: string) {
  const ws = await open();
  const { link } = await handshake(ws, { t: 'join', code: code.trim().toUpperCase() });
  return link;
}

/** Таблица рекордов на сервере. Без сервера — пустой список. */
export async function fetchRecords(game: string): Promise<{ name: string; score: number; at: number }[]> {
  try {
    const r = await fetch(serverBase() + '/api/records/' + encodeURIComponent(game));
    if (!r.ok) return [];
    return await r.json();
  } catch {
    return [];
  }
}

export async function postRecord(game: string, name: string, score: number) {
  try {
    await fetch(serverBase() + '/api/records/' + encodeURIComponent(game), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, score }),
    });
  } catch {
    /* нет сервера — рекорд остаётся только локальным */
  }
}
