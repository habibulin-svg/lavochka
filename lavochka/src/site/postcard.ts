/* Карточка игры внутри записи (новости, блог, «Слово Мастера»): строка [[игра:durak]] в тексте → ссылка с превью,
 * названием и подписью. Общая для пререндера (tools/posts.ts) и предпросмотра в редакторе админки. */
import { esc } from '../core/markdown';
import { byId } from '../games/catalog';
import { gamePath } from './routes';

export function gameCard(id: string, caption: string): string | null {
  const g = byId(id);
  if (!g || g.shelved || (!g.load && !g.of && !g.members)) return null;
  const pic = g.thumb ? `<img src="/thumbs/${esc(g.thumb)}" alt="" loading="lazy" width="240" height="150">` : `<span class="pg-icon" style="background:${esc(g.tint ?? '#5b2f12')}">${esc(g.icon ?? '🎲')}</span>`;
  return `<a class="post-game" href="${gamePath(g.id)}">${pic}<b>${esc(g.title)}</b><span>${esc(caption || g.sub)}</span></a>`;
}
