/* «Коммерсы» — путь от ларька на Затулинке (май 1988) до покупки лондонского клуба (июль 2003).
 * Механика жанра Timeflow / «Денежный поток»: дорога из клеток, деньги и часы, сделки, события эпохи. Дизайн — docs/kommersy/DESIGN.md. */
import type { DemoScript, GameDef, GameResult, Rng, SeatSpec } from '../../core/types';
import { SEATS as HSEATS } from '../hodilki/core';
import { choose } from './bot';
import { CELL_NAME, CLUB, CLUB_PRICE, ENDINGS, HEROES, TIERS, mm, type Cell } from './data';
import { legacyStore, s2Access, season } from './season';
import { parseLegacy } from './legacy';
import { ENDINGS2, START_2009, START_2017, TYNDEX } from './s2data';
import { apply, marketWorth, money, newState, toAct, view, type Action, type Event, type State, type View } from './engine';

const COLOR: Record<string, string> = { kolyan: '#5a5a5a', seryoga: '#2a9a3a', vovka: '#d8241c', lenka: '#2060d0', svetka: '#e85a9a', dimon: '#8a3ac8', tanka: '#e8b020', zheka: '#1a9a9a', mihalych: '#6a4a2a' };
export const SEATS = HEROES.slice(0, 6).map((h) => {
  const look = HSEATS.find((x) => x.color === COLOR[h.id]) ?? HSEATS[0];
  return { ...look, name: h.name };
});

const num = (v: unknown, d: number, a: number, b: number) => {
  const x = Number(v ?? d);
  return Number.isFinite(x) ? Math.max(a, Math.min(b, Math.round(x))) : d;
};
const opts = (o: Record<string, unknown>) => ({
  diff: num(o.diff, 1, 0, 2),
  start: num(o.start, 0, 0, mm(2003, 6)),
  chance: num(o.chance, 0, 0, 3),
  buh: o.buh === true || o.buh === 1 || o.buh === 'true',
  season: num(o.season, 1, 1, 2),
  // наследие первого сезона — только во втором и только с 2004-го (newState сам отбросит в сети)
  ...(num(o.season, 1, 1, 2) === 2 && num(o.start, 0, 0, mm(2003, 6)) === 0 && parseLegacy(o.legacy) ? { legacy: parseLegacy(o.legacy)! } : {}),
});
/** Второй сезон — платное дополнение (право kommersy_s2): тот же разбор, что у партии, — подменой опций не обойти. */
export const isSeason2 = (o: Record<string, unknown>) => opts(o).season === 2;
export const S2_RIGHT = 'kommersy_s2';

// ---------------------------------------------------------------- показ правил
const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
function demo(patch: (s: State) => void, steps: DemoScript<State, Action>['steps']): DemoScript<State, Action> {
  return {
    seats: demoSeats,
    setup: () => {
      const s = newState([0, 1]);
      patch(s);
      return s;
    },
    steps,
  };
}
/** Бросок и перестановка фишки — два шага: фишку ставит сам игрок. */
const roll = (seat: number, d: number, caption: string, more: number[] = []) => [
  { seat, action: { type: 'roll' } as Action, rig: [d - 1], caption: `Выпало ${d}…` },
  { seat, action: { type: 'move' } as Action, rig: more, caption },
];
const pick = (seat: number, i: number, caption: string, rig?: number[]) => ({ seat, action: { type: 'choose', i } as Action, caption, ...(rig ? { rig } : {}) });

