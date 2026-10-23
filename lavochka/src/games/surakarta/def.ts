/* Суракарта — описание игры: яванская игра на доске 6×6 с петлями по углам; берут, проезжая по кругу через петлю.
 * Одна партия до последней фишки или серия «на очки» (победителю партии — его оставшиеся фишки). */
import type { GameDef, Rng, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, at, cfgFrom, count, newState, RED, setup, step, toAct, WHITE, type Action, type Cfg, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Красные', color: '#c0281c', light: '#ff6a50', dark: '#6a0c06' },
  { name: 'Белые', color: '#efe6d2', light: '#fffaf0', dark: '#a8987a', ink: '#5a4a30' },
];

export function fishek(n: number): string {
  const m = n % 10;
  const t = n % 100;
  return `${n} ${m === 1 && t !== 11 ? 'фишка' : m >= 2 && m <= 4 && (t < 12 || t > 14) ? 'фишки' : 'фишек'}`;
}

export function ochkov(n: number): string {
  const m = n % 10;
  const t = n % 100;
  return `${n} ${m === 1 && t !== 11 ? 'очко' : m >= 2 && m <= 4 && (t < 12 || t > 14) ? 'очка' : 'очков'}`;
}

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'take') return `⚔️ ${name(ev.seat)}: взятие по ${ev.track.c ? 'большому' : 'малому'} кругу.`;
  if (ev.type === 'round') {
    const why = ev.why === 'quiet' ? 'долго без взятий — ' : ev.why === 'stuck' ? 'сопернику некуда ходить — ' : '';
    const who = ev.winner == null ? 'поровну, очков никому' : `партию взяли ${name(ev.winner)}: +${ochkov(ev.points)}`;
    return `🏁 ${why}${who}. Счёт ${ev.score[0]} : ${ev.score[1]}.`;
  }
  if (ev.type === 'end') {
    if (ev.why === 'match') return ev.winner == null ? '🏆 Серия кончилась вничью.' : `🏆 Серию выиграли ${name(ev.winner)}.`;
    if (ev.winner == null) return '🏁 Долго без взятий, фишек поровну — ничья.';
    if (ev.why === 'quiet') return `🏁 Долго без взятий — у кого больше фишек, тот и выиграл: ${name(ev.winner)}.`;
    if (ev.why === 'stuck') return `🏁 Сопернику некуда ходить — победа: ${name(ev.winner)}.`;
    return `🏁 Сняты все фишки соперника — победа: ${name(ev.winner)}.`;
  }
  return null;
}

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
/** Позиция: красные, белые, чей ход. */
function pos(red: [number, number][], white: [number, number][], turn = 0, cfg: Partial<Cfg> = {}): State {
  const s = newState({ ...cfgFrom({}), ...cfg });
  s.board.fill(0);
  for (const [x, y] of red) s.board[at(x, y)] = RED;
  for (const [x, y] of white) s.board[at(x, y)] = WHITE;
  s.turn = turn;
  s.ply = 2;
  return s;
}
const Mv = (seat: number, x: number, y: number, x2: number, y2: number, caption?: string) => ({ seat, action: { type: 'move', from: at(x, y), to: at(x2, y2) } as Action, caption });

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
  id: 'surakarta',
  title: 'Суракарта',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'games',
      label: 'Партий',
      hint: 'В серии победитель партии получает столько очков, сколько у него осталось фишек',
      type: 'select',
      choices: [
        { value: 1, label: 'одна — до последней фишки' },
        { value: 2, label: 'серия из 2 партий на очки' },
        { value: 4, label: 'серия из 4 партий на очки' },
        { value: 6, label: 'серия из 6 партий на очки' },
      ],
      default: 1,
    },
    {
      key: 'look',
      label: 'Вид',
      type: 'select',
      choices: [
        { value: 'wood', label: 'резной тик, семена саги и ракушки' },
        { value: 'batik', label: 'батик, медные и серебряные монетки' },
      ],
      default: 'wood',
    },
  ],
  presets: [
    { id: 'all', label: 'До последней фишки', hint: 'Одна партия: кто снимет все фишки соперника', options: { games: 1, look: 'wood' } },
    { id: 'score', label: 'На очки', hint: 'Серия из 4 партий: победитель партии получает свои оставшиеся фишки', options: { games: 4, look: 'batik' } },
  ],

  setup: (seats, opts) => setup(seats.map((x) => x.seat), opts),
  toAct,
  apply: (s, seat, a) => apply(s, seat, a),
  view: (s) => s,
  result(s) {
    if (!s.over) return null;
    const series = s.cfg.games > 1;
    const scores = series ? { 0: s.score[0], 1: s.score[1] } : { 0: count(s, 0), 1: count(s, 1) };
    if (s.winner == null) return { winners: [], text: 'ничья', scores };
    if (series) return { winners: [s.winner], text: `счёт ${s.score[s.winner]} : ${s.score[1 - s.winner]}`, scores };
    return { winners: [s.winner], text: `осталось ${fishek(count(s, s.winner))}`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    let s = newState(cfgFrom({}));
    const rng = fixedRng(7);
    for (let i = 0; i < 80 && s.ply < 16 && !s.over; i++) {
      const a = choose(s, s.turn, 1, rng);
      if (!a) break;
      s = step(s, a).state;
    }
    return s;
  },

  rules: {
    goal: 'Снять с доски все фишки соперника. В серии «на очки» — набрать больше очков за все партии.',
    sections: [
      {
        title: 'Доска и ход',
        html: `<p>Суракарта — игра с острова Ява, названа по городу Суракарта. Доска — <b>6×6 точек</b>, соединённых линиями,
          а по углам линии замкнуты <b>петлями</b>: вторые от края — малыми, третьи — большими. Так получаются два круга —
          <b>малый</b> и <b>большой</b>. У каждого по <b>12 фишек</b> в двух ближних рядах; первыми ходят <b>красные</b>
          (в серии — по очереди).</p>
          <p>Ход — на соседнюю <b>пустую</b> точку в любую сторону, <b>и по косой</b> тоже. Через фишки не прыгают.</p>`,
        demo: { seats: demoSeats, intro: 'Начальная расстановка.', steps: [Mv(0, 2, 4, 3, 3, 'Красная шагнула по косой.'), Mv(1, 3, 1, 3, 2, 'Белая — вперёд.')] },
      },
      {
        title: 'Взятие через петлю',
        html: `<p>Брать можно только <b>проездом по кругу</b>: фишка едет по линии своего круга, проходит <b>хотя бы одну петлю</b>
          и встаёт на место первой встреченной чужой фишки — та снимается. Пустых точек по пути — сколько угодно,
          и до петли, и после; одну и ту же точку можно проехать дважды.</p>
          <p>Нажмите на свою фишку — фишки соперника, которые она может взять, подсветятся красным.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos(
              [
                [3, 1],
                [0, 5],
              ],
              [
                [4, 2],
                [5, 5],
                [0, 0],
              ]
            ),
          intro: 'Красная стоит на малом круге.',
          steps: [Mv(0, 3, 1, 4, 2, 'Вправо по линии, через малую петлю — и вниз: белая снята.')],
        },
      },
      {
        title: 'Без петли не берут',
        html: `<p>Чужая фишка прямо впереди по линии, без петли, — <b>не под боем</b>. Зато к ней же или к другой можно
          подъехать с другой стороны круга. Путь должен быть <b>пустым</b>: любая фишка на дороге, своя или чужая,
          его закрывает.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos(
              [
                [1, 3],
                [5, 5],
              ],
              [
                [1, 1],
                [4, 4],
                [0, 0],
              ]
            ),
          intro: 'Верхняя белая — прямо впереди по линии, но без петли её не взять.',
          steps: [Mv(0, 1, 3, 4, 4, 'Вниз, через малую петлю — и вправо по линии: снята другая белая.')],
        },
      },
      {
        title: 'Большой круг и своя точка',
        html: `<p>Большой круг — по третьим линиям, с большими петлями. Фишка может проехать и через ту точку,
          <b>откуда сама вышла</b>, — она уже пуста. Можно пройти и несколько петель подряд.</p>
          <p>Брать <b>не обязательно</b>: вместо взятия можно просто шагнуть.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos(
              [
                [2, 2],
                [5, 5],
              ],
              [
                [2, 4],
                [0, 0],
              ]
            ),
          intro: 'Красная на большом круге, белая — ниже на той же линии.',
          steps: [Mv(0, 2, 2, 2, 4, 'Влево, через большую петлю, вниз — сквозь свою же точку — и белая снята.')],
        },
      },
      {
        title: 'Конец партии',
        html: `<p>Выигрывает тот, кто <b>снял все фишки</b> соперника (или запер их так, что ходить некуда).
          Если восемьдесят полуходов подряд никто никого не взял, партия кончается: побеждает тот, у кого <b>больше фишек</b>,
          поровну — ничья.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos(
              [
                [3, 1],
                [0, 5],
              ],
              [[4, 2]]
            ),
          intro: 'У белых осталась одна фишка.',
          steps: [Mv(0, 3, 1, 4, 2, 'Последняя белая снята — победа красных.')],
        },
      },
      {
        title: 'Серия на очки',
        html: `<p>По старому обычаю играют <b>несколько партий</b>. Победитель партии получает столько <b>очков</b>,
          сколько у него осталось фишек; первым ходит по очереди то один, то другой. После всех партий побеждает
          больший счёт.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos(
              [
                [3, 1],
                [0, 5],
                [5, 5],
              ],
              [[4, 2]],
              0,
              { games: 2 }
            ),
          intro: 'Серия из двух партий: у красных три фишки, у белых одна.',
          steps: [Mv(0, 3, 1, 4, 2, 'Красные взяли партию: +3 очка. Новая партия — первыми ходят белые.'), Mv(1, 2, 1, 2, 2)],
        },
      },
    ],
  },
};
