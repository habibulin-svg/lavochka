/* Деберц — описание игры для сборника: деберц на 2–4 (вчетвером парами), одесский клабор, французский белот. Без DOM. */
import type { GameDef, Options, SeatSpec } from '../../core/types';
import { SUIT_SYM, type Card, type Suit } from '../../cards/deck';
import { choose } from './ai';
import { apply, cfgFrom, makeView, newState, pairs, setup, teamOf, toAct, type Action, type Event, type State, type View } from './engine';

export const SEATS = [
  { name: 'Изя', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Сёма', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Додик', color: '#c84a1a', light: '#f08050', dark: '#7a2a0a' },
  { name: 'Мотя', color: '#1f5a9a', light: '#5a8ad0', dark: '#0f2a5a' },
];

const RANK: Record<number, string> = { 14: 'Т', 13: 'К', 12: 'Д', 11: 'В' };
const cn = (c: Card) => `<b class="${c.s === 'H' || c.s === 'D' ? 'red' : ''}">${RANK[c.r] ?? c.r}${SUIT_SYM[c.s]}</b>`;

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'deal':
      return `Сдача ${ev.deal}. Сдаёт ${name(ev.dealer)}, открыта ${cn(ev.up)}.`;
    case 'bid':
      return `${name(ev.seat)}: ${ev.play ? (ev.suit ? `козырь ${SUIT_SYM[ev.suit]}` : '«играю»') : 'пас'}.`;
    case 'redeal':
      return 'Все спасовали — пересдача.';
    case 'trump':
      return `Играет ${name(ev.taker)}, козырь ${SUIT_SYM[ev.suit]}.`;
    case 'swap':
      return `${name(ev.seat)} меняет семёрку на ${cn(ev.took)}.`;
    case 'decl':
      return `${name(ev.seat)}: ${ev.what}${ev.pts ? ` (+${ev.pts})` : ''}.`;
    case 'trick':
      return null;
    case 'hand':
      return `Сдача: ${ev.add.map((x) => (x > 0 ? '+' : '') + x).join(' : ')}${ev.lines.length ? ` — ${ev.lines.join(', ')}` : ''}. Счёт ${ev.score.join(' : ')}.`;
    case 'end':
      return `🏁 Партия — ${ev.score.join(' : ')}.`;
  }
  return null;
}

function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all') return ev;
  if (ev.type === 'deal' || ev.type === 'trump') return { ...ev, hands: ev.hands?.map((h, i) => (seats.includes(i) ? h : [])) };
  return ev;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);

function pos(hands: string[], up: string, extra: Partial<State> = {}, opts: Options = {}): State {
  const s = newState(cfgFrom(opts, 2), [0, 1]);
  hands.forEach((h, i) => (s.hands[i] = L(h)));
  s.up = C(up);
  s.deck = L('7C 8C 9C 7D 8D 9D 7S 8S 9S QC QD');
  s.deal = 1;
  s.dealer = 1;
  s.turn = 0;
  return Object.assign(s, extra);
}
const A = (seat: number, a: Action, caption?: string) => ({ seat, action: a, caption });

