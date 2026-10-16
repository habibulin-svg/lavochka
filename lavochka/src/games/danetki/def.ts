/* Данетки — описание игры для сборника: по правилам (круги, подсказки, очки) или без правил; ведущий — бот или игроки по очереди;
 * сложность и детские; боты-игроки и бот-ведущий; правила с показом. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { esc } from '../../core/util';
import { choose } from './ai';
import { DANETKI, danetka } from './data';
import { apply, makeView, setup, toAct, type Action, type Event, type State, type View } from './engine';

export const SEATS = [
  ['Вовка', '#b3322a'], ['Ленка', '#2b5c9e'], ['Серёга', '#2f7a3e'], ['Танька', '#c48a12'],
  ['Димон', '#6a3d8f'], ['Светка', '#c2185b'], ['Жека', '#0f7a7a'], ['Михалыч', '#8a5a2a'],
].map(([name, color]) => ({ name, color, light: color, dark: color }));

export const ANS = { y: 'Да', n: 'Нет', i: 'Неважно' } as const;
export const LEVEL = ['', 'лёгкая', 'средняя', 'трудная'];

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'start': {
      const d = danetka(ev.id);
      return `<b>Данетка ${ev.n}: «${esc(d?.title ?? '')}»</b>${ev.host != null ? ` — ведущий ${name(ev.host)}` : ''}.`;
    }
    case 'entry': {
      const e = ev.entry;
      if (e.guess) return `💡 ${name(e.seat)}: «${esc(e.text || 'разгадка голосом')}»${e.right == null ? '' : e.right ? ' — <b>верно!</b>' : ' — нет.'}`;
      return `${name(e.seat)}: «${esc(e.text || 'вопрос голосом')}»${e.a ? ` — <b>${ANS[e.a]}</b>` : ''}`;
    }
    case 'answer':
      return `— <b>${ANS[ev.a]}</b>`;
    case 'judge':
      return ev.right ? '— <b>Верно!</b>' : '— Нет, не то.';
    case 'hint':
      return `🔎 Подсказка ${ev.n}: ${esc(ev.text)}`;
    case 'end':
      return ev.result.solver != null ? `🏁 Разгадал ${name(ev.result.solver)}${ev.result.gain ? ` (+${ev.result.gain})` : ''}.` : '🏁 Никто не разгадал — ведущий рассказывает ответ.';
    case 'over':
      return '🏆 Игра окончена.';
  }
  return null;
}

const demoSeats = (n: number): SeatSpec[] => Array.from({ length: n }, (_, seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const z = { next: () => 0, int: () => 0, getState: () => 0 };
/** Позиция для показа: первая лёгкая данетка базы, ведущий — бот. */
function pos(n = 3, extra: Record<string, unknown> = {}): State {
  const s = setup(Array.from({ length: n }, (_, i) => i), { mode: 'rules', host: 'bot', count: 1, ...extra }, z);
  const d = DANETKI.find((x) => x.level === 1) ?? DANETKI[0];
  if (d) {
    s.id = d.id;
    s.used = [d.id];
  }
  return s;
}
const firstYes = (k: number) => {
  const d = DANETKI.find((x) => x.level === 1) ?? DANETKI[0];
  return d ? d.questions.map((q, i) => [q.a, i] as const).filter(([a]) => a === 'y').map(([, i]) => i)[k] ?? 0 : 0;
};
const firstNo = () => {
  const d = DANETKI.find((x) => x.level === 1) ?? DANETKI[0];
  return d ? Math.max(0, d.questions.findIndex((q) => q.a !== 'y')) : 0;
};

