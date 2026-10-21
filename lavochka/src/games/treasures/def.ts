/* «Клад» по сети: дуэль один на один и «битва» до десяти. Ходят все сразу, каждый на своём поле; комната ведёт поля, падлянки и отсев.
 * Без DOM. Одиночные сто уровней — аркада (index.ts), этот def — только для сетевого стола. */
import type { GameDef, SeatSpec } from '../../core/types';
import { VS_MODE, VS_PRESETS, VS_SEATS, vsCounts, vsCountsHint } from '../../core/vs';
import { botInput, cleanInput, CUT_EVERY, idleInput, newVersus, snapshot, step, TICK_MS, type VsEvent, type VsIn, type VsState, type VsView } from './versus';

const bricksWord = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? 'кирпич' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'кирпича' : 'кирпичей');

export const def: GameDef<VsState, never, VsEvent, VsView> = {
  id: 'treasures',
  title: 'Клад',
  players: { min: 2, max: 10, default: 2 },
  countsFor: vsCounts,
  countsHint: vsCountsHint,
  seats: VS_SEATS,
  options: [
    VS_MODE,
    {
      key: 'kinds',
      label: 'Видов сокровищ',
      hint: 'больше видов — реже ряды и каскады',
      type: 'select',
      choices: [
        { value: 5, label: '5' },
        { value: 6, label: '6' },
        { value: 7, label: '7' },
      ],
      default: 6,
    },
  ],
  presets: VS_PRESETS,
  setup(seats: SeatSpec[], opts, rng) {
    const kinds = Math.max(4, Math.min(7, Number(opts.kinds ?? 6) || 6));
    const st = newVersus(
      seats.map((s) => s.seat),
      opts.mode === 'battle' ? 'battle' : 'duel',
      kinds,
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
    const text = w.length === 1 ? `Последним устоял ${s.names[w[0]] || VS_SEATS[w[0]]?.name || 'игрок'}` : 'Выбыли разом — ничья';
    return { winners: w, text, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: () => null },
  realtime: {
    tickMs: TICK_MS,
    sendEvery: 1,
    idle: idleInput,
    input: cleanInput,
    tick: (s, inputs, rng) => step(s, inputs as (VsIn | null)[], rng),
    bot: (view, seat, level, mem, rng) => botInput(view, seat, level, mem, rng),
  },
  describe(ev, name) {
    if (ev.k === 'attack' && ev.n >= 2) return `🧱 ${name(ev.from)} → ${name(ev.to)}: ${ev.n} ${bricksWord(ev.n)}`;
    if (ev.k === 'out')
      return ev.why === 'cut' ? `⏱ ${name(ev.seat)} — меньше всех очков, выбыл (${ev.place}-е место)` : `🪨 ${name(ev.seat)}: ходов не осталось${ev.by >= 0 ? ` — выбил ${name(ev.by)}` : ''} (${ev.place}-е место)`;
    if (ev.k === 'end') return ev.winners.length === 1 ? `🏆 Победил ${name(ev.winners[0])}` : '🏁 Выбыли разом — ничья';
    return null;
  },
  rules: {
    goal: 'Продержаться дольше всех: не остаться без ходов и завалить соперников кирпичами.',
    sections: [
      {
        title: 'Ходы',
        html: `<p>Как в одиночной игре: поменяйте соседние фишки — ряд из трёх и больше исчезает. Четыре в ряд — лопата, пять — самородок,
          уголок — динамит. Ходят все сразу, каждый на своём поле, кто как успеет.</p>`,
      },
      {
        title: 'Кирпичи',
        html: `<p>Каскад (после хода ряды складываются ещё и ещё) или новая спецфишка — сопернику на поле встают кирпичи.
          Кирпич не двигается и ни с чем не складывается. Соберите ряд вплотную к нему — разобьётся; не успели за три своих хода —
          каменеет навсегда.</p>
          <p>Кирпичи ждут пять секунд в полоске сбоку от поля: успел сам сделать каскад — сначала гасишь то, что летит к тебе,
          остаток уходит сопернику. А раз в несколько секунд кирпич достаётся всем — чем дольше партия, тем чаще.</p>`,
      },
      {
        title: 'Кто выбывает',
        html: `<p>Не осталось ни одного хода — выбыл. В <b>битве</b> (от трёх до десяти) ещё и каждые ${CUT_EVERY} секунд выбывает
          тот, у кого меньше всех очков. Кирпичи летят тому, кто бил тебя, а если таких нет — случайному; нажми на поле соперника,
          чтобы бить его. За каждого выбитого — бейдж: атаки сильнее на четверть, до вдвое. В <b>дуэли</b> — своё поле и поле соперника рядом.</p>`,
      },
    ],
  },
  showcase() {
    const r = { v: 5, next: () => ((r.v = (r.v * 16807) % 2147483647) / 2147483647), int: (n: number) => Math.floor(r.next() * n), getState: () => 0 };
    const s = newVersus([0, 1], 'duel', 6, r);
    s.seats[0].b.addBricks(2, 2);
    s.seats[1].b.addBricks(3, 3);
    return s;
  },
};
