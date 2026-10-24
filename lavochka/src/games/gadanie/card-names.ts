/* Имена карт гадания для заголовков (без DOM): «XVI. Башня», «Девятка Мечей», «Шестёрка пик». */
import { tarotLabel } from '../../cards/tarot';
import { kartaMeaning } from './reading';
import type { DeckKind } from './spreads';

export function cardTitle(deck: DeckKind, c: number): string {
  return deck === 'taro' ? tarotLabel(c) : kartaMeaning(c).name.replace(/^./, (x) => x.toUpperCase());
}
