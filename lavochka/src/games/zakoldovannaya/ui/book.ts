/* «Книга» — лента рассказа и панель действий: выборы сцены, броски, лавка, игра, дорога и замок, решения ведущего. */
import { esc } from '../../../core/util';
import { SPELL } from '../book';
import { fmtHp } from '../dice';
import type { Action, View } from '../engine';
import { itemName, type Hero } from '../hero';
import { priceFor, sellPrice, spellsOfLevel, wares } from '../heroact';
import { GM } from '../state';
import { MAP, siteAt, siteTitle } from '../world';
import { portrait } from './common';

export type Act = (seat: number, a: Action) => void;

const heroOf = (v: View, seat: number) => v.heroes.find((h) => h.seat === seat);

/** Лента рассказа. */
export function renderFeed(el: HTMLElement, v: View, nameOf: (seat: number) => string): void {
  const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
  // новое в ленте — прокрутить к нему (если читатель не листает назад)
  const grew = v.story.length !== Number(el.dataset.n ?? -1);
  el.dataset.n = String(v.story.length);
  const parts: string[] = [];
  const list = v.story.slice(-160);
  let day = -1;
  for (const e of list) {
    if (e.day != null && e.day !== day) {
      day = e.day;
      parts.push(`<div class="zs-day">День ${day}</div>`);
    }
    const text = esc(e.text).replace(/\n/g, '<br>');
    if (e.k === 'title') parts.push(`<h3 class="zs-h">${e.img ? portrait(e.img, 'zs-h-por') : ''}<span>${text}</span></h3>`);
    else if (e.k === 'say') parts.push(`<p class="zs-say">${e.img ? portrait(e.img, 'zs-say-por') : ''}${text}</p>`);
    else if (e.k === 'gm') parts.push(`<p class="zs-gmnote"><b>Книга ведущего:</b> ${text}</p>`);
    else if (e.k === 'talk') parts.push(`<p class="zs-talk"><b>Ведущий:</b> ${text}</p>`);
    else parts.push(`<p class="zs-sys">${text}</p>`);
  }
  if (v.result) parts.push(`<div class="zs-end ${v.result.win ? 'win' : 'lose'}">${esc(v.result.text)}</div>`);
  el.innerHTML = parts.join('');
  void nameOf;
  if (atBottom || grew) el.scrollTop = el.scrollHeight;
}

