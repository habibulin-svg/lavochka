/* Комната карты на сервере (без сокетов: сервер даёт peer.send и зовёт tick; тесты гоняют её напрямую).
 * Лобби → карта → итог. Мир держит сервер: люди шлют действия, за ботов, пропавших и тех, у кого кончился запас, ходит бот карты.
 * Одновременные ходы (DESIGN.md §12): пока армии далеко, день общий — все ходят разом, кто первым прислал, того и действие.
 * Сблизились (или кто-то напал на чужого) — до конца дня по очереди: сблизивший доходит, за ним остальные, кто не закончил.
 * Своё «начатое» (выбор, бой) у каждого места своё: комната держит его в `pend`, мир получает его на время действия (`as`).
 * Бой на карте: стороны-люди ходят сами (как в Арене, с часами), остальные — бот; бой без людей считается сразу.
 * В общий день боёв с нейтралами может идти несколько: у каждого места свой. */
import { botAction } from '../bot/bot';
import { type BotMem, botStep, newMem } from '../bot/advbot';
import { fightOut } from '../bot/advplay';
import type { BotLevel } from '../bot/bot';
import { type BattleEvent, type BattleState, act as battleAct, actionError as battleError, createBattle, currentUnit, resign } from '../sim/battle';
import { type GenOptions, generateMap } from '../sim/adv/gen';
import { TEMPLATES } from '../sim/adv/templates';
import { type AdvAction, type AdvEvent, type PendingBattle, type World, act, actionError, applyBattle, battleSetup, heroById, objById, townById } from '../sim/adv/world';
import { factionClasses } from '../sim/heroes';
import { type MapClientMsg, type MapClock, type MapSeatView, type MapServerMsg, BOT_LEVELS, MAP_FACTIONS, cleanAdvAction, cleanGen, cleanPick, eventsView, worldView } from './mapproto';
import { type ClockView, cleanAction } from './protocol';

/** Запас хода на всю партию и прибавка в начале каждого своего хода. */
export const MAP_BANK_MS = 8 * 60_000;
export const MAP_TURN_MS = 75_000;
export const MAP_BANK_MAX = 15 * 60_000;
/** Бой на карте: запас стороны, прибавка за ход, минимум на ход. */
export const FIGHT_BANK_MS = 150_000;
const FIGHT_INC_MS = 5_000;
const FIGHT_MIN_MS = 12_000;
/** Пропал со связи: столько ждём, потом за него ходит бот (место остаётся за ним). Кончился запас — ход просто кончается. */
export const MAP_GONE_MS = 60_000;
/** Общий день начинается, только если чужие герои и города дальше этого (клеток); внутри дня сближение до CONTACT — по очереди. */
export const FREE_GAP = 20;
export const CONTACT = 12;
/** На показ события боя: часы ходящего стоят. */
const EVENT_MS = 420;
const MAX_SHOW_MS = 6_000;
/** Ход бота за один тик: не дольше, чтобы сервер не замирал. */
const BOT_BUDGET_MS = 25;

export interface MapPeer {
  id: number;
  name: string;
  token: string;
  user: number | null;
  send(m: MapServerMsg): void;
}

interface Seat {
  token: string | null;
  name: string;
  faction: MapSeatView['faction'];
  hero: MapSeatView['hero'];
  bot: BotLevel | null;
  goneAt: number;
}

interface Fight {
  /** Чьё это «начатое»: место нападающего. */
  att: number;
  state: BattleState;
  /** Место за каждой стороной: человек ходит сам; null — нейтралы. */
  seats: [number | null, number | null];
  levels: [BotLevel, BotLevel];
  bank: [number, number];
  since: number;
}

type Phase = 'lobby' | 'map' | 'over';
/** Как идёт день: по очереди (мир сам передаёт ход), общий, по очереди после сближения (очередь держит комната). */
type Day = 'seq' | 'free' | 'late';

