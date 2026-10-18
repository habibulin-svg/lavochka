/* Пульт ведущего-человека: рассказ от себя, опасность из бестиария, встреча на дороге, награда герою. Книга ведущего
 * (текст оригинала) идёт в ленте отдельными строками, план замка виден целиком. */
import { esc } from '../../../core/util';
import type { View } from '../engine';
import { MONSTERS } from '../monsters';
import { GM } from '../state';
import type { Act } from './book';
import { portrait } from './common';

export function gmPanel(el: HTMLElement, v: View, act: Act): void {
  el.replaceChildren();
  const box = document.createElement('div');
  box.className = 'zs-gm';
  const free = !v.scene && !v.combat && v.phase === 'travel';
  box.innerHTML = `<details open><summary>Ведущий говорит</summary><textarea rows="2" maxlength="600" placeholder="Что видят герои, что говорят встречные…"></textarea><button class="btn small zs-say">Сказать</button></details>
    <details><summary>Выставить опасность</summary><input class="zs-q" placeholder="поиск: гул, дракон…"><div class="zs-best"></div><div class="zs-row">Сколько: <input type="number" class="zs-n" min="1" max="12" value="1"></div>${free ? '' : '<p class="zs-hint">Можно, когда нет сцены и боя.</p>'}</details>
    <details><summary>Встреча на дороге</summary><button class="btn small zs-ev" ${free && v.where.k === 'map' ? '' : 'disabled'}>Следующая из «Прочего» (осталось ${v.world.deck})</button></details>
    <details><summary>Наградить</summary><select class="zs-who">${v.heroes.filter((h) => h.cls && !h.dead).map((h) => `<option value="${h.seat}">${esc(h.name)}</option>`).join('')}</select>
      <div class="zs-row"><input type="number" class="zs-gv" value="10"> <select class="zs-gk"><option value="gold">монет</option><option value="xp">ИО</option><option value="hp">ОР (лечить/ранить)</option><option value="hpMax">к очкам риска</option><option value="bottle">бутылочку №</option><option value="magic">волшебную вещь №</option></select> <button class="btn small zs-give">Дать</button></div></details>`;
  const ta = box.querySelector('textarea') as HTMLTextAreaElement;
  (box.querySelector('.zs-say') as HTMLButtonElement).onclick = () => {
    if (ta.value.trim()) act(GM, { t: 'gm-say', text: ta.value.trim() });
    ta.value = '';
  };
  const best = box.querySelector('.zs-best') as HTMLElement;
  const q = box.querySelector('.zs-q') as HTMLInputElement;
  const show = () => {
    const s = q.value.trim().toLowerCase();
    const list = MONSTERS.filter((m) => m.kd != null && (!s || m.name.toLowerCase().includes(s))).slice(0, 24);
    best.innerHTML = list.map((m) => `<button class="zs-bm" data-m="${m.id}" ${free ? '' : 'disabled'} title="${esc(m.text)}">${portrait(m.id, 'zs-bm-img')}<span>${esc(m.name)}<small>КД ${m.kd} · ${Array.isArray(m.value) ? m.value.join('–') : m.value ?? '—'} ИО</small></span></button>`).join('');
    best.querySelectorAll<HTMLButtonElement>('.zs-bm').forEach((b) => (b.onclick = () => act(GM, { t: 'gm-fight', foes: [{ m: b.dataset.m!, n: Number((box.querySelector('.zs-n') as HTMLInputElement).value) || 1 }] })));
  };
  q.oninput = show;
  show();
  (box.querySelector('.zs-ev') as HTMLButtonElement).onclick = () => act(GM, { t: 'gm-event' });
  (box.querySelector('.zs-give') as HTMLButtonElement).onclick = () => {
    const seat = Number((box.querySelector('.zs-who') as HTMLSelectElement).value);
    const k = (box.querySelector('.zs-gk') as HTMLSelectElement).value;
    const n = Number((box.querySelector('.zs-gv') as HTMLInputElement).value) || 0;
    const give = k === 'bottle' ? { bottles: [Math.min(25, Math.max(1, n))] } : k === 'magic' ? { item: `magic:${Math.min(43, Math.max(26, n))}` } : { [k]: n };
    act(GM, { t: 'gm-give', seat, give });
  };
  el.append(box);
}
