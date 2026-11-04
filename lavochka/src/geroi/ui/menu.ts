/* Меню «Героев»: заглавный экран, быстрый бой (фракция, герой, армия по бюджету, кто играет), загрузка. */
import type { Audio2 } from '../audio';
import type { Who } from '../game';
import { type Save, loadSaves, slotLabel } from '../save';
import { type ArmySlot, randomArmy } from '../sim/army';
import type { BattleSetup } from '../sim/battle';
import { CREATURES, FACTIONS, type Faction, factionCreatures } from '../sim/creatures';
import { type HeroPick, factionClasses, heroName, heroPortrait } from '../sim/heroes';
import type { GameSpec } from '../sim/adv/testmap';
import { GUARDS, type GenOptions, type GuardId, MAP_SIZES, type SizeId, TEMPLATES, WATERS, type WaterId, daySeed, genQuery, generateMap } from '../sim/adv/gen';
import { OBJECTS, TERRAINS, WATER } from '../sim/adv/data';
import type { World } from '../sim/adv/world';
import { PLAYER_COLORS } from '../render/mapview';
import type { TownFaction } from '../sim/adv/town';
import { button, creatureIcon, creatureLines, h, modal } from './common';

const BUDGETS = [5000, 10000, 20000, 40000, 80000];
const FIELDS: [string, string][] = [['meadow', 'Луг'], ['swamp', 'Болото'], ['ash', 'Пепелище'], ['pine', 'Бор'], ['ford', 'Брод'], ['crater', 'Кратер']];
const WHO: [Who, string][] = [['human', 'Человек'], ['easy', 'Бот: лёгкий'], ['medium', 'Бот: средний'], ['hard', 'Бот: сложный']];

interface SideCfg {
  faction: Faction;
  hero: HeroPick;
  who: Who;
  army: ArmySlot[];
}

export interface QuickConfig {
  setup: BattleSetup;
  who: [Who, Who];
}

/** Кто на месте карты: человек или бот (этап 5). */
export type MapWho = 'human' | 'easy' | 'medium' | 'hard';
const WHO_LABEL: [MapWho, string][] = [['human', 'Человек'], ['easy', 'Бот: лёгкий'], ['medium', 'Бот: средний'], ['hard', 'Бот: сложный']];
function whoSelect(value: MapWho, onChange: (v: MapWho) => void): HTMLSelectElement {
  const sel = h('select', 'g-select g-who');
  for (const [id, label] of WHO_LABEL) sel.append(new Option(label, id, false, id === value));
  sel.onchange = () => onChange(sel.value as MapWho);
  return sel;
}
const botOf = (who: MapWho): { bot?: 'easy' | 'medium' | 'hard' } => (who === 'human' ? {} : { bot: who });

export class Menu {
  readonly el = h('div', 'g-menu');
  onQuick: (c: QuickConfig) => void = () => {};
  onLoad: (s: Save) => void = () => {};
  onArena: () => void = () => {};
  onNetMap: () => void = () => {};
  onMap: (s: GameSpec) => void = () => {};
  onRandom: (s: GameSpec, o: GenOptions) => void = () => {};
  private last: QuickConfig | null = null;

  constructor(host: HTMLElement, private readonly audio: Audio2) {
    host.append(this.el);
  }

  hide(): void {
    this.el.hidden = true;
  }

  screen(...nodes: Node[]): void {
    this.el.hidden = false;
    this.el.replaceChildren(...nodes);
    this.audio.music('menu');
  }

  title(): void {
    const logo = h('div', 'g-logo');
    logo.append(h('b', '', 'Герои'), h('span', '', 'кастета и семок'));
    const col = h('div', 'g-col g-title-col');
    const music = button(this.audio.musicOff ? 'Музыка: выкл' : 'Музыка: вкл', () => {
      music.textContent = this.audio.toggleMusic() ? 'Музыка: выкл' : 'Музыка: вкл';
    });
    col.append(
      button('Арена', () => this.onArena(), 'g-btn main'),
      button('Случайная карта', () => this.randomMap()),
      button('Карта по сети', () => this.onNetMap()),
      button('Карта «Две реки»', () => this.mapSetup()),
      button('Быстрый бой', () => this.quick()),
      button('Загрузить', () => this.load()),
      music,
      button('Во двор', () => (location.href = '/')),
    );
    this.screen(logo, col, h('div', 'g-foot', 'Lavochka Games · ранний доступ: «Арена», карты с ботами и по сети'));
  }

