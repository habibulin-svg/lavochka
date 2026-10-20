/* Админка → «Тексты»: новости, блог и «Слово Мастера» (тексты страниц сайта — admin-pages.ts). Редактор Markdown с кнопками (жирный, заголовки, списки, ссылка),
 * картинками (кнопка, вставка из буфера, перетаскивание — загрузка на сервер) и карточками игр [[игра:id]], предпросмотр рядом.
 * Сервер — server/content.ts: записи в базе; новости и блог после сохранения пересобираются в статичные страницы. */
import { esc } from '../core/util';
import { modal, toast } from '../core/ui';
import { markdown } from '../core/markdown';
import { CATALOG } from '../games/catalog';
import { call } from './admin';
import { gameCard } from './postcard';
import { MASTER_MD } from './master';
import './page.css';

type Kind = 'news' | 'blog' | 'master';
const KIND_NAME: Record<Kind, string> = { news: 'Новость', blog: 'Статья блога', master: 'Слово Мастера' };
const KIND_PATH: Record<string, string> = { news: 'novosti', blog: 'blog' };
const today = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);

const TR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'j', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
};
/** Адрес из заголовка: транслит, дефисы, не длиннее 60. */
export const slugify = (s: string) =>
  s
    .toLowerCase()
    .split('')
    .map((c) => TR[c] ?? c)
    .join('')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '');

export async function drawTexts(body: HTMLElement, open?: { kind: string; slug: string }): Promise<void> {
  if (open) return editPost(body, open.kind as Kind, open.slug);
  const r = await call('/api/admin/posts');
  if (!r.ok) return void (body.innerHTML = `<div class="adm-card adm-err">${esc(r.body.message ?? 'Не удалось загрузить.')}</div>`);
  const posts = r.body.posts as any[];
  const rb = r.body.rebuild;
  const src: Record<string, string> = { file: 'из файла', db: 'из админки', both: 'файл, правлен в админке' };
  const group = (kind: 'news' | 'blog', title: string) => {
    const list = posts.filter((p) => p.kind === kind);
    return `<div class="adm-card"><div class="adm-head"><h2>${title}</h2><button class="btn small" data-new="${kind}">＋ ${kind === 'news' ? 'Новость' : 'Статья'}</button></div>
      <table class="adm-table"><tbody>${list
        .map(
          (p) => `<tr><td><button class="adm-link" data-kind="${p.kind}" data-slug="${esc(p.slug)}"><b>${esc(p.title)}</b></button>${p.hidden ? ' <span class="adm-chip off">снята</span>' : ''}<br><small>/${KIND_PATH[kind]}/${esc(p.slug)}/ · ${esc(src[p.source])}</small></td>
          <td><small>${esc(p.date)}</small></td></tr>`
        )
        .join('')}</tbody></table></div>`;
  };
  const master = posts.find((p) => p.kind === 'master');
  body.innerHTML = `<div class="adm-head"><h1>Тексты</h1></div>
    <div class="adm-card adm-row"><b>✉ Слово Мастера</b><span class="adm-muted">${master ? 'правлено в админке' : 'встроенный текст'}</span><button class="btn small" data-kind="master" data-slug="slovo">Править</button></div>
    <div class="adm-card" data-pages><p class="adm-muted">Страницы сайта загружаются…</p></div>
    ${group('news', 'Новости')}${group('blog', 'Блог')}
    <p class="adm-muted">После сохранения новости и статьи пересобираются в страницы сайта (несколько секунд).${
      rb?.at ? ` Последняя сборка: ${new Date(rb.at).toLocaleTimeString('ru-RU')} — ${rb.ok ? 'готово' : '<b>не удалась</b>: ' + esc(rb.message)}.` : ''
    }${rb?.running ? ' Сейчас собирается…' : ''}</p>`;
  body.querySelectorAll<HTMLButtonElement>('[data-slug]').forEach((b) => (b.onclick = () => void editPost(body, b.dataset.kind as Kind, b.dataset.slug!)));
  body.querySelectorAll<HTMLButtonElement>('[data-new]').forEach((b) => (b.onclick = () => void editPost(body, b.dataset.new as Kind, '')));
  const { pagesCard, editPage } = await import('./admin-pages');
  await pagesCard(body.querySelector('[data-pages]') as HTMLElement, (path) => void editPage(body, path, () => void drawTexts(body)));
}

