/* «Акционеры» — экономическая игра-бродилка (МП «ЭКСО», автор З. Галич, начало 90-х): малый бизнес — патенты и кредиты,
 * большой бизнес — фирмы и предприятия, биржа. Побеждает наибольший капитал, вложенный в собственность. */
import type { DemoScript, GameDef, Rng, SeatSpec } from '../../core/types';
import { SEATS as HSEATS } from '../hodilki/core';
import { choose } from './bot';
import { CELLS, COS, DECK_NAME, EXCHANGE, PT_NAME, firmByName } from './data';
import { apply, cardOf, fmt, money, newState, toAct, view, type Action, type Event, type State } from './engine';

export const SEATS = HSEATS.slice(0, 6);

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));

function demo(patch: (s: State) => void, steps: DemoScript<State, Action>['steps'], exchange = true): DemoScript<State, Action> {
  return {
    seats: demoSeats,
    options: { rounds: 50, exchange },
    setup: () => {
      const s = newState([0, 1], { rounds: 50, exchange });
      patch(s);
      return s;
    },
    steps,
  };
}

/** Бросок и перестановка фишки — два шага (фишку ставит сам игрок); подпись и подкрутка для клетки — на втором. */
const roll = (seat: number, d: number, caption: string, more: number[] = []) => [
  { seat, action: { type: 'roll' } as Action, rig: [d - 1], caption: `Выпало ${d}…` },
  { seat, action: { type: 'move' } as Action, rig: more, caption },
];
const pick = (seat: number, id: string, caption: string, rig?: number[]) => ({ seat, action: { type: 'choose', id } as Action, caption, ...(rig ? { rig } : {}) });
const pats = (n: number) => Array.from({ length: n }, (_, i) => ({ t: (['kafe', 'ferma', 'muzyka', 'odezhda', 'stroika', 'dacha'] as const)[i % 6], v: 10000 }));

const KNIGI = firmByName('Книги');
const ESTRADA = firmByName('Эстрада');
const NEFT = firmByName('Нефть');

