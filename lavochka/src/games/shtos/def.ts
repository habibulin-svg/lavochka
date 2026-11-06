/* Штос (фараон) — описание игры для сборника: банкомёт мечет направо-налево, понтёры ставят на карты, гнут углы; 2–6 игроков; без DOM. */
import type { GameDef, Options, SeatSpec } from '../../core/types';
import { SUIT_SYM, type Card, type Suit } from '../../cards/deck';
import { choose } from './ai';
import { apply, cfgFrom, LEVEL_NAME, makeView, newState, setup, toAct, type Action, type Event, type State, type View } from './engine';

export const SEATS = [
  { name: 'Чекалинский', color: '#8a2a1e', light: '#c45a44', dark: '#4e140c' },
  { name: 'Нарумов', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Сурин', color: '#2f7a3e', light: '#58ad66', dark: '#18452a' },
  { name: 'Томский', color: '#d9a521', light: '#f3cf62', dark: '#8a6410', ink: '#8a6410' },
  { name: 'Арбенин', color: '#6b3fa0', light: '#9a76c8', dark: '#3b1f5e' },
  { name: 'Лугин', color: '#1f8a8a', light: '#4fbcbc', dark: '#0f4a4a' },
];

const RANK: Record<number, string> = { 14: 'Т', 13: 'К', 12: 'Д', 11: 'В' };
export const rk = (r: number) => RANK[r] ?? String(r);
/** Достоинство в родительном: «на даму», «на семёрку». */
const ON: Record<number, string> = { 2: 'двойку', 3: 'тройку', 4: 'четвёрку', 5: 'пятёрку', 6: 'шестёрку', 7: 'семёрку', 8: 'восьмёрку', 9: 'девятку', 10: 'десятку', 11: 'валета', 12: 'даму', 13: 'короля', 14: 'туза' };
export const onRank = (r: number) => ON[r];
const cn = (c: Card) => `<b class="${c.s === 'H' || c.s === 'D' ? 'red' : ''}">${rk(c.r)}${SUIT_SYM[c.s]}</b>`;

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'talia':
      return `Талья ${ev.talia}. Банк мечет ${name(ev.banker)}.`;
    case 'skipBank':
      return `${name(ev.seat)}: на банк не хватает — банк дальше.`;
    case 'bank':
      return `${name(ev.seat)} кладёт банк: <b>${ev.n}</b>.`;
    case 'soda':
      return `Сода — ${cn(ev.card)}, мёртвая.`;
    case 'stake':
      return `${name(ev.seat)} ставит <b>${ev.n}</b> на ${onRank(ev.rank)}${ev.copper ? ' медью' : ''}.`;
    case 'decide':
      return ev.how === 'take'
        ? `${name(ev.seat)} снимает ${ev.amt + ev.win}.`
        : ev.how === 'paix'
          ? `${name(ev.seat)}: «Пе!» — ${ev.win} в карман, куш ${ev.amt} на ${onRank(ev.rank)}.`
          : `${name(ev.seat)} загибает угол — ${LEVEL_NAME[ev.level]}, на ${onRank(ev.rank)} ${ev.amt + ev.win}.`;
    case 'done':
      return ev.out ? `${name(ev.seat)}: пас до конца тальи.` : null;
    case 'pair': {
      const res = ev.res
        .map((r) => (r.outcome === 'win' ? `${name(r.seat)} +${r.amt}` : r.outcome === 'lose' ? `${name(r.seat)} −${r.amt}` : `${name(r.seat)}: плие, −${r.lost}`))
        .join(', ');
      return `Направо ${cn(ev.right)}, налево ${cn(ev.left)}${res ? ` — ${res}` : ''}.`;
    }
    case 'endTalia':
      return `${ev.broke ? 'Банк сорван! ' : 'Колода вышла. '}${ev.hock ? `Хок — ${cn(ev.hock)}. ` : ''}${name(ev.banker)}: банк ${ev.start} → ${ev.bank}.`;
    case 'end':
      return `🏁 Больше всех у ${name(ev.winner)} — ${ev.money[ev.winner]}.`;
  }
  return null;
}

// ---------------------------------------------------------------- показ правил