const RULES = [
  {
    title: 'Дорога и ход',
    html: `<p>Дорога — это время: отрезок из десяти клеток и <b>«Новый квартал»</b> (в кризисные месяцы — «новый месяц»). Бросил кубик — фишка
      подсвечивает клетку, игрок ставит её сам. Дальше конца отрезка не уйти: дошедший ждёт остальных, а лишние очки кубика не пропадают —
      первым ходом нового отрезка фишка досходит их без броска. Когда дошли все — квартал кончается:
      доходы, расходы, рост цен, исторические события, и начинается новый отрезок.</p>
      <p>Клетки: <b>Сделка</b> — купить дело, <b>Рутина</b> — траты, <b>Учёба</b> — навыки, <b>Выходной</b> — отдых, близкие, знакомства и мечты,
      <b>Новости</b> — слухи, решения по бизнесу, удачи и беды, <b>Событие</b> — семья и форс-мажор, <b>Наезд</b> — братва и конкуренты,
      <b>Проверка</b> — налоговая, ОБЭП, СЭС.</p>`,
    demo: demo(() => {}, [
      ...roll(0, 1, 'Колян встаёт на «Сделку»: перепродажа дефицита — сапоги от знакомой из универмага.', [0, 15, 15]),
      pick(0, 0, 'Колян берёт дело и ведёт сам: 30 часов в месяц из 220.'),
      ...roll(1, 3, 'Серёга — на «Новостях».', [0]),
    ]),
  },
  {
    title: 'Деньги и часы',
    html: `<p>Две валюты: <b>деньги</b> (доллары — рубли тают) и <b>часы</b> — 220 в месяц. Работа и каждое дело едят часы. Не хватает часов — дело не взять;
      перегрузился — болеешь, злишься, своё дело без присмотра теряет доход. <b>Управляющий</b> освобождает часы, но берёт долю.
      Водитель, пейджер, мобильник и навык «Порядок» добавляют часов.</p>
      <p>Каждая ниша <b>стареет</b>: варёнки хороши в 1989-м, ларьки — в 1993-м, банки — до августа 1998-го. Стоять на месте — медленно беднеть,
      поэтому дела растут и продаются, когда пришло время. Дело каждого вида можно иметь только одно; недвижимость и бумаги — сколько угодно. Расти может не всякое дело: ларёк — в сеть ларьков, видеосалон — в прокат, челнок — в контейнеры;
      что во что растёт, написано у дела в списке. Когда новая ступень уже появилась, у дела загорается кнопка ⬆: своё дело идёт в зачёт,
      доплата — 80 % разницы цен. Во что растёт дело, видно уже в предложении на «Сделке». Из чего вырос, и всё, что ниже уже имеющегося дела, больше не предлагают. Ниша после пика не пропадает из «Дел», но там видно, что она стареет и сколько от прежнего дохода осталось. Карточка «Расширяться?» на «Новостях» — удачный случай: доплата всего 60 %. Доход в «Делах» — настоящий, за месяц:
      с долей управляющего, старением ниши и кризисом. Тёмные дела (🩸) отмечены ещё в предложении: внимание органов от них растёт каждый месяц.
      Не хватило денег — банк даёт кредит сам, если есть <b>Имя</b>.</p>`,
  },
  {
    title: 'Колян: параметры и тёмные дела',
    html: `<p>У Коляна не одно число: <b>Здоровье</b>, <b>Настроение</b> и <b>Стресс</b>, <b>Имя</b> (деловая репутация: кредиты, партнёры, Лондон),
      <b>Авторитет</b> (по понятиям), <b>Связи</b> (наверху: без бани, охоты и звонков забываются, а при смене власти часть сгорает), <b>Близкие</b> — и скрытые <b>Совесть</b> и <b>Внимание органов</b> (видны только намёком).</p>
      <p>Тёмные поступки отмечены красным и бьют каждый по своему: кинул партнёра — Имя и Совесть, взятка — Связи, но и внимание органов,
      палёнка — Совесть и проверки. Заказать конкурента можно — цена огромная.</p>`,
    demo: demo(
      (s) => {
        s.cells[0] = 'naezd';
      },
      [...roll(0, 1, 'Наезд: к точке подъехала «девятка» с тонировкой.', [0]), pick(0, 1, 'Колян встаёт под братву: наезды реже, но крыша берёт долю, а органы присматриваются.')]
    ),
  },
  {
    title: 'Падал, но поднимался',
    html: `<p>Убить Коляна нельзя. Но есть <b>разорение</b> (долги больше имущества: распродажа — дела за полцены, недвижимость за три четверти),
      <b>тюрьма</b> (внимание органов на пределе — от трёх месяцев до двух лет вне дороги), <b>покушение</b> (больница), <b>запой</b> (настроение на дне — квартал вылетает).
      После падения игра продолжается — с потерями. Главная плата — время.</p>`,
  },
  {
    title: 'Торги, соперники и «Бухгалтерия»',
    html: `<p>Когда коммерсов несколько, сделку, которая не по карману (или по часам), можно <b>выставить на торги</b>: право на неё по очереди
      предлагается остальным, и купивший платит продавцу наценку — десятую часть цены. Не взял никто — сделка уходит.</p>
      <p><b>Соперники.</b> Раз за отрезок, на своём ходу до броска, можно пойти против другого коммерса: <b>сбить цены</b> в общей нише (его доход
      с неё падает сильнее вашего), <b>переманить управляющего</b> (его дело снова ест его часы), <b>наехать через братву</b> (нужна бандитская крыша;
      соперник без крыши почти наверняка платит, но вы наживаете врага и внимание органов) или <b>донести</b> (органы займутся им, а совесть и имя — вами;
      стукача иногда вычисляют).</p>
      <p>С правилом <b>«Бухгалтерия»</b> в конце каждого отрезка баланс сводит сам игрок: доходы и расходы за месяц, умножить на число месяцев.
      Сошлось (с точностью до 5 %) — внимание органов падает, а каждая четвёртая чистая разноска прибавляет навык «Счёт». Не сошлось — налоговая заметила несостыковки.</p>`,
    demo: demo(
      (s) => {
        s.opts.buh = true;
        s.players[0].pos = 10;
        s.players[1].pos = 11;
      },
      [
        ...roll(0, 1, 'Колян дошёл до конца квартала — пора сводить баланс.'),
        { seat: 0, action: { type: 'buh', sum: -51 * 3 } as Action, caption: 'Колян: зарплата грузчика $55, жизнь −$32 — итого +$23 в месяц… а записал −$153. Не сошлось.' },
        { seat: 1, action: { type: 'buh', sum: 69 } as Action, caption: 'Серёга считает верно: +$23 × 3 месяца = +$69. Начинается новый квартал.' },
      ]
    ),
  },
  {
    title: 'Эпоха',
    html: `<p>Исторические даты стоят на своих местах: павловская реформа (январь 1991), отпуск цен (январь 1992), свобода торговли, ваучеры, МММ,
      «Чёрный вторник» (октябрь 1994), выборы 1996-го, дефолт (август 1998), равноудалённость (2000), плоская шкала (2001).
      Кто услышал слух на «Новостях» и подготовился — сохранит деньги. В кризисные годы дорога идёт помесячно.</p>`,
  },
  {
    title: 'Цель: «Лондон Юнайтед»',
    html: `<p>Купить лондонский клуб за <b>${money(CLUB_PRICE)}</b> до конца июля 2003-го. Условий несколько: деньги наличными, <b>Имя</b> (лондонские юристы проверяют, с кем имеют дело),
      <b>английский</b> или советник, <b>связи в Москве</b> или свой человек там (дорогой, на содержании), <b>чистый хвост</b> (внимание органов низкое, не под следствием) и <b>свободные часы</b> — бизнес должен работать без тебя.
      Покупка — на «Выходном» или в конце квартала, когда всё готово. Не успел — финал по итогу: «Король Затулинки», «Олигарх без клуба», «Олигарх без души» или «Честный, но небогатый».
      «Второй шанс» — начать заново с опытом прошлой попытки.</p>`,
  },
];

