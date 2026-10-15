/* Го — описание игры: доска 9/13/19, японский или китайский подсчёт, фора; 2 игрока; боты (Монте-Карло); правила с показом. */
import type { GameDef, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, BLACK, cfgFrom, makeView, newState, setup, toAct, WHITE, type Action, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Чёрные', color: '#1a1a1a', light: '#555555', dark: '#000000' },
  { name: 'Белые', color: '#e8e4d8', light: '#ffffff', dark: '#b8b4a8', ink: '#6a665a' },
];

const COLS = 'ABCDEFGHJKLMNOPQRST';
export const coord = (n: number, p: number) => `${COLS[p % n]}${n - Math.floor(p / n)}`;

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'play':
      return ev.captured.length ? `${name(ev.seat)} снимает ${ev.captured.length} ${ev.captured.length === 1 ? 'камень' : ev.captured.length < 5 ? 'камня' : 'камней'}` : null;
    case 'pass':
      return `${name(ev.seat)}: пас`;
    case 'resign':
      return `${name(ev.seat)} сдаётся.`;
    case 'end':
      return `🏁 Чёрные ${ev.score[0]} — белые ${ev.score[1]}. Победа: ${name(ev.winner)}.`;
  }
  return null;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
/** Позиция 9×9 из рисунка: 9 строк, «x» — чёрный, «o» — белый, «.» — пусто. */
function pos(rows: string[], turn = 0, extra: Partial<State> = {}): State {
  const s = newState(cfgFrom({ size: 9 }));
  s.board = rows.join('').split('').map((ch) => (ch === 'x' ? BLACK : ch === 'o' ? WHITE : 0));
  s.turn = turn;
  return Object.assign(s, extra);
}
const P = (x: number, y: number) => y * 9 + x;
const M = (seat: number, x: number, y: number, caption?: string) => ({ seat, action: { type: 'play', p: P(x, y) } as Action, caption });

export const def: GameDef<State, Action, Event, State> = {
  id: 'go',
  title: 'Го',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'size',
      label: 'Доска',
      type: 'select',
      choices: [
        { value: 9, label: '9×9 — быстро' },
        { value: 13, label: '13×13' },
        { value: 19, label: '19×19 — полная' },
      ],
      default: 9,
    },
    {
      key: 'rules',
      label: 'Подсчёт',
      type: 'select',
      choices: [
        { value: 'japanese', label: 'японский — территория и пленные, коми 6,5' },
        { value: 'chinese', label: 'китайский — камни и территория, коми 7,5' },
      ],
      default: 'japanese',
    },
    { key: 'handicap', label: 'Фора чёрным', type: 'number', min: 0, max: 9, step: 1, default: 0, hint: '2–9 камней на звёзды; белые ходят первыми, коми 0,5.' },
  ],
  presets: [
    { id: 'small', label: '9×9', hint: 'Для начала и быстрой партии', options: { size: 9, rules: 'japanese', handicap: 0 } },
    { id: 'mid', label: '13×13', hint: 'Средняя доска', options: { size: 13, rules: 'japanese', handicap: 0 } },
    { id: 'full', label: '19×19', hint: 'Настоящая доска; боты здесь слабые', options: { size: 19, rules: 'japanese', handicap: 0 } },
    { id: 'chinese', label: 'Китайский подсчёт', hint: '19×19, камни + территория', options: { size: 19, rules: 'chinese', handicap: 0 } },
    { id: 'handicap', label: 'С форой', hint: '9×9, у чёрных два камня', options: { size: 9, rules: 'japanese', handicap: 2 } },
  ],

  setup: (seats, opts) => setup(seats.map((x) => x.seat), opts),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s) => makeView(s),
  result(s) {
    if (!s.over || !s.final) return null;
    const f = s.final;
    const scores = { 0: f.score[0], 1: f.score[1] };
    if (f.resign != null) return { winners: [f.winner], text: `${f.resign === 0 ? 'чёрные' : 'белые'} сдались`, scores };
    return { winners: [f.winner], text: `${f.score[0]} : ${f.score[1]}`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () =>
    pos(
      [
        '.........',
        '..xo.o...',
        '.x.xo.o..',
        '..xxoo...',
        '..x.xo.o.',
        '.xo.x.o..',
        '..o.xo...',
        '...xxo...',
        '.........',
      ],
      1,
      { last: P(4, 6), caps: [2, 1] }
    ),

  rules: {
    goal: 'Огородить камнями больше пунктов доски, чем соперник. Чёрные ходят первыми; камень ставят на пересечение линий и больше не двигают.',
    sections: [
      {
        title: 'Дыхания и взятие',
        html: `<p>Соседние по линиям камни одного цвета — <b>группа</b>. Свободные пункты рядом с группой — её <b>дыхания</b>.
          Закрыл последнее дыхание чужой группы — она снимается с доски, камни идут в плен.
          Ставить камень туда, где у своей группы не останется дыханий, нельзя — если только этим ходом не снимаешь чужие.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['.........', '.........', '...x.....', '..xo.....', '...x.....', '.........', '.........', '.........', '.........']),
          intro: 'У белого камня одно дыхание — справа.',
          steps: [M(0, 4, 3, 'Чёрные закрывают его — белый камень снят, он в плену.')],
        },
      },
      {
        title: 'Ко',
        html: `<p>Бывает, что взятие можно сразу «взять обратно» — и так без конца. Поэтому правило <b>ко</b>: нельзя ходом вернуть доску
          в положение, которое было перед прошлым ходом соперника. Сначала сходи в другое место — потом можно.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['.........', '.........', '...xo....', '..x.xo...', '...xo....', '.........', '.........', '.........', '.........'], 1),
          intro: 'Белые могут взять чёрный камень.',
          steps: [M(1, 3, 3, 'Белые берут. Чёрные сразу взять обратно не могут — это ко: им нужно сначала сходить в другом месте.'), M(0, 7, 7, 'Чёрные ходят в стороне — «угроза ко».'), M(1, 0, 0, 'Белые отвечают где-то ещё…'), M(0, 4, 3, '…и теперь чёрные могут взять обратно.')],
        },
      },
      {
        title: 'Конец и подсчёт',
        html: `<p>Когда ходить больше некуда с пользой, игроки <b>пасуют</b>; два паса подряд — конец. Безнадёжные камни внутри чужой территории
          считаются мёртвыми и снимаются в плен (их определяет программа, доигрывая позицию много раз).</p>
          <p><b>Японский подсчёт:</b> пустые пункты своей территории + пленные. <b>Китайский:</b> свои камни на доске + территория.
          Белым добавляется <b>коми</b> — 6,5 (японский) или 7,5 (китайский), за то что чёрные ходили первыми. Можно и сдаться.</p>
          <p>Боты играют доигрываниями «наугад» (Монте-Карло): на 9×9 — прилично, на 19×19 — слабо, как начинающий.</p>`,
      },
    ],
  },
};
