/* Аватары игроков: дворовые значки на выбор или фото из Яндекса/VK (если игрок вошёл через них).
 * В базе — значок или 'photo'; наружу — значок или адрес фото. */

export const AVATARS = ['🐱', '🐶', '🦊', '🐻', '🐸', '🐰', '🦉', '🐢', '⚽', '🚲', '🎸', '🪁', '🧢', '🍦', '🌻', '⭐', '🎲', '♟️', '🃏', '🚀'];

/** Фото только с сервисов входа (их адреса не меняют смысла страницы и не следят сверх того, что уже знает вход). */
export const PHOTO_RE = /^https:\/\/([a-z0-9-]+\.)*(yandex\.net|userapi\.com|vk\.com|vk\.ru|mycdn\.me|ok\.ru)\/[^\s"'<>]{1,400}$/i;

/** Аватар для показа: значок, адрес фото или null. */
export function avatarOf(avatar: string | null | undefined, photo: string | null | undefined): string | null {
  if (avatar === 'photo') return photo && PHOTO_RE.test(photo) ? photo : null;
  return avatar && AVATARS.includes(avatar) ? avatar : null;
}

/** Разметка аватара: картинка или значок (cls — для размеров). */
export function avatarHtml(a: string | null | undefined, cls = 'ava'): string {
  if (!a) return `<span class="${cls} ava-none" aria-hidden="true">👤</span>`;
  if (a.startsWith('https://')) return `<img class="${cls}" src="${a.replace(/"/g, '')}" alt="" referrerpolicy="no-referrer" loading="lazy">`;
  return `<span class="${cls}" aria-hidden="true">${a}</span>`;
}