/** Панель действий для мест этого экрана, которые могут действовать сейчас. */
export function renderActions(el: HTMLElement, v: View, seats: number[], act: Act, nameOf: (seat: number) => string, ui: { sheet: (seat: number) => void; gm: () => void }): void {
  el.replaceChildren();
  const add = (html: string) => {
    const d = document.createElement('div');
    d.innerHTML = html;
    el.append(...Array.from(d.childNodes));
  };
  const btn = (label: string, seat: number, a: Action, cls = '') => {
    const b = document.createElement('button');
    b.className = `btn ${cls}`;
    b.innerHTML = label;
    b.onclick = () => act(seat, a);
    el.append(b);
    return b;
  };
  const who = (seat: number) => (seats.length > 1 ? `<div class="zs-who">${nameOf(seat)}</div>` : '');
  if (v.result || v.phase === 'create') return;
  const wt = v.scene?.wait;

  // ведущий
  if (seats.includes(GM)) {
    const cm = v.combat;
    if (cm?.phase === 'init' && cm.queue.includes(GM)) btn('🎲 Бросить за опасности — кто бьёт первым', GM, { t: 'gm-init' }, 'primary');
    if (cm?.phase === 'foes') btn('⚔ Опасности бьют', GM, { t: 'gm-foes' }, 'primary');
    if (wt?.k === 'ask' && wt.who.includes(GM)) {
      add(`<div class="zs-prompt">Решает ведущий: ${esc(wt.prompt)}</div>`);
      for (const o of wt.opts ?? []) btn(esc(o.text), GM, { t: 'answer', i: o.i });
    }
  }

  for (const seat of seats.filter((s) => s !== GM)) {
    const h = heroOf(v, seat);
    if (!h || h.dead || h.stone) continue;
    // уровень
    for (const p of h.pending.slice(0, 1)) {
      add(who(seat));
      if (p.kind === 'hp') btn(`★ Новый уровень — бросить жизненный кубик`, seat, { t: 'lvl-hp' }, 'primary');
      else {
        add(`<div class="zs-prompt">★ Заклинание ${p.level}-го уровня — выберите:</div>`);
        for (const sp of spellsOfLevel(p.level)) btn(`${esc(sp.name)}${sp.uses ? ` <small>(${sp.uses} раз)</small>` : ''}`, seat, { t: 'lvl-spell', id: sp.id }).title = sp.text;
      }
    }
    if (v.combat) continue; // бой — в панели боя
    if (wt?.k === 'ask' && wt.who.includes(seat)) {
      add(`${who(seat)}<div class="zs-prompt">${esc(wt.prompt)}</div>`);
      for (const o of wt.opts ?? []) btn(esc(o.text), seat, { t: 'answer', i: o.i }, 'opt');
    } else if (wt?.k === 'roll' && wt.roll.seat === seat) {
      const need = Array.isArray(wt.roll.need) ? `нужно ${wt.roll.need.join(', ')}` : wt.roll.kind === 'dice4' ? 'больше соперника' : `нужно ${wt.roll.need}+`;
      add(who(seat));
      btn(`🎲 ${esc(wt.roll.label)} <small>(${need})</small>`, seat, { t: 'roll' }, 'primary');
    } else if (wt?.k === 'shop' && !wt.done.includes(seat)) {
      shopPanel(el, v, h, act, seats.length > 1 ? nameOf(seat) : '');
    } else if (wt?.k === 'gamble' && !wt.game.done?.includes(seat)) {
      gamblePanel(el, v, h, act, who(seat));
    }
  }

  // дорога и замок — вожак
  const lead = v.party.leader;
  if (!wt && !v.combat && seats.includes(lead)) {
    if (v.where.k === 'map') {
      const site = siteAt(v as never, v.where.node);
      add(`<div class="zs-prompt">Куда пойдёте? Выберите дорогу на карте — до развилки фишка идёт сама.</div>`);
      if (site) btn(`🏰 Войти: ${esc(siteTitle(v as never, site))}`, lead, { t: 'enter' }, 'primary');
      btn('🔥 Привал до утра', lead, { t: 'camp' });
    } else if (v.where.k === 'site') {
      add(`<div class="zs-prompt">Куда идёте? Двери и лестницы — на плане.</div>`);
      for (const e of v.exits.filter((x) => !x.hidden)) btn(`${e.kind === 'up' ? '▲' : e.kind === 'down' ? '▼' : '→'} ${/^\d/.test(e.to) ? 'К комнате ' + e.to : 'Дальше'}`, lead, { t: 'room', id: e.to }, 'small');
      btn('🔍 Искать потайную дверь', lead, { t: 'search' }, 'small');
      const h = heroOf(v, lead);
      if (h?.spells.some((s) => s.id === 'otpiranie')) btn('✨ «Отпирание»', lead, { t: 'search', spell: true }, 'small');
      btn('🚪 Выйти из замка', lead, { t: 'leave' }, 'small');
    }
  }
  if (!el.childNodes.length) {
    const toAct = v.combat ? v.combat.queue : wt?.k === 'ask' ? wt.who : wt?.k === 'roll' ? [wt.roll.seat] : [lead];
    add(`<div class="zs-wait">Ждём: ${toAct.map((s) => (s === GM ? 'ведущего' : nameOf(s))).join(', ')}…</div>`);
  }
  void ui;
}

