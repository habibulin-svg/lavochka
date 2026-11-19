/* Симулятор дирижёра — сохранения: текущая карьера (автосохранение после каждого концерта и покупки) и три ячейки.
 * Настройки (музыка меню, подсказки клавиш) — отдельно. */
import { newCareer, validCareer, type CareerState } from './core/career';

const CUR = 'dirizher.career';
const SLOTS_KEY = 'dirizher.saves';
export const SLOTS = 3;

export interface Slot {
  at: number;
  title: string;
  career: CareerState;
}

function read<T>(key: string, def: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : def;
  } catch {
    return def;
  }
}

function write(key: string, v: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(v));
    return true;
  } catch {
    return false;
  }
}

export function loadCareer(): CareerState | null {
  const c = read<unknown>(CUR, null);
  return validCareer(c) ? c : null;
}

export function saveCareer(c: CareerState): boolean {
  return write(CUR, c);
}

export function freshCareer(name?: string): CareerState {
  const c = newCareer(name);
  saveCareer(c);
  return c;
}

export function loadSlots(): (Slot | null)[] {
  const list = read<(Slot | null)[]>(SLOTS_KEY, []);
  return Array.from({ length: SLOTS }, (_, i) => (list[i] && validCareer(list[i]!.career) ? list[i] : null));
}

export function writeSlot(i: number, title: string, c: CareerState): boolean {
  const list = loadSlots();
  list[i] = { at: Date.now(), title, career: JSON.parse(JSON.stringify(c)) as CareerState };
  return write(SLOTS_KEY, list);
}

export function slotLabel(s: Slot | null, i: number): string {
  if (!s) return `${i + 1}. Пусто`;
  const d = new Date(s.at).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  return `${i + 1}. ${s.title} · ${d}`;
}

export interface Prefs {
  music: boolean;
  keys: boolean;
  /** Какие подсказки обучения уже показаны. */
  seen: string[];
}

export function loadPrefs(): Prefs {
  return { music: true, keys: true, seen: [], ...read<Partial<Prefs>>('dirizher.prefs', {}) };
}

export function savePrefs(p: Prefs): void {
  write('dirizher.prefs', p);
}
