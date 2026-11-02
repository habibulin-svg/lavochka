/* Где лежат ассеты ГОПС: public/gops/a/ (Git LFS) — отобранное с выхода конвейера, сжатое studio/post/pack_gops.py
 * (раскладка папок та же, что у G:/temp/studio/out/gops; картинки — WebP). Отбор ниже и в pack_gops.py — одинаковый,
 * сверяет tests/gops/assets.test.ts. */

export const BASE = '/gops/a/';
/** Путь картинки в public/gops/a: PNG с выхода конвейера лежит как WebP. */
const DEV = BASE;
const webp = (url: string) => url.replace(/\.png$/, '.webp');

export interface Brigade {
  id: string;
  name: string;
  /** Цвет бригады в интерфейсе (полоска здоровья, имя). */
  color: number;
}

/** Бригады — docs/gops/texts/brigades.json, цвета — по трико (studio/blender/liveries.py). */
export const BRIGADES: Brigade[] = [
  // по костюму: Затулинка — тёмно-синяя с красными рукавами, Расточка — бирюзовая (было наоборот, 2026-11-02)
  { id: 'zatulinka', name: 'Затулинка', color: 0xe63946 },
  { id: 'rastochka', name: 'Расточка', color: 0x2ec4b6 },
  { id: 'zaton', name: 'Затон', color: 0x5aa9e6 },
  { id: 'pervomayka', name: 'Первомайка', color: 0x3d5a98 },
  { id: 'chemskoy', name: 'Чемской', color: 0x52b788 },
  { id: 'leninsky', name: 'Ленинский', color: 0xf1f1f1 },
];

/** Атлас анимаций бригады (формат PixiJS Spritesheet + meta.anims с fps и точками руки/головы). */
export function atlasUrl(brigade: string): string {
  const dir = brigade === 'leninsky' ? 'leninskiy' : brigade;
  return `${DEV}28-anims/${dir}-atlas.json`;
}

export interface ThemeArt {
  ground: string;
  far: string;
  near: string;
  /** Цвет жидкости и неба, пока нет своих картинок. */
  liquid: number;
  sky: number;
}

/** Темы уровней (CONTENT.md §3) — картинки 21-themes: дальний и ближний фоны по времени суток, бесшовный грунт.
 * Времена, что есть у темы (первое — запасное); отбор — первый вариант (2026-11-02, до ручного отбора листов). */
const THEME_TIMES: Record<string, string[]> = {
  yard: ['grey', 'night'], garages: ['day', 'evening', 'night'], construction: ['day', 'evening', 'grey'], dacha: ['day', 'evening'],
  depot: ['evening', 'grey', 'night'], dump: ['evening', 'grey'], factory: ['evening', 'grey', 'night'], heating: ['grey', 'night'],
  market: ['day', 'evening'], school: ['day', 'evening'], beach: ['day', 'evening'], winter: ['night', 'winter'],
};
const SKY: Record<string, number> = { day: 0x9cc3e6, evening: 0xc98a6b, grey: 0x7c8590, night: 0x141a2e, winter: 0xb8c8d8 };

export function themeArt(theme: string, time = 'night'): ThemeArt {
  const times = THEME_TIMES[theme] ?? THEME_TIMES.yard;
  const th = THEME_TIMES[theme] ? theme : 'yard';
  const t = times.includes(time) ? time : times[times.length - 1];
  const liquid: Record<string, number> = {
    yard: 0x4a5a3a, garages: 0x2b2b2b, construction: 0x8d8d86, dump: 0x7a9a2a, factory: 0x1f1f24,
    market: 0x55603a, depot: 0x2a2620, dacha: 0x4f6b3a, winter: 0x9fc4d8, heating: 0xc8d6d8, school: 0x5a6b48, beach: 0x5f7f86,
  };
  return {
    ground: webp(`${DEV}21-themes/seamless/${th}-ground-1.png`),
    far: webp(`${DEV}21-themes/${th}-far-${t}-1.png`),
    near: webp(`${DEV}21-themes/${th}-near-${t}-1.png`),
    liquid: liquid[th] ?? 0x4a5a3a,
    sky: SKY[t] ?? 0x141a2e,
  };
}