function showcase(): State {
  const s = newState([0, 1, 2]);
  s.m = mm(1993, 6);
  const k = s.players[0];
  k.cash = 21400;
  k.job = null;
  k.krysha = 'bandit';
  k.stats.avt = 38;
  k.stats.name = 31;
  k.skills.trade = 2;
  k.assets = [
    { uid: 1, id: 'larek', name: 'Ларёк у остановки', kind: 'biz', value: 3200, income: 950, hours: 60, manager: true, mul: 1 },
    { uid: 2, id: 'yaponki', name: 'Перегон японок', kind: 'biz', value: 6100, income: 1800, hours: 70, manager: false, mul: 1 },
  ];
  s.players[1].cash = 8800;
  s.players[2].cash = 46000;
  s.players[0].pos = 3;
  s.players[1].pos = 5;
  s.players[2].pos = 2;
  s.cells = ['deal', 'routine', 'naezd', 'news', 'deal', 'study', 'rest', 'deal', 'check', 'news', 'period'];
  s.uid = 3;
  return s;
}

function result(s: State): GameResult | null {
  if (s.phase !== 'over') return null;
  const scores: Record<number, number> = {};
  const worth = (p: State['players'][number]) => marketWorth(s, p);
  for (const p of s.players) scores[p.seat] = Math.round(worth(p));
  if (s.opts.season === 2) {
    // второй сезон: побеждает выживший владелец «Тындекса»; нет такого — самый богатый из выживших
    const name = (p: State['players'][number]) => ENDINGS2[p.ending as keyof typeof ENDINGS2] ?? '';
    const win = s.players.filter((p) => p.ending === 'tyndex' || p.ending === 'island');
    if (win.length) return { winners: win.map((p) => p.seat), text: `купил ${TYNDEX}: ${name(win[0])}`, scores };
    if (s.players.length === 1) return { winners: [], text: name(s.players[0]), scores };
    const alive = s.players.filter((p) => p.ending !== 'dead');
    const best = Math.max(0, ...alive.map((p) => worth(p)));
    return { winners: alive.filter((p) => worth(p) === best).map((p) => p.seat), text: `${TYNDEX} никто не купил — богаче всех из выживших`, scores };
  }
  const club = s.players.filter((p) => p.club);
  if (club.length) return { winners: club.map((p) => p.seat), text: `купил «${CLUB}»`, scores };
  if (s.players.length === 1) return { winners: [], text: `не успел: ${ENDINGS[s.players[0].ending as keyof typeof ENDINGS] ?? ''}`, scores };
  const best = Math.max(...s.players.map((p) => worth(p)));
  return { winners: s.players.filter((p) => worth(p) === best).map((p) => p.seat), text: 'клуб никто не купил — богаче всех к июлю 2003-го', scores };
}

