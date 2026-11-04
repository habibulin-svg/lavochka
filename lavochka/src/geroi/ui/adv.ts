/* Партия на карте: выбор героя, путь, панель, события мира, передача хода за одним экраном, бой, пауза, сохранения. Правила — в sim/adv, картинка — в render/mapview. */
import type { Audio2, Situation } from '../audio';
import { type BotLevel, botAction } from '../bot/bot';
import { Game, type Who } from '../game';
import { MapView, PLAYER_COLORS } from '../render/mapview';
import { SLOTS, type Save, loadSaves, slotLabel, writeAuto, writeSave } from '../save';
import { act as battleAct, type BattleState, createBattle } from '../sim/battle';
import { CREATURES } from '../sim/creatures';
import { classOf, heroName } from '../sim/heroes';
import { SPELLS, spellIcon } from '../sim/spells';
import { type Purse, RES_NAME, type ResId, TERRAINS } from '../sim/adv/data';
import { type AdvHero, ARTIFACTS, SKILL, armyPower, heroMaxMp } from '../sim/adv/hero';
import {
  type AdvAction, type AdvEvent, HERO_COST, type PendingBattle, type World, act, actionError, applyBattle, battleSetup, cellOf, defOf, dirOf, guardOf, heroAt, heroById, heroHiddenFrom, hireCost, isStack, objAt, objById, pathDays, pathOf, playerHeroes, playerTowns, reachOf, townAt, townById, xOf, yOf,
} from '../sim/adv/world';
import { ArmyPicker, heroSheet, icon, marketDialog, portrait, priceRow, resBar } from './advparts';
import { button, h, modal } from './common';
import { TownScreen } from './town';

const STAGE_W = 1920;
const STAGE_H = 1080;
const MINI = 280;
const MUSIC_BY_TERRAIN: Record<string, Situation> = { meadow: 'map', rough: 'map', sand: 'map', water: 'map', swamp: 'map-swamp', ash: 'map-ash', pine: 'map-pine', underground: 'map-ash' };

/** Сколько в отряде: на карте точного числа не показываем. */
export function stackWord(n: number): string {
  if (n < 5) return 'немного';
  if (n < 10) return 'несколько';
  if (n < 20) return 'стая';
  if (n < 50) return 'много';
  if (n < 100) return 'орда';
  return 'тьма';
}

export interface AdvOptions {
  world: World;
  /** Сохранённый бой посреди партии. */
  battle?: BattleState;
}

export class AdvGame {
  world: World;
  private root = h('div', 'g-game');
  private canvasHost = h('div', 'g-canvas');
  private hud = h('div', 'g-hud a-hud');
  private panel = h('div', 'a-panel');
  private mini = h('canvas', 'a-mini');
  private miniBox = h('div', 'a-minibox');
  private miniFrame = h('div', 'a-miniframe');
  private info = h('div', 'a-info');
  private heroes = h('div', 'a-heroes');
  private towns = h('div', 'a-towns');
  private resbar = h('div', 'a-resbar a-resbar-map');
  private tipEl = h('div', 'a-tip');
  private overlay = h('div', 'g-overlayhost');
  private musicBtn = button('♪', () => this.toggleMusic(), 'g-round');
  private view: MapView;
  private selected: number | null = null;
  private target = -1;
  private busy = false;
  private town: TownScreen | null = null;
  private battle: Game | null = null;
  private dead = false;
  private lastDay = -1;
  private resumeBattle: BattleState | null;
  /** Тела объектов и городов → вход: щелчок по зданию идёт к его воротам. */
  private bodies = new Map<number, number>();
  private readonly onKey = (e: KeyboardEvent): void => this.key(e);
  private readonly fit = (): void => this.fitHud();
  onQuit: () => void = () => {};
  onLoad: (s: Save) => void = () => {};

  constructor(private readonly host: HTMLElement, private readonly audio: Audio2, o: AdvOptions) {
    this.world = o.world;
    this.view = new MapView(this.canvasHost, audio);
    this.resumeBattle = o.battle ?? null;
  }

  async start(): Promise<void> {
    this.root.append(this.canvasHost, this.hud);
    this.host.append(this.root);
    this.buildHud();
    this.fitHud();
    await this.view.init(this.world);
    this.collectBodies();
    this.view.onHover = (c) => this.hover(c);
    this.view.onClick = (c, right) => this.click(c, right);
    this.view.onCamera = () => this.drawMiniFrame();
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('resize', this.fit);
    this.lastDay = this.world.day;
    await this.syncAll();
    if (this.resumeBattle) {
      const s = this.resumeBattle;
      this.resumeBattle = null;
      await this.playBattle(s);
      return;
    }
    this.startTurn(false);
    this.afterAction();
  }

