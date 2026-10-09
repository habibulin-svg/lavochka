/* P2P через PeerJS (WebRTC). Публичный сигнальный сервер нужен только для установки связи. */
import type { DataConnection, Peer as PeerT } from 'peerjs';
import type { Link } from '../protocol';

const PREFIX = 'lavochka-v1-';
const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const P2P_CODE_LEN = 5;

export function genCode(len: number) {
  let s = '';
  for (let i = 0; i < len; i++) s += ALPH[Math.floor(Math.random() * ALPH.length)];
  return s;
}

async function loadPeer(): Promise<typeof PeerT> {
  const mod = await import('peerjs');
  return mod.Peer;
}

function wrap(conn: DataConnection): Link {
  const link: Link = {
    send: (msg) => conn.open && conn.send(msg),
    close: () => conn.close(),
    onMessage: null,
    onClose: null,
  };
  let gone = false;
  const bye = () => {
    if (gone) return;
    gone = true;
    link.onClose?.();
  };
  conn.on('data', (d) => link.onMessage?.(d));
  conn.on('close', bye);
  conn.on('error', bye);
  return link;
}

export interface P2PHost {
  code: string;
  destroy(): void;
}

/** Хост: регистрирует код комнаты и отдаёт каждое входящее соединение в onLink. */
export async function p2pHost(onLink: (link: Link) => void, attempt = 0): Promise<P2PHost> {
  const Peer = await loadPeer();
  return new Promise((resolve, reject) => {
    const code = genCode(P2P_CODE_LEN);
    const peer = new Peer(PREFIX + code, { debug: 0 });
    let opened = false;
    peer.on('open', () => {
      opened = true;
      resolve({ code, destroy: () => peer.destroy() });
    });
    peer.on('connection', (conn) => conn.on('open', () => onLink(wrap(conn))));
    peer.on('disconnected', () => {
      // связь с сигнальным сервером пропала — уже открытые P2P-каналы живут, переподключаемся
      setTimeout(() => !peer.destroyed && peer.reconnect(), 1500);
    });
    peer.on('error', (err: any) => {
      if (opened) return console.warn('peer', err);
      peer.destroy();
      if (err.type === 'unavailable-id' && attempt < 3) p2pHost(onLink, attempt + 1).then(resolve, reject);
      else reject(new Error('Не удалось создать комнату: ' + (err.message || err.type)));
    });
  });
}

/** Клиент: подключение к комнате по коду. */
export async function p2pJoin(code: string): Promise<Link> {
  const Peer = await loadPeer();
  return new Promise((resolve, reject) => {
    const peer = new Peer({ debug: 0 });
    let done = false;
    const fail = (e: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      peer.destroy();
      reject(e);
    };
    const timer = setTimeout(() => fail(new Error('Хост не отвечает. Проверьте код комнаты.')), 15000);
    peer.on('open', () => {
      const conn = peer.connect(PREFIX + code.trim().toUpperCase(), { reliable: true });
      conn.on('open', () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        const link = wrap(conn);
        const close = link.close;
        link.close = () => {
          close();
          setTimeout(() => peer.destroy(), 100);
        };
        resolve(link);
      });
    });
    peer.on('error', (err: any) =>
      fail(err.type === 'peer-unavailable' ? new Error('Комната не найдена. Проверьте код.') : new Error(err.message || String(err.type)))
    );
  });
}
