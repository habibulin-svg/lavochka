/* Гадание на картах — таро (колода Уэйта — Смит 1909) и обычная колода на 36 картах. Не игра: свой экран в рамке аркады
 * (как «Шахматный кружок»), разделы — выбор колоды, гадание на таро, на обычной колоде и справочник значений.
 * Расклады и движок — spreads.ts / reading.ts (без DOM), стол — table.ts, толкование Светки — svetka.ts. План — docs/analysis/tarot-research.md. */
import type { ArcadeModule } from '../../core/arcade';
import { mountChoose } from './choose';
import { MODES, parseGadanie } from './pages';
import { mountReference } from './reference';
import { mountTable } from './table';
import { mountThumb } from './thumb';
import './gadanie.css';

/** Страница карты справочника (/gadanie-na-kartah/znacheniya-kart/<карта>/) — открыть её сразу, один раз. */
let urlUsed = false;
function cardFromUrl() {
  if (urlUsed || typeof location === 'undefined') return undefined;
  urlUsed = true;
  const at = parseGadanie(location.pathname);
  return at?.deck && at.card != null ? { deck: at.deck, card: at.card } : undefined;
}

const mod: ArcadeModule = {
  kind: 'arcade',
  id: 'gadanie',
  title: 'Гадание на картах',
  about: 'Гадание на картах таро и на обычной колоде: карта дня, да или нет, кельтский крест, на короля, на желание. Карты тянете сами, значения — сразу под рукой.',
  controls: `<p>Выберите расклад, задумайте вопрос и нажмите «Перетасовать». Колода ляжет веером — тяните карты по одной: каждая сама встанет на своё место и откроется.</p>
    <p>Нажмите на открытую карту — её значение целиком. В «Справочнике» — все карты с толкованиями.</p>`,
  modes: MODES.map(({ id, label, hint }) => ({ id, label, hint })),
  noRecords: true,
  home: 'vybor',
  thumb: mountThumb,
  mount: (root, opts) => {
    const panel = opts.panel ?? document.createElement('div');
    const go = (mode: string) => (root.closest('.arcade-screen')?.querySelector<HTMLButtonElement>(`.arcade-modes [data-mode="${mode}"]`) ?? null)?.click();
    const sub =
      opts.mode === 'taro' || opts.mode === 'karty'
        ? mountTable(root, panel, opts.mode)
        : opts.mode === 'znacheniya'
          ? mountReference(root, panel, cardFromUrl())
          : mountChoose(root, panel, go);
    return { destroy: () => sub.destroy() };
  },
};

export default mod;
