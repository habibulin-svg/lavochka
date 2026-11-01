/* Клиент сети ГОПС: соединение с комнатой-ретранслятором, лобби, буфер кадров для лок-степа. */
import { serverBase } from '../../core/net/ws';
import type { Input } from '../sim/world';
import type { FrameIn, Held, NetClientMsg, NetPeer, NetServerMsg, NetSetup, Once } from './protocol';

export class NetClient {
  code = '';
  peers: NetPeer[] = [];
  you = -1;
  setup: NetSetup | null = null;
  /** Кадры до upto (не включая) пришли; ввод — по кадрам. */
  upto = 0;
  private frames = new Map<number, FrameIn[]>();
  onLobby: () => void = () => {};
  onStart: (setup: NetSetup, seed: number) => void = () => {};
  /** Миры разошлись: upto — кадр снимка, mine — снимок шлю я. */
  onDesync: (turn: number, upto: number, mine: boolean) => void = () => {};
  /** Пришёл весь снимок (JSON) — наложить на кадре frame. */
  onSnapshot: (frame: number, turn: number, json: string) => void = () => {};
  private parts: string[] = [];
  onLeft: (name: string) => void = () => {};
  onClose: (why: string) => void = () => {};
  onChat: (name: string, text: string) => void = () => {};
  /** Подписчики на сообщения голоса (core/voice.ts ждёт клиента с on/voice/rtc/id). */
  private listeners = new Set<(m: NetServerMsg) => void>();
  private lastHeld = '';
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

  /** Создать комнату (ответ — код) или войти по коду. */
  static async open(first: NetClientMsg): Promise<NetClient> {
    const url = serverBase().replace(/^http/, 'ws') + '/ws';
    const ws = new WebSocket(url);
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
        if (m.t === 'error') {
          reject(new Error(m.text));
          return;
        }
        if (m.t === 'created' || m.t === 'joined') {
          const c = new NetClient(ws);
          c.code = m.code;
          resolve(c);
        }
      };
    });
  }

  send(m: NetClientMsg): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  close(): void {
    clearInterval(this.ping);
    this.ws.onclose = null;
    this.ws.close();
  }

  private handle(m: NetServerMsg): void {
    switch (m.t) {
      case 'lobby':
        this.setup = m.setup;
        this.peers = m.peers;
        this.you = m.you;
        this.onLobby();
        break;
      case 'start':
        this.setup = m.setup;
        this.onStart(m.setup, m.seed);
        break;
      case 'f':
        for (const fi of m.ins) {
          const list = this.frames.get(fi[0]);
          if (list) list.push(fi);
          else this.frames.set(fi[0], [fi]);
        }
        this.upto = m.upto;
        break;
      case 'desync':
        this.parts = [];
        this.onDesync(m.turn, m.upto, m.from === this.you);
        break;
      case 'snap':
        this.parts[m.i] = m.data;
        if (m.i === m.n - 1) this.onSnapshot(m.frame, m.turn, this.parts.join(''));
        break;
      case 'left':
        this.onLeft(m.name);
        break;
      case 'error':
        this.onClose(m.text);
        break;
      case 'chat':
        this.onChat(m.name, m.text);
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

  /** Отправить снимок частями (у сервера предел сообщения 64 КБ). */
  sendSnapshot(frame: number, turn: number, json: string): void {
    const size = 40000;
    const n = Math.ceil(json.length / size);
    for (let i = 0; i < n; i++) this.send({ t: 'snap', frame, turn, i, n, data: json.slice(i * size, (i + 1) * size) });
  }

  chat(text: string): void {
    this.send({ t: 'chat', text });
  }

  /** Ввод кадра по бригадам (и забыть кадр). */
  take(frame: number): Map<number, Input> {
    const out = new Map<number, Input>();
    for (const [, side, inp] of this.frames.get(frame) ?? []) out.set(side, inp);
    this.frames.delete(frame);
    return out;
  }

  /** Отправить свой ввод бригады: удерживаемое — только при изменении, разовое — если есть. */
  input(side: number, inp: Input): void {
    const held: Held = {};
    if (inp.move) held.move = inp.move;
    if (inp.aim) held.aim = inp.aim;
    if (inp.fire) held.fire = true;
    const once: Once = {};
    if (inp.jump) once.jump = inp.jump;
    if (inp.weapon) once.weapon = inp.weapon;
    if (inp.fuse) once.fuse = inp.fuse;
    if (inp.target) once.target = inp.target;
    const key = `${side}:${JSON.stringify(held)}`;
    const hasOnce = Object.keys(once).length > 0;
    if (key === this.lastHeld && !hasOnce) return;
    this.send({ t: 'in', side, held: key !== this.lastHeld ? held : undefined, once: hasOnce ? once : undefined });
    this.lastHeld = key;
  }
}