const PRESETS1 = [
  { id: 'full', label: 'С 1988', hint: 'весь путь: 15 лет, от дембеля до Лондона', options: { season: 1, start: 0, diff: 1, chance: 0 } },
  { id: 'y1992', label: 'С 1992', hint: 'свобода торговли, денег на старте больше', options: { season: 1, start: mm(1992, 2), diff: 1, chance: 0 } },
  { id: 'y1998', label: 'С 1998', hint: 'после дефолта: короткая партия на час', options: { season: 1, start: mm(1998, 9), diff: 1, chance: 0 } },
  { id: 'chance', label: 'Второй шанс', hint: 'с 1988, но с опытом прошлой попытки', options: { season: 1, start: 0, diff: 1, chance: 1 } },
];
export const PRESETS2 = [
  { id: 's2-2004', label: 'Сезон 2: с 2004', hint: 'весь путь: клуб в Лондоне, крах, «Цифра», ковид — одиночная', options: { season: 2, start: 0, diff: 1, chance: 0, buh: false } },
  { id: 's2-2009', label: 'Сезон 2: с 2009', hint: 'только «Цифра»: миллион в Академгородке; сеть — гонка за «Тындексом»', options: { season: 2, start: START_2009, diff: 1, chance: 0, buh: false } },
  { id: 's2-2017', label: 'Сезон 2: с 2017', hint: 'короткая партия на час: крипта, ковид, финал', options: { season: 2, start: START_2017, diff: 1, chance: 0, buh: false } },
];

