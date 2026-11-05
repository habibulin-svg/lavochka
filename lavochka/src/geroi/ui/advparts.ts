/* Части окон карты приключений: цены, ряд отрядов, лист героя, рынок. Логика — только через act() мира. */
import { CREATURES } from '../sim/creatures';
import { classOf, heroName, heroPortrait } from '../sim/heroes';
import { spellIcon, SPELLS } from '../sim/spells';
import { type Purse, RES, RES_NAME, type ResId } from '../sim/adv/data';
import { type AdvHero, ART_SLOTS, ARTIFACTS, type Army, SKILL, slotRank, heroAtk, heroDef, heroKnow, heroLuck, heroMaxMana, heroMaxMp, heroMorale, heroPower, xpForLevel } from '../sim/adv/hero';
import { marketRate } from '../sim/adv/town';
import { type AdvAction, type ArmyRef, type Player, type World, actionError } from '../sim/adv/world';
import { button, creatureIcon, creatureLines, h, modal } from './common';

export type Act = (a: AdvAction) => void;

export const icon = (name: string, size = 24): HTMLImageElement => {
  const i = h('img', 'a-icon');
  i.src = `/geroi/a/icons/${name}.webp`;
  i.width = i.height = size;
  i.alt = '';
  return i;
};

/** Цена значками: чего не хватает — красным. */
export function priceRow(cost: Purse, p?: Player): HTMLElement {
  const row = h('span', 'a-price');
  for (const r of RES) {
    const v = cost[r];
    if (!v) continue;
    const c = h('span', p && p.res[r] < v ? 'lack' : '');
    c.title = RES_NAME[r];
    c.append(icon(`icon-${r}`, 22), String(v));
    row.append(c);
  }
  if (!row.children.length) row.textContent = 'даром';
  return row;
}

/** Строка ресурсов игрока. */
export function resBar(el: HTMLElement, p: Player): void {
  el.replaceChildren();
  for (const r of RES) {
    const c = h('span');
    c.title = RES_NAME[r];
    c.append(icon(`icon-${r}`, 28), String(p.res[r]));
    el.append(c);
  }
}

/** Ряд из семи слотов: щёлк — выбрать, второй щёлк по другому — переложить, правая кнопка — сведения. Выбор общий на окно. */
export class ArmyPicker {
  sel: { ref: ArmyRef; slot: number } | null = null;
  constructor(private readonly host: HTMLElement, private readonly act: Act, private readonly world: () => World, private readonly redraw: () => void) {}

  row(ref: ArmyRef, army: Army, label: string): HTMLElement {
    const row = h('div', 'a-army');
    row.append(h('b', 'a-army-label', label));
    army.forEach((s, i) => {
      const on = this.sel && JSON.stringify(this.sel.ref) === JSON.stringify(ref) && this.sel.slot === i;
      const cell = h('button', `a-slot${on ? ' on' : ''}${s ? '' : ' empty'}`);
      if (s) {
        cell.append(creatureIcon(s.cre, 72), h('em', '', String(s.count)));
        cell.title = CREATURES[s.cre].name;
        const rank = slotRank(s);
        if (rank) {
          cell.append(h('i', '', `★${rank}`));
          cell.title += ` · ранг ${rank}, опыт ${s.xp}`;
        }
        if (s.until !== undefined) {
          const left = s.until - this.world().day;
          cell.append(h('i', 'spirit', `${left} дн.`));
          cell.title += ` · дух, уйдёт через ${left} дн.`;
        }
      }
      cell.onclick = (e) => this.click(ref, i, e.shiftKey);
      cell.oncontextmenu = (e) => {
        e.preventDefault();
        if (s) this.info(s.cre);
      };
      row.append(cell);
    });
    return row;
  }

