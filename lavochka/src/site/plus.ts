/* Подписка «Лавочка+» на сайте (server/plus.ts): окно с составом и оплатой, статус и история в профиле,
 * записки «это в подписке» (камера за столом, ранний доступ), список подписок для Мастера.
 * Ссылки на окно: <a href="#plus"> или [data-plus] — на любой странице, в том числе в тексте /podpiska/. */
import { esc } from '../core/util';
import { modal, toast, type ModalHandle } from '../core/ui';
import { Sound } from '../core/audio';
import { hasRight } from '../core/rights';
import { PLUS_NAME, PLUS_PAGE, PLUS_PRICE, type PlusRow, type PlusStatus } from '../core/plus';
import { currentUser, loadAccount, openAuth } from './account';
import { goPay } from './donate';
import './plus.css';

const rub = (n: number) => n.toLocaleString('ru-RU') + ' ₽';
const date = (t: number) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' });

/** Есть ли у вошедшего право (подпиской, от Мастера или группы). */
export const mayVideo = () => hasRight(currentUser()?.rights ?? [], 'video');
/** Оформление из подписки (колода «Классическая»). */
export const mayCosmetics = () => hasRight(currentUser()?.rights ?? [], 'cosmetics');

const WHAT = `<ul class="plus-what">
  <li><b>📷 Видео за столом</b> — камера в сетевой партии, друзья видят вас, а не только слышат.</li>
  <li><b>🔑 Ранний доступ</b> — новые игры открываются подписчикам раньше всех.</li>
  <li><b>🧔 Михалыч</b> — руководитель шахматного кружка, помощник на ИИ: объяснит, почему ход ошибочный, намекнёт, куда смотреть в задаче, разберёт ваш ход.</li>
  <li><b>🃏 Димон</b> — помощник в покере: подскажет, что делать в раздаче, разберёт сыгранную руку, статистику соперника и ваш турнир.</li>
  <li><b>🔮 Светка</b> — гадалка с нашего двора, помощница на ИИ: растолкует расклад на таро или на обычной колоде целиком, по всем картам вместе.</li>
  <li><b>♠ Колода «Классическая»</b> — карты как в покер-клубе (J, Q, K, A) во всех играх с французской колодой.</li>
  <li><b>✨ Дальше</b> — новое оформление и помощники в других играх.</li>
</ul>`;

