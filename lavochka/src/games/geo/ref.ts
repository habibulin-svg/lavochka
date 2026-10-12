/* «География» — справочник: все страны, территории и регионы с флагом, гербом, контуром, местом на карте и столицей. */
import { esc, h } from '../../core/util';
import { armsUrl, CONTINENTS, ENTITIES, type Entity, flagUrl, KIND_LABEL, REGION_COUNTRIES, ent } from './data';
import { loadLayer, locatorSvg, outlineSvg } from './map';

const BASE = import.meta.env.BASE_URL;

const GROUPS: { id: string; title: string; of: (e: Entity) => boolean }[] = [
  { id: 'world', title: 'Все страны', of: (e) => e.k === 'country' || e.k === 'partial' },
  ...CONTINENTS.map((c) => ({ id: c.id, title: c.title, of: (e: Entity) => (e.k === 'country' || e.k === 'partial') && !!e.c?.includes(c.id) })),
  { id: 'unrec', title: 'Непризнанные', of: (e) => e.k === 'unrec' || e.k === 'partial' },
  { id: 'dep', title: 'Зависимые территории', of: (e) => e.k === 'dep' },
  { id: 'ru', title: 'Регионы России', of: (e) => e.l === 'ru' },
  { id: 'us', title: 'Штаты США', of: (e) => e.l === 'us' },
  ...REGION_COUNTRIES.map((c) => ({ id: c.id, title: `${c.title}: ${c.unit}`, of: (e: Entity) => e.l === 'regions' && e.p === c.id })),
];

const fmt = (n: number) => n.toLocaleString('ru-RU');

let lastGroup = 'world';
let lastId = '';

export function openRef(startId?: string) {
  const el = h(`<div class="geo-ref" role="dialog" aria-label="Справочник">
    <div class="geo-ref-box">
      <header><b>📖 Справочник</b><select class="grp"></select><input class="find" type="search" placeholder="Поиск…" autocomplete="off"><button class="btn small close" title="Закрыть">✕</button></header>
      <div class="geo-ref-body"><ul class="list"></ul><div class="card"></div></div>
      <footer>Контуры — Natural Earth; флаги, гербы и сведения — Викиданные и Викисклад.</footer>
    </div>
  </div>`);
  document.body.appendChild(el);
  const grp = el.querySelector('.grp') as HTMLSelectElement;
  const find = el.querySelector('.find') as HTMLInputElement;
  const list = el.querySelector('.list') as HTMLElement;
  const card = el.querySelector('.card') as HTMLElement;
  for (const g of GROUPS) grp.appendChild(h(`<option value="${g.id}">${esc(g.title)}</option>`));
  grp.value = lastGroup;
  const close = () => {
    el.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
  document.addEventListener('keydown', onKey);
  (el.querySelector('.close') as HTMLElement).onclick = close;
  el.addEventListener('click', (e) => e.target === el && close());

  const fill = () => {
    const t = find.value.trim().toLowerCase();
    const g = GROUPS.find((x) => x.id === grp.value) ?? GROUPS[0];
    const items = (t ? ENTITIES.filter((e) => e.n.toLowerCase().includes(t) || e.cap?.toLowerCase().includes(t)) : ENTITIES.filter(g.of)).sort((a, b) => a.n.localeCompare(b.n, 'ru'));
    list.innerHTML = '';
    for (const e of items) {
      const li = h(`<li data-id="${e.id}">${e.f ? `<img src="${flagUrl(BASE, e.id)}" alt="" loading="lazy">` : '<i></i>'}<span>${esc(e.n)}</span></li>`);
      li.onclick = () => show(e.id);
      list.appendChild(li);
    }
    if (!items.some((e) => e.id === lastId) && items[0]) show(items[0].id);
    else list.querySelector(`[data-id="${lastId}"]`)?.classList.add('on');
  };

  const show = async (id: string) => {
    lastId = id;
    const e = ent(id);
    for (const li of list.querySelectorAll('li')) li.classList.toggle('on', (li as HTMLElement).dataset.id === id);
    list.querySelector('.on')?.scrollIntoView({ block: 'nearest' });
    const parent = e.p ? ent(e.p) : null;
    const facts = [
      `<dt>Что это</dt><dd>${KIND_LABEL[e.k]}${e.disp ? ' (статус оспаривается)' : ''}${parent ? ` · ${esc(parent.n)}` : ''}</dd>`,
      e.cap ? `<dt>${e.k === 'region' ? 'Центр' : 'Столица'}</dt><dd>${esc(e.cap)}</dd>` : '',
      e.c?.length ? `<dt>Часть света</dt><dd>${e.c.map((c) => CONTINENTS.find((x) => x.id === c)?.title).join(', ')}</dd>` : '',
      e.pop ? `<dt>Население</dt><dd>${fmt(e.pop)}</dd>` : '',
      e.area ? `<dt>Площадь</dt><dd>${fmt(e.area)} км²</dd>` : '',
    ].join('');
    card.innerHTML = `<h2>${esc(e.n)}</h2>
      <div class="pics">
        ${e.f ? `<figure><img class="geo-flag big" src="${flagUrl(BASE, e.id)}" alt=""><figcaption>Флаг</figcaption></figure>` : ''}
        ${e.a ? `<figure><img class="geo-arms big" src="${armsUrl(BASE, e.id)}" alt=""><figcaption>${e.seal ? 'Печать' : 'Герб'}</figcaption></figure>` : ''}
        <figure class="ol"><span class="wait">…</span><figcaption>Контур</figcaption></figure>
      </div>
      <dl>${facts}</dl>
      <div class="loc"></div>
      ${e.w ? `<a class="wiki" href="https://ru.wikipedia.org/wiki/${encodeURIComponent(e.w)}" target="_blank" rel="noopener">Статья в Википедии →</a>` : ''}`;
    await Promise.all([loadLayer(e.l), loadLayer('world'), loadLayer('detail')]).catch(() => {});
    if (lastId !== id) return;
    card.querySelector('.ol .wait')!.outerHTML = outlineSvg(id, 220, 160);
    card.querySelector('.loc')!.innerHTML = locatorSvg(id);
  };

  grp.onchange = () => {
    lastGroup = grp.value;
    find.value = '';
    fill();
  };
  find.oninput = fill;
  if (startId) lastId = startId;
  fill();
  if (startId) void show(startId);
}
