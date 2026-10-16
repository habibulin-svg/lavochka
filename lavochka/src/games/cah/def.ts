/* Карты против человечества (18+) — описание игры для сборника: очки до победы, домашние правила, пустые карты; боты; правила с показом. Без DOM.
 * Cards Against Humanity — Cards Against Humanity LLC, CC BY-NC-SA 2.0; тексты карт и правил — официальная русская версия с cardsagainsthumanity.com. */
import type { GameDef, Rng, SeatSpec } from '../../core/types';
import { esc } from '../../core/util';
import { choose } from './ai';
import { apply, BLACK, blackText, fillParts, GOALS, makeView, RANDO, setup, toAct, WHITE, whiteText, type Action, type Event, type State, type View } from './engine';

export const SEATS = [
  ['Вовка', '#b3322a'], ['Ленка', '#2b5c9e'], ['Серёга', '#2f7a3e'], ['Танька', '#c48a12'], ['Димон', '#6a3d8f'],
  ['Светка', '#c2185b'], ['Жека', '#0f7a7a'], ['Михалыч', '#8a5a2a'], ['Олька', '#7a3aa0'], ['Колян', '#5a5a5a'],
].map(([name, color]) => ({ name, color, light: color, dark: color }));

const who = (seat: number, name: (s: number) => string) => (seat === RANDO ? '<b>Рандо Кардриссиан</b>' : name(seat));

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'round':
      return `<b>${ev.final ? 'Последний раунд — хайку!' : `Раунд ${ev.round}`}</b>${ev.czar != null ? ` · Царь — ${name(ev.czar)}` : ' · Царя нет, голосуют все'}. «${esc(blackText(ev.black)).replace(/_/g, '_____')}»${ev.extra ? ` Все берут ещё ${ev.extra}.` : ''}`;
    case 'played':
      return ev.bet ? `${name(ev.seat)} кладёт карты — и ещё набор на залог очка.` : null;
    case 'reboot':
      return `🔄 ${name(ev.seat)} перезапускает вселенную: −1 очко, сброс ${ev.n} и добор.`;
    case 'judge':
      return `Все ответили — ${ev.n} ${ev.n < 5 ? 'ответа' : 'ответов'} вперемешку.`;
    case 'win': {
      const r = ev.rec;
      const lines = r.win.map((i) => {
        const u = r.subs[i];
        const text = fillParts(r.black, u.cards.map((c) => whiteText(c, u.texts)))
          .map((p) => (p.a ? `<u>${esc(p.t)}</u>` : esc(p.t)))
          .join('');
        return `${who(u.seat, name)}: «${text}»`;
      });
      const lost = Object.entries(r.gain)
        .filter(([, d]) => d < 0)
        .map(([x]) => who(+x, name));
      return `🏆 ${lines.join('; ')}${lost.length ? `. Залог проиграли: ${lost.join(', ')}` : ''}.`;
    }
    case 'over':
      return ev.rando != null && ev.rando > Math.max(...Object.values(ev.scores)) ? '🏁 Победил Рандо Кардриссиан. Все идут домой со стыдом.' : '🏁 Игра окончена.';
  }
  return null;
}

// ---------------------------------------------------------------- показ правил

