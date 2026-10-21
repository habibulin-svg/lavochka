/* Точка входа: двор → экран игры → стол. */
import './styles/base.css';
import { Sound } from './core/audio';
import { openHome } from './core/home';
import { isArcade, openArcade } from './core/arcade';
import { currentTable, nav, offerResume, resumeTable } from './core/session';
import { closeAllModals, modal, mountScreen, showScreen } from './core/ui';
import type { GameModule } from './core/view';
import { gamePath, modePath, parseRoute, searchPath, sectionPath, tablePath, type Route } from './site/routes';
import { attachSeo } from './site/page';
import { siteBar } from './site/bar';
import { handleAuthRoute, handleOAuthReturn, loadAccount } from './site/account';
import { handleDonateReturn, loadDonate } from './site/donate';
import { handlePlusReturn, wirePlusLinks } from './site/plus';
import { wireSupportLinks } from './site/support';
import { likeButton } from './site/likes';
import './site/history';
import './site/seen';
import { syncSave } from './site/saves';
import { metrikaHit, startMetrika } from './site/metrika';
import { startPresence } from './site/stats';
import { startErrorReports } from './site/errors';
import { canPlay, releaseOf, releaseReady } from './site/release';
import { esc, h } from './core/util';
import { byId, type CatalogEntry, type Category } from './games/catalog';
import { earlyNote, yard } from './launcher/yard';
import { cardHTML, DECK_STYLES } from './cards/render';
import { makeDeck } from './cards/deck';
import { Authority } from './core/authority';
import { SeededRng } from './core/rng';
import { defaultOptions } from './core/rules';
import type { GameDef } from './core/types';

/* ------------------------------------------------------------------ адреса
 * Каждый экран — свой адрес: двор «/», группа «/priklyucheniya/», игра «/nardy/» (вариант «/nardy/dlinnye/»),
 * правила «/nardy/pravila/», партия за этим экраном — адрес игры с «?igra», сетевой стол — «/stol/<код>».
 * Обновили страницу — открывается то же самое; «назад»/«вперёд» браузера ходят по экранам. */

/** Сейчас обрабатываем «назад»/«вперёд»: адрес уже сменил браузер, экраны его не трогают. */
let popping = false;

function go(path: string, replace = false, state: object | null = null) {
  if (popping || location.pathname + location.search === path) return;
  if (replace) history.replaceState(state, '', path);
  else history.pushState(state, '', path);
  // заголовок вкладки меняет экран следом — даём ему отрисоваться
  setTimeout(metrikaHit);
}

/** Встали из-за стола, на который сели с этой же вкладки: шаг назад по истории (popstate покажет прежний экран). */
function backFromTable(): boolean {
  if (popping || !history.state?.table) return false;
  history.back();
  return true;
}

/** Пресет по адресу варианта — его настройки, как у ярлыка. */
function presetOpts(mod: GameModule, preset?: string) {
  return preset ? mod.def.presets?.find((p) => p.id === preset)?.options : undefined;
}

