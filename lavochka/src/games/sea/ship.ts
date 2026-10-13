/* Корабли — общее для «Захвата колоний» и «Пиратов».
 *
 * Из правил:
 *   «Галион тонет с трёх попаданий, бригантина — с двух» (и отдельно подчёркнуто:
 *    не «выдерживает два», а тонет со второго — разницу видно в игре);
 *   «все корабли изначально имели по 5 боеприпасов» («Захват колоний»);
 *   «корабли могут чиниться, зайдя в порт и пропуская 1 ход за каждую пробоину»;
 *   «испанцы чинятся только в испанских портах, пираты — в любых (кроме испанских)»;
 *   «стрелять из порта или в порт нельзя»;
 *   «корабли гибнут, если при следующем ходе будет ураган» — про выброшенные на берег.
 */

export type ShipClass = 'galleon' | 'brigantine';
export type Side = 'spanish' | 'pirate';

/** С какого попадания корабль идёт ко дну. */
export const HITS_TO_SINK: Record<ShipClass, number> = { galleon: 3, brigantine: 2 };

/** Сколько боеприпасов у корабля в начале. */
export const AMMO_START = 5;

/** Дальность стрельбы: галион бьёт на две клетки во все стороны, бригантина — на одну. */
export const SHOT_RANGE: Record<ShipClass, number> = { galleon: 2, brigantine: 1 };

export interface Ship {
  id: string;
  cls: ShipClass;
  side: Side;
  /** Сколько попаданий уже получено. */
  hits: number;
  ammo: number;
  /** Потоплен и снят с карты. */
  sunk?: boolean;
  /** Выброшен ураганом на берег: погибнет, если следующий ураган застанет его там. */
  ashore?: boolean;
  /** Захвачен противником (золотой галион в «Пиратах»). */
  captured?: boolean;
}

export const isSunk = (s: Ship) => !!s.sunk || s.hits >= HITS_TO_SINK[s.cls];

/** Попадание: отмечаем пробоину и, если хватило, топим. */
export function takeHit(s: Ship): Ship {
  const hits = s.hits + 1;
  return { ...s, hits, sunk: hits >= HITS_TO_SINK[s.cls] ? true : s.sunk };
}

/** Может ли корабль стрелять: не потоплен, есть боеприпас и он не в порту. */
export function canShoot(s: Ship, inPort = false): boolean {
  return !isSunk(s) && s.ammo > 0 && !inPort;
}

/** Выстрел: тратит боеприпас и, если попал, наносит пробоину цели. */
export function shoot(shooter: Ship, target: Ship, hit: boolean): { shooter: Ship; target: Ship } {
  const after = { ...shooter, ammo: shooter.ammo - 1 };
  return { shooter: after, target: hit ? takeHit(target) : target };
}

/** Сколько ходов займёт починка: по одному за каждую пробоину. */
export const repairTurns = (s: Ship) => s.hits;

/** Где можно чиниться: испанцы — только в своих портах, пираты — в любых чужих, кроме испанских. */
export function canRepair(s: Ship, port: { side: Side } | null): boolean {
  if (!port || isSunk(s) || s.hits === 0) return false;
  // испанцы — только в испанских портах, пираты — в любых, КРОМЕ испанских
  if (s.side === 'spanish') return port.side === 'spanish';
  return port.side !== 'spanish';
}

/** Привести корабль в порядок (после пропуска ходов за каждую пробоину). */
export const repaired = (s: Ship): Ship => ({ ...s, hits: 0 });

/**
 * Проверка берега: выброшенный ураганом корабль гибнет, если следующий ураган застанет его
 * на берегу; если ветер дует со стороны берега — корабль остаётся (поправка игроков «Пиратов»).
 */
export function stormOnShore(ashore: boolean, drivenToShore: boolean): { ship: Ship | null; wreck: boolean } {
  if (!ashore) return { ship: null, wreck: false };
  return drivenToShore ? { ship: null, wreck: true } : { ship: null, wreck: false };
}

/** Сколько очков даёт потопление — нужно «Захвату колоний» и «Пиратам» для итогов. */
export const sinkScore = (s: Ship) => (s.cls === 'galleon' ? 2 : 1);
