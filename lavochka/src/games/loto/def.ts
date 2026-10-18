/* Лото — описание игры для сборника: русское лото (бочонки, присказки, ряд → два ряда → вся карточка)
 * и географическое «Вокруг света» (1972). Боты, правила с показом. Без DOM. */
import type { DemoStep, GameDef, SeatSpec } from '../../core/types';
import { apply, cardNums, free, makeView, ownerOf, picsOf, score, setup, STAGES, toAct, type Action, type Card, type Event, type State, type View } from './engine';
import { SeededRng } from '../../core/rng';
import { barrelCall } from './names';
import { WORLD_SHEETS } from './world-data';

export const SEATS = [
  { name: 'Бабушка', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Дед', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Серёга', color: '#2f7a3e', light: '#58ad66', dark: '#18452a' },
  { name: 'Танька', color: '#d9a521', light: '#f3cf62', dark: '#8a6410', ink: '#8a6410' },
  { name: 'Дядя Витя', color: '#7a3e9e', light: '#a872c8', dark: '#43205a' },
  { name: 'Светка', color: '#1f8a8a', light: '#58bdbd', dark: '#0f4a4a' },
  { name: 'Вовка', color: '#c0602a', light: '#e8915c', dark: '#6a3010' },
  { name: 'Ленка', color: '#9e2b6a', light: '#cf5f9c', dark: '#5a1a3c' },
];

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'draw':
      return `${name(ev.seat)}: «${barrelCall(ev.n, ev.k)}»`;
    case 'prize':
      return `🎉 ${name(ev.seat)} закрыл${STAGES[ev.stage] === 'вся карточка' ? ' всю карточку' : ` ${STAGES[ev.stage]}`}${ev.shared ? ' — делят на том же бочонке' : ''}!`;
    case 'read':
      return `${name(ev.seat)} читает карточку${ev.again ? ' (второй раз)' : ''}.`;
    case 'take':
      return `${name(ev.seat)}: «${ev.text}!» — верно, закрывает.`;
    case 'wrong':
      return `${name(ev.seat)}: «${ev.text}?» — нет.`;
    case 'unknown':
      return ev.lost ? `Никто не узнал «${ev.text}» — карточка уходит в коробку.` : 'Никто не узнал — карточка уходит под низ колоды.';
    case 'end':
      return '🏁 Партия окончена.';
  }
  return null;
}

// ---------------------------------------------------------------- боты

function choose(v: View, seat: number, level: number, rng: { next(): number; int(n: number): number }): Action | null {
  if (v.cfg.mode === 'russian') return v.over || v.seats[v.turn] !== seat ? null : { type: 'draw' };
  if (v.current == null || seat in v.answers) return null;
  const mine = picsOf(v, seat).filter((x) => !v.covered.includes(x));
  const owner = ownerOf(v, v.current);
  const know = [0.6, 0.85, 0.97][level] ?? 0.85;
  if (owner === seat) {
    if (rng.next() < know) return { type: 'answer', pic: v.current };
    // не узнал: промолчал или ошибся
    return rng.next() < 0.5 || !mine.length ? { type: 'answer', pic: 0 } : { type: 'answer', pic: mine[rng.int(mine.length)] };
  }
  // чужая — лёгкий иногда путает
  if (level === 0 && mine.length && rng.next() < 0.05) return { type: 'answer', pic: mine[rng.int(mine.length)] };
  return { type: 'answer', pic: 0 };
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1, 2].map((seat) => ({ seat, kind: seat === 0 ? 'human' : 'bot', name: SEATS[seat].name, level: 2 }));
const card = (rows: number[][], tint = 0): Card => ({ rows, tint, marked: [] });

/** Позиция русского лото: у каждого одна карточка, мешок без выпавших. */
function rpos(cards: Card[][], called: number[] = [], opts: Partial<State['cfg']> = {}): State {
  const s = setup(demoSeats, { mode: 'russian', cards: 1, goal: 'stages', ...opts }, new SeededRng(7));
  cards.forEach((c, i) => (s.cards[i] = c.map((x) => ({ ...x, rows: x.rows.map((r) => r.slice()), marked: [] }))));
  s.called = called.slice();
  s.bag = Array.from({ length: 90 }, (_, i) => i + 1).filter((n) => !called.includes(n));
  for (const p of s.seats) for (const c of s.cards[p]) c.marked = cardNums(c).filter((n) => called.includes(n));
  return s;
}
const C1 = card(
  [
    [3, 0, 21, 0, 47, 0, 63, 0, 81],
    [0, 11, 25, 35, 0, 52, 0, 75, 0],
    [8, 15, 0, 30, 0, 55, 62, 72, 0],
  ],
  0
);
const C2 = card(
  [
    [0, 14, 0, 33, 41, 0, 66, 0, 88],
    [5, 0, 26, 0, 49, 57, 0, 77, 0],
    [9, 0, 28, 39, 0, 0, 69, 0, 90],
  ],
  1
);
const C3 = card(
  [
    [1, 0, 22, 0, 44, 50, 0, 70, 0],
    [0, 17, 0, 36, 0, 58, 64, 0, 85],
    [7, 19, 29, 0, 0, 0, 68, 79, 0],
  ],
  2
);
function draws(s0: State, seq: number[], captions: (string | undefined)[]): DemoStep<Action>[] {
  const bag = s0.bag.slice();
  return seq.map((n, i) => {
    const idx = bag.indexOf(n);
    bag.splice(idx, 1);
    return { seat: i % 3, action: { type: 'draw' }, rig: [idx, 0], caption: captions[i] };
  });
}

