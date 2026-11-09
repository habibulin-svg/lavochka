/* Лаунчер: вечерний двор 90-х. Фон рисуется процедурно (SVG), поверх — карточки игр. */
import { Sound } from '../core/audio';
import { codeKind, joinGame, loadSave } from '../core/session';
import { openSettings } from '../core/settings-ui';
import { onSettings, settings, store } from '../core/settings';
import { modal, mountScreen, showScreen, toast } from '../core/ui';
import { esc, h } from '../core/util';
import { SeededRng } from '../core/rng';
import { SHOWN, CATEGORIES, membersOf, type CatalogEntry, type Category } from '../games/catalog';
import { cardMarkup, isReady } from '../site/card';
import { likeCount, onLikes } from '../site/likes';
import { masterNote } from '../site/master';
import { sectionPath } from '../site/routes';
import { searchGames } from '../site/search';
import { canPlay, canSee, onRelease, releaseBadge, releaseOf } from '../site/release';
import { plusNote } from '../site/plus';
import { AFISHA_IDS, afishiRow } from './afishi';
import { loadStats, onStats } from '../site/stats';
import { DVOR } from './dvor-data';
import './yard.css';

const WAVE_NAMES: Record<number, string> = {
  1: 'скоро',
  2: 'в планах',
  3: 'в планах',
  4: 'в планах',
  5: 'в планах',
  6: 'в планах',
  7: 'в планах',
};

// ------------------------------------------------------------------ фон

/** Фон двора: картинка (tools/dvor/make.py) и поверх неё в тех же координатах то, что оживает:
 * мерцают звёзды, гаснут и зажигаются окна, мигает телевизор, дышит фонарь. Режется как картинка — slice, низ по низу. */
export function scene(): string {
  const { w, h, lamp, tv, windows, stars } = DVOR;
  const rng = new SeededRng(1993);
  const r = () => rng.next();
  const src = typeof innerWidth === 'number' && innerWidth < 760 ? '/dvor/dvor-s.webp' : '/dvor/dvor.webp';
  let s = `<svg class="yard-bg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMax slice" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
  <defs><radialGradient id="y-glow" cx=".5" cy=".5" r=".5">
    <stop offset="0" stop-color="#fff2c4" stop-opacity=".9"/><stop offset=".35" stop-color="#ffd27a" stop-opacity=".45"/><stop offset="1" stop-color="#ffb24a" stop-opacity="0"/>
  </radialGradient></defs>
  <image href="${src}" width="${w}" height="${h}" preserveAspectRatio="none"/>`;
  for (const [x, y, rr] of stars)
    s += `<circle class="tw" style="animation-delay:${(r() * 4).toFixed(2)}s;animation-duration:${(2.4 + r() * 3).toFixed(1)}s" cx="${x}" cy="${y}" r="${rr}" fill="#fff"/>`;
  // окна: тёмная заслонка, которая изредка закрывает горящее окно — «свет погасили», потом снова зажгли
  for (const [x, y, ww, hh] of windows)
    s += `<rect class="off" style="animation-delay:-${(r() * 30).toFixed(1)}s;animation-duration:${(14 + r() * 22).toFixed(1)}s" x="${x}" y="${y}" width="${ww}" height="${hh}" fill="#2a2836"/>`;
  if (tv) s += `<rect class="tv" x="${tv[0]}" y="${tv[1]}" width="${tv[2]}" height="${tv[3]}"/>`;
  s += `<circle class="lamp" cx="${lamp[0]}" cy="${lamp[1]}" r="${lamp[2]}" fill="url(#y-glow)"/></svg>`;
  return s;
}

// ------------------------------------------------------------------ карточки

/** Сохранённая партия: у игры, ярлык — по игре, у группы — по любой из её игр. */
const hasSave = (g: CatalogEntry): boolean => (g.members ? membersOf(g).some(hasSave) : !!g.load && !!loadSave(g.id));

