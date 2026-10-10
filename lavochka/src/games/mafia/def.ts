/* Мафия — описание игры для сборника: классическая, с доктором и путаной, спортивная; 6–16 игроков; боты с репликами; правила с показом. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { esc } from '../../core/util';
import { choose } from './ai';
import { apply, isMafia, makeView, ROLE_NAME, setup, toAct, type Action, type Event, type Role, type State, type View } from './engine';

export const SEATS = [
  ['Вовка', '#b3322a'], ['Ленка', '#2b5c9e'], ['Серёга', '#2f7a3e'], ['Танька', '#d9a521'], ['Димон', '#6a3d8f'], ['Колян', '#5a5a5a'],
  ['Светка', '#c2185b'], ['Жека', '#0f7a7a'], ['Михалыч', '#8a5a2a'], ['Олька', '#7a3aa0'], ['Петрович', '#3a5a8a'], ['Наташка', '#a0522d'],
  ['Лёха', '#4a6a1a'], ['Маринка', '#b0306a'], ['Толян', '#606020'], ['Юлька', '#2a7aa0'],
].map(([name, color]) => ({ name, color, light: color, dark: color }));

/** Подставить имена в реплику ({@3} → имя третьего места). */
export const withNames = (text: string, name: (seat: number) => string) => esc(text).replace(/\{@(\d+)\}/g, (_, n) => name(+n).replace(/\s*\(бот\)/, ''));

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'night':
      return `🌙 Ночь ${ev.day}. Город засыпает…`;
    case 'act':
      return ev.role && isMafia(ev.role) && ev.target != null ? `${name(ev.seat)} целится в ${name(ev.target)}.` : null;
    case 'check':
      return ev.who === 'sheriff' ? `Проверка: ${name(ev.target)} — <b>${ev.result ? 'мафия' : 'не мафия'}</b>.` : `Дон проверил: ${name(ev.target)} — <b>${ev.result ? 'комиссар' : 'не комиссар'}</b>.`;
    case 'dawn':
      return ev.killed == null ? `☀ Утро. ${ev.saved ? 'Этой ночью никто не погиб — кого-то спасли!' : 'Ночь прошла спокойно.'}` : `☀ Утро. Убит${ev.role ? ' ' + ROLE_NAME[ev.role] : ''} ${name(ev.killed)}.`;
    case 'speak':
      return `${name(ev.seat)}: «${withNames(ev.text, name)}»${ev.nominate != null ? ` — выставляет ${name(ev.nominate)}` : ''}`;
    case 'vote':
      return `${name(ev.seat)} голосует против ${name(ev.target)}`;
    case 'revote':
      return `Поровну! Переголосовка: ${ev.between.map(name).join(', ')}.`;
    case 'out':
      return `⚖ ${name(ev.seat)} покидает игру (${ev.votes} голосов)${ev.role ? ` — это был${ev.role === 'putana' ? 'а' : ''} <b>${ROLE_NAME[ev.role]}</b>` : ''}.`;
    case 'nobody':
      return ev.reason === 'tie' ? 'Снова поровну — сегодня никто не уходит.' : 'Никого не выставили — город спит дальше.';
    case 'end':
      return ev.winner === 'city' ? '🏆 <b>Город победил!</b> Мафия разоблачена.' : '🏆 <b>Мафия победила.</b> Город пал.';
  }
  return null;
}

/** Ночные ходы и проверки видят только свои. */
function redact(ev: Event, seats: number[] | 'all'): Event | null {
  if (seats === 'all') return ev;
  if (ev.type === 'act' || ev.type === 'check') return ev.to.some((x) => seats.includes(x)) ? ev : null;
  return ev;
}

// ---------------------------------------------------------------- показ правил

const demoSeats = (n: number): SeatSpec[] => Array.from({ length: n }, (_, seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));

/** Позиция с заданными ролями (на месте i — roles[i]). */
function pos(roles: Role[], opts: Record<string, unknown> = {}): State {
  const seats = roles.map((_, i) => i);
  const s = setup(seats, opts as never, { next: () => 0, int: () => 0, getState: () => 0 });
  roles.forEach((r, i) => (s.roles[i] = r));
  return s;
}
const N = (seat: number, target: number, caption?: string) => ({ seat, action: { type: 'night', target } as Action, caption });
const S = (seat: number, text: string, nominate?: number, caption?: string) => ({ seat, action: { type: 'speak', text, nominate } as Action, caption });
const V = (seat: number, target: number, caption?: string) => ({ seat, action: { type: 'vote', target } as Action, caption });
const ROLES6: Role[] = ['civ', 'mafia', 'sheriff', 'civ', 'civ', 'civ'];

