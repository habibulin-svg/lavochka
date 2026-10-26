/* Го — описание игры: доска 9/13/19, японский или китайский подсчёт, фора, тибетское го 17×17 (миг-манг); 2 игрока; боты (Монте-Карло); правила с показом. */
import type { GameDef, SeatSpec } from '../../core/types';
import { choose } from './ai';
import { apply, BLACK, cfgFrom, makeView, newState, setup, toAct, WHITE, type Action, type Event, type State } from './engine';

export const SEATS = [
  { name: 'Чёрные', color: '#1a1a1a', light: '#555555', dark: '#000000' },
  { name: 'Белые', color: '#e8e4d8', light: '#ffffff', dark: '#b8b4a8', ink: '#6a665a' },
];

const COLS = 'ABCDEFGHJKLMNOPQRST';
export const coord = (n: number, p: number) => `${COLS[p % n]}${n - Math.floor(p / n)}`;

function describe(ev: Event, name: (seat: number) => string): string | null {
  switch (ev.type) {
    case 'play':
      return ev.captured.length ? `${name(ev.seat)} снимает ${ev.captured.length} ${ev.captured.length === 1 ? 'камень' : ev.captured.length < 5 ? 'камня' : 'камней'}` : null;
    case 'pass':
      return `${name(ev.seat)}: пас`;
    case 'resign':
      return `${name(ev.seat)} сдаётся.`;
    case 'end':
      return `🏁 Чёрные ${ev.score[0]} — белые ${ev.score[1]}. ${ev.winner < 0 ? 'Ничья.' : `Победа: ${name(ev.winner)}.`}`;
  }
  return null;
}

// ---------------------------------------------------------------- показ правил

const demoSeats: SeatSpec[] = [0, 1].map((seat) => ({ seat, kind: 'bot', name: SEATS[seat].name, level: 1 }));
/** Позиция 9×9 из рисунка: 9 строк, «x» — чёрный, «o» — белый, «.» — пусто. */
function pos(rows: string[], turn = 0, extra: Partial<State> = {}): State {
  const s = newState(cfgFrom({ size: 9 }));
  s.board = rows.join('').split('').map((ch) => (ch === 'x' ? BLACK : ch === 'o' ? WHITE : 0));
  s.turn = turn;
  return Object.assign(s, extra);
}
const P = (x: number, y: number) => y * 9 + x;
const M = (seat: number, x: number, y: number, caption?: string) => ({ seat, action: { type: 'play', p: P(x, y) } as Action, caption });
/** Тибетская доска 17×17: расстановка плюс камни из рисунка (строки с верхней-левой точки (x0, y0)); ход белых. */
function tibet(rows: string[] = [], x0 = 0, y0 = 0, turn = 1): State {
  const s = newState(cfgFrom({ rules: 'tibetan' }));
  rows.forEach((row, y) => row.split('').forEach((ch, x) => {
    if (ch !== ' ') s.board[(y0 + y) * 17 + x0 + x] = ch === 'x' ? BLACK : ch === 'o' ? WHITE : 0;
  }));
  s.turn = turn;
  return s;
}
const T = (seat: number, x: number, y: number, caption?: string) => ({ seat, action: { type: 'play', p: y * 17 + x } as Action, caption });
const TIBET_HINT = 'Тибетское го (миг-манг): доска 17×17 без звёзд и 12 камней заранее, первыми ходят белые, камень — не дальше пункта от своего, усиленное ко, бонус за центр и штраф за углы.';

