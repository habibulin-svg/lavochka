/* Окно разовой покупки (src/core/buy.ts → server/buy.ts → Robokassa): общее для игр с платной частью —
 * «Герои» (полная игра, своё оформление окна поверх startBuy/takeBuyReturn) и «Коммерсы» (второй сезон, окно buyOffer).
 * Здесь только показ и переход на кассу; право выдаёт сервер по уведомлению кассы, и он же проверяет его в сети. */
import { PRODUCTS } from './buy';
import { modal } from './ui';
import { esc } from './util';

/** Завести заказ и уйти на страницу оплаты. Вернёт текст ошибки, если не вышло (касса выключена, нет входа, нет связи). */
export async function startBuy(product: string): Promise<string | null> {
  try {
    const r = await fetch('/api/buy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ product }) });
    const b = (await r.json().catch(() => ({}))) as { form?: { action: string; fields: Record<string, string> }; message?: string };
    if (b.form) {
      goPay(b.form);
      return null;
    }
    return b.message ?? 'Оплата сейчас недоступна. Попробуйте позже.';
  } catch {
    return 'Нет связи с сервером.';
  }
}

/** На страницу оплаты Robokassa — обычной формой (POST); поля и подпись дал сервер. */
export function goPay(form: { action: string; fields: Record<string, string> }): void {
  const f = document.createElement('form');
  f.method = 'post';
  f.action = form.action;
  f.acceptCharset = 'utf-8';
  for (const [k, v] of Object.entries(form.fields)) {
    const i = document.createElement('input');
    i.type = 'hidden';
    i.name = k;
    i.value = v;
    f.appendChild(i);
  }
  document.body.appendChild(f);
  f.submit();
}

/** Возврат с кассы (?buy=spasibo|otmena, server/donate.ts): забрать метку из адреса. null — не с кассы. */
export function takeBuyReturn(): 'spasibo' | 'otmena' | null {
  const q = new URLSearchParams(location.search);
  const v = q.get('buy');
  if (v !== 'spasibo' && v !== 'otmena') return null;
  q.delete('buy');
  history.replaceState(history.state, '', location.pathname + (q.size ? `?${q}` : '') + location.hash);
  return v;
}

export interface BuyOffer {
  /** Товар из PRODUCTS. */
  product: string;
  title: string;
  /** Почему окно открылось (выбрали запертое). */
  why?: string;
  /** Что входит — строки списка. */
  lines: string[];
  /** Мелкая строка под списком: что остаётся бесплатным. */
  note?: string;
  signedIn: boolean;
  /** Не вошёл — открыть вход (покупка привязывается к аккаунту). */
  onLogin(): void;
}

/** Окно покупки: что входит, цена, «Купить» (или «Войти и купить»), «Не сейчас». */
export function buyOffer(o: BuyOffer): void {
  const p = PRODUCTS[o.product];
  if (!p) return;
  const body = document.createElement('div');
  body.className = 'buy-offer';
  body.innerHTML = `<h2>${esc(o.title)} — ${p.rub} ₽</h2>${o.why ? `<p class="buy-why">${esc(o.why)}</p>` : ''}
    <p>Один раз и навсегда, на любом устройстве с вашим аккаунтом:</p>
    <ul>${o.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
    ${o.note ? `<p class="dim">${esc(o.note)}</p>` : ''}<p class="err buy-err"></p>`;
  const err = body.querySelector('.buy-err') as HTMLElement;
  modal(body, [
    { text: 'Не сейчас' },
    {
      text: o.signedIn ? `Купить за ${p.rub} ₽` : 'Войти и купить',
      primary: true,
      action: () => {
        if (!o.signedIn) {
          o.onLogin();
          return;
        }
        err.textContent = 'Переходим к оплате…';
        void startBuy(p.id).then((e) => {
          if (e) err.textContent = e;
        });
        return false;
      },
    },
  ]);
}
