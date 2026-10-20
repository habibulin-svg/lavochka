/* Мелкие помощники для интерфейса. */

export const $ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;
export const $$ = <T extends Element = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll(sel)] as T[];

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const esc = (s: unknown) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

export function clone<T>(o: T): T {
  return structuredClone(o);
}

/** Создать элемент из HTML-строки. */
export function h<T extends HTMLElement = HTMLElement>(html: string): T {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild as T;
}

/** Перерисовать панель, не теряя набранного: текст полей (по placeholder), фокус и курсор переживают render(). */
export function keepDrafts(root: HTMLElement, render: () => void) {
  const fields = (el: HTMLElement) => [...el.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('textarea, input[type=text], input:not([type])')];
  const drafts = new Map<string, string>();
  for (const f of fields(root)) if (f.value) drafts.set(f.placeholder, f.value);
  const act = document.activeElement as HTMLInputElement | null;
  const focus = act && root.contains(act) && fields(root).includes(act) ? { ph: act.placeholder, a: act.selectionStart, b: act.selectionEnd } : null;
  render();
  for (const f of fields(root)) {
    const d = drafts.get(f.placeholder);
    if (d != null && !f.value) f.value = d;
    if (focus && f.placeholder === focus.ph) {
      f.focus();
      try {
        f.setSelectionRange(focus.a, focus.b);
      } catch {}
    }
  }
}

export function uid(): string {
  const a = new Uint8Array(12);
  crypto.getRandomValues(a);
  return [...a].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Склонение: plural(5, 'игрок', 'игрока', 'игроков'). */
export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** Сенсорный экран без мыши (телефон, планшет): в подсказках — «нажмите», а не клавиши. */
export function touchScreen(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}
