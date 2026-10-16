/* Шляпа — описание игры для сборника: объясни партнёру как можно больше слов из шляпы, пока не вышло время. 2–10 игроков;
 * пары каждый с каждым или постоянные команды; один круг или три (словами, жестами, одним словом); словарь или свои слова;
 * пропуск, ошибка, последнее слово — настройками. Боты объясняют и угадывают подсказками из словаря. Правила с показом. Без DOM. */
import type { GameDef, SeatSpec, Rng } from '../../core/types';
import { esc } from '../../core/util';
import { choose } from './ai';
import { apply, makeView, redact, setup, teamsOf, teamScore, toAct, total, type Action, type Event, type State, type View } from './engine';
import { LEVELS, WORDS } from './words';

export const SEATS = [
  ['Вовка', '#b3322a'], ['Ленка', '#2b5c9e'], ['Серёга', '#2f7a3e'], ['Танька', '#c48a12'], ['Димон', '#6a3d8f'],
  ['Светка', '#c2185b'], ['Жека', '#0f7a7a'], ['Михалыч', '#8a5a2a'], ['Олька', '#7a3aa0'], ['Колян', '#5a5a5a'],
].map(([name, color]) => ({ name, color, light: color, dark: color }));

export const ROUND_NAME = ['словами', 'жестами', 'одним словом'];
export const ROUND_HOW = [
  'Объясняйте словами: нельзя однокоренные, переводы и «звучит как».',
  'Только жестами и мимикой — ни звука, ни слова.',
  'Ровно одно слово — и ни одного больше.',
];

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'written':
      return `${name(ev.seat)} положил слова в шляпу.`;
    case 'hatReady':
      return `В шляпе ${ev.total} слов.`;
    case 'pair':
      return null;
    case 'start':
      return `${name(ev.exp)} объясняет, ${name(ev.gue)} угадывает.`;
    case 'hint':
      return `${name(ev.seat)}: «${esc(ev.hint.text)}»`;
    case 'guess':
      return ev.right ? null : `${name(ev.seat)}: «${esc(ev.text)}?» — нет.`;
    case 'got':
      return `✓ <b>${esc(ev.w)}</b>${ev.last ? ' — последнее слово!' : ''}`;
    case 'miss':
      return `✗ ${ev.w ? `<b>${esc(ev.w)}</b> — ` : ''}ошибка, слово ${ev.burn ? 'сгорело' : 'вернулось в шляпу'}.`;
    case 'skip':
      return `⏭ Пропуск${ev.penalty ? ' (−1)' : ''}.`;
    case 'timeup':
      return ev.last ? '⏰ Время! Последнее слово…' : '⏰ Время!';
    case 'turnEnd':
      return `${name(ev.exp)} → ${name(ev.gue)}: <b>${ev.got}</b> ${plural(ev.got)}.${ev.empty ? ' Шляпа опустела!' : ''}`;
    case 'round':
      return `🎩 Круг ${ev.round + 1}: ${ROUND_NAME[ev.round]}. Все слова снова в шляпе.`;
    case 'over':
      return '🏆 Слова кончились — игра окончена.';
  }
  return null;
}

export const plural = (n: number) => {
  const a = Math.abs(n) % 100;
  const b = a % 10;
  return a > 10 && a < 20 ? 'слов' : b === 1 ? 'слово' : b >= 2 && b <= 4 ? 'слова' : 'слов';
};

// ---------------------------------------------------------------- показ правил

const W = (w: string) => {
  const i = WORDS.findIndex((e) => e.w === w);
  return i >= 0 ? { w, i } : { w };
};
const rngZero: Rng = { next: () => 0, int: () => 0, getState: () => 0 };
const demoSeats = (n: number, humans = 0): SeatSpec[] =>
  Array.from({ length: n }, (_, seat) => ({ seat, kind: seat < humans ? 'human' : 'bot', name: SEATS[seat].name, level: 1 }));
/** Позиция для показа: свои бумажки, первая вытянется первой (rng подкручен на 0). */
function fixed(n: number, words: string[], humans: number[], opts: Record<string, unknown> = {}): State {
  const s = setup(
    Array.from({ length: n }, (_, i) => i),
    { per: 1, time: 30, ...opts } as never,
    rngZero,
    humans
  );
  s.slips = words.map(W);
  s.hat = s.slips.map((_, k) => k);
  return s;
}
const step = (seat: number, action: Action, caption?: string, rig?: number[]) => ({ seat, action, caption, ...(rig ? { rig } : {}) });

