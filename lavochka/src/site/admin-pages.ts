/* Админка → «Тексты» → «Страницы сайта»: заголовок вкладки, описание, заголовок, вводный текст, вопросы и ответы
 * (а у статей и документов — сам текст) любой статичной страницы: игры, варианта, правил, раздела, главной.
 * Исходные тексты — из последней сборки (dist/texts.json), правка хранится на сервере (server/content.ts) и после
 * сохранения кладётся пререндером поверх исходного. Тексты — HTML, как в src/games/<игра>/seo.ts. */
import { esc } from '../core/util';
import { toast } from '../core/ui';
import { call } from './admin';
import './page.css';

interface Faq {
  q: string;
  a: string;
}
interface Texts {
  title: string;
  description: string;
  h1: string;
  intro: string;
  faq: Faq[];
  body?: string;
  short?: string;
}
interface ListItem {
  path: string;
  label: string;
  title: string;
  edited: boolean;
}

/** Карточка в списке «Текстов»: поиск по адресу и названию, правленые — сверху. */
export async function pagesCard(box: HTMLElement, open: (path: string) => void): Promise<void> {
  const r = await call('/api/admin/pages');
  if (!r.ok) return void (box.innerHTML = `<p class="adm-err">${esc(r.body.message ?? 'Не удалось загрузить страницы.')}</p>`);
  const list = r.body.pages as ListItem[];
  box.innerHTML = `<div class="adm-head"><h2>Страницы сайта</h2><span class="adm-muted">${list.length} стр. · правлено: ${list.filter((p) => p.edited).length}</span></div>
    ${r.body.built ? '' : '<p class="adm-muted">Сайт ещё не собран (нет dist/texts.json) — список пуст.</p>'}
    <div class="adm-search"><input type="search" placeholder="Найти страницу: нарды, /durak/, правила, главная…"></div>
    <table class="adm-table"><tbody></tbody></table>`;
  const q = box.querySelector('input') as HTMLInputElement;
  const tb = box.querySelector('tbody') as HTMLElement;
  const draw = () => {
    const t = q.value.trim().toLowerCase();
    const found = t ? list.filter((p) => (p.path + ' ' + p.label + ' ' + p.title).toLowerCase().includes(t)) : list.filter((p) => p.edited || p.path === '/');
    tb.innerHTML =
      found
        .slice(0, 60)
        .map(
          (p) => `<tr><td><button class="adm-link" data-path="${esc(p.path)}"><b>${esc(p.label)}</b></button>${p.edited ? ' <span class="adm-chip">правлено</span>' : ''}<br><small>${esc(p.path)} · ${esc(p.title)}</small></td></tr>`
        )
        .join('') + (found.length > 60 ? `<tr><td class="adm-muted">…и ещё ${found.length - 60} — уточните поиск</td></tr>` : '');
    tb.querySelectorAll<HTMLButtonElement>('[data-path]').forEach((b) => (b.onclick = () => open(b.dataset.path!)));
  };
  q.oninput = draw;
  draw();
}

const FIELDS: { k: 'title' | 'description' | 'h1'; name: string; hint: string; max?: number }[] = [
  { k: 'title', name: 'Заголовок вкладки', hint: '&lt;title&gt;, в поиске — синяя ссылка; до ~65 знаков', max: 65 },
  { k: 'h1', name: 'Заголовок на странице', hint: 'H1' },
  { k: 'description', name: 'Описание', hint: 'для поисковиков, 140–160 знаков', max: 160 },
];