const RULES = [
  {
    title: 'Маршрут: малый и большой бизнес',
    html: `<p>Фишки стоят на <b>«Начале»</b> (внизу справа). Бросают один кубик и идут <b>вокруг «Малого бизнеса»</b>: первая клетка — «Дача».
      Пройдя «Получите наследство», фишка <b>останавливается на «Начале»</b>, даже если очки остались. Следующим ходом без кубика — в <b>«Аэропорт»</b>
      (или ещё круг малого бизнеса: пока никто не купил фирму — не больше трёх кругов подряд, потом — двух).</p>
      <p>Из аэропорта — <b>«Большой бизнес»</b> от «Телекса» до <b>«Клуба бизнесменов»</b>. Оттуда — снова большой бизнес или назад в малый.
      Где кольца соприкасаются («рэкет», «телекс», «суд», «известие»), поворачивают <b>только направо</b> — каждый идёт по своему кольцу.</p>`,
    demo: demo(
      (s) => {
        s.pos[0] = 34;
        s.fresh[0] = false;
        s.cash[0] = 900000;
        s.smallDone[0] = 1;
        s.laps[0] = 1;
      },
      [
        ...roll(0, 3, 'Вовка выбросил 3: «Субсидия», «Наследство» — и остановка на «Начале», хотя очко осталось.'),
        ...roll(1, 1, 'Ленка начинает: первая клетка — «Дача», патент приносит деньги.', [0]),
        pick(0, 'fly', 'Ход Вовки: без кубика — в аэропорт.'),
        ...roll(1, 2, 'Ленка — на «Одежде».', [1]),
        ...roll(0, 4, 'Из аэропорта Вовка идёт по большому бизнесу: «Телекс», «Газеты», «Журналы» — и «Книги».'),
      ]
    ),
  },
  {
    title: 'Патенты, банки и кредит',
    html: `<p>На клетках «Дача», «Одежда», «Кафе», «Ферма», «Стройка», «Музыка» игрок получает <b>патент</b> этого вида и сумму с его оборота —
      от 1 000 до 280 000. Патенты — залог для <b>кредита</b>: в первом банке — по <b>300 000</b> за каждый патент после третьего (после восьмого — по половине),
      во втором — по <b>500 000</b> после пятого (после десятого — по половине). Эти патенты отдаются банку насовсем.</p>
      <p>Кредит возвращают с процентами через оговорённое число своих ходов (по умолчанию <b>20 % через 15 ходов</b>). Не хватает денег — фирмы закладываются,
      не хватило и этого — банкротство. В пресете «Мягкий старт» у каждого 300 000 с начала, кредит под 10 %, а пока своих фирм нет, долг не разоряет — игрок отдаёт сколько есть.</p>`,
    demo: demo(
      (s) => {
        s.pos[0] = 20;
        s.fresh[0] = false;
        s.pats[0] = pats(6);
        s.cash[0] = 250000;
      },
      [...roll(0, 3, 'У Вовки 6 патентов. Он попадает в первый банк.'), pick(0, 'take', 'Три патента сверх трёх — 900 000 в кредит; вернуть 1 080 000 через 15 ходов.')]
    ),
  },
  {
    title: 'Рэкет, милиция, пожар и страховка',
    html: `<p><b>Рэкет</b> отбирает все патенты, <b>милиция</b> возвращает их. <b>Пожар</b> уничтожает все патенты и предприятия (право на фирмы остаётся),
      <b>«Вас ограбили»</b> — все наличные. От пожара и ограбления спасает <b>страховой полис</b> (650 000 на клетке «Страхование»; меценат может получить его по карточке даром).</p>
      <p>В «Казино» чётное выигрывает 400 000, нечётное — проигрывает. <b>Клад</b> — три броска: за каждое выпавшее <b>число-ключ</b> (договорились заранее, обычно 6) — по 300 000.
      Субсидии и наследство дают деньги без возврата, «Отдых» — пропуск 2 или 3 ходов.</p>`,
    demo: demo(
      (s) => {
        s.pos[0] = 11;
        s.fresh[0] = false;
        s.pats[0] = pats(4);
        s.pos[1] = 12;
        s.fresh[1] = false;
        s.polis[1] = true;
        s.pats[1] = pats(3);
      },
      [...roll(0, 2, 'Вовка попал к рэкетирам: четыре патента — под поле, до «Милиции».'), ...roll(1, 3, 'У Ленки пожар, но у неё страховой полис — всё цело.')]
    ),
  },
  {
    title: 'Фирмы, предприятия и прибыль',
    html: `<p>В большом бизнесе 21 фирма восьми компаний. Попав на свободную фирму, можно купить <b>право владения</b> за цену под её названием.
      Перед своим ходом владелец строит <b>предприятия</b> — до трёх, по цене «стоимость каждого предприятия».</p>
      <p>С попавшего на фирму владелец получает <b>прибыль только при предприятиях</b> — сумму из таблицы на клетке: за 1, 2 или 3 предприятия.
      <b>Диплом менеджера</b> (школа бизнеса: 350 000 и пропуск хода) удваивает прибыль. Не хватает денег на фирму — она идёт <b>с аукциона</b> чуть дороже цены.
      Собственность можно <b>заложить</b> за половину стоимости и выкупить за полную.</p>`,
    demo: demo(
      (s) => {
        s.pos[0] = 45;
        s.fresh[0] = false;
        s.owner[KNIGI] = 0;
        s.anyBought = true;
        s.cash[0] = 1200000;
        s.pos[1] = 38;
        s.fresh[1] = false;
        s.cash[1] = 2000000;
      },
      [
        { seat: 0, action: { type: 'build', cell: KNIGI }, caption: 'Перед ходом Вовка строит на «Книгах» предприятие за 350 000…' },
        { seat: 0, action: { type: 'build', cell: KNIGI }, caption: '…и второе.' },
        ...roll(0, 1, 'Ход — на «Финансового инспектора»: теневиком Вовка не был, ему не страшно.'),
        ...roll(1, 3, 'Ленка попала на «Книги»: два предприятия — прибыль 800 000 владельцу.'),
      ]
    ),
  },
  {
    title: 'Биржа',
    html: `<p>Биржа открывается после первой покупки фирмы. На клетке «Биржа» или по карточке «Отправляйтесь на биржу» указатель крутят дважды:
      сначала он выбирает <b>компанию</b> (внешний круг восьмиугольника), потом — <b>изменение курса</b> (внутренний круг): красные цифры — во сколько раз
      растут цена фирм, предприятий и прибыль компании, зелёные — во сколько падают. «Биржевая лихорадка» — крутят все по очереди.</p>
      <p>Простой вариант игры — <b>без биржи</b>: её клетки пустые, биржевых карточек нет.</p>`,
    demo: demo(
      (s) => {
        s.owner[ESTRADA] = 0;
        s.anyBought = true;
        s.pos[1] = 56;
        s.fresh[1] = false;
        s.pos[0] = 70;
        s.fresh[0] = false;
        s.turn = 1;
      },
      [...roll(1, 3, `Ленка — на бирже. Указатель: «Шоу-бизнес»… ×${EXCHANGE[0]}! «Эстрада» Вовки теперь стоит 4 400 000, и прибыль с неё вдвое больше.`, [7, 0])]
    ),
  },
  {
    title: 'Известия и телексы',
    html: `<p>На клетках «Известие» и «Телекс» тянут карточку своей колоды: призы и штрафы, день рождения, реклама в чужой газете, забастовка в аэропорту
      (никто не улетает, пока не вытянут карточку другой колоды), игра на бирже, меценатство, <b>угроза банкротства</b> — если в ближайшие пять своих ходов
      придёт плохая карточка, забастовка на предприятиях или упадёт курс ваших фирм, игрок разоряется.</p>
      <p>Карточки «певец», «садовод», «королева красоты» остаются у игрока: патенты «Музыка» приносят вдесятеро, «Дача» — втрое, фирма шоу-бизнеса — за полцены.</p>`,
    demo: demo(
      (s) => {
        s.pos[0] = 1;
        s.fresh[0] = false;
        s.cash[1] = 60000;
        s.cash[0] = 15000;
      },
      [...roll(0, 1, `Вовка на «Известии»: «${cardOf({ deck: 'izv', i: 2 }).text}».`, [2])]
    ),
  },
  {
    title: 'Теневая экономика и суд',
    html: `<p>На «Теневой экономике» можно взять 1 или 2 миллиона — и карточку теневика. Теневик, попавший на «Финансового инспектора», получает и его карточку.
      С обеими карточками <b>суд</b> конфискует всё — деньги, патенты, фирмы — и игрок пропускает несколько ходов (по умолчанию 3). Попавшись теневиком второй раз,
      выбывает. Теневику без карточки инспектора суд не страшен.</p>`,
    demo: demo(
      (s) => {
        s.pos[0] = 49;
        s.fresh[0] = false;
        s.shadow[0] = 1;
        s.inspector[0] = true;
        s.cash[0] = 1800000;
        s.owner[NEFT] = 0;
        s.anyBought = true;
      },
      [...roll(0, 1, 'Вовка — теневик с карточкой фининспектора — попал в суд: «Нефть», деньги и патенты конфискованы.')]
    ),
  },
  {
    title: 'Налоги, благотворительность, забастовка',
    html: `<p>На клетках налога платят указанную сумму; в первый круг малого бизнеса налог не берут. <b>Благотворителю</b> — льгота на один налог:
      взнос больше половины налога — платит половину, больше налога — не платит. Взносы делают по карточкам и на <b>благотворительном аукционе</b> (кто больше, от 100 000).</p>
      <p><b>«На ваших предприятиях забастовка!»</b> — уйти можно, только выбросив чётное; пока игрок стоит здесь, его предприятия прибыли не приносят.</p>`,
    demo: demo(
      (s) => {
        s.pos[0] = 64;
        s.fresh[0] = false;
        s.relief[0] = 150000;
        s.donated[0] = 150000;
        s.cash[0] = 500000;
      },
      [...roll(0, 1, 'Налог 200 000, но Вовка пожертвовал 150 000 — больше половины: платит 100 000.')]
    ),
  },
  {
    title: 'Конец игры',
    html: `<p>Играют оговорённое число кругов стола (30, 50 или 80) или пока не останется один не разорившийся. Банкрот отдаёт оставшуюся собственность тому,
      кому задолжал, и выходит. Побеждает <b>наибольший капитал, вложенный в собственность</b>: фирмы и предприятия по текущему курсу, кроме заложенных;
      при равенстве — наличные.</p>`,
  },
];

