/* Ячейки сохранения партии за этим экраном: три на игру (store `slots.<игра>`), поверх автосохранения.
 * В ячейку кладётся снимок комнаты (тот же, что пишет автосохранение) и подпись — что за партия и когда. */
import type { Snapshot } from './authority';
import { store } from './settings';
import { modal } from './ui';
import { esc } from './util';

export const SLOTS = 3;

export interface Slot {
  /** Когда сохранено, мс. */
  at: number;
  /** Что за партия: «Май 1990 · Ларёк» (GameView.saveTitle) или номер хода. */
  title: string;
  snap: Snapshot;
}

const key = (game: string) => 'slots.' + game;

export function loadSlots(game: string): (Slot | null)[] {
  const list = store.get<(Slot | null)[]>(key(game), []);
  return Array.from({ length: SLOTS }, (_, i) => list[i] ?? null);
}

export function writeSlot(game: string, i: number, s: Slot) {
  const list = loadSlots(game);
  list[i] = s;
  store.set(key(game), list);
}

export const hasSlots = (game: string) => loadSlots(game).some(Boolean);

function slotLabel(s: Slot | null, i: number) {
  if (!s) return `${i + 1}. Пусто`;
  const when = new Date(s.at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  return `${i + 1}. ${s.title} · ${when}`;
}

/** Окно выбора ячейки: сохранить — в любую (занятая перезаписывается), загрузить — только из занятой. */
export function pickSlot(game: string, mode: 'save' | 'load', done: (i: number, s: Slot | null) => void) {
  const slots = loadSlots(game);
  const m = modal(
    `<h2>${mode === 'save' ? 'Сохранить партию' : 'Загрузить партию'}</h2><div class="slot-list">${slots
      .map((s, i) => `<button class="btn slot-btn" data-slot="${i}"${mode === 'load' && !s ? ' disabled' : ''}>${esc(slotLabel(s, i))}</button>`)
      .join('')}</div>`,
    [{ text: 'Отмена' }]
  );
  m.el.querySelectorAll<HTMLButtonElement>('[data-slot]').forEach((b) => {
    b.onclick = () => {
      const i = Number(b.dataset.slot);
      m.close();
      done(i, slots[i]);
    };
  });
}
