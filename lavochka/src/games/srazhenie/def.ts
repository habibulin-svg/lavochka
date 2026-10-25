/* «Сражение» — описание игры. Советский «Стратего»: поле с озёрами и листы фишек для печати (jakobCIT),
 * правила — из того же набора (материалы и решения — docs/analysis/materials-srazhenie.md). */
import type { GameDef, Rng, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, cfgFrom, FLAG, makeView, MINE, NAMES, ACC, newState, place, QUIET, redact, setup, smartLayout, toAct, type Action, type Event, type Piece, type State } from './engine';

export const SEATS = [
  { name: 'Зелёные', color: '#4caf3a', light: '#8ad86e', dark: '#22601a' },
  { name: 'Синие', color: '#3f55a5', light: '#7f93e0', dark: '#1d2a5e' },
];

const WHY: Record<string, string> = {
  flag: 'знамя захвачено',
  stuck: 'у соперника не осталось ни одного хода',
  quiet: `${QUIET / 2} ходов без единого боя — ничья`,
  both: 'ходов нет ни у кого — ничья',
};

const who = (r: number) => NAMES[r];

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'ready') return `${name(ev.seat)}: армия расставлена.`;
  if (ev.type === 'start') return 'Обе армии готовы — в бой! Первыми ходят зелёные.';
  if (ev.type === 'battle') {
    const a = who(ev.att);
    if (ev.def === FLAG) return `🚩 ${name(ev.seat)}: ${a} захватывает знамя!`;
    if (ev.def === MINE) return ev.res === 'win' ? `${name(ev.seat)}: Сапёр обезвреживает мину.` : `💥 ${name(ev.seat)}: ${a} подрывается на мине.`;
    if (ev.res === 'win') return `⚔ ${name(ev.seat)}: ${a} бьёт ${ACC[ev.def]}.`;
    if (ev.res === 'lose') return `⚔ ${name(ev.seat)}: ${a} нападает на ${ACC[ev.def]} — и гибнет.`;
    return `⚔ ${name(ev.seat)}: ${a} против ${ACC[ev.def]} — оба выбывают.`;
  }
  if (ev.type === 'end') return ev.winner == null ? `🏁 Ничья: ${WHY[ev.why]}.` : `🏁 Победа — ${name(ev.winner)}: ${WHY[ev.why]}!`;
  return null;
}

const demoSeats: SeatSpec[] = [
  { seat: 0, kind: 'bot', name: 'Вовка', level: 1 },
  { seat: 1, kind: 'bot', name: 'Серёга', level: 1 },
];

/** Клетка по шахматному обозначению снизу: столбец a…k (без j), ряд 1…10 от зелёных. */
const at = (c: number, r: number) => c + (10 - r) * 10;

/** Позиция посреди партии: [клетка, место, ранг]. */
function pos(list: [number, number, number][], turn = 0, known: number[] = []): State {
  const s = newState(cfgFrom({}));
  s.phase = 'play';
  s.ready = [true, true];
  s.laid = [true, true];
  s.turn = turn;
  list.forEach(([p, owner, rank], i) => {
    s.cells[p] = { id: owner * 100 + i, owner, rank, moved: false, known: known.includes(p) } as Piece;
  });
  return s;
}
const Mv = (seat: number, from: number, to: number, caption?: string) => ({ seat, action: { type: 'move', from, to } as Action, caption });

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

/** Обе армии расставлены «с умом» — для показа ходов. */
function armies(seed: number): State {
  const rng = fixedRng(seed);
  const s = newState(cfgFrom({}));
  place(s, 0, smartLayout(rng));
  place(s, 1, smartLayout(rng));
  s.phase = 'play';
  s.ready = [true, true];
  s.laid = [true, true];
  return s;
}

