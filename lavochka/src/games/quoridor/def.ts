/* Коридор — описание игры: пешки и стенки, кто первым дойдёт до другого края. Вдвоём по 10 стенок или вчетвером
 * по 5; малое поле 7×7; строгий вариант без обхода вбок. */
import type { GameDef, Rng, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, at, cfgFrom, dist, newState, PLY_LIMIT, seatsFor, setup, toAct, type Action, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Красные', color: '#c8302a', light: '#f26a5e', dark: '#6a0e0a' },
  { name: 'Синие', color: '#2a5cc0', light: '#6a96f0', dark: '#0c2468' },
  { name: 'Жёлтые', color: '#e8b81c', light: '#ffe070', dark: '#8a6400', ink: '#7a5a00' },
  { name: 'Зелёные', color: '#2a9a48', light: '#6ad08a', dark: '#0c4a1c' },
];

export function stenok(n: number): string {
  const m = n % 10;
  const t = n % 100;
  return `${n} ${m === 1 && t !== 11 ? 'стенка' : m >= 2 && m <= 4 && (t < 12 || t > 14) ? 'стенки' : 'стенок'}`;
}

function describe(ev: Event, name: (seat: number) => string): string | null {
  if (ev.type === 'move' && ev.jump) return `${name(ev.seat)} перепрыгивают через пешку.`;
  if (ev.type === 'wall') return `🧱 ${name(ev.seat)} ставят стенку — осталось ${stenok(ev.left)}.`;
  if (ev.type === 'end') return ev.why === 'goal' ? `🏁 ${name(ev.winner)} дошли до другого края — победа!` : `⏱ Ходов слишком много — побеждают ${name(ev.winner)}: им ближе всех до цели.`;
  return null;
}

