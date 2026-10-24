/* Расклад словами — для Светки (server/svetka.ts): расклад, каждое место с картой, её положением и значением из справочника,
 * совпадения и итог. Без DOM; модель получает только это и ничего не придумывает. */
import { isMajor, suitOf, SUIT_TITLE } from '../../cards/tarot';
import { combosOf, drawnName, KARTY, KARTY36, kartaMeaning, majorCount, nearOf, slotsOf, TARO, verdictOf, type Drawn } from './reading';
import type { DeckKind, Spread } from './spreads';

export function readingFacts(deck: DeckKind, s: Spread, cards: Drawn[], person: number | null): string {
  const order = slotsOf(s);
  const lines: string[] = [];
  lines.push(`Колода: ${deck === 'taro' ? 'таро Уэйта — Смит, 78 карт' : 'обычная, 36 карт (перевёрнутых значений нет; короли, дамы и валеты — люди)'}.`);
  lines.push(`Расклад: «${s.title}», ${cards.length} карт.${s.source ? ` Источник: ${s.source}.` : ''}`);
  if (person != null) {
    const c = KARTY36[person];
    lines.push(`Гадают на человека: ${drawnName('karty', person)} (лежит в середине). ${KARTY.persons[c.s + c.r] ?? ''}`);
  }
  cards.forEach((d, k) => {
    const spot = s.spots[order[k]];
    if (deck === 'taro') {
      const m = TARO[d.card];
      const kind = isMajor(d.card) ? 'старший аркан' : `масть ${SUIT_TITLE[suitOf(d.card)!]}`;
      lines.push(
        `${k + 1}. Место «${spot.label}» (${spot.hint}): ${drawnName('taro', d.card, true)}, ${kind}, ${d.rev ? 'ПЕРЕВЁРНУТА' : 'прямо'}. ` +
          `Значение: ${(d.rev ? m.down : m.up).join(', ')}. ${d.rev ? m.downText : m.upText} В отношениях: ${m.love} В делах: ${m.work}`
      );
    } else {
      const m = kartaMeaning(d.card);
      const c = KARTY36[d.card];
      const who = c.r >= 11 && c.r <= 13 ? ` Человек: ${KARTY.persons[c.s + c.r] ?? ''}` : '';
      lines.push(`${k + 1}. Место «${spot.label}» (${spot.hint}): ${m.name} — ${m.short}. ${m.text}${who}`);
    }
  });
  const v = verdictOf(s, cards);
  if (v) lines.push(`Итог по правилам расклада: «${v.word}». ${v.text}`);
  if (deck === 'karty') for (const t of [...combosOf(cards), ...nearOf(cards)]) lines.push(`Совпадение: ${t}`);
  if (deck === 'taro' && cards.length >= 5) lines.push(`Старших арканов: ${majorCount(cards)} из ${cards.length}.`);
  return lines.join('\n');
}
