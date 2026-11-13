/* Викторина — описание игры для сборника: семь режимов в одной карточке (тривиа, кнопка, лестница к миллиону, барабан,
 * сто опрошенных, табло тем, верю — не верю). Время — часы комнаты (GameDef.clock). Без DOM.
 * Банк вопросов должен быть загружен до setup (loadBank в defs.ts и в каталоге). */
import type { DemoScript, GameDef, Options, Rng, SeatSpec } from '../../core/types';
import { choose } from './ai';
import {
  apply,
  due,
  free,
  LADDER_SUM,
  MODES,
  readMs,
  redact,
  restart,
  result,
  SECTORS,
  setup,
  speedPts,
  toAct,
  TOPICS,
  view,
  type Action,
  type Event,
  type Q,
  type State,
  type View,
} from './engine';

export const SEATS = [
  { name: 'Красный', color: '#d8402e', light: '#ff8a6a', dark: '#6e1a10' },
  { name: 'Синий', color: '#2f6ad0', light: '#7aa8ff', dark: '#10306e' },
  { name: 'Зелёный', color: '#2f9a48', light: '#7ad88a', dark: '#104a1e' },
  { name: 'Жёлтый', color: '#e0a020', light: '#ffd86a', dark: '#6a4a08', ink: '#a87410' },
  { name: 'Фиолетовый', color: '#8a3ab8', light: '#c58aea', dark: '#3e1258' },
  { name: 'Бирюзовый', color: '#1a9a9a', light: '#6ad8d8', dark: '#0a4848' },
  { name: 'Оранжевый', color: '#e06a1a', light: '#ffaa6a', dark: '#6a2a08' },
  { name: 'Розовый', color: '#d84a8a', light: '#ff9ac8', dark: '#6a1a40' },
];

const rub = (n: number) => `${n.toLocaleString('ru-RU')} ₽`;
const sectorName = (i: number) => {
  const x = SECTORS[i];
  return x === 'Б' ? 'Банкрот' : x === '0' ? 'Ноль' : x === 'П' ? 'Приз' : x === '+' ? 'Плюс' : x === 'x2' ? '×2' : `${x} очков`;
};

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.k) {
    case 'q':
      return `<b>Вопрос ${ev.n} из ${ev.total}.</b>`;
    case 'reveal':
      return `Правильный ответ — «${ev.ans}».${Object.keys(ev.gains).length ? ' ' + Object.entries(ev.gains).map(([s, g]) => `${name(Number(s))} +${g}`).join(', ') : ''}`;
    case 'early':
      return `${name(ev.seat)} — фальстарт: нажал до сигнала.`;
    case 'buzzed':
      return `${name(ev.seat)} нажал первым${ev.lead != null ? ` — на ${ev.lead} мс раньше` : ''}.`;
    case 'nobody':
      return 'Никто не нажал.';
    case 'right':
      return `${name(ev.seat)}: «${ev.said}» — верно! +${ev.gain}`;
    case 'wrong':
      return `${name(ev.seat)}: «${ev.said || '—'}» — неверно, ${ev.gain}.`;
    case 'timeout':
      return `${name(ev.seat)} не успел ответить, ${ev.gain}.`;
    case 'life':
      return `${name(ev.seat)} берёт подсказку: ${ev.life === 'fifty' ? '50 на 50' : ev.life === 'hall' ? 'помощь зала' : 'звонок другу'}.`;
    case 'take':
      return `${name(ev.seat)} забирает деньги: <b>${rub(ev.sum)}</b>.`;
    case 'climb':
      return `${name(ev.seat)}: верно — ${rub(ev.sum)}.`;
    case 'fall':
      return `${name(ev.seat)}: неверно (правильно — «${ev.ans}»). Уходит с ${rub(ev.sum)}.`;
    case 'ladder':
      return `Лестница ${name(ev.seat)}.`;
    case 'spin':
      return `${name(ev.seat)} крутит барабан: <b>${sectorName(ev.sector)}</b>.`;
    case 'bankrupt':
      return `${name(ev.seat)} — банкрот, очки тура сгорели.`;
    case 'letter':
      return ev.n ? `${name(ev.seat)}: «${ev.l}» — есть${ev.n > 1 ? ` (×${ev.n})` : ''}${ev.gain ? `, +${ev.gain}` : ''}.` : `${name(ev.seat)}: «${ev.l}» — нет.`;
    case 'word':
      return ev.ok ? `${name(ev.seat)} называет слово «${ev.w}» — верно!${ev.gain ? ` +${ev.gain}` : ''}` : `${name(ev.seat)}: «${ev.w}»? Неверно${ev.gain === 0 ? '' : ''}.`;
    case 'opened':
      return `Открыта буква «${ev.l}»${ev.n > 1 ? ` (×${ev.n})` : ''}.`;
    case 'turn':
      return null;
    case 'wround':
      return `${ev.final ? 'Финал' : `Тур ${ev.round}`}: слово «${ev.word}»${ev.winner != null ? ` — отгадал ${name(ev.winner)}` : ''}.`;
    case 'finalist':
      return `В финале — ${name(ev.seat)}.`;
    case 'say':
      return ev.hit >= 0 ? `${name(ev.seat)}: «${ev.text}» — есть на табло! +${ev.pts}` : `${name(ev.seat)}: «${ev.text || '—'}» — нет на табло.`;
    case 'strike':
      return `Промах ${ev.n} из 3.`;
    case 'steal':
      return 'Три промаха — отыгрывается соперник.';
    case 'pround':
      return ev.team != null ? `Банк ${ev.bank} уходит команде ${ev.team + 1}.` : 'Банк никому.';
    case 'cell':
      return `${name(ev.seat)}: «${ev.theme}» за ${ev.price}.`;
    case 'end':
      return '🏁 Игра окончена.';
    default:
      return null;
  }
}

