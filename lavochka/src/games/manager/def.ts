/* «Менеджер» и «Космос 2000» — одна карточка, поле (и с ним правила) выбирается настройкой. Движок — engine.ts, боты — bot.ts. */
import type { DemoScript, GameDef, Rng, SeatSpec } from '../../core/types';
import { SEATS as HSEATS } from '../hodilki/core';
import { BOARDS, boardOf } from './boards';
import { choose } from './bot';
import { apply, fmt, newState, toAct, view, type Action, type Event, type State } from './engine';

export const SEATS = HSEATS.slice(0, 6);

/** У события — поле партии: журнал на клиенте должен знать валюту и названия клеток. */
export type Ev = Event & { m?: 'manager' | 'kosmos' };

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));

/** Показ правил: обычная расстановка на двоих и правка позиции. */
function demo(map: 'manager' | 'kosmos', patch: (s: State) => void, steps: DemoScript<State, Action>['steps']): DemoScript<State, Action> {
  return {
    seats: demoSeats,
    options: { map },
    setup: (_def, rng: Rng) => {
      const s = newState(map, [0, 1], {}, rng);
      patch(s);
      return s;
    },
    steps,
  };
}

const cardIndex = (map: 'manager' | 'kosmos', deck: number, start: string) => boardOf(map).decks[deck].cards.findIndex((c) => c.text.startsWith(start));
const top = (s: State, deck: number, start: string) => {
  const id = cardIndex(s.map, deck, start);
  s.decks[deck] = [id, ...s.decks[deck].filter((i) => i !== id)];
};

const M = 'manager' as const;
const K = 'kosmos' as const;

