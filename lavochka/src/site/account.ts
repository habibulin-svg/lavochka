/* Аккаунт игрока на сайте: кто вошёл (/api/auth/me), окно входа и регистрации, профиль.
 * Сессия — httpOnly-cookie, её ставит и стирает сервер; здесь — только показ. Играть можно и без входа.
 * Ссылки из писем ведут на /vhod/?podtverdit=… и /vhod/?sbros=… — их разбирает роутер (main.ts → handleAuthRoute). */
import { esc } from '../core/util';
import { modal, toast, type ModalHandle } from '../core/ui';
import { Sound } from '../core/audio';
import { RIGHTS, type RightGrant } from '../core/rights';
import { onSettings, saveSettings, settings } from '../core/settings';
import './account.css';

export interface Me {
  id: number;
  name: string;
  email: string | null;
  verified: boolean;
  rights: RightGrant[];
  /** Привязанные входы: yandex, vk. */
  providers: string[];
  /** Есть ли пароль. */
  password: boolean;
}

let me: Me | null = null;
let mailOn = false;
/** Какие входы через сервисы включены на сервере. */
let loginWith: string[] = [];
let loaded: Promise<void> | null = null;
const subs = new Set<(m: Me | null) => void>();

/** Кто вошёл (null — гость). */
export const currentUser = () => me;

/** Подписаться на вход/выход (сразу вызывается с текущим). */
export function onAccount(f: (m: Me | null) => void): () => void {
  subs.add(f);
  f(me);
  return () => subs.delete(f);
}

function setMe(m: Me | null) {
  me = m;
  // имя за столом — из аккаунта
  if (me && settings.name !== me.name) {
    settings.name = me.name;
    saveSettings();
  }
  subs.forEach((f) => f(me));
}

// имя сменили в настройках — сохранить и в аккаунте (с паузой: поле сохраняется на каждый знак)
let nameTimer = 0;
onSettings(() => {
  clearTimeout(nameTimer);
  if (!me || settings.name === me.name) return;
  nameTimer = window.setTimeout(async () => {
    const name = settings.name;
    if (!me || name === me.name || name.length < 2 || name.length > 24) return;
    const r = await post('profile', { name });
    if (r.ok) setMe(r.body.user);
  }, 1200);
});

