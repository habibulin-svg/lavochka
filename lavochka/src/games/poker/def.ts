/* Покер — описание игры: одна карточка, все виды — пресетами (холдем, Short Deck, пайнэппл, Омаха, Куршевель, стад, разз, дро,
 * лоуболл, бадуги, HORSE, 8-Game). 2–9 игроков (сколько позволяет колода вида). Холдем и Short Deck играются на столе холдема
 * с 3D-комнатой, остальные — на 2D-столе (выбор стола — poker/switch.ts). Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { SeededRng } from '../../core/rng';
import { SUIT_SYM, type Card, type Suit } from '../../cards/deck';
import { choose } from './ai';
import { apply, cfgFrom, deal, toCall, GAMES, isMix, makeView, maxPlayers, MIXES, newState, recFor, setup, toAct, type Action, type Event, type Game, type Mode, type State, type Struct, type View } from './engine';
import { chooseOfc } from './ofc/ai';
import { applyOfc, isOfc, makeOView, ofcMax, redactOfc, resultOfc, setupOfc, toActOfc, type OAction, type OEvent, type OfcMode, type OState, type OView } from './ofc/engine';
import { describeOfc, OFC_PRESETS, OFC_RULES } from './ofc/rules';
import { afterApply, isTour, isTourAction, tourApply, tourResult, tourSetup, type TourAction } from './tour';

/** Всё, что ходит через def: обычный покер или китайский (OFC — свой движок без ставок, вид 'ofc'/'ofcp'). */
export type AnyState = State | OState;
export type AnyView = View | OView;
export type AnyAction = Action | OAction | TourAction;
export type AnyEvent = Event | OEvent;
export const isO = (s: object): s is OState => 'ofc' in s;
const isOEv = (e: AnyEvent): e is OEvent => e.type[0] === 'o';

export const SEATS = [
  { name: 'Вовка', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Ленка', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Серёга', color: '#2f7a3e', light: '#58ad66', dark: '#18452a' },
  { name: 'Танька', color: '#d9a521', light: '#f3cf62', dark: '#8a6410', ink: '#8a6410' },
  { name: 'Димон', color: '#6a3d8f', light: '#9a70c0', dark: '#3a1f52' },
  { name: 'Колян', color: '#5a5a5a', light: '#9a9a9a', dark: '#2a2a2a' },
  { name: 'Светка', color: '#c2185b', light: '#e0609a', dark: '#6e0e34' },
  { name: 'Жека', color: '#0f7a7a', light: '#4ab0b0', dark: '#074242' },
  { name: 'Михалыч', color: '#8a5a2a', light: '#c08a50', dark: '#4a2e12' },
];

