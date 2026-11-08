/* Аэрохоккей: оформление столов — сгенерировано Z-Image (studio/jobs/aerohockey/01-art.yaml), детали вырезаны BiRefNet,
 * подогнаны studio/jobs/aerohockey/export_art.py → public/aerohockey/art/. Код только раскладывает картинки по столу.
 *
 * У каждого стола: окружение (bg), поверхность поля (surf), фактура борта (rail, бесшовная плитка), эмблема в центре, своя шайба.
 * Биты (красная и синяя) и табло — общие. */

const DIR = '/aerohockey/art/';
const THEMES = ['katok', 'disco', 'lager', 'kosmos'] as const;

const FILES: string[] = [...THEMES.flatMap((t) => [`bg-${t}`, `surf-${t}`, `rail-${t}`, `emblem-${t}`, `puck-${t}`]), 'mallet-0', 'mallet-1'];

const imgs = new Map<string, HTMLImageElement>();
let loading: Promise<void> | null = null;

/** Загрузить всё (один раз на страницу). */
export function loadArt(): Promise<void> {
  loading ??= Promise.all(
    FILES.map(
      (f) =>
        new Promise<void>((res) => {
          const im = new Image();
          im.decoding = 'async';
          im.onload = () => {
            imgs.set(f, im);
            res();
          };
          im.onerror = () => res();
          im.src = `${DIR}${f}.webp`;
        })
    )
  ).then(() => {});
  return loading;
}

export const art = (n: string): HTMLImageElement | null => imgs.get(n) ?? null;
/** Сколько картинок уже загружено (ключ кэша статичного слоя). */
export const loaded = () => imgs.size;
