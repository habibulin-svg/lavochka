/* Покер (2D) — описание игры: одна карточка, вид — пресетами (Омаха, стад, разз, дро, лоуболл, бадуги, HORSE). 2–6 игроков.
 * Холдем — отдельная карточка на 3D-столе; здесь только в ротации HORSE (решение пользователя: остальные виды — только 2D). */
import type { GameDef, SeatSpec } from '../../core/types';
import { SUIT_SYM, type Card, type Suit } from '../../cards/deck';
import { choose } from './ai';
import { apply, cfgFrom, GAMES, makeView, newState, setup, toAct, type Action, type Event, type Game, type State, type View } from './engine';

export const SEATS = [
  { name: 'Вовка', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Ленка', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Серёга', color: '#2f7a3e', light: '#58ad66', dark: '#18452a' },
  { name: 'Танька', color: '#d9a521', light: '#f3cf62', dark: '#8a6410', ink: '#8a6410' },
  { name: 'Димон', color: '#7a3e9e', light: '#a872c8', dark: '#43205a' },
  { name: 'Светка', color: '#1f8a8a', light: '#58bdbd', dark: '#0f4a4a' },
];

const cn = (c: Card) => `${c.r === 14 ? 'Т' : c.r === 13 ? 'К' : c.r === 12 ? 'Д' : c.r === 11 ? 'В' : c.r}${SUIT_SYM[c.s]}`;
export const gameTitle = (g: Game, hilo: boolean) => `${GAMES[g].name}${hilo ? ' хай-лоу' : ''}`;

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'deal':
      return `Раздача ${ev.hand}: ${gameTitle(ev.game, ev.hilo)}.`;
    case 'post':
      return ev.what === 'принос' ? `${name(ev.seat)} — принос ${ev.amount}` : null;
    case 'act': {
      const a = ev.action;
      const t = a.type === 'fold' ? 'пас' : a.type === 'check' ? 'чек' : a.type === 'call' ? `колл ${ev.amount}` : a.type === 'raise' ? `рейз до ${a.to}` : a.type === 'allin' ? `ва-банк ${ev.amount}` : '';
      return t ? `${name(ev.seat)}: ${t}` : null;
    }
    case 'draw':
      return ev.count ? `${name(ev.seat)} меняет ${ev.count}` : `${name(ev.seat)} стоит — не меняет`;
    case 'show':
      return `${name(ev.seat)} открывает: ${ev.cards.map(cn).join(' ')}`;
    case 'win':
      return `💰 ${name(ev.seat)} забирает ${ev.amount}${ev.hand ? ` (${ev.hand})` : ''}`;
    case 'bust':
      return `${name(ev.seat)} выбывает.`;
    case 'end':
      return `🏁 Больше всех фишек — у ${name(ev.winner)}.`;
  }
  return null;
}

function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all') return ev;
  if (ev.type === 'deal') return { ...ev, hole: ev.hole?.map((h, p) => (seats.includes(p) ? h : h.map((c, i) => (ev.up?.[p][i] ? c : (null as unknown as Card))))) };
  if (ev.type === 'draw' && !seats.includes(ev.seat)) return { ...ev, cards: undefined };
  if (ev.type === 'street' && ev.cards) return { ...ev, cards: ev.cards.map((x) => (x.up || seats.includes(x.seat) ? x : { ...x, card: null })) };
  return ev;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1, 2].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14, T: 10 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);

function pos(mode: string, hands: string[], extra: Partial<State> = {}, ups?: boolean[][]): State {
  const s = newState(cfgFrom({ mode }), [0, 1, 2]);
  s.hole = [...hands.map(L), [], [], []];
  s.up = s.hole.map((h, p) => h.map((_, i) => ups?.[p]?.[i] ?? false));
  s.inHand = [0, 1, 2];
  s.hand = 1;
  s.button = 2;
  s.turn = 0;
  const used = new Set(s.hole.flat().map((c) => c.s + c.r));
  s.deck = ['S', 'H', 'D', 'C'].flatMap((su) => Array.from({ length: 13 }, (_, i) => ({ s: su as Suit, r: i + 2 }))).filter((c) => !used.has(c.s + c.r));
  return Object.assign(s, extra);
}
const A = (seat: number, a: Action, caption?: string, rig?: number[]) => ({ seat, action: a, caption, rig });

const MODES: [string, string][] = [
  ['omaha4', 'Омаха — 4 карты'],
  ['omaha5', 'Омаха — 5 карт'],
  ['stud7', 'Стад — 7 карт'],
  ['stud5', 'Стад — 5 карт'],
  ['razz', 'Разз — стад на младшую'],
  ['draw5', 'Дро — один обмен'],
  ['td27', '2–7 тройной обмен'],
  ['tda5', 'A–5 тройной обмен'],
  ['badugi', 'Бадуги'],
  ['badeucy', 'Бадьюси (2–7 + бадуги)'],
  ['badacey', 'Бадэйси (A–5 + бадуги)'],
  ['horse', 'HORSE — по кругу'],
];

