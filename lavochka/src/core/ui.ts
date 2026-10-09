/* Экраны, модальные окна и всплывающие подсказки. */
import { Sound } from './audio';
import { h } from './util';

const screens = new Map<string, HTMLElement>();

function app(): HTMLElement {
  return document.getElementById('app')!;
}

export function mountScreen(id: string, el: HTMLElement) {
  removeScreen(id);
  el.classList.add('screen');
  el.dataset.screen = id;
  screens.set(id, el);
  app().appendChild(el);
}

export function removeScreen(id: string) {
  const old = screens.get(id);
  if (old) old.remove();
  screens.delete(id);
}

export function showScreen(id: string) {
  screens.forEach((el, k) => el.classList.toggle('active', k === id));
  window.scrollTo(0, 0);
}

export function currentScreen(): string | null {
  for (const [k, el] of screens) if (el.classList.contains('active')) return k;
  return null;
}

export interface ModalButton {
  text: string;
  primary?: boolean;
  /** Вернуть false, чтобы окно не закрывалось. */
  action?: () => void | boolean;
}

export interface ModalHandle {
  el: HTMLElement;
  body: HTMLElement;
  close(): void;
}

/** Модальное окно. Несколько окон складываются стопкой. */
export function modal(html: string | HTMLElement, buttons: ModalButton[] = [], opts: { wide?: boolean; cls?: string; dismiss?: boolean } = {}): ModalHandle {
  const el = h(`<div class="modal ${opts.cls || ''}"><div class="sheet modal-body ${opts.wide ? 'wide' : ''}">
      <div class="modal-content"></div><div class="row buttons"></div></div></div>`);
  const body = el.querySelector('.modal-content') as HTMLElement;
  if (typeof html === 'string') body.innerHTML = html;
  else body.appendChild(html);
  const box = el.querySelector('.buttons') as HTMLElement;
  const handle: ModalHandle = {
    el,
    body,
    close: () => {
      el.remove();
      document.removeEventListener('keydown', onKey);
    },
  };
  for (const b of buttons) {
    const btn = document.createElement('button');
    btn.className = 'btn' + (b.primary ? ' primary' : '');
    btn.textContent = b.text;
    btn.onclick = () => {
      Sound.ui();
      if (b.action && b.action() === false) return;
      handle.close();
    };
    box.appendChild(btn);
  }
  if (!buttons.length) box.remove();
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && opts.dismiss !== false && el === document.querySelector('.modal:last-of-type')) handle.close();
  };
  if (opts.dismiss !== false) {
    el.addEventListener('click', (e) => e.target === el && handle.close());
    document.addEventListener('keydown', onKey);
  }
  document.body.appendChild(el);
  return handle;
}

export function closeAllModals() {
  document.querySelectorAll('.modal').forEach((m) => m.remove());
}

let toastBox: HTMLElement | null = null;
export function toast(text: string, ms = 2600) {
  if (!toastBox) {
    toastBox = h('<div class="toasts"></div>');
    document.body.appendChild(toastBox);
  }
  const t = h(`<div class="toast"></div>`);
  t.textContent = text;
  toastBox.appendChild(t);
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 400);
}
