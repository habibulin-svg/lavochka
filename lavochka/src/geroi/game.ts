/* Партия боя: кто ходит, ввод человека, боты, панель, пауза, сохранения. Правила — в sim/, картинка — в render/. */
import { type Audio2 } from './audio';
import { type BotLevel, botAction } from './bot/bot';
import { BattleView, STAGE_H, STAGE_W, cellCenter, type Pointer } from './render/view';
import { SLOTS, type Save, loadSaves, slotLabel, writeAuto, writeSave } from './save';
import {
  type Action, type BattleEvent, type BattleSetup, type BattleState, type Unit, act, actionError, aidError, attackCells, canShoot, canTarget, createBattle, currentUnit, damageEstimate, reachOf, sideValue,
  skyAt, spellError, spellPower, unitAt,
} from './sim/battle';
import { CREATURES, hasAb } from './sim/creatures';
import { heroName, heroPortrait } from './sim/heroes';
import { CELLS, neighbors } from './sim/hex';
import { SPELLS, type School, spellIcon } from './sim/spells';
import { button, creatureIcon, creatureLines, h, modal } from './ui/common';

export type Who = 'human' | BotLevel;

const SCHOOL_NAME: Record<School, string> = { fire: 'Огонь', water: 'Вода', earth: 'Земля', air: 'Воздух' };
const SCHOOL_SIGN: Record<School, string> = { fire: '🔥', water: '💧', earth: '⛰', air: '🌀' };
const WHO_NAME: Record<Who, string> = { human: 'человек', easy: 'лёгкий', medium: 'средний', hard: 'сложный' };

export interface GameOptions {
  who: [Who, Who];
  setup?: BattleSetup;
  restore?: Save;
  fast?: boolean;
}

export class Game {
  state: BattleState;
  readonly who: [Who, Who];
  private view: BattleView;
  private root = h('div', 'g-game');
  private canvasHost = h('div', 'g-canvas');
  private hud = h('div', 'g-hud');
  private plates: HTMLElement[] = [h('div', 'g-hero left'), h('div', 'g-hero right')];
  private center = h('div', 'g-center');
  private queueEl = h('div', 'g-queue');
  private logEl = h('div', 'g-log');
  private tip = h('div', 'g-tip');
  private actions = h('div', 'g-actions');
  private corner = h('div', 'g-corner');
  private overlay = h('div', 'g-overlayhost');
  private musicBtn = button('♪', () => this.toggleMusic(), 'g-round');
  private autoBtn = button('Авто', () => this.toggleAuto(), 'g-btn small');
  /** Что нажмёт человек: задаёт waitInput. */
  private input: ((a: Action) => void) | null = null;
  private auto = false;
  private mode: { t: 'normal' } | { t: 'aid' } | { t: 'cast'; spell: string } = { t: 'normal' };
  private paused = false;
  private resumeFn: (() => void) | null = null;
  private dead = false;
  private lastRound = 0;
  private start0: number[];
  private readonly title: string;
  private readonly onKey = (e: KeyboardEvent): void => this.key(e);
  private readonly fit = (): void => this.fitHud();
  onQuit: () => void = () => {};
  onLoad: (s: Save) => void = () => {};
  onRematch: () => void = () => {};

  constructor(private readonly host: HTMLElement, private readonly audio: Audio2, o: GameOptions) {
    this.state = o.restore ? o.restore.state : createBattle(o.setup!);
    this.who = o.who;
    this.view = new BattleView(this.canvasHost, audio);
    this.view.instant = !!o.fast;
    this.lastRound = this.state.round;
    this.start0 = this.state.units.map((u) => u.start);
    const names = this.state.sides.map((x) => heroName(x.pick));
    this.title = `${names[0]} и ${names[1]}, раунд`;
  }

  async start(): Promise<void> {
    this.root.append(this.canvasHost, this.hud);
    this.host.append(this.root);
    this.buildHud();
    await this.view.init(this.state);
    this.view.sync(this.state);
    this.view.onPointer = (p) => this.hover(p);
    this.view.onClick = (p, right) => this.click(p, right);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('resize', this.fit);
    this.fitHud();
    this.audio.music('battle');
    this.audio.sfx('battle-start');
    this.refresh();
    void this.loop();
  }

