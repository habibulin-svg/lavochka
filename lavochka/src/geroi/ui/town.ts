/* Экран замка: панорама и слои построек, стройка, найм, гильдия, трактир, механики фракций (DESIGN.md §8.1). HTML поверх канваса. */
import { CREATURES, FACTIONS, factionCreatures } from '../sim/creatures';
import { classOf, heroName, heroPortrait } from '../sim/heroes';
import { SPELLS, spellIcon } from '../sim/spells';
import { BRANCHES, BUILDINGS, type BuildingDef, DECREES, RESEARCH_AMBER, RESEARCH_DAYS, type Town, buildCost, canUpgrade, creaturePrice, forgePerDay, guildLevel, has, hallIncome, isCast, weeklyGrowth } from '../sim/adv/town';
import { type AdvAction, HERO_COST, type World, actionError, heroAt, repairCost } from '../sim/adv/world';
import { type Act, ArmyPicker, heroSheet, icon, marketDialog, priceRow, resBar } from './advparts';
import { button, creatureIcon, h, modal } from './common';

/** Постройка на панораме 1920×1080: ряд (0 — дальний), x, ширина в ближнем ряду. Правый край занят панелью замка. */
const LAYOUT: Record<string, [number, number, number]> = {
  guild: [0, 240, 240], dwell7: [0, 540, 280], dwell6: [0, 830, 270], fort: [0, 1160, 400], dwell5: [0, 1480, 250],
  storehouse: [1, 130, 230], dwell4: [1, 400, 250], hall: [1, 760, 350], tavern: [1, 1090, 250], market: [1, 1340, 260], uniq2: [1, 1560, 240],
  shipyard: [2, 130, 240], dwell1: [2, 400, 250], dwell2: [2, 680, 250], uniq1: [2, 960, 260], smithy: [2, 1230, 240], dwell3: [2, 1500, 260],
};
/** Где на панораме ровная земля: верх и низ; у каждого замка своя. */
const GROUND: Record<string, [number, number]> = { zatulye: [430, 670], zatonye: [440, 665], kuznya: [490, 730], akademiya: [590, 860] };
/** Дальние ряды мельче. */
const ROW_SCALE = [0.62, 0.8, 1];
const UNIQ: Record<string, string> = { skhod: 'uniq1', fogwell: 'uniq1', gat: 'uniq2', furnace: 'uniq1', scrapyard: 'uniq2', lab: 'uniq1', observatory: 'uniq2' };

export class TownScreen {
  readonly el = h('div', 'a-town');
  private scene = h('div', 'a-town-scene');
  private res = h('div', 'a-resbar');
  private bottom = h('div', 'a-town-bottom');
  private side = h('div', 'a-town-side');
  private pick: ArmyPicker;
  private overlay = h('div', 'g-overlayhost');

  constructor(
    host: HTMLElement,
    private readonly world: () => World,
    private readonly townId: number,
    private readonly act: Act,
    private readonly close: () => void,
  ) {
    this.pick = new ArmyPicker(this.overlay, act, world, () => this.draw());
    this.el.append(this.scene, this.res, this.side, this.bottom, this.overlay);
    host.append(this.el);
    this.draw();
  }

  private get town(): Town {
    return this.world().towns.find((t) => t.id === this.townId)!;
  }

  /** Открыто ли окно поверх замка: Esc сперва закрывает его. */
  closeTop(): boolean {
    const open = this.overlay.querySelector('.g-modal');
    if (!open) return false;
    open.dispatchEvent(new PointerEvent('pointerdown', { bubbles: false }));
    return true;
  }