// ---------------------------------------------------------------- показ правил

const T0 = 1_000_000;
const human = (n: number): SeatSpec[] => Array.from({ length: n }, (_, seat) => ({ seat, kind: 'human', name: SEATS[seat].name, level: 1 }));

const mk = (text: string, opts: string[], ok: number, d = 2, t = 'misc', ans?: string, alt?: string[]): Q => ({ id: 'demo', text, opts, ok, d, t, ans: ans ?? opts[ok], alt });

/** Партия с подложенными вопросами; часы начинаются с T0. */
function demoState(seats: SeatSpec[], o: Options, rng: Rng, patch: (s: State) => void): State {
  const s = setup(seats, o, rng);
  s.now = T0;
  patch(s);
  restart(s);
  return s;
}

const PLANET = mk('Какая планета ближе всех к Солнцу?', ['Меркурий', 'Венера', 'Марс', 'Юпитер'], 0, 1, 'space');
const BUZZQ = mk('Кто написал «Капитанскую дочку»?', ['Пушкин', 'Лермонтов', 'Гоголь', 'Тургенев'], 0, 2, 'lit');
const BZ_OPEN = T0 + readMs(BUZZQ.text);

const a = (seat: number, action: Action, caption: string) => ({ seat, action, caption });
const wake = (now: number, caption: string) => ({ seat: -1, action: { type: 'wake', now } as Action, caption });

const triviaDemo: DemoScript<State, Action> = {
  seats: human(2),
  options: { mode: 'trivia', count: 10 },
  setup: (_d, rng) =>
    demoState(human(2), { mode: 'trivia', count: 10 }, rng, (s) => {
      s.qs = [PLANET, ...s.qs.slice(1)];
    }),
  intro: 'Вопрос и четыре варианта. Компанией отвечают все сразу — на скорость.',
  steps: [
    a(1, { type: 'answer', i: 0, at: T0 + 2400, now: T0 + 2400 }, 'Синий выбрал «Меркурий» через 2,4 с.'),
    a(0, { type: 'answer', i: 1, at: T0 + 3100, now: T0 + 3100 }, 'Красный — «Венера», через 3,1 с.'),
    wake(T0 + 3101, `Все ответили — показываем: верно «Меркурий». Синему ${speedPts(2400, 20000)} за верный и быстроту и ещё 50 — первому верному.`),
    wake(T0 + 6400, 'Следующий вопрос.'),
  ],
};

