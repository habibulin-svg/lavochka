/* Ветер и вертушка — общее для двух морских игр В. М. Голицына:
 * «Захват колоний» (проще) и «Пираты» (со скрытым галионом с золотом).
 *
 * И в той, и в другой игре ход начинается с вертушки: она показывает, откуда дует ветер
 * (один из восьми румбов) и какая погода (штиль, свежий ветер, ураган). Скорость корабля
 * считается от угла между курсом и ветром — как в парусном деле:
 *   фордевинд (ветер в корму) и бакштаг (наискосок) — 3 клетки,
 *   галфвинд (под прямым углом) — 2 клетки,
 *   бейдевинд (круто против ветра) — 1 клетка,
 *   против ветра парусник не идёт вовсе.
 * Правила «Пиратов» добавляют: пираты на вёслах могут пройти 1 клетку и против ветра.
 */

/** Румбы по часовой стрелке, начиная с севера. */
export const POINTS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;
export type Point = (typeof POINTS)[number];

/** Погода с вертушки: жёлтый сектор — штиль, голубые — свежий ветер, красные — ураган. */
export type Weather = 'calm' | 'breeze' | 'storm';

export interface Wind {
  /** Откуда дует ветер. */
  from: Point;
  weather: Weather;
}

export const POINT_NAMES: Record<Point, string> = {
  N: 'норд',
  NE: 'норд-ост',
  E: 'ост',
  SE: 'зюйд-ост',
  S: 'зюйд',
  SW: 'зюйд-вест',
  W: 'вест',
  NW: 'норд-вест',
};

/** Смещение по клеткам для каждого румба: x — на восток, y — на юг (как на экране). */
export const POINT_STEP: Record<Point, [number, number]> = {
  N: [0, -1],
  NE: [1, -1],
  E: [1, 0],
  SE: [1, 1],
  S: [0, 1],
  SW: [-1, 1],
  W: [-1, 0],
  NW: [-1, -1],
};

const idx = (p: Point) => POINTS.indexOf(p);

/** Угол между курсом и ветром в «шагах румба»: 0 — ветер в корму, 4 — прямо в нос. */
export function angle(from: Point, course: Point): number {
  const d = Math.abs(idx(course) - idx(from));
  return Math.min(d, 8 - d);
}

/**
 * Сколько клеток проходит парусник этим курсом при свежем ветре.
 * 0 — против ветра идти нельзя (нужно сворачивать с курса или стоять).
 */
export function sailSteps(from: Point, course: Point): number {
  const a = angle(from, course);
  if (a <= 1) return 3; // фордевинд и бакштаг
  if (a === 2) return 2; // галфвинд
  if (a === 3) return 1; // бейдевинд
  return 0; // лейдевинд: против ветра парусники не ходят
}

/**
 * Сколько клеток может пройти корабль за ход.
 * В штиль парусники стоят; на вёслах (пираты) можно ровно 1 клетку в любую сторону.
 * При урагане корабль не идёт своим курсом, а дрейфует по ветру — это отдельное правило (drift).
 */
export function stepsFor(wind: Wind, course: Point, oars = false): number {
  if (wind.weather === 'calm') return oars ? 1 : 0;
  if (wind.weather === 'storm') return 0;
  const sail = sailSteps(wind.from, course);
  if (sail > 0) return sail;
  return oars ? 1 : 0;
}

/** Куда сносит корабль ураганом: по ветру, то есть в сторону, куда ветер дует. */
export function drift(wind: Wind): [number, number] {
  const to = POINTS[(idx(wind.from) + 4) % 8];
  return POINT_STEP[to];
}

/** Погода по цвету сектора вертушки — для показа игроку. */
export const WEATHER_NAMES: Record<Weather, string> = {
  calm: 'штиль',
  breeze: 'свежий ветер',
  storm: 'ураган',
};
