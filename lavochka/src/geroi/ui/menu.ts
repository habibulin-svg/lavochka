/* Меню «Героев»: заглавный экран, быстрый бой (фракция, герой, армия по бюджету, кто играет), загрузка. */
import type { Audio2 } from '../audio';
import type { Who } from '../game';
import { type Save, loadSaves, slotLabel } from '../save';
import { type ArmySlot, randomArmy } from '../sim/army';
import type { BattleSetup } from '../sim/battle';
import { CREATURES, FACTIONS, type Faction, factionCreatures } from '../sim/creatures';
import { type HeroPick, factionClasses, heroName, heroPortrait } from '../sim/heroes';
import type { GameSpec } from '../sim/adv/testmap';
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

export class Menu {
  readonly el = h('div', 'g-menu');
  onQuick: (c: QuickConfig) => void = () => {};
  onLoad: (s: Save) => void = () => {};
  onArena: () => void = () => {};
  onMap: (s: GameSpec) => void = () => {};
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
      button('Карта: за одним экраном', () => this.mapSetup()),
      button('Быстрый бой', () => this.quick()),
      button('Загрузить', () => this.load()),
      music,
      button('Во двор', () => (location.href = '/')),
    );
    this.screen(logo, col, h('div', 'g-foot', 'Lavochka Games · ранний доступ: «Арена» и карта за одним экраном'));
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

  /** Партия на карте «Две реки»: двое за одним экраном; боты на карте — этап 5. */
  mapSetup(): void {
    const sides: { faction: Faction; hero: HeroPick; name: string }[] = [
      { faction: 'zatulye', hero: { cls: factionClasses('zatulye')[0].id, n: 1 }, name: 'Первый' },
      { faction: 'zatonye', hero: { cls: factionClasses('zatonye')[0].id, n: 1 }, name: 'Второй' },
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
        row.append(name, fac);
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
      this.onMap({ seed: Date.now() % 2147483647, players: sides.map((s, i) => ({ name: s.name.trim() || `Игрок ${i + 1}`, faction: s.faction as TownFaction, hero: s.hero })) });
    }, 'g-btn main'));
    this.screen(h('h2', 'g-quick-title', 'Карта «Две реки»'), cols, bar);
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
