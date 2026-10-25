/* «Идут танки» — описание игры. Советская настольная игра для младших школьников: поле-карта с дорогами, мостами и
 * пунктирными маршрутами авиации, по 4 танка, 2 самолёта, 3 ракетные установки и 5 мин у красных и зелёных, кубик «1:3».
 * Материалы и решения — docs/analysis/materials-tanki.md. */
import type { GameDef, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, cfgFrom, makeView, MAX_TURNS, newState, setup, toAct, type Action, type Event, type Mine, type State } from './engine';
import { cellOf, ROADS } from './map';

export const SEATS = [
  { name: 'Зелёные', color: '#2e8a3a', light: '#6cc87a', dark: '#124a1a' },
  { name: 'Красные', color: '#d42a1e', light: '#ff7464', dark: '#6a0a04' },
];

const WHY: Record<string, string> = {
  tanks: 'все танки соперника разбиты',
  count: 'больше танков дошло до цели',
  limit: `${MAX_TURNS} ходов — считаем, кто больше довёл`,
};
const MINE: Record<string, string> = { tr: '«Т-Р» — танк разбит', lp: '«Л-П» — лёгкое повреждение, пропуск хода', ns: '«Н-С» — не сработала' };

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'roll') return `${name(ev.seat)}: на кубике ${ev.value}.`;
  if (ev.type === 'lost') return `${name(ev.seat)}: «${ev.value}» некуда — бросок пропал.`;
  if (ev.type === 'reverse') return `${name(ev.seat)}: танк разворачивается.`;
  if (ev.type === 'move') {
    let t = `${name(ev.seat)}: танк проехал ${ev.path.length}`;
    if (ev.mine) t += ` — мина ${MINE[ev.mine.label]}`;
    if (ev.took != null) t += ' — 💥 танк соперника разбит';
    if (ev.both != null) t += ' — оба танка рухнули с моста';
    else if (ev.fell) t += ' — провалился на мосту, следующий ход пропускается';
    if (ev.done) t += ' — 🏁 дошёл до цели!';
    return t;
  }
  if (ev.type === 'fly') {
    const r = ev.label === 'hit' ? '«Ц-П»' : '«П»';
    return `✈ ${name(ev.seat)}: полёт над дугой, ракета — ${r}: ${ev.tank != null ? 'танк разбомблён' : 'танк цел'}${ev.shot ? ', самолёт сбит' : ', самолёт сел на другом аэродроме'}.`;
  }
  if (ev.type === 'swap') return `${name(ev.seat)} переставляет ракеты.`;
  if (ev.type === 'return') return `${name(ev.seat)}: разбитый танк снова в строю.`;
  if (ev.type === 'skip') return `${name(ev.seat)} вытаскивает танк из пролёта моста — ход пропущен.`;
  if (ev.type === 'end') return ev.winner == null ? `🏁 Ничья: ${WHY[ev.why]}.` : `🏁 Победа — ${name(ev.winner)}: ${WHY[ev.why]}!`;
  return null;
}

const demoSeats: SeatSpec[] = [
  { seat: 0, kind: 'bot', name: 'Вовка', level: 1 },
  { seat: 1, kind: 'bot', name: 'Серёга', level: 1 },
];

const fixedRng = { next: () => 0.5, int: () => 0, getState: () => 0 };
const C = cellOf;

/** Позиция: танки [место, клетка (имя), направление вверх(−1)/вниз(+1)]; первая подходящая дорога. */
function pos(list: [number, string, number][], mines: Mine[] = [], side = 0): State {
  const s = newState(cfgFrom({}), fixedRng);
  s.tanks = list.map(([sd, name, dir], i) => {
    const p = C(name);
    const road = ROADS.findIndex((r) => r.includes(p));
    return { id: sd * 10 + i, side: sd, p, road, dir, state: 'board', repair: false };
  });
  s.mines = mines;
  s.rockets = [
    ['hit', 'hit', 'miss'],
    ['hit', 'hit', 'miss'],
  ];
  s.side = side;
  s.phase = 'turn';
  s.rolls = s.tanks.filter((t) => t.side === side).length;
  s.left = [1, 2, 3, 4].slice(4 - s.rolls);
  return s;
}
const Roll = (v: number, caption?: string) => ({ seat: 0, action: { type: 'roll' } as Action, rig: [v - 1], caption });
const Go = (id: number, cells: string[], caption?: string) => ({ seat: 0, action: { type: 'move', id, path: cells.map(C) } as Action, caption });

