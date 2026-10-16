/* Кто я? — описание игры для сборника: персонаж на лбу, вопросы «да/нет» про себя, 3–10 игроков; подборки персонажей,
 * загадывает сосед или случайно, до первого угадавшего или до последнего; боты; правила с показом. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { esc } from '../../core/util';
import { choose } from './ai';
import { CHAR, POOLS } from './chars';
import { apply, makeView, redact, setup, toAct, type Action, type Event, type State, type View } from './engine';

export const SEATS = [
  ['Вовка', '#b3322a'], ['Ленка', '#2b5c9e'], ['Серёга', '#2f7a3e'], ['Танька', '#c48a12'], ['Димон', '#6a3d8f'],
  ['Светка', '#c2185b'], ['Жека', '#0f7a7a'], ['Михалыч', '#8a5a2a'], ['Олька', '#7a3aa0'], ['Колян', '#5a5a5a'],
].map(([name, color]) => ({ name, color, light: color, dark: color }));

export const ANS_TEXT = { y: 'да', n: 'нет', '?': 'не знаю' } as const;

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'pick':
      return `${name(ev.by)} загадал${ev.who ? ` для ${name(ev.to)}: <b>${esc(ev.who.name)}</b>` : ` персонажа для ${name(ev.to)}`}.`;
    case 'start':
      return `Все персонажи загаданы. Первым спрашивает ${name(ev.turn)}.`;
    case 'ask':
      return `${name(ev.seat)}: «${esc(ev.text || 'вопрос голосом')}»`;
    case 'answer':
      return null;
    case 'result':
      return `— ${ev.result === 'y' ? '<b>Да!</b> Спрашивает дальше.' : ev.result === 'n' ? `<b>Нет.</b> Ход — ${name(ev.next)}.` : `<b>Непонятно.</b> Ход — ${name(ev.next)}.`}`;
    case 'guess':
      return ev.right ? `🎉 ${name(ev.seat)}: «Я — ${esc(ev.guess)}!» — <b>угадал!</b>` : `${name(ev.seat)}: «Я — ${esc(ev.guess)}?» — нет. Ход — ${name(ev.next!)}.`;
    case 'over':
      return `🏆 Игра окончена: ${ev.done.map(name).join(', ')}.`;
  }
  return null;
}

const demoSeats = (n: number): SeatSpec[] => Array.from({ length: n }, (_, seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const fixed = (ids: string[]): State => {
  const s = setup(ids.map((_, i) => i), { pool: 'all', goal: 'all' }, { next: () => 0, int: () => 0, getState: () => 0 });
  ids.forEach((id, i) => (s.chars[i] = { id, name: CHAR[id].name }));
  s.phase = 'ask';
  return s;
};
const ASK = (seat: number, q: number, caption?: string) => ({ seat, action: { type: 'ask', q } as Action, caption });
const ANS = (seat: number, ans: 'y' | 'n' | '?', caption?: string) => ({ seat, action: { type: 'answer', ans } as Action, caption });

export const def: GameDef<State, Action, Event, View> = {
  id: 'whoami',
  title: 'Кто я?',
  players: { min: 3, max: 10, default: 4 },
  seats: SEATS,
  options: [
    { key: 'pool', label: 'Персонажи', type: 'select', choices: POOLS.map(([value, label]) => ({ value, label })), default: 'all' },
    {
      key: 'pick',
      label: 'Кто загадывает',
      type: 'select',
      choices: [
        { value: 'neighbor', label: 'сосед — тому, кто слева' },
        { value: 'random', label: 'случайно из списка' },
      ],
      default: 'neighbor',
      hint: 'С ботами люди выбирают из готового списка; одни люди — можно вписать своего.',
    },
    {
      key: 'goal',
      label: 'Играем',
      type: 'select',
      choices: [
        { value: 'all', label: 'пока не угадают все, кроме последнего' },
        { value: 'first', label: 'до первого угадавшего' },
      ],
      default: 'all',
    },
  ],
  presets: [
    { id: 'all', label: 'Все подряд', hint: 'Знаменитости и вымышленные герои', options: { pool: 'all' } },
    { id: 'real', label: 'Знаменитости', hint: 'Исторические личности, актёры, музыканты, спортсмены', options: { pool: 'real' } },
    { id: 'fiction', label: 'Герои', hint: 'Кино, книги, мультфильмы, игры, сказки', options: { pool: 'fiction' } },
    { id: 'ours', label: 'Наши', hint: 'Только из России и СССР', options: { pool: 'ours' } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng, seats.filter((x) => x.kind !== 'bot').map((x) => x.seat)),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  redact,
  result(s) {
    if (s.phase !== 'over') return null;
    const n = s.seats.length;
    const scores: Record<number, number> = {};
    for (const x of s.seats) scores[x] = s.done.includes(x) ? n - s.done.indexOf(x) : 0;
    return { winners: s.done.slice(0, 1), text: 'первым угадал себя', scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    const s = fixed(['gagarin', 'cheburashka_char', 'sherlock_holmes_char', 'pugacheva_person', 'shrek_char']);
    s.turn = 1;
    s.log = [
      { seat: 0, q: 0, text: 'Я реальный человек?', result: 'y' },
      { seat: 0, q: 3, text: 'Я наш — из России или СССР?', result: 'n' },
      { seat: 1, q: 11, text: 'Я из мультфильма?', result: 'y' },
      { seat: 1, q: 3, text: 'Я наш — из России или СССР?' },
    ];
    s.phase = 'answer';
    s.answers = { 0: 'y', 2: 'y' };
    return s;
  },

  rules: {
    goal: 'У каждого на лбу персонаж — все его видят, кроме тебя самого. Задавай вопросы «да/нет» и догадайся, кто ты.',
    sections: [
      {
        title: 'Загадывание',
        html: `<p>Каждый загадывает персонажа соседу слева — знаменитость или героя кино, книги, мультфильма, игры. Карточка висит над кружком игрока:
          всем видно, кроме него самого. Можно и случайно из списка. С ботами люди выбирают из готового списка, одни люди — могут вписать своего.</p>`,
      },
      {
        title: 'Вопросы',
        html: `<p>В свой ход спрашиваешь про себя: «Я реальный человек?», «Я из мультфильма?». Остальные отвечают <b>да</b>, <b>нет</b> или <b>не знаю</b> — решает большинство.
          «Да» — спрашиваешь дальше, «нет» или непонятно — ход переходит к соседу. Боты понимают готовые вопросы; свои вопросы (текстом или голосом) — когда играют одни люди.</p>`,
        demo: {
          seats: demoSeats(4),
          setup: () => fixed(['cheburashka_char', 'gagarin', 'shrek_char', 'pushkin']),
          intro: 'Вовке загадан Чебурашка. Остальные это видят, Вовка — нет.',
          steps: [
            ASK(0, 0, 'Вовка: «Я реальный человек?»'),
            ANS(1, 'n'),
            ANS(2, 'n'),
            ANS(3, 'n', 'Все ответили «нет» — ход переходит к Ленке.'),
            ASK(1, 0, 'Ленка: «Я реальный человек?»'),
            ANS(0, 'y'),
            ANS(2, 'y'),
            ANS(3, 'y', '«Да!» — Ленка спрашивает дальше.'),
          ],
        },
      },
      {
        title: 'Догадка',
        html: `<p>В свой ход можно сказать «Я — …!». Угадал — ты выбыл победителем, места по порядку. Не угадал — ход переходит.
          Играют, пока не останется один, или до первого угадавшего.</p>`,
        demo: {
          seats: demoSeats(3),
          setup: () => {
            const s = fixed(['cheburashka_char', 'gagarin', 'shrek_char']);
            s.log = [
              { seat: 0, q: 0, text: 'Я реальный человек?', result: 'n' },
              { seat: 0, q: 11, text: 'Я из мультфильма?', result: 'y' },
              { seat: 0, q: 3, text: 'Я наш — из России или СССР?', result: 'y' },
            ];
            return s;
          },
          intro: 'Вовка уже знает: не человек, из мультфильма, наш.',
          steps: [{ seat: 0, action: { type: 'guess', id: 'cheburashka_char' } as Action, caption: '«Я — Чебурашка!» — угадал, первое место.' }],
        },
      },
    ],
  },
};