  private fitHud(): void {
    const w = this.root.clientWidth;
    const hh = this.root.clientHeight;
    const k = Math.min(w / STAGE_W, hh / STAGE_H);
    // панель прижата к правому краю, карта занимает всё остальное
    this.hud.style.transform = `translate(${w - STAGE_W * k}px, ${(hh - STAGE_H * k) / 2}px) scale(${k})`;
  }

  private buildHud(): void {
    this.miniBox.append(this.mini, this.miniFrame);
    this.miniBox.onpointerdown = (e) => this.miniJump(e);
    this.miniBox.onpointermove = (e) => {
      if (e.buttons & 1) this.miniJump(e);
    };
    const buttons = h('div', 'a-buttons');
    buttons.append(
      button('☰', () => this.pause(), 'g-round'),
      this.musicBtn,
      button('?', () => this.help(), 'g-round'),
      button('📖', () => this.book(), 'g-round'),
      button('⛏', () => this.dig(), 'g-round'),
    );
    this.musicBtn.classList.toggle('off', this.audio.musicOff);
    this.panel.append(this.miniBox, this.info, this.heroes, this.towns, buttons, button('Следующий герой', () => this.nextHero(), 'g-btn small'), button('Конец хода', () => this.endTurn(), 'g-btn main'));
    this.tipEl.hidden = true;
    this.hud.append(this.panel, this.resbar, this.tipEl, this.overlay);
  }

  private collectBodies(): void {
    this.bodies.clear();
    const w = this.world;
    for (const o of w.objects) for (const c of o.cells ?? []) this.bodies.set(c, o.cell);
    for (const t of w.towns) {
      const tx = xOf(w, t.cell);
      const ty = yOf(w, t.cell);
      for (let y = ty - 2; y <= ty; y++) for (let x = tx - 2; x <= tx + 2; x++) if (x >= 0 && y >= 0 && x < w.w && y < w.h) this.bodies.set(cellOf(w, x, y), t.cell);
    }
  }

  private get me(): number {
    return this.world.current;
  }
  private get hero(): AdvHero | undefined {
    return this.selected !== null ? heroById(this.world, this.selected) : undefined;
  }

  private async syncAll(): Promise<void> {
    await this.view.syncObjects(this.world);
    await this.view.syncHeroes(this.world);
    this.collectBodies();
    this.view.syncFog(this.world, this.me);
    this.drawPanel();
  }

  // ------------------------------------------------------------------ панель

  private drawPanel(): void {
    const w = this.world;
    const week = Math.trunc(w.day / 7);
    const p = w.players[this.me];
    this.view.drawMinimap(this.mini, w, this.me);
    this.drawMiniFrame();
    this.info.replaceChildren();
    const who = h('b', '', p.name);
    who.style.color = `#${PLAYER_COLORS[this.me].toString(16).padStart(6, '0')}`;
    this.info.append(who, h('span', 'dim', `Месяц ${Math.trunc(week / 4) + 1}, неделя ${(week % 4) + 1}, день ${(w.day % 7) + 1}`));
    resBar(this.resbar, p);
    this.heroes.replaceChildren();
    for (const x of playerHeroes(w, this.me)) {
      const b = h('button', `a-herocard${x.id === this.selected ? ' on' : ''}`);
      b.title = `${heroName(x.pick)}: ${x.level}-й уровень, ход ${x.mp}, мана ${x.mana}`;
      const bars = h('i', 'a-bars');
      const mp = h('i', 'mp');
      mp.style.height = `${Math.min(100, (x.mp / heroMaxMp(x)) * 100)}%`;
      bars.append(mp);
      b.append(portrait(x, 64), bars);
      b.onclick = () => {
        if (this.selected === x.id) this.openHero(x.id);
        else this.select(x.id, true);
      };
      this.heroes.append(b);
    }
    this.towns.replaceChildren();
    for (const t of playerTowns(w, this.me)) this.towns.append(button(t.name + (t.decrees.length ? ' •' : ''), () => this.openTown(t.id), 'g-btn small a-townbtn'));
  }

  private drawMiniFrame(): void {
    const v = this.view.viewRect();
    const k = MINI / this.world.w;
    this.miniFrame.style.left = `${Math.max(0, v.x * k)}px`;
    this.miniFrame.style.top = `${Math.max(0, v.y * k)}px`;
    this.miniFrame.style.width = `${Math.min(MINI, v.w * k)}px`;
    this.miniFrame.style.height = `${Math.min(MINI, v.h * k)}px`;
  }

  private miniJump(e: PointerEvent): void {
    const r = this.miniBox.getBoundingClientRect();
    this.view.centerAt(((e.clientX - r.left) / r.width) * this.world.w, ((e.clientY - r.top) / r.height) * this.world.h);
  }

  // ------------------------------------------------------------------ ход игрока

