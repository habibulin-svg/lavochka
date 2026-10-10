/* Дурак — описание игры для сборника: варианты, боты, журнал, скрытие карт, правила с показом. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { plural } from '../../core/util';
import { SUIT_NAME, SUIT_SYM, type Card, type Suit } from '../../cards/deck';
import { choose } from './ai';
import { apply, DEFAULT_CFG, makeView, newState, setup, toAct, winners, type Action, type Cfg, type Event, type State, type View } from './engine';

export const SEATS = [
  { name: 'Вовка', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Ленка', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Серёга', color: '#2f7a3e', light: '#58ad66', dark: '#18452a' },
  { name: 'Танька', color: '#d9a521', light: '#f3cf62', dark: '#8a6410', ink: '#8a6410' },
  { name: 'Димон', color: '#6a3d8f', light: '#9a70c0', dark: '#3a1f52' },
  { name: 'Колян', color: '#5a5a5a', light: '#9a9a9a', dark: '#2a2a2a' },
];

/** Звания Короля-говно: Король, Принц, в середине — Палач, Солдат, Вор, Шут; последний — Говно. */
export function titleOf(place: number, total: number): string {
  if (place === total - 1) return 'Говно';
  if (place === 0) return 'Король';
  if (place === 1) return 'Принц';
  return ['Палач', 'Солдат', 'Вор', 'Шут'][place - 2] ?? 'Шут';
}

const cards = (list: Card[]) => list.map((c) => `<b class="dk-c${c.s === 'H' || c.s === 'D' ? ' red' : ''}">${c.r > 10 ? 'ВДКТ'[c.r - 11] : c.r}${SUIT_SYM[c.s]}</b>`).join(' ');
const suitWord = (s: Suit) => `${SUIT_SYM[s]} ${SUIT_NAME[s]}`;

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'deal': {
      let t = ev.game > 1 ? `<b>Партия ${ev.game}.</b> ` : '';
      if (ev.dealer != null) t += `Сдаёт ${name(ev.dealer)}. `;
      if (ev.chooser != null) return t + `${name(ev.chooser)} выбирает козырь.`;
      if (ev.ptrump) t += `Личные козыри: ${ev.ptrump.map((x, seat) => (x ? `${name(seat)} ${SUIT_SYM[x]}` : '')).filter(Boolean).join(', ')}. `;
      else t += `Козырь — <b>${suitWord(ev.trump)}</b>${ev.trumpCard ? ` (${cards([ev.trumpCard])} под колодой)` : ''}. `;
      t += ev.low ? `Младший козырь ${cards([ev.low])} у ${name(ev.first)} — ходит первым.` : `Первым ходит ${name(ev.first)}.`;
      return t;
    }
    case 'trump':
      return `${name(ev.seat)} назначает козырем <b>${suitWord(ev.suit)}</b>. Ходит ${name(ev.first)}.`;
    case 'attack':
      return `${name(ev.seat)} ходит: ${cards(ev.cards)}`;
    case 'beat':
      return `${name(ev.seat)} кроет: ${cards([ev.card])}`;
    case 'transfer':
      return ev.shown
        ? `${name(ev.seat)} показывает козырь ${cards([ev.shown])} и переводит на ${name(ev.to)}.`
        : `${name(ev.seat)} переводит ${cards([ev.card!])} на ${name(ev.to)}.`;
    case 'take':
      return `${name(ev.seat)}: <i>беру</i>.`;
    case 'throw':
      return `${name(ev.seat)} подкидывает: ${cards(ev.cards)}`;
    case 'pass':
      return null;
    case 'bito':
      return `<i>Бито (${ev.count} ${plural(ev.count, 'карта', 'карты', 'карт')}).</i>`;
    case 'pickup':
      return `${name(ev.seat)} забирает ${ev.cards.length} ${plural(ev.cards.length, 'карту', 'карты', 'карт')}.`;
    case 'draw':
      return ev.trump ? `${name(ev.seat)} добирает и забирает козырь ${cards([ev.trump])}.` : null;
    case 'laid':
      return `${name(ev.seat)} выкладывает ${cards([ev.card])}${ev.card.r === 14 ? ' — <b>длинный дурак!</b>' : ev.hand < 6 ? ` — теперь ему сдают по ${ev.hand}` : ''}.`;
    case 'out':
      return `${name(ev.seat)} вышел${ev.place === 1 ? ' первым' : ''}.`;
    case 'gameEnd': {
      if (ev.draw) return `🤝 <b>Ничья</b> — карты кончились у всех разом.`;
      let t = ev.losers.length > 1 ? `🃏 <b>Дураки — ${ev.losers.map(name).join(' и ')}!</b>` : `🃏 <b>${name(ev.fool!)} — дурак!</b>`;
      if (ev.pogony) t += ` И с ${ev.pogony === 2 ? 'погонами на обоих плечах' : 'погоном'}!`;
      return t;
    }
  }
  return null;
}