export async function editPage(body: HTMLElement, path: string, back: () => void): Promise<void> {
  const r = await call(`/api/admin/pages?path=${encodeURIComponent(path)}`);
  if (!r.ok) return toast(r.body.message || 'Не удалось открыть.');
  const page = r.body.page as { path: string; label: string; base: Texts | null; edit: Partial<Texts> | null };
  const base: Texts = page.base ?? { title: '', description: '', h1: '', intro: '', faq: [] };
  const cur: Texts = { ...base, ...(page.edit ?? {}) };
  const area = (k: 'intro' | 'body' | 'short', name: string, hint: string, rows: number) =>
    base[k] == null && cur[k] == null
      ? ''
      : `<label class="wide" data-f="${k}">${name} <small>${hint}</small><textarea name="${k}" rows="${rows}" class="adm-html">${esc(cur[k] ?? '')}</textarea></label>`;
  body.innerHTML = `<div class="adm-head"><h1>${esc(page.label)}</h1><button class="btn small" data-a="back">← К списку</button></div>
    <form class="adm-card adm-ed">
      <p class="adm-muted">${esc(path)} · тексты — HTML: абзацы &lt;p&gt;, ссылки &lt;a href="/nardy/"&gt;, жирный &lt;b&gt;. Поле, совпавшее с исходным, не хранится — при правке в коде подтянется новое.</p>
      <div class="adm-ed-split">
        <div class="adm-ed-meta">
          ${FIELDS.map(
            (f) =>
              `<label class="wide" data-f="${f.k}">${f.name} <small>${f.hint}${f.max ? ` · <span data-n="${f.k}"></span>` : ''}</small>${
                f.k === 'description' ? `<textarea name="${f.k}" rows="3">${esc(cur[f.k])}</textarea>` : `<input name="${f.k}" value="${esc(cur[f.k])}">`
              }</label>`
          ).join('')}
          ${area('intro', 'Вводный текст', 'под заголовком', 8)}
          ${area('body', 'Текст', 'статья или документ целиком', 18)}
          ${area('short', 'Абзац на главной', 'про этот раздел', 4)}
          <div class="wide" data-f="faq"><b>Частые вопросы</b> <small class="adm-muted">ответ — HTML; пустые не сохраняются</small><div class="adm-faq"></div>
            <button type="button" class="btn small" data-a="faq+">＋ Вопрос</button></div>
        </div>
        <div class="adm-prev seo-page"></div>
      </div>
      <p class="err" role="alert"></p>
      <div class="adm-row">
        <button class="btn primary">Сохранить и опубликовать</button>
        ${page.edit ? '<button type="button" class="btn small" data-a="reset">Вернуть исходные тексты</button>' : ''}
        <a class="btn small" href="${esc(path)}" target="_blank" rel="noopener">Открыть на сайте ↗</a>
      </div>
    </form>`;
  const form = body.querySelector('form') as HTMLFormElement;
  const prev = body.querySelector('.adm-prev') as HTMLElement;
  const err = body.querySelector('.err') as HTMLElement;
  const faqBox = body.querySelector('.adm-faq') as HTMLElement;
  const val = (k: string) => (form.querySelector(`[name=${k}]`) as HTMLInputElement | HTMLTextAreaElement | null)?.value;

  const faqRow = (f: Faq) => {
    const row = document.createElement('div');
    row.className = 'adm-faq-row';
    row.innerHTML = `<input placeholder="Вопрос" value="${esc(f.q)}"><textarea rows="2" placeholder="Ответ (HTML)">${esc(f.a)}</textarea><button type="button" class="btn small" title="Убрать вопрос">✕</button>`;
    (row.querySelector('button') as HTMLButtonElement).onclick = () => (row.remove(), update());
    faqBox.append(row);
  };
  const faqNow = (): Faq[] =>
    [...faqBox.querySelectorAll('.adm-faq-row')].map((r) => ({ q: (r.querySelector('input') as HTMLInputElement).value.trim(), a: (r.querySelector('textarea') as HTMLTextAreaElement).value.trim() }));
  cur.faq.forEach(faqRow);

  const same = (k: keyof Texts) => (k === 'faq' ? JSON.stringify(faqNow().filter((f) => f.q && f.a)) === JSON.stringify(base.faq) : (val(k) ?? '') === (base[k] ?? ''));
  const update = () => {
    for (const f of FIELDS) if (f.max) {
      const n = (val(f.k) ?? '').length;
      const el = body.querySelector(`[data-n=${f.k}]`) as HTMLElement;
      el.textContent = `${n} зн.`;
      el.style.color = n > f.max + 10 ? '#b3322a' : '';
    }
    // правленое поле — с пометкой и кнопкой «как было»
    body.querySelectorAll<HTMLElement>('[data-f]').forEach((l) => {
      const k = l.dataset.f as keyof Texts;
      const changed = !!page.base && !same(k);
      l.classList.toggle('adm-changed', changed);
      let b = l.querySelector<HTMLButtonElement>('.adm-undo');
      if (changed && !b) {
        b = document.createElement('button');
        b.type = 'button';
        b.className = 'adm-undo';
        b.textContent = '↺ как было';
        b.onclick = (e) => {
          e.preventDefault();
          if (k === 'faq') {
            faqBox.innerHTML = '';
            base.faq.forEach(faqRow);
          } else (form.querySelector(`[name=${k}]`) as HTMLInputElement).value = (base[k] as string) ?? '';
          update();
        };
        l.querySelector('small')?.after(b);
      } else if (!changed) b?.remove();
    });
    const faq = faqNow().filter((f) => f.q && f.a);
    prev.innerHTML = `<p class="adm-muted"><b>${esc(val('title') ?? '')}</b><br>${esc(val('description') ?? '')}</p>
      <h1>${esc(val('h1') ?? '')}</h1>${val('intro') ?? ''}${val('body') ?? ''}${
        faq.length ? `<h2>Частые вопросы</h2><dl class="seo-faq">${faq.map((f) => `<dt>${esc(f.q)}</dt><dd>${f.a}</dd>`).join('')}</dl>` : ''
      }${val('short') != null ? `<h2>На главной</h2>${val('short')}` : ''}`;
  };
  let t: ReturnType<typeof setTimeout> | undefined;
  form.addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(update, 150);
  });
  update();

  (body.querySelector('[data-a=back]') as HTMLButtonElement).onclick = back;
  (body.querySelector('[data-a="faq+"]') as HTMLButtonElement).onclick = () => {
    faqRow({ q: '', a: '' });
    (faqBox.lastElementChild?.querySelector('input') as HTMLInputElement | null)?.focus();
  };
  const reset = body.querySelector<HTMLButtonElement>('[data-a=reset]');
  if (reset)
    reset.onclick = async () => {
      if (!confirm('Убрать все правки этой страницы и вернуть исходные тексты?')) return;
      const r = await call('/api/admin/pages', { path, remove: true });
      if (!r.ok) return void (err.textContent = r.body.message || 'Не вышло.');
      toast('Исходные тексты вернутся после пересборки (несколько секунд).');
      void editPage(body, path, back);
    };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const r = await call('/api/admin/pages', {
      path,
      title: val('title'),
      h1: val('h1'),
      description: val('description'),
      intro: val('intro'),
      body: val('body'),
      short: val('short'),
      faq: faqNow(),
    });
    if (!r.ok) return void (err.textContent = r.body.message || 'Не сохранилось.');
    toast(r.body.edited ? 'Сохранено — страница пересоберётся за несколько секунд.' : 'Совпадает с исходным — правка убрана.');
    void editPage(body, path, back);
  };
}