  /** Начало хода: экран передачи, если людей несколько; герой под рукой. */
  private startTurn(pass: boolean): void {
    const w = this.world;
    this.selected = null;
    this.target = -1;
    this.view.clearPath();
    this.view.selectHero(null);
    const first = playerHeroes(w, this.me).find((x) => x.mp > 0) ?? playerHeroes(w, this.me)[0];
    const begin = (): void => {
      if (first) this.select(first.id, true);
      else this.centerTown();
      this.playMusic();
    };
    if (!pass || w.players.filter((p) => p.alive).length < 2) return begin();
    // за одним экраном чужой туман не показываем
    this.canvasHost.style.visibility = 'hidden';
    this.view.frozen = true;
    const { box, close } = modal(this.overlay, 'a-pass', () => {
      this.canvasHost.style.visibility = '';
      this.view.frozen = false;
      this.audio.sfx('ui-turn');
      void this.syncAll().then(() => {
        begin();
        this.afterAction();
      });
    });
    box.append(h('h2', '', `Ходит: ${w.players[this.me].name}`), h('p', 'dim', 'Передай управление и нажми, когда будешь готов.'));
    if (w.weekNote && w.day % 7 === 0) box.append(h('p', '', w.weekNote));
    box.append(button('Начать ход', close, 'g-btn main'));
  }

  private centerTown(): void {
    const t = playerTowns(this.world, this.me)[0];
    if (t) this.view.centerOn(t.cell);
  }

  private playMusic(): void {
    const cell = this.hero?.cell ?? playerTowns(this.world, this.me)[0]?.cell ?? 0;
    this.audio.music(MUSIC_BY_TERRAIN[TERRAINS[this.world.terrain[cell]].id] ?? 'map');
  }

  private select(id: number, center: boolean): void {
    this.selected = id;
    this.target = -1;
    this.view.clearPath();
    const x = heroById(this.world, id);
    if (x) {
      this.view.selectHero(x);
      if (center) this.view.centerOn(x.cell);
    }
    this.drawPanel();
  }

  private nextHero(): void {
    const list = playerHeroes(this.world, this.me);
    if (!list.length) return;
    const i = list.findIndex((x) => x.id === this.selected);
    for (let k = 1; k <= list.length; k++) {
      const c = list[(i + k) % list.length];
      if (c.mp > 0) return this.select(c.id, true);
    }
    this.select(list[(i + 1) % list.length].id, true);
  }

  private blocked(): boolean {
    return this.busy || !!this.town || !!this.battle || !!this.overlay.querySelector('.g-modal');
  }

  private click(cell: number, right: boolean): void {
    if (this.blocked() || cell < 0) return;
    const w = this.world;
    if (!w.players[this.me].explored[cell]) return;
    const tcell = this.bodies.get(cell) ?? cell;
    if (right) return this.describe(tcell);
    const other = heroAt(w, cell);
    if (other && other.owner === this.me && other.id !== this.selected) return this.select(other.id, false);
    if (other && other.id === this.selected) {
      const t = townAt(w, cell);
      if (t) return this.openTown(t.id);
      return this.openHero(other.id);
    }
    const x = this.hero;
    const town = townAt(w, tcell);
    if (town && town.owner === this.me && (!x || x.cell === tcell)) return this.openTown(town.id);
    if (!x) return;
    if (this.target === tcell) {
      void this.go(x.id, tcell);
      return;
    }
    const path = pathOf(reachOf(w, x), tcell);
    if (!path.length) {
      this.target = -1;
      this.view.clearPath();
      this.audio.sfx('ui-error');
      return;
    }
    this.target = tcell;
    const obj = objAt(w, tcell);
    const foe = heroAt(w, tcell);
    const fight = !!(foe && foe.owner !== this.me) || !!(obj && isStack(obj)) || !!guardOf(w, tcell) || !!(obj?.army?.some((s) => s) && obj.owner !== this.me) || !!(town && town.owner !== this.me);
    this.view.showPath(path, pathDays(w, x, path), fight);
    this.audio.sfx('ui-click', 0.4);
  }

  private async go(hero: number, to: number): Promise<void> {
    this.target = -1;
    this.view.clearPath();
    await this.doAct({ t: 'move', hero, to });
  }

  private endTurn(): void {
    if (this.blocked()) return;
    const idle = playerHeroes(this.world, this.me).filter((x) => x.mp === heroMaxMp(x));
    if (idle.length) {
      const { box, close } = modal(this.overlay, 'g-card');
      box.append(h('h3', '', 'Закончить ход?'), h('p', '', `Не ходили: ${idle.map((x) => heroName(x.pick)).join(', ')}.`));
      box.append(button('Закончить', () => {
        close();
        void this.doAct({ t: 'end' });
      }, 'g-btn main'), button('Назад', close));
      return;
    }
    void this.doAct({ t: 'end' });
  }

