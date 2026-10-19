/* Кнопка «Поддержать проект» в шапке, окно с суммами и оплата через Robokassa (server/donate.ts).
 * Надпись кнопки и цель сбора задаёт Мастер — окно «Поддержка проекта» из профиля. */
import { esc } from '../core/util';
import { modal, toast, type ModalHandle } from '../core/ui';
import { Sound } from '../core/audio';
import { DONATE_AMOUNTS, DONATE_LABEL, DONATE_MAX, DONATE_MIN, LIMITS, type DonateInfo, type DonateSettings } from '../core/donate';
import './donate.css';

let info: DonateInfo = { label: DONATE_LABEL, goal: null, enabled: false };
let loaded: Promise<void> | null = null;

/** Обновить надпись на всех кнопках «Поддержать». */
function showLabel() {
  document.querySelectorAll<HTMLElement>('.bar-donate .dt').forEach((e) => (e.textContent = info.label));
  document.querySelectorAll<HTMLElement>('.bar-donate').forEach((b) => (b.title = info.goal ? info.goal.title : info.label));
}

/** Надпись и цель с сервера (один раз за загрузку; force — заново). */
export function loadDonate(force = false): Promise<void> {
  if (loaded && !force) return loaded;
  loaded = fetch('/api/donate', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((b: DonateInfo | null) => {
      if (b) info = b;
      showLabel();
    })
    .catch(() => {});
  return loaded;
}

/** Кнопка для шапки (надпись подтянется с сервера). */
export function donateButton(cls = 'btn bar-donate'): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = cls;
  b.innerHTML = `<span class="di" aria-hidden="true">♥</span> <span class="dt"></span>`;
  b.onclick = () => {
    Sound.ui();
    openDonate();
  };
  queueMicrotask(showLabel);
  void loadDonate();
  return b;
}

const rub = (n: number) => n.toLocaleString('ru-RU') + ' ₽';

function goalHtml(g: DonateInfo['goal']) {
  if (!g) return '';
  const pct = g.target ? Math.min(100, Math.round((g.collected / g.target) * 100)) : 0;
  return `<div class="don-goal"><b>${esc(g.title)}</b>${g.text ? `<p>${esc(g.text)}</p>` : ''}${
    g.target
      ? `<div class="don-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${g.target}" aria-valuenow="${g.collected}"><i style="width:${pct}%"></i></div>
         <small>Собрано ${rub(g.collected)} из ${rub(g.target)}</small>`
      : ''
  }</div>`;
}

let open: ModalHandle | null = null;

/** Окно «Поддержать проект»: готовые суммы и своя. */
export async function openDonate(): Promise<void> {
  open?.close();
  await loadDonate(true);
  const box = document.createElement('div');
  box.className = 'don';
  let amount = DONATE_AMOUNTS[1];
  box.innerHTML = `<h2>${esc(info.label)}</h2>
    <p class="hint">Сайт без рекламы и без платы за игры. Если он вам по душе — поддержите рублём: деньги идут на сервер, голосовую связь и новые игры.</p>
    ${goalHtml(info.goal)}
    <form>
      <div class="don-sums">${DONATE_AMOUNTS.map((a) => `<button type="button" data-sum="${a}"${a === amount ? ' class="on"' : ''}>${rub(a)}</button>`).join('')}</div>
      <label class="don-own">Своя сумма<span><input name="own" type="number" inputmode="numeric" min="${DONATE_MIN}" max="${DONATE_MAX}" step="1" placeholder="от ${DONATE_MIN}"> ₽</span></label>
      <p class="don-note">${
        info.enabled
          ? 'Оплата картой или через СБП на защищённой странице Robokassa. Данные карты сайт не получает. Это добровольный платёж — он не открывает платных функций.'
          : 'Приём платежей скоро откроется — спасибо, что заглянули!'
      }</p>
      <p class="err" role="alert"></p>
      <div class="row don-btns"><button type="button" class="btn" data-a="close">Не сейчас</button><button class="btn primary"${info.enabled ? '' : ' disabled'}></button></div>
    </form>`;
  open = modal(box, [], { cls: 'don-modal' });
  const form = box.querySelector('form') as HTMLFormElement;
  const own = form.querySelector('[name=own]') as HTMLInputElement;
  const pay = form.querySelector('.btn.primary') as HTMLButtonElement;
  const errEl = box.querySelector('.err') as HTMLElement;
  const show = () => {
    pay.textContent = amount ? `Поддержать на ${rub(amount)}` : 'Поддержать';
    box.querySelectorAll<HTMLButtonElement>('[data-sum]').forEach((b) => b.classList.toggle('on', Number(b.dataset.sum) === amount && !own.value));
  };
  box.querySelectorAll<HTMLButtonElement>('[data-sum]').forEach(
    (b) =>
      (b.onclick = () => {
        Sound.ui();
        own.value = '';
        amount = Number(b.dataset.sum);
        errEl.textContent = '';
        show();
      })
  );
  own.oninput = () => {
    const v = Math.floor(Number(own.value));
    amount = own.value ? v : DONATE_AMOUNTS[1];
    errEl.textContent = '';
    show();
  };
  (box.querySelector('[data-a=close]') as HTMLButtonElement).onclick = () => open?.close();
  show();
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!Number.isInteger(amount) || amount < DONATE_MIN || amount > DONATE_MAX) return void (errEl.textContent = `Сумма — от ${DONATE_MIN} до ${rub(DONATE_MAX)}.`);
    pay.disabled = true;
    try {
      const r = await fetch('/api/donate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ amount }) });
      const b = await r.json().catch(() => ({}));
      if (!r.ok || !b.form) return void (errEl.textContent = b.message || 'Не получилось начать оплату. Попробуйте ещё раз.');
      // на страницу оплаты Robokassa — обычной формой (POST)
      const f = document.createElement('form');
      f.method = 'post';
      f.action = b.form.action;
      f.acceptCharset = 'utf-8';
      for (const [k, v] of Object.entries(b.form.fields as Record<string, string>)) {
        const i = document.createElement('input');
        i.type = 'hidden';
        i.name = k;
        i.value = v;
        f.appendChild(i);
      }
      document.body.appendChild(f);
      f.submit();
    } catch {
      errEl.textContent = 'Нет связи с сервером. Проверьте интернет.';
    } finally {
      pay.disabled = false;
    }
  };
}

