/* Обращения (server/support.ts): окно «Написать нам» / «Сообщить об ошибке», свои обращения в профиле,
 * окно «Обращения» у Мастера. Ссылка с якорем #napisat (подвал, «Контакты») открывает окно; /?obrashenie=N
 * (ссылка из письма) — переписку по обращению. */
import { esc } from '../core/util';
import { modal, toast, type ModalHandle } from '../core/ui';
import { currentUser, loadAccount, openAuth } from './account';
import { SUPPORT_EMAIL, SUPPORT_LIMITS as L, TICKET_KINDS, TICKET_STATUS, type TicketBrief, type TicketFull, type TicketKind } from '../core/support';
import './support.css';

async function call(url: string, body?: unknown): Promise<{ ok: boolean; body: any }> {
  const r = await fetch(url, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
  return { ok: !!r?.ok, body: r ? await r.json().catch(() => ({})) : { message: 'Нет связи с сервером.' } };
}

const when = (t: number) => new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/** Подробности для ошибки: игра, вариант, страница, браузер, экран. */
export interface SupportOpen {
  kind?: TicketKind;
  context?: Record<string, string>;
}

/** Окно «Написать нам». */
export async function openSupport(o: SupportOpen = {}): Promise<void> {
  await loadAccount().catch(() => {});
  const u = currentUser();
  const ctx: Record<string, string> = {
    ...(o.context ?? {}),
    страница: location.pathname + location.search,
    браузер: navigator.userAgent,
    экран: `${innerWidth}×${innerHeight} @${devicePixelRatio}`,
  };
  const kind = o.kind ?? 'question';
  const box = document.createElement('div');
  box.className = 'sup';
  box.innerHTML = `<h2>${kind === 'bug' ? 'Сообщить об ошибке' : 'Написать нам'}</h2>
    <form>
      <label class="field">О чём<select name="kind">${Object.entries(TICKET_KINDS)
        .map(([k, t]) => `<option value="${k}"${k === kind ? ' selected' : ''}>${t}</option>`)
        .join('')}</select></label>
      <label class="field">${kind === 'bug' ? 'Что случилось' : 'Сообщение'}<textarea name="text" rows="6" maxlength="${L.text}" required placeholder="${
        kind === 'bug' ? 'Что делали, что ожидали увидеть и что получилось. Чем подробнее — тем быстрее починим.' : 'Вопрос, предложение, что угодно.'
      }"></textarea></label>
      ${
        u
          ? `<p class="hint">Ответ придёт ${u.email ? `на <b>${esc(u.email)}</b> и ` : ''}в профиль — «✉ Мои обращения».</p>`
          : `<label class="field">Почта для ответа <small>(необязательно)</small><input name="email" type="email" maxlength="${L.email}" autocomplete="email" placeholder="без неё ответить не сможем"></label>`
      }
      <label class="sup-trap" aria-hidden="true">Сайт<input name="website" tabindex="-1" autocomplete="off"></label>
      <details class="sup-ctx"><summary>Что приложится само</summary><ul>${Object.entries(ctx)
        .map(([k, v]) => `<li><b>${esc(k)}:</b> ${esc(v)}</li>`)
        .join('')}</ul></details>
      <p class="err" role="alert"></p>
      <div class="row sup-btns"><button type="button" class="btn" data-a="close">Отмена</button><button class="btn primary">Отправить</button></div>
    </form>
    <p class="hint sup-mail">Или письмом: <a href="mailto:${SUPPORT_EMAIL}">${SUPPORT_EMAIL}</a></p>`;
  const m = modal(box, [], { cls: 'sup-modal' });
  const form = box.querySelector('form') as HTMLFormElement;
  (box.querySelector('[data-a=close]') as HTMLButtonElement).onclick = () => m.close();
  (box.querySelector('textarea') as HTMLTextAreaElement).focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const btn = form.querySelector('.primary') as HTMLButtonElement;
    btn.disabled = true;
    const r = await call('/api/support', {
      kind: f.get('kind'),
      text: f.get('text'),
      email: f.get('email') || undefined,
      website: f.get('website') || undefined,
      context: ctx,
    });
    btn.disabled = false;
    if (!r.ok) return void ((box.querySelector('.err') as HTMLElement).textContent = r.body.message || 'Не отправилось. Попробуйте ещё раз.');
    m.close();
    modal(
      `<h2>Спасибо!</h2><p>Обращение №${r.body.id} принято. ${
        u ? 'Ответ появится в профиле — «✉ Мои обращения»' + (r.body.email ? ' — и придёт на почту.' : '.') : r.body.email ? 'Ответим на почту.' : 'Почту вы не указали — поэтому ответить не сможем, но сообщение прочитаем.'
      }</p>`,
      [{ text: 'Хорошо', primary: true }]
    );
  };
}

