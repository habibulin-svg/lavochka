/* Партия ГОПС в браузере: мир + фиксированный шаг 60 Гц + отрисовка + ввод людей и ботов.
 * Быстрый бой (стороны из setup) или миссия кампании (mission: мир, цель и звёзды — sim/mission.ts).
 * Сеть (лок-степ) встанет между вводом и step — здесь всё локально (за одним экраном). */
import { GopsAudio, VOICE_SETS } from './audio';
import { Bot, type BotLevel } from './bot/bot';
import { Controls } from './input';
import { type LevelData, dealSpawns, decodeMask } from './level';
import { BRIGADE_IDS, GameView } from './render/view';
import { type MissionDef, type MissionRun, buildMission, missionStars, objectiveText, tickMission, zonePx } from './sim/mission';
import { ARSENAL_AMMO, WEAPONS } from './sim/weapons';
import type { NetClient } from './net/client';
import { Rng } from './sim/rng';
import { type Snapshot, applySnapshot, takeSnapshot } from './sim/snapshot';
import { type Input, type Scheme, TICK_HZ, type World, createWorld, step, worldHash } from './sim/world';
import { Hud } from './ui/hud';
import { Talk } from './ui/talk';

export interface Side {
  brigade: string;
  /** null — человек за этим устройством. */
  bot: BotLevel | null;
  count: number;
  hp: number;
  /** Голосовой набор (audio.ts VOICE_SETS); по умолчанию — по порядку. */
  voice?: string;
}

export interface GameSetup {
  level: LevelData;
  theme: string;
  time?: string;
  sides: Side[];
  seed: number;
  ammo?: Record<string, number>;
  /** Схема быстрого боя (время хода, ветер, ящики, внезапная смерть). */
  scheme?: Scheme;
  /** Сетевая партия: кадры идут от сервера; mine — бригады, которыми правит этот экран. */
  net?: { client: NetClient; mine: number[] };
  /** Миссия: стороны берутся из неё (игрок — бригада sides[0].brigade, человек). */
  mission?: MissionDef;
}

export class Game {
  world!: World;
  view!: GameView;
  hud!: Hud;
  controls = new Controls();
  audio!: GopsAudio;
  private bots: (Bot | null)[] = [];
  private acc = 0;
  private last = 0;
  private raf = 0;
  private timer = 0;
  private off = new AbortController();
  /** Ход миссии (если это миссия) и чем кончилась партия. */
  run: MissionRun | null = null;
  onEnd: (run: MissionRun, stars: number) => void = () => {};
  private ended = false;
  /** Сеть: следующий кадр к шагу, номер хода (для сверки хеша), чья бригада последней слала ввод. */
  private frameNo = 0;
  private turnNo = 0;
  private sentSide = -1;
  /** Рассинхрон: ждём кадра snapAt (свой снимок отправить) или чужой снимок. */
  private resync: { at: number; mine: boolean; sent: boolean } | null = null;
  private talk: Talk | null = null;

  constructor(private host: HTMLElement, private setup: GameSetup) {}

