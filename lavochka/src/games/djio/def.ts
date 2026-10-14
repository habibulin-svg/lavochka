/* «Чудовище Джио-Джанги» — карточка игры: правила с показом, боты, превью. Без DOM. */
import type { DemoScript, GameDef, Rng, SeatSpec } from '../../core/types';
import { SEATS } from '../hodilki/core';
import {
  CELLS, HOTEL, NEIGH, TO_ANIMAL, TO_HOTEL, apply, bestWeapon, camera, canBuy, describe, has, isAnimal,
  newState, options, scoreOf, shopAt, toAct, view,
  type Action, type Event, type State,
} from './engine';
import { ANIMALS, START_MONEY, itemOf, type ItemId } from './rules';

export const SEATS_LOCAL = SEATS.slice(0, 5);

/** Что бот покупает по порядку (и сколько оставляет на переправы и туземцев). */
const WISH: ItemId[][] = [
  ['photo', 'revolver', 'suit', 'presents', 'horse', 'aid', 'helmet'],
  ['horse', 'photo', 'revolver', 'helmet', 'suit', 'presents', 'aid', 'smoke'],
  ['horse', 'photo', 'gun', 'helmet', 'suit', 'presents', 'smoke', 'boat'],
];
const RESERVE = 40000;

function wishFor(s: State, seat: number, level: number): ItemId | null {
  for (const id of WISH[Math.min(level, 2)]) {
    if (has(s, seat, id)) continue;
    if (id === 'revolver' && bestWeapon(s, seat)) continue;
    if (s.money[seat] - itemOf(id).price < RESERVE) continue;
    if (canBuy(s, seat, id)) return id;
  }
  return null;
}

/** Боту пора домой: отснял своё (или экспедиция затянулась). */
const homeward = (s: State, seat: number, level: number) => s.away[seat] && (s.films[seat] >= [1, 2, 3][level] || s.skins[seat].length > 0 || s.rounds > 60 || !camera(s, seat));

export function choose(s: State, seat: number, level: number, rng: Rng): Action | null {
  if (s.over) return null;
  switch (s.phase) {
    case 'buy': {
      const want = wishFor(s, seat, level);
      return want ? { type: 'buy', item: want } : { type: 'done' };
    }
    case 'roll': {
      if (shopAt(s, seat)) {
        const want = wishFor(s, seat, level);
        if (want) return { type: 'buy', item: want };
      }
      if (isAnimal(s.pos[seat]) && !s.wait[seat] && camera(s, seat) && !homeward(s, seat, level)) return { type: 'film' };
      return { type: 'roll' };
    }
    case 'move': {
      const opts = options(s, seat);
      if (!opts.length) return null;
      if (level === 0 && rng.int(4) === 0) return { type: 'step', to: opts[rng.int(opts.length)] };
      const dist = homeward(s, seat, level) ? TO_HOTEL : TO_ANIMAL;
      let pick = opts[0];
      for (const n of opts) if (dist[n] >= 0 && (dist[pick] < 0 || dist[n] < dist[pick])) pick = n;
      return { type: 'step', to: pick };
    }
    case 'ask': {
      const ask = s.ask!;
      const o = ask.options;
      const first = (...ids: string[]) => ids.find((x) => o.includes(x));
      if (ask.kind === 'natives') return { type: 'pick', pick: first('presents', 'smoke', 'money') ?? o[o.length - 1] };
      if (ask.kind === 'cross') {
        const rich = s.money[seat] >= 60000;
        return { type: 'pick', pick: first('boat', ...(rich ? ['raft', 'local'] : ['local', 'raft']), 'rapids')! };
      }
      if (ask.kind === 'beast') {
        const need = s.fight?.need ?? ANIMALS.find((a) => a.id === CELLS[s.pos[seat]].what)?.hits ?? 1;
        const scared = level > 0 && need >= 5 && o.includes('smoke');
        return { type: 'pick', pick: scared ? 'smoke' : first('shoot', 'smoke')! };
      }
      if (ask.kind === 'buy') return { type: 'pick', pick: s.money[seat] > 60000 ? o[0] : 'none' };
      if (ask.kind === 'gift') return { type: 'pick', pick: first(bestWeapon(s, seat) ? 'helmet' : 'revolver', 'suit', 'presents', 'aid', 'helmet', 'smoke', 'boat') ?? o[0] };
      return { type: 'pick', pick: o[0] };
    }
    case 'shoot':
      return { type: 'shoot' };
  }
  return null;
}