/** Ближе всего друг к другу чужие герои и города (по клеткам, на одном уровне). */
export function enemyGap(w: World): number {
  const wh = w.w * w.h;
  const pos = (c: number) => ({ x: c % w.w, y: Math.trunc((c % wh) / w.w), z: Math.trunc(c / wh) });
  const things = [
    ...w.heroes.map((h) => ({ owner: h.owner, hero: true, ...pos(h.cell) })),
    ...w.towns.filter((t) => t.owner >= 0).map((t) => ({ owner: t.owner, hero: false, ...pos(t.cell) })),
  ];
  let best = Infinity;
  for (const a of things) {
    if (!a.hero) continue;
    for (const b of things) {
      if (b.owner === a.owner || b.z !== a.z) continue;
      best = Math.min(best, Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y)));
    }
  }
  return best;
}

export class MapRoom {
  private peers: MapPeer[] = [];
  private seats: Seat[] = [];
  private talking = new Set<number>();
  phase: Phase = 'lobby';
  gen: GenOptions;
  /** Одновременные ходы (хозяин выбирает в лобби). */
  simul = true;
  world: World | null = null;
  day: Day = 'seq';
  private mems: BotMem[] = [];
  private fights: Fight[] = [];
  private bank: number[] = [];
  /** С какого времени идут часы места. */
  private since: number[] = [];
  /** «Начатое» каждого места: вне `as` в мире его нет. */
  private pend: World['pending'][] = [];
  /** Закончил день (общий и очередь после сближения). */
  private done: boolean[] = [];
  /** События, ещё не разосланные. */
  private pendingEvents: AdvEvent[] = [];
  private pendingActor = -1;
  /** Изменилось то, чего в событиях нет (кто ходит, кто закончил): разослать вид и без событий. */
  private dirty = false;

  constructor(gen: GenOptions, private readonly now: () => number = Date.now) {
    this.gen = gen;
    this.resizeSeats();
  }

  get isEmpty(): boolean {
    return this.peers.length === 0;
  }

  /** Число мест — по шаблону; новые места — боты Средние. */
  private resizeSeats(): void {
    const n = TEMPLATES[this.gen.template].players;
    while (this.seats.length < n) {
      const i = this.seats.length;
      const f = MAP_FACTIONS[i % 4];
      this.seats.push({ token: null, name: `Бот ${i + 1}`, faction: f, hero: this.freeHero(f, i), bot: i === 0 ? null : i === 1 ? null : 'medium', goneAt: 0 });
    }
    this.seats.length = n;
  }

  private freeHero(f: MapSeatView['faction'], i: number): MapSeatView['hero'] {
    for (const cls of factionClasses(f)) for (let n = 1; n <= 4; n++) if (!this.seats.some((s, j) => j !== i && s.hero.cls === cls.id && s.hero.n === n)) return { cls: cls.id, n };
    return { cls: factionClasses(f)[0].id, n: 1 };
  }

  private seatOf(p: MapPeer): number | null {
    const i = this.seats.findIndex((s) => s.token === p.token);
    return i < 0 ? null : i;
  }

  private isHost(p: MapPeer): boolean {
    return this.seatOf(p) === 0;
  }

  /** Кто ходит за место сейчас: человек на связи — сам, иначе бот (у пропавшего и у бота). */
  private botFor(seat: number): BotLevel | null {
    const s = this.seats[seat];
    if (s.bot) return s.bot;
    if (!s.token) return 'medium';
    return s.goneAt && this.now() - s.goneAt >= MAP_GONE_MS ? 'medium' : null;
  }

  private view(): MapSeatView[] {
    return this.seats.map((s) => ({ name: s.name, faction: s.faction, hero: s.hero, bot: s.bot, taken: !!s.token, on: !!s.token && !s.goneAt }));
  }