/** «Вокруг света»: у троих по листу, текущая карточка — заданная. */
function wpos(current: number, sheets: number[][] = [[4], [0], [9]], covered: number[] = []): State {
  const s = setup(demoSeats, { mode: 'world' }, new SeededRng(7));
  sheets.forEach((sh, i) => (s.sheets[i] = sh));
  s.covered = covered;
  s.deck = [current, ...WORLD_SHEETS.flat().filter((n) => n !== current && !covered.includes(n))];
  s.current = s.deck.shift()!;
  s.answers = {};
  return s;
}

const demoRussian = rpos([[C1], [C2], [C3]]);
const demoRow = rpos([[C1], [C2], [C3]], [3, 21, 47, 63, 14, 33, 90]);

export const def: GameDef<State, Action, Event, View> = {
  id: 'loto',
  title: 'Лото',
  players: { min: 2, max: 8, default: 4 },
  seats: SEATS,
  options: [
    {
      key: 'mode',
      label: 'Лото',
      type: 'select',
      choices: [
        { value: 'russian', label: 'Русское: бочонки 1–90' },
        { value: 'world', label: '«Вокруг света» (географическое, 1972)' },
      ],
      default: 'russian',
    },
    {
      key: 'cards',
      label: 'Карточек у каждого',
      type: 'select',
      choices: [
        { value: 1, label: 'одна' },
        { value: 2, label: 'две' },
        { value: 3, label: 'три' },
      ],
      default: 2,
      showIf: (o) => o.mode !== 'world',
    },
    {
      key: 'goal',
      label: 'До чего играем',
      type: 'select',
      choices: [
        { value: 'stages', label: 'ряд → два ряда → вся карточка' },
        { value: 'row', label: 'короткая: первый закрытый ряд' },
        { value: 'card', label: 'длинная: вся карточка' },
      ],
      default: 'stages',
      showIf: (o) => o.mode !== 'world',
    },
    { key: 'auto', label: 'Фишки кладутся сами', type: 'toggle', default: false, hint: 'Иначе вышедшие числа закрываешь сам — прозевал, сам виноват.', showIf: (o) => o.mode !== 'world' },
    {
      key: 'edition',
      label: 'Издание',
      type: 'select',
      choices: [
        { value: '72', label: '1972: 16 карт по 8 картинок' },
        { value: '80', label: '1980: 20 карт по 6 картинок' },
      ],
      default: '72',
      hint: 'Вопросы почти те же, рисунки другие: в 1972-м — Васильев и Крутцова, в 1980-м — Флоренская и Никеев.',
      showIf: (o) => o.mode === 'world',
    },
    { key: 'hint', label: 'Подсказка «это у тебя»', type: 'toggle', default: false, hint: 'Для малышей: карта мигает, если ответ на ней.', showIf: (o) => o.mode === 'world' },
  ],
  presets: [
    { id: 'russian', label: 'Русское лото', hint: 'Бочонки с присказками, ряд → два ряда → карточка', options: { mode: 'russian', cards: 2, goal: 'stages', auto: false } },
    { id: 'short', label: 'Короткое', hint: 'Кто первым закроет ряд', options: { mode: 'russian', cards: 2, goal: 'row', auto: false } },
    { id: 'long', label: 'Длинное', hint: 'Кто первым закроет всю карточку', options: { mode: 'russian', cards: 3, goal: 'card', auto: false } },
    { id: 'world', label: 'Вокруг света', hint: 'Географическое лото 1972 года: узнай картинку по описанию', options: { mode: 'world', edition: '72', hint: false } },
    { id: 'world80', label: 'Вокруг света-80', hint: 'Издание 1980 года в жёлтой коробке с птицей: 20 карт по 6 картинок', options: { mode: 'world', edition: '80', hint: false } },
  ],

  setup: (seats, opts, rng) => setup(seats, opts, rng),
  toAct,
  free,
  apply,
  view: (s, seats) => makeView(s, seats),
  result(s) {
    if (!s.over) return null;
    const scores: Record<number, number> = {};
    for (const p of s.seats) scores[p] = score(s, p);
    if (s.cfg.mode === 'world') {
      const best = Math.max(...s.seats.map((p) => scores[p]));
      const w = s.seats.filter((p) => scores[p] === best);
      return { winners: w, text: 'закрыл все свои картинки первым', scores };
    }
    const last = Math.max(...s.prizes.map((x) => x.stage), -1);
    const w = [...new Set(s.prizes.filter((x) => x.stage === last).map((x) => x.seat))];
    return { winners: w, text: last >= 0 ? `закрыл ${last === 2 ? 'всю карточку' : STAGES[last]}` : 'мешок кончился', scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    const s = rpos([[C1, C2], [C3], [C2]], [3, 21, 47, 11, 25, 52, 75, 30, 62, 90, 14, 41, 66, 88, 57]);
    s.seats = [0, 1, 2];
    s.callKey = 0;
    return s;
  },

  rules: {
    goal: 'Первым закрыть фишками числа на своей карточке — ряд, два ряда или всю. В «Вокруг света» — первым закрыть все картинки на своих картах.',
    sections: [
      {
        title: 'Бочонки и карточки',
        html: `<p>В мешке 90 бочонков с числами от 1 до 90. У каждого — карточки: три ряда по пять чисел. Мешок ходит по кругу: кто тянет, тот
          выкрикивает номер — по-дворовому, с присказкой: «11 — барабанные палочки!», «90 — дедушка!».</p>
          <p>Вышло число, которое есть на твоей карточке, — <b>закрой его фишкой сам</b> (нажми на число). Прозевал — никто не подскажет.
          Если лень следить — включи «Фишки кладутся сами».</p>`,
        demo: { seats: demoSeats, setup: () => demoRussian, intro: 'Мешок пошёл по кругу.', steps: [
            ...draws(demoRussian, [11, 90, 47], ['Бабушка тянет: «11 — барабанные палочки!» У неё на карточке есть 11.', 'Дед: «90 — дедушка!» — у Деда в нижнем ряду.', 'Серёга: «47 — баба ягодка совсем!»']),
            { seat: 0, action: { type: 'mark', card: 0, n: 11 }, caption: 'Бабушка закрывает 11 фишкой…' },
            { seat: 0, action: { type: 'mark', card: 0, n: 47 }, caption: '…и 47. Боты закрывают свои числа сами.' },
          ] },
      },
      {
        title: 'Ряд, два ряда, вся карточка',
        html: `<p>Первым закрыл целый ряд (все пять чисел в строке) — взял первый приз. Дальше играют на <b>два ряда</b> одной карточки,
          потом — на <b>всю карточку</b>: кто закрыл её первым, тот выиграл партию. Закрыли на одном бочонке двое — делят приз.</p>
          <p>Короткая партия — до первого ряда, длинная — сразу на всю карточку.</p>`,
        demo: { seats: demoSeats, setup: () => demoRow, intro: 'У Бабушки в верхнем ряду не хватает только 81.', steps: [
            ...draws(demoRow, [81], ['Бабушка тянет: «81 — бабушка с клюкой!»']),
            { seat: 0, action: { type: 'mark', card: 0, n: 81 }, caption: 'Закрыла 81 — верхний ряд целиком, первый приз у Бабушки. Теперь играют на два ряда.' },
          ] },
      },
      {
        title: '«Вокруг света»',
        html: `<p>Географическое лото О. Н. Мамаевой. Два издания: 1972 года (художники И. И. Васильев и А. К. Крутцова, 16 больших карт
          по 8 картинок; у нас 15 — шестнадцатая не сохранилась) и 1980 года в жёлтой коробке с птицей (Н. А. Флоренская и Г. Г. Никеев,
          20 карт по 6 картинок, 120 карточек). Большие карты раздают поровну.</p>
          <p>Ведущий читает карточку: «Самая длинная параллель». У кого на карте подходящая картинка — узнаёт её и называет (нажми на картинку).
          Угадал — получает карточку и закрывает картинку. Не у тебя — «Не у меня». Никто не узнал — карточка уходит под низ, а со второго
          раза — в коробку. Выигрывает тот, кто первым закроет все свои картинки.</p>`,
        demo: {
          seats: demoSeats,
          options: { mode: 'world' },
          setup: () => wpos(34, [[4], [0], [9]]),
          intro: 'Карточка 34. Ю. А. Гагарин — на карте у Бабушки.',
          steps: [
            { seat: 0, action: { type: 'answer', pic: 34 }, caption: '«Гагарин!» — верно.' },
            { seat: 1, action: { type: 'answer', pic: 0 }, caption: 'Дед: «Не у меня».' },
            { seat: 2, action: { type: 'answer', pic: 0 }, caption: 'Бабушка получает карточку и закрывает картинку.' },
          ],
        },
      },
    ],
  },
};