const cn = (c: Card) => `<b>${c.r === 14 ? 'Т' : c.r === 13 ? 'К' : c.r === 12 ? 'Д' : c.r === 11 ? 'В' : c.r}${SUIT_SYM[c.s]}</b>`;
const STRUCT: Record<Struct, string> = { limit: 'лимит', pot: 'пот-лимит', nl: 'безлимит' };
export const gameTitle = (g: Game, hilo: boolean) => `${GAMES[g].name}${hilo ? ' хай-лоу' : ''}`;
const FLOP_STREET = ['', 'Флоп', 'Тёрн', 'Ривер'];

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'blinds':
      return `Блайнды растут: теперь ${ev.small}/${ev.big}.`;
    case 'deal':
      return `Раздача ${ev.hand}: ${gameTitle(ev.game, ev.hilo)}, ${STRUCT[ev.struct]}. Баттон — ${name(ev.button)}${GAMES[ev.game].family === 'stud' ? '' : `, блайнды ${ev.small}/${ev.big}`}.${ev.board?.length ? ` Открыта ${ev.board.map(cn).join(' ')}.` : ''}`;
    case 'post':
      return ev.what === 'принос' ? `${name(ev.seat)} — принос ${ev.amount}` : null;
    case 'act': {
      const a = ev.action;
      const t = a.type === 'fold' ? 'пас' : a.type === 'check' ? 'чек' : a.type === 'call' ? `колл ${ev.amount}` : a.type === 'raise' ? (ev.open ? `ставка ${a.to}` : `рейз до ${a.to}`) : a.type === 'allin' ? `ва-банк до ${ev.to}` : '';
      return t ? `${name(ev.seat)}: ${t}${ev.allin && a.type !== 'allin' ? ' (ва-банк)' : ''}` : null;
    }
    case 'street':
      return ev.board ? `${FLOP_STREET[ev.street] ?? 'Карты'}: ${ev.board.map(cn).join(' ')}` : null;
    case 'draw':
      return ev.count ? `${name(ev.seat)} меняет ${ev.count}` : `${name(ev.seat)} стоит — не меняет`;
    case 'discard':
      return `${name(ev.seat)} сбрасывает лишнюю карту`;
    case 'show':
      return `${name(ev.seat)} открывает ${ev.cards.map(cn).join(' ')}${ev.hand ? ` — ${ev.hand}` : ''}`;
    case 'win':
      return `💰 ${name(ev.seat)} забирает <b>${ev.amount}</b>${ev.hand ? ` (${ev.hand})` : ''}.`;
    case 'bust':
      return `${name(ev.seat)} вылетает.`;
    case 'end':
      return `🏁 Больше всех фишек — у <b>${name(ev.winner)}</b>.`;
    case 'tour':
      return ev.kind === 'big' || ev.kind === 'end' ? `<b>${ev.text}</b>` : ev.text;
  }
  return null;
}

/** Чужие закрытые карты не показываем (и в истории раздачи тоже). */
function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all') return ev;
  if (ev.type === 'deal') return { ...ev, hole: ev.hole?.map((h, p) => (seats.includes(p) ? h : h.map((c, i) => (ev.up?.[p][i] ? c : (null as unknown as Card))))) };
  if (ev.type === 'draw' && !seats.includes(ev.seat)) return { ...ev, cards: undefined };
  if (ev.type === 'discard' && !seats.includes(ev.seat)) return { ...ev, card: undefined };
  if (ev.type === 'street' && ev.cards) return { ...ev, cards: ev.cards.map((x) => (x.up || seats.includes(x.seat) ? x : { ...x, card: null })) };
  if (ev.type === 'hand') return { ...ev, rec: recFor(ev.rec, seats) };
  return ev;
}

// ---------------------------------------------------------------- показ правил