  destroy(): void {
    this.dead = true;
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('resize', this.fit);
    this.resumeFn?.();
    this.input = null;
    this.view.destroy();
    this.root.remove();
  }

  private fitHud(): void {
    const w = this.root.clientWidth;
    const hh = this.root.clientHeight;
    const k = Math.min(w / STAGE_W, hh / STAGE_H);
    this.hud.style.transform = `translate(${(w - STAGE_W * k) / 2}px, ${(hh - STAGE_H * k) / 2}px) scale(${k})`;
  }

  // ------------------------------------------------------------------ ход партии

  private async loop(): Promise<void> {
    while (!this.dead && !this.state.over) {
      if (this.paused) await new Promise<void>((r) => (this.resumeFn = r));
      if (this.dead) return;
      const u = currentUnit(this.state);
      if (!u) break;
      const who = this.who[u.side];
      let a: Action;
      if (who === 'human' && !this.auto) {
        this.prepareInput();
        a = await new Promise<Action>((res) => (this.input = res));
        this.input = null;
        this.view.highlight({});
      } else {
        this.view.highlight({ active: u });
        await this.pauseFor(this.view.instant ? 0 : 220);
        if (this.dead) return;
        if (this.paused) continue;
        a = botAction(this.state, who === 'human' ? 'hard' : who);
      }
      if (this.dead) return;
      const err = actionError(this.state, a);
      if (err) {
        // сюда попадает только то, что запретила логика: ход не теряем
        this.flash(err);
        continue;
      }
      await this.apply(a);
    }
    if (!this.dead && this.state.over) this.showResult();
  }

