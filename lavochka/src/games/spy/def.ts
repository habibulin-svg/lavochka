/* Шпион — описание игры для сборника: темы (локации, кино, музыка, книги, игры, живопись, география, история) — пресетами и свободно вперемешку,
 * время раунда 5/10 минут или без ограничения, счёт по раундам; боты; правила с показом. Без DOM. */
import type { GameDef, OptionDef, Options, SeatSpec } from '../../core/types';
import { esc } from '../../core/util';
import { choose } from './ai';
import { apply, makeView, OUTCOME_TEXT, ROUND_CHOICES, setup, toAct, type Action, type Event, type State, type View } from './engine';
import { THEME, THEMES, word } from './themes';

export const SEATS = [
  ['Вовка', '#b3322a'], ['Ленка', '#2b5c9e'], ['Серёга', '#2f7a3e'], ['Танька', '#c48a12'], ['Димон', '#6a3d8f'],
  ['Светка', '#c2185b'], ['Жека', '#0f7a7a'], ['Михалыч', '#8a5a2a'], ['Олька', '#7a3aa0'], ['Колян', '#5a5a5a'],
].map(([name, color]) => ({ name, color, light: color, dark: color }));

const wordName = (theme: string, id: string) => word(theme, id)?.name ?? id;

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'round':
      return `<b>Раунд ${ev.round}</b> · ${THEME[ev.theme].icon} ${THEME[ev.theme].title}. Карточки розданы.`;
    case 'go':
      return `Все посмотрели карточки. Первым спрашивает ${name(ev.asker)}.`;
    case 'ask':
      return `${name(ev.from)} → ${name(ev.to)}: «${esc(ev.text || 'вопрос голосом')}»`;
    case 'answer':
      return `${name(ev.seat)}: «${esc(ev.text || 'ответ голосом')}»`;
    case 'accuse':
      return `☝ ${name(ev.by)} обвиняет ${name(ev.suspect)}! Голосуем.`;
    case 'vote':
      return ev.yes ? null : `${name(ev.seat)} против.`;
    case 'acquit':
      return `Не единогласно — ${name(ev.suspect)} вне подозрений, играем дальше.`;
    case 'timeup':
      return '⏰ Время вышло! Все разом показывают на шпиона.';
    case 'guess':
      return `🕵 ${name(ev.seat)}: «Я шпион!» — и называет…`;
    case 'end': {
      const e = ev.end;
      const w = `${THEME[e.theme].noun}: <b>${esc(wordName(e.theme, e.word))}</b>`;
      const guess = e.guess ? ` (назвал «${esc(wordName(e.theme, e.guess))}»)` : '';
      const who = e.accused != null && e.outcome === 'innocent' ? ` — ${name(e.accused)} был мирным` : '';
      return `🏁 ${OUTCOME_TEXT[e.outcome]}${guess}${who}. Шпион — ${name(e.spy)}. ${w}.`;
    }
    case 'over':
      return '🏆 Игра окончена.';
  }
  return null;
}

// ---------------------------------------------------------------- настройки

const themeOptions: OptionDef[] = THEMES.flatMap((t): OptionDef[] => {
  const on: OptionDef = { key: `th_${t.id}`, label: `${t.icon} ${t.title}`, type: 'toggle', default: t.id === 'locations' };
  if (!t.subs) return [on];
  return [on, { key: `sub_${t.id}`, label: `${t.title}: что именно`, type: 'select', choices: t.subs.map(([value, label]) => ({ value, label })), default: 'all', showIf: (o) => o[`th_${t.id}`] === true }];
});

/** Пресет: только эти темы (у остальных — выключено). */
const only = (themes: string[], subs: Record<string, string> = {}): Options => {
  const o: Options = {};
  for (const t of THEMES) {
    o[`th_${t.id}`] = themes.includes(t.id);
    if (t.subs) o[`sub_${t.id}`] = subs[t.id] ?? 'all';
  }
  return o;
};

const demoSeats = (n: number): SeatSpec[] => Array.from({ length: n }, (_, seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));