async function openGame(entry: CatalogEntry, r: { preset?: string; rules?: boolean; play?: boolean; article?: boolean; mode?: string; net?: boolean } = {}) {
  // ярлык (например, «Шёл солдат» — поле кинь-двинь): открываем игру с заранее выбранными вариантами
  const g = entry.of ? byId(entry.of) : entry;
  if (!g?.load) return;
  const my = ++navSeq;
  // выход игр из админки: скрытая — только Мастеру, ранний доступ — по праву
  await releaseReady();
  if (releaseOf(g.id).state) await loadAccount();
  if (my !== navSeq) return;
  if (!canPlay(g.id)) {
    showYard('all');
    history.replaceState(null, '', '/');
    if (releaseOf(g.id).state === 'early') earlyNote(g);
    return;
  }
  try {
    let mod = (await g.load()).default;
    if (my !== navSeq) return; // пока грузилось, ушли на другой экран
    // аркада с сетевым режимом: «Дуэль и битва» (или возврат со стола) — обычный экран настройки стола; «назад» — снова аркада
    const arcade = isArcade(mod) ? mod : null;
    if (arcade?.net && (r.net || r.preset)) {
      mod = await arcade.net.load();
      if (my !== navSeq) return;
    }
    if (isArcade(mod)) {
      const a = mod;
      stopArcade = openArcade(a, toYard, { mode: r.mode, onMode: (m) => go(modePath(a.id, m), true), onNet: () => void openGame(entry, { net: true }) });
      return;
    }
    const back = arcade ? () => void openGame(entry) : toYard;
    // вошедшему — сохранение из базы, если там новее (продолжить партию с другого устройства)
    if (!mod.ownSaves) {
      await syncSave(mod.def.id);
      if (my !== navSeq) return;
    }
    const fixed = presetOpts(mod, r.preset) ?? entry.opts;
    let rulesByUrl = !!r.rules; // правила открыли адресом: закрыли — меняем адрес на месте, а не шагаем назад
    openHome(mod, back, fixed, {
      rules: r.rules,
      resume: r.play,
      topExtra: likeButton(mod.def.id),
      onPreset: (p) => {
        go(gamePath(mod.def.id, p), true);
        void attachSeo(homeEl(), location.pathname);
      },
      onRules: (open) => {
        const base = location.pathname.replace(/pravila\/?$/, '');
        if (open) return go(base + 'pravila/', rulesByUrl, { rules: 1 });
        if (popping || !location.pathname.endsWith('/pravila/')) return;
        if (history.state?.rules && !rulesByUrl) history.back();
        else go(base, true);
        rulesByUrl = false;
      },
    });
    homeEl()?.prepend(siteBar({ onSearch: searchFromBar }));
    const seo = attachSeo(homeEl(), location.pathname.replace(/pravila\/$/, ''));
    // статья при игре (комбинации покера): пришли читать — сразу к тексту, игра выше
    if (r.article) void seo.then(() => document.querySelector('#app .seo-page')?.scrollIntoView());
  } catch (e: any) {
    modal(`<h2>Не загрузилось</h2><p>${esc(e?.message || e)}</p>`, [{ text: 'Ок', primary: true }]);
  }
}

/** Поиск из шапки страницы игры — во двор, на найденное. */
function searchFromBar(q: string) {
  go(searchPath(q));
  render({ kind: 'search', q });
  window.scrollTo(0, 0);
}

const homeEl = () => document.querySelector('[data-screen=home]');
const yardEl = () => document.querySelector('[data-screen=yard] .yard-content');
/** Двор с текстом страницы (главная, раздел или группа). */
function showYard(cat: Category | 'all' = 'all') {
  yard.show(cat);
  void attachSeo(yardEl(), location.pathname);
}

/** Номер перехода: игра, догрузившаяся после ухода на другой экран, не открывается. */
let navSeq = 0;
/** Открытая аркада: при уходе с её экрана «назад» браузера — остановить (иначе играет в фоне). */
let stopArcade: (() => void) | null = null;
function leaveArcade() {
  stopArcade?.();
  stopArcade = null;
}

/** «Во двор» — в тот раздел, откуда пришли. */
function toYard() {
  navSeq++;
  go(sectionPath(yard.cat === 'all' ? null : yard.cat));
  yard.group = null;
  showYard(yard.cat);
}

yard.makeBar = () => siteBar({ onSearch: searchFromBar, yard: true });
yard.openGame = (g) => {
  go(gamePath(g.id));
  void openGame(g);
};
yard.onGroup = (g) => {
  go(g ? gamePath(g.id) : sectionPath(yard.cat === 'all' ? null : yard.cat));
  void attachSeo(yardEl(), location.pathname);
};
yard.onCat = (cat) => {
  go(sectionPath(cat === 'all' ? null : cat));
  void attachSeo(yardEl(), location.pathname);
};
// поиск: адрес /poisk/?q=… меняется на месте, пока печатают; стёрли запрос — обратно в раздел
yard.onSearch = (q) => {
  const onSearch = location.pathname.startsWith('/poisk');
  if (q) {
    go(searchPath(q), onSearch);
    void attachSeo(null);
    document.title = `Поиск: ${q} — Вечером на лавочке`;
  } else {
    go(sectionPath(yard.cat === 'all' ? null : yard.cat), onSearch);
    void attachSeo(yardEl(), location.pathname);
  }
};
// возвращение со стола или из ошибки лобби — на место прежнего экрана, без лишней записи в истории
nav.yard = () => {
  navSeq++;
  if (backFromTable()) return;
  go('/', true);
  showYard();
};
nav.home = (id) => {
  const g = byId(id);
  if (!g) return nav.yard();
  if (backFromTable()) return;
  go(location.pathname.startsWith('/stol/') ? gamePath(id) : location.pathname, true);
  void openGame(g, { net: true });
};
nav.table = (code) => {
  // гость с адреса стола или повторное подключение — тот же адрес; иначе — новая запись в истории
  const here = location.pathname.startsWith('/stol/') || location.search.includes('igra');
  go(code ? tablePath(code) : location.pathname + '?igra', here, here ? history.state : { table: 1 });
};