  /** Мир глазами места: в общий день «ходит» он сам, пока не закончил; своё «начатое». */
  viewOf(seat: number | null): World {
    const w = this.world!;
    if (seat === null) return worldView({ ...w, pending: null }, null);
    let current = w.current;
    if (this.day === 'free') current = this.done[seat] ? (this.movers()[0] ?? seat) : seat;
    return worldView({ ...w, current, pending: this.pend[seat] }, seat);
  }

  add(p: MapPeer): void {
    this.peers.push(p);
    let seat = this.seatOf(p);
    if (seat === null && this.phase === 'lobby') {
      const free = this.seats.findIndex((s) => !s.bot && !s.token);
      if (free >= 0) {
        seat = free;
        this.seats[free].token = p.token;
        this.seats[free].name = p.name;
      }
    }
    if (seat !== null && this.seats[seat].goneAt) {
      this.seats[seat].goneAt = 0;
      this.since[seat] = this.now();
      this.broadcast({ t: 'peer', name: p.name, on: true });
    }
    if (this.phase === 'lobby') return this.sendLobby();
    this.sendStart(p);
    this.sendFightStart(p);
  }

  remove(p: MapPeer): void {
    const i = this.peers.indexOf(p);
    if (i < 0) return;
    this.peers.splice(i, 1);
    if (this.talking.delete(p.id)) this.voiceList();
    const seat = this.seatOf(p);
    if (seat === null || this.peers.some((x) => this.seatOf(x) === seat)) return;
    if (this.phase === 'lobby') {
      const s = this.seats[seat];
      s.token = null;
      s.name = `Игрок ${seat + 1}`;
      this.sendLobby();
    } else {
      this.seats[seat].goneAt = this.now();
      this.broadcast({ t: 'peer', name: p.name, on: false });
    }
  }

  message(p: MapPeer, m: MapClientMsg): void {
    if (!this.peers.includes(p)) return;
    const seat = this.seatOf(p);
    switch (m.t) {
      case 'mseat': {
        const pk = cleanPick(m.hero);
        if (this.phase !== 'lobby' || seat === null || !MAP_FACTIONS.includes(m.faction) || !pk) return;
        if (!factionClasses(m.faction).some((c) => c.id === pk.cls)) return;
        if (this.seats.some((s, j) => j !== seat && s.hero.cls === pk.cls && s.hero.n === pk.n)) return;
        this.seats[seat].faction = m.faction;
        this.seats[seat].hero = pk;
        return this.sendLobby();
      }
      case 'mgen': {
        const g = cleanGen(m.gen);
        if (this.phase !== 'lobby' || !this.isHost(p) || !g) return;
        this.gen = g;
        this.resizeSeats();
        return this.sendLobby();
      }
      case 'mbot': {
        if (this.phase !== 'lobby' || !this.isHost(p) || !Number.isInteger(m.seat) || m.seat <= 0 || m.seat >= this.seats.length) return;
        const s = this.seats[m.seat];
        if (m.bot !== null && !BOT_LEVELS.includes(m.bot)) return;
        // занятое человеком место ботом не делаем
        if (m.bot && s.token) return;
        s.bot = m.bot;
        s.name = m.bot ? `Бот ${m.seat + 1}` : `Игрок ${m.seat + 1}`;
        return this.sendLobby();
      }
      case 'msimul':
        if (this.phase !== 'lobby' || !this.isHost(p)) return;
        this.simul = !!m.on;
        return this.sendLobby();
      case 'start':
        if (this.phase === 'lobby' && this.isHost(p) && this.seats.every((s) => s.bot || s.token)) this.startMap();
        return;
      case 'adv': {
        if (this.phase !== 'map' || seat === null || this.fightOf(seat)) return p.send({ t: 'mnope', why: 'сейчас нельзя' });
        if (!this.mayAct(seat)) return p.send({ t: 'mnope', why: this.day === 'free' ? 'ты уже закончил день' : 'не твой ход' });
        const a = cleanAdvAction(m.a);
        const err = a ? this.as(seat, () => actionError(this.world!, a)) : 'непонятное действие';
        if (err || !a) return p.send({ t: 'mnope', why: err ?? 'непонятное действие' });
        this.doAct(seat, a);
        return;
      }
      case 'act': {
        const f = seat === null ? undefined : this.fightOf(seat);
        if (!f || seat === null) return;
        const side = f.seats.indexOf(seat);
        const u = currentUnit(f.state);
        if (u?.side !== side) return p.send({ t: 'nope', why: 'не твой ход' });
        const a = cleanAction(m.a);
        const err = a ? battleError(f.state, a) : 'непонятный ход';
        if (err || !a) return p.send({ t: 'nope', why: err ?? 'непонятный ход' });
        this.chargeFight(f, u.side, a.t !== 'cast');
        this.fightStep(f, battleAct(f.state, a));
        return;
      }
      case 'bresign': {
        const f = seat === null ? undefined : this.fightOf(seat);
        if (!f || seat === null) return;
        f.since = this.now();
        this.fightStep(f, resign(f.state, f.seats.indexOf(seat)));
        return;
      }
      case 'resign':
        if (this.phase === 'map' && seat !== null && this.world!.players[seat].alive) this.surrender(seat);
        return;
      case 'chat': {
        const text = String(m.text ?? '').trim().slice(0, 200);
        if (text) this.broadcast({ t: 'chat', name: p.name, text });
        return;
      }
      case 'voice':
        if (m.on) this.talking.add(p.id);
        else this.talking.delete(p.id);
        this.voiceList();
        return;
      case 'rtc': {
        const to = this.peers.find((x) => String(x.id) === String(m.to));
        if (to && this.talking.has(p.id) && this.talking.has(to.id)) to.send({ t: 'rtc', from: String(p.id), data: m.data });
        return;
      }
      case 'ping':
        p.send({ t: 'pong' });
        return;
    }
  }