  locked(signedIn: boolean): void {
    const logo = h('div', 'g-logo');
    logo.append(h('b', '', 'Герои'), h('span', '', 'кастета и семок'));
    const col = h('div', 'g-col g-title-col');
    col.append(
      h('p', 'g-note', `Игра в раннем доступе — первыми в неё играют подписчики «Лавочки+».${signedIn ? '' : ' Войди, если подписка есть.'}`),
      button(signedIn ? 'Оформить «Лавочку+»' : 'Войти или оформить «Лавочку+»', () => (location.href = '/geroi/')),
      button('Во двор', () => (location.href = '/')),
    );
    this.screen(logo, col);
  }

  load(): void {
    const col = h('div', 'g-col g-title-col');
    col.append(h('h2', '', 'Загрузить'));
    loadSaves().forEach((sv, i) => {
      const b = button(slotLabel(sv, i), () => sv && this.onLoad(sv));
      b.disabled = !sv;
      col.append(b);
    });
    col.append(button('Назад', () => this.title()));
    this.screen(col);
  }

  /** Партия на карте «Две реки»: люди за одним экраном и боты. */
  mapSetup(): void {
    const sides: { faction: Faction; hero: HeroPick; name: string; who: MapWho }[] = [
      { faction: 'zatulye', hero: { cls: factionClasses('zatulye')[0].id, n: 1 }, name: 'Первый', who: 'human' },
      { faction: 'zatonye', hero: { cls: factionClasses('zatonye')[0].id, n: 1 }, name: 'Второй', who: 'medium' },
    ];
    const cols = h('div', 'g-quick');
    const draw = (): void => {
      cols.replaceChildren();
      sides.forEach((s, i) => {
        const col = h('div', `g-panel g-side side${i}`);
        const name = h('input', 'g-select');
        name.value = s.name;
        name.maxLength = 16;
        name.oninput = () => (s.name = name.value);
        const fac = h('select', 'g-select');
        for (const f of FACTIONS) fac.append(new Option(f.name, f.id, false, f.id === s.faction));
        fac.onchange = () => {
          s.faction = fac.value as Faction;
          s.hero = { cls: factionClasses(s.faction)[0].id, n: 1 };
          draw();
        };
        const row = h('div', 'g-row');
        row.append(name, fac, whoSelect(s.who, (v) => (s.who = v)));
        col.append(row, h('p', 'dim g-mech', FACTIONS.find((f) => f.id === s.faction)!.mechanic));
        const heroes = h('div', 'g-heroes');
        for (const cls of factionClasses(s.faction)) for (let n = 1; n <= 4; n++) {
          const p = { cls: cls.id, n };
          const b = h('button', `g-heropick${s.hero.cls === cls.id && s.hero.n === n ? ' on' : ''}`);
          const img = h('img');
          img.src = `/geroi/a/heroes/${heroPortrait(p)}.webp`;
          img.alt = heroName(p);
          b.title = `${heroName(p)}, ${cls.name}: атака ${cls.atk}, защита ${cls.def}, магия ${cls.power}, знание ${cls.know}`;
          b.append(img);
          b.onclick = () => {
            s.hero = p;
            draw();
          };
          heroes.append(b);
        }
        col.append(heroes, h('p', 'g-heroline', `${heroName(s.hero)}, ${factionClasses(s.faction).find((c) => c.id === s.hero.cls)!.name}`));
        cols.append(col);
      });
    };
    draw();
    const bar = h('div', 'g-quickbar');
    bar.append(button('Назад', () => this.title()), button('На карту!', () => {
      if (sides[0].hero.cls === sides[1].hero.cls && sides[0].hero.n === sides[1].hero.n) return;
      this.onMap({ seed: Date.now() % 2147483647, players: sides.map((s, i) => ({ name: s.name.trim() || `Игрок ${i + 1}`, faction: s.faction as TownFaction, hero: s.hero, ...botOf(s.who) })) });
    }, 'g-btn main'));
    this.screen(h('h2', 'g-quick-title', 'Карта «Две реки»'), cols, bar);
  }