  draw(): void {
    const t = this.town;
    const w = this.world();
    const p = w.players[t.owner >= 0 ? t.owner : w.current];
    this.scene.style.backgroundImage = `url(/geroi/a/towns/${t.faction}-site.webp)`;
    this.scene.replaceChildren();
    const arts = new Map<string, BuildingDef>();
    for (const id of t.built) {
      const d = BUILDINGS[t.faction][id];
      if (d) arts.set(d.art, d);
    }
    const [top, low] = GROUND[t.faction];
    const layers = [...arts.entries()].map(([art, d]) => ({ art, d, pos: LAYOUT[UNIQ[art] ?? art] })).filter((x) => x.pos).sort((a, b) => a.pos[0] - b.pos[0]);
    for (const { art, d, pos } of layers) {
      const [row, x, size] = pos;
      const width = size * ROW_SCALE[row];
      const img = h('img', 'a-bld');
      img.src = `/geroi/a/towns/${t.faction}-${art}.webp`;
      img.alt = d.name;
      img.title = d.name;
      img.style.left = `${x - width / 2}px`;
      img.style.bottom = `${1080 - (top + ((low - top) * row) / 2)}px`;
      img.style.width = `${width}px`;
      img.onclick = () => this.openBuilding(art);
      this.scene.append(img);
    }
    resBar(this.res, p);
    this.side.replaceChildren();
    const fac = FACTIONS.find((f) => f.id === t.faction)!;
    this.side.append(h('h2', '', t.name), h('p', 'dim', `${fac.name} · +${hallIncome(t)} семок в день`));
    const items: [string, () => void, boolean?][] = [
      ['Стройка', () => this.buildList()],
      ['Найм', () => this.recruit()],
      ['Гильдия магов', () => this.guild(), guildLevel(t) === 0],
      ['Рынок', () => this.market(), !has(t, 'market')],
      ['Трактир', () => this.tavern(), !has(t, 'tavern')],
    ];
    if (has(t, 'skhod')) items.push([t.decrees.length ? 'Сход: выбрать указ!' : 'Сход', () => this.skhod()]);
    if (has(t, 'lab')) items.push(['Опыты', () => this.lab()]);
    if (has(t, 'scrapyard')) items.push(['Ремонтный двор', () => this.scrap()]);
    if (has(t, 'shipyard')) items.push(['Лодка', () => this.boat()]);
    for (const [label, fn, off] of items) {
      const b = button(label, fn, 'g-btn small');
      b.disabled = !!off;
      this.side.append(b);
    }
    this.side.append(button('На карту', this.close, 'g-btn main'));
    this.bottom.replaceChildren(this.pick.row({ t: t.id }, t.garrison, 'Гарнизон'));
    const hero = heroAt(w, t.cell);
    if (hero && hero.owner === t.owner) {
      const row = this.pick.row({ h: hero.id }, hero.army, heroName(hero.pick));
      const face = h('img', 'a-portrait small');
      face.src = `/geroi/a/heroes/${heroPortrait(hero.pick)}.webp`;
      face.alt = '';
      face.title = 'Лист героя';
      face.onclick = () => heroSheet(this.overlay, this.world, hero.id, this.act, () => this.draw());
      row.prepend(face);
      this.bottom.append(row);
    }
    const sel = this.pick.sel;
    if (sel) {
      const army = 'h' in sel.ref ? hero?.army : t.garrison;
      const s = army?.[sel.slot];
      const up = s && canUpgrade(t, s.cre);
      if (s && up) {
        const a: AdvAction = { t: 'upgrade', town: t.id, ref: sel.ref, slot: sel.slot };
        const b = button(`Улучшить в «${up.name}»: ${(up.cost - CREATURES[s.cre].cost) * s.count} семок`, () => {
          this.pick.sel = null;
          this.act(a);
          this.draw();
        }, 'g-btn small');
        b.disabled = !!actionError(w, a);
        this.bottom.append(b);
      }
    }
    this.bottom.append(h('p', 'a-hintline dim', 'Щёлк по отряду, потом по другому месту — переложить. С Shift — разделить. Правая кнопка — сведения.'));
  }

  private openBuilding(art: string): void {
    if (art.startsWith('dwell')) return this.recruit();
    switch (art) {
      case 'hall':
      case 'fort':
        return this.buildList();
      case 'tavern':
        return this.tavern();
      case 'market':
        return this.market();
      case 'guild':
        return this.guild();
      case 'skhod':
        return this.skhod();
      case 'lab':
        return this.lab();
      case 'scrapyard':
        return this.scrap();
      case 'shipyard':
        return this.boat();
    }
  }