  /** Действие мира и всё, что из него следует. */
  private async doAct(a: AdvAction): Promise<void> {
    if (this.busy || this.dead) return;
    const err = actionError(this.world, a);
    if (err) {
      this.tip(err);
      this.audio.sfx('ui-error');
      return;
    }
    this.busy = true;
    const next = await this.play(act(this.world, a));
    this.busy = false;
    if (this.dead) return;
    next();
  }

  /** Быстрое действие из окна: без показа пути. */
  private readonly quick = (a: AdvAction): void => {
    const err = actionError(this.world, a);
    if (err) {
      this.tip(err);
      this.audio.sfx('ui-error');
      return;
    }
    const ev = act(this.world, a);
    for (const e of ev) if (e.e === 'sfx') this.audio.sfx(e.name);
    void this.syncAll();
    this.town?.draw();
    const m = ev.find((e) => e.e === 'msg');
    if (m && m.e === 'msg') this.message(m.title ?? '', m.text);
  };

  /** Показать события; возвращает, что делать дальше, когда показ кончился. */
  private async play(ev: AdvEvent[]): Promise<() => void> {
    const w = this.world;
    let steps: { to: number; from: number; dir: number }[] = [];
    let walker: AdvHero | undefined;
    const flush = async (): Promise<void> => {
      if (steps.length && walker) await this.view.walk(walker, steps, false);
      steps = [];
    };
    const msgs: { title: string; text: string }[] = [];
    let opened: Extract<AdvEvent, { e: 'open' }> | null = null;
    let met: { a: number; b: number } | null = null;
    let newTurn = false;
    for (const e of ev) {
      switch (e.e) {
        case 'step':
          walker = heroById(w, e.hero);
          steps.push({ to: e.to, from: e.from, dir: dirOf(w, e.from, e.to) });
          break;
        case 'sfx':
          this.audio.sfx(e.name);
          break;
        case 'msg':
          msgs.push({ title: e.title ?? '', text: e.text });
          break;
        case 'gain':
          await flush();
          this.gainFloat(e.player, e.res, walker);
          break;
        case 'level':
          this.audio.sfx('levelup');
          break;
        case 'open':
          opened = e;
          break;
        case 'meet':
          met = { a: e.a, b: e.b };
          break;
        case 'turn':
          newTurn = true;
          break;
        case 'day':
          if (e.week && e.note) msgs.push({ title: 'Новая неделя', text: e.note });
          break;
        case 'lost':
          msgs.push({ title: 'Игрок выбыл', text: w.players[e.player].name });
          break;
        default:
          break;
      }
    }
    await flush();
    await this.syncAll();
    if (newTurn) {
      if (w.day !== this.lastDay) {
        this.lastDay = w.day;
        writeAuto(this.saveData());
      }
      return () => {
        this.startTurn(true);
        for (const m of msgs) this.message(m.title, m.text);
      };
    }
    if (walker) this.view.selectHero(walker);
    return () => {
      for (const m of msgs) this.message(m.title, m.text);
      if (opened) this.handleOpen(opened);
      if (met) this.exchange(met.a, met.b);
      this.afterAction();
    };
  }

  private gainFloat(player: number, res: Purse, near?: AdvHero): void {
    if (player !== this.me || !near) return;
    const parts = (Object.entries(res) as [ResId, number][]).map(([k, v]) => `+${v} ${RES_NAME[k].toLowerCase()}`);
    this.view.floatText(near.cell, parts.join(', '));
  }

  private message(title: string, text: string): void {
    const { box, close } = modal(this.overlay, 'g-card');
    if (title) box.append(h('h3', '', title));
    box.append(h('p', '', text), button('Понятно', close));
  }

  private handleOpen(e: Extract<AdvEvent, { e: 'open' }>): void {
    if (e.what === 'town') return this.openTown(e.town);
    if (!objById(this.world, e.obj)) return;
    if (e.what === 'dwelling') return this.dwelling(e.obj, e.hero);
    if (e.what === 'tradepost') return marketDialog(this.overlay, () => this.world, this.quick, e.hero, () => this.drawPanel());
    if (e.what === 'tavern') return this.mapTavern(e.hero);
    if (e.what === 'shipyard') return this.shipyard(e.obj, e.hero);
    if (e.what === 'garrison') return this.garrison(e.obj, e.hero);
  }

