/* «Белая ворона» — советская экономическая игра-календарь (ЦПР, ок. 1990). Два издания — синее и зелёное — выбираются настройкой. */
import type { DemoScript, GameDef, Rng, SeatSpec } from '../../core/types';
import { SEATS as HSEATS } from '../hodilki/core';
import { BIZ, MAIL, type Variant } from './data';
import { choose } from './bot';
import { apply, fmt, newState, toAct, view, type Action, type Event, type State } from './engine';

export const SEATS = HSEATS.slice(0, 6);

/** У события — издание: журналу нужны названия бизнесов. */
export type Ev = Event & { v?: Variant };

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));

function demo(patch: (s: State) => void, steps: DemoScript<State, Action>['steps']): DemoScript<State, Action> {
  return {
    seats: demoSeats,
    options: { variant: 'blue', months: 2 },
    setup: (_def, rng: Rng) => {
      const s = newState('blue', [0, 1], 2, rng);
      patch(s);
      return s;
    },
    // после броска фишку переставляют отдельным шагом: подкрутка сверх кубика и подпись — на нём
    steps: steps.flatMap((st) =>
      st.action.type === 'roll'
        ? [
            { ...st, rig: st.rig?.slice(0, 1), caption: `${SEATS[st.seat].name} бросает кубик…` },
            { seat: st.seat, action: { type: 'move' } as Action, rig: st.rig?.slice(1), caption: st.caption },
          ]
        : [st],
    ),
  };
}

const mailId = (start: string) => MAIL.findIndex((m) => m.text.startsWith(start) || m.who.startsWith(start));
const mailTop = (s: State, ...ids: number[]) => {
  s.mail = [...ids, ...s.mail.filter((i) => !ids.includes(i))];
};
const bizTop = (s: State, name: string) => {
  const id = BIZ.blue.findIndex((b) => b.name.startsWith(name));
  s.bizDeck = [id, ...s.bizDeck.filter((i) => i !== id)];
};

