/* Комната карты на сервере (без сокетов: сервер даёт peer.send и зовёт tick; тесты гоняют её напрямую).
 * Лобби → карта → итог. Мир держит сервер: люди шлют действия, за ботов, пропавших и тех, у кого кончился запас, ходит бот карты.
 * Бой на карте: стороны-люди ходят сами (как в Арене, с часами), остальные — бот; бой без людей считается сразу. */
import { botAction } from '../bot/bot';
import { type BotMem, botStep, newMem } from '../bot/advbot';
import { fightOut } from '../bot/advplay';
import type { BotLevel } from '../bot/bot';
import { type BattleEvent, type BattleState, act as battleAct, actionError as battleError, createBattle, currentUnit, resign } from '../sim/battle';
import { type GenOptions, generateMap } from '../sim/adv/gen';
import { TEMPLATES } from '../sim/adv/templates';
import { type AdvEvent, type World, act, actionError, applyBattle, battleSetup, heroById, townById } from '../sim/adv/world';
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
  state: BattleState;
  /** Место за каждой стороной: человек ходит сам; null — нейтралы. */
  seats: [number | null, number | null];
  levels: [BotLevel, BotLevel];
  bank: [number, number];
  since: number;
}

type Phase = 'lobby' | 'map' | 'over';

export class MapRoom {
  private peers: MapPeer[] = [];
  private seats: Seat[] = [];
  private talking = new Set<number>();
  phase: Phase = 'lobby';
  gen: GenOptions;
  world: World | null = null;
  private mems: BotMem[] = [];
  private fight: Fight | null = null;
  private bank: number[] = [];
  /** С какого времени идут часы ходящего человека. */
  private since = 0;
  /** События хода бота, ещё не разосланные. */
  private pendingEvents: AdvEvent[] = [];
  private pendingActor = -1;

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
      this.broadcast({ t: 'peer', name: p.name, on: true });
    }
    if (this.phase === 'lobby') return this.sendLobby();
    this.sendStart(p);
    if (this.fight) this.sendFightStart(p);
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
      case 'start':
        if (this.phase === 'lobby' && this.isHost(p) && this.seats.every((s) => s.bot || s.token)) this.startMap();
        return;
      case 'adv': {
        if (this.phase !== 'map' || seat === null || this.fight) return p.send({ t: 'mnope', why: 'сейчас нельзя' });
        const w = this.world!;
        if (w.current !== seat) return p.send({ t: 'mnope', why: 'не твой ход' });
        const a = cleanAdvAction(m.a);
        const err = a ? actionError(w, a) : 'непонятное действие';
        if (err || !a) return p.send({ t: 'mnope', why: err ?? 'непонятное действие' });
        const before = w.current;
        if (a.t === 'end') this.charge(seat);
        const ev = act(w, a);
        this.afterAct(before, ev);
        return;
      }
      case 'act': {
        const f = this.fight;
        if (!f || seat === null) return;
        const side = f.seats.indexOf(seat);
        const u = currentUnit(f.state);
        if (side < 0 || u?.side !== side) return p.send({ t: 'nope', why: 'не твой ход' });
        const a = cleanAction(m.a);
        const err = a ? battleError(f.state, a) : 'непонятный ход';
        if (err || !a) return p.send({ t: 'nope', why: err ?? 'непонятный ход' });
        this.chargeFight(u.side, a.t !== 'cast');
        this.fightStep(battleAct(f.state, a));
        return;
      }
      case 'bresign': {
        const f = this.fight;
        if (!f || seat === null) return;
        const side = f.seats.indexOf(seat);
        if (side < 0) return;
        f.since = this.now();
        this.fightStep(resign(f.state, side));
        return;
      }
      case 'resign':
        if (this.phase === 'map' && seat !== null) this.surrender(seat);
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

  /** Часы комнаты: ход ботов, запас хода, бой. */
  tick(): void {
    if (this.phase !== 'map') return;
    const w = this.world!;
    const t = this.now();
    if (this.fight) return this.tickFight(t);
    const cur = w.current;
    const human = this.botFor(cur) === null;
    if (human) {
      if (t - this.since < this.bank[cur]) return;
      // кончился запас — ход кончается (выбор и навык — первым вариантом)
      this.bank[cur] = 0;
      if (w.pending?.t === 'choice') this.collect(cur, act(w, { t: 'choose', id: w.pending.options[0].id }));
      for (const h of w.heroes) while (h.owner === cur && h.ups.length) this.collect(cur, act(w, { t: 'skill', hero: h.id, skill: h.ups[0].options[0] ?? null }));
      if (w.pending?.t === 'battle') return this.startFight();
      this.collect(cur, act(w, { t: 'end' }));
      this.flush();
      if (w.over) this.finish(w.winner, 'map');
      return;
    }
    const level = this.botFor(cur) ?? 'medium';
    const start = this.now();
    while (!w.over && !this.fight && w.current === cur && this.now() - start < BOT_BUDGET_MS) {
      if (w.pending?.t === 'battle') {
        this.startFight();
        break;
      }
      const a = botStep(w, level, (this.mems[cur] ??= newMem()));
      const ev = act(w, actionError(w, a) ? { t: 'end' } : a);
      this.collect(cur, ev);
    }
    this.flush();
    if (w.over) this.finish(w.winner, 'map');
  }

  // ------------------------------------------------------------------ ход карты

  private afterAct(actor: number, ev: AdvEvent[]): void {
    const w = this.world!;
    this.collect(actor, ev);
    this.flush();
    if (w.over) return this.finish(w.winner, 'map');
    if (w.pending?.t === 'battle') this.startFight();
  }

  /** Новый ход человека: прибавка к запасу и пуск часов. */
  private collect(actor: number, ev: AdvEvent[]): void {
    if (this.pendingActor !== actor && this.pendingEvents.length) this.flush();
    this.pendingActor = actor;
    this.pendingEvents.push(...ev);
    if (ev.some((e) => e.e === 'turn')) {
      const w = this.world!;
      this.bank[w.current] = Math.min(MAP_BANK_MAX, this.bank[w.current] + MAP_TURN_MS);
      this.since = this.now();
      this.flush();
    }
  }

  private charge(seat: number): void {
    this.bank[seat] = Math.max(0, this.bank[seat] - Math.max(0, this.now() - this.since));
  }

  private clock(): MapClock {
    const w = this.world!;
    const running = this.fight || this.botFor(w.current) ? -1 : w.current;
    const bank = this.bank.map((b, i) => (i === running ? Math.max(0, b - (this.now() - this.since)) : b));
    return { bank, running };
  }

  /** Разослать накопленные события: каждому — своим видом. */
  private flush(): void {
    if (!this.pendingEvents.length) return;
    const w = this.world!;
    const ev = this.pendingEvents;
    const actor = this.pendingActor;
    this.pendingEvents = [];
    const seats = this.view();
    const clock = this.clock();
    for (const p of this.peers) {
      const seat = this.seatOf(p);
      p.send({ t: 'mstep', events: eventsView(w, ev, seat, actor), world: worldView(w, seat), clock, seats, actor });
    }
  }

  private startMap(): void {
    const players = this.seats.map((s) => ({ name: s.name, faction: s.faction, hero: s.hero, ...(s.bot ? { bot: s.bot } : {}) }));
    this.world = generateMap({ seed: this.gen.seed, players }, this.gen);
    this.world.name = 'Сетевая карта';
    this.phase = 'map';
    this.bank = this.seats.map(() => MAP_BANK_MS);
    this.since = this.now();
    for (const p of this.peers) this.sendStart(p);
  }

  private sendStart(p: MapPeer): void {
    if (!this.world) return;
    const seat = this.seatOf(p);
    p.send({ t: 'mstart', world: worldView(this.world, seat), seat, seats: this.view(), clock: this.clock(), you: p.id, busy: this.busyText() });
    if (this.phase === 'over') p.send({ t: 'mover', winner: this.world.winner, why: 'map' });
  }

  private surrender(seat: number): void {
    const w = this.world!;
    // сдавшийся выбывает: его города и герои — ничьи
    for (const t of w.towns) if (t.owner === seat) t.owner = -1;
    w.heroes = w.heroes.filter((h) => h.owner !== seat);
    w.players[seat].alive = false;
    this.seats[seat].bot = 'medium';
    const left = w.players.filter((p) => p.alive);
    const ev: AdvEvent[] = [{ e: 'lost', player: seat }];
    if (left.length <= 1) {
      w.over = true;
      w.winner = left[0]?.id ?? -1;
      ev.push({ e: 'over', winner: w.winner });
    } else if (w.current === seat) {
      w.pending = null;
      ev.push(...act(w, { t: 'end' }));
    }
    this.collect(seat, ev);
    this.flush();
    if (w.over) this.finish(w.winner, 'resign');
  }

  private finish(winner: number, why: 'map' | 'resign'): void {
    if (this.phase === 'over') return;
    this.phase = 'over';
    this.broadcast({ t: 'mover', winner, why });
  }

  private busyText(): string {
    const f = this.fight;
    if (!f) return '';
    const name = (s: number | null, side: number): string => (s === null ? (side === 1 ? 'нейтралы' : '—') : this.seats[s].name);
    return `Идёт бой: ${name(f.seats[0], 0)} против ${name(f.seats[1], 1)}`;
  }

  // ------------------------------------------------------------------ бой на карте

  private startFight(): void {
    const w = this.world!;
    const b = w.pending;
    if (b?.t !== 'battle') return;
    const att = heroById(w, b.hero)!.owner;
    let def: number | null = null;
    if (b.def.k === 'hero') def = heroById(w, b.def.id)!.owner;
    else if (b.def.k === 'town') {
      const owner = townById(w, b.def.id)!.owner;
      def = owner >= 0 ? owner : null;
    }
    const seats: [number | null, number | null] = [att, def];
    const lv = (s: number | null): BotLevel => (s === null ? 'medium' : this.botFor(s) ?? 'medium');
    const levels: [BotLevel, BotLevel] = [lv(att), lv(def)];
    const setup = battleSetup(w).setup;
    // людей в бою нет — считаем сразу (Сложный боевой бот медленный: на сервере — Средний)
    if (seats.every((s) => s === null || this.botFor(s) !== null)) {
      const state = fightOut(setup, [levels[0] === 'hard' ? 'medium' : levels[0], levels[1] === 'hard' ? 'medium' : levels[1]]);
      this.collect(w.current, applyBattle(w, state));
      return;
    }
    this.flush();
    // время боя не идёт в запас хода
    if (this.botFor(w.current) === null) this.charge(w.current);
    this.fight = { state: createBattle(setup), seats, levels, bank: [FIGHT_BANK_MS, FIGHT_BANK_MS], since: this.now() + 3000 };
    const busy = this.busyText();
    for (const p of this.peers) {
      this.sendFightStart(p);
      if (!this.inFight(p)) p.send({ t: 'mbusy', text: busy });
    }
  }

  private inFight(p: MapPeer): boolean {
    const seat = this.seatOf(p);
    return seat !== null && !!this.fight && this.fight.seats.includes(seat);
  }

  private sendFightStart(p: MapPeer): void {
    const f = this.fight;
    if (!f || !this.inFight(p)) return;
    const seat = this.seatOf(p)!;
    const side = f.seats.indexOf(seat);
    const name = (s: number | null): string => (s === null ? 'Нейтралы' : this.seats[s].name);
    p.send({ t: 'start', state: f.state, seat: side, names: [name(f.seats[0]), name(f.seats[1])], clock: this.fightClock(Math.max(0, f.since - this.now())), you: p.id });
  }

  private fightClock(waitMs: number): ClockView {
    const f = this.fight!;
    return { bank: [Math.max(0, f.bank[0]), Math.max(0, f.bank[1])], waitMs };
  }

  private chargeFight(side: number, increment: boolean): void {
    const f = this.fight!;
    const spent = Math.max(0, this.now() - f.since);
    f.bank[side] = Math.min(FIGHT_BANK_MS, Math.max(0, f.bank[side] - spent) + (increment ? FIGHT_INC_MS : 0));
  }

  private tickFight(t: number): void {
    const f = this.fight!;
    const u = currentUnit(f.state);
    if (!u) return;
    const seat = f.seats[u.side];
    const human = seat !== null && this.botFor(seat) === null;
    if (human && t - f.since < Math.max(f.bank[u.side], FIGHT_MIN_MS)) return;
    if (human) this.chargeFight(u.side, false);
    else if (t < f.since) return;
    const lv = human ? 'medium' : f.levels[u.side] === 'hard' ? 'medium' : f.levels[u.side];
    this.fightStep(battleAct(f.state, botAction(f.state, lv)));
  }

  private fightStep(events: BattleEvent[]): void {
    const f = this.fight!;
    const show = Math.min(MAX_SHOW_MS, events.length * EVENT_MS);
    f.since = this.now() + show;
    for (const p of this.peers) if (this.inFight(p)) p.send({ t: 'step', events, state: f.state, clock: this.fightClock(show) });
    if (!f.state.over) return;
    for (const p of this.peers) if (this.inFight(p)) p.send({ t: 'result', result: { winner: f.state.winner, why: 'battle' } });
    this.fight = null;
    this.since = this.now();
    const w = this.world!;
    this.collect(w.current, applyBattle(w, f.state));
    this.flush();
    this.broadcast({ t: 'mbusy', text: '' });
    if (w.over) this.finish(w.winner, 'map');
  }

  // ------------------------------------------------------------------ общее

  private sendLobby(): void {
    const seats = this.view();
    for (const p of this.peers) p.send({ t: 'mlobby', gen: this.gen, seats, you: p.id, seat: this.seatOf(p), host: this.isHost(p) });
  }

  private voiceList(): void {
    const members = this.peers.filter((x) => this.talking.has(x.id)).map((x) => ({ id: String(x.id), name: x.name, seat: this.seatOf(x), video: false }));
    this.broadcast({ t: 'voice', members });
  }

  private broadcast(m: MapServerMsg): void {
    for (const p of this.peers) p.send(m);
  }
}
