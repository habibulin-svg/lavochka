/* 15 фигур городошного спорта. Все фигуры, кроме «Письма», строятся от середины лицевой линии города (y = 0) вглубь;
 * «Письмо» — четыре городка по углам города и «марка» в центре. Координаты — метры, x — вдоль лицевой линии, y — вглубь города.
 * Угол a — направление оси лежачего городка (0 — вдоль лицевой линии, π/2 — «на бросающего»). Без DOM. */
import { RH, RR } from './physics';

export interface Piece {
  x: number;
  y: number;
  a: number;
  stand?: boolean;
  /** Марка «Письма». */
  mark?: boolean;
}

export interface Figure {
  id: string;
  name: string;
  /** Как стоит — для правил. */
  hint: string;
  pieces: Piece[];
  /** Выбивается только с кона. */
  konOnly?: boolean;
}

const A = 0; // поперёк броска, вдоль лицевой линии
const V = Math.PI / 2; // вдоль броска
const L = RH * 2; // длина городка, 0,2
const D = RR * 2; // толщина, 0,05
const g = 0.004; // зазор, чтобы не толкались при расстановке
const lie = (x: number, y: number, a = A): Piece => ({ x, y, a });
const up = (x: number, y: number): Piece => ({ x, y, a: 0, stand: true });
/** Лежачий «на бросающего», передний край — на y0. */
const vAt = (x: number, y0: number): Piece => lie(x, y0 + RH, V);
/** Лежачий поперёк, передний край — на y0. */
const aAt = (x: number, y0: number): Piece => lie(x, y0 + RR, A);
const diag = (x: number, y: number, a: number): Piece => lie(x, y, a);

