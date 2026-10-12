/* Серия «Электроника ИМ»: какие игры, как подключены кнопки, где они на корпусе.
 * Прошивки и экраны — из MAME (hh_sm510.cpp), корпуса — артворк hydef; собираются tools/elektronika/build.py. */
import type { GwPort } from '../../arcade/gw';

export interface GwButton {
  id: string;
  port: GwPort;
  mask: number;
  /** Центр и радиус на корпусе (2782×1654), если в артворке нет картинки нажатой кнопки. */
  at: [number, number, number];
  /** e.key в нижнем регистре; цифровой блок — e.code (Numpad7). */
  keys: string[];
  label: string;
}

export interface GwGame {
  id: string;
  model: string;
  title: string;
  /** Пара слов для подписи под корпусом. */
  about: string;
  buttons: GwButton[];
}

const TOP: GwButton[] = [
  { id: 'a', port: 'IN.2', mask: 0x04, at: [2405, 244, 110], keys: ['1'], label: 'игра А' },
  { id: 'b', port: 'IN.2', mask: 0x02, at: [2405, 435, 110], keys: ['2'], label: 'игра Б' },
  { id: 't', port: 'IN.2', mask: 0x01, at: [2405, 613, 110], keys: ['3', 't'], label: 'время' },
];

const L_UP: [number, number, number] = [334, 1107, 175];
const L_DN: [number, number, number] = [334, 1395, 175];
const R_UP: [number, number, number] = [2452, 1107, 175];
const R_DN: [number, number, number] = [2452, 1395, 175];

/** «Яйца» (Ну, погоди! и все его перерисовки): четыре кнопки — четыре угла. */
const EGG: GwButton[] = [
  { id: 'lu', port: 'IN.1', mask: 0x08, at: L_UP, keys: ['q', 'arrowup', 'Numpad7'], label: '↖' },
  { id: 'ld', port: 'IN.1', mask: 0x04, at: L_DN, keys: ['a', 'arrowleft', 'Numpad1'], label: '↙' },
  { id: 'ru', port: 'IN.1', mask: 0x02, at: R_UP, keys: ['p', 'arrowright', 'Numpad9'], label: '↗' },
  { id: 'rd', port: 'IN.1', mask: 0x01, at: R_DN, keys: ['l', 'arrowdown', 'Numpad3'], label: '↘' },
  ...TOP,
];

const LEFT_KEYS = ['arrowleft', 'a', 'z'];
const RIGHT_KEYS = ['arrowright', 'd', 'm'];

/** Две кнопки на α/β (Тайны океана, Космический мост). */
const TWO_AB = (l: [number, number, number], r: [number, number, number]): GwButton[] => [
  { id: 'l', port: 'B', mask: 1, at: l, keys: LEFT_KEYS, label: '◀' },
  { id: 'r', port: 'BA', mask: 1, at: r, keys: RIGHT_KEYS, label: '▶' },
  ...TOP,
];

const egg = (id: string, model: string, title: string, about: string): GwGame => ({ id, model, title, about, buttons: EGG });

export const GAMES: GwGame[] = [
  egg('nupogodi', 'ИМ-02', 'Ну, погоди!', 'Волк ловит корзиной яйца с четырёх насестов. Пока в окошке заяц, разбитое яйцо — полштрафа.'),
  {
    id: 'taynyoke',
    model: 'ИМ-03',
    title: 'Тайны океана',
    about: 'Водолаз носит сокровища с затонувшего корабля в лодку, а спрут тянет к нему щупальца.',
    buttons: TWO_AB([300, 1200, 200], [2470, 1200, 200]),
  },
  {
    id: 'vespovar',
    model: 'ИМ-04',
    title: 'Весёлый повар',
    about: 'Повар подбрасывает на сковородке сосиски, рыбу и курицу — ничего не уронить на пол.',
    buttons: [
      { id: 'l', port: 'IN.1', mask: 0x08, at: [288, 1211, 200], keys: LEFT_KEYS, label: '◀' },
      { id: 'r', port: 'IN.1', mask: 0x04, at: [2494, 1211, 200], keys: RIGHT_KEYS, label: '▶' },
      ...TOP,
    ],
  },
  {
    id: 'kosmicmt',
    model: 'ИМ-09',
    title: 'Космический мост',
    about: 'Двое с батутом перебрасывают космонавтов в спасательный корабль.',
    buttons: TWO_AB([288, 1203, 200], [2490, 1203, 200]),
  },
  egg('ehockey', 'ИМ-10', 'Хоккей', 'Вратарь ловит шайбы, что катятся с четырёх сторон.'),
  egg('rkosmosa', 'ИМ-13', 'Разведчики космоса', 'Та же ловля с четырёх сторон; «игра А» и «игра Б» вместе — роли наоборот.'),
  egg('okhota', 'ИМ-16', 'Охота', 'Охотник не пропускает дичь ни с одной из четырёх сторон.'),
  egg('biathlon', 'ИМ-19', 'Биатлон', 'Ловля с четырёх сторон в зимнем наряде.'),
  egg('vfutbol', 'ИМ-22', 'Весёлые футболисты', 'Вратарь ловит мячи, летящие с четырёх сторон.'),
  {
    id: 'auslalom',
    model: 'ИМ-23',
    title: 'Автослалом',
    about: 'Машинка мчится по трассе: объезжать препятствия влево-вправо, «скорость» — прибавить.',
    buttons: [
      { id: 'speed', port: 'IN.1', mask: 0x08, at: L_UP, keys: ['arrowup', 'w'], label: 'скорость' },
      { id: 'l', port: 'IN.1', mask: 0x04, at: L_DN, keys: LEFT_KEYS, label: '◀' },
      { id: 'go', port: 'IN.1', mask: 0x02, at: R_UP, keys: [' ', 'enter'], label: 'запуск' },
      { id: 'r', port: 'IN.1', mask: 0x01, at: R_DN, keys: RIGHT_KEYS, label: '▶' },
      ...TOP,
    ],
  },
  egg('krybolov', 'ИМ-32', 'Кот-рыболов', 'Кот с сачком ловит рыбу с четырёх сторон.'),
  egg('kvakazad', 'ИМ-33', 'Квака-задавака', 'Лягушка ловит добычу с четырёх сторон.'),
  egg('kosmicpt', 'ИМ-50', 'Космический полёт', 'Космонавт ловит грузы с четырёх сторон.'),
  egg('atakaast', 'ИМ-53', 'Атака астероидов', 'Отбить астероиды, летящие с четырёх сторон.'),
];
