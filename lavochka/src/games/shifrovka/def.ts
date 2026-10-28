/* Шифровка — описание игры для сборника: две команды (или одна против соперника), капитаны, подсказки, ловушка; боты; правила с показом. Без DOM. */
import type { GameDef, Rng, SeatSpec } from '../../core/types';
import { alternate } from '../../core/teams';
import { choose } from './ai';
import { apply, makeView, nText, setup, TEAM_NAME, TEAM_OF, toAct, type Action, type Event, type Kind, type State, type View } from './engine';

export const SEATS = [
  ['Вовка', '#c0392b'], ['Ленка', '#2b5c9e'], ['Серёга', '#d35400'], ['Танька', '#1f7a9e'], ['Димон', '#a8326e'],
  ['Светка', '#4b3c9e'], ['Жека', '#b5651d'], ['Михалыч', '#2f6f7a'], ['Олька', '#9e2b4a'], ['Колян', '#3a5a8a'],
].map(([name, color]) => ({ name, color, light: color, dark: color }));

const KIND: Record<string, string> = { 0: 'красное', 1: 'синее', n: 'нейтральное', x: 'ловушка' };

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'turn':
      return `${ev.coop ? 'Новый ход' : `Ход ${TEAM_OF[ev.team]}`}: капитан ${name(ev.captain)} думает над подсказкой.`;
    case 'clue':
      return `🔐 ${name(ev.by)}: «<b>${ev.word}</b>, ${nText(ev.n)}».`;
    case 'guess':
      return `${name(ev.seat)} открывает «${ev.word}» — ${ev.kind === 'x' ? '💣 ловушка!' : KIND[String(ev.kind)]}.`;
    case 'stop':
      return `${name(ev.seat)}: «Хватит, передаём ход».`;
    case 'rival':
      return `Соперник открывает своё слово «${ev.word}».`;
    case 'over':
      return `🏁 ${ev.winner == null ? 'Поражение' : `Победа: ${TEAM_NAME[ev.winner]}`} — ${ev.reason}.`;
  }
  return null;
}

// ---------------------------------------------------------------- показ правил

