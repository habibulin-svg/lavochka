/* Markdown записей (новости, блог, «Слово Мастера») → HTML. Один и тот же код у пререндера (tools/posts.ts), сервера
 * и предпросмотра в редакторе админки. Разметка: ## и ### заголовки, абзацы, списки (- и 1.), > цитаты, таблицы через |,
 * **жирный**, *курсив*, [ссылка](/адрес/), картинка ![подпись](/путь.webp) отдельной строкой, карточка игры [[игра:durak]]
 * (или [[игра:durak|подпись]]) отдельной строкой; строка, начинающаяся с <, идёт как есть (HTML). */

export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Строчная разметка: экранирование, ссылки, жирный, курсив, код. */
export function inline(s: string): string {
  let t = esc(s);
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  t = t.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_, text, href) => `<a href="${href}">${text}</a>`);
  t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  t = t.replace(/(^|[\s(«])\*([^*\s][^*]*?)\*(?=[\s).,:;!?»]|$)/g, '$1<i>$2</i>');
  t = t.replace(/(^|[\s(«])_([^_\s][^_]*?)_(?=[\s).,:;!?»]|$)/g, '$1<i>$2</i>');
  return t;
}

/** Карточка игры для строки «[[игра:id]]» или «[[игра:id|подпись]]» — HTML или null (нет такой игры). */
export type GameCardFn = (id: string, caption: string) => string | null;

/** Markdown → HTML (подмножество, см. шапку файла). */
export function markdown(src: string, card?: GameCardFn): string {
  const lines = src.replace(/\r/g, '').split('\n');
  const out: string[] = [];
  let i = 0;
  const isBlockStart = (l: string) => /^(#{2,4}\s|[-*]\s|\d+\.\s|>\s?|\||<|!\[|\[\[)/.test(l) || !l.trim();
  while (i < lines.length) {
    const l = lines[i];
    if (!l.trim()) {
      i++;
      continue;
    }
    let m: RegExpMatchArray | null;
    if ((m = l.match(/^(#{2,4})\s+(.*)$/))) {
      out.push(`<h${m[1].length}>${inline(m[2])}</h${m[1].length}>`);
      i++;
    } else if ((m = l.match(/^\[\[(?:игра|game):\s*([^\]|\s]+)\s*(?:\|([^\]]*))?\]\]\s*$/i))) {
      // карточка игры (в редакторе админки — кнопка «Карточка игры»); подряд идущие — одним рядом
      const cards: string[] = [];
      while (i < lines.length && (m = lines[i].match(/^\[\[(?:игра|game):\s*([^\]|\s]+)\s*(?:\|([^\]]*))?\]\]\s*$/i))) {
        const c = card?.(m[1], (m[2] ?? '').trim());
        if (c) cards.push(c);
        i++;
      }
      if (cards.length) out.push(`<div class="post-games">${cards.join('')}</div>`);
    } else if ((m = l.match(/^!\[([^\]]*)\]\(([^)\s]+)\)\s*$/))) {
      out.push(`<figure class="post-pic"><img src="${esc(m[2])}" alt="${esc(m[1])}" loading="lazy">${m[1] ? `<figcaption>${inline(m[1])}</figcaption>` : ''}</figure>`);
      i++;
    } else if (/^[-*]\s/.test(l) || /^\d+\.\s/.test(l)) {
      const ordered = /^\d+\./.test(l);
      const items: string[] = [];
      while (i < lines.length && (ordered ? /^\d+\.\s/ : /^[-*]\s/).test(lines[i])) {
        let item = lines[i].replace(/^([-*]|\d+\.)\s+/, '');
        i++;
        // продолжение пункта — строка с отступом
        while (i < lines.length && /^\s{2,}\S/.test(lines[i])) item += ' ' + lines[i++].trim();
        items.push(`<li>${inline(item)}</li>`);
      }
      out.push(ordered ? `<ol>${items.join('')}</ol>` : `<ul>${items.join('')}</ul>`);
    } else if (/^>/.test(l)) {
      const q: string[] = [];
      while (i < lines.length && /^>/.test(lines[i])) q.push(lines[i++].replace(/^>\s?/, ''));
      out.push(`<blockquote>${markdown(q.join('\n'), card)}</blockquote>`);
    } else if (/^\|/.test(l)) {
      const rows: string[][] = [];
      while (i < lines.length && /^\|/.test(lines[i])) {
        const cells = lines[i++].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // строка-разделитель под заголовком
        rows.push(cells);
      }
      const [head, ...body] = rows;
      out.push(
        `<table class="seo-table"><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join('')}</tr></thead><tbody>${body
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`)
          .join('')}</tbody></table>`
      );
    } else if (/^</.test(l)) {
      const raw: string[] = [];
      while (i < lines.length && lines[i].trim()) raw.push(lines[i++]);
      out.push(raw.join('\n'));
    } else {
      const p: string[] = [l.trim()];
      i++;
      while (i < lines.length && !isBlockStart(lines[i])) p.push(lines[i++].trim());
      out.push(`<p>${inline(p.join(' '))}</p>`);
    }
  }
  return out.join('\n');
}