/** Возврат со страницы оплаты: /?donate=spasibo или /?donate=otmena. */
export function handleDonateReturn(): void {
  const q = new URLSearchParams(location.search);
  const v = q.get('donate');
  if (v !== 'spasibo' && v !== 'otmena') return;
  q.delete('donate');
  history.replaceState(history.state, '', location.pathname + (q.size ? '?' + q : '') + location.hash);
  if (v === 'spasibo') modal(`<h2>Спасибо!</h2><p>Платёж прошёл — от всего двора огромное спасибо за поддержку. Чек придёт на почту, если вы её указали.</p>`, [{ text: 'Играть', primary: true }]);
  else modal(`<h2>Оплата не прошла</h2><p>Деньги не списаны. Можно попробовать ещё раз — кнопка «${esc(info.label)}» в шапке.</p>`, [{ text: 'Хорошо', primary: true }]);
}

// ------------------------------------------------------------------ админка Мастера

interface AdminData {
  settings: DonateSettings;
  info: DonateInfo;
  total: number;
  since: number;
  recent: { id: number; rub: number; at: number; user: string | null }[];
  enabled: boolean;
}

/** Окно «Поддержка проекта» для Мастера: надпись кнопки, цель сбора, последние донаты. */
export async function openDonateAdmin(): Promise<void> {
  const r = await fetch('/api/admin/donate', { cache: 'no-store' }).catch(() => null);
  const d: AdminData | null = r?.ok ? await r.json() : null;
  if (!d) return void toast('Не удалось открыть — нужен вход Мастера.');
  const box = document.createElement('div');
  box.className = 'don don-admin';
  const s = d.settings;
  const day = (t: number) => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  box.innerHTML = `<h2>Поддержка проекта</h2>
    <p class="hint">Приём платежей: ${d.enabled ? '<b class="auth-ok">подключён</b>' : '<b class="auth-no">выключен</b> (нет ключей Robokassa на сервере)'}. Всего получено: <b>${rub(d.total)}</b>.</p>
    <form>
      <label class="field">Надпись кнопки в шапке<input name="label" maxlength="${LIMITS.label}" value="${esc(s.label)}" placeholder="${esc(DONATE_LABEL)}"></label>
      <fieldset><legend>Цель сбора (необязательно)</legend>
        <label class="field">Название<input name="goalTitle" maxlength="${LIMITS.goalTitle}" value="${esc(s.goalTitle)}" placeholder="например: «На сервер для видео»"></label>
        <label class="field">Описание<textarea name="goalText" maxlength="${LIMITS.goalText}" rows="3">${esc(s.goalText)}</textarea></label>
        <label class="field">Сколько собрать, ₽ (0 — без шкалы)<input name="goalTarget" type="number" min="0" step="1" value="${s.goalTarget || 0}"></label>
        <label class="don-check"><input type="checkbox" name="resetCollected"> Начать счёт собранного заново${d.since ? ` (сейчас — с ${day(d.since)})` : ''}</label>
      </fieldset>
      <p class="err" role="alert"></p>
      <div class="row don-btns"><button type="button" class="btn" data-a="close">Закрыть</button><button class="btn primary">Сохранить</button></div>
    </form>
    <p class="lbl">Последние поступления</p>
    ${
      d.recent.length
        ? `<ul class="don-recent">${d.recent.map((x) => `<li><b>${rub(x.rub)}</b> — ${day(x.at)}${x.user ? ' · ' + esc(x.user) : ''}</li>`).join('')}</ul>`
        : '<p class="hint">Пока ни одного.</p>'
    }`;
  const m = modal(box, [], { cls: 'don-modal' });
  const form = box.querySelector('form') as HTMLFormElement;
  (box.querySelector('[data-a=close]') as HTMLButtonElement).onclick = () => m.close();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const body: DonateSettings = {
      label: String(f.get('label') ?? ''),
      goalTitle: String(f.get('goalTitle') ?? ''),
      goalText: String(f.get('goalText') ?? ''),
      goalTarget: Number(f.get('goalTarget') ?? 0),
      resetCollected: !!f.get('resetCollected'),
    };
    const res = await fetch('/api/admin/donate', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    const b = res ? await res.json().catch(() => ({})) : {};
    if (!res?.ok) return void ((box.querySelector('.err') as HTMLElement).textContent = b.message || 'Не сохранилось. Попробуйте ещё раз.');
    info = b.info;
    showLabel();
    m.close();
    toast('Сохранено');
  };
}