/** Новости и блог: шапка сайта и готовый текст страницы (его пишет пререндер из content/*.md). */
function openPage(r: Extract<Route, { kind: 'page' }>) {
  const el = h(`<section class="page-screen"><div class="page-body"></div></section>`);
  el.prepend(siteBar({ onSearch: searchFromBar, tab: r.tab === 'doc' ? undefined : r.tab }));
  mountScreen('page', el);
  showScreen('page');
  const body = el.querySelector('.page-body') as HTMLElement;
  void attachSeo(body, r.path).then((ok) => {
    if (ok || !body.isConnected) return;
    const list = r.tab === 'blog' ? ['/blog/', 'Все статьи блога'] : ['/novosti/', 'Все новости'];
    document.title = 'Страница не найдена — Вечером на лавочке';
    body.innerHTML = `<article class="seo-page"><h1>Такой страницы нет</h1><p>${
      import.meta.env.PROD ? 'Возможно, запись переехала или адрес набран с ошибкой.' : 'В разработке страниц новостей и блога нет: они собираются при сборке (npm run build, сервер :8787).'
    }</p><p><a href="${list[0]}">${list[1]}</a> · <a href="/">Во двор, к играм</a></p></article>`;
  });
}

/** Показать экран по адресу. */
function render(r: Route) {
  navSeq++;
  leaveArcade();
  closeAllModals();
  if (r.kind === 'table') return resumeTable(r.code);
  if (r.kind === 'page') return openPage(r);
  if (r.kind === 'admin') return void import('./site/admin').then((a) => a.openAdmin(r.tab, siteBar({ onSearch: searchFromBar })));
  if (r.kind === 'auth') {
    // вход и ссылки из писем — окно поверх двора; адрес — снова двор, чтобы токен не остался в истории
    history.replaceState(null, '', '/');
    showYard('all');
    return void handleAuthRoute(r);
  }
  if (r.kind === 'game') {
    const g = byId(r.id);
    if (g?.members) {
      yard.show();
      return yard.openGroup(g);
    }
    if (g && (g.load || g.of)) return void openGame(g, r);
  }
  yard.group = null;
  if (r.kind === 'search' && r.q.trim()) {
    yard.show('all', r.q.trim());
    void attachSeo(null);
    document.title = `Поиск: ${r.q.trim()} — Вечером на лавочке`;
    return;
  }
  // неизвестный адрес и пустой поиск — во двор
  if (r.kind !== 'yard') history.replaceState(null, '', '/');
  showYard(r.kind === 'yard' ? ((r.cat as Category | undefined) ?? 'all') : 'all');
}

// ссылки внутри сайта (текст под игрой) — без перезагрузки страницы
document.addEventListener('click', (e) => {
  const a = (e.target as Element | null)?.closest?.('a[href^="/"]') as HTMLAnchorElement | null;
  if (!a || e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey || a.target) return;
  const url = new URL(a.href);
  // файлы и адреса сервера (вход через Яндекс/VK и т. п.) — обычным переходом
  if (url.origin !== location.origin || /\.\w+$/.test(url.pathname) || url.pathname.startsWith('/api/')) return;
  e.preventDefault();
  go(url.pathname + url.search);
  render(parseRoute(url.pathname, url.search));
  window.scrollTo(0, 0);
});

window.addEventListener('popstate', () => {
  setTimeout(metrikaHit);
  const r = parseRoute(location.pathname, location.search);
  const t = currentTable();
  if (t) {
    if (r.kind === 'table' || (r.kind === 'game' && r.play)) return;
    // сетевой стол: «назад» — как кнопка «Выйти» (с вопросом); локальная партия сохранена — уходим сразу
    if (t.netMode !== 'local') {
      history.pushState({ table: 1 }, '', tablePath(t.roomCode!));
      return t.confirmLeave();
    }
    popping = true;
    try {
      t.leave();
    } finally {
      popping = false;
    }
  }
  popping = true;
  try {
    render(r);
  } finally {
    popping = false;
  }
});

