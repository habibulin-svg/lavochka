/* Фидхел — описание: реконструкции на доске 7×7 — Ард-Ри (король уходит на край), Ланнах (король ходит по шагу и уходит
 * в угол) и «Равные силы» без короля. Оформление: доска из Баллиндерри с лунками и колышками или резная доска с клетками;
 * по кайме — кельтская плетёнка, в углах — узлы; фишки — бронзовые с трискелем и костяные с глазками, король — золотой. */
import type { GameDef, Options, Rng, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, at, BONE, BRONZE, cfgFrom, KING, newState, RULES, setup, step, toAct, type Action, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Бронза', color: '#b0702a', light: '#e0a050', dark: '#5a3410' },
  {
    name: 'Кость',
    color: '#ece0c4',
    light: '#fbf4e2',
    dark: '#b8a47c',
    ink: '#6a5430',
  },
];

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'move' && ev.taken.length) return `${name(ev.seat)}: взято фишек — ${ev.taken.length}.`;
  if (ev.type === 'end') {
    if (ev.why === 'escape') return `🏁 Король ушёл — победа: ${name(1)}.`;
    if (ev.why === 'king') return `🏁 Король окружён — победа: ${name(0)}.`;
    if (ev.why === 'stuck') return `🏁 Сопернику некуда ходить — победа: ${name(ev.winner!)}.`;
    if (ev.why === 'one') return `🏁 У соперника осталась одна фишка — победа: ${name(ev.winner!)}.`;
    return ev.winner == null ? '🏁 Двести ходов без исхода — ничья.' : `🏁 Двести ходов — у кого больше фишек, тот и победил: ${name(ev.winner)}.`;
  }
  return null;
}

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({
  seat,
  kind: 'bot',
  name: SEATS[seat].name,
  level: 1,
}));
type XY = [number, number];
function pos(bronze: XY[], bone: XY[], king: XY | null, turn: number, o: Options = {}): State {
  const s = newState(cfgFrom(o));
  s.board.fill(0);
  for (const [x, y] of bronze) s.board[at(x, y)] = BRONZE;
  for (const [x, y] of bone) s.board[at(x, y)] = BONE;
  if (king) s.board[at(king[0], king[1])] = KING;
  s.turn = turn;
  return s;
}
const Mv = (seat: number, x: number, y: number, x2: number, y2: number, caption?: string) => ({
  seat,
  action: { type: 'move', from: at(x, y), to: at(x2, y2) } as Action,
  caption,
});

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
  id: 'fidchell',
  title: 'Фидхел',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'kind',
      label: 'Правила',
      type: 'select',
      choices: [
        { value: 'ardri', label: 'Ард-Ри: король уходит на край' },
        { value: 'lannach', label: 'Ланнах: король по шагу, в угол' },
        { value: 'equal', label: 'равные силы, без короля' },
      ],
      default: 'ardri',
    },
    {
      key: 'look',
      label: 'Доска',
      type: 'select',
      choices: [
        { value: 'ballinderry', label: 'с лунками и колышками (Баллиндерри)' },
        { value: 'carved', label: 'резная, с клетками' },
      ],
      default: 'ballinderry',
    },
  ],
  presets: [
    {
      id: 'ardri',
      label: 'Ард-Ри',
      hint: '«Верховный король»: 16 бронзовых против короля и 8 костяных, король уходит на любой край',
      options: { kind: 'ardri', look: 'ballinderry' },
    },
    {
      id: 'lannach',
      label: 'Ланнах',
      hint: 'Король ходит лишь на одну клетку и уходит в угол — медленно, но верно',
      options: { kind: 'lannach', look: 'carved' },
    },
    {
      id: 'equal',
      label: 'Равные силы',
      hint: 'Без короля, по 8 фишек: кто оставит соперника с одной фишкой',
      options: { kind: 'equal', look: 'carved' },
    },
  ],

  setup: (seats, opts) =>
    setup(
      seats.map((x) => x.seat),
      opts,
    ),
  toAct,
  apply: (s, seat, a) => apply(s, seat, a),
  view: (s) => s,
  result(s) {
    if (!s.over) return null;
    if (s.winner == null) return { winners: [], text: 'ничья' };
    if (!RULES[s.cfg.kind].king) return { winners: [s.winner], text: 'войско разбито' };
    return {
      winners: [s.winner],
      text: s.winner === 1 ? 'король ушёл' : 'король взят',
    };
  },
  bot: {
    levels: ['Лёгкий', 'Средний', 'Сложный'],
    choose: (v, seat, lv, rng) => choose(v, seat, lv, rng),
  },
  describe,

  showcase: () => {
    let s = newState(cfgFrom({}));
    const rng = fixedRng(5);
    for (let i = 0; i < 9 && !s.over; i++) {
      const a = choose(s, s.turn, 0, rng);
      if (!a) break;
      s = step(s, a).state;
    }
    return s;
  },

  rules: {
    goal: 'Кости — увести короля из центра на край доски. Бронзе — окружить короля.',
    sections: [
      {
        title: 'Доска и фишки',
        html: `<p>Фидхел («деревянная мудрость») — игра ирландских королей и героев саг. Подлинных правил не сохранилось,
          играем по реконструкции <b>Ард-Ри</b> («верховный король») на доске 7×7 — такую, с 49 лунками для колышков,
          нашли в Баллиндерри. В центре, на троне, стоит <b>король</b> и восемь <b>костяных</b> фишек, по краям — шестнадцать <b>бронзовых</b>.</p>
          <p>Первой ходит бронза. Любая фишка ходит как ладья: по прямой на сколько угодно свободных клеток, не перепрыгивая.
          На трон встаёт только король; через пустой трон проходить можно.</p>`,
        demo: {
          seats: demoSeats,
          intro: 'Начальная расстановка Ард-Ри.',
          steps: [Mv(0, 2, 0, 2, 1, 'Бронза выходит из строя.'), Mv(1, 4, 4, 5, 4, 'Костяная фишка отходит в сторону.')],
        },
      },
      {
        title: 'Взятие в клещи',
        html: `<p>Фишку берут, <b>зажав с двух сторон</b> по прямой: ходом ставите свою фишку так, чтобы чужая оказалась между ней
          и другой вашей. Вместо второй фишки годится пустой трон. Король тоже помогает брать, а сам в клещи не попадает.
          Самому вставать между двумя чужими фишками можно — так не берут.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos(
              [
                [1, 1],
                [5, 1],
                [6, 6],
              ],
              [
                [2, 1],
                [2, 3],
                [0, 6],
              ],
              [3, 5],
              0,
            ),
          intro: 'Костяная фишка стоит рядом с бронзовой.',
          steps: [Mv(0, 5, 1, 3, 1, 'Клещи — фишка снята.'), Mv(1, 0, 6, 0, 5), Mv(0, 1, 1, 1, 3, 'Клещи с пустым троном — снята и вторая.')],
        },
      },
      {
        title: 'Король уходит',
        html: `<p>Кость выигрывает, когда король доходит до <b>любой клетки края</b>. Король, у которого открыты два пути к краю сразу, уже не остановить.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos(
              [
                [3, 0],
                [1, 5],
                [5, 1],
              ],
              [[2, 4]],
              [3, 3],
              1,
            ),
          intro: 'Король на троне, путь вправо свободен.',
          steps: [Mv(1, 3, 3, 6, 3, 'Король на краю — победа кости.')],
        },
      },
      {
        title: 'Как взять короля',
        html: `<p>Короля берут, окружив <b>с четырёх сторон</b>; рядом с троном хватит трёх бронзовых — пустой трон за четвёртую.</p>
          <p>Проигрывает и тот, кому некуда ходить. Двести ходов без исхода — ничья.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos(
              [
                [2, 2],
                [4, 2],
                [3, 0],
              ],
              [[6, 6]],
              [3, 2],
              0,
            ),
          intro: 'Король рядом с троном, с боков — бронза.',
          steps: [Mv(0, 3, 0, 3, 1, 'Сверху бронза, снизу пустой трон — король взят.')],
        },
      },
      {
        title: 'Ланнах',
        html: `<p>В <b>Ланнахе</b> король ходит <b>только на одну клетку</b> и уходит не на край, а <b>в угол</b>.
          Углы, как и трон, — только для короля и враждебны всем: угол годится вместо второй фишки клещей.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos(
              [
                [3, 0],
                [4, 4],
                [0, 4],
              ],
              [[1, 3]],
              [1, 1],
              0,
              { kind: 'lannach' },
            ),
          intro: 'Король в шаге от угла.',
          steps: [Mv(0, 3, 0, 1, 0, 'Бронза закрывает угол сверху…'), Mv(1, 1, 1, 0, 1, '…но король шагает влево.'), Mv(0, 0, 4, 0, 2), Mv(1, 0, 1, 0, 0, 'Угол — победа кости.')],
        },
      },
      {
        title: 'Равные силы',
        html: `<p>Учёные спорят, был ли в фидхеле король: в сагах о нём не сказано, а силы сторон названы равными. В варианте
          <b>«Равные силы»</b> у каждого по восемь фишек — ряд у своего края и одна впереди. Ход и клещи — те же.
          Проигрывает тот, у кого осталась <b>одна фишка</b> или некуда ходить; через двести ходов побеждает тот, у кого фишек больше.</p>`,
        demo: {
          seats: demoSeats,
          options: { kind: 'equal' },
          intro: 'По восемь фишек у бронзы и кости.',
          steps: [Mv(0, 3, 5, 3, 2, 'Бронза выдвигает передовую фишку.'), Mv(1, 4, 0, 4, 2, 'Кость подходит справа.'), Mv(0, 0, 6, 0, 3), Mv(1, 2, 0, 2, 2, 'Клещи — передовая фишка снята.')],
        },
      },
    ],
  },
};
