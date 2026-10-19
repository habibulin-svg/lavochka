/* Лайки игр: кнопка «♥» на экране игры (ставят вошедшие), счётчики — из /api/stats (кэш на минуту),
 * свои лайки — /api/likes. Гостю кнопка предлагает войти. */
import { toast } from '../core/ui';
import { Sound } from '../core/audio';
import { currentUser, onAccount, openAuth } from './account';
import { loadStats, onStats } from './stats';

let counts: Record<string, number> = {};
let mine = new Set<string>();
const subs = new Set<() => void>();
const changed = () => subs.forEach((f) => f());

/** Лайков у игры. */
export const likeCount = (game: string) => counts[game] ?? 0;
/** Стоит ли мой лайк. */
export const liked = (game: string) => mine.has(game);

export function onLikes(f: () => void): () => void {
  subs.add(f);
  return () => subs.delete(f);
}

onStats((s) => {
  if (s.likes) {
    counts = { ...s.likes };
    changed();
  }
});

// вошёл/вышел — свои лайки заново
onAccount((m) => {
  if (!m) {
    if (mine.size) {
      mine = new Set();
      changed();
    }
    return;
  }
  void fetch('/api/likes', { cache: 'no-store' })
    .then((r) => (r.ok ? r.json() : null))
    .then((b) => {
      if (!b) return;
      mine = new Set(b.mine as string[]);
      changed();
    })
    .catch(() => {});
});

/** Поставить или снять лайк. */
export async function toggleLike(game: string): Promise<void> {
  if (!currentUser()) {
    toast('Лайки ставят вошедшие игроки — войдите, это быстро');
    openAuth();
    return;
  }
  const on = !mine.has(game);
  // сразу на экране, потом — ответ сервера
  if (on) mine.add(game);
  else mine.delete(game);
  counts[game] = Math.max(0, likeCount(game) + (on ? 1 : -1));
  changed();
  try {
    const r = await fetch('/api/likes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ game, on }) });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(b.message || 'Не получилось');
    counts[game] = b.count;
    if (b.on) mine.add(game);
    else mine.delete(game);
  } catch (e) {
    if (on) mine.delete(game);
    else mine.add(game);
    counts[game] = Math.max(0, likeCount(game) + (on ? -1 : 1));
    toast((e as Error).message || 'Нет связи с сервером');
  }
  changed();
}

/** Кнопка «♥ N» для экрана игры. */
export function likeButton(game: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'btn like-btn';
  const show = () => {
    const on = liked(game);
    b.classList.toggle('on', on);
    b.innerHTML = `<span class="lh">${on ? '♥' : '♡'}</span> ${likeCount(game) || ''}`;
    b.title = on ? 'Убрать из любимых' : 'В любимые игры';
    b.setAttribute('aria-pressed', String(on));
  };
  show();
  // экран игры пересоздаётся: кнопку убрали со страницы — отписаться при следующем обновлении
  let seen = false;
  setTimeout(() => (seen ||= b.isConnected));
  const off = onLikes(() => {
    if (b.isConnected) seen = true;
    else if (seen) return void off();
    show();
  });
  b.onclick = () => {
    Sound.ui();
    void toggleLike(game);
  };
  void loadStats();
  return b;
}
