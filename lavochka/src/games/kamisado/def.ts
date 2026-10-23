/* Камисадо — описание игры: доска 8×8 из восьми цветов, ходят башнями; цвет клетки, куда встала башня, решает,
 * какой башней пойдёт соперник. Один раунд или серия до 3/7/15 очков с сумо-башнями. */
import type { GameDef, Rng, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, at, CELL, COLOR_GEN, cfgFrom, newState, RANK_RU, setup, step, toAct, towerId, type Action, type Cfg, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Чёрные', color: '#1c1a1e', light: '#5a5560', dark: '#000000' },
  { name: 'Золотые', color: '#d8a83a', light: '#ffe08a', dark: '#7a5810', ink: '#3a2a08' },
];

export function ochkov(n: number): string {
  const m = n % 10;
  const t = n % 100;
  return `${n} ${m === 1 && t !== 11 ? 'очко' : m >= 2 && m <= 4 && (t < 12 || t > 14) ? 'очка' : 'очков'}`;
}

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'push') return `💥 ${name(ev.seat)}: сумо толкает ${ev.pushed.length > 1 ? `${ev.pushed.length} башни` : 'башню'} — соперник пропускает ход.`;
  if (ev.type === 'pass') return `⛔ ${name(ev.seat)}: башне некуда идти — ход на месте; дальше — башня ${COLOR_GEN[CELL[ev.at]]} цвета.`;
  if (ev.type === 'round') {
    if (ev.why === 'deadlock') return `🔒 Тупик: обе стороны заперты — виноват последний ходивший. Раунд взяли ${name(ev.winner)}: +1. Счёт ${ev.score[0]} : ${ev.score[1]}.`;
    const who = ev.rank ? `${RANK_RU[ev.rank]} ` : 'башня ';
    return `🏁 ${name(ev.winner)}: ${who}дошла до чужого ряда — +${ochkov(ev.points)}. Счёт ${ev.score[0]} : ${ev.score[1]}.`;
  }
  if (ev.type === 'fill') return `↔️ ${name(ev.seat)}: новый раунд, расстановка ${ev.side === 'right' ? 'справа' : 'слева'}.`;
  if (ev.type === 'end') return `🏆 Победа: ${name(ev.winner)}.`;
  return null;
}

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
/** Башня в показе: место, цвет, x, y, ранг сумо. */
type T = [number, number, number, number, number?];
/** Позиция: башни, кто ходит, обязательный цвет (−1 — любой), цель серии. */
function pos(towers: T[], turn = 0, forced = -1, cfg: Partial<Cfg> = {}): State {
  const s = newState({ ...cfgFrom({}), ...cfg });
  s.board.fill(-1);
  for (const [seat, c, x, y, r] of towers) {
    s.board[at(x, y)] = towerId(seat, c);
    s.rank[towerId(seat, c)] = r ?? 0;
  }
  s.turn = turn;
  s.forced = forced;
  s.ply = 2;
  return s;
}
const Mv = (seat: number, x: number, y: number, x2: number, y2: number, caption?: string) => ({ seat, action: { type: 'move', from: at(x, y), to: at(x2, y2) } as Action, caption });
const cl = (x: number, y: number) => CELL[at(x, y)];

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
  id: 'kamisado',
  title: 'Камисадо',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'target',
      label: 'Игра',
      hint: 'В серии башня-победитель становится сумо: ходит короче, зато толкает и приносит больше очков',
      type: 'select',
      choices: [
        { value: 1, label: 'один раунд' },
        { value: 3, label: 'серия до 3 очков' },
        { value: 7, label: 'серия до 7 очков' },
        { value: 15, label: 'марафон до 15 очков' },
      ],
      default: 1,
    },
    {
      key: 'look',
      label: 'Вид',
      type: 'select',
      choices: [
        { value: 'lacquer', label: 'лаковая доска, чёрные и золотые башни' },
        { value: 'paper', label: 'светлое дерево и рисовая бумага' },
      ],
      default: 'lacquer',
    },
  ],
  presets: [
    { id: 'single', label: 'Один раунд', hint: 'Кто первым доведёт башню до чужого ряда', options: { target: 1, look: 'lacquer' } },
    { id: 'standard', label: 'До 3 очков', hint: 'Серия раундов с сумо-башнями', options: { target: 3, look: 'lacquer' } },
    { id: 'long', label: 'До 7 очков', hint: 'Длинная серия: двойные сумо', options: { target: 7, look: 'paper' } },
    { id: 'marathon', label: 'До 15 очков', hint: 'Марафон: до тройных и четверных сумо', options: { target: 15, look: 'lacquer' } },
  ],

  setup: (seats, opts) => setup(seats.map((x) => x.seat), opts),
  toAct,
  apply: (s, seat, a) => apply(s, seat, a),
  view: (s) => s,
  result(s) {
    if (!s.over || s.winner == null) return null;
    const scores = { 0: s.score[0], 1: s.score[1] };
    return { winners: [s.winner], text: s.cfg.target > 1 ? `счёт ${s.score[s.winner]} : ${s.score[1 - s.winner]}` : 'башня дошла до чужого ряда', scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    let s = newState(cfgFrom({ target: 3 }));
    const rng = fixedRng(11);
    for (let i = 0; i < 40 && s.ply < 9 && !s.over; i++) {
      const a = choose(s, s.turn, 1, rng);
      if (!a || s.phase !== 'move') break;
      s = step(s, a).state;
    }
    s.rank[towerId(1, 3)] = 1;
    return s;
  },

  rules: {
    goal: 'Первым довести любую свою башню до первого ряда соперника. В серии — набрать нужное число очков.',
    sections: [
      {
        title: 'Доска и ход башни',
        html: `<p>Доска — <b>8×8 клеток восьми цветов</b>: в каждом ряду и столбце все восемь по разу. У каждого игрока
          <b>8 башен</b> — тех же цветов, что клетки его первого ряда, где они и стоят. Первыми ходят <b>чёрные</b> (снизу).</p>
          <p>Башня ходит <b>только вперёд</b> — прямо или по косой — на <b>любое число пустых клеток</b>. Перепрыгивать
          через башни нельзя, брать — тоже: никого не снимают.</p>`,
        demo: { seats: demoSeats, intro: 'Начальная расстановка. Первый ход — любой башней.', steps: [Mv(0, 4, 7, 4, 3, 'Розовая чёрная прошла прямо четыре клетки и встала на коричневую.')] },
      },
      {
        title: 'Цвет клетки решает',
        html: `<p>Главное правило: <b>после первого хода выбирать башню нельзя</b>. Соперник обязан пойти башней
          <b>того цвета, на клетку которого встала ваша башня</b>. Так что, выбирая клетку, вы выбираете и его ход —
          стоит думать, куда тогда сможет добраться его башня.</p>`,
        demo: {
          seats: demoSeats,
          intro: 'Чёрная встала на коричневую клетку — золотые обязаны ходить коричневой башней.',
          setup: () => {
            const s = newState(cfgFrom({}));
            return step(s, { type: 'move', from: at(4, 7), to: at(4, 3) }).state;
          },
          steps: [Mv(1, 7, 0, 7, 4, 'Коричневая золотая встала на розовую — теперь чёрные ходят розовой.'), Mv(0, 4, 3, 3, 2, 'Розовая шагнула по косой на красную клетку: очередь красной золотой.')],
        },
      },
      {
        title: 'Некуда идти — ход на месте',
        html: `<p>Если обязательная башня <b>заперта</b> (впереди и по обеим косым вплотную стоят башни или край), её хозяин
          пропускает ход: башня как бы «ходит на месте». Тогда соперник ходит башней <b>цвета клетки под запертой башней</b>.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos(
              [
                [1, cl(5, 4), 0, 0],
                [0, 2, 0, 1],
                [0, 3, 1, 1],
                [0, cl(0, 0), 5, 6],
                [1, cl(5, 2), 7, 0],
              ],
              0,
              cl(0, 0)
            ),
          intro: 'Чёрная встанет на клетку того же цвета, что и запертая в углу золотая башня.',
          steps: [Mv(0, 5, 6, 5, 4, 'Золотой башне некуда идти — ход на месте. Под ней оранжевая клетка — и чёрные снова ходят, оранжевой.'), Mv(0, 5, 4, 5, 2)],
        },
      },
      {
        title: 'Тупик',
        html: `<p>Бывает, что заперты обе нужные башни и ходы «на месте» идут по кругу. Это <b>тупик</b>: раунд проигрывает
          тот, <b>чей ход к нему привёл</b> — последний, кто по-настоящему двигал башню.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos([
              [1, cl(0, 4), 0, 3],
              [1, 2, 1, 3],
              [0, cl(0, 3), 0, 4],
              [0, 6, 1, 4],
              [0, 0, 2, 6],
            ]),
          intro: 'Две пары башен уткнулись друг в друга.',
          steps: [Mv(0, 2, 6, 1, 5, 'Чёрные встали на жёлтую: жёлтая золотая заперта, под ней розовая — а розовая чёрная тоже заперта. Тупик, и вызвали его чёрные.')],
        },
      },
      {
        title: 'Победа в раунде',
        html: `<p>Раунд выигрывает тот, чья башня <b>первой встанет в первый ряд соперника</b> — на любую клетку. В игре
          «один раунд» на этом всё.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos(
              [
                [0, cl(2, 3), 3, 2],
                [1, 0, 0, 0],
                [1, 1, 6, 1],
              ],
              0,
              cl(2, 3)
            ),
          intro: 'Дорога к верхнему ряду свободна.',
          steps: [Mv(0, 3, 2, 3, 0, 'Чёрная башня в первом ряду золотых — победа.')],
        },
      },
      {
        title: 'Серия и сумо',
        html: `<p>В серии играют раунды до <b>3, 7 или 15 очков</b>. Башня-победитель становится <b>сумо</b> (на ней появляются
          зубцы), а следующая её победа стоит дороже: простая башня — <b>1 очко</b>, сумо — <b>3</b>, двойной сумо — <b>7</b>,
          тройной — <b>15</b>.</p>
          <p>После раунда победитель выбирает расстановку: <b>справа</b> или <b>слева</b>. Каждый ставит башни в свой первый ряд
          от этого края — сначала из ближних к дому рядов, в каждом ряду тоже от этого края. Первым ходит <b>проигравший</b>,
          любой башней.</p>`,
        demo: {
          seats: demoSeats,
          options: { target: 3 },
          setup: () => {
            const s = newState(cfgFrom({ target: 3 }));
            let t = step(s, { type: 'move', from: at(4, 7), to: at(4, 3) }).state;
            t = step(t, { type: 'move', from: at(7, 0), to: at(7, 4) }).state;
            return t;
          },
          intro: 'Серия до 3 очков. Чёрные ходят розовой — а угол, откуда ушла коричневая золотая, пуст.',
          steps: [Mv(0, 4, 3, 7, 0, 'Розовая ушла по косой в освободившийся угол — +1 очко, и она стала сумо.'), { seat: 0, action: { type: 'fill', side: 'right' } as Action, caption: 'Чёрные выбрали расстановку справа. Первыми ходят золотые.' }],
        },
      },
      {
        title: 'Сумо ходит короче и толкает',
        html: `<p>Сумо ходит не дальше <b>5 клеток</b>, двойной сумо — <b>3</b>, тройной — <b>1</b>. Зато сумо умеет <b>толкать</b>:
          если прямо впереди вплотную стоит чужая башня, а за ней пусто, он сдвигает её на клетку назад и встаёт на её место.
          Двойной сумо толкает до двух башен подряд, тройной — до трёх; сумо своего ранга и выше толкнуть нельзя.</p>
          <p>После толчка соперник <b>пропускает ход</b>, а толкнувший ходит ещё раз — башней цвета клетки, на которой
          теперь стоит сумо.</p>`,
        demo: {
          seats: demoSeats,
          options: { target: 7 },
          setup: () =>
            pos(
              [
                [0, 5, 4, 5, 1],
                [0, cl(4, 4), 6, 6],
                [1, 2, 4, 4],
                [1, 7, 0, 0],
              ],
              0,
              5,
              { target: 7 }
            ),
          intro: 'Красный сумо чёрных, прямо перед ним — золотая башня.',
          steps: [Mv(0, 4, 5, 4, 4, 'Толчок! Золотая отъехала назад, золотые пропускают ход.'), Mv(0, 6, 6, 6, 3, 'Сумо встал на оранжевую клетку — и чёрные ходят ещё раз, оранжевой.')],
        },
      },
    ],
  },
};
