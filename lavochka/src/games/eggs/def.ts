/* «Яйца динозавров» по сети: дуэль один на один и «битва» до десяти. Игра реального времени — комната ведёт поля всех,
 * игроки шлют прицел и выстрелы. Без DOM. Одиночные сто уровней — аркада (index.ts), этот def — только для сетевого стола. */
import type { GameDef, SeatSpec } from '../../core/types';
import { botInput, cleanInput, idleInput, newVersus, snapshot, step, TICK_MS, type VsEvent, type VsIn, type VsMode, type VsState, type VsView } from './versus';

export const SEATS = [
  { name: 'Вовка', color: '#c0281e', light: '#e86a5a', dark: '#7a140e' },
  { name: 'Ленка', color: '#23408f', light: '#5a78c8', dark: '#122450' },
  { name: 'Серёга', color: '#2a7a3a', light: '#5aaa6a', dark: '#164a20' },
  { name: 'Танька', color: '#8a5a10', light: '#c8964a', dark: '#4a3008' },
  { name: 'Димка', color: '#7a2a8a', light: '#b06ac0', dark: '#40104a' },
  { name: 'Олька', color: '#c05a10', light: '#e8945a', dark: '#6a3008' },
  { name: 'Лёха', color: '#1a7a7a', light: '#5ab0b0', dark: '#0a4040' },
  { name: 'Маринка', color: '#b0306a', light: '#e070a0', dark: '#601838' },
  { name: 'Костик', color: '#4a5a1a', light: '#8a9a5a', dark: '#2a3008' },
  { name: 'Светка', color: '#3a3a9a', light: '#7a7ad0', dark: '#1a1a50' },
];

const placeText = (p: number) => `${p}-е место`;

export const def: GameDef<VsState, never, VsEvent, VsView> = {
  id: 'eggs',
  title: 'Яйца динозавров',
  players: { min: 2, max: 10, default: 2 },
  countsFor: (o) => (o.mode === 'battle' ? [3, 4, 5, 6, 7, 8, 9, 10] : [2]),
  countsHint: (o) => (o.mode === 'battle' ? 'битва — от трёх до десяти' : 'дуэль — вдвоём'),
  seats: SEATS,
  options: [
    {
      key: 'mode',
      label: 'Режим',
      type: 'select',
      choices: [
        { value: 'duel', label: 'Дуэль 1 на 1' },
        { value: 'battle', label: 'Битва до 10' },
      ],
      default: 'duel',
    },
    {
      key: 'colors',
      label: 'Цветов яиц',
      hint: 'больше цветов — труднее собрать тройку',
      type: 'select',
      choices: [
        { value: 4, label: '4' },
        { value: 5, label: '5' },
        { value: 6, label: '6' },
      ],
      default: 5,
    },
  ],
  presets: [
    { id: 'duel', label: 'Дуэль 1 на 1', hint: 'Своё поле и поле соперника рядом', options: { mode: 'duel' } },
    { id: 'battle', label: 'Битва до 10', hint: 'Кто останется последним', options: { mode: 'battle' } },
  ],
  setup(seats: SeatSpec[], opts, rng) {
    const mode: VsMode = opts.mode === 'battle' ? 'battle' : 'duel';
    const colors = Math.max(3, Math.min(6, Number(opts.colors ?? 5) || 5));
    const st = newVersus(
      seats.map((s) => s.seat),
      mode,
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
    const text = w.length === 1 ? `Последним устоял ${s.names?.[w[0]] || SEATS[w[0]]?.name || 'игрок'}` : 'Выбыли разом — ничья';
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
    if (ev.k === 'attack' && ev.n >= 2) return `🥚 ${name(ev.from)} → ${name(ev.to)}: падлянка на <b>${ev.n}</b> ряд${ev.n < 5 ? 'а' : 'ов'}`;
    if (ev.k === 'out') return `💥 ${name(ev.seat)} выбыл${ev.by >= 0 ? ` — выбил ${name(ev.by)}` : ''} (${placeText(ev.place)})`;
    if (ev.k === 'clear') return `✨ ${name(ev.seat)} расчистил всё поле!`;
    if (ev.k === 'end') return ev.winners.length === 1 ? `🏆 Победил ${name(ev.winners[0])}` : '🏁 Выбыли разом — ничья';
    return null;
  },
  rules: {
    goal: 'Продержаться дольше всех: не дать яйцам опуститься за красную черту и завалить соперников падлянками.',
    sections: [
      {
        title: 'Стрельба',
        html: `<p>Как в одиночной игре: динозаврик стреляет яйцом, оно отскакивает от стенок и прилипает к кладке.
          Три и больше одного цвета вместе — лопаются, всё, что после этого ни за что не держится, падает.
          <kbd>Пробел</kbd> или «⇄» — поменять яйцо на следующее.</p>`,
      },
      {
        title: 'Падлянки',
        html: `<p>Лопнули четыре яйца и больше или случился обвал — сопернику сверху наезжает ряд яиц, а за крупный обвал и несколько.
          Расчистил всё поле — большая падлянка, а тебе новая кладка.</p>
          <p>Падлянка наезжает не сразу: три секунды она ждёт в полоске сбоку от поля. Успел сам лопнуть что-нибудь крупное —
          сначала гасишь то, что летит к тебе, и только остаток уходит сопернику.</p>`,
      },
      {
        title: 'Потолок и темп',
        html: `<p>Раз в несколько секунд всем сразу сверху наезжает ряд. Чем дольше идёт партия и чем меньше осталось игроков,
          тем чаще это случается и тем сильнее падлянки, так что партия длится минуты три-шесть.</p>
          <p>Яйцо за красной чертой — выбыл.</p>`,
      },
      {
        title: 'Дуэль и битва',
        html: `<p><b>Дуэль</b> — вдвоём: своё поле крупно, соперника — рядом целиком.</p>
          <p><b>Битва</b> — от трёх до десяти, побеждает последний уцелевший. Падлянки летят тому, кто бил тебя, а если таких нет —
          случайному; нажми на поле соперника, чтобы бить его. За каждого выбитого — бейдж: падлянки сильнее на четверть, до вдвое.
          Выбывший может смотреть любого: нажмите на его поле.</p>`,
      },
    ],
  },
  showcase() {
    const rng = { next: () => 0.37, int: (n: number) => Math.floor(n * 0.37), getState: () => 0 };
    const s = newVersus([0, 1], 'duel', 5, rng);
    const r = { v: 7, next: () => ((r.v = (r.v * 16807) % 2147483647) / 2147483647), int: (n: number) => Math.floor(r.next() * n), getState: () => 0 };
    for (let i = 0; i < 6; i++) {
      step(s, [{ aim: -1.2, shot: i + 1, shotAim: -1.2 - i * 0.2, swap: 0, target: -1 }, { aim: -1.9, shot: i + 1, shotAim: -2 + i * 0.25, swap: 0, target: -1 }], r);
      for (let k = 0; k < 6; k++) step(s, [null, null], r);
    }
    s.seats[1].queue.push({ n: 2, at: s.t + 2, from: 0 });
    return s;
  },
};
