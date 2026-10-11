/* Общие кусочки экрана игр реального времени: переключатели в панели под столом (вид, скорость игры). */
import { SPEED_OPTION } from './realtime';
import { h } from './util';

/** Ряд кнопок «подпись: [a][b][c]»; cur — что выбрано; pick — выбор. */
export function segRow(title: string, opts: [string, string][], cur: () => string, pick: (v: string) => void, cls = 'rt-pref'): HTMLElement {
  const row = h(`<div class="${cls}"><span>${title}</span><div class="seg"></div></div>`);
  const s = row.querySelector('.seg') as HTMLElement;
  const sync = () => s.querySelectorAll<HTMLButtonElement>('button').forEach((x) => x.classList.toggle('on', x.dataset.v === cur()));
  for (const [v, label] of opts) {
    const b = h<HTMLButtonElement>(`<button data-v="${v}">${label}</button>`);
    b.onclick = () => {
      pick(v);
      sync();
      b.blur();
    };
    s.appendChild(b);
  }
  sync();
  (row as HTMLElement & { sync?: () => void }).sync = sync;
  return row;
}

/** Скорость игры за столом: меняет любой игрок, у всех сразу (уходит в ввод места — поле sp). */
export function speedRow(cur: () => number, pick: (v: number) => void): HTMLElement & { sync?: () => void } {
  const opts = (SPEED_OPTION.choices ?? []).map((c) => [String(c.value), c.label] as [string, string]);
  return segRow('Скорость', opts, () => String(cur()), (v) => pick(Number(v)));
}