/** Узнать у сервера, кто вошёл (один раз за загрузку страницы; force — заново). */
export function loadAccount(force = false): Promise<void> {
  if (loaded && !force) return loaded;
  loaded = fetch('/api/auth/me', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((b) => {
      if (!b) return;
      mailOn = !!b.mail;
      loginWith = Array.isArray(b.loginWith) ? b.loginWith : [];
      setMe(b.user ?? null);
    })
    .catch(() => {});
  return loaded;
}

interface ApiReply {
  ok: boolean;
  status: number;
  body: any;
}

async function post(action: string, body: object = {}): Promise<ApiReply> {
  try {
    const r = await fetch('/api/auth/' + action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const b = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, body: b };
  } catch {
    return { ok: false, status: 0, body: { message: 'Нет связи с сервером. Проверьте интернет.' } };
  }
}

const errText = (r: ApiReply) => r.body?.message || (r.status === 503 ? 'Вход временно недоступен. Играть можно и без него.' : 'Что-то пошло не так. Попробуйте ещё раз.');

// ------------------------------------------------------------------ вход через Яндекс ID и VK ID

export const PROVIDERS: Record<string, string> = { yandex: 'Яндекс ID', vk: 'VK ID' };

/** Адрес начала входа через сервис (сервер уведёт на его страницу и вернёт сюда же). */
const startUrl = (p: string) => `/api/auth/${p}/start?` + new URLSearchParams({ back: location.pathname + location.search });

function socialHtml(): string {
  if (!loginWith.length) return '';
  const b: string[] = [];
  if (loginWith.includes('yandex')) b.push(`<a class="soc soc-ya" href="${startUrl('yandex')}"><i>Я</i>Яндекс ID</a>`);
  if (loginWith.includes('vk')) b.push(`<a class="soc soc-vk" href="${startUrl('vk')}" title="ВКонтакте, Одноклассники, Mail"><i>VK</i>VK ID</a>`);
  return `<div class="auth-soc">${b.join('')}</div><p class="auth-or"><span>или по почте</span></p>`;
}

const OAUTH_ERRORS: Record<string, string> = {
  otmena: 'Вход отменён.',
  ustarelo: 'Вход устарел — попробуйте ещё раз.',
  servis: 'Сервис входа не ответил. Попробуйте ещё раз или войдите по почте.',
  master: 'Мастер входит только по почте, паролю и коду из приложения.',
  linked: 'Этот вход уже привязан к другому аккаунту.',
  banned: 'Вход для этого аккаунта закрыт.',
  often: 'Слишком много регистраций с этого адреса. Попробуйте через час.',
  'net-vhoda': 'Этот способ входа пока не подключён.',
};

/** Вернулись со страницы сервиса: ?voshel=… / ?privyazan=… — сказать и убрать из адреса. */
export function handleOAuthReturn(): void {
  const q = new URLSearchParams(location.search);
  const p = q.get('voshel') ?? q.get('privyazan');
  if (!p) return;
  const linked = q.has('privyazan');
  q.delete('voshel');
  q.delete('privyazan');
  history.replaceState(history.state, '', location.pathname + (q.size ? '?' + q : '') + location.hash);
  void loadAccount(true).then(() => {
    if (linked) toast(`${PROVIDERS[p] ?? p} привязан к аккаунту`);
    else if (me) toast(`Вы вошли как ${me.name}`);
  });
}

// ------------------------------------------------------------------ окно входа

type View = 'login' | 'register' | 'forgot';

let open: ModalHandle | null = null;

/** Окно входа / регистрации. Вошёл — открывается профиль. */
export function openAuth(view: View = 'login'): void {
  if (me) return openProfile();
  open?.close();
  const box = document.createElement('div');
  box.className = 'auth';
  open = modal(box, [], { cls: 'auth-modal' });
  render(box, view);
}

function render(box: HTMLElement, view: View, email = '') {
  const tabs = `<div class="auth-tabs seg"><button type="button" data-v="login" class="${view === 'login' ? 'on' : ''}">Вход</button><button type="button" data-v="register" class="${
    view === 'register' ? 'on' : ''
  }">Регистрация</button></div>`;
  const emailField = `<label class="field">Почта<input type="email" name="email" autocomplete="email" required maxlength="120" value="${esc(email)}"></label>`;
  if (view === 'forgot') {
    box.innerHTML = `<h2>Восстановить пароль</h2>
      <p class="hint">Пришлём на почту ссылку, по которой можно задать новый пароль.</p>
      <form>${emailField}<p class="err" role="alert"></p>
      <div class="row auth-btns"><button type="button" class="btn" data-v="login">Назад</button><button class="btn primary">Прислать ссылку</button></div></form>`;
  } else {
    const reg = view === 'register';
    box.innerHTML = `${tabs}
      <h2>${reg ? 'Регистрация' : 'Вход'}</h2>
      <p class="hint">${reg ? 'Аккаунт хранит рекорды, партии и настройки. Играть можно и без него.' : 'Войдите, чтобы ваши рекорды и настройки были с вами на любом устройстве.'}</p>
      ${socialHtml()}${
        reg && loginWith.length
          ? '<p class="auth-soc-note">Входя через сервис, вы соглашаетесь с <a href="/usloviya/" target="_blank">условиями</a> и <a href="/politika/" target="_blank">политикой конфиденциальности</a>.</p>'
          : ''
      }
      <form>
        ${reg ? `<label class="field">Имя за столом<input name="name" autocomplete="nickname" maxlength="24" placeholder="как вас звать во дворе"></label>` : ''}
        ${emailField}
        <label class="field">Пароль<input type="password" name="password" autocomplete="${reg ? 'new-password' : 'current-password'}" required minlength="${reg ? 8 : 1}" maxlength="200"${reg ? ' placeholder="от 8 знаков"' : ''}></label>
        <label class="field auth-totp" hidden>Код из приложения<input name="totp" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="\\d{6}" placeholder="6 цифр"></label>
        ${
          reg
            ? `<label class="auth-consent"><input type="checkbox" name="consent" required> <span>Соглашаюсь с <a href="/usloviya/" target="_blank">условиями</a> и на обработку персональных данных по <a href="/politika/" target="_blank">политике конфиденциальности</a></span></label>`
            : `<p class="auth-forgot"><a href="#" data-v="forgot">Забыли пароль?</a></p>`
        }
        <p class="err" role="alert"></p>
        <div class="row auth-btns"><button class="btn primary">${reg ? 'Зарегистрироваться' : 'Войти'}</button></div>
      </form>`;
  }
  box.querySelectorAll<HTMLElement>('[data-v]').forEach(
    (b) =>
      (b.onclick = (e) => {
        e.preventDefault();
        Sound.ui();
        render(box, b.dataset.v as View, (box.querySelector('[name=email]') as HTMLInputElement | null)?.value ?? email);
      })
  );
  const form = box.querySelector('form') as HTMLFormElement;
  const errEl = box.querySelector('.err') as HTMLElement;
  const btn = form.querySelector('.btn.primary') as HTMLButtonElement;
  (form.querySelector(view === 'register' ? '[name=name]' : '[name=email]') as HTMLInputElement)?.focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(form)) as Record<string, string>;
    errEl.textContent = '';
    btn.disabled = true;
    try {
      if (view === 'forgot') {
        const r = await post('forgot', { email: data.email });
        if (!r.ok) return void (errEl.textContent = errText(r));
        open?.close();
        modal(`<h2>Письмо отправлено</h2><p>Если на ${esc(data.email)} есть аккаунт, туда придёт ссылка для нового пароля. Она действует два часа. Не видно письма — загляните в «Спам».</p>`, [{ text: 'Хорошо', primary: true }]);
        return;
      }
      const reg = view === 'register';
      const r = await post(reg ? 'register' : 'login', reg ? { ...data, consent: !!data.consent } : data);
      if (r.ok && r.body.need === 'totp') {
        const t = box.querySelector('.auth-totp') as HTMLElement;
        t.hidden = false;
        (t.querySelector('input') as HTMLInputElement).focus();
        errEl.textContent = 'Введите код из приложения-генератора.';
        return;
      }
      if (!r.ok) return void (errEl.textContent = errText(r));
      setMe(r.body.user);
      open?.close();
      Sound.ui();
      if (reg)
        modal(
          `<h2>Добро пожаловать во двор!</h2><p>Аккаунт создан, вы вошли как <b>${esc(r.body.user.name)}</b>.</p>${
            r.body.mailSent ? `<p>На ${esc(r.body.user.email)} отправлено письмо — откройте ссылку в нём, чтобы подтвердить почту.</p>` : ''
          }`,
          [{ text: 'Играть', primary: true }]
        );
      else toast(`Вы вошли как ${r.body.user.name}`);
    } finally {
      btn.disabled = false;
    }
  };
}