async function editPost(body: HTMLElement, kind: Kind, slug: string) {
  let p: any = { kind, slug: '', title: '', h1: '', description: '', date: today(), image: '', games: [], body: '', hidden: false, source: 'new' };
  if (slug) {
    const r = await call(`/api/admin/posts?kind=${kind}&slug=${encodeURIComponent(slug)}`);
    if (r.ok) p = r.body.post;
    else if (kind === 'master') p = { ...p, slug: 'slovo', title: 'Слово Мастера', body: MASTER_MD(), source: 'new' };
    else return toast(r.body.message || 'Не удалось открыть.');
  }
  const isMaster = kind === 'master';
  body.innerHTML = `<div class="adm-head"><h1>${KIND_NAME[kind]}${slug && !isMaster ? ': ' + esc(p.title) : ''}</h1><button class="btn small" data-a="back">← К списку</button></div>
    <form class="adm-card adm-ed">
      <div class="adm-ed-meta">
        <label>Заголовок<input name="title" maxlength="200" required value="${esc(p.title)}"></label>
        ${
          isMaster
            ? ''
            : `<label>Адрес <small>/${KIND_PATH[kind]}/…/</small><input name="slug" maxlength="80" pattern="[a-z0-9][a-z0-9-]{1,79}" value="${esc(p.slug)}" placeholder="из заголовка"></label>
        <label>Дата<input name="date" type="date" value="${esc(p.date)}"></label>
        <label class="wide">Описание <small>(для поисковиков и списка записей, до 300 знаков)</small><textarea name="description" rows="2" maxlength="300">${esc(p.description)}</textarea></label>
        <label>Заголовок на странице <small>(если другой)</small><input name="h1" maxlength="200" value="${esc(p.h1 ?? '')}"></label>
        <label>Обложка <small>(для соцсетей)</small><span class="adm-row"><input name="image" value="${esc(p.image ?? '')}" placeholder="/uploads/…"><button type="button" class="btn small" data-a="cover">Загрузить</button></span></label>
        <label class="wide">Статья об играх <small>(id через запятую — запись появится на их страницах)</small><input name="games" value="${esc((p.games ?? []).join(', '))}" placeholder="durak, nardy"></label>`
        }
      </div>
      <div class="adm-tools">
        <button type="button" data-md="b" title="Жирный"><b>Ж</b></button><button type="button" data-md="i" title="Курсив"><i>К</i></button>
        <button type="button" data-md="h2">Заголовок</button><button type="button" data-md="h3">Подзаголовок</button>
        <button type="button" data-md="ul">• Список</button><button type="button" data-md="ol">1. Список</button><button type="button" data-md="q">❝ Цитата</button>
        <button type="button" data-md="a">🔗 Ссылка</button><button type="button" data-md="img">🖼 Картинка</button><button type="button" data-md="game">🎲 Карточка игры</button>
        <span class="adm-muted">картинку можно вставить из буфера или перетащить в текст</span>
      </div>
      <div class="adm-ed-split">
        <textarea name="body" class="adm-src" spellcheck="true">${esc(p.body)}</textarea>
        <div class="adm-prev seo-page"></div>
      </div>
      <p class="err" role="alert"></p>
      <div class="adm-row">
        <button class="btn primary">${isMaster ? 'Сохранить' : 'Сохранить и опубликовать'}</button>
        ${!isMaster && p.source !== 'new' ? `<label class="adm-row"><input type="checkbox" name="hidden"${p.hidden ? ' checked' : ''}> снять с сайта</label>` : ''}
        ${p.source === 'both' || p.source === 'db' ? `<button type="button" class="btn small" data-a="remove">${p.source === 'both' ? 'Вернуть текст из файла' : 'Удалить запись'}</button>` : ''}
        ${!isMaster && p.source !== 'new' ? `<a class="btn small" href="/${KIND_PATH[kind]}/${esc(p.slug)}/" target="_blank" rel="noopener">Открыть на сайте ↗</a>` : ''}
      </div>
    </form>`;
  const form = body.querySelector('form') as HTMLFormElement;
  const ta = form.querySelector('[name=body]') as HTMLTextAreaElement;
  const prev = body.querySelector('.adm-prev') as HTMLElement;
  const err = body.querySelector('.err') as HTMLElement;
  const title = form.querySelector('[name=title]') as HTMLInputElement;
  const slugIn = form.querySelector('[name=slug]') as HTMLInputElement | null;
  let slugTouched = !!p.slug;
  if (slugIn) slugIn.oninput = () => (slugTouched = true);
  const render = () => (prev.innerHTML = `<h1>${esc(title.value || 'Без заголовка')}</h1>${markdown(ta.value, gameCard)}`);
  let t: ReturnType<typeof setTimeout> | undefined;
  ta.oninput = () => {
    clearTimeout(t);
    t = setTimeout(render, 150);
  };
  title.oninput = () => {
    if (slugIn && !slugTouched) slugIn.value = slugify(title.value);
    render();
  };
  render();
  (body.querySelector('[data-a=back]') as HTMLButtonElement).onclick = () => void drawTexts(body);

  /** Обернуть выделение или вставить блок отдельными строками. */
  const wrap = (a: string, b = a) => {
    const { selectionStart: s, selectionEnd: e, value: v } = ta;
    ta.setRangeText(a + (v.slice(s, e) || 'текст') + b, s, e, 'select');
    ta.focus();
    render();
  };
  const block = (text: string) => {
    const s = ta.selectionStart;
    const v = ta.value;
    const before = s && v[s - 1] !== '\n' ? '\n\n' : s && v[s - 2] !== '\n' ? '\n' : '';
    ta.setRangeText(before + text + '\n\n', s, ta.selectionEnd, 'end');
    ta.focus();
    render();
  };
  const linePrefix = (pre: (i: number) => string) => {
    const { selectionStart: s, selectionEnd: e, value: v } = ta;
    const from = v.lastIndexOf('\n', s - 1) + 1;
    const lines = v.slice(from, e).split('\n');
    ta.setRangeText(lines.map((l, i) => pre(i) + l.replace(/^(#{2,3} |[-*] |\d+\. |> )/, '')).join('\n'), from, e, 'select');
    ta.focus();
    render();
  };
  const upload = async (original: File): Promise<string | null> => {
    const file = await shrink(original);
    if (file.size > 5 * 1024 * 1024) return (toast('Картинка больше 5 МБ — уменьшите.'), null);
    const r = await fetch('/api/admin/upload', { method: 'POST', body: file }).catch(() => null);
    const b = r ? await r.json().catch(() => ({})) : { message: 'Нет связи.' };
    if (!r?.ok) return (toast(b.message || 'Не загрузилась.'), null);
    return b.url as string;
  };
  const insertImages = async (files: File[]) => {
    for (const f of files.filter((x) => x.type.startsWith('image/'))) {
      const url = await upload(f);
      if (url) block(`![${(f.name || 'картинка').replace(/\.\w+$/, '').replace(/[[\]]/g, '')}](${url})`);
    }
  };
  const pick = (cb: (f: File[]) => void) => {
    const inp = document.createElement('input');
    inp.type = 'file';
    inp.accept = 'image/webp,image/png,image/jpeg,image/gif';
    inp.multiple = true;
    inp.onchange = () => cb([...(inp.files ?? [])]);
    inp.click();
  };
  ta.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files ?? [])];
    if (files.length) {
      e.preventDefault();
      void insertImages(files);
    }
  });
  ta.addEventListener('dragover', (e) => e.preventDefault());
  ta.addEventListener('drop', (e) => {
    const files = [...(e.dataTransfer?.files ?? [])];
    if (files.length) {
      e.preventDefault();
      void insertImages(files);
    }
  });
  const cover = body.querySelector<HTMLButtonElement>('[data-a=cover]');
  if (cover)
    cover.onclick = () =>
      pick(async ([f]) => {
        const url = f && (await upload(f));
        if (url) (form.querySelector('[name=image]') as HTMLInputElement).value = url;
      });
  body.querySelectorAll<HTMLButtonElement>('[data-md]').forEach(
    (b) =>
      (b.onclick = () => {
        const k = b.dataset.md;
        if (k === 'b') wrap('**');
        else if (k === 'i') wrap('*');
        else if (k === 'h2') linePrefix(() => '## ');
        else if (k === 'h3') linePrefix(() => '### ');
        else if (k === 'ul') linePrefix(() => '- ');
        else if (k === 'ol') linePrefix((i) => `${i + 1}. `);
        else if (k === 'q') linePrefix(() => '> ');
        else if (k === 'a') {
          const url = prompt('Адрес ссылки (на свой сайт — с /, например /nardy/):', '/');
          if (url) wrap('[', `](${url.trim()})`);
        } else if (k === 'img') pick((f) => void insertImages(f));
        else if (k === 'game') pickGames((ids) => block(ids.map((id) => `[[игра:${id}]]`).join('\n')));
      })
  );
  const rm = body.querySelector<HTMLButtonElement>('[data-a=remove]');
  if (rm)
    rm.onclick = async () => {
      if (!confirm(p.source === 'both' ? 'Убрать правки и вернуть текст из файла?' : 'Удалить запись насовсем?')) return;
      const r = await call('/api/admin/posts', { kind, slug: p.slug, remove: true });
      if (!r.ok) return void (err.textContent = r.body.message || 'Не вышло.');
      toast('Готово.');
      void drawTexts(body);
    };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(form);
    const newSlug = isMaster ? 'slovo' : String(f.get('slug') || slugify(title.value));
    const r = await call('/api/admin/posts', {
      kind,
      slug: newSlug,
      oldSlug: p.source !== 'new' ? p.slug : undefined,
      title: f.get('title'),
      h1: f.get('h1'),
      description: f.get('description'),
      date: f.get('date'),
      image: f.get('image'),
      games: f.get('games'),
      body: ta.value,
      hidden: f.get('hidden') === 'on',
    });
    if (!r.ok) return void (err.textContent = r.body.message || 'Не сохранилось.');
    toast(isMaster ? 'Слово Мастера сохранено.' : 'Сохранено — страница пересоберётся за несколько секунд.');
    void editPost(body, kind, r.body.slug);
  };
}