const MANAGER_RULES = [
  {
    title: 'Менеджер: ход и покупка',
    html: `<p>От 2 до 6 игроков, у каждого на старте <b>20 000 ₽</b>. Бросают два кубика и идут по стрелке от «Старта». Каждый раз, когда фишка
      проходит «Старт» или останавливается на нём, банк платит <b>2 000</b>. Дубль — ещё бросок; три дубля подряд — на биржу.</p>
      <p>На ничьём участке его можно купить по цене на клетке. Отказались — банкир сразу продаёт участок <b>с торгов</b>: торгуются все, и тот, кто отказался.
      Шаг торгов — 500 ₽.</p>`,
    demo: demo(M, () => {}, [
      { seat: 0, action: { type: 'roll' }, rig: [0, 2], caption: 'Вовка бросает 1 и 3 — фабрика «Большевичка» ничья, её можно купить за 7 000.' },
      { seat: 0, action: { type: 'buy' }, caption: 'Покупает: карточка «Право на собственность» теперь у него.' },
      { seat: 1, action: { type: 'roll' }, rig: [2, 3], caption: 'Ленка попадает на СКК им. Ленина (10 000)…' },
      { seat: 1, action: { type: 'pass' }, caption: '…и отказывается. Банкир тут же выставляет участок на торги.' },
      { seat: 0, action: { type: 'bid', amount: 5000 }, caption: 'Вовка даёт 5 000.' },
      { seat: 1, action: { type: 'bid', amount: 6000 }, caption: 'Ленка — 6 000.' },
      { seat: 0, action: { type: 'fold' }, caption: 'Вовка выходит из торгов — СКК уходит Ленке за 6 000, дешевле цены.' },
    ]),
  },
  {
    title: 'Менеджер: плата за наём и постройки',
    html: `<p>Попал на чужой участок — плати хозяину за наём по карточке «Право на собственность». Заложенный участок платы не приносит.</p>
      <p>Собрал <b>все участки одного цвета</b> — плата за пустые участки этой группы двойная, и на них можно строить: <b>филиалы</b> (до трёх) и
      <b>предприятие</b> (когда на каждом участке группы по три филиала). Строят до броска, <b>равномерно</b> — на участке не может быть больше
      на две постройки, чем на соседнем. Цена постройки — внизу карточки: 5 000, 10 000, 15 000 или 20 000. В банке 26 филиалов и 12 предприятий —
      кончились, ждите, пока кто-нибудь продаст.</p>`,
    demo: demo(
      M,
      (s) => {
        for (const c of [1, 2, 4]) s.owner[c] = 0;
        s.cash[0] = 40000;
        s.pos[0] = 25;
      },
      [
        { seat: 0, action: { type: 'build', cell: 1 }, caption: 'Вся «Лёгкая промышленность» у Вовки. Филиал на «Пр. Победа» — 5 000.' },
        { seat: 0, action: { type: 'build', cell: 2 }, caption: 'Строят равномерно: теперь филиал на фабрике им. Володарского…' },
        { seat: 0, action: { type: 'build', cell: 4 }, caption: '…и на «Большевичке».' },
        { seat: 0, action: { type: 'roll' }, rig: [2, 3], caption: 'Вовка попадает на «Прибыль» — 20 000 из банка.' },
        { seat: 1, action: { type: 'roll' }, rig: [0, 0], caption: 'Ленка встаёт на фабрику им. Володарского с филиалом — платит Вовке 1 500 (без филиала было бы 800). Дубль — ещё бросок.' },
      ]
    ),
  },
  {
    title: 'Менеджер: «Сюрприз», «Извещение», выигрыш и штраф',
    html: `<p>На клетке «Сюрприз» или «Извещение» берут верхнюю карточку колоды, выполняют и кладут вниз. Карточку «Вы освобождены от посещения биржи»
      оставляют себе до случая (её можно и продать). «Выигрыш», «Подарок» и «Прибыль» — получить 20 000, «Штраф» — заплатить 20 000.</p>
      <p>В колодах — все карточки распечатки с printgames.ru, как есть, с повторами.</p>`,
    demo: demo(
      M,
      (s) => {
        top(s, 0, 'Идите на старт');
        top(s, 1, 'Банковская ошибка. Получите');
      },
      [
        { seat: 0, action: { type: 'roll' }, rig: [1, 2], caption: 'Вовка на «Сюрпризе»: «Идите на старт» — и получает на «Старте» 2 000.' },
        { seat: 1, action: { type: 'roll' }, rig: [2, 4], caption: 'Ленка тянет «Извещение»: банковская ошибка в её пользу, +20 000.' },
      ]
    ),
  },
  {
    title: 'Менеджер: биржа',
    html: `<p>На биржу попадают с клетки «Маклер», по карточке и за три дубля подряд — фишку ставят прямо на «Биржу», «Старт» не платит.
      Остановиться на «Бирже» обычным ходом — простой визит.</p>
      <p>Выйти: выбросить дубль (за три хода), сдать карточку освобождения или заплатить <b>500</b> до броска. После третьей неудачной попытки 500 платят
      обязательно и идут на выпавшее. Сидя на бирже, можно получать плату за наём, строить, покупать и закладывать.</p>`,
    demo: demo(
      M,
      (s) => {
        s.pos[0] = 25;
      },
      [
        { seat: 0, action: { type: 'roll' }, rig: [1, 2], caption: 'Вовка попадает на «Маклер» — прямиком на биржу.' },
        { seat: 1, action: { type: 'roll' }, rig: [0, 1], caption: 'Ленка встаёт на «Выигрыш» — 20 000.' },
        { seat: 0, action: { type: 'payJail' }, caption: 'Вовка платит 500 и выходит с биржи…' },
        { seat: 0, action: { type: 'roll' }, rig: [3, 4], caption: '…и сразу ходит: театр им. Кирова.' },
      ]
    ),
  },
  {
    title: 'Менеджер: залог, долги и разорение',
    html: `<p>Не хватает денег — продайте постройки банку за полцены (равномерно, с самых застроенных) и заложите участки: банк даёт половину цены.
      Заложить можно только участок без построек в группе. Выкуп из залога — та же половина.</p>
      <p>Если и так не набрать — разорение: всё имущество уходит банку, банк сам выплачивает кредитору полную сумму, игрок выбывает.
      Побеждает последний оставшийся. Можно играть <b>на время</b> (20 или 40 кругов) — тогда побеждает самый богатый: деньги, участки и постройки по цене.</p>`,
    demo: demo(
      M,
      (s) => {
        for (const c of [1, 2, 4]) s.owner[c] = 0;
        for (const c of [6, 7, 9]) {
          s.owner[c] = 1;
          s.houses[c] = 1;
        }
        s.stock[0] -= 3;
        s.cash[0] = 1000;
      },
      [
        { seat: 0, action: { type: 'roll' }, rig: [2, 3], caption: 'Вовка встаёт на СКК им. Ленина с филиалом: 4 000 за наём, а у него 1 000.' },
        { seat: 0, action: { type: 'mortgage', cell: 4 }, caption: 'Закладывает «Большевичку» за 3 500 — долг уплачен.' },
      ]
    ),
  },
  {
    title: 'Менеджер: сделки',
    html: `<p>До броска можно меняться с другими игроками участками без построек, продавать их за деньги, продавать карточку освобождения с биржи —
      по цене, о которой договорились. Нажмите на участок соперника или кнопку «Сделка», соберите предложение — второй игрок соглашается или отказывается.
      Заложенные участки не продаются и не меняются.</p>`,
    demo: demo(
      M,
      (s) => {
        s.owner[1] = 0;
        s.owner[2] = 0;
        s.owner[4] = 1;
      },
      [
        { seat: 0, action: { type: 'offer', to: 1, give: [], get: [4], cash: 10000, cards: 0 }, caption: 'Вовке не хватает «Большевички» до полной группы — он предлагает Ленке 10 000.' },
        { seat: 1, action: { type: 'accept' }, caption: 'Ленка соглашается: группа у Вовки собрана, можно строить.' },
      ]
    ),
  },
];

