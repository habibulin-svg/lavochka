/* Чапаев и карром — описание игры для сборника: вдвоём, щелчками; без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, cfgFrom, CR, newState, setup, toAct, type Action, type Event, type State } from './engine';

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

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const A = (seat: number, a: Action, caption?: string) => ({ seat, action: a, caption });

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
    { key: 'strict', label: 'Строго по очереди', type: 'toggle', default: false, hint: 'Чапаев: после каждого щелчка ход переходит, даже если выбил шашку.' },
    {
      key: 'target',
      label: 'Карром — до скольких',
      type: 'select',
      choices: [
        { value: 25, label: 'до 25 очков' },
        { value: 13, label: 'до 13 — быстро' },
      ],
      default: 25,
    },
  ],
  presets: [
    { id: 'chapaev', label: 'Чапаев', hint: 'Выбил — бьёшь ещё; победитель раунда сдвигает ряд вперёд', options: { mode: 'chapaev', strict: false } },
    { id: 'strict', label: 'По очереди', hint: 'Чапаев, где ход всегда переходит', options: { mode: 'chapaev', strict: true } },
    { id: 'carrom', label: 'Карром', hint: 'Индийская доска с лузами: биток, фишки, королева — до 25', options: { mode: 'carrom', target: 25 } },
    { id: 'carrom13', label: 'Карром до 13', hint: 'Короткая партия', options: { mode: 'carrom', target: 13 } },
  ],

  setup: (_seats, opts) => setup(opts),
  toAct,
  apply: (s, seat, a) => apply(s, seat, a),
  view: (s) => s,
  result(s) {
    if (!s.over || s.winner == null) return null;
    const scores = s.cfg.mode === 'carrom' ? { 0: s.score[0], 1: s.score[1] } : { 0: s.line[0], 1: s.line[1] };
    return { winners: [s.winner], text: s.cfg.mode === 'carrom' ? `${s.score[0]} : ${s.score[1]}` : `раундов: ${s.round}`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    const s = setup({});
    s.pieces = s.pieces.filter((p) => ![2, 5, 9, 12, 14].includes(p.id));
    const mv = (id: number, x: number, y: number) => {
      const p = s.pieces.find((q) => q.id === id);
      if (p) (p.x = x), (p.y = y);
    };
    mv(3, 3.6, 4.4);
    mv(10, 4.3, 2.2);
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
          Нажмите на свою шашку, потяните назад, как рогатку, и отпустите — чем дальше тянете, тем сильнее.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => newState(cfgFrom({}), [0, 1]),
          steps: [A(0, { type: 'shot', id: 3, angle: -Math.PI / 2, power: 1 }, 'Белые со всей силы бьют прямо вперёд.')],
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
        title: 'Карром',
        html: `<p>Индийская родня Чапаева: квадратная доска с бортами и четырьмя лузами, по 9 светлых и тёмных фишек и красная королева в центре.
          Биток ставят на свою линию (её можно передвигать) и щелчком загоняют свои фишки в лузы. Забил свою — бьёшь ещё.
          Королеву надо «покрыть»: следующим ударом забить свою фишку, иначе она возвращается в центр. Биток в лузе — штраф: одна своя фишка обратно.</p>
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