/** Картинки меню, заглавия, загрузки (20-brand), имя — без расширения: title-keyart-1, menu-bg-1, loading-2-1… */
/** Превью уровня — снимок карты в её теме (tools/thumbs/gops-levels.mjs). */
export function levelThumb(id: string): string {
  return `${DEV}levels/${id}.webp`;
}

export function brandArt(name: string): string {
  return webp(`${DEV}20-brand/${name}.png`);
}

/** Переделанные ролики (отбор 2026-11-02): «квас» — 25c, вариант 2 (без абракадабры на бочке, лица не плывут). */
const CUTSCENE_FIX: Record<string, string> = {
  's09-kvass': '25c-fix-videos/s09b-kvass-2-v1.mp4',
};

/** Межигровой ролик по имени из missions.json (cutscene_after): переделка, иначе первый вариант первого ключа. */
export function cutsceneUrl(name: string): string {
  return `${DEV}${CUTSCENE_FIX[name] ?? `25-videos/${name}-1-v1.mp4`}`;
}

/** Иконки оружия: отобранный вариант из 22-arsenal/cut (отбор 2026-11-02); 0 — пока без картинки (переделка — партия 22b). */
const ICON_PICK: Record<string, number> = {
  armatura: 2, auger: 1, babka: 1, buratino: 1, carbide: 2, dog: 1, holodilnik: 1, homing: 1, kalash: 1, kedy: 2, kirpichi: 1, kite: 1,
  korsar: 2, kozy: 1, kukuruznik: 1, kuryu: 1, limonka: 1, makarov: 2, marshrutka: 1, mawashi: 2, mine: 1, mortar: 0, mukha: 1, napalm: 1,
  nevidimka: 1, obrez: 1, ognetushitel: 1, otboinik: 1, pas: 1, payalnik: 1, pigeon: 1, plita: 0, pochta: 1, ponyatiya: 1, posylka: 1,
  pulemet: 1, rezinka: 0, rope: 1, samogon: 1, sling: 2, tnt: 1, truba: 1, tychok: 1, tyidi: 1, ukazka: 2, uppercut: 1, vanna: 1,
  yagga: 0, zapacanov: 1, zontik: 1,
};

/** Переделанные (партия 22b, отбор 2026-11-02) — важнее первого отбора. */
const ICON_FIX: Record<string, number> = { auger: 12, mortar: 13, otboinik: 11, plita: 12, ponyatiya: 12, rezinka: 13, tyidi: 12, yagga: 12 };

export function weaponIcon(id: string): string | null {
  if (ICON_FIX[id]) return webp(`${DEV}22b-arsenal-fix/cut/icon-${id}-${ICON_FIX[id]}.png`);
  const v = ICON_PICK[id];
  return v ? webp(`${DEV}22-arsenal/cut/icon-${id}-${v}.png`) : null;
}

/** Картинки в мире (отбор 2026-11-02): снаряды и бегуны — 22-arsenal/cut, ящики и предметы — 23-common/cut.
 * h — высота на карте, px; turn — поворачивать по скорости (картинка смотрит вверх — rot90). */
export interface WorldArt {
  url: string;
  h: number;
  turn?: 'up' | 'right';
}