function card(g: CatalogEntry): HTMLElement {
  const ready = isReady(g);
  // ссылка, а не кнопка: открывается в новой вкладке, и поисковик видит адреса игр
  const id = g.of ?? g.id;
  const el = h<HTMLAnchorElement>(cardMarkup(g, { save: ready && hasSave(g), stamp: WAVE_NAMES[g.wave] ?? 'в планах', likes: ready ? likesOfCard(g) : 0, badge: g.members ? '' : releaseBadge(id) }));
  if (AFISHA_IDS.has(id)) el.classList.add('big');
  el.onclick = (e) => {
    if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    Sound.ui();
    if (g.members) yard.openGroup(g);
    else if (ready && !canPlay(id)) earlyNote(g);
    else if (ready) yard.openGame(g);
    else
      modal(
        `<h2>${esc(g.title)}</h2><p>${esc(g.sub)}.</p><p>Эту игру ещё строим — она появится в одной из следующих волн. Пока можно сыграть в то, что уже готово.</p>`,
        [{ text: 'Ладно', primary: true }]
      );
  };
  return el;
}

/** Игра в раннем доступе, а права нет. */
export function earlyNote(g: CatalogEntry) {
  plusNote('early', g.title);
}

/** Видна ли карточка: у группы — если видна хоть одна её игра. */
const visible = (g: CatalogEntry): boolean => (g.members ? membersOf(g).some(visible) : canSee(g.of ?? g.id));
/** Место из админки: у группы — самое высокое из её игр. */
const orderOf = (g: CatalogEntry): number => (g.members ? Math.min(...membersOf(g).map(orderOf)) : (releaseOf(g.of ?? g.id).order ?? 1e9));

/** Форма входа по коду комнаты (двор и шапка страниц игр). */
export function wireJoin(form: HTMLFormElement) {
  const code = form.querySelector('input') as HTMLInputElement;
  code.value = store.get('lastCode', '');
  code.oninput = () => (code.value = code.value.toUpperCase().replace(/[^A-Z0-9]/g, ''));
  form.onsubmit = (e) => {
    e.preventDefault();
    Sound.unlock();
    if (!codeKind(code.value)) return toast('Код комнаты — 5 или 6 знаков.');
    if (!settings.name) {
      openSettings();
      toast('Сначала скажите, как вас зовут.');
      return;
    }
    void joinGame(code.value);
  };
}

/** Кнопка настроек с именем игрока. */
export function wireSettings(btn: HTMLButtonElement) {
  const who = btn.querySelector('.who') as HTMLElement;
  const upd = () => (who.textContent = settings.name || 'Настройки');
  upd();
  onSettings(upd);
  btn.onclick = () => openSettings();
}

export const SEARCH_HINT = 'Найти игру: нарды, косынка, tetris…';

// ------------------------------------------------------------------ порядок карточек

export type YardSort = '' | 'new' | 'popular' | 'liked';
/** Начатые партии по играм (с сервера); пока не пришли — null. */
let played: Record<string, number> | null = null;

/** Дата появления: у группы — самой новой из её игр. */
const addedOf = (g: CatalogEntry): string => (g.members ? membersOf(g).reduce((d, m) => (addedOf(m) > d ? addedOf(m) : d), g.added) : g.added);
/** Партий сыграно: у группы — сумма по её играм. */
const playedOf = (g: CatalogEntry): number => (g.members ? membersOf(g).reduce((n, m) => n + playedOf(m), 0) : (played?.[g.id] ?? 0));

/** Лайков: у ярлыка — у его игры, у группы — сумма по её играм. */
const likesOfCard = (g: CatalogEntry): number => (g.members ? membersOf(g).reduce((n, m) => n + likesOfCard(m), 0) : likeCount(g.of ?? g.id));

/** Готовые — первыми; дальше — как выбрано (при равенстве — порядок каталога). */
function sorted(list: CatalogEntry[], how: YardSort): CatalogEntry[] {
  // «как сейчас» — порядок из админки (у кого он задан — первыми), дальше каталог
  const key = (g: CatalogEntry) => (how === 'new' ? addedOf(g) : how === 'popular' ? playedOf(g) : how === 'liked' ? likesOfCard(g) : -orderOf(g));
  return list
    .filter(visible)
    .map((g, i) => ({ g, i, k: key(g) }))
    .sort((a, b) => Number(isReady(b.g)) - Number(isReady(a.g)) || (b.k > a.k ? 1 : b.k < a.k ? -1 : 0) || a.i - b.i)
    .map((x) => x.g);
}

