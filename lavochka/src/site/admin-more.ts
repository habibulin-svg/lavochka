/* Админка: разделы «Игроки» (права на срок, закрыть вход), «Группы» (права группе — у каждого участника), «Ошибки» (автоошибки браузера и сервера, выгрузка пачкой),
 * «Обращения» (список; переписка — окном из src/site/support.ts). Открывает src/site/admin.ts по адресу. */
import { esc } from '../core/util';
import { toast } from '../core/ui';
import { byId, CATALOG, CATEGORIES } from '../games/catalog';
import { isReady } from './card';
import { RELEASE_STATE, type Release } from '../core/release';
import { call } from './admin';
import { list as ticketList, openTicket } from './support';

const when = (t: number | null) => (t ? new Date(t).toLocaleString('ru-RU', { day: 'numeric', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
const date = (t: number) => new Date(t).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
const fail = (body: HTMLElement, r: { body: any }) => {
  body.innerHTML = `<div class="adm-card adm-err">${esc(r.body.message ?? 'Не удалось загрузить.')}</div>`;
};

export async function drawTab(tab: string, body: HTMLElement): Promise<void> {
  if (tab === 'igroki') return drawUsers(body);
  if (tab === 'gruppy') return drawGroups(body);
  if (tab === 'oshibki') return drawErrors(body);
  if (tab === 'igry') return drawGames(body);
  return drawTickets(body);
}

// ---------------------------------------------------------------- игроки

let userQ = '';

async function drawUsers(body: HTMLElement) {
  const r = await call('/api/admin/users?q=' + encodeURIComponent(userQ));
  if (!r.ok) return fail(body, r);
  const RIGHTS = r.body.rights as Record<string, string>;
  const users = r.body.users as any[];
  const opts = rightOptions(RIGHTS);
  body.innerHTML = `<div class="adm-head"><h1>Игроки</h1></div>
    <form class="adm-card adm-row adm-search"><input name="q" placeholder="Почта, имя или номер" value="${esc(userQ)}" autocomplete="off"><button class="btn small">Найти</button>
      <span class="adm-muted">${userQ ? `найдено ${users.length}` : 'последние 50 зарегистрированных'}</span></form>
    <div class="adm-card"><table class="adm-table"><thead><tr><th>№</th><th>Игрок</th><th>С нами</th><th>Права</th><th></th></tr></thead><tbody>${
      users
        .map((u) => {
          const rights = (u.rights as { right: string; until: number | null; group?: string }[])
            .map(
              (g) =>
                `<span class="adm-chip" title="${esc(RIGHTS[g.right] ?? g.right)}${g.group ? ` — от группы «${esc(g.group)}»` : ''}">${esc(g.right)}${g.until ? ` до ${date(g.until)}` : ''}${g.group ? ` · 👪 ${esc(g.group)}` : g.right === 'master' ? '' : `<button data-revoke="${esc(g.right)}" data-id="${u.id}" title="Забрать">✕</button>`}</span>`
            )
            .join('');
          const groups = (u.groups as { id: number; name: string }[]).map((g) => `<a class="adm-chip" href="/admin/gruppy/#g${g.id}">👪 ${esc(g.name)}</a>`).join('');
          return `<tr><td>${u.id}</td>
            <td><b>${esc(u.name)}</b><br><small>${u.email ? esc(u.email) + (u.verified ? '' : ' (не подтв.)') : 'без почты'}${u.logins.length ? ' · ' + esc(u.logins.join(', ')) : ''}</small></td>
            <td><small>с ${date(u.createdAt)}<br>вход: ${when(u.lastLoginAt)}</small></td>
            <td>${rights || '<small class="adm-muted">—</small>'}${groups}${u.bannedUntil ? `<span class="adm-chip off">вход закрыт до ${date(u.bannedUntil)}</span>` : ''}</td>
            <td><div class="adm-row"><select data-right="${u.id}"><option value="">выдать право…</option>${opts}</select><select data-days="${u.id}" title="Срок">${DAYS}</select><button class="btn small" data-grant="${u.id}">Выдать</button>
              ${u.bannedUntil ? `<button class="btn small" data-unban="${u.id}">Открыть вход</button>` : `<button class="btn small" data-ban="${u.id}">Закрыть вход…</button>`}</div></td></tr>`;
        })
        .join('') || '<tr><td colspan="5" class="adm-muted">Никого.</td></tr>'
    }</tbody></table></div>
    <p class="adm-muted">Право Мастера выдаётся и забирается только командой на сервере (lavochka-admin). Закрытый вход выкидывает игрока из всех сессий.</p>`;
  const form = body.querySelector('form') as HTMLFormElement;
  form.onsubmit = (e) => {
    e.preventDefault();
    userQ = String(new FormData(form).get('q') ?? '').trim();
    void drawUsers(body);
  };
  const act = async (b: unknown, ok: string) => {
    const res = await call('/api/admin/users', b);
    toast(res.ok ? ok : res.body.message || 'Не вышло.');
    void drawUsers(body);
  };
  body.querySelectorAll<HTMLButtonElement>('[data-grant]').forEach(
    (b) =>
      (b.onclick = () => {
        const id = b.dataset.grant!;
        const right = (body.querySelector(`[data-right="${id}"]`) as HTMLSelectElement).value;
        const days = Number((body.querySelector(`[data-days="${id}"]`) as HTMLSelectElement).value) || null;
        if (!right) return toast('Выберите право.');
        void act({ id: Number(id), grant: right, days }, 'Право выдано.');
      })
  );
  body.querySelectorAll<HTMLButtonElement>('[data-revoke]').forEach(
    (b) => (b.onclick = () => confirm(`Забрать право ${b.dataset.revoke}?`) && void act({ id: Number(b.dataset.id), revoke: b.dataset.revoke }, 'Право забрано.'))
  );
  body.querySelectorAll<HTMLButtonElement>('[data-ban]').forEach(
    (b) =>
      (b.onclick = () => {
        const d = Number(prompt('Закрыть вход на сколько дней?', '7'));
        if (d > 0) void act({ id: Number(b.dataset.ban), ban: d }, 'Вход закрыт.');
      })
  );
  body.querySelectorAll<HTMLButtonElement>('[data-unban]').forEach((b) => (b.onclick = () => void act({ id: Number(b.dataset.unban), ban: 0 }, 'Вход открыт.')));
}

const rightOptions = (RIGHTS: Record<string, string>) =>
  Object.entries(RIGHTS)
    .filter(([k]) => k !== 'master')
    .map(([k, t]) => `<option value="${k}">${esc(t)}</option>`)
    .join('');
const DAYS = '<option value="">бессрочно</option><option value="7">7 дн.</option><option value="30" selected>30 дн.</option><option value="90">90 дн.</option><option value="365">год</option>';
const plural = (n: number, one: string, few: string, many: string) =>
  n % 10 === 1 && n % 100 !== 11 ? one : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 12 || n % 100 > 14) ? few : many;

// ---------------------------------------------------------------- группы

async function drawGroups(body: HTMLElement) {
  const r = await call('/api/admin/groups');
  if (!r.ok) return fail(body, r);
  const RIGHTS = r.body.rights as Record<string, string>;
  const groups = r.body.groups as any[];
  const opts = rightOptions(RIGHTS);
  body.innerHTML = `<div class="adm-head"><h1>Группы</h1></div>
    <form class="adm-card adm-row adm-search" data-new><input name="name" placeholder="Название новой группы" maxlength="60" autocomplete="off" required><input name="note" placeholder="Для чего (необязательно)" maxlength="300" autocomplete="off"><button class="btn small">Завести</button></form>
    ${
      groups
        .map(
          (g) => `<div class="adm-card" id="g${g.id}" data-g="${g.id}">
        <div class="adm-row"><b>👪 ${esc(g.name)}</b><span class="adm-muted">${g.members} ${plural(g.members, 'участник', 'участника', 'участников')}${g.note ? ' · ' + esc(g.note) : ''}</span>
          <button class="btn small" data-rename>Переименовать…</button><button class="btn small" data-del>Удалить</button></div>
        <p>${
          (g.rights as { right: string; until: number | null }[])
            .map((x) => `<span class="adm-chip" title="${esc(RIGHTS[x.right] ?? x.right)}">${esc(x.right)}${x.until ? ` до ${date(x.until)}` : ''}<button data-revoke="${esc(x.right)}" title="Забрать у группы">✕</button></span>`)
            .join('') || '<small class="adm-muted">прав нет</small>'
        }</p>
        <div class="adm-row"><select data-right><option value="">выдать право группе…</option>${opts}</select><select data-days title="Срок">${DAYS}</select><button class="btn small" data-grant>Выдать</button></div>
        <p>${
          (g.users as { id: number; name: string; email: string | null }[])
            .map((u) => `<span class="adm-chip" title="${esc(u.email ?? 'без почты')}">№${u.id} ${esc(u.name)}<button data-remove="${u.id}" title="Убрать из группы">✕</button></span>`)
            .join('') || '<small class="adm-muted">участников нет</small>'
        }</p>
        <form class="adm-row" data-add><input name="who" placeholder="Номер игрока или почта" autocomplete="off" required><button class="btn small">Добавить</button></form>
      </div>`
        )
        .join('') || '<div class="adm-card adm-muted">Групп пока нет. Например: «Тестировщики» — ранний доступ, «Друзья проекта» — видео за столом.</div>'
    }
    <p class="adm-muted">Право, выданное группе, действует у каждого её участника на тот же срок; убрали из группы — право пропало. В «Игроки» такие права подписаны названием группы. Право Мастера группе не выдаётся.</p>`;
  const act = async (b: unknown, ok: string) => {
    const res = await call('/api/admin/groups', b);
    toast(res.ok ? ok : res.body.message || 'Не вышло.');
    if (res.ok) void drawGroups(body);
  };
  const nf = body.querySelector('[data-new]') as HTMLFormElement;
  nf.onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(nf);
    void act({ name: f.get('name'), note: f.get('note') }, 'Группа заведена.');
  };
  body.querySelectorAll<HTMLElement>('[data-g]').forEach((card) => {
    const id = Number(card.dataset.g);
    const g = groups.find((x) => x.id === id);
    (card.querySelector('[data-rename]') as HTMLButtonElement).onclick = () => {
      const name = prompt('Название группы', g.name);
      if (name == null) return;
      const note = prompt('Для чего (можно пусто)', g.note);
      void act({ id, name, note: note ?? g.note }, 'Сохранено.');
    };
    (card.querySelector('[data-del]') as HTMLButtonElement).onclick = () =>
      confirm(`Удалить группу «${g.name}»? Её права пропадут у всех участников.`) && void act({ id, del: true }, 'Группа удалена.');
    (card.querySelector('[data-grant]') as HTMLButtonElement).onclick = () => {
      const right = (card.querySelector('[data-right]') as HTMLSelectElement).value;
      if (!right) return toast('Выберите право.');
      void act({ id, grant: right, days: Number((card.querySelector('[data-days]') as HTMLSelectElement).value) || null }, 'Право выдано группе.');
    };
    card.querySelectorAll<HTMLButtonElement>('[data-revoke]').forEach(
      (b) => (b.onclick = () => confirm(`Забрать ${b.dataset.revoke} у группы «${g.name}»?`) && void act({ id, revoke: b.dataset.revoke }, 'Право забрано.'))
    );
    card.querySelectorAll<HTMLButtonElement>('[data-remove]').forEach((b) => (b.onclick = () => void act({ id, remove: Number(b.dataset.remove) }, 'Убран из группы.')));
    const add = card.querySelector('[data-add]') as HTMLFormElement;
    add.onsubmit = (e) => {
      e.preventDefault();
      void act({ id, add: String(new FormData(add).get('who') ?? '').trim() }, 'Добавлен в группу.');
    };
  });
  if (location.hash) body.querySelector('#' + CSS.escape(location.hash.slice(1)))?.scrollIntoView({ block: 'center' });
}

// ---------------------------------------------------------------- ошибки

const ERR_ST: Record<string, string> = { new: 'новая', seen: 'смотрю', fixed: 'исправлена', ignored: 'не важно' };
let errFilter = 'new';

async function drawErrors(body: HTMLElement) {
  const r = await call('/api/admin/errors' + (errFilter ? '?status=' + errFilter : ''));
  if (!r.ok) return fail(body, r);
  const list = r.body.errors as any[];
  body.innerHTML = `<div class="adm-head"><h1>Ошибки</h1><div class="adm-row">${[
    ['new', 'Новые'],
    ['seen', 'Смотрю'],
    ['', 'Все'],
  ]
    .map(([k, t]) => `<button class="btn small${k === errFilter ? ' primary' : ''}" data-f="${k}">${t}</button>`)
    .join('')}<button class="btn small" data-md>⬇ Выгрузить (Markdown)</button>${list.length && errFilter === 'new' ? '<button class="btn small" data-allseen>Все — «смотрю»</button>' : ''}</div></div>
    <div class="adm-card">${
      list.length
        ? `<table class="adm-table"><thead><tr><th>Ошибка</th><th>Раз</th><th>Когда</th><th></th></tr></thead><tbody>${list
            .map(
              (e) => `<tr><td><b>${esc(e.message)}</b><br><small>${e.source === 'client' ? 'браузер' : 'сервер'}${e.game ? ' · ' + esc(byId(e.game)?.title ?? e.game) : ''}${e.url ? ' · ' + esc(e.url) : ''}</small>${
                e.place ? `<br><small><code>${esc(e.place)}</code></small>` : ''
              }${e.stack ? `<details><summary><small>стек</small></summary><pre class="adm-pre">${esc(e.stack)}</pre>${e.ua ? `<small>${esc(e.ua)}</small>` : ''}</details>` : ''}</td>
              <td>${e.count}</td><td><small>${when(e.lastAt)}${e.count > 1 ? `<br>впервые ${when(e.firstAt)}` : ''}</small></td>
              <td><select data-st="${e.id}">${Object.entries(ERR_ST).map(([k, t]) => `<option value="${k}"${k === e.status ? ' selected' : ''}>${t}</option>`).join('')}</select></td></tr>`
            )
            .join('')}</tbody></table>`
        : '<p class="adm-muted">Ошибок нет.</p>'
    }</div>
    <p class="adm-muted">Одинаковые ошибки склеиваются (сообщение + место). «Исправленная», случившись снова, опять становится новой. Выгрузку удобно отдать Claude — разобрать пачкой.</p>`;
  body.querySelectorAll<HTMLButtonElement>('[data-f]').forEach((b) => (b.onclick = () => ((errFilter = b.dataset.f!), void drawErrors(body))));
  body.querySelectorAll<HTMLSelectElement>('[data-st]').forEach(
    (s) =>
      (s.onchange = async () => {
        const res = await call('/api/admin/errors', { id: Number(s.dataset.st), status: s.value });
        if (!res.ok) toast(res.body.message || 'Не вышло.');
      })
  );
  const all = body.querySelector<HTMLButtonElement>('[data-allseen]');
  if (all)
    all.onclick = async () => {
      await call('/api/admin/errors', { ids: list.map((e) => e.id), status: 'seen' });
      void drawErrors(body);
    };
  (body.querySelector('[data-md]') as HTMLButtonElement).onclick = async () => {
    const res = await call('/api/admin/errors?format=md' + (errFilter ? '&status=' + errFilter : ''));
    if (!res.ok) return toast(res.body.message || 'Не вышло.');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([res.body.md], { type: 'text/markdown;charset=utf-8' }));
    a.download = `oshibki-${new Date().toISOString().slice(0, 10)}.md`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  };
}

