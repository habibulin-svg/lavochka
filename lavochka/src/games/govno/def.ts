/* Г*вно (на внимательность) — описание игры для сборника: 3–6 игроков, такт передачи, «тихое», до скольких букв.
 * Игра реального времени: комната крутит шаги, игроки шлют выбранную карту и хлопки. Показ правил идёт через apply (только в позиции показа). Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import type { Card, Suit } from '../../cards/deck';
import { botInput } from './ai';
import { applyDemo, cfgFrom, cid, cleanInput, idleInput, makeView, newState, setup, step, TICK_MS, WORD, type Action, type Event, type Input, type State, type View } from './engine';

export const SEATS = [
  { name: 'Вовка', color: '#b3322a', light: '#e0674f', dark: '#6e1a14' },
  { name: 'Ленка', color: '#2b5c9e', light: '#5f8fd0', dark: '#16325a' },
  { name: 'Серёга', color: '#2f7a3e', light: '#58ad66', dark: '#18452a' },
  { name: 'Танька', color: '#d9a521', light: '#f3cf62', dark: '#8a6410', ink: '#8a6410' },
  { name: 'Димон', color: '#7a3e9e', light: '#a872c8', dark: '#43205a' },
  { name: 'Светка', color: '#1f8a8a', light: '#58bdbd', dark: '#0f4a4a' },
];

/** Буквы проигравшего: «Г*В». */
export const lettersOf = (n: number) => WORD.slice(0, Math.min(n, WORD.length)).join('');
const sec = (ms: number) => (ms / 1000).toFixed(2).replace('.', ',');

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.k) {
    case 'deal':
      return `Кон ${ev.round}. Раздали по четыре.`;
    case 'slap':
      return ev.first ? `🖐 ${name(ev.seat)} хлопает первым!` : `🖐 ${name(ev.seat)} — через ${sec(ev.dt)} с`;
    case 'round':
      return ev.losers.length
        ? `💩 ${ev.losers.map(name).join(', ')} — г*вно кона${ev.reason === 'foul' ? ' (хлопнул без четвёрки)' : ''}.`
        : 'Кон без проигравшего.';
    case 'end':
      return `🏁 Партия: ${ev.losers.map(name).join(', ')} собрал${ev.losers.length > 1 ? 'и' : ''} всё слово.`;
  }
  return null;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1, 2].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
const C = (t: string): Card => ({ s: t.slice(-1) as Suit, r: ({ J: 11, Q: 12, K: 13, A: 14 } as Record<string, number>)[t.slice(0, -1)] ?? Number(t.slice(0, -1)) });
const L = (t: string) => t.split(/\s+/).filter(Boolean).map(C);

/** Позиция втроём посреди кона: руки и кто что собирается отдать; до такта — ms. */
function pos(hands: string[], picks: (string | null)[], ms = 1000, extra: Partial<State> = {}): State {
  const s = newState(cfgFrom({}), [0, 1, 2]);
  hands.forEach((h, i) => (s.hands[i] = L(h)));
  picks.forEach((p, i) => (s.picks[i] = p ? cid(C(p)) : null));
  s.round = 1;
  s.t = 5000;
  s.phase = 'pass';
  s.nextAt = s.t + ms;
  s.tacts = 3;
  s.demo = true;
  return Object.assign(s, extra);
}
const D = (seat: number, a: Omit<Action, 'type'>, caption?: string) => ({ seat, action: { type: 'demo', ...a, pick: a.pick ? cid(C(a.pick)) : undefined } as Action, caption });

