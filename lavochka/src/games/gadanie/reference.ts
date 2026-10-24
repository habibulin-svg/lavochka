/* Справочник значений: все карты колоды сеткой, нажатие — толкование (у таро — прямо и перевёрнуто). Бесплатно для всех. */
import { MAJORS, minor, SUIT_TITLE, TAROT_SUITS } from '../../cards/tarot';
import { Sound } from '../../core/audio';
import { store } from '../../core/settings';
import { esc, h } from '../../core/util';
import { smallUrl } from './faces';
import { cardTitle, openMeaning } from './meaning';
import { KARTY, KARTY36 } from './reading';
import type { DeckKind } from './spreads';

const SUIT36: Record<string, string> = { S: 'Пики', C: 'Трефы', D: 'Бубны', H: 'Черви' };

/** start — открыть сразу эту карту (страница карты на сайте). */
export function mountReference(root: HTMLElement, panel: HTMLElement, start?: { deck: DeckKind; card: number }) {
  let deck = start?.deck ?? store.get<DeckKind>('gadanie.ref', 'taro');
  const page = h(`<div class="gd-ref sheet"></div>`);
  root.appendChild(page);
  const side = h(`<div class="gd-side">
    <div class="seg gd-ref-deck"><button data-d="taro">Таро</button><button data-d="karty">Обычная колода</button></div>
    <div class="gd-ref-about"></div>
  </div>`);
  panel.appendChild(side);

  const tile = (c: number) =>
    `<button class="gd-tile" data-c="${c}"><img src="${smallUrl(deck, c)}" alt="" loading="lazy" decoding="async"><span>${esc(cardTitle(deck, c))}</span></button>`;

  const draw = () => {
    side.querySelectorAll<HTMLButtonElement>('[data-d]').forEach((b) => b.classList.toggle('on', b.dataset.d === deck));
    if (deck === 'taro') {
      page.innerHTML = `<h2>Значения карт таро</h2>
        <h3>Старшие арканы</h3><div class="gd-grid gd-taro">${MAJORS.map((_, i) => tile(i)).join('')}</div>
        ${TAROT_SUITS.map((s) => `<h3>${SUIT_TITLE[s]}</h3><div class="gd-grid gd-taro">${Array.from({ length: 14 }, (_, r) => tile(minor(s, r + 1))).join('')}</div>`).join('')}`;
      side.querySelector('.gd-ref-about')!.innerHTML = `<p>78 карт колоды Уэйта — Смит (1909): 22 старших аркана — большие события и силы судьбы, 56 младших — повседневные дела по четырём мастям.</p>
        <p><b>Жезлы</b> — дело, замысел, напор. <b>Кубки</b> — чувства и отношения. <b>Мечи</b> — разум, споры, трудности. <b>Пентакли</b> — деньги, работа, быт.</p>
        <p class="hint">Значения пересказаны по книгам А. Э. Уэйта (1910) и С. Л. Мэзерса (1888).</p>`;
    } else {
      page.innerHTML = `<h2>Значения карт для гадания на 36 картах</h2>
        ${['H', 'D', 'C', 'S'].map((s) => `<h3>${SUIT36[s]}</h3><p class="gd-suit">${esc(KARTY.suits[s as 'H'])}</p><div class="gd-grid gd-karty">${KARTY36.map((c, i) => ({ c, i })).filter(({ c }) => c.s === s).map(({ i }) => tile(i)).join('')}</div>`).join('')}
        <h3>Одинаковые карты</h3><ul class="gd-combos">${KARTY.combos.map((c) => `<li>${esc(c.text)}</li>`).join('')}</ul>`;
      side.querySelector('.gd-ref-about')!.innerHTML = `<p>Бабушкино гадание на атласной колоде: шестёрки — дороги, семёрки — разговоры, восьмёрки — встречи, девятки — чувства и надежды, десятки — исполнение, фигуры — люди, тузы — главное событие.</p>
        <p class="hint">Перевёрнутых значений у 36 карт нет: фигуры атласной колоды двуглавые.</p>`;
    }
  };

  side.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLButtonElement>('[data-d]');
    if (!b) return;
    Sound.ui();
    deck = b.dataset.d as DeckKind;
    store.set('gadanie.ref', deck);
    draw();
  });
  page.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('[data-c]');
    if (!b) return;
    Sound.ui();
    openMeaning(deck, Number(b.dataset.c), null);
  });
  draw();
  if (start) openMeaning(start.deck, start.card, null);
  return {
    destroy() {
      page.remove();
      side.remove();
    },
  };
}