/** Выбор игр для карточек: поиск по названию, отметить несколько. */
function pickGames(done: (ids: string[]) => void) {
  const games = CATALOG.filter((g) => !g.shelved && (g.load || g.of || g.members));
  const box = document.createElement('div');
  box.className = 'adm-pick';
  box.innerHTML = `<h2>Карточки игр</h2><input placeholder="Найти игру…" class="adm-pick-q"><div class="adm-pick-list">${games
    .map((g) => `<label data-t="${esc((g.title + ' ' + g.id + ' ' + g.sub).toLowerCase())}"><input type="checkbox" value="${g.id}"> ${esc(g.icon ?? '')} <b>${esc(g.title)}</b> <small>${esc(g.sub)}</small></label>`)
    .join('')}</div>`;
  const q = box.querySelector('.adm-pick-q') as HTMLInputElement;
  q.oninput = () => {
    const t = q.value.trim().toLowerCase();
    box.querySelectorAll<HTMLElement>('[data-t]').forEach((l) => (l.hidden = !!t && !l.dataset.t!.includes(t)));
  };
  modal(box, [
    { text: 'Отмена' },
    {
      text: 'Вставить',
      primary: true,
      action: () => {
        const ids = [...box.querySelectorAll<HTMLInputElement>('input[type=checkbox]:checked')].map((c) => c.value);
        if (ids.length) done(ids);
      },
    },
  ]);
  setTimeout(() => q.focus(), 50);
}

/** Ужать картинку перед загрузкой: не шире 1600 px, webp. Анимированный gif и то, что не стало меньше, — как есть. */
async function shrink(file: File): Promise<Blob> {
  if (file.type === 'image/gif' || typeof createImageBitmap !== 'function') return file;
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k);
    c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    bmp.close();
    const out = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/webp', 0.85));
    // браузер без webp отдаёт png — тогда лучше исходник
    return out && out.type === 'image/webp' && (out.size < file.size || k < 1) ? out : file;
  } catch {
    return file;
  }
}
