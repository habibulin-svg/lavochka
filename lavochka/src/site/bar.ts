/* Шапка сайта в духе 2000-х: узкий баннер ночного двора (название — ссылка во двор, счётчик «во дворе», поиск,
 * вход по коду, настройки, место под вход/профиль) и под ним ряд вкладок разделов. Неготовые разделы — «скоро», без ссылок.
 * На телефоне: название, профиль значком и кнопка «меню» с теми же разделами крупным списком; поиск — строкой ниже.
 * Одна шапка на двор, экран игры и страницы новостей/блога; за столом с партией её нет. */
import { h } from '../core/util';
import { toast } from '../core/ui';
import { Sound } from '../core/audio';
import { scene, SEARCH_HINT, wireJoin, wireSettings } from '../launcher/yard';
import { loadStats, onStats } from './stats';
import './bar.css';

export type Tab = 'games' | 'lobby' | 'tourneys' | 'chat' | 'news' | 'blog';

/** Разделы шапки; без адреса — ещё не открыт («скоро»). */
export const TABS: { id: Tab; title: string; href?: string; icon: string }[] = [
  { id: 'games', title: 'Игры', href: '/', icon: '🎲' },
  { id: 'lobby', title: 'Лобби', icon: '🪑' },
  { id: 'tourneys', title: 'Турниры', icon: '🏆' },
  { id: 'chat', title: 'Чат', icon: '💬' },
  { id: 'news', title: 'Новости', href: '/novosti/', icon: '📰' },
  { id: 'blog', title: 'Блог', href: '/blog/', icon: '✎' },
];

let bg: string | null = null;
let online: number | null = null;

// счётчик «во дворе» — во всех шапках сразу
onStats((s) => {
  online = s.online;
  document.querySelectorAll<HTMLElement>('.bar-online').forEach(showOnline);
});
function showOnline(el: HTMLElement) {
  el.hidden = online == null;
  (el.querySelector('b') as HTMLElement).textContent = String(online ?? '');
}

export interface BarOpts {
  /** Запрос из строки поиска (Enter). */
  onSearch: (q: string) => void;
  /** Текущий раздел — его вкладка нажата. */
  tab?: Tab;
  /** Шапка поверх двора: без своего фона и без своей строки поиска (у двора — своя, большая). */
  yard?: boolean;
}

const tabLink = (t: (typeof TABS)[number], on: boolean, cls: string) =>
  t.href
    ? `<a class="${cls}${on ? ' on' : ''}" href="${t.href}"${on ? ' aria-current="page"' : ''}><span class="ti">${t.icon}</span>${t.title}</a>`
    : `<span class="${cls} soon" title="Скоро откроется"><span class="ti">${t.icon}</span>${t.title}<small>скоро</small></span>`;

/** Собрать шапку. */
export function siteBar(o: BarOpts): HTMLElement {
  bg ??= scene().replace('preserveAspectRatio="xMidYMax slice"', 'preserveAspectRatio="xMidYMid slice"').replace('class="yard-bg"', 'class="bar-bg"');
  const tab = o.tab ?? 'games';
  const el = h(`<header class="site-bar${o.yard ? ' on-yard' : ''}">
    <div class="bar-banner">
      ${o.yard ? '' : bg}
      <div class="bar-in">
        <a class="bar-logo" href="/">Вечером на лавочке</a>
        <span class="bar-online" title="Сейчас на сайте" hidden><i></i><b></b> во дворе</span>
        ${o.yard ? '' : `<form class="bar-search" role="search" action="/poisk/"><input type="search" name="q" placeholder="${SEARCH_HINT}" autocomplete="off" spellcheck="false" aria-label="Поиск игры"></form>`}
        <div class="bar-actions">
          <form class="join-form" title="Код комнаты от друга">
            <input class="code-input" maxlength="6" placeholder="КОД" autocomplete="off" spellcheck="false">
            <button class="btn primary">Войти</button>
          </form>
          <button class="btn" data-a="settings" title="Настройки">⚙ <span class="who"></span></button>
        </div>
        <button class="bar-login" type="button" title="Вход и профиль — скоро" aria-disabled="true"><span class="li">👤</span><span class="lt">Вход</span></button>
        <button class="bar-burger" type="button" aria-expanded="false" aria-label="Меню"><span></span><span></span><span></span></button>
      </div>
    </div>
    <nav class="bar-tabs" aria-label="Разделы сайта"><div class="bar-tabs-in">${TABS.map((t) => tabLink(t, t.id === tab, 'bar-tab')).join('')}</div></nav>
    <div class="bar-menu" hidden>
      <span class="bar-online" title="Сейчас на сайте" hidden><i></i><b></b> во дворе</span>
      <nav class="bar-menu-list">${TABS.map((t) => tabLink(t, t.id === tab, 'bar-mi')).join('')}</nav>
      <form class="join-form bar-menu-join" title="Код комнаты от друга">
        <input class="code-input" maxlength="6" placeholder="КОД" autocomplete="off" spellcheck="false">
        <button class="btn primary">Войти в комнату</button>
      </form>
      <div class="bar-menu-row">
        <button class="btn" data-a="settings">⚙ <span class="who"></span></button>
        <button class="btn" data-a="login" disabled title="Вход и профиль — скоро">👤 Вход — скоро</button>
      </div>
    </div>
  </header>`);
  el.querySelectorAll<HTMLFormElement>('.join-form').forEach(wireJoin);
  el.querySelectorAll<HTMLButtonElement>('[data-a=settings]').forEach(wireSettings);
  el.querySelectorAll<HTMLElement>('.bar-online').forEach(showOnline);
  // счётчик мог прийти раньше, чем шапка встала на экран, — дотянуть (в пределах минуты — из кэша, без запроса)
  void loadStats().then((st) => {
    if (st) online = st.online;
    el.querySelectorAll<HTMLElement>('.bar-online').forEach(showOnline);
  });

  const f = el.querySelector('.bar-search') as HTMLFormElement | null;
  if (f)
    f.onsubmit = (e) => {
      e.preventDefault();
      const q = (f.querySelector('input') as HTMLInputElement).value.trim();
      if (q) o.onSearch(q);
    };

  // меню на телефоне
  const burger = el.querySelector('.bar-burger') as HTMLButtonElement;
  const menu = el.querySelector('.bar-menu') as HTMLElement;
  const setMenu = (open: boolean) => {
    menu.hidden = !open;
    burger.setAttribute('aria-expanded', String(open));
    el.classList.toggle('menu-open', open);
  };
  burger.onclick = () => {
    Sound.ui();
    setMenu(menu.hidden);
  };
  // ушли по ссылке из меню — закрыть его
  menu.addEventListener('click', (e) => {
    if ((e.target as Element).closest('a')) setMenu(false);
  });
  (el.querySelector('.bar-login') as HTMLButtonElement).onclick = () => toast('Вход и профиль игрока появятся совсем скоро.');
  return el;
}