// ---------------------------------------------------------------- обращения

let ticketFilter = 'new';

async function drawTickets(body: HTMLElement) {
  const r = await call('/api/admin/support' + (ticketFilter ? '?status=' + ticketFilter : ''));
  if (!r.ok) return fail(body, r);
  body.innerHTML = `<div class="adm-head"><h1>Обращения</h1><div class="adm-row">${[
    ['new', `Ждут ответа (${r.body.fresh})`],
    ['', 'Все'],
  ]
    .map(([k, t]) => `<button class="btn small${k === ticketFilter ? ' primary' : ''}" data-f="${k}">${t}</button>`)
    .join('')}</div></div>
    <div class="adm-card adm-tickets">${ticketList(r.body.tickets, true)}</div>
    ${r.body.mail ? '' : '<p class="adm-muted">Почта сайта выключена — ответы письмами не уйдут.</p>'}`;
  body.querySelectorAll<HTMLButtonElement>('[data-f]').forEach((b) => (b.onclick = () => ((ticketFilter = b.dataset.f!), void drawTickets(body))));
  body.querySelectorAll<HTMLButtonElement>('[data-id]').forEach((b) => (b.onclick = () => void openTicket(Number(b.dataset.id), true, () => void drawTickets(body))));
}

// ---------------------------------------------------------------- выход игр

