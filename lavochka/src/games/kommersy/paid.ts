/* «Коммерсы 2.0»: второй сезон — разовая покупка 300 ₽ (товар kommersy2 → право kommersy_s2, src/core/buy.ts).
 * Здесь только показ: окно покупки (общее, core/buyui.ts) и хранение наследия первого сезона в браузере. */
import { buyOffer } from '../../core/buyui';
import { store } from '../../core/settings';
import { currentUser, openAuth } from '../../site/account';
import { encodeLegacy, type Legacy } from './legacy';

/** Наследие первого сезона в localStorage (через store настроек). */
export const LEGACY_KEY = 'kommersy.legacy';
export const saveLegacy = (l: Legacy) => store.set(LEGACY_KEY, encodeLegacy(l));

/** Окно «Второй сезон — 300 ₽». */
export function offerS2(why = ''): void {
  buyOffer({
    product: 'kommersy2',
    title: 'Коммерсы: второй сезон',
    why,
    lines: [
      '2004–2021: Колян — хозяин клуба в Лондоне, кризис 2008-го и крах, «Цифра» — IT-дела, стартапы, биткоин, ковид;',
      'цель — выжить и купить «Тындекс», лучшая концовка — остров «Нью-Затулинка»;',
      'купили клуб в первом сезоне — второй продолжается с вашим Коляном;',
      'по сети с 2009-го: платит только хозяин стола, гости по коду играют бесплатно.',
    ],
    note: 'Первый сезон (1988–2003) остаётся бесплатным.',
    signedIn: !!currentUser(),
    onLogin: () => openAuth('login'),
  });
}