export const FIGURES: Figure[] = [
  {
    id: 'pushka',
    name: 'Пушка',
    hint: 'лафет поперёк у лицевой линии, два колеса стоят по бокам ствола, ствол смотрит на бросающего, сзади — хобот лафета',
    pieces: [aAt(0, 0), up(-0.06, D + g + RR + 0.06), vAt(0, D + g), up(0.06, D + g + RR + 0.06), aAt(0, D + g + L + g)],
  },
  {
    id: 'vilka',
    name: 'Вилка',
    hint: 'черенок на бросающего, за ним перекладина и три зубца',
    pieces: [vAt(0, 0), aAt(0, L + g), vAt(-0.085, L + D + 2 * g), vAt(0, L + D + 2 * g), vAt(0.085, L + D + 2 * g)],
  },
  {
    id: 'zvezda',
    name: 'Звезда',
    hint: 'четыре луча крестом наискось, в середине стоит пятый городок',
    pieces: (() => {
      const cy = 0.2;
      const r = RH + RR + 0.012;
      const p: Piece[] = [up(0, cy)];
      for (const k of [0.25, 0.75, 1.25, 1.75]) {
        const ang = Math.PI * k;
        p.push(diag(Math.cos(ang) * r, cy + Math.sin(ang) * r, ang));
      }
      return p;
    })(),
  },
  {
    id: 'strela',
    name: 'Стрела',
    hint: 'остриё из двух городков наискось смотрит на бросающего, древко из двух и оперение поперёк',
    pieces: (() => {
      const k = Math.SQRT1_2 * RH;
      return [
        diag(-k - 0.012, k + RR, -Math.PI / 4),
        diag(k + 0.012, k + RR, Math.PI / 4),
        vAt(0, 2 * k + RR + g),
        vAt(0, 2 * k + RR + L + 2 * g),
        aAt(0, 2 * k + RR + 2 * L + 3 * g),
      ];
    })(),
  },
  {
    id: 'kolodec',
    name: 'Колодец',
    hint: 'сруб из четырёх городков квадратом, пятый — «ворот» поперёк посередине',
    pieces: (() => {
      const s = L + D + 2 * g; // сторона сруба по осям
      return [aAt(0, 0), vAt(-s / 2, D + g), vAt(s / 2, D + g), aAt(0, D + L + 2 * g), aAt(0, D + g + (L - D) / 2)];
    })(),
  },
  {
    id: 'kolenval',
    name: 'Коленчатый вал',
    hint: 'три городка поперёк лесенкой со сдвигом, между ними стоят два — «колена»',
    pieces: [aAt(-0.06, 0), up(0.07, D + g + RR + 0.01), aAt(0.06, D + D + 3 * g + 0.02), up(-0.07, 3 * D + 5 * g + 0.04), aAt(-0.06, 4 * D + 6 * g + 0.04)],
  },
  {
    id: 'artilleriya',
    name: 'Артиллерия',
    hint: 'три снаряда стоят в ряд между двумя лежачими поперёк',
    pieces: [aAt(0, 0), up(-0.075, D + g + RR), up(0, D + g + RR), up(0.075, D + g + RR), aAt(0, 2 * D + 2 * g + D)],
  },
  {
    id: 'raketka',
    name: 'Ракетка',
    hint: 'ручка на бросающего, за ней обод из четырёх городков квадратом',
    pieces: (() => {
      const y0 = L + g;
      const s = L + D + 2 * g;
      return [vAt(0, 0), aAt(0, y0), vAt(-s / 2, y0 + D + g), vAt(s / 2, y0 + D + g), aAt(0, y0 + D + L + 2 * g)];
    })(),
  },
  {
    id: 'gnezdo',
    name: 'Пулемётное гнездо',
    hint: 'по-старому «баба в окошке»: квадратная рамка из четырёх лежачих, в окошке стоит пятый',
    pieces: (() => {
      const s = L + D + 2 * g;
      return [aAt(0, 0), vAt(-s / 2, D + g), vAt(s / 2, D + g), aAt(0, D + L + 2 * g), up(0, D + g + RH)];
    })(),
  },
  {
    id: 'rak',
    name: 'Рак',
    hint: 'тело на бросающего, две клешни наискось вперёд, два хвоста наискось назад',
    pieces: (() => {
      const k = Math.SQRT1_2 * RH;
      const by = 2 * k + 0.01;
      return [
        diag(-k - 0.035, k + RR, Math.PI / 4),
        diag(k + 0.035, k + RR, -Math.PI / 4),
        lie(0, by + RH, V),
        diag(-k - 0.035, by + L + k - 0.02, -Math.PI / 4),
        diag(k + 0.035, by + L + k - 0.02, Math.PI / 4),
      ];
    })(),
  },
  {
    id: 'chasovye',
    name: 'Часовые',
    hint: 'три городка лежат поперёк в ряд, перед ними по краям стоят два «часовых»',
    pieces: [up(-0.16, RR + 0.02), up(0.16, RR + 0.02), aAt(-(L + g), 0.12), aAt(0, 0.12), aAt(L + g, 0.12)],
  },
  {
    id: 'serp',
    name: 'Серп',
    hint: 'дуга из четырёх городков и рукоять на бросающего',
    pieces: (() => {
      const cx = -0.05;
      const cy = 0.3;
      const R = 0.27;
      const p: Piece[] = [];
      for (const deg of [200, 245, 290, 335]) {
        const t = (deg * Math.PI) / 180;
        p.push(diag(cx + Math.cos(t) * R, cy + Math.sin(t) * R, t + Math.PI / 2));
      }
      // рукоять — от нижнего правого конца дуги к бросающему
      p[1].y = Math.max(p[1].y, RR + 0.004);
      p.push(vAt(0.26, 0));
      return p;
    })(),
  },
  {
    id: 'tir',
    name: 'Тир',
    hint: 'пять мишеней стоят в ряд поперёк, в метре от лицевой линии',
    pieces: [-0.2, -0.1, 0, 0.1, 0.2].map((x) => up(x, 1)),
  },
  {
    id: 'samolet',
    name: 'Самолёт',
    hint: 'фюзеляж из двух городков на бросающего, два крыла поперёк по бокам, хвост поперёк',
    pieces: [vAt(0, 0), lie(-(RH + RR + g), L * 0.7, A), lie(RH + RR + g, L * 0.7, A), vAt(0, L + g), aAt(0, 2 * L + 2 * g)],
  },
  {
    id: 'pismo',
    name: 'Письмо',
    hint: 'по углам города — четыре городка наискось, в середине — «марка»; выбивается только с кона',
    konOnly: true,
    pieces: (() => {
      const k = Math.SQRT1_2 * RH + RR;
      return [
        diag(-1 + k, k, -Math.PI / 4),
        diag(1 - k, k, Math.PI / 4),
        diag(-1 + k, 2 - k, Math.PI / 4),
        diag(1 - k, 2 - k, -Math.PI / 4),
        { x: 0, y: 1, a: Math.PI / 4, mark: true },
      ];
    })(),
  },
];

/** Официальная партия из 10 фигур. */
export const TEN = ['pushka', 'vilka', 'kolodec', 'strela', 'artilleriya', 'serp', 'gnezdo', 'samolet', 'tir', 'pismo'];
/** Короткая — 5 фигур. */
export const FIVE = ['pushka', 'zvezda', 'kolodec', 'samolet', 'pismo'];

export const figure = (id: string) => FIGURES.find((f) => f.id === id) ?? FIGURES[0];