const KOSMOS_RULES = [
  {
    title: 'Космос 2000: ход и планеты',
    html: `<p>От 2 до 4 игроков (можно и шестерым): вдвоём — по <b>3 000</b> дублонов, втроём и больше — по <b>2 500</b>. Один кубик; от «Старта» (правый нижний угол) влево к «Казино»
      и дальше по кругу, как в «Менеджере». Остановился на «Старте» — <b>250</b>. За проход «Старт» по правилам не платит (можно включить в настройках).</p>
      <p>Свободную планету покупают по цене в левом углу; рента — в правом нижнем. Не хочешь или не можешь — планету продают другим с торгов,
      а если никто не взял — она уходит банку: на клетку кладут жетон «Б».</p>`,
    demo: demo(K, () => {}, [
      { seat: 0, action: { type: 'roll' }, rig: [0], caption: 'Вовка выбрасывает 1 — Меркурий, 100 дублонов.' },
      { seat: 0, action: { type: 'buy' }, caption: 'Покупает и кладёт на планету свой жетон.' },
      { seat: 1, action: { type: 'roll' }, rig: [3], caption: 'Ленка долетает до Леи (150)…' },
      { seat: 1, action: { type: 'pass' }, caption: '…но покупать не хочет — Лея идёт с торгов другим игрокам.' },
      { seat: 0, action: { type: 'bid', amount: 120 }, caption: 'Вовка берёт её за 120.' },
    ]),
  },
  {
    title: 'Космос 2000: банк и жетоны «Б»',
    html: `<p>На планете с жетоном «Б» ренту платят в банк. Если есть деньги, банковскую планету можно выкупить — за цену плюс <b>100</b>.
      В трудную минуту свою планету можно продать банку по цене (кнопка на карточке планеты) — так же продаются планеты, когда нечем платить.</p>`,
    demo: demo(
      K,
      (s) => {
        s.owner[4] = -1;
      },
      [
        { seat: 0, action: { type: 'roll' }, rig: [3], caption: 'Лея принадлежит банку: Вовка платит ренту 30 в банк…' },
        { seat: 0, action: { type: 'buy' }, caption: '…и выкупает её за 150 + 100 = 250.' },
      ]
    ),
  },
  {
    title: 'Космос 2000: казино',
    html: `<p>В казино платят <b>50</b> за место и бросают кубик: сектор 1–6 на круге — плюс получают в банке, минус платят. Сектор со звёздочкой (2, 4, 6)
      даёт право бросить ещё раз — уже по секторам 7–12.</p>`,
    demo: demo(
      K,
      (s) => {
        s.pos[0] = 4;
      },
      [
        { seat: 0, action: { type: 'roll' }, rig: [2], caption: 'Вовка в казино: 50 за место.' },
        { seat: 0, action: { type: 'spin' }, rig: [1], caption: 'Сектор 2: −150, но со звёздочкой — можно бросить ещё.' },
        { seat: 0, action: { type: 'spin' }, rig: [2], caption: 'Сектор 9: +400!' },
      ]
    ),
  },
  {
    title: 'Космос 2000: страховка, чёрная дыра, пираты, полиция',
    html: `<p><b>Чёрная дыра</b> — заплатить 500. <b>Полиция</b> (и карточка «Астролога») — 250. <b>Пираты</b> отбирают все деньги — они ложатся на поле
      «Амазонки», и потом их можно получить по карточке «Астролога».</p>
      <p>В <b>Страховом агентстве</b> выбирают: страховка на всю сумму — 250, на половину — 100, или без неё. Действует до следующего агентства.
      Полная страховка — штраф и пираты не трогают, половинная — платите половину.</p>`,
    demo: demo(
      K,
      (s) => {
        s.pos[1] = 10;
        s.owner[16] = 1;
      },
      [
        { seat: 0, action: { type: 'roll' }, rig: [1], caption: 'Вовка в Страховом агентстве…' },
        { seat: 0, action: { type: 'insure', level: 2 }, caption: '…и страхуется на всю сумму за 250.' },
        { seat: 1, action: { type: 'roll' }, rig: [3], caption: 'Ленка без страховки попадает к пиратам — все деньги уходят Амазонкам.' },
        { seat: 0, action: { type: 'roll' }, rig: [5], caption: 'Вовку засасывает чёрная дыра — но он застрахован и не платит ничего.' },
      ]
    ),
  },
  {
    title: 'Космос 2000: Фортуна и Астролог',
    html: `<p>На клетках «Фортуна» и «Астролог» берут верхнюю карточку своей колоды, выполняют и кладут вниз: премии и расходы, переходы на ближайшую клетку,
      пропуск хода, ещё ход, «золото Амазонок».</p>`,
    demo: demo(
      K,
      (s) => {
        top(s, 0, 'У вас произошла встреча');
        top(s, 1, 'Все сокровища');
        s.pos[1] = 4;
        s.pot = 700;
      },
      [
        { seat: 0, action: { type: 'roll' }, rig: [2], caption: 'Фортуна: встреча с инопланетянами, +200.' },
        { seat: 1, action: { type: 'roll' }, rig: [5], caption: 'Астролог: все сокровища Амазонок — 700 дублонов — Ленкины!' },
      ]
    ),
  },
  {
    title: 'Космос 2000: банкротство и ссуда',
    html: `<p>Нет ни денег, ни планет — банкрот. Банк даёт ему ссуду <b>1 000</b> (в настройках можно выключить): фишка встаёт на «Старт», а за два круга надо вернуть
      <b>1 200</b>. Не вернул — выбывает. Ссуда — одна на игру. Побеждает последний, у кого остался капитал.</p>`,
    demo: demo(
      K,
      (s) => {
        s.pos[0] = 8;
        s.cash[0] = 300;
      },
      [{ seat: 0, action: { type: 'roll' }, rig: [5], caption: 'Пираты забирают у Вовки последние 300. Ни денег, ни планет — банк даёт ссуду 1 000, Вовка снова на «Старте».' }],
    ),
  },
];

