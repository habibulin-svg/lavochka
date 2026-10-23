/* В путь-дорогу — описание игры. Коробка «Малыша» (1990, автор-художник Н. Обухова): поле с двумя кольцевыми дорожками,
 * город в середине и парки по углам, четыре пластиковых автобуса и двенадцать фигурок ребят, кубик. */
import type { GameDef, Rng, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, cfgFrom, CITY, newState, PLY_LIMIT, RIDING, toAct, type Action, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Жёлтые', color: '#f2c814', light: '#ffe26a', dark: '#9a7a00', ink: '#7a5e00' },
  { name: 'Красные', color: '#e0262a', light: '#ff6a6e', dark: '#7a0a0e' },
  { name: 'Зелёные', color: '#1f7a3a', light: '#5cc07a', dark: '#0c4020' },
  { name: 'Синие', color: '#22389a', light: '#6a80e0', dark: '#0e1a50' },
];

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'board') return `🚌 ${name(ev.seat)}: пассажир сел в автобус.`;
  if (ev.type === 'drive' && ev.parked.length) return `🎡 Автобус «${name(ev.parked[0])}» въехал в парк!`;
  if (ev.type === 'end') {
    if (ev.winner == null) return `🏁 ${PLY_LIMIT} ходов — ничья.`;
    return ev.long ? `🏁 ${PLY_LIMIT} ходов — больше всех ребят в автобусе у игрока ${name(ev.winner)}.` : `🏁 ${name(ev.winner)} первыми отвезли ребят в парк — победа!`;
  }
  return null;
}

const demoSeats: SeatSpec[] = [0, 1, 2, 3].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const roll = (seat: number, d: number, caption?: string) => ({ seat, action: { type: 'roll' } as Action, rig: [d - 1], caption });
const walk = (seat: number, ped: number, to: number, caption?: string) => ({ seat, action: { type: 'walk', ped, to } as Action, caption });
const drive = (seat: number, caption?: string) => ({ seat, action: { type: 'drive' } as Action, caption });
const board = (seat: number, ped: number, caption?: string) => ({ seat, action: { type: 'board', ped } as Action, caption });

/** Позиция: автобусы, пешеходы мест и чей ход. */
function pos(bus: number[], peds: number[][], turn = 0, load = [0, 0, 0, 0]): State {
  const s = newState(cfgFrom({}), 4);
  s.bus = bus;
  s.peds = peds;
  s.load = load;
  s.turn = turn;
  return s;
}
const home = [CITY, CITY, CITY];

function fixedRng(seed: number): Rng {
  let x = seed;
  return {
    next: () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648,
    int(n: number) {
      return Math.floor(this.next() * n);
    },
    getState: () => x,
  };
}