  /** Случайная карта: шаблон, размер, вода, охрана, сид; предпросмотр и ссылка. Боты на карте — этап 5, пока все за одним экраном. */
  randomMap(pre?: GenOptions): void {
    const o: GenOptions = pre ? { ...pre } : { template: 'duel', size: 'm', water: 'lakes', guard: 'normal', seed: (Date.now() % 999999) + 1 };
    const START: Faction[] = ['zatulye', 'zatonye', 'kuznya', 'akademiya'];
    const NAMES = ['Первый', 'Второй', 'Третий', 'Четвёртый'];
    const sides = START.map((f, i) => ({ faction: f, hero: { cls: factionClasses(f)[i % 2].id, n: 1 + (i >> 1) } as HeroPick, name: NAMES[i], who: (i ? 'medium' : 'human') as MapWho }));
    const today = (): string => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    };
    let dayLabel = '';
    const form = h('div', 'g-panel g-rand-form');
    const list = h('div', 'g-rand-sides');
    const canvas = h('canvas', 'g-rand-map');
    const info = h('p', 'g-rand-info dim');
    const link = h('input', 'g-select g-rand-link');
    link.readOnly = true;
    const players = (): number => TEMPLATES[o.template].players;
    const spec = (): GameSpec => ({
      seed: o.seed,
      players: sides.slice(0, players()).map((s, i) => ({ name: s.name.trim() || `Игрок ${i + 1}`, faction: s.faction as TownFaction, hero: s.hero, ...botOf(s.who) })),
    });
    const url = (): string => {
      const fs = sides.slice(0, players()).map((s, i) => `&${'abcd'[i]}=${s.faction}${s.who === 'human' ? '' : `&w${'abcd'[i]}=${s.who}`}`).join('');
      return `${location.origin}/geroi.html?map=1&${genQuery(o)}${fs}`;
    };
    const free = (f: Faction, i: number): HeroPick => {
      for (const cls of factionClasses(f)) for (let n = 1; n <= 4; n++) {
        if (!sides.some((x, j) => j !== i && x.hero.cls === cls.id && x.hero.n === n)) return { cls: cls.id, n };
      }
      return { cls: factionClasses(f)[0].id, n: 1 };
    };
    const sel = <T extends string>(entries: [T, string][], value: T, on: (v: T) => void): HTMLSelectElement => {
      const el = h('select', 'g-select');
      for (const [id, name] of entries) el.append(new Option(name, id, false, id === value));
      el.onchange = () => {
        on(el.value as T);
        dayLabel = '';
        draw();
      };
      return el;
    };
    const seedIn = h('input', 'g-select g-rand-seed');
    seedIn.inputMode = 'numeric';
    seedIn.onchange = () => {
      o.seed = (Number(seedIn.value.replace(/\D/g, '')) || 1) >>> 0;
      dayLabel = '';
      draw();
    };
    const draw = (): void => {
      const t = TEMPLATES[o.template];
      if (!t.sizes.includes(o.size)) o.size = t.sizes.includes('m') ? 'm' : t.sizes[0];
      form.replaceChildren();
      const row1 = h('div', 'g-row');
      row1.append(
        sel(Object.values(TEMPLATES).map((x): [string, string] => [x.id, `${x.name} · игроков: ${x.players}`]), o.template, (v) => (o.template = v)),
        sel(t.sizes.map((x): [SizeId, string] => [x, `${MAP_SIZES[x].name}, ${MAP_SIZES[x].n}×${MAP_SIZES[x].n}`]), o.size, (v) => (o.size = v)),
      );
      const row2 = h('div', 'g-row');
      row2.append(
        sel(Object.entries(WATERS) as [WaterId, string][], o.water, (v) => (o.water = v)),
        sel(Object.entries(GUARDS).map(([k, v]): [GuardId, string] => [k as GuardId, v.name]), o.guard, (v) => (o.guard = v)),
      );
      seedIn.value = String(o.seed);
      const row3 = h('div', 'g-row');
      row3.append(h('span', 'g-rand-label', 'Сид'), seedIn, button('🎲', () => {
        o.seed = (Date.now() % 999999) + 1;
        dayLabel = '';
        draw();
      }, 'g-btn small'), button('Карта дня', () => {
        const d = today();
        Object.assign(o, { template: 'duel', size: 'm', water: 'lakes', guard: 'normal', seed: daySeed(d) });
        dayLabel = `Карта дня, ${d.split('-').reverse().join('.')}`;
        draw();
      }, 'g-btn small'));
      form.append(h('p', 'dim g-rand-text', t.text), row1, row2, row3);

      // игроки: имя, фракция, герой; одинаковых героев не бывает
      list.replaceChildren();
      sides.slice(0, t.players).forEach((s, i) => {
        if (sides.some((x, j) => j < i && x.hero.cls === s.hero.cls && x.hero.n === s.hero.n)) s.hero = free(s.faction, i);
        const row = h('div', 'g-rand-side');
        row.style.borderLeftColor = `#${PLAYER_COLORS[i].toString(16).padStart(6, '0')}`;
        const name = h('input', 'g-select');
        name.value = s.name;
        name.maxLength = 16;
        name.oninput = () => (s.name = name.value);
        const fac = h('select', 'g-select');
        for (const f of FACTIONS) fac.append(new Option(f.name, f.id, false, f.id === s.faction));
        fac.onchange = () => {
          s.faction = fac.value as Faction;
          s.hero = free(s.faction, i);
          draw();
        };
        const hero = h('select', 'g-select');
        for (const cls of factionClasses(s.faction)) for (let n = 1; n <= 4; n++) {
          const p = { cls: cls.id, n };
          const opt = new Option(`${heroName(p)}, ${cls.name}`, `${cls.id}:${n}`, false, s.hero.cls === cls.id && s.hero.n === n);
          opt.disabled = sides.slice(0, t.players).some((x, j) => j !== i && x.hero.cls === p.cls && x.hero.n === p.n);
          hero.append(opt);
        }
        hero.onchange = () => {
          const [cls, n] = hero.value.split(':');
          s.hero = { cls, n: Number(n) };
          draw();
        };
        row.append(name, fac, hero, whoSelect(s.who, (v) => {
          s.who = v;
          link.value = url();
        }));
        list.append(row);
      });

      // предпросмотр: та же карта, что будет в игре (стартовые зоны — по фракциям)
      const w = generateMap(spec(), o);
      drawPreview(canvas, w);
      const mines = w.objects.filter((x) => x.kind.startsWith('mine-')).length;
      const guards = w.objects.filter((x) => x.kind === 'stack').length;
      info.textContent = `${dayLabel ? `${dayLabel} · ` : ''}${w.w}×${w.h} · объектов ${w.objects.length - guards} · шахт ${mines} · стражей ${guards}`;
      link.value = url();
    };
    draw();
    const left = h('div', 'g-rand-left');
    left.append(form, list);
    const right = h('div', 'g-panel g-rand-right');
    const copy = button('Скопировать ссылку', () => {
      link.select();
      void navigator.clipboard?.writeText(link.value).catch(() => {});
    }, 'g-btn small');
    const lrow = h('div', 'g-row');
    lrow.append(link, copy);
    right.append(canvas, info, lrow);
    const cols = h('div', 'g-quick g-rand');
    cols.append(left, right);
    const bar = h('div', 'g-quickbar');
    bar.append(button('Назад', () => this.title()), button('На карту!', () => this.onRandom(spec(), { ...o }), 'g-btn main'));
    this.screen(h('h2', 'g-quick-title', 'Случайная карта'), cols, bar);
  }

  private newSide(f: Faction, who: Who, budget: number): SideCfg {
    return { faction: f, hero: { cls: factionClasses(f)[0].id, n: 1 }, who, army: randomArmy(f, budget, Date.now() % 100000) };
  }

  quick(): void {
    let budget = 20000;
    let field = 'auto';
    const sides: [SideCfg, SideCfg] = [this.newSide('zatulye', 'human', budget), this.newSide('zatonye', 'medium', budget)];
    const cols = h('div', 'g-quick');
    const bar = h('div', 'g-quickbar');
    const redraw = (): void => {
      cols.replaceChildren(this.sideEditor(sides[0], 0, budget, redraw), this.sideEditor(sides[1], 1, budget, redraw));
      bar.replaceChildren();
      const bud = h('select', 'g-select');
      for (const b of BUDGETS) bud.append(new Option(`${b} семок`, String(b), false, b === budget));
      bud.onchange = () => {
        budget = Number(bud.value);
        for (const s of sides) s.army = randomArmy(s.faction, budget, Date.now() % 100000);
        redraw();
      };
      const fld = h('select', 'g-select');
      fld.append(new Option('Поле: по первой фракции', 'auto', false, field === 'auto'));
      for (const [id, name] of FIELDS) fld.append(new Option(`Поле: ${name}`, id, false, field === id));
      fld.onchange = () => (field = fld.value);
      bar.append(bud, fld, button('Назад', () => this.title()), button('В бой!', () => {
        if (sides.some((s) => !s.army.length)) return;
        const f = field === 'auto' ? FACTIONS.find((x) => x.id === sides[0].faction)!.field : field;
        const cfg: QuickConfig = {
          who: [sides[0].who, sides[1].who],
          setup: { seed: Date.now() % 2147483647, field: f, sides: [{ hero: sides[0].hero, army: sides[0].army }, { hero: sides[1].hero, army: sides[1].army }] },
        };
        this.last = cfg;
        this.onQuick(cfg);
      }, 'g-btn main'));
    };
    redraw();
    this.screen(h('h2', 'g-quick-title', 'Быстрый бой'), cols, bar);
  }

  /** Та же настройка, новый сид. */
  rematch(): QuickConfig | null {
    if (!this.last) return null;
    this.last = { ...this.last, setup: { ...this.last.setup, seed: Date.now() % 2147483647 } };
    return this.last;
  }

  remember(c: QuickConfig): void {
    this.last = c;
  }

  private sideEditor(s: SideCfg, idx: number, budget: number, redraw: () => void): HTMLElement {
    const col = h('div', `g-panel g-side side${idx}`);
    const top = h('div', 'g-row');
    const fac = h('select', 'g-select');
    for (const f of FACTIONS) fac.append(new Option(f.name, f.id, false, f.id === s.faction));
    fac.onchange = () => {
      s.faction = fac.value as Faction;
      s.hero = { cls: factionClasses(s.faction)[0].id, n: 1 };
      s.army = randomArmy(s.faction, budget, Date.now() % 100000);
      redraw();
    };
    const who = h('select', 'g-select');
    for (const [id, name] of WHO) who.append(new Option(name, id, false, id === s.who));
    who.onchange = () => (s.who = who.value as Who);
    top.append(fac, who);
    col.append(top, h('p', 'dim g-mech', FACTIONS.find((f) => f.id === s.faction)!.mechanic));
    const heroes = h('div', 'g-heroes');
    for (const cls of factionClasses(s.faction)) for (let n = 1; n <= 4; n++) {
      const p = { cls: cls.id, n };
      const b = h('button', `g-heropick${s.hero.cls === cls.id && s.hero.n === n ? ' on' : ''}`);
      const img = h('img');
      img.src = `/geroi/a/heroes/${heroPortrait(p)}.webp`;
      img.alt = heroName(p);
      b.title = `${heroName(p)}, ${cls.name}: атака ${cls.atk}, защита ${cls.def}, магия ${cls.power}, знание ${cls.know}`;
      b.append(img);
      b.onclick = () => {
        s.hero = p;
        redraw();
      };
      heroes.append(b);
    }
    col.append(heroes);
    const cls = factionClasses(s.faction).find((c) => c.id === s.hero.cls)!;
    col.append(h('p', 'g-heroline', `${heroName(s.hero)}, ${cls.name} · А ${cls.atk} · З ${cls.def} · М ${cls.power} · Зн ${cls.know}`));
    const spent = s.army.reduce((sum, a) => sum + CREATURES[a.cre].cost * a.count, 0);
    const money = h('div', `g-money${spent > budget ? ' over' : ''}`, `Семки: ${spent} из ${budget}`);
    col.append(money);
    const list = h('div', 'g-army');
    const all = factionCreatures(s.faction);
    for (let tier = 1; tier <= 7; tier++) {
      const pair = all.filter((c) => c.tier === tier);
      const slot = s.army.find((a) => CREATURES[a.cre].tier === tier);
      const c = slot ? CREATURES[slot.cre] : pair[0];
      const row = h('div', `g-slot${slot ? '' : ' empty'}`);
      const ic = creatureIcon(c.id, 54);
      ic.onclick = () => {
        const { box, close } = modal(this.el, 'g-card');
        box.append(creatureIcon(c.id, 150), h('h3', '', c.name));
        for (const line of creatureLines(c.id)) box.append(h('p', '', line));
        box.append(button('Закрыть', close));
      };
      const name = button(`${c.name}${c.up ? ' ★' : ''}`, () => {
        // сменить на вторую форму: столько же, сколько влезет в те же семки
        const other = pair.find((x) => x.id !== c.id)!;
        if (slot) {
          slot.count = Math.max(1, Math.trunc((slot.count * c.cost) / other.cost));
          slot.cre = other.id;
        } else s.army.push({ cre: c.id, count: 1 });
        redraw();
      }, 'g-link');
      const change = (d: number): void => {
        if (slot) {
          slot.count += d;
          if (slot.count <= 0) s.army.splice(s.army.indexOf(slot), 1);
        } else if (d > 0) s.army.push({ cre: c.id, count: d });
        s.army.sort((a, b) => CREATURES[a.cre].tier - CREATURES[b.cre].tier);
        redraw();
      };
      const step = Math.max(1, Math.round(1000 / c.cost / 2));
      const free = Math.trunc((budget - spent) / c.cost);
      const count = h('b', 'g-count', String(slot?.count ?? 0));
      const plus = button('+', () => change(Math.min(step, Math.max(1, free))), 'g-mini');
      plus.disabled = free < 1;
      row.append(ic, name, button('−', () => change(-step), 'g-mini'), count, plus, h('em', '', `${c.cost}`));
      list.append(row);
    }
    col.append(list, button('Случайная армия', () => {
      s.army = randomArmy(s.faction, budget, Date.now() % 100000);
      redraw();
    }, 'g-btn small'));
    return col;
  }
}

