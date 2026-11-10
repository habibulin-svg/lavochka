/* Ключ озвучки: короткий хеш исходного текста (до подстановок {name}/{leader}/{n}). Один и тот же у выгрузки
 * (tools/zakoldovannaya/voice/extract.ts) и у проигрывателя (ui/tts.ts) — файл public/zakoldovannaya/voice/<ключ>.ogg. */
export function vkey(text: string): string {
  let h = 0x811c9dc5;
  const t = text.replace(/\s+/g, ' ').trim();
  for (let i = 0; i < t.length; i++) {
    h ^= t.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36).padStart(7, '0');
}