  /** Часы комнаты: ход ботов, запас хода, бои. */
  tick(): void {
    if (this.phase !== 'map') return;
    const w = this.world!;
    const t = this.now();
    for (const f of [...this.fights]) this.tickFight(f, t);
    for (const seat of this.movers()) {
      if (this.phase !== 'map' || !this.mayAct(seat) || this.fightOf(seat)) continue;
      // бой ждал, пока освободится защитник
      if (this.pend[seat]?.t === 'battle') {
        this.startFight(seat);
        continue;
      }
      if (this.botFor(seat) === null) {
        if (t - this.since[seat] >= this.bank[seat]) this.timeout(seat);
        continue;
      }
      const level = this.botFor(seat)!;
      const start = this.now();
      while (this.phase === 'map' && this.mayAct(seat) && !this.fightOf(seat) && this.now() - start < BOT_BUDGET_MS) {
        // бой: начнётся сейчас или подождёт защитника — бот в любом случае ждёт его
        if ((this.pend[seat] as World['pending'])?.t === 'battle') {
          this.startFight(seat);
          break;
        }
        const a = this.as(seat, () => {
          const x = botStep(w, level, (this.mems[seat] ??= newMem()));
          return actionError(w, x) ? ({ t: 'end' } as AdvAction) : x;
        });
        this.doAct(seat, a);
      }
    }
    this.flush();
  }

  // ------------------------------------------------------------------ ход карты

  /** Кто сейчас ходит: в общий день — все, кто не закончил; иначе — один. */
  private movers(): number[] {
    const w = this.world!;
    if (this.day !== 'free') return w.over ? [] : [w.current];
    return w.players.filter((p) => p.alive && !this.done[p.id]).map((p) => p.id);
  }

  private mayAct(seat: number): boolean {
    const w = this.world!;
    return this.phase === 'map' && !w.over && w.players[seat].alive && this.movers().includes(seat);
  }

