/* Сальто — описание игры для сборника: немецкая игра 1899 года (Конрад Бюттгенбах) на шашечной доске 10×10:
 * солнца, луны и звёзды с номерами переходят на места соперника. Пресеты: классика (подсчёт через 120 ходов),
 * быстрая (80), долгая (200), «Пирамида» по Беллу (8×8, прыжки цепочкой). Без DOM. */
import { SeededRng } from '../../core/rng';
import type { GameDef, SeatSpec } from '../../core/types';
import { botStep, choose } from './ai';
import { apply, cfgFrom, newState, toAct, type Action, type Event, type State, type Sym } from './engine';

export const SEATS = [
  { name: 'Зелёные', color: '#2f7a3a', light: '#6ab86a', dark: '#123a18' },
  { name: 'Красные', color: '#b8282a', light: '#e86a5a', dark: '#5a0a0c' },
];

export const SYM_NAME: Record<Sym, string> = { star: 'звезда', moon: 'луна', sun: 'солнце', plain: 'фишка' };

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'move' && ev.jump) return `${name(ev.seat)}: сальто — прыжок через фишку${ev.path.length > 2 ? ' цепочкой' : ''}.`;
  if (ev.type === 'pass') return `${name(ev.seat)}: ходить некуда — пропуск.`;
  if (ev.type === 'end') {
    if (ev.why === 'home') return `🏆 <b>${name(ev.winner!)}</b> первыми поставили все фишки на места соперника.`;
    const l = ev.left!;
    const head = ev.why === 'limit' ? 'Ходы вышли — подсчёт' : 'Обоим некуда ходить — подсчёт';
    const tail = ev.winner == null ? 'ничья' : `победа: <b>${name(ev.winner)}</b>`;
    return `🏁 ${head}: осталось шагов — ${name(0)} ${l[0]}, ${name(1)} ${l[1]}; ${tail}.`;
  }
  return null;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const sq = (f: number, r: number, n = 10) => r * n + f;
type Place = [seat: number, sym: Sym, num: number, f: number, r: number];
/** Позиция: только перечисленные фишки, остальные убраны с доски. */
function pos(cells: Place[], turn = 0): State {
  const s = newState(cfgFrom({}));
  s.board.fill(-1);
  for (const [seat, sym, num, f, r] of cells) {
    const id = s.pieces.findIndex((p) => p.seat === seat && p.sym === sym && p.num === num);
    s.board[sq(f, r)] = id;
  }
  s.turn = turn;
  s.made = [30, 30];
  return s;
}
const Mv = (seat: number, f: number, r: number, f2: number, r2: number, caption?: string, n = 10) => ({ seat, action: { type: 'move', from: sq(f, r, n), to: sq(f2, r2, n) } as Action, caption });

/** Почти конец: у зелёных все дома, кроме звезды № 1; красные — посередине, в трёх рядах от своих мест. */
function nearEnd(): State {
  const s = newState(cfgFrom({}));
  s.board.fill(-1);
  const mid = [3, 4, 5].map((r) => Array.from({ length: 10 }, (_, f) => sq(f, r)).filter((p) => (p % 10 + r) % 2 === 0).reverse());
  s.pieces.forEach((pc, id) => {
    if (pc.seat === 0) s.board[pc.tgt] = id;
    else s.board[mid[pc.sym === 'star' ? 0 : pc.sym === 'moon' ? 1 : 2][pc.num - 1]] = id;
  });
  const star1 = s.pieces.findIndex((p) => p.seat === 0 && p.sym === 'star' && p.num === 1);
  const t = s.pieces[star1].tgt;
  s.board[t] = -1;
  s.board[t - 10 + 1] = star1;
  s.made = [60, 60];
  return s;
}

/** Первые ходы: подбираем по настоящим ходам начальной позиции. */
function opening(mode: 'salta' | 'pyramid', plies: number) {
  let s = newState(cfgFrom({ mode }));
  const rng = new SeededRng(mode === 'salta' ? 5 : 11);
  const steps: { seat: number; action: Action; caption?: string }[] = [];
  for (let i = 0; i < plies; i++) {
    const a = choose(s, s.turn, 1, rng)!;
    steps.push({ seat: s.turn, action: a });
    s = apply(s, s.turn, a)!.state;
  }
  return steps;
}
const saltaOpen = opening('salta', 4);
saltaOpen[0].caption = 'Фишка шагает по диагонали на соседнее тёмное поле.';
saltaOpen[1].caption = 'Красные отвечают — тоже шагом.';
const pyrOpen = opening('pyramid', 6);
pyrOpen[5].caption = 'В пирамиде ходят только вперёд, а прыгают через любую фишку — и цепочкой.';