  /** Встреча своих героев: отряды и вещи из сумки — туда и обратно. */
  private exchange(a: number, b: number): void {
    const { box, close } = modal(this.overlay, 'a-sheet', () => this.afterAction());
    const pick = new ArmyPicker(box, this.quick, () => this.world, () => draw());
    const draw = (): void => {
      const x = heroById(this.world, a);
      const y = heroById(this.world, b);
      if (!x || !y) {
        close();
        return;
      }
      box.replaceChildren(h('h3', '', 'Встреча героев'), pick.row({ h: a }, x.army, heroName(x.pick)), pick.row({ h: b }, y.army, heroName(y.pick)));
      for (const [from, to] of [[x, y], [y, x]]) {
        if (!from.bag.length) continue;
        const row = h('div', 'a-arts');
        for (const art of from.bag) {
          const c = h('button', 'a-art');
          c.title = `${ARTIFACTS[art].name} — отдать: ${heroName(to.pick)}`;
          c.append(icon(art, 56));
          c.onclick = () => {
            this.quick({ t: 'giveArt', from: from.id, to: to.id, art });
            draw();
          };
          row.append(c);
        }
        box.append(h('h3', '', `В сумке, ${heroName(from.pick)}`), row);
      }
      box.append(h('p', 'dim', 'Вещи передаются из сумки: сними их на листе героя. Щёлк по отряду, потом по месту — переложить, с Shift — разделить.'), button('Разойтись', close));
    };
    draw();
  }

  private dwelling(objId: number, hero: number): void {
    const { box, close } = modal(this.overlay, 'g-card', () => this.afterAction());
    const draw = (): void => {
      const w = this.world;
      const o = objById(w, objId);
      const x = heroById(w, hero);
      if (!o || !x) {
        close();
        return;
      }
      const fx = defOf(o).effect as { t: 'dwelling'; cre: string };
      const c = CREATURES[fx.cre];
      const avail = o.n ?? 0;
      box.replaceChildren(h('h3', '', defOf(o).name), h('p', '', `${c.name}: есть ${avail}. В неделю +${c.weekly}.`));
      if (avail > 0) {
        const r = h('input');
        r.type = 'range';
        r.min = '1';
        r.max = String(avail);
        r.value = String(avail);
        const line = h('p', 'g-heroline', '');
        const go = button('Нанять', () => {
          this.quick({ t: 'hire', hero, obj: objId, count: Number(r.value) });
          draw();
        });
        const check = (): void => {
          const n = Number(r.value);
          line.textContent = `${n} × ${c.name}: ${hireCost(x, fx.cre, n)} семок`;
          go.disabled = !!actionError(w, { t: 'hire', hero, obj: objId, count: n });
        };
        r.oninput = check;
        check();
        box.append(r, line, go);
      }
      box.append(button('Уйти', close));
    };
    draw();
  }

  private mapTavern(hero: number): void {
    const { box, close } = modal(this.overlay, 'g-card', () => this.afterAction());
    const w = this.world;
    box.append(h('h3', '', 'Трактир'), h('p', 'dim', `Герой стоит ${HERO_COST} семок.`));
    const offer = playerTowns(w, this.me)[0]?.tavern ?? [];
    for (const pick of offer) {
      const a: AdvAction = { t: 'tavern', town: null, hero, pick };
      const b = button(`${heroName(pick)}, ${classOf(pick.cls).name}`, () => {
        close();
        this.quick(a);
      });
      b.disabled = !!actionError(w, a);
      box.append(b);
    }
    if (!offer.length) box.append(h('p', '', 'Никого нет: новые придут в начале недели.'));
    box.append(button('Уйти', close));
  }

  private shipyard(objId: number, hero: number): void {
    const { box, close } = modal(this.overlay, 'g-card', () => this.afterAction());
    const a: AdvAction = { t: 'boat', hero, obj: objId };
    const err = actionError(this.world, a);
    box.append(h('h3', '', 'Верфь'), priceRow({ semki: 1000, wood: 10 }, this.world.players[this.me]));
    if (err) box.append(h('p', 'a-why', err));
    const b = button('Купить лодку', () => {
      close();
      this.quick(a);
    });
    b.disabled = !!err;
    box.append(b, button('Уйти', close));
  }

  private garrison(objId: number, hero: number): void {
    const { box, close } = modal(this.overlay, 'a-sheet', () => this.afterAction());
    const pick = new ArmyPicker(box, this.quick, () => this.world, () => draw());
    const draw = (): void => {
      const o = objById(this.world, objId);
      const x = heroById(this.world, hero);
      if (!o || !x) {
        close();
        return;
      }
      box.replaceChildren(h('h3', '', defOf(o).name), pick.row({ o: objId }, o.army!, 'Гарнизон'), pick.row({ h: hero }, x.army, heroName(x.pick)), button('Уйти', close));
    };
    draw();
  }

