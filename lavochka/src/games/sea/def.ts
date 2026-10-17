/* «Морские стратегии» — две морские игры художника В. М. Голицына (правила — журнал «Пионер», 1989–1990):
 * «Пираты» (испанцы везут золото в Кадикс, пираты его отбивают) и «Захват колоний» (кто первым наберёт 29 очков за порты),
 * и «Путешествие в Швамбранию» Л. Кассиля («Малыш») — поход вокруг страны по компасу с вопросниками (движок — shv/).
 * Одна карточка, игра выбирается настройкой «Игра», как поле у кинь-двинь. */
import type { DemoScript, GameDef, Options, Rng, SeatSpec } from '../../core/types';
import { SEATS as HSEATS } from '../hodilki/core';
import { choose, LEVELS } from './bot';
import { DEFAULTS, apply, newState, points, shipLabel, toAct, view, type Action, type Event, type Opts, type State } from './engine';
import { MAPS, type MapId } from './maps';
import { angleFor } from './spinner';
import { POINT_NAMES, type Point } from './wind';
import { chooseShv } from './shv/bot';
import { SHV_DEFAULTS, SHV_EVENTS, apply as applyShv, newShv, toAct as toActShv, type ShvAction, type ShvEvent, type ShvOpts, type ShvState } from './shv/engine';
import { SHV_RULES, describeShv } from './shv/rules';

type AnyState = State | ShvState;
type AnyAction = Action | ShvAction;
type AnyEvent = Event | ShvEvent;
const isShv = (s: AnyState): s is ShvState => s.game === 'shv';

export const SEATS = HSEATS.slice(0, 9);

const shvOpts = (o: Options): Partial<ShvOpts> => ({
  quiz: (o.quiz as ShvOpts['quiz']) ?? SHV_DEFAULTS.quiz,
  marks: Number(o.marks ?? SHV_DEFAULTS.marks),
  ice: SHV_DEFAULTS.ice,
  limit: Number(o.limit ?? SHV_DEFAULTS.limit),
});

const optsOf = (o: Options): Partial<Opts> => ({
  game: (o.game as MapId) ?? DEFAULTS.game,
  shore: (o.shore as Opts['shore']) ?? DEFAULTS.shore,
  oars: (o.oars as Opts['oars']) ?? DEFAULTS.oars,
  target: Number(o.target ?? DEFAULTS.target),
  ships: Number(o.ships ?? DEFAULTS.ships),
  revive: !!(o.revive ?? DEFAULTS.revive),
  limit: Number(o.limit ?? DEFAULTS.limit),
});

/* ---------- показ правил ---------- */

const two: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));

/** Позиция «Пиратов» для показа: Вовка — испанцы, Ленка — пираты; золото на «Пегасе». */
function pir(patch: (s: State) => void, steps: DemoScript<State, Action>['steps'], intro?: string): DemoScript<State, Action> {
  return {
    seats: two,
    options: { game: 'piraty' },
    setup: (_d, rng: Rng) => {
      const s = newState([0, 1], { game: 'piraty' }, rng);
      s.ships[0].gold = true;
      s.phase = 'spin';
      patch(s);
      return s;
    },
    intro,
    steps,
  };
}

function kol(patch: (s: State) => void, steps: DemoScript<State, Action>['steps']): DemoScript<State, Action> {
  return {
    seats: two,
    options: { game: 'kolonii' },
    setup: (_d, rng: Rng) => {
      const s = newState([0, 1], { game: 'kolonii' }, rng);
      s.seats = [0, 1];
      s.turn = 0;
      patch(s);
      return s;
    },
    steps,
  };
}