  private click(ref: ArmyRef, slot: number, split: boolean): void {
    const sel = this.sel;
    if (!sel) {
      if (this.armyOf(ref)?.[slot]) {
        this.sel = { ref, slot };
        this.redraw();
      }
      return;
    }
    this.sel = null;
    if (JSON.stringify(sel.ref) === JSON.stringify(ref) && sel.slot === slot) return this.redraw();
    const from = this.armyOf(sel.ref)?.[sel.slot];
    const to = this.armyOf(ref)?.[slot];
    if (from && split && (!to || to.cre === from.cre) && from.count > 1) {
      this.askSplit(sel.ref, sel.slot, ref, slot, from.count);
      return;
    }
    this.send({ t: 'transfer', from: sel.ref, fromSlot: sel.slot, to: ref, toSlot: slot });
  }

  private send(a: AdvAction): void {
    const err = actionError(this.world(), a);
    if (err) this.note(err);
    else this.act(a);
    this.redraw();
  }

  private armyOf(r: ArmyRef): Army | undefined {
    const w = this.world();
    if ('h' in r) return w.heroes.find((x) => x.id === r.h)?.army;
    if ('t' in r) return w.towns.find((x) => x.id === r.t)?.garrison;
    return w.objects.find((x) => x.id === r.o)?.army;
  }

  private askSplit(from: ArmyRef, fromSlot: number, to: ArmyRef, toSlot: number, max: number): void {
    const { box, close } = modal(this.host, 'g-card');
    const r = h('input');
    r.type = 'range';
    r.min = '1';
    r.max = String(max);
    r.value = String(max >> 1 || 1);
    const label = h('b', '', r.value);
    r.oninput = () => (label.textContent = r.value);
    box.append(h('h3', '', 'Разделить отряд'), r, label, button('Отделить', () => {
      close();
      this.send({ t: 'transfer', from, fromSlot, to, toSlot, count: Number(r.value) });
    }), button('Отмена', () => {
      close();
      this.redraw();
    }));
  }

  private note(text: string): void {
    const { box, close } = modal(this.host, 'g-card');
    box.append(h('p', '', text), button('Понятно', close));
  }

  private info(cre: string): void {
    const { box, close } = modal(this.host, 'g-card');
    box.append(creatureIcon(cre, 150), h('h3', '', CREATURES[cre].name));
    for (const line of creatureLines(cre)) box.append(h('p', '', line));
    box.append(button('Закрыть', close));
  }
}

export const portrait = (x: AdvHero, size: number): HTMLImageElement => {
  const i = h('img', 'a-portrait');
  i.src = `/geroi/a/heroes/${heroPortrait(x.pick)}.webp`;
  i.width = size;
  i.height = size;
  i.alt = heroName(x.pick);
  return i;
};

