/* «Воздушный бой» — разметка полей по узлам сетки (столбец, ряд от левого верхнего узла). Снято с картинок
 * public/vozboy/ (tools/vozboy/cut.py, наложение узлов — вручную по сканам). Без DOM.
 *
 * А «Игрушка» (ЛПО «Игрушка»): 30×14 узлов, синие слева (место 0), красные справа (место 1), поле симметрично
 * поворотом на 180°. На среднем листе ещё пять красных «разрывов» — не по 12 на сторону и без симметрии; по листку
 * зениток по 12, поэтому средние — рисунок (решение без пользователя).
 * Б «Аэрофото»: 14×24 узла, синие внизу (место 0), жёлтые вверху (место 1). */
import type { Dir } from './engine';

export interface Gun {
  c: number;
  r: number;
  rocket: boolean;
}

export interface SideMap {
  hq: [number, number];
  fighters: [number, number][];
  bombers: [number, number][];
  guns: Gun[];
  /** Куда смотрят самолёты на аэродроме (к противнику). */
  face: Dir;
}

export interface MapDef {
  w: number;
  h: number;
  sides: [SideMap, SideMap];
}

const g = (c: number, r: number, rocket = false): Gun => ({ c, r, rocket });

function mirror(s: SideMap, w: number, h: number, face: Dir): SideMap {
  const m = ([c, r]: [number, number]): [number, number] => [w - 1 - c, h - 1 - r];
  return { hq: m(s.hq), fighters: s.fighters.map(m), bombers: s.bombers.map(m), guns: s.guns.map((x) => ({ ...x, c: w - 1 - x.c, r: h - 1 - x.r })), face };
}

const BLUE_A: SideMap = {
  hq: [0, 13],
  fighters: [
    [0, 1], [1, 1], [2, 1],
    [0, 2], [1, 2], [2, 2],
    [0, 3], [1, 3], [2, 3],
    [1, 4],
  ],
  bombers: [
    [1, 10], [2, 10],
    [1, 11], [2, 11],
    [1, 12], [2, 12],
  ],
  guns: [g(2, 0, true), g(3, 2), g(6, 3), g(4, 4), g(7, 5, true), g(1, 7, true), g(9, 7), g(4, 9), g(3, 10), g(7, 11), g(4, 12), g(1, 13, true)],
  face: 'e',
};

export const IGRUSHKA_MAP: MapDef = { w: 30, h: 14, sides: [BLUE_A, mirror(BLUE_A, 30, 14, 'w')] };

export const AEROFOTO_MAP: MapDef = {
  w: 14,
  h: 24,
  sides: [
    {
      hq: [13, 23],
      fighters: [
        [1, 21], [2, 21], [3, 21],
        [1, 22], [2, 22], [3, 22], [4, 22],
        [1, 23], [2, 23], [3, 23],
      ],
      bombers: [
        [10, 21], [11, 21], [12, 21],
        [10, 22], [11, 22], [12, 22],
      ],
      guns: [g(0, 21, true), g(5, 16, true), g(7, 22, true), g(13, 22, true), g(7, 14), g(11, 16), g(3, 17), g(4, 19), g(9, 19), g(12, 19), g(2, 20), g(10, 20)],
      face: 'n',
    },
    {
      hq: [0, 0],
      fighters: [
        [10, 0], [11, 0], [12, 0],
        [9, 1], [10, 1], [11, 1], [12, 1],
        [10, 2], [11, 2], [12, 2],
      ],
      bombers: [
        [1, 1], [2, 1], [3, 1],
        [1, 2], [2, 2], [3, 2],
      ],
      guns: [g(0, 1, true), g(6, 1, true), g(13, 2, true), g(6, 9, true), g(3, 3), g(11, 3), g(1, 4), g(4, 4), g(9, 4), g(10, 6), g(2, 7), g(8, 7)],
      face: 's',
    },
  ],
};