const buzzDemo: DemoScript<State, Action> = {
  seats: human(3),
  options: { mode: 'buzz', count: 10, answer: 'choice' },
  setup: (_d, rng) =>
    demoState(human(3), { mode: 'buzz', count: 10, answer: 'choice' }, rng, (s) => {
      s.qs = [BUZZQ, ...s.qs.slice(1)];
    }),
  intro: 'Вопрос без вариантов. Пока его читают, кнопка заперта — она загорается по сигналу.',
  steps: [
    a(2, { type: 'buzz', at: BZ_OPEN - 300, now: BZ_OPEN - 280 }, 'Зелёный нажал до сигнала — фальстарт: кнопка у него заблокирована почти на секунду.'),
    a(0, { type: 'buzz', at: BZ_OPEN + 190, now: BZ_OPEN + 205 }, 'Красный (быстрый интернет) нажал через 190 мс после сигнала — его нажатие пришло через 15 мс.'),
    a(1, { type: 'buzz', at: BZ_OPEN + 150, now: BZ_OPEN + 370 }, 'Синий (мобильный интернет) нажал через 150 мс, но сообщение шло 220 мс и пришло позже.'),
    wake(BZ_OPEN + 460, 'Окно ожидания кончилось. Первым считается тот, кто раньше НАЖАЛ, а не чьё сообщение раньше пришло: Синий, на 40 мс раньше Красного.'),
    a(1, { type: 'pick', i: 0, now: BZ_OPEN + 2600 }, 'Синий отвечает: «Пушкин» — верно, +200 (вопрос второй трудности).'),
  ],
};

const LADDER_QS: Q[] = [
  mk('Сколько дней в високосном году?', ['365', '366', '364', '367'], 1, 1, 'misc'),
  mk('Какого цвета мухомор в сказках?', ['Синий', 'Зелёный', 'Красный в белый горошек', 'Жёлтый'], 2, 1, 'nature'),
  mk('Кто построил Ноев ковчег?', ['Моисей', 'Ной', 'Авраам', 'Давид'], 1, 1, 'myth'),
];

const ladderDemo: DemoScript<State, Action> = {
  seats: human(1),
  options: { mode: 'ladder' },
  setup: (_d, rng) =>
    demoState(human(1), { mode: 'ladder' }, rng, (s) => {
      s.ld!.qs[0] = [...LADDER_QS, ...s.ld!.qs[0].slice(3)];
    }),
  intro: '15 вопросов, суммы растут от 100 до миллиона. Три подсказки на всю лестницу.',
  steps: [
    a(0, { type: 'answer', i: 1, now: T0 + 4000 }, '«366» — верно: 100 ₽.'),
    wake(T0 + 7300, 'Второй вопрос — на 200 ₽.'),
    a(0, { type: 'life', k: 'fifty', now: T0 + 9000 }, 'Подсказка «50 на 50»: два неверных варианта убраны.'),
    a(0, { type: 'answer', i: 2, now: T0 + 11000 }, 'Верно: 200 ₽.'),
    wake(T0 + 14300, 'Третий — на 300 ₽.'),
    a(0, { type: 'take', now: T0 + 16000 }, `Не уверены — можно забрать то, что есть (${LADDER_SUM[1]} ₽). Ошибка отбросит к несгораемой сумме: 1 000 после пятого вопроса и 32 000 — после десятого.`),
  ],
};