  /** Что ещё ждёт игрока: выбор, повышение, бой, конец партии. */
  private afterAction(): void {
    if (this.dead || this.busy || this.town) return;
    // сначала закрываются сообщения: повторим, когда их не останется
    if (this.overlay.querySelector('.g-modal')) {
      window.setTimeout(() => this.afterAction(), 150);
      return;
    }
    const w = this.world;
    if (w.over) return this.showEnd();
    const pending = w.pending;
    if (pending?.t === 'choice') {
      const { box, close } = modal(this.overlay, 'g-card');
      box.append(h('h3', '', pending.title));
      for (const o of pending.options) {
        box.append(button(o.text, () => {
          close();
          void this.doAct({ t: 'choose', id: o.id });
        }));
      }
      // случайный щелчок мимо не теряет выбор
      box.parentElement!.onpointerdown = null;
      return;
    }
    const upHero = playerHeroes(w, this.me).find((x) => x.ups.length);
    if (upHero) return this.levelUp(upHero);
    if (pending?.t === 'battle') return this.battlePrompt(pending);
    this.playMusic();
  }

  private levelUp(x: AdvHero): void {
    const up = x.ups[0];
    const { box, close } = modal(this.overlay, 'g-card');
    const STAT: Record<string, string> = { atk: 'атака', def: 'защита', power: 'сила магии', know: 'знание' };
    box.append(h('h3', '', `${heroName(x.pick)}: новый уровень!`), h('p', '', `+1: ${STAT[up.stat]}`));
    if (up.options.length) box.append(h('p', 'dim', 'Выбери навык'));
    const pickIt = (skill: string | null): void => {
      close();
      void this.doAct({ t: 'skill', hero: x.id, skill });
    };
    for (const id of up.options) {
      const d = SKILL[id];
      const lv = (x.skills.find((s) => s.id === id)?.lv ?? 0) + 1;
      const b = h('button', 'g-btn a-skillpick');
      b.append(icon(`skill-${String(d.icon).padStart(2, '0')}`, 48), h('span', '', `${d.name}, ${lv}-я ступень: ${d.text(d.levels[lv - 1])}`));
      b.onclick = () => pickIt(id);
      box.append(b);
    }
    if (!up.options.length) box.append(button('Дальше', () => pickIt(null)));
    box.parentElement!.onpointerdown = null;
  }

  // ------------------------------------------------------------------ бой

  private battleTitle(p: PendingBattle): string {
    const w = this.world;
    if (p.def.k === 'hero') {
      const d = heroById(w, p.def.id);
      return d ? `Чужой герой: ${heroName(d.pick)}` : 'Бой';
    }
    if (p.def.k === 'town') return `Осада: ${townById(w, p.def.id)?.name}`;
    const o = objById(w, p.def.id);
    const s = o?.army?.find((x) => x);
    if (o && s) return `${isStack(o) ? '' : `${defOf(o).name}: `}${CREATURES[s.cre].name} — ${stackWord(s.count)}`;
    return 'Бой';
  }

  private battlePrompt(p: PendingBattle): void {
    const hero = heroById(this.world, p.hero)!;
    const { box, close } = modal(this.overlay, 'a-battleask');
    box.parentElement!.onpointerdown = null;
    box.append(h('h2', '', 'На пути бой'), h('p', '', this.battleTitle(p)), portrait(hero, 96));
    box.append(button('В бой', () => {
      close();
      void this.playBattle(null);
    }, 'g-btn main'));
    box.append(button('Автобой без показа', () => {
      close();
      void this.autoBattle();
    }));
  }

  /** Расчёт без показа: тот же бот, что сыграл бы (DESIGN.md §4). */
  private async autoBattle(): Promise<void> {
    const w = this.world;
    const pend = w.pending as PendingBattle;
    const b = createBattle(battleSetup(w).setup);
    const level: BotLevel = 'medium';
    for (let i = 0; i < 6000 && !b.over; i++) battleAct(b, botAction(b, level));
    const lines: string[] = [];
    for (const u of b.units) if (u.side === 0 && u.start > u.count) lines.push(`${CREATURES[u.cre].name}: −${u.start - u.count}`);
    const text = b.winner !== 0 ? 'Герой пал.' : lines.length ? `Потери: ${lines.join(', ')}.` : 'Без потерь.';
    void pend;
    this.message('Итог автобоя', text);
    await this.finishBattle(b);
  }

  private async playBattle(saved: BattleState | null): Promise<void> {
    const w = this.world;
    const pend = w.pending as PendingBattle;
    if (!pend || pend.t !== 'battle') return;
    const who: [Who, Who] = ['human', pend.def.k === 'hero' ? 'human' : 'medium'];
    this.root.style.display = 'none';
    this.view.frozen = true;
    const g = new Game(this.host, this.audio, saved ? { who, restore: { at: 0, title: '', state: saved, who } } : { who, setup: battleSetup(w).setup });
    this.battle = g;
    g.adv = { world: () => this.world, onFinish: (s) => void this.endGameBattle(g, s) };
    g.onQuit = () => {
      g.destroy();
      this.battle = null;
      this.onQuit();
    };
    g.onLoad = (s) => {
      g.destroy();
      this.battle = null;
      this.onLoad(s);
    };
    await g.start();
  }

