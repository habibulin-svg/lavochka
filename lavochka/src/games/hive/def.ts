/* Улей — описание игры для сборника: вдвоём, без поля, дополнения (комар, божья коровка, мокрица) и турнирное правило. Без DOM. */
import type { GameDef, Options, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { BUG_ACC, BUG_RU, newState, cfgFrom, setup, step, toAct, type Action, type Bug, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Белые', color: '#efe4cc', light: '#fffaf0', dark: '#8e7c5c', ink: '#6a5a3a' },
  { name: 'Чёрные', color: '#262422', light: '#4a4744', dark: '#000' },
];

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'place') return `${name(ev.seat)}: ставят ${BUG_ACC[ev.bug]}`;
  if (ev.type === 'move') return `${name(ev.seat)}: ${BUG_RU[ev.bug]} ${ev.climb ? 'по улью' : 'ходит'}`;
  if (ev.type === 'throw') return `${name(ev.seat)}: ${BUG_RU[ev.by]} переносит ${ev.owner === ev.seat ? 'своего' : 'чужого'} — ${BUG_ACC[ev.bug]}`;
  if (ev.type === 'pass') return `${name(ev.seat)}: ходов нет — пропуск`;
  if (ev.type === 'end') return ev.winner == null ? (ev.trapped.length ? '🏁 Обе пчелы окружены — ничья.' : '🏁 Ничья.') : `🏁 ${name(ev.winner)}: пчела соперника окружена!`;
  return null;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));

/** Позиция: «q,r» → стопка снизу вверх; заглавная буква — белые, строчная — чёрные. */
export function pos(cells: Record<string, string>, turn = 0, opts: Options = {}): State {
  const s = newState(cfgFrom(opts));
  for (const [k, st] of Object.entries(cells)) {
    s.cells[k] = st.split('').map((ch) => ({ o: ch === ch.toUpperCase() ? 0 : 1, b: ch.toUpperCase() as Bug }));
    for (const p of s.cells[k]) s.hand[p.o][p.b]--, s.placed[p.o]++;
  }
  s.turn = turn;
  s.ply = 10;
  return s;
}
const A = (seat: number, a: Action, caption?: string) => ({ seat, action: a, caption });
const mv = (from: string, to: string): Action => ({ type: 'move', from, to });

const ALL = { mosquito: true, ladybug: true, pillbug: true };