export const def: GameDef<State, Action, Event, View> = {
  id: 'danetki',
  title: 'Данетки',
  players: { min: 1, max: 8, default: 3 },
  countsFor: (o) => (o.host === 'players' ? [2, 3, 4, 5, 6, 7, 8] : [1, 2, 3, 4, 5, 6, 7, 8]),
  countsHint: (o) => (o.host === 'players' ? 'один из игроков — ведущий, по очереди' : undefined),
  seats: SEATS,
  options: [
    {
      key: 'mode',
      label: 'Играем',
      type: 'select',
      choices: [
        { value: 'rules', label: 'по правилам — круги, подсказки, очки' },
        { value: 'free', label: 'без правил — пока не надоест' },
      ],
      default: 'rules',
    },
    {
      key: 'host',
      label: 'Ведущий',
      type: 'select',
      choices: [
        { value: 'bot', label: 'бот — вопросы из готовых' },
        { value: 'players', label: 'игроки по очереди — вопросы свои' },
      ],
      default: 'bot',
      hint: 'Живой ведущий видит разгадку и жмёт «да/нет»; с ботом-ведущим вопросы и разгадка — из готовых вариантов.',
    },
    {
      key: 'level',
      label: 'Сложность',
      type: 'select',
      choices: [
        { value: 'any', label: 'любая' },
        { value: '1', label: 'лёгкие' },
        { value: '2', label: 'средние' },
        { value: '3', label: 'трудные' },
      ],
      default: 'any',
    },
    { key: 'kids', label: 'Только детские', type: 'toggle', default: false, hint: 'Без убийств и страшилок' },
    {
      key: 'count',
      label: 'Данеток',
      type: 'select',
      choices: [
        { value: 3, label: '3' },
        { value: 5, label: '5' },
        { value: 10, label: '10' },
        { value: 'hosts', label: 'каждый побудет ведущим' },
      ],
      default: 5,
    },
  ],
  presets: [
    { id: 'rules', label: 'По правилам', hint: 'По кругу, подсказка после каждого круга, 4 круга, очки 4/5/6 минус подсказки', options: { mode: 'rules', kids: false } },
    { id: 'free', label: 'Без правил', hint: 'Спрашивайте сколько угодно, подсказки — по желанию, без очков', options: { mode: 'free', kids: false } },
    { id: 'kids', label: 'Детские', hint: 'Только добрые истории', options: { mode: 'rules', kids: true } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng, seats.filter((x) => x.kind !== 'bot').map((x) => x.seat)),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  result(s) {
    if (s.phase !== 'over') return null;
    const best = Math.max(...s.seats.map((x) => s.scores[x] ?? 0));
    const winners = s.rules && best > 0 ? s.seats.filter((x) => s.scores[x] === best) : [];
    return { winners, text: s.rules ? `больше всех очков — ${best}` : 'разгадывали без счёта', scores: { ...s.scores } };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    const s = pos(4);
    const d = danetka(s.id);
    if (d) {
      const ys = d.questions.map((q, i) => [q, i] as const);
      const take = ys.slice(0, 5);
      s.log = take.map(([q, i], k) => ({ seat: s.players[k % s.players.length], text: q.q, q: i, a: q.a }));
      s.log.push({ seat: -1, text: d.hints[0], hint: 1 });
      s.hints = 1;
      s.circle = 2;
      s.turn = s.players[1];
      s.asked = [s.players[0]];
    }
    return s;
  },

  rules: {
    goal: 'Разгадать странную историю: понять, что случилось и почему, — задавая ведущему вопросы, на которые можно ответить «да», «нет» или «неважно».',
    sections: [
      {
        title: 'Ведущий и вопросы',
        html: `<p>Ведущий читает данетку вслух. Игроки по очереди, начиная слева от ведущего, задают по одному вопросу. Ведущий отвечает только
          <b>«да»</b>, <b>«нет»</b> или <b>«неважно»</b>. Что выяснили (все «да») — собирается в блокноте.</p>
          <p>С ботом-ведущим вопросы выбирают из готовых, разгадку — из четырёх вариантов. С живым ведущим (игроки по очереди) — спрашивают своими словами,
          голосом или текстом; ведущий видит разгадку и жмёт «да/нет».</p>`,
        demo: {
          seats: demoSeats(3),
          setup: () => pos(3),
          intro: 'Ведущий — бот. Игроки спрашивают по кругу.',
          steps: [
            { seat: 0, action: { type: 'ask', q: firstYes(0) } as Action, caption: 'Вовка спрашивает — «да», это уже факт.' },
            { seat: 1, action: { type: 'ask', q: firstNo() } as Action, caption: 'Ленка проверяет свою версию.' },
            { seat: 2, action: { type: 'ask', q: firstYes(1) } as Action, caption: 'Круг закончился — ведущий читает первую подсказку.' },
          ],
        },
      },
      {
        title: 'Подсказки и время',
        html: `<p>После каждого круга ведущий читает следующую подсказку — всего их три. После четвёртого круга время вышло: если никто не разгадал,
          ведущий рассказывает ответ. (Вдвоём-втроём кругов больше — чтобы вопросов было хотя бы двенадцать.)</p>`,
      },
      {
        title: 'Разгадка и очки',
        html: `<p>В свой ход вместо вопроса можно назвать разгадку. Верно — получаешь <b>4</b> очка за лёгкую, <b>5</b> за среднюю, <b>6</b> за трудную,
          минус очко за каждую уже прочитанную подсказку. Неверно — ход переходит.</p>
          <p>Игра кончается, когда сыграли выбранное число данеток (или каждый побыл ведущим), либо кто-то набрал 10 очков. У кого больше — тот победил.</p>
          <p><b>Без правил:</b> спрашивайте сколько угодно, подсказку ведущий даёт, когда сочтёт нужным (с ботом-ведущим — по просьбе), можно сдаться и узнать ответ. Очков нет.</p>`,
      },
    ],
  },
};