function shopPanel(el: HTMLElement, v: View, h: Hero, act: Act, who: string): void {
  const spec = (v.scene?.shop ?? {}) as { kind?: string; markup?: number; free?: boolean; stock?: { id: string; price: number }[]; exchange?: boolean; title?: string };
  const list = wares(spec.kind ?? 'trurl', spec.free ? 0 : spec.markup ?? 1, spec.stock);
  const box = document.createElement('div');
  box.className = 'zs-shop';
  const groups = [...new Set(list.map((w) => w.group))];
  box.innerHTML = `<div class="zs-shop-h"><b>${esc(spec.title ?? 'Лавка')}</b>${who ? ` — ${who}` : ''} <span class="zs-gold">💰 ${h.gold}</span></div>` +
    groups.map((g) => `<details${g === 'Доспехи' || g === 'Мечи' ? ' open' : ''}><summary>${esc(g)}</summary>` +
      list.filter((w) => w.group === g).map((w) => {
        const p = priceFor(h, w);
        return `<button class="zs-ware" data-id="${w.id}" ${p > h.gold ? 'disabled' : ''}>${esc(w.name)}<span>${p}${w.each ? ' за шт.' : ''}</span></button>`;
      }).join('') + `</details>`).join('') +
    (spec.kind !== 'custom' && h.items.length ? `<details><summary>Продать (за полцены)</summary>${h.items.map((it) => `<button class="zs-sell" data-id="${it.id}" data-b="${it.bottle ?? ''}">${esc(itemName(it))}${it.n > 1 ? ' ×' + it.n : ''}<span>${it.id === 'bottle' ? 5 : sellPrice(it.id)}</span></button>`).join('')}</details>` : '') +
    (spec.exchange ? `<div class="zs-exch">Деньги → игровые очки (1:1, до 1000): <input type="number" min="1" max="1000" value="${Math.min(100, h.gold)}"><button class="btn small">Обменять</button></div>` : '') +
    `<button class="btn primary zs-done">Готово</button>`;
  box.querySelectorAll<HTMLButtonElement>('.zs-ware').forEach((b) => (b.onclick = () => act(h.seat, { t: 'buy', id: b.dataset.id!, n: /arrow|bolt|dart|sling_|throw|catapult_ball/.test(b.dataset.id!) ? 10 : 1 })));
  box.querySelectorAll<HTMLButtonElement>('.zs-sell').forEach((b) => (b.onclick = () => act(h.seat, { t: 'sell', id: b.dataset.id!, ...(b.dataset.b ? { bottle: Number(b.dataset.b) } : {}) })));
  const ex = box.querySelector('.zs-exch button') as HTMLButtonElement | null;
  if (ex) ex.onclick = () => act(h.seat, { t: 'exchange', n: Number((box.querySelector('.zs-exch input') as HTMLInputElement).value) });
  (box.querySelector('.zs-done') as HTMLButtonElement).onclick = () => act(h.seat, { t: 'shop-done' });
  el.append(box);
}

function gamblePanel(el: HTMLElement, v: View, h: Hero, act: Act, who: string): void {
  const wt = v.scene!.wait as { game: { game: string; vs: string; net?: Record<number, number> } };
  const g = wt.game;
  const box = document.createElement('div');
  box.className = 'zs-gamble';
  const unit = g.game === 'hp' ? 'ОР' : 'мон.';
  box.innerHTML = `${who}<div class="zs-prompt">${esc(g.vs)}: ${g.game === 'cards' ? 'ставка на каждый номер — угадавшему весь банк' : 'четыре кубика — у кого больше'}. Итог: ${(g.net?.[h.seat] ?? 0) >= 0 ? '+' : ''}${g.net?.[h.seat] ?? 0} ${unit}</div>` +
    `<label>Ставка: <input type="number" min="1" value="5" class="zs-stake"> ${unit}</label>` +
    (g.game === 'cards' ? `<div class="zs-picks">${[1, 2, 3, 4, 5, 6].map((n) => `<label><input type="checkbox" value="${n}"${n === 6 ? ' checked' : ''}>${n}</label>`).join('')}</div>` : '') +
    `<div class="zs-row"><button class="btn primary zs-bet">🎲 Ставлю и бросаю</button><button class="btn zs-quit">Встать из-за стола</button></div>`;
  (box.querySelector('.zs-bet') as HTMLButtonElement).onclick = () => {
    const n = Number((box.querySelector('.zs-stake') as HTMLInputElement).value);
    const picks = [...box.querySelectorAll<HTMLInputElement>('.zs-picks input:checked')].map((x) => Number(x.value));
    act(h.seat, { t: 'bet', n, ...(g.game === 'cards' ? { picks } : {}) });
  };
  (box.querySelector('.zs-quit') as HTMLButtonElement).onclick = () => act(h.seat, { t: 'gamble-quit' });
  el.append(box);
}

/** Короткая сводка героя для боковой панели. */
export function heroLine(h: Hero): string {
  if (!h.cls) return '<i>оформляется…</i>';
  const st = h.dead ? '☠ погиб' : h.stone ? '🗿 окаменел' : `❤ ${fmtHp(Math.max(0, h.hp))}/${fmtHp(h.hpMax)}`;
  return `${st} · ур. ${h.level} · 💰 ${h.gold}`;
}

export { MAP, SPELL };
