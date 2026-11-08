/* Чапаев и карром — описание игры для сборника: вдвоём, щелчками; без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, cfgFrom, CR, HOUSES, newState, setup, toAct, TRAPS, ZONES, type Action, type Event, type Piece, type State } from './engine';

export const SEATS = [
  { name: 'Белые', color: '#e8dcc0', light: '#fffaf0', dark: '#9a8a68', ink: '#5a4a28' },
  { name: 'Чёрные', color: '#2a1e18', light: '#5a4a42', dark: '#0a0604' },
];

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'shot': {
      const n = ev.gone.length;
      return `${name(ev.seat)}: щелчок${n ? ` — слетело ${n}` : ' — мимо'}${ev.again ? ', бьёт ещё' : ''}.`;
    }
    case 'round':
      return ev.winner == null ? `Раунд: ${ev.text}.` : `Раунд за ${name(ev.winner)} — ${ev.text}.`;
    case 'board':
      return `Доска за ${name(ev.winner)}: +${ev.pts}. Счёт ${ev.score[0]} : ${ev.score[1]}.`;
    case 'foul':
      return `${name(ev.seat)}: ${ev.text}.`;
    case 'end':
      return `🏁 Победа: ${name(ev.winner)}.`;
  }
  return null;
}

// ---------------------------------------------------------------- варианты

const ch = (o: { mode?: unknown }) => o.mode !== 'carrom';
const VARIANTS = ['strict', 'houses', 'king', 'traps', 'tanks', 'wind', 'terrain'] as const;
/** Пресет Чапаева: все варианты выключены, кроме названных. */
const V = (on: Partial<Record<(typeof VARIANTS)[number], boolean>>) => ({ mode: 'chapaev', ...Object.fromEntries(VARIANTS.map((k) => [k, !!on[k]])) });

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const A = (seat: number, a: Action, caption?: string) => ({ seat, action: a, caption });
const P = (id: number, o: number, x: number, y: number, k?: boolean, t?: boolean): Piece => ({ id, o, x, y, ...(k ? { k: 1 as const } : {}), ...(t ? { t: 1 as const } : {}) });
/** Позиция для показа: вариант и заданные шашки. */
function demo(on: Record<string, boolean>, pieces: Piece[]): State {
  const s = newState(cfgFrom(V(on)), [0, 1]);
  s.pieces = pieces;
  return s;
}