export const def: GameDef<State, Action, Event, View> = {
  id: 'poker',
  title: 'Покер',
  players: { min: 2, max: 6, default: 4 },
  seats: SEATS,
  options: [
    { key: 'mode', label: 'Вид', type: 'select', choices: MODES.map(([value, label]) => ({ value, label })), default: 'omaha4' },
    { key: 'hilo', label: 'Хай-лоу «8 или лучше»', type: 'toggle', default: false, hint: 'Банк пополам: старшей руке и лучшей младшей из пяти разных до восьмёрки.', showIf: (o) => ['omaha4', 'omaha5', 'stud7', 'stud5'].includes(String(o.mode ?? 'omaha4')) },
    {
      key: 'struct',
      label: 'Ставки',
      type: 'select',
      choices: [
        { value: 'auto', label: 'как принято' },
        { value: 'limit', label: 'лимит' },
        { value: 'pot', label: 'пот-лимит' },
        { value: 'nl', label: 'безлимит' },
      ],
      default: 'auto',
      showIf: (o) => o.mode !== 'horse',
    },
    {
      key: 'stack',
      label: 'Фишек у каждого',
      type: 'select',
      choices: [
        { value: 500, label: '500' },
        { value: 1000, label: '1000' },
        { value: 2000, label: '2000' },
      ],
      default: 1000,
    },
    {
      key: 'hands',
      label: 'Раздач',
      type: 'select',
      choices: [
        { value: 20, label: '20' },
        { value: 30, label: '30' },
        { value: 40, label: '40' },
        { value: 0, label: 'до последнего' },
      ],
      default: 30,
    },
  ],
  presets: [
    { id: 'plo', label: 'Омаха', hint: '4 карты, пот-лимит', options: { mode: 'omaha4', hilo: false, struct: 'auto' } },
    { id: 'plo5', label: 'Омаха-5', hint: '5 карт, пот-лимит', options: { mode: 'omaha5', hilo: false, struct: 'auto' } },
    { id: 'o8', label: 'Омаха хай-лоу', hint: '«8 или лучше», лимит', options: { mode: 'omaha4', hilo: true, struct: 'limit' } },
    { id: 'stud', label: 'Стад-7', hint: 'Семикарточный, лимит', options: { mode: 'stud7', hilo: false } },
    { id: 'stud8', label: 'Стад хай-лоу', hint: 'Семикарточный «8 или лучше»', options: { mode: 'stud7', hilo: true } },
    { id: 'stud5', label: 'Стад-5', hint: 'Пятикарточный', options: { mode: 'stud5', hilo: false } },
    { id: 'razz', label: 'Разз', hint: 'Стад на младшую A–5', options: { mode: 'razz' } },
    { id: 'draw', label: 'Дро', hint: '5 карт, один обмен, безлимит', options: { mode: 'draw5', struct: 'auto' } },
    { id: 'td27', label: '2–7', hint: 'Тройной обмен, лучшая 7-5-4-3-2', options: { mode: 'td27' } },
    { id: 'tda5', label: 'A–5', hint: 'Тройной обмен, лучшая 5-4-3-2-A', options: { mode: 'tda5' } },
    { id: 'badugi', label: 'Бадуги', hint: '4 карты разных мастей и достоинств', options: { mode: 'badugi' } },
    { id: 'badeucy', label: 'Бадьюси', hint: 'Пополам: 2–7 и бадуги', options: { mode: 'badeucy' } },
    { id: 'badacey', label: 'Бадэйси', hint: 'Пополам: A–5 и бадуги', options: { mode: 'badacey' } },
    { id: 'horse', label: 'HORSE', hint: 'Холдем, Омаха х/л, разз, стад, стад х/л — по кругу', options: { mode: 'horse' } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  redact,
  result(s) {
    if (!s.over) return null;
    const top = Math.max(...s.seats.map((p) => s.chips[p]));
    const scores: Record<number, number> = {};
    for (const p of s.seats) scores[p] = s.chips[p];
    return { winners: s.seats.filter((p) => s.chips[p] === top), text: `${top} фишек`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    const s = pos('omaha4', ['AS KS QH JH', '9C 9D 4S 2H', 'TD 8D 7C 6C'], { board: L('KH 7H 9S'), street: 1, bet: [40, 40, 0, 0, 0, 0], total: [60, 60, 20, 0, 0, 0], current: 40 }, undefined);
    s.seats = [0, 1, 2, 3];
    s.hole[3] = L('5S 5H 3D 2C');
    s.up[3] = [false, false, false, false];
    s.inHand = [0, 1, 2, 3];
    s.folded = [false, false, true, false, false, false];
    s.chips = [880, 1240, 980, 900, 0, 0];
    s.turn = 3;
    return makeView(s, [0]);
  },

  rules: {
    goal: 'Выиграть фишки соперников: лучшей рукой на вскрытии или ставкой, на которую никто не ответит.',
    sections: [
      {
        title: 'Торговля',
        html: `<p>На каждом круге: <b>пас</b> (сбросить карты), <b>чек</b> (если ставки нет), <b>колл</b> (уравнять), <b>рейз</b> (повысить).
          Ставки бывают <b>лимитные</b> (рейз ровно на ставку, не больше четырёх за круг; на поздних улицах ставка вдвое больше),
          <b>пот-лимит</b> (рейз не больше банка) и <b>безлимит</b> (хоть все фишки).</p>`,
      },
      {
        title: 'Омаха',
        html: `<p>У каждого четыре (в Омахе-5 — пять) своих карт, на стол выходят пять общих: флоп (3), тёрн, ривер.
          Комбинация — <b>ровно две свои и три общие</b>, не больше и не меньше. Обычно пот-лимит.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos('omaha4', ['AS KS QH JH', '9C 9D 4S 2H', 'TD 8D 7C 6C'], { board: L('KH 7H 9S'), street: 1, total: [20, 20, 20, 0, 0, 0] }),
          intro: 'Флоп: К♥ 7♥ 9♠. У Вовки Т♠ К♠ Д♥ В♥.',
          steps: [A(0, { type: 'check' }, 'Вовка: чек — у него пара королей и четыре червы (две свои + две на столе).'), A(1, { type: 'raise', to: 40 }, 'Ленка с сетом девяток ставит.'), A(2, { type: 'call' }, 'Серёга коллирует: у него стритовое дро — 10 и 8 свои, 7 и 9 на столе, ждёт валета или шестёрку.')],
        },
      },
      {
        title: 'Стад',
        html: `<p>Общих карт нет. В семикарточном — две карты в закрытую и одна в открытую, потом ещё три открытых и последняя закрытая;
          из семи — лучшие пять. В пятикарточном — одна закрытая и четыре открытых. Все ставят <b>анте</b>; самая младшая открытая карта
          обязана сделать <b>принос</b>, дальше первым говорит лучшая открытая рука.</p>
          <p><b>Разз</b> — стад на младшую: лучшая 5-4-3-2-A, пары плохо, стриты и флеши не считаются.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => {
            const s = pos('stud7', ['KS 2H 9D', 'AC QD 3S', '7H 7S JC'], {}, [[false, false, true], [false, false, true], [false, false, true]]);
            s.total = [5, 10, 5, 0, 0, 0];
            s.bet = [0, 0, 0, 0, 0, 0];
            s.current = 5;
            s.bet[1] = 5;
            s.turn = 2;
            return s;
          },
          intro: 'Открыты: 9♦, 3♠, В♣. Младшая — тройка Ленки, она сделала принос.',
          steps: [A(2, { type: 'raise', to: 20 }, 'Серёга с закрытой парой семёрок доводит до малой ставки.'), A(0, { type: 'fold' }, 'Вовке нечем — пас.'), A(1, { type: 'call' }, 'Ленка уравнивает.')],
        },
      },
      {
        title: 'Дро и обмен',
        html: `<p>Все карты закрыты. После торговли — <b>обмен</b>: сбросить сколько угодно карт и добрать столько же; потом снова торговля.
          В <b>дро</b> обмен один и считается старшая комбинация. В <b>тройном обмене</b> обменов три, а выигрывает младшая:
          в <b>2–7</b> туз старший, стриты и флеши против тебя (лучшая 7-5-4-3-2); в <b>A–5</b> туз младший, стриты и флеши не считаются.</p>
          <p><b>Бадуги</b>: четыре карты, лучшая — четыре разных масти и четыре разных достоинства, младше — лучше (A-2-3-4 разных мастей).
          <b>Бадьюси</b> и <b>бадэйси</b>: пять карт, банк пополам — лучшему бадуги из четырёх и лучшей младшей 2–7 или A–5.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos('td27', ['7S 5H 3D KC 2C', 'AS AD 9H 8S 4C', 'QS JD 6H 6C 3S'], { phase: 'draw', street: 1, drew: [false, false, false, false, false, false] }),
          intro: '2–7, первый обмен. У Вовки 7-5-3-2 и король.',
          steps: [A(0, { type: 'draw', cards: [C('KC')] }, 'Вовка меняет одну — короля.'), A(1, { type: 'draw', cards: L('AS AD 9H') }, 'Ленке хуже: тузы в 2–7 старшие — меняет три.'), A(2, { type: 'draw', cards: L('QS JD 6C') }, 'Серёга меняет три.')],
        },
      },
      {
        title: 'Хай-лоу и HORSE',
        html: `<p><b>Хай-лоу «8 или лучше»</b> (Омаха, стад): банк делится пополам — лучшей старшей руке и лучшей младшей из пяти разных
          не старше восьмёрки (туз младший). Младшей ни у кого нет — весь банк старшей. В Омахе и младшая — ровно две свои и три общие.</p>
          <p><b>HORSE</b> — пять видов по кругу, каждый на круг раздач: Холдем, Омаха хай-лоу, Разз, Стад, стад хай-лоу («Eight or better»). Всё — лимит.</p>`,
      },
    ],
  },
};