// ------------------------------------------------------------------ профиль

const until = (g: RightGrant) => (g.until ? ' — до ' + new Date(g.until).toLocaleDateString('ru-RU') : '');

export function openProfile(): void {
  if (!me) return openAuth();
  open?.close();
  const u = me;
  const box = document.createElement('div');
  box.className = 'auth';
  box.innerHTML = `<h2>Профиль</h2>
    <form class="auth-name"><label class="field">Имя за столом<span class="row"><input name="name" maxlength="24" value="${esc(u.name)}"><button class="btn">Сохранить</button></span></label></form>
    <p><span class="lbl">Почта:</span> ${esc(u.email ?? '—')} ${
      u.email ? (u.verified ? '<span class="auth-ok">✔ подтверждена</span>' : `<span class="auth-no">не подтверждена</span>${mailOn ? ' <button type="button" class="btn small" data-a="resend">Прислать письмо ещё раз</button>' : ''}`) : ''
    }</p>
    ${
      loginWith.length || u.providers.length
        ? `<p class="lbl">Вход через сервисы</p><ul class="auth-links">${[...new Set([...loginWith, ...u.providers])]
            .map((p) =>
              u.providers.includes(p)
                ? `<li>${PROVIDERS[p] ?? p} <span class="auth-ok">✔ привязан</span> <button type="button" class="btn small" data-unlink="${p}">Отвязать</button></li>`
                : `<li>${PROVIDERS[p] ?? p} <a class="btn small" href="${startUrl(p)}">Привязать</a></li>`
            )
            .join('')}</ul>`
        : ''
    }
    ${u.rights.length ? `<p class="lbl">Права</p><ul class="auth-rights">${u.rights.map((g) => `<li>${esc(RIGHTS[g.right as keyof typeof RIGHTS] ?? g.right)}${until(g)}</li>`).join('')}</ul>` : ''}
    <p><button type="button" class="btn small" data-a="history">📜 Мои партии</button></p>
    ${u.rights.some((g) => g.right === 'master') ? `<p><button type="button" class="btn small" data-a="donate">♥ Поддержка проекта: надпись и цель</button></p>` : ''}
    <p class="err" role="alert"></p>
    <div class="row auth-btns"><button type="button" class="btn" data-a="logout">Выйти</button><button type="button" class="btn primary" data-a="close">Закрыть</button></div>`;
  open = modal(box, [], { cls: 'auth-modal' });
  const errEl = box.querySelector('.err') as HTMLElement;
  (box.querySelector('.auth-name') as HTMLFormElement).onsubmit = async (e) => {
    e.preventDefault();
    const name = (box.querySelector('[name=name]') as HTMLInputElement).value;
    const r = await post('profile', { name });
    if (!r.ok) return void (errEl.textContent = errText(r));
    setMe(r.body.user);
    toast('Имя сохранено');
  };
  const act = (a: string, f: () => void) => {
    const b = box.querySelector(`[data-a=${a}]`) as HTMLButtonElement | null;
    if (b) b.onclick = f;
  };
  act('close', () => open?.close());
  act('history', () => {
    open?.close();
    void import('./history').then((h) => h.openHistory());
  });
  act('donate', () => {
    open?.close();
    void import('./donate').then((d) => d.openDonateAdmin());
  });
  act('logout', () => {
    open?.close();
    void logout();
  });
  box.querySelectorAll<HTMLButtonElement>('[data-unlink]').forEach(
    (b) =>
      (b.onclick = async () => {
        const r = await post('unlink', { provider: b.dataset.unlink });
        if (!r.ok) return void (errEl.textContent = errText(r));
        setMe(r.body.user);
        openProfile();
        toast('Вход отвязан');
      })
  );
  act('resend', async () => {
    const r = await post('resend');
    if (!r.ok) return void (errEl.textContent = errText(r));
    toast('Письмо отправлено — загляните в почту');
  });
}

