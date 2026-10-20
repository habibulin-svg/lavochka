/* Виселица — описание игры для сборника: четыре режима, загадывает компьютер или игроки по очереди. Без DOM. */
import type { GameDef, Options, Rng, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { alternate } from '../../core/teams';
import { apply, newPuzzle, PTS, redact, setup, toAct, view, type Action, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Синий', color: '#23408f', light: '#5a78c8', dark: '#122450' },
  { name: 'Красный', color: '#b8281e', light: '#e86a5a', dark: '#7a140e' },
  { name: 'Зелёный', color: '#2a7a3a', light: '#5aaa6a', dark: '#164a20' },
  { name: 'Фиолетовый', color: '#6a2a8a', light: '#9a6ab8', dark: '#3a1250' },
  { name: 'Коричневый', color: '#7a4a1a', light: '#b07a4a', dark: '#4a2a0a' },
  { name: 'Чёрный', color: '#2a2a2a', light: '#6a6a6a', dark: '#111111' },
];

const up = (w: string) => w.toUpperCase();

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'set':
      return `${name(ev.seat)} загадывает слово из ${ev.len} букв.`;
    case 'letter':
      return ev.hit
        ? `${name(ev.seat)}: «${up(ev.l)}» — есть${ev.hit > 1 ? ` (×${ev.hit})` : ''}${ev.p ? `, +${ev.p}` : ''}.`
        : `${name(ev.seat)}: «${up(ev.l)}» — нет.`;
    case 'word':
      return ev.ok ? `${name(ev.seat)} называет слово «${up(ev.word)}» — верно! +${ev.p}` : `${name(ev.seat)}: «${up(ev.word)}»? Не угадал.`;
    case 'bids':
      return `Ставки: ${Object.entries(ev.bids)
        .map(([k, n]) => `${name(Number(k))} ${n}`)
        .join(', ')}. Букву называет ${name(ev.winner)}${ev.paid ? ` (−${ev.paid})` : ''}.`;
    case 'round':
      return `Кон ${ev.round}: ${ev.words.map((w) => `«${up(w)}»`).join(' и ')} — ${ev.hanged.every(Boolean) ? 'повешен' : ev.winners.length ? `выиграли ${ev.winners.map(name).join(', ')}` : 'повешен'}.`;
    case 'newround':
      return ev.setter >= 0 ? `Кон ${ev.round}: загадывает ${name(ev.setter)}.` : `Кон ${ev.round}.`;
    case 'end':
      return `🏁 ${ev.winners.length > 1 ? 'Поровну' : `Победа — <b>${name(ev.winners[0])}</b>`}.`;
  }
}

// ---------------------------------------------------------------- показ правил