/** Чужие карты при доборе не показываем — только сколько. Вытянутый козырь видели все. */
function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (ev.type === 'draw' && seats !== 'all' && !seats.includes(ev.seat)) return { ...ev, cards: undefined };
  if (ev.type === 'pass') return ev;
  return ev;
}

// ---------------------------------------------------------------- позиции для показа правил

const demoSeats = (n: number): SeatSpec[] => Array.from({ length: n }, (_, i) => ({ seat: i, kind: 'bot', name: SEATS[i].name, level: 1 }));

/** Карта из записи «7S», «10H», «QD», «AC» (В/Д/К/Т — J/Q/K/A). */
export function cd(t: string): Card {
  const s = t.slice(-1) as Suit;
  const r = t.slice(0, -1);
  const map: Record<string, number> = { J: 11, Q: 12, K: 13, A: 14 };
  return { s, r: map[r] ?? Number(r) };
}
const cl = (t: string) => (t.trim() ? t.trim().split(/\s+/).map(cd) : []);

/** Позиция: руки по местам, колода (верх первым, последняя — козырь), отбой; ходит attacker на следующего. */
function pos(c: Partial<Cfg>, hands: string[], deck: string, extra: Partial<State> = {}): State {
  const cfg: Cfg = { ...DEFAULT_CFG, ...c };
  const seats = hands.map((_, i) => i);
  const s = newState(cfg, seats);
  hands.forEach((h, i) => (s.hands[i] = cl(h)));
  s.deck = cl(deck);
  const last = s.deck[s.deck.length - 1];
  s.trump = cfg.diamonds ? 'D' : last ? last.s : 'H';
  s.trumpCard = last && !cfg.diamonds ? last : null;
  s.game = 1;
  s.first = false;
  s.attacker = 0;
  s.defender = 1;
  s.cap = Math.min(cfg.hand, s.hands[1].length);
  Object.assign(s, extra);
  return s;
}

const A = (seat: number, list: string): { seat: number; action: Action } => ({ seat, action: { type: 'attack', cards: cl(list) } });
const B = (seat: number, i: number, card: string) => ({ seat, action: { type: 'beat', i, card: cd(card) } as Action });
const T = (seat: number, list: string) => ({ seat, action: { type: 'throw', cards: cl(list) } as Action });
const P = (seat: number) => ({ seat, action: { type: 'pass' } as Action });