export const def: GameDef<State, Action, Event, State> = {
  id: 'salta',
  title: 'Сальто',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'mode',
      label: 'Игра',
      type: 'select',
      choices: [
        { value: 'salta', label: 'Сальто — 10×10, солнца, луны и звёзды' },
        { value: 'pyramid', label: 'Пирамида — 8×8, по 10 фишек' },
      ],
      default: 'salta',
    },
    {
      key: 'limit',
      label: 'Подсчёт после',
      hint: 'Сколько ходов каждого до подсчёта оставшихся шагов',
      type: 'select',
      choices: [
        { value: 80, label: '80 ходов' },
        { value: 120, label: '120 ходов (турнирное)' },
        { value: 200, label: '200 ходов' },
      ],
      default: 120,
      showIf: (o) => o.mode !== 'pyramid',
    },
  ],
  presets: [
    { id: 'salta', label: 'Сальто', hint: 'Как в 1899 году: 120 ходов каждого — и подсчёт', options: { mode: 'salta', limit: 120 } },
    { id: 'fast', label: 'быстрая', hint: 'Подсчёт уже после 80 ходов', options: { mode: 'salta', limit: 80 } },
    { id: 'long', label: 'долгая', hint: '200 ходов — хватит, чтобы дойти до конца', options: { mode: 'salta', limit: 200 } },
    { id: 'pyramid', label: 'Пирамида', hint: 'По Беллу: 8×8, ходы только вперёд, прыжки цепочкой', options: { mode: 'pyramid' } },
  ],

  setup: (_seats, opts) => newState(cfgFrom(opts)),
  toAct,
  apply: (s, seat, a) => apply(s, seat, a),
  view: (s) => s,
  result(s) {
    if (!s.over) return null;
    if (s.winner == null) return { winners: [], text: 'поровну шагов' };
    return { winners: [s.winner], text: s.why === 'home' ? 'все фишки на местах соперника' : 'меньше шагов до цели' };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    let s = newState(cfgFrom({}));
    const rng = new SeededRng(3);
    for (let i = 0; i < 34 && !s.over; i++) s = botStep(s, 1, rng);
    return s;
  },

  rules: {
    goal: 'Первым перевести все свои фишки <b>на места соперника</b>: каждая проходит ровно семь рядов вперёд и встаёт на своё поле, порядок номеров сохраняется.',
    sections: [
      {
        title: 'Доска и фишки',
        html: `<p>Сальто придумал в 1899 году немец Конрад Бюттгенбах, и в начале XX века оно было в Европе модным, как сегодня головоломки. Доска — шашечная, 10×10, играют только на тёмных полях.
          У каждого 15 фишек в трёх ближних рядах: в первом — <b>звёзды</b>, во втором — <b>луны</b>, в третьем — <b>солнца</b>, в каждом ряду номера 1–5 слева направо. Первыми ходят зелёные.</p>`,
        demo: { seats: demoSeats, intro: 'Начальная расстановка: звёзды, луны и солнца с номерами.', steps: saltaOpen },
      },
      {
        title: 'Ходы и сальто',
        html: `<p>Фишка шагает по диагонали на соседнее пустое поле — <b>вперёд или назад</b>. Прыжок — <b>«сальто»</b>: только вперёд, через одну фишку соперника на пустое поле сразу за ней.
          Фишку при этом не снимают, а прыгают за ход один раз, без цепочек. Через свои фишки не прыгают.</p>
          <p>Прыгать <b>обязательно</b>: если есть прыжок, шагать нельзя (в старину соперник кричал «Сальто!» и заставлял переходить). Из нескольких прыжков выбирают любой.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos([
              [0, 'moon', 3, 4, 4],
              [0, 'sun', 2, 2, 2],
              [1, 'star', 2, 5, 5],
              [1, 'moon', 4, 1, 7],
            ]),
          intro: 'Перед зелёной луной — красная звезда, а за ней пусто.',
          steps: [Mv(0, 4, 4, 6, 6, 'Сальто! Прыгать обязательно: шагать другой фишкой нельзя.'), Mv(1, 1, 7, 2, 6), Mv(0, 6, 6, 7, 5, 'Назад шагнуть можно — прыгать назад нельзя.')],
        },
      },
      {
        title: 'Куда идти',
        html: `<p>Каждая фишка должна пройти <b>ровно семь рядов</b> вперёд и встать на поле с тем же порядковым номером в ряду (считая со своей стороны).
          Звёзды встают на места солнц соперника, луны — на места его лун, солнца — на места звёзд. Нажмите на фишку — её место на доске обведено.</p>
          <p>Побеждает тот, кто первым поставил на места все пятнадцать.</p>`,
        demo: { seats: demoSeats, setup: () => nearEnd(), intro: 'Зелёным осталась одна звезда № 1.', steps: [Mv(0, 2, 6, 1, 7, 'Последняя звезда на месте — зелёные победили.')] },
      },
      {
        title: 'Запирать нельзя',
        html: `<p>У соперника всегда должен оставаться ход. Ход, после которого ему некуда ходить, запрещён (кроме победного) — такие ходы просто не подсвечиваются.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos([
              [0, 'sun', 1, 7, 7],
              [0, 'sun', 2, 9, 7],
              [0, 'moon', 5, 3, 3],
              [1, 'star', 5, 9, 9],
            ]),
          intro: 'Красной звезде в углу можно ходить только на i9. Если зелёные встанут туда — ей не останется хода, и прыгнуть некуда: за i9 стоит зелёное солнце.',
          steps: [Mv(0, 3, 3, 4, 4, 'Поэтому солнцу № 2 на i9 шагать нельзя — зелёные ходят другой фишкой.'), Mv(1, 9, 9, 8, 8, 'Звезда выходит из угла.')],
        },
      },
      {
        title: 'Подсчёт',
        html: `<p>Чтобы партия не тянулась вечно, после <b>120 ходов</b> каждого (турнирное правило; можно выбрать 80 или 200) считают, сколько шагов осталось каждой фишке до её места —
          так, будто доска пуста. У кого сумма меньше, тот и выиграл; поровну — ничья. Если обоим некуда ходить, считают так же.</p>`,
      },
      {
        title: 'Пирамида',
        html: `<p>Упрощённое сальто из книги Р. Белла: доска 8×8, у каждого 10 фишек без знаков, сложенных треугольником 4-3-2-1. Ходят только <b>вперёд</b>, прыгают через любую фишку, свою или чужую, и <b>цепочкой</b>.
          Цель — занять все поля треугольника соперника. Нет хода — пропуск; если застряли оба, считают, сколько осталось до лагеря.</p>`,
        demo: { seats: demoSeats, options: { mode: 'pyramid' }, intro: 'Пирамиды на 8×8.', steps: pyrOpen },
      },
    ],
  },
};
