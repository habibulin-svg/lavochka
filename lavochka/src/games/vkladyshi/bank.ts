/* «Вкладыши» — где лежит коллекция. Вошёл на сайт — на сервере (server/vkladyshi.ts: жвачки открывает сервер, там же кон и обмен);
 * гость — в браузере (store), без кона и обмена. Снимок держим здесь, экран читает его синхронно через get(). */
import { store } from '../../core/settings';
import type { Card } from './cards';
import { card } from './cards';
import { dustExtras, fresh, normalize, openGum, reward as rewardLocal, type Collection, type Deck } from './collection';

const KEY = 'vk.collection';

export type Mode = 'local' | 'server';
let mode: Mode = 'local';
let cur: Collection = normalize(store.get<Collection | null>(KEY, null));
/** Отложенные на кон / в обмен номера (сервер присылает вместе с коллекцией). */
let held: Record<string, number> = {};
let payOn = false;

export const getMode = () => mode;
export const get = () => cur;
export const heldOf = (id: string) => held[id] ?? 0;
export const payEnabled = () => payOn;

/** Ответ сервера — ошибка с текстом для игрока. */
export class BankError extends Error {}

async function api<T = any>(path: string, body?: unknown): Promise<T> {
  const r = await fetch('/api/vk' + path, body === undefined ? { credentials: 'same-origin' } : { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let j: any = null;
  try {
    j = await r.json();
  } catch {
    /* не JSON — ниже ошибка */
  }
  if (!r.ok) throw new BankError(j?.message || 'Сервер не ответил. Попробуйте позже.');
  if (j?.coll) {
    cur = normalize(j.coll);
    held = j.held ?? {};
  }
  return j as T;
}

export { api as vkApi };

/** Узнать, где коллекция: вошедшему — сервер (и одноразовый перенос браузерной, как домашней). */
export async function init(): Promise<Mode> {
  try {
    const r = await fetch('/api/vk', { credentials: 'same-origin' });
    if (r.status === 200) {
      const j = await r.json();
      cur = normalize(j.coll);
      held = j.held ?? {};
      payOn = !!j.pay;
      mode = 'server';
      const local = store.get<Collection | null>(KEY, null);
      if (local && !cur.imported && Object.keys(local.owned ?? {}).length) {
        await api('/import', { coll: local }).catch(() => {});
      }
      return mode;
    }
  } catch {
    /* сервера нет (dev без сервера) — играем в браузере */
  }
  mode = 'local';
  cur = normalize(store.get<Collection | null>(KEY, null));
  return mode;
}

const saveLocal = () => store.set(KEY, cur);

export async function gum(id: string): Promise<Card[] | null> {
  if (mode === 'server') {
    const r = await api<{ got: string[] }>('/gum', { gum: id });
    return r.got.map(card);
  }
  const got = openGum(cur, id);
  saveLocal();
  return got;
}

export async function dust(): Promise<number> {
  if (mode === 'server') return (await api<{ coins: number }>('/dust', {})).coins;
  const n = dustExtras(cur);
  saveLocal();
  return n;
}

export async function setDecks(decks: Deck[], active: number): Promise<void> {
  if (mode === 'server') {
    await api('/decks', { decks, active });
    return;
  }
  cur.decks = decks;
  cur.active = active;
  saveLocal();
}

/** Награда за партию с ботом; сервер считает её с ограничением по времени. */
export async function reward(win: boolean): Promise<number> {
  if (mode === 'server') return (await api<{ coins: number }>('/reward', { win })).coins;
  const n = rewardLocal(cur, win);
  saveLocal();
  return n;
}

/** Обновить снимок с сервера (после кона/обмена). */
export async function refresh(): Promise<void> {
  if (mode === 'server') await api('');
}

/** Для тестов: начать с чистой коллекции в браузере. */
export function resetLocal() {
  mode = 'local';
  cur = fresh();
  held = {};
}