export const yard = {
  /** Назначается в main.ts: открыть экран игры. */
  openGame: (_g: CatalogEntry) => {},
  /** Назначается в main.ts: открыли или закрыли группу (адрес в строке браузера). */
  onGroup: (_g: CatalogEntry | null) => {},
  /** Назначается в main.ts: выбрали раздел (адрес раздела). */
  onCat: (_cat: Category | 'all') => {},
  /** Назначается в main.ts: изменился запрос поиска (адрес /poisk/?q=…). */
  onSearch: (_q: string) => {},
  /** Назначается в main.ts: шапка сайта для двора. */
  makeBar: (): HTMLElement => document.createElement('div'),
  el: null as HTMLElement | null,
  /** Порядок карточек (запоминается). */
  sort: (() => {
    const v = store.get<string>('yard.sort', '');
    return (v === 'new' || v === 'popular' || v === 'liked' ? v : '') as YardSort;
  })(),
  /** Раздел, который сейчас показан (его задаёт адрес). */
  cat: 'all' as Category | 'all',
  /** Запрос поиска: пока он не пуст, двор показывает найденное. */
  query: '',

  mount() {
    const el = h(`<section class="yard">
      ${scene()}
      <div class="yard-shade"></div>
      <div class="yard-content">
        <header class="yard-top">
          <div class="yard-title">
            <h1>Вечером на лавочке</h1>
            <p>сборник дворовых игр</p>
          </div>
        </header>
        <div class="yard-spacer"></div>
        <div class="search-row">
          <form class="search-form" role="search" action="/poisk/"><input type="search" name="q" placeholder="${esc(SEARCH_HINT)}" autocomplete="off" spellcheck="false" aria-label="Поиск игры"></form>
          <label class="yard-sort" title="Порядок карточек"><span>Порядок:</span><select>
            <option value="">как обычно</option><option value="new">сначала новые</option><option value="popular">популярные</option><option value="liked">любимые (♥)</option>
          </select></label></div>
        <nav class="cats"></nav>
        <div class="cards"></div>
        <footer class="yard-foot">Играть можно за одним экраном, с ботами или с друзьями по коду комнаты.</footer>
      </div>
    </section>`);
    this.el = el;
    // шапка сайта (её собирает main.ts: там же решается, куда ведёт поиск)
    el.prepend(this.makeBar());
    (el.querySelector('.yard-top') as HTMLElement).appendChild(masterNote());
    // афиши больших игр — на асфальте под заголовком
    (el.querySelector('.yard-spacer') as HTMLElement).after(
      afishiRow((g) => {
        Sound.ui();
        if (!canPlay(g.id)) earlyNote(g);
        else this.openGame(g);
      })
    );
    // фон кончается у крыш гаражей (чуть заходит под них): лавочка и фонарь стоят прямо над гаражами при любой ширине
    const fitBg = () => {
      const gar = el.querySelector('.garage');
      if (gar) el.style.setProperty('--bg-h', `${Math.round(gar.getBoundingClientRect().top - el.getBoundingClientRect().top + 26)}px`);
    };
    new ResizeObserver(fitBg).observe(el.querySelector('.yard-content') as HTMLElement);
    mountScreen('yard', el);

    const sort = el.querySelector('.yard-sort select') as HTMLSelectElement;
    sort.value = this.sort;
    sort.onchange = () => {
      Sound.ui();
      this.sort = sort.value as YardSort;
      store.set('yard.sort', this.sort);
      if (this.sort === 'liked') void loadStats();
      if (this.sort === 'popular' && !played) void loadStats().then((st) => (st ? this.renderCards() : toast('Нет связи с сервером — счётчики партий недоступны.')));
      this.renderCards();
    };
    // счётчики партий пришли или обновились — пересобрать популярное
    onStats((st) => {
      const first = !played;
      played = st.played;
      if (first && this.sort === 'popular' && this.el?.classList.contains('active')) this.renderCards();
    });
    if (this.sort === 'popular' || this.sort === 'liked') void loadStats();
    // выход игр из админки пришёл или вошёл другой игрок — пересобрать карточки
    onRelease(() => this.el?.classList.contains('active') && this.renderCards());
    // лайки пришли или изменились — пересобрать карточки (счётчики на них и порядок «любимые»)
    let likeTimer = 0;
    onLikes(() => {
      clearTimeout(likeTimer);
      likeTimer = window.setTimeout(() => this.el?.classList.contains('active') && this.renderCards(), 200);
    });

    const sf = el.querySelector('.search-form') as HTMLFormElement;
    const si = sf.querySelector('input') as HTMLInputElement;
    sf.onsubmit = (e) => {
      e.preventDefault();
      si.blur();
    };
    si.oninput = () => {
      this.query = si.value.trim();
      this.group = null;
      this.onSearch(this.query);
      this.renderCards();
    };

    const cats = el.querySelector('.cats') as HTMLElement;
    // Раздел, где не осталось карточек (все отложены), не показываем.
    const cats_ = CATEGORIES.filter((c) => SHOWN.some((g) => g.cat === c.id));
    const mk = (id: Category | 'all', title: string) => {
      // ссылка на страницу раздела: у раздела свой адрес и свой текст
      const b = h<HTMLAnchorElement>(`<a data-cat="${id}" href="${sectionPath(id === 'all' ? null : id)}">${esc(title)}</a>`);
      b.onclick = (e) => {
        if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        Sound.ui();
        this.group = null;
        this.setQuery('');
        this.cat = id;
        store.set('cat', id);
        this.onCat(id);
        this.renderCards();
      };
      cats.appendChild(b);
    };
    mk('all', 'Все игры');
    for (const c of cats_) mk(c.id, c.title);
  },

  setQuery(q: string) {
    this.query = q;
    const si = this.el?.querySelector('.search-form input') as HTMLInputElement | null;
    if (si && si.value.trim() !== q) si.value = q;
  },

  /** Открытая группа (карточка «Приключения» и т. п.): двор показывает её игры, пока не нажали «назад». */
  group: null as CatalogEntry | null,

  openGroup(g: CatalogEntry) {
    this.group = g;
    this.setQuery('');
    this.onGroup(g);
    this.renderCards();
  },

  renderCards() {
    const el = this.el!;
    const box = el.querySelector('.cards') as HTMLElement;
    box.innerHTML = '';
    el.querySelectorAll<HTMLElement>('.cats a').forEach((b) => b.classList.toggle('on', !this.group && !this.query && b.dataset.cat === this.cat));
    if (this.query) {
      const found = searchGames(this.query);
      box.appendChild(
        h(`<div class="group-head"><h2>${found.length ? `Нашлось: ${found.length}` : 'Ничего не нашлось'}</h2><p>${
          found.length ? `по запросу «${esc(this.query)}»` : `По запросу «${esc(this.query)}» игр нет. Попробуйте иначе: «нарды», «косынка», «тетрис», «backgammon».`
        }</p></div>`)
      );
      for (const g of found.filter(visible)) box.appendChild(card(g));
      return;
    }
    if (this.group) {
      const g = this.group;
      const head = h(`<div class="group-head"><button class="btn back">← Все игры</button><h2>${esc(g.icon)} ${esc(g.title)}</h2><p>${esc(g.sub)}</p></div>`);
      (head.querySelector('button') as HTMLButtonElement).onclick = () => {
        Sound.ui();
        this.group = null;
        this.onGroup(null);
        this.renderCards();
      };
      box.appendChild(head);
      for (const m of sorted(membersOf(g), this.sort)) box.appendChild(card(m));
      return;
    }
    const cat = this.cat;
    for (const g of sorted(SHOWN.filter((g) => cat === 'all' || g.cat === cat), this.sort)) box.appendChild(card(g));
  },

  /** Показать двор: раздел (по адресу) или найденное по запросу. */
  show(cat: Category | 'all' = 'all', query = '') {
    if (!this.el) this.mount();
    this.cat = cat;
    this.setQuery(query);
    this.renderCards();
    showScreen('yard');
  },
};
