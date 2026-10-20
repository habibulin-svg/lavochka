/* Задания, которые уже видели (данетки, дела детективов): игра копит за столом «кто что видел» — номер задания → когда
 * (минута с 1970-го, наибольшая среди игроков) — и подбирает то, чего никто не видел, а если всё видели — виденное давнее всех.
 * Списки присылают браузеры игроков действием (см. core/seen.ts). Без DOM. */
import type { Rng } from './types';

/** Номер задания → минута, когда его в последний раз видел кто-то за столом. */
export type Avoid = Record<number, number>;
/** Сколько записей принимаем от одного игрока. */
export const SEEN_MAX = 1500;

/** Слить присланный список [[номер, минута], …] в avoid. Возвращает номера, которые пришли (проверенные). */
export function addSeen(avoid: Avoid, raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const got: number[] = [];
  for (const x of raw.slice(0, SEEN_MAX)) {
    if (!Array.isArray(x)) continue;
    const id = Number(x[0]);
    const t = Number(x[1]);
    if (!Number.isInteger(id) || id < 0 || !Number.isFinite(t) || t < 0) continue;
    avoid[id] = Math.max(avoid[id] ?? 0, Math.floor(t));
    got.push(id);
  }
  return got;
}

/** Самое свежее для стола: случайное из невиденных, а если таких нет — из виденных давнее всех. */
export function freshest<T>(list: T[], id: (x: T) => number, avoid: Avoid, rng: Rng): T | undefined {
  if (!list.length) return undefined;
  const never = list.filter((x) => avoid[id(x)] == null);
  if (never.length) return never[rng.int(never.length)];
  const min = Math.min(...list.map((x) => avoid[id(x)]));
  const old = list.filter((x) => avoid[id(x)] === min);
  return old[rng.int(old.length)];
}
