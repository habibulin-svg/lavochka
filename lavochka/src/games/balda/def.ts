/* Балда — описание игры: поле 5×5 / 6×6 / 7×7, диагонали по желанию, 2–4 игрока; боты, правила с показом. Без DOM.
 * Словарь должен быть загружен до setup (loadDict в defs.ts и в index.ts). */
import { SeededRng } from '../../core/rng';
import type { GameDef, SeatSpec } from '../../core/types';
import { plural } from '../../core/util';
import { choose } from './ai';
import { apply, cfgFrom, newGame, toAct, winners, type Action, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Вовка', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Серёга', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Ленка', color: '#2f7a3a', light: '#5fae6a', dark: '#18421f' },
  { name: 'Танька', color: '#7a3f8f', light: '#a874bb', dark: '#41204d' },
];

const END: Record<string, string> = {
  full: 'Поле заполнено.',
  passes: 'Все пропустили ход — слов больше нет.',
  resign: 'Остался один игрок.',
};

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'word':
      return `${name(ev.seat)}: <b>${ev.word.toUpperCase()}</b> (+${ev.points})`;
    case 'pass':
      return `${name(ev.seat)} пропускает ход.`;
    case 'resign':
      return `🏳 ${name(ev.seat)} сдаётся.`;
    case 'end':
      return `<i>${END[ev.reason]}</i>`;
  }
  return null;
}

const demoSeats: SeatSpec[] = SEATS.slice(0, 2).map((x, seat) => ({ seat, kind: 'bot', name: x.name, level: 1 }));
const fixed = (o: Record<string, unknown> = {}) => newGame([0, 1], cfgFrom(o as never), new SeededRng(1), 'балда');
const word = (seat: number, cell: number, letter: string, path: number[], caption: string) => ({
  seat,
  action: { type: 'word', cell, letter, path } as Action,
  caption,
});

export const def: GameDef<State, Action, Event, State> = {
  id: 'balda',
  title: 'Балда',
  players: { min: 2, max: 4, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'size',
      label: 'Поле',
      type: 'select',
      choices: [
        { value: 5, label: '5×5 — слово из 5 букв' },
        { value: 6, label: '6×6 — слово из 6 букв' },
        { value: 7, label: '7×7 — слово из 7 букв' },
      ],
      default: 5,
    },
    { key: 'diag', label: 'Слова по диагонали', type: 'toggle', default: false, hint: 'Соседними считаются и клетки углом.' },
    {
      key: 'min',
      label: 'Слово не короче',
      type: 'select',
      choices: [
        { value: 2, label: 'двух букв' },
        { value: 3, label: 'трёх букв' },
      ],
      default: 2,
    },
  ],
  presets: [
    { id: 'classic', label: 'Классика 5×5', hint: 'Как на тетрадном листе', options: { size: 5, diag: false, min: 2 } },
    { id: 'big', label: 'Большое поле 7×7', hint: 'Партия длиннее, слова длиннее', options: { size: 7, diag: false, min: 2 } },
    { id: 'diag', label: 'С диагоналями', hint: 'Слово можно вести и углом', options: { size: 5, diag: true, min: 3 } },
  ],

  setup: (seats, opts, rng) => newGame(seats.map((x) => x.seat), cfgFrom(opts), rng),
  toAct,
  apply: (s, seat, a) => apply(s, seat, a),
  view: (s) => s,
  result(s) {
    if (!s.over) return null;
    const w = winners(s);
    const scores = Object.fromEntries(s.players.map((p) => [p.seat, p.score]));
    const best = s.players.find((p) => p.seat === w[0])!.score;
    const text = w.length > 1 ? `ничья — по ${best} ${plural(best, 'очку', 'очка', 'очков')}` : `${best} ${plural(best, 'очко', 'очка', 'очков')}`;
    return { winners: w, text, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, level, rng) => choose(v, seat, level, rng) },
  describe,

  showcase: () => {
    const rng = new SeededRng(7);
    let s = newGame([0, 1], cfgFrom({}), rng, 'балда');
    for (let i = 0; i < 9 && !s.over; i++) {
      const a = choose(s, s.players[s.cur].seat, 1, rng);
      const r = apply(s, s.players[s.cur].seat, a);
      if (!r) break;
      s = r.state;
    }
    return s;
  },

  rules: {
    goal: 'Ставить по букве и складывать слова — у кого к концу больше букв во всех словах, тот и выиграл. Проигравший — балда.',
    sections: [
      {
        title: 'Ход',
        html: `<p>В середине поля написано слово. За ход ставят <b>одну букву</b> в пустую клетку рядом с буквами
          и читают <b>слово</b> по соседним клеткам — вверх, вниз, вбок, с поворотами. Новая буква обязательно входит в слово,
          каждую клетку берут не больше раза.</p>
          <p>Слово — <b>нарицательное существительное</b> в начальной форме (как в словаре). Повторять слова нельзя, начальное — тоже.
          За слово — <b>очко за каждую букву</b>.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => fixed(),
          intro: 'Начальное слово — БАЛДА.',
          steps: [
            word(0, 6, 'к', [10, 11, 6], 'Вовка ставит К над А и читает Б-А-К: «бак», 3 очка.'),
            word(1, 7, 'о', [6, 7, 12], 'Серёга ставит О рядом с К и читает К-О-Л с поворотом вниз: «кол», 3 очка.'),
          ],
        },
      },
      {
        title: 'Пропуск и конец партии',
        html: `<p>Не придумал слова — можно <b>пропустить ход</b>. Партия кончается, когда поле заполнено
          или когда все подряд пропустили ход. Можно и сдаться.</p>
          <p>Побеждает тот, у кого больше очков; поровну — ничья.</p>`,
      },
      {
        title: 'Варианты',
        html: `<p><b>Поле 6×6 и 7×7</b> — начальное слово из 6 или 7 букв, ходов больше.</p>
          <p><b>С диагоналями</b> — соседними считаются и клетки углом: и букву можно ставить углом, и слово так вести.
          Обычно тогда слова — не короче трёх букв.</p>`,
      },
    ],
  },
};
