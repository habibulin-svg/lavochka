/* Партия ГОПС в браузере: мир + фиксированный шаг 60 Гц + отрисовка + ввод людей и ботов.
 * Сеть (лок-степ) встанет между вводом и step — здесь всё локально (быстрый бой, за одним экраном). */
import { Bot, type BotLevel } from './bot/bot';
import { Controls } from './input';
import { type LevelData, dealSpawns, decodeMask } from './level';
import { BRIGADE_IDS, GameView } from './render/view';
import { CORE_AMMO } from './sim/weapons';
import { type Input, TICK_HZ, type World, createWorld, step } from './sim/world';
import { Hud } from './ui/hud';

export interface Side {
  brigade: string;
  /** null — человек за этим устройством. */
  bot: BotLevel | null;
  count: number;
  hp: number;
}

export interface GameSetup {
  level: LevelData;
  theme: string;
  time?: string;
  sides: Side[];
  seed: number;
  ammo?: Record<string, number>;
}

export class Game {
  world!: World;
  view!: GameView;
  hud!: Hud;
  controls = new Controls();
  private bots: (Bot | null)[] = [];
  private acc = 0;
  private last = 0;
  private raf = 0;

  constructor(private host: HTMLElement, private setup: GameSetup) {}

  async start(): Promise<void> {
    const s = this.setup;
    const spawns = dealSpawns(s.level.spawns, s.sides.length, Math.max(...s.sides.map((x) => x.count)));
    this.world = createWorld({
      mask: decodeMask(s.level),
      waterY: s.level.water_y,
      seed: s.seed,
      teams: s.sides.map((side, i) => ({ spawns: spawns[i].slice(0, side.count), hp: side.hp, ammo: { ...(s.ammo ?? CORE_AMMO) } })),
    });
    this.bots = s.sides.map((x) => (x.bot ? new Bot(x.bot) : null));
    BRIGADE_IDS.splice(0, BRIGADE_IDS.length, ...s.sides.map((x) => x.brigade));
    this.view = new GameView(this.host);
    await this.view.init(this.world, s.sides.map((x) => x.brigade), s.theme, s.time);
    this.hud = new Hud(this.host, s.sides.map((x) => x.brigade));
    this.hud.onPick = (id) => this.controls.selectWeapon(id);
    this.controls.onMenu = () => this.hud.toggleMenu(this.world);
    this.bindPointer();
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private frame = (now: number): void => {
    const dt = Math.min(250, now - this.last);
    this.last = now;
    this.acc += dt;
    const tick = 1000 / TICK_HZ;
    while (this.acc >= tick) {
      this.acc -= tick;
      step(this.world, this.input());
      this.view.onEvents(this.world, this.world.events);
    }
    this.view.draw(this.world, dt);
    this.hud.update(this.world);
    this.raf = requestAnimationFrame(this.frame);
  };

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
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.hud.toggleMenu(this.world);
    });
    el.addEventListener('pointerdown', (e) => {
      if (e.button === 0) drag = { x: e.clientX, y: e.clientY, cx: cam.x, cy: cam.y };
    });
    window.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 6) cam.follow = false;
      cam.x = cam.tx = drag.cx - dx / cam.zoom;
      cam.y = cam.ty = drag.cy - dy / cam.zoom;
    });
    window.addEventListener('pointerup', () => (drag = null));
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      const min = this.view.fitZoom(this.world);
      cam.zoom = Math.max(min, Math.min(min * 4, cam.zoom * Math.pow(1.0015, -e.deltaY)));
    }, { passive: false });
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyC') cam.follow = true;
    });
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.view.destroy();
  }
}
