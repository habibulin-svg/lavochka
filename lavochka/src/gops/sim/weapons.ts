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
  | 'rope'      // верёвка с крюком: ход не кончает
  | 'strike'    // с неба над точкой (target) или по всей карте: drops снарядов drop
  | 'teleport'  // маршрутка: боец переносится в точку
  | 'girder'    // бетонная плита в точку, поворот — прицелом
  | 'dig'       // отбойник (вниз) / паяльная лампа (по прицелу) — fuse секунд, повторное нажатие — стоп
  | 'buff'      // усилитель на этот ход (ход не кончает)
  | 'select'    // «ты иди» — другой боец бригады
  | 'justice'   // «по понятиям» — здоровье всех поровну
  | 'flood'     // прорыв трубы — жидкость поднимается
  | 'walker'    // бежит по земле (дворняга, бабка, козы); огонь ещё раз — взрыв (refire)
  | 'flyer'     // летит с постоянной скоростью, ←/→ — руль (голубь, змей)
  | 'kamikaze'  // «за пацанов!»: боец сам летит по прицелу и взрывается
  | 'flame'     // огонь: падает, горит на месте, жжёт рядом
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
  /** Разрыв на осколки: n снарядов fragment со скоростью speed (Q8) веером вверх. */
  cluster?: { n: number; fragment: string; speed: number };
  /** Очередь: выстрел каждые auto кадров, пока держат огонь; разброс прицела ± spread (1/4096 оборота). */
  auto?: number;
  spread?: number;
  /** Удар под своим углом, а не по прицелу (наклон как у прицела: − вверх). */
  meleeAim?: number;
  /** Нужна точка на карте (Input.target). */
  target?: boolean;
  /** Наводится на точку после взлёта. */
  homing?: boolean;
  /** Таймер не выбирают (самогон). */
  fixedFuse?: boolean;
  /** strike: сколько и чего падает, шаг по x (px); 0 — по всей карте вразброс. */
  drops?: number;
  drop?: string;
  gap?: number;
  /** walker: прыжок через препятствие (Q8 за кадр), сколько бежит (count), взрыв при касании бойца, по повторному нажатию. */
  jump?: number;
  count?: number;
  contact?: boolean;
  refire?: boolean;
  /** Ледобур: сколько кадров ввинчивается в грунт после касания. */
  drill?: number;
  /** Заморозка: радиус, px (вместо взрыва). */
  freeze?: number;
  /** dig: отбойник роет вниз, лампа — по прицелу. */
  down?: boolean;
  /** buff: что даёт. */
  buff?: 'lowgrav' | 'fast' | 'double' | 'laser' | 'chute' | 'jet' | 'bungee' | 'invisible';
  /** Только осколок/падающий снаряд: нет в арсенале и меню. */
  hidden?: boolean;
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
  rope: { kind: 'rope', range: 320 },
  kuryu: { kind: 'skip' },
  pas: { kind: 'surrender' },

  // артиллерия и взрывчатка
  homing: { kind: 'missile', charged: true, speed: 3600, target: true, homing: true, radius: 48, damage: 50, r: 3 },
  mortar: { kind: 'missile', charged: true, speed: 4400, wind: true, radius: 24, damage: 20, r: 3, cluster: { n: 6, fragment: 'shard', speed: 900 } },
  carbide: { kind: 'grenade', charged: true, speed: 3600, radius: 24, damage: 20, bounce: 150, slide: 200, fuse: 3, r: 3, cluster: { n: 5, fragment: 'shard', speed: 1000 } },
  korsar: { kind: 'grenade', charged: true, speed: 3400, radius: 40, damage: 30, bounce: 170, slide: 210, fuse: 3, r: 4, cluster: { n: 6, fragment: 'petarda', speed: 1300 } },
  posylka: { kind: 'missile', charged: true, speed: 3200, radius: 10, damage: 5, r: 4, cluster: { n: 3, fragment: 'mine', speed: 500 } },
  samogon: { kind: 'grenade', charged: true, speed: 3000, radius: 100, damage: 100, bounce: 90, slide: 160, fuse: 3, fixedFuse: true, r: 4 },
  // огнестрел и ближний бой
  kalash: { kind: 'hitscan', shots: 12, auto: 5, spread: 40, range: 900, radius: 3, damage: 5, push: 160 },
  pulemet: { kind: 'hitscan', shots: 30, auto: 3, spread: 70, range: 900, radius: 3, damage: 4, push: 120 },
  uppercut: { kind: 'melee', range: 22, damage: 30, push: 3000, meleeAim: -820 },
  mawashi: { kind: 'melee', range: 26, damage: 15, push: 2400, meleeAim: -120 },
  // с воздуха
  kukuruznik: { kind: 'strike', target: true, drops: 5, drop: 'brick', gap: 16 },
  pochta: { kind: 'strike', target: true, drops: 4, drop: 'mine', gap: 22 },
  vanna: { kind: 'strike', target: true, drops: 1, drop: 'vanna-drop', gap: 0 },
  kirpichi: { kind: 'strike', drops: 24, drop: 'brick', gap: 0 },
  truba: { kind: 'flood', range: 48 },
  ponyatiya: { kind: 'justice' },
  // утилиты
  marshrutka: { kind: 'teleport', target: true },
  plita: { kind: 'girder', target: true, range: 30 },
  otboinik: { kind: 'dig', fuse: 4, range: 11, down: true },
  payalnik: { kind: 'dig', fuse: 4, range: 11 },
  zontik: { kind: 'buff', buff: 'chute' },
  buratino: { kind: 'buff', buff: 'lowgrav' },
  kedy: { kind: 'buff', buff: 'fast' },
  yagga: { kind: 'buff', buff: 'double' },
  ukazka: { kind: 'buff', buff: 'laser' },
  tyidi: { kind: 'select' },
  ognetushitel: { kind: 'buff', buff: 'jet', fuse: 6 },
  rezinka: { kind: 'buff', buff: 'bungee' },
  nevidimka: { kind: 'buff', buff: 'invisible' },

  // третья волна: бегущие, управляемые, ледобур, огонь, заморозка
  dog: { kind: 'walker', speed: 260, jump: 950, fuse: 8, radius: 60, damage: 60, r: 4, refire: true },
  babka: { kind: 'walker', speed: 110, jump: 700, fuse: 10, radius: 80, damage: 75, r: 5, refire: true },
  kozy: { kind: 'walker', speed: 200, jump: 850, fuse: 7, radius: 45, damage: 40, r: 5, count: 3, contact: true },
  pigeon: { kind: 'flyer', speed: 620, fuse: 8, radius: 50, damage: 50, r: 3, refire: true },
  kite: { kind: 'flyer', speed: 420, fuse: 10, r: 4, refire: true, drop: 'kite-bomb' },
  auger: { kind: 'missile', charged: true, speed: 3800, radius: 40, damage: 40, r: 3, drill: 150 },
  zapacanov: { kind: 'kamikaze', speed: 1500, fuse: 2, radius: 50, damage: 50 },
  napalm: { kind: 'strike', target: true, drops: 10, drop: 'flame', gap: 7 },
  holodilnik: { kind: 'grenade', charged: true, speed: 3200, bounce: 120, slide: 200, fuse: 3, r: 4, freeze: 70 },

  // осколки и то, что падает с неба
  shard: { kind: 'missile', hidden: true, radius: 16, damage: 12, r: 2 },
  petarda: { kind: 'missile', hidden: true, radius: 30, damage: 26, r: 2 },
  brick: { kind: 'missile', hidden: true, radius: 22, damage: 22, r: 3 },
  'vanna-drop': { kind: 'missile', hidden: true, radius: 60, damage: 70, r: 7 },
  'kite-bomb': { kind: 'missile', hidden: true, radius: 50, damage: 50, r: 4 },
  flame: { kind: 'flame', hidden: true, damage: 2, fuse: 4, r: 2 },
};


/** Полный набор ядра с бесконечным запасом (−1). */
export const CORE_AMMO: Record<string, number> = {
  mukha: -1, limonka: -1, sling: -1, obrez: -1, makarov: -1, tnt: 2, mine: 3, tychok: -1, armatura: 1, rope: 5, kuryu: -1, pas: -1,
};

/** Весь готовый арсенал — для быстрого боя: сильное — поштучно. */
export const ARSENAL_AMMO: Record<string, number> = {
  ...CORE_AMMO,
  homing: 1, mortar: 2, carbide: 2, korsar: 1, posylka: 1, samogon: 1, kalash: 2, pulemet: 1, uppercut: 2, mawashi: 2,
  kukuruznik: 1, pochta: 1, vanna: 1, kirpichi: 0, truba: 0, ponyatiya: 0,
  marshrutka: 2, plita: 3, otboinik: 2, payalnik: 2, zontik: 2, buratino: 1, kedy: 1, yagga: 1, ukazka: 1, tyidi: 1,
  ognetushitel: 1, rezinka: 1, nevidimka: 1, dog: 1, babka: 1, kozy: 1, pigeon: 1, kite: 1, auger: 2, zapacanov: 1, napalm: 1, holodilnik: 1,
};