/** ?thumb=<игра> — служебный режим: поле в «красивой» позиции для снимка превью карточки. */
async function thumbMode(id: string) {
  const g = byId(id);
  if (!g?.load) return;
  const mod = (await g.load()).default;
  const stage = document.createElement('div');
  stage.className = 'thumb-stage';
  const board = document.createElement('div');
  board.className = 'thumb-board';
  const controls = document.createElement('div');
  stage.append(board);
  document.body.append(stage);
  // аркада: устройство как есть (в ожидании — показывает часы или заставку)
  if (isArcade(mod)) {
    mod.mount(board, { mode: mod.modes[0]?.id ?? 'A', onScore() {} });
    return;
  }
  const view = mod.createView();
  view.mount(board, { act() {}, mySeats: [], demo: true, controls, name: (s) => mod.def.seats[s]?.name ?? String(s), speed: () => 1, autoSingle: () => false });
  const preset = params.get('preset');
  const st = preset ? await variantShot(mod.def, preset) : mod.def.showcase ? mod.def.showcase() : null;
  if (st) view.setView(mod.def.view(st, 'all'));
}

/**
 * ?thumb=<игра>&preset=<вариант>[&steps=N][&n=игроков][&seed=S] — позиция варианта для снимка страницы варианта:
 * расстановка с настройками пресета и N ходов ботов (по умолчанию 20; если партия кончилась — на ход раньше).
 */
async function variantShot(def: GameDef, presetId: string) {
  const p = def.presets?.find((x) => x.id === presetId);
  if (!p) return null;
  const opts = { ...defaultOptions(def), ...p.options };
  const counts = def.countsFor?.(opts) ?? [];
  const want = Number(params.get('n')) || def.players.default;
  const n = counts.length && !counts.includes(want) ? counts[0] : want;
  const places = def.seatsFor ? def.seatsFor(n) : Array.from({ length: n }, (_, i) => i);
  const seats = places.map((seat) => ({ seat, kind: 'bot' as const, name: def.seats[seat].name, level: def.bot.levels.length - 1 }));
  const seed = Number(params.get('seed')) || 7;
  const a = new Authority(def, seats, opts);
  a.rng = new SeededRng(seed);
  a.state = def.setup(seats, opts, a.rng);
  const rng = new SeededRng(seed ^ 0x5bd1e995);
  const steps = Number(params.get('steps') ?? 20);
  for (let i = 0; i < steps && !def.realtime; i++) {
    const seat = a.toAct()[0];
    if (seat == null) break;
    const action = await def.bot.choose(a.viewFor([seat]), seat, seats.find((s) => s.seat === seat)?.level ?? 0, rng);
    if (action == null) break;
    const before = a.state;
    if (!a.act(seat, action)) break;
    if (a.result) {
      a.state = before;
      break;
    }
  }
  return a.state;
}

/** ?cards — служебный режим: вся колода во всех трёх стилях (проверка рисунков). */
function cardsMode() {
  // ?cards=courts — только фигуры, крупно
  const courts = params.get('cards') === 'courts';
  const deck = makeDeck(54).filter((c) => !courts || (c.r >= 11 && c.r <= 13));
  document.body.innerHTML = DECK_STYLES.map(
    (d) => `<h2 style="color:#fff;font:20px 'PT Serif',serif;margin:16px">${d.title}</h2><div class="cards-sheet">${deck.map((c) => cardHTML(c, d.id)).join('')}${cardHTML(null, d.id)}</div>`
  ).join('');
  const st = document.createElement('style');
  st.textContent = `body{background:#2a4a32;overflow:auto}.cards-sheet{display:flex;flex-wrap:wrap;gap:8px;padding:0 16px}.cards-sheet .card{width:${courts ? 230 : 150}px;height:auto;filter:drop-shadow(0 2px 3px rgba(0,0,0,.4))}`;
  document.head.append(st);
}

const params = new URLSearchParams(location.search);
const thumb = params.get('thumb');
if (thumb) void thumbMode(thumb);
else if (params.has('cards')) cardsMode();
else {
  document.addEventListener('pointerdown', () => Sound.unlock(), { once: true });
  render(parseRoute(location.pathname, location.search));
  offerResume();
  setTimeout(startMetrika);
  startPresence();
  startErrorReports();
  // вернулись со страницы оплаты — «спасибо» (после первого показа экрана: он закрывает окна)
  if (params.has('voshel') || params.has('privyazan')) setTimeout(handleOAuthReturn);
  if (params.has('donate')) setTimeout(() => void loadDonate().then(handleDonateReturn));
  if (params.has('plus')) setTimeout(handlePlusReturn);
  // ссылка из письма поддержки
  if (params.has('obrashenie')) setTimeout(() => void import('./site/support').then((s) => s.handleTicketLink()));
  wireSupportLinks();
  wirePlusLinks();
}
