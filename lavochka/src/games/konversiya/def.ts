/* «Конверсия 1» — «первая советская оригинальная игра инвестиционного типа» (АСК-ГЕЙМ, СП «АСК»): добыча сырья, заводы и станки,
 * перевозки за границу, импорт и перемена курса рубля. Поля в наборе не было — собираем его сами: внутренний рынок СССР, пять
 * континентов мирового рынка и таблица ввоза-вывоза; карточки и жетоны — из PnP-архива. */
import type { DemoStep, GameDef, Rng, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, CARD_KINDS, cfgFrom, newState, setup, step, toAct, worth, type Action, type Event, type Key, type State, NAMES, CONT_NAME } from './engine';

export const SEATS = [
  { name: 'Красный', color: '#d8241c', light: '#ff7a6e', dark: '#7a0806' },
  { name: 'Синий', color: '#2a6fd0', light: '#7ab0ff', dark: '#123a7a' },
  { name: 'Зелёный', color: '#2a9a48', light: '#6fd08a', dark: '#0f5a24' },
  { name: 'Жёлтый', color: '#e8c21a', light: '#fff07a', dark: '#8a7000', ink: '#8a7000' },
  { name: 'Фиолетовый', color: '#8a3ac0', light: '#c48af0', dark: '#4a1a70' },
  { name: 'Оранжевый', color: '#f07a1a', light: '#ffb070', dark: '#8a3a00' },
];

const list = (items: Partial<Record<Key, number>>) =>
  Object.entries(items)
    .map(([k, n]) => `${NAMES[k as Key]} × ${n}`)
    .join(', ');

function describe(ev: Event, name: (seat: number) => string): string | null {
  const m = (v: number, usd: boolean) => (usd ? `${v} тыс. $` : `${v} тыс. руб.`);
  switch (ev.type) {
    case 'buy':
      return `${name(ev.seat)} покупает: ${list(ev.items)} — ${m(ev.cost, ev.usd)}.`;
    case 'sell':
      return `${name(ev.seat)} продаёт: ${list(ev.items)} — ${m(ev.got, ev.usd)}.`;
    case 'mine':
      return `${name(ev.seat)} добывает ${ev.units} парт. сырья (затраты ${ev.cost} тыс.).`;
    case 'produce':
      return `${name(ev.seat)} производит ${ev.units} парт. товара (затраты ${ev.cost} тыс.).`;
    case 'load':
      return `${name(ev.seat)} грузит ${ev.n} парт. государственного груза и получает за перевозку ${ev.fee} тыс. руб.`;
    case 'unload':
      return `${name(ev.seat)} сгружает государственный груз.`;
    case 'trip':
      return `${name(ev.seat)} едет: ${ev.to === 'ussr' ? 'на внутренний рынок СССР' : CONT_NAME[ev.to]}${ev.mode === 'state' ? ` (госавтотранспорт, ${ev.cost} тыс. руб.)` : ev.mode === 'fleet' ? ' флотом' : ' на автотранспорте'}.`;
    case 'card':
      return `«События в пути»: ${CARD_KINDS[ev.kind].text}`;
    case 'back':
      return `${name(ev.seat)} возвращается.`;
    case 'rate':
      return ev.rate === 5 ? '💱 Рубль стал равен доллару — конец игры!' : `💱 Перемена курса рубля: теперь курс ${ev.rate}.`;
    case 'skip':
      return ev.forced ? `${name(ev.seat)} пропускает ход.` : `${name(ev.seat)}: пропуск хода.`;
    case 'loan':
      return ev.back ? `${name(ev.seat)} возвращает ссуду: 150 тыс. руб.` : `${name(ev.seat)} берёт ссуду 100 тыс. руб. (вернуть 150).`;
    case 'broke':
      return `💸 ${name(ev.seat)} — банкрот.`;
    case 'end':
      return ev.winner == null ? '🏁 Поровну.' : `🏁 Победа: ${name(ev.winner)} — ${ev.worth[ev.winner]} тыс.`;
  }
  return null;
}

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const Do = (seat: number, action: Action, caption?: string): DemoStep<Action> => ({ seat, action, caption });