/** Мини-карта для предпросмотра: всё открыто, города — цветом игрока, шахты — жёлтым, стража — красным. */
export function drawPreview(canvas: HTMLCanvasElement, w: World): void {
  canvas.width = w.w;
  canvas.height = w.h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w.w, w.h);
  const put = (c: number, color: number): void => {
    if (c < 0 || c >= w.w * w.h) return;
    img.data[c * 4] = (color >> 16) & 255;
    img.data[c * 4 + 1] = (color >> 8) & 255;
    img.data[c * 4 + 2] = color & 255;
    img.data[c * 4 + 3] = 255;
  };
  const shade = (color: number, k: number): number => (Math.trunc(((color >> 16) & 255) * k) << 16) | (Math.trunc(((color >> 8) & 255) * k) << 8) | Math.trunc((color & 255) * k);
  for (let c = 0; c < w.w * w.h; c++) {
    const base = TERRAINS[w.terrain[c]].color;
    put(c, w.terrain[c] === WATER ? base : w.block[c] ? shade(base, 0.45) : w.road[c] ? 0xb09a68 : base);
  }
  for (const o of w.objects) {
    const color = o.kind === 'stack' ? 0xe04a3a : o.kind.startsWith('mine-') ? 0xf2d04a : o.kind.startsWith('treasury') ? 0xff9a3c : 0xf4ecd8;
    put(o.cell, color);
    if (OBJECTS[o.kind]?.w >= 3) for (const k of o.cells ?? []) put(k, shade(color, 0.7));
  }
  for (const t of w.towns) for (const c of [t.cell, t.cell - 1, t.cell + 1, t.cell - w.w, t.cell - w.w - 1, t.cell - w.w + 1, t.cell - 2 * w.w]) put(c, PLAYER_COLORS[t.owner] ?? 0xc9c2a8);
  ctx.putImageData(img, 0, 0);
}
