/* Окно с толкованием карты: большая картинка и значение из справочника (Уэйт и Мэзерс для таро, народная традиция — для 36 карт). */
import { isCourt, isMajor, suitOf, SUIT_TITLE } from '../../cards/tarot';
import { modal } from '../../core/ui';
import { esc } from '../../core/util';
import { bigUrl } from './faces';
import { cardTitle } from './card-names';
import { KARTY, KARTY36, kartaMeaning, TARO } from './reading';
import type { DeckKind, Spot } from './spreads';

const list = (w: string[]) => w.map(esc).join(', ');

/** Значение карты — HTML (для окна и справочника). rev: null — показать оба положения. */
export function meaningHTML(deck: DeckKind, c: number, rev: boolean | null, spot?: Spot): string {
  const where = spot ? `<p class="gd-m-spot"><b>${esc(spot.label)}</b> — ${esc(spot.hint)}</p>` : '';
  if (deck === 'karty') {
    const m = kartaMeaning(c);
    const card = KARTY36[c];
    const person = card.r >= 11 && card.r <= 13 ? KARTY.persons[card.s + card.r] : '';
    return `${where}<p class="gd-m-short">${esc(m.short)}</p>
      <p>${esc(m.text)}</p>
      ${person ? `<p class="gd-m-note">${esc(person)}</p>` : ''}
      <p class="gd-m-keys">${list(m.up)}</p>
      <p class="gd-m-note">${esc(KARTY.suits[card.s])}</p>`;
  }
  const m = TARO[c];
  const kind = isMajor(c) ? 'Старший аркан' : `${isCourt(c) ? 'Фигура' : 'Младший аркан'}, масть ${SUIT_TITLE[suitOf(c)!]}`;
  const up = `<h4>Прямо</h4><p class="gd-m-keys">${list(m.up)}</p><p>${esc(m.upText)}</p>`;
  const down = `<h4>Перевёрнута</h4><p class="gd-m-keys">${list(m.down)}</p><p>${esc(m.downText)}</p>`;
  const main = rev === null ? up + down : rev ? down : up;
  const other = rev === null ? '' : `<details class="gd-m-other"><summary>${rev ? 'А прямо она значит…' : 'А перевёрнутая значит…'}</summary>${rev ? up : down}</details>`;
  return `${where}<p class="gd-m-kind">${kind}${rev ? ' · <b>перевёрнута</b>' : ''}</p>
    <p class="gd-m-pic">${esc(m.pic)}</p>
    ${main}
    <p><b>В отношениях.</b> ${esc(m.love)}</p>
    <p><b>В делах и деньгах.</b> ${esc(m.work)}</p>
    <p class="gd-m-advice">${esc(m.advice)}</p>
    ${other}`;
}

export { cardTitle };

/** Открыть окно с картой. */
export function openMeaning(deck: DeckKind, c: number, rev: boolean | null, spot?: Spot) {
  const body = `<div class="gd-meaning gd-${deck}">
    <img class="gd-m-img${rev ? ' rev' : ''}" src="${bigUrl(deck, c)}" alt="${esc(cardTitle(deck, c))}" decoding="async">
    <div class="gd-m-text"><h2>${esc(cardTitle(deck, c))}</h2>${meaningHTML(deck, c, rev, spot)}
    <p class="gd-m-src">${deck === 'taro' ? 'По книгам А. Э. Уэйта (1910) и С. Л. Мэзерса (1888), пересказ «Лавочки». Рисунок — Памела Колман Смит, 1909.' : 'По народной традиции гадания на 36 картах и книге П. Фоли (1900), пересказ «Лавочки».'}</p></div>
  </div>`;
  modal(body, [{ text: 'Закрыть', primary: true }], { wide: true, cls: 'gd-modal', dismiss: true });
}