const RULES = [
  {
    title: 'Календарь и почта',
    html: `<p>Игра идёт по календарю месяца: фишки стоят на «Старте» (воскресенье) и одним кубиком идут день за днём к <b>Дню Белой Вороны</b> —
      31-му числу. На нём останавливаются, сколько бы ни выпало. У каждого на старте <b>325 монет</b>; число месяцев выбирают до игры.</p>
      <p>На «Почте» берут карточку. <b>Счёт</b> («Оплатить») кладут перед собой — платят его в День Белой Вороны. <b>«Успех»</b> («Взять») — деньги сразу.
      Реклама, письма и телеграммы просто отбрасываются. «Заначка», «Премия», «Тараканьи бега» — получить; «Капкан», «Зверовидение», «Ремонт норы» — заплатить сразу.</p>`,
    demo: demo((s) => mailTop(s, mailId('Посещение аттракционов')), [
      { seat: 0, action: { type: 'roll' }, rig: [0], caption: 'Вовка выбрасывает 1 — «Почта»: «Диснейленд», оплатить 25. Счёт ляжет перед ним до конца месяца.' },
      { seat: 1, action: { type: 'roll' }, rig: [1], caption: 'Ленка — на «Давно забытой заначке»: 1000 монет!' },
    ]),
  },
  {
    title: 'Бизнес и клиент',
    html: `<p>На клетке «Бизнес» открывают карточку: её можно купить за <b>плату</b> или вернуть вниз стопки. Попав на «Клиента», продаёшь
      один свой бизнес за <b>цену</b> — разница твоя. Комиссионные с этой сделки получает тот из остальных, кто выбросит на кубике больше.</p>
      <p>Не дошёл до клиента — бизнес ничего не принёс: в конце игры купленные карточки отбрасываются. «Бизнес — дубль» — две карточки подряд.</p>`,
    demo: demo(
      (s) => {
        bizTop(s, 'Автомобиль');
        mailTop(s, mailId('Вы выиграли все раколовки'));
      },
      [
        { seat: 0, action: { type: 'roll' }, rig: [3], caption: 'Вовка на «Бизнесе»: автомобиль «Ягуар» — плата 950, цена 1400.' },
        { seat: 0, action: { type: 'buy' }, caption: 'Покупает: наличных 325, остальное — в долг у банка.' },
        { seat: 1, action: { type: 'roll' }, rig: [0], caption: 'Ленке пришёл «Успех»: +50.' },
        { seat: 0, action: { type: 'roll' }, rig: [4], caption: 'Вовка дошёл до «Клиента».' },
        { seat: 0, action: { type: 'sell', i: 0 }, rig: [3], caption: 'Продаёт «Ягуар» за 1400 — прибыль 450. Комиссионные 95 бросает Ленка — они её.' },
      ]
    ),
  },
  {
    title: 'Особые карточки «Почты»',
    html: `<p><b>Ветеринарное страхование</b> (150) гасит до конца игры все ветеринарные счета — «Скорую помощь», «Каштанку», лазарет им. Шарикова,
      профессора Гиббона, «Белый клык», доктора Собак и психотерапевта Зайцеровского. <b>Охотничий билет</b> (125) — все счета магазина «Охотник».
      Их покупают сразу или отбрасывают.</p>
      <p><b>«5 или 6»</b>: ставишь 100 и бросаешь кубик — 5 или 6 приносят 1000, иначе ставка уходит в банк. Можно и не рисковать.
      <b>Облигация лесного займа</b> оплачивается банком, если в этом месяце попадёшь на «День тиража»; не попал — сгорает.</p>`,
    demo: demo(
      (s) => {
        mailTop(s, mailId('5 или 6'), mailId('Ветеринарное'));
        s.pos[1] = 2;
      },
      [
        { seat: 0, action: { type: 'roll' }, rig: [0], caption: 'Вовке выпало «5 или 6».' },
        { seat: 0, action: { type: 'buy' }, rig: [5], caption: 'Рискует — шестёрка! +1000 вместо ставки.' },
        { seat: 1, action: { type: 'roll' }, rig: [0], caption: 'Ленке — ветеринарное страхование.' },
        { seat: 1, action: { type: 'buy' }, caption: 'Покупает за 150: теперь ветеринарные счета ей не страшны.' },
      ]
    ),
  },
  {
    title: 'Аукцион, выборы царя зверей, линька',
    html: `<p><b>Аукцион</b>: все ставят по 100, бросают кубик — у кого больше, тот забирает всё. <b>Выборы царя зверей</b>: попавший кладёт 50 в нижний угол поля;
      первый, кто потом выбросит <b>6</b>, забирает эти деньги.</p>
      <p><b>Сезонная линька</b>: все, начиная с попавшего, отступают на квадрат назад и делают то, что там написано. Кто стоит на старте — остаётся,
      а попавший получает за него 325.</p>`,
    demo: demo(
      (s) => {
        s.pos[0] = 4;
        s.pos[1] = 19;
        mailTop(s, mailId('Председателю'));
      },
      [
        { seat: 0, action: { type: 'roll' }, rig: [5, 3, 1], caption: 'Вовка на аукционе: оба ставят по 100, Вовка выбросил 4, Ленка 2 — 200 у Вовки.' },
        { seat: 1, action: { type: 'roll' }, rig: [0], caption: 'Ленка — на «Сезонной линьке»: оба отступают на день. Ленке — «Почта» (телеграмма), Вовке — «Клиент», но продавать нечего.' },
      ]
    ),
  },
  {
    title: 'День Белой Вороны и банк',
    html: `<p>В День Белой Вороны: <b>зарплата 325</b>; по вкладу банк платит <b>10 %</b>, по займу берёт <b>20 %</b> (заём до 100 — без процентов); оплатить все счета.
      Не хватает наличных — снимается со вклада или растёт заём. Потом можно положить деньги во вклад, снять его, погасить заём —
      только в этот день; взять в долг можно когда угодно. Вклад и заём сразу не бывают.</p>
      <p>Когда все дошли до Дня Белой Вороны последнего месяца, побеждает тот, у кого больше денег — или меньше всех долга.</p>`,
    demo: demo(
      (s) => {
        s.pos[0] = 28;
        s.cash[0] = 400;
        s.bank[0] = -300;
        s.bills[0] = [mailId('Посещение аттракционов')];
        s.mail = s.mail.filter((i) => !s.bills[0].includes(i));
      },
      [
        { seat: 0, action: { type: 'roll' }, rig: [5], caption: 'Вовка выбросил 6, но стоп — День Белой Вороны: +325, 60 процентов по займу 300 и счёт 25.' },
        { seat: 0, action: { type: 'bank', n: 300 }, caption: 'Гасит заём целиком.' },
        { seat: 0, action: { type: 'done' }, caption: 'Месяц закрыт — снова на старт.' },
      ]
    ),
  },
];

