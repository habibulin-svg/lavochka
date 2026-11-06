/* Экран замка: панорама и слои построек, стройка, найм, гильдия, трактир, механики фракций (DESIGN.md §8.1). HTML поверх канваса. */
import { CREATURES, FACTIONS, factionCreatures } from '../sim/creatures';
import { classOf, heroName, heroPortrait } from '../sim/heroes';
import { SPELLS, spellIcon } from '../sim/spells';
import { slotRank, RANK_XP } from '../sim/adv/hero';
import {
  BANYA_MP, BRANCHES, BUILDINGS, type BuildingDef, DECREES, LOAN, MEMORY_WEEK_CAP, NAPOR_COST, NAPOR_MAX, RELEASES, RESEARCH_AMBER, RESEARCH_DAYS, SPIRIT_DAYS, type Town, bindCost, buildCost, canUpgrade, creaturePrice, forgePerDay,
  guildLevel, has, hallIncome, isCast, mercPrice, naporPerDay, summonCost, weeklyGrowth,
} from '../sim/adv/town';
import { type AdvAction, type ArmyRef, HERO_COST, type World, actionError, heroAt, mercLeft, mercSeen, repairCost } from '../sim/adv/world';
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
/** Панорам второй четвёрки ещё нет: земля по середине, пока не снята своя. */
const GROUND_DEFAULT: [number, number] = [480, 720];
/** Дальние ряды мельче. */
const ROW_SCALE = [0.62, 0.8, 1];
const UNIQ: Record<string, string> = {
  skhod: 'uniq1', fogwell: 'uniq1', gat: 'uniq2', furnace: 'uniq1', scrapyard: 'uniq2', lab: 'uniq1', observatory: 'uniq2',
  dam: 'uniq1', turbine: 'uniq2', drill: 'uniq1', banya: 'uniq2', caravanserai: 'uniq1', bank: 'uniq2', memory: 'uniq1', bindstone: 'uniq2',
};