function showcase(): State {
  const rng = { next: () => 0.5, int: (n: number) => n - 1, getState: () => 0 };
  const s = newState('manager', [0, 1, 2, 3], {}, rng);
  const own: [number, number[]][] = [
    [0, [1, 2, 4, 26, 39]],
    [1, [11, 12, 14, 21]],
    [2, [16, 17, 19, 31, 33]],
    [3, [6, 9, 23, 36, 38]],
  ];
  for (const [p, cs] of own) for (const c of cs) s.owner[c] = p;
  s.houses[1] = 2;
  s.houses[2] = 2;
  s.houses[4] = 3;
  s.houses[11] = 4;
  s.houses[12] = 3;
  s.houses[14] = 3;
  s.houses[16] = 1;
  s.houses[17] = 1;
  s.houses[19] = 1;
  s.mort[23] = true;
  s.pos = [7, 13, 30, 24, 0, 0];
  s.cash = [41500, 18000, 63000, 9500, 0, 0];
  s.turn = 1;
  s.dice = [4, 2];
  s.round = 9;
  return s;
}

export const def: GameDef<State, Action, Ev, State> = {
  id: 'manager',
  title: 'Менеджер',
  players: { min: 2, max: 6, default: 4 },
  seats: SEATS,
  options: [
    { key: 'map', label: 'Игра', type: 'select', choices: BOARDS.map((b) => ({ value: b.id, label: b.title })), default: 'manager' },
    {
      key: 'limit',
      label: 'Конец партии',
      type: 'select',
      choices: [
        { value: 0, label: 'до разорения всех, кроме одного' },
        { value: 20, label: 'через 20 кругов — у кого больше капитал' },
        { value: 40, label: 'через 40 кругов — у кого больше капитал' },
      ],
      default: 0,
    },
    { key: 'startPass', label: '250 и за проход через «Старт»', hint: 'по правилам — только за остановку', type: 'toggle', default: false, showIf: (o) => o.map === 'kosmos' },
    { key: 'loan', label: 'Ссуда банкроту', hint: '1 000, вернуть 1 200 за два круга', type: 'toggle', default: true, showIf: (o) => o.map === 'kosmos' },
  ],
  presets: [
    { id: 'manager', label: 'Менеджер', hint: 'Ленинград 90-х: филиалы, предприятия, биржа', options: { map: 'manager', limit: 0 } },
    { id: 'manager20', label: 'Менеджер на 20 кругов', hint: 'побеждает самый богатый', options: { map: 'manager', limit: 20 } },
    { id: 'kosmos', label: 'Космос 2000', hint: 'планеты, казино, пираты и Астролог', options: { map: 'kosmos', limit: 0 } },
  ],
  setup: (seats, opts, rng) => {
    const ids = seats.map((x) => x.seat).sort((a, b) => a - b);
    const map = opts.map === 'kosmos' ? 'kosmos' : 'manager';
    return newState(map, ids, { limit: Number(opts.limit) || 0, startPass: !!opts.startPass, loan: opts.loan !== false }, rng);
  },
  toAct,
  apply: (s, seat, a, rng) => {
    const r = apply(s, seat, a, rng);
    return r && { state: r.state, events: r.events.map((e) => ({ ...e, m: s.map })) };
  },
  view: (s) => view(s),
  result: (s) => s.result,
  showcase,
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, level, rng) => choose(v, seat, level, rng) },
  describe: (ev, name) => describe(ev, name),
  rules: {
    goal: 'Покупать участки (или планеты), собирать с соперников плату за наём и разорить всех — остаться единственным, у кого есть капитал.',
    sections: [...MANAGER_RULES, ...KOSMOS_RULES],
  },
};

