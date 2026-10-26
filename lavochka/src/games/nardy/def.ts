/* Нарды — описание игры для сборника: варианты, боты, журнал, правила с показом. Без DOM. */
import type { GameDef, SeatSpec } from '../../core/types';
import { plural } from '../../core/util';
import { choose } from './ai';
import { apply, absOf, BAR, boardSize, cfgFrom, checkersOf, DEFAULT_CFG, newGame, OFF, sign, toAct, type Action, type Cfg, type EndKind, type Event, type Mode, type State } from './engine';

export const SEATS = [
  { name: 'Белые', color: '#e8dcc0', light: '#fffaf0', dark: '#8a7a5a', ink: '#7a5f30' },
  { name: 'Чёрные', color: '#2a211c', light: '#5a4a40', dark: '#0d0a08' },
];

/** Номер пункта глазами игрока: 24 — голова / самый дальний, 1 — последний пункт дома. */
const ptName = (i: number, fwd = false) => (i === BAR ? 'бар' : i === OFF ? 'снята' : String(fwd ? i + 1 : 24 - i));

const END_TEXT: Record<EndKind, string> = { oin: 'ойн', mars: 'марс', koks: 'кокс', homeMars: 'домашний марс', drop: 'отказ от удвоения', mother: 'зажата «мать»' };
const GREEK = ['tavli', 'portes', 'plakoto', 'fevga'];
const ROMAN = ['tabula', 'zeno', 'duodecim', 'pompeii'];
/** Варианты без правил длинных нард (головы, блока из шести, кокса). */
const NO_LONG = [...GREEK, ...ROMAN, 'short'];
const MODE_NAME: Record<string, string> = { portes: 'портес', plakoto: 'плакото', fevga: 'февга' };

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'opening': {
      const last = ev.rolls[ev.rolls.length - 1];
      const ties = ev.rolls.length > 1 ? ` (${ev.rolls.length - 1} ${plural(ev.rolls.length - 1, 'раз', 'раза', 'раз')} поровну)` : '';
      return `${ev.game > 1 ? `<b>Партия ${ev.game}.</b> ` : ''}${ev.mode && MODE_NAME[ev.mode] ? `<b>${MODE_NAME[ev.mode]}</b>. ` : ''}Розыгрыш первого хода: ${name(0)} ${last[0]}, ${name(1)} ${last[1]}${ties} — начинают ${name(ev.first)}.`;
    }
    case 'roll': {
      let t = `${name(ev.seat)}: <b>${ev.dice.join(':')}</b>`;
      if (ev.dice.length === 2 && ev.dice[0] === ev.dice[1]) t += ' — дубль';
      if (ev.cascade?.length) t += `, каскад до ${ev.cascade[ev.cascade.length - 1]}:${ev.cascade[ev.cascade.length - 1]}`;
      if (ev.noMoves) t += '. <i>Ходов нет.</i>';
      return t;
    }
    case 'stage':
      return `<i>Каскад: дубль ${ev.value}:${ev.value}.</i>`;
    case 'move': {
      const from = ev.from !== BAR ? ptName(ev.from, ev.fwd) : ev.fromHand ? 'с руки' : 'с бара';
      let t = `${name(ev.seat)}${ev.stolen ? ' (за соперника)' : ''}: ${from} → ${ev.to === OFF ? 'снята' : ptName(ev.to, ev.fwd)}`;
      if (ev.hit) t += ' — <b>бьёт!</b>';
      if (ev.pin) t += ' — <b>зажимает!</b>';
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

/** Римская позиция: шашки [индекс пути, сколько]; кого нет на доске — на руке (в extra можно задать off). */
function rpos(mode: Mode, white: [number, number][], black: [number, number][], extra: Partial<State> = {}): State {
  const cfg = cfgFrom({ mode });
  const s = newGame(cfg);
  s.pts = new Array(boardSize(cfg)).fill(0);
  const n = checkersOf(cfg);
  const off = extra.off ?? [0, 0];
  [white, black].forEach((list, p) => {
    for (const [i, k] of list) {
      if (i === BAR) s.bar[p] += k;
      else s.pts[absOf(cfg, p, i)] += k * sign(p);
    }
    s.hand![p] = n - off[p] - list.reduce((a, [, k]) => a + k, 0);
  });
  s.phase = 'roll';
  s.cur = 0;
  s.turns = [3, 3];
  return Object.assign(s, extra);
}

const dice = (a: number, b: number) => [a - 1, b - 1];
const dice3 = (a: number, b: number, c: number) => [a - 1, b - 1, c - 1];
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
        { value: 'tavli', label: 'тавли — портес, плакото, февга по кругу' },
        { value: 'portes', label: 'портес (греческие короткие)' },
        { value: 'plakoto', label: 'плакото — зажимать, а не бить' },
        { value: 'fevga', label: 'февга (греческие длинные)' },
        { value: 'tabula', label: 'табула (Древний Рим, три кости)' },
        { value: 'zeno', label: 'табула Зенона — навстречу, без снятия' },
        { value: 'duodecim', label: '12 линий (Ludus duodecim scriptorum)' },
        { value: 'pompeii', label: 'Duodecim scripta — доска-надпись из Помпей' },
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
      showIf: (o) => !NO_LONG.includes(String(o.mode)),
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
      showIf: (o) => !NO_LONG.includes(String(o.mode)),
    },
    { key: 'mars', label: 'Марс — 2 очка', hint: 'Соперник не успел снять ни одной шашки.', type: 'toggle', default: true, showIf: (o) => !ROMAN.includes(String(o.mode)) },
    {
      key: 'koks',
      label: 'Кокс — 3 очка',
      hint: 'Марс, да ещё у проигравшего шашки остались в первой четверти пути (в коротких — на баре или в доме победителя).',
      type: 'toggle',
      default: false,
      showIf: (o) => o.mars === true && !GREEK.includes(String(o.mode)) && !ROMAN.includes(String(o.mode)),
    },
    {
      key: 'homeMars',
      label: 'Домашний марс — 4 очка',
      hint: 'Марс, да ещё шашки проигравшего остались в доме победителя (так играют не везде).',
      type: 'toggle',
      default: false,
      showIf: (o) => o.mars === true && (o.mode === 'long' || o.mode === 'gulbara'),
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
    { id: 'tavli', label: 'Тавли', hint: 'Греческий матч до 5: портес, плакото, февга по очереди', options: { mode: 'tavli', target: 5, mars: true } },
    { id: 'portes', label: 'Портес', hint: 'Греческие короткие: бой, бар, марс — 2', options: { mode: 'portes', target: 1, mars: true } },
    { id: 'plakoto', label: 'Плакото', hint: 'Шашки навстречу; не бьют, а зажимают', options: { mode: 'plakoto', target: 1, mars: true } },
    { id: 'fevga', label: 'Февга', hint: 'Греческие длинные: первая шашка уходит вперёд одна', options: { mode: 'fevga', target: 1, mars: true } },
    { id: 'tabula', label: 'Табула', hint: 'Древний Рим: три кости, все шашки входят с руки, одиночку бьют', options: { mode: 'tabula', target: 1 } },
    { id: 'zeno', label: 'Табула Зенона', hint: 'Навстречу; не снимают — побеждает, кто первым соберёт всех в доме', options: { mode: 'zeno', target: 1 } },
    { id: 'duodecim', label: '12 линий', hint: 'Три ряда по 12 полей, три кости, по 15 шашек', options: { mode: 'duodecim', target: 1 } },
    { id: 'pompeii', label: 'Duodecim scripta', hint: 'Доска-надпись из Помпей: шесть слов по шесть букв, по 12 шашек', options: { mode: 'pompeii', target: 1 } },
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
    if (ROMAN.includes(s.cfg.mode)) return { winners: [s.winner], text: s.cfg.mode === 'zeno' ? 'первыми собрали все шашки в доме' : 'первыми вывели все шашки', scores };
    const txt = k === 'mars' ? 'марс — выиграли вдвойне' : k === 'koks' ? 'кокс — выиграли втройне' : k === 'homeMars' ? 'домашний марс — выиграли вчетверо' : k === 'drop' ? 'соперник отказался от удвоения' : 'первыми сняли все шашки';
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
          <b>Кокс</b> (3 очка, включается в настройках) — марс, да ещё у проигравшего шашки остались в первой четверти пути (в коротких — на баре или в доме победителя).
          В длинных можно включить и <b>домашний марс</b> (4 очка): марс, а шашки проигравшего ещё стоят в доме победителя — так играют не везде.</p>
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
      {
        title: 'Тавли: портес и февга',
        html: `<p><b>Тавли</b> — греческий матч из трёх игр по очереди: портес, плакото, февга, и снова по кругу, пока кто-то не наберёт условленные очки
          (обычно 5 или 7). Победа — 1 очко, марс (соперник не снял ни одной шашки) — 2.</p>
          <p><b>Портес</b> — это короткие нарды без куба: шашки идут навстречу, одиночку бьют на бар, с бара входят в дом соперника.
          <b>Февга</b> — длинные нарды: все 15 шашек на старте, ходят в одну сторону, не бьют, одна шашка держит пункт.
          Правила головы нет, зато пока первая ушедшая шашка не дошла до четверти соперника, вторую со старта снимать нельзя.</p>`,
      },
      {
        title: 'Плакото: зажим',
        html: `<p>Все 15 шашек на стартовом пункте, идут навстречу друг другу. Шашки не бьют: встал на <b>одиночную</b> шашку соперника — она
          <b>зажата</b> под твоей и не ходит, пока ты не уйдёшь с пункта. На пункт с двумя шашками соперника не встать.</p>
          <p>Зажал «мать» — шашку соперника на его стартовом пункте — и сразу победа с 2 очками.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos({ mode: 'plakoto', head: 'free' }, [[0, 13], [5, 1], [2, 1]], [[0, 14], [15, 1]]),
          intro: 'Плакото. Одиночная чёрная шашка в трёх пунктах от белой.',
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: dice(3, 1), caption: 'Выпало 3 и 1.' },
            mv(5, 3, 'Тройкой — прямо на чёрную: она зажата и не сдвинется, пока белая стоит сверху.'),
            mv(2, 1, 'Единицей — другой шашкой.'),
          ],
        },
      },
      {
        title: 'Табула: три кости и вход с руки',
        html: `<p><b>Табула</b> — римская предшественница нард, в неё играли от Августа до Византии. Доска та же, 24 пункта, у каждого 15 шашек,
          но в начале доска <b>пуста</b>: все шашки на руке и входят в первую четверть — кость с числом 3 ставит шашку на третий пункт.
          Бросают <b>три кости</b>, каждая — отдельный ход; дубль не удваивается. Сыграть надо столько костей, сколько получится.</p>
          <p>По реконструкции Остина (по описанию партии императора Зенона) оба игрока идут одной дорогой в одну сторону: входят справа вверху, дом — справа внизу.
          Пока на руке есть шашки, вошедшие не выходят за первую четверть.</p>`,
        demo: {
          seats: demoSeats,
          options: { mode: 'tabula' },
          setup: () => rpos('tabula', [[0, 2], [4, 1]], [[1, 2], [3, 1]]),
          intro: 'Табула. У белых три шашки на доске, двенадцать на руке; чёрные идут той же дорогой.',
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: dice3(6, 4, 2), caption: 'Три кости: 6, 4 и 2.' },
            mv(BAR, 6, 'Шестёрка — шашка с руки на шестой пункт.'),
            mv(BAR, 4, 'Четвёрка — тоже с руки, прямо на одинокую чёрную: она побита и уходит на бар.'),
            mv(0, 2, 'Шашка с пятого пункта двойкой ушла бы за первую четверть — пока на руке есть шашки, так нельзя. Двойку играет шашка с первого пункта.'),
          ],
        },
      },
      {
        title: 'Табула: бой и вход побитой',
        html: `<p>Одинокую шашку соперника бьют — она уходит на бар и входит заново с начала пути. Пока побитая не вошла, другими шашками ходить нельзя.
          На пункт с двумя шашками соперника вставать нельзя.</p>
          <p>Когда все шашки в последней четверти, их выводят с доски: кость снимает шашку со своего пункта, большая — с самого дальнего занятого.
          Первым вывел все 15 — победил. Марса в табуле нет.</p>`,
        demo: {
          seats: demoSeats,
          options: { mode: 'tabula' },
          setup: () => rpos('tabula', [[2, 1], [10, 7], [14, 7]], [[5, 1], [12, 7], [17, 7]]),
          intro: 'Все шашки вошли. На шестом пункте пути — одинокая чёрная.',
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: dice3(3, 6, 1), caption: 'У белых 3, 6 и 1.' },
            mv(2, 3, 'Тройкой — на чёрную: бьём, она уходит на бар.'),
            mv(5, 6, 'Шестёркой — дальше той же шашкой…'),
            mv(10, 1, '…и единицей.'),
            { seat: 1, action: { type: 'roll' }, rig: dice3(2, 5, 4), caption: 'Чёрные сначала обязаны ввести побитую.' },
            { seat: 1, action: { type: 'move', from: BAR, die: 2 }, caption: 'Двойкой — на второй пункт. Теперь можно ходить остальными.' },
          ],
        },
      },
      {
        title: 'Табула Зенона: навстречу и без снятия',
        html: `<p>Другая реконструкция по той же эпиграмме Агафия: шашки идут <b>навстречу</b> друг другу, как в коротких нардах, — каждый входит в свою первую четверть,
          она же дом соперника. Шашки не снимают: побеждает тот, кто первым соберёт все 15 в последней четверти.</p>
          <p>Агафий рассказывает, как Зенону выпало 2, 5 и 6 и его стройная позиция рассыпалась: пришлось оставить под боем сразу несколько одиночек.</p>`,
        demo: {
          seats: demoSeats,
          options: { mode: 'zeno' },
          setup: () => rpos('zeno', [[19, 6], [20, 5], [22, 3], [13, 1]], [[18, 8], [21, 4], [9, 3]]),
          intro: 'Табула Зенона. Белым осталось завести домой одну шашку.',
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: dice3(5, 2, 1), caption: 'Выпало 5, 2 и 1.' },
            mv(13, 5, 'Пятёркой последняя шашка входит в дом — все 15 собраны, белые победили.'),
          ],
        },
      },
      {
        title: '12 линий: три ряда по двенадцать',
        html: `<p><b>Ludus duodecim scriptorum</b> — «игра двенадцати линий», самая известная настольная игра Рима: доска в три ряда по 12 полей, разделённых посередине.
          У каждого 15 шашек, все на руке, бросают три кости, одиночку бьют, на два и больше чужих не встают — правила как в табуле.</p>
          <p>Путь — змейкой: белые входят в правую половину среднего ряда, идут по нему налево, потом по верхнему ряду направо и по своему нижнему — налево,
          и снимаются за его левым краем. Чёрные идут так же, но с другой стороны доски. Снимать можно, когда все шашки в последнем ряду.</p>`,
        demo: {
          seats: demoSeats,
          options: { mode: 'duodecim' },
          setup: () => rpos('duodecim', [[3, 2], [9, 1]], [[14, 2], [26, 1]]),
          intro: '12 линий. Белые — снизу, их путь начинается справа в среднем ряду.',
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: dice3(6, 5, 3), caption: 'Выпало 6, 5 и 3.' },
            mv(BAR, 6, 'Шестёркой — с руки на шестое поле среднего ряда.'),
            mv(9, 5, 'Пятёркой — из среднего ряда в верхний, на одинокую чёрную: бьём.'),
            mv(3, 3, 'Тройкой — дальше по среднему ряду.'),
          ],
        },
      },
      {
        title: 'Duodecim scripta: надпись из Помпей',
        html: `<p>Римляне часто вместо полей писали на доске буквы: 36 клеток — шесть слов по шесть букв. Здесь — настоящая мраморная плита из Помпей,
          меню таверны: <i>ABEMVS INCENA / PVLLVM PISCEM / PERNAM PAONEM</i> — «есть на ужин: курица, рыба, окорок, павлин»
          (в HABEMUS пропущена H, чтобы вышло шесть букв). Посередине — сердце, колесо и пальмовая ветвь, внизу — BENA TORES.
          Каждая буква — поле; на неё и ставят шашку.</p>
          <p>В этом варианте, как в наборе с такой доской, у каждого по <b>12 шашек</b> — партия короче. Остальные правила как в «12 линиях».</p>`,
        demo: {
          seats: demoSeats,
          options: { mode: 'pompeii' },
          setup: () => rpos('pompeii', [[4, 2], [14, 1]], [[1, 1], [6, 2]]),
          intro: 'Duodecim scripta. Каждая буква — поле.',
          steps: [
            { seat: 0, action: { type: 'roll' }, rig: dice3(6, 4, 1), caption: 'Выпало 6, 4 и 1.' },
            mv(BAR, 4, 'Четвёркой — с руки.'),
            mv(4, 6, 'Шестёркой — шашка доходит до одинокой чёрной и бьёт её.'),
            mv(14, 1, 'Единицей — по верхнему ряду.'),
          ],
        },
      },
    ],
  },
};
