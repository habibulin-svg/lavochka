/* Шапка страниц игр: узкая полоса ночного двора — название сайта (ссылка во двор), поиск, вход по коду, настройки. */
import { h } from '../core/util';
import { scene, SEARCH_HINT, wireJoin, wireSettings } from '../launcher/yard';
import './bar.css';

let bg: string | null = null;

/** Собрать шапку; `onSearch` — запрос из строки поиска (Enter). */
export function siteBar(onSearch: (q: string) => void): HTMLElement {
  bg ??= scene().replace('preserveAspectRatio="xMidYMax slice"', 'preserveAspectRatio="xMidYMid slice"').replace('class="yard-bg"', 'class="bar-bg"');
  const el = h(`<header class="site-bar">
    ${bg}
    <div class="bar-in">
      <a class="bar-logo" href="/">Вечером на лавочке</a>
      <form class="bar-search" role="search" action="/poisk/"><input type="search" name="q" placeholder="${SEARCH_HINT}" autocomplete="off" spellcheck="false" aria-label="Поиск игры"></form>
      <div class="bar-actions">
        <form class="join-form" title="Код комнаты от друга">
          <input class="code-input" maxlength="6" placeholder="КОД" autocomplete="off" spellcheck="false">
          <button class="btn primary">Войти</button>
        </form>
        <button class="btn" data-a="settings" title="Настройки">⚙ <span class="who"></span></button>
      </div>
    </div>
  </header>`);
  wireJoin(el.querySelector('.join-form') as HTMLFormElement);
  wireSettings(el.querySelector('[data-a=settings]') as HTMLButtonElement);
  const f = el.querySelector('.bar-search') as HTMLFormElement;
  f.onsubmit = (e) => {
    e.preventDefault();
    const q = (f.querySelector('input') as HTMLInputElement).value.trim();
    if (q) onSearch(q);
  };
  return el;
}
