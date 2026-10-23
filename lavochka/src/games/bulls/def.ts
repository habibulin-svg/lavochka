/* Быки и коровы — описание игры: цифры (дуэль, с повторами и без) и советская «Логика» (цветные фишки, коны со сменой
 * ролей, варианты I и II, серая коробка); вдвоём или против компьютера; боты; правила с показом. */
import type { GameDef, Rng, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, cfgFrom, makeView, newState, setup, toAct, type Action, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Первый', color: '#2f6fd0', light: '#6a9ae6', dark: '#1d4a94' },
  { name: 'Второй', color: '#c8402a', light: '#e2775f', dark: '#8a2615' },
];

const plural = (n: number, a: string, b: string, c: string) => (n % 10 === 1 && n % 100 !== 11 ? a : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? b : c);

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'secret') return `${name(ev.seat)} загадывает код.`;
  if (ev.type === 'round')
    return ev.solved ? `${name(ev.decoder)} разгадывает код: ${ev.points} ${plural(ev.points, 'очко', 'очка', 'очков')}.` : `${name(ev.decoder)} не разгадал код: ${ev.points} ${plural(ev.points, 'очко', 'очка', 'очков')}.`;
  if (ev.type === 'end') return ev.winners.length ? `🏁 Победа: ${name(ev.winners[0])}.` : '🏁 Ничья.';
  return null;
}

const solo: SeatSpec[] = [{ seat: 0, kind: 'bot', name: 'Игрок', level: 2 }];
const duo: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const G = (seat: number, code: number[], caption?: string) => ({ seat, action: { type: 'guess', code } as Action, caption });

/** Неслучайный генератор (превью и показ правил). */
function fixedRng(seed: number): Rng {
  let x = seed;
  return {
    next: () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648,
    int(n: number) {
      return Math.floor(this.next() * n);
    },
    getState: () => x,
  };
}

const BULLS = { symbols: 'digits', len: 4, repeats: false, mode: 'duel', rows: 0 };
const LOGIKA = { symbols: 'colors', len: 5, colors: 8, blank: false, repeats: true, mode: 'rounds', rows: 12, rounds: 2, look: 'logika' };