export const def: GameDef<State, Action, Event, State> = {
  id: 'hive',
  title: 'Улей',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    { key: 'mosquito', label: 'Комар', type: 'toggle', default: false, hint: 'Ходит как любой соседний жучок, а наверху улья — как жук.' },
    { key: 'ladybug', label: 'Божья коровка', type: 'toggle', default: false, hint: 'Две клетки по верху улья и одна вниз.' },
    { key: 'pillbug', label: 'Мокрица', type: 'toggle', default: false, hint: 'Ходит на клетку или переносит соседнюю фишку через себя.' },
    { key: 'tourney', label: 'Турнирное правило', type: 'toggle', default: false, hint: 'Пчелу нельзя ставить первым ходом.' },
  ],
  presets: [
    { id: 'base', label: 'Улей', hint: 'Основная коробка: пчела, жуки, кузнечики, пауки, муравьи', options: { mosquito: false, ladybug: false, pillbug: false, tourney: false } },
    { id: 'mosquito', label: 'С комаром', hint: '+ комар', options: { mosquito: true, ladybug: false, pillbug: false, tourney: false } },
    { id: 'ladybug', label: 'С божьей коровкой', hint: '+ божья коровка', options: { mosquito: false, ladybug: true, pillbug: false, tourney: false } },
    { id: 'pillbug', label: 'С мокрицей', hint: '+ мокрица', options: { mosquito: false, ladybug: false, pillbug: true, tourney: false } },
    { id: 'all', label: 'Все дополнения', hint: 'Комар, божья коровка и мокрица', options: { ...ALL, tourney: false } },
    { id: 'tourney', label: 'Турнирный', hint: 'Все дополнения, пчелу нельзя первым ходом', options: { ...ALL, tourney: true } },
  ],
  setup: (_seats, opts) => setup(opts),
  toAct,
  apply: (s, _seat, a) => step(s, a),
  view: (s) => s,
  result(s) {
    if (!s.over) return null;
    if (s.winner == null) return { winners: [], text: s.trapped.length ? 'обе пчелы окружены' : 'ничья' };
    return { winners: [s.winner], text: 'пчела соперника окружена' };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () =>
    pos(
      {
        '0,0': 'q',
        '1,-1': 'A',
        '1,0': 'gB',
        '0,1': 'S',
        '-1,1': 'm',
        '-1,0': 'G',
        '0,-1': 'a',
        '-1,-1': 's',
        '2,-1': 'Q',
        '2,0': 'L',
        '-2,1': 'p',
        '-2,0': 'a',
        '1,1': 'M',
        '3,-1': 'P',
      },
      1,
      ALL,
    ),

  rules: {
    goal: '<b>Окружить пчелу соперника</b> со всех шести сторон — неважно, своими фишками или чужими.',
    sections: [
      {
        title: 'Улей без поля',
        html: `<p>Поля нет: фишки кладут друг к другу, и получается улей. Первая фишка — куда угодно, вторая — рядом с ней. Дальше новую фишку из запаса
          ставят <b>рядом со своими и не касаясь чужих</b>. Ход — либо поставить фишку, либо передвинуть свою.</p>
          <p><b>Пчелу</b> надо поставить не позже четвёртого своего хода, и пока она в запасе, своими фишками ходить нельзя.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => newState(cfgFrom({})),
          steps: [
            A(0, { type: 'place', bug: 'G', at: '0,0' }, 'Белые начинают с кузнечика.'),
            A(1, { type: 'place', bug: 'G', at: '1,0' }, 'Вторая фишка партии — просто рядом.'),
            A(0, { type: 'place', bug: 'Q', at: '-1,0' }, 'Дальше — только у своих: белые ставят пчелу, не касаясь чёрных.'),
            A(1, { type: 'place', bug: 'A', at: '2,0' }, 'Чёрные — муравья со своей стороны.'),
          ],
        },
      },
      {
        title: 'Один улей и узкие ворота',
        html: `<p>Улей всегда должен быть одним целым — даже на миг, пока фишка в пути. Фишку-перемычку, без которой улей распадётся, двигать нельзя.</p>
          <p>Фишки ползут по полу, не отрываясь от улья, и <b>не протискиваются</b> в щель между двумя соседями. Пчела ползёт на одну клетку.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos({ '0,0': 'Q', '1,0': 'g', '1,-1': 'A', '2,-1': 'q' }),
          steps: [A(0, mv('0,0', '0,1'), 'Пчела ползёт на соседнюю клетку вдоль улья.')],
        },
      },
      {
        title: 'Паук и муравей',
        html: `<p><b>Паук</b> ползёт ровно на три клетки, не возвращаясь. <b>Муравей</b> — на сколько угодно клеток вокруг улья, куда может пролезть.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos({ '0,0': 'S', '1,0': 'Q', '2,0': 'q', '0,1': 'A' }),
          steps: [
            A(0, mv('0,0', '3,-1'), 'Паук — ровно три шага.'),
            A(1, { type: 'place', bug: 'G', at: '2,1' }),
            A(0, mv('0,1', '3,0'), 'Муравей обегает улей и встаёт куда хочет.'),
          ],
        },
      },
      {
        title: 'Кузнечик',
        html: `<p><b>Кузнечик</b> не ползёт, а прыгает по прямой через одну или несколько фишек подряд на первую пустую клетку. Ворота ему не помеха.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos({ '0,0': 'G', '1,0': 'Q', '2,0': 'q', '3,0': 'a' }),
          steps: [A(0, mv('0,0', '4,0'), 'Кузнечик перелетает через три фишки.')],
        },
      },
      {
        title: 'Жук',
        html: `<p><b>Жук</b> ходит на одну клетку, но может залезть <b>на улей</b> и ходить по верху. Фишка под жуком не ходит, а стопка считается цвета жука:
          рядом с ней ставят фишки цвета жука. Жук на чужой пчеле — страшная сила.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos({ '0,0': 'Q', '1,-1': 'B', '1,0': 'q', '2,0': 'a' }),
          steps: [A(0, mv('1,-1', '1,0'), 'Жук залезает на чёрную пчелу — теперь она не двинется.')],
        },
      },
      {
        title: 'Комар',
        html: `<p><b>Комар</b> (дополнение) ходит так, как ходит любой из его соседей: рядом с кузнечиком прыгает, рядом с муравьём бегает.
          Наверху улья комар — жук. Если рядом только комар, не ходит.</p>`,
        demo: {
          seats: demoSeats,
          options: { mosquito: true },
          setup: () => pos({ '0,0': 'M', '1,0': 'Q', '2,0': 'q', '1,-1': 'g' }, 0, { mosquito: true }),
          steps: [A(0, mv('0,0', '2,-2'), 'Рядом чёрный кузнечик — и комар прыгает, как кузнечик.')],
        },
      },
      {
        title: 'Божья коровка',
        html: `<p><b>Божья коровка</b> (дополнение) делает ровно три шага: два по верху улья и один вниз, на пустую клетку.</p>`,
        demo: {
          seats: demoSeats,
          options: { ladybug: true },
          setup: () => pos({ '0,0': 'L', '1,0': 'Q', '2,0': 'q' }, 0, { ladybug: true }),
          steps: [A(0, mv('0,0', '3,0'), 'По двум фишкам — и вниз на дальнюю сторону.')],
        },
      },
      {
        title: 'Мокрица',
        html: `<p><b>Мокрица</b> (дополнение) ползёт на одну клетку — или вместо хода <b>переносит соседнюю фишку</b> (свою или чужую, не из стопки)
          через себя на пустую клетку рядом с собой. Нельзя трогать фишку, которой соперник только что ходил, и рвать улей; перенесённая фишка следующий ход стоит.</p>`,
        demo: {
          seats: demoSeats,
          options: { pillbug: true },
          setup: () => pos({ '0,0': 'P', '1,0': 'Q', '-1,1': 'a', '-1,0': 'q' }, 0, { pillbug: true }),
          steps: [A(0, { type: 'throw', by: '0,0', from: '-1,1', to: '1,-1' }, 'Мокрица перекидывает чёрного муравья через себя.')],
        },
      },
      {
        title: 'Победа',
        html: `<p>Пчела, окружённая со всех шести сторон, проиграла. Окружены обе сразу — ничья. Если ходить некуда, ход пропускают.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos({ '0,0': 'q', '1,0': 'A', '1,-1': 'G', '0,-1': 'S', '-1,0': 'B', '-1,1': 'g', '-2,0': 'Q', '2,-1': 'A' }),
          steps: [A(0, mv('2,-1', '0,1'), 'Муравей закрывает последнюю клетку — чёрная пчела окружена.')],
        },
      },
    ],
  },
};