export const def: GameDef<State, Action, Event, View> = {
  id: 'govno',
  title: 'Г*вно',
  players: { min: 3, max: 6, default: 4 },
  seats: SEATS,
  options: [
    {
      key: 'tact',
      label: 'Такт передачи',
      type: 'select',
      choices: [
        { value: 2500, label: 'медленно — 2,5 с' },
        { value: 2000, label: 'обычно — 2 с' },
        { value: 1500, label: 'бодро — 1,5 с' },
        { value: 1000, label: 'быстро — 1 с' },
      ],
      default: 2000,
    },
    { key: 'silent', label: 'Тихое', type: 'toggle', default: false, hint: 'Про хлопок не объявляют: смотри, не легла ли на стол чья-то ладонь.' },
    {
      key: 'limit',
      label: 'До скольких букв',
      type: 'select',
      choices: [
        { value: 5, label: 'всё слово — Г*ВНО' },
        { value: 3, label: 'до трёх — Г*В' },
        { value: 1, label: 'один кон' },
      ],
      default: 5,
    },
  ],
  presets: [
    { id: 'classic', label: 'Дворовое', hint: 'Такт 2 с, до всего слова', options: { tact: 2000, silent: false, limit: 5 } },
    { id: 'silent', label: 'Тихое', hint: 'Без крика — замечай ладони на столе', options: { tact: 2000, silent: true, limit: 5 } },
    { id: 'fast', label: 'Быстрое', hint: 'Такт 1 с, до трёх букв', options: { tact: 1000, silent: false, limit: 3 } },
    { id: 'calm', label: 'Для начала', hint: 'Такт 2,5 с — успеть разобраться', options: { tact: 2500, silent: false, limit: 3 } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng),
  toAct: (s) => (s.phase === 'over' ? [] : s.seats.slice()),
  apply: (s, seat, a, rng) => applyDemo(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  redact: (ev) => ev,
  result(s) {
    if (s.phase !== 'over') return null;
    const top = Math.max(...s.seats.map((p) => s.letters[p]));
    const scores: Record<number, number> = {};
    for (const p of s.seats) scores[p] = -s.letters[p];
    const losers = s.seats.filter((p) => s.letters[p] === top);
    return { winners: s.seats.filter((p) => !losers.includes(p)), text: `${lettersOf(top)} — у проигравшего`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: () => null },
  realtime: {
    tickMs: TICK_MS,
    sendEvery: 2,
    idle: idleInput,
    input: cleanInput,
    tick: (s, inputs, rng) => step(s, inputs as (Input | null)[], rng),
    bot: (v, seat, level, mem, rng) => botInput(v, seat, level, mem, rng),
  },
  describe,

  showcase: () => {
    const s = pos(['JS JC JD JH', 'AS KD QC AH', 'KS KC AD QH', 'QS QD AC KH'], [null, null, null, null], 600);
    s.seats = [0, 1, 2, 3];
    s.phase = 'slap';
    s.slapAt = s.t - 300;
    s.slaps = [
      { seat: 0, dt: 0 },
      { seat: 2, dt: 280 },
    ];
    s.letters = [0, 2, 1, 3, 0, 0];
    s.demo = false;
    return s;
  },

  rules: {
    goal: 'Собрать на руке четыре карты одного достоинства и хлопнуть — а когда хлопнул другой, хлопнуть следом и не оказаться последним. Последний — «г*вно» кона.',
    sections: [
      {
        title: 'Карты и передача',
        html: `<p>Колода — по четвёрке на каждого: втроём тузы, короли и дамы, вчетвером ещё и вальты, и так далее. Каждому по четыре карты.</p>
          <p>Каждые полторы секунды все <b>разом</b> отдают по одной карте соседу слева и получают от соседа справа. Какую отдать — коснитесь
          её заранее (или клавиши <kbd>1</kbd>–<kbd>4</kbd>). Не выбрали — дальше уйдёт только что полученная.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['AS AC KD QH', 'KS QS AD KC', 'AH KH QC QD'], [null, 'KS', 'QC']),
          intro: 'Втроём: тузы, короли, дамы. Вовка копит тузы.',
          steps: [D(0, { pick: 'QH', wait: 1100 }, 'Вовка отдаёт даму червей Ленке, от Серёги приходит дама треф.')],
        },
      },
      {
        title: 'Хлоп!',
        html: `<p>Собрал четыре одного достоинства — <b>хлопай</b>: кнопка «Хлоп!» или пробел. Передача сразу встаёт, и все остальные тоже должны
          хлопнуть. Кто хлопнул <b>последним</b> — «г*вно» кона. Не хлопнул совсем за шесть секунд — тоже.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['AS AC AD KH', 'KC KD QS QH', 'AH KS QC QD'], ['KH', 'QS', 'AH']),
          intro: 'У Вовки три туза, а Серёга как раз отдаёт ему туза червей.',
          steps: [
            D(0, { wait: 1100 }, 'Такт — и у Вовки четыре туза!'),
            D(0, { slap: true, wait: 300 }, 'Хлоп! Передача встала.'),
            D(1, { slap: true, wait: 300 }, 'Ленка успевает следом — Серёга последний, ему буква «Г».'),
          ],
        },
      },
      {
        title: 'Фальстарт',
        html: `<p>Хлопнул, а четвёрки нет — <b>сразу</b> проиграл кон, без всякой реакции остальных.</p>
          <p>Проигравший кон получает букву: Г, *, В, Н, О. Собрал всё слово — проиграл партию. В «тихом» про хлопок не объявляют —
          ладонь на столе надо заметить самому.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['AS AC KD QH', 'KS KC KH QS', 'AH AD QC QD'], [null, null, null], 3000),
          intro: 'У Ленки три короля — показалось, что четыре.',
          steps: [D(1, { slap: true, wait: 300 }, 'Хлоп без четвёрки — Ленка сразу «г*вно» кона.')],
        },
      },
    ],
  },
};