  /** Действие от имени места: на время мир — его (ход и «начатое»). Ход передан (конец хода по очереди) — так и остаётся. */
  private as<T>(seat: number, f: () => T): T {
    const w = this.world!;
    const cur = w.current;
    w.current = seat;
    w.pending = this.pend[seat];
    try {
      return f();
    } finally {
      this.pend[seat] = w.pending;
      w.pending = null;
      if (w.current === seat) w.current = cur;
    }
  }

  /** Проверенное действие места. */
  private doAct(seat: number, a: AdvAction): void {
    const w = this.world!;
    if (a.t === 'end') return this.endSeat(seat);
    const ev = this.as(seat, () => act(w, a));
    this.collect(seat, ev);
    if (w.over) return this.finish(w.winner, 'map');
    const b = this.pend[seat];
    // в общий день: сблизились или напали на чужого — дальше по очереди
    if (this.day === 'free' && ((b?.t === 'battle' && b.def.k !== 'obj' && this.defOwner(b) !== null) || enemyGap(w) <= CONTACT)) this.goLate(seat);
    if (b?.t === 'battle') this.startFight(seat);
    this.flush();
  }

  /** Место закончило ход (день). */
  private endSeat(seat: number): void {
    const w = this.world!;
    this.charge(seat);
    if (this.day === 'seq') {
      const ev = this.as(seat, () => act(w, { t: 'end' }));
      this.collect(seat, ev);
      return this.afterDayChange(ev);
    }
    this.done[seat] = true;
    this.dirty = true;
    if (this.day === 'late') {
      const n = w.players.length;
      for (let k = 1; k <= n; k++) {
        const i = (seat + k) % n;
        if (w.players[i].alive && !this.done[i]) {
          w.current = i;
          this.since[i] = this.now();
          this.collect(i, [{ e: 'turn', player: i }]);
          this.flush();
          return;
        }
      }
    } else if (this.movers().length) return this.flush();
    // все закончили — новый день (мир переходит к нему от последнего места)
    w.current = w.players.length - 1;
    const ev = act(w, { t: 'end' });
    this.collect(seat, ev);
    this.afterDayChange(ev);
  }

  /** После конца хода: новый день — общий он или по очереди. */
  private afterDayChange(ev: AdvEvent[]): void {
    const w = this.world!;
    if (w.over) {
      this.flush();
      return this.finish(w.winner, 'map');
    }
    if (ev.some((e) => e.e === 'day')) this.startDay();
    else this.beginTurn(w.current);
    this.flush();
  }

  private startDay(): void {
    const w = this.world!;
    this.done = w.players.map((p) => !p.alive);
    this.dirty = true;
    if (this.simul && enemyGap(w) > FREE_GAP) {
      this.day = 'free';
      for (const p of w.players) if (p.alive) this.beginTurn(p.id);
      return;
    }
    this.day = 'seq';
    this.beginTurn(w.current);
  }

  /** Новый ход места: прибавка к запасу и пуск часов. */
  private beginTurn(seat: number): void {
    this.bank[seat] = Math.min(MAP_BANK_MAX, this.bank[seat] + MAP_TURN_MS);
    this.since[seat] = this.now();
  }

  /** Сблизились посреди общего дня: сблизивший доходит, за ним по порядку мест — кто не закончил. */
  private goLate(actor: number): void {
    const w = this.world!;
    for (const s of this.movers()) if (s !== actor) this.charge(s);
    this.day = 'late';
    w.current = actor;
    this.dirty = true;
    this.broadcast({ t: 'mnote', text: `Армии сблизились: до конца дня ходим по очереди. Сейчас ходит ${this.seats[actor].name}.` });
  }

