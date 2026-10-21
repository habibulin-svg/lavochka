/* «Шарики» по сети: дуэль один на один и «битва» до десяти. Игра реального времени — комната ведёт цепочки всех,
 * игроки шлют прицел и выстрелы. Без DOM. Одиночные сто уровней — аркада (index.ts), этот def — только для сетевого стола. */
import type { GameDef, SeatSpec } from '../../core/types';
import { VS_MODE, VS_PRESETS, VS_SEATS, vsCounts, vsCountsHint } from '../../core/vs';
import { botInput, cleanInput, idleInput, newVersus, snapshot, step, TICK_MS, type VsEvent, type VsIn, type VsState, type VsView } from './versus';

const ballsWord = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'серый шар' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'серых шара' : 'серых шаров');

export const def: GameDef<VsState, never, VsEvent, VsView> = {
  id: 'shariki',
  title: 'Шарики',
  players: { min: 2, max: 10, default: 2 },
  countsFor: vsCounts,
  countsHint: vsCountsHint,
  seats: VS_SEATS,
  options: [
    VS_MODE,
    {
      key: 'colors',
      label: 'Цветов шариков',
      hint: 'больше цветов — труднее собрать тройку',
      type: 'select',
      choices: [
        { value: 4, label: '4' },
        { value: 5, label: '5' },
      ],
      default: 4,
    },
  ],
  presets: VS_PRESETS,
  setup(seats: SeatSpec[], opts, rng) {
    const colors = Math.max(3, Math.min(5, Number(opts.colors ?? 4) || 4));
    const st = newVersus(
      seats.map((s) => s.seat),
      opts.mode === 'battle' ? 'battle' : 'duel',
      colors,
      rng
    );
    for (const x of seats) st.names[x.seat] = x.name;
    return st;
  },
  toAct: (s) => (s.over ? [] : s.seats.filter((x) => !x.out).map((x) => x.seat)),
  apply: () => null,
  view: (s) => snapshot(s),
  result(s) {
    if (!s.over) return null;
    const scores: Record<number, number> = {};
    for (const x of s.seats) scores[x.seat] = s.seats.length + 1 - (x.place || 1);
    const w = s.winners;
    const text = w.length === 1 ? `Последним устоял ${s.names[w[0]] || VS_SEATS[w[0]]?.name || 'игрок'}` : 'Выбыли разом — ничья';
    return { winners: w, text, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: () => null },
  realtime: {
    tickMs: TICK_MS,
    sendEvery: 2,
    idle: idleInput,
    input: cleanInput,
    tick: (s, inputs, rng) => step(s, inputs as (VsIn | null)[], rng),
    bot: (view, seat, level, mem, rng) => botInput(view, seat, level, mem, rng),
  },
  describe(ev, name) {
    if (ev.k === 'attack' && ev.n >= 3) return `🔘 ${name(ev.from)} → ${name(ev.to)}: ${ev.n} ${ballsWord(ev.n)}`;
    if (ev.k === 'out') return `🕳 ${name(ev.seat)}: шарик в люке${ev.by >= 0 ? ` — выбил ${name(ev.by)}` : ''} (${ev.place}-е место)`;
    if (ev.k === 'end') return ev.winners.length === 1 ? `🏆 Победил ${name(ev.winners[0])}` : '🏁 Выбыли разом — ничья';
    return null;
  },
  rules: {
    goal: 'Продержаться дольше всех: не пустить шарики в люк и завалить соперников серыми шарами.',
    sections: [
      {
        title: 'Стрельба',
        html: `<p>Как в одиночной игре: лягушка стреляет шариком, он встаёт в цепочку. Три и больше одного цвета подряд — исчезают;
          разрыв стягивается, если по краям один цвет, и так получаются комбо. Правая кнопка, <kbd>Пробел</kbd> или «⇄» — поменять шарик
          во рту и на спине.</p><p>Цепочка здесь бесконечная и катится всё быстрее.</p>`,
      },
      {
        title: 'Серые шары',
        html: `<p>Собрал четыре и больше или комбо — сопернику в цепочку встают серые шары, и она на пару секунд ускоряется.
          Серый ни с чем не складывается: его убирает только тройка, лопнувшая вплотную к нему.</p>
          <p>Серые шары ждут четыре секунды в полоске сбоку от поля. Успел сам собрать что-нибудь крупное — сначала гасишь то,
          что летит к тебе, и только остаток уходит сопернику.</p>`,
      },
      {
        title: 'Дуэль и битва',
        html: `<p><b>Дуэль</b> — вдвоём: своё поле крупно, соперника — рядом. <b>Битва</b> — от трёх до десяти, побеждает последний.
          Серые шары летят тому, кто бил тебя, а если таких нет — случайному; нажми на поле соперника, чтобы бить его.
          За каждого выбитого — бейдж: атаки сильнее на четверть, до вдвое. Шарик в люке — выбыл; выбывший может смотреть любого.</p>`,
      },
    ],
  },
  showcase() {
    const r = { v: 11, next: () => ((r.v = (r.v * 16807) % 2147483647) / 2147483647), int: (n: number) => Math.floor(r.next() * n), getState: () => 0 };
    const s = newVersus([0, 1], 'duel', 4, r);
    for (let i = 0; i < 160; i++) step(s, [null, null], r);
    s.seats[1].z.addGray(3);
    return s;
  },
};
