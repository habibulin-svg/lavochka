/* Сохранения ГОПС: три ячейки в localStorage (gops-saves). В ячейке — настройка партии (уровень по id), снимок мира
 * (sim/snapshot.ts, тот же, что чинит рассинхрон в сети) и ход миссии. Сеть не сохраняется. */
import type { Side } from './game';
import type { MissionRun } from './sim/mission';
import type { Snapshot } from './sim/snapshot';
import type { Scheme } from './sim/world';

export const SLOTS = 3;
const KEY = 'gops-saves';

export type SaveKind = 'mission' | 'quick' | 'pustyr';

export interface SaveSetup {
  /** id уровня (public/gops/levels/<id>.json). */
  level: string;
  theme: string;
  time?: string;
  sides: Side[];
  seed: number;
  ammo?: Record<string, number>;
  mines?: number;
  barrels?: number;
  scheme?: Scheme;
  /** Миссия кампании — по id из missions.json. */
  mission?: string;
}

export interface Save {
  /** Когда сохранено, мс. */
  at: number;
  kind: SaveKind;
  title: string;
  setup: SaveSetup;
  snap: Snapshot;
  run?: Omit<MissionRun, 'def'>;
}

export function loadSaves(): (Save | null)[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as (Save | null)[];
    return Array.from({ length: SLOTS }, (_, i) => list[i] ?? null);
  } catch {
    return Array(SLOTS).fill(null);
  }
}

/** Записать в ячейку; false — хранилище недоступно или переполнено. */
export function writeSave(slot: number, s: Save): boolean {
  const list = loadSaves();
  list[slot] = s;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

/** «Расточка · 2 ноября, 21:40» — строка ячейки в списке. */
export function slotLabel(s: Save | null, i: number): string {
  if (!s) return `${i + 1}. Пусто`;
  const d = new Date(s.at);
  const when = d.toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  return `${i + 1}. ${s.title} · ${when}`;
}
