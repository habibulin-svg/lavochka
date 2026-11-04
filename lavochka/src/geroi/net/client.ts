/* Клиент Арены: соединение с комнатой на сервере. Логики нет: шлёт выбор и ходы, принимает события со снимком. */
import { serverBase } from '../../core/net/ws';
import type { Action } from '../sim/battle';
import type { NetClientMsg, NetServerMsg } from './protocol';

type Of<T extends NetServerMsg['t']> = Extract<NetServerMsg, { t: T }>;

export class ArenaClient {
  code = '';
  you = -1;
  onJoined: (code: string) => void = () => {};
  onLobby: (m: Of<'lobby'>) => void = () => {};
  onDraft: (m: Of<'draft'>) => void = () => {};
  onStart: (m: Of<'start'>) => void = () => {};
  onStep: (m: Of<'step'>) => void = () => {};
  onNope: (why: string) => void = () => {};
  onResult: (m: Of<'result'>) => void = () => {};
  onPeer: (name: string, on: boolean) => void = () => {};
  onChat: (name: string, text: string) => void = () => {};
  onClose: (why: string) => void = () => {};
  /** Подписчики голоса (core/voice.ts ждёт клиента с on/voice/rtc/id). */
  private listeners = new Set<(m: NetServerMsg) => void>();
  private ping = 0;

  private constructor(private ws: WebSocket) {
    ws.onmessage = (e) => this.handle(JSON.parse(String(e.data)) as NetServerMsg);
    ws.onclose = () => {
      clearInterval(this.ping);
      this.onClose('Связь с сервером пропала.');
    };
    // держим соединение живым (прокси рвут молчащие)
    this.ping = window.setInterval(() => this.send({ t: 'ping' }), 15000);
  }

  /** Создать комнату, войти по коду или встать в очередь. */
  static open(first: NetClientMsg): Promise<ArenaClient> {
    // разработка: ?ws=http://localhost:8788 — свой сервер мимо прокси Vite
    const dev = import.meta.env.DEV ? new URLSearchParams(location.search).get('ws') : null;
    const ws = new WebSocket((dev ?? serverBase()).replace(/^http/, 'ws') + '/ws');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error('Сервер не отвечает.'));
      }, 15000);
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error('Нет связи с сервером.'));
      };
      ws.onopen = () => ws.send(JSON.stringify(first));
      ws.onmessage = (e) => {
        const m = JSON.parse(String(e.data)) as NetServerMsg;
        clearTimeout(timer);
        if (m.t === 'error') return reject(new Error(m.text));
        const c = new ArenaClient(ws);
        if (m.t === 'created' || m.t === 'joined') c.code = m.code;
        resolve(c);
      };
    });
  }

  private send(m: NetClientMsg): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  close(): void {
    clearInterval(this.ping);
    this.ws.onclose = null;
    this.ws.close();
  }

  budget(budget: number): void {
    this.send({ t: 'budget', budget });
  }
  start(): void {
    this.send({ t: 'start' });
  }
  pick(i: number): void {
    this.send({ t: 'pick', i });
  }
  act(a: Action): void {
    this.send({ t: 'act', a });
  }
  resign(): void {
    this.send({ t: 'resign' });
  }
  chat(text: string): void {
    this.send({ t: 'chat', text });
  }

  private handle(m: NetServerMsg): void {
    switch (m.t) {
      case 'joined':
        this.code = m.code;
        this.onJoined(m.code);
        break;
      case 'lobby':
        this.you = m.you;
        this.onLobby(m);
        break;
      case 'draft':
        this.onDraft(m);
        break;
      case 'start':
        this.you = m.you;
        this.onStart(m);
        break;
      case 'step':
        this.onStep(m);
        break;
      case 'nope':
        this.onNope(m.why);
        break;
      case 'result':
        this.onResult(m);
        break;
      case 'peer':
        this.onPeer(m.name, m.on);
        break;
      case 'chat':
        this.onChat(m.name, m.text);
        break;
      case 'error':
        this.onClose(m.text);
        break;
    }
    if (m.t === 'voice' || m.t === 'rtc') for (const l of this.listeners) l(m);
  }

  /** Для голосового чата: свой id, подписка, вход/выход, сигнал собеседнику. */
  get id(): string {
    return String(this.you);
  }
  on(h: (m: NetServerMsg) => void): () => void {
    this.listeners.add(h);
    return () => this.listeners.delete(h);
  }
  voice(on: boolean, video = false): void {
    this.send({ t: 'voice', on, video });
  }
  rtc(to: string, data: unknown): void {
    this.send({ t: 'rtc', to, data });
  }
}
