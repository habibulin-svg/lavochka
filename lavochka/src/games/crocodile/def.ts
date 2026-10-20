/* Крокодил — описание игры для сборника: покажи слово без слов и звуков, остальные угадывают. 2–10 игроков;
 * каждый сам за себя или командами; слова, пословицы, фильмы; слово из словаря или загадывает предыдущий показывающий;
 * время, пропуск, кивки, очки показывающему — настройками. «Эмодзи-крокодил» — показывают эмодзи из набора.
 * Боты показывают и угадывают карточками (что изобразил бы мим). Правила с показом. Без DOM. */
import type { GameDef, Rng, SeatSpec } from '../../core/types';
import { esc } from '../../core/util';
import { LEVELS, WORDS } from '../hat/words';
import { choose } from './ai';
import { apply, makeView, redact, setup, teamScore, teamsOf, toAct, total, type Action, type Event, type State, type View } from './engine';
import { FILMS, PROVERBS } from './phrases';
import { cardText, EMOJI, KIND_NAME, THEMES, type Item } from './words';

export const SEATS = [
  ['Вовка', '#b3322a'], ['Ленка', '#2b5c9e'], ['Серёга', '#2f7a3e'], ['Танька', '#c48a12'], ['Димон', '#6a3d8f'],
  ['Светка', '#c2185b'], ['Жека', '#0f7a7a'], ['Михалыч', '#8a5a2a'], ['Олька', '#7a3aa0'], ['Колян', '#5a5a5a'],
].map(([name, color]) => ({ name, color, light: color, dark: color }));

export const NOD_TEXT = { yes: 'кивает 👍', close: 'показывает «близко» 🤏', no: 'мотает головой 👎' } as const;

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'turn':
      return `🐊 Показывает ${name(ev.shower)}${ev.picker != null ? `, загадывает ${name(ev.picker)}` : ''}.`;
    case 'picked':
      return ev.own ? `${name(ev.picker)} загадал своё.` : null;
    case 'draw':
      return ev.kind === 'p' || ev.kind === 'f' ? `Показывает ${KIND_NAME[ev.kind]}.` : null;
    case 'card':
      return `${name(ev.seat)} показывает: ${esc(cardText(ev.card))}`;
    case 'guess':
      return ev.res === 'right' ? null : `${name(ev.seat)}: «${esc(ev.text)}?»${ev.res === 'near' ? ' — почти!' : ''}`;
    case 'nod':
      return `${name(ev.seat)} ${NOD_TEXT[ev.val]}`;
    case 'skip':
      return `⏭ Пропуск — было «${esc(ev.w)}».`;
    case 'done':
      return ev.res === 'got'
        ? `✓ ${name(ev.by!)} угадал: <b>${esc(ev.w)}</b>`
        : `${ev.res === 'timeup' ? '⏰ Время!' : '🏳 Сдался.'} Было: <b>${esc(ev.w)}</b>`;
    case 'over':
      return '🏆 Игра окончена.';
  }
  return null;
}

// ---------------------------------------------------------------- показ правил

const W = (w: string): Item => ({ k: 'w', i: Math.max(0, WORDS.findIndex((e) => e.w === w)) });
const rngZero: Rng = { next: () => 0, int: () => 0, getState: () => 0 };
const demoSeats = (n: number, humans = 0): SeatSpec[] =>
  Array.from({ length: n }, (_, seat) => ({ seat, kind: seat < humans ? 'human' : 'bot', name: SEATS[seat].name, level: 1 }));
/** Позиция для показа: показывает Вовка, слово задано. */
function fixed(n: number, item: Item | null, humans: number[], opts: Record<string, unknown> = {}): State {
  const s = setup(
    Array.from({ length: n }, (_, i) => i),
    { time: 120, rounds: 2, ...opts } as never,
    rngZero,
    humans
  );
  if (item && s.phase === 'ready') s.item = item;
  if (item && s.phase === 'pick') s.offers = [item, W('валенок'), W('телевизор')];
  return s;
}
const step = (seat: number, action: Action, caption?: string) => ({ seat, action, caption });

