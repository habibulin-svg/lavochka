/* Где лежат картинки ГОПС. Пока ассеты не отобраны и не разложены в public/gops (CONTENT.md §4),
 * в разработке берём их прямо с выхода конвейера через Vite (/@fs/, разрешено в vite.config.ts). */

const DEV = '/@fs/G:/temp/studio/out/gops/';

export interface Brigade {
  id: string;
  name: string;
  /** Цвет бригады в интерфейсе (полоска здоровья, имя). */
  color: number;
}

/** Бригады — docs/gops/texts/brigades.json, цвета — по трико (studio/blender/liveries.py). */
export const BRIGADES: Brigade[] = [
  { id: 'zatulinka', name: 'Затулинка', color: 0x2ec4b6 },
  { id: 'rastochka', name: 'Расточка', color: 0xe63946 },
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

/** Темы уровней (CONTENT.md §3). Пока есть только картинки двора; остальные — двор с другой жидкостью. */
export function themeArt(theme: string, time = 'night'): ThemeArt {
  const t = time === 'grey' ? 'grey' : 'night';
  const liquid: Record<string, number> = {
    yard: 0x4a5a3a, garages: 0x2b2b2b, construction: 0x8d8d86, dump: 0x7a9a2a, factory: 0x1f1f24,
    market: 0x55603a, depot: 0x2a2620, dacha: 0x4f6b3a, winter: 0x9fc4d8, heating: 0xc8d6d8, school: 0x5a6b48, beach: 0x5f7f86,
  };
  return {
    ground: `${DEV}21-themes/yard-ground-1.png`,
    far: `${DEV}21-themes/yard-far-${t}-1.png`,
    near: `${DEV}21-themes/yard-near-${t}-1.png`,
    liquid: liquid[theme] ?? 0x4a5a3a,
    sky: t === 'night' ? 0x141a2e : 0x6d7480,
  };
}
