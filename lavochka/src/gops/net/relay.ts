/* Комната ГОПС на сервере — ретранслятор кадров (без сокетов: сервер даёт ей peer.send и зовёт tick по таймеру).
 * Лобби: хозяин задаёт настройку, гости садятся за бригады 'net'. Партия: часы 60 кадров/с, в каждый кадр —
 * удерживаемый ввод бригад плюс одно разовое из очереди; рассылка пачками раз в BATCH_MS; журнал — для сверки и опоздавших. */
import type { Input } from '../sim/world';
import { BATCH_MS, FRAME_MS, type FrameIn, type Held, type NetClientMsg, type NetPeer, type NetServerMsg, type NetSetup, type Once, cleanInput, cleanSetup, emptyInput } from './protocol';

export interface RelayPeer {
  id: number;
  name: string;
  send(m: NetServerMsg): void;
}

const MAX_ONCE = 8;

export class GopsRelay {
  private peers: { p: RelayPeer; side: number | null; host: boolean }[] = [];
  private held: Held[] = [];
  private once: Once[][] = [];
  private started = false;
  private t0 = 0;
  private frame = 0;
  private sentAt = 0;
  private pending: FrameIn[] = [];
  /** Хеш первого присланного для хода — с ним сверяются остальные. */
  private hashes = new Map<number, number>();
  desynced = false;

  constructor(public setup: NetSetup, private seed: number) {}

  get isEmpty(): boolean {
    return this.peers.length === 0;
  }

  get isStarted(): boolean {
    return this.started;
  }

  add(p: RelayPeer, host: boolean): void {
    this.peers.push({ p, side: null, host });
    this.lobby();
  }

  remove(p: RelayPeer): void {
    const i = this.peers.findIndex((x) => x.p === p);
    if (i < 0) return;
    const [gone] = this.peers.splice(i, 1);
    // его бригады стоят: ввод — пустой
    for (const s of this.sidesOf(gone)) {
      this.held[s] = {};
      this.once[s] = [];
    }
    if (this.started) this.broadcast({ t: 'left', name: gone.p.name });
    else this.lobby();
  }

  /** Бригады, которыми правит участник: хозяин — все 'host', гость — свою. */
  private sidesOf(x: { side: number | null; host: boolean }): number[] {
    const own = this.setup.sides.flatMap((s, i) => (x.host && s.who === 'host' ? [i] : []));
    if (x.side != null) own.push(x.side);
    return own;
  }

  message(p: RelayPeer, m: NetClientMsg): void {
    const me = this.peers.find((x) => x.p === p);
    if (!me) return;
    switch (m.t) {
      case 'setup': {
        if (!me.host || this.started) return;
        const s = cleanSetup(m.setup);
        if (!s) return;
        this.setup = s;
        // кто сидел за бригадой, которая больше не сетевая, — встаёт
        for (const x of this.peers) if (x.side != null && s.sides[x.side]?.who !== 'net') x.side = null;
        this.lobby();
        return;
      }
      case 'claim': {
        if (this.started) return;
        const side = m.side;
        if (side == null) me.side = null;
        else if (this.setup.sides[side]?.who === 'net' && !this.peers.some((x) => x.side === side)) me.side = side;
        this.lobby();
        return;
      }
      case 'start': {
        if (!me.host || this.started) return;
        this.started = true;
        this.held = this.setup.sides.map(() => ({}));
        this.once = this.setup.sides.map(() => []);
        this.broadcast({ t: 'start', setup: this.setup, seed: this.seed });
        return;
      }
      case 'in': {
        if (!this.started || !this.sidesOf(me).includes(m.side)) return;
        if (m.held) {
          const h = cleanInput(m.held);
          this.held[m.side] = { move: h.move, aim: h.aim, fire: h.fire };
        }
        if (m.once && this.once[m.side].length < MAX_ONCE) {
          const o = cleanInput(m.once);
          const one: Once = {};
          if (o.jump) one.jump = o.jump;
          if (o.weapon) one.weapon = o.weapon;
          if (o.fuse) one.fuse = o.fuse;
          if (o.target) one.target = o.target;
          if (Object.keys(one).length) this.once[m.side].push(one);
        }
        return;
      }
      case 'hash': {
        const first = this.hashes.get(m.turn);
        if (first === undefined) this.hashes.set(m.turn, m.h >>> 0);
        else if (first !== m.h >>> 0 && !this.desynced) {
          this.desynced = true;
          this.broadcast({ t: 'desync', turn: m.turn });
        }
        return;
      }
      case 'ping':
        p.send({ t: 'pong' });
        return;
    }
  }

  /** Часы: дошагать кадры до now (мс), разослать пачку, если пора. Первый вызов после старта запускает отсчёт. */
  tick(now: number): void {
    if (!this.started || this.desynced) return;
    if (!this.t0) {
      this.t0 = now;
      this.sentAt = now;
    }
    const target = Math.floor((now - this.t0) / FRAME_MS);
    // долго не звали (сервер подвис) — не выдаём рывком больше секунды
    if (target - this.frame > 60) this.t0 = now - (this.frame + 60) * FRAME_MS;
    while (this.frame < Math.floor((now - this.t0) / FRAME_MS)) {
      for (let s = 0; s < this.held.length; s++) {
        const inp: Input = { ...this.held[s], ...(this.once[s].shift() ?? {}) };
        if (!emptyInput(inp)) this.pending.push([this.frame, s, inp]);
      }
      this.frame++;
    }
    if (now - this.sentAt >= BATCH_MS) {
      this.sentAt = now;
      this.broadcast({ t: 'f', upto: this.frame, ins: this.pending });
      this.pending = [];
    }
  }

  private lobby(): void {
    const peers: NetPeer[] = this.peers.map((x) => ({ id: x.p.id, name: x.p.name, side: x.side, host: x.host }));
    for (const x of this.peers) x.p.send({ t: 'lobby', setup: this.setup, peers, you: x.p.id });
  }

  private broadcast(m: NetServerMsg): void {
    for (const x of this.peers) x.p.send(m);
  }
}