function showcase(): State {
  const rng = { next: () => 0.5, int: (n: number) => n - 1, getState: () => 0 };
  const s = newState('blue', [0, 1, 2, 3], 3, rng);
  s.pos = [12, 17, 23, 9, 0, 0];
  s.cash = [640, 215, 1180, 90, 0, 0];
  s.bank = [500, -400, 0, -150, 0, 0];
  s.biz[0] = [8];
  s.biz[2] = [3, 12];
  s.bills[1] = [2, 4];
  s.pot = 100;
  s.turn = s.actor = 1;
  s.dice = 5;
  s.month = [1, 1, 1, 1, 0, 0];
  return s;
}

export const def: GameDef<State, Action, Ev, State> = {
  id: 'vorona',
  title: 'Белая ворона',
  players: { min: 2, max: 6, default: 4 },
  seats: SEATS,
  options: [
    {
      key: 'variant',
      label: 'Издание',
      type: 'select',
      choices: [
        { value: 'blue', label: 'синее (ЦПР, 1990)' },
        { value: 'green', label: 'зелёное' },
      ],
      default: 'blue',
    },
    {
      key: 'months',
      label: 'Сколько месяцев',
      type: 'select',
      choices: [
        { value: 1, label: '1 месяц' },
        { value: 2, label: '2 месяца' },
        { value: 3, label: '3 месяца (около часа)' },
        { value: 6, label: '6 месяцев (около двух часов)' },
      ],
      default: 2,
    },
  ],
  presets: [
    { id: 'blue', label: 'Синее издание', hint: 'ЦПР, Москва: поле с «Тараканьими бегами» и «Бизнес — дубль»', options: { variant: 'blue', months: 2 } },
    { id: 'green', label: 'Зелёное издание', hint: 'другие бизнесы и цены, «Мяу-мяу» и «Звериная линька»', options: { variant: 'green', months: 2 } },
  ],
  setup: (seats, opts, rng) => {
    const ids = seats.map((x) => x.seat).sort((a, b) => a - b);
    return newState(opts.variant === 'green' ? 'green' : 'blue', ids, Number(opts.months) || 2, rng);
  },
  toAct,
  apply: (s, seat, a, rng) => {
    const r = apply(s, seat, a, rng);
    return r && { state: r.state, events: r.events.map((e) => ({ ...e, v: s.variant })) };
  },
  view: (s) => view(s),
  result: (s) => s.result,
  showcase,
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, level, rng) => choose(v, seat, level, rng) },
  describe: (ev, name) => describe(ev, name),
  rules: {
    goal: 'Прожить заданное число месяцев экономнее всех: платить по счетам, делать бизнес на клиентах, вовремя гасить займы — и закончить с самой большой суммой.',
    sections: RULES,
  },
};

const QUIET = new Set(['покупка бизнеса', 'Успех']);