const demoSeats = (n: number): SeatSpec[] => Array.from({ length: n }, (_, seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);

/** Позиция для показа: банк уже лежит, колода сверху — заданные карты, дальше остальное. */
function pos(n: number, top: string, opts: Options = {}, extra: Partial<State> = {}): State {
  const s = newState(cfgFrom(opts), Array.from({ length: n }, (_, i) => i));
  const head = L(top);
  const rest = L('2S 3S 4S 5S 6S 7S 8S 9S 10S JS QS KS AS 2H 3H 4H 5H 6H 7H 8H 9H 10H JH QH KH AH 2C 3C 4C 5C 6C 7C 8C 9C 10C JC QC KC AC 2D 3D 4D 5D 6D 7D 8D 9D 10D JD QD KD AD')
    .filter((c) => (s.cfg.deck === 52 || c.r >= 6) && !head.some((h) => h.s === c.s && h.r === c.r));
  s.deck = [...head, ...rest];
  s.talia = 1;
  s.banker = 0;
  s.money[0] -= 300;
  s.bank = s.bankStart = 300;
  s.phase = 'stake';
  s.order = s.seats.slice(1);
  s.turn = 1;
  return Object.assign(s, extra);
}

const A = (seat: number, a: Action, caption?: string) => ({ seat, action: a, caption });

export const def: GameDef<State, Action, Event, View> = {
  id: 'shtos',
  title: 'Штос',
  players: { min: 2, max: 6, default: 4 },
  seats: SEATS,
  options: [
    {
      key: 'deck',
      label: 'Колода',
      type: 'select',
      choices: [
        { value: 52, label: '52 карты' },
        { value: 36, label: '36 карт — талья короче' },
      ],
      default: 52,
    },
    { key: 'split', label: 'Плие: банкомёт берёт половину куша (иначе — весь)', type: 'toggle', default: false },
    { key: 'sodaHock', label: 'Сода и хок: первая и последняя карты мёртвые', type: 'toggle', default: false },
    { key: 'corners', label: 'Гнуть углы: пароли, сетелева и дальше', type: 'toggle', default: true },
    { key: 'copper', label: 'Ставка медью (копер) — наоборот, на банкомётову сторону', type: 'toggle', default: false },
    {
      key: 'rounds',
      label: 'Банк у каждого',
      type: 'select',
      choices: [
        { value: 1, label: 'по одной талье' },
        { value: 2, label: 'по две тальи' },
      ],
      default: 1,
    },
  ],
  presets: [
    { id: 'shtos', label: 'Штос', hint: 'Русский штосс XIX века: 52 карты, плие — банкомёту, углы, пароли и сетелева', options: { deck: 52, split: false, sodaHock: false, corners: true, copper: false, rounds: 1 } },
    { id: 'faro', label: 'Фараон', hint: 'Американский фараон: сода и хок мёртвые, плие — пополам, можно ставить медью', options: { deck: 52, split: true, sodaHock: true, corners: true, copper: true, rounds: 1 } },
    { id: 'bank', label: 'Банчок', hint: 'Дворовый банк: 36 карт, без углов — играют мирандолем, тальи короткие, по две на каждого', options: { deck: 36, split: false, sodaHock: false, corners: false, copper: false, rounds: 2 } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  result(s) {
    if (!s.over || s.winner == null) return null;
    const best = s.money[s.winner];
    const winners = s.seats.filter((x) => s.money[x] === best);
    const scores: Record<number, number> = {};
    for (const x of s.seats) scores[x] = s.money[x];
    return { winners, text: `больше всех — ${best}`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    const s = pos(4, '');
    s.right = L('9C 4H KS 7D QH');
    s.left = L('3S JD 7C 10H AC');
    s.deck = s.deck.filter((c) => ![...s.right, ...s.left].some((x) => x.s === c.s && x.r === c.r));
    s.bets = [
      { seat: 1, rank: 12, amt: 100, win: 0, level: 1, copper: false },
      { seat: 2, rank: 14, amt: 50, win: 50, level: 0, copper: false },
      { seat: 3, rank: 8, amt: 80, win: 0, level: 0, copper: false },
      { seat: 3, rank: 5, amt: 30, win: 0, level: 0, copper: false },
    ];
    s.money = [700, 860, 1040, 910];
    s.bank = 290;
    s.phase = 'deal';
    s.order = [];
    s.turn = 0;
    return s;
  },

  rules: {
    goal: 'Обыграть банк — или, держа банк, обыграть понтёров — и к концу партии остаться с самыми большими фишками. Всё — на фишки, без денег.',
    sections: [
      {
        title: 'Банкомёт и понтёры',
        html: `<p>Один держит <b>банк</b> — он банкомёт и кладёт на стол сумму, против которой играют все остальные, понтёры. Банк переходит по кругу:
          каждый мечет одну талью (в банчке — две). Понтёр ставит <b>куш</b> на достоинство карты — даму, семёрку, туза; масть не важна.
          Ставить можно на одну-три карты, всего на столе — не больше банка: банк должен покрыть всё. Поставить весь остаток банка — <b>ва-банк</b>.</p>`,
      },
      {
        title: 'Направо — банку, налево — понтёру',
        html: `<p>Банкомёт мечет колоду парами: первую карту <b>направо</b> — она его, вторую <b>налево</b> — она понтёрова.
          Карта понтёра легла налево — он выиграл куш, банк платит один к одному. Легла направо — куш ушёл в банк. Пока карта не вышла, ставка ждёт.</p>`,
        demo: {
          seats: demoSeats(2),
          setup: () => pos(2, '9C QD 5S 7H'),
          steps: [
            A(1, { type: 'stake', rank: 12, n: 50 }, 'Нарумов ставит 50 на даму.'),
            A(1, { type: 'done' }, '«Мечите!»'),
            A(0, { type: 'deal' }, 'Направо девятка — мимо, налево дама. Дама понтёрова — Нарумов выиграл 50.'),
            A(1, { type: 'take', rank: 12 }, 'Снимает куш с выигрышем — 100.'),
          ],
        },
      },
      {
        title: 'Плие',
        html: `<p>Если в паре обе карты одного достоинства — это <b>плие</b> (дублет). В штосе куш на эту карту целиком забирает банкомёт,
          в фараоне — половину. На этом и стоит преимущество банка. Чем меньше карт достоинства осталось в колоде, тем реже плие:
          на последнюю, четвёртую карту плие не бывает вовсе.</p>`,
        demo: {
          seats: demoSeats(2),
          setup: () => pos(2, '7S 7D'),
          steps: [
            A(1, { type: 'stake', rank: 7, n: 50 }, 'Нарумов ставит 50 на семёрку.'),
            A(1, { type: 'done' }),
            A(0, { type: 'deal' }, 'Направо семёрка и налево семёрка — плие! Куш уходит в банк.'),
          ],
        },
      },
      {
        title: 'Углы: пароли, сетелева',
        html: `<p>Выиграл — решай: <b>снять</b> куш с выигрышем; сказать <b>«пе»</b> — выигрыш в карман, куш остаётся на карте;
          или <b>загнуть угол</b> карты — оставить на ней и куш, и выигрыш: ставка удваивается. Выиграет снова — это <b>пароли</b>, три куша чистыми.
          Дальше — второй угол, <b>сетелева</b> (семь кушей), кензелева (15), трантелева (31) и сонника (63). Проиграл с загнутыми углами — уходит всё, что стояло.</p>
          <p>Играть <b>мирандолем</b> — ставить одно и то же и углов не гнуть: так осторожные понтёры сидели всю ночь. В банчке углов нет вовсе.</p>`,
        demo: {
          seats: demoSeats(2),
          setup: () => pos(2, '4C 10S 2H 10D'),
          steps: [
            A(1, { type: 'stake', rank: 10, n: 50 }, 'Нарумов ставит 50 на десятку.'),
            A(1, { type: 'done' }),
            A(0, { type: 'deal' }, 'Налево десятка — выигрыш 50.'),
            A(1, { type: 'paroli', rank: 10 }, 'Загибает угол: на десятке теперь 100.'),
            A(1, { type: 'done' }),
            A(0, { type: 'deal' }, 'И снова десятка налево — пароли! Ещё 100.'),
            A(1, { type: 'take', rank: 10 }, 'Снимает 200: при куше 50 — 150 чистыми.'),
          ],
        },
      },
      {
        title: 'Фараон: сода, хок и медь',
        html: `<p>В американском фараоне первую карту колоды открывают и кладут в сторону — это <b>сода</b>, она мёртвая. Последняя карта —
          <b>хок</b> — тоже не играет: ставки на неё возвращаются. Фишка с медяком сверху — ставка <b>медью</b> (копер): она наоборот,
          выигрывает, когда карта ляжет направо. Сколько карт каждого достоинства осталось — видно на счётах под картами, как у «кейс-кипера».</p>`,
        demo: {
          seats: demoSeats(2),
          options: { sodaHock: true, copper: true, split: true },
          setup: () => pos(2, 'KH 6S 2D', { sodaHock: true, copper: true, split: true }, { phase: 'bank', turn: 0, bank: 0, bankStart: 0, money: [1000, 1000], order: [] }),
          steps: [
            A(0, { type: 'bank', n: 300 }, 'Чекалинский кладёт банк 300 — и открывает соду: король червей, мёртвый.'),
            A(1, { type: 'stake', rank: 6, n: 50, copper: true }, 'Нарумов ставит 50 на шестёрку медью.'),
            A(1, { type: 'done' }),
            A(0, { type: 'deal' }, 'Шестёрка легла направо — медью это выигрыш!'),
          ],
        },
      },
      {
        title: 'Конец тальи и партии',
        html: `<p>Колода вышла — талья кончилась: ставки, что ещё стоят, возвращаются, банкомёт забирает банк со всем, что в нём набралось.
          Банк опустел — <b>сорван</b>: талья кончается сразу. Затем банк переходит к соседу. У каждого на старте 1000; после тальи на каждого банкомёта
          партия окончена — выигрывает тот, у кого больше всех.</p>`,
      },
    ],
  },
};
