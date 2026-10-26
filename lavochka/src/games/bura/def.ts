/* Бура — описание игры для сборника: москва, «вслепую», до скольких палок; 2–4 игрока; боты, правила с показом. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { SUIT_SYM, type Card, type Suit } from '../../cards/deck';
import { choose } from './ai';
import { apply, cfgFrom, makeView, newState, setup, toAct, type Action, type Event, type State, type View, COMBO_NAME } from './engine';

export const SEATS = [
  { name: 'Вовка', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Ленка', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Серёга', color: '#2f7a3e', light: '#58ad66', dark: '#18452a' },
  { name: 'Танька', color: '#d9a521', light: '#f3cf62', dark: '#8a6410', ink: '#8a6410' },
];

const cn = (c: Card) => `<b>${c.r === 14 ? 'Т' : c.r === 13 ? 'К' : c.r === 12 ? 'Д' : c.r === 11 ? 'В' : c.r}${SUIT_SYM[c.s]}</b>`;
const REASON: Record<string, string> = { declare: 'вскрылся — 31 есть', wrong: 'вскрылся без 31', bura: 'бура!', moscow: 'москва!', molodka: 'молодка!', konce: '4 конца!', small: 'малая москва!', cards: 'карты кончились' };

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'deal':
      return `Кон ${ev.round}. Козырь — ${cn(ev.trump)}.`;
    case 'lead':
      return `${name(ev.seat)} заходит: ${ev.cards.map(cn).join(' ')}`;
    case 'beat':
      return `${name(ev.seat)} бьёт: ${ev.cards.map(cn).join(' ')}`;
    case 'skip':
      return `${name(ev.seat)} скидывает втёмную (${ev.count})`;
    case 'take':
      return null;
    case 'declare':
      return ev.ok ? `${name(ev.seat)}: «Вскрываюсь!» — <b>${ev.pts}</b> очков.` : `${name(ev.seat)}: «Вскрываюсь!» — а там всего ${ev.pts}. Ошибка!`;
    case 'show':
      return `${name(ev.seat)}: <b>${ev.kind === 'molodka' && ev.cards.length ? 'Стоп! Молодка' : COMBO_NAME[ev.kind]}!</b> ${ev.cards.map(cn).join(' ')}`;
    case 'round': {
      const add = ev.add.map((x, i) => (x ? `${name(i)} +${x}` : '')).filter(Boolean);
      return `${ev.winner != null ? `Кон за ${name(ev.winner)}` : 'Кон без победителя'} (${REASON[ev.reason]}). Палки: ${add.join(', ') || 'никому'}.`;
    }
    case 'end':
      return `🏁 Партия окончена: ${name(ev.loser)} набирает ${ev.palki[ev.loser]} палок.`;
  }
  return null;
}

/** Чужие карты и скинутое втёмную не показываем. */
function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all') return ev;
  if (ev.type === 'deal') return { ...ev, hands: ev.hands?.map((h, i) => (seats.includes(i) ? h : [])) };
  if ((ev.type === 'draw' || ev.type === 'skip') && !seats.includes(ev.seat)) return { ...ev, cards: undefined };
  return ev;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);

/** Позиция вдвоём: руки, козырь, колода (верх первым), взятки. */
function pos(hands: string[], trump: string, deck: string, piles: string[] = [], extra: Partial<State> = {}): State {
  const s = newState(cfgFrom({}), [0, 1]);
  hands.forEach((h, i) => (s.hands[i] = L(h)));
  piles.forEach((p, i) => (s.piles[i] = L(p)));
  s.trumpCard = C(trump);
  s.trump = s.trumpCard.s;
  s.deck = [...L(deck), s.trumpCard];
  s.round = 1;
  s.turn = 0;
  return Object.assign(s, extra);
}

const A = (seat: number, a: Action, caption?: string) => ({ seat, action: a, caption });