async function drawGames(body: HTMLElement) {
  const st = await fetch('/api/stats', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  if (!st) return fail(body, { body: { message: 'Нет связи с сервером.' } });
  let rel: Release = st.release ?? {};
  const played: Record<string, number> = st.played ?? {};
  const games = CATALOG.filter((g) => !g.members && !g.of && !g.shelved && isReady(g));
  const cat = (id: string) => CATEGORIES.find((c) => c.id === id)?.title ?? id;
  body.innerHTML = `<div class="adm-head"><h1>Выход игр</h1><span class="adm-muted">${games.length} игр</span></div>
    <div class="adm-card"><table class="adm-table adm-games-t"><thead><tr><th>Игра</th><th>Состояние</th><th>Новинка</th><th title="Место на дворе: меньше — выше; пусто — как в каталоге">Место</th><th>Партий</th></tr></thead><tbody>${games
      .map((g) => {
        const r = rel[g.id] ?? {};
        return `<tr data-id="${g.id}"><td><b>${esc(g.icon)} ${esc(g.title)}</b><br><small>${esc(cat(g.cat))} · с ${esc(g.added)}</small></td>
          <td><select name="state">${Object.entries(RELEASE_STATE).map(([k, t]) => `<option value="${k}"${(r.state ?? 'all') === k ? ' selected' : ''}>${t}</option>`).join('')}</select></td>
          <td><input type="checkbox" name="new"${r.new ? ' checked' : ''}></td>
          <td><input type="number" name="order" min="1" max="999" value="${r.order ?? ''}" placeholder="—"></td>
          <td>${played[g.id] ?? 0}</td></tr>`;
      })
      .join('')}</tbody></table></div>
    <p class="adm-muted">Скрытая игра видна только Мастеру (страница игры для поисковиков остаётся). Ранний доступ — играют те, у кого право «Ранний доступ» (выдаётся в «Игроки», позже — подпиской); остальные видят карточку с меткой. «Место» — порядок на дворе при сортировке «как сейчас». Изменения сразу видят все.</p>`;
  body.querySelectorAll<HTMLTableRowElement>('tr[data-id]').forEach((tr) => {
    const save = async () => {
      const state = (tr.querySelector('[name=state]') as HTMLSelectElement).value;
      const res = await call('/api/admin/games', {
        id: tr.dataset.id,
        state: state === 'all' ? undefined : state,
        new: (tr.querySelector('[name=new]') as HTMLInputElement).checked,
        order: (tr.querySelector('[name=order]') as HTMLInputElement).value,
      });
      if (!res.ok) return toast(res.body.message || 'Не сохранилось.');
      rel = res.body.release;
      toast('Сохранено.');
    };
    tr.querySelectorAll<HTMLInputElement | HTMLSelectElement>('select, input').forEach((x) => (x.onchange = () => void save()));
  });
}