const demoSeats = (n: number): SeatSpec[] => Array.from({ length: n }, (_, seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const fixedRng: Rng = { next: () => 0, int: () => 0, getState: () => 0 };
const W = (t: string) => {
  const i = WHITE.findIndex((w) => w.startsWith(t));
  if (i < 0) throw new Error(`нет белой карты «${t}»`);
  return i;
};
const B = (t: string) => {
  const i = BLACK.findIndex((b) => b.t.startsWith(t));
  if (i < 0) throw new Error(`нет чёрной карты «${t}»`);
  return i;
};

/** Позиция для показа: чёрная карта, Царь и начало рук заданы (остальное — из колоды). */
function pos(n: number, black: string, czar: number, hands: Record<number, string[]>, opts: Record<string, boolean | number> = {}): State {
  const s = setup(Array.from({ length: n }, (_, i) => i), { goal: 7, ...opts }, fixedRng);
  const take = (id: number) => {
    for (const x of s.seats) s.hands[x] = s.hands[x].filter((c) => c !== id);
    s.deck = s.deck.filter((c) => c !== id);
  };
  for (const [x, ts] of Object.entries(hands)) {
    const ids = ts.map(W);
    ids.forEach(take);
    s.hands[+x] = [...ids, ...s.hands[+x]].slice(0, Math.max(10, ids.length));
  }
  s.black = B(black);
  s.czar = opts.godless ? null : czar;
  s.rot = czar;
  return s;
}
/** Пресет: все домашние правила выключены, кроме перечисленных. */
const preset = (goal: number, on: Record<string, boolean> = {}) => ({ goal, gamble: true, rando: false, reboot: false, heat: false, happy: false, godless: false, ...on });
const act = (seat: number, action: Action, caption?: string, rig?: number[]) => ({ seat, action, caption, ...(rig ? { rig } : {}) });
const play = (cards: string[]): Action => ({ type: 'play', cards: cards.map(W) });

export const def: GameDef<State, Action, Event, View> = {
  id: 'cah',
  title: 'Карты против человечества',
  players: { min: 3, max: 10, default: 5 },
  seats: SEATS,
  options: [
    { key: 'goal', label: 'Играем до', type: 'select', choices: GOALS.map((g) => ({ value: g, label: `${g} очков` })), default: 7 },
    { key: 'gamble', label: 'Азартные игры', hint: 'можно поставить очко и сыграть второй набор карт', type: 'toggle', default: true },
    { key: 'blanks', label: 'Пустые карты', hint: 'впишите свой ответ; только когда за столом нет ботов', type: 'toggle', default: true },
    { key: 'rando', label: 'Рандо Кардриссиан', hint: 'воображаемый игрок кладёт случайные карты', type: 'toggle', default: false },
    { key: 'reboot', label: 'Перезапуск вселенной', hint: 'отдать очко и обменять карты из руки', type: 'toggle', default: false },
    { key: 'heat', label: 'С запасом', hint: 'на «Выберите 2» все сначала берут ещё карту', type: 'toggle', default: false },
    { key: 'happy', label: 'Счастливый конец', hint: 'последний раунд — «Сочините хайку»', type: 'toggle', default: false },
    { key: 'godless', label: 'Бог умер', hint: 'Царя нет — лучший ответ выбирают все голосованием', type: 'toggle', default: false },
  ],
  presets: [
    { id: 'classic', label: 'Классика', hint: 'По правилам: Карточный Царь по кругу, до 7 очков, азартные игры', options: preset(7) },
    { id: 'short', label: 'До 5 очков', hint: 'Короткая партия', options: preset(5) },
    { id: 'long', label: 'До 10 очков', hint: 'Длинная партия', options: preset(10) },
    { id: 'house', label: 'Домашние правила', hint: 'Рандо Кардриссиан, перезапуск вселенной, «с запасом» и хайку в конце', options: preset(7, { rando: true, reboot: true, heat: true, happy: true }) },
    { id: 'godless', label: 'Бог умер', hint: 'Без Царя: все кладут карты и голосуют', options: preset(7, { godless: true }) },
  ],

  setup: (seats, opts, rng) =>
    setup(
      seats.map((x) => x.seat).sort((a, b) => a - b),
      opts,
      rng,
      seats.filter((x) => x.kind !== 'bot').map((x) => x.seat),
      opts.blanks !== false && seats.every((x) => x.kind !== 'bot'),
    ),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  result(s) {
    if (s.phase !== 'over') return null;
    const best = Math.max(...s.seats.map((x) => s.scores[x] ?? 0));
    if (s.house.rando && s.rando > best) return { winners: [], text: `победил Рандо Кардриссиан (${s.rando}) — все идут домой со стыдом`, scores: { ...s.scores } };
    const winners = s.seats.filter((x) => (s.scores[x] ?? 0) === best);
    return { winners, text: `больше всех очков — ${best}`, scores: { ...s.scores } };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    const s = pos(5, 'Что это за запах', 2, {});
    s.round = 6;
    s.scores = { 0: 2, 1: 1, 2: 3, 3: 0, 4: 2 };
    s.subs = [
      { seat: 0, cards: [W('Холодный борщ')] },
      { seat: 1, cards: [W('Орда викингов')] },
      { seat: 3, cards: [W('Мужчина средних лет на роликах')] },
      { seat: 4, cards: [W('Неописуемое очарование')] },
    ];
    s.phase = 'judge';
    return s;
  },

  rules: {
    goal: 'Карточный Царь открывает чёрную карту — вопрос или фразу с пропуском. Остальные тайно отвечают белыми картами из руки. Царь выбирает самый смешной ответ — его автор получает очко. Игра для взрослых: 18+.',
    sections: [
      {
        title: 'Раунд',
        html: `<p>У каждого на руке десять белых карт. Первый Карточный Царь — «тот, кто последним какал» (здесь — жребий), дальше Царь идёт по кругу.</p>
          <p>Царь читает чёрную карту. Остальные кладут по белой карте рубашкой вверх. Когда все положили, Царь видит ответы <b>вперемешку и без имён</b>,
          зачитывает каждый вместе с чёрной картой и выбирает самый смешной. Автор получает очко — чёрную карту. Все добирают до десяти, Царь переходит к следующему.</p>
          <p>Играем до 5, 7 или 10 очков.</p>`,
        demo: {
          seats: demoSeats(4),
          setup: () => pos(4, 'Что это за запах', 0, { 1: ['Холодный борщ'], 2: ['Орда викингов'], 3: ['Мужчина средних лет на роликах'] }),
          intro: 'Царь — Вовка. На чёрной карте: «Что это за запах?»',
          steps: [
            act(1, { type: 'play', cards: [W('Холодный борщ')] }, 'Каждый тайно кладёт белую карту рубашкой вверх.'),
            act(2, { type: 'play', cards: [W('Орда викингов')] }),
            act(3, { type: 'play', cards: [W('Мужчина средних лет на роликах')] }, 'Все положили — Царь видит ответы вперемешку, без имён.', [2, 1]),
            act(0, { type: 'pick', index: 2 }, '«Что это за запах? — Мужчина средних лет на роликах». Очко — Таньке.'),
          ],
        },
      },
      {
        title: 'Выберите 2',
        html: `<p>На некоторых чёрных картах — «PICK 2» («Выберите 2»): каждый кладёт две белые карты <b>по порядку</b>, в котором Царь их зачитает
          (здесь — выбираете карты по очереди, номер виден на карте). На картах «PICK 3» — три, и перед этим все берут ещё две карты («DRAW 2»).</p>`,
        demo: {
          seats: demoSeats(3),
          setup: () => pos(3, 'Шаг 1:', 2, { 0: ['Сельское хозяйство', 'Активное слушание'], 1: ['Орда викингов', 'Пятичасовая игровая сессия'] }),
          intro: 'Царь — Серёга: «Шаг 1: _. Шаг 2: _. Шаг 3: Прибыль.»',
          steps: [
            act(0, play(['Сельское хозяйство', 'Активное слушание']), 'Вовка: сначала «Сельское хозяйство», потом «Активное слушание».'),
            act(1, play(['Орда викингов', 'Пятичасовая игровая сессия']), 'Ленка кладёт свои две.', [1]),
            act(2, { type: 'pick', index: 1 }, 'Серёге смешнее викинги — очко Ленке.'),
          ],
        },
      },
      {
        title: 'Азартные игры',
        html: `<p>Если у вас больше одной карты, которая, по-вашему, может выиграть, можно поставить <b>одно очко</b> и сыграть ещё один набор.
          Выиграли — очко остаётся при вас. Проиграли — отдайте залог победителю раунда. (Можно выключить в настройках.)</p>`,
        demo: {
          seats: demoSeats(4),
          setup: () => {
            const s = pos(4, 'Я пью, чтобы забыть', 3, { 0: ['Пятичасовая игровая сессия', 'Соглашение о неразглашении'], 1: ['Опухоль мозга'], 2: ['Ошибка'] });
            s.scores = { 0: 2, 1: 1, 2: 1, 3: 2 };
            return s;
          },
          intro: 'Царь — Танька: «Я пью, чтобы забыть вот это: _». У Вовки два хороших ответа и два очка.',
          steps: [
            act(0, { type: 'play', cards: [W('Пятичасовая игровая сессия')], bet: [W('Соглашение о неразглашении')] }, 'Вовка ставит очко и кладёт обе карты.'),
            act(1, { type: 'play', cards: [W('Опухоль мозга')] }),
            act(2, { type: 'play', cards: [W('Ошибка')] }, 'Четыре ответа вперемешку — два из них Вовкины.', [3, 2, 1]),
            act(3, { type: 'pick', index: 3 }, 'Танька выбирает «Ошибку» — очко Серёге, и Вовкин залог тоже уходит ему.'),
          ],
        },
      },
      {
        title: 'Пустые карты',
        html: `<p>Когда за столом одни люди (по сети или за одним экраном), в колоду подмешаны 30 <b>пустых карт</b>: попалась такая — впишите в неё свой ответ.
          С ботами пустых карт нет — бот их не поймёт.</p>
          <p>За одним экраном каждый смотрит свою руку за занавеской; Царь выбирает при всех. По сети — у стола есть чат и голос.</p>`,
      },
      {
        title: 'Домашние правила',
        html: `<p>Официальные домашние правила — включаются в настройках:</p>
          <ul><li><b>Рандо Кардриссиан.</b> Каждый раунд воображаемый игрок Рандо кладёт верхние карты колоды. Если он наберёт больше всех — все идут домой со стыдом.</li>
          <li><b>Перезапуск вселенной.</b> Перед ходом можно отдать одно очко, сбросить сколько угодно белых карт и добрать до десяти.</li>
          <li><b>С запасом.</b> На «Выберите 2» все сначала берут ещё одну карту — чтобы было из чего выбрать.</li>
          <li><b>Счастливый конец.</b> Когда кто-то набрал нужные очки, играется последний раунд — «Сочините хайку» (выберите 3).</li>
          <li><b>Бог умер.</b> Царя нет: карты кладут все, а потом голосуют за лучший ответ (за свой нельзя). Ничья — очко всем, кто набрал больше всех голосов.</li></ul>`,
        demo: {
          seats: demoSeats(3),
          options: { rando: true },
          setup: () => pos(3, 'Чего в раю навалом', 0, { 1: ['Холодный борщ'], 2: ['Стукач'] }, { rando: true }),
          intro: 'Рандо Кардриссиан тоже играет — кладёт верхнюю карту колоды.',
          steps: [
            act(1, { type: 'play', cards: [W('Холодный борщ')] }),
            act(2, { type: 'play', cards: [W('Стукач')] }, 'Ответов три: Ленкин, Серёгин и Рандо.', [2, 1]),
            act(0, { type: 'pick', index: 2 }, 'Царь выбрал карту Рандо. Очко — воображаемому игроку.'),
          ],
        },
      },
      {
        title: 'Боты',
        html: `<p>Юмора бот не понимает — играет по честным приметам. Лёгкий — наугад. Средний подбирает ответ по форме: на «кто?» — человека,
          после «нравится» и «чтобы» — действие, на «Выберите 2» — покороче. Сложный ещё и запоминает, какие ответы брал текущий Царь (длинные или короткие,
          приличные или шокирующие, про людей или про дела), и подстраивается под него; Царём выбирает по своей оценке.</p>`,
      },
      {
        title: 'Авторы и лицензия',
        html: `<p><b>Cards Against Humanity</b> — игра Cards Against Humanity LLC (Josh Dillon, Daniel Dranove, Eli Halpern, Ben Hantoot, David Munk, David Pinsof, Max Temkin, Eliot Weinstein).
          Тексты карт и правил — официальная русская версия с <a href="https://www.cardsagainsthumanity.com/" target="_blank" rel="noopener">cardsagainsthumanity.com</a>
          (переводчики в файле не указаны); перевод отредактирован для этой версии: язык, падежи пропусков, опечатки, несколько американских реалий заменены нашими. «Cards Against Humanity» — зарегистрированный товарный знак Cards Against Humanity LLC.</p>
          <p>Игра распространяется по лицензии <a href="https://creativecommons.org/licenses/by-nc-sa/2.0/deed.ru" target="_blank" rel="noopener">CC BY-NC-SA 2.0</a>:
          только некоммерческое использование, с указанием авторов. Эта электронная версия — производная работа, распространяется по той же лицензии.
          <a href="/cah/credits.html" target="_blank">Подробнее</a>.</p>`,
      },
    ],
  },
};