const at = (s: State, id: number, x: number, y: number, more: Partial<State['ships'][0]> = {}) => Object.assign(s.ships[id], { x, y }, more);
const spinTo = (seat: number, angle: number | number[], caption: string) => ({ seat, action: { type: 'spin' } as Action, rig: ([] as number[]).concat(angle), caption });
const mv = (seat: number, ship: number, course: Point, steps: number, caption: string) => ({ seat, action: { type: 'move', ship, course, steps } as Action, caption });
const end = (seat: number, caption?: string, rig?: number[]) => ({ seat, action: { type: 'end' } as Action, caption, ...(rig ? { rig } : {}) });
const fire = (seat: number, ships: number[], target: { ship: number } | { port: number }, angle: number, caption: string) => ({
  seat,
  action: { type: 'shoot', ships, target } as Action,
  rig: [angle],
  caption,
});

/** Пираты в открытой Атлантике — для большинства показов. */
const atlantic = (s: State) => {
  at(s, 0, 24, 14);
  at(s, 1, 24, 16);
  at(s, 2, 22, 15);
  at(s, 3, 30, 14);
};

const KOKOS = MAPS.kolonii.ports.findIndex((p) => p.name === 'Кокосовые о-ва');
const SING = MAPS.kolonii.ports.findIndex((p) => p.name === 'Сингапур');
const KOLOMBO = MAPS.kolonii.ports.findIndex((p) => p.name === 'Коломбо');

