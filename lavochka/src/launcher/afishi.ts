/* Афиши больших игр во дворе: ряд вытянутых плакатов под заголовком (картинка, логотип, пояснение).
 * Картинки и логотипы — public/afishi/, собирает tools/afishi/make.py. Игры остаются и в общей сетке. */
import { CATALOG, type CatalogEntry } from '../games/catalog';
import { esc, h } from '../core/util';
import { gamePath } from '../site/routes';
import { canSee, releaseBadge } from '../site/release';

export interface Afisha {
  id: string;
  /** Пояснение под логотипом: одна-две строки о главном. */
  pitch: string;
  /** Метки под пояснением (игроки берутся из каталога). */
  tags: string[];
}

/** Порядок — как на дворе. Факты — из каталога и def.ts игр. */
export const AFISHI: Afisha[] = [
  { id: 'gops', pitch: 'Пошаговая артиллерия гопников в больших кепках: разрушаемая земля, кампания на 66 миссий.', tags: ['по сети'] },
  { id: 'geroi', pitch: 'Пошаговая стратегия: бой на гексах, четыре фракции, Арена с драфтом и рейтингом.', tags: ['по сети'] },
  { id: 'kommersy', pitch: 'От ларька на Затулинке до лондонского клуба: сделки, крыша, дефолт.', tags: ['с 1988 по 2003', 'по сети'] },
  { id: 'vkladyshi', pitch: 'Карточная игра на настоящих вкладышах 90-х: жвачки, альбом и партии с соседом.', tags: ['по сети'] },
  { id: 'zakoldovannaya', pitch: 'Первая советская RPG 1990 года: 15 приключений по книге и кампании.', tags: [] },
];

export const AFISHA_IDS = new Set(AFISHI.map((a) => a.id));

/** Гаражи под афишами: цвет ворот и что ещё на них (мел, кот на крыше). */
const GARAGES: { col: string; chalk?: string; cat?: boolean }[] = [
  { col: '#56606c' },
  { col: '#62553f', chalk: 'ЦОЙ ЖИВ' },
  { col: '#4a5c4c', cat: true },
  { col: '#575070', chalk: 'Вася + Лена' },
  { col: '#4b6070', chalk: '♥' },
];
const CAT = `<svg class="gr-cat" viewBox="-30 -42 50 44" aria-hidden="true"><g fill="#0c0c10"><ellipse cx="0" cy="-12" rx="16" ry="12"/><circle cx="14" cy="-24" r="8"/><path d="M8 -30 l3 -9 l4 7Z M16 -30 l5 -8 l2 9Z"/><path d="M-16 -10 q-14 -4 -10 -22" stroke="#0c0c10" stroke-width="4" fill="none"/></g><circle cx="12" cy="-25" r="1.6" fill="#d8e070"/><circle cx="18" cy="-25" r="1.6" fill="#d8e070"/></svg>`;

/** Ряд гаражей с афишами на воротах; щелчок — open(игра). Игры, которых игроку не видно, пропускаются. */
export function afishiRow(open: (g: CatalogEntry) => void): HTMLElement {
  const row = h(`<div class="afishi" aria-label="Большие игры"></div>`);
  let n = 0;
  for (const a of AFISHI) {
    const g = CATALOG.find((c) => c.id === a.id);
    if (!g || !canSee(g.id)) continue;
    const badge = releaseBadge(g.id);
    const last = Number(g.players.match(/(\d+)\D*$/)?.[1] ?? 2);
    const tags = [`${g.players} ${last === 1 ? 'игрок' : last <= 4 ? 'игрока' : 'игроков'}`, ...a.tags];
    const gar = GARAGES[n % GARAGES.length];
    const el = h<HTMLAnchorElement>(`<a class="garage" href="${gamePath(g.id)}" style="--tint:${g.tint};--g:${gar.col}">
      <span class="gr-roof"><b>${17 + n++}</b>${gar.cat ? CAT : ''}</span>
      <span class="gr-door">${gar.chalk ? `<span class="gr-chalk">${esc(gar.chalk)}</span>` : ''}<span class="gr-lock"></span>
      <span class="afisha"><span class="af-art"><img src="/afishi/${g.id}.webp" alt="" loading="lazy" decoding="async">
        <img class="af-logo" src="/afishi/${g.id}-logo.webp" alt="${esc(g.title)}" decoding="async">
        ${badge ? `<span class="af-badge">${esc(badge)}</span>` : ''}</span>
      <span class="af-text"><span class="af-pitch">${esc(a.pitch)}</span><span class="af-tags">${tags.map((t) => `<i>${esc(t)}</i>`).join('')}</span></span></span>
      </span>
    </a>`);
    el.onclick = (e) => {
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      open(g);
    };
    row.appendChild(el);
  }
  return row;
}