function fixedRng(seed: number): Rng {
  let x = seed;
  return {
    next: () => (x = (x * 1103515245 + 12345) % 2147483648) / 2147483648,
    int(n: number) {
      return Math.floor(this.next() * n);
    },
    getState: () => x,
  };
}
/** Позиция для показа: двое, колода начинается с заданных карт. */
function pos(o: (s: State) => void, deck: string[] = []): State {
  const s = newState(cfgFrom({}), 2, fixedRng(1));
  s.deck = [...deck.map((id) => CARD_KINDS.findIndex((c) => c.id === id)), ...s.deck];
  o(s);
  return s;
}

export const def: GameDef<State, Action, Event, State> = {
  id: 'konversiya',
  title: 'Конверсия',
  players: { min: 2, max: 6, default: 4 },
  seats: SEATS,
  options: [
    {
      key: 'variant',
      label: 'Таблица ввоза-вывоза',
      type: 'select',
      choices: [
        { value: 'short', label: 'короткая — 4 курса по 25 клеток' },
        { value: 'medium', label: 'средняя — 15, 25, 35 и 50' },
        { value: 'long', label: 'длинная — 15, 25, 50 и 100' },
      ],
      default: 'short',
    },
  ],
  presets: [
    { id: 'short', label: 'Короткая таблица', hint: 'Для знакомства с игрой: 100 партий груза до конвертируемого рубля', options: { variant: 'short' } },
    { id: 'medium', label: 'Средняя таблица', hint: '125 партий, первые курсы меняются быстрее', options: { variant: 'medium' } },
    { id: 'long', label: 'Длинная таблица', hint: '190 партий — долгая игра', options: { variant: 'long' } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat), opts, rng),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s) => ({ ...s, deck: [] }),
  result(s) {
    if (!s.over) return null;
    if (s.winner == null) return { winners: [], text: 'поровну' };
    return { winners: [s.winner], text: `${worth(s, s.winner)} тыс.` };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    const rng = fixedRng(5);
    let s = newState(cfgFrom({}), 4, rng);
    for (let i = 0; i < 70 && !s.over; i++) {
      const a = choose(s, s.turn, 1, rng);
      if (!a) break;
      s = step(s, a, rng).state;
    }
    return { ...s, deck: [] };
  },

  rules: {
    goal: 'Заработать к концу игры больше всех денег. Конец наступает, когда рубль конвертируется и становится равным доллару — от перевозок через границу курс меняется пять раз.',
    sections: [
      {
        title: 'Ход — одно действие',
        html: `<p>У каждого по 100 тыс. руб. В свой ход игрок делает одно и только одно действие: <b>покупку</b>, <b>добычу сырья</b>,
          <b>производство товара</b>, <b>продажу</b>, <b>погрузку</b>, <b>разгрузку</b>, <b>поездку</b> — или пропускает ход. Покупать и
          продавать можно сразу всё, что нужно, за один ход. Цены — по таблице курсов: рынок продаёт дороже, чем покупает.</p>
          <p>В любой момент можно взять в банке <b>ссуду</b> 100 тыс. руб. с обязательством вернуть 150; вторую — только вернув первую.</p>`,
        demo: {
          seats: demoSeats,
          intro: 'Начало: у каждого по 100 тыс. руб.',
          steps: [Do(0, { type: 'buy', items: { equipS: 2 } }, 'Красный покупает два комплекта оборудования для добычи сырья.'), Do(1, { type: 'skip' }), Do(0, { type: 'mine' }, 'Добыча: по 1 тыс. за оборудование — две партии сырья.')],
        },
      },
      {
        title: 'Добыча и производство',
        html: `<p><b>Добыча</b>: за работу каждого оборудования — 1 тыс. руб.; советское добывает за ход партию сырья, импортное (азиатское) — две.
          <b>Производство</b>: нужен завод (на нём 5 станков), станки и сырьё; за работу станка — 2 тыс. руб., советский станок делает из
          партии сырья партию товара, импортный (европейский) — две. <b>Компьютер</b> добавляет каждому предприятию и транспорту ещё одну партию.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos((s) => {
              s.p[0].own.factory = 1;
              s.p[0].own.machS = 2;
              s.p[0].own.raw = 2;
            }),
          intro: 'У Красного завод, два станка и две партии сырья.',
          steps: [Do(0, { type: 'produce' }, 'Две партии товара.'), Do(1, { type: 'skip' }), Do(0, { type: 'sell', items: { goods: 2 } }, 'Товар — на внутренний рынок.')],
        },
      },
      {
        title: 'Поездки за границу',
        html: `<p>Для поездки нужен свой <b>автотранспорт</b> (советский везёт партию груза, импортный — две) или <b>флот</b> (две и три;
          флот ходит только в Африку, Австралию и Америку), или нанятый государственный транспорт — тогда платите за себя и за каждую партию.
          На континенте может быть только один игрок. В пути открывают карту <b>«События в пути»</b>: попутный груз, ремонт, тайфун, забастовка,
          а то и «досрочно прибыли» — тогда успеваете сделать ещё одну операцию.</p>
          <p>Мировой рынок покупает только советский товар — по 4 тыс. долларов за партию — и продаёт на каждом континенте свой импорт:
          станки в Европе, оборудование в Азии, компьютеры в Америке, автотранспорт в Африке, флот в Австралии.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos(
              (s) => {
                s.p[0].own.truckS = 2;
                s.p[0].own.goods = 2;
              },
              ['extra']
            ),
          intro: 'У Красного два грузовика и две партии своего товара.',
          steps: [Do(0, { type: 'trip', to: 'europe', mode: 'truck', goods: 2 }, 'В Европу! Карта — «досрочно прибыли»: ещё одна операция.'), Do(0, { type: 'sell', items: { goods: 2 } }, 'Товар продан за 8 тыс. долларов.')],
        },
      },
      {
        title: 'Импорт',
        html: `<p>Купленное за границей — пока только груз: его надо довезти до СССР. Там импортное можно оставить себе или продать на внутренний
          рынок — оно стоит <b>вдвое дороже</b> советского. Доллары банк меняет на рубли один к одному, а рубли на доллары не меняет:
          доллары зарабатывают только вывозом товара.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos(
              (s) => {
                s.p[0].own.truckS = 3;
                s.p[0].loc = 'europe';
                s.p[0].lastMode = 'truck';
                s.p[0].usd = 6;
              },
              ['usd1']
            ),
          intro: 'Красный в Европе, у него 6 тыс. долларов.',
          steps: [
            Do(0, { type: 'buy', items: { machI: 3 } }, 'Три европейских станка по 2 тыс. $.'),
            Do(1, { type: 'skip' }),
            Do(0, { type: 'trip', to: 'ussr', mode: 'truck', goods: 0 }, 'Домой — да ещё попутный груз.'),
            Do(1, { type: 'skip' }),
            Do(0, { type: 'sell', items: { machI: 3 } }, 'Станки — на внутренний рынок по двойной цене.'),
          ],
        },
      },
      {
        title: 'Государственный груз и курс рубля',
        html: `<p>Перевозчик может везти <b>государственный груз</b>: погрузка — отдельное действие, деньги за перевозку платят сразу при погрузке.
          Туда везут советский товар, обратно — импорт континента, который потом поступает на внутренний рынок.</p>
          <p>Каждая партия груза, пересёкшая границу, двигает фишку-индикатор по <b>таблице ввоза-вывоза</b>. Новый цвет — новый курс рубля,
          и цены внутреннего рынка падают. Переход на 5-й курс — конец игры: всё имущество продаётся по 5-му курсу, доллары считаются один
          к одному, ссуда — минус 150. Перед переменой курса выгодно продать запасы: потом всё подешевеет.</p>`,
        demo: {
          seats: demoSeats,
          setup: () =>
            pos((s) => {
              s.p[0].own.truckS = 2;
            }),
          intro: 'У Красного два грузовика.',
          steps: [Do(0, { type: 'load', n: 2 }, 'Погрузка двух партий государственного товара — 20 тыс. руб. за перевозку сразу.')],
        },
      },
    ],
  },
};

