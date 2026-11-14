/* Дворовый спорт — площадки: где играем (лапта, пекарь, чиж). Каждая — свой двор из Blender (studio/blender/dvor_places.py
 * → public/dvorsport/<id>.glb, та же утоптанная площадка ~40 × 72 м, но другое окружение), свой задник и своё время дня.
 * «По очереди» — каждая новая партия на следующей площадке. Выбор — у игрока в браузере (у всех за столом может быть своя:
 * на правила площадка не влияет). Разметку своей игры поверх рисует сама игра. */
import { store } from '../settings';
import { segRow } from '../rtview';
import { LOOK_EVENING, type DvorYard, type Look } from './yard3d';

const BASE = `${import.meta.env.BASE_URL}dvorsport/`;

export interface Place {
  id: string;
  name: string;
  /** Коротко — для кнопки выбора. */
  short: string;
  /** Двор и задник. */
  yard: string;
  backdrop: string;
  look: Look;
  /** Цвет пыли из-под ног (под землю площадки). */
  dust: string;
}

export const PLACES: Place[] = [
  {
    id: 'garages',
    name: 'За гаражами',
    short: 'гаражи',
    yard: `${BASE}field.glb?v=2`,
    backdrop: `${import.meta.env.BASE_URL}gorodki/backdrop.webp`,
    look: LOOK_EVENING,
    dust: '#cdb48c',
  },
  {
    id: 'school',
    name: 'Школьный стадион',
    short: 'школа',
    yard: `${BASE}school.glb?v=1`,
    backdrop: `${BASE}backdrop-school.webp?v=1`,
    // ясный полдень: солнце высоко, тени короткие и чёткие, небо синее
    look: { sky: '#8fc0ee', fog: ['#d6e6f2', 60, 190], hemi: ['#e8f2ff', '#5a6a3a', 1.15], sun: ['#fff6e0', 3.6, [-6, 15, 7]], env: 0.4, exposure: 1.02, backdropTint: '#ffffff' },
    dust: '#b9a57a',
  },
  {
    id: 'dvor',
    name: 'Двор у пятиэтажек',
    short: 'двор',
    yard: `${BASE}dvor.glb?v=1`,
    backdrop: `${BASE}backdrop-dvor.webp?v=1`,
    // закат: солнце совсем низко, рыжее, длинные тени, розовая дымка
    look: { sky: '#f2c9a0', fog: ['#f0c6a8', 34, 130], hemi: ['#ffd2a8', '#4a3a40', 0.85], sun: ['#ff9d5a', 3.4, [14, 4.2, 9]], env: 0.26, exposure: 1.05, backdropTint: '#ffe9d8' },
    dust: '#d2b08a',
  },
  {
    id: 'village',
    name: 'Выгон за деревней',
    short: 'деревня',
    yard: `${BASE}village.glb?v=1`,
    backdrop: `${BASE}backdrop-village.webp?v=1`,
    // утро: мягкий прохладный свет, лёгкая дымка над лугом
    look: { sky: '#bcd6e6', fog: ['#d8e4e0', 70, 190], hemi: ['#eaf4ff', '#4c5a36', 1.05], sun: ['#fff0cc', 2.7, [12, 8, 12]], env: 0.32, exposure: 0.96, backdropTint: '#f4f8f8' },
    dust: '#a9a07a',
  },
];

const PREF = 'ds.place';
const TURN = 'ds.place.n';

/** Что выбрано: 'auto' — по очереди. */
export const placePref = () => store.get<string>(PREF, 'auto');

/** Площадка этой партии: выбранная или следующая по очереди (у каждой игры своя очередь). Звать один раз при входе за стол. */
export function nextPlace(game: string, advance = true): Place {
  const pref = placePref();
  const fixed = PLACES.find((p) => p.id === pref);
  if (fixed) return fixed;
  const key = `${TURN}.${game}`;
  const n = store.get<number>(key, -1) + (advance ? 1 : 0);
  if (advance) store.set(key, n);
  return PLACES[((n % PLACES.length) + PLACES.length) % PLACES.length];
}

/** Ряд «Площадка» для ctx.controls: меняет площадку сразу. onPick — что выбрано (после загрузки двора). */
export function placeRow(yard: DvorYard, current: () => Place, onPick: (p: Place) => void): HTMLElement {
  let cur = current().id;
  return segRow(
    'Площадка',
    [['auto', 'по очереди'], ...PLACES.map((p) => [p.id, p.short] as [string, string])],
    () => (placePref() === 'auto' ? 'auto' : cur),
    (id) => {
      store.set(PREF, id);
      const p = PLACES.find((x) => x.id === id);
      if (!p || p.id === cur) return;
      cur = p.id;
      void yard.setPlace(p.yard, p.backdrop, p.look).then(() => onPick(p));
    },
  );
}