export const def: GameDef<State, Action, Event, State> = {
  id: 'go',
  title: 'Го',
  players: { min: 2, max: 2, default: 2 },
  seats: SEATS,
  options: [
    {
      key: 'size',
      label: 'Доска',
      type: 'select',
      showIf: (o) => o.rules !== 'tibetan',
      choices: [
        { value: 9, label: '9×9 — быстро' },
        { value: 13, label: '13×13' },
        { value: 19, label: '19×19 — полная' },
      ],
      default: 9,
    },
    {
      key: 'rules',
      label: 'Правила',
      type: 'select',
      choices: [
        { value: 'japanese', label: 'японский подсчёт — территория и пленные, коми 6,5' },
        { value: 'chinese', label: 'китайский подсчёт — камни и территория, коми 7,5' },
        { value: 'tibetan', label: 'тибетское го (миг-манг) — 17×17 с расстановкой' },
      ],
      default: 'japanese',
    },
    { key: 'handicap', label: 'Фора чёрным', type: 'number', min: 0, max: 9, step: 1, default: 0, showIf: (o) => o.rules !== 'tibetan', hint: '2–9 камней на звёзды; белые ходят первыми, коми 0,5.' },
  ],
  presets: [
    { id: 'small', label: '9×9', hint: 'Для начала и быстрой партии', options: { size: 9, rules: 'japanese', handicap: 0 } },
    { id: 'mid', label: '13×13', hint: 'Средняя доска', options: { size: 13, rules: 'japanese', handicap: 0 } },
    { id: 'full', label: '19×19', hint: 'Настоящая доска; боты здесь слабые', options: { size: 19, rules: 'japanese', handicap: 0 } },
    { id: 'chinese', label: 'Китайский подсчёт', hint: '19×19, камни + территория', options: { size: 19, rules: 'chinese', handicap: 0 } },
    { id: 'handicap', label: 'С форой', hint: '9×9, у чёрных два камня', options: { size: 9, rules: 'japanese', handicap: 2 } },
    { id: 'tibet', label: 'Тибетское го', hint: TIBET_HINT, options: { size: 17, rules: 'tibetan', handicap: 0 } },
  ],

  setup: (seats, opts) => setup(seats.map((x) => x.seat), opts),
  toAct,
  apply: (s, seat, a, rng) => apply(s, seat, a, rng),
  view: (s) => makeView(s),
  result(s) {
    if (!s.over || !s.final) return null;
    const f = s.final;
    const scores = { 0: f.score[0], 1: f.score[1] };
    if (f.resign != null) return { winners: [f.winner], text: `${f.resign === 0 ? 'чёрные' : 'белые'} сдались`, scores };
    if (f.winner < 0) return { winners: [], text: `ничья, ${f.score[0]} : ${f.score[1]}`, scores };
    return { winners: [f.winner], text: `${f.score[0]} : ${f.score[1]}`, scores };
  },
  bot: { levels: ['Лёгкий', 'Средний', 'Сложный'], choose: (v, seat, lv, rng) => choose(v, seat, lv, rng) },
  describe,

  showcase: () =>
    pos(
      [
        '.........',
        '..xo.o...',
        '.x.xo.o..',
        '..xxoo...',
        '..x.xo.o.',
        '.xo.x.o..',
        '..o.xo...',
        '...xxo...',
        '.........',
      ],
      1,
      { last: P(4, 6), caps: [2, 1] }
    ),

  rules: {
    goal: 'Огородить камнями больше пунктов доски, чем соперник. Чёрные ходят первыми; камень ставят на пересечение линий и больше не двигают.',
    sections: [
      {
        title: 'Дыхания и взятие',
        html: `<p>Соседние по линиям камни одного цвета — <b>группа</b>. Свободные пункты рядом с группой — её <b>дыхания</b>.
          Закрыл последнее дыхание чужой группы — она снимается с доски, камни идут в плен.
          Ставить камень туда, где у своей группы не останется дыханий, нельзя — если только этим ходом не снимаешь чужие.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['.........', '.........', '...x.....', '..xo.....', '...x.....', '.........', '.........', '.........', '.........']),
          intro: 'У белого камня одно дыхание — справа.',
          steps: [M(0, 4, 3, 'Чёрные закрывают его — белый камень снят, он в плену.')],
        },
      },
      {
        title: 'Ко',
        html: `<p>Бывает, что взятие можно сразу «взять обратно» — и так без конца. Поэтому правило <b>ко</b>: нельзя ходом вернуть доску
          в положение, которое было перед прошлым ходом соперника. Сначала сходи в другое место — потом можно.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => pos(['.........', '.........', '...xo....', '..x.xo...', '...xo....', '.........', '.........', '.........', '.........'], 1),
          intro: 'Белые могут взять чёрный камень.',
          steps: [M(1, 3, 3, 'Белые берут. Чёрные сразу взять обратно не могут — это ко: им нужно сначала сходить в другом месте.'), M(0, 7, 7, 'Чёрные ходят в стороне — «угроза ко».'), M(1, 0, 0, 'Белые отвечают где-то ещё…'), M(0, 4, 3, '…и теперь чёрные могут взять обратно.')],
        },
      },
      {
        title: 'Конец и подсчёт',
        html: `<p>Когда ходить больше некуда с пользой, игроки <b>пасуют</b>; два паса подряд — конец. Безнадёжные камни внутри чужой территории
          считаются мёртвыми и снимаются в плен (их определяет программа, доигрывая позицию много раз).</p>
          <p><b>Японский подсчёт:</b> пустые пункты своей территории + пленные. <b>Китайский:</b> свои камни на доске + территория.
          Белым добавляется <b>коми</b> — 6,5 (японский) или 7,5 (китайский), за то что чёрные ходили первыми. Можно и сдаться.</p>
          <p>Боты играют доигрываниями «наугад» (Монте-Карло): на 9×9 — прилично, на 19×19 — слабо, как начинающий.</p>`,
      },
      {
        title: 'Тибетское го: расстановка и ход',
        html: `<p><b>Миг-манг</b> («много глаз») — го Тибета. Доска 17×17, звёзд на ней нет. До начала на третью линию ставят
          <b>12 камней</b> — через три пункта, чередуя чёрные и белые. <b>Первыми ходят белые.</b></p>
          <p>Новый камень можно ставить <b>не дальше чем через один пункт от своего</b> камня (в квадрате 5×5 вокруг него) —
          прыгать через всю доску нельзя, игра растёт от расстановки. Разрешённые пункты в свой ход видны точками.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => tibet(),
          intro: 'Расстановка: двенадцать камней на третьей линии, цвета чередуются. Ходят белые.',
          steps: [T(1, 6, 4, 'Белые ставят камень через пункт от своего.'), T(0, 4, 3, 'Чёрные отвечают рядом со своим угловым камнем.'), T(1, 8, 4, 'Дальше пункта от своих камней не сходить — игра растёт от расстановки.')],
        },
      },
      {
        title: 'Тибетское го: усиленное ко',
        html: `<p>Нельзя ставить камень в пункт, <b>откуда соперник только что снял камень</b>, — не только в ко, а после любого взятия.
          Сначала сходи в другое место, на следующий ход — можно.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => tibet(['   xo', '  x xo', '   xo'], 3, 6),
          intro: 'Белые могут взять чёрный камень.',
          steps: [T(1, 6, 7, 'Белые берут. В этот пункт чёрным сейчас ходить нельзя.'), T(0, 4, 3, 'Чёрные ходят в другом месте…'), T(1, 7, 4, 'Белые тоже…'), T(0, 7, 7, '…и теперь чёрные берут обратно.')],
        },
      },
      {
        title: 'Тибетское го: подсчёт',
        html: `<p>Считают по-китайски: очко за каждый свой камень на доске и за каждый пустой пункт своей территории; коми нет.</p>
          <p><b>+5 очков</b> тому, кто первым поставил камень в <b>центр</b> доски. <b>−20 очков</b> тому, чей угловой камень расстановки
          в конце оказался на чужой территории (соперник захватил угол). Равный счёт — ничья.</p>`,
        demo: {
          seats: demoSeats,
          setup: () => tibet(['x o', '   ', 'o x'], 7, 7),
          intro: 'Центр доски свободен — кто займёт его первым, получит 5 очков.',
          steps: [T(1, 8, 8, 'Белые первыми ставят камень в центр: +5 очков при подсчёте, даже если камень потом снимут.')],
        },
      },
    ],
  },
};