const RULES = [
  {
    title: 'Вертушка: ветер и погода',
    html: `<p>Кубика нет — ход начинается с <b>вертушки</b>. Стрелка показывает румб, <b>откуда</b> дует ветер («ветер дует в компас, а корабли идут из компаса»),
      и сектор погоды: <b>жёлтый — штиль</b>, <b>красный — ураган</b>, всё остальное поле — свежий ветер. Один ветер — на все корабли игрока.</p>
      <p>Каждый корабль за ход может раз пройти <b>по прямой</b> одним из восьми румбов (ходом коня нельзя) и раз выстрелить — до или после хода.
      Полное число клеток проходить не обязательно, можно и стоять.</p>`,
    demo: pir(atlantic, [
      spinTo(0, angleFor('W'), 'Вовка (испанцы) крутит вертушку: ветер с веста, свежий.'),
      mv(0, 0, 'E', 3, 'Ветер в корму — фордевинд: галион идёт на ост три клетки.'),
      mv(0, 1, 'NE', 3, 'Наискосок по ветру — бакштаг: тоже три.'),
      mv(0, 2, 'N', 2, 'Ветер в борт — галфвинд: две клетки.'),
      end(0),
      spinTo(1, angleFor('N', 'calm'), 'Ленке выпал жёлтый сектор — штиль. Галионы стояли бы, а пиратская бригантина идёт на вёслах на клетку.'),
      mv(1, 3, 'W', 1, 'Бригантина на вёслах — на клетку в любую сторону.'),
      end(1),
    ]),
  },
  {
    title: 'Курсы под парусами',
    html: `<p>Скорость зависит от угла между курсом и ветром:</p>
      <ul><li><b>фордевинд</b> (ветер прямо в корму) и <b>бакштаг</b> (наискосок в корму) — <b>3 клетки</b>;</li>
      <li><b>галфвинд</b> (ветер в борт) — <b>2 клетки</b>;</li>
      <li><b>бейдевинд</b> (наискосок против ветра) — <b>1 клетка</b>;</li>
      <li>прямо против ветра парусник не идёт — надо сворачивать или стоять.</li></ul>
      <p>Через клетку с кораблём и через чужой порт пройти нельзя; в одной клетке — один корабль (кроме портов).
      Пираты на вёслах проходят клетку и против ветра (поправка игроков; по журналу — только в штиль).</p>`,
    demo: pir(atlantic, [
      spinTo(0, angleFor('N'), 'Ветер с норда.'),
      mv(0, 1, 'E', 2, 'На ост — галфвинд, две клетки.'),
      mv(0, 0, 'S', 3, 'На зюйд — фордевинд, три.'),
      mv(0, 2, 'NE', 1, 'На норд-ост — бейдевинд, одна: круто к ветру.'),
      end(0),
      spinTo(1, angleFor('N'), 'Ленке тоже норд.'),
      mv(1, 3, 'N', 1, 'Прямо против ветра бригантина идёт на вёслах — на одну клетку.'),
      end(1),
    ]),
  },
  {
    title: 'Ураган и берег',
    html: `<p><b>Ураган</b> (красный сектор) сносит все корабли игрока, кроме стоящих в порту, на клетку по ветру. В порту ураган не страшен, но и выйти нельзя.
      Если снесло на клетку с другим кораблём — оба остаются на местах.</p>
      <p>«Пираты»: если ураган несёт судно на берег, оно гибнет. Поправка игроков: вертушку крутят ещё раз — если ветер опять гонит на скалы,
      кораблекрушение, если дует с берега — корабль уцелел. Золотой галион на дно не идёт: он ничейный, и его забирает тот, кто первым подойдёт вплотную.</p>
      <p>«Захват колоний»: выброшенный на берег корабль гибнет, если при его следующем ходе снова ураган; иначе снимается с мели.</p>`,
    demo: pir(
      (s) => {
        atlantic(s);
        at(s, 0, 45, 8);
      },
      [
        spinTo(
          0,
          [angleFor('W', 'storm'), angleFor('E')],
          'Красный сектор — ураган с веста! Всех сносит на ост. «Пегас» у берегов Португалии гонит на скалы — крутят ещё раз: выпал ост, ветер с берега, галион уцелел.',
        ),
        end(0),
      ],
    ),
  },
  {
    title: 'Течения',
    html: `<p>Стрелки на карте — <b>морские течения</b>. Корабль, попавший на хвост стрелки, сносит на клетку к её острию, и он идёт дальше прежним курсом.
      Прямо против течения можно идти, только если ветер даёт этим курсом хотя бы две клетки.</p>`,
    demo: pir(
      (s) => {
        atlantic(s);
        at(s, 0, 19, 10);
      },
      [spinTo(0, angleFor('S'), 'Ветер с зюйда.'), mv(0, 0, 'N', 3, 'Галион идёт на норд, на второй клетке его подхватывает Гольфстрим и сносит на ост — дальше он идёт тем же курсом.'), end(0)],
    ),
  },
  {
    title: 'Бой',
    html: `<p>Стреляют той же вертушкой: выпал <b>основной румб</b> (N, O, S, W) — <b>попадание</b>, <b>четвертной</b> (NO, SO, SW, NW) — промах.
      Галионы бьют во все стороны на <b>две клетки</b>, бригантины — на <b>одну</b>. Галион тонет с трёх попаданий, бригантина — с двух.</p>
      <p>Можно бить <b>залпом</b> несколькими кораблями по одному щелчку вертушки: попали — пробоин столько, сколько стреляло кораблей.
      Стрелять из порта и в порт нельзя («Пираты»).</p>`,
    demo: pir(
      (s) => {
        atlantic(s);
        at(s, 2, 23, 13);
        at(s, 3, 25, 13);
        at(s, 4, 25, 15);
        s.turn = 1;
      },
      [
        spinTo(1, angleFor('E'), 'Ход Ленки: две бригантины рядом с галионом.'),
        fire(1, [3, 4], { ship: 0 }, angleFor('S'), 'Залп двумя бригантинами: выпал зюйд — основной румб, попадание! Сразу две пробоины.'),
        end(1),
        spinTo(0, angleFor('W'), 'Вовка отвечает.'),
        fire(0, [1], { ship: 4 }, angleFor('NE'), 'Выпал норд-ост — четвертной румб, промах.'),
        fire(0, [2], { ship: 3 }, angleFor('E'), 'Галион бьёт на две клетки: ост — попадание, у бригантины пробоина.'),
        end(0),
      ],
    ),
  },
  {
    title: 'Золотой галион',
    html: `<p>Золото везёт один галион — испанцы <b>тайно</b> выбирают его в начале. Задача испанцев — довести его в <b>Кадикс</b>,
      пиратов — вычислить, отбить и увести на <b>любую пиратскую базу</b> (их шесть: три в Европе, три у Америки). Начинают испанцы.</p>
      <p>Потопленный корабль снимается с карты, но золотой галион не тонет: пираты спешно заделывают пробоину и ведут его как свой,
      а испанцам хватает <b>одного</b> меткого попадания, чтобы отбить его обратно.</p>`,
    demo: pir(
      (s) => {
        atlantic(s);
        at(s, 0, 25, 14, { hits: 2 });
        at(s, 3, 26, 14);
        at(s, 1, 23, 14);
        s.turn = 1;
      },
      [
        spinTo(1, angleFor('E'), 'У «Пегаса» с золотом уже две пробоины.'),
        fire(1, [3], { ship: 0 }, angleFor('S'), 'Попадание — третья пробоина! Но галион не тонет: на нём золото, и его ведут пираты.'),
        end(1),
        spinTo(0, angleFor('N'), 'Испанцы крутят вертушку.'),
        fire(0, [1], { ship: 0 }, angleFor('W'), 'Одно меткое попадание — и золотой галион снова у испанцев.'),
        end(0),
      ],
    ),
  },
  {
    title: 'Починка',
    html: `<p>Корабль чинится, зайдя в порт: «Пираты» — <b>пропуск хода за каждую пробоину</b>; испанцы чинятся только в испанских портах
      (на карте — квадрат с крестом), пираты — на своих базах. «Захват колоний» — только в своих колониях, пропуск одного хода.</p>`,
    demo: pir(
      (s) => {
        atlantic(s);
        const tortuga = MAPS.piraty.ports.find((p) => p.name === 'Тортуга')!;
        at(s, 3, tortuga.x, tortuga.y, { hits: 1 });
        s.turn = 1;
      },
      [spinTo(1, angleFor('N'), 'Бригантина с пробоиной стоит на Тортуге.'), { seat: 1, action: { type: 'repair', ship: 3 }, caption: 'Чинится: один ход пропускает.' }, end(1)],
    ),
  },
  {
    title: 'Захват колоний',
    html: `<p>В «Захвате колоний» у каждого по три корабля (вдвоём-втроём) или по два (вчетвером-впятером); все выходят из квадратика в левом нижнем углу карты.
      Цифры на странах — <b>цена колоний</b>. Порт надо сбить: попасть в него столько раз, сколько половина цены (цена 6 и 5 — три раза, 3 — два, 1 — один),
      потом войти в него — колония ваша. Корабли и порты бьют на две клетки.</p>
      <p>Побеждает тот, кто первым наберёт <b>29 очков</b>.</p>`,
    demo: kol(
      (s) => at(s, 0, 17, 20),
      [
        spinTo(0, angleFor('N'), 'Ветер с норда. «Пегас» в двух клетках от Кокосовых островов (цена 1).'),
        fire(0, [0], { port: KOKOS }, angleFor('E'), 'Ост — попадание: Кокосовые сбиты с одного раза.'),
        mv(0, 0, 'S', 2, 'По ветру — в порт: «Кокосовые — 1 очко» в журнал.'),
        end(0),
      ],
    ),
  },
  {
    title: 'Ответный огонь и укрепление',
    html: `<p>Если по ничейному порту промахнулись, его батареи <b>отвечают</b>: бьют по каждому кораблю обидчика в пределах двух клеток.
      Своя колония сама бьёт по чужим кораблям рядом. Нападать на чужие корабли и колонии может только тот, у кого есть хотя бы одна колония.</p>
      <p>У каждого корабля по <b>5 боеприпасов</b>: сложив их в свою колонию, её <b>укрепляют</b> — сбивать придётся дольше («Сингапур» сшибался с двух,
      с пятью боеприпасами — с семи). Боеприпасы можно забрать обратно. Сбитый порт достаётся тому, кто первым в него войдёт.</p>`,
    demo: kol(
      (s) => {
        const sg = MAPS.kolonii.ports[SING];
        s.ports[SING].owner = 0;
        at(s, 0, sg.x, sg.y);
        at(s, 1, 8, 13);
      },
      [
        spinTo(0, angleFor('N'), 'Сингапур уже у Вовки.'),
        { seat: 0, action: { type: 'unload', ship: 0 }, caption: '«Пегас» сгружает пять боеприпасов: Сингапур теперь сшибается с семи попаданий.' },
        fire(0, [1], { port: KOLOMBO }, angleFor('NE'), '«Цефея» бьёт по Коломбо — норд-ост, промах…'),
        end(0, '…и батареи Коломбо отвечают: попадание!', [angleFor('S')]),
      ],
    ),
  },
  {
    title: 'Конец игры и варианты',
    html: `<p>«Пираты»: испанцы побеждают, когда золотой галион входит в Кадикс, пираты — когда уводят его на свою базу. Играют от двух до девяти:
      вдвоём — один за испанцев, другой за пиратов; дальше корабли делятся между игроками каждой стороны.</p>
      <p>«Захват колоний»: от двух до пяти игроков, до 29 очков. Погибшие корабли убираются в коробочку или возвращаются в игру — как договоритесь.
      Предел кругов можно поставить, чтобы партия не затягивалась: тогда в «Колониях» побеждает больше всех набравший, в «Пиратах» — ничья.</p>`,
  },
];