  private buildList(): void {
    const { box, close } = modal(this.overlay, 'a-build', () => this.draw());
    const t = this.town;
    const w = this.world();
    const p = w.players[t.owner];
    box.append(h('h3', '', `Стройка: ${t.name}`));
    if (t.builtToday) box.append(h('p', 'dim', 'Сегодня уже строили: следующая постройка — завтра.'));
    if (t.discount) box.append(h('p', 'dim', `Скидка схода на следующую постройку: ${t.discount} %.`));
    const grid = h('div', 'a-build-grid');
    const all = Object.values(BUILDINGS[t.faction]).filter((d) => !has(t, d.id));
    const rank = (d: BuildingDef): number => (actionError(w, { t: 'build', town: t.id, b: d.id }) ? 1 : 0);
    all.sort((a, b) => rank(a) - rank(b));
    for (const d of all) {
      const err = actionError(w, { t: 'build', town: t.id, b: d.id });
      const card = h('div', `a-build-card${err ? ' off' : ''}`);
      const img = h('img');
      img.src = `/geroi/a/towns/${t.faction}-${d.art}.webp`;
      img.alt = '';
      const text = h('div');
      text.append(h('b', '', d.name), h('p', 'dim', d.text), priceRow(buildCost(t, d.id), p));
      if (err && err !== 'Не хватает ресурсов') text.append(h('p', 'a-why', err));
      const go = button('Строить', () => {
        close();
        this.act({ t: 'build', town: t.id, b: d.id });
        this.draw();
      }, 'g-btn small');
      go.disabled = !!err;
      card.append(img, text, go);
      grid.append(card);
    }
    box.append(grid, button('Закрыть', close));
  }

  private recruit(): void {
    const { box, close } = modal(this.overlay, 'a-recruit', () => this.draw());
    const draw = (): void => {
      const t = this.town;
      const w = this.world();
      const p = w.players[t.owner];
      box.replaceChildren(h('h3', '', `Найм: ${t.name}`));
      if (t.faction === 'kuznya') box.append(h('p', 'dim', `Плавка: механизмы отливают за камень и железо. Запас ${t.forge} семок силы, в день +${forgePerDay(t)}.`));
      const list = h('div', 'a-recruit-list');
      for (const c of factionCreatures(t.faction).sort((a, b) => a.tier - b.tier || Number(a.up) - Number(b.up))) {
        if (!has(t, c.up ? `up${c.tier}` : `dwell${c.tier}`)) continue;
        const cast = isCast(c);
        const avail = cast ? Math.trunc(t.forge / c.cost) : t.avail[c.tier - 1];
        const row = h('div', 'a-recruit-row');
        const info = h('div');
        info.append(h('b', '', c.name), h('p', 'dim', cast ? `Можно отлить: ${avail}` : `Есть: ${avail} · в неделю +${weeklyGrowth(t, c.tier)}`), priceRow(creaturePrice(c, 1), p));
        const r = h('input');
        r.type = 'range';
        r.min = '1';
        r.max = String(Math.max(1, avail));
        r.value = '1';
        const n = h('b', 'a-count', '1');
        const go = button('Нанять', () => {
          this.act({ t: 'recruit', town: t.id, cre: c.id, count: Number(r.value) });
          draw();
        }, 'g-btn small');
        const check = (): void => {
          n.textContent = r.value;
          go.disabled = avail < 1 || !!actionError(w, { t: 'recruit', town: t.id, cre: c.id, count: Number(r.value) });
        };
        r.oninput = check;
        check();
        row.append(creatureIcon(c.id, 88), info, r, n, go);
        list.append(row);
      }
      if (!list.children.length) list.append(h('p', 'dim', 'Жилищ ещё нет: построй их в разделе «Стройка».'));
      box.append(list, button('Закрыть', close));
    };
    draw();
  }

  private guild(): void {
    const { box, close } = modal(this.overlay, 'g-card', () => this.draw());
    const t = this.town;
    box.append(h('h3', '', 'Гильдия магов'));
    box.append(h('p', 'dim', t.faction === 'akademiya' ? 'Заклинания появляются из опытов. Герой выучит их, зайдя в замок.' : 'Герой выучит всё, что знает гильдия, зайдя в замок. 3-й круг — только с Мудростью.'));
    const lv = guildLevel(t);
    let any = false;
    for (let i = 0; i < lv; i++) {
      for (const sp of t.guild[i]) {
        any = true;
        const d = SPELLS[sp];
        const row = h('div', 'a-row');
        row.append(icon(spellIcon(d), 44), h('span', '', `${i + 1}-й круг · ${d.name}: ${d.text}`));
        box.append(row);
      }
    }
    if (!any) box.append(h('p', '', 'Пока пусто.'));
    box.append(button('Закрыть', close));
  }

  private market(): void {
    marketDialog(this.overlay, this.world, this.act, undefined, () => this.draw());
  }