const demoSeats = (n: number): SeatSpec[] => Array.from({ length: n }, (_, seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const L = (seat: number, l: string, caption?: string) => ({ seat, action: { type: 'letter', l } as Action, caption });

/** Позиция с известным словом — для показа и превью. */
function demoState(opts: Options, words: [string, string][], rng: Rng, seats = 2): State {
  const s = setup(Array.from({ length: seats }, (_, i) => i), opts, rng);
  s.puzzles = words.map(([w, h]) => newPuzzle(w, h));
  return s;
}

const countsFor = (o: Options) => (o.mode === 'team' ? [2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6]);

export const def: GameDef<State, Action, Event, State> = {
  id: 'hangman',
  title: 'Виселица',
  players: { min: 1, max: 6, default: 2 },
  teams: (o, seats) => (o.mode === 'team' && seats.length >= 2 ? alternate(seats) : null),
  countsFor,
  countsHint: (o) => (o.mode === 'team' ? 'команды: места по очереди — в первую, во вторую' : undefined),
  seats: SEATS,
  options: [
    {
      key: 'mode',
      label: 'Вариант',
      type: 'select',
      choices: [
        { value: 'classic', label: 'обычная' },
        { value: 'team', label: 'командная — две виселицы' },
        { value: 'reverse', label: 'обратная — человечек уже висит' },
        { value: 'auction', label: 'аукцион — ставки на буквы' },
      ],
      default: 'classic',
    },
    {
      key: 'setter',
      label: 'Кто загадывает',
      hint: 'Игроки — по кругу: ведущий вписывает слово, остальные отгадывают; повесили — очки ведущему.',
      type: 'select',
      choices: [
        { value: 'computer', label: 'компьютер (с подсказкой)' },
        { value: 'players', label: 'игроки по очереди' },
      ],
      default: 'computer',
      showIf: (o) => o.mode === 'classic' || o.mode === 'reverse',
    },
    {
      key: 'rounds',
      label: 'Конов',
      type: 'select',
      choices: [1, 3, 5, 7].map((n) => ({ value: n, label: String(n) })),
      default: 3,
      showIf: (o) => !((o.mode === 'classic' || o.mode === 'reverse') && o.setter === 'players'),
    },
    {
      key: 'laps',
      label: 'Кругов ведущих',
      type: 'select',
      choices: [1, 2, 3].map((n) => ({ value: n, label: String(n) })),
      default: 1,
      showIf: (o) => (o.mode === 'classic' || o.mode === 'reverse') && o.setter === 'players',
    },
    {
      key: 'limit',
      label: 'Ошибок до конца',
      hint: '10 — рисуют и виселицу, и человечка; 6 — виселица уже стоит, рисуют только человечка.',
      type: 'select',
      choices: [
        { value: 10, label: '10 — виселица и человечек' },
        { value: 6, label: '6 — только человечек' },
      ],
      default: 10,
    },
    {
      key: 'diff',
      label: 'Слова',
      type: 'select',
      choices: [
        { value: 1, label: 'простые' },
        { value: 2, label: 'посложнее' },
        { value: 3, label: 'любые' },
      ],
      default: 1,
    },
    { key: 'hint', label: 'Подсказка к слову', hint: 'Компьютер пишет, что загадано: «Скамейка во дворе».', type: 'toggle', default: true },
  ],
  presets: [
    { id: 'classic', label: 'Обычная', hint: 'Все отгадывают одно слово по очереди', options: { mode: 'classic', setter: 'computer', limit: 10 } },
    { id: 'players', label: 'Загадываем сами', hint: 'Ведущий по кругу вписывает слово', options: { mode: 'classic', setter: 'players', limit: 10 } },
    { id: 'team', label: 'Командная', hint: 'Две команды, две виселицы — кто быстрее', options: { mode: 'team', limit: 10 } },
    { id: 'reverse', label: 'Обратная', hint: 'Человечек уже висит — спасайте буквами', options: { mode: 'reverse', setter: 'computer', limit: 6 } },
    { id: 'auction', label: 'Аукцион', hint: 'Тайные ставки за право назвать букву', options: { mode: 'auction', limit: 10 } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat), opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view,
  redact,
  result(s) {
    if (s.phase !== 'over') return null;
    const best = Math.max(...s.seats.map((x) => s.scores[x]));
    const winners = s.seats.filter((x) => s.scores[x] === best);
    const text = s.mode === 'team' ? `конов выиграно: ${best}` : s.mode === 'auction' ? `в банке ${best}` : `очков: ${best}`;
    return { winners, text, scores: { ...s.scores } };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose },
  describe,

  showcase: () => {
    const rng = { next: () => 0.5, int: (n: number) => Math.floor(n / 2), getState: () => 0 };
    const s = demoState({ mode: 'classic', limit: 10 }, [['лавочка', 'Скамейка во дворе']], rng);
    s.puzzles[0].letters = ['о', 'а', 'с', 'л', 'е', 'т', 'к', 'р', 'и', 'н'];
    s.puzzles[0].misses = 6;
    s.puzzles[0].word = 'ла_о_ка'; // превью смотрит view('all') — показываем маску, как у отгадчика
    return s;
  },

  rules: {
    goal: 'Отгадать загаданное слово по буквам, пока на листке не дорисовали виселицу с человечком.',
    sections: [
      {
        title: 'Обычная',
        html: `<p>Загаданное слово записано чёрточками — по одной на букву. Отгадчики по очереди называют буквы.
          Есть такая — её вписывают во все места, где она стоит, отгадчик получает по очку за каждую и называет ещё.
          Нет — рисуют ещё одну часть виселицы, ход переходит к следующему.</p>
          <p>Можно сразу назвать слово целиком: угадали — очки за все оставшиеся буквы и ещё ${PTS.wordBonus} сверху,
          ошиблись — это тоже ошибка. Дорисовали человечка — повешен, кон проигран.</p>`,
        demo: {
          seats: demoSeats(2),
          options: { mode: 'classic', limit: 10 },
          setup: (_d, rng) => demoState({ mode: 'classic', limit: 10 }, [['лавочка', 'Скамейка во дворе']], rng),
          intro: 'Компьютер загадал слово из семи букв и подсказал: «Скамейка во дворе».',
          steps: [
            L(0, 'а', 'Синий: «А» — есть, даже две! Два очка, и он называет ещё.'),
            L(0, 'е', '«Е» — нет. Рисуют основание виселицы, ход Красного.'),
            L(1, 'о', 'Красный: «О» — есть.'),
            L(1, 'л', '«Л» — есть.'),
            L(1, 'в', '«В» — есть: «ЛАВО_КА».'),
            { seat: 1, action: { type: 'word', word: 'лавочка' } as Action, caption: 'Красный называет слово целиком — «ЛАВОЧКА»! Очки за последнюю букву и бонус.' },
          ],
        },
      },
      {
        title: 'Кто загадывает',
        html: `<p>Слово загадывает компьютер — обиходное слово с подсказкой (подсказку можно выключить) —
          или <b>игроки по кругу</b>: ведущий вписывает любое существительное, остальные отгадывают.
          Если отгадчиков повесили, ведущий получает ${PTS.hanged} очков. Каждый побывает ведущим одинаковое число раз.</p>
          <p>«Ошибок до конца»: 10 — сначала рисуют виселицу (основание, столб, перекладину, верёвку), потом человечка;
          6 — виселица стоит заранее, рисуют только человечка.</p>`,
      },
      {
        title: 'Командная',
        html: `<p>Игроки делятся на две команды (места по очереди: первое — в первую, второе — во вторую…).
          У каждой команды своё слово той же длины и своя виселица. Команды ходят по очереди, внутри команды —
          тоже по очереди; угадали букву — называете ещё.</p>
          <p>Кто первым отгадал своё слово — выиграл кон. Повесили одну команду — кон у другой.</p>`,
        demo: {
          seats: demoSeats(2),
          options: { mode: 'team', limit: 10 },
          setup: (_d, rng) => {
            const s = demoState({ mode: 'team', limit: 10 }, [['кошка', 'Мурка'], ['дождь', 'Льёт с неба']], rng);
            s.team = 0;
            s.turn = 0;
            return s;
          },
          intro: 'У Синих своё слово, у Красных — своё, оба по пять букв.',
          steps: [
            L(0, 'о', 'Синий: «О» — у Синих есть.'),
            L(0, 'а', '«А» — тоже есть.'),
            L(0, 'и', '«И» — нет: ошибка Синим, ход Красным.'),
            L(1, 'о', 'Красный: «О» — есть в их слове.'),
            L(1, 'д', '«Д» — есть, сразу две.'),
          ],
        },
      },
      {
        title: 'Обратная',
        html: `<p>Человечек <b>уже висит</b>. Каждая угаданная буква стирает часть рисунка: открыли всё слово — человечек спасён.
          Но неверные буквы считаются: кончились попытки — спасти не успели.</p>`,
        demo: {
          seats: demoSeats(1),
          options: { mode: 'reverse', limit: 6 },
          setup: (_d, rng) => demoState({ mode: 'reverse', limit: 6 }, [['мост', 'Через реку']], rng, 1),
          intro: 'Слово из четырёх букв, человечек висит.',
          steps: [L(0, 'о', '«О» — есть: стёрли часть рисунка.'), L(0, 'т', '«Т» — есть.'), L(0, 'м', '«М».'), L(0, 'с', '«С» — слово открыто, человечек спасён!')],
        },
      },
      {
        title: 'Аукцион',
        html: `<p>У каждого банк — ${PTS.auctionBank} очков. Перед каждой буквой все тайно делают ставку.
          Кто поставил больше, платит ставку и называет букву (при равенстве — тот, кто ближе по кругу к начинающему).
          Есть буква — по ${PTS.auctionLetter} очков за каждую; слово целиком — ещё ${PTS.auctionWord} сверху. Ставка не возвращается.</p>
          <p>Побеждает тот, у кого в банке больше всего после всех конов.</p>`,
        demo: {
          seats: demoSeats(2),
          options: { mode: 'auction', limit: 10 },
          setup: (_d, rng) => demoState({ mode: 'auction', limit: 10 }, [['арбуз', 'Полосатая ягода']], rng),
          intro: 'Слово из пяти букв. Сначала — ставки.',
          steps: [
            { seat: 0, action: { type: 'bid', n: 4 } as Action, caption: 'Синий ставит 4.' },
            { seat: 1, action: { type: 'bid', n: 7 } as Action, caption: 'Красный — 7: он и называет букву, отдав 7 очков.' },
            L(1, 'а', '«А» — есть: +10. Снова торг.'),
          ],
        },
      },
    ],
  },
};