export const def: GameDef<State, Action, Event, View> = {
  id: 'kommersy',
  title: 'Коммерсы',
  players: { min: 1, max: 6, default: 1 },
  seats: SEATS,
  options: [
    {
      key: 'season',
      label: 'Сезон',
      hint: 'второй сезон — 2004–2021: клуб, крах, «Цифра»; дополнение за 300 ₽',
      type: 'select',
      choices: [
        { value: 1, label: 'Сезон 1 (1988–2003)' },
        {
          value: 2,
          get label() {
            return s2Access.check() ? 'Сезон 2 (2004–2021)' : '🔒 Сезон 2 (2004–2021) — 300 ₽';
          },
        },
      ],
      default: 1,
    },
    {
      key: 'heir',
      label: 'Колян',
      hint: 'свой — из финала первого сезона: Имя, Авторитет, Связи, навыки, падения, свои дела',
      type: 'select',
      choices: [
        { value: 1, label: 'мой, из сезона 1' },
        { value: 0, label: 'канонический' },
      ],
      default: 1,
      showIf: (o) => o.season === 2 && Number(o.start) === 0 && !!legacyStore.get(),
    },
    {
      key: 'start',
      label: 'Начало',
      type: 'select',
      choices: [
        { value: 0, label: 'май 1988 — закон о кооперации', showIf: (o) => o.season !== 2 },
        { value: mm(1992, 2), label: 'февраль 1992 — свобода торговли', showIf: (o) => o.season !== 2 },
        { value: mm(1998, 9), label: 'сентябрь 1998 — после дефолта', showIf: (o) => o.season !== 2 },
        { value: 0, label: 'январь 2004 — хозяин клуба (одиночная)', showIf: (o) => o.season === 2 },
        { value: START_2009, label: 'январь 2009 — «Цифра», с миллионом', showIf: (o) => o.season === 2 },
        { value: START_2017, label: 'январь 2017 — крипта, ковид, финал', showIf: (o) => o.season === 2 },
      ],
      default: 0,
    },
    {
      key: 'diff',
      label: 'Лондонские юристы',
      hint: 'насколько строги условия покупки клуба',
      type: 'select',
      choices: [
        { value: 0, label: 'сговорчивые' },
        { value: 1, label: 'обычные' },
        { value: 2, label: 'дотошные' },
      ],
      default: 1,
    },
    { key: 'buh', label: 'Бухгалтерия', showIf: (o) => o.season !== 2, hint: 'в конце квартала баланс сводишь сам: сошлось — органы спокойнее и растёт «Счёт»', type: 'toggle', default: false },
    { key: 'chance', label: 'Второй шанс', hint: 'опыт прошлой попытки: навыки, деньги, память о датах', type: 'number', min: 0, max: 3, step: 1, default: 0, showIf: (o) => o.season !== 2 },
  ],
  // второй сезон — платное дополнение: пресеты видны всем, запуск без права открывает окно покупки (index.ts → prepare)
  presets: [...PRESETS1, ...PRESETS2],
  needRight: (o) => (isSeason2(o) ? S2_RIGHT : null),
  setup: (seats: SeatSpec[], o, rng: Rng) => {
    const ids = seats.map((x) => x.seat).sort((a, b) => a - b);
    return newState(ids, opts(o), ids.map((i) => HEROES[i]?.id), rng);
  },
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => view(s, seats),
  result,
  showcase,
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, level, rng) => choose(v, seat, level, rng) },
  describe: (ev, name) => describe(ev, name),
  // совесть и органы в итоге выбора — только самому игроку
  redact: (ev, seats) => {
    if (seats === 'all') return ev;
    if (ev.t === 'fx' && ev.secret && !seats.includes(ev.seat)) return { ...ev, secret: undefined };
    // анонимку не подписывают: кто донёс, знает только он сам (если не вычислили)
    if (ev.t === 'rival' && ev.kind === 'donos' && ev.ok && !seats.includes(ev.seat)) return { ...ev, seat: -1 };
    return ev;
  },
  rules: {
    goal: `Пройти путь от ларька на Затулинке (май 1988) до покупки лондонского клуба «${CLUB}» (июль 2003): сделки, крыша и чиновники, учёба и близкие — и не потерять себя.`,
    sections: RULES,
  },
};

const FALL = { razor: 'разорился', jail: 'сел', pokushenie: 'пережил покушение', zapoi: 'ушёл в запой', infarkt: 'пережил инфаркт' };
const OUT = { jail: 'в тюрьме', hosp: 'в больнице', away: 'уехал' };