export const def: GameDef<State, Action, Event, State> = {
  id: 'chapaev',
  title: 'Чапаев',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'mode',
      label: 'Игра',
      type: 'select',
      choices: [
        { value: 'chapaev', label: 'Чапаев — шашки на шахматной доске' },
        { value: 'carrom', label: 'карром — доска с лузами' },
      ],
      default: 'chapaev',
    },
    { key: 'strict', label: 'Строго по очереди', type: 'toggle', default: false, hint: 'Чапаев: после каждого щелчка ход переходит, даже если выбил шашку.', showIf: ch },
    { key: 'houses', label: 'Дома', type: 'toggle', default: false, hint: 'Спичечные коробки посреди доски: шашки от них отскакивают, за ними можно спрятаться.', showIf: ch },
    { key: 'king', label: 'Король', type: 'toggle', default: false, hint: 'Шахматный Чапаев: сбил чужого короля — раунд твой, слетел свой — раунд проигран.', showIf: ch },
    { key: 'traps', label: 'Ловушки', type: 'toggle', default: false, hint: 'Две лунки посередине: медленная шашка над лункой проваливается.', showIf: ch },
    { key: 'tanks', label: 'Танки', type: 'toggle', default: false, hint: 'По две шашки в ряду — стопкой: вдвое тяжелее, бьют сильнее, сдвинуть трудно.', showIf: ch },
    { key: 'wind', label: 'Ветер', type: 'toggle', default: false, hint: 'Перед каждым ходом ветер меняется и сносит катящиеся шашки; стрелка показывает куда.', showIf: ch },
    { key: 'terrain', label: 'Лёд и песок', type: 'toggle', default: false, hint: 'Посередине лёд — шашка скользит далеко, по краям песок — вязнет.', showIf: ch },
    {
      key: 'target',
      label: 'Карром — до скольких',
      type: 'select',
      showIf: (o) => o.mode === 'carrom',
      choices: [
        { value: 25, label: 'до 25 очков' },
        { value: 13, label: 'до 13 — быстро' },
      ],
      default: 25,
    },
  ],
  presets: [
    { id: 'chapaev', label: 'Чапаев', hint: 'Выбил — бьёшь ещё; победитель раунда сдвигает ряд вперёд', options: V({}) },
    { id: 'strict', label: 'По очереди', hint: 'Чапаев, где ход всегда переходит', options: V({ strict: true }) },
    { id: 'doma', label: 'С домами', hint: 'Спичечные коробки посреди доски: рикошеты и укрытия', options: V({ houses: true }) },
    { id: 'korol', label: 'Шахматный', hint: 'Короли и дома: собьёшь короля — раунд твой', options: V({ houses: true, king: true }) },
    { id: 'lovushki', label: 'Ловушки', hint: 'Лунки посередине: медленная шашка в них проваливается', options: V({ traps: true }) },
    { id: 'tanki', label: 'Танки', hint: 'По два танка-стопки в ряду: тяжёлые, бьют сильнее', options: V({ tanks: true }) },
    { id: 'veter', label: 'Ветер', hint: 'Каждый ход дует по-новому и сносит шашки', options: V({ wind: true }) },
    { id: 'led', label: 'Лёд и песок', hint: 'Скользкий лёд посередине, вязкий песок по краям', options: V({ terrain: true }) },
    { id: 'carrom', label: 'Карром', hint: 'Индийская доска с лузами: биток, фишки, королева — до 25', options: { mode: 'carrom', target: 25 } },
    { id: 'carrom13', label: 'Карром до 13', hint: 'Короткая партия', options: { mode: 'carrom', target: 13 } },
  ],

  setup: (_seats, opts) => setup(opts),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s) => s,
  result(s) {
    if (!s.over || s.winner == null) return null;
    const scores = s.cfg.mode === 'carrom' ? { 0: s.score[0], 1: s.score[1] } : { 0: s.line[0], 1: s.line[1] };
    return { winners: [s.winner], text: s.cfg.mode === 'carrom' ? `${s.score[0]} : ${s.score[1]}` : `раундов: ${s.round}`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    // шахматный Чапаев с домами — видно и коробки, и королей
    const s = setup(V({ houses: true, king: true }));
    s.pieces = s.pieces.filter((p) => ![2, 5, 9, 14].includes(p.id));
    const mv = (id: number, x: number, y: number) => {
      const p = s.pieces.find((q) => q.id === id);
      if (p) (p.x = x), (p.y = y);
    };
    mv(3, 2.9, 5.3);
    mv(12, 4.6, 2.9);
    mv(10, 3.2, 2.3);
    mv(6, 5.8, 6.1);
    mv(13, 2.2, 1.4);
    s.round = 3;
    return s;
  },

  rules: {
    goal: 'Щелчками выбить все шашки соперника и сохранить свои; выигранный раунд двигает твой ряд вперёд — когда ряды сойдутся, партия твоя.',
    sections: [
      {
        title: 'Щелчок',
        html: `<p>Шашки — по 8 на крайних рядах шахматной доски. По очереди щелчком посылают свою шашку в чужие: что слетело с доски, то выбыло.
          Нажмите на свою шашку, потяните назад, как рогатку, и отпустите — чем дальше тянете, тем сильнее.</p>
          <p>Шашки деревянные: удар забирает часть силы, так что ряд одним щелчком не снести. А у сильного щелчка дрожит рука —
          шашка может уйти чуть в сторону (веер у прицела показывает насколько). Слабый щелчок точнее, сильный — дальше.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => newState(cfgFrom({}), [0, 1]),
          steps: [A(0, { type: 'shot', id: 3, angle: -Math.PI / 2, power: 1 }, 'Белые бьют со всей силы через всю доску: у сильного щелчка рука дрожит — можно и промахнуться.')],
        },
      },
      {
        title: 'Ещё удар',
        html: `<p>Выбил хотя бы одну чужую шашку, а своя осталась на доске, — бьёшь ещё. Своя слетела или промахнулся — ход сопернику.
          В варианте «по очереди» ход переходит после каждого щелчка.</p>`,
      },
      {
        title: 'Раунды',
        html: `<p>Раунд выигрывает тот, кто выбил все чужие шашки, сохранив хотя бы одну свою. В следующем раунде его ряд стоит на линию ближе к сопернику,
          а если он не потерял ни одной шашки — на две. Все шашки слетели — раунд переигрывают. Когда ряды сошлись вплотную, выигранный раунд решает партию.</p>`,
      },
      {
        title: 'Дома',
        html: `<p>Вариант «С домами»: посреди доски стоят спичечные коробки. Шашки отскакивают от них, как от стенки, — можно спрятаться за домом
          или выбить чужую рикошетом. Дома не двигаются и не выбывают.</p>`,
        demo: {
          seats: demoSeats,
          options: V({ houses: true }),
          setup: () => demo({ houses: true }, [P(3, 0, HOUSES[0].x, 6.2), P(0, 0, 0.5, 7.5), P(11, 1, HOUSES[0].x, 2.9), P(8, 1, 0.5, 0.5)]),
          steps: [A(0, { type: 'shot', id: 3, angle: -Math.PI / 2, power: 0.8 }, 'Чёрная спряталась за домом: прямой щелчок упирается в коробку и отскакивает.')],
        },
      },
      {
        title: 'Король',
        html: `<p>Шахматный Чапаев: шашка на поле e — король (с короной). Сбил чужого короля — раунд твой, сколько бы шашек у соперника ни осталось.
          Слетел свой король, даже от своего же щелчка, — раунд проигран. Короля прячут за домами и прикрывают своими шашками.</p>`,
        demo: {
          seats: demoSeats,
          options: V({ houses: true, king: true }),
          setup: () => demo({ houses: true, king: true }, [P(4, 0, 4.5, 7.5, true), P(2, 0, 2.5, 2.2), P(12, 1, 2.5, 0.9, true), P(13, 1, 5.5, 0.5)]),
          steps: [A(0, { type: 'shot', id: 2, angle: -Math.PI / 2, power: 0.6 }, 'Белые сбивают чёрного короля — раунд за белыми.')],
        },
      },
      {
        title: 'Ловушки',
        html: `<p>В варианте «Ловушки» посередине доски две лунки. Шашка, что еле катится над лункой, проваливается и выбывает — своя или чужая.
          Быструю шашку проносит над лункой.</p>`,
        demo: {
          seats: demoSeats,
          options: V({ traps: true }),
          setup: () => demo({ traps: true }, [P(1, 0, TRAPS[0].x, 6.4), P(3, 0, 4.5, 7.5), P(9, 1, TRAPS[0].x, 4.9), P(13, 1, 5.5, 0.5)]),
          steps: [A(0, { type: 'shot', id: 1, angle: -Math.PI / 2, power: 0.55 }, 'Чёрную шашку толкнули несильно — она доехала до лунки и провалилась.')],
        },
      },
      {
        title: 'Танки',
        html: `<p>В варианте «Танки» по две шашки в каждом ряду стоят стопкой по две. Танк вдвое тяжелее: сам бьёт сильнее и выбивает простую шашку
          на всю доску, а сдвинуть его самого трудно — по танку бей со всей силы.</p>`,
        demo: {
          seats: demoSeats,
          options: V({ tanks: true }),
          setup: () => demo({ tanks: true }, [P(1, 0, 1.5, 3, false, true), P(3, 0, 3.5, 3), P(9, 1, 1.5, 1.6), P(11, 1, 3.5, 1.6, false, true)]),
          steps: [
            A(0, { type: 'shot', id: 1, angle: -Math.PI / 2, power: 0.6 }, 'Танк бьёт простую шашку — она улетает с доски.'),
            A(0, { type: 'shot', id: 3, angle: -Math.PI / 2, power: 0.6 }, 'Простая шашка тем же щелчком танк почти не сдвигает.'),
          ],
        },
      },
      {
        title: 'Ветер, лёд и песок',
        html: `<p>«Ветер»: перед каждым ходом ветер меняется — флажок в углу доски показывает, куда и как сильно он дует. Катящиеся шашки сносит,
          а стоящие он не трогает. «Лёд и песок»: посередине доски лёд — шашка скользит по нему далеко, по краям песок — в нём шашка вязнет и
          почти сразу останавливается; за песком можно отсидеться.</p>`,
        demo: {
          seats: demoSeats,
          options: V({ terrain: true }),
          setup: () => demo({ terrain: true }, [P(3, 0, 4, 6.8), P(0, 0, ZONES[1].x, 6.8), P(11, 1, 4, 0.5), P(8, 1, ZONES[1].x, 0.5)]),
          steps: [
            A(0, { type: 'shot', id: 0, angle: -Math.PI / 2, power: 0.8 }, 'Через песок — шашка вязнет и не доходит.'),
            A(1, { type: 'shot', id: 11, angle: Math.PI / 2, power: 0.8 }, 'Тот же щелчок через лёд — шашка проскальзывает его и докатывается до белой.'),
          ],
        },
      },
      {
        title: 'Карром',
        html: `<p>Индийская родня Чапаева: квадратная доска с бортами и четырьмя лузами, по 9 светлых и тёмных фишек и красная королева в центре.
          Биток ставят на свою линию (её можно передвигать) и щелчком загоняют свои фишки в лузы. Забил свою — бьёшь ещё.
          Королеву надо «покрыть»: следующим ударом забить свою фишку, иначе она возвращается в центр. Биток в лузе — штраф: одна своя фишка обратно.
          Последнюю свою фишку нельзя забить раньше королевы — фол: она и ещё одна забитая возвращаются в центр. Первый удар сдачи (разбой),
          если биток не сдвинул ни одной фишки, можно повторить — всего три попытки.</p>
          <p>Забил все свои — доска твоя: очки по числу оставшихся фишек соперника, за покрытую королеву +3. Партия — до 25.</p>`,
        demo: {
          seats: demoSeats,
          options: { mode: 'carrom' },
          setup: () => newState(cfgFrom({ mode: 'carrom' }), [0, 1]),
          steps: [A(0, { type: 'strike', x: CR.size / 2, angle: -Math.PI / 2, power: 0.9 }, 'Первый удар — «разбить» кучу в центре.')],
        },
      },
    ],
  },
};