  private pauseFor(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms / this.view.speed));
  }

  private async apply(a: Action): Promise<void> {
    const ev = act(this.state, a);
    this.logEvents(ev);
    this.view.highlight({});
    await this.view.play(ev);
    if (this.dead) return;
    this.view.refreshStates(this.state);
    this.refresh();
    if (this.state.round !== this.lastRound) {
      this.lastRound = this.state.round;
      if (!this.state.over) writeAuto(this.saveData());
    }
  }

  private saveData(): Save {
    return { at: Date.now(), title: `${this.title} ${this.state.round}`, state: this.state, who: this.who };
  }

  private prepareInput(): void {
    this.mode = { t: 'normal' };
    this.refresh();
    this.drawNormal();
  }

  private send(a: Action): void {
    if (this.input) this.input(a);
  }

  // ------------------------------------------------------------------ мышь

  private reachCells(u: Unit): number[] {
    const r = reachOf(this.state, u);
    const out: number[] = [];
    for (let c = 0; c < CELLS; c++) if (r.dist[c] > 0) out.push(c);
    return out;
  }

  private drawNormal(hover = -1, extra: Partial<Parameters<BattleView['highlight']>[0]> = {}): void {
    const u = currentUnit(this.state);
    if (!u) return;
    this.view.highlight({ reach: this.reachCells(u), active: u, hover, ...extra });
  }

  /** Что сделает щелчок по этой точке (для подсказки и самого щелчка). */
  private intent(p: Pointer): { a: Action | null; tip: string; draw: Partial<Parameters<BattleView['highlight']>[0]> } {
    const s = this.state;
    const u = currentUnit(s)!;
    const none = { a: null, tip: '', draw: {} };
    if (p.cell < 0) return none;
    const t = unitAt(s, p.cell);
    if (this.mode.t === 'cast') {
      const sp = SPELLS[this.mode.spell];
      const err = spellError(s, u.side, sp.id, p.cell);
      const area = sp.kind === 'aoe' ? [p.cell, ...neighbors(p.cell)] : undefined;
      if (err) return { a: null, tip: err, draw: { area } };
      return { a: { t: 'cast', spell: sp.id, cell: p.cell }, tip: `${sp.name}: ${sp.text}`, draw: { area, target: t ?? undefined } };
    }
    if (this.mode.t === 'aid') {
      if (!t) return none;
      const err = aidError(s, u, t.id);
      return err ? { a: null, tip: err, draw: {} } : { a: { t: 'aid', target: t.id }, tip: hasAb(CREATURES[u.cre], 'curseCast') ? 'Замедлить' : 'Лечить', draw: { target: t } };
    }
    if (t && t.side !== u.side) {
      if (!canTarget(t)) return { a: null, tip: 'В тумане — не достать', draw: {} };
      if (canShoot(s, u)) {
        const d = damageEstimate(s, u, t, { ranged: true });
        return { a: { t: 'shoot', target: t.id }, tip: `Выстрел: ${d.min}–${d.max} урона, падёт ${d.killMin}–${d.killMax}`, draw: { target: t } };
      }
      const r = reachOf(s, u);
      const cells = attackCells(s, u, t, r);
      if (!cells.length) return { a: null, tip: `${CREATURES[t.cre].name}: не дойти`, draw: {} };
      // с какой стороны бить — куда ближе мышь
      const from = cells.reduce((best, c) => {
        const a = cellCenter(c);
        const b = cellCenter(best);
        return (a.x - p.x) * (a.x - p.x) + (a.y - p.y) * (a.y - p.y) < (b.x - p.x) * (b.x - p.x) + (b.y - p.y) * (b.y - p.y) ? c : best;
      });
      const d = damageEstimate(s, u, t, { steps: r.dist[from] });
      return { a: { t: 'attack', target: t.id, from }, tip: `Удар: ${d.min}–${d.max} урона, падёт ${d.killMin}–${d.killMax}`, draw: { target: t, attackFrom: from } };
    }
    if (t) return { a: null, tip: `${CREATURES[t.cre].name}: правая кнопка — сведения`, draw: {} };
    const r = reachOf(s, u);
    if (r.dist[p.cell] > 0) return { a: { t: 'move', to: p.cell }, tip: '', draw: { hover: p.cell } };
    return none;
  }

  private hover(p: Pointer): void {
    if (!this.input) return this.hideTip();
    const i = this.intent(p);
    this.drawNormal(p.cell, i.draw);
    if (i.tip) {
      this.tip.textContent = i.tip;
      this.tip.hidden = false;
      this.tip.style.left = `${Math.min(STAGE_W - 460, Math.max(10, p.x + 24))}px`;
      this.tip.style.top = `${Math.max(10, p.y - 56)}px`;
    } else this.hideTip();
  }

  private hideTip(): void {
    this.tip.hidden = true;
  }

  private click(p: Pointer, right: boolean): void {
    if (right) {
      if (this.mode.t !== 'normal') return this.setMode({ t: 'normal' });
      const t = p.cell >= 0 ? unitAt(this.state, p.cell) : null;
      if (t) this.unitCard(t);
      return;
    }
    if (!this.input) return;
    const i = this.intent(p);
    if (i.a) {
      this.hideTip();
      const a = i.a;
      this.mode = { t: 'normal' };
      this.send(a);
    } else if (i.tip) this.audio.sfx('ui-error', 0.4);
  }

  private setMode(m: Game['mode']): void {
    this.mode = m;
    this.refresh();
    this.drawNormal();
  }

  // ------------------------------------------------------------------ панель

  private buildHud(): void {
    this.tip.hidden = true;
    this.corner.append(button('☰', () => this.togglePause(), 'g-round'), this.musicBtn, button('?', () => this.help(), 'g-round'));
    this.hud.append(...this.plates, this.center, this.corner, this.logEl, this.queueEl, this.actions, this.tip, this.overlay);
    this.musicBtn.classList.toggle('off', this.audio.musicOff);
  }

  private plate(side: 0 | 1): void {
    const x = this.state.sides[side];
    const el = this.plates[side];
    el.replaceChildren();
    const img = h('img');
    img.src = `/geroi/a/heroes/${heroPortrait(x.pick)}.webp`;
    img.alt = '';
    const text = h('div', 'g-hero-text');
    text.append(h('b', '', heroName(x.pick)), h('span', 'dim', WHO_NAME[this.who[side]]));
    const stats = h('div', 'g-stats');
    for (const [icon, v] of [['01', x.atk], ['02', x.def], ['03', x.power], ['04', x.know]] as const) {
      const c = h('span');
      const i = h('img');
      i.src = `/geroi/a/icons/stat-${icon}.webp`;
      c.append(i, String(v));
      stats.append(c);
    }
    const mana = h('div', 'g-mana');
    const bar = h('i');
    bar.style.width = `${Math.round((x.mana / Math.max(1, x.know * 10)) * 100)}%`;
    mana.append(bar, h('span', '', `${x.mana}/${x.know * 10}`));
    text.append(stats, mana);
    el.append(img, text);
    el.classList.toggle('active', currentUnit(this.state)?.side === side);
  }

  /** Обновить всё, что зависит от состояния. */
  private refresh(): void {
    const s = this.state;
    this.plate(0);
    this.plate(1);
    this.center.replaceChildren(h('b', '', `Раунд ${s.round}`));
    if (s.sides.some((x) => x.faction === 'akademiya')) {
      const sky = h('div', 'g-sky');
      for (let i = 0; i < 3; i++) {
        const sc = skyAt(s, s.round + i);
        const d = h('span', i === 0 ? 'now' : '', SCHOOL_SIGN[sc]);
        d.title = `${i === 0 ? 'Сейчас' : `Через ${i}`}: ${SCHOOL_NAME[sc]}`;
        sky.append(d);
      }
      this.center.append(sky);
    }
    const queue = [s.current, ...s.queue, ...s.waited].filter((id) => id >= 0 && s.units[id].count > 0);
    this.queueEl.replaceChildren();
    for (const id of queue.slice(0, 14)) {
      const u = s.units[id];
      const d = h('div', `g-qi side${u.side}${id === s.current ? ' now' : ''}`);
      d.append(creatureIcon(u.cre, 66), h('span', '', String(u.count)));
      d.title = CREATURES[u.cre].name;
      d.onclick = () => this.unitCard(u);
      this.queueEl.append(d);
    }
    this.buildActions();
    this.musicBtn.classList.toggle('off', this.audio.musicOff);
  }

  private buildActions(): void {
    const s = this.state;
    const u = currentUnit(s);
    this.actions.replaceChildren();
    if (!u || s.over) return;
    const mine = this.who[u.side] === 'human' && !this.auto;
    const add = (text: string, fn: () => void, on: boolean, cls = 'g-btn small'): void => {
      const b = button(text, fn, cls);
      b.disabled = !on;
      this.actions.append(b);
    };
    const c = CREATURES[u.cre];
    add('Ждать (W)', () => this.send({ t: 'wait' }), mine && !u.waited);
    add('Защита (D)', () => this.send({ t: 'defend' }), mine);
    if (u.aid > 0 && (hasAb(c, 'heal') || hasAb(c, 'repair') || hasAb(c, 'curseCast')))
      add(`${hasAb(c, 'curseCast') ? 'Замедлить' : hasAb(c, 'repair') ? 'Чинить' : 'Лечить'} (E) · ${u.aid}`, () => this.setMode(this.mode.t === 'aid' ? { t: 'normal' } : { t: 'aid' }), mine, `g-btn small${this.mode.t === 'aid' ? ' on' : ''}`);
    add('Магия (B)', () => this.book(), mine && !s.sides[u.side].cast, `g-btn small${this.mode.t === 'cast' ? ' on' : ''}`);
    this.autoBtn.classList.toggle('on', this.auto);
    if (this.who.includes('human')) this.actions.append(this.autoBtn);
    add('Бежать', () => this.confirmFlee(), mine);
  }

  private flash(text: string): void {
    this.logEl.textContent = text;
  }

  private logEvents(ev: BattleEvent[]): void {
    const s = this.state;
    const name = (id: number): string => CREATURES[s.units[id].cre].name;
    for (const e of ev) {
      if (e.e === 'hit') {
        const kills = e.hits.reduce((n, x) => n + x.kills, 0);
        const dmg = e.hits.reduce((n, x) => n + x.dmg, 0);
        this.logEl.textContent = `${name(e.u)} ${e.retal ? 'отвечают' : e.shot ? 'стреляют' : 'бьют'}: ${Math.round(dmg)} урона${kills ? `, пало ${kills}` : ''}${e.luck ? ' · удача!' : ''}`;
      } else if (e.e === 'spell') this.logEl.textContent = `${heroName(s.sides[e.side].pick)} колдует: ${SPELLS[e.spell].name}`;
      else if (e.e === 'round') this.logEl.textContent = `Раунд ${e.n}`;
    }
  }

  // ------------------------------------------------------------------ окна

  private unitCard(u: Unit): void {
    const c = CREATURES[u.cre];
    const { box, close } = modal(this.overlay, 'g-card');
    box.append(creatureIcon(u.cre, 150), h('h3', '', c.name), h('p', 'dim', `В отряде ${u.count} · верхний ${u.top}/${c.hp}${c.shots ? ` · выстрелов ${u.shots}` : ''}`));
    for (const line of creatureLines(u.cre)) box.append(h('p', '', line));
    if (u.effects.length) {
      const names: Record<string, string> = { atk: 'атака', def: 'защита', speed: 'скорость', poison: 'яд', stun: 'пропуск хода', root: 'опутан', hidden: 'в тумане' };
      box.append(h('p', 'dim', u.effects.map((e) => `${names[e.k]}${e.k === 'atk' || e.k === 'def' || e.k === 'speed' ? ` ${e.v > 0 ? '+' : ''}${e.v}` : ''} (${e.n})`).join(', ')));
    }
    box.append(button('Закрыть', close));
  }

  private book(): void {
    const s = this.state;
    const u = currentUnit(s);
    if (!u || !this.input) return;
    const hero = s.sides[u.side];
    const { box, close } = modal(this.overlay, 'g-book');
    box.append(h('h3', '', `Книга: ${heroName(hero.pick)} · мана ${hero.mana}`));
    const grid = h('div', 'g-spells');
    for (const id of hero.spells) {
      const sp = SPELLS[id];
      const b = h('button', 'g-spell');
      const img = h('img');
      img.src = `/geroi/a/icons/${spellIcon(sp)}.webp`;
      img.alt = '';
      const boosted = spellPower(s, u.side, sp) > hero.power;
      const t = h('span');
      t.append(h('b', '', sp.name), h('em', '', `${SCHOOL_NAME[sp.school]}${boosted ? ' ✦ созвездие' : ''} · мана ${sp.mana}`), h('em', '', sp.text));
      b.append(img, t);
      b.disabled = hero.mana < sp.mana;
      b.onclick = () => {
        close();
        this.setMode({ t: 'cast', spell: id });
        this.flash(`${sp.name}: выбери цель. Правая кнопка — отмена.`);
      };
      grid.append(b);
    }
    box.append(grid, button('Закрыть', close));
  }

  private confirmFlee(): void {
    const { box, close } = modal(this.overlay, 'g-card');
    box.append(h('h3', '', 'Бежать с поля?'), h('p', '', 'Это поражение.'));
    box.append(button('Бежать', () => {
      close();
      this.send({ t: 'flee' });
    }), button('Остаться', close));
  }

  private help(): void {
    const { box, close } = modal(this.overlay, 'g-card');
    box.append(h('h3', '', 'Управление'));
    for (const line of [
      'Щелчок по клетке — идти.',
      'По врагу — удар или выстрел; с какой стороны бить, решает положение мыши.',
      'Правая кнопка по отряду — сведения.',
      'W — ждать, D — защита, E — умение, B — книга заклинаний.',
      'A — автобой, F — быстрее, Esc — пауза, M — весь звук.',
    ]) box.append(h('p', '', line));
    box.append(button('Понятно', close));
  }

  private toggleMusic(): void {
    this.audio.toggleMusic();
    this.musicBtn.classList.toggle('off', this.audio.musicOff);
  }

  private toggleAuto(): void {
    this.auto = !this.auto;
    // автобой включён на нашем ходу — ждём его, а не щелчка
    if (this.auto && this.input) {
      this.send(botAction(this.state, 'hard'));
    }
    this.refresh();
  }

  togglePause(): void {
    if (this.paused) return;
    this.paused = true;
    const close0 = (): void => {
      this.paused = false;
      this.resumeFn?.();
      this.resumeFn = null;
    };
    const { box, close } = modal(this.overlay, 'g-pause', close0);
    box.append(h('h3', '', 'Пауза'));
    const list = h('div', 'g-col');
    const showSlots = (mode: 'save' | 'load'): void => {
      list.replaceChildren();
      const saves = loadSaves();
      saves.forEach((sv, i) => {
        if (mode === 'save' && i >= SLOTS) return;
        const b = button(slotLabel(sv, i), () => {
          if (mode === 'save') {
            writeSave(i, this.saveData());
            showSlots('save');
          } else if (sv) {
            close();
            this.onLoad(sv);
          }
        });
        b.disabled = mode === 'load' && !sv;
        list.append(b);
      });
      list.append(button('Назад', showMain));
    };
    const showMain = (): void => {
      list.replaceChildren(
        button('Продолжить', close),
        button('Сохранить', () => showSlots('save')),
        button('Загрузить', () => showSlots('load')),
        button('Управление', () => this.help()),
        button('В меню игры', () => {
          close();
          this.onQuit();
        }),
        button('Во двор', () => (location.href = '/')),
      );
    };
    showMain();
    box.append(list);
  }

  private key(e: KeyboardEvent): void {
    if (e.repeat) return;
    if (e.code === 'Escape') {
      const open = this.overlay.querySelector('.g-modal');
      if (open) {
        // закрыть верхнее окно тем же путём, что и щелчок мимо
        open.dispatchEvent(new PointerEvent('pointerdown', { bubbles: false }));
        return;
      }
      if (this.mode.t !== 'normal') return this.setMode({ t: 'normal' });
      if (!this.state.over) this.togglePause();
      return;
    }
    // под открытым окном поле не слушает клавиши
    if (this.overlay.querySelector('.g-modal')) return;
    if (e.code === 'KeyM') {
      this.audio.toggleMute();
      return;
    }
    if (e.code === 'KeyF') {
      this.view.speed = this.view.speed === 1 ? 2 : this.view.speed === 2 ? 4 : 1;
      this.flash(`Скорость боя ×${this.view.speed}`);
      return;
    }
    if (e.code === 'KeyA') return this.who.includes('human') ? this.toggleAuto() : undefined;
    if (!this.input) return;
    const u = currentUnit(this.state);
    if (!u) return;
    if (e.code === 'KeyW' && !u.waited) this.send({ t: 'wait' });
    else if (e.code === 'KeyD') this.send({ t: 'defend' });
    else if (e.code === 'KeyB' && !this.state.sides[u.side].cast) this.book();
    else if (e.code === 'KeyE' && u.aid > 0) {
      const c = CREATURES[u.cre];
      if (hasAb(c, 'heal') || hasAb(c, 'repair') || hasAb(c, 'curseCast')) this.setMode({ t: 'aid' });
    }
  }

  private showResult(): void {
    const s = this.state;
    const humans = this.who.map((w, i) => (w === 'human' ? i : -1)).filter((i) => i >= 0);
    const won = humans.length ? humans.includes(s.winner) : s.winner >= 0;
    this.audio.music(won ? 'victory' : 'defeat');
    this.audio.sfx(won ? 'battle-win' : 'battle-lose');
    const title = s.winner < 0 ? 'Ничья' : humans.length === 1 ? (won ? 'Победа!' : 'Поражение') : `Победа: ${heroName(s.sides[s.winner].pick)}`;
    const { box } = modal(this.overlay, 'g-result');
    box.append(h('h2', '', title));
    const cols = h('div', 'g-losses');
    for (const side of [0, 1] as const) {
      const col = h('div');
      col.append(h('b', '', `${heroName(s.sides[side].pick)} · осталось силы ${Math.round(sideValue(s, side))}`));
      for (const u of s.units) {
        if (u.side !== side) continue;
        const row = h('div', 'g-loss');
        row.append(creatureIcon(u.cre, 48), h('span', '', `${CREATURES[u.cre].name}: потери ${this.start0[u.id] - u.count} из ${this.start0[u.id]}`));
        col.append(row);
      }
      cols.append(col);
    }
    box.append(cols, button('Ещё раз', () => this.onRematch()), button('В меню игры', () => this.onQuit()));
  }
}