export const def: GameDef<State, Action, Event, View> = {
  id: 'hat',
  title: 'Шляпа',
  players: { min: 2, max: 10, default: 4 },
  countsFor: (o) => (o.pairs === 'teams' ? [4, 6, 8, 10] : [2, 3, 4, 5, 6, 7, 8, 9, 10]),
  countsHint: (o) => (o.pairs === 'teams' ? 'командами по двое — чётное число' : undefined),
  seats: SEATS,
  options: [
    {
      key: 'time',
      label: 'Время на ход',
      type: 'select',
      choices: [20, 30, 40, 60].map((value) => ({ value, label: `${value} секунд` })),
      default: 30,
    },
    {
      key: 'source',
      label: 'Слова',
      type: 'select',
      choices: [
        { value: 'dict', label: 'из словаря' },
        { value: 'own', label: 'пишут сами игроки' },
      ],
      default: 'dict',
      hint: 'Свои слова — когда играют одни люди: боты объясняют только словарными подсказками.',
    },
    { key: 'level', label: 'Сложность слов', type: 'select', choices: LEVELS.map(([value, label]) => ({ value, label })), default: 'mid', showIf: (o) => o.source !== 'own' },
    { key: 'per', label: 'Слов на игрока', type: 'select', choices: [5, 8, 10, 15].map((value) => ({ value, label: String(value) })), default: 8 },
    {
      key: 'pairs',
      label: 'Пары',
      type: 'select',
      choices: [
        { value: 'circle', label: 'каждый с каждым по кругу' },
        { value: 'teams', label: 'постоянные команды по двое' },
      ],
      default: 'circle',
    },
    {
      key: 'rounds',
      label: 'Круги',
      type: 'select',
      choices: [
        { value: 1, label: 'один — словами' },
        { value: 3, label: 'три — словами, жестами, одним словом' },
      ],
      default: 1,
    },
    {
      key: 'skip',
      label: 'Пропуск слова',
      type: 'select',
      choices: [
        { value: 'free', label: 'можно, без штрафа' },
        { value: 'penalty', label: 'можно, минус очко паре' },
        { value: 'off', label: 'нельзя' },
      ],
      default: 'free',
    },
    {
      key: 'miss',
      label: 'Ошибка объясняющего',
      type: 'select',
      choices: [
        { value: 'burn', label: 'слово сгорает' },
        { value: 'return', label: 'слово возвращается в шляпу' },
      ],
      default: 'burn',
      hint: 'Однокоренное слово, перевод, «звучит как», показ на предмет.',
    },
    { key: 'last', label: 'Последнее слово после сигнала', type: 'toggle', default: true, hint: 'Ещё три секунды, чтобы партнёр успел назвать слово.' },
  ],
  presets: [
    { id: 'classic', label: 'Обычная шляпа', hint: 'Один круг словами, 30 секунд, каждый с каждым', options: { rounds: 1, time: 30, pairs: 'circle', source: 'dict', skip: 'free' } },
    { id: 'three', label: 'Три круга', hint: 'Те же слова: словами, потом жестами, потом одним словом', options: { rounds: 3, time: 40, per: 5, pairs: 'circle', source: 'dict', skip: 'free' } },
    { id: 'teams', label: 'Командами', hint: 'Постоянные пары; счёт — у команды', options: { rounds: 1, time: 30, pairs: 'teams', source: 'dict' } },
    { id: 'blitz', label: 'Блиц', hint: '20 секунд, пропуск — минус очко, трудные слова', options: { rounds: 1, time: 20, level: 'hard', skip: 'penalty', miss: 'burn', source: 'dict' } },
    { id: 'own', label: 'Свои слова', hint: 'Каждый тайно пишет слова в шляпу (только люди)', options: { source: 'own', per: 8, rounds: 1, time: 30 } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng, seats.filter((x) => x.kind !== 'bot').map((x) => x.seat)),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  redact,
  result(s) {
    if (s.phase !== 'over') return null;
    const scores: Record<number, number> = {};
    if (s.pairs === 'teams') {
      const teams = teamsOf(s.seats);
      const sc = teams.map((t) => teamScore(s, t));
      const best = Math.max(...sc);
      teams.forEach((t, j) => t.forEach((x) => (scores[x] = sc[j])));
      return { winners: teams.filter((_, j) => sc[j] === best).flat(), text: `команда объяснила больше всех слов (${best})`, scores };
    }
    for (const x of s.seats) scores[x] = total(s, x);
    const best = Math.max(...s.seats.map((x) => scores[x]));
    return { winners: s.seats.filter((x) => scores[x] === best), text: `больше всех очков: объяснил и угадал ${best}`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    const s = fixed(5, ['самолёт', 'берёза', 'балалайка', 'ёлка', 'футбол', 'самовар', 'кот', 'гармошка', 'валенок', 'матрёшка'], [], {});
    s.phase = 'explain';
    s.exp = 0;
    s.gue = 1;
    s.virt = true;
    s.cur = 0;
    s.hat = [5, 6, 7, 8, 9];
    s.seq = 4;
    s.turn = [
      { slip: 1, w: 'берёза', res: 'got' },
      { slip: 2, w: 'балалайка', res: 'got' },
      { slip: 3, w: 'ёлка', res: 'skip' },
    ];
    s.hat.push(3);
    s.hints = [{ kind: 'long', text: 'Авиационное средство тяжелее воздуха' }];
    s.used = 13000;
    s.need = 'guess';
    s.expl = { 0: 5, 1: 3, 2: 4, 3: 2, 4: 3 };
    s.gues = { 0: 3, 1: 6, 2: 2, 3: 4, 4: 2 };
    s.seen = [1, 2];
    s.log = [
      { round: 0, exp: 3, gue: 4, got: 4 },
      { round: 0, exp: 4, gue: 0, got: 3 },
    ];
    s.t = 5;
    return s;
  },

  rules: {
    goal: 'Объясни партнёру как можно больше слов из шляпы, пока не вышло время. Очко за слово получают оба — и объяснивший, и угадавший.',
    sections: [
      {
        title: 'Шляпа',
        html: `<p>Перед игрой в шляпу кладут слова — по несколько на каждого игрока: из словаря нужной сложности или свои
          (каждый тайно пишет свои бумажки). Слова — существительные: «самовар», «берёза», «гармошка».</p>
          <p>Пока шляпа не опустела, ходят по очереди: объясняющий тянет бумажку и объясняет слово партнёру. Время хода — 20, 30, 40 или 60 секунд.</p>`,
      },
      {
        title: 'Ход',
        html: `<p>Объясняющий видит слово и объясняет его — словами, как угодно, только <b>нельзя</b> называть однокоренные слова, переводить на другие языки,
          говорить «звучит как…» и показывать на предметы. Партнёр угадывает вслух. Угадал — бумажка в зачёт, тянется следующая.</p>
          <p>На телефоне по кругу: объясняющий держит телефон, видит слово крупно и жмёт <b>«Угадано»</b>. По сети слово видит только объясняющий, объясняет голосом.</p>`,
        demo: {
          seats: demoSeats(3, 3),
          setup: () => fixed(3, ['самовар', 'берёза', 'гармошка', 'валенок'], [0, 1, 2]),
          intro: 'Вовка объясняет Ленке. Слово видит только он.',
          steps: [
            step(0, { type: 'start' }, 'Вовка тянет бумажку: «самовар». «Пузатый, медный, на нём чай кипятят…»', [0]),
            step(0, { type: 'got' }, 'Ленка: «Самовар!» — угадано, очко обоим. Следующая бумажка.', [0]),
            step(0, { type: 'got' }, '«Белая, с чёрными пятнышками, растёт в роще…» — «Берёза!»', [0]),
          ],
        },
      },
      {
        title: 'Ошибка и пропуск',
        html: `<p><b>Ошибка</b> — объясняющий сказал однокоренное слово или перевод: слово сгорает (или, по настройке, возвращается в шляпу), очка нет.</p>
          <p><b>Пропуск</b> — слово не идёт: бумажка возвращается в шляпу, в этот ход её больше не вытянут. По настройке — без штрафа, минус очко паре или пропускать нельзя совсем.</p>`,
        demo: {
          seats: demoSeats(3, 3),
          setup: () => fixed(3, ['балалайка', 'валенок', 'матрёшка'], [0, 1, 2], { skip: 'penalty' }),
          intro: 'Пропуск со штрафом.',
          steps: [
            step(0, { type: 'start' }, '«Балалайка». Вовка: «На ней балалаечник играет…» — однокоренное!', [0]),
            step(0, { type: 'miss' }, 'Ошибка: слово сгорело.', [0]),
            step(0, { type: 'skip' }, '«Валенок» никак не объясняется — пропуск, минус очко Вовке и Ленке.', [0]),
          ],
        },
      },
      {
        title: 'Время и последнее слово',
        html: `<p>Звучит сигнал — ход окончен. Слово, которое не успели, возвращается в шляпу.
          С правилом <b>«последнее слово»</b> у партнёра есть ещё три секунды, чтобы назвать его, — объяснять дальше нельзя.</p>`,
        demo: {
          seats: demoSeats(3, 3),
          setup: () => fixed(3, ['валенок', 'матрёшка'], [0, 1, 2]),
          intro: 'Время почти вышло.',
          steps: [
            step(0, { type: 'start' }, '«Валенок»: «Зимой на ноги, из войлока…»', [0]),
            step(0, { type: 'timeup' }, 'Сигнал! Последнее слово — у Ленки три секунды.'),
            step(0, { type: 'got' }, 'Ленка успела: «Валенок!» — засчитано.'),
          ],
        },
      },
      {
        title: 'Пары и счёт',
        html: `<p><b>Каждый с каждым</b> (классика, подходит и для нечётного числа): игроки по кругу объясняют соседу через одного, двух… —
          после каждого круга партнёр сдвигается, так что каждый успевает поиграть с каждым. Очко за слово — и объяснившему, и угадавшему; побеждает тот, у кого больше.</p>
          <p><b>Командами</b> — постоянные пары (сидят друг напротив друга), объясняют по очереди, роли в паре меняются. Счёт — у команды.</p>
          <p>Игра кончается, когда шляпа опустела.</p>`,
        demo: {
          seats: demoSeats(3, 3),
          setup: () => fixed(3, ['самовар', 'берёза', 'валенок', 'матрёшка', 'балалайка', 'гармошка'], [0, 1, 2], { last: false }),
          intro: 'Трое, каждый с каждым.',
          steps: [
            step(0, { type: 'start' }, 'Вовка объясняет Ленке.', [0]),
            step(0, { type: 'got' }, '«Самовар» — очко Вовке и Ленке.', [0]),
            step(0, { type: 'timeup' }, 'Время!'),
            step(0, { type: 'next' }, 'Дальше Ленка объясняет Серёге…'),
            step(1, { type: 'start' }, undefined, [0]),
            step(1, { type: 'timeup' }),
            step(1, { type: 'next' }, '…Серёга — Вовке. Круг прошёл — партнёр сдвигается:'),
            step(2, { type: 'start' }, undefined, [0]),
            step(2, { type: 'timeup' }),
            step(2, { type: 'next' }, 'теперь Вовка объясняет Серёге — через одного.'),
          ],
        },
      },
      {
        title: 'Три круга',
        html: `<p>Те же слова играют трижды: сначала <b>словами</b>, потом шляпу наполняют снова и показывают <b>жестами</b> (ни звука),
          в третьем круге — <b>одним словом</b>. Слова к концу знакомые — тем и смешно. Очки за все круги складываются.</p>`,
      },
      {
        title: 'Боты',
        html: `<p>Голосом бот не объясняет и не слышит — играет честно, подсказками из словаря: сначала подробное толкование, потом короткое
          (во втором круге вместо жестов — коротко, в третьем — одним словом). Угадывает, перебирая слова, подходящие к подсказке; лёгкий бот думает дольше и чаще не узнаёт слово.</p>
          <p>Человек, угадывающий за ботом, печатает слово или выбирает из вариантов. Объясняя боту, человек даёт ему словарные подсказки кнопкой.
          Свои слова — только когда играют одни люди.</p>`,
        demo: {
          seats: demoSeats(3),
          setup: () => fixed(3, ['самолёт', 'кот'], []),
          intro: 'Два бота: Вовка объясняет Ленке подсказками из словаря.',
          steps: [
            step(0, { type: 'start' }, undefined, [0]),
            step(0, { type: 'hint', dt: 4000 }, 'Вовка даёт подробную подсказку.'),
            step(1, { type: 'guess', text: 'дирижабль', dt: 2000 }, 'Ленка: «Дирижабль?» — нет.'),
            step(0, { type: 'hint', dt: 3000 }, 'Ещё подсказка — короче.'),
            step(1, { type: 'guess', text: 'самолёт', dt: 1500 }, '«Самолёт!» — угадано.', [0]),
          ],
        },
      },
      {
        title: 'Слова и авторы',
        html: `<p>Словарь — ${WORDS.length.toLocaleString('ru')} существительных трёх уровней сложности. Список слов — «Russian Nouns» Антона Сергиенко
          (<a href="https://github.com/Harrix/Russian-Nouns" target="_blank" rel="noopener">github.com/Harrix/Russian-Nouns</a>, лицензия MIT).
          Толкования, по которым объясняют боты, написаны для сборника заново (вопросы кроссворда), смысл сверялся с Викисловарём (CC BY-SA).</p>`,
      },
    ],
  },
};
