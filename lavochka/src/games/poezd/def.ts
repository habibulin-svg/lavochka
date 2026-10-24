/* «Поездом по СССР» — описание игры. Железные дороги СССР: собрать вагоны нужных цветов, проложить пути между городами
 * и соединить города из своих карт маршрутов. Поле, карты и правила — фанатский набор 2011 года (карта СССР к Ticket to Ride,
 * printgames.ru); материалы Days of Wonder не используются. */
import type { DemoScript, GameDef, Rng, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { CITIES, ROUTES } from './board';
import { BONUS, CARD_ONE, CARD_PL, COLORS, CTRL, LOCO, STATION_POINTS, TICKETS } from './data';
import { apply, cfgFrom, newState, redact, syncCounts, toAct, view, type Action, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Вовка', color: '#c81e1e', light: '#ff6a5a', dark: '#6a0c0c' },
  { name: 'Ленка', color: '#1d5fd0', light: '#6a9aff', dark: '#0c2f70' },
  { name: 'Серёга', color: '#2a9a3a', light: '#6ad07a', dark: '#145a20' },
  { name: 'Танька', color: '#e8b020', light: '#ffd870', dark: '#8a6408', ink: '#8a6408' },
  { name: 'Колян', color: '#3a3a3a', light: '#8a8a8a', dark: '#111111' },
];

const city = (n: string) => CITIES.findIndex((c) => c.name === n);
const route = (a: string, b: string, color?: string) =>
  ROUTES.findIndex((r) => ((r.a === city(a) && r.b === city(b)) || (r.a === city(b) && r.b === city(a))) && (!color || r.color === color));
const ticket = (a: string, b: string) => TICKETS.findIndex((t) => (t.a === city(a) && t.b === city(b)) || (t.a === city(b) && t.b === city(a)));

const cardsText = (cards: number[]) => {
  const by = new Map<number, number>();
  for (const c of cards) by.set(c, (by.get(c) ?? 0) + 1);
  return [...by].map(([c, n]) => (n === 1 ? CARD_ONE[c] : `${n} ${CARD_PL[c]}`)).join(' + ');
};
const routeName = (r: number) => `${CITIES[ROUTES[r].a].name} — ${CITIES[ROUTES[r].b].name}`;

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'claim':
      return `${name(ev.seat)}: путь <b>${routeName(ev.route)}</b> (${ROUTES[ev.route].len} ваг.) — ${ev.ctrl ? 'по карте контролёра' : cardsText(ev.cards)}, +${ev.pts}`;
    case 'reveal':
      return `Тоннель ${routeName(ev.route)}: открыты ${cardsText(ev.cards) || 'ничего'} — ${ev.extra ? `доплатить ${ev.extra}` : 'доплаты нет'}`;
    case 'tunnelEnd':
      return ev.ok ? (ev.extra.length ? `${name(ev.seat)} доплачивает: ${cardsText(ev.extra)}` : null) : `${name(ev.seat)} отказывается от тоннеля — карты назад в руку`;
    case 'remove':
      return `${name(ev.seat)} — контролёр: путь ${routeName(ev.route)} игрока ${name(ev.owner)} разобран (−${ev.pts})`;
    case 'station':
      return `${name(ev.seat)} ставит станцию: <b>${CITIES[ev.city].name}</b> (${cardsText(ev.cards)})`;
    case 'take':
      return `${name(ev.seat)} берёт карты маршрутов (${ev.n})`;
    case 'keep':
      return `${name(ev.seat)} оставляет маршрутов: ${ev.n}${ev.back ? `, ${ev.back} — в коробку` : ''}`;
    case 'draw':
      return ev.slot === -1 ? `${name(ev.seat)} берёт карту из колоды${ev.card >= 0 ? ` (${CARD_ONE[ev.card]})` : ''}` : `${name(ev.seat)} берёт открытую карту: ${CARD_ONE[ev.card]}`;
    case 'flush':
      return ev.why === 'ctrl' ? 'В открытых картах — контролёр: все пять в сброс' : 'Три локомотива в открытых картах — все пять в сброс';
    case 'shuffle':
      return 'Колода кончилась — сброс перетасован';
    case 'final':
      return `🚩 У игрока ${name(ev.seat)} осталось два вагончика или меньше — последний круг!`;
    case 'pass':
      return `${name(ev.seat)}: ходить нечем — пропуск`;
    case 'end': {
      const w = ev.winners.map(name).join(', ');
      return `🏁 Победа: ${w} — ${ev.rows[ev.winners[0]].total} очков`;
    }
  }
  return null;
}

// ---------- показ правил ----------

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));

