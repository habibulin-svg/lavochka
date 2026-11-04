/* Клиент сетевой карты: соединение с комнатой на сервере. Логики нет: шлёт действия, принимает мир своими глазами и события.
 * Бои на карте — теми же сообщениями, что Арена: клиент годится для Game (`BattleNet`). */
import { serverBase } from '../../core/net/ws';
import type { Action } from '../sim/battle';
import type { GenOptions } from '../sim/adv/gen';
import type { TownFaction } from '../sim/adv/town';
import type { AdvAction } from '../sim/adv/world';
import type { BotLevel } from '../bot/bot';
import type { HeroPick } from '../sim/heroes';
import type { MapClientMsg, MapClock, MapServerMsg } from './mapproto';
import { type MapRecord, patchJson } from './record';
import type { World } from '../sim/adv/world';
import type { BattleNet } from './protocol';

type Of<T extends MapServerMsg['t']> = Extract<MapServerMsg, { t: T }>;

export class MapClient implements BattleNet {
  code = '';
  you = -1;
  onLobby: (m: Of<'mlobby'>) => void = () => {};
  onDraft: (m: Of<'mdraft'>) => void = () => {};
  onStart: (m: Of<'mstart'>) => void = () => {};
  onMapStep: (m: Of<'mstep'>) => void = () => {};
  onBusy: (text: string) => void = () => {};
  onMapNope: (why: string) => void = () => {};
  onOver: (m: Of<'mover'>) => void = () => {};
  onNote: (text: string) => void = () => {};
  /** Запись партии пришла (после конца, по просьбе). */
  onRecord: (rec: MapRecord) => void = () => {};
  /** Зритель: мир, собранный из шагов записи. */
  private spec: World | null = null;
  private clock: MapClock | null = null;
  /** Бой на карте начался для этого места. */
  onFight: (m: Of<'start'>) => void = () => {};
  onStep: BattleNet['onStep'] = () => {};
  onNope: (why: string) => void = () => {};
  onResult: BattleNet['onResult'] = () => {};
  onPeer: (name: string, on: boolean) => void = () => {};
  onChat: (name: string, text: string) => void = () => {};
  onClose: (why: string) => void = () => {};
  private listeners = new Set<(m: MapServerMsg) => void>();
  private ping = 0;

  private constructor(private ws: WebSocket) {
    ws.onmessage = (e) => this.handle(JSON.parse(String(e.data)) as MapServerMsg);
    ws.onclose = () => {
      clearInterval(this.ping);
      this.onClose('Связь с сервером пропала.');
    };
    this.ping = window.setInterval(() => this.send({ t: 'ping' }), 15000);
  }

  /** Создать комнату или войти по коду. */
  static open(first: MapClientMsg): Promise<MapClient> {
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
        const m = JSON.parse(String(e.data)) as MapServerMsg;
        clearTimeout(timer);
        if (m.t === 'error') return reject(new Error(m.text));
        const c = new MapClient(ws);
        if (m.t === 'created' || m.t === 'joined') c.code = m.code;
        resolve(c);
      };
    });
  }

  private send(m: MapClientMsg): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  close(): void {
    clearInterval(this.ping);
    this.ws.onclose = null;
    this.ws.close();
  }

  seat(faction: TownFaction, hero: HeroPick): void {
    this.send({ t: 'mseat', faction, hero });
  }
  gen(gen: GenOptions): void {
    this.send({ t: 'mgen', gen });
  }
  bot(seat: number, bot: BotLevel | null): void {
    this.send({ t: 'mbot', seat, bot });
  }
  team(seat: number, team: number | null): void {
    this.send({ t: 'mteam', seat, team });
  }
  mail(on: boolean): void {
    this.send({ t: 'mmail', on });
  }
  ranked(on: boolean): void {
    this.send({ t: 'mranked', on });
  }
  simul(on: boolean): void {
    this.send({ t: 'msimul', on });
  }
  draftOpt(on: boolean): void {
    this.send({ t: 'mdraftopt', on });
  }
  /** Шаг драфта: бан героя, бан фракции или выбор. */
  draft(faction?: TownFaction, hero?: HeroPick): void {
    this.send({ t: 'mdraft', faction, hero });
  }
  /** Попросить запись партии (сервер даст её только после конца). */
  record(): void {
    this.send({ t: 'mrec' });
  }
  start(): void {
    this.send({ t: 'start' });
  }
  adv(a: AdvAction): void {
    this.send({ t: 'adv', a });
  }
  surrender(): void {
    this.send({ t: 'resign' });
  }
  act(a: Action): void {
    this.send({ t: 'act', a });
  }
  /** Кнопка «Сдаться» в бою: герой бежит, партия идёт дальше. */
  resign(): void {
    this.send({ t: 'bresign' });
  }
  chat(text: string): void {
    this.send({ t: 'chat', text });
  }

  private handle(m: MapServerMsg): void {
    switch (m.t) {
      case 'joined':
        this.code = m.code;
        break;
      case 'mlobby':
        this.you = m.you;
        this.onLobby(m);
        break;
      case 'mdraft':
        this.onDraft(m);
        break;
      case 'mstart':
        this.you = m.you;
        this.spec = m.seat === null ? structuredClone(m.world) : null;
        this.clock = m.clock;
        this.onStart(m);
        break;
      case 'mstep':
        this.onMapStep(m);
        break;
      case 'mspec':
        // зритель: шаги записи → обычные шаги карты (мир у каждого шага свой — показ идёт с отставанием)
        if (!this.spec || !this.clock) break;
        for (const st of m.steps) {
          this.spec = patchJson(this.spec, st.d);
          this.onMapStep({ t: 'mstep', events: st.ev, world: structuredClone(this.spec), clock: { ...this.clock, running: [], free: false }, seats: m.seats, actor: st.actor });
        }
        break;
      case 'mrecord':
        this.onRecord(m.rec);
        break;
      case 'mbusy':
        this.onBusy(m.text);
        break;
      case 'mnope':
        this.onMapNope(m.why);
        break;
      case 'mover':
        this.onOver(m);
        break;
      case 'mnote':
        this.onNote(m.text);
        break;
      case 'start':
        this.onFight(m);
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

  get id(): string {
    return String(this.you);
  }
  on(h: (m: MapServerMsg) => void): () => void {
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