const demoSeats = (n: number): SeatSpec[] => Array.from({ length: n }, (_, seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const fixedRng: Rng = { next: () => 0, int: () => 0, getState: () => 0 };

const DEMO_WORDS = 'ключ,замок,корона,лиса,мёд,пчела,кит,море,якорь,мышь,компьютер,сыр,луна,ракета,звезда,лук,стрела,рыцарь,банк,касса,пирог,снег,шарф,Париж,гроза'.split(',');
const DEMO_KEY = '0,0,0,1,0,0,1,1,1,n,n,1,0,0,0,1,n,0,1,n,n,n,1,n,x'.split(',').map((k) => (k === 'n' || k === 'x' ? k : +k)) as Kind[];

/** Позиция для показа: поле задано, ход команды turn. */
function pos(n: number, extra: Partial<State> = {}, coop = false): State {
  const s = setup(Array.from({ length: n }, (_, i) => i), { mode: coop ? 'coop' : 'teams' }, fixedRng);
  s.words = DEMO_WORDS.slice();
  s.key = DEMO_KEY.slice();
  s.turn = 0;
  return Object.assign(s, extra);
}
const act = (seat: number, action: Action, caption?: string) => ({ seat, action, caption });
const at = (w: string) => DEMO_WORDS.indexOf(w);

export const def: GameDef<State, Action, Event, View> = {
  id: 'shifrovka',
  title: 'Шифровка',
  players: { min: 2, max: 10, default: 4 },
  countsFor: (o) => (o.mode === 'coop' ? [2, 3, 4, 5, 6, 7, 8] : [4, 5, 6, 7, 8, 9, 10]),
  countsHint: (o) => (o.mode === 'coop' ? 'одной командой: капитан и отгадчики' : 'две команды — от четырёх; капитаны — первые места команд'),
  teams: (o, seats) => (o.mode === 'coop' ? null : alternate(seats)),
  seats: SEATS,
  options: [
    {
      key: 'mode',
      label: 'Как играем',
      type: 'select',
      choices: [
        { value: 'teams', label: 'две команды' },
        { value: 'coop', label: 'одной командой против соперника' },
      ],
      default: 'teams',
    },
    {
      key: 'traps',
      label: 'Ловушки',
      hint: 'с тремя ловушками нейтральных слов меньше — подсказывать опаснее',
      type: 'select',
      choices: [
        { value: 1, label: 'одна' },
        { value: 3, label: 'три' },
      ],
      default: 1,
    },
    { key: 'topo', label: 'Города и страны', hint: 'на поле 1–3 известных топонима', type: 'toggle', default: true },
  ],
  presets: [
    { id: 'teams', label: 'Две команды', hint: 'Красные против синих, у каждой свой капитан', options: { mode: 'teams', traps: 1, topo: true } },
    { id: 'coop', label: 'Одной командой', hint: 'Вдвоём и втроём: команда против соперника, который открывает по слову за ход', options: { mode: 'coop', traps: 1, topo: true } },
    { id: 'traps', label: 'Три ловушки', hint: 'Две команды, но ловушек три — каждая подсказка на грани', options: { mode: 'teams', traps: 3, topo: true } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng, seats.filter((x) => x.kind !== 'bot').map((x) => x.seat)),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  result(s) {
    if (s.phase !== 'over') return null;
    if (s.coop) {
      const rivals = s.key.filter((k, i) => k === 1 && s.opened[i] == null).length;
      const scores = Object.fromEntries(s.seats.map((x) => [x, s.winner === 0 ? rivals + 1 : 0]));
      return { winners: s.winner === 0 ? s.seats.slice() : [], text: s.winner === 0 ? `все слова найдены за ${s.rounds} ход., у соперника осталось ${rivals}` : `поражение: ${s.reason}`, scores };
    }
    if (s.winner == null) return null;
    return { winners: s.teams[s.winner].slice(), text: `победа: ${TEAM_NAME[s.winner]} — ${s.reason}` };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    const s = pos(6);
    const open: [string, number][] = [['ключ', 2], ['замок', 2], ['кит', 3], ['море', 5], ['банк', 3], ['пирог', 4], ['мёд', 3], ['пчела', 2]];
    for (const [w, x] of open) s.opened[at(w)] = x;
    s.clues = [
      { team: 0, by: 0, word: 'дверь', n: 2, picks: [at('ключ'), at('замок')] },
      { team: 1, by: 1, word: 'океан', n: 2, picks: [at('кит'), at('море'), at('банк')] },
      { team: 0, by: 0, word: 'улей', n: 3, picks: [at('пирог')] },
      { team: 1, by: 1, word: 'сладкое', n: 2, picks: [at('мёд')] },
      { team: 0, by: 0, word: 'жало', n: 1, picks: [at('пчела')] },
    ];
    s.clues.push({ team: 0, by: 0, word: 'космос', n: 3, picks: [] });
    s.turn = 0;
    s.phase = 'guess';
    s.left = 4;
    s.marks = { [at('луна')]: [2], [at('ракета')]: [2, 4] };
    return s;
  },

  rules: {
    goal: 'Две команды, у каждой капитан. Только капитаны видят ключ — какие слова поля свои. Подсказывая одним словом, капитан ведёт команду к своим словам; кто первым откроет все свои — победил. Ловушка — мгновенное поражение.',
    sections: [
      {
        title: 'Поле и ключ',
        html: `<p>На поле 25 слов. Ключ раскрашивает их: у начинающей команды <b>9</b> слов, у второй — <b>8</b>, <b>7</b> нейтральных и одна <b>ловушка</b>.
          Кто начинает — решает жребий. Ключ видят только два капитана (здесь им его показывает стол — рамкой цвета у каждого слова), отгадчики видят просто слова.</p>
          <p>Команды — через одного по местам за столом, капитан — первый в команде (в лобби игроков можно пересадить).</p>`,
      },
      {
        title: 'Подсказка',
        html: `<p>Капитан называет <b>одно слово и число</b>: «океан, 2» — значит, к подсказке подходят два слова его команды. Нельзя подсказывать словом с поля
          (и его формами — стол не пустит «рыбака» при «рыбе» на поле), нельзя жестами и намёками на место слова. Число может быть <b>0</b> («ни одно не подходит» — открывайте сколько угодно)
          или <b>∞</b> — если команда должна добрать старые.</p>`,
        demo: {
          seats: demoSeats(4),
          setup: () => pos(4),
          intro: 'Капитан красных Вовка видит ключ: «ключ» и «замок» — красные, а «банк» рядом с ними — синий.',
          steps: [act(0, { type: 'clue', word: 'дверь', n: 2 }, 'Вовка: «дверь, 2».')],
        },
      },
      {
        title: 'Отгадывание',
        html: `<p>Команда советуется (можно ставить пометки — нажать на слово и выбрать «пометить») и открывает слова по одному. Слово своей команды — можно открывать дальше,
          всего до <b>числа + 1</b> слов (лишнее — для старых подсказок). Нейтральное или чужое слово — ход переходит к соперникам (чужое ещё и помогает им).
          Открыть хотя бы одно слово обязательно, дальше можно остановиться.</p>`,
        demo: {
          seats: demoSeats(4),
          setup: () => {
            const s = pos(4);
            s.clues = [{ team: 0, by: 0, word: 'дверь', n: 2, picks: [] }];
            s.phase = 'guess';
            s.left = 3;
            return s;
          },
          intro: 'Подсказка — «дверь, 2». Отгадывает Серёга.',
          steps: [
            act(2, { type: 'guess', index: at('ключ') }, '«Ключ» — красное, можно дальше.'),
            act(2, { type: 'guess', index: at('замок') }, '«Замок» — тоже красное. Есть ещё одна попытка.'),
            act(2, { type: 'guess', index: at('банк') }, '«Банк» — это синее слово. Ход переходит к синим.'),
          ],
        },
      },
      {
        title: 'Ловушка и победа',
        html: `<p>Кто открыл <b>ловушку</b> — та команда сразу проиграла. Иначе побеждает та, у которой первой открыты все её слова — даже если последнее открыли соперники.</p>
          <p>Пресет «Три ловушки» — ловушек три, нейтральных слов пять.</p>`,
        demo: {
          seats: demoSeats(4),
          setup: () => {
            const s = pos(4, { turn: 1 });
            s.clues = [{ team: 1, by: 1, word: 'погода', n: 2, picks: [] }];
            s.phase = 'guess';
            s.left = 3;
            return s;
          },
          intro: 'Синие: «погода, 2». Танька открывает…',
          steps: [act(3, { type: 'guess', index: at('гроза') }, '«Гроза» — ловушка! Синие проиграли.')],
        },
      },
      {
        title: 'Одной командой',
        html: `<p>Вдвоём, втроём и больше — пресет «Одной командой»: один капитан, остальные отгадывают, а за синих играет невидимый соперник.
          После каждого хода команды он открывает одно своё слово. Нужно найти все 9 своих раньше, чем соперник откроет свои 8, и не наступить на ловушку.
          Чем больше слов соперника осталось закрытыми — тем лучше результат.</p>`,
        demo: {
          seats: demoSeats(2),
          options: { mode: 'coop' },
          setup: () => {
            const s = pos(2, {}, true);
            s.clues = [{ team: 0, by: 0, word: 'космос', n: 3, picks: [] }];
            s.phase = 'guess';
            s.left = 4;
            return s;
          },
          intro: 'Капитан Вовка: «космос, 3». Отгадывает Ленка.',
          steps: [
            act(1, { type: 'guess', index: at('луна') }, '«Луна» — своё.'),
            act(1, { type: 'guess', index: at('ракета') }, '«Ракета» — своё.'),
            act(1, { type: 'stop' }, 'Ленка не уверена насчёт «звезды» и останавливается. Соперник открывает одно своё слово.'),
          ],
        },
      },
      {
        title: 'Подсказки',
        html: `<p>Капитану: подсказка на 2–3 слова лучше, чем на одно, но не тяните к словам, которые близки к ловушке. Следите за многозначными словами — «лук», «коса», «ключ».
          Отгадчикам: последняя «лишняя» попытка — для недобранных старых подсказок.</p>
          <p>Ботам подсказки понятны, если они есть в их словаре ассоциаций (у каждого слова поля 25 связанных слов) — человеческая подсказка вне словаря для бота почти пустая.</p>`,
      },
    ],
  },
};