/** Лист героя: цифры, навыки, армия, вещи, книга. */
export function heroSheet(host: HTMLElement, world: () => World, id: number, act: Act, onClose: () => void): void {
  const { box, close } = modal(host, 'a-sheet', onClose);
  const pick = new ArmyPicker(box, act, world, () => draw());
  const draw = (): void => {
    const x = world().heroes.find((v) => v.id === id);
    box.replaceChildren();
    if (!x) {
      close();
      return;
    }
    const top = h('div', 'a-sheet-top');
    const info = h('div');
    const cls = classOf(x.pick.cls);
    info.append(h('h2', '', heroName(x.pick)), h('p', 'dim', `${cls.name}, ${x.level}-й уровень · опыт ${x.xp} из ${xpForLevel(x.level + 1)}`));
    const stats = h('div', 'a-stats');
    for (const [ic, label, v] of [['stat-01', 'Атака', heroAtk(x)], ['stat-02', 'Защита', heroDef(x)], ['stat-03', 'Сила магии', heroPower(x)], ['stat-04', 'Знание', heroKnow(x)], ['stat-05', 'Мораль', heroMorale(x)], ['stat-06', 'Удача', heroLuck(x)], ['stat-07', 'Ход', `${x.mp}/${heroMaxMp(x)}`], ['stat-09', 'Мана', `${x.mana}/${heroMaxMana(x)}`]] as [string, string, number | string][]) {
      const c = h('span');
      c.title = label;
      c.append(icon(ic, 34), h('b', '', String(v)));
      stats.append(c);
    }
    info.append(stats);
    top.append(portrait(x, 170), info);
    box.append(top);
    const skills = h('div', 'a-skills');
    for (const s of x.skills) {
      const d = SKILL[s.id];
      const c = h('span');
      c.title = `${d.name}, ${s.lv}-я ступень: ${d.text(d.levels[s.lv - 1])}`;
      c.append(icon(`skill-${String(d.icon).padStart(2, '0')}`, 48), h('em', '', String(s.lv)));
      skills.append(c);
    }
    box.append(h('h3', '', 'Навыки'), skills);
    box.append(pick.row({ h: x.id }, x.army, 'Армия'));
    const arts = h('div', 'a-arts');
    for (const sl of ART_SLOTS) {
      const art = x.arts[sl.id];
      const c = h('button', `a-art${art ? '' : ' empty'}`);
      c.title = art ? `${ARTIFACTS[art].name} — снять в сумку` : sl.name;
      if (art) {
        c.append(icon(art, 56));
        c.onclick = () => {
          act({ t: 'unequip', hero: x.id, slot: sl.id });
          draw();
        };
      } else c.append(h('small', '', sl.name));
      arts.append(c);
    }
    box.append(h('h3', '', 'Вещи'), arts);
    if (x.bag.length) {
      const bag = h('div', 'a-arts');
      for (const art of x.bag) {
        const c = h('button', 'a-art');
        c.title = `${ARTIFACTS[art].name} — надеть`;
        c.append(icon(art, 56));
        c.onclick = () => {
          const slot = ART_SLOTS.find((s) => s.slot === ARTIFACTS[art].slot && !x.arts[s.id]) ?? ART_SLOTS.find((s) => s.slot === ARTIFACTS[art].slot)!;
          act({ t: 'equip', hero: x.id, art, slot: slot.id });
          draw();
        };
        bag.append(c);
      }
      box.append(h('h3', '', 'Сумка'), bag);
    }
    const book = h('div', 'a-book');
    for (const sp of x.spells) {
      const d = SPELLS[sp];
      const c = h('span');
      c.title = `${d.name}: ${d.text}, мана ${d.mana}`;
      c.append(icon(spellIcon(d), 44));
      book.append(c);
    }
    box.append(h('h3', '', 'Книга'), book);
    box.append(button('Закрыть', close));
  };
  draw();
}

/** Рынок: отдать → получить. */
export function marketDialog(host: HTMLElement, world: () => World, act: Act, hero: number | undefined, onClose: () => void): void {
  const { box, close } = modal(host, 'a-market', onClose);
  let give: ResId = 'wood';
  let get: ResId = 'semki';
  let amount = 1;
  const draw = (): void => {
    const p = world().players[world().current];
    box.replaceChildren(h('h3', '', 'Рынок'));
    const pick = (cur: ResId, set: (r: ResId) => void): HTMLElement => {
      const row = h('div', 'a-res-pick');
      for (const r of RES) {
        const b = h('button', cur === r ? 'on' : '');
        b.title = RES_NAME[r];
        b.append(icon(`icon-${r}`, 40), h('em', '', String(p.res[r])));
        b.onclick = () => {
          set(r);
          amount = Math.max(1, Math.min(amount, p.res[give]));
          draw();
        };
        row.append(b);
      }
      return row;
    };
    box.append(h('p', 'dim', 'Отдаю'), pick(give, (r) => (give = r)), h('p', 'dim', 'Получаю'), pick(get, (r) => (get = r)));
    const r = h('input');
    r.type = 'range';
    r.min = '1';
    r.max = String(Math.max(1, p.res[give]));
    r.value = String(amount);
    const out = h('p', 'g-heroline', '');
    const deal = button('Обменять', () => {
      act({ t: 'market', give, get, amount, hero });
      amount = 1;
      draw();
    });
    const check = (): void => {
      out.textContent = `${amount} ${RES_NAME[give]} → ${give === get ? 0 : marketRate(give, get, amount)} ${RES_NAME[get]}`;
      deal.disabled = !!actionError(world(), { t: 'market', give, get, amount, hero });
    };
    r.oninput = () => {
      amount = Number(r.value);
      check();
    };
    check();
    box.append(r, out, deal, button('Закрыть', close));
  };
  draw();
}
