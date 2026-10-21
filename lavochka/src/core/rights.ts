/* Права игрока (entitlements). Даются на срок (или бессрочно): подпиской, Мастером вручную, позже — группам.
 * Сервер проверяет их сам; клиент получает список при входе только для показа.
 * Голос за столом — бесплатный всем, права на него нет (решение пользователя 2026-10-19). */

export const RIGHTS = {
  video: 'Видео за столом',
  early_access: 'Ранний доступ к новым играм',
  ai: 'Помощники на ИИ',
  ai_unlimited: 'Михалыч без лимита',
  cosmetics: 'Оформление: карты, доски, фишки, кости, сукно',
  lobby_host: 'Свои столы в лобби',
  moderator: 'Модератор',
  master: 'Мастер (всё и админка)',
} as const;

export type RightId = keyof typeof RIGHTS;

export interface RightGrant {
  right: string;
  /** Конец срока (мс) или null — бессрочно. */
  until: number | null;
  /** Право от группы (её название), а не личное. */
  group?: string;
}

/** Есть ли право (Мастеру можно всё). */
export const hasRight = (list: RightGrant[], r: RightId, now = Date.now()) =>
  list.some((g) => (g.right === r || g.right === 'master') && (g.until == null || g.until > now));
