/* Ханафуда — описание игры для сборника: японский коикои (вдвоём, 12 / 6 / 1 месяц) и корейский го-стоп (вдвоём и втроём).
 * Колода — рисунки Louie Mantia (Wikimedia Commons, CC BY-SA 4.0). Без DOM. */
import type { GameDef, Options, SeatSpec } from '../../core/types';
import { CURTAIN, MONTHS, MOON, SAKE, info } from './cards';
import { choose } from './ai';
import { apply, cfgFrom, makeView, newState, setup, toAct, type Action, type Event, type Mode, type State, type View } from './engine';

export const SEATS = [
  { name: 'Тётя Валя', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Дядя Миша', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Серёга', color: '#2f7a3e', light: '#58ad66', dark: '#18452a' },
];

/** Имя карты для журнала: «луна (мискантус)»; пустые — по растению. */
export function cardTitle(id: number): string {
  const c = info(id);
  const month = MONTHS[c.month].toLowerCase();
  if (c.kind === 'kasu') return id === 43 ? 'гроза (ива)' : month;
  return `${c.name} (${month})`;
}
export const cn = (id: number) => `<b class="hf-k-${info(id).kind}">${cardTitle(id)}</b>`;

export const MODE_NAME = (mode: Mode, n: number) => (mode === 'koikoi' ? 'Коикои' : n === 2 ? 'Го-стоп вдвоём (матго)' : 'Го-стоп втроём');

const WHY: Record<string, string> = { jjok: 'чок!', ttadak: 'ттадак!', eat: 'съел ппок!', sseul: 'ссыль — стол чист!', bomb: 'бомба!' };

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'deal':
      if (ev.redeal) return 'На столе четыре одного месяца — пересдача.';
      return `Кон ${ev.round}. Первым ходит ${name(ev.oya)}.`;
    case 'play':
      if (ev.bomb) return `${name(ev.seat)}: бомба — три карты месяца «${MONTHS[info(ev.cards[0]).month]}».`;
      return `${name(ev.seat)}: ${cn(ev.cards[0])}${ev.onto.length ? ` → ${ev.onto.map((c) => cn(c)).join(', ')}` : ' — на стол'}${ev.shake ? ' (трясёт, ×2)' : ''}.`;
    case 'pass':
      return `${name(ev.seat)} пропускает выкладку (после бомбы).`;
    case 'flip':
      return `Из колоды: ${cn(ev.card)}.`;
    case 'take':
      if (!ev.cards.length) return ev.why ? `${name(ev.seat)}: ${WHY[ev.why]}` : null;
      return `${name(ev.seat)} забирает: ${ev.cards.map((c) => cn(c)).join(', ')}${ev.why ? ` — ${WHY[ev.why] ?? ''}` : ''}`;
    case 'stick':
      return `${name(ev.seat)}: <b>ппок!</b> Три карты месяца «${MONTHS[ev.month]}» застряли на столе.`;
    case 'steal':
      return `${name(ev.from)} отдаёт пустую карту (${cn(ev.card)}) — ${name(ev.to)}.`;
    case 'yaku':
      return `${name(ev.seat)}: ${ev.lines.map((l) => `${l.name} ${l.pts}`).join(', ')} — всего ${ev.total}.`;
    case 'call':
      if (!ev.go) return `${name(ev.seat)}: «Стоп!»`;
      return ev.mode === 'koikoi' ? `${name(ev.seat)}: «Коикои!»` : `${name(ev.seat)}: «${ev.n}-го!»`;
    case 'instant':
      return `${name(ev.seat)}: ${ev.what} — кон сразу.`;
    case 'score': {
      const r = ev.result;
      if (r.winner == null) return `Кон без очков${r.notes.length ? ` (${r.notes.join('; ')})` : ''}.`;
      const got = r.add[r.winner];
      return `Кон взял ${name(r.winner)}: +${got}${r.notes.length ? ` (${r.notes.join('; ')})` : ''}.`;
    }
    case 'end':
      return `🏁 Партия: ${ev.winners.map(name).join(' и ')} — ${ev.score[ev.winners[0]]}.`;
  }
  return null;
}