const A = `${DEV}22-arsenal/cut/`;
const C = `${DEV}23-common/cut/`;
const P = `${DEV}23e-mission-props/cut/`;
export const WORLD_ART: Record<string, WorldArt> = {
  limonka: { url: `${A}world-limonka-1.webp`, h: 10 },
  carbide: { url: `${A}world-carbide-2.webp`, h: 10 },
  korsar: { url: `${A}world-korsar-1.webp`, h: 13, turn: 'up' },
  petarda: { url: `${A}world-korsar-2.webp`, h: 7, turn: 'up' },
  posylka: { url: `${A}world-posylka-1.webp`, h: 12 },
  samogon: { url: `${A}world-samogon-1.webp`, h: 12 },
  tnt: { url: `${A}world-tnt-1.webp`, h: 14 },
  mine: { url: `${A}world-mine-1.webp`, h: 8 },
  'kite-bomb': { url: `${A}world-mine-2.webp`, h: 9 },
  mukha: { url: `${A}world-homing-2.webp`, h: 15, turn: 'up' },
  homing: { url: `${A}world-homing-1.webp`, h: 16, turn: 'up' },
  kite: { url: `${A}world-kite-1.webp`, h: 24 },
  pigeon: { url: `${A}world-pigeon-1.webp`, h: 18 },
  dog: { url: `${A}world-dog-1.webp`, h: 16 },
  babka: { url: `${A}world-babka-1.webp`, h: 22 },
  kozy: { url: `${A}world-kozy-1.webp`, h: 15 },
  'vanna-drop': { url: `${A}world-vanna-1.webp`, h: 18 },
  brick: { url: `${A}world-kirpichi-2.webp`, h: 10 },
  holodilnik: { url: `${A}icon-holodilnik-1.webp`, h: 12 },
  'crate-weapon': { url: `${C}crate-weapon-1.webp`, h: 40 },
  'crate-health': { url: `${C}crate-health-2.webp`, h: 40 },
  'crate-util': { url: `${C}crate-utility-1.webp`, h: 40 },
  barrel: { url: `${C}fuel-barrel-2.webp`, h: 17 },
  gas: { url: `${C}gas-cylinder-1.webp`, h: 20 },
  plate: { url: `${C}target-2.webp`, h: 20 },
  // предметы миссий (23e, отбор 2026-11-02): мишени, «разнести», подопечные, свой на матрасе — OBJ_ART
  'obj-can': { url: `${P}prop-can-2.webp`, h: 13 },
  'obj-keg': { url: `${P}prop-keg-2.webp`, h: 14 },
  'obj-boiler': { url: `${P}prop-boiler-2.webp`, h: 24 },
  'obj-transformer': { url: `${P}prop-transformer-2.webp`, h: 22 },
  'obj-fridge': { url: `${A}icon-holodilnik-1.webp`, h: 24 },
  'obj-beehive': { url: `${P}prop-beehive-2.webp`, h: 30 },
  'obj-locomotive': { url: `${P}prop-locomotive-2.webp`, h: 22 },
  'obj-kiosk': { url: `${P}prop-kiosk-3.webp`, h: 34 },
  'obj-babka': { url: `${A}world-babka-1.webp`, h: 30 },
  'obj-hostage': { url: `${P}prop-hostage-2.webp`, h: 22 },
};

/** Предмет миссии (Obj.look; у «своего в беде» — kind) → картинка из WORLD_ART; стоит низом на земле. */
export const OBJ_ART: Record<string, string> = {
  can: 'obj-can', keg: 'obj-keg', boiler: 'obj-boiler', transformer: 'obj-transformer', fridge: 'obj-fridge',
  beehive: 'obj-beehive', locomotive: 'obj-locomotive', kiosk: 'obj-kiosk', babka: 'obj-babka', hostage: 'obj-hostage',
};

/** Эффекты — полосы кадров из 31-sprites/fx (ролик Wan → прозрачность по яркости), отбор 2026-11-02:
 * взрыв (маленький, вариант 2 — для любого радиуса), огонь (вариант 2, без земли), дым (вариант 2).
 * Переделка (партия 25c → 31-sprites/fx2): большой взрыв — вариант 2 (шар → кольцо). Всплеск вышел короной (буквально «crown»),
 * кирпичи — вяло; они и пыль рисуются кодом. Вторая попытка всплеска (24d/25d → fx3) — тоже мимо: капли стоят, за ними
 * видеомодель дорисовала водопад; всплеск остаётся кодом. */
export const FX_ART: Record<string, string> = {
  boom: `${DEV}31-sprites/fx/fx-explosion-s-2-v1`,
  bigboom: `${DEV}31-sprites/fx2/fx2-explosion-l-2-v1`,
  fire: `${DEV}31-sprites/fx/fx-fire-2-v1`,
  smoke: `${DEV}31-sprites/fx/fx-smoke-2-v1`,
};

/** Анимации бегунов и летунов — полосы кадров 31-sprites/actors (отбор 2026-11-02); кукурузник — пролёт при авиаударе. */
export const ANIM_ART: Record<string, string> = {
  dog: `${DEV}31-sprites/actors/world-dog-1-v1`,
  babka: `${DEV}31-sprites/actors/world-babka-1-v1`,
  kozy: `${DEV}31-sprites/actors/world-kozy-1-v1`,
  pigeon: `${DEV}31-sprites/actors/world-pigeon-1-v1`,
  plane: `${DEV}31-sprites/actors/world-kukuruznik-1-v1`,
};