  /** Кончился запас: выбор и навык — первым вариантом, бой — играет бот, ход кончается. */
  private timeout(seat: number): void {
    const w = this.world!;
    this.bank[seat] = 0;
    this.as(seat, () => {
      if (w.pending?.t === 'choice') this.collect(seat, act(w, { t: 'choose', id: w.pending.options[0].id }));
      for (const h of w.heroes) while (h.owner === seat && h.ups.length) this.collect(seat, act(w, { t: 'skill', hero: h.id, skill: h.ups[0].options[0] ?? null }));
    });
    if (this.pend[seat]?.t === 'battle') return this.startFight(seat);
    this.endSeat(seat);
  }

  private collect(actor: number, ev: AdvEvent[]): void {
    if (this.pendingActor !== actor && this.pendingEvents.length) this.flush();
    this.pendingActor = actor;
    this.pendingEvents.push(...ev);
  }

  /** Идут ли часы места: человек, его ход, не в бою. */
  private running(seat: number): boolean {
    return this.botFor(seat) === null && this.movers().includes(seat) && !this.fightOf(seat);
  }

  /** Часы места стоят с этого мгновения: потраченное — из запаса. */
  private charge(seat: number): void {
    const t = this.now();
    if (this.running(seat)) this.bank[seat] = Math.max(0, this.bank[seat] - Math.max(0, t - this.since[seat]));
    this.since[seat] = t;
  }

  private clock(): MapClock {
    const t = this.now();
    const running = this.movers().filter((s) => this.running(s));
    const bank = this.bank.map((b, i) => (running.includes(i) ? Math.max(0, b - (t - this.since[i])) : b));
    return { bank, running, free: this.day === 'free', done: [...this.done] };
  }

  /** Разослать накопленные события: каждому — своим видом. */
  private flush(): void {
    if (!this.pendingEvents.length && !this.dirty) return;
    const w = this.world!;
    const ev = this.pendingEvents;
    const actor = this.pendingActor;
    this.pendingEvents = [];
    this.dirty = false;
    const seats = this.view();
    const clock = this.clock();
    for (const p of this.peers) {
      const seat = this.seatOf(p);
      p.send({ t: 'mstep', events: eventsView(w, ev, seat, actor), world: this.viewOf(seat), clock, seats, actor });
    }
  }

  private startMap(): void {
    const players = this.seats.map((s) => ({ name: s.name, faction: s.faction, hero: s.hero, ...(s.bot ? { bot: s.bot } : {}) }));
    const w = generateMap({ seed: this.gen.seed, players }, this.gen);
    w.name = 'Сетевая карта';
    this.world = w;
    this.phase = 'map';
    this.pend = this.seats.map(() => null);
    this.bank = this.seats.map(() => MAP_BANK_MS - MAP_TURN_MS);
    this.since = this.seats.map(() => this.now());
    this.startDay();
    this.pendingEvents = [];
    this.dirty = false;
    for (const p of this.peers) this.sendStart(p);
  }

  private sendStart(p: MapPeer): void {
    if (!this.world) return;
    const seat = this.seatOf(p);
    p.send({ t: 'mstart', world: this.viewOf(seat), seat, seats: this.view(), clock: this.clock(), you: p.id, busy: this.busyText(seat) });
    if (this.phase === 'over') p.send({ t: 'mover', winner: this.world.winner, why: 'map' });
  }