/** Чужие руки скрыты; тряску видят все (показывают три карты). */
function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all') return ev;
  if (ev.type === 'deal' && ev.hands) return { ...ev, hands: ev.hands.map((h, i) => (seats.includes(i) ? h : [])) };
  if (ev.type === 'instant' && !seats.includes(ev.seat)) return ev;
  return ev;
}

// ---------------------------------------------------------------- показ правил

const seats2: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));

function pos(opts: Options, hands: number[][], table: number[], deck: number[], caps: number[][] = [[], []]): State {
  const s = newState(cfgFrom(opts), [0, 1]);
  s.hands = hands.map((h) => h.slice());
  s.table = table.slice();
  s.caps = caps.map((c) => c.slice());
  // колода: сначала нужные карты, остальное — что не на руках и не на столе
  const used = new Set([...hands.flat(), ...table, ...caps.flat(), ...deck]);
  s.deck = [...deck, ...Array.from({ length: 48 }, (_, i) => i).filter((i) => !used.has(i))];
  s.round = 1;
  s.oya = 0;
  s.turn = 0;
  return s;
}

const KOI: Options = { mode: 'koikoi', months: 12 };
const GO: Options = { mode: 'gostop', months: 10 };
const P = (seat: number, card: number, caption?: string, onto?: number) => ({ seat, action: (onto != null ? { type: 'play', card, onto } : { type: 'play', card }) as Action, caption });
const D = (seat: number, caption?: string) => ({ seat, action: { type: 'draw' } as Action, caption });