const lifeDemo: DemoScript<State, Action> = {
  seats: human(1),
  options: { mode: 'ladder' },
  setup: (_d, rng) =>
    demoState(human(1), { mode: 'ladder' }, rng, (s) => {
      s.ld!.qs[0] = [mk('В каком городе стоит Эрмитаж?', ['Москва', 'Санкт-Петербург', 'Казань', 'Киев'], 1, 3, 'art'), ...s.ld!.qs[0].slice(1)];
    }),
  intro: 'Помощь зала и звонок другу — подсказки с ошибкой: чем труднее вопрос, тем чаще зал и друг ошибаются.',
  steps: [
    a(0, { type: 'life', k: 'hall', now: T0 + 3000 }, 'Помощь зала: столбики — сколько зрителей за какой вариант.'),
    a(0, { type: 'life', k: 'call', now: T0 + 6000 }, 'Звонок другу: друг называет вариант и говорит, насколько уверен.'),
    a(0, { type: 'answer', i: 1, now: T0 + 9000 }, '«Санкт-Петербург» — верно.'),
  ],
};

const wheelWord = { w: 'ЛАВОЧКА', h: 'Скамейка у подъезда, где сидят бабушки и вечером — молодёжь', d: 1 };
const wheelDemo: DemoScript<State, Action> = {
  seats: human(2),
  options: { mode: 'wheel', wrounds: 'short' },
  setup: (_d, rng) =>
    demoState(human(2), { mode: 'wheel', wrounds: 'short' }, rng, (s) => {
      s.wh!.words = [wheelWord];
    }),
  intro: 'Слово из семи букв и подсказка. Барабан крутит сам игрок — взмахом по барабану или кнопкой.',
  steps: [
    { seat: 0, action: { type: 'spin', f: 0.7 } as Action, rig: [SECTORS.indexOf(500)], caption: 'Красный крутит: 500 очков. Теперь называет букву.' },
    a(0, { type: 'letter', l: 'А' }, '«А» — есть, две! 500 × 2 = 1000. Угадал букву — крутит снова.'),
    { seat: 0, action: { type: 'spin', f: 0.6 } as Action, rig: [SECTORS.indexOf('Б')], caption: '«Банкрот» — очки тура сгорели, ход Синему.' },
    { seat: 1, action: { type: 'spin', f: 0.8 } as Action, rig: [SECTORS.indexOf(300)], caption: 'Синий: 300.' },
    a(1, { type: 'letter', l: 'Я' }, '«Я» — нет. Ход обратно Красному.'),
    { seat: 0, action: { type: 'spin', f: 0.5 } as Action, rig: [SECTORS.indexOf('+')], caption: '«Плюс»: можно открыть любую букву на выбор.' },
    a(0, { type: 'plus', pos: 0 }, 'Красный открывает первую: «Л».'),
    a(0, { type: 'word', w: 'лавочка' }, 'И называет слово целиком — «ЛАВОЧКА»! За каждую неоткрытую букву — ещё по 100. Ошибся бы — выбыл бы из тура.'),
  ],
};

const pollDemo: DemoScript<State, Action> = {
  seats: human(2),
  options: { mode: 'poll' },
  setup: (_d, rng) =>
    demoState(human(2), { mode: 'poll' }, rng, (s) => {
      s.pl!.qs[0] = {
        id: 'demo',
        q: 'Что берут с собой на пикник?',
        r: [
          ['шашлык', 34, ['мясо']],
          ['мяч', 21, ['волейбольный мяч']],
          ['покрывало', 16, ['плед', 'одеяло']],
          ['гитару', 12, []],
          ['палатку', 9, []],
          ['спички', 8, ['зажигалку']],
        ],
        t: 'misc',
      };
    }),
  intro: 'Сто человек ответили на вопрос — шесть самых частых ответов спрятаны на табло. Ответ пишут с клавиатуры.',
  steps: [
    a(0, { type: 'say', text: 'мясо', now: T0 + 4000 }, '«Мясо» — это «шашлык» (синоним засчитывается): +34.'),
    a(0, { type: 'say', text: 'плет', now: T0 + 8000 }, '«Плет» — опечатка в «плед», а плед — это «покрывало»: +16.'),
    a(0, { type: 'say', text: 'телевизор', now: T0 + 12000 }, 'Телевизора на табло нет — промах.'),
    a(0, { type: 'say', text: 'книга', now: T0 + 16000 }, 'Второй промах.'),
    a(0, { type: 'say', text: 'вилки', now: T0 + 20000 }, 'Третий промах — отыгрывается соперник: один ответ на всю команду.'),
    a(1, { type: 'say', text: 'гитара', now: T0 + 25000 }, '«Гитара» — есть! Синий забирает весь банк раунда: 62. Во втором раунде очки удваиваются, в третьем — утраиваются.'),
  ],
};