/** Картинки экрана замка: панорама и все построенные — грузим до показа. */
export function townArt(t: Town): string[] {
  const arts = new Set<string>();
  for (const id of t.built) {
    const d = BUILDINGS[t.faction][id];
    if (d) arts.add(d.art);
  }
  return [`/geroi/a/towns/${t.faction}-site.webp`, ...[...arts].map((a) => `/geroi/a/towns/${t.faction}-${a}.webp`)];
}

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
    const [top, low] = GROUND[t.faction] ?? GROUND_DEFAULT;
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
    if (has(t, 'dam')) items.push([`Плотина: напор ${t.napor ?? 0}/${NAPOR_MAX}${(t.napor ?? 0) >= NAPOR_COST ? '!' : ''}`, () => this.dam()]);
    if (t.faction === 'ostrog') items.push(['Муштра', () => this.drill()]);
    if (has(t, 'caravanserai')) items.push(['Караван-сарай', () => this.merc()]);
    if (has(t, 'bank')) items.push([p.loan ? `Контора: долг ${p.loan.left} нед.` : 'Меняльная контора', () => this.bank()]);
    if (has(t, 'memory')) items.push([`Круг памяти: ${p.memory ?? 0}`, () => this.memory()]);
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
      case 'dam':
      case 'turbine':
        return this.dam();
      case 'drill':
      case 'banya':
        return this.drill();
      case 'caravanserai':
        return this.merc();
      case 'bank':
        return this.bank();
      case 'memory':
      case 'bindstone':
        return this.memory();
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

  /** Плотина: напор и три сброса. */
  private dam(): void {
    const { box, close } = modal(this.overlay, 'g-card', () => this.draw());
    const draw = (): void => {
      const t = this.town;
      const w = this.world();
      box.replaceChildren(
        h('h3', '', 'Плотина'),
        h('p', 'dim', `Напор копится каждый день: +${naporPerDay(t)}${has(t, 'turbine') ? ' (с турбиной)' : ''}, не больше ${NAPOR_MAX}. Сброс стоит ${NAPOR_COST}.`),
        h('p', 'g-heroline', `Напор: ${'▮'.repeat(t.napor ?? 0)}${'▯'.repeat(NAPOR_MAX - (t.napor ?? 0))} ${t.napor ?? 0}/${NAPOR_MAX}`),
      );
      for (const use of ['semki', 'mp', 'build'] as const) {
        const a: AdvAction = { t: 'release', town: t.id, use };
        const err = actionError(w, a);
        const b = button(`${RELEASES[use].name}: ${RELEASES[use].text}`, () => {
          this.act(a);
          draw();
        });
        b.disabled = !!err;
        b.title = err ?? '';
        box.append(b);
      }
      box.append(button('Закрыть', close));
    };
    draw();
  }

  /** Острог: ранги отрядов и что даёт плац и баня. */
  private drill(): void {
    const { box, close } = modal(this.overlay, 'g-card', () => this.draw());
    const t = this.town;
    const w = this.world();
    box.append(
      h('h3', '', 'Муштра'),
      h('p', 'dim', `Отряд Острога, выживший в победном бою, получает опыт. Ранги по опыту ${RANK_XP.join(' / ')}: +1 к атаке и защите за ранг. Разбитый отряд опыт теряет, при слиянии — остаётся меньший.`),
      h('p', 'dim', has(t, 'drill') ? 'Плац: каждую неделю гарнизону +1 опыта.' : 'Плац не построен: гарнизон опыта не получает.'),
      h('p', 'dim', has(t, 'banya') ? `Баня: герой, начавший день в городе, +${BANYA_MP} к ходу.` : 'Бани нет.'),
    );
    const hero = heroAt(w, t.cell);
    const armies: [string, typeof t.garrison][] = [['Гарнизон', t.garrison]];
    if (hero && hero.owner === t.owner) armies.push([heroName(hero.pick), hero.army]);
    let any = false;
    for (const [label, army] of armies) {
      for (const s of army) {
        if (!s || CREATURES[s.cre].faction !== 'ostrog') continue;
        any = true;
        const row = h('div', 'a-row');
        const r = slotRank(s);
        const next = RANK_XP[r];
        row.append(creatureIcon(s.cre, 44), h('span', '', `${label}: ${CREATURES[s.cre].name} — ранг ${r}, опыт ${s.xp ?? 0}${next !== undefined ? ` (до следующего ${next})` : ' (высший)'}`));
        box.append(row);
      }
    }
    if (!any) box.append(h('p', '', 'Отрядов Острога рядом нет.'));
    box.append(button('Закрыть', close));
  }

  /** Караван-сарай: чужие базовые существа тех фракций, чьи города видели. */
  private merc(): void {
    const { box, close } = modal(this.overlay, 'a-recruit', () => this.draw());
    const draw = (): void => {
      const t = this.town;
      const w = this.world();
      const p = w.players[t.owner];
      box.replaceChildren(h('h3', '', 'Караван-сарай'), h('p', 'dim', 'Чужие бойцы из городов, которые вы видели. Дороже на четверть, в неделю — половина их прироста.'));
      const list = h('div', 'a-recruit-list');
      const seen = FACTIONS.filter((f) => f.id !== 'neutral' && f.id !== t.faction && mercSeen(w, t.owner, f.id));
      for (const f of seen) {
        for (const c of factionCreatures(f.id).filter((x) => !x.up).sort((a, b) => a.tier - b.tier)) {
          const left = mercLeft(t, c.id);
          const row = h('div', 'a-recruit-row');
          const info = h('div');
          info.append(h('b', '', `${c.name} · ${f.name}`), h('p', 'dim', `Есть: ${left}`), priceRow(mercPrice(c, 1), p));
          const r = h('input');
          r.type = 'range';
          r.min = '1';
          r.max = String(Math.max(1, left));
          r.value = String(Math.max(1, left));
          const n = h('b', 'a-count', r.value);
          const go = button('Нанять', () => {
            this.act({ t: 'merc', town: t.id, cre: c.id, count: Number(r.value) });
            draw();
          }, 'g-btn small');
          const check = (): void => {
            n.textContent = r.value;
            go.disabled = left < 1 || !!actionError(w, { t: 'merc', town: t.id, cre: c.id, count: Number(r.value) });
          };
          r.oninput = check;
          check();
          row.append(creatureIcon(c.id, 88), info, r, n, go);
          list.append(row);
        }
      }
      if (!seen.length) list.append(h('p', 'dim', 'Чужих городов вы пока не видели: разведайте карту.'));
      box.append(list, button('Закрыть', close));
    };
    draw();
  }

  /** Меняльная контора: кредит. */
  private bank(): void {
    const { box, close } = modal(this.overlay, 'g-card', () => this.draw());
    const t = this.town;
    const w = this.world();
    const p = w.players[t.owner];
    box.append(
      h('h3', '', 'Меняльная контора'),
      h('p', 'dim', `Кредит: ${LOAN.sum} семок сейчас, потом ${LOAN.weeks} недели по ${LOAN.pay} в начале недели. Не хватит семок на взнос — бунт: сильнейший отряд гарнизона разбежится наполовину.`),
    );
    if (p.loan) box.append(h('p', 'g-heroline', `Долг: ещё ${p.loan.left} взнос(а) по ${LOAN.pay}.`));
    const a: AdvAction = { t: 'loan', town: t.id };
    const err = actionError(w, a);
    const b = button(`Взять ${LOAN.sum} семок`, () => {
      close();
      this.act(a);
      this.draw();
    });
    b.disabled = !!err;
    b.title = err ?? '';
    box.append(b, button('Закрыть', close));
  }

  /** Круг памяти и камень привязки. */
  private memory(): void {
    const { box, close } = modal(this.overlay, 'a-recruit', () => this.draw());
    const draw = (): void => {
      const t = this.town;
      const w = this.world();
      const p = w.players[t.owner];
      const mem = p.memory ?? 0;
      box.replaceChildren(
        h('h3', '', 'Круг памяти'),
        h('p', 'dim', `Память копится после боёв с героем Курганов: павшие обеих сторон. За неделю — не больше ${MEMORY_WEEK_CAP} (набрано ${p.memWeek ?? 0}). Дух стоит половину своей цены в памяти и уходит через ${SPIRIT_DAYS} дней.`),
        h('p', 'g-heroline', `Память: ${mem}`),
      );
      const list = h('div', 'a-recruit-list');
      for (const c of factionCreatures(t.faction).filter((x) => !x.up && has(t, `dwell${x.tier}`)).sort((a, b) => a.tier - b.tier)) {
        const most = Math.trunc(mem / summonCost(c, 1));
        const row = h('div', 'a-recruit-row');
        const info = h('div');
        info.append(h('b', '', c.name), h('p', 'dim', `Память за одного: ${summonCost(c, 1)} · хватит на ${most}`));
        const r = h('input');
        r.type = 'range';
        r.min = '1';
        r.max = String(Math.max(1, most));
        r.value = String(Math.max(1, most));
        const n = h('b', 'a-count', r.value);
        const go = button('Призвать', () => {
          this.act({ t: 'summon', town: t.id, cre: c.id, count: Number(r.value) });
          draw();
        }, 'g-btn small');
        const check = (): void => {
          n.textContent = r.value;
          go.disabled = most < 1 || !!actionError(w, { t: 'summon', town: t.id, cre: c.id, count: Number(r.value) });
        };
        r.oninput = check;
        check();
        row.append(creatureIcon(c.id, 88), info, r, n, go);
        list.append(row);
      }
      if (!list.children.length) list.append(h('p', 'dim', 'Призывать можно тех, чьё жилище построено.'));
      box.append(list);
      // духи в гарнизоне и у героя в воротах: привязка
      const hero = heroAt(w, t.cell);
      const refs: [ArmyRef, typeof t.garrison, string][] = [[{ t: t.id }, t.garrison, 'Гарнизон']];
      if (hero && hero.owner === t.owner) refs.push([{ h: hero.id }, hero.army, heroName(hero.pick)]);
      const spirits = h('div');
      for (const [ref, army, label] of refs) {
        army.forEach((s, slot) => {
          if (!s || s.until === undefined) return;
          const row = h('div', 'a-row');
          const a: AdvAction = { t: 'bind', town: t.id, ref, slot };
          const err = actionError(w, a);
          const b = button(`Привязать: ${bindCost(CREATURES[s.cre], s.count)} янтаря`, () => {
            this.act(a);
            draw();
          }, 'g-btn small');
          b.disabled = !!err;
          b.title = err ?? '';
          row.append(creatureIcon(s.cre, 44), h('span', '', `${label}: ${CREATURES[s.cre].name}, ${s.count} — уйдут через ${s.until - w.day} дн.`));
          if (has(t, 'bindstone')) row.append(b);
          spirits.append(row);
        });
      }
      if (spirits.children.length) box.append(h('b', '', has(t, 'bindstone') ? 'Духи рядом — камень привязки оставит их навсегда' : 'Духи рядом (привязать — камень привязки)'), spirits);
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
