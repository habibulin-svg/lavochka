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
  onDesync: (turn: number) => void = () => {};
  onLeft: (name: string) => void = () => {};
  onClose: (why: string) => void = () => {};
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
        this.onDesync(m.turn);
        break;
      case 'left':
        this.onLeft(m.name);
        break;
      case 'error':
        this.onClose(m.text);
        break;
    }
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