function describe(ev: Ev, name: (seat: number) => string): string | null {
  const biz = BIZ[ev.v ?? 'blue'];
  const who = (w: number | null | 'pot') => (w === 'pot' ? 'на кон' : w == null ? 'банку' : name(w));
  switch (ev.type) {
    case 'roll':
      return `${name(ev.seat)} бросает: <b>${ev.d}</b>`;
    case 'pay':
      if (QUIET.has(ev.why)) return null;
      if (ev.from == null) return `${name(ev.to as number)} получает ${fmt(ev.amount)} — ${ev.why}`;
      if (ev.from === 'pot') return null;
      return `${name(ev.from)} платит ${fmt(ev.amount)} ${who(ev.to)} — ${ev.why}`;
    case 'loan':
      return `${name(ev.seat)}: не хватило наличных — ${fmt(ev.amount)} из банка${ev.auto ? '' : ''}`;
    case 'bank':
      return `${name(ev.seat)} ${ev.n > 0 ? 'вносит в банк' : 'берёт из банка'} ${fmt(Math.abs(ev.n))} — ${ev.bank > 0 ? `вклад ${fmt(ev.bank)}` : ev.bank < 0 ? `заём ${fmt(-ev.bank)}` : 'счёт закрыт'}`;
    case 'mail': {
      const m = MAIL[ev.id];
      const t = `«${m.who}»: <i>${m.text}</i>`;
      if (ev.res === 'bill') return `✉ ${name(ev.seat)} — счёт ${t}, оплатить ${fmt(m.n)}`;
      if (ev.res === 'covered') return `✉ ${name(ev.seat)} — счёт ${t}: погашен ${m.tag === 'vet' ? 'страховкой' : 'охотничьим билетом'}`;
      if (ev.res === 'take') return `✉ ${name(ev.seat)} — «Успех»: <i>${m.text}</i>, +${fmt(m.n)}`;
      if (ev.res === 'bond') return `✉ ${name(ev.seat)} — облигация лесного займа на ${fmt(m.n)}`;
      if (ev.res === 'junk') return `✉ ${name(ev.seat)} — ${m.who.toLowerCase()}: в корзину`;
      return `✉ ${name(ev.seat)} — «${m.who}»`;
    }
    case 'insure':
      return `${name(ev.seat)} ${ev.buy ? 'покупает' : 'отбрасывает'}: ${MAIL[ev.id].who.toLowerCase()}`;
    case 'risk':
      return `🎲 ${name(ev.seat)} рискует: ${ev.d} — ${ev.win ? 'выигрыш 1000!' : 'ставка пропала'}`;
    case 'biz':
      return ev.buy == null ? `${name(ev.seat)} открывает бизнес: «${biz[ev.id].name}»` : ev.buy ? `${name(ev.seat)} покупает бизнес «${biz[ev.id].name}» за ${fmt(biz[ev.id].cost)}` : `${name(ev.seat)} не покупает`;
    case 'sell':
      return `🤝 ${name(ev.seat)} продаёт клиенту «${biz[ev.id].name}» за ${fmt(ev.price)}${ev.to != null ? `; комиссионные ${fmt(ev.fee)} — ${name(ev.to)} (${ev.rolls[ev.rolls.length - 1].map((r) => r.d).join(':')})` : ''}`;
    case 'auction':
      return `🔨 Аукцион: ${ev.rolls.map((r) => r.map((q) => `${name(q.seat)} ${q.d}`).join(', ')).join(' → ')} — ${name(ev.winner)} забирает ${fmt(ev.pot)}`;
    case 'election':
      return `👑 ${name(ev.seat)} выбросил 6 — деньги выборов царя зверей (${fmt(ev.pot)}) его`;
    case 'bonds':
      return `🌲 ${name(ev.seat)} в День тиража гасит облигации: +${fmt(ev.amount)}`;
    case 'payday':
      return `🐦 ${name(ev.seat)}: День Белой Вороны, ${ev.month}-й месяц — зарплата 325${ev.interest > 0 ? `, +${fmt(ev.interest)} по вкладу` : ev.interest < 0 ? `, −${fmt(-ev.interest)} по займу` : ''}${ev.bills ? `, счета ${fmt(ev.bills)}` : ''}`;
    case 'done':
      return `${name(ev.seat)} отыграл все месяцы`;
    case 'end':
      return `🏆 ${ev.winners.map(name).join(', ')} — ${ev.text}`;
  }
  return null;
}