export const def: GameDef<State, Action, Event, View> = {
  id: 'hanafuda',
  title: 'Ханафуда',
  players: { min: 2, max: 3, default: 2 },
  countsFor: (o) => (o.mode === 'gostop' ? [2, 3] : [2]),
  countsHint: (o) => (o.mode === 'gostop' ? 'вдвоём (матго) или втроём' : 'коикои — только вдвоём'),
  seats: SEATS,
  options: [
    {
      key: 'mode',
      label: 'Игра',
      type: 'select',
      choices: [
        { value: 'koikoi', label: 'коикои — Япония, вдвоём' },
        { value: 'gostop', label: 'го-стоп — Корея, вдвоём или втроём' },
      ],
      default: 'koikoi',
    },
    {
      key: 'months',
      label: 'Конов',
      type: 'select',
      choices: [
        { value: 12, label: '12 — целый год' },
        { value: 10, label: '10' },
        { value: 6, label: '6 — полгода' },
        { value: 3, label: '3' },
        { value: 1, label: '1 — один кон' },
      ],
      default: 12,
    },
    { key: 'double7', label: '7 очков и больше — вдвойне', type: 'toggle', default: true, showIf: (o) => o.mode !== 'gostop' },
    { key: 'koiDouble', label: 'Остановил соперника после его «коикои» — вдвойне', type: 'toggle', default: true, showIf: (o) => o.mode !== 'gostop' },
    { key: 'viewing', label: 'Ханами и цукими (сакэ под вишней и под луной)', type: 'toggle', default: true, showIf: (o) => o.mode !== 'gostop' },
    { key: 'sakeKasu', label: 'Чашка сакэ — ещё и пустая карта', type: 'toggle', default: true, showIf: (o) => o.mode !== 'gostop' },
    { key: 'handYaku', label: 'Тэси и куттуки на раздаче (6 очков)', type: 'toggle', default: true, showIf: (o) => o.mode !== 'gostop' },
    { key: 'nagari', label: 'Нагари: кон без очков — следующий вдвойне', type: 'toggle', default: true, showIf: (o) => o.mode === 'gostop' },
  ],
  presets: [
    { id: 'koikoi', label: 'Коикои — 12 месяцев', hint: 'Япония, вдвоём: целый год, по кону на месяц', options: { mode: 'koikoi', months: 12 } },
    { id: 'koikoi6', label: 'Коикои — полгода', hint: '6 конов, как в онлайн-клубах', options: { mode: 'koikoi', months: 6 } },
    { id: 'koikoi1', label: 'Коикои — один кон', hint: 'Быстрая партия на один месяц', options: { mode: 'koikoi', months: 1 } },
    { id: 'gostop', label: 'Го-стоп', hint: 'Корея: вдвоём или втроём, «го» и «стоп», ппок и штрафы-удвоения', options: { mode: 'gostop', months: 10 } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  redact,
  result(s) {
    if (!s.over) return null;
    const scores: Record<number, number> = {};
    for (const x of s.seats) scores[x] = s.score[x];
    return { winners: s.winners, text: `${s.score[s.winners[0]]} очков за ${s.round} ${s.round === 1 ? 'кон' : s.round < 5 ? 'кона' : 'конов'}`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    const s = pos(KOI, [[1, 21, 26, 37, 45, 14], [3, 7, 11, 15, 19, 23]], [6, 10, 30, 34, 38, 46, 18], [], [[0, 8, 5, 9, 24, 2], [36, 4, 13, 47]]);
    s.round = 4;
    s.score = [12, 7];
    return s;
  },

  rules: {
    goal: 'Собирать со стола карты по месяцам и складывать из взятого <b>комбинации</b> — светы, ленты, животных. Собрал — решай: остановиться и забрать очки или рискнуть ради большего.',
    sections: [
      {
        title: 'Колода',
        html: `<p>48 карт — 12 месяцев по 4, у каждого месяца своё растение: сосна, слива, вишня, глициния, ирис, пион, леспедеца, мискантус,
          хризантема, клён, ива, павлония. Карты месяца разной цены: <b>светы</b> (5 на колоду: журавль, занавес под вишней, луна,
          человек под дождём, феникс), <b>животные</b> (9, среди них кабан, олень, бабочки и чашка сакэ), <b>ленты</b> (10: три красные со стихами,
          три синие, четыре простые красные) и <b>пустые</b> (24).</p>
          <p>Рисунок колоды — Louie Mantia, すけじょ и Spenĉjo, Wikimedia Commons, лицензия CC BY-SA 4.0.</p>`,
      },
      {
        title: 'Ход',
        html: `<p>Каждому по 8 карт, ещё 8 — открыто на стол. Сначала кладёшь карту с руки: если на столе есть карта того же месяца — забираешь обе;
          нет — карта остаётся на столе. Потом <b>сам открываешь</b> верхнюю карту колоды, и она играет так же. Две карты того же месяца на столе —
          выбираешь, какую взять; три — забираешь все четыре.</p>`,
        demo: {
          seats: seats2,
          options: KOI,
          setup: () => pos(KOI, [[0, 5, 26, 33, 41, 14, 18, 44], [3, 9, 13, 17, 21, 25, 29, 37]], [2, 6, 7, 28, 10, 22, 38, 46], [30, 11]),
          steps: [
            P(0, 0, 'Журавль — карта сосны, на столе есть сосна: взял пару.'),
            D(0, 'Из колоды — мискантус, на столе луна того же месяца: забрал и её.'),
            P(1, 9, 'Соперник кладёт вишню — на столе вишня есть, пара его.'),
            D(1, 'Из колоды снова вишня, но её пара уже ушла — карта ложится на стол.'),
            P(0, 5, 'Лента сливы, а на столе две пустые сливы — выбираю, какую взять.', 6),
          ],
        },
      },
      {
        title: 'Комбинации коикои',
        html: `<ul>
          <li><b>Светы:</b> гоко — все пять, 10; сико — четыре без дождя, 8; амэ-сико — четыре с дождём, 7; санко — три без дождя, 5.</li>
          <li><b>Ханами-дзакэ</b> — занавес под вишней и чашка сакэ, 5; <b>цукими-дзакэ</b> — луна и чашка сакэ, 5.</li>
          <li><b>Иносикатё</b> — кабан, олень и бабочки, 5 (+1 за каждое другое животное).</li>
          <li><b>Акатан</b> — три красные ленты со стихами, 5; <b>аотан</b> — три синие, 5; обе — 10 (+1 за каждую лишнюю ленту).</li>
          <li><b>Тане</b> — 5 животных, 1 (+1 за каждое); <b>тандзаку</b> — 5 лент, 1 (+1); <b>касу</b> — 10 пустых, 1 (+1). Чашка сакэ — ещё и пустая.</li>
          </ul>`,
      },
      {
        title: 'Коикои или стоп',
        html: `<p>Собрал новую комбинацию — решай: <b>«Стоп»</b> — кон окончен, забираешь очки всех своих комбинаций (7 и больше — вдвойне);
          <b>«Коикои»</b> — играешь дальше, чтобы собрать больше. Но если после твоего «коикои» комбинацию соберёт соперник и остановится —
          ты не получишь ничего, а его очки удвоятся. Руки кончились, а никто не остановился, — кон без очков.</p>
          <p>Сразу на раздаче: четыре карты одного месяца на руке (тэси) или четыре пары (куттуки) — 6 очков. Партия — 12 конов (полгода — 6).</p>`,
        demo: {
          seats: seats2,
          options: { ...KOI, months: 1 },
          setup: () => pos({ ...KOI, months: 1 }, [[SAKE, 1, 5], [3, 7, 11]], [34, 22, 26], [42, 16], [[CURTAIN, MOON], [13]]),
          steps: [
            P(0, SAKE, 'Чашка сакэ берёт хризантему со стола. А у меня уже есть занавес и луна!'),
            D(0, 'Ханами и цукими — 10 очков. Теперь решаю: дальше или стоп.'),
            { seat: 0, action: { type: 'call', go: false } as Action, caption: '«Стоп!» — 10 очков, а за 7 и больше — вдвойне: 20.' },
          ],
        },
      },
      {
        title: 'Го-стоп',
        html: `<p>Корейская игра на той же колоде (у корейцев ноябрь — павлония, декабрь — ива с дождём). Вдвоём — по 10 карт и 8 на стол, втроём — по 7 и 6.</p>
          <p>Очки: <b>светы</b> — три 3 (с дождём 2), четыре 4, пять 15; <b>годори</b> (три птицы: соловей, кукушка, гуси) 5; <b>животные</b> — пять 1, +1 за каждое;
          <b>ленты</b> — хондан (со стихами), чхондан (синие), чходан (простые красные, кроме ивы) по 3, пять лент 1, +1; <b>пустые</b> — десять 1, +1,
          гроза и одна павлония — двойные, чашку сакэ можно считать двойной пустой.</p>
          <p>Набрал 7 очков (втроём — 3) — «го» или «стоп». Каждое «го» — +1, с третьего — удвоение. Сказал «го», а кон взял другой — <b>го-бак</b>, платишь вдвойне
          (втроём — и за второго). Удвоения: <b>пи-бак</b> — у проигравшего меньше 8 пустых (втроём — 6), <b>кван-бак</b> — у проигравшего нет светов,
          <b>мён-бак</b> — у победителя 7 животных. Кон без очков — <b>нагари</b>, следующий кон вдвойне.</p>`,
      },
      {
        title: 'Ппок, чок, ттадак',
        html: `<p>В го-стопе сыгранная и открытая карта решаются вместе. Открылась карта того же месяца, что ты только что сыграл:</p>
          <ul><li>сыграл на пустое место — <b>чок</b>: забираешь обе;</li>
          <li>сыграл на одну карту — <b>ппок</b>: все три застревают на столе, забрать их сможет тот, у кого четвёртая;</li>
          <li>сыграл на две — <b>ттадак</b>: забираешь все четыре.</li></ul>
          <p>Чок, ттадак, съеденный ппок (свой — вдвойне) и <b>ссыль</b> — сметённый стол — каждый соперник отдаёт тебе по одной пустой. Три ппока за кон — 7 очков сразу.
          Три карты месяца на руке — можно <b>трясти</b> (показать и удвоить свой выигрыш); а если четвёртая на столе — <b>бомба</b>: выкладываешь все три, забираешь четыре,
          берёшь по пустой и удваиваешь, а два следующих хода только открываешь колоду.</p>`,
        demo: {
          seats: seats2,
          options: GO,
          setup: () => pos(GO, [[1, 5, 13, 17, 21, 25, 33, 37, 41, 45], [0, 9, 14, 18, 22, 26, 30, 38, 42, 46]], [2, 6, 10, 15, 19, 23, 27, 35], [3, 7], [[39], [31, 34]]),
          steps: [
            P(0, 1, 'Лента сосны — на сосну со стола.'),
            D(0, 'А из колоды — опять сосна! Ппок: все три карты сосны застряли на столе.'),
            P(1, 0, 'У соперника журавль — четвёртая сосна. Он съедает ппок…'),
            D(1, '…и за съеденный ппок забирает у меня пустую карту. А из колоды слива — и её пара.'),
          ],
        },
      },
    ],
  },
};