// ------------------------------------------------------------------ переписка

function thread(t: TicketFull): string {
  return `<ol class="sup-thread">${t.messages
    .map((m) => `<li class="${m.staff ? 'staff' : ''}"><div class="sup-who"><b>${esc(m.author)}</b> · ${when(m.at)}</div><div class="sup-text">${esc(m.text)}</div></li>`)
    .join('')}</ol>`;
}

const badge = (s: TicketBrief['status']) => `<span class="sup-st sup-st-${s}">${TICKET_STATUS[s]}</span>`;

function list(items: TicketBrief[], staff: boolean): string {
  return items.length
    ? `<ul class="sup-list">${items
        .map(
          (t) =>
            `<li><button type="button" data-id="${t.id}"><span class="sup-no">№${t.id}</span> ${badge(t.status)} <b>${esc(t.subject)}</b><small>${esc(TICKET_KINDS[t.kind])}${
              staff ? ' · ' + esc(t.from) + (t.source === 'mail' ? ' · ✉' : '') : ''
            } · ${when(t.updatedAt)}</small></button></li>`
        )
        .join('')}</ul>`
    : '<p class="hint">Пока ни одного.</p>';
}

/** Свои обращения (профиль). */
export async function openMyTickets(): Promise<void> {
  const r = await call('/api/support');
  if (!r.ok) return void toast(r.body.message || 'Не удалось открыть.');
  const box = document.createElement('div');
  box.className = 'sup';
  box.innerHTML = `<h2>Мои обращения</h2>${list(r.body.tickets, false)}<div class="row sup-btns"><button type="button" class="btn" data-a="new">Написать нам</button><button type="button" class="btn primary" data-a="close">Закрыть</button></div>`;
  const m = modal(box, [], { cls: 'sup-modal' });
  box.querySelectorAll<HTMLButtonElement>('[data-id]').forEach((b) => (b.onclick = () => (m.close(), void openTicket(Number(b.dataset.id), false))));
  (box.querySelector('[data-a=close]') as HTMLButtonElement).onclick = () => m.close();
  (box.querySelector('[data-a=new]') as HTMLButtonElement).onclick = () => (m.close(), void openSupport());
}

/** Одно обращение: переписка и ответ (staff — окно Мастера). */
export async function openTicket(id: number, staff: boolean, back?: () => void): Promise<void> {
  const r = await call(staff ? `/api/admin/support?id=${id}` : `/api/support?id=${id}`);
  if (!r.ok) return void toast(r.body.message || 'Не удалось открыть обращение.');
  let m: ModalHandle | null = null;
  const show = (t: TicketFull, note = '') => {
    m?.close();
    const box = document.createElement('div');
    box.className = 'sup';
    box.innerHTML = `<h2>№${t.id}. ${esc(t.subject)}</h2>
      <p class="hint">${badge(t.status)} ${esc(TICKET_KINDS[t.kind])}${staff ? ` · ${esc(t.from)}${t.email ? ` &lt;${esc(t.email)}&gt;` : ' · <b>без почты</b>' + (t.source === 'site' ? '' : '')}` : ''}</p>
      ${staff && t.context ? `<details class="sup-ctx"><summary>Подробности</summary><pre>${esc(t.context)}</pre></details>` : ''}
      ${thread(t)}
      ${note ? `<p class="hint">${note}</p>` : ''}
      <form><label class="field">${staff ? 'Ответ' + (t.email ? ' (уйдёт письмом)' : ' (только на сайте)') : 'Дописать'}<textarea name="text" rows="4" maxlength="${L.text}"></textarea></label>
      <p class="err" role="alert"></p>
      <div class="row sup-btns">
        <button type="button" class="btn" data-a="back">${back ? '← К списку' : 'Закрыть'}</button>
        ${staff ? `<select name="status" title="Состояние">${Object.entries(TICKET_STATUS).map(([k, s]) => `<option value="${k}"${k === (t.status === 'new' ? 'open' : t.status) ? ' selected' : ''}>${s}</option>`).join('')}</select>` : ''}
        <button class="btn primary">Отправить</button>
      </div></form>`;
    m = modal(box, [], { cls: 'sup-modal sup-wide' });
    (box.querySelector('[data-a=back]') as HTMLButtonElement).onclick = () => (m!.close(), back?.());
    const form = box.querySelector('form') as HTMLFormElement;
    form.onsubmit = async (e) => {
      e.preventDefault();
      const f = new FormData(form);
      const text = String(f.get('text') ?? '').trim();
      const status = f.get('status');
      if (!text && !(staff && status !== t.status)) return void ((box.querySelector('.err') as HTMLElement).textContent = 'Пустое сообщение.');
      const res = staff ? await call('/api/admin/support', { id: t.id, text, status }) : await call('/api/support/reply', { id: t.id, text });
      if (!res.ok) return void ((box.querySelector('.err') as HTMLElement).textContent = res.body.message || 'Не отправилось.');
      show(res.body.ticket, res.body.mailed === false ? '⚠ Ответ сохранён, но письмом не ушёл (предел писем или сбой почты).' : res.body.mailed ? 'Ответ ушёл письмом.' : '');
    };
  };
  show(r.body.ticket);
}