  private surrender(seat: number): void {
    const w = this.world!;
    // его бои кончаются: без сдавшегося их некому доигрывать
    for (const f of this.fights.filter((x) => x.seats.includes(seat))) {
      this.fights.splice(this.fights.indexOf(f), 1);
      this.pend[f.att] = null;
      const winner = f.seats[0] === seat ? 1 : 0;
      for (const p of this.peers) if (f.seats.includes(this.seatOf(p))) p.send({ t: 'result', result: { winner, why: 'resign' } });
      for (const s of f.seats) if (s !== null && s !== seat) this.since[s] = this.now();
    }
    // сдавшийся выбывает: его города и герои — ничьи
    for (const t of w.towns) if (t.owner === seat) t.owner = -1;
    w.heroes = w.heroes.filter((h) => h.owner !== seat);
    w.players[seat].alive = false;
    this.pend[seat] = null;
    this.seats[seat].bot = 'medium';
    const left = w.players.filter((p) => p.alive);
    this.collect(seat, [{ e: 'lost', player: seat }]);
    this.broadcastBusy();
    if (left.length <= 1) {
      w.over = true;
      w.winner = left[0]?.id ?? -1;
      this.collect(seat, [{ e: 'over', winner: w.winner }]);
      this.flush();
      return this.finish(w.winner, 'resign');
    }
    // ход переходит дальше так же, как после «конца хода»
    if (this.day === 'free' || w.current === seat) this.endSeat(seat);
    this.flush();
  }

  private finish(winner: number, why: 'map' | 'resign'): void {
    if (this.phase === 'over') return;
    this.phase = 'over';
    this.broadcast({ t: 'mover', winner, why });
  }

  // ------------------------------------------------------------------ бой на карте

  private fightOf(seat: number): Fight | undefined {
    return this.fights.find((f) => f.seats.includes(seat));
  }

  private defOwner(b: PendingBattle): number | null {
    const w = this.world!;
    if (b.def.k === 'hero') return heroById(w, b.def.id)?.owner ?? null;
    if (b.def.k === 'town') {
      const owner = townById(w, b.def.id)?.owner ?? -1;
      return owner >= 0 ? owner : null;
    }
    return null;
  }

  /** Начать бой из «начатого» места. Защитник уже в другом бою — ждём, бой начнётся, когда тот кончится. */
  private startFight(seat: number): void {
    const w = this.world!;
    const b = this.pend[seat];
    if (b?.t !== 'battle' || this.fightOf(seat)) return;
    // пока ждали, цель могла исчезнуть
    const gone = !heroById(w, b.hero) || (b.def.k === 'hero' ? !heroById(w, b.def.id) : b.def.k === 'town' ? !townById(w, b.def.id) : !objById(w, b.def.id));
    if (gone) {
      this.pend[seat] = null;
      this.dirty = true;
      return;
    }
    const def = this.defOwner(b);
    if (def !== null && this.fightOf(def)) return;
    const seats: [number | null, number | null] = [seat, def];
    const lv = (s: number | null): BotLevel => (s === null ? 'medium' : this.botFor(s) ?? 'medium');
    const levels: [BotLevel, BotLevel] = [lv(seat), lv(def)];
    const setup = this.as(seat, () => battleSetup(w).setup);
    // людей в бою нет — считаем сразу (Сложный боевой бот медленный: на сервере — Средний)
    if (seats.every((s) => s === null || this.botFor(s) !== null)) {
      const state = fightOut(setup, [levels[0] === 'hard' ? 'medium' : levels[0], levels[1] === 'hard' ? 'medium' : levels[1]]);
      this.collect(seat, this.as(seat, () => applyBattle(w, state)));
      if (w.over) {
        this.flush();
        this.finish(w.winner, 'map');
      }
      return;
    }
    this.flush();
    // время боя не идёт в запас хода
    for (const s of seats) if (s !== null) this.charge(s);
    const f: Fight = { att: seat, state: createBattle(setup), seats, levels, bank: [FIGHT_BANK_MS, FIGHT_BANK_MS], since: this.now() + 3000 };
    this.fights.push(f);
    for (const p of this.peers) this.sendFightStart(p);
    this.broadcastBusy();
  }

  /** Чужие бои: тем, кто сейчас не ходит, — плашка «идёт бой»; в общий день ходящим не мешаем. */
  private busyText(seat: number | null): string {
    if (seat !== null && (this.fightOf(seat) || (this.day === 'free' && this.mayAct(seat)))) return '';
    const f = this.fights[0];
    if (!f) return '';
    const name = (s: number | null, side: number): string => (s === null ? (side === 1 ? 'нейтралы' : '—') : this.seats[s].name);
    return `Идёт бой: ${name(f.seats[0], 0)} против ${name(f.seats[1], 1)}`;
  }

