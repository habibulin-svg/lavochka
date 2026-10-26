/* «Полёт» — описание игры. Советская настольная игра: плакат-карта с маршрутом самолёта, пульт со стрелкой и кольцами
 * высоты, скорости, курса и хода, три самолётика. Правила — брошюра (стр. 8–11); материалы и решения —
 * docs/analysis/materials-polet.md. */
import type { GameDef, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, makeView, MAX_TURNS, newState, setup, toAct, type Action, type Event, type State } from './engine';
import { LEGS } from './map';

export const SEATS = [
  { name: 'Красный', color: '#d8322a', light: '#ff7a6a', dark: '#6a0a04' },
  { name: 'Синий', color: '#2a62d8', light: '#7aa2ff', dark: '#0a2a6a' },
  { name: 'Зелёный', color: '#2a9a3a', light: '#7ad88a', dark: '#0a4a14' },
];

const EFFECT: Record<string, string> = {
  delay: 'задержка рейса из-за погоды — назад на старт',
  belts: 'пассажиры не пристегнули ремни — пропуск хода',
  storm: 'впереди грозовой фронт — обход',
  ice: 'сильное обледенение — смена высоты, обход',
  closed: 'аэропорт назначения закрыт — на запасной',
  spare: 'посадка на запасном аэродроме',
  hold: 'команда диспетчера — в зону ожидания',
  circle: 'не выпущено шасси — на второй круг',
  wind: 'сильный попутный ветер — ещё 4 точки',
};
const WHY: Record<string, string> = { takeoff: 'взлёт', landing: 'посадка', task: 'задание' };

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'spin') {
    if (ev.why === 'move') return ev.ok ? `${name(ev.seat)}: ход — ${ev.value}.` : null;
    return `${name(ev.seat)}: ${WHY[ev.why ?? 'task']} — ${ev.ok ? 'разрешено ✔' : 'не вышло'}.`;
  }
  if (ev.type === 'move') return EFFECT[ev.effect] ? `${name(ev.seat)}: ${EFFECT[ev.effect]}.` : ev.effect === 'landed' ? `🛬 ${name(ev.seat)}: посадка в аэропорту назначения!` : null;
  if (ev.type === 'answer') return ev.ok ? `${name(ev.seat)}: верно!` : `${name(ev.seat)}: ошибка (верно — ${ev.right}), пропуск хода.`;
  if (ev.type === 'skip') return `${name(ev.seat)} пропускает ход.`;
  if (ev.type === 'end') return `🏁 ${name(ev.winner)} первым долетел до точки 27!`;
  return null;
}

const demoSeats: SeatSpec[] = [
  { seat: 0, kind: 'bot', name: 'Вовка', level: 2 },
  { seat: 1, kind: 'bot', name: 'Серёга', level: 2 },
];
/** Стрелка встанет на угол a (rng.int(3600) / 10). */
const Spin = (seat: number, a: number, caption?: string) => ({ seat, action: { type: 'spin' } as Action, rig: [a * 10], caption });
const Move = (seat: number, caption?: string) => ({ seat, action: { type: 'move' } as Action, caption });

/** Самолёт места 0 на точке участка main с номером k в списке; задание — need. */
function at(i: number, need: State['planes'][0]['need'] = null, leg = 'main'): State {
  const s = newState(2);
  s.planes[0] = { ...s.planes[0], leg, i, need };
  s.planes[1] = { ...s.planes[1], need: 'takeoff' };
  return s;
}

