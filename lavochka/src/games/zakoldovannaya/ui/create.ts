/* Оформление героя на листе персонажа (как у ведущего в книге: качества → персонаж → деньги → покупки → КД и ОР). */
import { esc } from '../../../core/util';
import { CLASSES, CLASS_IDS, SPELLS, STATS, STAT_NAME, statMod, type ClassId } from '../book';
import type { Action, View } from '../engine';
import { eligible, heroKd, itemName, meleeAttack, type Hero } from '../hero';
import { priceFor, wares } from '../heroact';
import type { Act } from './book';
import { classImg } from './common';

const STEP_TEXT: Record<string, string> = {
  stats: 'Качества: по каждому — четыре кубика, худший отбрасывается («два раза по два кубика»).',
  class: 'Выберите персонажа: главные качества должны быть не ниже 9.',
  bonus: 'Маг и крон могут увеличить все качества: кубик на каждое.',
  hp: 'Очки риска: кубик по таблице персонажа, плюс поправка сложения.',
  money: 'Деньги: снова четыре кубика без худшего — каждое очко десять монет.',
  shop: 'Купите оружие и вещи. Посмотрите, что разрешено вашему персонажу, и оставьте немного денег в дорогу.',
  spell: 'Эльф на нулевом уровне знает одно заклинание первого уровня.',
  name: 'Как зовут героя?',
};

const MOD_LABEL: Record<string, string> = { str: 'АТ', dex: 'КД', wis: 'БУ', con: 'ОР', brv: '' };

export class CreateView {
  el: HTMLElement;
  private tab = -1;
  constructor(parent: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'zs-create';
    parent.append(this.el);
  }

  render(v: View, seats: number[], act: Act, nameOf: (s: number) => string): void {
    const mine = v.heroes.filter((h) => seats.includes(h.seat));
    const others = v.heroes.filter((h) => !seats.includes(h.seat));
    if (!mine.length) {
      this.el.innerHTML = `<div class="zs-sheet zs-wait-sheet"><h2>Заколдованная страна</h2><p>Герои оформляются…</p>${v.heroes.map((h) => `<p>${nameOf(h.seat)}: ${h.create.step === 'done' ? 'готов' : 'оформляется'}</p>`).join('')}</div>`;
      return;
    }
    if (!mine.some((h) => h.seat === this.tab)) this.tab = (mine.find((h) => h.create.step !== 'done') ?? mine[0]).seat;
    const h = mine.find((x) => x.seat === this.tab)!;
    const tabs = mine.length > 1 ? `<div class="zs-tabs">${mine.map((x) => `<button class="${x.seat === h.seat ? 'on' : ''}" data-s="${x.seat}">${nameOf(x.seat)}${x.create.step === 'done' ? ' ✓' : ''}</button>`).join('')}</div>` : '';
    this.el.innerHTML = `${tabs}<div class="zs-sheet">${sheetHtml(h, true)}<div class="zs-step"></div></div>${others.length ? `<div class="zs-others">${others.map((x) => `${nameOf(x.seat)}: ${x.create.step === 'done' ? 'готов' : 'оформляется…'}`).join(' · ')}</div>` : ''}`;
    this.el.querySelectorAll<HTMLButtonElement>('.zs-tabs button').forEach((b) => (b.onclick = () => {
      this.tab = Number(b.dataset.s);
      this.render(v, seats, act, nameOf);
    }));
    this.step(this.el.querySelector('.zs-step') as HTMLElement, h, act);
  }