export const def: GameDef<State, Action, Event, View> = {
  id: 'deberts',
  title: 'Деберц',
  players: { min: 2, max: 4, default: 2 },
  countsFor: (o) => (o.rules === 'belote' ? [4] : [2, 3, 4]),
  teams: (_o, seats) => (seats.length === 4 ? [[seats[0], seats[2]], [seats[1], seats[3]]] : null),
  seats: SEATS,
  options: [
    {
      key: 'rules',
      label: 'Игра',
      type: 'select',
      choices: [
        { value: 'deberts', label: 'деберц — терц, полтинник, белла' },
        { value: 'klabor', label: 'клабор — одесский, «обязон» и «лыжи»' },
        { value: 'belote', label: 'белот — французский, вчетвером' },
      ],
      default: 'deberts',
    },
    {
      key: 'target',
      label: 'Партия',
      type: 'select',
      choices: [
        { value: 301, label: 'до 301 — короткая' },
        { value: 501, label: 'до 501' },
        { value: 1001, label: 'до 1001' },
        { value: 1000, label: 'до 1000 (белот)' },
      ],
      default: 501,
    },
  ],
  presets: [
    { id: 'deberts', label: 'Деберц', hint: 'Вдвоём или втроём по 9 карт, до 501', options: { rules: 'deberts', target: 501 } },
    { id: 'pairs', label: 'Деберц парами', hint: 'Вчетвером пара на пару, по 8 карт, до 1001', options: { rules: 'deberts', target: 1001 } },
    { id: 'klabor', label: 'Клабор', hint: 'Одесский: «обязон», «лыжи» −100, третий байт −100', options: { rules: 'klabor', target: 501 } },
    { id: 'belote', label: 'Белот', hint: 'Французский: вчетвером по 8, карэ, капот, до 1000', options: { rules: 'belote', target: 1000 } },
    { id: 'short', label: 'Короткий', hint: 'Деберц до 301', options: { rules: 'deberts', target: 301 } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  redact,
  result(s) {
    if (!s.over || s.winner == null) return null;
    const winners = s.seats.filter((x) => teamOf(s, x) === s.winner);
    const scores: Record<number, number> = {};
    for (const x of s.seats) scores[x] = s.score[teamOf(s, x)];
    return { winners, text: `${s.score[s.winner]} очков${pairs(s) ? ' у пары' : ''}`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () =>
    pos(['JH 9H AS 10S KD QH 8C', 'AH KS QS 7D 10C JC 9D'], 'AC', {
      trump: 'H',
      taker: 0,
      phase: 'play',
      trick: [{ seat: 1, card: C('AD') }],
      turn: 0,
      pts: [44, 21],
      score: [212, 168],
      tricks: [2, 1],
      deal: 5,
    }),

  rules: {
    goal: 'Набрать во взятках и комбинациях больше соперника, если играешь, — и первым дойти до 501 очка.',
    sections: [
      {
        title: 'Карты и очки',
        html: `<p>32 карты. Козыри по старшинству: <b>валет</b> (20 очков), <b>девятка</b> (14), туз (11), десятка (10), король (4), дама (3), восьмёрка, семёрка.
          В простых мастях: туз 11, десятка 10, король 4, дама 3, валет 2, остальные — ноль. Последняя взятка — ещё 10, всего в сдаче 162.</p>`,
      },
      {
        title: 'Торги',
        html: `<p>Каждому по 6 карт, следующую открывают. По кругу, начиная с соседа сдатчика: «играю» (козырь — масть открытой карты) или «пас».
          Все спасовали — второй круг: назвать другую масть или пас; снова все — пересдача. Потом добирают прикуп: вдвоём и втроём — по 3 (на руках 9).
          Козырную семёрку можно обменять на открытый козырь.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['JH 9H AS 10S KD 7H', 'AH KS QS 7D 10C JC'], 'QH'),
          steps: [A(0, { type: 'bid', play: true }, 'У Изи валет и девятка червей — «Играю!». Козырь — черви, все добирают по три карты.')],
        },
      },
      {
        title: 'Ход',
        html: `<p>В масть обязательно; нет масти — козырем; если на столе уже козырь — перебить его, если можно. Взятку берёт старший козырь или старшая карта масти захода.</p>`,
      },
      {
        title: 'Комбинации',
        html: `<p><b>Терц</b> — три карты подряд одной масти, 20; <b>полтинник</b> — четыре подряд, 50. Засчитываются только у того, чья комбинация лучше
          (полтинник старше терца, равные — по старшей карте, козырная — старше). <b>Белла</b> — король и дама козыря, 20, объявляется при ходе первой из них —
          засчитывается всегда. Семь карт подряд одной масти — <b>деберц</b>: сразу победа в партии.</p>`,
      },
      {
        title: 'Счёт',
        html: `<p>Играющий набрал больше соперника — каждый записывает своё. Меньше — <b>байт</b>: его очки достаются сопернику. Поровну — очки играющего «висят»
          и достанутся тому, кто выиграет следующую сдачу. Партия — до 501 (вчетвером — до 1001).</p>
          <p><b>Клабор</b> (одесский): на втором круге сдатчик обязан назвать козырь («обязон»), сдача без взятки — «лыжи», −100, каждый третий байт — ещё −100.
          <b>Белот</b> (Франция): вчетвером по 8 карт, взявший козырь получает открытую; комбинации — ещё и пятёрки подряд (100) и карэ (валеты 200, девятки 150, остальные 100);
          не сыграл — соперникам 162 и все комбинации; все взятки — капот, 250. До 1000.</p>`,
      },
    ],
  },
};
