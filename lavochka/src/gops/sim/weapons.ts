/* Оружие ГОПС: числа и способ стрельбы. Названия и описания — docs/gops/texts/weapons.json (тот же id).
 * Здесь только то, что нужно логике; поведение снарядов — в world.ts по полю kind. */

export type WeaponKind =
  | 'missile'   // летит по дуге, взрыв при касании (ветер — по полю wind)
  | 'grenade'   // отскакивает, взрыв по таймеру
  | 'stone'     // как missile, но без взрыва: удар по бойцу
  | 'hitscan'   // пуля мгновенно по лучу
  | 'placed'    // кладётся под ноги, взрыв по таймеру
  | 'mine'      // кладётся, взводится и ждёт, кто подойдёт
  | 'melee'     // удар перед собой
  | 'skip'      // пропуск хода
  | 'surrender';

export interface WeaponDef {
  kind: WeaponKind;
  /** Сила задаётся удержанием (иначе — выстрел по нажатию). */
  charged?: boolean;
  /** Скорость при полной силе (или постоянная), Q8 за кадр. */
  speed?: number;
  /** Сносит ли ветром. */
  wind?: boolean;
  /** Радиус взрыва (px) и урон в центре. */
  radius?: number;
  damage?: number;
  /** Упругость снаряда (из 256) и трение вдоль. */
  bounce?: number;
  slide?: number;
  /** Таймер по умолчанию, с (у гранат игрок выбирает 1–5). */
  fuse?: number;
  /** Выстрелов за ход (у обреза — два). */
  shots?: number;
  /** Дальность пули/удара, px. */
  range?: number;
  /** Толчок без взрыва (пуля, удар), Q8 за кадр. */
  push?: number;
  /** Радиус снаряда, px. */
  r?: number;
}

/** Ядро арсенала (DESIGN.md §3.1). Остальные позиции — по мере готовности. */
export const WEAPONS: Record<string, WeaponDef> = {
  mukha: { kind: 'missile', charged: true, speed: 4600, wind: true, radius: 48, damage: 50, r: 3 },
  limonka: { kind: 'grenade', charged: true, speed: 3600, radius: 48, damage: 50, bounce: 150, slide: 200, fuse: 3, r: 3 },
  sling: { kind: 'stone', charged: true, speed: 4400, wind: true, damage: 20, push: 900, r: 2 },
  obrez: { kind: 'hitscan', shots: 2, range: 900, radius: 9, damage: 25, push: 800 },
  makarov: { kind: 'hitscan', shots: 6, range: 900, radius: 3, damage: 6, push: 250 },
  tnt: { kind: 'placed', radius: 72, damage: 75, bounce: 40, slide: 120, fuse: 5, r: 4 },
  mine: { kind: 'mine', radius: 48, damage: 50, bounce: 40, slide: 120, fuse: 2, r: 3 },
  tychok: { kind: 'melee', range: 22, damage: 0, push: 900 },
  armatura: { kind: 'melee', range: 24, damage: 30, push: 2600 },
  kuryu: { kind: 'skip' },
  pas: { kind: 'surrender' },
};

/** Полный набор ядра с бесконечным запасом (−1) — для быстрого боя. */
export const CORE_AMMO: Record<string, number> = {
  mukha: -1, limonka: -1, sling: -1, obrez: -1, makarov: -1, tnt: 2, mine: 3, tychok: -1, armatura: 1, kuryu: -1, pas: -1,
};
