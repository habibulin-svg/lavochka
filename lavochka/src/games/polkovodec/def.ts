/* «Полководец» — описание игры. Советский варгейм об армиях 1812–1814 гг.: поле из трёх листов с крепостями, горами,
 * лесами и рекой, карточки русских, французских и австрийских войск, склады и знамёна генералов. Бой — шахматное взятие
 * по таблице родов войск. Материалы и решения — docs/analysis/materials-polkovodec.md. */
import type { GameDef, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, at, cfgFrom, MAX_TURNS, NAMES, newState, setup, toAct, type Action, type Event, type Kind, type Piece, type State } from './engine';

export const SEATS = [
  { name: 'Русские', color: '#4f7a3a', light: '#8ac06a', dark: '#1f3a10' },
  { name: 'Французы', color: '#3a64b8', light: '#7aa2f0', dark: '#122a62' },
  { name: 'Австрийцы', color: '#b0a890', light: '#e8e2d0', dark: '#5a5440', ink: '#6a6450' },
];
const n = (k: Kind, army: number) => NAMES[k][army];

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'hit') return `⚔ ${name(ev.seat)}: ${n(ev.kind, ev.seat)} поражает — ${n(ev.took.kind, ev.took.army)} снят с поля.`;
  if (ev.type === 'recruit') return `${name(ev.seat)}: в крепости сформирован ${n(ev.kind, ev.seat)}.`;
  if (ev.type === 'drown') return `${name(ev.seat)}: ${n(ev.kind, ev.seat)} утонул в реке.`;
  if (ev.type === 'fort') return `🏰 ${name(ev.seat)} берёт крепость ${ev.name} — трофеи: ${ev.loot / 2} складов.`;
  if (ev.type === 'marshal') return `${name(ev.seat)}: маршал пал — назначен новый.`;
  if (ev.type === 'capitulate') return `🏳 ${name(ev.seat)}: маршал пал, назначить нового не на что — армия капитулирует.`;
  if (ev.type === 'end') return ev.winner == null ? '🏁 Ничья.' : `🏁 Победа — ${name(ev.winner)}!`;
  return null;
}

const demoSeats: SeatSpec[] = [
  { seat: 0, kind: 'bot', name: 'Вовка', level: 1 },
  { seat: 1, kind: 'bot', name: 'Серёга', level: 1 },
];
/** Позиция: фигуры [место, род, столбец, ряд]. */
function pos(list: [number, Kind, number, number][]): State {
  const s = newState(cfgFrom({}), 2);
  s.pieces = list.map(([side, kind, c, r], i): Piece => ({ id: i + 1, side, army: side, kind, p: at(c, r), wet: 0 }));
  s.nextId = list.length + 1;
  return s;
}
const Mv = (seat: number, id: number, c: number, r: number, caption?: string) => ({ seat, action: { type: 'move', id, to: at(c, r) } as Action, caption });
const Hit = (seat: number, id: number, c: number, r: number, caption?: string) => ({ seat, action: { type: 'hit', id, to: at(c, r) } as Action, caption });

