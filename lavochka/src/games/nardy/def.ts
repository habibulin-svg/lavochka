/* Нарды — описание игры для сборника: варианты, боты, журнал, правила с показом. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { plural } from '../../core/util';
import { choose } from './ai';
import { apply, absOf, BAR, cfgFrom, DEFAULT_CFG, newGame, OFF, sign, toAct, type Action, type Cfg, type EndKind, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Белые', color: '#e8dcc0', light: '#fffaf0', dark: '#8a7a5a', ink: '#7a5f30' },
  { name: 'Чёрные', color: '#2a211c', light: '#5a4a40', dark: '#0d0a08' },
];

/** Номер пункта глазами игрока: 24 — голова / самый дальний, 1 — последний пункт дома. */
const ptName = (i: number) => (i === BAR ? 'бар' : i === OFF ? 'снята' : String(24 - i));

const END_TEXT: Record<EndKind, string> = { oin: 'ойн', mars: 'марс', koks: 'кокс', drop: 'отказ от удвоения' };

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'opening': {
      const last = ev.rolls[ev.rolls.length - 1];
      const ties = ev.rolls.length > 1 ? ` (${ev.rolls.length - 1} ${plural(ev.rolls.length - 1, 'раз', 'раза', 'раз')} поровну)` : '';
      return `${ev.game > 1 ? `<b>Партия ${ev.game}.</b> ` : ''}Розыгрыш первого хода: ${name(0)} ${last[0]}, ${name(1)} ${last[1]}${ties} — начинают ${name(ev.first)}.`;
    }
    case 'roll': {
      let t = `${name(ev.seat)}: <b>${ev.dice[0]}:${ev.dice[1]}</b>`;
      if (ev.dice[0] === ev.dice[1]) t += ' — дубль';
      if (ev.cascade?.length) t += `, каскад до ${ev.cascade[ev.cascade.length - 1]}:${ev.cascade[ev.cascade.length - 1]}`;
      if (ev.noMoves) t += '. <i>Ходов нет.</i>';
      return t;
    }
    case 'stage':
      return `<i>Каскад: дубль ${ev.value}:${ev.value}.</i>`;
    case 'move': {
      let t = `${name(ev.seat)}${ev.stolen ? ' (за соперника)' : ''}: ${ev.from === BAR ? 'с бара' : ptName(ev.from)} → ${ev.to === OFF ? 'снята' : ptName(ev.to)}`;
      if (ev.hit) t += ' — <b>бьёт!</b>';
      return t;
    }
    case 'forfeit':
      return `<i>${name(ev.seat)}: ${ev.count} ${plural(ev.count, 'ход', 'хода', 'ходов')} ${ev.toOpponent ? 'уходит сопернику' : 'сгорает'} — сыграть нельзя.</i>`;
    case 'steal':
      return `${name(ev.seat)} доигрывает за соперника остаток каскада (${ev.count}).`;
    case 'double':
      return `${name(ev.seat)} предлагает удвоить — до <b>${ev.value}</b>.`;
    case 'take':
      return `${name(ev.seat)} принимает. Куб: ${ev.value}.`;
    case 'drop':
      return `${name(ev.seat)} сдаётся.`;
    case 'gameEnd': {
      const pts = `+${ev.points} ${plural(ev.points, 'очко', 'очка', 'очков')}`;
      return `🏆 <b>${name(ev.winner)}</b>: ${END_TEXT[ev.kind]}${ev.cube > 1 ? ` ×${ev.cube}` : ''} (${pts}). Счёт ${ev.score[0]}:${ev.score[1]}.`;
    }
  }
  return null;
}

// ---------- позиции для показа правил ----------

const demoSeats: SeatSpec[] = [
  { seat: 0, kind: 'bot', name: 'Белые', level: 1 },
  { seat: 1, kind: 'bot', name: 'Чёрные', level: 1 },
];

/** Позиция: шашки [индекс пути, сколько] для белых и чёрных, ход белых, ждём броска. */
function pos(c: Partial<Cfg>, white: [number, number][], black: [number, number][], extra: Partial<State> = {}): State {
  const cfg: Cfg = { ...DEFAULT_CFG, ...c };
  const s = newGame(cfg);
  s.pts = new Array(24).fill(0);
  const put = (p: number, list: [number, number][]) => {
    for (const [i, n] of list) {
      if (i === BAR) s.bar[p] += n;
      else s.pts[absOf(cfg, p, i)] += n * sign(p);
    }
  };
  put(0, white);
  put(1, black);
  const onBoard = (p: number, list: [number, number][]) => list.reduce((a, [, n]) => a + n, 0);
  s.off = [15 - onBoard(0, white), 15 - onBoard(1, black)];
  s.phase = 'roll';
  s.cur = 0;
  s.turns = [3, 3];
  return Object.assign(s, extra);
}

