/* Текст SEO-страницы (article#seo, его пишет tools/prerender.ts) — под экраном игры и во дворе.
 * При первом заходе текст уже в HTML; при переходах внутри сайта — берём его из готовой страницы того адреса. */
import './page.css';

interface Text {
  html: string;
  title: string;
}
const cache = new Map<string, Text | null>();

// текст, пришедший с самой страницей: забираем из-под #app, дальше он живёт внутри экрана
const first = document.getElementById('seo');
if (first) {
  cache.set(first.dataset.path || location.pathname, { html: first.innerHTML, title: document.title });
  first.remove();
}

async function textFor(path: string): Promise<Text | null> {
  if (cache.has(path)) return cache.get(path)!;
  // в разработке пререндера нет — Vite на любой адрес отдаёт пустую оболочку
  if (!import.meta.env.PROD) return null;
  let t: Text | null = null;
  try {
    const r = await fetch(path, { headers: { accept: 'text/html' } });
    if (r.ok) {
      const doc = new DOMParser().parseFromString(await r.text(), 'text/html');
      const art = doc.getElementById('seo');
      if (art) t = { html: art.innerHTML, title: doc.title };
    }
  } catch {
    /* нет сети — без текста */
  }
  cache.set(path, t);
  return t;
}

let gen = 0;

/** Поставить текст страницы `path` в конец экрана `host` (прежний — убрать) и заголовок вкладки той страницы.
 * Вернёт false, если текста у адреса нет. */
export async function attachSeo(host: Element | null, path = location.pathname): Promise<boolean> {
  const my = ++gen;
  document.querySelectorAll('#app .seo-page, #app .site-foot').forEach((e) => e.remove());
  if (!host) return false;
  const t = await textFor(path);
  if (my !== gen || !host.isConnected) return true;
  if (!t) return false;
  document.title = t.title;
  const el = document.createElement('article');
  el.className = 'seo-page';
  el.innerHTML = t.html;
  // карточки страницы двора уже показывает сам двор — в тексте они для поисковика и для чтения без скриптов
  if (host.closest('[data-screen=yard]')) el.querySelectorAll('.seo-cards[data-yard]').forEach((c) => c.remove());
  host.appendChild(el);
  // подвал — не на листе, а под ним, на тёмном фоне экрана: не отвлекает от текста
  const foot = el.querySelector('.site-foot');
  if (foot) host.appendChild(foot);
  // рекорды: сервер вписал свежие строками для поисковика, в браузере — живая таблица с разделами
  el.querySelectorAll<HTMLElement>('.seo-records[data-records]').forEach((sec) => {
    const game = sec.dataset.records!;
    void import('../core/records-ui').then(({ recordsBox }) => {
      const head = sec.querySelector('h2');
      sec.innerHTML = '';
      if (head) sec.appendChild(head);
      sec.appendChild(recordsBox(game, { rows: 10 }));
    });
  });
  return true;
}
