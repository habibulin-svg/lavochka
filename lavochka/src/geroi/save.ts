/* Сохранения «Героев»: три ячейки и автосохранение в localStorage. Снимок — само состояние боя (DESIGN.md §10), поэтому сохранение и сеть — одно и то же. */
import type { BattleState } from './sim/battle';
import type { World } from './sim/adv/world';
import type { Who } from './game';

export const SLOTS = 3;
const KEY = 'geroi-saves';
const AUTO = SLOTS;

export interface Save {
  at: number;
  title: string;
  /** Бой: быстрый или посреди партии на карте. */
  state?: BattleState;
  who: [Who, Who];
  /** Партия на карте. */
  adv?: World;
}

function all(): (Save | null)[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) ?? '[]') as (Save | null)[];
    return Array.from({ length: SLOTS + 1 }, (_, i) => list[i] ?? null);
  } catch {
    return Array(SLOTS + 1).fill(null);
  }
}

/** Три ячейки и последней — автосохранение. */
export const loadSaves = (): (Save | null)[] => all();

export function writeSave(slot: number, s: Save): boolean {
  const list = all();
  list[slot] = s;
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export const writeAuto = (s: Save): boolean => writeSave(AUTO, s);

export function slotLabel(s: Save | null, i: number): string {
  const name = i === AUTO ? 'Авто' : `${i + 1}`;
  if (!s) return `${name}. Пусто`;
  const when = new Date(s.at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  return `${name}. ${s.title} · ${when}`;
}
