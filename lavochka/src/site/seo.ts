/* Тексты SEO-страниц (без DOM). У игры — необязательный src/games/<id>/seo.ts с `export const seo: GameSeo`;
 * чего там нет, пререндер собирает сам из каталога и правил. Ключевые фразы — docs/seo/games.json, план — docs/seo/plan.md. */

export interface Faq {
  q: string;
  /** Ответ (HTML). */
  a: string;
}

export interface PageText {
  /** <title>, до ~65 знаков: «Длинные нарды онлайн — играть бесплатно с компьютером». */
  title?: string;
  /** Заголовок страницы: «Длинные нарды онлайн». */
  h1?: string;
  /** meta description, 140–160 знаков: «бесплатно», «без регистрации», «с другом по ссылке». */
  description?: string;
  /** Вводный текст под заголовком (HTML, абзацы <p>). */
  intro?: string;
  /** Частые вопросы — блок FAQ и разметка FAQPage. */
  faq?: Faq[];
}

export interface GameSeo extends PageText {
  /** Тексты страниц вариантов (ключ — id пресета из routes.ts VARIANTS). */
  variants?: Record<string, PageText>;
  /** Страница правил /<игра>/pravila/. */
  rules?: PageText;
}

/** Обрезать описание по слову до n знаков. */
export function clip(s: string, n = 160): string {
  const t = s.replace(/\s+/g, ' ').trim();
  if (t.length <= n) return t;
  const cut = t.slice(0, n - 1);
  return cut.slice(0, cut.lastIndexOf(' ')).replace(/[,.;:—–-]+$/, '') + '…';
}

/** Убрать теги (для description и JSON-LD). */
export const plain = (html: string) =>
  html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&laquo;/g, '«')
    .replace(/&raquo;/g, '»')
    .replace(/&mdash;/g, '—')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
