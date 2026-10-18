/* «Заколдованная страна» (кооператив «Осень» при ГОЗНАК, 1990) — первая и единственная советская настольная ролевая игра.
 * Место 0 — ведущий (человек или бот), 1–5 — герои. Описание для сборника: настройки, режимы, боты, правила. */
import type { GameDef, Options, SeatLook, SeatSpec } from '../../core/types';
import { choose, LEVELS } from './bots';
import { CAMPAIGNS } from './content';
import type { Ev } from './ctx';
import { apply, free, setup, toAct, view, type Action, type View } from './engine';
import { rulesDoc } from './rulesdoc';
import { GM, type State } from './state';
import { setup as setupState } from './engine';

const SEATS: SeatLook[] = [
  { name: 'Ведущий', color: '#7a1f1f', light: '#c96a5a', dark: '#4a0e0e' },
  { name: 'Велимир', color: '#2f6fb0', light: '#7fb2e6', dark: '#173a60' },
  { name: 'Ярослава', color: '#3c8c3c', light: '#8fd08f', dark: '#1d4a1d' },
  { name: 'Добрыня', color: '#b07a1e', light: '#e8c27a', dark: '#5e3e08' },
  { name: 'Злата', color: '#8a3c9c', light: '#c99ad6', dark: '#4a1a55' },
  { name: 'Мирон', color: '#2a8a86', light: '#7fd1cc', dark: '#124644' },
];

function modeChoices() {
  return [
    { value: 'book', label: 'По книге: 15 приключений и «Прочее»' },
    ...Object.values(CAMPAIGNS).map((c) => ({ value: c.id, label: `Кампания: ${c.title}` })),
  ];
}

export const def: GameDef<State, Action, Ev, View> = {
  id: 'zakoldovannaya',
  title: 'Заколдованная страна',
  players: { min: 2, max: 6, default: 3 },
  countsHint: () => 'ведущий и от 1 до 5 героев; ведущим может быть бот',
  seats: SEATS,
  defaultHuman: 1,
  options: [
    { key: 'mode', label: 'Приключение', type: 'select', choices: modeChoices(), default: 'book', hint: 'по книге ведущего — все замки и дорожные встречи оригинала; кампании — сюжеты поверх той же карты' },
    { key: 'layout', label: 'Замки на карте', type: 'select', choices: [{ value: 'book', label: 'как в книге: лёгкие ближе к Форпосту' }, { value: 'shuffle', label: 'вперемешку — карточки кладутся наугад' }], default: 'book', showIf: (o) => (o.mode ?? 'book') === 'book' },
    { key: 'quick', label: 'Готовые герои', type: 'toggle', default: false, hint: 'качества, класс и покупки — броском и по совету; иначе каждый оформляет героя сам' },
    { key: 'rest', label: 'Отдых лечит', type: 'select', choices: [{ value: 'off', label: 'нет — только бальзамы и заклинания (по книге)' }, { value: 'inn', label: 'ночлег в трактире и городе' }, { value: 'always', label: 'и в трактире, и +1 ОР за ночь в пути' }], default: 'inn' },
    { key: 'spells', label: 'Заклинания', type: 'select', choices: [{ value: 'never', label: 'сколько раз написано — на всю игру (по книге)' }, { value: 'rest', label: 'восстанавливаются после ночлега' }], default: 'rest' },
    { key: 'death', label: 'Павший герой', type: 'select', choices: [{ value: 'dead', label: 'выбывает из игры (по книге)' }, { value: 'forpost', label: 'товарищи могут отнести в храм Форпоста' }], default: 'forpost' },
    { key: 'stats', label: 'Карточки опасностей открыты', type: 'toggle', default: false, hint: 'игроки видят КД, очки риска и стоимость; по правилам видит только ведущий' },
    { key: 'road', label: 'Встречи в пути', type: 'select', choices: [{ value: 20, label: 'редко' }, { value: 35, label: 'обычно' }, { value: 55, label: 'часто' }], default: 35 },
  ],
  presets: [
    { id: 'book', label: 'По книге', hint: 'как в 1990-м: ран не лечит отдых, заклинания — на всю игру, павший выбывает', options: { mode: 'book', rest: 'off', spells: 'never', death: 'dead', stats: false, quick: false } },
    { id: 'soft', label: 'Приключение', hint: 'ночлег лечит, заклинания восстанавливаются, павших несут в храм', options: { mode: 'book', rest: 'inn', spells: 'rest', death: 'forpost', stats: false, quick: false } },
    { id: 'quick', label: 'Сразу в путь', hint: 'готовые герои, карточки открыты', options: { mode: 'book', rest: 'inn', spells: 'rest', death: 'forpost', stats: true, quick: true } },
  ],
  setup: (seats: SeatSpec[], opts: Options, rng) => setup(seats, opts, rng),
  toAct,
  free: (s, seat, a) => free(s, seat, a),
  apply,
  view,
  result: (s) => (s.result ? { winners: s.result.win ? s.heroes.filter((h) => !h.dead).map((h) => h.seat) : [GM], text: s.result.text } : null),
  bot: { levels: LEVELS, choose },
  describe: (e) => (e.k === 'say' ? e.text : null),
  rules: rulesDoc,
  showcase: () => showcase(),
};

/** Превью карточки: отряд из трёх героев в пути у замков. */
function showcase(): State {
  let x = 12345;
  const rng = { next: () => ((x = (x * 1103515245 + 12345) >>> 0) / 4294967296), int: (n: number) => Math.floor(rng.next() * n), getState: () => x };
  const seats: SeatSpec[] = [0, 1, 2, 3].map((seat) => ({ seat, kind: seat ? 'human' : 'bot', name: SEATS[seat].name, level: 1 }) as SeatSpec);
  const s = setupState(seats, { quick: true }, rng);
  s.scene = null;
  s.phase = 'travel';
  s.where = { k: 'map', node: 27 };
  s.world.visited = ['c1:*', 'c1:c0', 'c3:*'];
  return s;
}
