/* «Морская игра» — описание игры. Вариант с броненосцами, минами и береговой артиллерией (описание из docx пользователя)
 * на поле советской «Морской игры» (фото 1001.jpg). Материалы и решения — docs/analysis/materials-morskaya.md. */
import type { GameDef, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { ACC, apply, at, cfgFrom, newState, QUIET, setup, toAct, type Action, type Event, type Kind, type State } from './engine';

export const SEATS = [
  { name: 'Зелёные', color: '#1c9b82', light: '#6ad2bc', dark: '#0a4a3c' },
  { name: 'Красные', color: '#e2432d', light: '#ff8a76', dark: '#7a1408' },
];

const WHY: Record<string, string> = { fleet: 'флот соперника потоплен', quiet: `${QUIET / 2} ходов без потоплений — по очкам` };

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'fwd') {
    let t = '';
    if (ev.took) t = `${name(ev.seat)}: потоплен ${ACC[ev.took.kind]}!`;
    for (const r of ev.rolls) t += ` ${r.what === 'mine' ? 'Мина' : 'Береговые пушки'}: ${r.boom ? '💥 взрыв' : 'мимо'}.`;
    if (ev.sunk) t += ' Корабль потоплен.';
    return t ? t.trim() : null;
  }
  if (ev.type === 'mine') return `${name(ev.seat)}: тральщик ${ev.put ? 'ставит' : 'снимает'} мину.`;
  if (ev.type === 'end') return ev.winner == null ? `🏁 Ничья: ${WHY[ev.why]}.` : `🏁 Победа — ${name(ev.winner)}: ${WHY[ev.why]}!`;
  return null;
}

const demoSeats: SeatSpec[] = [
  { seat: 0, kind: 'bot', name: 'Вовка', level: 1 },
  { seat: 1, kind: 'bot', name: 'Серёга', level: 1 },
];

/** Позиция: корабли [сторона, класс, столбец, ряд, курс 0–3 (С, В, Ю, З)]. */
function pos(list: [number, Kind, number, number, number][], turn = 0): State {
  const s = newState(cfgFrom({}));
  s.ships = list.map(([side, kind, c, r, dir], id) => ({ id, side, kind, p: at(c, r), dir }));
  s.turn = turn;
  return s;
}
const Fwd = (seat: number, id: number, caption?: string, rig?: number[]) => ({ seat, action: { type: 'fwd', id } as Action, caption, rig });
const Turn = (seat: number, id: number, d: 'l' | 'r', caption?: string) => ({ seat, action: { type: 'turn', id, d } as Action, caption });