function showcase(): State {
  const s = newState([0, 1, 2, 3], { rounds: 50 });
  const own = (name: string, seat: number, ent: number) => {
    const c = firmByName(name);
    s.owner[c] = seat;
    s.ent[c] = ent;
  };
  own('Нефть', 0, 2);
  own('Алмазы', 0, 1);
  own('Газеты', 1, 3);
  own('Книги', 1, 1);
  own('Эстрада', 2, 1);
  own('Дом', 2, 0);
  own('Отель', 3, 2);
  own('Гастроном', 3, 0);
  s.anyBought = true;
  s.rate[7] = [2, 1];
  s.rate[1] = [1, 3];
  s.pos = [70, 41, 15, 59, 0, 0];
  s.fresh = s.fresh.map(() => false);
  s.cash = [1840000, 960000, 3250000, 415000, 0, 0];
  s.pats[2] = pats(4);
  s.polis[0] = true;
  s.diploma[1] = true;
  s.round = 18;
  s.turn = 2;
  s.dice = 5;
  return s;
}

export const def: GameDef<State, Action, Event, State> = {
  id: 'akcii',
  title: 'Акционеры',
  players: { min: 2, max: 6, default: 4 },
  seats: SEATS,
  options: [
    {
      key: 'rounds',
      label: 'Сколько кругов стола',
      type: 'select',
      choices: [
        { value: 30, label: '30 (около часа)' },
        { value: 50, label: '50' },
        { value: 80, label: '80' },
      ],
      default: 50,
    },
    { key: 'exchange', label: 'Биржа', hint: 'клетки «Биржа» и биржевые карточки меняют курс компаний', type: 'toggle', default: true },
    { key: 'auctions', label: 'Аукционы', hint: 'фирма, на которую не хватило денег, уходит с торгов', type: 'toggle', default: true },
    {
      key: 'credit',
      label: 'Кредит',
      type: 'select',
      choices: [
        { value: 20, label: 'под 20 % на 15 ходов' },
        { value: 10, label: 'под 10 % на 20 ходов' },
        { value: 30, label: 'под 30 % на 10 ходов' },
      ],
      default: 20,
    },
    {
      key: 'start',
      label: 'Стартовые деньги',
      hint: 'в правилах первые деньги зарабатывают в малом бизнесе',
      type: 'select',
      choices: [
        { value: 0, label: 'нет, как в правилах' },
        { value: 300000, label: '300 000' },
        { value: 1000000, label: '1 000 000' },
      ],
      default: 0,
    },
    { key: 'mercy', label: 'Без разорения в малом бизнесе', hint: 'пока нет фирм, долг не разоряет — игрок отдаёт сколько есть', type: 'toggle', default: false },
    {
      key: 'key',
      label: 'Ключ от клада',
      type: 'select',
      choices: [1, 2, 3, 4, 5, 6].map((v) => ({ value: v, label: `выпало ${v}` })),
      default: 6,
    },
    {
      key: 'court',
      label: 'После суда пропустить',
      type: 'select',
      choices: [
        { value: 2, label: '2 хода' },
        { value: 3, label: '3 хода' },
        { value: 5, label: '5 ходов' },
      ],
      default: 3,
    },
  ],
  presets: [
    { id: 'simple', label: 'Простой вариант', hint: 'без биржи, 30 кругов — для младших', options: { rounds: 30, exchange: false, auctions: true } },
    { id: 'full', label: 'С биржей', hint: 'указатель меняет курс компаний, 50 кругов', options: { rounds: 50, exchange: true, auctions: true } },
    { id: 'soft', label: 'Мягкий старт', hint: '300 000 на старте, кредит под 10 %, в малом бизнесе не разоряются', options: { rounds: 50, exchange: true, auctions: true, start: 300000, credit: 10, mercy: true } },
    { id: 'long', label: 'Длинная партия', hint: 'с биржей, 80 кругов', options: { rounds: 80, exchange: true, auctions: true } },
  ],
  setup: (seats, opts) => {
    const ids = seats.map((x) => x.seat).sort((a, b) => a - b);
    const pct = Number(opts.credit ?? 20);
    return newState(ids, {
      rounds: Number(opts.rounds) || 50,
      exchange: opts.exchange !== false,
      auctions: opts.auctions !== false,
      key: Number(opts.key) || 6,
      courtSkip: Number(opts.court) || 3,
      pct,
      term: pct === 10 ? 20 : pct === 30 ? 10 : 15,
      start: Number(opts.start) || 0,
      mercy: opts.mercy === true,
    });
  },
  toAct,
  apply: (s, seat, a, rng: Rng) => apply(s, seat, a, rng),
  view: (s) => view(s),
  result: (s) => s.result,
  showcase,
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, level, rng) => choose(v, seat, level, rng) },
  describe: (ev, name) => describe(ev, name),
  rules: {
    goal: 'Начать с малого — патентов и кредитов, перебраться в большой бизнес и скупить как можно больше фирм с предприятиями. Побеждает наибольший капитал, вложенный в собственность.',
    sections: RULES,
  },
};

