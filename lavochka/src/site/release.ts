/* Выход игр на этом экране: что скрыто, что в раннем доступе, что новинка и в каком порядке (src/core/release.ts).
 * Приходит со счётчиками (/api/stats); нет связи — все игры для всех. Мастер видит и скрытые. */
import { hasRight } from '../core/rights';
import { mayPlay, type GameRelease, type Release } from '../core/release';
import { currentUser, onAccount } from './account';
import { loadStats, onStats } from './stats';

let rel: Release = {};
let key = '{}';
const subs = new Set<() => void>();
const changed = () => subs.forEach((f) => f());

onStats((s) => {
  const k = JSON.stringify(s.release ?? {});
  if (k === key) return;
  key = k;
  rel = s.release ?? {};
  changed();
});
// вошёл или вышел — меняется, что видно
onAccount(() => changed());

export const releaseOf = (id: string): GameRelease => rel[id] ?? {};

const rights = () => currentUser()?.rights ?? [];
export const isMaster = () => hasRight(rights(), 'master');

/** Видна ли игра во дворе и в поиске. */
export const canSee = (id: string) => releaseOf(id).state !== 'hidden' || isMaster();

/** Можно ли открыть игру. */
export const canPlay = (id: string): boolean => mayPlay(rel, id, rights());

/** Метка на карточке. */
export function releaseBadge(id: string): string {
  const r = releaseOf(id);
  return r.state === 'hidden' ? 'скрыта' : r.state === 'early' ? 'ранний доступ' : r.new ? 'новинка' : '';
}

/** Подписаться на изменения (выход игр, вход/выход игрока). */
export function onRelease(f: () => void): () => void {
  subs.add(f);
  return () => subs.delete(f);
}

/** Дождаться выхода игр (открыли игру по адресу сразу после загрузки) — не дольше пары секунд. */
export const releaseReady = () => Promise.race([loadStats(), new Promise((r) => setTimeout(r, 2500))]);