export const def: GameDef<State, Action, Event, View> = {
  id: 'durak',
  title: 'Дурак',
  players: { min: 2, max: 6, default: 3 },
  seats: SEATS,

  options: [
    {
      key: 'throwers',
      label: 'Кто подкидывает',
      type: 'select',
      choices: [
        { value: 'all', label: 'все, кроме отбивающегося' },
        { value: 'neighbors', label: 'только соседи отбивающегося' },
        { value: 'attacker', label: 'только ходивший' },
        { value: 'none', label: 'никто (простой дурак)' },
      ],
      default: 'all',
    },
    { key: 'transfer', label: 'Переводной', hint: 'Пока не покрыл ни одной карты, можно перевести ход картой того же достоинства на следующего.', type: 'toggle', default: false },
    { key: 'transferShow', label: 'Перевод показом козыря', hint: 'Показал козырь того же достоинства — перевёл, карта осталась на руке. Каждым козырем — раз за кон.', type: 'toggle', default: true, showIf: (o) => o.transfer === true },
    {
      key: 'deck',
      label: 'Колода',
      type: 'select',
      choices: [
        { value: 24, label: '24 карты (с девяток)' },
        { value: 32, label: '32 карты (с семёрок)' },
        { value: 36, label: '36 карт (с шестёрок)' },
        { value: 52, label: '52 карты (с двоек)' },
      ],
      default: 36,
      hint: 'Если на всех не хватает, колода берётся больше.',
    },
    {
      key: 'long',
      label: 'Длинный дурак',
      hint: 'На 2–4 игроков (правильно — на четверых). Шестёрки раздают каждому: масть шестёрки — твой личный козырь, сами шестёрки не играют. Проигравший выкладывает следующую карту своей масти (7, 8 … туз); с десятки ему сдают 5 карт, с валета 4 и т. д. Выложил туза — длинный дурак.',
      type: 'toggle',
      default: false,
      showIf: (o) => o.ranks !== true && o.diamonds !== true,
    },
    { key: 'firstFive', label: 'Первый отбой — не больше 5 карт', type: 'toggle', default: true },
    { key: 'multiLead', label: 'Ходить несколькими картами одного достоинства', type: 'toggle', default: true },
    { key: 'spades', label: 'Пики бьются только пиками', hint: 'Японский дурак: на пику можно положить только старшую пику, козырь её не бьёт.', type: 'toggle', default: false },
    { key: 'diamonds', label: 'Козырь всегда бубны', type: 'toggle', default: false },
    {
      key: 'teams',
      label: 'Командами',
      hint: 'На четверых — 2 на 2, на шестерых — 3 на 3. Напарники сидят через одного: ходят и переводят только на соперника, на напарника не подкидывают. Вышла вся команда — она выиграла.',
      type: 'toggle',
      default: false,
      showIf: (o) => o.ranks !== true && o.long !== true,
    },
    { key: 'pogony', label: 'Погоны', hint: 'Если дурака добили шестёркой (или двумя) — ему вешают погоны.', type: 'toggle', default: false },
    {
      key: 'ranks',
      label: 'Звания (Король-говно)',
      hint: 'Серия партий. После первой — звания по порядку выхода: Король, Принц, Палач, Солдат, Вор, Шут, Говно. Козырь назначает Король, сдаёт и ходит первым Говно. Проигравший меняется местами с Говном. Зовут друг друга только по званиям.',
      type: 'toggle',
      default: false,
    },
    {
      key: 'games',
      label: 'Партий',
      type: 'select',
      choices: [
        { value: 1, label: 'одна партия' },
        { value: 3, label: '3 партии' },
        { value: 5, label: '5 партий' },
        { value: 7, label: '7 партий' },
        { value: 10, label: '10 партий' },
      ],
      default: 1,
      hint: 'В серии выигрывает тот, кто реже всех оставался дураком.',
    },
  ],
  presets: [
    { id: 'classic', label: 'Классический', hint: 'Простой дурак: без подкидывания', options: { throwers: 'none', transfer: false, deck: 36, spades: false, diamonds: false, ranks: false, games: 1 , long: false} },
    { id: 'podkidnoy', label: 'Подкидной', hint: 'Подкидывают все', options: { throwers: 'all', transfer: false, deck: 36, spades: false, diamonds: false, ranks: false, games: 1 , long: false} },
    { id: 'perevodnoy', label: 'Переводной', hint: 'Перевод картой или показом козыря', options: { throwers: 'all', transfer: true, transferShow: true, deck: 36, spades: false, diamonds: false, ranks: false, games: 1 , long: false} },
    { id: 'long', label: 'Длинный', hint: 'Личные козыри из шестёрок, проигравший выкладывает карты до туза', options: { throwers: 'all', transfer: false, deck: 36, spades: false, diamonds: false, ranks: false, teams: false, long: true, games: 1 } },
    { id: 'japan', label: 'Японский', hint: 'Пики пиками, козырь — бубны', options: { throwers: 'all', transfer: false, deck: 36, spades: true, diamonds: true, ranks: false, games: 1 , long: false} },
    { id: 'pairs', label: '2 на 2', hint: 'Подкидной парами: напарники через одного (на шестерых — 3 на 3)', options: { throwers: 'all', transfer: false, deck: 36, spades: false, diamonds: false, ranks: false, teams: true, games: 1 , long: false} },
    { id: 'govno', label: 'Король-говно', hint: 'Звания: Король назначает козырь, первым ходит Говно', options: { throwers: 'all', transfer: false, deck: 36, spades: false, diamonds: false, ranks: true, teams: false, long: false, pogony: true, games: 5 } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  redact,
  result(s) {
    if (s.phase !== 'over') return null;
    const w = winners(s);
    const scores: Record<number, number> = {};
    for (const x of s.seats) scores[x] = s.fools[x];
    if (s.cfg.long && s.seats.length <= 4) return { winners: w, text: 'не дошли до туза — длинный дурак другой', scores };
    if (s.cfg.ranks) return { winners: w, text: `Король после ${s.game} ${plural(s.game, 'партии', 'партий', 'партий')}`, scores };
    if (s.cfg.games > 1) return { winners: w, text: `реже всех оставались дураком (${s.game} ${plural(s.game, 'партия', 'партии', 'партий')})`, scores };
    if (s.draw) return { winners: w, text: 'ничья — карты кончились у всех разом', scores };
    if (s.losers.length > 1) return { winners: w, text: 'команда вышла первой', scores };
    return { winners: w, text: `не остались в дураках`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose },
  describe,

  showcase() {
    // 36 разных карт: стол 5, бито 6, руки 6+4+5+5, колода 5 (козырь — десятка бубен)
    const s = pos({}, ['6S 9S JC QH KH AS', 'JD JH QS 7H', 'QC 8H 9D AH 10S', '6C JS QD 8D AC'], '6H 7D KD AD 10D');
    s.table = [
      { a: cd('9C'), d: cd('KC') },
      { a: cd('KS'), d: cd('6D') },
      { a: cd('9H'), d: null },
    ];
    s.bito = cl('7C 7S 8S 8C 10C 10H');
    s.phase = 'defend';
    s.cap = 6;
    return s;
  },

  rules: {
    goal: 'Избавиться от всех карт. Кто последним остался с картами на руках — тот и <b>дурак</b>.',
    sections: [
      {
        title: 'Раздача и козырь',
        html: `<p>Играют колодой в 36 карт (с шестёрок; можно 24, 32 или 52). Каждому сдают по <b>6 карт</b>, следующую кладут под колоду лицом вверх — её масть <b>козырь</b>.
          Козырь бьёт любую карту другой масти.</p>
          <p>Первым ходит тот, у кого <b>младший козырь</b>. Ходят по часовой стрелке: ходящий ходит под соседа слева.</p>`,
      },
      {
        title: 'Ход и отбой',
        html: `<p>Ходящий кладёт карту — или сразу несколько одного достоинства. Отбивающийся кроет каждую <b>старшей картой той же масти</b> или козырем (козырь — только старшим козырем).</p>
          <p>Когда всё покрыто и никто ничего не подкинул, карты уходят в <b>бито</b>, и ход переходит к отбившемуся.</p>
          <p>После кона все добирают из колоды до шести: сначала ходивший, потом остальные, отбивавшийся — последним.</p>`,
        demo: {
          seats: demoSeats(2),
          setup: () => pos({ throwers: 'all' }, ['7S 9S QH KD 8C 6D', 'JS 8S 10H AH 7C 9D'], 'QC 6H 10C 7D AS KS KC AC 6C'),
          intro: 'Козырь — трефы (шестёрка треф под колодой). Ходит Вовка.',
          steps: [
            { ...A(0, '7S'), caption: 'Вовка ходит семёркой пик.' },
            { ...B(1, 0, '8S'), caption: 'Ленка кроет восьмёркой пик — старшей той же масти.' },
            { ...P(0), caption: 'Подкинуть Вовка мог бы только козырную восьмёрку — жалко. Пас: бито. Все добирают, ход у Ленки.' },
          ],
        },
      },
      {
        title: 'Подкидывание',
        html: `<p>В подкидном, пока кон не закончен, можно <b>подкидывать</b> карты того же достоинства, что уже лежат на столе. Первым подкидывает ходивший, потом остальные по кругу.</p>
          <p>Всего за кон — не больше шести карт и не больше, чем у отбивающегося на руках. В первом коне партии — не больше пяти.</p>
          <p>В «простом» (классическом) дураке подкидывать нельзя: кон — это только первый ход.</p>`,
        demo: {
          seats: demoSeats(3),
          setup: () => pos({ throwers: 'all' }, ['9H 6S QD KS 10C 7D', 'JH 7H 8S QH KD 7C', '9C 6C KH 9S JD 8D'], 'AC 10D 8C 10S 6H JC'),
          intro: 'Козырь — трефы. Вовка ходит под Ленку, Серёга тоже может подкидывать.',
          steps: [
            { ...A(0, '9H'), caption: 'Вовка ходит девяткой червей.' },
            { ...B(1, 0, 'QH'), caption: 'Ленка кроет дамой червей.' },
            { ...T(0, 'QD'), caption: 'На столе есть дама — Вовка подкидывает даму бубен.' },
            { ...B(1, 1, 'KD'), caption: 'Ленка кроет королём бубен.' },
            { ...P(0), caption: 'Вовка мог бы подкинуть короля, но бережёт его — пас.' },
            { ...T(2, '9S'), caption: 'Очередь Серёги: он подкидывает девятку пик.' },
            { ...B(1, 2, '7C'), caption: 'Ленка кроет козырем — семёркой треф.' },
            { ...P(0) },
            { ...P(2), caption: 'Все спасовали — бито. Ленка отбилась, ход у неё.' },
          ],
        },
      },
      {
        title: 'Взять',
        html: `<p>Если отбиться нечем (или не хочется тратить козыри), отбивающийся говорит «<b>беру</b>». Остальные ещё могут подкинуть ему «вдогонку» — сколько позволяет лимит, — и он забирает со стола всё.</p>
          <p>Взявший пропускает ход: ходит следующий за ним. Карты, которые все видели на столе, помнят все — сильные боты тоже.</p>`,
        demo: {
          seats: demoSeats(2),
          setup: () => pos({ throwers: 'all' }, ['10S 10D 6H QC 8D KH', '9S 7C 9C AH 8H 6C'], 'QS 7D KC 9D AS 7H JD 10H AD'),
          intro: 'Козырь — бубны. У Ленки нет ни пик, ни бубен.',
          steps: [
            { ...A(0, '10S'), caption: 'Вовка ходит десяткой пик.' },
            { seat: 1, action: { type: 'take' }, caption: 'Покрыть нечем: «беру».' },
            { ...T(0, '10D'), caption: 'Вовка подкидывает вдогонку десятку бубен. Больше подкинуть нечего — Ленка забирает обе карты и пропускает ход: снова ходит Вовка.' },
          ],
        },
      },
      {
        title: 'Переводной',
        html: `<p>В переводном, пока отбивающийся не покрыл ни одной карты, он может <b>перевести</b>: положить к атакующим карту того же достоинства — и отбиваться теперь следующему.
          Перевести можно, только если у следующего хватает карт на все переведённые.</p>
          <p>Если включён <b>перевод показом</b>, достаточно показать козырь того же достоинства — карта остаётся на руке. Каждым козырем — один раз за кон.</p>`,
        demo: {
          seats: demoSeats(3),
          options: { transfer: true },
          setup: () => pos({ transfer: true, transferShow: true }, ['8H 6S QD KS 10C 7D', '8S JH 7H QH 10D AS', '9C 8C KH 9S JD 8D'], 'AC 7C 6C 10S 6H JC'),
          intro: 'Козырь — трефы. Вовка ходит под Ленку.',
          steps: [
            { ...A(0, '8H'), caption: 'Вовка ходит восьмёркой червей.' },
            { seat: 1, action: { type: 'transfer', card: cd('8S') }, caption: 'У Ленки тоже восьмёрка — она переводит на Серёгу.' },
            { seat: 2, action: { type: 'show', card: cd('8C') }, caption: 'Серёга показывает козырную восьмёрку — и переводит обратно на Вовку, не выкладывая её.' },
            { ...B(0, 0, '10C'), caption: 'Вовке приходится отбиваться самому.' },
          ],
        },
      },
      {
        title: '2 на 2: командами',
        html: `<p>Вчетвером можно играть <b>пара на пару</b> (вшестером — тройка на тройку). Напарники сидят <b>через одного</b>, так что ход всегда идёт на соперника.</p>
          <ul><li>Подкидывают только соперники отбивающегося — на напарника не подкидывают.</li>
          <li>Переводят тоже только на соперника — следующего игрока другой команды.</li>
          <li>Вышли все игроки команды — она выиграла; оставшиеся — <b>дураки</b>, сколько бы карт у них ни было.</li></ul>`,
        demo: {
          seats: demoSeats(4),
          options: { teams: true },
          setup: () => pos({ teams: true }, ['8H 6S QD', '9H JH', '8C 6C', 'KH 7D'], '', { team: [0, 1, 0, 1, -1, -1], trump: 'S' }),
          intro: 'Колода кончилась, козырь — пики. Вовка с Серёгой — против Ленки с Танькой. Ходит Вовка под Ленку.',
          steps: [
            { ...A(0, '8H'), caption: 'Вовка ходит восьмёркой червей.' },
            { ...B(1, 0, '9H'), caption: 'Ленка кроет девяткой.' },
            { ...T(2, '8C'), caption: 'Подкидывает напарник Вовки — Серёга. Танька, напарница Ленки, подкидывать на неё не может.' },
            { seat: 1, action: { type: 'take' }, caption: 'Покрыть нечем — Ленка берёт.' },
          ],
        },
      },
      {
        title: 'Конец партии',
        html: `<p>Когда колода кончилась, игрок без карт <b>выходит</b>. Последний, у кого остались карты, — <b>дурак</b>.
          Если в последнем коне карты кончились у всех разом — <b>ничья</b>.</p>
          <p><b>Погоны</b> (включаются в настройках): если дурака добили шестёркой — на плечо ему вешают погон, двумя шестёрками — погоны на оба плеча.</p>
          <p>Можно играть серию партий: следующую сдаёт дурак, и первым ходят под него — ходит сосед справа от дурака.</p>`,
      },
      {
        title: 'Японский: пики пиками',
        html: `<p>В японском дураке козырь всегда <b>бубны</b>, а пики — особая масть: <b>пику можно побить только старшей пикой</b>, даже козырь её не берёт. Сами пики другие масти не бьют.</p>`,
        demo: {
          seats: demoSeats(2),
          setup: () => pos({ spades: true, diamonds: true }, ['9S 7H 8C QS 10H 6H', '6D 10S AD 8H KC 7S'], 'QH JD 10C 9C 6S AH'),
          intro: 'Козырь — бубны. Вовка ходит девяткой пик.',
          steps: [
            { ...A(0, '9S'), caption: 'Девятка пик. Козырями её не взять — только старшей пикой.' },
            { ...B(1, 0, '10S'), caption: 'Ленка кроет десяткой пик.' },
            { ...T(0, '10H'), caption: 'Вовка подкидывает десятку червей…' },
            { ...B(1, 1, '6D'), caption: '…а её козырь бьёт как обычно: особые только пики.' },
          ],
        },
      },
      {
        title: 'Длинный дурак',
        html: `<p>Играют вчетвером (можно вдвоём или втроём). Перед первой партией из колоды вынимают <b>шестёрки</b> и раздают по одной: масть шестёрки — <b>личный козырь</b> игрока, сами шестёрки не играют.
          Козырь отбивающегося бьёт любую карту другой масти, а козырь ходящего для отбивающегося — обычная масть.</p>
          <p>Первым ходит тот, у кого шестёрка пик, дальше — «из-под дурака». Подкидывают строго по очереди по часовой стрелке.</p>
          <p>Дурак выкладывает перед собой следующую карту своей масти: семёрку, потом восьмёрку… С десятки ему сдают по 5 карт, с валета — по 4, с дамы — по 3, с короля — по 2. Выложил туза — <b>длинный дурак</b>, игра окончена.</p>`,
        demo: {
          seats: demoSeats(2),
          options: { long: true },
          setup: () => pos({ long: true }, ['9H 10C 8S JD QH 7C', 'JH 9S 10D 7D KC AS'], 'QS KD 8D 9C', { ptrump: ['C', 'D', null, null, null, null], laid: [[cd('6C')], [cd('6D')], [], [], [], []], trump: 'C', trumpCard: null }),
          intro: 'Личные козыри: у Вовки — трефы, у Ленки — бубны.',
          steps: [
            { ...A(0, '10C'), caption: 'Вовка ходит своим козырем, десяткой треф. Для Ленки трефы — обычная масть…' },
            { ...B(1, 0, '7D'), caption: '…и она кроет её своим козырем — семёркой бубен.' },
          ],
        },
      },
      {
        title: 'Король-говно',
        html: `<p>Дворовая игра со <b>званиями</b> поверх подкидного. После первой партии звания раздают по порядку выхода: <b>Король</b>, <b>Принц</b>, в середине — Палач, Солдат, Вор, Шут, последний — <b>Говно</b>.</p>
          <p>Дальше <b>козырь назначает Король</b>, посмотрев свои карты, а сдаёт и <b>первым ходит Говно</b>. Кто остался дураком — меняется местами с Говном (если сам не Говно).</p>
          <p>Называть друг друга по именам нельзя — только по званиям. Выигрывает тот, кто Король в конце серии.</p>`,
      },
    ],
  },
};

