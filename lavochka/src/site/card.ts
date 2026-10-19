/* Карточка игры (без DOM): одна разметка и для двора, и для готовых страниц (похожие игры, разделы) — пререндер
 * пишет её прямо в HTML, поэтому поисковик видит карточки-ссылки без скриптов. Стили — launcher/yard.css. */
import { byId, membersOf, type CatalogEntry } from '../games/catalog';
import { gamePath } from './routes';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Готова ли карточка: своя игра, ярлык на готовую игру или группа, где есть готовое. */
export const isReady = (g: CatalogEntry): boolean => !!g.load || (!!g.of && !!byId(g.of)?.load) || membersOf(g).some(isReady);

export interface CardOpts {
  /** Есть сохранённая партия (только в браузере). */
  save?: boolean;
  /** Штамп неготовой карточки: «скоро», «в планах». */
  stamp?: string;
  /** Картинки: ленивая загрузка (во дворе) или сразу. */
  lazy?: boolean;
  /** Лайков (во дворе, с сервера). */
  likes?: number;
}

export function cardMarkup(g: CatalogEntry, o: CardOpts = {}): string {
  const ready = isReady(g);
  const base = (import.meta as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';
  const alt = `${g.title} — ${g.sub}`;
  return `<a class="game-card${ready ? ' ready' : ''}${g.members ? ' group' : ''}" href="${ready ? gamePath(g.id) : '#'}" style="--tint:${g.tint}">
      <span class="gc-pic">${
        g.thumb
          ? `<img src="${base}thumbs/${esc(g.thumb)}" alt="${esc(alt)}" width="480" height="300"${o.lazy === false ? '' : ' loading="lazy"'}>`
          : `<span class="gc-glyph">${esc(g.icon)}</span>`
      }</span>
      <span class="gc-icon">${esc(g.icon)}</span>
      <span class="gc-title">${esc(g.title)}</span>
      <span class="gc-sub">${esc(g.sub)}</span>
      ${g.variants?.length ? `<span class="gc-vars">${g.variants.map(esc).join(' · ')}</span>` : ''}
      <span class="gc-meta"><span class="gc-players">👥 ${esc(g.players)}</span>${g.members ? `<span class="gc-count">${membersOf(g).length} игр</span>` : ''}${o.save ? '<span class="gc-save">▶ партия</span>' : ''}${o.likes ? `<span class="gc-likes" title="Лайков">♥ ${o.likes}</span>` : ''}</span>
      ${ready || !o.stamp ? '' : `<span class="stamp">${esc(o.stamp)}</span>`}
    </a>`;
}