export const money = (n: number) => `${n.toLocaleString('ru-RU')} $`;

/* ---------- показ правил ---------- */

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS_LOCAL[seat].name, level: 1 }));
/** Клетка нужного вида и соседняя с ней обычная клетка (с двумя дорогами), откуда на неё шагнуть. */
function near(pred: (i: number) => boolean): [number, number] {
  for (let i = 0; i < CELLS.length; i++) {
    if (!pred(i)) continue;
    const n = NEIGH[i].find((k) => CELLS[k].kind === 'plain' && NEIGH[k].length === 2);
    if (n != null) return [i, n];
  }
  return [HOTEL, NEIGH[HOTEL][0]];
}

function demo(patch: (s: State) => void, steps: DemoScript<State, Action>['steps']): DemoScript<State, Action> {
  return {
    seats: demoSeats,
    setup: (_def, rng) => {
      const s = newState([0, 1], rng);
      s.done = s.done.map(() => true);
      s.phase = 'roll';
      s.rounds = 1;
      s.turn = 0;
      patch(s);
      return s;
    },
    steps,
  };
}
const roll = (d: number, caption: string, rig: number[] = []) => ({ seat: 0, action: { type: 'roll' } as Action, rig: [d - 1, ...rig], caption });
const step = (to: number, caption: string, rig?: number[]) => ({ seat: 0, action: { type: 'step', to } as Action, rig, caption });
const pick = (p: string, caption: string, rig?: number[]) => ({ seat: 0, action: { type: 'pick', pick: p } as Action, rig, caption });
const shoot = (d: number, caption: string) => ({ seat: 0, action: { type: 'shoot' } as Action, rig: [d - 1], caption });

const [CARD, CARD_FROM] = near((i) => CELLS[i].kind === 'card');
const [SWAMP, SWAMP_FROM] = near((i) => CELLS[i].kind === 'swamp');
const [CROSS, CROSS_FROM] = near((i) => CELLS[i].kind === 'cross');
const [NATIVES, NATIVES_FROM] = near((i) => CELLS[i].what === 'natives');
const CROC = CELLS.findIndex((c) => c.what === 'croc');

