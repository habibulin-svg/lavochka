/* Шиш-беш — сетевая игра P2P (WebRTC через PeerJS). Хост авторитетен. */
(function () {
  const SH = (window.SH = window.SH || {});
  const PREFIX = 'shishbesh-v2-';
  const ALPH = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  function genCode() {
    let s = '';
    for (let i = 0; i < 5; i++) s += ALPH[Math.floor(Math.random() * ALPH.length)];
    return s;
  }

  function available() {
    return typeof window.Peer === 'function';
  }

  /** Хост: создаёт комнату. handlers: onConnect(conn), onData(conn,msg), onClose(conn), onError(err) */
  function host(handlers, attempt = 0) {
    return new Promise((resolve, reject) => {
      if (!available()) return reject(new Error('Библиотека PeerJS не загрузилась (нужен интернет).'));
      const code = genCode();
      const peer = new window.Peer(PREFIX + code, { debug: 0 });
      let opened = false;
      peer.on('open', () => {
        opened = true;
        resolve({ peer, code });
      });
      peer.on('connection', (conn) => {
        conn.on('open', () => handlers.onConnect && handlers.onConnect(conn));
        conn.on('data', (msg) => handlers.onData && handlers.onData(conn, msg));
        conn.on('close', () => handlers.onClose && handlers.onClose(conn));
        conn.on('error', () => handlers.onClose && handlers.onClose(conn));
      });
      peer.on('disconnected', () => {
        // потеря связи с сигнальным сервером — пробуем переподключиться, P2P-каналы живут
        if (!peer.destroyed) setTimeout(() => !peer.destroyed && peer.reconnect(), 1500);
      });
      peer.on('error', (err) => {
        if (!opened) {
          peer.destroy();
          if (err.type === 'unavailable-id' && attempt < 3) host(handlers, attempt + 1).then(resolve, reject);
          else reject(err);
        } else if (handlers.onError) handlers.onError(err);
      });
    });
  }

  /** Клиент: подключается к комнате по коду. */
  function join(code, handlers) {
    return new Promise((resolve, reject) => {
      if (!available()) return reject(new Error('Библиотека PeerJS не загрузилась (нужен интернет).'));
      const peer = new window.Peer({ debug: 0 });
      let done = false;
      const timer = setTimeout(() => {
        if (!done) {
          done = true;
          peer.destroy();
          reject(new Error('Хост не отвечает. Проверьте код комнаты.'));
        }
      }, 15000);
      peer.on('open', () => {
        const conn = peer.connect(PREFIX + code.trim().toUpperCase(), { reliable: true });
        conn.on('open', () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          resolve({ peer, conn });
        });
        conn.on('data', (msg) => handlers.onData && handlers.onData(msg));
        conn.on('close', () => handlers.onClose && handlers.onClose());
        conn.on('error', () => handlers.onClose && handlers.onClose());
      });
      peer.on('error', (err) => {
        if (!done) {
          done = true;
          clearTimeout(timer);
          peer.destroy();
          reject(err.type === 'peer-unavailable' ? new Error('Комната не найдена. Проверьте код.') : err);
        } else if (handlers.onClose) handlers.onClose();
      });
    });
  }

  SH.Net = { host, join, available };
})();