/** Выйти из аккаунта (кнопка в шапке и в профиле). */
export async function logout(): Promise<void> {
  await post('logout');
  setMe(null);
  toast('Вы вышли. Играть можно и без входа.');
}

// ------------------------------------------------------------------ ссылки из писем

/** /vhod/?podtverdit=… — подтвердить почту; /vhod/?sbros=… — окно нового пароля; просто /vhod/ — окно входа. */
export async function handleAuthRoute(r: { confirm?: string; reset?: string; error?: string }) {
  await loadAccount();
  if (r.error) {
    openAuth();
    const e = document.querySelector('.auth .err');
    if (e) e.textContent = OAUTH_ERRORS[r.error] ?? 'Не получилось войти через сервис. Попробуйте ещё раз.';
    return;
  }
  if (r.confirm) {
    const res = await post('confirm', { token: r.confirm });
    if (res.ok) {
      if (res.body.user) setMe(res.body.user);
      modal(`<h2>Почта подтверждена</h2><p>Спасибо! Теперь пароль можно восстановить через почту, если забудете.</p>`, [{ text: 'Во двор', primary: true }]);
    } else modal(`<h2>Ссылка не сработала</h2><p>${esc(errText(res))}</p><p>Новое письмо можно запросить в профиле.</p>`, [{ text: 'Хорошо', primary: true }]);
    return;
  }
  if (r.reset) return openReset(r.reset);
  openAuth();
}

function openReset(token: string) {
  open?.close();
  const box = document.createElement('div');
  box.className = 'auth';
  box.innerHTML = `<h2>Новый пароль</h2>
    <form><label class="field">Новый пароль<input type="password" name="password" autocomplete="new-password" required minlength="8" maxlength="200" placeholder="от 8 знаков"></label>
    <p class="err" role="alert"></p><div class="row auth-btns"><button class="btn primary">Сохранить и войти</button></div></form>`;
  open = modal(box, [], { cls: 'auth-modal' });
  const form = box.querySelector('form') as HTMLFormElement;
  (form.querySelector('input') as HTMLInputElement).focus();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const r = await post('reset', { token, password: (form.querySelector('input') as HTMLInputElement).value });
    if (!r.ok) return void ((box.querySelector('.err') as HTMLElement).textContent = errText(r));
    open?.close();
    if (r.body.user) {
      setMe(r.body.user);
      toast('Пароль сменён, вы вошли');
    } else {
      toast('Пароль сменён — войдите с ним');
      openAuth('login');
    }
  };
}
