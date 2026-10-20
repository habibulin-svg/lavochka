/* Админка Мастера (/admin/): сводка (что сейчас, итоги, графики по дням, игры), игроки и права, ошибки и обращения.
 * Данные — server/backoffice.ts (/api/admin/*). Не Мастеру — вход или «только для Мастера». */
import { esc, h } from '../core/util';
import { mountScreen, showScreen } from '../core/ui';
import { byId } from '../games/catalog';
import { currentUser, loadAccount, onAccount, openAuth } from './account';
import { gamePath } from './routes';
import './admin.css';

export async function call(url: string, body?: unknown): Promise<{ ok: boolean; body: any }> {
  const r = await fetch(url, body === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
  return { ok: !!r?.ok, body: r ? await r.json().catch(() => ({})) : { message: 'Нет связи с сервером.' } };
}

const TABS: [string, string][] = [
  ['', '📊 Сводка'],
  ['igroki', '👥 Игроки'],
  ['gruppy', '👪 Группы'],
  ['oshibki', '🐞 Ошибки'],
  ['obrashcheniya', '📮 Обращения'],
  ['teksty', '✍ Тексты'],
  ['igry', '🎲 Игры'],
];

const num = (n: number) => n.toLocaleString('ru-RU');
const rub = (kop: number) => Math.round(kop / 100).toLocaleString('ru-RU') + ' ₽';
const dayName = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', weekday: 'short' });
const gameTitle = (id: string) => byId(id)?.title ?? id;

let unsub: (() => void) | null = null;

/** Открыть админку на разделе tab (часть адреса после /admin/). */
export async function openAdmin(tab: string, bar: HTMLElement): Promise<void> {
  const el = h(`<section class="page-screen adm-screen"><div class="adm"><nav class="adm-tabs"></nav><div class="adm-body"><p class="adm-wait">Загружаем…</p></div></div></section>`);
  el.prepend(bar);
  mountScreen('admin', el);
  showScreen('admin');
  document.title = 'Админка — Вечером на лавочке';
  const nav = el.querySelector('.adm-tabs') as HTMLElement;
  nav.innerHTML = TABS.map(([id, t]) => `<a href="/admin/${id ? id + '/' : ''}"${id === tab ? ' class="on"' : ''}>${t}</a>`).join('');
  const body = el.querySelector('.adm-body') as HTMLElement;
  await loadAccount();
  const draw = () => {
    const u = currentUser();
    if (!u) {
      body.innerHTML = `<div class="adm-card"><p>Админка — для Мастера. Войдите.</p><button class="btn primary">Войти</button></div>`;
      (body.querySelector('button') as HTMLButtonElement).onclick = () => openAuth();
      return;
    }
    if (!u.rights.some((r) => r.right === 'master')) {
      body.innerHTML = `<div class="adm-card"><p>Только для Мастера.</p><p><a href="/">Во двор, к играм</a></p></div>`;
      return;
    }
    if (tab === 'teksty') void import('./admin-texts').then((m) => m.drawTexts(body));
    else if (tab === 'igroki' || tab === 'gruppy' || tab === 'oshibki' || tab === 'obrashcheniya' || tab === 'igry') void import('./admin-more').then((m) => m.drawTab(tab, body));
    else void drawDash(body);
  };
  unsub?.();
  let first = true;
  unsub = onAccount(() => {
    if (!el.isConnected) return unsub?.();
    if (first) return void (first = false);
    draw();
  });
  draw();
}

// ---------------------------------------------------------------- сводка

interface Day {
  day: string;
  plays: number;
  net: number;
  local: number;
  arcade: number;
  signups: number;
  online: number;
  players: number;
  visitors: number;
}

let period = 30;

async function drawDash(body: HTMLElement) {
  const r = await call(`/api/admin/dash?days=${period}`);
  if (!r.ok) return void (body.innerHTML = `<div class="adm-card adm-err">${esc(r.body.message ?? 'Не удалось загрузить.')}</div>`);
  const { days, games, totals, live } = r.body as { days: Day[]; games: { game: string; plays: number }[]; totals: any; live: any };
  const sum = (k: keyof Day) => days.reduce((n, d) => n + (d[k] as number), 0);
  const max = (k: keyof Day) => days.reduce((n, d) => Math.max(n, d[k] as number), 0);
  const tile = (label: string, value: string, sub = '', href = '') =>
    `<${href ? `a href="${href}"` : 'div'} class="adm-tile"><span class="adm-t-v">${value}</span><span class="adm-t-l">${label}</span>${sub ? `<span class="adm-t-s">${sub}</span>` : ''}</${href ? 'a' : 'div'}>`;
  body.innerHTML = `
    <div class="adm-head"><h1>Сводка</h1><div class="adm-period">${[7, 30, 90].map((p) => `<button class="btn small${p === period ? ' on' : ''}" data-p="${p}">${p} дн.</button>`).join('')}</div></div>
    <div class="adm-tiles">
      ${tile('на сайте сейчас', num(live.online), `за столами — ${num(live.players)}, столов ${num(live.rooms)}`)}
      ${tile(`партий за ${period} дн.`, num(sum('plays')), `по сети — ${num(sum('net'))}`)}
      ${tile('игроков', num(totals.users), `+${num(totals.users7)} за неделю`, '/admin/igroki/')}
      ${tile('пожертвований', rub(totals.donated30), 'за 30 дней')}
      ${tile('обращений ждут', num(totals.ticketsNew), '', '/admin/obrashcheniya/')}
      ${tile('новых ошибок', num(totals.errorsNew), '', '/admin/oshibki/')}
    </div>
    <div class="adm-charts">
      ${bars(days, 'plays', 'Партии в день', (d) => `${d.plays}: за экраном ${d.local}, по сети ${d.net}, аркады ${d.arcade}`)}
      ${bars(days, 'visitors', 'Посетители в день', (d) => `${d.visitors} вкладок`)}
      ${bars(days, 'online', 'Пик онлайна', (d) => `до ${d.online} одновременно, за столами до ${d.players}`)}
      ${bars(days, 'signups', 'Регистрации', (d) => `${d.signups}`)}
    </div>
    <div class="adm-card"><h2>Игры за ${period} дн.</h2>${
      games.length
        ? `<ol class="adm-games">${games
            .slice(0, 40)
            .map(
              (g) =>
                `<li><a href="${gamePath(g.game)}">${esc(gameTitle(g.game))}</a><span class="adm-g-bar"><i style="width:${((g.plays / games[0].plays) * 100).toFixed(1)}%"></i></span><b>${num(g.plays)}</b></li>`
            )
            .join('')}</ol>`
        : '<p class="adm-muted">Партий ещё не было — счётчик по дням начат с появления админки.</p>'
    }</div>
    <p class="adm-muted">День — по Москве. Посетители — разные вкладки за день, онлайн — пик за день (замер раз в 5 минут). Максимум за период: партий в день ${num(max('plays'))}, онлайна ${num(max('online'))}.</p>`;
  body.querySelectorAll<HTMLButtonElement>('[data-p]').forEach(
    (b) =>
      (b.onclick = () => {
        period = Number(b.dataset.p);
        void drawDash(body);
      })
  );
}

/** Столбики по дням для одной величины: одна шкала, подписи — первый и последний день, подробности — при наведении. */
function bars(days: Day[], k: keyof Day, title: string, tip: (d: Day) => string): string {
  const top = Math.max(1, ...days.map((d) => d[k] as number));
  const total = days.reduce((n, d) => n + (d[k] as number), 0);
  const cols = days
    .map((d) => {
      const v = d[k] as number;
      const hgt = v ? Math.max(2, (v / top) * 100) : 0;
      return `<span class="adm-col" title="${esc(dayName(d.day))} — ${esc(tip(d))}"><i style="height:${hgt.toFixed(1)}%"></i></span>`;
    })
    .join('');
  return `<figure class="adm-card adm-chart"><figcaption><b>${title}</b><span>${k === 'online' ? 'пик ' + num(top) : 'всего ' + num(total)}</span></figcaption>
    <div class="adm-plot"><span class="adm-y">${num(top)}</span><div class="adm-cols">${cols}</div></div>
    <div class="adm-x"><span>${esc(dayName(days[0].day))}</span><span>${esc(dayName(days[days.length - 1].day))}</span></div></figure>`;
}
