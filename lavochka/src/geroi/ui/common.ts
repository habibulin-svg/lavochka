/* Мелочи интерфейса «Героев»: создание узлов, значок существа, окно поверх всего. */
import { ABILITY_TEXT, CREATURES } from '../sim/creatures';

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, cls = '', text?: string): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
}

export function button(text: string, onClick: () => void, cls = 'g-btn'): HTMLButtonElement {
  const b = h('button', cls, text);
  b.onclick = onClick;
  return b;
}

/** Атлас: 10 кадров в ряд, 6 строк, кадр 240 px; idle — верхний ряд. */
export function creatureIcon(id: string, size = 72): HTMLElement {
  const el = h('i', 'g-cre');
  const k = (size * 1.35) / 240;
  el.style.width = el.style.height = `${size}px`;
  el.style.backgroundImage = `url(/geroi/a/creatures/${id}.webp)`;
  el.style.backgroundSize = `${2400 * k}px ${1440 * k}px`;
  el.style.backgroundPosition = `${(size - 240 * k) / 2}px ${size - 222 * k}px`;
  return el;
}

/** Строки характеристик существа. */
export function creatureLines(id: string): string[] {
  const c = CREATURES[id];
  const out = [
    `Ступень ${c.tier}${c.up ? ', улучшенное' : ''}`,
    `Атака ${c.atk} · Защита ${c.def}`,
    `Урон ${c.dmin}–${c.dmax} · Здоровье ${c.hp}`,
    `Скорость ${c.speed}${c.shots ? ` · Выстрелов ${c.shots}` : ''}`,
    `Цена ${c.cost} семок`,
  ];
  if (c.abilities.length) out.push(c.abilities.map((a) => ABILITY_TEXT[a]).join('; '));
  return out;
}

export function modal(host: HTMLElement, cls: string, onClose?: () => void): { box: HTMLElement; close: () => void } {
  const back = h('div', 'g-modal');
  const box = h('div', `g-panel ${cls}`);
  back.append(box);
  const close = (): void => {
    back.remove();
    onClose?.();
  };
  back.onpointerdown = (e) => {
    if (e.target === back) close();
  };
  host.append(back);
  return { box, close };
}
