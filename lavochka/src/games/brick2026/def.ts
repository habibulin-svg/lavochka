/* Brick Game 2026 по сети: дуэль и «битва до 16» — каждый сам за себя, кто останется последним. Без DOM.
 * Одиночные «тип A» и «тип B» — аркада (index.ts); этот def — для сетевого стола. */
import type { GameDef, Preset, SeatLook, SeatSpec } from '../../core/types';
import { rowsWord, VS_SEATS } from '../../core/vs';
import { botInput, cleanInput, idleInput, LAND, newBattle, snapshot, step, TICK_MS, type BrEvent, type BrIn, type BrState, type BrView } from './versus';

const MORE: SeatLook[] = [
  { name: 'Генка', color: '#2a8ac8', light: '#6ab8e8', dark: '#104a70' },
  { name: 'Ирка', color: '#c83a3a', light: '#e87a7a', dark: '#701818' },
  { name: 'Петька', color: '#5a8a2a', light: '#8ab85a', dark: '#2a4a10' },
  { name: 'Наташка', color: '#a05ac8', light: '#c88ae8', dark: '#502a70' },
  { name: 'Мишка', color: '#c8a02a', light: '#e8c86a', dark: '#705a10' },
  { name: 'Юлька', color: '#2ac8a0', light: '#6ae8c8', dark: '#107058' },
];
export const SEATS: SeatLook[] = [...VS_SEATS, ...MORE];

const PRESETS: Preset[] = [
  { id: 'battle', label: 'Битва до 16', hint: 'Каждый сам за себя, кто останется последним', options: { mode: 'battle' } },
  { id: 'duel', label: 'Дуэль 1 на 1', hint: 'Своё поле и поле соперника рядом', options: { mode: 'duel' } },
];

export const def: GameDef<BrState, never, BrEvent, BrView> = {
  id: 'brick2026',
  title: 'Brick Game 2026',
  players: { min: 2, max: 16, default: 16 },
  countsFor: (o) => (o.mode === 'duel' ? [2] : [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
  countsHint: (o) => (o.mode === 'duel' ? 'дуэль — вдвоём' : 'битва — от трёх до шестнадцати; свободные места займут боты'),
  seats: SEATS,
  options: [
    {
      key: 'mode',
      label: 'Режим',
      type: 'select',
      choices: [
        { value: 'battle', label: 'Битва до 16' },
        { value: 'duel', label: 'Дуэль 1 на 1' },
      ],
      default: 'battle',
    },
  ],
  presets: PRESETS,
  setup(seats: SeatSpec[], opts, rng) {
    const st = newBattle(
      seats.map((s) => s.seat),
      opts.mode === 'duel' ? 'duel' : 'battle',
      rng
    );
    for (const x of seats) st.names[x.seat] = x.name;
    return st;
  },
  toAct: (s) => (s.over ? [] : s.seats.filter((x) => !x.out).map((x) => x.seat)),
  apply: () => null,
  view: (s, seats) => snapshot(s, seats),
  result(s) {
    if (!s.over) return null;
    const scores: Record<number, number> = {};
    for (const x of s.seats) scores[x.seat] = s.seats.length + 1 - (x.place || 1);
    const w = s.winners;
    const text = w.length === 1 ? `Последним устоял ${s.names[w[0]] || SEATS[w[0]]?.name || 'игрок'}` : 'Выбыли разом — ничья';
    return { winners: w, text, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: () => null },
  realtime: {
    tickMs: TICK_MS,
    sendEvery: 1,
    idle: idleInput,
    input: cleanInput,
    tick: (s, inputs, rng) => step(s, inputs as (BrIn | null)[], rng),
    bot: (view, seat, level, mem, rng) => botInput(view, seat, level, mem, rng),
  },
  describe(ev, name) {
    if (ev.k === 'attack' && ev.n >= 3) return `💥 ${name(ev.from)} → ${name(ev.to)}: ${ev.n} ряд${rowsWord(ev.n)} мусора`;
    if (ev.k === 'out') return `🧱 ${name(ev.seat)} — стакан переполнен${ev.by >= 0 ? `, добил ${name(ev.by)}` : ''} (${ev.place}-е место)`;
    if (ev.k === 'end') return ev.winners.length === 1 ? `🏆 Победил ${name(ev.winners[0])}` : '🏁 Выбыли разом — ничья';
    return null;
  },
  rules: {
    goal: 'Продержаться дольше всех: не дать стакану переполниться и завалить соперников мусорными рядами.',
    sections: [
      {
        title: 'Фигуры',
        html: `<p>Сверху падают фигуры из четырёх квадратиков. Сдвигайте и поворачивайте их, чтобы собрать сплошной ряд поперёк стакана —
          он исчезнет, всё, что выше, опустится. Стакан переполнился, новой фигуре некуда встать — вы выбыли.</p>
          <p>Скорость общая для всех и растёт: каждые 20 секунд и с каждым выбывшим. Управление — как в одиночной игре.</p>`,
      },
      {
        title: 'Мусорные ряды',
        html: `<p>Сняли разом два ряда — сопернику уходит один мусорный ряд, три — два, четыре — четыре. Снимаете ряды фигуру за фигурой подряд —
          прибавка за серию. Мусор с одной дыркой встаёт снизу у соперника и поднимает весь его стакан.</p>
          <p>Летящий к вам мусор виден красной полоской у поля. Он ждёт ${LAND} секунды и входит, когда вы ставите фигуру, не сняв ряда.
          Успели снять ряды сами — сначала гасите то, что летит к вам, остаток уходит дальше.</p>`,
      },
      {
        title: 'Цели и бейджи',
        html: `<p>Мусор летит тому, кто бил вас, а если таких нет — случайному сопернику; нажмите на мини-поле, чтобы бить его.
          Добили соперника — забираете его бейджи и ещё один свой: каждый бейдж делает атаки на четверть сильнее, до вдвое.</p>`,
      },
    ],
  },
  showcase() {
    const r = { v: 5, next: () => ((r.v = (r.v * 16807) % 2147483647) / 2147483647), int: (n: number) => Math.floor(r.next() * n), getState: () => 0 };
    const s = newBattle([...Array(16).keys()], 'battle', r);
    // стаканы «как в игре»: столбики разной высоты, колодец под палку; у соперников внизу — мусор
    for (const x of s.seats) {
      const well = x.seat === 0 ? 9 : (x.seat * 3) % 10;
      for (let col = 0; col < 10; col++) {
        if (col === well) continue;
        const hgt = (x.seat === 0 ? 7 : 3 + (x.seat % 7)) + Math.round(Math.sin(col * 1.7 + x.seat) * 1.5);
        for (let i = 0; i < hgt; i++) x.t.grid[(21 - i) * 10 + col] = i < (x.seat % 4) ? 8 : 1 + ((col * 5 + i * 2 + x.seat * 3 + ((col * i) % 3) * 2) % 7);
      }
    }
    const t0 = s.seats[0].t;
    t0.cur = { k: 1, r: 1, x: 9, y: 9 };
    t0.level = 0;
    s.seats[0].badges = 3;
    s.seats[0].ko = 2;
    s.seats[0].t.garbage = [{ n: 3, hole: 2, at: 99, from: 5 }];
    s.seats[3].out = true;
    s.seats[3].place = 16;
    return s;
  },
};
