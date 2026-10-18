/* Лист персонажа во время игры: снаряжение (надеть/снять), бутылочки, передать товарищу, заклинания вне боя, победы. */
import { esc } from '../../../core/util';
import { SPELL } from '../book';
import type { View } from '../engine';
import { slotOf, itemName, type Hero } from '../hero';
import type { Act } from './book';
import { sheetHtml } from './create';

const SLOT_NAME: Record<string, string> = { armor: 'доспех', shield: 'щит', helm: 'шлем', melee: 'в руке', launcher: 'лук/арбалет' };

export function openSheet(host: HTMLElement, v: View, seat: number, mine: boolean, act: Act, nameOf: (s: number) => string): void {
  host.querySelector('.zs-modal')?.remove();
  const h = v.heroes.find((x) => x.seat === seat);
  if (!h) return;
  const m = document.createElement('div');
  m.className = 'zs-modal';
  const friends = v.heroes.filter((x) => x.seat !== seat && !x.dead && !x.stone && x.cls);
  const canFree = mine && !v.combat && !h.dead;
  const inv = h.items
    .map((it) => {
      const slot = slotOf(it.id);
      const on = slot && h.eq[slot] === it.id;
      const btns: string[] = [];
      if (canFree && slot) btns.push(on ? `<button data-a="unequip" data-slot="${slot}">снять</button>` : `<button data-a="equip" data-id="${it.id}">надеть</button>`);
      if (canFree && it.id === 'bottle' && it.bottle) btns.push(`<button data-a="drink" data-b="${it.bottle}">выпить</button>`);
      if (canFree && friends.length) btns.push(`<select data-a="give" data-id="${it.id}" data-b="${it.bottle ?? ''}"><option value="">передать…</option>${friends.map((f) => `<option value="${f.seat}">${esc(f.name)}</option>`).join('')}</select>`);
      return `<li>${esc(itemName(it))}${it.n > 1 ? ` ×${it.n}` : ''}${on ? ` <i>(${SLOT_NAME[slot!]})</i>` : ''} <span class="zs-ib">${btns.join('')}</span></li>`;
    })
    .join('');
  const spells = h.spells
    .map((s) => {
      const d = SPELL[s.id];
      const out = /heal|gold|identify|raise|unpetrify/.test(d?.kind ?? '');
      return `<li title="${esc(d?.text ?? '')}">«${esc(d?.name ?? s.id)}» ${s.left != null ? `<small>осталось ${s.left}</small>` : ''}${canFree && out && (s.left ?? 1) > 0 ? ` <button data-a="cast" data-id="${s.id}">прочесть</button>` : ''}</li>`;
    })
    .join('');
  m.innerHTML = `<div class="zs-modal-box zs-sheet">
    <button class="zs-close" title="Закрыть">✕</button>
    ${sheetHtml(h)}
    <div class="zs-cols"><div><h4>Снаряжение</h4><ul class="zs-list">${inv || '<li><i>ничего</i></li>'}</ul>
    ${canFree && friends.length && h.gold ? `<div class="zs-row">Передать монеты: <input type="number" min="1" max="${h.gold}" value="${Math.min(10, h.gold)}" class="zs-gg"> <select class="zs-gt">${friends.map((f) => `<option value="${f.seat}">${esc(f.name)}</option>`).join('')}</select> <button data-a="gold">отдать</button></div>` : ''}</div>
    <div><h4>Заклинания</h4><ul class="zs-list">${spells || '<li><i>нет</i></li>'}</ul>
    <h4>Победы</h4><ul class="zs-list zs-kills">${h.kills.slice(-30).map((k) => `<li>${esc(k.name)} — ${k.value}</li>`).join('') || '<li><i>пока никого</i></li>'}</ul></div></div>
  </div>`;
  const close = () => m.remove();
  m.onclick = (e) => {
    if (e.target === m) close();
  };
  (m.querySelector('.zs-close') as HTMLButtonElement).onclick = close;
  const run = (a: Parameters<Act>[1]) => {
    act(seat, a);
    close();
  };
  m.querySelectorAll<HTMLButtonElement>('button[data-a]').forEach((b) => {
    b.onclick = () => {
      const k = b.dataset.a;
      if (k === 'equip') run({ t: 'equip', id: b.dataset.id! });
      else if (k === 'unequip') run({ t: 'unequip', slot: b.dataset.slot as never });
      else if (k === 'drink') run({ t: 'drink', bottle: Number(b.dataset.b) });
      else if (k === 'cast') {
        const d = SPELL[b.dataset.id!];
        const target = d.kind.startsWith('heal') || d.kind === 'raise' || d.kind === 'unpetrify' ? pickTarget(v, h) : undefined;
        const bottle = d.kind === 'identify' ? h.items.find((x) => x.id === 'bottle' && !x.known)?.bottle : undefined;
        run({ t: 'cast', id: d.id, ...(target != null ? { target } : {}), ...(bottle ? { bottle } : {}) });
      } else if (k === 'gold') run({ t: 'give', to: Number((m.querySelector('.zs-gt') as HTMLSelectElement).value), gold: Number((m.querySelector('.zs-gg') as HTMLInputElement).value) });
    };
  });
  m.querySelectorAll<HTMLSelectElement>('select[data-a="give"]').forEach((s) => {
    s.onchange = () => {
      if (!s.value) return;
      run({ t: 'give', to: Number(s.value), id: s.dataset.id!, ...(s.dataset.b ? { bottle: Number(s.dataset.b) } : {}) });
    };
  });
  void nameOf;
  host.append(m);
}

/** Кого лечить/оживлять: раненого или павшего товарища, иначе себя. */
function pickTarget(v: View, h: Hero): number {
  const dead = v.heroes.find((x) => (x.dead || x.stone) && x.seat !== h.seat);
  if (dead) return dead.seat;
  const hurt = [...v.heroes].filter((x) => !x.dead && x.cls).sort((a, b) => a.hp / a.hpMax - b.hp / b.hpMax)[0];
  return hurt?.seat ?? h.seat;
}