const duo: SeatSpec[] = [0, 2].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
/** Позиция 9×9: пешки [место, x, y], стенки [x, y, 'h'|'v']. */
function pos(pawns: [number, number, number][], walls: [number, number, 'h' | 'v'][] = [], turn = 0, diag = true): State {
  const s = newState(cfgFrom({ diag }), [0, 2]);
  for (const [seat, x, y] of pawns) s.pos[seat] = at(9, x, y);
  for (const [x, y, o] of walls) (o === 'h' ? s.hw : s.vw)[y * 8 + x] = 1;
  s.turn = turn;
  s.ply = 2;
  return s;
}
const Mv = (seat: number, x: number, y: number, caption?: string) => ({ seat, action: { type: 'move', to: at(9, x, y) } as Action, caption });
const Wl = (seat: number, x: number, y: number, o: 'h' | 'v', caption?: string) => ({ seat, action: { type: 'wall', x, y, o } as Action, caption });

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
  id: 'quoridor',
  title: 'Коридор',
  players: { min: 2, max: 4, default: 2 },
  countsFor: (o) => (o.mode === 'four' ? [4] : [2]),
  countsHint: (o) => (o.mode === 'four' ? 'вчетвером, у каждого по ' + (Number(o.size) === 7 ? 4 : 5) + ' стенок' : undefined),
  seatsFor,
  seats: SEATS,
  options: [
    {
      key: 'mode',
      label: 'Игроки',
      type: 'select',
      choices: [
        { value: 'duel', label: 'вдвоём — по 10 стенок (на 7×7 — по 8)' },
        { value: 'four', label: 'вчетвером — по 5 стенок (на 7×7 — по 4)' },
      ],
      default: 'duel',
    },
    {
      key: 'size',
      label: 'Поле',
      type: 'select',
      choices: [
        { value: 9, label: '9×9 — классика' },
        { value: 7, label: '7×7 — малое, как в детской версии' },
      ],
      default: 9,
    },
    { key: 'diag', label: 'Обход вбок', hint: 'Если за пешкой стенка или край, можно встать сбоку от неё. Без него — прыжок только прямо', type: 'toggle', default: true },
    {
      key: 'look',
      label: 'Вид',
      type: 'select',
      choices: [
        { value: 'walnut', label: 'тёмный орех, светлые стенки' },
        { value: 'beech', label: 'светлый бук, тёмные стенки' },
      ],
      default: 'walnut',
    },
  ],
  presets: [
    { id: 'duel', label: 'Вдвоём 9×9', hint: 'Классика: по 10 стенок', options: { mode: 'duel', size: 9, diag: true, look: 'walnut' } },
    { id: 'four', label: 'Вчетвером', hint: 'Четыре пешки с четырёх сторон, по 5 стенок', options: { mode: 'four', size: 9, diag: true, look: 'walnut' } },
    { id: 'small', label: 'Малое поле 7×7', hint: 'Быстрая партия: по 8 стенок', options: { mode: 'duel', size: 7, diag: true, look: 'beech' } },
    { id: 'strict', label: 'Без обхода', hint: 'Через пешку прыгают только прямо', options: { mode: 'duel', size: 9, diag: false, look: 'walnut' } },
  ],

  setup: (seats, opts) => setup(seats.map((x) => x.seat), opts),
  toAct,
  apply: (s, seat, a) => apply(s, seat, a),
  view: (s) => s,
  result(s) {
    if (!s.over || s.winner == null) return null;
    const scores: Record<number, number> = {};
    for (const q of s.order) scores[q] = -dist(s.cfg.n, s.hw, s.vw, q, s.pos[q]);
    return { winners: [s.winner], text: s.why === 'goal' ? 'первыми дошли до другого края' : 'ходов слишком много — ближе всех к цели', scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    let s = newState(cfgFrom({}), [0, 2]);
    const rng = fixedRng(3);
    for (let i = 0; i < 200 && s.ply < 18; i++) {
      const r = apply(s, s.turn, choose(s, s.turn, 1, rng)!);
      if (!r || r.state.over) break;
      s = r.state;
    }
    return s;
  },

  rules: {
    goal: 'Первым довести свою пешку до <b>любой клетки противоположного края</b> поля.',
    sections: [
      {
        title: 'Поле и пешки',
        html: `<p>Поле — 9×9 клеток, между клетками — <b>пазы</b> для стенок. Пешки стоят посередине своих краёв; красные
          начинают. Ход — <b>одно из двух</b>: шагнуть пешкой на соседнюю клетку (вперёд, назад или вбок, не по диагонали)
          или поставить стенку.</p>`,
        demo: { seats: duo, intro: 'Красные снизу, жёлтые сверху.', steps: [Mv(0, 4, 7, 'Красные шагнули вперёд.'), Mv(2, 4, 1, 'Жёлтые тоже.')] },
      },
      {
        title: 'Стенки',
        html: `<p>Стенка длиной в <b>две клетки</b> ставится в паз — поперёк или вдоль. Сквозь стенку пешки не ходят, поэтому
          стенками удлиняют дорогу сопернику. Вдвоём у каждого <b>10 стенок</b>, вчетвером — по 5; кончились — только ходить.</p>
          <p>Стенки не пересекаются крестом и не накладываются. И главное: <b>нельзя наглухо отрезать</b> ни одну пешку —
          у каждой должна остаться дорога к её краю, пусть и длинная.</p>`,
        demo: {
          seats: duo,
          setup: () => pos([
            [0, 4, 6],
            [2, 4, 2],
          ]),
          intro: 'Пешки идут навстречу.',
          steps: [Wl(0, 3, 2, 'h', 'Красные ставят стенку прямо перед жёлтыми — тем придётся обходить.'), Mv(2, 3, 2, 'Жёлтые обходят слева…'), Wl(0, 2, 1, 'v', '…и вторая стенка закрывает и этот путь.')],
        },
      },
      {
        title: 'Прыжок через пешку',
        html: `<p>Если пешки встали <b>лицом к лицу</b>, ходящий может <b>перепрыгнуть</b> через соперника — если за ним нет стенки.
          Через две пешки подряд прыгать нельзя.</p>`,
        demo: {
          seats: duo,
          setup: () => pos([
            [0, 4, 5],
            [2, 4, 4],
          ]),
          intro: 'Пешки уткнулись друг в друга.',
          steps: [Mv(0, 4, 3, 'Красные перепрыгнули через жёлтую пешку.')],
        },
      },
      {
        title: 'Обход вбок',
        html: `<p>Если же за пешкой соперника <b>стенка или край поля</b> (или ещё одна пешка), прыгнуть прямо нельзя — зато можно
          встать <b>сбоку от неё</b>, слева или справа. В строгом варианте «без обхода» этого нет.</p>`,
        demo: {
          seats: duo,
          setup: () => pos(
            [
              [0, 4, 5],
              [2, 4, 4],
            ],
            [[4, 3, 'h']]
          ),
          intro: 'За жёлтой пешкой — стенка.',
          steps: [Mv(0, 5, 4, 'Прямо не прыгнуть — красные встали справа от жёлтой.')],
        },
      },
      {
        title: 'Вчетвером',
        html: `<p>Вчетвером пешки стоят с <b>четырёх сторон</b> поля, у каждого по <b>5 стенок</b>; ходят по часовой стрелке:
          красные (снизу), синие (слева), жёлтые (сверху), зелёные (справа). Каждый идёт к противоположному краю; кто первым
          дошёл — победил.</p>
          <p>На малом поле 7×7 стенок меньше: вдвоём по 8, вчетвером по 4. Если партия затянулась (${PLY_LIMIT} ходов на всех),
          побеждает тот, кому ближе до цели.</p>`,
      },
    ],
  },
};