export const def: GameDef<State, Action, Event, State> = {
  id: 'morskaya',
  title: 'Морская игра',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'faces',
      label: '«Взрыв» на кубике',
      type: 'select',
      choices: [
        { value: 1, label: 'одна грань из шести — мины и пушки редко топят' },
        { value: 2, label: 'две грани из шести' },
        { value: 3, label: 'три грани — каждый второй бросок' },
      ],
      default: 2,
    },
  ],
  presets: [
    { id: 'box', label: 'Обычная', hint: '«Взрыв» — две грани кубика из шести', options: { faces: 2 } },
    { id: 'soft', label: 'Тихое море', hint: 'Мины и береговые пушки топят реже — одна грань', options: { faces: 1 } },
    { id: 'hard', label: 'Минное поле', hint: 'Каждый второй бросок — «взрыв»', options: { faces: 3 } },
  ],

  setup: (_seats, opts) => setup(opts),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s) => s,
  result(s) {
    if (!s.over) return null;
    if (s.winner == null) return { winners: [], text: WHY[s.why] };
    return { winners: [s.winner], text: WHY[s.why] };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose },
  describe,

  showcase: () => {
    let s = setup({});
    const rng = { n: 11, next() { this.n = (this.n * 1103515245 + 12345) % 2147483648; return this.n / 2147483648; }, int(k: number) { return Math.floor(this.next() * k); }, getState() { return this.n; } };
    for (let i = 0; i < 36 && !s.over; i++) {
      const a = choose(s, s.turn, 1, rng);
      if (!a) break;
      const r = apply(s, s.turn, a, rng);
      if (!r || r.state.over) break;
      s = r.state;
    }
    return s;
  },

  rules: {
    goal: 'Потопить весь флот противника.',
    sections: [
      {
        title: 'Флот и расстановка',
        html: `<p>У каждого 12 кораблей: <b>1</b> — броненосец, <b>2</b> — два крейсера, <b>3</b> — три канонерки, <b>4</b> — четыре миноносца,
          <b>5</b> — тральщик, <b>6</b> — подводная лодка. Они стоят у своего берега на кружках с этими цифрами, носом к противнику.
          Углы поля — суша, через неё не ходят.</p>`,
      },
      {
        title: 'Как ходят',
        html: `<p>За ход двигают <b>один</b> корабль: носом вперёд на соседний кружок — или поворачивают нос вправо или влево (это тоже ход;
          разворот кругом — два хода). Пятиться кормой и идти бортом нельзя. Скорость у всех одинаковая.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => newState(cfgFrom({})),
          steps: [Fwd(0, 11, 'Канонерка — на кружок вперёд.'), Fwd(1, 23, 'Красные отвечают.'), Turn(0, 9, 'l', 'Броненосец поворачивает нос — это тоже ход.')],
        },
      },
      {
        title: 'Бой',
        html: `<p>Корабль бьёт, выйдя на кружок корабля противника, и встаёт на его место. <b>Старший</b> бьёт младшего в борт и в нос, <b>равные</b>
          — только в борт, <b>младший</b> старшего — тоже только в борт. <b>В корму</b> не бьёт никто. Бить не обязательно.</p>
          <p>Старшинство: броненосец, крейсер, канонерка, миноносец, тральщик. <b>Подводная лодка</b> старше броненосца и крейсера, но младше остальных.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos([
              [0, 'cr', 4, 4, 1],
              [1, 'dd', 5, 4, 0],
              [1, 'bb', 7, 4, 3],
              [0, 'ss', 3, 6, 1],
              [1, 'cr', 5, 6, 3],
            ]),
          steps: [
            Fwd(0, 0, 'Крейсер бьёт миноносец в борт — потоплен.'),
            Fwd(1, 2, 'Броненосец подходит…'),
            Fwd(0, 3, 'Подлодка идёт навстречу крейсеру…'),
            Fwd(1, 2, '…броненосец идёт на крейсер в нос: он старше — потопил.'),
            Fwd(0, 3, 'Подлодка бьёт крейсер в нос — она старше крейсера!'),
          ],
        },
      },
      {
        title: 'Мины и береговые пушки',
        html: `<p><b>Тральщик</b> ставит и снимает мины на своём кружке — это не ход; у каждого три мины. Корабль (кроме тральщика и подлодки),
          зашедший на кружок с миной, бросает кубик: «взрыв» — потоплен, мина остаётся. Кружки со «взрывом» у берегов — под огнём
          береговых пушек: туда зашёл корабль противника (кроме подлодки) — бросок. Если на кружке и мина, и пушки, бросают дважды.
          Стоящий корабль не бросает — только зашедший.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos([
              [0, 'ms', 5, 3, 1],
              [1, 'gb', 7, 3, 3],
              [1, 'dd', 9, 7, 2],
            ]),
          steps: [
            { seat: 0, action: { type: 'mine', id: 0 } as Action, caption: 'Тральщик ставит мину — это не ход…' },
            Turn(0, 0, 'l', '…и поворачивает, чтобы уйти.'),
            Fwd(1, 1, 'Канонерка красных идёт вперёд.'),
            Fwd(0, 0, 'Тральщик ушёл с мины.'),
            Fwd(1, 1, 'Канонерка заходит на мину: бросок — «взрыв»!', [0]),
          ],
        },
      },
      {
        title: 'Победа',
        html: `<p>Побеждает тот, кто потопит весь флот противника. Если ${QUIET / 2} ходов подряд никого не потопили, считают по очкам: у кого
          больше кораблей (при равенстве — флот сильнее), тот и выиграл; пока ещё никого не потопили, ждём вдвое дольше (это наше правило —
          в описании конца без потоплений нет).</p>`,
      },
    ],
  },
};