const boardDemo: DemoScript<State, Action> = {
  seats: human(2),
  options: { mode: 'board', answer: 'input', themes: 5, brounds: 1 },
  setup: (_d, rng) =>
    demoState(human(2), { mode: 'board', answer: 'input', themes: 5, brounds: 1 }, rng, (s) => {
      s.bd!.themes[0][0] = {
        name: 'Цари и царицы',
        t: 'history',
        cells: [
          { q: 'Последний российский император', ans: 'Николай II', alt: ['Николай 2', 'Николай Второй'], opts: ['Николай II', 'Пётр I', 'Александр I', 'Иван Грозный'], ok: 0 },
          ...s.bd!.themes[0][0].cells.slice(1),
        ],
      };
    }),
  intro: 'Табло: темы и цены 100…500. Выбирает ячейку тот, кто последним ответил верно.',
  steps: [
    a(0, { type: 'cell', th: 0, k: 0, now: T0 + 2000 }, 'Красный выбирает «Цари и царицы» за 100. Вопрос читается — потом кнопка.'),
    a(1, { type: 'buzz', at: T0 + 2000 + readMs('Последний российский император') + 400, now: T0 + 2000 + readMs('Последний российский император') + 420 }, 'Синий нажал первым.'),
    wake(T0 + 2000 + readMs('Последний российский император') + 800, 'Отвечает Синий.'),
    a(1, { type: 'say', text: 'николай 2', now: T0 + 2000 + readMs('Последний российский император') + 5000 }, '«Николай 2» — засчитано (так тоже пишут). +100, и следующую ячейку выбирает Синий. Неверно — минус цена вопроса, и кнопка снова открыта.'),
  ],
};

const truthDemo: DemoScript<State, Action> = {
  seats: human(2),
  options: { mode: 'truth' },
  setup: (_d, rng) =>
    demoState(human(2), { mode: 'truth' }, rng, (s) => {
      s.qs = [{ id: 'demo', text: 'Столица Австралии — Сидней.', opts: ['Верю', 'Не верю'], ok: 1, d: 2, t: 'geo', ans: 'Неверно: правильно — Канберра' }, ...s.qs.slice(1)];
    }),
  intro: 'Ведущий говорит утверждение — правду или неправду, поровну. Отвечаем «верю» или «не верю», на скорость.',
  steps: [
    a(0, { type: 'answer', i: 0, at: T0 + 1800, now: T0 + 1800 }, 'Красный: «Верю».'),
    a(1, { type: 'answer', i: 1, at: T0 + 2600, now: T0 + 2600 }, 'Синий: «Не верю».'),
    wake(T0 + 2601, 'Не верно: столица Австралии — Канберра. Очки Синему.'),
  ],
};

// ---------------------------------------------------------------- настройки

const QUIZ = (o: Options) => o.mode === 'trivia' || o.mode === 'buzz' || o.mode === 'truth';