export const def: GameDef<State, Action, Event, State> = {
  id: 'srazhenie',
  title: 'Сражение',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'move',
      label: 'Как ходит Солдат',
      type: 'select',
      choices: [
        { value: 'one', label: 'на одну клетку, как все — по правилам набора' },
        { value: 'run', label: 'на любое число свободных клеток по прямой — как в «Стратего»' },
      ],
      default: 'one',
    },
  ],
  presets: [
    { id: 'box', label: 'По правилам набора', hint: 'Все фишки ходят на одну клетку', options: { move: 'one' } },
    { id: 'run', label: 'Солдаты-бегуны', hint: 'Солдат проходит любое число свободных клеток по прямой — как разведчик в «Стратего»', options: { move: 'run' } },
  ],

  setup: (_seats, opts, rng) => setup(opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  redact,
  result(s) {
    if (s.phase !== 'over') return null;
    if (s.winner == null) return { winners: [], text: WHY[s.why] };
    return { winners: [s.winner], text: WHY[s.why], scores: { [s.winner]: 1, [1 - s.winner]: 0 } };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose },
  describe,

  showcase: () => {
    let s = armies(5);
    const rng = fixedRng(23);
    for (let i = 0; i < 70; i++) {
      const a = choose(s, s.turn, 2, rng);
      if (!a) break;
      const r = apply(s, s.turn, a, rng);
      if (!r || r.state.phase !== 'play') break;
      s = r.state;
    }
    return makeView(s, [0]);
  },

  rules: {
    goal: 'Захватить знамя противника — или оставить его армию без единого хода. Где какая фишка у соперника, не видно: ранг открывается только в бою.',
    sections: [
      {
        title: 'Армии и поле',
        html: `<p>Поле — 10×10 клеток, посередине два <b>озера</b>: по ним не ходят. У каждого по <b>40 фишек</b>, ранг написан
          только на стороне, обращённой к хозяину, — сопернику видна цветная спинка.</p>
          <p>Ранги (на поле сверху и снизу — портреты): <b>1 Маршал</b>, 2 Генерал, 3 Полковник ×2, 4 Майор ×3, 5 Капитан ×4,
          6 Лейтенант ×4, 7 Сержант ×4, <b>8 Сапёр</b> ×5, 9 Солдат ×8, <b>10 Разведчик</b>, а ещё <b>6 мин</b> и <b>знамя</b>.
          <b>Чем меньше число, тем сильнее фишка</b>: Маршал сильнее всех. (В листке правил набора напечатано наоборот — это
          опечатка: иначе не нужно было бы особое правило про Разведчика и Маршала.)</p>`,
      },
      {
        title: 'Расстановка',
        html: `<p>Каждый втайне расставляет армию в <b>четырёх ближних к себе рядах</b> — как хочет. Знамя обычно прячут в заднем ряду
          и обкладывают минами. Чтобы поменять две фишки местами, нажмите на одну, потом на другую; «Перемешать» — случайно,
          «Расставить с умом» — знамя под минами, солдаты впереди. Когда готовы — «В бой!».</p>`,
        demo: {
          seats: demoSeats,
          setup: (_d, rng) => setup({}, rng),
          intro: 'Фишки стоят как попало — сейчас оба наведут порядок.',
          steps: [
            { seat: 0, action: { type: 'auto' } as Action, rig: [3], caption: 'Вовка: «Расставить с умом» — знамя в заднем ряду под минами.' },
            { seat: 0, action: { type: 'swap', a: at(0, 4), b: at(4, 2) } as Action, caption: 'И меняет местами пару фишек на свой вкус.' },
            { seat: 0, action: { type: 'ready' } as Action, caption: 'Готово!' },
            { seat: 1, action: { type: 'auto' } as Action, rig: [7], caption: 'Серёга тоже расставился.' },
            { seat: 1, action: { type: 'ready' } as Action, caption: 'Обе армии на местах — в бой. Первыми ходят зелёные.' },
          ],
        },
      },
      {
        title: 'Как ходят',
        html: `<p>Ходят по очереди, по одной фишке, на <b>одну клетку</b> вперёд, назад или вбок — не по диагонали, не на озеро и не на
          свою фишку. <b>Мины и знамя не ходят.</b> Пропустить ход нельзя.</p>
          <p>Гонять одну фишку туда-обратно между двумя клетками можно не больше трёх раз подряд. В варианте «Солдаты-бегуны» Солдат (9)
          проходит любое число свободных клеток по прямой.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([[at(4, 4), 0, 5], [at(5, 7), 1, 6], [at(1, 4), 0, MINE], [at(0, 1), 0, FLAG], [at(9, 10), 1, FLAG]]),
          steps: [Mv(0, at(4, 4), at(4, 5), 'Капитан шагает вперёд на одну клетку.'), Mv(1, at(5, 7), at(5, 8), 'Синие отвечают.'), Mv(0, at(4, 5), at(5, 5), 'Вбок — тоже можно, а вот левее — озеро, туда нельзя.')],
        },
      },
      {
        title: 'Бой',
        html: `<p>Встать на клетку с фишкой противника — значит <b>напасть</b>. Обе фишки открываются: <b>меньший ранг побеждает</b> —
          проигравшая снимается, победитель (если нападал) встаёт на её место. Равные ранги — снимаются <b>обе</b>.</p>
          <p>После боя ранг выжившей фишки знают оба — на поле она так и остаётся открытой.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([[at(4, 5), 0, 5], [at(4, 6), 1, 7], [at(5, 5), 0, 6], [at(5, 6), 1, 4], [at(0, 4), 0, 9], [at(0, 5), 1, 9], [at(9, 1), 0, FLAG], [at(9, 10), 1, FLAG]]),
          steps: [
            Mv(0, at(4, 5), at(4, 6), 'Капитан (5) нападает на неизвестную фишку — это Сержант (7). Капитан сильнее и занимает клетку.'),
            Mv(1, at(0, 5), at(0, 4), 'Солдат на Солдата: равные ранги — снимаются оба.'),
            Mv(0, at(5, 5), at(5, 6), 'Лейтенант (6) нападает на Майора (4) — и гибнет. Майор теперь открыт.'),
          ],
        },
      },
      {
        title: 'Мины, Сапёр и Разведчик',
        html: `<p><b>Мина</b> не ходит. Любая фишка, напавшая на мину, подрывается — а мина остаётся. Только <b>Сапёр (8)</b> обезвреживает
          мину: она снимается, Сапёр встаёт на её клетку.</p>
          <p><b>Разведчик (10)</b> слабее всех — кроме одного случая: если он сам <b>нападёт на Маршала</b>, Маршал снят.
          Если же Маршал нападёт на Разведчика, Разведчик проиграет.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos([[at(2, 7), 0, 4], [at(2, 8), 1, MINE], [at(3, 7), 0, 8], [at(3, 8), 1, MINE], [at(8, 5), 0, 10], [at(8, 6), 1, 1], [at(9, 9), 1, 9], [at(9, 1), 0, FLAG], [at(0, 10), 1, FLAG]]),
          steps: [
            Mv(0, at(2, 7), at(2, 8), 'Майор наступает на мину — подорвался. Мина на месте.'),
            Mv(1, at(9, 9), at(9, 8)),
            Mv(0, at(3, 7), at(3, 8), 'Сапёр обезвреживает соседнюю мину.'),
            Mv(1, at(9, 8), at(9, 7)),
            Mv(0, at(8, 5), at(8, 6), 'Разведчик нападает на Маршала — и побеждает!'),
          ],
        },
      },
      {
        title: 'Победа',
        html: `<p>Побеждает тот, кто <b>захватит знамя</b> противника — напасть на него может любая подвижная фишка. Выигрывает и тот,
          у чьего соперника в его ход <b>не осталось ни одного хода</b> (все снятые или зажаты своими же минами).</p>
          <p>Если ${QUIET / 2} ходов подряд никто ни на кого не нападал, — ничья (в листке набора об этом ничего нет, это наше).</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos([[at(4, 9), 0, 9], [at(4, 10), 1, FLAG], [at(3, 10), 1, MINE], [at(5, 10), 1, MINE], [at(0, 1), 0, FLAG], [at(9, 6), 1, 6]]),
          steps: [Mv(0, at(4, 9), at(4, 10), 'Солдат нападает на фишку в заднем ряду — это знамя! Победа.')],
        },
      },
    ],
  },
};