export function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.t) {
    case 'roll':
      return `${name(ev.seat)} бросает: <b>${ev.d}</b>`;
    case 'move':
      return ev.cell === 'period' ? `${name(ev.seat)} дошёл до конца квартала` : `${name(ev.seat)} — <b>${CELL_NAME[ev.cell as Cell]}</b>`;
    case 'pick':
      return `${ev.dark ? '🩸 ' : ''}${name(ev.seat)} — «${ev.title}»: ${ev.label}`;
    case 'risk':
      return `⚠ ${name(ev.seat)}: <i>${ev.text}</i>`;
    case 'fx': {
      const all = [...ev.lines, ...(ev.secret ?? [])];
      return `↳ ${name(ev.seat)}: ${all.length ? all.join(' · ') : 'без последствий'}`;
    }
    case 'buy':
      return `💼 ${name(ev.seat)}: «${ev.name}» за ${money(ev.sum)}`;
    case 'grow':
      return `⬆ ${name(ev.seat)}: «${ev.from}» вырос в «${ev.name}», доплата ${money(ev.sum)}`;
    case 'carry':
      return `↪ ${name(ev.seat)} досходит остаток хода: <b>${ev.d}</b>`;
    case 'sell':
      return `💵 ${name(ev.seat)} продаёт «${ev.name}» за ${money(ev.sum)}`;
    case 'period':
      return `📅 <b>${season(ev.season).dateText(ev.m)}</b>`;
    case 'hist':
      return `📰 <b>${ev.title}.</b> <i>${ev.text}</i>`;
    case 'fall':
      return `⬇ ${name(ev.seat)} ${FALL[ev.kind]}. Падал, но поднимался.`;
    case 'out':
      return `${name(ev.seat)} ${OUT[ev.kind]}: ${ev.months} мес.`;
    case 'auction':
      return `🔨 ${name(ev.seat)} выставляет на торги «${ev.name}» (наценка ${money(ev.fee)})`;
    case 'resold':
      return `🤝 ${name(ev.seat)} покупает у ${name(ev.from)} право на «${ev.name}» за ${money(ev.fee)}`;
    case 'unsold':
      return `«${ev.name}» никто не взял`;
    case 'rival':
      return {
        demping: `📉 ${name(ev.seat)} сбивает цены — у ${name(ev.target)} падает выручка`,
        peremanit: `👔 ${name(ev.seat)} переманивает управляющего у ${name(ev.target)}`,
        naezd: ev.ok ? `🩸 ${name(ev.seat)} наезжает на ${name(ev.target)} через братву — пришлось платить` : `🩸 ${name(ev.seat)} наезжает на ${name(ev.target)}, но тот отбился`,
        donos: ev.ok ? `🩸 На ${name(ev.target)} пришла анонимка` : `🩸 ${name(ev.seat)} донёс на ${name(ev.target)} — и все узнали, кто стукач`,
      }[ev.kind];
    case 'buh':
      return ev.ok ? `📒 ${name(ev.seat)}: баланс сошёлся, ${money(ev.sum)}` : `📒 ${name(ev.seat)}: записал ${money(ev.ans)}, а вышло ${money(ev.sum)} — налоговая заметила`;
    case 'club':
      return ev.name ? `🏆 ${name(ev.seat)} покупает ${ev.name}!` : `🏆 ${name(ev.seat)} покупает «${CLUB}»!`;
    case 'tour':
      return ev.final ? `⚽ Итоги сезона: ${ev.place}-е место${ev.trophies?.length ? ` · 🏆 ${ev.trophies.join(', ')}` : ''}` : `⚽ Итоги тура: ${ev.place}-е место`;
    case 'match':
      return `⚽ ${ev.title}: ${ev.win ? 'победа' : 'поражение'}, ${ev.score}`;
    case 'venture':
      return ev.stage >= 4 && ev.ok ? `🚀 ${name(ev.seat)}: стартап «${ev.name}» вышел — ${money(ev.sum ?? 0)}` : !ev.ok ? `💨 ${name(ev.seat)}: стартап «${ev.name}» закрылся` : ev.stage === 0 ? `🌱 ${name(ev.seat)} берёт долю в стартапе «${ev.name}» за ${money(ev.sum ?? 0)}` : `📈 ${name(ev.seat)}: «${ev.name}» — следующий раунд`;
    case 'btc':
      return `₿ ${name(ev.seat)} ${ev.buy ? 'покупает' : 'продаёт'} биткоины на ${money(ev.sum)} (по $${ev.price})`;
    case 'health':
      return ev.ok ? `❤ ${name(ev.seat)} выкарабкался: здоровье ${ev.health}` : `🕯 ${name(ev.seat)} не выкарабкался`;
    case 'over':
      return ev.season === 2 ? '🏁 Декабрь 2021-го.' : '🏁 Июль 2003-го.';

  }
  return null;
}

export { TIERS };