export const def: GameDef<State, Action, Event, State> = {
  id: 'polet',
  title: 'Полёт',
  players: { min: 1, max: 3, default: 2 },
  seats: SEATS,
  setup: (seats, opts) => setup(opts, seats.length),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  result(s) {
    if (s.phase !== 'over' || s.winner == null) return null;
    return { winners: [s.winner], text: s.turns >= MAX_TURNS ? 'дальше всех по маршруту' : 'первым приземлился в аэропорту назначения' };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose },
  describe,

  showcase: () => {
    const s = newState(3);
    s.planes[0] = { ...s.planes[0], leg: 'main', i: 17, need: null };
    s.planes[1] = { ...s.planes[1], leg: 'main', i: 9, need: null };
    s.planes[2] = { ...s.planes[2], leg: 'main', i: 34, need: null };
    s.angle = 300;
    return s;
  },

  rules: {
    goal: 'Первым довести свой самолёт до аэропорта назначения — точки 27, выполнив по дороге все команды: курс, высоту, скорость, взлёт и посадку.',
    sections: [
      {
        title: 'Поле и пульт',
        html: `<p>На карте — маршрут: широкая оранжевая линия с цветными и чёрными точками, тонкая — обходные пути. На пульте одна стрелка
          и кольца: внутреннее жёлтое — <b>ход</b> (1, 2, 3 или 4 точки) и сектора «Взлёт разрешён» и «Посадка разрешена»; зелёное —
          <b>курс</b>, красное — <b>скорость</b>, голубое — <b>высота</b>. Играют от одного до трёх.</p>`,
      },
      {
        title: 'Взлёт и полёт',
        html: `<p>Самолёты стоят в аэропорту вылета (точка 1). Сначала — разрешение на взлёт: в свою очередь крутят стрелку, пока она не
          встанет в секторе «Взлёт разрешён», — и сразу летят. Дальше крутят стрелку и переставляют самолёт на столько точек, сколько
          показало кольцо «Ход» (точки считаются все — и цветные, и чёрные).</p>`,
        demo: {
          seats: demoSeats,
          setup: () => at(0, 'takeoff'),
          steps: [Spin(0, 10, 'Стрелка в секторе «Взлёт разрешён» — взлёт!'), Spin(0, 250, 'Сразу ход: на кольце «Ход» — 3.'), Move(0, 'Самолёт перелетает на три точки — и попадает на точку 3: пассажиры не пристегнули ремни, пропуск хода.')],
        },
      },
      {
        title: 'Курс, высота, скорость',
        html: `<p><b>Красные</b> точки 4, 9, 13, 17 — смена курса, <b>голубые</b> 5, 15, 22, 24 — высота, <b>фиолетовые</b> 8, 11, 18, 25 —
          скорость. Долетев до такой точки, самолёт останавливается и сразу делает попытку: стрелка должна встать в секторе с нужным
          значением. Получилось — сразу ещё ход, не дожидаясь очереди; нет — пробуете в следующий раз.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => at(3),
          steps: [Spin(0, 70, 'Ход — 2, но точка 4 ближе: дальше неё не пролететь.'), Move(0, 'Точка 4 — «Возьмите курс 97°».'), Spin(0, 110, 'Стрелка на 97° — курс взят, сразу ещё ход.')],
        },
      },
      {
        title: 'Вопросы',
        html: `<p><b>Жёлтые</b> точки 6, 12, 20 — вопросы: назвать аварийно-спасательные средства по пиктограммам (на суше и на воде) и
          сигнал, который передают пассажирам перед снижением. Ответил верно — сразу ещё ход, ошибся — пропуск хода «для изучения
          ошибки».</p>`,
      },
      {
        title: 'Белые точки',
        html: `<p>2 — задержка рейса, назад на старт; 3 — пропуск хода; 7 — обойти грозовой фронт; 10 — попутный ветер, ещё 4 точки;
          14 — обледенение, сменить высоту по обходу; 16 — аэропорт назначения закрыт: лететь на запасной (19), там снова получить
          разрешение на взлёт и вернуться; 21 — зона ожидания до «Посадка разрешена» на точке 23; 26 — не выпущено шасси, второй круг.
          Срабатывают, только если самолёт остановился на них.</p>`,
      },
      {
        title: 'Победа',
        html: `<p>Побеждает тот, кто первым долетит до точки 27 — аэропорта назначения. Если партия затянулась на ${MAX_TURNS} кругов, побеждает
          тот, кто дальше по маршруту (это наше правило).</p>`,
        demo: {
          seats: demoSeats,
          setup: () => at(LEGS.main.pts.length - 3),
          steps: [Spin(0, 70, 'Ход — 2, а до точки 27 как раз две точки.'), Move(0, 'Посадка в аэропорту назначения — победа!')],
        },
      },
    ],
  },
};
