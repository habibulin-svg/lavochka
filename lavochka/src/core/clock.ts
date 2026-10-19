/* Часы партии. Движки, которым нужно время (сапёр, «Во дворе», водопроводчик), берут его отсюда, а не из Date.now:
 * при переигрывании записи партии на сервере (таблицы рекордов) часы идут по записи, и итог сходится с тем, что видел игрок. */
let fixed: number | null = null;

export const gameNow = () => fixed ?? Date.now();

/** Выполнить fn с часами, стоящими на t (переигрывание). */
export function atTime<T>(t: number, fn: () => T): T {
  const was = fixed;
  fixed = t;
  try {
    return fn();
  } finally {
    fixed = was;
  }
}