export const def: GameDef<State, Action, Event, State> = {
  id: 'vput',
  title: 'В путь-дорогу',
  players: { min: 2, max: 4, default: 4 },
  seats: SEATS,
  options: [
    {
      key: 'peds',
      label: 'Ребят у каждого',
      type: 'select',
      choices: [
        { value: 3, label: 'трое — по коробке' },
        { value: 2, label: 'двое — быстрая игра' },
      ],
      default: 3,
    },
    {
      key: 'board',
      label: 'Посадка в автобус',
      type: 'select',
      choices: [
        { value: 'hand', label: 'сам сажаешь своих — по коробке' },
        { value: 'auto', label: 'садятся сами' },
      ],
      default: 'hand',
    },
    {
      key: 'park',
      label: 'Парк',
      type: 'select',
      choices: [
        { value: 'any', label: 'любой — «в одном из углов», как в правилах' },
        { value: 'own', label: 'только своего цвета — кому-то ехать дальше' },
      ],
      default: 'any',
    },
  ],
  presets: [
    { id: 'box', label: 'По коробке', hint: 'По трое ребят, сажаешь своих сам — даже в чужой ход', options: { peds: 3, board: 'hand', park: 'any' } },
    { id: 'quick', label: 'Быстрая', hint: 'По двое ребят у каждого', options: { peds: 2, board: 'hand', park: 'any' } },
    { id: 'auto', label: 'Посадка сама', hint: 'Ребята садятся в свой автобус сами — следить не надо', options: { peds: 3, board: 'auto', park: 'any' } },
  ],

  setup: (seats, opts, rng) => newState(cfgFrom(opts), seats.length, rng.int(seats.length)),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s) => s,
  result(s) {
    if (!s.over) return null;
    if (s.winner == null) return { winners: [], text: 'ничья' };
    return { winners: [s.winner], text: 'первыми отвезли ребят в парк' };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    let s = newState(cfgFrom({}), 4);
    const rng = fixedRng(5);
    for (let i = 0; i < 70 && !s.over; i++) {
      const seat = toAct(s)[0];
      const a = choose(s, seat, 1, rng);
      if (!a) break;
      const r = apply(s, seat, a, rng);
      if (!r || r.state.over) break;
      s = r.state;
    }
    return s;
  },

  rules: {
    goal: 'Вывести своих ребят из города на дорожку, посадить их в автобус своего цвета и первым отвезти в парк.',
    sections: [
      {
        title: 'Поле и начало',
        html: `<p>По наружной дорожке ездят <b>автобусы</b>, по внутренней ходят <b>пешеходы</b>. У каждого игрока трое ребят
          своего цвета — они ждут в городе, в середине поля, — и автобус того же цвета на остановке «А». В углах поля — четыре парка.</p>
          <p>Всё движется в одну сторону — по стрелкам, против часовой. Кто ходит первым — по жребию.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => newState(cfgFrom({}), 4),
          intro: 'Ребята в городе, автобусы на остановках.',
          steps: [roll(0, 3, 'Жёлтые бросают кубик: 3.'), walk(0, 0, 13, 'От синей стрелки — три клетки: пешеход выходит из города.'), drive(0, 'И все четыре автобуса — на клетку вперёд.')],
        },
      },
      {
        title: 'Ход',
        html: `<p>Бросив кубик, игрок решает сам: <b>вывести</b> нового пешехода из города — отсчитать от любой синей стрелки столько
          клеток, сколько выпало (клетка со стрелкой — первая), — или <b>передвинуть</b> того, кто уже на дорожке.
          Пешеходов на одной клетке может быть сколько угодно.</p>
          <p>Потом он передвигает <b>все четыре автобуса</b> на одну клетку — и чужие тоже.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([9, 0, 5, 14], [[10, CITY, CITY], home, home, home]),
          intro: 'Жёлтый пешеход на дорожке, жёлтый автобус чуть впереди.',
          steps: [roll(0, 2, 'Выпало 2.'), walk(0, 0, 8, 'Пешеход обгоняет автобус на клетку.'), drive(0, 'Автобусы едут — жёлтый встаёт как раз над пешеходом.'), board(0, 0, 'Садимся!')],
        },
      },
      {
        title: 'Посадка',
        html: `<p>Сесть в автобус можно, только когда он стоит на соседней клетке — <b>один под другим</b> — с пешеходом
          <b>своего цвета</b>. Неважно, чей был ход: если красные передвинули автобусы и жёлтый встал над жёлтым пешеходом,
          жёлтые тут же сажают своего.</p>
          <p>Пешеходы и автобусы ходят только вперёд. В варианте «посадка сама» ребята садятся без кнопки.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([6, 0, 5, 14], [[5, CITY, CITY], home, home, home], 1),
          intro: 'Ход красных. Жёлтый автобус на клетку позади жёлтого пешехода.',
          steps: [roll(1, 4, 'Красные бросают: 4.'), walk(1, 0, 2, 'Красный пешеход выходит из города.'), drive(1, 'Красные двигают автобусы…'), board(0, 0, '…и жёлтые сажают своего в чужой ход.')],
        },
      },
      {
        title: 'В парк',
        html: `<p>Когда в автобусе соберутся <b>все трое</b>, он едет до парка в одном из углов поля. Въехать в парк можно с одной
          из двух клеток, что граничат с ним: автобус, стоящий на такой клетке, при следующем ходе автобусов сворачивает в парк.
          Можно договориться ездить только в парк <b>своего цвета</b> — но тогда кому-то ехать заметно дальше.</p>
          <p>Кто первым отвёз ребят в парк — победил. Если за ${PLY_LIMIT} ходов никто не доехал, побеждает тот, у кого в автобусе
          больше ребят (это наше правило).</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([12, 0, 5, 14], [[RIDING, RIDING, RIDING], home, home, home], 0, [3, 0, 0, 0]),
          intro: 'Все жёлтые в автобусе, он у самого парка.',
          steps: [roll(0, 5, 'Вести некого — кубик не нужен, но бросить положено.'), drive(0, 'Автобус сворачивает в жёлтый парк — победа!')],
        },
      },
    ],
  },
};