  async start(): Promise<void> {
    const s = this.setup;
    if (s.mission) {
      const m = s.mission;
      const built = buildMission(m, { mask: decodeMask(s.level), waterY: s.level.water_y, spawns: s.level.spawns, race: s.level.race }, s.seed);
      this.world = built.world;
      this.run = built.run;
      s.sides = [
        { brigade: s.sides[0]?.brigade ?? 'zatulinka', bot: null, count: m.player.count, hp: m.player.hp },
        ...m.enemies.map((e) => ({ brigade: e.brigade, bot: e.bot, count: e.count, hp: e.hp })),
      ];
    } else {
      const spawns = dealSpawns(s.level.spawns, s.sides.length, Math.max(...s.sides.map((x) => x.count)));
      this.world = createWorld({
        mask: decodeMask(s.level),
        waterY: s.level.water_y,
        seed: s.seed,
        scheme: s.scheme,
        teams: s.sides.map((side, i) => ({ spawns: spawns[i].slice(0, side.count), hp: side.hp, ammo: { ...(s.ammo ?? ARSENAL_AMMO) } })),
      });
    }
    // в сети боты считаются в каждом браузере одинаково — их случайность от сида партии
    this.bots = s.sides.map((x, i) => (x.bot ? new Bot(x.bot, s.net ? seeded(s.seed * 31 + i * 977) : undefined) : null));
    this.audio = new GopsAudio(s.theme, s.sides.map((x, i) => x.voice ?? VOICE_SETS[i % VOICE_SETS.length]));
    this.audio.humans = s.sides.flatMap((x, i) => (x.bot ? [] : [i]));
    if (s.mission) this.audio.setMissionMusic(s.mission.music);
    BRIGADE_IDS.splice(0, BRIGADE_IDS.length, ...s.sides.map((x) => x.brigade));
    this.view = new GameView(this.host);
    await this.view.init(this.world, s.sides.map((x) => x.brigade), s.theme, s.time);
    if (s.mission?.objective.type === 'king_of_hill') this.view.zone = zonePx(this.world, s.mission.objective.zone);
    this.hud = new Hud(this.host, s.sides.map((x) => x.brigade));
    this.hud.quietOver = !!s.mission;
    // свои бригады: в сети — по рассадке, иначе — все, за которых не бот
    this.hud.mine = s.net ? s.net.mine : s.sides.flatMap((x, i) => (x.bot ? [] : [i]));
    if (s.net) {
      this.talk = new Talk(this.host, s.net.client);
      const c = s.net.client;
      c.onDesync = (_turn, upto, mine) => {
        this.resync = { at: upto, mine, sent: false };
        this.hud.flash('Миры разошлись — сверяемся…', 4000);
      };
      c.onSnapshot = (frame, turn, json) => {
        applySnapshot(this.world, JSON.parse(json) as Snapshot);
        this.frameNo = frame;
        this.turnNo = turn;
        this.resetBots(frame);
        this.view.rebuildTerrain();
        this.resync = null;
        this.hud.flash('Сверились, играем дальше');
      };
    }
    this.hud.onPick = (id) => this.controls.selectWeapon(id);
    this.controls.onMenu = () => this.hud.toggleMenu(this.world);
    this.hud.bindPad(this.controls);
    this.bindPointer();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
    // мир шагает и без кадров отрисовки: в фоновой вкладке rAF стоит, таймер (пусть и придушенный до 1 с) догоняет
    this.timer = window.setInterval(this.pump, 50);
  }

  /** Шаги мира за прошедшее время (фиксированные 60 Гц); возвращает прошедшее время, мс. */
  private pump = (): number => {
    const now = performance.now();
    const dt = Math.min(2000, now - this.last);
    this.last = now;
    if (this.setup.net) {
      this.netPump(this.setup.net);
      return dt;
    }
    this.acc += dt;
    const tick = 1000 / TICK_HZ;
    while (this.acc >= tick) {
      this.acc -= tick;
      if (this.ended && this.run) {
        // миссия кончилась: мир ещё доживает (падения, взрывы), но без ввода
        step(this.world, {});
      } else step(this.world, this.input());
      if (this.run) this.checkMission(this.run);
      this.view.onEvents(this.world, this.world.events);
      this.audio.onEvents(this.world, this.world.events);
    }
    return dt;
  };

  /** Боты заново от сида партии и кадра — после снимка у всех одинаковые. */
  private resetBots(frame: number): void {
    const s = this.setup;
    this.bots = s.sides.map((x, i) => (x.bot ? new Bot(x.bot, seeded(s.seed * 31 + i * 977 + frame)) : null));
  }

  /** Лок-степ: свой ввод — на сервер, мир шагает ровно по пришедшим кадрам. */
  private netPump(net: { client: NetClient; mine: number[] }): void {
    const w = this.world;
    const c = net.client;
    const rs = this.resync;
    if (rs && rs.mine && !rs.sent && this.frameNo >= rs.at) {
      // мой мир — общий: снимок на кадре остановки часов, боты заново
      rs.sent = true;
      c.sendSnapshot(this.frameNo, this.turnNo, JSON.stringify(takeSnapshot(w)));
      this.resetBots(this.frameNo);
      this.resync = null;
      this.hud.flash('Сверились, играем дальше');
    }
    if (this.resync && !this.resync.mine && this.frameNo >= this.resync.at) return; // ждём снимок
    const myTurn = net.mine.includes(w.team) && !this.bots[w.team];
    const local = this.controls.take();
    if (myTurn) {
      c.input(w.team, local);
      this.sentSide = w.team;
    } else if (this.sentSide >= 0) {
      // ход ушёл — отпустить всё, что было зажато за прошлую бригаду
      c.input(this.sentSide, {});
      this.sentSide = -1;
    }
    // догонять журнал (вернулся в идущую партию) — порциями, чтобы вкладка не вставала
    let budget = 3000;
    while (this.frameNo < c.upto && budget-- > 0) {
      const ins = c.take(this.frameNo++);
      const bot = this.bots[this.world.team];
      step(this.world, bot ? bot.input(this.world) : ins.get(this.world.team) ?? {});
      for (const e of this.world.events) if (e.t === 'turn') c.send({ t: 'hash', turn: ++this.turnNo, h: worldHash(this.world) });
      this.view.onEvents(this.world, this.world.events);
      this.audio.onEvents(this.world, this.world.events);
    }
  }