export const def: GameDef<State, Action, Event, State> = {
  id: 'bulls',
  title: 'Быки и коровы',
  players: { min: 1, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'symbols',
      label: 'Код из',
      type: 'select',
      choices: [
        { value: 'digits', label: 'цифр' },
        { value: 'colors', label: 'цветных фишек («Логика»)' },
      ],
      default: 'digits',
    },
    {
      key: 'len',
      label: 'Длина кода',
      type: 'select',
      choices: [3, 4, 5, 6].map((v) => ({ value: v, label: `${v}` })),
      default: 4,
    },
    {
      key: 'colors',
      label: 'Цветов',
      type: 'select',
      choices: [4, 6, 8].map((v) => ({ value: v, label: `${v}` })),
      default: 8,
      showIf: (o) => o.symbols === 'colors',
    },
    { key: 'blank', label: 'Пустая ячейка — девятый цвет', hint: 'Вариант II «Логики»', type: 'toggle', default: false, showIf: (o) => o.symbols === 'colors' },
    { key: 'repeats', label: 'Знаки могут повторяться', type: 'toggle', default: false },
    {
      key: 'mode',
      label: 'Как играем',
      type: 'select',
      choices: [
        { value: 'duel', label: 'дуэль — кто первым угадает чужой код' },
        { value: 'rounds', label: 'коны — по очереди загадывать, считать ряды' },
      ],
      default: 'duel',
    },
    {
      key: 'rows',
      label: 'Рядов на разгадку',
      type: 'select',
      choices: [
        { value: 0, label: 'сколько угодно' },
        { value: 6, label: '6' },
        { value: 10, label: '10' },
        { value: 12, label: '12' },
      ],
      default: 0,
    },
    {
      key: 'rounds',
      label: 'Конов',
      type: 'select',
      choices: [2, 4, 6].map((v) => ({ value: v, label: `${v}` })),
      default: 2,
      showIf: (o) => o.mode === 'rounds',
    },
    {
      key: 'look',
      label: 'Коробка',
      type: 'select',
      choices: [
        { value: 'logika', label: 'бежевая, 12 рядов' },
        { value: 'grey', label: 'серая, маленькая' },
      ],
      default: 'logika',
      showIf: (o) => o.symbols === 'colors',
    },
  ],
  presets: [
    { id: 'bulls', label: 'Быки и коровы', hint: 'Четыре разные цифры; кто первым угадает чужое число', options: BULLS },
    { id: 'bulls3', label: 'Три цифры', hint: 'Для разминки', options: { ...BULLS, len: 3 } },
    { id: 'bulls5', label: 'Пять цифр', hint: 'Подольше', options: { ...BULLS, len: 5 } },
    { id: 'repeats', label: 'Цифры с повторами', hint: 'В числе могут быть одинаковые цифры', options: { ...BULLS, repeats: true } },
    { id: 'logika', label: 'Логика, вариант I', hint: 'Советская игра: 5 фишек, 8 цветов, 12 рядов', options: LOGIKA },
    { id: 'logika2', label: 'Логика, вариант II', hint: 'Пустая ячейка — девятый цвет', options: { ...LOGIKA, blank: true } },
    { id: 'logika-easy', label: 'Логика попроще', hint: '4 фишки, 6 цветов', options: { ...LOGIKA, len: 4, colors: 6 } },
    { id: 'grey', label: 'Логика, серая коробка', hint: '4 фишки, 6 цветов, 6 рядов', options: { ...LOGIKA, len: 4, colors: 6, rows: 6, look: 'grey' } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat), opts, rng),
  toAct,
  apply: (s, seat, a) => apply(s, seat, a),
  view: (s, seats) => makeView(s, seats),
  result(s) {
    if (s.phase !== 'over') return null;
    const scores = s.cfg.mode === 'rounds' || s.n === 1 ? { 0: s.scores[0], 1: s.scores[1] } : undefined;
    if (s.n === 1) {
      const k = s.past[0]?.tries.length ?? 0;
      return s.winners.length ? { winners: [0], text: `угадан с ${k}-й попытки`, scores } : { winners: [], text: 'код не разгадан', scores };
    }
    if (!s.winners.length) return { winners: [], text: 'ничья', scores };
    return { winners: s.winners, text: s.cfg.mode === 'rounds' ? `меньше очков: ${s.scores[s.winners[0]]}` : 'угадал первым', scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    const rng = fixedRng(9);
    let s = newState(cfgFrom(LOGIKA), 2, rng);
    s = apply(s, 1, { type: 'secret', code: [0, 3, 3, 6, 1] })!.state;
    for (let i = 0; i < 5; i++) {
      const a = choose(s, 0, 1, rng);
      if (!a) break;
      const t = apply(s, 0, a)!.state;
      if (t.round !== 0) break;
      s = t;
    }
    return s;
  },

  rules: {
    goal: 'Разгадать код соперника за как можно меньшее число попыток.',
    sections: [
      {
        title: 'Быки и коровы',
        html: `<p>Один загадывает число из четырёх <b>разных</b> цифр, другой пытается его угадать. На каждую попытку загадавший отвечает:
          сколько <b>быков</b> — цифр, которые есть в числе и стоят на своём месте, и сколько <b>коров</b> — цифр, которые в числе есть,
          но стоят не там. Четыре быка — число угадано. Отвечает за загадавшего сам сайт — без ошибок.</p>`,
        demo: {
          seats: solo,
          options: { ...BULLS },
          setup: () => {
            const s = newState(cfgFrom(BULLS), 1, fixedRng(1));
            s.secrets[1] = [1, 2, 3, 4];
            return s;
          },
          intro: 'Загадано число (оно скрыто).',
          steps: [G(0, [5, 6, 7, 8], 'Ни одной цифры: ноль быков, ноль коров.'), G(0, [1, 2, 4, 3], 'Все цифры верные, две на своих местах: 2 быка, 2 коровы.'), G(0, [1, 2, 3, 4], 'Четыре быка — угадано с третьей попытки.')],
        },
      },
      {
        title: 'Дуэль',
        html: `<p>Вдвоём каждый загадывает своё число и по очереди угадывает чужое. Кто угадал первым — выиграл.
          Если первым угадал тот, кто начинал, сопернику дают ещё одну попытку с тем же номером: угадает и он — ничья.
          Против компьютера можно играть и в одиночку: загадывает он, а вы угадываете.</p>`,
        demo: {
          seats: duo,
          options: { ...BULLS },
          setup: () => {
            const s = newState(cfgFrom(BULLS), 2, fixedRng(1));
            s.secrets = [
              [9, 0, 1, 2],
              [4, 7, 2, 5],
            ];
            s.phase = 'guess';
            s.tries[0] = [{ code: [4, 7, 5, 2], bulls: 2, cows: 2 }];
            s.tries[1] = [{ code: [9, 1, 0, 3], bulls: 1, cows: 2 }];
            return s;
          },
          intro: 'Каждый сделал по попытке.',
          steps: [G(0, [4, 7, 2, 5], 'Первый угадал на второй попытке…'), G(1, [9, 0, 1, 2], '…но и второй угадывает со второй — ничья.')],
        },
      },
      {
        title: '«Логика»: фишки и штырьки',
        html: `<p>Советская «Логика» — то же самое, только код из <b>пяти цветных фишек</b> восьми цветов, и цвета могут повторяться.
          Составитель прячет код за экраном, а на каждый ряд дешифровальщика ставит штырьки: <b>чёрный</b> — фишка верного цвета
          на своём месте (бык), <b>белый</b> — цвет есть в коде, но не на этом месте (корова). Порядок штырьков ничего не значит.</p>
          <p>В <b>варианте II</b> в коде можно оставить ячейки пустыми — получается девятый «цвет» и 59 049 возможных кодов.</p>`,
        demo: {
          seats: solo,
          options: { ...LOGIKA },
          setup: () => {
            const s = newState(cfgFrom(LOGIKA), 1, fixedRng(1));
            s.secrets[1] = [0, 1, 1, 2, 3];
            return s;
          },
          intro: 'Код спрятан за экраном.',
          steps: [G(0, [0, 0, 1, 1, 4], 'Красная на месте и синяя на месте — два чёрных; ещё одна синяя не там — белый.'), G(0, [0, 1, 1, 2, 3], 'Пять чёрных — код разгадан.')],
        },
      },
      {
        title: 'Коны и очки',
        html: `<p>В «Логике» играют конами. В каждом один загадывает, другой разгадывает и получает <b>очко за каждый ряд</b>,
          который понадобился. Не разгадал за все ряды доски — очков столько же плюс одно. Потом роли меняются.
          О числе конов договариваются заранее; у кого к концу игры очков <b>меньше</b>, тот и выиграл.</p>`,
      },
    ],
  },
};
