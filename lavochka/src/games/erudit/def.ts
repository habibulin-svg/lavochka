/* Эрудит — описание игры: набор «Эрудит» (131 фишка, 3 звёздочки) или «Скрэббл» (104, 2 пустые), 2–4 игрока,
 * звёздочку можно выкупить с поля, игра до конца мешка или до 200/300/500 очков; боты, правила с показом. Без DOM.
 * Словарь должен быть загружен до setup (loadDict в defs.ts и в каталоге). */
import { SeededRng } from '../../core/rng';
import type { GameDef, Rng, SeatSpec } from '../../core/types';
import { plural } from '../../core/util';
import { choose } from './ai';
import { apply, cfgFrom, makeView, N, newGame, redact, toAct, winners, type Action, type Event, type State, type View } from './engine';

export const SEATS = [
  { name: 'Вовка', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Серёга', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Ленка', color: '#2f7a3a', light: '#5fae6a', dark: '#18421f' },
  { name: 'Танька', color: '#7a3f8f', light: '#a874bb', dark: '#41204d' },
];

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'play':
      return `${name(ev.seat)}: ${ev.words.map((w) => `<b>${w.toUpperCase()}</b>`).join(', ')} — ${ev.points} ${plural(ev.points, 'очко', 'очка', 'очков')}${ev.bonus ? ' (все фишки!)' : ''}${ev.take != null ? ' — выкупил звёздочку' : ''}`;
    case 'swap':
      return `${name(ev.seat)} меняет ${ev.count} ${plural(ev.count, 'фишку', 'фишки', 'фишек')}.`;
    case 'pass':
      return `${name(ev.seat)} пропускает ход.`;
    case 'resign':
      return `🏳 ${name(ev.seat)} сдаётся.`;
    case 'end':
      return ev.seat != null ? `<i>${name(ev.seat)} выложил все фишки — остатки соперников ему.</i>` : '<i>Партия окончена.</i>';
  }
  return null;
}

const demoSeats: SeatSpec[] = SEATS.slice(0, 2).map((x, seat) => ({ seat, kind: 'bot', name: x.name, level: 1 }));
const at = (r: number, c: number) => r * N + c;

/** Позиция для показа: руки заданы, мешок как есть. */
function demoGame(racks: string[][], rng: Rng, set: 'erudit' | 'scrabble' = 'erudit'): State {
  const s = newGame([0, 1], cfgFrom({ set }), rng);
  s.bag.push(...s.racks.flat());
  s.racks = racks.map((r) => {
    const out = r.slice();
    for (const ch of out) s.bag.splice(s.bag.indexOf(ch), 1);
    return out;
  });
  s.cur = 0;
  return s;
}