export const def: GameDef<State, Action, Event, View> = {
  id: 'crocodile',
  title: 'Крокодил',
  players: { min: 2, max: 10, default: 4 },
  teams: (o, seats) => (o.mode === 'teams' && seats.length >= 4 ? teamsOf(seats) : null),
  countsFor: (o) => (o.mode === 'teams' ? [4, 5, 6, 7, 8, 9, 10] : [2, 3, 4, 5, 6, 7, 8, 9, 10]),
  countsHint: (o) => (o.mode === 'teams' ? 'две команды — от четырёх' : undefined),
  seats: SEATS,
  options: [
    {
      key: 'style',
      label: 'Как показывают',
      type: 'select',
      choices: [
        { value: 'gesture', label: 'жестами' },
        { value: 'emoji', label: 'эмодзи из набора' },
      ],
      default: 'gesture',
      hint: 'Эмодзи-крокодил: вместо пантомимы — картинки, удобно по сети и с ботами.',
    },
    {
      key: 'mode',
      label: 'Кто угадывает',
      type: 'select',
      choices: [
        { value: 'solo', label: 'все — каждый сам за себя' },
        { value: 'teams', label: 'своя команда (две команды)' },
      ],
      default: 'solo',
    },
    { key: 'theme', label: 'Что показывают', type: 'select', choices: THEMES.map(([value, label]) => ({ value, label })), default: 'words', showIf: (o) => o.style !== 'emoji' },
    {
      key: 'level',
      label: 'Сложность слов',
      type: 'select',
      choices: LEVELS.map(([value, label]) => ({ value, label })),
      default: 'easy',
      showIf: (o) => o.style === 'emoji' || o.theme === 'words' || o.theme === 'mix' || o.theme == null,
    },
    {
      key: 'source',
      label: 'Слово',
      type: 'select',
      choices: [
        { value: 'dict', label: 'случайно из словаря' },
        { value: 'pick', label: 'загадывает предыдущий показывающий' },
      ],
      default: 'dict',
      hint: 'Командами загадывают соперники. Из трёх на выбор или своё (своё — когда угадывают одни люди).',
    },
    {
      key: 'time',
      label: 'Время на слово',
      type: 'select',
      choices: [
        { value: 60, label: '1 минута' },
        { value: 120, label: '2 минуты' },
        { value: 180, label: '3 минуты' },
        { value: 0, label: 'без времени' },
      ],
      default: 120,
    },
    {
      key: 'skip',
      label: 'Пропуск слова',
      type: 'select',
      choices: [
        { value: 'free', label: 'можно' },
        { value: 'one', label: 'один раз за ход' },
        { value: 'off', label: 'нельзя' },
      ],
      default: 'free',
    },
    {
      key: 'order',
      label: 'Кто показывает следующим',
      type: 'select',
      choices: [
        { value: 'guesser', label: 'угадавший' },
        { value: 'circle', label: 'по кругу' },
      ],
      default: 'guesser',
      showIf: (o) => o.mode !== 'teams',
    },
    {
      key: 'score',
      label: 'Очко за слово',
      type: 'select',
      choices: [
        { value: 'both', label: 'угадавшему и показывающему' },
        { value: 'guesser', label: 'только угадавшему' },
      ],
      default: 'both',
      showIf: (o) => o.mode !== 'teams',
    },
    { key: 'rounds', label: 'Показов на каждого', type: 'select', choices: [1, 2, 3, 5].map((value) => ({ value, label: String(value) })), default: 2, hint: 'Сколько ходов в партии: по столько на игрока.' },
    { key: 'nod', label: 'Можно кивать «да / нет / близко»', type: 'toggle', default: true },
  ],
  presets: [
    { id: 'classic', label: 'Классика', hint: 'Все угадывают, угадавший показывает следующим, 2 минуты', options: { style: 'gesture', mode: 'solo', theme: 'words', level: 'easy', source: 'dict', time: 120, order: 'guesser' } },
    { id: 'teams', label: 'Командами', hint: 'Показываешь своей команде минуту, слово загадывают соперники', options: { style: 'gesture', mode: 'teams', theme: 'words', level: 'mid', source: 'pick', time: 60, skip: 'one' } },
    { id: 'proverbs', label: 'Пословицы', hint: 'Пословицу показывают по словам', options: { style: 'gesture', mode: 'solo', theme: 'proverbs', time: 180 } },
    { id: 'films', label: 'Кино и мультфильмы', hint: 'Названия фильмов и мультфильмов', options: { style: 'gesture', mode: 'solo', theme: 'films', time: 180 } },
    { id: 'emoji', label: 'Эмодзи-крокодил', hint: 'Показывают эмодзи из набора — по сети и с ботами на равных', options: { style: 'emoji', mode: 'solo', level: 'easy', time: 120, source: 'dict' } },
    { id: 'home', label: 'Загадываем сами', hint: 'Слово даёт предыдущий показывающий, без времени', options: { style: 'gesture', mode: 'solo', theme: 'words', source: 'pick', time: 0, order: 'guesser' } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng, seats.filter((x) => x.kind !== 'bot').map((x) => x.seat)),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  redact,
  result(s) {
    if (s.phase !== 'over') return null;
    const scores: Record<number, number> = {};
    if (s.teams) {
      const sc = s.teams.map((t) => teamScore(s, t));
      const best = Math.max(...sc);
      s.teams.forEach((t, j) => t.forEach((x) => (scores[x] = sc[j])));
      return { winners: s.teams.filter((_, j) => sc[j] === best).flat(), text: `команда угадала больше слов (${best})`, scores };
    }
    for (const x of s.seats) scores[x] = total(s, x);
    const best = Math.max(...s.seats.map((x) => scores[x]));
    return { winners: s.seats.filter((x) => scores[x] === best), text: `больше всех очков (${best})`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    const s = fixed(5, W('крокодил'), [], { nod: true });
    const r = apply(s, 0, { type: 'start' }, rngZero)!.state;
    r.virt = false;
    r.cards = [{ k: 'syl', n: 3 }, { k: 'emo', es: ['🐊'] }];
    r.dealt = [0, 1];
    r.tries = [
      { id: 1, seat: 2, text: 'ящерица', res: 'no', nod: 'close' },
      { id: 2, seat: 3, text: 'дракон', res: 'no', nod: 'no' },
    ];
    r.tryId = 2;
    r.used = 47000;
    r.pts = { 0: 2, 1: 3, 2: 1, 3: 0, 4: 2 };
    r.shown = { 0: 2, 1: 1, 2: 1, 3: 1, 4: 0 };
    r.t = 6;
    return r;
  },

  rules: {
    goal: 'Покажи слово без слов и звуков — жестами, мимикой, всем телом. Кто угадал — получает очко и показывает следующим.',
    sections: [
      {
        title: 'Показ',
        html: `<p>Показывающий тайно видит слово и показывает его <b>без единого звука</b>: нельзя говорить, шептать, проговаривать губами,
          рисовать буквы в воздухе и показывать на предметы вокруг. Можно — жесты, мимику, позы, «звучит как» жестом уха.</p>
          <p>Остальные угадывают вслух (по сети — и в поле). Угадал — очко угадавшему и, по настройке, показывающему; кто угадал, тот и показывает
          следующим (или по кругу). Слово видит только показывающий: по сети — на своём экране, на одном телефоне — за занавеской.</p>`,
        demo: {
          seats: demoSeats(3, 3),
          setup: () => fixed(3, W('самовар'), [0, 1, 2]),
          intro: 'Вовка показывает, Ленка и Серёга угадывают.',
          steps: [
            step(0, { type: 'start' }, 'Вовка смотрит слово — «самовар» — и кладёт телефон. Изображает: пузатое, на столе, пар идёт, чай наливает…'),
            step(0, { type: 'got', by: 1 }, 'Ленка: «Самовар!» — Вовка жмёт «Угадала Ленка». Очко ей и Вовке, следующей показывает Ленка.'),
          ],
        },
      },
      {
        title: 'Условные жесты',
        html: `<p>По двору ходят договорённости — они не нарушают правил:</p>
          <ul><li><b>слогов / слов столько-то</b> — пальцами, потом номер слова, которое показываешь;</li>
          <li><b>«часть слова»</b> — ребро ладони по руке; <b>«звучит как»</b> — ладонь к уху;</li>
          <li><b>«тепло-холодно»</b>, «ближе», «наоборот», «множественное число» — руками.</li></ul>
          <p>С настройкой <b>«можно кивать»</b> показывающий кивает «да», мотает «нет» или показывает «близко» —
          по сети это кнопки у каждой догадки.</p>`,
      },
      {
        title: 'Догадки в поле',
        html: `<p>По сети догадку можно не только сказать, но и написать. Верное слово засчитывается само — без разницы, большие буквы, «е» или «ё».
          Если написано почти верно — другая форма («кошки» вместо «кошка»), опечатка, пословица без пары слов — решает показывающий:
          у догадки появляется кнопка «засчитать».</p>`,
        demo: {
          seats: demoSeats(3, 3),
          setup: () => fixed(3, W('кошка'), [0, 1, 2]),
          intro: 'Вовка показывает «кошку» по видео, остальные пишут.',
          steps: [
            step(0, { type: 'start' }),
            step(1, { type: 'guess', text: 'собака' }, 'Ленка пишет «собака»…'),
            step(0, { type: 'nod', id: 1, val: 'close' }, '…Вовка показывает «близко».'),
            step(2, { type: 'guess', text: 'кошки' }, 'Серёга: «кошки» — почти!'),
            step(0, { type: 'accept', id: 2 }, 'Вовка засчитывает: очко Серёге.'),
          ],
        },
      },
      {
        title: 'Время и пропуск',
        html: `<p>На слово — 1, 2 или 3 минуты (или без времени). Не угадали за время — слово открывается, очков нет, показывает следующий по кругу.
          Не идёт слово — <b>пропуск</b>: новое слово, часы не останавливаются (по настройке — один раз за ход или нельзя).
          Показывающий может и <b>сдаться</b>.</p>`,
        demo: {
          seats: demoSeats(3, 3),
          setup: () => fixed(3, W('абонемент'), [0, 1, 2], { skip: 'one', time: 60 }),
          intro: 'Минута на слово, пропуск — один.',
          steps: [
            step(0, { type: 'start' }, '«Абонемент» — как это показать?!'),
            step(0, { type: 'skip' }, 'Пропуск — новое слово, часы идут дальше.'),
            step(1, { type: 'timeup' }, 'Минута вышла — слово открывается, очков нет.'),
          ],
        },
      },
      {
        title: 'Кто загадывает',
        html: `<p><b>Из словаря</b> — слово выпадает случайно нужной сложности. <b>Загадываем сами</b> — по классике слово следующему даёт
          предыдущий показывающий: выбирает из трёх или пишет своё (своё — если угадывают одни люди: ботам нечем его понять). Загадавший знает слово — сам не угадывает.</p>`,
      },
      {
        title: 'Командами',
        html: `<p>Две команды (сидят через одного). Показывают по очереди — своей команде, на время; слово загадывает соперник.
          Угадала команда — ей очко. Побеждает команда, угадавшая больше.</p>`,
        demo: {
          seats: demoSeats(4, 4),
          setup: () => fixed(4, W('гармошка'), [0, 1, 2, 3], { mode: 'teams', source: 'pick', time: 60 }),
          intro: 'Вовка и Серёга против Ленки и Таньки.',
          steps: [
            step(1, { type: 'offer', k: 0 }, 'Ленка из соперников загадывает Вовке «гармошку».'),
            step(0, { type: 'start' }, 'Вовка показывает своей команде — Серёге.'),
            step(0, { type: 'got', by: 2 }, 'Серёга угадал — очко команде.'),
          ],
        },
      },
      {
        title: 'Пословицы и фильмы',
        html: `<p>Пословицу или название показывают <b>по словам</b>: сначала сколько слов (пальцами), потом слово за словом — в любом порядке,
          номер слова — пальцами. Фильм — жестом «кинокамера» (крутить ручку у глаза), мультфильм — тоже. Засчитывается и почти целиком угаданная фраза — решает показывающий.</p>
          <p>Пословиц в игре ${PROVERBS.length}, фильмов и мультфильмов — ${FILMS.length}.</p>`,
        demo: {
          seats: demoSeats(3),
          setup: () => fixed(3, { k: 'p', i: 0 }, [], { theme: 'proverbs' }),
          intro: 'Три бота: Вовка показывает пословицу.',
          steps: [
            step(0, { type: 'start' }),
            step(0, { type: 'card', dt: 3000 }, 'Пальцами: «в пословице восемь слов».'),
            step(1, { type: 'pass', dt: 1500 }),
            step(2, { type: 'pass', dt: 1500 }),
            step(0, { type: 'card', dt: 4000 }, 'Показывает самое длинное слово — «выловишь» (удочку закинул).'),
            step(1, { type: 'guess', text: 'Без труда не выловишь и рыбку из пруда', dt: 2000 }, 'Ленка: «Без труда не выловишь и рыбку из пруда!»'),
          ],
        },
      },
      {
        title: 'Боты',
        html: `<p>Жестов бот не видит и не показывает — играет честно <b>карточками</b>: это то, что изобразил бы мим, от общего к точному —
          «слогов столько-то», эмодзи-картинка, «что это» (толкование из словаря), синоним; у пословиц и фильмов — число слов и слова по одному.
          Угадывает бот только по показанным карточкам: перебирает слова, которые ко всем подходят (и отбрасывает чужие неверные догадки);
          сильный называет самое ходовое, слабый — наугад и реже решается.</p>
          <p>Человек, показывая ботам, кроме жестов выкладывает карточки из набора (по одному телефону — по одной, чтобы не подсмотрели).
          Свои слова боты не понимают — их можно, только когда угадывают одни люди. На равных с ботами — <b>эмодзи-крокодил</b>.</p>`,
        demo: {
          seats: demoSeats(3),
          setup: () => fixed(3, W('самолёт'), []),
          intro: 'Три бота: Вовка показывает карточками.',
          steps: [
            step(0, { type: 'start' }),
            step(0, { type: 'card', dt: 3000 }, '«Три слога» — пальцами по руке.'),
            step(1, { type: 'pass', dt: 1200 }),
            step(2, { type: 'pass', dt: 1200 }),
            step(0, { type: 'card', dt: 3000 }, 'Следующая карточка — что он изобразил бы руками.'),
            step(1, { type: 'guess', text: 'самолёт', dt: 1500 }, 'Ленка: «Самолёт!»'),
          ],
        },
      },
      {
        title: 'Эмодзи-крокодил',
        html: `<p>Вариант для сети: показывают не руками, а <b>эмодзи из набора</b> — ищешь картинку по слову и выкладываешь по одной или по несколько.
          Буквы, цифры-слова и иероглифы из набора убраны. Слова — только те, что можно изобразить картинками (около девятисот, в основном лёгкие).
          Тут боты угадывают и показывают на равных с людьми: и человек, и бот понимают эмодзи по их русским подписям.</p>`,
        demo: {
          seats: demoSeats(3, 1),
          setup: () => fixed(3, W('мёд'), [0], { style: 'emoji' }),
          intro: 'Вы показываете «мёд» эмодзи двум ботам.',
          steps: [
            step(0, { type: 'start' }),
            step(0, { type: 'emo', list: ['🐝'] }, 'Пчела…'),
            step(1, { type: 'guess', text: 'улей' }, 'Ленка: «Улей?»'),
            step(0, { type: 'emo', list: ['🍯'] }, '…и горшочек.'),
            step(2, { type: 'guess', text: 'мёд' }, 'Серёга: «Мёд!»'),
          ],
        },
      },
      {
        title: 'Камера по сети',
        html: `<p>По сети показывающего видно по камере: включите на столе «📷 С камерой» — пока он показывает, его видео у всех крупно над ковром.
          Голос у всех открыт — угадывайте вслух, а показывающий отмечает, кто угадал. Сам показывающий молчит!</p>`,
      },
      {
        title: 'Слова и авторы',
        html: `<p>Словарь — ${WORDS.length.toLocaleString('ru')} существительных трёх уровней из «Шляпы»: список «Russian Nouns» Антона Сергиенко
          (<a href="https://github.com/Harrix/Russian-Nouns" target="_blank" rel="noopener">github.com/Harrix/Russian-Nouns</a>, MIT), толкования для ботов
          написаны для сборника заново. Эмодзи и их русские подписи (${EMOJI.length}) — Unicode CLDR
          (<a href="https://github.com/unicode-org/cldr-json" target="_blank" rel="noopener">cldr-json</a>, Unicode License v3).
          Пословицы — народные (общественное достояние), названия фильмов и мультфильмов собраны для сборника.</p>`,
      },
    ],
  },
};