export function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'roll':
      return ev.why === 'treasure' ? `${name(ev.seat)} ищет клад: <b>${ev.d}</b>` : ev.why === 'casino' ? `🎰 ${name(ev.seat)} в казино: <b>${ev.d}</b>` : `${name(ev.seat)} бросает: <b>${ev.d}</b>`;
    case 'cell': {
      const c = CELLS[ev.cell];
      if (c.kind === 'firm' || c.kind === 'patent' || c.kind === 'izv' || c.kind === 'telex') return null;
      return `${name(ev.seat)} — <b>${c.name}</b>`;
    }
    case 'patent':
      return `📜 ${name(ev.seat)}: патент «${PT_NAME[ev.t]}» — ${money(ev.paid)}`;
    case 'card':
      return `${ev.deck === 'izv' ? '📰' : '📠'} ${name(ev.seat)} — «${DECK_NAME[ev.deck]}»: <i>${cardOf(ev).text}</i>`;
    case 'pay':
      if (ev.from == null) return `${name(ev.to!)} получает ${money(ev.amount)} — ${ev.why}`;
      return `${name(ev.from)} платит ${money(ev.amount)} ${ev.to == null ? 'банку' : name(ev.to)} — ${ev.why}`;
    case 'pats':
      return `${name(ev.seat)}: ${ev.back ? '+' : '−'}${ev.n} пат. — ${ev.why}`;
    case 'credit':
      return `🏦 ${name(ev.seat)} берёт кредит ${money(ev.sum)} за ${ev.n} пат. (вернуть ${money(ev.due)})`;
    case 'buy':
      return `🏢 ${name(ev.seat)} покупает «${CELLS[ev.cell].name}» за ${money(ev.price)}`;
    case 'build':
      return `🏗 ${name(ev.seat)} строит ${ev.n}-е предприятие на «${CELLS[ev.cell].name}» за ${money(ev.cost)}`;
    case 'mortgage':
      return ev.back ? `${name(ev.seat)} выкупает «${CELLS[ev.cell].name}» за ${money(ev.sum)}` : `${name(ev.seat)} закладывает «${CELLS[ev.cell].name}» за ${money(ev.sum)}`;
    case 'lose':
      return `🔥 ${name(ev.seat)}: «${CELLS[ev.cell].name}» — ${ev.why === 'конфискация' ? 'конфискована' : `предприятия потеряны (${ev.why})`}`;
    case 'spin': {
      const m = EXCHANGE[ev.k];
      return `📈 Биржа (${name(ev.seat)}): ${COS[ev.co].short} — ${m > 0 ? `курс ×${m}` : `курс ÷${-m}`}`;
    }
    case 'skip':
      return ev.air ? `✈ ${name(ev.seat)} ждёт в аэропорту — забастовка` : `${name(ev.seat)} пропускает ход${ev.left ? ` (ещё ${ev.left})` : ''}`;
    case 'note':
      return ev.seat == null ? `<i>${ev.text}</i>` : `${name(ev.seat)}: <i>${ev.text}</i>`;
    case 'choice':
      return `${name(ev.seat)}: ${ev.label}`;
    case 'auction':
      if (ev.seat == null) return ev.bid ? `🔨 Аукцион: «${CELLS[ev.cell].name}», от ${money(ev.bid)}` : '🔨 Аукцион не состоялся';
      return `🔨 ${name(ev.seat)}: ${money(ev.bid)}`;
    case 'bankrupt':
      return `💀 ${name(ev.seat)} — банкрот и выбывает`;
    case 'end':
      return `🏆 ${ev.winners.map(name).join(', ')} — ${ev.text}`;
    case 'move':
      return null;
  }
  return null;
}

export { fmt };