const dice = (a: number, b: number) => [a - 1, b - 1];
const mv = (from: number, die: number, caption?: string) => ({ seat: 0, action: { type: 'move', from, die } as Action, caption });

export const def: GameDef<State, Action, Event, State> = {
  id: 'nardy',
  title: 'Нарды',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,

  options: [
    {
      key: 'mode',
      label: 'Игра',
      type: 'select',
      choices: [
        { value: 'long', label: 'длинные нарды' },
        { value: 'short', label: 'короткие нарды' },
        { value: 'gulbara', label: 'гюльбара' },
      ],
      default: 'long',
    },
    {
      key: 'target',
      label: 'Матч',
      type: 'select',
      choices: [
        { value: 1, label: 'одна партия' },
        { value: 3, label: 'до 3 очков' },
        { value: 5, label: 'до 5 очков' },
        { value: 7, label: 'до 7 очков' },
      ],
      default: 1,
    },
    {
      key: 'head',
      label: 'С головы за ход',
      type: 'select',
      choices: [
        { value: 'classic', label: 'одна; первым ходом на дубль — две' },
        { value: 'strict', label: 'всегда одна' },
        { value: 'free', label: 'сколько угодно' },
      ],
      default: 'classic',
      showIf: (o) => o.mode !== 'short',
    },
    {
      key: 'block6',
      label: 'Блок из шести подряд',
      type: 'select',
      choices: [
        { value: 'rule', label: 'можно, если впереди есть шашка соперника' },
        { value: 'home', label: 'можно, если у соперника есть шашка дома' },
        { value: 'forbid', label: 'нельзя' },
        { value: 'allow', label: 'можно всегда' },
      ],
      default: 'rule',
      showIf: (o) => o.mode !== 'short',
    },
    { key: 'mars', label: 'Марс — 2 очка', hint: 'Соперник не успел снять ни одной шашки.', type: 'toggle', default: true },
    {
      key: 'koks',
      label: 'Кокс — 3 очка',
      hint: 'Марс, да ещё у проигравшего шашки остались в первой четверти пути (в коротких — на баре или в доме победителя).',
      type: 'toggle',
      default: false,
      showIf: (o) => o.mars === true,
    },
    { key: 'cube', label: 'Куб удвоения', hint: 'Перед броском можно предложить удвоить ставку; отказ — проигрыш по текущему кубу.', type: 'toggle', default: false, showIf: (o) => o.mode === 'short' },
    { key: 'cascade', label: 'Каскад дублей', hint: 'С четвёртого хода дубль тянет за собой все старшие дубли до 6:6.', type: 'toggle', default: true, showIf: (o) => o.mode === 'gulbara' },
    { key: 'steal', label: 'Остаток каскада доигрывает соперник', type: 'toggle', default: true, showIf: (o) => o.mode === 'gulbara' && o.cascade === true },
  ],
  presets: [
    { id: 'long', label: 'Длинные', hint: 'Одна шашка с головы, без боя, марс — 2', options: { mode: 'long', target: 1, head: 'classic', block6: 'rule', mars: true, koks: false } },
    { id: 'long-match', label: 'Длинные до 5', hint: 'Матч до 5 очков, марс и кокс', options: { mode: 'long', target: 5, head: 'classic', block6: 'rule', mars: true, koks: true } },
    { id: 'short', label: 'Короткие', hint: 'С боем и баром, марс и кокс', options: { mode: 'short', target: 1, mars: true, koks: true, cube: false } },
    { id: 'short-cube', label: 'Короткие с кубом', hint: 'Матч до 5 очков с кубом удвоения', options: { mode: 'short', target: 5, mars: true, koks: true, cube: true } },
    { id: 'gulbara', label: 'Гюльбара', hint: 'Каскад дублей до 6:6', options: { mode: 'gulbara', target: 1, head: 'free', block6: 'rule', mars: true, koks: false, cascade: true, steal: true } },
  ],

  setup: (_seats, opts) => newGame(cfgFrom(opts)),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s) => s,
  result(s) {
    if (s.phase !== 'over' || s.winner == null) return null;
    const scores = { 0: s.score[0], 1: s.score[1] };
    if (s.cfg.target > 1) return { winners: [s.winner], text: `выиграли матч ${s.score[0]}:${s.score[1]}`, scores };
    const k = s.lastEnd?.kind ?? 'oin';
    const txt = k === 'mars' ? 'марс — выиграли вдвойне' : k === 'koks' ? 'кокс — выиграли втройне' : k === 'drop' ? 'соперник отказался от удвоения' : 'первыми сняли все шашки';
    return { winners: [s.winner], text: txt, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose },
  describe,

  showcase: () =>
    pos(
      { mode: 'long' },
      [[0, 7], [3, 2], [5, 1], [8, 2], [13, 1], [19, 2]],
      [[0, 6], [2, 2], [4, 1], [7, 2], [11, 1], [14, 1], [16, 2]],
      { phase: 'move', dice: [5, 3], left: [5, 3], turns: [12, 12] }
    ),

  rules: {
    goal: 'Первым провести все 15 шашек по кругу в свой дом и снять их с доски.',
    sections: [
      {
        title: 'Длинные нарды: доска и ход',
        html: `<p>У каждого 15 шашек. В длинных нардах все шашки стоят стопкой на <b>голове</b> — крайнем пункте, и оба игрока ходят в одну сторону, против часовой стрелки:
          белые от правого верхнего угла, чёрные — от левого нижнего. Дом белых — справа внизу, чёрных — слева вверху.</p>
          <p>Бросают два кубика: каждый кубик — отдельный ход (одной шашкой или двумя). Дубль играется четыре раза.
          Если сходить можно — ходить обязательно, и сыграть надо как можно больше кубиков; если получается сыграть только один — больший.</p>
          <p>С головы за ход можно снять <b>одну</b> шашку.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos({ mode: 'long' }, [[0, 14], [7, 1]], [[0, 14], [5, 1]]),
          intro: 'Обе стороны только начали.',
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: dice(6, 5), caption: 'У белых 6 и 5.' },
            mv(0, 6, 'Шестёркой — шашка с головы.'),
            mv(6, 5, 'Вторую с головы снять нельзя — пятёркой идёт та же шашка.'),
          ],
        },
      },
      {
        title: 'Первый ход: две с головы',
        html: `<p>Исключение: если первым ходом выпал <b>любой дубль</b>, с головы можно снять две шашки.</p>
          <p>Это можно отключить в настройках («всегда одна») или снять ограничение совсем.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos({ mode: 'long' }, [[0, 15]], [[0, 15]], { turns: [0, 0] }),
          intro: 'Самое начало партии.',
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: dice(6, 6), caption: 'Выпало 6:6!' },
            mv(0, 6, 'Первая шашка с головы.'),
            mv(0, 6, 'И вторая — это разрешено только сейчас. Остальные шестёрки упираются в голову чёрных и сгорают.'),
          ],
        },
      },
      {
        title: 'Без боя. Блок из шести',
        html: `<p>В длинных нардах шашки не бьют: на пункт, где стоит хоть одна шашка соперника, вставать нельзя. Одна шашка уже держит пункт.</p>
          <p>Шесть занятых пунктов подряд — <b>блок</b>: через него не перепрыгнуть. Строить его можно, только если впереди блока уже есть хотя бы одна шашка соперника — запереть все 15 нельзя.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos({ mode: 'long' }, [[0, 6], [13, 2], [14, 1], [15, 1], [16, 1], [17, 1], [9, 3]], [[0, 15]]),
          intro: 'Белые держат пять пунктов подряд перед головой чёрных.',
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: dice(5, 1), caption: 'Выпало 5 и 1. Пойти пятёркой с 11-го на 6-й — значит замкнуть шесть пунктов подряд, а впереди блока чёрных нет. Так нельзя.' },
            mv(9, 5, 'Пятёрку играем другой шашкой…'),
            mv(14, 1, '…и единицу тоже. Блок не замкнут.'),
          ],
        },
      },
      {
        title: 'Дом и снятие шашек',
        html: `<p>Когда все 15 шашек в доме (последние шесть пунктов), их снимают: кубик снимает шашку с пункта своего номера.</p>
          <p>Если на этом пункте шашки нет — ходят шашкой со старшего пункта, а если и там пусто, большим кубиком снимают шашку с самого старшего занятого.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos({ mode: 'long' }, [[18, 3], [20, 4], [22, 3], [23, 2]], [[17, 5], [15, 10]]),
          intro: 'Все белые шашки дома, три уже сняты.',
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: dice(6, 2), caption: 'Выпало 6 и 2.' },
            mv(18, 6, 'Шестёрка снимает шашку с шестого пункта.'),
            mv(22, 2, 'Двойка — со второго.'),
          ],
        },
      },
      {
        title: 'Победа, марс и кокс',
        html: `<p>Кто первым снял все шашки — выиграл <b>ойн</b> (1 очко). Если соперник не успел снять ни одной — <b>марс</b> (2 очка).
          <b>Кокс</b> (3 очка, включается в настройках) — марс, да ещё у проигравшего шашки остались в первой четверти пути (в коротких — на баре или в доме победителя).</p>
          <p>Можно играть одну партию или матч до 3, 5, 7 очков.</p>`,
      },
      {
        title: 'Короткие нарды: бой и бар',
        html: `<p>В коротких нардах шашки расставлены по-бэкгаммонному и идут <b>навстречу</b> друг другу. Одинокую шашку соперника можно <b>побить</b> —
          она уходит на бар и должна войти заново в дом соперника. Пока на баре есть своя шашка, ходить другими нельзя. На пункт с двумя и больше чужими шашками вставать нельзя.</p>
          <p>В розыгрыше первого хода каждый бросает по кубику — начинает тот, у кого больше, и сразу играет эти два числа.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos({ mode: 'short', koks: true }, [[0, 2], [11, 5], [16, 3], [18, 5]], [[0, 2], [11, 4], [15, 1], [16, 3], [18, 5]]),
          intro: 'Одинокая чёрная шашка стоит под ударом.',
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: dice(5, 3), caption: 'У белых 5 и 3.' },
            mv(0, 3, 'Тройкой — с 24-го на 21-й…'),
            mv(3, 5, '…и пятёркой дальше — прямо на одинокую чёрную. Бьём! Шашка уходит на бар.'),
            { seat: 1, action: { type: 'roll' }, rig: dice(4, 2), caption: 'Чёрные сначала обязаны войти с бара.' },
            { seat: 1, action: { type: 'move', from: BAR, die: 4 }, caption: 'Вход четвёркой в дом белых.' },
            { seat: 1, action: { type: 'move', from: 11, die: 2 }, caption: 'Теперь можно ходить остальными.' },
          ],
        },
      },
      {
        title: 'Куб удвоения',
        html: `<p>В коротких нардах можно играть с кубом. Перед своим броском игрок предлагает удвоить ставку. Соперник либо принимает (куб переходит к нему, и удвоить снова может только он),
          либо сдаётся и проигрывает партию по текущей ставке. В матче после того, как кому-то осталось одно очко, одна партия играется без куба (правило Кроуфорда).</p>`,
        demo: {
          seats: demoSeats,
          options: { mode: 'short', cube: true },
          setup: () => pos({ mode: 'short', cube: true, koks: true, target: 5 }, [[18, 4], [19, 4], [20, 4], [21, 3]], [[10, 5], [12, 5], [16, 5]]),
          intro: 'Белые далеко впереди в гонке.',
          steps: [
            { seat: 0, action: { type: 'double' }, caption: 'Белые предлагают удвоить.' },
            { seat: 1, action: { type: 'take' }, caption: 'Чёрные принимают: теперь партия стоит 2 очка, а куб у чёрных.' },
            { seat: 0, action: { type: 'roll' }, rig: dice(6, 5), caption: 'Игра идёт дальше.' },
          ],
        },
      },
      {
        title: 'Гюльбара: каскад дублей',
        html: `<p>Гюльбара начинается как длинные нарды: все шашки на голове, ходят в одну сторону, не бьют, одна шашка держит пункт.</p>
          <p>Главное — <b>каскад</b>: начиная с четвёртого хода, после дубля играют ещё все старшие дубли до 6:6. Выпало 4:4 — играете четыре четвёрки, потом четыре пятёрки и четыре шестёрки.
          Если очередной дубль сыграть нельзя, остаток доигрывает соперник перед своим броском.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos({ mode: 'gulbara', head: 'free' }, [[0, 15]], [[0, 15]], { turns: [4, 4] }),
          intro: 'Четвёртый ход белых.',
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: dice(5, 5), caption: 'Дубль 5:5 — а за ним каскадом ещё 6:6.' },
            mv(0, 5, 'Четыре пятёрки…'),
            mv(0, 5),
            mv(0, 5),
            mv(0, 5),
            mv(5, 6, '…и четыре шестёрки.'),
            mv(5, 6),
            mv(5, 6),
            mv(5, 6, 'Каскад сыгран.'),
          ],
        },
      },
    ],
  },
};