  private async endGameBattle(g: Game, s: BattleState): Promise<void> {
    g.destroy();
    this.battle = null;
    this.root.style.display = '';
    this.view.frozen = false;
    this.fitHud();
    await this.finishBattle(s);
  }

  private async finishBattle(s: BattleState): Promise<void> {
    this.busy = true;
    const next = await this.play(applyBattle(this.world, s));
    this.busy = false;
    if (this.dead) return;
    const list = playerHeroes(this.world, this.me);
    if (this.selected !== null && !list.some((x) => x.id === this.selected)) {
      if (list[0]) this.select(list[0].id, true);
      else {
        this.selected = null;
        this.view.selectHero(null);
      }
    } else if (this.hero) this.view.selectHero(this.hero);
    this.playMusic();
    next();
  }

  // ------------------------------------------------------------------ окна

  private openTown(id: number): void {
    if (this.town || !townById(this.world, id)) return;
    this.audio.music(`town-${townById(this.world, id)!.faction}` as Situation);
    this.audio.sfx('gate');
    this.view.frozen = true;
    this.town = new TownScreen(this.hud, () => this.world, id, this.quick, () => this.closeTown());
  }

  private closeTown(): void {
    this.town?.destroy();
    this.town = null;
    this.view.frozen = false;
    this.audio.sfx('ui-close');
    void this.syncAll().then(() => this.afterAction());
  }

  private openHero(id: number): void {
    heroSheet(this.overlay, () => this.world, id, this.quick, () => this.drawPanel());
  }

  private book(): void {
    const x = this.hero;
    if (!x || this.blocked()) return;
    const { box, close } = modal(this.overlay, 'g-card');
    box.append(h('h3', '', `Заклинания карты · мана ${x.mana}`));
    const list = x.spells.filter((s) => SPELLS[s].kind === 'adv');
    for (const id of list) {
      const d = SPELLS[id];
      const a: AdvAction = { t: 'cast', hero: x.id, spell: id };
      const b = h('button', 'g-btn a-skillpick');
      b.append(icon(spellIcon(d), 44), h('span', '', `${d.name}: ${d.text}, мана ${d.mana}`));
      const err = actionError(this.world, a);
      b.disabled = !!err;
      b.title = err ?? '';
      b.onclick = () => {
        close();
        void this.doAct(a);
      };
      box.append(b);
    }
    if (!list.length) box.append(h('p', '', 'Заклинаний карты пока нет: их учат в гильдиях и святилищах. Боевые заклинания — в книге на поле боя.'));
    box.append(button('Закрыть', close));
  }

  private dig(): void {
    const x = this.hero;
    if (!x || this.blocked()) return;
    void this.doAct({ t: 'dig', hero: x.id });
  }

  private help(): void {
    const { box, close } = modal(this.overlay, 'g-card');
    box.append(h('h3', '', 'Управление'));
    for (const line of [
      'Щелчок по клетке — показать путь, второй щелчок туда же — идти.',
      'Зелёные точки — дойдёт сегодня, жёлтые — позже. Красный крест — там бой.',
      'Щелчок по герою или замку — открыть; правая кнопка — сведения.',
      'Экран двигают стрелки и край окна, колёсико — масштаб, средняя кнопка — тащить.',
      'H — следующий герой, E — конец хода, B — заклинания, D — копать.',
      'Esc — пауза, M — весь звук, пробел — идти по показанному пути.',
    ]) box.append(h('p', '', line));
    box.append(button('Понятно', close));
  }

  private toggleMusic(): void {
    this.audio.toggleMusic();
    this.musicBtn.classList.toggle('off', this.audio.musicOff);
  }

  private saveData(): Save {
    const w = this.world;
    const week = Math.trunc(w.day / 7);
    return { at: Date.now(), title: `${w.name ?? 'Две реки'}: ${w.players[w.current].name}, неделя ${week + 1}, день ${(w.day % 7) + 1}`, who: ['human', 'human'], adv: w };
  }