/* ---------- превью ---------- */

function showcase(): State {
  const rng = { next: () => 0.3, int: (n: number) => Math.floor(n * 0.3), getState: () => 0 };
  const s = newState([0, 1, 2, 3], { game: 'piraty' }, rng);
  s.ships[1].gold = true;
  s.phase = 'act';
  const pos: [number, number, number][] = [
    [0, 22, 15],
    [1, 26, 13],
    [2, 27, 15],
    [3, 28, 12],
    [4, 29, 14],
    [5, 24, 17],
    [6, 33, 9],
    [7, 18, 18],
    [8, 40, 6],
  ];
  for (const [id, x, y] of pos) if (s.ships[id]) Object.assign(s.ships[id], { x, y });
  s.ships[1].hits = 1;
  s.ships[4].hits = 1;
  s.wind = { angle: 290, from: 'W', weather: 'breeze', main: true };
  s.round = 9;
  s.turn = 1;
  return s;
}

export const def: GameDef<AnyState, AnyAction, AnyEvent, AnyState> = {
  id: 'sea',
  title: 'Морские стратегии',
  players: { min: 2, max: 9, default: 2 },
  countsFor: (o) => (o.game === 'kolonii' || o.game === 'shv' ? [2, 3, 4, 5] : [2, 3, 4, 5, 6, 7, 8, 9]),
  countsHint: (o) =>
    o.game === 'shv' ? 'от двух до пяти капитанов' : o.game === 'kolonii' ? 'от двух до пяти капитанов' : 'вдвоём — испанцы против пиратов; до девяти — по кораблю на каждого',
  seats: SEATS,
  options: [
    {
      key: 'game',
      label: 'Игра',
      type: 'select',
      choices: [
        { value: 'piraty', label: 'Пираты — золото из Америки' },
        { value: 'kolonii', label: 'Захват колоний — до 29 очков' },
        { value: 'shv', label: 'Путешествие в Швамбранию — по компасу вокруг страны' },
      ],
      default: 'piraty',
    },
    {
      key: 'quiz',
      label: 'Вопросники',
      type: 'select',
      choices: [
        { value: 'letters', label: 'по правилам: номер и буква на компасе' },
        { value: 'easy', label: 'облегчённый вариант: только номер (для младших)' },
        { value: 'none', label: 'без вопросников — одна гонка' },
      ],
      default: SHV_DEFAULTS.quiz,
      showIf: (o) => o.game === 'shv',
    },
    {
      key: 'marks',
      label: 'Марок на дорогу',
      type: 'select',
      choices: [
        { value: 30, label: '30 швамбраний, как в правилах' },
        { value: 20, label: '20 — туже с топливом' },
        { value: 45, label: '45 — с запасом' },
      ],
      default: SHV_DEFAULTS.marks,
      showIf: (o) => o.game === 'shv',
    },
    {
      key: 'shore',
      label: 'Ураган гонит на скалы',
      type: 'select',
      choices: [
        { value: 'respin', label: 'вертушку крутят ещё раз (поправка игроков)' },
        { value: 'wreck', label: 'корабль гибнет (журнал «Пионер»)' },
      ],
      default: DEFAULTS.shore,
      showIf: (o) => o.game === 'piraty' || o.game === undefined,
    },
    {
      key: 'oars',
      label: 'Вёсла пиратов',
      type: 'select',
      choices: [
        { value: 'against', label: 'в штиль и на клетку против ветра' },
        { value: 'calm', label: 'только в штиль' },
      ],
      default: DEFAULTS.oars,
      showIf: (o) => o.game === 'piraty' || o.game === undefined,
    },
    {
      key: 'target',
      label: 'Очков до победы',
      type: 'select',
      choices: [
        { value: 29, label: '29, как в правилах' },
        { value: 20, label: '20 — короткая партия' },
        { value: 40, label: '40 — долгая' },
      ],
      default: DEFAULTS.target,
      showIf: (o) => o.game === 'kolonii',
    },
    {
      key: 'ships',
      label: 'Кораблей у каждого',
      type: 'select',
      choices: [
        { value: 0, label: 'по правилам: до трёх игроков — 3, больше — 2' },
        { value: 2, label: '2' },
        { value: 3, label: '3' },
      ],
      default: DEFAULTS.ships,
      showIf: (o) => o.game === 'kolonii',
    },
    { key: 'revive', label: 'Погибшие корабли возвращаются', hint: 'в квадратик старта при следующем ходе', type: 'toggle', default: DEFAULTS.revive, showIf: (o) => o.game === 'kolonii' },
    {
      key: 'limit',
      label: 'Предел кругов',
      type: 'select',
      choices: [
        { value: 0, label: 'без предела' },
        { value: 80, label: '80' },
        { value: 150, label: '150' },
      ],
      default: DEFAULTS.limit,
    },
  ],
  presets: [
    { id: 'piraty', label: 'Пираты — с поправками игроков', options: { game: 'piraty', shore: 'respin', oars: 'against' } },
    { id: 'piraty-pioner', label: 'Пираты — по журналу «Пионер»', hint: 'на скалах гибнут сразу, вёсла только в штиль', options: { game: 'piraty', shore: 'wreck', oars: 'calm' } },
    { id: 'kolonii', label: 'Захват колоний', options: { game: 'kolonii', target: 29, ships: 0, revive: false } },
    { id: 'kolonii-short', label: 'Захват колоний — до 20 очков', options: { game: 'kolonii', target: 20, ships: 0, revive: true } },
    { id: 'shv', label: 'Путешествие в Швамбранию', hint: 'по книге правил: компас, вопросники с буквой, 30 марок', options: { game: 'shv', quiz: 'letters', marks: 30 } },
    { id: 'shv-easy', label: 'Швамбрания — облегчённый вариант', hint: 'буква не нужна: назвать любое слово раздела', options: { game: 'shv', quiz: 'easy', marks: 30 } },
    { id: 'shv-race', label: 'Швамбрания — без вопросников', hint: 'одна гонка вокруг страны', options: { game: 'shv', quiz: 'none', marks: 30 } },
  ],
  setup: (seats, o, rng) =>
    o.game === 'shv'
      ? newShv(
          seats.map((x) => x.seat),
          seats.filter((x) => x.kind !== 'bot').map((x) => x.seat),
          shvOpts(o),
          rng,
        )
      : newState(seats.map((x) => x.seat), optsOf(o), rng),
  toAct: (s) => (isShv(s) ? toActShv(s) : toAct(s)),
  apply: (s, seat, a, rng) => (isShv(s) ? applyShv(s, seat, a as ShvAction, rng) : apply(s, seat, a as Action, rng)),
  view: (s, seats) => (isShv(s) ? s : view(s, seats)),
  result: (s) =>
    s.result
      ? { winners: s.result.winners, text: s.result.text, scores: s.game === 'kolonii' ? Object.fromEntries(s.seats.map((x) => [x, points(s as State, x)])) : undefined }
      : null,
  bot: { levels: LEVELS, choose: (v, seat, level, rng) => (isShv(v) ? chooseShv(v, seat, level, rng) : choose(v, seat, level, rng)) },
  describe(ev, name) {
    if (SHV_EVENTS.has(ev.t)) return describeShv(ev as ShvEvent, name);
    const e = ev as Event;
    switch (e.t) {
      case 'gold':
        return `${name(e.seat)} тайно выбрал галион с золотом`;
      case 'spin':
        return `${name(e.seat)}: ${e.spin.weather === 'calm' ? 'штиль' : e.spin.weather === 'storm' ? `ураган с ${POINT_NAMES[e.spin.from]}а` : `ветер с ${POINT_NAMES[e.spin.from]}а`}`;
      case 'shot':
        return `${name(e.seat)}: ${e.ships.length > 1 ? `залп ${e.ships.length} кораблей` : 'выстрел'} — ${e.holes ? `попадание${e.holes > 1 ? `, пробоин: ${e.holes}` : ''}` : 'промах'}${e.sunk ? ', корабль потоплен' : ''}${e.captured ? ', золотой галион взят!' : ''}${e.recaptured ? ', золотой галион отбит!' : ''}${e.down ? ', порт сбит' : ''}`;
      case 'portFire':
        return `Батареи порта бьют: ${e.spin.main ? 'попадание' : 'промах'}${e.sunk ? ', корабль потоплен' : ''}`;
      case 'claim':
        return `${name(e.seat)} занял ${MAPS.kolonii.ports[e.port].name} (${MAPS.kolonii.ports[e.port].value})`;
      case 'drift':
        return e.wreck ? (e.derelict ? 'Золотой галион разбит о скалы — он ничей!' : 'Кораблекрушение!') : e.shore ? (e.respin ? 'Ураган гнал на скалы, но корабль уцелел' : 'Корабль выброшен на берег') : null;
      case 'salvage':
        return `${name(e.seat)} забирает ничейный золотой галион`;
      case 'repair':
        return `Корабль чинится${e.turns > 1 ? ` (${e.turns} хода)` : ''}`;
      case 'ammo':
        return e.n > 0 ? `В порт сложено боеприпасов: ${e.n}` : `Из порта взято боеприпасов: ${-e.n}`;
      case 'end':
        return `<b>${e.result.text}</b>`;
      default:
        return null;
    }
  },
  rules: {
    goal: `Три морские игры. Две — В. М. Голицына на его картах: <b>«Пираты»</b> (испанцы ведут галион с золотом из Вера-Круца в Кадикс, пираты его ищут и отбивают)
      и <b>«Захват колоний»</b> (капитаны сбивают и занимают порты Индийского и Тихого океанов — кто первым наберёт 29 очков).
      Третья — <b>«Путешествие в Швамбранию»</b> Льва Кассиля: поход вокруг выдуманной страны по компасу-циферблату, с вопросниками в гаванях, —
      кто первым бросит якорь на Большом рейде Швамбраэны.`,
    sections: [...RULES, ...SHV_RULES],
  },
  showcase,
};

export { shipLabel };