export const def: GameDef<State, Action, Event, View> = {
  id: 'bura',
  title: 'Бура',
  players: { min: 2, max: 4, default: 2 },
  seats: SEATS,
  options: [
    { key: 'moscow', label: 'Москва', type: 'toggle', default: true, hint: 'Три туза на руке (при четырёх картах — с козырным) — сразу выигрыш кона, как бура.' },
    {
      key: 'mode',
      label: 'Кон',
      type: 'select',
      choices: [
        { value: 'bura', label: 'бура: вскрыться на 31' },
        { value: 'kozel', label: 'буркозёл: до конца, 61 из 120' },
      ],
      default: 'bura',
    },
    {
      key: 'hand',
      label: 'Карт на руке',
      type: 'select',
      choices: [
        { value: 3, label: 'по 3' },
        { value: 4, label: 'по 4' },
      ],
      default: 3,
    },
    { key: 'blind', label: 'Вслепую', type: 'toggle', default: false, hint: 'Свои очки не показываются — считайте в уме, как во дворе.' },
    {
      key: 'limit',
      label: 'До скольких палок',
      type: 'select',
      choices: [
        { value: 8, label: 'до 8 — быстро' },
        { value: 12, label: 'до 12' },
        { value: 16, label: 'до 16' },
      ],
      default: 12,
    },
  ],
  presets: [
    { id: 'classic', label: 'Классическая', hint: 'С москвой, очки видны', options: { mode: 'bura', hand: 3, moscow: true, blind: false, limit: 12 } },
    { id: 'blind', label: 'Вслепую', hint: 'Считай очки в уме — ошибёшься, проиграешь', options: { mode: 'bura', hand: 3, moscow: true, blind: true, limit: 12 } },
    { id: 'quick', label: 'Быстрая', hint: 'До 8 палок', options: { mode: 'bura', hand: 3, moscow: true, blind: false, limit: 8 } },
    { id: 'burkozel', label: 'Буркозёл', hint: 'По 4 карты, кон до конца: 61 из 120, штрафы 2/4/6 до 12', options: { mode: 'kozel', hand: 4, moscow: true, blind: false, limit: 12 } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  redact,
  result(s) {
    if (s.phase !== 'over' || s.loser == null) return null;
    const low = Math.min(...s.seats.map((x) => s.palki[x]));
    const winners = s.seats.filter((x) => s.palki[x] === low);
    const scores: Record<number, number> = {};
    for (const x of s.seats) scores[x] = -s.palki[x];
    return { winners, text: `меньше всех палок — ${low}`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => makeView(pos(['AS 10S 7H', 'KC 9D 6S'], 'QH', '8C 9S JD', ['AD KD'], { phase: 'answer', turn: 1, lead: { seat: 0, cards: [C('KS')] }, best: { seat: 0, cards: [C('KS')] } }), [0]),

  rules: {
    goal: 'Первым набрать во взятках <b>31</b> очко и «вскрыться» — или собрать буру. Проигравшие кон получают палки; у кого их больше всех к концу — проиграл партию.',
    sections: [
      {
        title: 'Карты и очки',
        html: `<p>Колода — 36 карт. Очки: <b>туз</b> — 11, <b>десятка</b> — 10, король — 4, дама — 3, валет — 2, остальные — 0. Десятка старше короля.</p>
          <p>Каждому по 3 карты, следующую открывают — это <b>козырь</b>, её кладут под колоду. После каждой взятки добирают до трёх.</p>`,
      },
      {
        title: 'Заход и отбой',
        html: `<p>Заходят одной картой или двумя-тремя <b>одной масти</b>. Остальные по очереди кладут столько же карт: либо бьют <b>каждую</b>
          (старшей той же масти или козырем), либо скидывают любые втёмную. Взятку забирает тот, кто побил последним, — вместе со скинутым.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['10S 9C KC', 'AS 6H 10C'], 'QH', '7D 8D 9D 7S 8S 9S'),
          intro: 'Козырь — черви.',
          steps: [
            A(0, { type: 'lead', cards: [C('10S')] }, 'Вовка заходит десяткой пик.'),
            A(1, { type: 'beat', cards: [C('AS')] }, 'Ленка бьёт тузом — 21 очко её.'),
            A(1, { type: 'lead', cards: [C('6H')] }, 'Теперь она заходит.'),
            A(0, { type: 'skip', cards: [C('9C')] }, 'Козырь Вовке крыть нечем — скидывает пустую девятку.'),
          ],
        },
      },
      {
        title: 'Заход парой',
        html: `<p>Две-три карты одной масти отбить трудно: каждую надо покрыть. Не можешь покрыть все — придётся скидывать столько же карт.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['9C KC 7D', '10C 6H 8S'], 'QH', '7S 8D 9D 9S 6D'),
          steps: [A(0, { type: 'lead', cards: [C('9C'), C('KC')] }, 'Вовка заходит двумя трефами.'), A(1, { type: 'beat', cards: [C('10C'), C('6H')] }, 'Ленка кроет: короля — десяткой, девятку — козырем.')],
        },
      },
      {
        title: 'Вскрыться',
        html: `<p>Набрал во взятках <b>31</b> — на своём заходе скажи «Вскрываюсь!»: очки пересчитают, и кон твой. Ошибся — кон проигран.
          Если карты кончились, а никто не вскрылся, выигрывает тот, у кого больше очков.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['9C KC 7D', '10C 6H 8S'], 'QH', '7S 8D', ['AS 10S AD', '']),
          intro: 'Во взятках у Вовки туз, десятка и туз — 32 очка.',
          steps: [A(0, { type: 'declare' }, '«Вскрываюсь!» — 32, кон за Вовкой.')],
        },
      },
      {
        title: 'Бура и москва',
        html: `<p><b>Бура</b> — три козыря на руке, <b>москва</b> — три туза. Показал на своём заходе — сразу выиграл кон, а проигравшим — по 4 палки.</p>
          <p>Слабее — <b>молодка</b> (три карты одной некозырной масти) и <b>малая москва</b> (три десятки): кон тоже твой, но проигравшим по 2 палки.
          Молодку можно показать и не в свой заход — крикнуть «Стоп!», когда отвечаешь на чужой заход.</p>
          <p>Палки: проигравшему кон — 2, без единой взятки — 4. Кто первым набрал 12 (или сколько договорились), тот проиграл партию.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['6H 9H AH', '10C 7S 8S'], 'QH', '7D 8D'),
          intro: 'У Вовки три червы, а черви — козырь.',
          steps: [A(0, { type: 'show', kind: 'bura' }, 'Бура! Кон за Вовкой.')],
        },
      },
      {
        title: 'Буркозёл',
        html: `<p>Бура пополам с Козлом. На руке <b>по 4 карты</b>, заходить можно и всеми четырьмя одной масти. Кон играют до последней карты:
          все очки — 120, выигрывает набравший больше (можно и раньше «вскрыться», если у тебя уже 61).</p>
          <p>Штрафные «палки»: у кого 31 и больше — 2, 30 и меньше — 4, ни одной взятки — 6. Лучшему — ничего. Поровну у лучших — «яйца»:
          следующий кон вдвойне. <b>Бура</b> — четыре козыря, <b>москва</b> — три туза с козырным, <b>4 конца</b> — четыре десятки
          или четыре туза: кон сразу, остальным по 6. <b>Молодка</b> — четыре карты одной масти (можно и «Стоп!» не в свой заход): кон твой,
          остальным по 4. 12 палок — козёл.</p>`,
        demo: {
          seats: demoSeats,
          options: { mode: 'kozel', hand: 4 },
          setup: () => {
            const s = pos(['7D 9D KD 6C', 'AD 6H 10C 8S'], 'QH', '7S 8D 9C JS JC');
            s.cfg = cfgFrom({ mode: 'kozel', hand: 4 });
            return s;
          },
          intro: 'Козырь — черви, на руке по четыре.',
          steps: [
            A(0, { type: 'lead', cards: [C('7D'), C('9D'), C('KD')] }, 'Вовка заходит тремя бубнами.'),
            A(1, { type: 'skip', cards: [C('10C'), C('8S'), C('6H')] }, 'Покрыть все три Ленке нечем — туз и козырь есть, а третьей карты нет. Скидывает втёмную, взятка Вовке.'),
          ],
        },
      },
    ],
  },
};