export const def: GameDef<State, Action, Event, View> = {
  id: 'viktorina',
  title: 'Викторина',
  players: { min: 1, max: 8, default: 3 },
  countsFor: (o) => (o.mode === 'wheel' ? [1, 2, 3] : o.mode === 'board' || o.mode === 'buzz' ? [1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 7, 8]),
  countsHint: (o) =>
    o.mode === 'wheel' ? 'у барабана — до трёх игроков' : o.mode === 'poll' ? 'вдвоём и больше — две команды: места по очереди' : o.mode === 'ladder' ? 'каждый проходит свою лестницу по очереди' : undefined,
  teams: (o, seats) => (o.mode === 'poll' && seats.length >= 2 ? [seats.filter((_, i) => i % 2 === 0), seats.filter((_, i) => i % 2 === 1)] : null),
  seats: SEATS,
  options: [
    {
      key: 'mode',
      label: 'Режим',
      type: 'select',
      choices: MODES.map((m) => ({ value: m.id, label: m.name })),
      default: 'trivia',
    },
    {
      key: 'count',
      label: 'Вопросов',
      type: 'select',
      choices: [10, 20, 30].map((n) => ({ value: n, label: String(n) })),
      default: 10,
      showIf: QUIZ,
    },
    {
      key: 'topic',
      label: 'Темы',
      type: 'select',
      choices: [{ value: 'all', label: 'все темы' }, ...TOPICS.map(([v, l]) => ({ value: v, label: l }))],
      default: 'all',
      showIf: QUIZ,
    },
    {
      key: 'diff',
      label: 'Сложность',
      type: 'select',
      choices: [
        { value: 'rise', label: 'нарастающая' },
        { value: 'easy', label: 'лёгкие' },
        { value: 'mid', label: 'средние' },
        { value: 'hard', label: 'трудные' },
        { value: 'any', label: 'вперемешку' },
      ],
      default: 'rise',
      showIf: QUIZ,
    },
    {
      key: 'time',
      label: 'Время на ответ',
      hint: 'Компанией без срока нельзя — тогда 20 секунд.',
      type: 'select',
      choices: [
        { value: 0, label: 'без времени' },
        { value: 10000, label: '10 секунд', showIf: (o) => o.mode !== 'ladder' },
        { value: 20000, label: '20 секунд', showIf: (o) => o.mode !== 'ladder' },
        { value: 30000, label: '30 секунд' },
        { value: 60000, label: 'минута', showIf: (o) => o.mode === 'ladder' },
      ],
      default: 0,
      showIf: (o) => o.mode === 'trivia' || o.mode === 'truth' || o.mode === 'ladder',
    },
    {
      key: 'answer',
      label: 'Ответ',
      type: 'select',
      choices: [
        { value: 'choice', label: 'выбор из четырёх' },
        { value: 'input', label: 'ввод с клавиатуры' },
      ],
      default: 'choice',
      showIf: (o) => o.mode === 'buzz' || o.mode === 'board',
    },
    {
      key: 'wrounds',
      label: 'Игра',
      type: 'select',
      choices: [
        { value: 'full', label: 'три тура и финал' },
        { value: 'short', label: 'один тур' },
      ],
      default: 'full',
      showIf: (o) => o.mode === 'wheel',
    },
    { key: 'reverse', label: '«Обратная игра» в конце', hint: 'Последний раунд: чем реже ответ, тем он дороже.', type: 'toggle', default: false, showIf: (o) => o.mode === 'poll' },
    {
      key: 'themes',
      label: 'Тем на табло',
      type: 'select',
      choices: [5, 6].map((n) => ({ value: n, label: String(n) })),
      default: 5,
      showIf: (o) => o.mode === 'board',
    },
    {
      key: 'brounds',
      label: 'Раундов',
      hint: 'Во втором раунде — новые темы, цены вдвое.',
      type: 'select',
      choices: [
        { value: 1, label: 'один' },
        { value: 2, label: 'два' },
      ],
      default: 1,
      showIf: (o) => o.mode === 'board',
    },
  ],
  presets: [
    { id: 'trivia', label: 'Тривиа', hint: '10 вопросов, четыре варианта, сложность растёт', options: { mode: 'trivia', count: 10, diff: 'rise', time: 0 } },
    { id: 'speed', label: 'Тривиа на скорость', hint: 'Компанией: все отвечают сразу, 10 секунд', options: { mode: 'trivia', count: 20, diff: 'any', time: 10000 } },
    { id: 'buzz', label: 'Кнопка', hint: 'Кто первый нажал — тот отвечает (с поправкой на задержку сети)', options: { mode: 'buzz', count: 10, answer: 'choice' } },
    { id: 'buzz-input', label: 'Кнопка с вводом', hint: 'Нажал первым — пиши ответ сам', options: { mode: 'buzz', count: 10, answer: 'input' } },
    { id: 'ladder', label: 'Лестница к миллиону', hint: '15 вопросов, несгораемые суммы, три подсказки', options: { mode: 'ladder', time: 0 } },
    { id: 'ladder-time', label: 'Лестница на время', hint: '30 секунд на вопрос', options: { mode: 'ladder', time: 30000 } },
    { id: 'wheel', label: 'Барабан', hint: 'Слово по буквам: три тура и финал', options: { mode: 'wheel', wrounds: 'full' } },
    { id: 'wheel-short', label: 'Барабан, один тур', hint: 'Коротко: одно слово', options: { mode: 'wheel', wrounds: 'short' } },
    { id: 'poll', label: 'Сто опрошенных', hint: 'Угадай самые частые ответы, три промаха', options: { mode: 'poll', reverse: false } },
    { id: 'poll-reverse', label: 'Сто опрошенных с обратной игрой', hint: 'В конце — чем реже ответ, тем дороже', options: { mode: 'poll', reverse: true } },
    { id: 'board', label: 'Табло тем', hint: 'Темы и цены, ответ по кнопке, выбор из четырёх', options: { mode: 'board', answer: 'choice', themes: 5, brounds: 1 } },
    { id: 'board-input', label: 'Табло тем с вводом', hint: 'Два раунда, ответ пишут сами', options: { mode: 'board', answer: 'input', themes: 6, brounds: 2 } },
    { id: 'truth', label: 'Верю — не верю', hint: 'Правда или нет — на скорость', options: { mode: 'truth', count: 10, diff: 'any' } },
  ],
  summary: (o, base) => base,

  setup: (seats, opts, rng) => setup(seats, opts, rng),
  toAct,
  free,
  apply,
  view,
  redact: (ev) => redact(ev),
  result,
  clock: { wake: (s) => (s.phase === 'over' ? null : due(s)) },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose },
  describe,

  showcase: () => {
    const rng = { next: () => 0.37, int: (n: number) => Math.floor(n * 0.37), getState: () => 0 };
    const s = demoState(human(3), { mode: 'wheel', wrounds: 'full' }, rng, (st) => {
      st.wh!.words = [wheelWord, wheelWord, wheelWord, wheelWord];
    });
    const wh = s.wh!;
    wh.open = [true, true, false, true, false, false, true];
    wh.named = ['Л', 'А', 'О', 'Я'];
    wh.sector = SECTORS.indexOf(500);
    wh.turn = 1;
    wh.rs = { 0: 1200, 1: 800, 2: 350 };
    s.scores = { 0: 1200, 1: 800, 2: 350 };
    s.phase = 'letter';
    return s;
  },

  rules: {
    goal: 'Набрать больше всех очков (в «Лестнице» — денег), отвечая на вопросы: семь телевизионных форматов в одной игре — одному, компанией за одним экраном и по сети.',
    sections: [
      {
        title: 'Тривиа',
        html: `<p>Вопрос и четыре варианта, верный — один. Вопросов 10, 20 или 30; темы — все или одна; сложность — лёгкие, средние,
          трудные или нарастающая (от школьных к вопросам для знатоков).</p>
          <p><b>Одному</b> — время на вопрос по желанию; очки — 100 за верный и до 100 за быстроту.
          <b>Компанией</b> — все отвечают одновременно, на скорость: 100 за верный + до 100 за быстроту (время считается по часам
          комнаты, с поправкой на задержку сети), первому верному ещё +50.</p>`,
        demo: triviaDemo,
      },
      {
        title: 'Кнопка',
        html: `<p>Вопрос показывается <b>без вариантов</b>, пока его читают — кнопка заперта. По сигналу она загорается: кто нажал первым —
          отвечает (выбор из четырёх или ввод с клавиатуры — по настройке), на ответ 7 секунд. Верно — очки (100 × трудность),
          неверно — столько же минус, и кнопка снова открыта для остальных. Нажал до сигнала — <b>фальстарт</b>: кнопка заблокирована на 0,8 с.</p>
          <p><b>Кто первый — решают часы, а не интернет.</b> Часы каждого игрока сверяются с комнатой (как у buzzin.live: круг «туда-обратно»,
          смещение по самому быстрому замеру). Нажатие помечается моментом касания по вашим часам и переводится в часы комнаты.
          Комната ждёт окно — столько, сколько может идти сообщение самого медленного игрока, — и только потом объявляет первого.
          На экране видно, на сколько миллисекунд он опередил второго.</p>`,
        demo: buzzDemo,
      },
      {
        title: 'Лестница к миллиону',
        html: `<p>15 вопросов, трудность растёт, суммы — от 100 до 1 000 000 ₽. Ошибка — уходите с <b>несгораемой</b> суммой
          (1 000 ₽ после пятого вопроса, 32 000 ₽ после десятого), до неё — ни с чем. Можно в любой момент <b>забрать деньги</b>.
          Компанией каждый проходит свою лестницу по очереди; кто унёс больше — победил.</p>`,
        demo: ladderDemo,
      },
      {
        title: 'Подсказки лестницы',
        html: `<p>На всю лестницу — по одной: <b>50 на 50</b> (убрать два неверных), <b>помощь зала</b> (столбики голосов — зал ошибается тем чаще,
          чем труднее вопрос), <b>звонок другу</b> (друг называет ответ и говорит, насколько уверен — и тоже может ошибиться).</p>`,
        demo: lifeDemo,
      },
      {
        title: 'Барабан',
        html: `<p>До трёх игроков по кругу отгадывают слово по подсказке. <b>Барабан крутит сам игрок</b> — взмахом по барабану
          или кнопкой. Выпало число — называете букву: есть — очки × столько, сколько раз она в слове, и крутите снова; нет — ход следующему.
          «×2» — угаданная буква удваивает очки тура, «Банкрот» — очки тура сгорают, «Ноль» — ход переходит, «Приз» — ведущий открывает
          случайную букву, и вам идёт по 100 за каждое её появление в слове, «Плюс» — открываете любую букву сами.</p>
          <p>Можно назвать слово целиком: угадали — по 100 за каждую неоткрытую букву, ошиблись — выбываете из тура.
          Три тура, потом <b>финал</b> для лидера: три буквы на выбор — и одно слово целиком (угадал — очки удваиваются). Можно играть один тур.</p>`,
        demo: wheelDemo,
      },
      {
        title: 'Сто опрошенных',
        html: `<p>«Мы спросили сто человек…» — шесть самых частых ответов спрятаны на табло. Ответ пишут с клавиатуры: засчитываются
          синонимы, другие окончания, перестановка слов и опечатка-другая. Одному — набрать как можно больше до трёх промахов.
          Компанией — две команды (места по очереди): команда называет ответы по кругу, после трёх промахов соперник
          <b>отыгрывается</b> — один ответ, угадал — забирает весь банк раунда.</p>
          <p>Раундов три: очки — число ответивших ×1, ×2, ×3. По желанию в конце — <b>обратная игра</b>: чем реже ответ, тем он дороже.</p>`,
        demo: pollDemo,
      },
      {
        title: 'Табло тем',
        html: `<p>Табло — 5 или 6 тем по 5 вопросов, цены от 100 до 500 (во втором раунде — новые темы, цены вдвое).
          Ячейку выбирает тот, кто последним ответил верно. Вопрос читается — и отвечает тот, кто первым нажал кнопку
          (как в «Кнопке»: с поправкой на задержку). Ответ — вводом (пишется как угодно: «Пётр I», «Петр Первый») или выбором из четырёх.
          Верно — плюс цена, неверно — минус цена, и кнопка снова открыта. Одному — все вопросы отвечаете сами.</p>`,
        demo: boardDemo,
      },
      {
        title: 'Верю — не верю',
        html: `<p>Ведущий говорит утверждение — примерно половина правдивы, половина нет. Отвечают «верю» или «не верю», все сразу,
          на скорость — очки как в тривиа.</p>`,
        demo: truthDemo,
      },
    ],
  },
};
