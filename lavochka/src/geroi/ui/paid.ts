/* Полная игра (решение пользователя 2026-11-06): база — 4 фракции, «Арена», случайные карты, кампании 1–2 — бесплатно;
 * вторая четвёрка фракций и кампании 3–7 — разовой покупкой 300 ₽ (src/core/buy.ts, server/buy.ts, право geroi_full).
 * Здесь только показ: куплено ли, замок на выборе, окно покупки (заказ и касса — общие, core/buyui.ts). Сеть проверяет право сама (server/geroi.ts → peer.full). */
import { PRODUCTS } from '../../core/buy';
import { startBuy, takeBuyReturn } from '../../core/buyui';
import { FACTIONS, type Faction, isPaidFaction } from '../sim/creatures';
import { button, h, modal } from './common';
import { SALE_OPEN } from '../sale';

const PRODUCT = PRODUCTS.geroi;
let full = false;
let signedIn = false;

export const ownsFull = (): boolean => full;
export function setOwnership(v: { full: boolean; signedIn: boolean }): void {
  full = v.full;
  signedIn = v.signedIn;
}
export const factionOpen = (f: string): boolean => full || !isPaidFaction(f);
/** Продажа открыта (src/geroi/sale.ts): до готовности второй волны платное не показываем вовсе (видят только купившие и Мастер — право master). */
export { SALE_OPEN };
/** Показывать ли фракцию в списке выбора. */
export const factionListed = (f: string): boolean => factionOpen(f) || SALE_OPEN;

/** Выбор фракции: платные без покупки — с замком; выбор запертой открывает окно покупки и возвращает прежнюю. */
export function factionSelect(value: Faction, onPick: (f: Faction) => void, host: HTMLElement = document.body, only?: readonly string[]): HTMLSelectElement {
  const sel = h('select', 'g-select');
  for (const f of FACTIONS) {
    if ((only && !only.includes(f.id)) || !factionListed(f.id)) continue;
    sel.append(new Option(factionOpen(f.id) ? f.name : `🔒 ${f.name}`, f.id, false, f.id === value));
  }
  sel.onchange = () => {
    const f = sel.value as Faction;
    if (!factionOpen(f)) {
      sel.value = value;
      buyOffer(host);
      return;
    }
    onPick(f);
  };
  return sel;
}

/** Окно «Полная игра»: что входит, цена, кнопка. */
export function buyOffer(host: HTMLElement = document.body, why = ''): void {
  const { box, close } = modal(host, 'g-buy');
  box.append(
    h('h2', '', 'Полная игра — ' + PRODUCT.rub + ' ₽'),
    ...(why ? [h('p', 'g-note', why)] : []),
    h('p', '', 'Один раз и навсегда, на любом устройстве с вашим аккаунтом:'),
    h('p', 'dim', '• ещё четыре края: Плотина бурь, Северный острог, Нахалов базар, Курганы предков — в «Арене», на картах и по сети;'),
    h('p', 'dim', '• кампании «Обское море», «Устав», «Навар», «Голоса» и финал «Кастет».'),
    h('p', 'dim', 'Четыре края, «Арена», случайные карты и первые две кампании остаются бесплатными.'),
  );
  const err = h('p', 'g-note');
  const go = button(signedIn ? `Купить за ${PRODUCT.rub} ₽` : 'Войти и купить', () => void buy(go, err), 'g-btn');
  box.append(go, err, button('Не сейчас', close, 'g-btn small'));
}

async function buy(btn: HTMLButtonElement, err: HTMLElement): Promise<void> {
  if (!signedIn) {
    location.href = '/geroi/';
    return;
  }
  btn.disabled = true;
  const e = await startBuy(PRODUCT.id);
  if (e) err.textContent = e;
  btn.disabled = false;
}

/** Возврат с кассы: ?buy=spasibo — спасибо (право придёт уведомлением, обычно сразу), ?buy=otmena — не вышло. */
export function buyReturn(host: HTMLElement): void {
  const v = takeBuyReturn();
  if (!v) return;
  const { box, close } = modal(host, 'g-buy');
  box.append(
    h('h2', '', v === 'spasibo' ? 'Спасибо!' : 'Оплата не прошла'),
    h('p', '', v === 'spasibo'
      ? (full ? 'Полная игра открыта: новые края и кампании ждут.' : 'Оплата принята. Если новые края ещё закрыты — обновите страницу через минуту.')
      : 'Деньги не списаны. Можно попробовать ещё раз из меню.'),
    button('Хорошо', close, 'g-btn'),
  );
}