function hand(spec: Partial<Record<string, number>>): number[] {
  const h = new Array(10).fill(0);
  for (const [k, n] of Object.entries(spec)) h[k === 'loco' ? LOCO : k === 'ctrl' ? CTRL : COLORS.indexOf(k as (typeof COLORS)[number])] = n!;
  return h;
}

function demo(patch: (s: State) => void, steps: DemoScript<State, Action>['steps'], intro?: string, options: Record<string, unknown> = {}): DemoScript<State, Action> {
  return {
    seats: demoSeats,
    options: options as never,
    intro,
    setup: (_d, rng: Rng) => {
      const s = newState(2, cfgFrom(options), rng);
      s.phase = 'act';
      s.offer = [null, null];
      s.tickets = [[ticket('Москва', 'Магадан'), ticket('Москва', 'Одесса')], [ticket('Рига', 'Мирный'), ticket('Москва', 'Рига')]];
      s.hand = [hand({ red: 2, blue: 1, purple: 2, loco: 1 }), hand({ green: 3, yellow: 1 })];
      patch(s);
      syncCounts(s);
      return s;
    },
    steps,
  };
}
const A = (seat: number, action: Action, caption?: string) => ({ seat, action, caption });

const RULES = [
  {
    title: 'Подготовка',
    html: `<p>У каждого — <b>45 вагончиков</b> своего цвета, <b>3 станции</b> и фишка на счётчике очков по краю поля. Каждому сдают <b>4 карты вагонов</b>,
      рядом выкладывают <b>5 открытых</b>, остальные — колодой.</p>
      <p>Каждый получает <b>2 длинных и 2 коротких</b> карты маршрутов и оставляет себе хотя бы один длинный и один короткий (можно и все).
      Отказанные уходят в коробку. Свои маршруты другие игроки не видят.</p>`,
    demo: {
      seats: demoSeats,
      intro: 'Каждому — по два длинных и по два коротких маршрута.',
      setup: (_d: unknown, rng: Rng) => {
        const s = newState(2, cfgFrom({}), rng);
        s.offer = [
          [ticket('Москва', 'Магадан'), ticket('Тында', 'Ашхабад'), ticket('Москва', 'Одесса'), ticket('Анадырь', 'Норильск')],
          [ticket('Рига', 'Мирный'), ticket('Воркута', 'Владивосток'), ticket('Москва', 'Рига'), ticket('Баку', 'Фрунзе')],
        ];
        syncCounts(s);
        return s;
      },
      steps: [
        A(0, { type: 'keep', keep: [ticket('Москва', 'Магадан'), ticket('Москва', 'Одесса')] }, 'Вовка оставляет «Москва — Магадан» и «Москва — Одесса»: из Москвы удобно идти в обе стороны.'),
        A(1, { type: 'keep', keep: [ticket('Рига', 'Мирный'), ticket('Москва', 'Рига'), ticket('Баку', 'Фрунзе')] }, 'Ленка рискует и оставляет три.'),
      ],
    } as DemoScript<State, Action>,
  },
  {
    title: 'Карты вагонов',
    html: `<p>За ход делают <b>одно</b> из действий: берут карты вагонов, прокладывают путь, берут новые маршруты, ставят станцию или играют контролёра.</p>
      <p>Карт вагонов берут <b>две</b> — из открытых или вслепую из колоды, в любом порядке. Взятую открытую сразу заменяют картой из колоды.
      <b>Локомотив</b> — джокер, годится вместо любого цвета. Открытый локомотив берут <b>только один вместо двух</b> карт, и вторым его брать нельзя.</p>
      <p>Если в открытых оказались <b>три локомотива</b> — все пять карт уходят в сброс и выкладывают новые. Кончилась колода — перетасовывают сброс.</p>`,
    demo: demo(
      (s) => {
        s.open = [0, LOCO, 4, 5, 2];
        s.deck.push(3, 1, 7);
      },
      [
        A(0, { type: 'draw', slot: 0 }, 'Вовка берёт открытую красную…'),
        A(0, { type: 'draw', slot: -1 }, '…и вторую — вслепую из колоды.'),
        A(1, { type: 'draw', slot: 1 }, 'Ленка берёт открытый локомотив — и это весь её ход.'),
      ]
    ),
  },
  {
    title: 'Как проложить путь',
    html: `<p>Путь между двумя <b>соседними</b> городами прокладывают за один ход целиком: сбрасывают столько карт, сколько на нём вагончиков,
      и того же цвета. <b>Серый</b> путь строят картами любого <b>одного</b> цвета. Локомотивы добавляют к любым.</p>
      <p>На путь ставят свои вагончики и сразу получают очки: 1 вагон — 1, 2 — 2, 3 — 4, 4 — 7, 5 — 10, 6 — 15, 7 — 18.</p>
      <p>Строить можно любой свободный путь, не обязательно рядом со своими. Между некоторыми городами пути двойные: один игрок не может занять оба,
      а <b>вдвоём</b> работает только один из них — после первого второй закрыт.</p>`,
    demo: demo(
      (s) => {
        s.hand[0] = hand({ purple: 2, red: 3, loco: 1 });
      },
      [
        A(0, { type: 'claim', route: route('Москва', 'Казань', 'purple'), color: 5, locos: 0 }, 'Две фиолетовые карты — фиолетовый путь Москва — Казань, +2 очка.'),
        A(1, { type: 'draw', slot: -1 }),
        A(1, { type: 'draw', slot: -1 }),
        A(0, { type: 'claim', route: route('Москва', 'Ростов на Дону', 'gray'), color: 0, locos: 1 }, 'Серый путь в три вагона: две красные и локомотив, +4.'),
      ]
    ),
  },
  {
    title: 'Паромы',
    html: `<p>Пути через море — <b>паромы</b>: на их отрезках нарисован паровоз. За каждый такой отрезок нужен <b>локомотив</b>,
      остальные отрезки — картами одного цвета, как обычно.</p>`,
    demo: demo(
      (s) => {
        s.hand[0] = hand({ blue: 2, loco: 1 });
      },
      [A(0, { type: 'claim', route: route('Ростов на Дону', 'Баку'), color: 4, locos: 1 }, 'Паром Ростов-на-Дону — Баку: один локомотив за паровоз и две синие.')]
    ),
  },
  {
    title: 'Тоннели',
    html: `<p><b>Тоннели</b> обведены особой рамкой с заклёпками. Никто не знает, насколько длинным окажется тоннель: выложив нужные карты,
      игрок открывает <b>три верхние</b> карты колоды. За каждую того же цвета, что он выложил (и за каждый локомотив), нужно доплатить
      ещё одну карту этого цвета или локомотив.</p>
      <p>Не может или не хочет доплачивать — забирает свои карты назад в руку, и ход окончен. Открытые три карты уходят в сброс.</p>`,
    demo: demo(
      (s) => {
        s.hand[0] = hand({ purple: 3, red: 1 });
        s.deck.push(0, 5, 2);
      },
      [
        A(0, { type: 'claim', route: route('Норильск', 'Хатанга', 'purple'), color: 5, locos: 0 }, 'Вовка выкладывает две фиолетовые на тоннель Норильск — Хатанга и открывает три карты: одна фиолетовая.'),
        A(0, { type: 'tunnel', pay: true }, 'Доплачивает третьей фиолетовой — тоннель построен.'),
      ]
    ),
  },
  {
    title: 'Новые маршруты',
    html: `<p>Можно потратить ход на новые маршруты: взять <b>три</b> верхние карты маршрутов и оставить хотя бы одну (можно и все).
      Остальные уходят в коробку. Выполненный маршрут — пусть цепочка своих путей соединит его города — даст очки на карте,
      невыполненный в конце <b>вычитается</b>.</p>`,
    demo: demo(
      (s) => {
        s.tdeck.push(ticket('Казань', 'Алма-Ата'), ticket('Москва', 'Свердловск'), ticket('Киев', 'Ленинград'));
      },
      [A(0, { type: 'tickets' }, 'Вовка берёт три маршрута…'), A(0, { type: 'keep', keep: [ticket('Киев', 'Ленинград'), ticket('Москва', 'Свердловск')] }, '…и оставляет два, через Москву.')]
    ),
  },
  {
    title: 'Станции',
    html: `<p>В любом городе, где ещё нет станции, можно поставить <b>свою станцию</b>. Первая стоит <b>1</b> карту — цвета любого из путей,
      идущих из города (если среди них есть серый — любого цвета), вторая — <b>2</b> карты одного цвета, третья — <b>3</b>.</p>
      <p>В конце игры станция позволяет пройти по <b>одному</b> пути другого игрока из этого города, чтобы выполнить свои маршруты.
      Каждая неиспользованная станция — <b>${STATION_POINTS} очка</b>.</p>`,
    demo: demo(
      (s) => {
        s.owner[route('Москва', 'Ленинград', 'blue')] = 1;
        s.owner[route('Москва', 'Ленинград', 'gray')] = 1;
        s.hand[0] = hand({ blue: 1, red: 2 });
      },
      [A(0, { type: 'station', city: city('Ленинград'), color: 4, locos: 0 }, 'Оба пути Москва — Ленинград у Ленки. Вовка ставит станцию в Ленинграде: в конце сможет проехать по одному из них.')]
    ),
  },
  {
    title: 'Контролёр',
    html: `<p>В колоде две карты <b>контролёра</b>. Кто вытянул контролёра <b>вслепую из колоды</b>, может вместо хода сыграть его:</p>
      <p>1) <b>разобрать</b> чужой путь не длиннее 4 вагончиков — вагончики возвращаются хозяину, а с ними и очки за путь; или<br>
      2) <b>построить</b> свой путь не длиннее 4 вагончиков, не отдавая карт вагонов — и паром, и тоннель (тоннель без открытия карт).</p>
      <p>Если контролёр выпал в открытые карты — все пять открытых уходят в сброс.</p>`,
    demo: demo(
      (s) => {
        s.owner[route('Москва', 'Казань', 'orange')] = 1;
        s.owner[route('Москва', 'Казань', 'purple')] = 1;
        s.wagons[1] = 41;
        s.score[1] = 4;
        s.hand[0] = hand({ red: 1, ctrl: 1 });
      },
      [A(0, { type: 'ctrl', route: route('Москва', 'Казань', 'orange'), mode: 'remove' }, 'Вовка играет контролёра: оранжевый путь Москва — Казань снова свободен, Ленка теряет 2 очка.')]
    ),
  },
  {
    title: 'Конец игры и подсчёт',
    html: `<p>Когда у кого-то после хода остаётся <b>два вагончика или меньше</b>, каждый, включая его, делает ещё по <b>одному</b> ходу — и игра окончена.</p>
      <p>К очкам за пути прибавляют выполненные маршруты и вычитают невыполненные, добавляют по ${STATION_POINTS} за неиспользованные станции и бонусы:</p>
      <p>«${BONUS.path.name}» — <b>${BONUS.path.pts}</b> за ${BONUS.path.why};<br>
      «${BONUS.rail.name}» — <b>${BONUS.rail.pts}</b> за ${BONUS.rail.why};<br>
      «${BONUS.ferry.name}» и «${BONUS.tunnel.name}» — по <b>${BONUS.ferry.pts}</b> за больше всех паромов и тоннелей.</p>
      <p>При равенстве бонус получают все. Побеждает больше очков; при равенстве — больше выполненных маршрутов, затем — самый длинный путь.</p>`,
  },
];

