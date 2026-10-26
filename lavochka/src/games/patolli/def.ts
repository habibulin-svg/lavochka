/* Патолли — игра ацтеков: крест из 52 клеток на листе Флорентийского кодекса, пять бобов с точкой, ставки-бусины.
 * Движок — engine.ts, боты — ai.ts. */
import type { DemoStep, GameDef, Options, Rng, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, cfgFrom, newState, setup, toAct, type Action, type Event, type Pay, type State } from './engine';

export const SEATS = [
  { name: 'Красные', color: '#b3321f', light: '#e0735c', dark: '#5e150a' },
  { name: 'Бирюзовые', color: '#1f7f95', light: '#62b8c8', dark: '#0d3f4b' },
  { name: 'Обсидиан', color: '#2a2724', light: '#6b655e', dark: '#0e0c0b' },
  { name: 'Золотые', color: '#c8901f', light: '#efc566', dark: '#6e4a08', ink: '#6e4a08' },
];

const stake = (k: number) => (k === 1 ? 'ставку' : k < 5 ? `${k} ставки` : `${k} ставок`);

function payText(p: Pay, name: (seat: number) => string): string {
  if (p.why === 'offer') return `${name(p.from)}: подношение богу Макуильшочитлю — ставка в кон`;
  if (p.why === 'tri') return `${name(p.from)} встаёт на треугольник — ставка в кон`;
  if (p.why === 'hit') return `${name(p.from)} платит ставку ${name(p.to)} за сбитую фишку`;
  if (p.why === 'lap') return `${name(p.from)} платит ставку ${name(p.to)}: фишка прошла круг`;
  return '';
}

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'roll') {
    const c = ev.beans.filter((x) => x).length;
    const v = ev.value === 0 ? 'ни одной точки' : c === 5 ? `все пять точек — ${ev.value}` : c === 0 ? `ни одной точки — ${ev.value}` : `точек: ${c}`;
    return `${name(ev.seat)}: ${v}${ev.none && ev.value > 0 ? ' — ходить некуда' : ''}.`;
  }
  if (ev.type === 'move') {
    const parts: string[] = [];
    if (ev.from < 0) parts.push('вводит фишку');
    if (ev.hit >= 0) parts.push(`сбивает фишку: ${name(ev.hit)}`);
    if (ev.to >= 52) parts.push('проводит фишку по кругу');
    if (ev.again) parts.push('и бросает ещё раз');
    return parts.length ? `${name(ev.seat)} ${parts.join(', ')}.` : null;
  }
  if (ev.type === 'pay') {
    const lines = ev.pays.map((p) => payText(p, name)).filter(Boolean);
    const pot = ev.pays.filter((p) => p.why === 'pot');
    if (pot.length) lines.push(`${name(pot[0].to)} забирает кон: ${stake(pot.length)}`);
    return lines.length ? lines.join('. ') + '.' : null;
  }
  if (ev.type === 'bust') return `${name(ev.seat)}: нечем платить — проигрался и выбывает.`;
  if (ev.type === 'end') return `🏁 ${ev.why === 'race' ? 'Все фишки прошли круг' : ev.why === 'stakes' ? 'Все ставки у одного' : 'Партия затянулась — побеждает самый богатый'}.`;
  return null;
}