  pause(): void {
    if (this.overlay.querySelector('.g-pause')) return;
    const { box, close } = modal(this.overlay, 'g-pause');
    box.append(h('h3', '', 'Пауза'));
    const list = h('div', 'g-col');
    const slots = (mode: 'save' | 'load'): void => {
      list.replaceChildren();
      loadSaves().forEach((sv, i) => {
        if (mode === 'save' && i >= SLOTS) return;
        const b = button(slotLabel(sv, i), () => {
          if (mode === 'save') {
            if (!writeSave(i, this.saveData())) this.message('Сохранение', 'Не удалось: место в браузере закончилось.');
            slots('save');
          } else if (sv) {
            close();
            this.onLoad(sv);
          }
        });
        b.disabled = mode === 'load' && !sv;
        list.append(b);
      });
      list.append(button('Назад', main));
    };
    const main = (): void => {
      const save = button('Сохранить', () => slots('save'));
      save.disabled = !!this.world.pending;
      list.replaceChildren(
        button('Продолжить', close),
        save,
        button('Загрузить', () => slots('load')),
        button('Управление', () => this.help()),
        button('В меню игры', () => {
          close();
          this.onQuit();
        }),
        button('Во двор', () => (location.href = '/')),
      );
    };
    main();
    box.append(list);
  }

  private showEnd(): void {
    const w = this.world;
    this.audio.music('victory');
    const { box } = modal(this.overlay, 'g-result');
    box.parentElement!.onpointerdown = null;
    box.append(h('h2', '', w.winner >= 0 ? `Победа: ${w.players[w.winner].name}!` : 'Никто не выстоял'), h('p', 'dim', `Партия шла ${w.day + 1} дн.`), button('В меню игры', () => this.onQuit(), 'g-btn main'));
  }

  // ------------------------------------------------------------------ подсказки

  private tip(text: string): void {
    this.tipEl.textContent = text;
    this.tipEl.hidden = !text;
  }

  private describeCell(c: number): string {
    const w = this.world;
    if (c < 0 || !w.players[this.me].explored[c]) return '';
    const cell = this.bodies.get(c) ?? c;
    const foe = heroAt(w, cell);
    if (foe && !heroHiddenFrom(w, foe, this.me)) return `${foe.owner === this.me ? '' : 'Чужой герой: '}${heroName(foe.pick)}, ${foe.level}-й уровень`;
    const t = townAt(w, cell);
    if (t) return `${t.name} · ${t.owner < 0 ? 'ничей' : w.players[t.owner].name}`;
    const o = objAt(w, cell);
    if (o) {
      if (isStack(o)) {
        const s = o.army?.find((x) => x);
        return s ? `${CREATURES[s.cre].name}: ${stackWord(s.count)}. Стерегут клетки вокруг.` : 'Отряд';
      }
      const d = defOf(o);
      const owner = o.owner >= 0 ? ` · ${w.players[o.owner].name}` : '';
      const guard = o.army?.some((x) => x) && o.owner !== this.me ? ' · под охраной' : '';
      return `${d.name}${owner}${guard}. ${d.text}`;
    }
    if (guardOf(w, c)) return 'Эту клетку стережёт отряд: шагнёшь — будет бой';
    return TERRAINS[w.terrain[c]].name + (w.road[c] ? ', дорога' : '');
  }

  private hover(c: number): void {
    if (this.blocked()) return;
    this.tip(this.describeCell(c));
  }

  private describe(c: number): void {
    const text = this.describeCell(c);
    if (!text) return;
    const { box, close } = modal(this.overlay, 'g-card');
    box.append(h('p', '', text));
    const o = objAt(this.world, c);
    const x = this.hero;
    if (o?.army?.some((v) => v) && x) {
      const mine = armyPower(x.army);
      const theirs = armyPower(o.army);
      box.append(h('p', 'dim', mine > theirs * 2 ? 'Похоже, отряд по зубам.' : mine > theirs ? 'Будут потери.' : 'Похоже, отряд сильнее.'));
    }
    box.append(button('Понятно', close));
  }

  private key(e: KeyboardEvent): void {
    if (e.repeat || this.battle) return;
    if (e.code === 'Escape') {
      if (this.town) {
        if (!this.town.closeTop()) this.closeTown();
        return;
      }
      const open = this.overlay.querySelector('.g-modal');
      if (open) {
        open.dispatchEvent(new PointerEvent('pointerdown', { bubbles: false }));
        return;
      }
      if (this.target >= 0) {
        this.target = -1;
        this.view.clearPath();
        return;
      }
      this.pause();
      return;
    }
    if (e.code === 'KeyM') {
      this.audio.toggleMute();
      return;
    }
    if (this.blocked()) return;
    if (e.code === 'KeyE') this.endTurn();
    else if (e.code === 'KeyH') this.nextHero();
    else if (e.code === 'KeyB') this.book();
    else if (e.code === 'KeyD') this.dig();
    else if (e.code === 'Space' && this.target >= 0 && this.hero) {
      e.preventDefault();
      void this.go(this.hero.id, this.target);
    }
  }

  destroy(): void {
    this.dead = true;
    this.battle?.destroy();
    this.town?.destroy();
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('resize', this.fit);
    this.view.destroy();
    this.root.remove();
  }
}