export const def: GameDef<State, Action, Event, State> = {
  id: 'djio',
  title: 'Чудовище Джио-Джанги',
  players: { min: 2, max: 5, default: 3 },
  seats: SEATS_LOCAL,
  options: [
    {
      key: 'speed',
      label: 'Сборы',
      type: 'select',
      choices: [
        { value: 'long', label: 'по правилам — по одному предмету за ход' },
        { value: 'short', label: 'быстрые сборы — по три предмета за ход' },
      ],
      default: 'long',
    },
  ],
  presets: [
    { id: 'classic', label: 'Экспедиция по правилам', options: { speed: 'long' } },
    { id: 'quick', label: 'Быстрые сборы', options: { speed: 'short' } },
  ],
  setup: (seats, opts, rng) => newState(seats.map((x) => x.seat).sort((a, b) => a - b), rng, String(opts.speed ?? 'long') === 'short' ? 3 : 1),
  apply,
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose },
  describe,
  toAct,
  view,
  result: (s) => {
    if (s.winner == null) return null;
    const rows = s.seats
      .slice()
      .sort((a, b) => scoreOf(s, b) - scoreOf(s, a))
      .map((x) => `${SEATS_LOCAL[x]?.name ?? x}: ${money(scoreOf(s, x))}`);
    return {
      winners: [s.winner],
      text: `Экспедиция окончена — больше всех денег, шкур и снаряжения у ${SEATS_LOCAL[s.winner]?.name ?? s.winner}. Итог: ${rows.join('; ')}.`,
      scores: Object.fromEntries(s.seats.map((x) => [x, scoreOf(s, x)])),
    };
  },
  showcase: () => {
    const s = newState([0, 1, 2], { int: (n: number) => n - 1 } as Rng);
    s.done = s.done.map(() => true);
    s.phase = 'roll';
    s.rounds = 3;
    s.money = [START_MONEY - 40000, START_MONEY - 60000, START_MONEY + 50000];
    s.items[0] = ['horse', 'photo', 'revolver', 'helmet'];
    s.items[1] = ['photo', 'suit', 'gun'];
    s.items[2] = ['gun', 'cine'];
    s.pos[0] = NEIGH[HOTEL][0];
    s.pos[1] = CROSS;
    s.pos[2] = NATIVES;
    return s;
  },
  rules: {
    goal: 'Снарядить экспедицию в страну Джио-Джанга, отснять чудовищ (а если нападут — отстреляться), уцелеть и вернуться в гостиницу: кто вернулся первым — игра окончена, побеждает тот, у кого больше денег, шкур и снаряжения.',
    sections: [
      {
        title: 'Сборы',
        html: `<p>Каждый получает <b>${money(START_MONEY)}</b> кредита и по кругу покупает снаряжение — <b>по одному предмету за ход</b>
          (вещей немного, кому-то не достанется). Аптечка, спецодежда, шлем, дымовые шашки, подарки туземцам, надувная лодка,
          фото-, кино- и видеокамера, револьвер, ружьё, винчестер, карабин, лошадь. Часть денег стоит оставить на переправу и туземцев.
          Купить и продать можно и потом — в гостинице и в монастыре.</p>`,
        demo: {
          seats: demoSeats,
          setup: (_def, rng) => newState([0, 1], rng),
          steps: [
            { seat: 0, action: { type: 'buy', item: 'horse' }, caption: 'Вовка покупает лошадь за 30 000: к каждому броску +6.' },
            { seat: 1, action: { type: 'buy', item: 'photo' }, caption: 'Ленка — фотоаппарат: каждый снимок зверя сразу приносит деньги.' },
            { seat: 0, action: { type: 'buy', item: 'revolver' }, caption: 'Вовка — револьвер: серия 6 выстрелов, попадание на 5–6.' },
            { seat: 1, action: { type: 'done' }, caption: 'Ленке хватит — она закончила сборы.' },
          ],
        },
      },
      {
        title: 'Ход по ленте',
        html: `<p>Бросают кубик и идут по клеткам ленты <b>в любую сторону</b>, на развилках выбирая дорогу (подсвечено, куда можно
          шагнуть; фишку можно и перетащить). Назад в том же ходу не поворачивают. С лошадью к броску прибавляют <b>6</b>, но её можно
          вести на поводу. У гостиницы, большого дома, монастыря, хижины и костра, на берегу перед переправой и в тупике у логова
          зверя останавливаются, сколько бы ни выпало. Первый, кто дошёл до привала, даром берёт одну нераскупленную вещь.</p>`,
        demo: demo(() => {}, [
          roll(3, 'Вовка выходит из гостиницы: тройка. Дорога сразу раздваивается — выбирать ему.'),
          step(NEIGH[HOTEL][0], 'Вовка идёт по ленте: на каждой развилке выбор за ним.'),
        ]),
      },
      {
        title: 'Жёлтые клетки — карточки ситуаций',
        html: `<p>Остановился на жёлтой клетке — открываешь карточку ситуаций: находки, звери, комары, туземцы. Предметы с карточки
          берут, только если они остались в наборе. Нет нужной вещи — иной раз приходится стоять, пока не выпадет нужная цифра.</p>`,
        demo: demo(
          (s) => {
            s.pos[0] = CARD_FROM;
            s.deck = [4, ...s.deck.filter((n) => n !== 4)];
          },
          [roll(1, 'Единица — ровно до жёлтой клетки.'), step(CARD, 'Карточка: «Находка» — можно выбрать одну вещь.'), pick('helmet', 'Вовка берёт пробковый шлем.')]
        ),
      },
      {
        title: 'Зелёные клетки — болота',
        html: `<p>На болоте бросают кубик. <b>1–3 — москиты</b>: спецодежда или аптечка спасают, иначе лихорадка — стоять, пока не выпадет 6.
          <b>4–6 — трясина</b>: строго по порядку тонет лошадь, иначе бросаешь все вещи, кроме оружия, иначе кидаешь верёвку
          (три броска — хоть раз 4–6, и выбрался), а не вышло — гибель.</p>`,
        demo: demo(
          (s) => {
            s.pos[0] = SWAMP_FROM;
            s.items[0] = ['horse', 'revolver'];
            s.lead[0] = true;
          },
          [roll(1, 'Вовка ведёт лошадь на поводу — идёт на одну клетку, в болото.'), step(SWAMP, 'Бросок на болоте: пятёрка — трясина! Лошадь тонет, а Вовка спасён.', [4])]
        ),
      },
      {
        title: 'Синие клетки — переправа',
        html: `<p>Через реку переправляются четырьмя способами: <b>через пороги</b> (1–2 — гибель), на <b>лодке местных</b> за 20 000
          (1–2 — назад на берег, одна вещь тонет), на <b>плоту</b> за 40 000 (1 — назад), на своей <b>надувной лодке</b>
          (1–2 — назад и две вещи тонут). На берегу перед переправой останавливаются; с лошадью на воде 6 не прибавляют.</p>`,
        demo: demo((s) => (s.pos[0] = CROSS_FROM), [
          roll(1, 'Вовка выходит на берег.'),
          step(CROSS, 'Река: как переправляться — выбирать ему.'),
          pick('local', 'Лодка местных за 20 000: четвёрка — на том берегу.', [3]),
        ]),
      },
      {
        title: 'Красные клетки — туземцы и враги',
        html: `<p><b>Туземцы-людоеды</b>: отдай подарки, отсчитай 10 000, отдай любую вещь, купи у них лошадь или брось дымовые шашки — иначе съедят.
          <b>Гангстер, жрецы-людоеды, бешеный туземец, пума</b> — нужен один точный выстрел за серию, не попал — гибель.
          Гибель — всё пропадает, экспедиция начинается сначала из гостиницы с новым кредитом.</p>`,
        demo: demo(
          (s) => {
            s.pos[0] = NATIVES_FROM;
            s.items[0] = ['presents', 'revolver'];
          },
          [roll(1, 'Вовка выходит к стойбищу туземцев.'), step(NATIVES, 'Туземцы окружили: чем откупиться?'), pick('presents', 'Подарки — и путь свободен.')]
        ),
      },
      {
        title: 'Звери: съёмка и охота',
        html: `<p>У зверя бросают кубик: <b>1–3</b> — зверь спокоен, снимают и сразу получают деньги: фото 50 000, кино 70 000, видео 100 000,
          умноженные на редкость (крокодил и змея ×1, птеродактиль и эйпа ×2, чудовище ×4). Снимать можно и дальше — следующим ходом,
          не уходя. <b>4–6</b> — зверь нападает: стреляй серией (крокодил и змея — 2 попадания, птеродактиль и эйпа — 3, чудовище — 5)
          или брось дымовую шашку и уходи. Не убил за серию — зверь бьёт в ответ (крокодил 2 раза, …, чудовище 5): 4–6 — гибель.
          Убитый зверь — шкура: 150 000, 250 000 или 500 000.</p>`,
        demo: demo(
          (s) => {
            s.pos[0] = CROC;
            s.away[0] = true;
            s.items[0] = ['photo', 'gun'];
          },
          [
            { seat: 0, action: { type: 'film' }, rig: [4], caption: 'Вовка у крокодила снимает дальше: пятёрка — крокодил нападает!' },
            pick('shoot', 'Вовка берётся за ружьё: серия 4 выстрела, попадание на 4–6.'),
            shoot(6, 'Шестёрка — попадание!'),
            shoot(5, 'Ещё одно — крокодил убит, шкура стоит 150 000.'),
          ]
        ),
      },
      {
        title: 'Возвращение и итог',
        html: `<p>Кто побывал у зверей (или дошёл до костра) и первым вернулся в гостиницу — заканчивает игру; остальным идти назад не нужно.
          Считают деньги, шкуры и снаряжение по ценам таблицы — у кого больше, тот и победил.</p>`,
      },
    ],
  },
};

