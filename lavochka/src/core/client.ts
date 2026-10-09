/* Клиент комнаты: шлёт hello, отвечает на ping, следит за связью и раздаёт сообщения интерфейсу. */
import { PROTOCOL_VERSION, type ClientMsg, type Link, type RoomMsg } from './protocol';
import { settings } from './settings';

type Handler = (msg: RoomMsg) => void;

const LOST_MS = 11000;

export class RoomClient {
  private handlers = new Set<Handler>();
  private lastSeen = Date.now();
  private watchdog: ReturnType<typeof setInterval> | undefined;
  private dead = false;
  /** Пользователь сам вышел — обрыв не считается потерей связи. */
  leaving = false;
  onLost: (() => void) | null = null;
  /** Пока интерфейс игры грузится, сообщения копятся здесь (кроме ping). */
  private held: RoomMsg[] | null = [];
  welcome: Extract<RoomMsg, { t: 'welcome' }> | null = null;
  private welcomeWaiters: { ok: (w: Extract<RoomMsg, { t: 'welcome' }>) => void; fail: (e: Error) => void }[] = [];

  constructor(
    private link: Link,
    hello: { name: string; ownerKey?: string }
  ) {
    link.onMessage = (m: RoomMsg) => this.receive(m);
    link.onClose = () => this.lost();
    this.send({ t: 'hello', clientId: settings.clientId, name: hello.name, ownerKey: hello.ownerKey, v: PROTOCOL_VERSION });
    if (!link.local) {
      this.watchdog = setInterval(() => {
        if (Date.now() - this.lastSeen > LOST_MS) this.lost();
      }, 2000);
    }
  }

  on(h: Handler) {
    this.handlers.add(h);
    return () => this.handlers.delete(h);
  }

  private receive(m: RoomMsg) {
    if (this.dead || !m || typeof m !== 'object') return;
    this.lastSeen = Date.now();
    if (m.t === 'ping') return this.send({ t: 'pong' });
    if (m.t === 'welcome') {
      this.welcome = m;
      this.welcomeWaiters.splice(0).forEach((w) => w.ok(m));
    }
    if (m.t === 'error' && !this.welcome) this.welcomeWaiters.splice(0).forEach((w) => w.fail(new Error(m.text)));
    if (this.held) {
      this.held.push(m);
      if (m.t === 'closed') this.welcomeWaiters.splice(0).forEach((w) => w.fail(new Error('Комната закрыта.')));
      return;
    }
    this.handlers.forEach((h) => h(m));
    if (m.t === 'closed') this.shutdown();
  }

  /** Дождаться ответа комнаты на hello. */
  waitWelcome(): Promise<Extract<RoomMsg, { t: 'welcome' }>> {
    if (this.welcome) return Promise.resolve(this.welcome);
    if (this.dead) return Promise.reject(new Error('Нет связи.'));
    return new Promise((ok, fail) => this.welcomeWaiters.push({ ok, fail }));
  }

  /** Интерфейс готов — отдать накопленные сообщения и дальше передавать сразу. */
  release() {
    const q = this.held;
    this.held = null;
    if (!q) return;
    for (const m of q) {
      this.handlers.forEach((h) => h(m));
      if (m.t === 'closed') this.shutdown();
    }
  }

  send(msg: ClientMsg) {
    if (this.dead) return;
    try {
      this.link.send(msg);
    } catch {
      /* обрыв заметит сторож */
    }
  }

  act(seat: number, action: unknown) {
    this.send({ t: 'act', seat, action });
  }
  chat(text: string) {
    this.send({ t: 'chat', text });
  }
  idle(seq: number) {
    this.send({ t: 'idle', seq });
  }
  start(fillBots: boolean) {
    this.send({ t: 'start', fillBots });
  }
  restart() {
    this.send({ t: 'restart' });
  }

  private shutdown() {
    this.dead = true;
    clearInterval(this.watchdog);
    try {
      this.link.onClose = null;
      this.link.close();
    } catch {
      /* ignore */
    }
  }

  private lost() {
    if (this.dead) return;
    this.shutdown();
    this.welcomeWaiters.splice(0).forEach((w) => w.fail(new Error('Соединение оборвалось.')));
    if (!this.leaving) this.onLost?.();
  }

  leave() {
    this.leaving = true;
    this.send({ t: 'bye' });
    setTimeout(() => this.shutdown(), 50);
  }

  get alive() {
    return !this.dead;
  }
}