/** Окно Мастера: все обращения (сначала — ждущие ответа). */
export async function openSupportAdmin(filter: 'new' | '' = 'new'): Promise<void> {
  const r = await call('/api/admin/support' + (filter ? '?status=' + filter : ''));
  if (!r.ok) return void toast(r.body.message || 'Не удалось открыть — нужен вход Мастера.');
  const box = document.createElement('div');
  box.className = 'sup';
  box.innerHTML = `<h2>Обращения</h2>
    <p class="hint">Ждут ответа: <b>${r.body.fresh}</b>. Письма на ${SUPPORT_EMAIL}, bugs@, admin@ попадают сюда же.${r.body.mail ? '' : ' <b class="auth-no">Почта сайта выключена — ответы письмами не уйдут.</b>'}</p>
    <p class="row sup-tabs"><button type="button" class="btn small${filter === 'new' ? ' primary' : ''}" data-f="new">Ждут ответа</button><button type="button" class="btn small${filter === '' ? ' primary' : ''}" data-f="">Все</button></p>
    ${list(r.body.tickets, true)}
    <div class="row sup-btns"><button type="button" class="btn primary" data-a="close">Закрыть</button></div>`;
  const m = modal(box, [], { cls: 'sup-modal sup-wide' });
  (box.querySelector('[data-a=close]') as HTMLButtonElement).onclick = () => m.close();
  box.querySelectorAll<HTMLButtonElement>('[data-f]').forEach((b) => (b.onclick = () => (m.close(), void openSupportAdmin(b.dataset.f as 'new' | ''))));
  box.querySelectorAll<HTMLButtonElement>('[data-id]').forEach(
    (b) => (b.onclick = () => (m.close(), void openTicket(Number(b.dataset.id), true, () => void openSupportAdmin(filter))))
  );
}

/** /?obrashenie=N — из письма: Мастеру — его окно, автору — своя переписка, гостю — вход. */
export async function handleTicketLink(): Promise<void> {
  const q = new URLSearchParams(location.search);
  const id = Number(q.get('obrashenie'));
  q.delete('obrashenie');
  history.replaceState(history.state, '', location.pathname + (q.size ? '?' + q : '') + location.hash);
  if (!id) return;
  await loadAccount().catch(() => {});
  const u = currentUser();
  if (!u) return openAuth('login');
  void openTicket(id, u.rights.some((g) => g.right === 'master'));
}

/** Ссылки «Написать нам» (…#napisat) по всему сайту открывают окно, а не уводят на страницу «Контакты». */
export function wireSupportLinks(): void {
  document.addEventListener('click', (e) => {
    const a = (e.target as Element | null)?.closest?.('a[href$="#napisat"]');
    if (!a || e.defaultPrevented || (e as MouseEvent).ctrlKey || (e as MouseEvent).metaKey) return;
    e.preventDefault();
    void openSupport();
  }, true); // раньше роутера сайта (main.ts), который уводит по ссылкам
}