  private tavern(): void {
    const { box, close } = modal(this.overlay, 'g-card', () => this.draw());
    const t = this.town;
    const w = this.world();
    box.append(h('h3', '', 'Трактир'), h('p', 'dim', `Герой стоит ${HERO_COST} семок и приходит с младшими отрядами своей фракции.`));
    for (const pick of t.tavern) {
      const row = h('div', 'a-row');
      const img = h('img', 'a-portrait small');
      img.src = `/geroi/a/heroes/${heroPortrait(pick)}.webp`;
      img.alt = '';
      const a: AdvAction = { t: 'tavern', town: t.id, hero: null, pick };
      const b = button('Нанять', () => {
        close();
        this.act(a);
        this.draw();
      }, 'g-btn small');
      const err = actionError(w, a);
      b.disabled = !!err;
      b.title = err ?? '';
      row.append(img, h('span', '', `${heroName(pick)}, ${classOf(pick.cls).name}`), b);
      box.append(row);
    }
    if (!t.tavern.length) box.append(h('p', '', 'Сегодня никого: новые придут в начале недели.'));
    box.append(button('Закрыть', close));
  }

  private skhod(): void {
    const { box, close } = modal(this.overlay, 'g-card', () => this.draw());
    const t = this.town;
    box.append(h('h3', '', 'Сход'));
    if (!t.decrees.length) box.append(h('p', '', 'Указ этой недели уже выбран. Следующий сход — через неделю.'));
    for (const id of t.decrees) {
      const d = DECREES[id];
      box.append(button(`${d.name}: ${d.text}`, () => {
        close();
        this.act({ t: 'decree', town: t.id, id });
        this.draw();
      }));
    }
    box.append(button('Закрыть', close));
  }

  private lab(): void {
    const { box, close } = modal(this.overlay, 'g-card', () => this.draw());
    const t = this.town;
    const w = this.world();
    const NAME: Record<string, string> = { fire: 'Огонь', water: 'Вода', earth: 'Земля', air: 'Воздух' };
    box.append(h('h3', '', 'Опыты'), h('p', 'dim', `Выбери школу: следующее заклинание ветки за ${RESEARCH_AMBER} янтаря и ${RESEARCH_DAYS} дня.`));
    if (t.research) box.append(h('p', 'g-heroline', `Идёт опыт, школа «${NAME[t.research.school]}»: осталось дней ${t.research.left}.`));
    for (const school of Object.keys(BRANCHES)) {
      const next = BRANCHES[school][t.studied[school] ?? 0];
      const a: AdvAction = { t: 'research', town: t.id, school };
      const b = button(next ? `${NAME[school]}: ${SPELLS[next].name}` : `${NAME[school]}: ветка изучена`, () => {
        close();
        this.act(a);
        this.draw();
      });
      b.disabled = !!actionError(w, a);
      box.append(b);
    }
    box.append(button('Закрыть', close));
  }

  private scrap(): void {
    const { box, close } = modal(this.overlay, 'g-card', () => this.draw());
    const draw = (): void => {
      const t = this.town;
      const w = this.world();
      const p = w.players[t.owner];
      box.replaceChildren(h('h3', '', 'Ремонтный двор'), h('p', 'dim', 'Половина разбитых механизмов остаётся ломом. Здесь их чинят за полцены.'));
      let any = false;
      for (const [cre, n] of Object.entries(p.scrap)) {
        if (n <= 0) continue;
        any = true;
        const row = h('div', 'a-row');
        const a: AdvAction = { t: 'repair', town: t.id, cre, count: n };
        const b = button(`Починить всех: ${n}`, () => {
          this.act(a);
          draw();
        }, 'g-btn small');
        b.disabled = !!actionError(w, a);
        row.append(creatureIcon(cre, 56), h('span', '', CREATURES[cre].name), priceRow(repairCost(cre, n), p), b);
        box.append(row);
      }
      if (!any) box.append(h('p', '', 'Лома нет.'));
      box.append(button('Закрыть', close));
    };
    draw();
  }

  private boat(): void {
    const { box, close } = modal(this.overlay, 'g-card', () => this.draw());
    const a: AdvAction = { t: 'townBoat', town: this.townId };
    const err = actionError(this.world(), a);
    box.append(h('h3', '', 'Верфь'), h('p', '', 'Лодка: 1000 семок и 10 леса. Появится на ближайшей воде.'));
    if (err) box.append(h('p', 'a-why', err));
    const b = button('Купить лодку', () => {
      close();
      this.act(a);
      this.draw();
    });
    b.disabled = !!err;
    box.append(b, button('Закрыть', close));
  }

  destroy(): void {
    this.el.remove();
  }
}