export const def: GameDef<State, Action, Event, View> = {
  id: 'mafia',
  title: 'Мафия',
  players: { min: 6, max: 16, default: 8 },
  seats: SEATS,
  options: [
    {
      key: 'variant',
      label: 'Игра',
      type: 'select',
      choices: [
        { value: 'classic', label: 'классическая — мафия, комиссар, мирные' },
        { value: 'extended', label: 'с доктором и путаной' },
        { value: 'sport', label: 'спортивная — 3 мафии с доном, ночь знакомства' },
      ],
      default: 'classic',
    },
    { key: 'reveal', label: 'Открывать роль ушедшего', type: 'toggle', default: true, hint: 'В спортивной обычно не открывают.' },
  ],
  presets: [
    { id: 'classic', label: 'Классическая', hint: 'Мафия, комиссар и мирные жители', options: { variant: 'classic', reveal: true } },
    { id: 'extended', label: 'С доктором и путаной', hint: 'Доктор лечит, путана отвлекает', options: { variant: 'extended', reveal: true } },
    { id: 'sport', label: 'Спортивная', hint: 'Дон, ночь знакомства, роли не открывают', options: { variant: 'sport', reveal: false } },
  ],

  setup: (seats, opts, rng) => setup(seats.map((x) => x.seat).sort((a, b) => a - b), opts, rng, seats.filter((x) => x.kind !== 'bot').map((x) => x.seat)),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s, seats) => makeView(s, seats),
  redact,
  result(s) {
    if (s.phase !== 'over' || !s.winner) return null;
    const winners = s.seats.filter((x) => (s.winner === 'mafia') === isMafia(s.roles[x]));
    const scores: Record<number, number> = {};
    for (const x of s.seats) scores[x] = winners.includes(x) ? 1 : 0;
    return { winners, text: s.winner === 'city' ? 'город победил' : 'мафия победила', scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () => {
    const s = pos(['civ', 'mafia', 'sheriff', 'civ', 'mafia', 'civ', 'doctor', 'civ'], { variant: 'classic' });
    s.phase = 'day';
    s.day = 2;
    s.alive = [0, 1, 2, 3, 4, 6, 7];
    s.shown = { 5: 'civ' };
    s.order = s.alive.slice();
    s.speaker = 3;
    s.said = { 0: 'Я мирный. Мне не нравится {@4}.', 1: 'Город, присмотритесь к {@2}.', 2: 'Я комиссар! {@4} — мафия, проверено.' };
    s.nominees = [4, 2];
    return makeView(s, [0]);
  },

  rules: {
    goal: 'Мирным — вычислить и выгнать всю мафию. Мафии — остаться в большинстве.',
    sections: [
      {
        title: 'Роли',
        html: `<p>Роли раздаются втайне. <b>Мафия</b> знает друг друга и ночью убивает. <b>Комиссар</b> ночью проверяет одного игрока — мафия ли он.
          Остальные — <b>мирные жители</b>. С доктором и путаной: <b>доктор</b> ночью лечит одного (себя — не два раза подряд), <b>путана</b> приходит к игроку —
          его ночной ход не срабатывает, но и убить его этой ночью нельзя. В спортивной у мафии есть <b>дон</b>: ночью он ищет комиссара.</p>`,
      },
      {
        title: 'Ночь',
        html: `<p>«Город засыпает» — все выбирают цель втайне: мафия — кого убить (решает большинство), комиссар — кого проверить.
          Мирные тоже что-то выбирают (кого подозревают) — чтобы никто не догадался, у кого есть роль. Утром объявляют, кто погиб.</p>`,
        demo: {
          seats: demoSeats(6),
          setup: () => pos(ROLES6),
          intro: 'Ленка — мафия, Серёга — комиссар. Остальные мирные.',
          steps: [
            N(1, 3, 'Мафия (Ленка) выбирает Таньку.'),
            N(2, 1, 'Комиссар проверяет Ленку…'),
            N(0, 4),
            N(3, 5),
            N(4, 0),
            N(5, 1, 'Утро: Танька убита, а комиссар знает, что Ленка — мафия.'),
          ],
        },
      },
      {
        title: 'День и голосование',
        html: `<p>Днём каждый по очереди говорит и может <b>выставить</b> одного игрока. Потом все голосуют за одного из выставленных — больше всех голосов уходит из игры.
          Поровну — переголосовка между лидерами, снова поровну — никто не уходит.</p>`,
        demo: {
          seats: demoSeats(6),
          setup: () => {
            const s = pos(ROLES6);
            s.phase = 'day';
            s.alive = [0, 1, 2, 4, 5];
            s.order = [0, 1, 2, 4, 5];
            s.speaker = 0;
            s.checks = { 2: [{ target: 1, result: true }] };
            return s;
          },
          intro: 'Ночью убили Таньку. Комиссар знает: Ленка — мафия.',
          steps: [
            S(0, 'Я мирный, пока молчу.'),
            S(1, 'Подозреваю {@4}.', 4, 'Ленка (мафия) переводит стрелки на Димона.'),
            S(2, 'Я комиссар! {@1} — мафия, проверено.', 1, 'Комиссар открывается и выставляет Ленку.'),
            S(4, 'Верю комиссару.'),
            S(5, 'Согласен.'),
            V(0, 1),
            V(1, 4),
            V(2, 1),
            V(4, 1),
            V(5, 1, 'Ленка уходит — мафии больше нет, город победил!'),
          ],
        },
      },
      {
        title: 'Победа',
        html: `<p>Город побеждает, когда выбыла вся мафия. Мафия — когда её не меньше, чем всех остальных. В классике роль ушедшего открывают, в спортивной — нет.</p>
          <p>Спортивная: 10 игроков, 3 мафии (одна — дон), комиссар; первая ночь — знакомство: мафия открывает глаза и запоминает своих, никого не убивают.</p>`,
      },
    ],
  },
};
