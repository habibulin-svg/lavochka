/* Бридж — описание игры для сборника: роббер, Чикаго, спортивный (дупликат против ботов), мини-бридж. Ровно 4 игрока,
 * пары Юг–Север («мы») и Запад–Восток («они»). Боты, правила с показом. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import type { Card, Suit } from '../../cards/deck';
import { choose, playOtherTable } from './ai';
import { apply, cfgFrom, makeView, newState, setOtherTable, setup, startBoard, toAct, type Action, type Call, type Contract, type Event, type State, type Strain, type View } from './engine';

setOtherTable(playOtherTable);

export const SEATS = [
  { name: 'Вовка', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Ленка', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Серёга', color: '#c0452f', light: '#e57a5f', dark: '#6e2414' },
  { name: 'Танька', color: '#2b7aa0', light: '#5fb0d8', dark: '#16405a' },
];
export const DIR = ['Юг', 'Запад', 'Север', 'Восток'];
export const STRAIN_SYM: Record<Strain, string> = { C: '♣', D: '♦', H: '♥', S: '♠', N: 'БК' };

export const callText = (c: Call) => (c.type === 'pass' ? 'пас' : c.type === 'double' ? 'контра' : c.type === 'redouble' ? 'реконтра' : `${c.level}${STRAIN_SYM[c.strain]}`);
export const contractText = (c: Contract | null) => (c ? `${c.level}${STRAIN_SYM[c.strain]}${c.dbl === 2 ? ' XX' : c.dbl === 1 ? ' X' : ''}` : 'пас');

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'deal':
      return `Сдача ${ev.board + 1}. Сдаёт ${name(ev.dealer)}. Зона: ${ev.vul[0] && ev.vul[1] ? 'обе' : ev.vul[0] ? 'мы' : ev.vul[1] ? 'они' : 'никто'}.`;
    case 'call':
      return `${name(ev.seat)}: <b>${callText(ev.call)}</b>${ev.note ? ` <small>— ${ev.note}</small>` : ''}`;
    case 'contract':
      return ev.contract ? `Контракт ${contractText(ev.contract)}, разыгрывает ${name(ev.contract.declarer)}.` : 'Все спасовали — пересдача.';
    case 'result': {
      const r = ev.result;
      if (!r.contract) return null;
      const need = r.contract.level + 6;
      const made = r.tricks >= need ? (r.tricks > need ? `+${r.tricks - need}` : 'ровно') : `без ${need - r.tricks}`;
      const sc = r.score >= 0 ? `«мы» +${r.score}` : `«они» +${-r.score}`;
      const imp = r.imp != null ? ` · за другим столом ${contractText(r.other!.contract)} (${r.other!.score >= 0 ? '+' : ''}${r.other!.score}) · IMP ${r.imp >= 0 ? '+' : ''}${r.imp}` : '';
      return `${contractText(r.contract)} — ${made}, взяток ${r.tricks}: ${sc}${imp}.`;
    }
    case 'rubber':
      return `🏆 Роббер за ${ev.winner === 0 ? '«нами»' : '«ними»'}: +${ev.bonus}.`;
    case 'honours':
      return `Гонор у ${ev.side === 0 ? '«нас»' : '«них»'}: +${ev.pts} над чертой.`;
    case 'end':
      return `🏁 Итог: «мы» ${ev.total[0]} — «они» ${ev.total[1]}.`;
  }
  return null;
}

function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all' || ev.type !== 'deal') return ev;
  return { ...ev, hands: ev.hands?.map((h, i) => (seats.includes(i) ? h : [])) };
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1, 2, 3].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14, T: 10 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);

function pos(hands: string[], format = 'chicago', extra: Partial<State> = {}): State {
  const s = newState(cfgFrom({ format }));
  s.hands = hands.map(L);
  s.deal = s.hands.map((h) => h.slice());
  s.board = 0;
  s.dealer = 0;
  startBoard(s, []);
  return Object.assign(s, extra);
}
const B = (seat: number, call: Call, caption?: string) => ({ seat, action: call as Action, caption });
const P = (seat: number, card: string, caption?: string) => ({ seat, action: { type: 'play', card: C(card) } as Action, caption });

// раздача для показов: у Юга 16 очков ровная, у Севера 5 пик и 7 очков
const DEMO = [
  'AS KS 3S AH 7H 4H KD 8D 5D 2D QC 9C 3C',
  'QS 8S 2S KH QH 9H 6H 7D 6D AC TC 7C 2C',
  'JS TS 9S 7S 5S JH TH 3H QD 3D KC 8C 6C',
  '6S 4S 8H 5H 2H AD JD TD 9D 4D JC 5C 4C',
];

export const def: GameDef<State, Action, Event, View> = {
  id: 'bridge',
  title: 'Бридж',
  players: { min: 4, max: 4, default: 4 },
  teams: (_o, seats) => [seats.filter((s) => s % 2 === 0), seats.filter((s) => s % 2 === 1)],
  seats: SEATS,
  options: [
    {
      key: 'format',
      label: 'Счёт',
      type: 'select',
      choices: [
        { value: 'rubber', label: 'роббер — до двух геймов' },
        { value: 'chicago', label: 'Чикаго — по 4 сдачи' },
        { value: 'duplicate', label: 'спортивный — IMP против другого стола' },
        { value: 'mini', label: 'мини-бридж — без торговли' },
      ],
      default: 'rubber',
    },
    {
      key: 'boards',
      label: 'Сдач',
      type: 'select',
      choices: [
        { value: 4, label: '4' },
        { value: 8, label: '8' },
        { value: 12, label: '12' },
        { value: 16, label: '16' },
      ],
      default: 4,
      showIf: (o) => o.format !== 'rubber',
    },
  ],
  presets: [
    { id: 'rubber', label: 'Роббер', hint: 'Классика: геймы, зона, запись «мы / они» над и под чертой', options: { format: 'rubber' } },
    { id: 'chicago', label: 'Чикаго', hint: '4 сдачи, зона по очереди', options: { format: 'chicago', boards: 4 } },
    { id: 'duplicate', label: 'Спортивный', hint: 'Та же сдача за другим столом — сравнение в IMP', options: { format: 'duplicate', boards: 8 } },
    { id: 'mini', label: 'Мини-бридж', hint: 'Для начинающих: без торговли, контракт по очкам', options: { format: 'mini', boards: 4 } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat), opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  redact,
  result(s) {
    if (s.phase !== 'over') return null;
    const w = s.total[0] > s.total[1] ? 0 : s.total[1] > s.total[0] ? 1 : -1;
    const scores: Record<number, number> = { 0: s.total[0], 1: s.total[1], 2: s.total[0], 3: s.total[1] };
    return { winners: w < 0 ? [] : [w, w + 2], text: `«мы» ${s.total[0]} — «они» ${s.total[1]}${s.cfg.format === 'duplicate' ? ' IMP' : ''}`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    const s = pos(DEMO, 'rubber', {});
    s.calls = [
      { seat: 0, call: { type: 'bid', level: 1, strain: 'N' } },
      { seat: 1, call: { type: 'pass' } },
      { seat: 2, call: { type: 'bid', level: 2, strain: 'H' } },
      { seat: 3, call: { type: 'pass' } },
      { seat: 0, call: { type: 'bid', level: 2, strain: 'S' } },
      { seat: 1, call: { type: 'pass' } },
      { seat: 2, call: { type: 'bid', level: 4, strain: 'S' } },
      { seat: 3, call: { type: 'pass' } },
      { seat: 0, call: { type: 'pass' } },
      { seat: 1, call: { type: 'pass' } },
    ];
    s.contract = { level: 4, strain: 'S', dbl: 0, declarer: 0 };
    s.dummy = 2;
    s.dummyUp = true;
    s.phase = 'play';
    s.trick = [
      { seat: 1, card: C('KH') },
      { seat: 2, card: C('3H') },
    ];
    s.hands[1] = s.hands[1].filter((c) => !(c.s === 'H' && c.r === 13));
    s.hands[2] = s.hands[2].filter((c) => !(c.s === 'H' && c.r === 3));
    s.turn = 3;
    s.games = [1, 0];
    s.below = [40, 60];
    s.above = [150, 50];
    return makeView(s, [0]);
  },

  rules: {
    goal: 'Вдвоём с партнёром (он напротив) заказать контракт — сколько взяток сверх шести возьмёте и с каким козырем — и выполнить его. Или не дать противникам выполнить их контракт.',
    sections: [
      {
        title: 'Торговля',
        html: `<p>Сдают всю колоду по 13. По кругу, начиная со сдающего, называют <b>заявки</b>: число (сколько взяток сверх шести) и козырь —
          ♣ &lt; ♦ &lt; ♥ &lt; ♠ &lt; БК (без козыря). Каждая следующая заявка старше. Можно сказать «пас», «контра» на заявку противников
          (удвоить их счёт) или «реконтра» на контру. Три паса подряд — последняя заявка стала <b>контрактом</b>.</p>
          <p>Очки силы: туз — 4, король — 3, дама — 2, валет — 1. Открывают обычно с 12+; 1БК — 15–17 при ровной руке.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(DEMO),
          intro: 'У Вовки (Юг) 16 очков и ровная рука.',
          steps: [
            B(0, { type: 'bid', level: 1, strain: 'N' }, '«1БК» — 15–17, ровная.'),
            B(1, { type: 'pass' }, 'Ленка — пас.'),
            B(2, { type: 'bid', level: 2, strain: 'H' }, 'Серёга: «2♥» — трансфер, у него 5+ пик.'),
            B(3, { type: 'pass' }),
            B(0, { type: 'bid', level: 2, strain: 'S' }, 'Вовка принимает: «2♠».'),
            B(1, { type: 'pass' }),
            B(2, { type: 'bid', level: 4, strain: 'S' }, 'Серёга прикидывает: пик у пары восемь, очков около 23 — рискует на гейм: «4♠».'),
            B(3, { type: 'pass' }),
            B(0, { type: 'pass' }),
            B(1, { type: 'pass' }, 'Три паса: контракт 4♠, разыгрывает Вовка — он первым назвал пики.'),
          ],
        },
      },
      {
        title: 'Болван и розыгрыш',
        html: `<p>Первым ходит сосед слева от разыгрывающего. После этого партнёр разыгрывающего — <b>болван</b> — открывает карты на стол,
          и ими ходит разыгрывающий. В масть ходить обязательно, нет масти — любую (козырь бьёт). Взятку берёт старший козырь
          или старшая карта масти захода.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(DEMO, 'chicago', { phase: 'play', contract: { level: 4, strain: 'S', dbl: 0, declarer: 0 }, dummy: 2, turn: 1 }),
          intro: 'Контракт 4♠, разыгрывает Вовка.',
          steps: [
            P(1, 'KH', 'Ленка выходит королём червей — Серёга открывает карты, он болван.'),
            P(0, '3H', 'Вовка ходит за болвана: тройка червей.'),
            P(3, '2H', 'Танька — двойка.'),
            P(0, 'AH', 'Туз Вовки забирает взятку.'),
          ],
        },
      },
      {
        title: 'Счёт',
        html: `<p>За каждую взятку сверх шести: ♣♦ — 20, ♥♠ — 30, БК — 40 за первую и 30 за остальные. Контра удваивает, реконтра — вчетверо.
          100 очков за контракт — <b>гейм</b> (3БК, 4♥/4♠, 5♣/5♦). Шлем: малый (6) — 500, большой (7) — 1000; в зоне больше.</p>
          <p>Не добрал — противникам по 50 за каждую недостающую взятку (в зоне 100, с контрой — больше).</p>
          <p><b>Роббер:</b> очки за контракт пишут под чертой, остальное над; два гейма — роббер (+700, или +500 при 2:1). Взявший гейм — в зоне.
          <b>Чикаго:</b> четыре сдачи с зоной по очереди, гейм +300 (в зоне +500), частичка +50.
          <b>Спортивный:</b> ту же сдачу за другим столом играют боты; разница очков переводится в IMP.
          <b>Мини-бридж:</b> без торговли — пара с большими очками играет, разыгрывающий видит болвана и сам выбирает козырь и «гейм или частичку».</p>`,
      },
    ],
  },
};