export const def: GameDef<State, Action, Event, State> = {
  id: 'poezd',
  title: 'Поездом по СССР',
  players: { min: 2, max: 5, default: 3 },
  seats: SEATS,
  options: [
    { key: 'stations', label: 'Станции', hint: 'по три у игрока: проехать по чужому пути', type: 'toggle', default: true },
    { key: 'ctrl', label: 'Контролёры', hint: 'две карты в колоде: разобрать чужой путь или построить свой даром', type: 'toggle', default: true },
    { key: 'bonuses', label: 'Бонусы за маршруты, паромы и тоннели', hint: 'за самый длинный путь — всегда', type: 'toggle', default: true },
    { key: 'longPile', label: 'Длинные маршруты в общей стопке', hint: 'иначе после раздачи — в коробку', type: 'toggle', default: true },
  ],
  presets: [
    { id: 'box', label: 'По правилам набора', hint: 'Станции, контролёры и все четыре бонуса', options: { stations: true, ctrl: true, bonuses: true, longPile: true } },
    { id: 'simple', label: 'Попроще', hint: 'Без контролёров и станций; бонус — только за самый длинный путь', options: { stations: false, ctrl: false, bonuses: false, longPile: false } },
    { id: 'noctrl', label: 'Без контролёров', hint: 'Всё по правилам, но чужие пути никто не разбирает', options: { stations: true, ctrl: false, bonuses: true, longPile: true } },
  ],
  setup: (seats, opts, rng) => newState(seats.length, cfgFrom(opts), rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view,
  redact,
  result(s) {
    if (!s.result) return null;
    const scores: Record<number, number> = {};
    s.result.rows.forEach((r, p) => (scores[p] = r.total));
    return { winners: s.result.winners, text: `${s.result.rows[s.result.winners[0]].total} очков`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,
  showcase: () => {
    let x = 7;
    const rng: Rng = {
      next: () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648,
      int(n: number) {
        return Math.floor(this.next() * n);
      },
      getState: () => x,
    };
    let s = newState(3, cfgFrom({}), rng);
    for (let i = 0; i < 400 && s.phase !== 'over'; i++) {
      const p = toAct(s)[0];
      const a = choose(view(s, [p]), p, 2, rng);
      if (!a) break;
      const r = apply(s, p, a, rng);
      if (!r) break;
      if (r.state.phase === 'over') break;
      s = r.state;
      if (s.wagons.every((w) => w < 24)) break;
    }
    return s;
  },
  rules: {
    goal: 'Набрать больше всех очков: прокладывать железные дороги между городами СССР и соединять города из своих карт маршрутов.',
    sections: RULES,
  },
};