async function status(): Promise<PlusStatus | null> {
  try {
    const r = await fetch('/api/plus', { cache: 'no-store' });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

async function post(path: string, body: object): Promise<{ ok: boolean; body: any }> {
  try {
    const r = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { ok: r.ok, body: await r.json().catch(() => ({})) };
  } catch {
    return { ok: false, body: { message: 'Нет связи с сервером. Проверьте интернет.' } };
  }
}

/** Строка статуса: «Лавочка+ до 21 ноября» или ничего. */
export function plusLine(s: PlusStatus): string {
  if (!s.until) return '';
  const live = s.until > Date.now();
  return live
    ? `<b class="auth-ok">✔ ${PLUS_NAME} до ${date(s.until)}</b>${s.autorenew ? ' <small>(продлится сама)</small>' : ''}`
    : `<span class="auth-no">${PLUS_NAME} закончилась ${date(s.until)}</span>`;
}

let open: ModalHandle | null = null;

/** Окно «Лавочка+»: что входит, срок, оплата, история, автопродление. */
export async function openPlus(): Promise<void> {
  open?.close();
  await loadAccount();
  if (!currentUser()) {
    toast('Чтобы оформить подписку, войдите — она привязывается к аккаунту', 4000);
    return openAuth('login');
  }
  const s = await status();
  if (!s) return void toast('Сервер не ответил. Попробуйте чуть позже.');
  const live = !!s.until && s.until > Date.now();
  // подписка по ссылке Robokassa: оформить (если ещё не продлевается) или как отменить (если продлевается)
  const viaLink = s.link && !s.recurring;
  const linkOn = viaLink && s.autorenew;
  const box = document.createElement('div');
  box.className = 'don plus';
  box.innerHTML = `<h2>${PLUS_NAME}</h2>
    ${s.until ? `<p class="plus-state">${plusLine(s)}</p>` : '<p class="hint">Все игры бесплатны, голос за столом — тоже. Подписка добавляет сверху:</p>'}
    ${WHAT}
    ${
      viaLink
        ? `<p class="plus-price"><b>${rub(s.price)}</b> в месяц${linkOn ? '' : ' — с автопродлением или разово на месяц'}.</p>`
        : `<p class="plus-price"><b>${rub(s.price)}</b> за месяц${live ? ' — новый месяц прибавится к оставшемуся сроку' : ''}.</p>`
    }
    ${
      s.recurring && !s.autorenew
        ? `<label class="don-check plus-agree"><input type="checkbox" name="autorenew"> Продлевать самой: раз в месяц списывать ${rub(s.price)} с этой карты, пока не отменю. Отменить — в любой момент здесь же.</label>`
        : ''
    }
    <p class="don-note">${
      !s.enabled
        ? 'Приём оплаты скоро откроется — спасибо, что заглянули!'
        : linkOn
          ? `Подписка продлевается сама: раз в месяц Robokassa списывает ${rub(s.price)} с карты и заранее присылает напоминание. Отменить — по ссылке «отписаться» в письме от robot@robokassa.ru; оплаченный срок останется.`
          : viaLink
            ? `<b>С автопродлением</b> — оплата картой на странице Robokassa, дальше она сама списывает ${rub(s.price)} раз в месяц, пока не отпишетесь (ссылка — в её письме). ${
                s.email ? `Почту на её странице оставьте <b>${esc(s.email)}</b> — по ней подписка привяжется к аккаунту.` : '<b>Нужна подтверждённая почта в профиле</b> — по ней подписка привяжется к аккаунту.'
              } <b>Разово</b> — картой или СБП, без списаний; к концу срока пришлём напоминание. Данные карты сайт не получает. Условия — <a href="/oferta/" target="_blank">оферта</a> и <a href="${PLUS_PAGE}" target="_blank">страница подписки</a>.`
            : `Оплата картой или через СБП на странице Robokassa, данные карты сайт не получает. ${s.recurring ? '' : 'Без автопродления: когда срок подойдёт к концу, пришлём напоминание на почту. '}Условия — <a href="/oferta/" target="_blank">оферта</a> и <a href="${PLUS_PAGE}" target="_blank">страница подписки</a>.`
    }</p>
    <p class="err" role="alert"></p>
    <div class="row don-btns">${
      linkOn
        ? '<button type="button" class="btn primary" data-a="close">Хорошо</button>'
        : viaLink
          ? `<button type="button" class="btn" data-a="close">Не сейчас</button><button type="button" class="btn" data-a="pay"${s.enabled ? '' : ' disabled'}>Разово на месяц</button><button type="button" class="btn primary" data-a="sub"${s.email ? '' : ' disabled'}>С автопродлением</button>`
          : `${s.autorenew ? '<button type="button" class="btn" data-a="cancel">Отменить автопродление</button>' : ''}<button type="button" class="btn" data-a="close">Не сейчас</button><button type="button" class="btn primary" data-a="pay"${s.enabled ? '' : ' disabled'}>${live ? 'Продлить на месяц' : `Оформить ${PLUS_NAME}`}</button>`
    }</div>
    ${
      s.payments.length
        ? `<p class="lbl">Оплаты</p><ul class="don-recent">${s.payments
            .map((p) => `<li><b>${rub(p.rub)}</b> — ${date(p.at)}${p.auto ? ' (автопродление)' : ''}, срок до ${date(p.until)}</li>`)
            .join('')}</ul>`
        : ''
    }`;
  open = modal(box, [], { cls: 'don-modal' });
  const errEl = box.querySelector('.err') as HTMLElement;
  (box.querySelector('[data-a=close]') as HTMLButtonElement).onclick = () => open?.close();
  const cancel = box.querySelector('[data-a=cancel]') as HTMLButtonElement | null;
  if (cancel)
    cancel.onclick = async () => {
      const r = await post('/api/plus/autorenew', { on: false });
      if (!r.ok) return void (errEl.textContent = r.body.message || 'Не получилось. Попробуйте ещё раз.');
      toast(`Автопродление отменено. ${PLUS_NAME} действует до ${date(r.body.until)}`, 5000);
      void openPlus();
    };
  const subBtn = box.querySelector('[data-a=sub]') as HTMLButtonElement | null;
  if (subBtn)
    subBtn.onclick = async () => {
      Sound.ui();
      subBtn.disabled = true;
      const r = await post('/api/plus/link', {});
      subBtn.disabled = false;
      if (!r.ok || !r.body.url) return void (errEl.textContent = r.body.message || 'Не получилось открыть подписку. Попробуйте ещё раз.');
      location.href = r.body.url;
    };
  const pay = box.querySelector('[data-a=pay]') as HTMLButtonElement | null;
  if (pay) pay.onclick = async () => {
    Sound.ui();
    pay.disabled = true;
    const agree = box.querySelector('[name=autorenew]') as HTMLInputElement | null;
    const r = await post('/api/plus', { autorenew: !!agree?.checked });
    pay.disabled = false;
    if (!r.ok || !r.body.form) return void (errEl.textContent = r.body.message || 'Не получилось начать оплату. Попробуйте ещё раз.');
    goPay(r.body.form);
  };
}

/** Записка «это в подписке»: камера за столом или игра раннего доступа. */
export function plusNote(what: 'video' | 'early' | 'deck', title?: string): void {
  const text =
    what === 'video'
      ? `<p><b>Видео за столом</b> — в подписке «${PLUS_NAME}». Голос остаётся бесплатным: можно войти в разговор и без камеры.</p><p>Камеры подписчиков за этим столом видно всем.</p>`
      : what === 'deck'
        ? `<p><b>Колода «Классическая»</b> — в подписке «${PLUS_NAME}»: карты как в покер-клубе во всех играх с французской колодой. Три советские колоды остаются бесплатными.</p>`
        : `<p>${title ? `«${esc(title)}» пока` : 'Эта игра пока'} в <b>раннем доступе</b> — её первыми пробуют подписчики «${PLUS_NAME}». Для всех она откроется совсем скоро.</p>`;
  modal(`<h2>${what === 'video' ? '📷 Камера' : what === 'deck' ? '♠ Колода' : esc(title ?? 'Ранний доступ')}</h2>${text}<p class="hint">${rub(PLUS_PRICE / 100)} в месяц · <a href="${PLUS_PAGE}">что входит</a></p>`, [
    { text: 'Ладно' },
    { text: `Оформить ${PLUS_NAME}`, primary: true, action: () => void openPlus() },
  ]);
}

/** Возврат со страницы оплаты: /?plus=spasibo или /?plus=otmena. */
export function handlePlusReturn(): void {
  const q = new URLSearchParams(location.search);
  const v = q.get('plus');
  if (v !== 'spasibo' && v !== 'otmena') return;
  q.delete('plus');
  history.replaceState(history.state, '', location.pathname + (q.size ? '?' + q : '') + location.hash);
  if (v === 'otmena') return void modal(`<h2>Оплата не прошла</h2><p>Деньги не списаны. Попробовать ещё раз можно в профиле или на <a href="${PLUS_PAGE}">странице подписки</a>.</p>`, [{ text: 'Хорошо', primary: true }]);
  // уведомление Robokassa может прийти на пару секунд позже покупателя — подождём его
  void (async () => {
    let s: PlusStatus | null = null;
    for (let i = 0; i < 6; i++) {
      s = await status();
      if (s?.until && s.until > Date.now()) break;
      await new Promise((r) => setTimeout(r, 2000));
    }
    await loadAccount(true);
    const live = !!s?.until && s.until > Date.now();
    modal(
      live
        ? `<h2>Спасибо!</h2><p>«${PLUS_NAME}» оформлена до <b>${date(s!.until!)}</b>: камера за столом, ранний доступ, помощники и колода «Классическая» уже открыты. Чек придёт на почту.</p>`
        : `<h2>Спасибо!</h2><p>Платёж прошёл, подписка включится, как только платёжный сервис подтвердит его — обычно за минуту. Если не включилась — напишите нам, разберёмся.</p>`,
      [{ text: 'Играть', primary: true }]
    );
  })();
}

/** Ссылки «#plus» и кнопки [data-plus] открывают окно подписки. */
export function wirePlusLinks(): void {
  document.addEventListener(
    'click',
    (e) => {
      const a = (e.target as Element | null)?.closest?.('a[href$="#plus"], [data-plus]');
      if (!a || e.defaultPrevented || (e as MouseEvent).ctrlKey || (e as MouseEvent).metaKey) return;
      e.preventDefault();
      void openPlus();
    },
    true
  );
}

// ------------------------------------------------------------------ Мастеру

/** Подписки игроков (админка → «Подписки»): у кого, до какого числа, сколько оплачено. */
export async function drawPlusAdmin(body: HTMLElement): Promise<void> {
  const r = await fetch('/api/admin/plus', { cache: 'no-store' }).catch(() => null);
  const d: { list: PlusRow[]; active: number; enabled: boolean; recurring: boolean; link: boolean } | null = r?.ok ? await r.json() : null;
  if (!d) return void (body.innerHTML = '<div class="adm-card"><p>Не загрузилось — нужен вход Мастера.</p></div>');
  const now = Date.now();
  const total = d.list.reduce((a, x) => a + x.rub, 0);
  body.innerHTML = `<div class="adm-head"><h1>Подписки «${PLUS_NAME}»</h1></div>
    <div class="adm-card"><p>Оплата: ${d.enabled ? '<b class="auth-ok">подключена</b>' : '<b class="auth-no">выключена</b> (нет ключей Robokassa)'}, автопродление: ${
      d.recurring
        ? '<b class="auth-ok">включено</b>'
        : d.link
          ? '<b class="auth-ok">подпиской по ссылке Robokassa</b> (подписчики и отмены — в её кабинете, «Подписки»)'
          : '<b class="auth-no">выключено</b> (ROBOKASSA_RECURRING / ROBOKASSA_SUBSCRIPTION)'
    }. Действуют сейчас: <b>${d.active}</b>, всего получено: <b>${rub(total)}</b>.</p></div>
    <div class="adm-card">${
      d.list.length
        ? `<table class="adm-table"><thead><tr><th>№</th><th>Игрок</th><th>До</th><th>Оплат</th><th>Получено</th></tr></thead><tbody>${d.list
            .map(
              (x) =>
                `<tr${x.until > now ? '' : ' class="adm-muted"'}><td>${x.userId}</td><td>${esc(x.name)}${x.email ? ` <span class="adm-muted">${esc(x.email)}</span>` : ''}</td><td>${date(x.until)}${
                  x.until > now ? '' : ' (кончилась)'
                }${x.autorenew ? ' ↻' : ''}</td><td>${x.payments}</td><td>${rub(x.rub)}</td></tr>`
            )
            .join('')}</tbody></table>`
        : '<p class="adm-muted">Пока ни одной.</p>'
    }</div>`;
}