  private step(el: HTMLElement, h: Hero, act: Act): void {
    const st = h.create.step;
    const a = (x: Action) => act(h.seat, x);
    const btn = (label: string, x: Action, cls = 'primary') => {
      const b = document.createElement('button');
      b.className = `btn ${cls}`;
      b.innerHTML = label;
      b.onclick = () => a(x);
      el.append(b);
      return b;
    };
    el.innerHTML = st === 'done' ? '<p class="zs-hint">Герой готов. Ждём остальных…</p>' : `<p class="zs-hint">${STEP_TEXT[st]}</p>`;
    if (st === 'stats') btn('🎲 Бросить качества', { t: 'cr-roll' });
    if (st === 'class') {
      const el2 = eligible(h.stats);
      const grid = document.createElement('div');
      grid.className = 'zs-classes';
      grid.innerHTML = CLASS_IDS.map((c) => {
        const d = CLASSES[c];
        const ok = el2.includes(c);
        return `<button class="zs-class${ok ? '' : ' off'}" data-c="${c}" ${ok ? '' : 'disabled'}><img src="${classImg(c)}" alt=""><b>${d.name}</b><small>главные: ${d.main.map((s) => STAT_NAME[s].toLowerCase()).join(', ')}; ОР ${d.hp.join('-')}</small><span>${esc(d.text)}</span></button>`;
      }).join('');
      grid.querySelectorAll<HTMLButtonElement>('.zs-class').forEach((b) => (b.onclick = () => a({ t: 'cr-class', cls: b.dataset.c as ClassId })));
      el.append(grid);
      if (!el2.length) btn('🎲 Ни один не подходит — перебросить', { t: 'cr-roll' });
    }
    if (st === 'bonus') btn('🎲 Бросить прибавки к качествам', { t: 'cr-bonus' });
    if (st === 'hp') btn('🎲 Бросить очки риска', { t: 'cr-hp' });
    if (st === 'money') btn('🎲 Бросить деньги', { t: 'cr-money' });
    if (st === 'shop') {
      const list = wares('start').filter((w) => !h.cls || ['Вещи', 'Животные', 'Волшебные вещи'].includes(w.group) || CLASSES[h.cls].weapon(w.id) || (w.group === 'Доспехи' && (w.id === 'shield' ? CLASSES[h.cls].shield : CLASSES[h.cls].armor(w.id))) || (w.group === 'Метательное' && CLASSES[h.cls].weapon(w.id)));
      const groups = [...new Set(list.map((w) => w.group))];
      const shop = document.createElement('div');
      shop.className = 'zs-shop zs-shop-start';
      shop.innerHTML = `<div class="zs-shop-h">💰 <b>${h.gold}</b> монет</div>` + groups.map((g) => `<details${['Доспехи', 'Мечи', 'Кинжалы'].includes(g) ? ' open' : ''}><summary>${g}</summary>${list.filter((w) => w.group === g).map((w) => {
        const p = priceFor(h, w);
        return `<button class="zs-ware" data-id="${w.id}" ${p > h.gold ? 'disabled' : ''}>${esc(w.name)}<span>${p}${w.each ? ' ×10' : ''}</span></button>`;
      }).join('')}</details>`).join('') +
        (h.items.length ? `<div class="zs-inv">${h.items.map((it) => `<span>${esc(itemName(it))}${it.n > 1 ? ' ×' + it.n : ''} <button class="zs-x" data-id="${it.id}" title="Вернуть в лавку">✕</button></span>`).join('')}</div>` : '');
      shop.querySelectorAll<HTMLButtonElement>('.zs-ware').forEach((b) => (b.onclick = () => a({ t: 'buy', id: b.dataset.id!, n: /arrow|bolt|dart|sling_|throw|catapult_ball/.test(b.dataset.id!) ? 10 : 1 })));
      shop.querySelectorAll<HTMLButtonElement>('.zs-x').forEach((b) => (b.onclick = () => a({ t: 'sell', id: b.dataset.id! })));
      el.append(shop);
      btn('Готово — дальше', { t: 'cr-done' });
    }
    if (st === 'spell') {
      for (const sp of SPELLS.filter((s) => s.level === 1)) btn(`${esc(sp.name)} <small>(${sp.uses ?? '∞'})</small>`, { t: 'cr-spell', id: sp.id }, '').title = sp.text;
    }
    if (st === 'name') {
      const row = document.createElement('div');
      row.className = 'zs-row';
      row.innerHTML = `<input class="zs-name" maxlength="24" value="${esc(h.name)}"><button class="btn primary">В путь!</button>`;
      const inp = row.querySelector('input') as HTMLInputElement;
      (row.querySelector('button') as HTMLButtonElement).onclick = () => a({ t: 'cr-name', name: inp.value });
      el.append(row);
    }
  }
}

/** Лист персонажа (как в коробке): качества с поправками, доспех и КД, оружие, ОР, способности, снаряжение, заклинания. */
export function sheetHtml(h: Hero, creating = false): string {
  const cls = h.cls ? CLASSES[h.cls] : null;
  const rows = STATS.map((s) => {
    const base = h.base[s] || '';
    const cur = h.stats[s] || '';
    const mod = h.stats[s] ? statMod(h.stats[s], s) : '';
    const dice = h.create.stats ? h.create.stats[STATS.indexOf(s)]?.dice : null;
    return `<tr><td>${STAT_NAME[s]}</td><td class="n">${cur}${base && cur !== base ? ` <small>(${base})</small>` : ''}</td><td class="m">${mod !== '' && MOD_LABEL[s] ? `<small>${MOD_LABEL[s]}</small> ${mod > 0 ? '+' : ''}${mod}` : ''}</td>${creating && dice ? `<td class="d">${dice.map((d, i) => `<i class="${i === dice.indexOf(Math.min(...dice)) ? 'drop' : ''}">${d}</i>`).join('')}</td>` : ''}</tr>`;
  }).join('');
  const atk = h.cls ? meleeAttack(h) : null;
  const next = h.cls && h.level < 12 ? CLASSES[h.cls].xp[h.level] : null;
  return `<div class="zs-sheet-top">${h.cls ? `<img class="zs-sheet-art" src="${classImg(h.cls)}" alt="">` : ''}<div><h2>${esc(h.name)}</h2>
    <div class="zs-sheet-line">Класс: <b>${cls?.name ?? '—'}</b> · Уровень <b>${h.level}</b></div>
    <div class="zs-sheet-line">Игровые очки: <b>${h.xp}</b>${next ? ` · до уровня ${next}` : ''}</div></div></div>
    <table class="zs-stats">${rows}</table>
    <div class="zs-sheet-grid">
      <div>Доспех: <b>${h.eq.armor ? esc(itemName({ id: h.eq.armor, n: 1 })) : 'никакого'}</b>${h.eq.shield ? ' + щит' : ''}${h.eq.helm ? ' + шлем' : ''}</div>
      <div>Класс доспехов: <b>${h.cls ? heroKd(h) : '—'}</b></div>
      <div>Оружие: <b>${atk ? esc(atk.name) : '—'}</b>${atk ? ` · атаки ${atk.dmg[0]}–${atk.dmg[atk.dmg.length - 1]}` : ''}</div>
      <div>Очки риска: <b>${h.hpMax ? `${Math.max(0, h.hp)} из ${h.hpMax}` : '—'}</b></div>
      <div>Деньги: <b>${h.gold}</b></div>
    </div>
    ${cls ? `<div class="zs-abil"><b>Дополнительные способности:</b> ${esc(cls.text)}</div>` : ''}`;
}
