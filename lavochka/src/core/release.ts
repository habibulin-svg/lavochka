/* Выход игр (админка → «Игры»): скрыта (видит только Мастер), ранний доступ (право early_access), «новинка», порядок на дворе.
 * Хранится в настройках сайта (site_settings 'games'), всем приходит вместе со счётчиками (/api/stats). Без записи — игра для всех. */
import { hasRight, type RightGrant } from './rights';

export type ReleaseState = 'all' | 'early' | 'hidden';

export interface GameRelease {
  state?: 'early' | 'hidden';
  /** Метка «новинка» на карточке. */
  new?: boolean;
  /** Место на дворе (меньше — выше); без него — как в каталоге. */
  order?: number;
}

export type Release = Record<string, GameRelease>;

export const RELEASE_STATE: Record<ReleaseState, string> = { all: 'для всех', early: 'ранний доступ', hidden: 'скрыта' };

/** Привести присланное к виду: только известные поля, пустые записи — долой. */
export function cleanRelease(x: unknown, known: (id: string) => boolean): Release {
  const out: Release = {};
  if (!x || typeof x !== 'object') return out;
  for (const [id, v] of Object.entries(x as Record<string, any>)) {
    if (!known(id) || !v || typeof v !== 'object') continue;
    const r: GameRelease = {};
    if (v.state === 'early' || v.state === 'hidden') r.state = v.state;
    if (v.new === true) r.new = true;
    const o = Number(v.order);
    if (v.order != null && v.order !== '' && Number.isInteger(o) && o >= 1 && o <= 999) r.order = o;
    if (Object.keys(r).length) out[id] = r;
  }
  return out;
}

/** Можно ли играть в игру с такими правами: скрытая — только Мастеру, ранний доступ — с правом early_access. */
export function mayPlay(rel: Release, id: string, rights: RightGrant[], now = Date.now()): boolean {
  const st = rel[id]?.state;
  if (st === 'hidden') return hasRight(rights, 'master', now);
  if (st === 'early') return hasRight(rights, 'early_access', now);
  return true;
}