  private frame = (): void => {
    const dt = this.pump();
    this.view.draw(this.world, dt);
    const c = this.view.cam;
    this.audio.view = { x: c.x, y: c.y, half: this.view.app.screen.width / 2 / c.zoom };
    this.hud.update(this.world);
    if (this.run) this.hud.setGoal(objectiveText(this.world, this.run));
    this.raf = requestAnimationFrame(this.frame);
  };

  private checkMission(run: MissionRun): void {
    tickMission(this.world, run);
    if (!run.result || this.ended) return;
    this.ended = true;
    const stars = missionStars(this.world, run);
    window.setTimeout(() => this.onEnd(run, stars), 1600);
  }

  /** Ввод кадра: от бота бригады, чей ход, иначе — от человека. */
  private input(): Input {
    const w = this.world;
    const bot = this.bots[w.team];
    if (bot) {
      this.controls.take(); // нажатия человека в чужой ход — в никуда
      return bot.input(w);
    }
    return this.controls.take();
  }

  /** Мышь: колесо — масштаб, перетаскивание — камера (до следующего хода), правая кнопка — оружие. */
  private bindPointer(): void {
    const el = this.view.app.canvas;
    const cam = this.view.cam;
    let drag: { x: number; y: number; cx: number; cy: number } | null = null;
    // щипок: два пальца — масштаб
    const touches = new Map<number, [number, number]>();
    let pinch: { d: number; zoom: number } | null = null;
    const dist = () => {
      const [a, b] = [...touches.values()];
      return Math.hypot(a[0] - b[0], a[1] - b[1]);
    };
    const sig = { signal: this.off.signal };
    el.addEventListener('pointerdown', (e) => {
      touches.set(e.pointerId, [e.clientX, e.clientY]);
      if (touches.size === 2) {
        pinch = { d: dist(), zoom: cam.zoom };
        drag = null;
      }
    });
    window.addEventListener('pointermove', (e) => {
      if (!touches.has(e.pointerId)) return;
      touches.set(e.pointerId, [e.clientX, e.clientY]);
      if (pinch && touches.size === 2) {
        const min = this.view.fitZoom(this.world);
        cam.zoom = Math.max(min, Math.min(min * 4, (pinch.zoom * dist()) / pinch.d));
      }
    }, sig);
    const lift = (e: PointerEvent) => {
      touches.delete(e.pointerId);
      if (touches.size < 2) pinch = null;
    };
    window.addEventListener('pointerup', lift, sig);
    window.addEventListener('pointercancel', lift, sig);
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.hud.toggleMenu(this.world);
    });
    el.addEventListener('pointerdown', (e) => {
      if (e.button === 0 && touches.size < 2) drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y };
    });
    // щелчок/тап без перетаскивания — точка для оружия, которому она нужна
    el.addEventListener('pointerup', (e) => {
      if (!drag || pinch || e.button !== 0 || Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) > 6) return;
      if (!WEAPONS[this.world.weapon]?.target || this.bots[this.world.team]) return;
      const r = el.getBoundingClientRect();
      const [x, y] = this.view.toWorld(e.clientX - r.left, e.clientY - r.top);
      this.controls.setTarget(x, y);
    });
    window.addEventListener('pointermove', (e) => {
      if (!drag || pinch) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) cam.follow = false;
      cam.x = cam.tx = drag.cx - dx / cam.zoom;
      cam.y = cam.ty = drag.cy - dy / cam.zoom;
    }, sig);
    window.addEventListener('pointerup', () => (drag = null), sig);
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const min = this.view.fitZoom(this.world);
      cam.zoom = Math.max(min, Math.min(min * 4, cam.zoom * Math.pow(1.0015, -e.deltaY)));
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyC') cam.follow = true;
    }, sig);
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    clearInterval(this.timer);
    this.off.abort();
    this.controls.dispose();
    this.audio.dispose();
    this.hud.el.remove();
    this.talk?.destroy();
    this.view.destroy();
  }
}

/** Случайность бота в сети: одна и та же во всех браузерах партии. */
function seeded(seed: number): () => number {
  const r = new Rng(seed >>> 0);
  return () => r.f();
}