/** Позиция для показа: локации, слово и шпион заданы, вопросы уже начались. */
function pos(theme: string, wordId: string, spy: number, n = 4): State {
  const s = setup(Array.from({ length: n }, (_, i) => i), { ...only([theme]), time: 0, rounds: 1 }, { next: () => 0, int: () => 0, getState: () => 0 });
  s.word = wordId;
  s.spy = spy;
  s.roles = {};
  const roles = word(theme, wordId)?.roles ?? [];
  s.seats.filter((x) => x !== spy).forEach((x, i) => roles.length && (s.roles[x] = roles[i % roles.length]));
  s.phase = 'ask';
  s.asker = 0;
  return s;
}
const ASK = (seat: number, target: number, facet: number, caption?: string) => ({ seat, action: { type: 'ask', target, facet } as Action, caption });
const ANS = (seat: number, val: number, caption?: string) => ({ seat, action: { type: 'answer', val } as Action, caption });

export const def: GameDef<State, Action, Event, View> = {
  id: 'spy',
  title: 'Шпион',
  players: { min: 3, max: 10, default: 5 },
  seats: SEATS,
  options: [
    ...themeOptions,
    { key: 'time', label: 'Время раунда', type: 'select', choices: [{ value: 5, label: '5 минут' }, { value: 10, label: '10 минут' }, { value: 0, label: 'без ограничения' }], default: 10 },
    { key: 'rounds', label: 'Раундов', type: 'select', choices: ROUND_CHOICES.map((r) => ({ value: r, label: String(r) })), default: 5 },
  ],
  presets: [
    { id: 'locations', label: 'Локации', hint: 'Классика: баня, рынок, пионерлагерь — у каждого своя роль', options: only(['locations']) },
    { id: 'movies', label: 'Кино', hint: 'Советское, наше и зарубежное кино', options: only(['movies']) },
    { id: 'cartoons', label: 'Мультфильмы', hint: 'Советские, диснеевские, аниме', options: only(['movies'], { movies: 'cartoons' }) },
    { id: 'music', label: 'Музыка', hint: 'Группы и исполнители', options: only(['music']) },
    { id: 'books', label: 'Книги', options: only(['books']) },
    { id: 'games', label: 'Компьютерные игры', options: only(['games']) },
    { id: 'art', label: 'Живопись', options: only(['art']) },
    { id: 'geography', label: 'География', hint: 'Города и достопримечательности', options: only(['geography']) },
    { id: 'history', label: 'История', hint: 'Исторические места и события', options: only(['history']) },
    { id: 'mix', label: 'Всё вперемешку', hint: 'Каждый раунд — новая тема', options: only(THEMES.map((t) => t.id)) },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng, seats.filter((x) => x.kind !== 'bot').map((x) => x.seat)),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  result(s) {
    if (s.phase !== 'over') return null;
    const best = Math.max(...s.seats.map((x) => s.scores[x] ?? 0));
    const winners = s.seats.filter((x) => (s.scores[x] ?? 0) === best);
    return { winners, text: `больше всех очков — ${best}`, scores: { ...s.scores } };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    const s = pos('locations', 'pionerlager', 3, 5);
    s.round = 2;
    s.rounds = 5;
    s.scores = { 0: 2, 1: 1, 2: 4, 3: 1, 4: 2 };
    s.qa = [
      { from: 0, to: 1, facet: 0, text: THEME.locations.facets[0].q, val: 1, answer: 'под открытым небом' },
      { from: 1, to: 3, facet: 2, text: THEME.locations.facets[2].q, val: 0, answer: 'людно' },
      { from: 3, to: 2, text: 'Тебе там нравилось в детстве?', answer: 'Ещё бы, каждое лето!' },
    ];
    s.asker = 2;
    s.prev = 3;
    s.limit = 600000;
    s.clock = { spent: 222000, start: null };
    return s;
  },

  rules: {
    goal: 'Всем, кроме шпиона, раздают одно и то же слово — локацию, фильм, книгу… Мирным — вычислить шпиона, шпиону — не выдать себя и догадаться, что загадано.',
    sections: [
      {
        title: 'Раздача',
        html: `<p>В начале раунда каждый втайне смотрит свою карточку. У мирных на ней слово (с картинкой) — например, «Общественная баня»,
          в локациях ещё и своя роль: «Банщик», «Завсегдатай». У одного карточка «Шпион»: тему он знает, а слово — нет.
          Список всех слов темы открыт всем — шпион выбирает из него.</p>
          <p>Темы — пресетами или любые вперемешку (каждый раунд — другая); в кино, музыке, книгах, живописи, географии и истории можно взять только наше или только зарубежное.</p>`,
      },
      {
        title: 'Вопросы',
        html: `<p>Первый игрок задаёт вопрос любому. Кого спросили — отвечает и спрашивает следующего, только не того, кто спросил его.
          Спрашивать можно своими словами (голосом или текстом) или готовым вопросом темы — «Это в помещении?», «Это наше кино?» — с ответом из вариантов.</p>
          <p>Мирным важно отвечать так, чтобы свои поняли, что вы знаете слово, а шпион — не догадался. Шпиону — отвечать уверенно и не попасться на нестыковке.
          Боты понимают только готовые вопросы и ответы.</p>`,
        demo: {
          seats: demoSeats(4),
          setup: () => pos('locations', 'banya', 2),
          intro: 'Загадана «Общественная баня». Шпион — Серёга, он слова не знает.',
          steps: [
            ASK(0, 1, 0, 'Вовка спрашивает Ленку: «Это в помещении или на улице?»'),
            ANS(1, 0, 'Ленка знает: баня — в помещении.'),
            ASK(1, 2, 1, 'Ленка спрашивает Серёгу: «Зачем туда приходят?»'),
            ANS(2, 1, 'Серёга-шпион угадывает: «отдыхать». А в бане — моются!'),
          ],
        },
      },
      {
        title: 'Обвинение',
        html: `<p>Любой игрок раз за раунд может обвинить другого. Часы останавливаются, все остальные голосуют —
          нужно <b>единогласно</b>. Хоть один против — обвинение снимается, играем дальше. Единогласно — карточку открывают: поймали шпиона или ошиблись.</p>`,
        demo: {
          seats: demoSeats(4),
          setup: () => {
            const s = pos('locations', 'banya', 2);
            s.qa = [{ from: 1, to: 2, facet: 1, text: THEME.locations.facets[1].q, val: 1, answer: 'отдыхать' }];
            s.asker = 2;
            s.prev = 1;
            return s;
          },
          intro: 'Серёга ответил, что в баню ходят отдыхать. Вовка с Ленкой знают: это неправда.',
          steps: [
            { seat: 1, action: { type: 'accuse', target: 2 } as Action, caption: 'Ленка обвиняет Серёгу!' },
            { seat: 0, action: { type: 'vote', yes: true } as Action },
            { seat: 3, action: { type: 'vote', yes: true } as Action, caption: 'Единогласно — Серёга и правда шпион. Мирным по очку, Ленке — два.' },
          ],
        },
      },
      {
        title: 'Догадка шпиона',
        html: `<p>Шпион в любой момент может остановить игру: «Я шпион!» — и назвать слово из списка. Угадал — его победа, нет — победили мирные.
          Когда время вышло, все разом показывают на подозреваемого: если все (кроме него самого) показали на одного — его карточку открывают.</p>`,
        demo: {
          seats: demoSeats(4),
          setup: () => {
            const s = pos('locations', 'banya', 2);
            s.qa = [
              { from: 0, to: 1, facet: 0, text: THEME.locations.facets[0].q, val: 0, answer: 'в помещении' },
              { from: 1, to: 3, facet: 1, text: THEME.locations.facets[1].q, val: 4, answer: 'лечиться или привести себя в порядок' },
            ];
            s.asker = 3;
            s.prev = 1;
            return s;
          },
          intro: 'Шпион Серёга слышал: «в помещении», «привести себя в порядок».',
          steps: [
            ASK(3, 2, 2, 'Танька спрашивает Серёгу, людно ли там…'),
            { seat: 2, action: { type: 'guess', word: 'banya' } as Action, caption: 'Серёга: «Я шпион! Это баня!» — угадал, ему 4 очка.' },
          ],
        },
      },
      {
        title: 'Очки',
        html: `<p><b>Шпион:</b> 2 очка — время вышло, а его не поймали; 4 — остановил игру и угадал слово; 4 — если по ошибке обвинили мирного.</p>
          <p><b>Мирные:</b> по 1 очку каждому, если шпиона поймали (или он назвал не то слово); тот, кто первым обвинил шпиона, получает 2.</p>
          <p>Время раунда — 5 или 10 минут, или без ограничения. После последнего раунда побеждает тот, у кого больше очков.</p>
          <p>Картинки — с Wikimedia Commons под свободными лицензиями; <a href="/spy/credits.html" target="_blank">авторы</a>.</p>`,
      },
    ],
  },
};