const bots = (n: number): SeatSpec[] => Array.from({ length: n }, (_, seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const demoSeats = bots(3);
const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14, T: 10 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);

/** Позиция для показа: вид, руки по местам, остальное — поверх. Колода — всё, что не на руках и не на столе. */
function pos(mode: Mode, hands: string[], extra: Partial<State> = {}, ups?: boolean[][], opts: Record<string, string | number | boolean> = {}): State {
  const seats = hands.map((_, i) => i);
  const s = newState(cfgFrom({ mode, ...opts }), seats);
  s.hole = s.hole.map((_, p) => (hands[p] ? L(hands[p]) : []));
  s.up = s.hole.map((h, p) => h.map((_, i) => ups?.[p]?.[i] ?? false));
  s.inHand = seats.slice();
  s.hand = 1;
  s.button = seats[seats.length - 1];
  s.turn = 0;
  Object.assign(s, extra);
  const used = new Set([...s.hole.flat(), ...s.board].map((c) => c.s + c.r));
  s.deck = ['S', 'H', 'D', 'C'].flatMap((su) => Array.from({ length: 13 }, (_, i) => ({ s: su as Suit, r: i + 2 }))).filter((c) => !used.has(c.s + c.r) && (!GAMES[s.game].short || c.r >= 6));
  return s;
}

/** Настоящая раздача холдема на n мест с заданными картами и колодой (баттон — последнее место). */
function dealt(holes: string[], deck: string, opts: Record<string, string | number | boolean> = {}): State {
  const seats = holes.map((_, i) => i);
  const s0 = newState(cfgFrom({ mode: 'holdem', ...opts }), seats);
  s0.button = seats[seats.length - 2];
  const s = deal(s0, new SeededRng(3)).state;
  holes.forEach((h, i) => (s.hole[i] = L(h)));
  if (s.rec) s.rec.hole = Object.fromEntries(holes.map((h, i) => [i, L(h)]));
  s.deck = L(deck);
  return s;
}
const A = (seat: number, a: Action, caption?: string, rig?: number[]) => ({ seat, action: a, caption, rig });
// колода после раздачи: сброс, флоп, сброс, тёрн, сброс, ривер
const DECK = '3C KS 9H 4H 5C 2H 6C 10C 8D 8S';

const MODES: [Mode | OfcMode, string][] = [
  ['holdem', 'Техасский холдем'],
  ['shortdeck', 'Short Deck (6+)'],
  ['pineapple', 'Пайнэппл'],
  ['crazy', 'Крейзи-пайнэппл'],
  ['omaha4', 'Омаха — 4 карты'],
  ['omaha5', 'Омаха — 5 карт'],
  ['courchevel', 'Куршевель'],
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
  ['eight', '8-Game — восемь видов по кругу'],
  ['ofcp', 'Китайский покер «Ананас» (OFC)'],
  ['ofc', 'Китайский покер — классический'],
];

const modeOf = (o: Record<string, unknown>) => cfgFrom(o as Record<string, string>).mode;
/** Обычный покер (со ставками) — для настроек, которые китайскому не нужны. */
const bet = (o: Record<string, unknown>) => !isOfc(o.mode);
const maxOf = (o: Record<string, unknown>) => (isOfc(o.mode) ? ofcMax(o.mode) : maxPlayers(modeOf(o)));

export const def: GameDef<AnyState, AnyAction, AnyEvent, AnyView> = {
  id: 'poker',
  title: 'Покер',
  players: { min: 2, max: 9, default: 6 },
  countsFor: (o) => Array.from({ length: maxOf(o) - 1 }, (_, i) => i + 2),
  countsHint: (o) => (maxOf(o) < 9 ? `в этом виде — до ${maxOf(o)}: больше не хватит колоды` : undefined),
  seats: SEATS,
  options: [
    { key: 'mode', label: 'Вид', type: 'select', choices: MODES.map(([value, label]) => ({ value, label })), default: 'holdem' },
    { key: 'hilo', label: 'Хай-лоу «8 или лучше»', type: 'toggle', default: false, hint: 'Банк пополам: старшей руке и лучшей младшей из пяти разных до восьмёрки.', showIf: (o) => { const m = modeOf(o); return bet(o) && !isMix(m) && !!GAMES[m].hilo; } },
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
      showIf: (o) => bet(o) && !isMix(modeOf(o)),
    },
    {
      key: 'stack',
      label: 'Фишек у каждого',
      type: 'select',
      choices: [500, 1000, 1500, 2000].map((v) => ({ value: v, label: String(v) })),
      default: 1000,
      showIf: bet,
    },
    {
      key: 'blind',
      label: 'Большой блайнд',
      type: 'select',
      choices: [10, 20, 50].map((v) => ({ value: v, label: String(v) })),
      default: 20,
      hint: 'Малый — половина. От него же лимитные ставки, анте и принос в стаде.',
      showIf: bet,
    },
    {
      key: 'every',
      label: 'Блайнды удваиваются',
      type: 'select',
      choices: [
        { value: 5, label: 'каждые 5 раздач' },
        { value: 10, label: 'каждые 10 раздач' },
        { value: 20, label: 'каждые 20 раздач' },
        { value: 0, label: 'никогда' },
      ],
      default: 10,
      showIf: bet,
    },
    {
      key: 'ante',
      label: 'Анте',
      type: 'select',
      choices: [
        { value: 'none', label: 'нет' },
        { value: 'all', label: 'с каждого' },
        { value: 'button', label: 'баттон-анте (баттон за всех)' },
        { value: 'bb', label: 'анте большого блайнда' },
      ],
      default: 'none',
      hint: 'Анте с каждого — десятая часть большого блайнда; баттон-анте — баттон платит его за весь стол; анте большого блайнда — большой блайнд кладёт ещё один блайнд.',
      showIf: (o) => { const m = modeOf(o); return bet(o) && !isMix(m) && GAMES[m].family !== 'stud'; },
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
      default: 0,
      showIf: bet,
    },
    {
      key: 'fant',
      label: 'Фантазия',
      type: 'select',
      choices: [
        { value: 'on', label: 'обычная' },
        { value: 'prog', label: 'прогрессивная (только «Ананас»)' },
        { value: 'off', label: 'без фантазии' },
      ],
      default: 'on',
      hint: 'Пара дам и старше вверху без фола — следующая раздача все карты сразу. Прогрессивная: QQ — 14 карт, KK — 15, AA — 16, сет — 17.',
      showIf: (o) => !bet(o),
    },
    {
      key: 'deals',
      label: 'Раздач',
      type: 'select',
      choices: [4, 6, 8, 12].map((v) => ({ value: v, label: String(v) })),
      default: 6,
      showIf: (o) => !bet(o),
    },
  ],
  presets: [
    { id: 'holdem', label: 'Холдем', hint: 'Безлимит, 1000 фишек, блайнды растут каждые 10 раздач — до последнего', options: { mode: 'holdem', struct: 'auto', stack: 1000, every: 10, hands: 0, ante: 'none' } },
    { id: 'turbo', label: 'Холдем турбо', hint: '500 фишек, блайнды растут каждые 5 раздач', options: { mode: 'holdem', struct: 'auto', stack: 500, every: 5, hands: 0, ante: 'none' } },
    { id: 'deep', label: 'Холдем, глубокие стеки', hint: '2000 фишек, рост каждые 20 раздач', options: { mode: 'holdem', struct: 'auto', stack: 2000, every: 20, hands: 0, ante: 'none' } },
    { id: 'lhe', label: 'Лимитный холдем', hint: 'Рейз ровно на ставку, не больше четырёх за круг', options: { mode: 'holdem', struct: 'limit' } },
    { id: 'shortdeck', label: 'Short Deck', hint: 'Колода с шестёрки, флеш старше фулл-хауса, сет старше стрита, анте с каждого', options: { mode: 'shortdeck', struct: 'auto', ante: 'all' } },
    { id: 'pineapple', label: 'Пайнэппл', hint: 'Три карты, одну сбросить до флопа', options: { mode: 'pineapple', struct: 'auto' } },
    { id: 'crazy', label: 'Крейзи-пайнэппл', hint: 'Три карты, одну сбросить после флопа', options: { mode: 'crazy', struct: 'auto' } },
    { id: 'plo', label: 'Омаха', hint: '4 карты, пот-лимит', options: { mode: 'omaha4', hilo: false, struct: 'auto' } },
    { id: 'plo5', label: 'Омаха-5', hint: '5 карт, пот-лимит', options: { mode: 'omaha5', hilo: false, struct: 'auto' } },
    { id: 'o8', label: 'Омаха хай-лоу', hint: '«8 или лучше», лимит', options: { mode: 'omaha4', hilo: true, struct: 'limit' } },
    { id: 'courchevel', label: 'Куршевель', hint: '5 карт, первая карта флопа открыта сразу, пот-лимит', options: { mode: 'courchevel', hilo: false, struct: 'auto' } },
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
    { id: 'eight', label: '8-Game', hint: '2–7, холдем, Омаха х/л, разз, стад, стад х/л, безлимитный холдем, PLO — по кругу', options: { mode: 'eight' } },
    ...OFC_PRESETS,
  ],

  setup: (seats, opts, rng) =>
    isOfc(opts.mode) ? setupOfc(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng) : isTour(opts) ? tourSetup(seats, opts, cfgFrom(opts), rng) : setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng),
  toAct: (s) => (isO(s) ? toActOfc(s) : toAct(s)),
  apply(s, seat, a, rng) {
    if (isO(s)) return applyOfc(s, seat, a as OAction, rng);
    if (isTourAction(a)) return tourApply(s, seat, a, rng);
    const r = apply(s, seat, a as Action, rng);
    return r && s.tour ? afterApply(r, rng) : r;
  },
  free: (s, _seat, a) => !isO(s) && !!s.tour && isTourAction(a) && a.what === 'rebuy',
  view: (s, seats) => (isO(s) ? makeOView(s, seats) : makeView(s, seats)),
  redact: (ev, seats) => (isOEv(ev) ? redactOfc(ev, seats) : redact(ev, seats)),
  result(s) {
    if (isO(s)) return resultOfc(s);
    if (!s.over) return null;
    if (s.tour) return tourResult(s);
    const top = Math.max(...s.seats.map((p) => s.chips[p]));
    const scores: Record<number, number> = {};
    for (const p of s.seats) scores[p] = s.chips[p];
    return { winners: s.seats.filter((p) => s.chips[p] === top), text: `${top} фишек`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => (isO(v) ? chooseOfc(v, seat, lv, rng) : choose(v, seat, lv, rng)) },
  // турнир по сети: отключившийся «сидит вне игры» — блайнды платит, чекает или сбрасывает (обмены и решения — за бота)
  away: (v, seat) => (isO(v) || !v.tour || v.decide || v.phase !== 'bet' ? null : toCall(v, seat) > 0 ? { type: 'fold' } : { type: 'check' }),
  awayText: (o) => (isTour(o) ? 'он «сидит вне игры»: блайнды платит, чек или пас' : null),
  describe: (ev, name) => (isOEv(ev) ? describeOfc(ev, name) : describe(ev, name)),

  showcase: () => {
    const s = dealt(['AH KH', '7C 2D', 'QS QD'], DECK);
    s.board = L('KS 9H 4H');
    s.street = 1;
    s.chips = [880, 980, 880, 0, 0, 0, 0, 0, 0];
    s.total = [120, 20, 120, 0, 0, 0, 0, 0, 0];
    s.bet = [60, 0, 0, 0, 0, 0, 0, 0, 0];
    s.current = 60;
    s.folded[1] = true;
    s.turn = 2;
    return makeView(s, [0]);
  },

  rules: {
    goal: 'Выиграть фишки соперников: лучшей рукой на вскрытии или ставкой, на которую никто не ответит.',
    sections: [
      {
        title: 'Раздача и торговля',
        html: `<p>В холдеме каждому — две закрытые карты. Двое слева от баттона ставят <b>блайнды</b> — малый и большой. Затем торговля: каждый по очереди
          <b>пас</b> (сбросить карты), <b>колл</b> (уравнять ставку), <b>рейз</b> (поднять) или <b>чек</b>, если ставить не нужно.</p>
          <p>Потом открывают три общие карты — <b>флоп</b>, ещё одну — <b>тёрн</b>, и последнюю — <b>ривер</b>; после каждой — снова торговля.</p>
          <p>Ставки бывают <b>безлимитные</b> (хоть все фишки; рейз — не меньше прошлого повышения), <b>пот-лимит</b> (не больше банка) и
          <b>лимитные</b> (рейз ровно на ставку, не больше четырёх за круг; на тёрне и ривере ставка вдвое больше).</p>`,
        demo: {
          seats: demoSeats,
          setup: () => dealt(['AH KH', '7C 2D', 'QS QD'], DECK),
          intro: 'Серёга на баттоне, Вовка — малый блайнд (10), Ленка — большой (20).',
          steps: [
            A(2, { type: 'raise', to: 60 }, 'У Серёги пара дам — поднимает до 60.'),
            A(0, { type: 'call' }, 'Вовка с тузом и королём червей уравнивает.'),
            A(1, { type: 'fold' }, 'Ленке с 7-2 тут нечего ловить — пас.'),
            A(0, { type: 'check' }, 'Флоп: К♠ 9♥ 4♥. У Вовки пара королей и четыре червы — пока чек.'),
            A(2, { type: 'raise', to: 80 }, 'Серёга ставит 80.'),
            A(0, { type: 'call' }, 'Вовка отвечает.'),
          ],
        },
      },
      {
        title: 'Комбинации',
        html: `<p>На вскрытии каждый составляет лучшую пятёрку (в холдеме — из своих двух карт и пяти общих). Снизу вверх:</p><ol>
          <li>старшая карта;</li><li><b>пара</b>;</li><li><b>две пары</b>;</li><li><b>сет</b> — три одинаковые;</li>
          <li><b>стрит</b> — пять подряд (туз бывает и единицей: Т-2-3-4-5);</li><li><b>флеш</b> — пять одной масти;</li>
          <li><b>фулл-хаус</b> — сет и пара;</li><li><b>каре</b> — четыре одинаковые;</li><li><b>стрит-флеш</b> — стрит одной масти.</li></ol>
          <p>При равных комбинациях решают старшие карты (кикеры); совсем поровну — банк делят.</p>`,
      },
      {
        title: 'Блайнды, анте и хедз-ап',
        html: `<p>Вдвоём (<b>хедз-ап</b>) баттон ставит малый блайнд и до флопа говорит первым, а после флопа — вторым.</p>
          <p><b>Анте</b> — обязательная ставка в банк до раздачи, она не идёт в ставку круга. Бывает <b>с каждого</b> (десятая часть большого блайнда),
          <b>баттон-анте</b> — баттон платит за весь стол, и <b>анте большого блайнда</b> — большой блайнд кладёт ещё один блайнд за всех.
          Анте делает банк больше с самого начала — играть приходится активнее. Блайнды можно растить каждые 5, 10 или 20 раздач, как в турнире.</p>`,
        demo: {
          seats: bots(2),
          setup: () => dealt(['AH 9C', 'KD 7S'], DECK, { ante: 'button' }),
          intro: 'Вдвоём: Ленка на баттоне — она ставит малый блайнд и, по баттон-анте, анте за двоих. Вовка — большой блайнд.',
          steps: [
            A(1, { type: 'call' }, 'До флопа первым говорит баттон: Ленка уравнивает.'),
            A(0, { type: 'check' }, 'Вовка — чек.'),
            A(0, { type: 'check' }, 'Флоп: К♠ 9♥ 4♥. После флопа первым говорит Вовка — баттон теперь последний.'),
            A(1, { type: 'raise', to: 40 }, 'У Ленки пара королей — ставит 40. Последнее слово — преимущество позиции.'),
          ],
        },
      },
      {
        title: 'Ва-банк и побочные банки',
        html: `<p>Не хватает фишек уравнять — можно пойти <b>ва-банк</b> на все. Тогда игрок претендует только на ту часть банка, которую покрыл,
          а остальное разыгрывают между собой те, у кого фишек больше, — это <b>побочный банк</b>.</p>
          <p>Остался без фишек — вылетел. Побеждает тот, у кого окажутся все фишки, а если число раздач задано — самый богатый в конце.</p>`,
      },
      {
        title: 'Short Deck (6+)',
        html: `<p>Холдем колодой с шестёрки — 36 карт. Карт меньше — сильные руки чаще, поэтому порядок комбинаций чуть другой:
          <b>флеш старше фулл-хауса</b> (собрать пять одной масти труднее) и <b>сет старше стрита</b> — так играют сейчас во всех крупных
          турнирах. Младший стрит — <b>Т-6-7-8-9</b> (туз вместо пятёрки). Обычно играют с анте с каждого.</p>`,
        demo: {
          seats: bots(2),
          // одна раздача — после вскрытия стол не пересдаётся, видно руки
          setup: () => pos('shortdeck', ['9S 9D', 'JS TD'], { board: L('9C QH KD 8S 6H'), street: 3, total: [100, 100, 0, 0, 0, 0, 0, 0, 0], button: 1, cfg: { ...cfgFrom({ mode: 'shortdeck' }), hands: 1 } }),
          intro: 'Ривер: 9♣ Д♥ К♦ 8♠ 6♥. У Вовки сет девяток, у Ленки стрит до короля.',
          steps: [A(0, { type: 'check' }, 'Вовка — чек.'), A(1, { type: 'check' }, 'Ленка тоже. Вскрытие: в Short Deck сет старше стрита (а флеш — старше фулл-хауса) — банк Вовке.')],
        },
      },
      {
        title: 'Пайнэппл',
        html: `<p>Как холдем, но своих карт <b>три</b>. В <b>пайнэппле</b> одну лишнюю сбрасывают после торговли на префлопе, до флопа;
          в <b>крейзи-пайнэппле</b> — после торговли на флопе, до тёрна (дольше играешь с тремя). Дальше всё как в холдеме: лучшая пятёрка из двух своих и пяти общих.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos('pineapple', ['AS KD 7C', 'QH QS 2D', 'JC TC 4H'], { phase: 'discard', total: [20, 20, 20, 0, 0, 0, 0, 0, 0], acted: [0, 1, 2], drew: Array(9).fill(false) }),
          intro: 'Торговля на префлопе кончилась — каждый сбрасывает одну из трёх карт.',
          steps: [
            A(0, { type: 'discard', card: C('7C') }, 'Вовка оставляет туз с королём, семёрку — в сброс.'),
            A(1, { type: 'discard', card: C('2D') }, 'Ленка сбрасывает двойку — у неё пара дам.'),
            A(2, { type: 'discard', card: C('4H') }, 'Серёга оставляет одномастные В-10. Теперь флоп.'),
          ],
        },
      },
      {
        title: 'Омаха',
        html: `<p>У каждого четыре (в Омахе-5 — пять) своих карт, на стол выходят пять общих: флоп (3), тёрн, ривер.
          Комбинация — <b>ровно две свои и три общие</b>, не больше и не меньше. Обычно пот-лимит.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos('omaha4', ['AS KS QH JH', '9C 9D 4S 2H', 'TD 8D 7C 6C'], { board: L('KH 7H 9S'), street: 1, total: [20, 20, 20, 0, 0, 0, 0, 0, 0] }),
          intro: 'Флоп: К♥ 7♥ 9♠. У Вовки Т♠ К♠ Д♥ В♥.',
          steps: [A(0, { type: 'check' }, 'Вовка: чек — у него пара королей и четыре червы (две свои + две на столе).'), A(1, { type: 'raise', to: 40 }, 'Ленка с сетом девяток ставит.'), A(2, { type: 'call' }, 'Серёга коллирует: у него стритовое дро — 10 и 8 свои, 7 и 9 на столе, ждёт валета или шестёрку.')],
        },
      },
      {
        title: 'Куршевель',
        html: `<p>Омаха на пять карт, но <b>первая карта флопа открыта сразу</b>, ещё до торговли на префлопе: уже видно, кому она подходит.
          Потом выходят ещё две карты флопа, тёрн и ривер. Комбинация — ровно две свои и три общие. Обычно пот-лимит, бывает и хай-лоу.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos('courchevel', ['AS AH 9D 8C 2S', 'KH QH JS 7D 3C', '6S 6D 5H 4C TD'], { board: L('AD'), bet: [10, 20, 0, 0, 0, 0, 0, 0, 0], total: [10, 20, 0, 0, 0, 0, 0, 0, 0], current: 20, turn: 2, button: 2 }),
          intro: 'Открыт Т♦. Серёга на баттоне, Вовка — малый блайнд, Ленка — большой.',
          steps: [
            A(2, { type: 'fold' }, 'Серёге туз на столе ни к чему — пас.'),
            A(0, { type: 'raise', to: 60 }, 'У Вовки два туза и туз на столе — уже сет! Поднимает до 60 (больше банка нельзя).'),
            A(1, { type: 'call' }, 'Ленка уравнивает с К-Д-В. Выходят ещё две карты флопа.'),
          ],
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
            s.total = [5, 10, 5, 0, 0, 0, 0, 0, 0];
            s.bet = [0, 5, 0, 0, 0, 0, 0, 0, 0];
            s.current = 5;
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
          setup: () => pos('td27', ['7S 5H 3D KC 2C', 'AS AD 9H 8S 4C', 'QS JD 6H 6C 3S'], { phase: 'draw', street: 1, drew: Array(9).fill(false) }),
          intro: '2–7, первый обмен. У Вовки 7-5-3-2 и король.',
          steps: [A(0, { type: 'draw', cards: [C('KC')] }, 'Вовка меняет одну — короля.'), A(1, { type: 'draw', cards: L('AS AD 9H') }, 'Ленке хуже: тузы в 2–7 старшие — меняет три.'), A(2, { type: 'draw', cards: L('QS JD 6C') }, 'Серёга меняет три.')],
        },
      },
      {
        title: 'Хай-лоу, HORSE и 8-Game',
        html: `<p><b>Хай-лоу «8 или лучше»</b> (Омаха, Куршевель, стад): банк делится пополам — лучшей старшей руке и лучшей младшей из пяти разных
          не старше восьмёрки (туз младший). Младшей ни у кого нет — весь банк старшей. В Омахе и младшая — ровно две свои и три общие.</p>
          <p><b>HORSE</b> — пять видов по кругу, каждый на круг раздач: Холдем, Омаха хай-лоу, Разз, Стад, стад хай-лоу («Eight or better»). Всё — лимит.</p>
          <p><b>8-Game</b> — восемь видов по кругу: 2–7 тройной обмен, лимитный холдем, Омаха хай-лоу, разз, стад, стад хай-лоу,
          <b>безлимитный</b> холдем и <b>пот-лимит</b> Омаха. Кто силён во всём — тот и выигрывает.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => {
            const s = pos('stud7', ['KS 2H 9D', 'AC QD 3S', '7H 7S JC'], {}, [[false, false, true], [false, false, true], [false, false, true]]);
            s.cfg = cfgFrom({ mode: 'eight' });
            s.hilo = true;
            s.hand = 18;
            s.total = [5, 10, 5, 0, 0, 0, 0, 0, 0];
            s.bet = [0, 5, 0, 0, 0, 0, 0, 0, 0];
            s.current = 5;
            s.turn = 2;
            return s;
          },
          intro: `8-Game, раздача 18 — последняя на круге стада хай-лоу (${MIXES.eight.slots.map((x) => x.letter).join(' → ')}).`,
          steps: [A(2, { type: 'raise', to: 20 }, 'Серёга доводит до малой ставки.'), A(0, { type: 'fold' }, 'Вовка — пас.'), A(1, { type: 'fold' }, 'Ленка — пас, банк Серёге. Круг стада кончился — следующая раздача уже безлимитный холдем.')],
        },
      },
      {
        title: 'Турниры: Sit&Go и MTT',
        html: `<p>В турнире фишки — не очки: все покупают вход (<b>бай-ин</b>) и получают одинаковый стек, а <b>блайнды растут по уровням</b>.
          Кто остался без фишек — выбыл; призы делят первые места. <b>Sit&Go</b> — один стол (вдвоём, на 6 или 9): платят 100%, 65/35 или 50/30/20.
          <b>«Удвоение»</b> — половина стола получает по два бай-ина. <b>Многостоловый (MTT)</b> — 18…180 игроков, платят примерно 15% поля;
          столы балансируют — игроков пересаживают, последние девять играют <b>финальный стол</b>. С середины турнира добавляется <b>анте</b>.</p>
          <p><b>Пузырь</b> — когда до призов остался один вылет: тут фишку проиграть дороже, чем выиграть (это и считает <b>ICM</b> — сколько
          призовых «стоит» стек). <b>M</b> — на сколько кругов блайндов и анте хватит стека: зелёная зона (20+) — играй во всю силу, жёлтая (10–20) — плотнее,
          оранжевая (6–10) — входи первым рейзом, красная (меньше 6) — только ва-банк или пас.</p>
          <p>Виды: <b>фриз-аут</b> — один вход; <b>ребай</b> — докупить стек, пока фишек не больше стартовых, в первые уровни, и <b>аддон</b> в перерыв;
          <b>ре-энтри</b> — вылетел в начале — войди снова; <b>PKO</b> (прогрессивный нокаут) — половина бай-ина идёт в награду за голову:
          за выбитого — половину его награды сразу, половину — к своей. Уровни здесь — по часам турнира: раздача «стоит» около минуты, так что часы стоят, пока вы думаете.</p>`,
      },
      ...OFC_RULES,
    ],
  },
};