  private broadcastBusy(): void {
    for (const p of this.peers) {
      const seat = this.seatOf(p);
      if (seat === null || !this.fightOf(seat)) p.send({ t: 'mbusy', text: this.busyText(seat) });
    }
  }

  private sendFightStart(p: MapPeer): void {
    const seat = this.seatOf(p);
    const f = seat === null ? undefined : this.fightOf(seat);
    if (!f || seat === null) return;
    const side = f.seats.indexOf(seat);
    const name = (s: number | null): string => (s === null ? 'Нейтралы' : this.seats[s].name);
    p.send({ t: 'start', state: f.state, seat: side, names: [name(f.seats[0]), name(f.seats[1])], clock: this.fightClock(f, Math.max(0, f.since - this.now())), you: p.id });
  }

  private fightClock(f: Fight, waitMs: number): ClockView {
    return { bank: [Math.max(0, f.bank[0]), Math.max(0, f.bank[1])], waitMs };
  }

  private chargeFight(f: Fight, side: number, increment: boolean): void {
    const spent = Math.max(0, this.now() - f.since);
    f.bank[side] = Math.min(FIGHT_BANK_MS, Math.max(0, f.bank[side] - spent) + (increment ? FIGHT_INC_MS : 0));
  }

  private tickFight(f: Fight, t: number): void {
    const u = currentUnit(f.state);
    if (!u) return;
    const seat = f.seats[u.side];
    const human = seat !== null && this.botFor(seat) === null;
    if (human && t - f.since < Math.max(f.bank[u.side], FIGHT_MIN_MS)) return;
    if (human) this.chargeFight(f, u.side, false);
    else if (t < f.since) return;
    const lv = human ? 'medium' : f.levels[u.side] === 'hard' ? 'medium' : f.levels[u.side];
    this.fightStep(f, battleAct(f.state, botAction(f.state, lv)));
  }

  private fightStep(f: Fight, events: BattleEvent[]): void {
    const show = Math.min(MAX_SHOW_MS, events.length * EVENT_MS);
    f.since = this.now() + show;
    const inIt = (p: MapPeer): boolean => f.seats.includes(this.seatOf(p));
    for (const p of this.peers) if (inIt(p)) p.send({ t: 'step', events, state: f.state, clock: this.fightClock(f, show) });
    if (!f.state.over) return;
    for (const p of this.peers) if (inIt(p)) p.send({ t: 'result', result: { winner: f.state.winner, why: 'battle' } });
    this.fights.splice(this.fights.indexOf(f), 1);
    for (const s of f.seats) if (s !== null) this.since[s] = this.now();
    const w = this.world!;
    this.collect(f.att, this.as(f.att, () => applyBattle(w, f.state)));
    this.flush();
    if (w.over) return this.finish(w.winner, 'map');
    // бои, ждавшие этих участников
    for (const p of w.players) if (this.pend[p.id]?.t === 'battle' && (this.day === 'free' || p.id === w.current)) this.startFight(p.id);
    this.broadcastBusy();
    this.flush();
  }

  // ------------------------------------------------------------------ общее

  private sendLobby(): void {
    const seats = this.view();
    for (const p of this.peers) p.send({ t: 'mlobby', gen: this.gen, seats, you: p.id, seat: this.seatOf(p), host: this.isHost(p), simul: this.simul });
  }

  private voiceList(): void {
    const members = this.peers.filter((x) => this.talking.has(x.id)).map((x) => ({ id: String(x.id), name: x.name, seat: this.seatOf(x), video: false }));
    this.broadcast({ t: 'voice', members });
  }

  private broadcast(m: MapServerMsg): void {
    for (const p of this.peers) p.send(m);
  }
}