export const def: GameDef<State, Action, Event, State> = {
  id: 'polkovodec',
  title: 'Полководец',
  players: { min: 2, max: 3, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'size',
      label: 'Армии',
      type: 'select',
      choices: [
        { value: 'small', label: 'малые — короткая партия' },
        { value: 'normal', label: 'обычные' },
        { value: 'big', label: 'большие' },
      ],
      default: 'normal',
    },
    {
      key: 'goal',
      label: 'Цель',
      type: 'select',
      choices: [
        { value: 'rout', label: 'разгром: уничтожить маршала' },
        { value: 'forts', label: 'крепости: к концу у кого больше крепостей' },
      ],
      default: 'rout',
    },
  ],
  presets: [
    { id: 'rout', label: 'Разгром', hint: 'Уничтожить маршала противника — армия без него капитулирует', options: { size: 'normal', goal: 'rout' } },
    { id: 'forts', label: 'Крепости', hint: `За ${MAX_TURNS} ходов взять больше крепостей`, options: { size: 'normal', goal: 'forts' } },
    { id: 'small', label: 'Малые армии', hint: 'Партия покороче', options: { size: 'small', goal: 'rout' } },
  ],

  setup: (seats, opts) => setup(opts, seats.length),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s) => s,
  result(s) {
    if (!s.over) return null;
    if (s.winner == null) return { winners: [], text: 'ничья' };
    return { winners: [s.winner], text: s.alive.filter(Boolean).length === 1 ? 'армии противника капитулировали' : 'больше сил и крепостей к концу кампании' };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose },
  describe,

  showcase: () => {
    const rng = { n: 3, next() { this.n = (this.n * 1103515245 + 12345) % 2147483648; return this.n / 2147483648; }, int(k: number) { return Math.floor(this.next() * k); }, getState() { return this.n; } };
    let s = setup({}, 2);
    for (let i = 0; i < 70 && !s.over; i++) {
      const a = choose(s, s.turn, 1, rng);
      if (!a) break;
      const r = apply(s, s.turn, a, rng);
      if (!r || r.state.over) break;
      s = r.state;
    }
    return s;
  },

  rules: {
    goal: 'Выполнить стратегическую цель: разгромить армию противника — уничтожить её маршала, — или к концу кампании владеть большим числом крепостей.',
    sections: [
      {
        title: 'Поле и армии',
        html: `<p>Поле из трёх листов в клетку: дороги, крепости (Дальний монастырь, Белый город, Цитадель, Лесной замок, Фольварк,
          Загорье), горы, леса, болото и река с мостом. Армии — русская (зелёные карточки «А»), французская (синие «N») и австрийская
          (белые «F»). Одна карточка — рота, эскадрон или батарея. Большое знамя — маршал, малые — генералы.</p>`,
      },
      {
        title: 'Приказы',
        html: `<p>Каждый генерал и маршал отдаёт за ход <b>один приказ</b>: одна фигура в квадрате 13×13 вокруг него делает ход — передвигается
          или поражает противника. Командир может и сам сделать шаг на клетку (это его приказ). Часть, рядом с которой нет командира,
          стоит без дела. Приказы кончились — ход переходит.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([[0, 'general', 5, 13], [0, 'musk', 8, 13], [0, 'hussar', 8, 14], [1, 'general', 30, 13], [1, 'marshal', 31, 13], [0, 'marshal', 4, 13]]),
          steps: [Mv(0, 2, 9, 13, 'Генерал приказал: мушкетёр — на клетку вперёд.'), Mv(0, 3, 11, 17, 'Маршал приказал: гусар — на 3 клетки по диагонали.')],
        },
      },
      {
        title: 'Как ходят и бьют',
        html: `<p>По таблице: пехота — на 1 клетку в любую сторону (мушкетёры и егеря бьют только по диагонали, гренадеры — во все стороны);
          драгуны — по диагонали на 2 и прямо на 1; гусары, уланы и казаки — по диагонали на 3; кирасиры — по прямой на 4; артиллерия
          ходит на 1, а бьёт на 5 клеток в любую сторону и остаётся на месте. Поражённая фигура снимается, пехота и кавалерия
          встают на её клетку. Перепрыгивать нельзя; пушки не стреляют через крепости, горы, лес и войска.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([[0, 'marshal', 10, 13], [0, 'general', 12, 15], [0, 'hussar', 12, 14], [1, 'ulan', 15, 11], [1, 'cuir', 14, 16], [0, 'gun', 10, 16], [1, 'marshal', 33, 13]]),
          steps: [Hit(0, 3, 15, 11, 'Гусар бьёт улана по диагонали на 3 клетки и встаёт на его место.'), Hit(0, 6, 14, 16, 'Орудие поражает кирасира за 4 клетки — и остаётся на месте.')],
        },
      },
      {
        title: 'Местность',
        html: `<p>По <b>дороге</b> (и через крепость, через которую она идёт) войска идут вдвое быстрее, но после такого марша бить нельзя.
          <b>Горы, лес и болото</b> закрыты для кавалерии и артиллерии; воевать там могут только егерские части и казаки (конные егеря,
          лёгкие драгуны), остальная пехота там лишь ходит. Через <b>реку</b> артиллерия не идёт, а кто простоит на реке два хода
          подряд — тонет; по мосту — можно.</p>`,
      },
      {
        title: 'Склады и крепости',
        html: `<p>У каждого — стратегический запас складов. В своей крепости по приказу генерала можно сформировать новые войска: мушкетёр —
          1 полковой склад, гренадер и егерь — 2, драгун, гусар, улан — 3, казак — 3,5, кирасир — 4, орудие — армейский (10), конная
          артиллерия — 15, генерал — 5. Крепость, из которой выбиты войска противника и которую вы удержали два хода, ваша: за каждую
          её клетку — корпусной склад (5) трофеями.</p>`,
      },
      {
        title: 'Маршал и победа',
        html: `<p>Погиб маршал — нового можно назначить в своей крепости за 15 складов; не на что — армия капитулирует. Победа — разгром
          всех противников. Если за ${MAX_TURNS} ходов этого не случилось, побеждает сильнейший (войска и склады), а в варианте «Крепости»
          — у кого больше крепостей. Цель и размер армий в брошюре оставлены на договорённость — здесь они пресетами.</p>`,
      },
    ],
  },
};