const demoSeats = (n = 2): SeatSpec[] => Array.from({ length: n }, (_, seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
/** Число меток → rig (пять rng.int(2): 1 — меткой вверх). */
const beans = (c: number) => [0, 1, 2, 3, 4].map((i) => (i < c ? 1 : 0));
const Roll = (seat: number, c: number, caption?: string): DemoStep<Action> => ({ seat, action: { type: 'roll' }, rig: beans(c), caption });
const Mv = (seat: number, from: number, caption?: string): DemoStep<Action> => ({ seat, action: { type: 'move', from }, caption });

/** Позиция для показа: фишки мест (путь, −1 — в чаше), ходит место 0. */
function pos(pieces: number[][], opts: Options = {}, stakes?: number[]): State {
  const s = newState(cfgFrom(opts), pieces.length, 0);
  s.pos = s.pos.map((row, i) => row.map((_, k) => pieces[i][k] ?? -1));
  if (stakes) s.stakes = stakes.slice();
  return s;
}

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

export const def: GameDef<State, Action, Event, State> = {
  id: 'patolli',
  title: 'Патолли',
  players: { min: 2, max: 4, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'throws',
      label: 'Бобы',
      type: 'select',
      choices: [
        { value: 'duran', label: 'по Дурану: 5 меток — 10, ни одной — подношение' },
        { value: 'modern', label: 'современные: ни одной — 10, пять — ещё бросок' },
      ],
      default: 'modern',
    },
    {
      key: 'enter',
      label: 'Ввод фишки',
      type: 'select',
      choices: [
        { value: 'one', label: 'только на единицу' },
        { value: 'any', label: 'любым броском' },
      ],
      default: 'any',
    },
    {
      key: 'hit',
      label: 'Сбивать',
      type: 'select',
      choices: [
        { value: 'center', label: 'только в середине креста' },
        { value: 'any', label: 'везде, кроме полукруглых концов' },
      ],
      default: 'any',
    },
    {
      key: 'goal',
      label: 'Цель',
      type: 'select',
      choices: [
        { value: 'race', label: 'провести все фишки' },
        { value: 'stakes', label: 'выиграть все ставки' },
      ],
      default: 'race',
    },
    { key: 'pieces', label: 'Фишек у каждого', type: 'select', choices: [2, 3, 4, 6].map((v) => ({ value: v, label: String(v) })), default: 6 },
    { key: 'stakes', label: 'Ставок у каждого', type: 'select', choices: [4, 6, 10, 15].map((v) => ({ value: v, label: String(v) })), default: 10 },
    { key: 'exact', label: 'Уйти с поля точным броском', type: 'toggle', default: false },
  ],
  presets: [
    { id: 'modern', label: 'Патолли', hint: 'Современные правила: ни одной метки — 10, вход любым броском, сбивают везде, кроме концов лучей', options: { throws: 'modern', enter: 'any', hit: 'any', goal: 'race', pieces: 6, stakes: 10, exact: false } },
    { id: 'patolli', label: 'По Дурану', hint: 'Хроника Дурана, XVI век: 6 фишек, вход на единицу, сбивают только в середине креста', options: { throws: 'duran', enter: 'one', hit: 'center', goal: 'race', pieces: 6, stakes: 10, exact: true } },
    { id: 'stakes', label: 'На все ставки', hint: 'Фишки ходят по кругу снова и снова, пока у одного не окажутся все ставки', options: { throws: 'duran', enter: 'one', hit: 'center', goal: 'stakes', pieces: 6, stakes: 6, exact: true } },
    { id: 'quick', label: 'Быстрая', hint: 'По три фишки, вход любым броском', options: { throws: 'duran', enter: 'any', hit: 'center', goal: 'race', pieces: 3, stakes: 6, exact: true } },
  ],

  setup: (seats, opts: Options, rng) => setup(opts, rng, seats.length || 2),
  toAct,
  apply,
  view: (s) => s,
  result(s) {
    if (s.phase !== 'over') return null;
    const text =
      s.why === 'race' ? 'все фишки прошли круг' : s.why === 'stakes' ? 'все ставки у победителя' : `больше всех ставок: ${Math.max(...s.stakes)}`;
    return { winners: s.winners, text };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    let s = setup({ enter: 'any' }, fixedRng(3), 4);
    const rng = fixedRng(11);
    for (let i = 0; i < 600 && s.phase !== 'over'; i++) {
      const a = choose(s, s.turn, 1, rng);
      if (!a) break;
      const r = apply(s, s.turn, a, rng);
      if (!r) break;
      s = r.state;
      const on = s.pos.flat().filter((p) => p >= 0 && p < 52).length;
      if (s.ply >= 40 && s.phase === 'move' && on >= 10 && s.pot > 0) break;
    }
    return s;
  },

  rules: {
    goal: 'Первым провести все свои фишки по кругу через четыре луча креста — и не проиграться: ставки уходят в кон и соперникам, а кому нечем платить, тот выбывает.',
    sections: [
      {
        title: 'Крест и фишки',
        html: `<p>Поле патолли — крест из 52 клеток, как на листе Флорентийского кодекса: четыре луча по два столбца,
          в середине — четыре клетки. У каждого игрока свой луч и шесть фишек-камешков в чаше.</p>
          <p>Фишка входит на первую клетку своего луча, идёт <b>по часовой стрелке</b>: наружу, вокруг полукруглого конца,
          обратно к середине — и в следующий луч. Пройдя все четыре луча, она уходит с поля.</p>`,
      },
      {
        title: 'Бобы вместо кубика',
        html: `<p>Кости — пять бобов с точкой на одной стороне. Сколько точек легло вверх — на столько клеток ход;
          <b>все пять — 10 клеток</b>. Ни одной точки — <b>подношение</b> богу игр Макуильшочитлю: ставка в кон, ход пропал.</p>
          <p>Ввести фишку из чаши можно только на <b>единицу</b>. После броска переставьте фишку сами: нажмите на неё (или на чашу),
          затем на подсвеченную клетку. Встать на занятую клетку нельзя, перепрыгивать можно; если ходить некуда, ход пропал.</p>`,
        demo: {
          seats: demoSeats(),
          setup: () => pos([[], []]),
          intro: 'Начало партии: все фишки в чашах.',
          steps: [
            Roll(0, 1, 'Одна точка — можно ввести фишку.'),
            Mv(0, -1, 'Фишка встаёт на первую клетку своего луча.'),
            Roll(1, 3, 'Три точки — ввести нельзя, а на поле фишек нет: ход пропал.'),
            Roll(0, 5, 'Все пять точек — это десять клеток!'),
            Mv(0, 0, 'Фишка идёт вдоль луча, огибает конец и возвращается.'),
          ],
        },
      },
      {
        title: 'Треугольники и полукруги',
        html: `<p>В каждом луче — ряд с тёмными <b>треугольниками</b>: вставший на них платит ставку в кон.
          Полукруглый <b>конец луча</b> — счастливое место: вставший туда бросает ещё раз.</p>`,
        demo: {
          seats: demoSeats(),
          setup: () => pos([[1, 2], [1]]),
          intro: 'Две красные фишки на своём луче.',
          steps: [
            Roll(0, 2, 'Две точки.'),
            Mv(0, 1, 'Фишка встала на треугольник — ставка уходит в кон.'),
            Roll(1, 4, 'Бирюзовым — четыре.'),
            Mv(1, 1, 'Их фишка встала на полукруглый конец…'),
            Roll(1, 1, '…и бросает ещё раз.'),
          ],
        },
      },
      {
        title: 'Сбить в середине',
        html: `<p>Четыре клетки в середине креста — место схватки. Встав на фишку соперника <b>в середине</b>, вы сбиваете её:
          она возвращается в чашу хозяина, а он платит вам ставку. На всех других клетках чужая фишка просто занимает место.</p>`,
        demo: {
          seats: demoSeats(),
          // красные (луч 3) в 3 клетках от середины между лучами 0 и 1, где стоит бирюзовая фишка (её путь 51)
          setup: () => pos([[22], [51]]),
          intro: 'Бирюзовая фишка стоит в середине креста, красная подходит к ней.',
          steps: [Roll(0, 3, 'Три точки — как раз до неё.'), Mv(0, 22, 'Сбита! Бирюзовая фишка вернулась в чашу, а её хозяин заплатил ставку.')],
        },
      },
      {
        title: 'Круг пройден',
        html: `<p>Фишка уходит с поля, пройдя круг <b>точным броском</b>. За это каждый соперник платит ей ставку, а весь кон
          достаётся вам. Кто первым проведёт все фишки, тот и выиграл.</p>`,
        demo: {
          seats: demoSeats(),
          setup: () => {
            const s = pos([[49], [10]]);
            s.pot = 2;
            return s;
          },
          intro: 'Красной фишке осталось три клетки, в кону две ставки.',
          steps: [Roll(0, 3, 'Три точки — ровно.'), Mv(0, 49, 'Круг пройден: бирюзовые платят ставку, кон — красным.')],
        },
      },
      {
        title: 'Ставки',
        html: `<p>Ацтеки играли на одеяла, перья, нефритовые бусины и даже на себя. Здесь у каждого — бусины-ставки.
          Кому нечем заплатить, тот <b>проигрался</b>: его фишки снимаются, и он выбывает. Последний оставшийся побеждает,
          даже если фишки ещё в пути.</p>
          <p>Вариант «на все ставки» (так у Дурана и шла игра): пройдя круг, фишка возвращается в чашу и может идти снова,
          а партия длится, пока все ставки не окажутся у одного.</p>`,
      },
      {
        title: 'Варианты',
        html: `<p>Источники расходятся, поэтому есть пресеты. <b>Современная</b> — как в нынешних наборах: ни одной точки — 10 клеток,
          все пять — 5 и бросок ещё раз, вводить можно любым броском (фишка встаёт на клетку броска), сбивать — везде, кроме
          полукруглых концов, а уйти с поля можно и с перебором. <b>Быстрая</b> — по три фишки и вход любым броском.
          Играют от двух до четырёх.</p>`,
      },
    ],
  },
};