export const def: GameDef<State, Action, Event, State> = {
  id: 'tanki',
  title: 'Идут танки',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'mode',
      label: 'Как едут танки',
      type: 'select',
      choices: [
        { value: 'dice', label: 'по кубику «1:3» — вариант 1' },
        { value: 'fixed', label: 'без кубика: на 1, 2, 3 и 4 кружка — вариант 2' },
      ],
      default: 'dice',
    },
  ],
  presets: [
    { id: 'dice', label: 'С кубиком', hint: 'Бросков — сколько танков на поле, каждый танк едет раз за ход', options: { mode: 'dice' } },
    { id: 'fixed', label: 'Без кубика', hint: 'Все танки едут сразу: на 1, 2, 3 и 4 кружка в любом порядке', options: { mode: 'fixed' } },
  ],

  setup: (_seats, opts, rng) => setup(opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  result(s) {
    if (s.phase !== 'over') return null;
    if (s.winner == null) return { winners: [], text: WHY[s.why] };
    return { winners: [s.winner], text: WHY[s.why] };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose },
  describe,

  showcase: () => {
    const rng = { n: 3, next() { this.n = (this.n * 1103515245 + 12345) % 2147483648; return this.n / 2147483648; }, int(k: number) { return Math.floor(this.next() * k); }, getState() { return this.n; } };
    let s = setup({}, rng);
    for (let i = 0; i < 60 && s.phase !== 'over'; i++) {
      const seat = toAct(s)[0];
      const a = choose(makeView(s, [seat]), seat, 1, rng);
      if (!a) break;
      const r = apply(s, seat, a, rng);
      if (!r || r.state.phase === 'over') break;
      s = r.state;
    }
    return makeView(s, [0]);
  },

  rules: {
    goal: 'Провести свои танки через всё поле на большие чёрные кружки соперника. Побеждает тот, кто доведёт больше танков — или разобьёт все танки соперника.',
    sections: [
      {
        title: 'Поле и силы',
        html: `<p>Четыре дороги ведут от больших кружков красных (сверху) к кружкам зелёных (снизу) и пересекаются. У каждого — <b>4 танка</b>
          на своих кружках, <b>2 самолёта</b> на аэродромах «Т», <b>3 ракетные установки</b> на красных кружках своей половины (на
          подставке метка: «Ц-П» — цель поражена, «П» — промах; видит только хозяин) и <b>4 мины</b> на дорогах у своего старта —
          их метки не знает никто: «Т-Р», «Л-П» или «Н-С».</p>`,
      },
      {
        title: 'Как едут танки',
        html: `<p>В свой ход бросают кубик «1:3» <b>столько раз, сколько танков на поле</b>, и после каждого броска один танк едет вперёд
          на выпавшее число кружков (каждый танк — раз за ход). Перепрыгивать танки нельзя. На <b>перекрёстке</b> можно свернуть на
          другую дорогу — танк проедет на кружок меньше. <b>Развернуться</b> — потратить ход танка без броска.</p>
          <p>Вариант без кубика: все танки едут сразу — на 1, 2, 3 и 4 кружка в любом порядке.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([[0, 'B4', -1], [0, 'B1', -1], [1, 'T1', 1]]),
          steps: [Roll(2, 'Выпало 2.'), Go(0, ['d96', 'd92'], 'Танк едет на два кружка.'), Roll(3, 'Выпало 3.'), Go(1, ['d97', 'd93', 'd88'], 'Второй танк — на три.')],
        },
      },
      {
        title: 'Бой и мосты',
        html: `<p>Наехал на танк соперника — тот <b>разбит</b>, твой встаёт на его место, даже если очков было больше. Остановился на
          <b>разрушенном мосту</b> (кружок на мосту) — провалился: следующий ход пропускаешь. Проскочить мост насквозь можно. Если на
          мосту остановится и танк соперника — выбывают оба.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([[0, 'd68', -1], [0, 'd54', -1], [1, 'd56', 1], [1, 'T4', 1]]),
          steps: [Roll(2, 'Выпало 2.'), { seat: 0, action: { type: 'move', id: 0, path: ['d61', 'd56'].map(C) } as Action, caption: 'Танк догоняет красного — разбит!' }, Roll(1, 'Выпало 1.'), { seat: 0, action: { type: 'move', id: 1, path: ['bG'].map(C) } as Action, caption: 'Встал на разрушенный мост — провалился.' }],
        },
      },
      {
        title: 'Мины',
        html: `<p>Танк, наехавший на мину соперника, переворачивает её: <b>«Т-Р»</b> — танк разбит, <b>«Л-П»</b> — танк стоит и пропускает
          следующий ход, <b>«Н-С»</b> — не сработала, едем дальше. Мину снимают. Свои мины свои танки проезжают спокойно.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([[0, 'd23', -1], [0, 'B1', -1], [1, 'T4', 1]], [{ p: C('d12'), side: 1, label: 'tr' }]),
          steps: [Roll(3, 'Выпало 3.'), { seat: 0, action: { type: 'move', id: 0, path: ['d18', 'd12', 'bB'].map(C) } as Action, caption: 'На пути мина — «Т-Р»: танк разбит.' }],
        },
      },
      {
        title: 'Авиация',
        html: `<p>Вместо хода танками можно послать <b>самолёт</b> — если на пунктирной дуге над половиной соперника стоит его танк. Самолёт
          летит с аэродрома до другого и открывает метку ракеты на дуге: «П» — танк разбомблён, самолёт цел; «Ц-П» — самолёт сбит,
          но если он пролетел над танком раньше, чем над ракетой, танк всё равно разбомблён. После полёта хозяин может переставить
          ракеты.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([[0, 'B1', -1], [1, 'd10', 1], [1, 'T4', 1]]),
          steps: [
            { seat: 0, action: { type: 'fly', plane: 0, arc: 0 } as Action, caption: 'Зелёный самолёт с левого аэродрома: над танком раньше, чем над ракетой «Ц-П», — танк разбомблён, самолёт сбит.' },
            { seat: 1, action: { type: 'keep' } as Action, caption: 'Красные оставляют ракеты как есть.' },
          ],
        },
      },
      {
        title: 'Цель',
        html: `<p>Танк, вставший на большой кружок соперника, <b>дошёл</b>. Тогда можно вернуть в игру один свой разбитый танк — на свободный
          большой кружок своей стороны. Игра идёт, пока на поле есть танки; побеждает тот, кто довёл больше, при равенстве — у кого
          меньше сбито самолётов. Разбиты все танки соперника — победа сразу.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([[0, 'd6', -1], [0, 'B2', -1], [1, 'd50', 1]]),
          steps: [Roll(1, 'Выпало 1.'), { seat: 0, action: { type: 'move', id: 0, path: ['T1'].map(C) } as Action, caption: 'Танк на кружке красных — дошёл!' }],
        },
      },
    ],
  },
};