export const def: GameDef<State, Action, Event, View> = {
  id: 'erudit',
  title: 'Эрудит',
  players: { min: 2, max: 4, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'set',
      label: 'Набор фишек',
      type: 'select',
      choices: [
        { value: 'erudit', label: '«Эрудит»: 131 фишка, 3 звёздочки, бонус 15' },
        { value: 'scrabble', label: '«Скрэббл»: 104 фишки, 2 пустые, бонус 50' },
      ],
      default: 'erudit',
    },
    { key: 'swapJoker', label: 'Звёздочку можно выкупить', type: 'toggle', default: true, hint: 'Положи на поле ту букву, что изображает звёздочка, — и забери звёздочку себе (выложить её надо тем же ходом).' },
    {
      key: 'target',
      label: 'Игра до',
      type: 'select',
      choices: [
        { value: 0, label: 'конца мешка' },
        { value: 200, label: '200 очков' },
        { value: 300, label: '300 очков' },
        { value: 500, label: '500 очков' },
      ],
      default: 0,
    },
  ],
  presets: [
    { id: 'erudit', label: 'Эрудит', hint: 'Советская коробка: 131 фишка, звёздочки', options: { set: 'erudit', swapJoker: true, target: 0 } },
    { id: 'scrabble', label: 'Скрэббл', hint: 'Русский набор на 104 фишки, бонус 50', options: { set: 'scrabble', swapJoker: false, target: 0 } },
    { id: 'quick', label: 'До 200 очков', hint: 'Короткая партия', options: { set: 'erudit', swapJoker: true, target: 200 } },
  ],

  setup: (seats, opts, rng) => newGame(seats.map((x) => x.seat), cfgFrom(opts), rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  redact,
  result(s) {
    if (!s.over) return null;
    const w = winners(s);
    const scores = Object.fromEntries(s.seats.map((seat, i) => [seat, s.scores[i]]));
    const best = s.scores[s.seats.indexOf(w[0])];
    const text = w.length > 1 ? `ничья — по ${best} ${plural(best, 'очку', 'очка', 'очков')}` : `${best} ${plural(best, 'очко', 'очка', 'очков')}`;
    return { winners: w, text, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, level, rng) => choose(v, seat, level, rng) },
  describe,

  showcase: () => {
    const rng = new SeededRng(11);
    let s = newGame([0, 1], cfgFrom({}), rng);
    for (let i = 0; i < 10 && !s.over; i++) {
      const seat = s.seats[s.cur];
      const r = apply(s, seat, choose(makeView(s, [seat]), seat, 2, rng), rng);
      if (!r) break;
      s = r.state;
    }
    // на превью — рука того, чей ход (показ берёт её у текущего игрока)
    s.cur = 0;
    return makeView(s, [s.seats[0]]);
  },

  rules: {
    goal: 'Составлять слова на поле из своих фишек, как в кроссворде, и набрать больше очков.',
    sections: [
      {
        title: 'Фишки и первый ход',
        html: `<p>У каждого на руке <b>7 фишек</b>, остальные — в мешке. На фишке буква и её цена: частые буквы дешёвые, редкие (Ф, Щ, Ъ, Э…) — дорогие.
          <b>Звёздочка</b> заменяет любую букву, но сама ничего не стоит.</p>
          <p>Первое слово выкладывают через <b>центр поля</b>. Слово — нарицательное существительное в начальной форме.</p>`,
        demo: {
          seats: demoSeats,
          setup: (_d, rng) => demoGame([['к', 'о', 'т', 'а', 'р', 'с', 'и'], ['л', 'е', 'с', 'н', 'о', 'д', 'м']], rng),
          intro: 'Пустое поле. Вовка выкладывает первое слово через центр.',
          steps: [
            {
              seat: 0,
              action: { type: 'play', tiles: [at(7, 5), at(7, 6), at(7, 7)].map((cell, i) => ({ cell, letter: 'кот'[i] })) } as Action,
              caption: 'КОТ через центральную клетку: 2 + 1 + 2 = 5 очков. (В «Скрэббле» центр удваивает слово.)',
            },
          ],
        },
      },
      {
        title: 'Дальше — как в кроссворде',
        html: `<p>Фишки кладут <b>в одну строку или один столбец</b>, без пропусков, примыкая к уже стоящим. Считаются все слова,
          которые получились — и основное, и поперечные. Повторять слова можно.</p>
          <p>Цветные клетки: <b>зелёная</b> — буква ×2, <b>жёлтая</b> — буква ×3, <b>синяя</b> — слово ×2, <b>красная</b> — слово ×3.
          Работают только под новыми фишками. Выложил все 7 — <b>бонус</b> (в «Эрудите» 15, в «Скрэббле» 50).</p>
          <p>После хода руку добирают из мешка до 7. Можно вместо хода <b>поменять</b> фишки (пока в мешке их хватает) или пропустить.</p>`,
        demo: {
          seats: demoSeats,
          setup: (_d, rng) => {
            const s = demoGame([['а', 'р', 'с', 'и', 'п', 'у', 'в'], ['л', 'е', 'с', 'н', 'о', 'д', 'м']], rng);
            for (const [i, ch] of [...'кот'].entries()) s.board[at(7, 5 + i)] = { ch };
            s.cur = 1;
            return s;
          },
          intro: 'На поле КОТ. Ходит Серёга.',
          steps: [
            {
              seat: 1,
              action: { type: 'play', tiles: [at(6, 6), at(8, 6)].map((cell, i) => ({ cell, letter: 'см'[i] })) } as Action,
              caption: 'Серёга ставит С над О и М под ним: СОМ. С и М — на зелёных клетках (буква ×2): 4 + 1 + 4 = 9 очков.',
            },
          ],
        },
      },
      {
        title: 'Звёздочка',
        html: `<p>Звёздочка изображает любую букву — её называют, когда кладут. Если на руке есть та буква, которую изображает звёздочка на поле,
          можно <b>выкупить</b> звёздочку: положить букву на её место и забрать звёздочку себе — но выложить её надо тем же ходом.</p>`,
      },
      {
        title: 'Конец партии',
        html: `<p>Партия кончается, когда мешок пуст и кто-то выложил все фишки: ему прибавляются фишки, оставшиеся у соперников, а у них они вычитаются.
          Ещё — если два круга подряд никто не выложил ни одного слова (все пропускали или меняли фишки), или кто-то дошёл до условленного счёта. Побеждает набравший больше очков.</p>`,
      },
    ],
  },
};