const QUIET = new Set(['покупка', 'торги', 'филиал', 'предприятие', 'залог', 'выкуп из залога', 'выкуп планеты у банка', 'филиал продан банку', 'предприятие продано банку', 'сделка', 'страховка']);

function describe(ev: Ev, name: (seat: number) => string): string | null {
  const b = boardOf(ev.m ?? 'manager');
  const m = (n: number) => `${fmt(n)} ${b.cur}`;
  const cn = (c: number) => b.cells[c]?.full ?? b.cells[c]?.name ?? '';
  const who = (w: number | null | 'pot') => (w === 'pot' ? 'Амазонкам' : w == null ? 'банку' : name(w));
  switch (ev.type) {
    case 'roll':
      return `${name(ev.seat)} бросает: <b>${ev.dice.join(' + ')}</b>`;
    case 'pay':
      if (QUIET.has(ev.why)) return null; // покупку, постройку, залог описывает своё событие
      if (ev.from == null) return `${name(ev.to as number)} получает ${m(ev.amount)} — ${ev.why}`;
      if (ev.from === 'pot') return `${name(ev.to as number)} получает ${m(ev.amount)} из золота Амазонок`;
      return `${name(ev.from)} платит ${m(ev.amount)} ${who(ev.to)} — ${ev.why}`;
    case 'buy':
      return `${name(ev.seat)} покупает: ${cn(ev.cell)} за ${m(ev.price)}`;
    case 'decline':
      return `${name(ev.seat)} не покупает ${cn(ev.cell)} — торги`;
    case 'bid':
      return `${name(ev.seat)}: ${m(ev.amount)}`;
    case 'fold':
      return `${name(ev.seat)} выходит из торгов`;
    case 'won':
      return ev.seat == null ? `${cn(ev.cell)}: никто не купил${b.id === 'kosmos' ? ' — планета уходит банку' : ''}` : `${cn(ev.cell)} уходит с торгов: ${name(ev.seat)}, ${m(ev.price)}`;
    case 'build':
      return `${name(ev.seat)} строит ${ev.level === 4 ? 'предприятие' : 'филиал'}: ${cn(ev.cell)}`;
    case 'unbuild':
      return `${name(ev.seat)} продаёт банку постройку: ${cn(ev.cell)}`;
    case 'mortgage':
      return `${name(ev.seat)} ${ev.on ? 'закладывает' : 'выкупает из залога'}: ${cn(ev.cell)}`;
    case 'sellBank':
      return `${name(ev.seat)} продаёт банку ${cn(ev.cell)} за ${m(ev.price)}`;
    case 'card':
      return `${name(ev.seat)}, «${b.decks[ev.deck].name}»: <i>${b.decks[ev.deck].cards[ev.id].text}</i>`;
    case 'jail':
      return `${name(ev.seat)} — на бирже`;
    case 'free':
      return `${name(ev.seat)} выходит с биржи${ev.how === 'double' ? ' — дубль' : ev.how === 'card' ? ' по карточке' : ev.how === 'pay' ? ' за 500' : ' — три хода прошли, 500 в банк'}`;
    case 'stay':
      return `${name(ev.seat)} не выбросил дубль — остаётся на бирже`;
    case 'offer': {
      const o = ev.offer;
      return `${name(o.from)} предлагает сделку ${name(o.to)}`;
    }
    case 'deal':
      return ev.ok ? `🤝 ${name(ev.to)} соглашается на сделку` : `${name(ev.to)} отказывается от сделки`;
    case 'debt':
      return `${name(ev.seat)}: не хватает денег, надо заплатить ${m(ev.amount)}`;
    case 'bankrupt':
      return `💸 ${name(ev.seat)} разоряется и выходит из игры`;
    case 'loan':
      return `${name(ev.seat)} — банкрот. Ссуда 1 000, вернуть 1 200 за два круга`;
    case 'repay':
      return `${name(ev.seat)} вернул ссуду`;
    case 'insure':
      return `${name(ev.seat)}: ${ev.level === 2 ? 'страховка на всю сумму' : ev.level === 1 ? 'страховка наполовину' : 'без страховки'}${ev.free ? ' — бесплатно' : ''}`;
    case 'casino':
      return `${name(ev.seat)} в казино: сектор ${ev.sector}, ${ev.amount > 0 ? '+' : '−'}${m(Math.abs(ev.amount))}${ev.star ? ' ★ — ещё бросок' : ''}`;
    case 'visit': {
      const k = b.cells[ev.cell]?.kind;
      return k === 'hole' || k === 'police' || k === 'pirates' ? `${name(ev.seat)} застрахован: «${b.cells[ev.cell].name}» — без потерь` : null;
    }
    case 'skip':
      return `${name(ev.seat)} пропускает ход`;
    case 'again':
      return `${name(ev.seat)} ходит ещё раз`;
    case 'end':
      return `🏆 ${ev.winners.map(name).join(', ')} — ${ev.text}`;
  }
  return null;
}
